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
  back: [],
  tabPrev: ['KeyQ'],
  tabNext: ['KeyE', 'Tab'],
};

/** Actions whose primary key the player may change (settings tab). The rest are fixed. */
export const REBINDABLE_ACTIONS = ['up', 'down', 'left', 'right', 'sprint', 'attack', 'interact', 'restart'];
export const ACTION_NAMES = {
  up: 'Move up',
  down: 'Move down',
  left: 'Move left',
  right: 'Move right',
  sprint: 'Sprint',
  attack: 'Takedown',
  interact: 'Interact',
  restart: 'Restart level',
};
/** Keys the menus rely on; they can't be given to a gameplay action. */
const RESERVED_CODES = new Set(['Escape', 'Enter', 'NumpadEnter', 'Tab']);

export const INPUT_MODES = ['auto', 'keyboard', 'gamepad', 'touch'];

// Standard-mapping gamepad: button index -> actions.
const PAD_BUTTONS = {
  0: ['attack', 'confirm'], // A / cross
  1: ['back'], // B / circle
  2: ['interact'], // X / square
  3: ['restart'], // Y / triangle
  4: ['tabPrev'], // LB
  5: ['tabNext'], // RB
  6: ['sprint'], // LT
  7: ['sprint'], // RT
  9: ['menu'], // Start
  12: ['up'],
  13: ['down'],
  14: ['left'],
  15: ['right'],
};
const STICK_DEADZONE = 0.25;
const STICK_DIRECTION = 0.5;

const PAD_LABELS = {
  attack: 'A', confirm: 'A', back: 'B', interact: 'X', restart: 'Y',
  tabPrev: 'LB', tabNext: 'RB', sprint: 'RT', menu: 'Start',
};
const TOUCH_LABELS = { attack: 'Attack', interact: 'Use', restart: '↻', menu: '☰', confirm: 'Tap' };
const CODE_LABELS = {
  Space: 'Space', Escape: 'Esc', Enter: 'Enter', NumpadEnter: 'Enter', Tab: 'Tab',
  ShiftLeft: 'Shift', ShiftRight: 'R Shift', ControlLeft: 'Ctrl', ControlRight: 'R Ctrl', AltLeft: 'Alt', AltRight: 'R Alt',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Mouse0: 'Click', Mouse1: 'Middle click', Mouse2: 'Right click', Backspace: 'Backspace',
};

export function codeLabel(code) {
  if (!code) return '—';
  if (CODE_LABELS[code]) return CODE_LABELS[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  return code;
}

/**
 * Normalizes keyboard/mouse, gamepad and touch into named actions so gameplay
 * code never checks which source is active.
 *   - keyboard/mouse: event driven; mouse buttons are codes 'Mouse0', 'Mouse1', ...
 *   - gamepad: polled once per frame in `update()` (standard mapping, first pad)
 *   - touch: the on-screen controls (ui/TouchControls.js) call `press`,
 *     `setTouchDown` and `setTouchMove`
 * Every source always feeds input. `mode` ('auto' or a forced source) only
 * decides `activeMode`, i.e. which prompts are shown and whether the touch
 * controls are on screen; in 'auto' it follows whichever source was used last.
 */
export class InputManager {
  constructor(target = window) {
    this.target = target;
    this.bindings = structuredClone(DEFAULT_BINDINGS);
    this.down = new Set();
    this.pressed = new Set();
    this.pointer = { x: 0, y: 0 };

    // Action-level state from gamepad and touch.
    this.padDown = new Set();
    this.touchDown = new Set();
    this.actionPressed = new Set();
    this.padMove = null;
    this.touchMove = null;

    this.mode = 'auto';
    this.lastSource = globalThis.matchMedia?.('(pointer: coarse)').matches ? 'touch' : 'keyboard';
    this.modeListeners = [];
    this._capture = null;

    this._onKeyDown = (e) => {
      if (this._capture) {
        e.preventDefault();
        const done = this._capture;
        this._capture = null;
        done(e.code === 'Escape' ? null : e.code);
        return;
      }
      if (!e.repeat) this.pressed.add(e.code);
      this.down.add(e.code);
      this._setSource('keyboard');
    };
    this._onKeyUp = (e) => this.down.delete(e.code);
    this._onPointerDown = (e) => {
      if (e.pointerType === 'touch') {
        this._setSource('touch');
        return; // touches act through the on-screen controls, never as a mouse click
      }
      // Clicks on UI (buttons, the menu, the touch controls) aren't gameplay input.
      if (e.target?.closest?.('button, .level-select, .touch')) return;
      const code = `Mouse${e.button}`;
      this.pressed.add(code);
      this.down.add(code);
      this._setSource('keyboard');
    };
    this._onPointerUp = (e) => this.down.delete(`Mouse${e.button}`);
    this._onPointerMove = (e) => {
      this.pointer.x = e.clientX;
      this.pointer.y = e.clientY;
    };
    // Keyup never arrives for keys held while the window loses focus.
    this._onBlur = () => {
      this.down.clear();
      this.touchDown.clear();
      this.touchMove = null;
    };

    this.target.addEventListener('keydown', this._onKeyDown);
    this.target.addEventListener('keyup', this._onKeyUp);
    this.target.addEventListener('pointerdown', this._onPointerDown);
    this.target.addEventListener('pointerup', this._onPointerUp);
    this.target.addEventListener('pointermove', this._onPointerMove);
    this.target.addEventListener('blur', this._onBlur);
  }

  // --- reading ---------------------------------------------------------------

  isActionDown(action) {
    return this.bindings[action].some((code) => this.down.has(code)) || this.padDown.has(action) || this.touchDown.has(action);
  }

  /** True only on the frame the action was first pressed. */
  wasActionPressed(action) {
    return this.bindings[action].some((code) => this.pressed.has(code)) || this.actionPressed.has(action);
  }

  /** Unit-length movement vector: stick/joystick direction if one is pushed, else 8-way from the direction actions. */
  getMoveVector() {
    const analog = this.touchMove ?? this.padMove;
    if (analog) return { x: analog.x, y: analog.y };

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

  // --- frame -----------------------------------------------------------------

  /** Call once per frame before gameplay reads input: polls the gamepad. */
  update() {
    const pad = [...(globalThis.navigator?.getGamepads?.() ?? [])].find((p) => p && p.connected);
    const nowDown = new Set();
    let move = null;
    if (pad) {
      pad.buttons.forEach((button, index) => {
        if (button.pressed || button.value > 0.5) for (const action of PAD_BUTTONS[index] ?? []) nowDown.add(action);
      });
      const x = pad.axes[0] ?? 0;
      const y = pad.axes[1] ?? 0;
      const magnitude = Math.hypot(x, y);
      if (magnitude > STICK_DEADZONE) move = { x: x / magnitude, y: y / magnitude };
      // The stick also counts as direction presses, so it can drive the menus.
      if (x < -STICK_DIRECTION) nowDown.add('left');
      if (x > STICK_DIRECTION) nowDown.add('right');
      if (y < -STICK_DIRECTION) nowDown.add('up');
      if (y > STICK_DIRECTION) nowDown.add('down');
    }
    for (const action of nowDown) if (!this.padDown.has(action)) this.actionPressed.add(action);
    if (nowDown.size > 0 || move) this._setSource('gamepad');
    this.padDown = nowDown;
    this.padMove = move;
  }

  /** Call once per frame after all gameplay has read input. */
  endFrame() {
    this.pressed.clear();
    this.actionPressed.clear();
  }

  // --- touch / UI buttons ----------------------------------------------------

  /** One-frame press of an action (on-screen buttons). */
  press(action) {
    this.actionPressed.add(action);
  }

  setTouchDown(action, isDown) {
    if (isDown) this.touchDown.add(action);
    else this.touchDown.delete(action);
  }

  /** Joystick direction as a unit vector, or null when released. */
  setTouchMove(vector) {
    this.touchMove = vector;
  }

  // --- mode ------------------------------------------------------------------

  /** The source whose prompts and controls should be shown: 'keyboard' | 'gamepad' | 'touch'. */
  get activeMode() {
    return this.mode === 'auto' ? this.lastSource : this.mode;
  }

  setMode(mode) {
    if (!INPUT_MODES.includes(mode)) return;
    const before = this.activeMode;
    this.mode = mode;
    if (this.activeMode !== before) this._emitMode();
  }

  onModeChange(listener) {
    this.modeListeners.push(listener);
  }

  _setSource(source) {
    if (this.lastSource === source) return;
    const before = this.activeMode;
    this.lastSource = source;
    if (this.activeMode !== before) this._emitMode();
  }

  _emitMode() {
    for (const listener of this.modeListeners) listener(this.activeMode);
  }

  /** What to call an action in prompts, for the active mode. */
  label(action) {
    const mode = this.activeMode;
    if (mode === 'gamepad' && PAD_LABELS[action]) return PAD_LABELS[action];
    if (mode === 'touch' && TOUCH_LABELS[action]) return TOUCH_LABELS[action];
    return codeLabel(this.bindings[action][0]);
  }

  // --- rebinding (keyboard) --------------------------------------------------

  /** The next key pressed goes to `done(code)` instead of the game; Escape cancels (`done(null)`). */
  captureKey(done) {
    this._capture = done;
  }

  get capturing() {
    return this._capture !== null;
  }

  /**
   * Make `code` the primary key of a rebindable action. If another rebindable
   * action used that key, it gets this action's old key (a swap), so nothing
   * ends up unbound. Returns false for reserved keys.
   */
  rebind(action, code) {
    if (!REBINDABLE_ACTIONS.includes(action) || !code || RESERVED_CODES.has(code)) return false;
    const own = this.bindings[action];
    const old = own[0];
    if (old === code) return true;
    for (const other of REBINDABLE_ACTIONS) {
      if (other === action) continue;
      const list = this.bindings[other];
      const index = list.indexOf(code);
      if (index < 0) continue;
      if (old && !list.includes(old)) list[index] = old;
      else list.splice(index, 1);
    }
    this.bindings[action] = [code, ...own.slice(1).filter((c) => c !== code)];
    return true;
  }

  resetBindings() {
    this.bindings = structuredClone(DEFAULT_BINDINGS);
  }

  /** Only the rebindable actions, for the save file. */
  exportBindings() {
    return Object.fromEntries(REBINDABLE_ACTIONS.map((action) => [action, [...this.bindings[action]]]));
  }

  /** Apply `{ inputMode, bindings }` from the save; anything malformed is ignored. */
  applySettings(settings = {}) {
    if (INPUT_MODES.includes(settings.inputMode)) this.mode = settings.inputMode;
    for (const action of REBINDABLE_ACTIONS) {
      const codes = settings.bindings?.[action];
      if (Array.isArray(codes) && codes.length > 0 && codes.every((c) => typeof c === 'string')) this.bindings[action] = [...codes];
    }
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
