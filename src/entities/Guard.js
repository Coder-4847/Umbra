import { Container, Graphics, Text } from 'pixi.js';
import { moveAndCollide } from '../world/collision.js';
import { raycast, hasLineOfSight } from '../world/raycast.js';
import { findPath } from '../world/pathfinding.js';
import { angleDiff, clamp, lerpColor, turnToward } from '../core/math.js';

export const GuardState = Object.freeze({
  PATROL: 'patrol',
  SUSPICIOUS: 'suspicious',
  ALERT: 'alert',
});

const HALF_SIZE = 10;
const SPEED = { patrol: 70, suspicious: 95, alert: 150 };
const TURN_SPEED = 4.5;
const ALERT_TURN_SPEED = 8;

const VISION_RANGE = 230;
const VISION_FOV = (70 * Math.PI) / 180;
const ALERT_RANGE_MULT = 1.3;
const CONE_RAYS = 48;

// Seconds for the detection meter to fill from empty at point-blank vs. max range.
const DETECT_TIME_NEAR = 0.25;
const DETECT_TIME_FAR = 1.1;
const SUSPICIOUS_THRESHOLD = 0.3;
const SUSPICIOUS_DETECT_MULT = 1.6;
const METER_DECAY = 0.3;
const METER_AFTER_LOSING_TARGET = 0.6;

const SEARCH_DURATION = 3.5;
const LOSE_TARGET_TIME = 4;
// Briefly keep tracking the player's true position after losing LOS so chases
// follow the player around corners instead of stalling at the corner.
const PURSUIT_INTUITION_TIME = 0.6;
const REPATH_INTERVAL = 0.3;
const ARRIVE_DIST = 4;
const CATCH_DIST = 26;

const CONE_COLORS = { patrol: 0xfff3b0, suspicious: 0xffa53d, alert: 0xff4545 };
const CONE_ALPHA = { patrol: 0.14, suspicious: 0.18, alert: 0.22 };

/**
 * Guard AI: patrol -> suspicious (investigate last-known position, look around)
 * -> alert (chase with pathfinding). Vision is a cone clipped by walls via
 * grid raycasts; sightings fill a detection meter whose rate scales with
 * proximity.
 *
 * `patrol` is a list of world-space waypoints { x, y, wait?, look? } where
 * `look` is a facing angle (radians) held while waiting. A single waypoint
 * makes a stationary guard; repeating a point with different `look`s makes a
 * guard that stands still and turns. `route` is 'loop' or 'pingpong'.
 */
export class Guard {
  constructor({ tilemap, patrol, route = 'loop' }) {
    this.tilemap = tilemap;
    this.patrol = patrol.length === 1 ? [{ ...patrol[0], wait: Infinity }] : patrol;
    this.route = route;

    this.x = patrol[0].x;
    this.y = patrol[0].y;
    this.halfSize = HALF_SIZE;
    this.facing = this._initialFacing();

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

    this.coneView = new Graphics();
    this.view = this._buildView();
    this._setDestination(this.x, this.y);
    this._syncView();
  }

  get visionRange() {
    return this.state === GuardState.ALERT ? VISION_RANGE * ALERT_RANGE_MULT : VISION_RANGE;
  }

  /** Sends the guard to investigate a point, e.g. a noise. Ignored while alert. */
  investigate(x, y) {
    if (this.state === GuardState.ALERT) return;
    this._enterSuspicious(x, y);
  }

  update(dt, player) {
    const sawPlayer = this.canSeePlayer;
    this.canSeePlayer = this._canSee(player);

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

  _canSee(player) {
    const dx = player.x - this.x;
    const dy = player.y - this.y;
    this.playerDist = Math.hypot(dx, dy);
    if (this.playerDist > this.visionRange + player.halfSize) return false;
    if (Math.abs(angleDiff(Math.atan2(dy, dx), this.facing)) > VISION_FOV / 2) return false;
    return hasLineOfSight(this.tilemap, this.x, this.y, player.x, player.y);
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

    if (this._followPath(dt, SPEED.patrol, true)) {
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
    this.waitTimer = 0;
    const waypoint = this.patrol[this.waypointIndex];
    this._setDestination(waypoint.x, waypoint.y);
  }

  _enterSuspicious(x, y) {
    this.state = GuardState.SUSPICIOUS;
    this.meter = Math.max(this.meter, SUSPICIOUS_THRESHOLD);
    this.lastKnown = { x, y };
    this.searching = false;
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
      this._followPath(dt, SPEED.suspicious, false);
      return;
    }

    this.meter = Math.max(SUSPICIOUS_THRESHOLD * 0.5, this.meter - METER_DECAY * 0.5 * dt);

    if (!this.searching) {
      if (this._followPath(dt, SPEED.suspicious, true)) {
        this.searching = true;
        this.searchTimer = SEARCH_DURATION;
        this.searchBaseAngle = this.facing;
      }
      return;
    }

    this.searchTimer -= dt;
    const elapsed = SEARCH_DURATION - this.searchTimer;
    this._turnTo(this.searchBaseAngle + Math.sin(elapsed * 1.8) * 1.1, dt, TURN_SPEED);
    if (this.searchTimer <= 0) this._enterPatrol();
  }

  _enterAlert() {
    this.state = GuardState.ALERT;
    this.meter = 1;
    this.lostTimer = 0;
    this.repathTimer = 0;
  }

  _updateAlert(dt, player, sawPlayerLastFrame) {
    this.repathTimer -= dt;

    if (this.canSeePlayer) {
      this.lostTimer = 0;
      this.lastKnown = { x: player.x, y: player.y };
      if (this.repathTimer <= 0) {
        this._setDestination(player.x, player.y);
        this.repathTimer = REPATH_INTERVAL;
      }
      this._faceToward(player.x, player.y, dt, ALERT_TURN_SPEED);
      if (this.playerDist > CATCH_DIST) this._followPath(dt, SPEED.alert, false);
      return;
    }

    this.lostTimer += dt;
    if (this.lostTimer < PURSUIT_INTUITION_TIME) {
      this.lastKnown = { x: player.x, y: player.y };
      if (this.repathTimer <= 0 || sawPlayerLastFrame) {
        this._setDestination(player.x, player.y);
        this.repathTimer = REPATH_INTERVAL;
      }
    }

    const arrived = this._followPath(dt, SPEED.alert, true);
    if ((arrived && this.lostTimer >= PURSUIT_INTUITION_TIME) || this.lostTimer > LOSE_TARGET_TIME) {
      this._enterSuspicious(this.lastKnown.x, this.lastKnown.y);
      this.meter = METER_AFTER_LOSING_TARGET;
    }
  }

  // --- movement -------------------------------------------------------------

  _setDestination(x, y) {
    this.path = findPath(this.tilemap, this.x, this.y, x, y, HALF_SIZE) ?? [];
    this.pathIndex = 0;
  }

  /** Advances along the current path. Returns true once the path is complete. */
  _followPath(dt, speed, faceMovement) {
    let budget = speed * dt;
    while (this.pathIndex < this.path.length) {
      const target = this.path[this.pathIndex];
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
    this.body.circle(0, 0, HALF_SIZE).fill(0x5b8def);
    this.body.poly([HALF_SIZE + 6, 0, HALF_SIZE - 4, -5, HALF_SIZE - 4, 5]).fill(0xdbe7ff);

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
        return CONE_COLORS.alert;
      case GuardState.SUSPICIOUS:
        return lerpColor(
          CONE_COLORS.suspicious,
          CONE_COLORS.alert,
          (this.meter - SUSPICIOUS_THRESHOLD) / (1 - SUSPICIOUS_THRESHOLD),
        );
      default:
        return lerpColor(CONE_COLORS.patrol, CONE_COLORS.suspicious, this.meter / SUSPICIOUS_THRESHOLD);
    }
  }

  _syncView() {
    this.view.position.set(this.x, this.y);
    this.body.rotation = this.facing;

    if (this._indicatorState !== this.state) {
      this._indicatorState = this.state;
      if (this.state === GuardState.ALERT) {
        this.indicator.text = '!';
        this.indicator.style.fill = CONE_COLORS.alert;
      } else if (this.state === GuardState.SUSPICIOUS) {
        this.indicator.text = '?';
        this.indicator.style.fill = CONE_COLORS.suspicious;
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
    const points = [this.x, this.y];
    const start = this.facing - VISION_FOV / 2;
    for (let i = 0; i <= CONE_RAYS; i++) {
      const angle = start + (VISION_FOV * i) / CONE_RAYS;
      const dirX = Math.cos(angle);
      const dirY = Math.sin(angle);
      const dist = raycast(this.tilemap, this.x, this.y, dirX, dirY, range);
      points.push(this.x + dirX * dist, this.y + dirY * dist);
    }

    this.coneView.clear();
    this.coneView.poly(points).fill({ color: this._coneColor(), alpha: CONE_ALPHA[this.state] });
  }
}
