import { Container, EventEmitter, Graphics } from 'pixi.js';
import { Tilemap } from '../world/Tilemap.js';
import { TILE_SIZE } from '../world/tiles.js';
import { Effects } from '../world/Effects.js';
import { hasLineOfSight } from '../world/raycast.js';
import { moveAndCollide } from '../world/collision.js';
import { Player, PLAYER_SPEED } from '../entities/Player.js';
import { Guard, GuardState } from '../entities/Guard.js';
import { Body } from '../entities/Body.js';
import { angleDiff } from '../core/math.js';

const TAKEDOWN_RANGE = 36;
// Takedown is silent when the player is at least this far off the guard's facing (i.e. behind it).
const BACKSTAB_MIN_ANGLE = (95 * Math.PI) / 180;
const TAKEDOWN_LOCK_TIME = 0.2;
const GRAB_RANGE = 30;
const DRAG_OFFSET = 18;

const SPRINT_NOISE_RADIUS = 190;
const SPRINT_STEP_INTERVAL = 0.28;
const LOUD_KILL_NOISE_RADIUS = 320;
// Walls muffle sound: guards without line of sight to a noise hear it at reduced range.
const MUFFLED_NOISE_FACTOR = 0.6;
const BACKUP_RADIUS = 360;
const PICKUP_RANGE = 22;

const COLOR = {
  noise: 0xdcdcf0,
  alarm: 0xff4545,
  body: 0xffa53d,
  silent: 0xffffff,
  tracer: 0xffd27a,
  exit: 0x4ade80,
  exitLocked: 0x3a5a46,
  intel: 0xffd166,
};

const OBJECTIVE_LABELS = {
  eliminateAll: 'Eliminate all guards',
  eliminateTargets: 'Eliminate the targets',
  collect: 'Collect the intel',
  exit: 'Reach the exit',
};

/**
 * One playable level, built from parsed level data (see levels/schema.js):
 * owns the map, player, guards, bodies and effects, and applies the rules that
 * connect them (takedowns, noise, backup calls, damage, objectives).
 *
 * Events: 'failed' (stats) when the player dies, 'completed' (stats) when all
 * objectives are done.
 */
export class Level extends EventEmitter {
  constructor(data) {
    super();
    this.data = data;
    this.tilemap = new Tilemap(data.cols, data.rows, data.grid);
    this.effects = new Effects();
    this.markers = new Graphics();

    this.root = new Container();
    this.bodyLayer = new Container();
    this.coneLayer = new Container();
    this.entityLayer = new Container();
    this.root.addChild(
      this.tilemap.view,
      this.markers,
      this.bodyLayer,
      this.coneLayer,
      this.entityLayer,
      this.effects.view,
    );

    this.player = new Player(data.spawn.x, data.spawn.y);
    this.guards = data.guards.map((guardConfig) => this._addGuard(guardConfig));
    this.entityLayer.addChild(this.player.view);
    this.bodies = [];

    this.objectives = data.objectives;
    this.exits = data.exits;
    this.intel = data.intel.map((item) => ({ ...item, collected: false }));
    this.totalGuards = this.guards.length;
    this.totalTargets = this.guards.filter((g) => g.target).length;
    this.exitUnlocked = false;

    this.stats = { elapsed: 0, kills: 0, stealthKills: 0, detections: 0, bodiesDiscovered: 0 };
    this.failed = false;
    this.completed = false;
    this.time = 0;
    this.stepTimer = 0;
  }

  get finished() {
    return this.failed || this.completed;
  }

  update(dt, input) {
    const { player } = this;
    this.time += dt;

    if (!this.finished) {
      this.stats.elapsed += dt;
      this._updatePlayer(dt, input);
      this._updateObjectives();
    } else {
      player.update(dt, { x: 0, y: 0 }, 0, this.tilemap);
    }

    // Freeze the guards once the level is won so nothing can change the final stats.
    if (!this.completed) {
      const ctx = { player, bodies: this.bodies };
      for (const guard of this.guards) guard.update(dt, ctx);
      this._separateGuards();
    }

    for (const body of this.bodies) {
      if (body.carried) this._followCarrier(body, dt);
      body.update(this.tilemap);
    }

    this._drawMarkers();
    this.effects.update(dt);
  }

  // --- objectives --------------------------------------------------------------

  /** Per-objective progress for the HUD. */
  objectiveStatus() {
    return this.objectives.map((id) => {
      const status = { id, label: OBJECTIVE_LABELS[id], done: false, current: 0, total: 0, locked: false };
      switch (id) {
        case 'eliminateAll':
          status.total = this.totalGuards;
          status.current = this.totalGuards - this.guards.length;
          status.done = this.guards.length === 0;
          break;
        case 'eliminateTargets': {
          const remaining = this.guards.filter((g) => g.target).length;
          status.total = this.totalTargets;
          status.current = this.totalTargets - remaining;
          status.done = remaining === 0;
          break;
        }
        case 'collect':
          status.total = this.intel.length;
          status.current = this.intel.filter((item) => item.collected).length;
          status.done = status.current === status.total;
          break;
        case 'exit':
          status.locked = !this.exitUnlocked;
          status.done = this.completed;
          break;
      }
      return status;
    });
  }

  _updateObjectives() {
    const { player } = this;
    for (const item of this.intel) {
      if (item.collected || Math.hypot(item.x - player.x, item.y - player.y) > PICKUP_RANGE) continue;
      item.collected = true;
      this.effects.burst(item.x, item.y, COLOR.intel);
    }

    const othersDone = this.objectiveStatus().every((s) => s.id === 'exit' || s.done);
    if (!othersDone) return;

    if (!this.objectives.includes('exit')) {
      this._complete();
      return;
    }
    this.exitUnlocked = true;
    const tx = Math.floor(player.x / TILE_SIZE);
    const ty = Math.floor(player.y / TILE_SIZE);
    const onExit = this.exits.some((e) => e.tx === tx && e.ty === ty);
    if (onExit) this._complete();
  }

  _complete() {
    this.completed = true;
    if (this.player.dragging) this._drop();
    this.emit('completed', this.stats);
  }

  _drawMarkers() {
    const g = this.markers;
    g.clear();
    if (this.objectives.includes('exit')) {
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 3);
      for (const exit of this.exits) {
        const color = this.exitUnlocked ? COLOR.exit : COLOR.exitLocked;
        g.rect(exit.x - 16, exit.y - 16, 32, 32)
          .fill({ color, alpha: this.exitUnlocked ? 0.2 + 0.25 * pulse : 0.2 })
          .stroke({ width: 2, color, alpha: this.exitUnlocked ? 0.9 : 0.5 });
      }
    }
    for (const item of this.intel) {
      if (item.collected) continue;
      const y = item.y + Math.sin(this.time * 3 + item.x) * 2;
      g.poly([item.x, y - 8, item.x + 6, y, item.x, y + 8, item.x - 6, y]).fill(COLOR.intel);
    }
  }

  // --- player ----------------------------------------------------------------

  _updatePlayer(dt, input) {
    const { player } = this;

    if (input.wasActionPressed('attack')) this._tryTakedown();
    if (input.wasActionPressed('interact')) this._toggleDrag();

    const move = input.getMoveVector();
    const moving = move.x !== 0 || move.y !== 0;
    player.sprinting = moving && !player.dragging && player.lockTimer <= 0 && input.isActionDown('sprint');
    const speed = player.dragging ? PLAYER_SPEED.drag : player.sprinting ? PLAYER_SPEED.sprint : PLAYER_SPEED.walk;

    player.update(dt, move, speed, this.tilemap);
    player.isHidden = this.tilemap.isConcealingAtWorld(player.x, player.y);

    if (player.sprinting) {
      this.stepTimer -= dt;
      if (this.stepTimer <= 0) {
        this.emitNoise(player.x, player.y, SPRINT_NOISE_RADIUS, false);
        this.stepTimer = SPRINT_STEP_INTERVAL;
      }
    } else {
      this.stepTimer = 0;
    }
  }

  _tryTakedown() {
    const { player } = this;
    let target = null;
    let bestDist = TAKEDOWN_RANGE;
    for (const guard of this.guards) {
      const dist = Math.hypot(guard.x - player.x, guard.y - player.y);
      if (dist <= bestDist) {
        bestDist = dist;
        target = guard;
      }
    }
    if (!target) return;

    if (player.dragging) this._drop();

    const angleToPlayer = Math.atan2(player.y - target.y, player.x - target.x);
    const fromBehind = Math.abs(angleDiff(angleToPlayer, target.facing)) >= BACKSTAB_MIN_ANGLE;
    const silent = fromBehind && target.state !== GuardState.ALERT;

    this._removeGuard(target);
    const body = new Body(target.x, target.y, target.facing);
    this.bodies.push(body);
    this.bodyLayer.addChild(body.view);

    this.stats.kills++;
    if (silent) this.stats.stealthKills++;

    player.facing = Math.atan2(target.y - player.y, target.x - player.x);
    player.lockTimer = TAKEDOWN_LOCK_TIME;
    this.effects.burst(target.x, target.y, silent ? COLOR.silent : COLOR.alarm);
    if (!silent) this.emitNoise(target.x, target.y, LOUD_KILL_NOISE_RADIUS, true);
  }

  _toggleDrag() {
    const { player } = this;
    if (player.dragging) {
      this._drop();
      return;
    }
    let nearest = null;
    let bestDist = GRAB_RANGE;
    for (const body of this.bodies) {
      const dist = Math.hypot(body.x - player.x, body.y - player.y);
      if (dist <= bestDist) {
        bestDist = dist;
        nearest = body;
      }
    }
    if (!nearest) return;
    nearest.carried = true;
    player.dragging = nearest;
  }

  _drop() {
    const body = this.player.dragging;
    body.carried = false;
    this.player.dragging = null;
    if (this.tilemap.isSolidAtWorld(body.x, body.y)) {
      body.x = this.player.x;
      body.y = this.player.y;
    }
  }

  _followCarrier(body, dt) {
    const { player } = this;
    const behind = player.facing + Math.PI;
    const tx = player.x + Math.cos(behind) * DRAG_OFFSET;
    const ty = player.y + Math.sin(behind) * DRAG_OFFSET;
    if (this.tilemap.isSolidAtWorld(tx, ty)) return;
    const t = Math.min(1, dt * 12);
    body.x += (tx - body.x) * t;
    body.y += (ty - body.y) * t;
    body.facing = player.facing;
    body.view.rotation = player.facing;
  }

  // --- guards ----------------------------------------------------------------

  _addGuard(config) {
    const guard = new Guard({ tilemap: this.tilemap, ...config });
    this.coneLayer.addChild(guard.coneView);
    this.entityLayer.addChild(guard.view);

    guard.on('alert', () => this._onGuardSpottedPlayer(guard));
    guard.on('shoot', () => this._onGuardShoot(guard));
    guard.on('bodyFound', (_, body) => this._onBodyFound(guard, body));
    return guard;
  }

  _removeGuard(guard) {
    guard.kill();
    guard.removeAllListeners();
    this.guards.splice(this.guards.indexOf(guard), 1);
    guard.view.destroy({ children: true });
    guard.coneView.destroy();
  }

  /** Radio call: nearby guards converge on where the caller saw the player. No chain reactions. */
  _onGuardSpottedPlayer(caller) {
    this.stats.detections++;
    this.effects.ring(caller.x, caller.y, BACKUP_RADIUS, COLOR.alarm, 0.8);
    for (const guard of this.guards) {
      if (guard === caller) continue;
      if (Math.hypot(guard.x - caller.x, guard.y - caller.y) > BACKUP_RADIUS) continue;
      guard.alertTo(caller.lastKnown.x, caller.lastKnown.y);
    }
  }

  _onGuardShoot(guard) {
    const { player } = this;
    this.effects.tracer(guard.x, guard.y, player.x, player.y, COLOR.tracer);
    if (!player.takeDamage(1)) return;
    this.effects.burst(player.x, player.y, COLOR.alarm);
    if (player.dead) this._fail();
  }

  _onBodyFound(finder, body) {
    this.stats.bodiesDiscovered++;
    this.effects.ring(finder.x, finder.y, BACKUP_RADIUS, COLOR.body, 0.8);
    for (const guard of this.guards) {
      if (guard === finder) continue;
      if (Math.hypot(guard.x - finder.x, guard.y - finder.y) > BACKUP_RADIUS) continue;
      guard.investigate(body.x, body.y);
    }
  }

  emitNoise(x, y, radius, alarming) {
    this.effects.ring(x, y, radius, alarming ? COLOR.alarm : COLOR.noise, alarming ? 0.6 : 0.45);
    for (const guard of this.guards) {
      const dist = Math.hypot(guard.x - x, guard.y - y);
      if (dist > radius) continue;
      if (dist > radius * MUFFLED_NOISE_FACTOR && !hasLineOfSight(this.tilemap, x, y, guard.x, guard.y)) continue;
      guard.hearNoise(x, y, alarming);
    }
  }

  /** Pushes overlapping guards apart so converging guards don't stack into one sprite. */
  _separateGuards() {
    const { guards } = this;
    for (let i = 0; i < guards.length; i++) {
      for (let j = i + 1; j < guards.length; j++) {
        const a = guards[i];
        const b = guards[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let dist = Math.hypot(dx, dy);
        const minDist = a.halfSize + b.halfSize;
        if (dist >= minDist) continue;
        if (dist < 0.001) {
          dx = 1;
          dy = 0;
          dist = 1;
        }
        const push = (minDist - dist) / 2;
        const nx = (dx / dist) * push;
        const ny = (dy / dist) * push;
        moveAndCollide(a, -nx, -ny, this.tilemap);
        moveAndCollide(b, nx, ny, this.tilemap);
      }
    }
  }

  _fail() {
    this.failed = true;
    if (this.player.dragging) this._drop();
    this.emit('failed', this.stats);
  }

  destroy() {
    for (const guard of this.guards) guard.removeAllListeners();
    this.removeAllListeners();
    this.root.destroy({ children: true });
  }
}
