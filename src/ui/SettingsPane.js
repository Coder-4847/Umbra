import { ACTION_NAMES, INPUT_MODES, REBINDABLE_ACTIONS, codeLabel } from '../core/InputManager.js';

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const MODE_NAMES = { auto: 'Auto', keyboard: 'Keyboard & mouse', gamepad: 'Gamepad', touch: 'Touch' };

/**
 * The Settings tab of the Esc menu: input mode override, keyboard rebinding,
 * and reset progress. Rows are a vertical list: up/down moves, confirm (or a
 * click) activates, left/right changes the input mode.
 */
export class SettingsPane {
  constructor({ input, save, onChange, onProgressReset }) {
    this.input = input;
    this.save = save;
    this.onChange = onChange; // re-render request
    this.onProgressReset = onProgressReset;
    this.index = 0;
    this.capturing = null; // action waiting for a key
    this.confirmReset = false;
    this.message = '';
    this.rows = ['mode', ...REBINDABLE_ACTIONS.map((action) => `bind:${action}`), 'resetKeys', 'resetProgress'];
  }

  reset() {
    this.capturing = null;
    this.confirmReset = false;
    this.message = '';
  }

  handleInput(input) {
    if (this.capturing) return; // the next key goes to captureKey
    const step = (input.wasActionPressed('down') ? 1 : 0) - (input.wasActionPressed('up') ? 1 : 0);
    if (step) {
      this.index = (this.index + step + this.rows.length) % this.rows.length;
      this.confirmReset = false;
      this.message = '';
      this.onChange();
    }
    if (this.rows[this.index] === 'mode') {
      if (input.wasActionPressed('left')) this._cycleMode(-1);
      if (input.wasActionPressed('right')) this._cycleMode(1);
    }
    if (input.wasActionPressed('confirm')) this.activate(this.index);
  }

  activate(index) {
    if (this.capturing) return;
    this.index = index;
    const row = this.rows[index];
    if (row !== 'resetProgress') this.confirmReset = false;
    this.message = '';

    if (row === 'mode') this._cycleMode(1);
    else if (row.startsWith('bind:')) this._capture(row.slice(5));
    else if (row === 'resetKeys') {
      this.input.resetBindings();
      this._persist();
      this.message = 'Keys reset to defaults';
    } else if (row === 'resetProgress') {
      if (!this.confirmReset) this.confirmReset = true;
      else {
        this.confirmReset = false;
        this.save.reset();
        this.message = 'Progress erased';
        this.onProgressReset?.();
      }
    }
    this.onChange();
  }

  _cycleMode(step) {
    const index = INPUT_MODES.indexOf(this.input.mode);
    this.input.setMode(INPUT_MODES[(index + step + INPUT_MODES.length) % INPUT_MODES.length]);
    this._persist();
    this.onChange();
  }

  _capture(action) {
    this.capturing = action;
    this.input.captureKey((code) => {
      this.capturing = null;
      if (code && !this.input.rebind(action, code)) this.message = `${codeLabel(code)} is used by the menus`;
      else if (code) this._persist();
      this.onChange();
    });
  }

  _persist() {
    this.save.setSettings({ inputMode: this.input.mode, bindings: this.input.exportBindings() });
  }

  render() {
    const { input } = this;
    const pane = el('div', 'settings-pane');
    const addRow = (index, label, value, extraClass = '') => {
      const row = el('button', `settings-row${index === this.index ? ' selected' : ''}${extraClass}`);
      row.type = 'button';
      row.tabIndex = -1;
      row.dataset.row = String(index);
      row.append(el('span', 'settings-label', label), el('span', 'settings-value', value));
      pane.append(row);
    };

    this.rows.forEach((row, index) => {
      if (row === 'mode') {
        const detail = input.mode === 'auto' ? ` (${MODE_NAMES[input.activeMode]})` : '';
        addRow(index, 'Input mode', `◂ ${MODE_NAMES[input.mode]}${detail} ▸`);
      } else if (row.startsWith('bind:')) {
        const action = row.slice(5);
        const value = this.capturing === action ? 'Press a key… (Esc cancels)' : input.bindings[action].map(codeLabel).join(' / ');
        addRow(index, ACTION_NAMES[action], value, this.capturing === action ? ' capturing' : '');
      } else if (row === 'resetKeys') {
        addRow(index, 'Reset keys to defaults', '');
      } else {
        addRow(
          index,
          'Reset progress',
          this.confirmReset ? 'Press again to erase all stars, unlocks and skins' : '',
          this.confirmReset ? ' danger' : '',
        );
      }
    });

    pane.append(
      el('div', 'settings-message', this.message),
      el('div', 'skin-note', 'Gamepad: stick / d-pad move · A takedown · X interact · RT sprint · Y restart · Start menu'),
    );
    return pane;
  }
}
