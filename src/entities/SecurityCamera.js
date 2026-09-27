import { Container, EventEmitter, Graphics } from 'pixi.js';
import { hasLineOfSight, raycast } from '../world/raycast.js';
import { angleDiff, clamp, lerpColor, turnToward } from '../core/math.js';
import { CAMERA_FOV, CAMERA_RANGE } from './vision.js';

export const CameraState = Object.freeze({
  SWEEP: 'sweep',
  ALARM: 'alarm',
});

const HIDDEN_DETECT_RANGE = 44;
const DETECT_TIME_NEAR = 0.35;
const DETECT_TIME_FAR = 1.0;
const METER_DECAY = 0.35;
const METER_AFTER_ALARM = 0.5;

const TRACK_TURN_SPEED = 2.5;
const RETURN_TURN_SPEED = 1.5;
// How far past its sweep arc the motor can turn to follow a target.
const TRACK_MARGIN = (25 * Math.PI) / 180;
const ALARM_LOSE_TIME = 3;
const REPORT_INTERVAL = 1;
const CONE_RAYS = 40;

const COLOR = {
  idle: 0x7dd3fc,
  alarm: 0xff4545,
  housing: 0x2a2d38,
  housingEdge: 0x5a5f70,
  mount: 0x3a3f4c,
  lens: 0x0e1016,
  ledIdle: 0x4ade80,
  ledDetect: 0xffb547,
};

/**
 * Ceiling-mounted security camera. Sweeps its cone across an arc centered on
 * `look` (radians); `sweep` is the arc width (0 = fixed). On spotting the player
 * it stops, tracks them and fills a detection meter; when full it raises the
 * alarm and keeps reporting the player's position while they stay in view.
 * Cameras can't be taken down; the player has to avoid them.
 *
 * Events: 'alarm' (camera, x, y) when it first raises the alarm,
 * 'report' (camera, x, y) while it keeps the player in view during an alarm,
 * 'bodyFound' (camera, body).
 */
export class SecurityCamera extends EventEmitter {
  constructor({ tilemap, x, y, look, sweep = 0, sweepTime = 3, pause = 1 }) {
    super();
    this.tilemap = tilemap;
    this.x = x;
    this.y = y;
    this.look = look;
    this.sweep = sweep;
    this.sweepTime = sweepTime;
    this.pause = pause;

    this.state = CameraState.SWEEP;
    this.facing = look;
    this.phase = 0.5;
    this.sweepDir = 1;
    this.pauseTimer = 0;
    this.returning = false;

    this.meter = 0;
    this.canSeePlayer = false;
    this.playerDist = Infinity;
    this.lostTimer = 0;
    this.reportTimer = 0;
    this.time = 0;

    this.coneView = new Graphics();
    this.view = this._buildView();
    this._syncView();
  }

  /** @param ctx {{ player, bodies }} */
  update(dt, ctx) {
    const { player } = ctx;
    this.time += dt;
    const sawPlayer = this.canSeePlayer;
    this.canSeePlayer = this._canSeePlayer(player, sawPlayer);

    if (this.state === CameraState.SWEEP) this._updateSweep(dt, ctx);
    else this._updateAlarm(dt, player);

    this._syncView();
  }

  // --- behaviour --------------------------------------------------------------

  _updateSweep(dt, ctx) {
    const { player } = ctx;
    this._checkBodies(ctx.bodies);

    if (this.canSeePlayer) {
      const t = clamp(this.playerDist / CAMERA_RANGE, 0, 1);
      const fillTime = DETECT_TIME_NEAR + (DETECT_TIME_FAR - DETECT_TIME_NEAR) * t;
      this.meter = Math.min(1, this.meter + dt / fillTime);
      this._track(player, dt);
      this.returning = true;
      if (this.meter >= 1) this._raiseAlarm(player);
      return;
    }

    if (this.meter > 0) {
      // Hold still on the last spot while "suspicious" instead of snapping back to the sweep.
      this.meter = Math.max(0, this.meter - METER_DECAY * dt);
      return;
    }

    if (this.returning) {
      const target = this._sweepFacing();
      this.facing = turnToward(this.facing, target, RETURN_TURN_SPEED * dt);
      if (this.facing === target) this.returning = false;
      return;
    }

    this._advanceSweep(dt);
  }

  _updateAlarm(dt, player) {
    if (this.canSeePlayer) {
      this.lostTimer = 0;
      this._track(player, dt);
      this.reportTimer -= dt;
      if (this.reportTimer <= 0) {
        this.reportTimer = REPORT_INTERVAL;
        this.emit('report', this, player.x, player.y);
      }
      return;
    }

    this.lostTimer += dt;
    if (this.lostTimer >= ALARM_LOSE_TIME) {
      this.state = CameraState.SWEEP;
      this.meter = METER_AFTER_ALARM;
      this.returning = true;
    }
  }

  _raiseAlarm(player) {
    this.state = CameraState.ALARM;
    this.meter = 1;
    this.lostTimer = 0;
    this.reportTimer = REPORT_INTERVAL;
    this.emit('alarm', this, player.x, player.y);
  }

  _advanceSweep(dt) {
    if (this.sweep <= 0) {
      this.facing = this.look;
      return;
    }
    if (this.pauseTimer > 0) {
      this.pauseTimer -= dt;
    } else {
      this.phase += (this.sweepDir * dt) / this.sweepTime;
      if (this.phase >= 1 || this.phase <= 0) {
        this.phase = clamp(this.phase, 0, 1);
        this.sweepDir = -this.sweepDir;
        this.pauseTimer = this.pause;
      }
    }
    this.facing = this._sweepFacing();
  }

  /** Facing for the current sweep phase, eased so the motor slows into each end. */
  _sweepFacing() {
    const t = this.phase * this.phase * (3 - 2 * this.phase);
    return this.look + (t - 0.5) * this.sweep;
  }

  _track(player, dt) {
    const limit = this.sweep / 2 + TRACK_MARGIN;
    const offset = clamp(angleDiff(Math.atan2(player.y - this.y, player.x - this.x), this.look), -limit, limit);
    this.facing = turnToward(this.facing, this.look + offset, TRACK_TURN_SPEED * dt);
  }

  // --- perception -------------------------------------------------------------

  _canSeePlayer(player, sawLastFrame) {
    this.playerDist = Math.hypot(player.x - this.x, player.y - this.y);
    if (player.dead) return false;
    const range = player.isHidden && !sawLastFrame ? HIDDEN_DETECT_RANGE : CAMERA_RANGE;
    return this._canSeePoint(player.x, player.y, range + player.halfSize);
  }

  _canSeePoint(x, y, range) {
    const dx = x - this.x;
    const dy = y - this.y;
    if (dx * dx + dy * dy > range * range) return false;
    if (Math.abs(angleDiff(Math.atan2(dy, dx), this.facing)) > CAMERA_FOV / 2) return false;
    return hasLineOfSight(this.tilemap, this.x, this.y, x, y);
  }

  _checkBodies(bodies) {
    for (const body of bodies) {
      if (body.discovered || body.concealed) continue;
      if (!this._canSeePoint(body.x, body.y, CAMERA_RANGE)) continue;
      body.discovered = true;
      this.emit('bodyFound', this, body);
      return;
    }
  }

  // --- rendering ----------------------------------------------------------------

  _buildView() {
    const view = new Container();

    const mount = new Graphics().circle(0, 0, 5).fill(COLOR.mount);

    this.housing = new Graphics();
    this.housing
      .roundRect(-7, -5, 15, 10, 2)
      .fill(COLOR.housing)
      .stroke({ width: 1, color: COLOR.housingEdge })
      .circle(8, 0, 3)
      .fill(COLOR.lens)
      .stroke({ width: 1, color: COLOR.idle, alpha: 0.8 });

    this.led = new Graphics().circle(-3, 0, 1.8).fill(0xffffff);
    this.housing.addChild(this.led);

    this.meterBar = new Graphics();
    view.addChild(mount, this.housing, this.meterBar);
    return view;
  }

  _coneColor() {
    return this.state === CameraState.ALARM ? COLOR.alarm : lerpColor(COLOR.idle, COLOR.alarm, this.meter);
  }

  _syncView() {
    this.view.position.set(this.x, this.y);
    this.housing.rotation = this.facing;

    if (this.state === CameraState.ALARM) {
      this.led.tint = COLOR.alarm;
      this.led.alpha = Math.floor(this.time * 8) % 2 === 0 ? 1 : 0.2;
    } else if (this.meter > 0) {
      this.led.tint = COLOR.ledDetect;
      this.led.alpha = 1;
    } else {
      this.led.tint = COLOR.ledIdle;
      this.led.alpha = 0.5 + 0.5 * Math.sin(this.time * 2);
    }

    this.meterBar.clear();
    if (this.state === CameraState.SWEEP && this.meter > 0) {
      this.meterBar
        .rect(-11, -14, 22, 3)
        .fill({ color: 0x000000, alpha: 0.5 })
        .rect(-11, -14, 22 * this.meter, 3)
        .fill(this._coneColor());
    }

    this._drawCone();
  }

  _drawCone() {
    const points = [this.x, this.y];
    const start = this.facing - CAMERA_FOV / 2;
    for (let i = 0; i <= CONE_RAYS; i++) {
      const angle = start + (CAMERA_FOV * i) / CONE_RAYS;
      const dirX = Math.cos(angle);
      const dirY = Math.sin(angle);
      const dist = raycast(this.tilemap, this.x, this.y, dirX, dirY, CAMERA_RANGE);
      points.push(this.x + dirX * dist, this.y + dirY * dist);
    }
    const color = this._coneColor();
    const alarmed = this.state === CameraState.ALARM;
    this.coneView.clear();
    this.coneView
      .poly(points)
      .fill({ color, alpha: alarmed ? 0.2 : 0.12 })
      .stroke({ width: 1, color, alpha: alarmed ? 0.5 : 0.3 });
  }
}
