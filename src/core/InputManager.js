const DEFAULT_BINDINGS = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  attack: ['Space', 'Mouse0'],
  interact: ['KeyE'],
  restart: ['KeyR'],
  confirm: ['Enter', 'NumpadEnter'],
  menu: ['Escape'],
  tabPrev: ['KeyQ'],
  tabNext: ['KeyE', 'Tab'],
};

/**
 * Normalizes input across sources (keyboard/mouse now, gamepad/touch in later phases)
 * into named actions so gameplay code never checks which source is active.
 * Mouse buttons are tracked as codes 'Mouse0', 'Mouse1', ...
 */
export class InputManager {
  constructor(target = window) {
    this.target = target;
    this.bindings = structuredClone(DEFAULT_BINDINGS);
    this.down = new Set();
    this.pressed = new Set();
    this.pointer = { x: 0, y: 0 };

    this._onKeyDown = (e) => {
      if (!e.repeat) this.pressed.add(e.code);
      this.down.add(e.code);
    };
    this._onKeyUp = (e) => this.down.delete(e.code);
    this._onPointerDown = (e) => {
      const code = `Mouse${e.button}`;
      this.pressed.add(code);
      this.down.add(code);
    };
    this._onPointerUp = (e) => this.down.delete(`Mouse${e.button}`);
    this._onPointerMove = (e) => {
      this.pointer.x = e.clientX;
      this.pointer.y = e.clientY;
    };
    // Keyup never arrives for keys held while the window loses focus.
    this._onBlur = () => this.down.clear();

    this.target.addEventListener('keydown', this._onKeyDown);
    this.target.addEventListener('keyup', this._onKeyUp);
    this.target.addEventListener('pointerdown', this._onPointerDown);
    this.target.addEventListener('pointerup', this._onPointerUp);
    this.target.addEventListener('pointermove', this._onPointerMove);
    this.target.addEventListener('blur', this._onBlur);
  }

  isActionDown(action) {
    return this.bindings[action].some((code) => this.down.has(code));
  }

  /** True only on the frame the action was first pressed. */
  wasActionPressed(action) {
    return this.bindings[action].some((code) => this.pressed.has(code));
  }

  /** Normalized 8-directional movement vector. */
  getMoveVector() {
    let x = 0;
    let y = 0;
    if (this.isActionDown('up')) y -= 1;
    if (this.isActionDown('down')) y += 1;
    if (this.isActionDown('left')) x -= 1;
    if (this.isActionDown('right')) x += 1;

    if (x !== 0 && y !== 0) {
      x *= Math.SQRT1_2;
      y *= Math.SQRT1_2;
    }
    return { x, y };
  }

  getPointer() {
    return this.pointer;
  }

  /** Call once per frame after all gameplay has read input. */
  endFrame() {
    this.pressed.clear();
  }

  destroy() {
    this.target.removeEventListener('keydown', this._onKeyDown);
    this.target.removeEventListener('keyup', this._onKeyUp);
    this.target.removeEventListener('pointerdown', this._onPointerDown);
    this.target.removeEventListener('pointerup', this._onPointerUp);
    this.target.removeEventListener('pointermove', this._onPointerMove);
    this.target.removeEventListener('blur', this._onBlur);
  }
}
