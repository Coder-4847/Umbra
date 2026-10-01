import { audio } from '../core/Audio.js';

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const TIPS = [
  'Walking is silent. Sprinting is not.',
  'A takedown from behind is silent. From the front, everyone hears it.',
  'Bushes and shadows hide you only if nobody watched you walk in.',
  'A body in the open gets found. Drag it into cover, or sink it.',
  'Walls muffle noise. Use them.',
  'Cameras pause at the end of every sweep. That is your window.',
  'Dogs follow your scent, and cover does not fool them. Shallow water does.',
  'A patrol boat only lights what is ahead of it. Follow it, never meet it.',
  'Radio teams check in every ten seconds. A missing voice brings company.',
  'Three stars: never seen, no body found, under the target time.',
];

/**
 * Main menu: title block and a numbered menu on the left, the live demo level
 * showing through on the right, a tip ticker along the bottom. Driven from
 * the game loop like the Esc menu (keyboard, gamepad), and clickable/tappable.
 */
export class TitleScreen {
  constructor({ input, onAction }) {
    this.input = input;
    this.onAction = onAction;
    this.visible = false;
    this.index = 0;
    this.items = [];

    this.root = el('div', 'title');
    this.root.addEventListener('click', (e) => {
      const item = e.target.closest('.title-item');
      if (item && this.visible) this._activate(Number(item.dataset.index));
    });
    this.root.addEventListener('pointermove', (e) => {
      const item = e.target.closest('.title-item');
      if (item && Number(item.dataset.index) !== this.index) this._select(Number(item.dataset.index));
    });
    input.onModeChange(() => this.visible && this._renderHints());
    document.body.append(this.root);
  }

  /** `info`: { items: [{ id, label, sub }], stars, maxStars, cleared, total } */
  show(info) {
    this.items = info.items;
    this.index = 0;
    this.visible = true;
    this._render(info);
    this.root.classList.add('visible');
  }

  hide() {
    this.visible = false;
    this.root.classList.remove('visible');
  }

  handleInput(input) {
    const step = (input.wasActionPressed('down') ? 1 : 0) - (input.wasActionPressed('up') ? 1 : 0);
    if (step) this._select((this.index + step + this.items.length) % this.items.length);
    if (input.wasActionPressed('confirm')) this._activate(this.index);
  }

  _select(index) {
    if (index !== this.index) audio.play('uiMove');
    this.index = index;
    this.root.querySelectorAll('.title-item').forEach((node, i) => node.classList.toggle('selected', i === index));
  }

  _activate(index) {
    this._select(index);
    audio.play('uiSelect');
    this.onAction(this.items[index].id);
  }

  _render(info) {
    const left = el('div', 'title-left');

    const tags = el('div', 'title-tags');
    tags.append(el('span', 'tag tag-solid', 'Night operations'), el('span', 'tag', `${info.cleared} / ${info.total} missions`));

    const logo = el('h1', 'title-logo', 'UMBRA');
    const strap = el('div', 'title-strap');
    strap.append(el('span', 'title-strap-block', 'Stay out of the light'), el('span', 'title-strap-tape'));

    const menu = el('div', 'title-menu');
    this.items.forEach((item, index) => {
      const row = el('button', `title-item${index === this.index ? ' selected' : ''}`);
      row.type = 'button';
      row.tabIndex = -1;
      row.dataset.index = String(index);
      row.style.setProperty('--i', String(index));
      const text = el('span', 'title-item-text');
      text.append(el('span', 'title-item-label', item.label), el('span', 'title-item-sub', item.sub));
      row.append(el('span', 'title-item-number', String(index + 1).padStart(2, '0')), text);
      menu.append(row);
    });

    this.hints = el('div', 'title-hints');
    left.append(tags, logo, strap, menu, this.hints);

    const card = el('div', 'title-card');
    card.append(
      el('div', 'title-card-big', `★ ${info.stars}`),
      el('div', 'title-card-small', info.stars === 0 ? 'No stars yet. Go earn some.' : `of ${info.maxStars} stars`),
    );

    const ticker = el('div', 'title-ticker');
    const track = el('div', 'title-ticker-track');
    // Two copies so the loop is seamless.
    for (let copy = 0; copy < 2; copy++) for (const tip of TIPS) track.append(el('span', 'title-tip', tip));
    ticker.append(el('span', 'title-ticker-label', 'Briefing'), track);

    this.root.replaceChildren(el('div', 'title-shade'), left, card, ticker);
    this._renderHints();
  }

  _renderHints() {
    const L = (action) => this.input.label(action);
    const mode = this.input.activeMode;
    const parts =
      mode === 'touch'
        ? [['Tap', 'choose'], ['Drag', 'move in a mission']]
        : mode === 'gamepad'
          ? [['Stick', 'move'], [L('attack'), 'takedown'], [L('interact'), 'interact'], [L('menu'), 'menu']]
          : [['WASD', 'move'], [L('sprint'), 'sprint'], [L('attack'), 'takedown'], [L('interact'), 'interact'], [L('menu'), 'menu']];
    this.hints.replaceChildren(
      ...parts.map(([key, text]) => {
        const hint = el('span', 'title-hint');
        hint.append(el('kbd', '', key), document.createTextNode(` ${text}`));
        return hint;
      }),
    );
  }
}
