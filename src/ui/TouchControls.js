const STICK_RADIUS = 56;
const STICK_DEADZONE = 0.2;
const SPRINT_AT = 0.9;

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/**
 * On-screen controls for touch: a floating joystick (appears wherever the
 * thumb lands on the left side; pushed to the rim = sprint), Attack and Use
 * buttons bottom-right, pause and restart top-right. Feeds the InputManager,
 * so gameplay code doesn't know it exists.
 */
export class TouchControls {
  constructor(input) {
    this.input = input;
    this.visible = false;
    this.stickPointer = null;
    this.origin = { x: 0, y: 0 };

    this.root = el('div', 'touch');
    this.zone = el('div', 'touch-zone');
    this.stick = el('div', 'touch-stick');
    this.knob = el('div', 'touch-knob');
    this.stick.append(this.knob);
    this.root.append(this.zone, this.stick);

    this._button('touch-btn touch-attack', '⚔', 'attack');
    this._button('touch-btn touch-use', 'USE', 'interact');
    this._button('touch-btn touch-small touch-pause', '☰', 'menu');
    this._button('touch-btn touch-small touch-restart', '↻', 'restart');

    this.zone.addEventListener('pointerdown', (e) => this._stickStart(e));
    this.zone.addEventListener('pointermove', (e) => this._stickMove(e));
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      this.zone.addEventListener(type, (e) => this._stickEnd(e));
    }
    document.body.append(this.root);
  }

  setVisible(visible) {
    if (visible === this.visible) return;
    this.visible = visible;
    this.root.classList.toggle('visible', visible);
    if (!visible) this._release();
  }

  _button(className, text, action) {
    const button = el('button', className, text);
    button.type = 'button';
    button.tabIndex = -1;
    button.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.input.press(action);
    });
    this.root.append(button);
  }

  _stickStart(e) {
    if (this.stickPointer !== null) return;
    e.preventDefault();
    this.stickPointer = e.pointerId;
    try {
      this.zone.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic pointers can't be captured; moves still arrive on the zone.
    }
    this.origin = { x: e.clientX, y: e.clientY };
    this.stick.style.left = `${e.clientX}px`;
    this.stick.style.top = `${e.clientY}px`;
    this.stick.classList.add('active');
    this._apply(0, 0);
  }

  _stickMove(e) {
    if (e.pointerId !== this.stickPointer) return;
    this._apply((e.clientX - this.origin.x) / STICK_RADIUS, (e.clientY - this.origin.y) / STICK_RADIUS);
  }

  _stickEnd(e) {
    if (e.pointerId !== this.stickPointer) return;
    this._release();
  }

  _apply(x, y) {
    const raw = Math.hypot(x, y);
    const magnitude = Math.min(1, raw);
    const ux = raw > 0 ? x / raw : 0;
    const uy = raw > 0 ? y / raw : 0;
    const sprinting = magnitude >= SPRINT_AT;
    this.knob.style.transform = `translate(${ux * magnitude * STICK_RADIUS}px, ${uy * magnitude * STICK_RADIUS}px)`;
    this.stick.classList.toggle('sprint', sprinting);
    this.input.setTouchMove(magnitude > STICK_DEADZONE ? { x: ux, y: uy } : null);
    this.input.setTouchDown('sprint', sprinting);
  }

  _release() {
    this.stickPointer = null;
    this.stick.classList.remove('active', 'sprint');
    this.input.setTouchMove(null);
    this.input.setTouchDown('sprint', false);
  }
}
