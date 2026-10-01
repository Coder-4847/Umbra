import { Graphics } from 'pixi.js';

const PARTICLE_DRAG = 4.5;

/**
 * Short-lived world-space feedback: noise rings, gunfire tracers, bursts and
 * the particles they throw. Everything is redrawn into one Graphics each frame.
 */
export class Effects {
  constructor() {
    this.view = new Graphics();
    this.items = [];
    this.particles = [];
    this._seed = 1;
  }

  ring(x, y, radius, color, duration = 0.5) {
    this.items.push({ type: 'ring', x, y, radius, color, duration, life: duration });
  }

  tracer(x1, y1, x2, y2, color, duration = 0.12) {
    this.items.push({ type: 'tracer', x1, y1, x2, y2, color, duration, life: duration });
    this.sparks(x1, y1, color, 3, 60);
  }

  /** A flash that also throws a handful of sparks. */
  burst(x, y, color, duration = 0.3) {
    this.items.push({ type: 'burst', x, y, color, duration, life: duration });
    this.sparks(x, y, color, 9, 150);
  }

  /** `count` particles flying out from a point at up to `speed` px/s. */
  sparks(x, y, color, count = 8, speed = 140) {
    for (let i = 0; i < count; i++) {
      const angle = this._random() * Math.PI * 2;
      const v = speed * (0.35 + 0.65 * this._random());
      const duration = 0.25 + 0.3 * this._random();
      this.particles.push({ x, y, vx: Math.cos(angle) * v, vy: Math.sin(angle) * v, color, size: 1.2 + 1.6 * this._random(), duration, life: duration });
    }
  }

  // Deterministic, so a run looks the same every time (and tests don't depend on Math.random).
  _random() {
    this._seed = (this._seed * 1664525 + 1013904223) >>> 0;
    return this._seed / 4294967296;
  }

  update(dt) {
    const g = this.view;
    g.clear();
    this.items = this.items.filter((item) => (item.life -= dt) > 0);
    this.particles = this.particles.filter((p) => (p.life -= dt) > 0);

    for (const item of this.items) {
      const t = 1 - item.life / item.duration;
      const fade = 1 - t;
      switch (item.type) {
        case 'ring': {
          const eased = 1 - (1 - t) * (1 - t);
          g.circle(item.x, item.y, item.radius * eased).stroke({ width: 2, color: item.color, alpha: fade * 0.5 });
          // A fainter echo trailing the wavefront.
          if (eased > 0.2) g.circle(item.x, item.y, item.radius * (eased - 0.12)).stroke({ width: 1, color: item.color, alpha: fade * 0.2 });
          break;
        }
        case 'tracer':
          g.moveTo(item.x1, item.y1).lineTo(item.x2, item.y2).stroke({ width: 2, color: item.color, alpha: fade });
          break;
        case 'burst':
          g.circle(item.x, item.y, 6 + 20 * t).fill({ color: item.color, alpha: fade * 0.45 });
          break;
      }
    }

    const drag = Math.exp(-PARTICLE_DRAG * dt);
    for (const p of this.particles) {
      p.vx *= drag;
      p.vy *= drag;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const fade = p.life / p.duration;
      g.rect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size).fill({ color: p.color, alpha: fade * 0.9 });
    }
  }
}
