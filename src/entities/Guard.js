import { coneColors } from '../core/visual.js';
import { Container, EventEmitter, Graphics, Text } from 'pixi.js';
import { moveAndCollide } from '../world/collision.js';
import { raycast, hasLineOfSight } from '../world/raycast.js';
import { findPath } from '../world/pathfinding.js';
import { angleDiff, clamp, lerpColor, turnToward } from '../core/math.js';
import { VISION_FOV, VISION_RANGE } from './vision.js';

export const GuardState = Object.freeze({
  PATROL: 'patrol',
  SUSPICIOUS: 'suspicious',
  ALERT: 'alert',
});

const HALF_SIZE = 10;
// Per-kind movement and senses; Dog overrides `tuning`.
const GUARD_TUNING = Object.freeze({
  speed: Object.freeze({ patrol: 70, suspicious: 95, alert: 150 }),
  visionRange: VISION_RANGE,
  visionFov: VISION_FOV,
  // An alert guard stops closing in at this distance and shoots from there.
  standoff: 110,
});
const TURN_SPEED = 4.5;
const ALERT_TURN_SPEED = 8;

const ALERT_RANGE_MULT = 1.3;
// A player who slipped into cover unseen is only spotted at point-blank range.
const HIDDEN_DETECT_RANGE = 44;
const CONE_RAYS = 48;

// Seconds for the detection meter to fill from empty at point-blank vs. max range.
const DETECT_TIME_NEAR = 0.25;
const DETECT_TIME_FAR = 1.1;
const SUSPICIOUS_THRESHOLD = 0.3;
const SUSPICIOUS_DETECT_MULT = 1.6;
const METER_DECAY = 0.3;
const METER_AFTER_LOSING_TARGET = 0.6;
const METER_ON_BODY_FOUND = 0.7;

// Footprints are small: guards spot them closer than they spot a person.
const TRACK_NOTICE_RANGE = 170;
// On reaching a print, a tracking guard looks this far around for the next, newer one.
const TRAIL_FOLLOW_RADIUS = 150;
const TRACK_SCAN_INTERVAL = 0.2;

const SEARCH_DURATION = 3.5;
const LOSE_TARGET_TIME = 4;
// Briefly keep tracking the player's true position after losing LOS so chases
// follow the player around corners instead of stalling at the corner.
const PURSUIT_INTUITION_TIME = 0.6;
const REPATH_INTERVAL = 0.3;
const ARRIVE_DIST = 4;
// Guards and dogs wade through shallow water at this fraction of their speed.
const SHALLOW_SPEED_FACTOR = 0.7;
// Stopping this far short of the point being checked (it's across water, say) means look toward it.
const UNREACHED_DIST = 48;

const SHOOT_RANGE = 220;
const AIM_TIME = 0.6;
const FIRE_COOLDOWN = 0.9;
const AIM_TOLERANCE = (12 * Math.PI) / 180;

// Seconds a guard spends at a panel before the alarm goes off: the player's last chance.
const PANEL_PRESS_TIME = 1;
const PANEL_PRESS_REACH = 40;

const CONE_ALPHA = { patrol: 0.14, suspicious: 0.18, alert: 0.22 };

/**
 * Guard AI: patrol -> suspicious (investigate a point, look around) -> alert
 * (A*-pathed chase, aim and fire). Vision is a cone clipped by walls via grid
 * raycasts; sightings fill a detection meter whose rate scales with proximity.
 *
 * `patrol` is a list of world-space waypoints { x, y, wait?, look? } where
 * `look` is a facing angle (radians) held while waiting. A single waypoint
 * makes a stationary guard; repeating a point with different `look`s makes a
 * guard that stands still and turns. `route` is 'loop' or 'pingpong'.
 * `target` marks a guard for the eliminate-targets objective.
 *
 * Events: 'raiseAlarm' (guard, panel) when it finishes an alarm run,
 * 'alert' (guard) when it first actually sees the player during an alert,
 * 'shoot' (guard) when it fires, 'bodyFound' (guard, body).
 */
export class Guard extends EventEmitter {
  constructor({ tilemap, patrol, route = 'loop', target = false, radio = null }) {
    super();
    this.tilemap = tilemap;
    this.patrol = patrol.length === 1 ? [{ ...patrol[0], wait: Infinity }] : patrol;
    this.route = route;
    this.target = target;
    this.radio = radio;

    this.x = patrol[0].x;
    this.y = patrol[0].y;
    this.halfSize = HALF_SIZE;
    this.facing = this._initialFacing();
    this.dead = false;

    this.state = GuardState.PATROL;
    this.meter = 0;
    this.canSeePlayer = false;
    this.playerDist = Infinity;
    this.lastKnown = { x: this.x, y: this.y };

    this.path = [];
    this.pathIndex = 0;
    this.waypointIndex = 0;
    this.waypointStep = 1;
    this.waitTimer = 0;
    this.searching = false;
    this.searchTimer = 0;
    this.searchBaseAngle = 0;
    this.lostTimer = 0;
    this.repathTimer = 0;
    this.aimTimer = 0;
    this.fireCooldown = 0;
    this.aimTarget = null;
    this.confirmedSighting = false;

    this.alarmRun = null;

    this.tracks = null;
    // Time of the newest print this guard has already followed; older prints no longer interest it.
    this.trailTime = -Infinity;
    this.followingTrail = false;
    this.trackScanTimer = 0;

    this.coneView = new Graphics();
    this.view = this._buildView();
    this._setDestination(this.x, this.y);
    this._syncView();
  }

  get tuning() {
    return GUARD_TUNING;
  }

  get isDog() {
    return false;
  }

  get visionRange() {
    const base = this.tuning.visionRange;
    return this.state === GuardState.ALERT ? base * ALERT_RANGE_MULT : base;
  }

  /** Sends the guard to check out a point. Ignored while alert. */
  investigate(x, y) {
    if (this.dead || this.state === GuardState.ALERT) return;
    this._enterSuspicious(x, y);
  }

  /**
   * Puts the guard on full alert heading for a point it was told about (backup
   * call, fight noise, camera). An already-alert guard that has lost sight of
   * the player takes the fresher position instead.
   */
  alertTo(x, y) {
    if (this.dead) return;
    if (this.state === GuardState.ALERT) {
      // A guard running for the alarm is committed; reports don't turn it around.
      if (this.canSeePlayer || this.alarmRun) return;
      this.lastKnown = { x, y };
      this.lostTimer = PURSUIT_INTUITION_TIME;
      this.repathTimer = REPATH_INTERVAL;
      this._setDestination(x, y);
      return;
    }
    this.state = GuardState.ALERT;
    this.meter = 1;
    this.lastKnown = { x, y };
    this.confirmedSighting = false;
    // They were told where to go, not where the player is: skip pursuit intuition.
    this.lostTimer = PURSUIT_INTUITION_TIME;
    this.repathTimer = REPATH_INTERVAL;
    this.aimTimer = 0;
    this._setDestination(x, y);
  }

  hearNoise(x, y, alarming) {
    if (alarming) this.alertTo(x, y);
    else this.investigate(x, y);
  }

  kill() {
    this.dead = true;
  }

  /** Breaks off the chase to run to an alarm panel and raise the alarm there. */
  runToPanel(panel) {
    this.alarmRun = { panel, pressTimer: 0 };
    this.aimTimer = 0;
    this.aimTarget = null;
    this._setDestination(panel.x, panel.y);
  }

  /** Returns true while the run is still in progress (it may have ended this frame). */
  _updateAlarmRun(dt, player) {
    const run = this.alarmRun;
    const { panel } = run;
    const distToPanel = Math.hypot(panel.x - this.x, panel.y - this.y);
    if (!panel.working || (this.path.length === 0 && distToPanel > PANEL_PRESS_REACH)) {
      this.alarmRun = null;
      return false;
    }
    if (this.canSeePlayer) {
      this.lostTimer = 0;
      this.lastKnown = { x: player.x, y: player.y };
    }
    if (this._followPath(dt, this.tuning.speed.alert, true)) {
      run.pressTimer += dt;
      if (run.pressTimer >= PANEL_PRESS_TIME) {
        this.alarmRun = null;
        this.emit('raiseAlarm', this, panel);
      }
    }
    return true;
  }

  /** @param ctx {{ player, bodies, tracks? }} */
  update(dt, ctx) {
    if (this.dead) return;
    const { player } = ctx;
    this.tracks = ctx.tracks ?? null;
    const sawPlayer = this.canSeePlayer;
    this.canSeePlayer = this._canSeePlayer(player, sawPlayer);
    this.fireCooldown = Math.max(0, this.fireCooldown - dt);

    if (this.state !== GuardState.ALERT) {
      this._checkBodies(ctx.bodies);
      this._checkTracks(dt);
    }

    switch (this.state) {
      case GuardState.PATROL:
        this._updatePatrol(dt, player);
        break;
      case GuardState.SUSPICIOUS:
        this._updateSuspicious(dt, player);
        break;
      case GuardState.ALERT:
        this._updateAlert(dt, player, sawPlayer);
        break;
    }

    this._syncView();
  }

  // --- perception -----------------------------------------------------------

  _canSeePlayer(player, sawLastFrame) {
    this.playerDist = Math.hypot(player.x - this.x, player.y - this.y);
    if (player.dead || player.inTransit) return false;
    // Cover only works if you slip into it unseen; a guard already watching keeps tracking you.
    const range = player.isHidden && !sawLastFrame ? HIDDEN_DETECT_RANGE : this.visionRange;
    return this._canSeePoint(player.x, player.y, range + player.halfSize);
  }

  _canSeePoint(x, y, range) {
    const dx = x - this.x;
    const dy = y - this.y;
    if (dx * dx + dy * dy > range * range) return false;
    if (Math.abs(angleDiff(Math.atan2(dy, dx), this.facing)) > this.tuning.visionFov / 2) return false;
    return hasLineOfSight(this.tilemap, this.x, this.y, x, y);
  }

  _checkBodies(bodies) {
    for (const body of bodies) {
      if (body.discovered || body.concealed) continue;
      if (!this._canSeePoint(body.x, body.y, this.visionRange)) continue;
      body.discovered = true;
      this._enterSuspicious(body.x, body.y);
      this.meter = Math.max(this.meter, METER_ON_BODY_FOUND);
      this.emit('bodyFound', this, body);
      return;
    }
  }

  /** Notices the newest fresh print in view that's newer than any trail already followed. */
  _checkTracks(dt) {
    const prints = this.tracks?.prints;
    if (!prints?.length) return;
    this.trackScanTimer -= dt;
    if (this.trackScanTimer > 0) return;
    this.trackScanTimer = TRACK_SCAN_INTERVAL;

    for (let i = prints.length - 1; i >= 0; i--) {
      const print = prints[i];
      if (print.time <= this.trailTime) return;
      if (!this._canSeePoint(print.x, print.y, TRACK_NOTICE_RANGE)) continue;
      this.trailTime = print.time;
      this._enterSuspicious(print.x, print.y);
      this.followingTrail = true;
      return;
    }
  }

  /** On reaching a print, the newest newer print close by and in line of sight, if any. */
  _nextTrailPrint() {
    const prints = this.tracks?.prints;
    if (!this.followingTrail || !prints) return null;
    for (let i = prints.length - 1; i >= 0; i--) {
      const print = prints[i];
      if (print.time <= this.trailTime) return null;
      const dx = print.x - this.x;
      const dy = print.y - this.y;
      if (dx * dx + dy * dy > TRAIL_FOLLOW_RADIUS * TRAIL_FOLLOW_RADIUS) continue;
      if (hasLineOfSight(this.tilemap, this.x, this.y, print.x, print.y)) return print;
    }
    return null;
  }

  _raiseMeter(dt, multiplier) {
    const t = clamp(this.playerDist / this.visionRange, 0, 1);
    const fillTime = DETECT_TIME_NEAR + (DETECT_TIME_FAR - DETECT_TIME_NEAR) * t;
    this.meter = Math.min(1, this.meter + (dt / fillTime) * multiplier);
  }

  _decayMeter(dt) {
    this.meter = Math.max(0, this.meter - METER_DECAY * dt);
  }

  // --- states ---------------------------------------------------------------

  _updatePatrol(dt, player) {
    if (this.canSeePlayer) {
      // Stop and stare while the meter fills: gives the player a beat to break LOS.
      this._raiseMeter(dt, 1);
      this.lastKnown = { x: player.x, y: player.y };
      this._faceToward(player.x, player.y, dt, TURN_SPEED);
      if (this.meter >= 1) this._enterAlert();
      else if (this.meter >= SUSPICIOUS_THRESHOLD) this._enterSuspicious(player.x, player.y);
      return;
    }

    this._decayMeter(dt);
    this._followPatrol(dt);
  }

  _followPatrol(dt) {
    const waypoint = this.patrol[this.waypointIndex];

    if (this.waitTimer > 0) {
      this.waitTimer -= dt;
      if (waypoint.look != null) this._turnTo(waypoint.look, dt, TURN_SPEED);
      if (this.waitTimer <= 0) this._advanceWaypoint();
      return;
    }

    if (this._followPath(dt, this.tuning.speed.patrol, true)) {
      this.waitTimer = waypoint.wait ?? 0;
      if (this.waitTimer <= 0) this._advanceWaypoint();
    }
  }

  _advanceWaypoint() {
    const count = this.patrol.length;
    if (this.route === 'pingpong' && count > 1) {
      if (this.waypointIndex + this.waypointStep < 0 || this.waypointIndex + this.waypointStep >= count) {
        this.waypointStep = -this.waypointStep;
      }
      this.waypointIndex += this.waypointStep;
    } else {
      this.waypointIndex = (this.waypointIndex + 1) % count;
    }
    const next = this.patrol[this.waypointIndex];
    this._setDestination(next.x, next.y);
  }

  _enterPatrol() {
    this.state = GuardState.PATROL;
    this.followingTrail = false;
    this.waitTimer = 0;
    const waypoint = this.patrol[this.waypointIndex];
    this._setDestination(waypoint.x, waypoint.y);
  }

  _enterSuspicious(x, y) {
    this.state = GuardState.SUSPICIOUS;
    this.meter = Math.max(this.meter, SUSPICIOUS_THRESHOLD);
    this.lastKnown = { x, y };
    this.searching = false;
    this.followingTrail = false;
    this.repathTimer = REPATH_INTERVAL;
    this._setDestination(x, y);
  }

  _updateSuspicious(dt, player) {
    this.repathTimer -= dt;

    if (this.canSeePlayer) {
      this._raiseMeter(dt, SUSPICIOUS_DETECT_MULT);
      if (this.meter >= 1) {
        this._enterAlert();
        return;
      }
      this.lastKnown = { x: player.x, y: player.y };
      this.searching = false;
      if (this.repathTimer <= 0) {
        this._setDestination(player.x, player.y);
        this.repathTimer = REPATH_INTERVAL;
      }
      this._faceToward(player.x, player.y, dt, TURN_SPEED);
      this._followPath(dt, this.tuning.speed.suspicious, false);
      return;
    }

    this.meter = Math.max(SUSPICIOUS_THRESHOLD * 0.5, this.meter - METER_DECAY * 0.5 * dt);

    if (!this.searching) {
      if (this._followPath(dt, this.tuning.speed.suspicious, true)) {
        const next = this._nextTrailPrint();
        if (next) {
          this.trailTime = next.time;
          this.lastKnown = { x: next.x, y: next.y };
          this._setDestination(next.x, next.y);
          return;
        }
        this.searching = true;
        this.searchTimer = SEARCH_DURATION;
        const { x, y } = this.lastKnown;
        this.searchBaseAngle =
          Math.hypot(x - this.x, y - this.y) > UNREACHED_DIST ? Math.atan2(y - this.y, x - this.x) : this.facing;
      }
      return;
    }

    this.searchTimer -= dt;
    const elapsed = SEARCH_DURATION - this.searchTimer;
    this._turnTo(this.searchBaseAngle + Math.sin(elapsed * 1.8) * 1.1, dt, TURN_SPEED);
    if (this.searchTimer <= 0) this._enterPatrol();
  }

  /** Entered by personally spotting the player; calls for backup. */
  _enterAlert() {
    this.state = GuardState.ALERT;
    this.meter = 1;
    this.lostTimer = 0;
    this.repathTimer = 0;
    this.aimTimer = 0;
    this.confirmedSighting = true;
    this.emit('alert', this);
  }

  _updateAlert(dt, player, sawPlayerLastFrame) {
    this.repathTimer -= dt;
    if (this.alarmRun && this._updateAlarmRun(dt, player)) return;

    if (this.canSeePlayer) {
      // A guard alerted second-hand (noise, radio) calls it in once it actually sees the player.
      if (!this.confirmedSighting) {
        this.confirmedSighting = true;
        this.emit('alert', this);
        // The level may have just sent this guard to raise the alarm; don't overwrite that route.
        if (this.alarmRun) return;
      }
      this.lostTimer = 0;
      this.lastKnown = { x: player.x, y: player.y };
      if (this.repathTimer <= 0) {
        this._setDestination(player.x, player.y);
        this.repathTimer = REPATH_INTERVAL;
      }
      this._faceToward(player.x, player.y, dt, ALERT_TURN_SPEED);
      this._updateAim(dt, player);
      if (this.playerDist > this.tuning.standoff) this._followPath(dt, this.tuning.speed.alert, false);
      return;
    }

    this.aimTimer = 0;
    this.aimTarget = null;
    this.lostTimer += dt;
    if (this.lostTimer < PURSUIT_INTUITION_TIME) {
      this.lastKnown = { x: player.x, y: player.y };
      if (this.repathTimer <= 0 || sawPlayerLastFrame) {
        this._setDestination(player.x, player.y);
        this.repathTimer = REPATH_INTERVAL;
      }
    }

    const arrived = this._followPath(dt, this.tuning.speed.alert, true);
    if ((arrived && this.lostTimer >= PURSUIT_INTUITION_TIME) || this.lostTimer > LOSE_TARGET_TIME) {
      this._enterSuspicious(this.lastKnown.x, this.lastKnown.y);
      this.meter = METER_AFTER_LOSING_TARGET;
    }
  }

  _updateAim(dt, player) {
    if (this.playerDist > SHOOT_RANGE || this.fireCooldown > 0) {
      this.aimTimer = 0;
      this.aimTarget = null;
      return;
    }
    this.aimTarget = player;
    this.aimTimer += dt;
    const onTarget = Math.abs(angleDiff(Math.atan2(player.y - this.y, player.x - this.x), this.facing)) <= AIM_TOLERANCE;
    if (this.aimTimer >= AIM_TIME && onTarget) {
      this.emit('shoot', this);
      this.aimTimer = 0;
      this.aimTarget = null;
      this.fireCooldown = FIRE_COOLDOWN;
    }
  }

  // --- movement -------------------------------------------------------------

  /** Paths to the point, or as near as it can get when the point can't be reached (across water). */
  _setDestination(x, y) {
    this.path = findPath(this.tilemap, this.x, this.y, x, y, HALF_SIZE, { closest: true }) ?? [];
    this.pathIndex = 0;
  }

  /** Advances along the current path. Returns true once the path is complete. */
  _followPath(dt, speed, faceMovement) {
    const wading = this.tilemap.isShallowAtWorld(this.x, this.y);
    let budget = speed * dt * (wading ? SHALLOW_SPEED_FACTOR : 1);
    while (this.pathIndex < this.path.length) {
      const target = this.path[this.pathIndex];
      // Reached a stairs/elevator pad (the previous point): step through to the other end.
      if (target.teleport) {
        this.x = target.x;
        this.y = target.y;
        this.pathIndex++;
        continue;
      }
      const dx = target.x - this.x;
      const dy = target.y - this.y;
      const dist = Math.hypot(dx, dy);

      if (dist <= ARRIVE_DIST) {
        this.pathIndex++;
        continue;
      }

      if (faceMovement) this._turnTo(Math.atan2(dy, dx), dt, TURN_SPEED);
      const step = Math.min(budget, dist);
      moveAndCollide(this, (dx / dist) * step, (dy / dist) * step, this.tilemap);
      budget -= step;
      if (budget <= 0) return false;
    }
    return true;
  }

  _turnTo(angle, dt, speed) {
    this.facing = turnToward(this.facing, angle, speed * dt);
  }

  _faceToward(x, y, dt, speed) {
    this._turnTo(Math.atan2(y - this.y, x - this.x), dt, speed);
  }

  _initialFacing() {
    const first = this.patrol[0];
    if (first.look != null) return first.look;
    const second = this.patrol[1];
    if (second && (second.x !== first.x || second.y !== first.y)) {
      return Math.atan2(second.y - first.y, second.x - first.x);
    }
    return 0;
  }

  // --- rendering ------------------------------------------------------------

  _buildView() {
    const view = new Container();

    this.body = new Graphics();
    this.body.circle(0, 0, HALF_SIZE).fill(this.target ? 0xd9534f : 0x5b8def);
    this.body.poly([HALF_SIZE + 6, 0, HALF_SIZE - 4, -5, HALF_SIZE - 4, 5]).fill(0xdbe7ff);
    if (this.target) this.body.circle(0, 0, HALF_SIZE + 4).stroke({ width: 2, color: 0xff8a80, alpha: 0.9 });

    this.meterBar = new Graphics();

    this.indicator = new Text({
      text: '',
      style: {
        fontFamily: 'system-ui, sans-serif',
        fontSize: 20,
        fontWeight: '900',
        fill: 0xffffff,
        stroke: { color: 0x0b0b10, width: 4 },
      },
    });
    this.indicator.anchor.set(0.5, 1);
    this.indicator.position.set(0, -HALF_SIZE - 8);
    this._indicatorState = null;

    view.addChild(this.body, this.meterBar, this.indicator);
    return view;
  }

  _coneColor() {
    switch (this.state) {
      case GuardState.ALERT:
        return coneColors().alert;
      case GuardState.SUSPICIOUS:
        return lerpColor(
          coneColors().suspicious,
          coneColors().alert,
          (this.meter - SUSPICIOUS_THRESHOLD) / (1 - SUSPICIOUS_THRESHOLD),
        );
      default:
        return lerpColor(coneColors().patrol, coneColors().suspicious, this.meter / SUSPICIOUS_THRESHOLD);
    }
  }

  _syncView() {
    this.view.position.set(this.x, this.y);
    this.body.rotation = this.facing;

    const indicatorState = this.alarmRun ? 'alarmRun' : this.state;
    if (this._indicatorState !== indicatorState) {
      this._indicatorState = indicatorState;
      if (this.alarmRun) {
        this.indicator.text = '!!';
        this.indicator.style.fill = coneColors().alert;
      } else if (this.state === GuardState.ALERT) {
        this.indicator.text = '!';
        this.indicator.style.fill = coneColors().alert;
      } else if (this.state === GuardState.SUSPICIOUS) {
        this.indicator.text = '?';
        this.indicator.style.fill = coneColors().suspicious;
      } else {
        this.indicator.text = '';
      }
    }

    this.meterBar.clear();
    if (this.state === GuardState.PATROL && this.meter > 0) {
      const width = 22;
      const top = -HALF_SIZE - 12;
      this.meterBar
        .rect(-width / 2, top, width, 4)
        .fill({ color: 0x000000, alpha: 0.5 })
        .rect(-width / 2, top, width * (this.meter / SUSPICIOUS_THRESHOLD), 4)
        .fill(this._coneColor());
    }

    this._drawCone();
  }

  _drawCone() {
    const range = this.visionRange;
    const fov = this.tuning.visionFov;
    const points = [this.x, this.y];
    const start = this.facing - fov / 2;
    for (let i = 0; i <= CONE_RAYS; i++) {
      const angle = start + (fov * i) / CONE_RAYS;
      const dirX = Math.cos(angle);
      const dirY = Math.sin(angle);
      const dist = raycast(this.tilemap, this.x, this.y, dirX, dirY, range);
      points.push(this.x + dirX * dist, this.y + dirY * dist);
    }

    this.coneView.clear();
    this.coneView.poly(points).fill({ color: this._coneColor(), alpha: CONE_ALPHA[this.state] });

    // Aim telegraph: a laser line that brightens as the shot winds up.
    if (this.aimTarget) {
      const progress = clamp(this.aimTimer / AIM_TIME, 0, 1);
      this.coneView
        .moveTo(this.x, this.y)
        .lineTo(this.aimTarget.x, this.aimTarget.y)
        .stroke({ width: 1 + progress * 1.5, color: coneColors().alert, alpha: 0.25 + progress * 0.65 });
    }

    // Alarm-run telegraph: a dashed line to the panel so the player knows who to stop.
    if (this.alarmRun) {
      const { panel } = this.alarmRun;
      const dx = panel.x - this.x;
      const dy = panel.y - this.y;
      const length = Math.hypot(dx, dy);
      for (let d = 0; d < length; d += 14) {
        const end = Math.min(length, d + 7);
        this.coneView
          .moveTo(this.x + (dx * d) / length, this.y + (dy * d) / length)
          .lineTo(this.x + (dx * end) / length, this.y + (dy * end) / length)
          .stroke({ width: 2, color: coneColors().alert, alpha: 0.7 });
      }
    }
  }
}
