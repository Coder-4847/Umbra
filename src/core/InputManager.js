/**
 * Normalizes input across sources (keyboard/mouse now, gamepad/touch in later phases)
 * into one interface so gameplay code never checks which source is active.
 */
export class InputManager {
  constructor(target = window) {
    this.target = target;
    this.keys = new Set();
    this.pointer = { x: 0, y: 0 };

    this._onKeyDown = (e) => this.keys.add(e.code);
    this._onKeyUp = (e) => this.keys.delete(e.code);
    this._onPointerMove = (e) => {
      this.pointer.x = e.clientX;
      this.pointer.y = e.clientY;
    };

    this.target.addEventListener('keydown', this._onKeyDown);
    this.target.addEventListener('keyup', this._onKeyUp);
    this.target.addEventListener('pointermove', this._onPointerMove);
  }

  isDown(code) {
    return this.keys.has(code);
  }

  /** Returns a normalized 8-directional movement vector from WASD/arrow keys. */
  getMoveVector() {
    let x = 0;
    let y = 0;
    if (this.isDown('KeyW') || this.isDown('ArrowUp')) y -= 1;
    if (this.isDown('KeyS') || this.isDown('ArrowDown')) y += 1;
    if (this.isDown('KeyA') || this.isDown('ArrowLeft')) x -= 1;
    if (this.isDown('KeyD') || this.isDown('ArrowRight')) x += 1;

    if (x !== 0 && y !== 0) {
      const invLength = 1 / Math.sqrt(2);
      x *= invLength;
      y *= invLength;
    }
    return { x, y };
  }

  getPointer() {
    return this.pointer;
  }

  destroy() {
    this.target.removeEventListener('keydown', this._onKeyDown);
    this.target.removeEventListener('keyup', this._onKeyUp);
    this.target.removeEventListener('pointermove', this._onPointerMove);
  }
}
