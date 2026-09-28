import { Graphics } from 'pixi.js';

const COLOR = {
  case: 0x2a2d38,
  edge: 0x6a7082,
  ok: 0x4ade80,
  targeted: 0xff4545,
  triggered: 0xff4545,
  disabled: 0x3a3d48,
};

/**
 * Security panel. Guards run to working panels to raise a full alarm; the
 * player can hack one to disable it and whatever lasers/cameras are wired to it.
 * States: working, targeted (a guard is on the way), triggered (alarm raised),
 * disabled (hacked).
 */
export class AlarmPanel {
  constructor({ x, y, id = null }) {
    this.x = x;
    this.y = y;
    this.id = id;
    this.disabled = false;
    this.triggered = false;
    this.targeted = false;
    this.view = new Graphics();
  }

  get working() {
    return !this.disabled && !this.triggered;
  }

  update(time) {
    const g = this.view;
    g.clear();
    g.roundRect(this.x - 8, this.y - 10, 16, 20, 2).fill(COLOR.case).stroke({ width: 1, color: COLOR.edge });

    let screen = COLOR.ok;
    let alpha = 0.55 + 0.25 * Math.sin(time * 2);
    if (this.disabled) {
      screen = COLOR.disabled;
      alpha = 1;
    } else if (this.triggered) {
      screen = COLOR.triggered;
      alpha = 1;
    } else if (this.targeted) {
      screen = COLOR.targeted;
      alpha = Math.floor(time * 8) % 2 === 0 ? 1 : 0.3;
    }
    g.rect(this.x - 5, this.y - 7, 10, 7).fill({ color: screen, alpha });
    for (let i = 0; i < 3; i++) g.rect(this.x - 5 + i * 4, this.y + 3, 2, 2).fill(COLOR.edge);
  }
}
