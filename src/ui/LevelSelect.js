import { MAX_STARS } from '../game/rating.js';

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

export function starString(stars) {
  return '★'.repeat(stars) + '☆'.repeat(MAX_STARS - stars);
}

/**
 * Chapter/level grid: one row per chapter, stars under each level, locked
 * levels greyed out. Minimal on purpose; Phase 12 restyles it.
 * Driven from the game loop (`handleInput`) so it shares the InputManager's
 * per-frame presses with the rest of the game; cells are clickable too.
 */
export class LevelSelect {
  constructor({ chapters, campaignIds, save, onPick }) {
    this.chapters = chapters;
    this.campaignIds = campaignIds;
    this.save = save;
    this.onPick = onPick;
    this.isOpen = false;
    this.row = 0;
    this.col = 0;

    this.root = el('div', 'level-select');
    this.root.addEventListener('click', (e) => {
      const cell = e.target.closest('.ls-cell');
      if (cell && this.isOpen) this._pick(cell.dataset.id);
    });
    document.body.append(this.root);
  }

  open(currentId) {
    this.isOpen = true;
    const focus = this.campaignIds.includes(currentId) ? currentId : this.save.continueId(this.campaignIds);
    const row = this.chapters.findIndex((chapter) => chapter.ids.includes(focus));
    this.row = Math.max(0, row);
    this.col = Math.max(0, this.chapters[this.row]?.ids.indexOf(focus) ?? 0);
    this._render();
    this.root.classList.add('visible');
  }

  close() {
    this.isOpen = false;
    this.root.classList.remove('visible');
  }

  handleInput(input) {
    const move = (dRow, dCol) => {
      this.row = (this.row + dRow + this.chapters.length) % this.chapters.length;
      const count = this.chapters[this.row].ids.length;
      this.col = Math.min((this.col + dCol + count) % count, count - 1);
      this._highlight();
    };
    if (input.wasActionPressed('up')) move(-1, 0);
    if (input.wasActionPressed('down')) move(1, 0);
    if (input.wasActionPressed('left')) move(0, -1);
    if (input.wasActionPressed('right')) move(0, 1);
    if (input.wasActionPressed('confirm')) this._pick(this.chapters[this.row].ids[this.col]);
  }

  _pick(id) {
    if (!this.save.isUnlocked(id, this.campaignIds)) return;
    this.onPick(id);
  }

  _render() {
    const { save, campaignIds } = this;
    const header = el('div', 'ls-header');
    header.append(
      el('div', 'ls-title', 'SELECT LEVEL'),
      el('div', 'ls-total', `★ ${save.totalStars()} / ${campaignIds.length * MAX_STARS}   ·   ${save.currency()} to spend`),
    );

    const grid = el('div', 'ls-grid');
    for (const chapter of this.chapters) {
      const earned = chapter.ids.reduce((sum, id) => sum + save.stars(id), 0);
      const row = el('div', 'ls-row');
      const label = el('div', 'ls-chapter');
      label.append(
        el('div', 'ls-chapter-name', `${chapter.number}. ${chapter.name}`),
        el('div', 'ls-chapter-stars', `★ ${earned} / ${chapter.ids.length * MAX_STARS}`),
      );
      const cells = el('div', 'ls-cells');
      for (const id of chapter.ids) {
        const unlocked = save.isUnlocked(id, campaignIds);
        const number = Number(id.slice(3));
        const cell = el('button', 'ls-cell');
        cell.type = 'button';
        cell.dataset.id = id;
        cell.tabIndex = -1;
        if (!unlocked) cell.classList.add('locked');
        if (save.isCleared(id)) cell.classList.add('cleared');
        if (number === 10) cell.classList.add('boss');
        cell.append(
          el('div', 'ls-number', number === 10 ? 'BOSS' : String(number)),
          el('div', 'ls-stars', unlocked ? starString(save.stars(id)) : 'locked'),
        );
        cells.append(cell);
      }
      row.append(label, cells);
      grid.append(row);
    }

    this.root.replaceChildren(header, grid, el('div', 'ls-hint', 'Arrows / WASD: move  ·  Enter: play  ·  Esc: back'));
    this._highlight();
  }

  _highlight() {
    const id = this.chapters[this.row]?.ids[this.col];
    for (const cell of this.root.querySelectorAll('.ls-cell')) {
      const selected = cell.dataset.id === id;
      cell.classList.toggle('selected', selected);
      if (selected) cell.scrollIntoView({ block: 'nearest' });
    }
  }
}
