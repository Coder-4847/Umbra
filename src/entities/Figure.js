import { Container, Graphics } from 'pixi.js';
import { drawShapes } from './shapes.js';

const BOOT = 0x14171c;
// Radians of walk cycle per pixel travelled: about one stride every 34px.
const STRIDE = 0.185;

/**
 * A walking person seen from above: a soft ground shadow, two boots that swing
 * under the body as it moves, and the body itself (a shape list, see shapes.js)
 * swaying slightly with each step. `pose(x, y, facing)` once per frame is all it
 * needs; the walk cycle is driven by the distance actually covered.
 */
export class Figure extends Container {
  constructor(shapes, scale = 1) {
    super();
    this.shadow = new Graphics();
    this.rig = new Container();
    this.feet = [new Graphics(), new Graphics()];
    this.body = new Graphics();
    this.rig.addChild(...this.feet, this.body);
    this.addChild(this.shadow, this.rig);
    this.phase = 0;
    this.stride = 0;
    this._last = null;
    this.setShapes(shapes, scale);
  }

  setShapes(shapes, scale = this.figureScale) {
    this.figureScale = scale;
    this.body.clear();
    drawShapes(this.body, shapes, scale);
    this.shadow.clear().ellipse(2.5 * scale, 3.5 * scale, 11 * scale, 10 * scale).fill({ color: 0x000000, alpha: 0.32 });
    for (const foot of this.feet) foot.clear().ellipse(0, 0, 4.4 * scale, 2.7 * scale).fill(BOOT);
  }

  /** Four-legged or wheeled things draw their own body and skip the boots. */
  setFeetVisible(visible) {
    for (const foot of this.feet) foot.visible = visible;
  }

  pose(x, y, facing) {
    const moved = this._last ? Math.hypot(x - this._last.x, y - this._last.y) : 0;
    this._last = { x, y };
    // Teleports (stairs, a boss relocating) are not steps.
    const step = moved > 20 ? 0 : moved;
    this.phase += step * STRIDE;
    this.stride += ((step > 0.05 ? 1 : 0) - this.stride) * 0.2;

    const k = this.figureScale;
    const swing = Math.sin(this.phase) * 6 * this.stride * k;
    this.feet[0].position.set(swing - k, -4.6 * k);
    this.feet[1].position.set(-swing - k, 4.6 * k);
    this.body.rotation = Math.sin(this.phase) * 0.08 * this.stride;
    this.rig.rotation = facing;
  }
}
