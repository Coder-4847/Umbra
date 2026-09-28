import { Graphics } from 'pixi.js';

const FLOCK_SIZE = 4;
const FLIGHT_TIME = 1.3;
const BODY = 0xd6cbb3;
const WING = 0x9c8f78;

/**
 * A small flock resting on the ground. Once flushed the birds scatter
 * outward, flapping and fading, and the flock is gone for the rest of the run.
 */
export class Birds {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.flushed = false;
    this.time = 0;
    this.flightTime = 0;

    // Deterministic per-flock layout so every run of a level looks the same.
    const seed = Math.floor(x * 13 + y * 7);
    this.birds = Array.from({ length: FLOCK_SIZE }, (_, i) => {
      const a = ((seed + i * 97) % 360) * (Math.PI / 180);
      const r = 3 + ((seed + i * 31) % 7);
      return {
        ox: Math.cos(a) * r,
        oy: Math.sin(a) * r,
        phase: (seed + i * 53) % 10,
        facing: ((seed + i * 71) % 360) * (Math.PI / 180),
        // Scatter away from the flock's center, with some spread.
        flyAngle: a + (((seed + i * 17) % 60) - 30) * (Math.PI / 180),
        flySpeed: 120 + ((seed + i * 43) % 70),
      };
    });

    this.view = new Graphics();
    this._draw();
  }

  get done() {
    return this.flushed && this.flightTime >= FLIGHT_TIME;
  }

  flush() {
    this.flushed = true;
    this.flightTime = 0;
  }

  update(dt) {
    this.time += dt;
    if (this.flushed) this.flightTime += dt;
    this._draw();
  }

  _draw() {
    const g = this.view;
    g.clear();
    if (this.done) return;

    if (!this.flushed) {
      for (const bird of this.birds) {
        // Idle pecking: a small dip every so often.
        const peck = Math.max(0, Math.sin(this.time * 2.2 + bird.phase)) ** 6 * 1.5;
        const bx = this.x + bird.ox;
        const by = this.y + bird.oy + peck;
        g.ellipse(bx, by, 3.2, 2.2).fill(BODY);
        g.circle(bx + Math.cos(bird.facing) * 2.6, by + Math.sin(bird.facing) * 2.6 - 0.6, 1.4).fill(WING);
      }
      return;
    }

    const t = this.flightTime / FLIGHT_TIME;
    const alpha = 1 - t * t;
    for (const bird of this.birds) {
      const dist = bird.flySpeed * this.flightTime;
      const bx = this.x + bird.ox + Math.cos(bird.flyAngle) * dist;
      // Rising toward the camera: drift "up" the screen a little and grow.
      const by = this.y + bird.oy + Math.sin(bird.flyAngle) * dist - 18 * t;
      const size = 4 + 4 * t;
      const flap = Math.sin(this.time * 30 + bird.phase) * 0.8;
      g.moveTo(bx - size, by - size * flap)
        .lineTo(bx, by)
        .lineTo(bx + size, by - size * flap)
        .stroke({ width: 1.6, color: BODY, alpha });
    }
  }
}
