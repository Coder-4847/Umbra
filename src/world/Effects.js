import { Graphics } from 'pixi.js';

/**
 * Short-lived world-space feedback: noise rings, gunfire tracers, takedown bursts.
 * Everything is redrawn into one Graphics each frame; Phase 13 layers particles on top.
 */
export class Effects {
  constructor() {
    this.view = new Graphics();
    this.items = [];
  }

  ring(x, y, radius, color, duration = 0.5) {
    this.items.push({ type: 'ring', x, y, radius, color, duration, life: duration });
  }

  tracer(x1, y1, x2, y2, color, duration = 0.12) {
    this.items.push({ type: 'tracer', x1, y1, x2, y2, color, duration, life: duration });
  }

  burst(x, y, color, duration = 0.3) {
    this.items.push({ type: 'burst', x, y, color, duration, life: duration });
  }

  update(dt) {
    const g = this.view;
    g.clear();
    this.items = this.items.filter((item) => (item.life -= dt) > 0);

    for (const item of this.items) {
      const t = 1 - item.life / item.duration;
      const fade = 1 - t;
      switch (item.type) {
        case 'ring': {
          const eased = 1 - (1 - t) * (1 - t);
          g.circle(item.x, item.y, item.radius * eased).stroke({ width: 2, color: item.color, alpha: fade * 0.5 });
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
  }
}
