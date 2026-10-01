import { Container, EventEmitter, Graphics } from 'pixi.js';
import { Tilemap } from '../world/Tilemap.js';
import { paletteFor } from '../world/palettes.js';
import { TILE_SIZE } from '../world/tiles.js';
import { Effects } from '../world/Effects.js';
import { SnowTracks } from '../world/SnowTracks.js';
import { ScentTrail } from '../world/ScentTrail.js';
import { hasLineOfSight } from '../world/raycast.js';
import { moveAndCollide } from '../world/collision.js';
import { Player, PLAYER_SPEED } from '../entities/Player.js';
import { Guard, GuardState } from '../entities/Guard.js';
import { Dog } from '../entities/Dog.js';
import { Boss } from '../entities/Boss.js';
import { Gate } from '../entities/Gate.js';
import { Body } from '../entities/Body.js';
import { SecurityCamera } from '../entities/SecurityCamera.js';
import { PatrolBoat } from '../entities/PatrolBoat.js';
import { Birds } from '../entities/Birds.js';
import { BIRD_PROXIMITY } from '../entities/wildlifeRules.js';
import { Laser } from '../entities/Laser.js';
import { AlarmPanel } from '../entities/AlarmPanel.js';
import { PANEL_REACH } from '../entities/securityRules.js';
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
const BIRD_NOISE_RADIUS = 280;
// Birds scatter from noises in the nearer part of their range, not at the very edge.
const WILDLIFE_HEARING = 0.6;
const BACKUP_RADIUS = 360;
// Cameras are wired into the security system, so their alarms reach further than a shout.
const CAMERA_ALARM_RADIUS = 520;
const LASER_ALARM_RADIUS = 520;
// A guard who spots the player only runs for a panel within this range.
const PANEL_RUN_RANGE = 700;
const HACK_LOCK_TIME = 0.4;
const ELEVATOR_RIDE = 1.2;
const ELEVATOR_DING_RADIUS = 220;
const LINK_REACH = 26;
const LINK_LOCK_TIME = 0.25;
const FLOOR_SHADE_ALPHA = 0.62;
// Radio nets check in this often; a member killed since the last check gets someone sent to look.
const RADIO_CHECKIN_INTERVAL = 10;
const RADIO_NOTICE_TIME = 3.5;
// A barking dog brings every guard in earshot on its floor to where it last sensed the player.
const BARK_RADIUS = 340;
// Shallow water: slow going, and every few strides splashes loud enough to hear.
const WADE_SPEED_FACTOR = 0.6;
const SPLASH_NOISE_RADIUS = 150;
const SPLASH_STEP_INTERVAL = 0.45;
// Dragging a body to the edge of deep water lets you sink it for good; the splash carries.
const SINK_REACH = 26;
const SINK_NOISE_RADIUS = 160;
const SINK_LOCK_TIME = 0.35;
const PICKUP_RANGE = 22;
// A wounded boss vanishes in smoke; the commotion brings guards nearby to the spot.
const BOSS_WOUND_NOISE_RADIUS = 280;
// A botched attack on a boss: it throws the player back and the fight gets loud.
const BOSS_PARRY_PUSH = 26;
const BOSS_NOTICE_TIME = 4.5;

const COLOR = {
  noise: 0xdcdcf0,
  wildlife: 0xd6cbb3,
  alarm: 0xff4545,
  body: 0xffa53d,
  silent: 0xffffff,
  tracer: 0xffd27a,
  exit: 0x4ade80,
  exitLocked: 0x3a5a46,
  intel: 0xffd166,
  hack: 0x7dd3fc,
  link: 0xc4b5fd,
  radio: 0x93c5fd,
  bark: 0xffc98a,
  water: 0x7cc4ff,
  smoke: 0xb8b4c8,
  boss: 0xf5c542,
};

const OBJECTIVE_LABELS = {
  eliminateAll: 'Eliminate all guards',
  eliminateTargets: 'Eliminate the targets',
  collect: 'Collect the intel',
  defeatBoss: 'Defeat the boss',
  exit: 'Reach the exit',
};

/**
 * One playable level, built from parsed level data (see levels/schema.js):
 * owns the map, player, guards, bodies and effects, and applies the rules that
 * connect them (takedowns, noise, backup calls, damage, objectives).
 *
 * Events: 'failed' (stats) when the player dies, 'completed' (stats) when all
 * objectives are done, 'alarm' when a guard raises a full alarm at a panel,
 * 'transit' when the player arrives by stairs or elevator.
 */
export class Level extends EventEmitter {
  constructor(data, { skin } = {}) {
    super();
    this.data = data;
    this.palette = paletteFor(data.chapter);
    this.tilemap = new Tilemap(data.cols, data.rows, data.grid, this.palette);
    this.effects = new Effects();
    this.markers = new Graphics();
    this.tracks = new SnowTracks(this.tilemap);
    // Only levels with dogs track the player's scent.
    this.scent = data.guards.some((g) => g.kind === 'dog') ? new ScentTrail(this.tilemap) : null;

    this.links = data.links;
    this.tilemap.setLinks(this.links);
    this.floors = this.tilemap.computeFloors();
    this.floorOwners = this._computeFloorOwners();
    this.floorCount = this.floors.reduce((max, f) => Math.max(max, f), -1) + 1;
    this.linkView = new Graphics();
    // Other floors are dimmed so a multi-floor level reads as a set of floor plans.
    this.floorShade = new Graphics();

    this.root = new Container();
    this.hazardLayer = new Container();
    this.bodyLayer = new Container();
    this.coneLayer = new Container();
    this.entityLayer = new Container();
    // Cameras hang from the ceiling, so they draw above the people walking under them.
    this.cameraLayer = new Container();
    this.root.addChild(
      ...[this.tilemap.view, this.tracks.view, this.scent?.view].filter(Boolean),
      this.markers,
      this.linkView,
      this.hazardLayer,
      this.bodyLayer,
      this.coneLayer,
      this.entityLayer,
      this.cameraLayer,
      this.floorShade,
      this.effects.view,
    );

    this.player = new Player(data.spawn.x, data.spawn.y, skin);
    this.panels = data.panels.map((config) => new AlarmPanel(config));
    const panelsById = new Map(this.panels.filter((p) => p.id).map((p) => [p.id, p]));
    this.lasers = data.lasers.map((config) => {
      const laser = new Laser(config);
      laser.panel = panelsById.get(config.panel) ?? null;
      return laser;
    });
    for (const laser of this.lasers) this.hazardLayer.addChild(laser.view);
    this.gates = data.gates.map((config) => {
      const gate = new Gate(config);
      gate.panel = panelsById.get(config.panel) ?? null;
      this.tilemap.setGateTiles(gate.tiles, true);
      this.hazardLayer.addChild(gate.view);
      return gate;
    });
    for (const panel of this.panels) this.hazardLayer.addChild(panel.view);

    // Boats patrol from the same list as guards and dogs, but they're security, not people to take down.
    // Units tied to a later boss phase wait off the map until the boss reaches it.
    const present = data.guards.filter((g) => g.phase <= 1);
    this.dormant = data.guards.filter((g) => g.phase > 1);
    this.guards = present.filter((g) => g.kind !== 'boat').map((config) => this._addGuard(config));
    this.boats = present.filter((g) => g.kind === 'boat').map((config) => this._addBoat(config));
    this.boss = this.guards.find((g) => g.isBoss) ?? null;
    this.bossInfo = this.boss ? { name: this.boss.name, maxHp: this.boss.maxHp } : null;
    this.bossDefeated = false;
    this.bossNotice = { text: '', timer: 0 };
    this.cameras = data.cameras.map((cameraConfig) => {
      const camera = this._addCamera(cameraConfig);
      camera.panel = panelsById.get(cameraConfig.panel) ?? null;
      return camera;
    });
    this.wildlife = data.wildlife.map((point) => new Birds(point.x, point.y));
    for (const flock of this.wildlife) this.entityLayer.addChild(flock.view);
    this.entityLayer.addChild(this.player.view);
    this.bodies = [];

    this.fullAlarm = false;
    this.alarmRunner = null;

    this.channels = new Map();
    for (const guard of this.guards) {
      if (!guard.radio) continue;
      if (!this.channels.has(guard.radio)) {
        this.channels.set(guard.radio, { members: new Set(), timer: RADIO_CHECKIN_INTERVAL, missing: [] });
      }
      this.channels.get(guard.radio).members.add(guard);
    }
    this.radioNotice = { text: '', timer: 0 };

    this.transit = null;
    this.currentFloor = -1;
    this._drawLinks();
    this._syncFloor();

    this.objectives = data.objectives;
    this.exits = data.exits;
    this.intel = data.intel.map((item) => ({ ...item, collected: false }));
    this.totalGuards = this.guards.length;
    this.totalTargets = this.guards.filter((g) => g.target).length;
    this.exitUnlocked = false;

    this.stats = {
      elapsed: 0,
      kills: 0,
      stealthKills: 0,
      detections: 0,
      bodiesDiscovered: 0,
      wildlifeFlushed: 0,
      lasersTripped: 0,
      fullAlarms: 0,
      radioChecksFailed: 0,
      bodiesSunk: 0,
      bossHits: 0,
    };
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
      this._updateTransit(dt);
      this._updatePlayer(dt, input);
      if (!player.inTransit) {
        this._checkWildlifeProximity();
        this._checkLasers();
        this._updateObjectives();
      }
      this._syncFloor();
    } else {
      player.update(dt, { x: 0, y: 0 }, 0, this.tilemap);
    }

    // Freeze the guards once the level is won so nothing can change the final stats.
    if (!this.completed) {
      const ctx = { player, bodies: this.bodies, tracks: this.tracks, scent: this.scent };
      for (const guard of this.guards) guard.update(dt, ctx);
      for (const camera of this.cameras) camera.update(dt, ctx);
      for (const boat of this.boats) boat.update(dt, ctx);
      this._separateGuards();
      this._syncAlarmRunner();
      if (!this.failed) this._updateRadios(dt);
    }
    this.radioNotice.timer = Math.max(0, this.radioNotice.timer - dt);
    this.bossNotice.timer = Math.max(0, this.bossNotice.timer - dt);

    for (const body of this.bodies) {
      if (body.carried) this._followCarrier(body, dt);
      body.update(this.tilemap);
    }
    this.tracks.update(dt, player, this.bodies);
    this.scent?.update(dt, player);
    for (const flock of this.wildlife) flock.update(dt);
    for (const laser of this.lasers) laser.update(dt, this.time);
    for (const panel of this.panels) panel.update(this.time);

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
        case 'defeatBoss':
          status.label = `Defeat ${this.bossInfo.name}`;
          status.total = this.bossInfo.maxHp;
          status.current = this.bossDefeated ? this.bossInfo.maxHp : this.boss.hits;
          status.done = this.bossDefeated;
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
    if (player.inTransit) {
      player.update(dt, { x: 0, y: 0 }, 0, this.tilemap);
      return;
    }

    if (input.wasActionPressed('attack')) this._tryTakedown();
    if (input.wasActionPressed('interact')) this._interact();

    const move = input.getMoveVector();
    const moving = (move.x !== 0 || move.y !== 0) && player.lockTimer <= 0;
    player.sprinting = moving && !player.dragging && input.isActionDown('sprint');
    const baseSpeed = player.dragging ? PLAYER_SPEED.drag : player.sprinting ? PLAYER_SPEED.sprint : PLAYER_SPEED.walk;
    const wading = this.tilemap.isShallowAtWorld(player.x, player.y);

    player.update(dt, move, baseSpeed * (wading ? WADE_SPEED_FACTOR : 1), this.tilemap);
    player.isHidden = this.tilemap.isConcealingAtWorld(player.x, player.y);

    // Sprinting is always loud; wading through shallows splashes even at a walk.
    if (moving && (player.sprinting || wading)) {
      this.stepTimer -= dt;
      if (this.stepTimer <= 0) {
        if (player.sprinting) {
          this.emitNoise(player.x, player.y, SPRINT_NOISE_RADIUS, false);
          this.stepTimer = SPRINT_STEP_INTERVAL;
        } else {
          this.emitNoise(player.x, player.y, SPLASH_NOISE_RADIUS, false, { color: COLOR.water });
          this.stepTimer = SPLASH_STEP_INTERVAL;
        }
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
      if (guard.hidden) continue;
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

    if (target.isBoss) {
      if (!silent || target.hp > 1) {
        this._hitBoss(target, silent);
        return;
      }
      this.stats.bossHits++;
      this.bossDefeated = true;
      this.bossNotice = { text: `⚔ ${target.name} is down`, timer: BOSS_NOTICE_TIME };
    }

    this._removeGuard(target);
    const body = new Body(target.x, target.y, target.facing, target.isDog);
    this.bodies.push(body);
    this.bodyLayer.addChild(body.view);

    this.stats.kills++;
    if (silent) this.stats.stealthKills++;

    player.facing = Math.atan2(target.y - player.y, target.x - player.x);
    player.lockTimer = TAKEDOWN_LOCK_TIME;
    this.effects.burst(target.x, target.y, silent ? COLOR.silent : COLOR.alarm);
    if (!silent) this.emitNoise(target.x, target.y, LOUD_KILL_NOISE_RADIUS, true);
  }

  /**
   * A clean stab from behind wounds the boss: it vanishes in smoke and turns up
   * at its next post, while guards nearby come to see what the commotion was.
   * Anything else it throws off, and the fight gets loud.
   */
  _hitBoss(boss, silent) {
    const { player } = this;
    player.facing = Math.atan2(boss.y - player.y, boss.x - player.x);
    player.lockTimer = TAKEDOWN_LOCK_TIME;
    if (!silent) {
      const away = Math.atan2(player.y - boss.y, player.x - boss.x);
      moveAndCollide(player, Math.cos(away) * BOSS_PARRY_PUSH, Math.sin(away) * BOSS_PARRY_PUSH, this.tilemap);
      this.effects.burst(boss.x, boss.y, COLOR.alarm);
      this.emitNoise(boss.x, boss.y, LOUD_KILL_NOISE_RADIUS, true);
      boss.alertTo(player.x, player.y);
      return;
    }
    this.stats.bossHits++;
    const { x, y } = boss;
    boss.wound();
    this.effects.burst(x, y, COLOR.smoke);
    this.effects.ring(x, y, 40, COLOR.smoke, 0.6);
    this.emitNoise(x, y, BOSS_WOUND_NOISE_RADIUS, false, { color: COLOR.smoke });
    this.bossNotice = { text: `⚔ ${boss.name} is wounded and slips away in the smoke`, timer: BOSS_NOTICE_TIME };
  }

  /** The boss turns up at its next post; whoever joins the fight for this phase arrives now. */
  _onBossReappear(boss, phaseIndex) {
    const phase = phaseIndex + 1;
    const arriving = this.dormant.filter((g) => g.phase === phase);
    this.dormant = this.dormant.filter((g) => g.phase !== phase);
    for (const config of arriving) {
      if (config.kind === 'boat') {
        this.boats.push(this._addBoat(config));
      } else {
        this.guards.push(this._addGuard(config));
        this.totalGuards++;
      }
    }
    // Reinforcements draw above the player like everyone else.
    this.entityLayer.addChild(this.player.view);
    this.effects.ring(boss.x, boss.y, 60, COLOR.boss, 0.9);
    const hint = boss.phases[phaseIndex].hint;
    const extra = arriving.length ? ' Reinforcements have arrived.' : '';
    this.bossNotice = { text: `⚔ ${boss.name} regroups${hint ? ` — ${hint}` : ''}.${extra}`, timer: BOSS_NOTICE_TIME };
  }

  /**
   * E: take stairs/elevator you're standing at (bringing a carried body along),
   * else sink a carried body into deep water in reach, else drop it, else hack
   * a panel in reach, else grab a nearby body.
   */
  _interact() {
    const { player } = this;
    const pad = this.linkInReach();
    if (pad) {
      this._useLink(pad.link, pad.from);
      return;
    }
    if (player.dragging) {
      const water = this.waterInReach();
      if (water) this._sinkBody(water);
      else this._drop();
      return;
    }
    const panel = this.hackablePanel();
    if (panel) {
      this._hackPanel(panel);
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
    if (this.tilemap.isBlockedAtWorld(body.x, body.y)) {
      body.x = this.player.x;
      body.y = this.player.y;
    }
  }

  /** A point on deep water right beside the player (ahead first), if there is one. */
  waterInReach() {
    const { player } = this;
    for (let i = 0; i < 9; i++) {
      const angle = i === 0 ? player.facing : ((i - 1) * Math.PI) / 4;
      const x = player.x + Math.cos(angle) * SINK_REACH;
      const y = player.y + Math.sin(angle) * SINK_REACH;
      if (this.tilemap.isWaterAtWorld(x, y)) return { x, y };
    }
    return null;
  }

  /** Gone for good — nobody will find this one — but the splash is heard. */
  _sinkBody(water) {
    const { player } = this;
    const body = player.dragging;
    player.dragging = null;
    this.bodies.splice(this.bodies.indexOf(body), 1);
    body.view.destroy();
    this.stats.bodiesSunk++;
    player.lockTimer = SINK_LOCK_TIME;
    this.effects.burst(water.x, water.y, COLOR.water);
    this.emitNoise(water.x, water.y, SINK_NOISE_RADIUS, false, { color: COLOR.water });
  }

  _followCarrier(body, dt) {
    const { player } = this;
    const behind = player.facing + Math.PI;
    const tx = player.x + Math.cos(behind) * DRAG_OFFSET;
    const ty = player.y + Math.sin(behind) * DRAG_OFFSET;
    if (this.tilemap.isBlockedAtWorld(tx, ty)) return;
    const t = Math.min(1, dt * 12);
    body.x += (tx - body.x) * t;
    body.y += (ty - body.y) * t;
    body.facing = player.facing;
    body.view.rotation = player.facing;
  }

  // --- guards ----------------------------------------------------------------

  _addGuard(config) {
    const isDog = config.kind === 'dog';
    const Kind = isDog ? Dog : config.kind === 'boss' ? Boss : Guard;
    const guard = new Kind({ tilemap: this.tilemap, ...config });
    this.coneLayer.addChild(guard.coneView);
    this.entityLayer.addChild(guard.view);

    guard.on('bodyFound', (_, body) => this._onBodyFound(guard, body));
    if (isDog) {
      guard.on('alert', () => this._onDogBark(guard, true));
      guard.on('bark', () => this._onDogBark(guard, false));
      guard.on('bite', () => this._onDogBite(guard));
      return guard;
    }
    guard.on('alert', () => this._onGuardSpottedPlayer(guard));
    guard.on('shoot', () => this._onGuardShoot(guard));
    guard.on('raiseAlarm', (_, panel) => this._raiseFullAlarm(guard, panel));
    if (guard.isBoss) guard.on('reappear', (_, phaseIndex) => this._onBossReappear(guard, phaseIndex));
    return guard;
  }

  _removeGuard(guard) {
    if (guard === this.alarmRunner) this._clearAlarmRunner();
    const channel = guard.radio ? this.channels.get(guard.radio) : null;
    if (channel) {
      channel.members.delete(guard);
      channel.missing.push({ x: guard.x, y: guard.y });
    }
    guard.kill();
    guard.removeAllListeners();
    this.guards.splice(this.guards.indexOf(guard), 1);
    guard.view.destroy({ children: true });
    guard.coneView.destroy();
  }

  /**
   * A shout brings guards nearby on the same floor; a radio call brings the
   * caller's whole channel, wherever they are. No chain reactions.
   */
  _onGuardSpottedPlayer(caller) {
    this.stats.detections++;
    this.effects.ring(caller.x, caller.y, BACKUP_RADIUS, COLOR.alarm, 0.8);
    for (const guard of this.guards) {
      if (guard === caller) continue;
      const inEarshot =
        Math.hypot(guard.x - caller.x, guard.y - caller.y) <= BACKUP_RADIUS && this.sameFloor(guard, caller);
      const onRadio = caller.radio && guard.radio === caller.radio;
      if (inEarshot || onRadio) guard.alertTo(caller.lastKnown.x, caller.lastKnown.y);
    }
    this._maybeSendAlarmRunner(caller);
  }

  // --- dogs ----------------------------------------------------------------------

  /**
   * A bark is sound: it reaches guards on the dog's floor within earshot (walls
   * muffle it like any noise) and sends them to where the dog sensed the player.
   * Dogs don't run for alarm panels; the guards they bring might.
   */
  _onDogBark(dog, isFirst) {
    if (isFirst) this.stats.detections++;
    this.effects.ring(dog.x, dog.y, BARK_RADIUS, COLOR.bark, isFirst ? 0.8 : 0.5);
    const floor = this.floorAt(dog.x, dog.y);
    for (const guard of this.guards) {
      if (guard === dog || this.floorAt(guard.x, guard.y) !== floor) continue;
      const dist = Math.hypot(guard.x - dog.x, guard.y - dog.y);
      if (dist > BARK_RADIUS) continue;
      if (dist > BARK_RADIUS * MUFFLED_NOISE_FACTOR && !hasLineOfSight(this.tilemap, dog.x, dog.y, guard.x, guard.y)) continue;
      guard.alertTo(dog.lastKnown.x, dog.lastKnown.y);
    }
    for (const flock of this.wildlife) {
      if (flock.flushed || this.floorAt(flock.x, flock.y) !== floor) continue;
      if (Math.hypot(flock.x - dog.x, flock.y - dog.y) <= BARK_RADIUS * WILDLIFE_HEARING) this._flushBirds(flock);
    }
  }

  _onDogBite(dog) {
    const { player } = this;
    if (!player.takeDamage(1)) return;
    this.effects.burst(player.x, player.y, COLOR.alarm);
    this.effects.ring(dog.x, dog.y, 30, COLOR.alarm, 0.25);
    if (player.dead) this._fail();
  }

  // --- alarm panels & lasers ------------------------------------------------------

  /** The working (not hacked) panel within the player's reach, if any. */
  hackablePanel() {
    const { player } = this;
    return (
      this.panels.find(
        (panel) => !panel.disabled && Math.hypot(panel.x - player.x, panel.y - player.y) <= PANEL_REACH,
      ) ?? null
    );
  }

  _hackPanel(panel) {
    panel.disabled = true;
    panel.targeted = false;
    for (const laser of this.lasers) if (laser.panel === panel) laser.disabled = true;
    for (const camera of this.cameras) if (camera.panel === panel) camera.disabled = true;
    for (const gate of this.gates) {
      if (gate.panel !== panel || !gate.unlock()) continue;
      this.tilemap.setGateTiles(gate.tiles, false);
      const mid = gate.tiles[Math.floor(gate.tiles.length / 2)];
      this.effects.burst((mid.tx + 0.5) * TILE_SIZE, (mid.ty + 0.5) * TILE_SIZE, COLOR.hack);
    }
    this.player.lockTimer = HACK_LOCK_TIME;
    this.effects.burst(panel.x, panel.y, COLOR.hack);
  }

  /** The guard who spotted the player breaks off to raise the alarm, if a working panel is near. */
  _maybeSendAlarmRunner(guard) {
    if (this.fullAlarm || this.alarmRunner) return;
    let best = null;
    let bestDist = PANEL_RUN_RANGE;
    for (const panel of this.panels) {
      if (!panel.working) continue;
      const dist = Math.hypot(panel.x - guard.x, panel.y - guard.y);
      if (dist < bestDist) {
        bestDist = dist;
        best = panel;
      }
    }
    if (!best) return;
    guard.runToPanel(best);
    best.targeted = true;
    this.alarmRunner = guard;
  }

  /** Releases the runner once its run ends for any reason (reached, cancelled, panel hacked). */
  _syncAlarmRunner() {
    if (this.alarmRunner && !this.alarmRunner.alarmRun) this._clearAlarmRunner();
  }

  _clearAlarmRunner() {
    for (const panel of this.panels) panel.targeted = false;
    this.alarmRunner = null;
  }

  /** Base-wide alarm: every guard on the map converges on the player's last known position. */
  _raiseFullAlarm(guard, panel) {
    if (this.fullAlarm) return;
    this.fullAlarm = true;
    this.stats.fullAlarms++;
    panel.triggered = true;
    this._clearAlarmRunner();
    this.effects.ring(panel.x, panel.y, Math.max(this.tilemap.pixelWidth, this.tilemap.pixelHeight), COLOR.alarm, 1.4);
    for (const other of this.guards) other.alertTo(guard.lastKnown.x, guard.lastKnown.y);
    this.emit('alarm');
  }

  _checkLasers() {
    const { player } = this;
    const carried = this.bodies.filter((body) => body.carried);
    for (const laser of this.lasers) {
      const active = laser.isActive(this.time);
      const touching =
        active &&
        (laser.intersects(player.x, player.y, player.halfSize) ||
          carried.some((body) => laser.intersects(body.x, body.y, 8)));
      // Trip on entering the beam (or the beam switching on over you), not on every frame inside it.
      if (touching && !laser.touching && laser.cooldown <= 0) this._tripLaser(laser);
      laser.touching = touching;
    }
  }

  _tripLaser(laser) {
    const { player } = this;
    laser.trip();
    this.stats.lasersTripped++;
    this.stats.detections++;
    this.effects.ring(player.x, player.y, LASER_ALARM_RADIUS, COLOR.alarm, 1);
    for (const guard of this.guards) {
      if (Math.hypot(guard.x - player.x, guard.y - player.y) > LASER_ALARM_RADIUS) continue;
      guard.alertTo(player.x, player.y);
    }
  }

  _onGuardShoot(guard) {
    const { player } = this;
    this.effects.tracer(guard.x, guard.y, player.x, player.y, COLOR.tracer);
    if (!player.takeDamage(1)) return;
    this.effects.burst(player.x, player.y, COLOR.alarm);
    if (player.dead) this._fail();
  }

  _onBodyFound(finder, body, radius = BACKUP_RADIUS) {
    this.stats.bodiesDiscovered++;
    this.effects.ring(finder.x, finder.y, radius, COLOR.body, 0.8);
    for (const guard of this.guards) {
      if (guard === finder) continue;
      const nearby = Math.hypot(guard.x - finder.x, guard.y - finder.y) <= radius;
      const onRadio = finder.radio && guard.radio === finder.radio;
      if (nearby || onRadio) guard.investigate(body.x, body.y);
    }
  }

  // --- cameras ----------------------------------------------------------------

  _addCamera(config) {
    const camera = new SecurityCamera({ tilemap: this.tilemap, ...config });
    this.coneLayer.addChild(camera.coneView);
    this.cameraLayer.addChild(camera.view);

    camera.on('alarm', (_, x, y) => this._onCameraSighting(camera, x, y, true));
    camera.on('report', (_, x, y) => this._onCameraSighting(camera, x, y, false));
    camera.on('bodyFound', (_, body) => this._onBodyFound(camera, body, CAMERA_ALARM_RADIUS));
    return camera;
  }

  /** Patrol boats are moving searchlights: they report like cameras and never go to sleep. */
  _addBoat(config) {
    const boat = new PatrolBoat({ tilemap: this.tilemap, ...config });
    this.coneLayer.addChild(boat.coneView);
    this.entityLayer.addChild(boat.view);

    boat.on('alarm', (_, x, y) => this._onCameraSighting(boat, x, y, true));
    boat.on('report', (_, x, y) => this._onCameraSighting(boat, x, y, false));
    boat.on('bodyFound', (_, body) => this._onBodyFound(boat, body, CAMERA_ALARM_RADIUS));
    return boat;
  }

  /** Guards on the security net converge on what the camera sees; follow-up reports keep them on target. */
  _onCameraSighting(camera, x, y, isNewAlarm) {
    if (isNewAlarm) {
      this.stats.detections++;
      this.effects.ring(camera.x, camera.y, CAMERA_ALARM_RADIUS, COLOR.alarm, 1);
    }
    for (const guard of this.guards) {
      if (Math.hypot(guard.x - camera.x, guard.y - camera.y) > CAMERA_ALARM_RADIUS) continue;
      guard.alertTo(x, y);
    }
  }

  /**
   * Guards in earshot react; wildlife within the nearer part of the radius takes
   * flight. A flock's own noise doesn't flush other flocks, so birds can't chain
   * across the whole map.
   */
  emitNoise(x, y, radius, alarming, { fromWildlife = false, color } = {}) {
    const ringColor = color ?? (fromWildlife ? COLOR.wildlife : alarming ? COLOR.alarm : COLOR.noise);
    this.effects.ring(x, y, radius, ringColor, alarming ? 0.6 : 0.45);
    // Sound stays on its own floor.
    const floor = this.floorAt(x, y);
    for (const guard of this.guards) {
      const dist = Math.hypot(guard.x - x, guard.y - y);
      if (dist > radius || this.floorAt(guard.x, guard.y) !== floor) continue;
      if (dist > radius * MUFFLED_NOISE_FACTOR && !hasLineOfSight(this.tilemap, x, y, guard.x, guard.y)) continue;
      guard.hearNoise(x, y, alarming);
    }
    if (fromWildlife) return;
    for (const flock of this.wildlife) {
      if (flock.flushed || this.floorAt(flock.x, flock.y) !== floor) continue;
      if (Math.hypot(flock.x - x, flock.y - y) <= radius * WILDLIFE_HEARING) this._flushBirds(flock);
    }
  }

  // --- floors, stairs & elevators ------------------------------------------------

  /** Floor id at a world position (walls count as the nearest floor's). */
  floorAt(x, y) {
    const { cols, rows } = this.tilemap;
    const tx = Math.floor(x / TILE_SIZE);
    const ty = Math.floor(y / TILE_SIZE);
    if (tx < 0 || ty < 0 || tx >= cols || ty >= rows) return -1;
    return this.floorOwners[ty * cols + tx];
  }

  sameFloor(a, b) {
    return this.floorAt(a.x, a.y) === this.floorAt(b.x, b.y);
  }

  /** Floor ids spread outward into the walls, so each wall dims with the floor it borders. */
  _computeFloorOwners() {
    const { cols, rows } = this.tilemap;
    const owners = Int32Array.from(this.floors);
    let frontier = [];
    for (let i = 0; i < owners.length; i++) if (owners[i] >= 0) frontier.push(i);
    while (frontier.length) {
      const next = [];
      for (const i of frontier) {
        const x = i % cols;
        const y = (i - x) / cols;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const n = ny * cols + nx;
          if (owners[n] !== -1) continue;
          owners[n] = owners[i];
          next.push(n);
        }
      }
      frontier = next;
    }
    return owners;
  }

  _syncFloor() {
    const floor = this.floorAt(this.player.x, this.player.y);
    if (floor < 0 || floor === this.currentFloor) return;
    this.currentFloor = floor;
    this._drawFloorShade();
  }

  _drawFloorShade() {
    const g = this.floorShade;
    g.clear();
    if (this.floorCount < 2) return;
    const { cols, rows } = this.tilemap;
    for (let y = 0; y < rows; y++) {
      let runStart = -1;
      for (let x = 0; x <= cols; x++) {
        const other = x < cols && this.floorOwners[y * cols + x] !== this.currentFloor;
        if (other && runStart < 0) runStart = x;
        if (!other && runStart >= 0) {
          g.rect(runStart * TILE_SIZE, y * TILE_SIZE, (x - runStart) * TILE_SIZE, TILE_SIZE).fill({
            color: 0x05050a,
            alpha: FLOOR_SHADE_ALPHA,
          });
          runStart = -1;
        }
      }
    }
  }

  _drawLinks() {
    const g = this.linkView;
    for (const link of this.links) {
      for (const end of [link.a, link.b]) {
        g.roundRect(end.x - 13, end.y - 13, 26, 26, 4)
          .fill({ color: 0x1a1830 })
          .stroke({ width: 2, color: COLOR.link, alpha: 0.9 });
        if (link.kind === 'elevator') {
          g.rect(end.x - 9, end.y - 9, 8, 18).fill({ color: COLOR.link, alpha: 0.35 });
          g.rect(end.x + 1, end.y - 9, 8, 18).fill({ color: COLOR.link, alpha: 0.35 });
        } else {
          for (let i = 0; i < 4; i++) {
            g.rect(end.x - 9 + i * 4.5, end.y + 6 - i * 5, 18 - i * 4.5, 3).fill({ color: COLOR.link, alpha: 0.65 });
          }
        }
      }
    }
  }

  /** The stairs/elevator end the player is standing at, if any. */
  linkInReach() {
    const { player } = this;
    for (const link of this.links) {
      for (const from of [link.a, link.b]) {
        if (Math.hypot(from.x - player.x, from.y - player.y) <= LINK_REACH) return { link, from };
      }
    }
    return null;
  }

  _useLink(link, from) {
    const { player } = this;
    const to = from === link.a ? link.b : link.a;
    this.effects.burst(from.x, from.y, COLOR.link);
    if (link.kind === 'elevator') {
      player.inTransit = true;
      if (player.dragging) player.dragging.view.visible = false;
      this.transit = { link, to, timer: ELEVATOR_RIDE };
      return;
    }
    this._arrive(link, to);
  }

  _updateTransit(dt) {
    if (!this.transit) return;
    this.transit.timer -= dt;
    if (this.transit.timer > 0) return;
    const { link, to } = this.transit;
    this.transit = null;
    this._arrive(link, to);
  }

  /** Stairs arrive silently; elevator doors open with a ding that guards on that floor come to check. */
  _arrive(link, to) {
    const { player } = this;
    player.inTransit = false;
    player.x = to.x;
    player.y = to.y;
    player.lockTimer = LINK_LOCK_TIME;
    if (player.dragging) {
      player.dragging.x = to.x;
      player.dragging.y = to.y;
      player.dragging.view.visible = true;
    }
    this.tracks.jump(player, this.bodies);
    this.scent?.jump(player);
    this._syncFloor();
    this.effects.burst(to.x, to.y, COLOR.link);
    if (link.kind === 'elevator') this.emitNoise(to.x, to.y, ELEVATOR_DING_RADIUS, false, { color: COLOR.link });
    this.emit('transit');
  }

  // --- radios --------------------------------------------------------------------

  /** Each channel checks in on a timer; members killed since the last check get someone sent to look. */
  _updateRadios(dt) {
    for (const channel of this.channels.values()) {
      channel.timer -= dt;
      if (channel.timer > 0) continue;
      channel.timer = RADIO_CHECKIN_INTERVAL;
      if (channel.missing.length === 0 || channel.members.size === 0) continue;

      for (const spot of channel.missing) {
        let nearest = null;
        let bestDist = Infinity;
        for (const guard of channel.members) {
          if (guard.state === GuardState.ALERT) continue;
          const dist = Math.hypot(guard.x - spot.x, guard.y - spot.y);
          if (dist < bestDist) {
            bestDist = dist;
            nearest = guard;
          }
        }
        if (!nearest) continue;
        nearest.investigate(spot.x, spot.y);
        this.effects.ring(nearest.x, nearest.y, 60, COLOR.radio, 0.8);
      }
      this.stats.radioChecksFailed += channel.missing.length;
      channel.missing = [];
      this.radioNotice = { text: '📻 Missed radio check-in — a guard is coming to look', timer: RADIO_NOTICE_TIME };
    }
  }

  /** HUD line for radio nets: a countdown while a silenced guard is still unaccounted for. */
  radioStatus() {
    if (this.radioNotice.timer > 0) return this.radioNotice.text;
    let soonest = Infinity;
    for (const channel of this.channels.values()) {
      if (channel.missing.length && channel.members.size) soonest = Math.min(soonest, channel.timer);
    }
    return soonest < Infinity ? `📻 Radio check-in in ${Math.ceil(soonest)}s` : null;
  }

  /** HUD line for the boss fight: what just happened, for a few seconds. */
  bossStatus() {
    return this.bossNotice.timer > 0 ? this.bossNotice.text : null;
  }

  /** HUD hint for what the interact action would do right now (the HUD adds the key/button name). */
  interactionHint() {
    if (this.finished || this.player.inTransit) return null;
    const pad = this.linkInReach();
    if (pad) return pad.link.kind === 'elevator' ? 'ride the elevator' : 'take the stairs';
    if (this.player.dragging) return this.waterInReach() ? 'sink the body' : null;
    const panel = this.hackablePanel();
    if (panel) return this.gates.some((g) => g.panel === panel && !g.open) ? 'hack the panel (opens a gate)' : 'disable alarm panel';
    return null;
  }

  // --- wildlife ----------------------------------------------------------------

  _checkWildlifeProximity() {
    const { player } = this;
    for (const flock of this.wildlife) {
      if (flock.flushed) continue;
      if (Math.hypot(flock.x - player.x, flock.y - player.y) <= BIRD_PROXIMITY) this._flushBirds(flock);
    }
  }

  /** Startled birds make a racket that brings guards to where the flock was, not to the player. */
  _flushBirds(flock) {
    flock.flush();
    this.stats.wildlifeFlushed++;
    this.emitNoise(flock.x, flock.y, BIRD_NOISE_RADIUS, false, { fromWildlife: true });
  }

  /** Pushes overlapping guards apart so converging guards don't stack into one sprite. */
  _separateGuards() {
    const { guards } = this;
    for (let i = 0; i < guards.length; i++) {
      for (let j = i + 1; j < guards.length; j++) {
        const a = guards[i];
        const b = guards[j];
        if (a.hidden || b.hidden) continue;
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
    for (const camera of this.cameras) camera.removeAllListeners();
    for (const boat of this.boats) boat.removeAllListeners();
    this.removeAllListeners();
    this.root.destroy({ children: true });
  }
}
