import { Graphics } from 'pixi.js';
import { TILE_SIZE } from '../world/tiles.js';

const COLOR = {
  frame: 0x5d6272,
  bar: 0x9aa1b5,
  lock: 0x7dd3fc,
  open: 0x3a3f4c,
};

/**
 * A barred gate across a straight run of tiles. Closed, it blocks movement but
 * not sight or sound (you can see and be seen through the bars). It opens for
 * good when its alarm panel is hacked. `tiles` are { tx, ty }.
 */
export class Gate {
  constructor({ tiles }) {
    this.tiles = tiles;
    this.open = false;
    this.panel = null;
    this.view = new Graphics();
    this._draw();
  }

  /** Opens the gate; returns false if it already was. */
  unlock() {
    if (this.open) return false;
    this.open = true;
    this._draw();
    return true;
  }

  _draw() {
    const g = this.view;
    g.clear();
    for (const { tx, ty } of this.tiles) {
      const px = tx * TILE_SIZE;
      const py = ty * TILE_SIZE;
      if (this.open) {
        // Just the frame left on the floor, swung aside.
        g.rect(px + 1, py + 1, TILE_SIZE - 2, TILE_SIZE - 2).stroke({ width: 1, color: COLOR.open, alpha: 0.8 });
        continue;
      }
      g.rect(px + 1, py + 1, TILE_SIZE - 2, TILE_SIZE - 2).stroke({ width: 2, color: COLOR.frame });
      for (let i = 1; i <= 4; i++) {
        const x = px + (TILE_SIZE * i) / 5;
        g.moveTo(x, py + 3).lineTo(x, py + TILE_SIZE - 3).stroke({ width: 2, color: COLOR.bar });
      }
      g.rect(px + TILE_SIZE / 2 - 3, py + TILE_SIZE / 2 - 3, 6, 6).fill(COLOR.lock);
    }
  }
}
