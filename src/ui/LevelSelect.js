import { SKINS, skinSvg } from '../entities/skins.js';
import { MAX_STARS } from '../game/rating.js';
import { SettingsPane } from './SettingsPane.js';

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

export function starString(stars) {
  return '★'.repeat(stars) + '☆'.repeat(MAX_STARS - stars);
}

const TABS = [
  { id: 'levels', label: 'Levels' },
  { id: 'skins', label: 'Skins' },
  { id: 'settings', label: 'Settings' },
];
const SKIN_COLUMNS = 4;

/**
 * The Esc menu, three tabs:
 *   Levels    one row per chapter, stars under each level, locked levels greyed
 *   Skins     cosmetic skins bought with stars
 *   Settings  input mode, key rebinding, reset progress (SettingsPane.js)
 * Minimal on purpose; Phase 12 restyles it. Driven from the game loop
 * (`handleInput`) so it shares the InputManager's per-frame presses with the
 * rest of the game; everything is clickable too.
 */
export class LevelSelect {
  constructor({ chapters, campaignIds, save, input, onPick, onSkinChange, onHome, onClose }) {
    this.input = input;
    this.onHome = onHome;
    this.onClose = onClose;
    this.canGoHome = false;
    this.settings = new SettingsPane({
      input,
      save,
      onChange: () => this.isOpen && this._render(),
      onProgressReset: () => onSkinChange?.(save.selectedSkin()),
    });
    input.onModeChange(() => this.isOpen && this._render());
    this.chapters = chapters;
    this.campaignIds = campaignIds;
    this.save = save;
    this.onPick = onPick;
    this.onSkinChange = onSkinChange;
    this.isOpen = false;
    this.tab = 'levels';
    this.row = 0;
    this.col = 0;
    this.skinIndex = 0;
    this.message = '';

    this.root = el('div', 'level-select');
    this.root.addEventListener('click', (e) => {
      if (!this.isOpen) return;
      const tab = e.target.closest('.ls-tab');
      const cell = e.target.closest('.ls-cell');
      const card = e.target.closest('.skin-card');
      const row = e.target.closest('.settings-row');
      if (e.target.closest('.ls-close')) this.close();
      else if (e.target.closest('.ls-home')) this.onHome?.();
      else if (row) this.settings.activate(Number(row.dataset.row));
      else if (this.settings.capturing) return;
      else if (tab) this._setTab(tab.dataset.tab);
      else if (cell) this._pick(cell.dataset.id);
      else if (card) {
        this.skinIndex = SKINS.findIndex((skin) => skin.id === card.dataset.id);
        this._useSkin();
      }
    });
    // Tab switches tabs here instead of moving browser focus.
    window.addEventListener('keydown', (e) => {
      if (this.isOpen && e.code === 'Tab') e.preventDefault();
    });
    document.body.append(this.root);
  }

  /** `tab`: which tab to show; `home`: offer "main menu" (only while playing a level). */
  open(currentId, { tab = 'levels', home = false } = {}) {
    this.isOpen = true;
    this.tab = tab;
    this.canGoHome = home;
    this.message = '';
    const focus = this.campaignIds.includes(currentId) ? currentId : this.save.continueId(this.campaignIds);
    const row = this.chapters.findIndex((chapter) => chapter.ids.includes(focus));
    this.row = Math.max(0, row);
    this.col = Math.max(0, this.chapters[this.row]?.ids.indexOf(focus) ?? 0);
    this.skinIndex = Math.max(0, SKINS.findIndex((skin) => skin.id === this.save.selectedSkin()));
    this._render();
    this.root.classList.add('visible');
  }

  /** `silent`: don't report the close (the caller is about to change scene itself). */
  close({ silent = false } = {}) {
    if (this.settings.capturing) return; // a key is being rebound; Esc cancels that first
    this.settings.reset();
    this.isOpen = false;
    this.root.classList.remove('visible');
    if (!silent) this.onClose?.();
  }

  handleInput(input) {
    if (this.settings.capturing) return;
    if (input.wasActionPressed('tabNext') || input.wasActionPressed('tabPrev')) {
      const step = input.wasActionPressed('tabNext') ? 1 : -1;
      const index = TABS.findIndex((tab) => tab.id === this.tab);
      this._setTab(TABS[(index + step + TABS.length) % TABS.length].id);
      return;
    }
    const dRow = (input.wasActionPressed('down') ? 1 : 0) - (input.wasActionPressed('up') ? 1 : 0);
    const dCol = (input.wasActionPressed('right') ? 1 : 0) - (input.wasActionPressed('left') ? 1 : 0);

    if (this.tab === 'levels') {
      if (dRow || dCol) {
        this.row = (this.row + dRow + this.chapters.length) % this.chapters.length;
        const count = this.chapters[this.row].ids.length;
        this.col = Math.min((this.col + dCol + count) % count, count - 1);
        this._highlight();
      }
      if (input.wasActionPressed('confirm')) this._pick(this.chapters[this.row].ids[this.col]);
    } else if (this.tab === 'settings') {
      this.settings.handleInput(input);
    } else {
      if (dRow || dCol) {
        const next = this.skinIndex + dCol + dRow * SKIN_COLUMNS;
        if (next >= 0 && next < SKINS.length) this.skinIndex = next;
        this.message = '';
        this._render();
      }
      if (input.wasActionPressed('confirm')) this._useSkin();
    }
  }

  _setTab(tab) {
    this.tab = tab;
    this.message = '';
    this.settings.reset();
    this._render();
  }

  _pick(id) {
    if (!this.save.isUnlocked(id, this.campaignIds)) return;
    this.onPick(id);
  }

  /** Enter/click on a skin: equip it if owned, otherwise buy it (and equip it) if the stars are there. */
  _useSkin() {
    const { save } = this;
    const skin = SKINS[this.skinIndex];
    if (!skin) return;
    if (!save.ownsSkin(skin.id)) {
      if (!save.buySkin(skin.id)) {
        this.message = `Not enough stars: ${skin.name} costs ${skin.price}, you have ${save.currency()}`;
        this._render();
        return;
      }
      this.message = `Bought ${skin.name} for ${skin.price} ★`;
    } else {
      this.message = '';
    }
    save.selectSkin(skin.id);
    this.onSkinChange?.(skin.id);
    this._render();
  }

  _render() {
    const { save, campaignIds } = this;
    const header = el('div', 'ls-header');
    const tabs = el('div', 'ls-tabs');
    for (const tab of TABS) {
      const button = el('button', `ls-tab${tab.id === this.tab ? ' active' : ''}`, tab.label);
      button.type = 'button';
      button.tabIndex = -1;
      button.dataset.tab = tab.id;
      tabs.append(button);
    }
    const close = el('button', 'ls-close', '✕');
    close.type = 'button';
    close.tabIndex = -1;
    if (this.canGoHome) {
      const home = el('button', 'ls-home');
      home.type = 'button';
      home.tabIndex = -1;
      if (this.input.activeMode !== 'touch') home.append(el('kbd', '', this.input.label('home')));
      home.append(document.createTextNode('Main menu'));
      header.append(home);
    }
    header.append(
      close,
      tabs,
      el('div', 'ls-total', `★ ${save.totalStars()} / ${campaignIds.length * MAX_STARS}   ·   ${save.currency()} to spend`),
    );

    const levels = this.tab === 'levels';
    const L = (action) => this.input.label(action);
    const verb = { levels: 'play', skins: 'buy / equip', settings: 'change' }[this.tab];
    const hint =
      this.input.activeMode === 'touch'
        ? 'Tap to choose  ·  ✕: back'
        : `${L('confirm')}: ${verb}  ·  ${L('tabPrev')} / ${L('tabNext')}: tabs  ·  ${L('menu')}: back`;
    const pane = levels ? this._levelGrid() : this.tab === 'skins' ? this._skinGrid() : this.settings.render();
    this.root.replaceChildren(header, pane, el('div', 'ls-hint', hint));
    if (levels) this._highlight();
  }

  _levelGrid() {
    const { save, campaignIds } = this;
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
    return grid;
  }

  _skinGrid() {
    const { save } = this;
    const equipped = save.selectedSkin();
    const wrap = el('div', 'skin-pane');
    const grid = el('div', 'skin-grid');
    SKINS.forEach((skin, index) => {
      const owned = save.ownsSkin(skin.id);
      const card = el('button', 'skin-card');
      card.type = 'button';
      card.tabIndex = -1;
      card.dataset.id = skin.id;
      if (index === this.skinIndex) card.classList.add('selected');
      if (skin.id === equipped) card.classList.add('equipped');
      if (!owned) card.classList.add(skin.price <= save.currency() ? 'affordable' : 'locked');
      const preview = el('div', 'skin-preview');
      preview.innerHTML = skinSvg(skin);
      const status = skin.id === equipped ? 'Equipped' : owned ? 'Owned' : `★ ${skin.price}`;
      card.append(preview, el('div', 'skin-name', skin.name), el('div', 'skin-status', status));
      grid.append(card);
    });
    const current = SKINS[this.skinIndex];
    wrap.append(grid, el('div', 'skin-blurb', this.message || current?.blurb || ''), el('div', 'skin-note', 'Skins are cosmetic only.'));
    return wrap;
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
