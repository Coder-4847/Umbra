import { Graphics } from 'pixi.js';
import { distanceToSegment, laserActiveAt } from './securityRules.js';

// A pulsing beam flickers this long before it switches on, so its timing is readable.
const WARN_TIME = 0.35;
const REARM_TIME = 2;
const FLASH_TIME = 0.5;

const COLOR = {
  beam: 0xff3b3b,
  glow: 0xff6b6b,
  emitter: 0x3a3f4c,
  emitterEdge: 0x8a8fa0,
  disabled: 0x55596a,
};

/**
 * A tripwire beam between two points. Crossing it while it emits trips it;
 * after tripping it re-arms a couple of seconds later. `period`/`onTime`/`offset`
 * (seconds) make it pulse; period 0 means always on. A disabled laser (its
 * panel was hacked) stays off for good.
 */
export class Laser {
  constructor({ x1, y1, x2, y2, period = 0, onTime = 0, offset = 0 }) {
    Object.assign(this, { x1, y1, x2, y2, period, onTime, offset });
    this.disabled = false;
    this.cooldown = 0;
    this.flash = 0;
    this.touching = false;
    this.view = new Graphics();
  }

  isActive(time) {
    return !this.disabled && laserActiveAt(this, time);
  }

  /** True when the beam is off but about to switch on. */
  isWarming(time) {
    if (this.disabled || this.period <= 0 || this.isActive(time)) return false;
    return (time + this.offset) % this.period > this.period - WARN_TIME;
  }

  intersects(x, y, radius) {
    return distanceToSegment(x, y, this.x1, this.y1, this.x2, this.y2) <= radius;
  }

  trip() {
    this.cooldown = REARM_TIME;
    this.flash = FLASH_TIME;
  }

  update(dt, time) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.flash = Math.max(0, this.flash - dt);
    this._draw(time);
  }

  _draw(time) {
    const g = this.view;
    g.clear();
    const active = this.isActive(time);

    if (active) {
      const flicker = 0.85 + 0.15 * Math.sin(time * 40);
      const flash = this.flash > 0 ? 1 : 0;
      g.moveTo(this.x1, this.y1)
        .lineTo(this.x2, this.y2)
        .stroke({ width: 6 + flash * 4, color: COLOR.glow, alpha: (0.18 + flash * 0.3) * flicker });
      g.moveTo(this.x1, this.y1)
        .lineTo(this.x2, this.y2)
        .stroke({ width: 1.8, color: flash ? 0xffffff : COLOR.beam, alpha: flicker });
    } else if (this.isWarming(time) && Math.floor(time * 20) % 2 === 0) {
      g.moveTo(this.x1, this.y1).lineTo(this.x2, this.y2).stroke({ width: 1, color: COLOR.beam, alpha: 0.35 });
    }

    const emitterColor = this.disabled ? COLOR.disabled : active ? COLOR.beam : COLOR.emitterEdge;
    for (const [x, y] of [[this.x1, this.y1], [this.x2, this.y2]]) {
      g.rect(x - 4, y - 4, 8, 8).fill(COLOR.emitter).stroke({ width: 1, color: COLOR.emitterEdge });
      g.circle(x, y, 1.8).fill(emitterColor);
    }
  }
}
