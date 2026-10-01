// QA route planner (browser module, dev server only; not part of the game bundle).
//
//   const R = await import('/tools/qa/routes.js');
//   await R.verify('03-04');            // plan + replay one level in the real Level class
//   await R.verifyAll(['01-01', ...]);  // compact one-line-per-level results
//
// How it works: guards and cameras only react to the player when they perceive them, so with a
// player nobody can see their movements are fixed. A demo `Level` (the main menu's backdrop) is
// recorded frame by frame; the planner then searches, layer by layer (one layer = 8 frames), for
// player cells on a 16px lattice that no cone, laser, bird flock or fresh snow print can betray, and
// strings those into a route: stab each guard from behind (and not be seen to), collect intel, hack
// panels, reach the exit. The route is then replayed in a real `Level` (the real rules, real
// collision) with synthetic input and the result is read from `level.stats`.
//
// A route counts only if the replay ends with completed, detections 0, bodiesDiscovered 0, hp 3.
// Movement uses an analog stick (full speed, stopping exactly on lattice points); on a keyboard the
// same legs are 8-direction moves with waiting in between.

import { Level } from '/src/game/Level.js';
import { loadLevel } from '/src/levels/index.js';
import { parseLevel } from '/src/levels/schema.js';
import { hasLineOfSight } from '/src/world/raycast.js';
import { isBoxClear } from '/src/world/collision.js';
import { TILE_SIZE } from '/src/world/tiles.js';
import { CAMERA_FOV, CAMERA_RANGE, VISION_FOV, VISION_RANGE } from '/src/entities/vision.js';
import { BIRD_PROXIMITY } from '/src/entities/wildlifeRules.js';
import { distanceToSegment, laserActiveAt } from '/src/entities/securityRules.js';

const LAT = 16; // lattice spacing in px
const FPL = 8; // frames per layer (8/60 s: a diagonal lattice step at walking speed takes 7.5 frames)
const DT = 1 / 60;
const PLAYER_SPEED = 180;
const MOVES = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const OFFS = [[-6, 0], [6, 0], [0, -6], [0, 6]];
const STAB_RANGE = 28; // the game allows 36
const STAB_ANGLE = (105 * Math.PI) / 180; // the game allows 95
const HOLD_STAB = 2; // layers the player is rooted after a stab (0.2s lock)
const HOLD_HACK = 3; // 0.4s lock
const PRINT_LIFE_FRAMES = 14 * 60;
// Safety margins in tiers: 'safe' keeps a clear gap round every cone, 'tight' leaves only a few px,
// 'exact' uses the game's own numbers (a route found only here is real but needs precise play).
export const TIERS = {
  safe: { rangePad: 18, anglePad: (4 * Math.PI) / 180, offsets: true },
  tight: { rangePad: 13, anglePad: (1.5 * Math.PI) / 180, offsets: false },
  exact: { rangePad: 10.5, anglePad: (0.3 * Math.PI) / 180, offsets: false },
};

const angDiff = (a, b) => {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
};

const inputStub = () => ({
  move: { x: 0, y: 0 },
  attack: false,
  interact: false,
  getMoveVector() {
    return this.move;
  },
  isActionDown() {
    return false;
  },
  wasActionPressed(action) {
    return (action === 'attack' && this.attack) || (action === 'interact' && this.interact);
  },
});

class Planner {
  constructor(data, opts = {}) {
    this.data = data;
    this.opts = { budget: 60, timeMs: 25000, enough: 0.8, hacks: false, tier: 'safe', ...opts };
    this.tier = TIERS[this.opts.tier];
    this.horizon = Math.min(14400, Math.ceil((data.targetTime * 2.4 * 60) / FPL) * FPL);
    this.layers = this.horizon / FPL;
    this._record();
    const tm = (this.tm = this.ghost.tilemap);
    this.nx = data.cols * 2 + 1;
    this.ny = data.rows * 2 + 1;
    this.ncell = this.nx * this.ny;
    this.cpx = new Float32Array(this.ncell);
    this.cpy = new Float32Array(this.ncell);
    this.walk = new Uint8Array(this.ncell);
    this.snow = new Uint8Array(this.ncell);
    this.bird = new Uint8Array(this.ncell);
    for (let c = 0; c < this.ncell; c++) {
      const x = (c % this.nx) * LAT;
      const y = Math.floor(c / this.nx) * LAT;
      this.cpx[c] = x;
      this.cpy[c] = y;
      this.walk[c] = isBoxClear(tm, x, y, 10) ? 1 : 0;
      this.snow[c] = [[0, 0], ...OFFS].some(([ox, oy]) => tm.isSnowAtWorld(x + ox, y + oy)) ? 1 : 0;
      this.bird[c] = data.wildlife.some((b) => Math.hypot(b.x - x, b.y - y) <= BIRD_PROXIMITY + 8) ? 1 : 0;
    }
    this.ctxs = new Map();
    this.snowSeenCache = new Map();
    this.laserCache = new Map();
    this.nodes = 0;
    this.t0 = performance.now();
  }

  cell(x, y) {
    return Math.round(y / LAT) * this.nx + Math.round(x / LAT);
  }

  // --- ghost recording -------------------------------------------------------------------

  _record() {
    const lvl = (this.ghost = new Level(this.data, { demo: true }));
    const input = inputStub();
    const n = this.horizon + FPL + 1;
    const mk = () => ({ x: new Float32Array(n), y: new Float32Array(n), f: new Float32Array(n) });
    this.G = lvl.guards.map((g) => ({ ...mk(), kind: 'g', ref: g, range: VISION_RANGE, half: VISION_FOV / 2, target: g.target }));
    this.C = lvl.cameras.map((cam, i) => ({
      ...mk(),
      kind: 'c',
      ref: cam,
      range: CAMERA_RANGE,
      half: CAMERA_FOV / 2,
      cache: null,
      panel: this.data.cameras[i].panel,
    }));
    this.anomalies = [];
    for (let f = 0; f < n; f++) {
      for (const e of [...this.G, ...this.C]) {
        e.x[f] = e.ref.x;
        e.y[f] = e.ref.y;
        e.f[f] = e.ref.facing;
      }
      lvl.update(DT, input);
      for (const g of lvl.guards) if (g.state !== 'patrol' && !this.anomalies.length) this.anomalies.push(`guard ${this.G.findIndex((e) => e.ref === g)} ${g.state} at ${(f / 60).toFixed(1)}s`);
    }
    const size = (this.horizon / FPL + 2) * 4400; // upper bound on ncell * layers, sized lazily below
    this._cacheSize = size;
  }

  _entityCache(e) {
    if (!e.cache) e.cache = new Uint8Array((this.layers + 2) * this.ncell);
    return e.cache;
  }

  // --- perception --------------------------------------------------------------------------

  sees(e, f, px, py, range, half) {
    const gx = e.x[f];
    const gy = e.y[f];
    const dx = px - gx;
    const dy = py - gy;
    const d2 = dx * dx + dy * dy;
    if (d2 > range * range) return false;
    if (d2 > 256 && Math.abs(angDiff(Math.atan2(dy, dx), e.f[f])) > half) return false;
    const tm = this.tm;
    if (hasLineOfSight(tm, gx, gy, px, py)) return true;
    if (this.tier.offsets) for (const [ox, oy] of OFFS) if (hasLineOfSight(tm, gx, gy, px + ox, py + oy)) return true;
    return false;
  }

  /** Could entity `e` see a player standing on cell `c` at any frame of layer `k`? */
  expo(e, c, k) {
    const cache = this._entityCache(e);
    const idx = k * this.ncell + c;
    const v = cache[idx];
    if (v) return v === 2;
    const f0 = k * FPL;
    const px = this.cpx[c];
    const py = this.cpy[c];
    let hit = false;
    for (let f = f0; f <= f0 + FPL && !hit; f++) hit = this.sees(e, f, px, py, e.range + this.tier.rangePad, e.half + this.tier.anglePad);
    cache[idx] = hit ? 2 : 1;
    return hit;
  }

  /** Frames at which guard `e` could see a fresh print at cell `c` (sorted). */
  snowSeen(e, c) {
    const key = (e.kind === 'g' ? 'g' : 'c') + this.G.indexOf(e) + ':' + c;
    let list = this.snowSeenCache.get(key);
    if (!list) {
      list = [];
      const px = this.cpx[c];
      const py = this.cpy[c];
      for (let f = 0; f <= this.horizon + FPL; f++) if (this.sees(e, f, px, py, 170 + this.tier.rangePad - 8, e.half + this.tier.anglePad)) list.push(f);
      this.snowSeenCache.set(key, list);
    }
    return list;
  }

  snowBlocked(e, c, k) {
    const list = this.snowSeen(e, c);
    if (!list.length) return false;
    const lo = k * FPL;
    const hi = lo + FPL + PRINT_LIFE_FRAMES;
    let a = 0;
    let b = list.length;
    while (a < b) {
      const m = (a + b) >> 1;
      if (list[m] < lo) a = m + 1;
      else b = m;
    }
    return a < list.length && list[a] <= hi;
  }

  laserBlocked(li, c, k) {
    const l = this.data.lasers[li];
    const px = this.cpx[c];
    const py = this.cpy[c];
    if (distanceToSegment(px, py, l.x1, l.y1, l.x2, l.y2) > 10 + 4 + 12) return false;
    const key = `${li}:${k}`;
    let on = this.laserCache.get(key);
    if (on === undefined) {
      on = false;
      const f0 = k * FPL;
      for (let f = f0 - 12; f <= f0 + FPL + 12 && !on; f++) on = laserActiveAt(l, f * DT);
      this.laserCache.set(key, on);
    }
    return on;
  }

  // --- contexts: which enemies are alive / which panels are hacked ----------------------------

  ctx(alive, hacked) {
    const key = alive.join('') + '|' + [...hacked].sort().join(',');
    let ctx = this.ctxs.get(key);
    if (!ctx) {
      ctx = {
        key,
        alive,
        camOn: this.C.map((cam) => !(cam.panel && hacked.has(cam.panel))),
        laserOn: this.data.lasers.map((l) => !(l.panel && hacked.has(l.panel))),
        cache: new Uint8Array((this.layers + 2) * this.ncell),
      };
      this.ctxs.set(key, ctx);
    }
    return ctx;
  }

  safe(ctx, c, k) {
    const idx = k * this.ncell + c;
    const v = ctx.cache[idx];
    if (v) return v === 1;
    let ok = !this.bird[c];
    for (let i = 0; ok && i < this.G.length; i++) if (ctx.alive[i] && this.expo(this.G[i], c, k)) ok = false;
    for (let i = 0; ok && i < this.C.length; i++) if (ctx.camOn[i] && this.expo(this.C[i], c, k)) ok = false;
    for (let i = 0; ok && i < this.data.lasers.length; i++) if (ctx.laserOn[i] && this.laserBlocked(i, c, k)) ok = false;
    if (ok && this.snow[c]) for (let i = 0; ok && i < this.G.length; i++) if (ctx.alive[i] && this.snowBlocked(this.G[i], c, k)) ok = false;
    ctx.cache[idx] = ok ? 1 : 2;
    return ok;
  }

  // --- bodies -----------------------------------------------------------------------------------

  /** First frame >= from at which anything still watching could see a body at (x, y); Infinity if never. */
  bodySeen(x, y, from, ctx) {
    if (this.tm.isConcealingAtWorld(x, y)) return Infinity;
    let first = Infinity;
    const scan = (e) => {
      for (let f = from; f < Math.min(first, this.horizon + FPL); f++) {
        if (this.sees(e, f, x, y, e.range + this.tier.rangePad - 8, e.half + this.tier.anglePad)) {
          first = f;
          return;
        }
      }
    };
    this.G.forEach((e, i) => ctx.alive[i] && scan(e));
    this.C.forEach((e, i) => ctx.camOn[i] && scan(e));
    return first;
  }

  // --- search ---------------------------------------------------------------------------------------

  /**
   * Layered flood fill from (state.k, state.c) until `goal` can be achieved. Returns candidate events
   * { k, c, path, hold } where path[i] is the cell at layer state.k + i (including the hold).
   */
  bfs(state, goal, limitFrame, maxEvents) {
    const ctx = this.ctx(state.alive, state.hacked);
    const childAlive = state.alive.slice();
    const childHacked = new Set(state.hacked);
    if (goal.type === 'stab') childAlive[goal.gi] = 0;
    if (goal.type === 'hack') childHacked.add(goal.panel);
    const childCtx = goal.type === 'stab' || goal.type === 'hack' ? this.ctx(childAlive, childHacked) : ctx;
    const hold = goal.type === 'stab' ? HOLD_STAB : goal.type === 'hack' ? HOLD_HACK : 0;
    const K0 = state.k;
    const kMax = Math.min(this.layers - hold - 1, Math.floor(limitFrame / FPL));
    if (K0 > kMax || !this.safe(ctx, state.c, K0)) return [];

    const parents = [];
    let active = [state.c];
    const stamp = new Int32Array(this.ncell).fill(-1);
    const events = [];
    let firstEvent = -1;
    const spacing = 12;
    const scanLayers = goal.type === 'exit' ? 0 : 150;

    for (let k = K0; k <= kMax; k++) {
      if (firstEvent >= 0 && k > firstEvent + scanLayers) break;
      // goal test on this layer
      let best = null;
      let bestScore = -1;
      for (const c of active) {
        const score = this.goalScore(goal, k, c, state, childCtx, hold);
        if (score > bestScore) {
          bestScore = score;
          best = c;
        }
      }
      if (best !== null) {
        if (firstEvent < 0) firstEvent = k;
        if (!events.length || k - events[events.length - 1].k >= spacing) events.push({ k, c: best });
        if (events.length >= maxEvents) break;
      }
      if (k === kMax) break;
      // expand
      const parent = new Int16Array(this.ncell).fill(-1);
      const next = [];
      for (const c of active) {
        const cx = c % this.nx;
        const cy = (c - cx) / this.nx;
        for (const [mx, my] of MOVES) {
          const x2 = cx + mx;
          const y2 = cy + my;
          if (x2 < 0 || y2 < 0 || x2 >= this.nx || y2 >= this.ny) continue;
          const c2 = y2 * this.nx + x2;
          if (stamp[c2] === k + 1 || !this.walk[c2]) continue;
          if (mx && my && !(this.walk[cy * this.nx + x2] && this.walk[y2 * this.nx + cx])) continue;
          if (!this.safe(ctx, c2, k) || !this.safe(ctx, c2, k + 1)) continue;
          stamp[c2] = k + 1;
          parent[c2] = c;
          next.push(c2);
        }
      }
      parents.push(parent);
      active = next;
      this.lastBfs = { layer: k + 1, active: active.length };
      if (this.debug) (this.reachLog ??= []).push(active.slice());
      if (!active.length) break;
    }

    return events.map((ev) => {
      const path = [];
      let c = ev.c;
      for (let k = ev.k; k > K0; k--) {
        path[k - K0] = c;
        c = parents[k - K0 - 1][c];
      }
      path[0] = state.c;
      for (let h = 1; h <= hold; h++) path[ev.k - K0 + h] = ev.c;
      return { ...ev, path, hold, endK: ev.k + hold };
    });
  }

  goalScore(goal, k, c, state, childCtx, hold) {
    const px = this.cpx[c];
    const py = this.cpy[c];
    switch (goal.type) {
      case 'stab': {
        const e = this.G[goal.gi];
        const f = k * FPL;
        const dx = px - e.x[f];
        const dy = py - e.y[f];
        const d = Math.hypot(dx, dy);
        if (d > STAB_RANGE) return -1;
        const ang = Math.abs(angDiff(Math.atan2(dy, dx), e.f[f]));
        if (ang < STAB_ANGLE) return -1;
        // nothing else may be nearer to the player than the target
        for (let i = 0; i < this.G.length; i++) {
          if (i === goal.gi || !state.alive[i]) continue;
          if (Math.hypot(px - this.G[i].x[f], py - this.G[i].y[f]) <= 40) return -1;
        }
        for (let h = 1; h <= hold; h++) if (!this.safe(childCtx, c, k + h)) return -1;
        return ang - d * 0.01;
      }
      case 'intel': {
        const item = this.data.intel[goal.idx];
        return Math.hypot(px - item.x, py - item.y) <= 16 ? 1 : -1;
      }
      case 'hack': {
        const p = this.data.panels[goal.pi];
        if (Math.hypot(px - p.x, py - p.y) > 24) return -1;
        for (let h = 1; h <= hold; h++) if (!this.safe(childCtx, c, k + h)) return -1;
        return 1;
      }
      case 'exit': {
        // the tile centre, so a few px of key jitter can't leave the player outside the tile
        return this.data.exits.some((e) => e.x === px && e.y === py) ? 1 : -1;
      }
    }
    return -1;
  }

  goalsFor() {
    const goals = [];
    const { objectives } = this.data;
    if (objectives.includes('eliminateAll')) this.G.forEach((_, gi) => goals.push({ type: 'stab', gi }));
    if (objectives.includes('eliminateTargets')) this.G.forEach((g, gi) => g.target && goals.push({ type: 'stab', gi }));
    if (objectives.includes('collect')) this.data.intel.forEach((_, idx) => goals.push({ type: 'intel', idx }));
    if (this.opts.hacks) {
      const used = new Set([...this.data.cameras.map((c) => c.panel), ...this.data.lasers.map((l) => l.panel)].filter(Boolean));
      this.data.panels.forEach((p, pi) => used.has(p.id) && goals.push({ type: 'hack', pi, panel: p.id }));
    }
    return goals;
  }

  solve() {
    if (this.data.objectives.includes('defeatBoss')) return { error: 'boss levels are not supported by the planner' };
    const goals = this.goalsFor();
    const spawn = this.cell(this.data.spawn.x, this.data.spawn.y);
    const alive = this.G.map(() => 1);
    const root = { k: 0, c: spawn, alive, hacked: new Set(), path: [spawn], done: [], bodies: [], marks: [] };
    this.best = null;
    this.dfs(root, goals);
    if (!this.best) return { error: 'no route', nodes: this.nodes, anomalies: this.anomalies };
    return { ...this.best, nodes: this.nodes, anomalies: this.anomalies };
  }

  horizonFor(state) {
    // The earliest frame at which an unconcealed body will be seen by something still watching.
    let h = this.horizon;
    const ctx = this.ctx(state.alive, state.hacked);
    for (const b of state.bodies) {
      const f = this.bodySeen(b.x, b.y, b.frame, ctx);
      h = Math.min(h, f - FPL * 2);
    }
    return h;
  }

  dfs(state, goals) {
    if (this.nodes >= this.opts.budget || performance.now() - this.t0 > this.opts.timeMs) return;
    const remaining = goals.filter((g) => !state.done.some((d) => d.type === g.type && d.gi === g.gi && d.idx === g.idx && d.pi === g.pi));
    const bound = this.best ? this.best.endK * FPL - 1 : this.horizon;
    const limit = Math.min(bound, this.horizonFor(state));
    if (!remaining.length) {
      this.nodes++;
      const [ev] = this.bfs(state, { type: 'exit' }, limit, 1);
      if (!ev) return;
      const path = state.path.slice(0, state.k).concat(ev.path);
      if (!this.best || ev.k < this.best.endK) this.best = { endK: ev.k, seconds: (ev.k * FPL) / 60, path, marks: state.marks, bodies: state.bodies };
      return;
    }
    const cands = [];
    for (const goal of remaining) {
      this.nodes++;
      for (const ev of this.bfs(state, goal, limit, goal.type === 'stab' ? 4 : 1)) cands.push({ goal, ev });
      if (this.nodes >= this.opts.budget) break;
    }
    // earliest event per goal first, then the rest by time
    const seen = new Set();
    const ordered = [];
    cands.sort((a, b) => a.ev.k - b.ev.k);
    for (const cd of cands) {
      const id = JSON.stringify(cd.goal);
      if (!seen.has(id)) {
        seen.add(id);
        ordered.push(cd);
      }
    }
    for (const cd of cands) if (!ordered.includes(cd)) ordered.push(cd);
    let tried = 0;
    for (const { goal, ev } of ordered) {
      if (tried++ >= 7 || this.nodes >= this.opts.budget) break;
      if (this.best && ev.endK * FPL >= this.best.endK * FPL - 1) continue;
      const child = {
        k: ev.endK,
        c: ev.c,
        alive: state.alive.slice(),
        hacked: new Set(state.hacked),
        path: state.path.slice(0, state.k).concat(ev.path),
        done: [...state.done, goal],
        bodies: state.bodies.slice(),
        marks: [...state.marks, { k: ev.k, type: goal.type, gi: goal.gi, pi: goal.pi, idx: goal.idx }],
      };
      if (goal.type === 'stab') {
        child.alive[goal.gi] = 0;
        const e = this.G[goal.gi];
        child.bodies.push({ x: e.x[ev.k * FPL], y: e.y[ev.k * FPL], frame: ev.k * FPL + FPL });
      }
      if (goal.type === 'hack') child.hacked.add(goal.panel);
      this.dfs(child, goals);
      if (this.best && this.best.seconds <= this.data.targetTime * this.opts.enough) return;
    }
  }
}

/** Replays a route in a real Level with synthetic input; returns the outcome read from the level. */
function replay(data, plan, { extraSeconds = 4 } = {}) {
  const lvl = new Level(data);
  const input = inputStub();
  const nx = plan.nx;
  const actions = new Map();
  for (const m of plan.marks) {
    if (m.type === 'stab') actions.set(m.k * FPL, 'attack');
    if (m.type === 'hack') actions.set(m.k * FPL, 'interact');
  }
  const path = plan.path;
  const lastFrame = (path.length - 1) * FPL + extraSeconds * 60;
  let maxDev = 0;
  let u = 0;
  for (; u < lastFrame && !lvl.finished; u++) {
    const k = Math.floor(u / FPL);
    const target = path[Math.min(k + 1, path.length - 1)];
    const tx = (target % nx) * LAT;
    const ty = Math.floor(target / nx) * LAT;
    const p = lvl.player;
    const dx = tx - p.x;
    const dy = ty - p.y;
    const dist = Math.hypot(dx, dy);
    const mag = Math.min(1, dist / (PLAYER_SPEED * DT));
    input.move = dist < 0.25 ? { x: 0, y: 0 } : { x: (dx / dist) * mag, y: (dy / dist) * mag };
    const act = actions.get(u);
    input.attack = act === 'attack';
    input.interact = act === 'interact';
    const cur = path[Math.min(k, path.length - 1)];
    if (u % FPL === 0) maxDev = Math.max(maxDev, Math.hypot(p.x - (cur % nx) * LAT, p.y - Math.floor(cur / nx) * LAT));
    lvl.update(DT, input);
  }
  const s = lvl.stats;
  return {
    completed: lvl.completed,
    failed: lvl.failed,
    hp: lvl.player.hp,
    detections: s.detections,
    bodiesDiscovered: s.bodiesDiscovered,
    fullAlarms: s.fullAlarms,
    kills: s.kills,
    stealthKills: s.stealthKills,
    elapsed: +s.elapsed.toFixed(2),
    maxDev: +maxDev.toFixed(1),
    guardsLeft: lvl.guards.length,
    states: lvl.guards.map((g) => g.state),
  };
}

/** The parsed level; `opts.json` (a level file's JSON, possibly edited) overrides the file on disk. */
const getData = (id, opts) => (opts.json ? parseLevel(structuredClone(opts.json)) : loadLevel(id));

export async function plan(id, opts = {}) {
  const data = await getData(id, opts);
  const planner = new Planner(data, opts);
  const result = planner.solve();
  result.nx = planner.nx;
  result.ms = Math.round(performance.now() - planner.t0);
  result.planner = planner;
  return result;
}

/** Plan (tiers from generous to exact margins; without hacks, then with) and replay. */
export async function verify(id, opts = {}) {
  const data = await getData(id, opts);
  const tiers = opts.tier ? [opts.tier] : Object.keys(TIERS);
  const canHack = (data.cameras.length || data.lasers.length) && data.panels.length;
  const attempts = [];
  for (const tier of tiers) for (const hacks of canHack ? (opts.hacks === undefined ? [false, true] : [opts.hacks]) : [false]) attempts.push({ tier, hacks });
  let row = { id, name: data.name, target: data.targetTime };
  let totalMs = 0;
  let totalNodes = 0;
  for (const a of attempts) {
    const result = await plan(id, { ...opts, ...a });
    totalMs += result.ms;
    totalNodes += result.nodes ?? 0;
    row = { ...row, nodes: totalNodes, ms: totalMs };
    if (result.anomalies?.length) row.anomalies = result.anomalies;
    if (result.error) {
      row.error = result.error;
      continue;
    }
    const real = replay(await getData(id, opts), result);
    const ok = real.completed && real.detections === 0 && real.bodiesDiscovered === 0 && real.hp === 3 && real.fullAlarms === 0;
    row = {
      ...row,
      ok,
      error: undefined,
      tier: a.tier,
      hacks: a.hacks,
      planned: +result.seconds.toFixed(1),
      real,
      within: real.elapsed <= data.targetTime,
      marks: result.marks.map((m) => `${m.type}${m.gi ?? m.pi ?? m.idx ?? ''}@${((m.k * FPL) / 60).toFixed(1)}`),
    };
    if (ok) return row;
    row.error = `replay failed (${a.tier}${a.hacks ? ', hacks' : ''}): det=${real.detections} body=${real.bodiesDiscovered} hp=${real.hp} done=${real.completed}`;
  }
  return { ...row, ok: false };
}

export async function verifyAll(ids, opts = {}) {
  const rows = [];
  for (const id of ids) {
    try {
      const r = await verify(id, opts);
      rows.push(r);
    } catch (e) {
      rows.push({ id, ok: false, error: String(e?.stack ?? e).slice(0, 300) });
    }
  }
  return rows;
}

export const summary = (r) =>
  !r.ok && (r.error || !r.real)
    ? `${r.id} FAIL ${r.error} (${r.nodes} nodes, ${r.ms}ms)`
    : `${r.id} ${r.ok ? 'OK  ' : 'FAIL'} ${r.tier === 'safe' ? '' : r.tier.toUpperCase() + ' '}${r.real.elapsed}s/${r.target}s ${r.within ? '' : 'SLOW '}det=${r.real.detections} body=${r.real.bodiesDiscovered} hp=${r.real.hp} kills=${r.real.stealthKills}/${r.real.kills} dev=${r.real.maxDev} ${r.hacks ? 'hacks ' : ''}[${r.marks.join(' ')}] (${r.nodes} nodes, ${r.ms}ms)`;

/**
 * Plays a route through the LIVE game with real keyboard events (8-direction movement, Space/E presses),
 * for a cross-check of the analog replay. The page must be at `?level=<id>`. Scheduling follows
 * `level.time`, because the game freezes the level for a few frames after a stab (hit-stop).
 */
export async function playKeyboard(id, opts = {}) {
  const result = await plan(id, opts);
  if (result.error) return { id, ok: false, error: result.error };
  const { game, level } = window.__debug;
  const lvl = () => window.__debug.level;
  const key = (type, code) => document.body.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
  const held = new Set();
  const setKeys = (want) => {
    for (const c of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) {
      const on = want.includes(c);
      if (on && !held.has(c)) { key('keydown', c); held.add(c); }
      if (!on && held.has(c)) { key('keyup', c); held.delete(c); }
    }
  };
  key('keydown', 'KeyR'); key('keyup', 'KeyR'); game._update(DT);
  if (lvl().data.id !== id) return { id, ok: false, error: `page is on ${lvl().data.id}, not ${id}` };
  const actions = new Map();
  for (const m of result.marks) {
    if (m.type === 'stab') actions.set(m.k * FPL, 'Space');
    if (m.type === 'hack') actions.set(m.k * FPL, 'KeyE');
  }
  const { path, nx } = result;
  const fired = new Set();
  for (let ticks = 0; ticks < 30000 && !lvl().finished; ticks++) {
    const f = Math.round(lvl().time * 60);
    const k = Math.floor(f / FPL);
    if (k >= path.length + 60) break;
    const target = path[Math.min(k + 1, path.length - 1)];
    const p = lvl().player;
    const dx = (target % nx) * LAT - p.x;
    const dy = Math.floor(target / nx) * LAT - p.y;
    const want = [];
    if (dx > 2.5) want.push('KeyD');
    if (dx < -2.5) want.push('KeyA');
    if (dy > 2.5) want.push('KeyS');
    if (dy < -2.5) want.push('KeyW');
    setKeys(want);
    const act = actions.get(f);
    const press = act && !fired.has(f);
    if (press) { key('keydown', act); fired.add(f); }
    game._update(DT);
    if (press) key('keyup', act);
  }
  setKeys([]);
  const s = lvl().stats;
  const ok = lvl().completed && s.detections === 0 && s.bodiesDiscovered === 0 && lvl().player.hp === 3;
  return { id, ok, completed: lvl().completed, hp: lvl().player.hp, detections: s.detections, bodiesDiscovered: s.bodiesDiscovered, kills: `${s.stealthKills}/${s.kills}`, elapsed: +s.elapsed.toFixed(2), planned: +result.seconds.toFixed(1) };
}
