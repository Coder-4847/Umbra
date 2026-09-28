import { Container, Graphics } from 'pixi.js';
import { CameraState, SecurityCamera } from './SecurityCamera.js';
import { angleDiff, turnToward } from '../core/math.js';
import { BOAT_LIGHT_FOV, BOAT_LIGHT_RANGE } from './boatRules.js';

const SPEED = 60;
const TURN_SPEED = 1.4;
// The boat only makes way once it's roughly pointed at the next waypoint, so it turns like a boat.
const ALIGN_ANGLE = 0.6;
const ARRIVE_DIST = 2;
// Cool white, so the searchlight never reads as a guard's warm vision cone or a camera's teal one.
const LIGHT_COLOR = 0xe6f0ff;
const HULL = 0xc9d1dc;
const HULL_EDGE = 0x5a6272;
const CABIN = 0x39414f;

/**
 * Patrol boat: sails a waypoint route over deep water with a searchlight that
 * swings either side of its heading. The light works like a security camera
 * (detection meter, then alarm and position reports; finds bodies), and the
 * boat holds position while the light is on something. Boats can't be taken
 * down or disabled — the player has to stay out of the light.
 *
 * `patrol` waypoints are world-space { x, y, wait?, look? } over deep water;
 * legs are straight lines. `sweep` is radians, `sweepTime` seconds per pass.
 * Same events as SecurityCamera: 'alarm', 'report', 'bodyFound'.
 */
export class PatrolBoat extends SecurityCamera {
  constructor({ tilemap, patrol, route = 'loop', sweep, sweepTime }) {
    const heading = initialHeading(patrol);
    super({ tilemap, x: patrol[0].x, y: patrol[0].y, look: heading, sweep, sweepTime, pause: 0.3 });
    this.patrol = patrol.length === 1 ? [{ ...patrol[0], wait: Infinity }] : patrol;
    this.route = route;
    this.heading = heading;
    this.index = 0;
    this.step = 1;
    this.waitTimer = 0;
    this.wake = 0;
  }

  get range() {
    return BOAT_LIGHT_RANGE;
  }

  get fov() {
    return BOAT_LIGHT_FOV;
  }

  get idleColor() {
    return LIGHT_COLOR;
  }

  update(dt, ctx) {
    // Keep the light on whatever it has spotted rather than sailing away from it.
    const holding = this.meter > 0 || this.state === CameraState.ALARM;
    const moved = holding ? false : this._sail(dt);
    this.wake += ((moved ? 1 : 0) - this.wake) * Math.min(1, dt * 3);
    this.look = this.heading;
    super.update(dt, ctx);
  }

  /** Returns true if the boat moved this frame. */
  _sail(dt) {
    const waypoint = this.patrol[this.index];
    if (this.waitTimer > 0) {
      this.waitTimer -= dt;
      if (waypoint.look != null) this.heading = turnToward(this.heading, waypoint.look, TURN_SPEED * dt);
      if (this.waitTimer <= 0) this._advance();
      return false;
    }

    const dx = waypoint.x - this.x;
    const dy = waypoint.y - this.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= ARRIVE_DIST) {
      this.x = waypoint.x;
      this.y = waypoint.y;
      this.waitTimer = waypoint.wait ?? 0;
      if (this.waitTimer <= 0) this._advance();
      return false;
    }

    const want = Math.atan2(dy, dx);
    this.heading = turnToward(this.heading, want, TURN_SPEED * dt);
    if (Math.abs(angleDiff(want, this.heading)) > ALIGN_ANGLE) return false;
    // Move along the leg itself (validated to stay over water), whatever the bow is doing.
    const step = Math.min(SPEED * dt, dist);
    this.x += (dx / dist) * step;
    this.y += (dy / dist) * step;
    return true;
  }

  _advance() {
    const count = this.patrol.length;
    if (this.route === 'pingpong' && count > 1) {
      if (this.index + this.step < 0 || this.index + this.step >= count) this.step = -this.step;
      this.index += this.step;
    } else {
      this.index = (this.index + 1) % count;
    }
  }

  // --- rendering ------------------------------------------------------------

  _buildView() {
    const view = new Container();
    this.hull = new Graphics()
      .poly([21, 0, 11, -8.5, -15, -8.5, -18, -5, -18, 5, -15, 8.5, 11, 8.5])
      .fill(HULL)
      .stroke({ width: 1.5, color: HULL_EDGE })
      .roundRect(-12, -5.5, 15, 11, 2)
      .fill(CABIN);

    this.housing = new Graphics()
      .circle(0, 0, 4.5)
      .fill(0x22252e)
      .stroke({ width: 1, color: HULL_EDGE })
      .rect(3, -2.5, 4, 5)
      .fill(LIGHT_COLOR);
    this.led = new Graphics().circle(-1.5, 0, 1.5).fill(0xffffff);
    this.housing.addChild(this.led);

    this.meterBar = new Graphics();
    view.addChild(this.hull, this.housing, this.meterBar);
    return view;
  }

  _syncView() {
    super._syncView();
    this.hull.rotation = this.heading ?? this.facing;
  }

  _drawCone() {
    super._drawCone();
    const wake = this.wake ?? 0;
    if (wake < 0.05) return;
    // A V of wake trailing off the stern.
    const heading = this.heading;
    const sternX = this.x - Math.cos(heading) * 18;
    const sternY = this.y - Math.sin(heading) * 18;
    for (const side of [-1, 1]) {
      const angle = heading + Math.PI + side * 0.4;
      this.coneView
        .moveTo(sternX, sternY)
        .lineTo(sternX + Math.cos(angle) * 30, sternY + Math.sin(angle) * 30)
        .stroke({ width: 2, color: 0xcfe6ff, alpha: 0.3 * wake });
    }
  }
}

function initialHeading(patrol) {
  const [first, second] = patrol;
  if (first.look != null) return first.look;
  if (second && (second.x !== first.x || second.y !== first.y)) return Math.atan2(second.y - first.y, second.x - first.x);
  return 0;
}
