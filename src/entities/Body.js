import { Graphics } from 'pixi.js';

/**
 * A downed guard, or a knocked-out dog. Guards who see one that isn't
 * concealed raise suspicion (dogs smell them even when concealed).
 */
export class Body {
  constructor(x, y, facing, dog = false) {
    this.x = x;
    this.y = y;
    this.facing = facing;
    this.dog = dog;
    this.carried = false;
    this.concealed = false;
    this.discovered = false;

    this.view = new Graphics();
    if (dog) {
      // Curled up asleep.
      this.view.ellipse(-1, 1, 11, 7).fill(0x6e4829);
      this.view.circle(7, -3, 5).fill(0x8a5f3a);
      this.view.ellipse(-9, 5, 5, 2).fill(0x4a3020);
    } else {
      this.view.ellipse(0, 0, 13, 8).fill(0x34466b);
      this.view.circle(9, 0, 5).fill(0x4a5f8c);
    }
    this.view.rotation = facing;
    this._drawnDiscovered = false;
    this.update(null);
  }

  update(tilemap) {
    if (tilemap) this.concealed = tilemap.isConcealingAtWorld(this.x, this.y);
    this.view.position.set(this.x, this.y);
    this.view.alpha = this.concealed ? 0.4 : 1;

    if (this.discovered && !this._drawnDiscovered) {
      this._drawnDiscovered = true;
      this.view.circle(0, 0, 16).stroke({ width: 2, color: 0xffa53d, alpha: 0.8 });
    }
  }
}
