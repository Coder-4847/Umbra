import { Graphics } from 'pixi.js';

/** Seconds a scent mark lingers. Dogs following a trail lose it once the marks ahead have faded. */
export const SCENT_LIFETIME = 8;

const MARK_SPACING = 36;
const COLOR = 0x9be15d;
const ALPHA = 0.3;

/**
 * The player's scent, left everywhere they walk (floor, bushes, shadows) in
 * levels with dogs. Kept in time order so dogs can scan newest-first and follow
 * the trail forward. Each mark: { x, y, time }.
 */
export class ScentTrail {
  constructor() {
    this.marks = [];
    this.now = 0;
    this.view = new Graphics();
    this._last = null;
  }

  update(dt, player) {
    this.now += dt;
    while (this.marks.length && this.now - this.marks[0].time > SCENT_LIFETIME) this.marks.shift();
    if (!player.dead && !player.inTransit) this._trackPlayer(player);
    this._draw();
  }

  /** After stairs/an elevator the trail starts over on the new floor. */
  jump(player) {
    this._last = { x: player.x, y: player.y };
  }

  _trackPlayer(player) {
    const last = this._last;
    if (last) {
      const dx = player.x - last.x;
      const dy = player.y - last.y;
      if (dx * dx + dy * dy < MARK_SPACING * MARK_SPACING) return;
    }
    this._last = { x: player.x, y: player.y };
    this.marks.push({ x: player.x, y: player.y, time: this.now });
  }

  _draw() {
    const g = this.view;
    g.clear();
    for (const mark of this.marks) {
      const life = 1 - (this.now - mark.time) / SCENT_LIFETIME;
      g.circle(mark.x, mark.y, 1.5 + 2 * life).fill({ color: COLOR, alpha: ALPHA * life });
    }
  }
}
