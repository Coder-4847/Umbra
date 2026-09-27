import { Container, EventEmitter } from 'pixi.js';
import { Tilemap } from '../world/Tilemap.js';
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

const COLOR = {
  noise: 0xdcdcf0,
  alarm: 0xff4545,
  body: 0xffa53d,
  silent: 0xffffff,
  tracer: 0xffd27a,
};

/**
 * One playable level: owns the map, player, guards, bodies and effects, and
 * applies the rules that connect them (takedowns, noise, backup calls, damage).
 *
 * Events: 'failed' when the player dies.
 */
export class Level extends EventEmitter {
  constructor(config) {
    super();
    this.tilemap = new Tilemap();
    this.effects = new Effects();

    this.root = new Container();
    this.bodyLayer = new Container();
    this.coneLayer = new Container();
    this.entityLayer = new Container();
    this.root.addChild(this.tilemap.view, this.bodyLayer, this.coneLayer, this.entityLayer, this.effects.view);

    this.player = new Player(config.spawn.x, config.spawn.y);
    this.guards = config.guards.map((guardConfig) => this._addGuard(guardConfig));
    this.entityLayer.addChild(this.player.view);
    this.bodies = [];

    this.stats = { elapsed: 0, kills: 0, stealthKills: 0, detections: 0, bodiesDiscovered: 0 };
    this.failed = false;
    this.stepTimer = 0;
  }

  update(dt, input) {
    const { player } = this;
    if (!this.failed) {
      this.stats.elapsed += dt;
      this._updatePlayer(dt, input);
    } else {
      player.update(dt, { x: 0, y: 0 }, 0, this.tilemap);
    }

    const ctx = { player, bodies: this.bodies };
    for (const guard of this.guards) guard.update(dt, ctx);
    this._separateGuards();

    for (const body of this.bodies) {
      if (body.carried) this._followCarrier(body, dt);
      body.update(this.tilemap);
    }

    this.effects.update(dt);
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
