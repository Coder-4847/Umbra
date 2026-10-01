// Fonts ship with the game (no Google Fonts request), so it also works offline.
import '@fontsource/saira-condensed/latin-400.css';
import '@fontsource/saira-condensed/latin-500.css';
import '@fontsource/saira-condensed/latin-600.css';
import '@fontsource/saira-condensed/latin-700.css';
import '@fontsource/saira-condensed/latin-800.css';
import '@fontsource/saira-stencil-one/latin-400.css';
import './style.css';
import { audio } from './core/Audio.js';
import { Game } from './core/Game.js';
import { Camera } from './core/Camera.js';
import { Level } from './game/Level.js';
import { SaveData } from './core/SaveData.js';
import { applyVisualSettings, visual } from './core/visual.js';
import { getSkin } from './entities/skins.js';
import { MAX_STARS, missedReasons, rateLevel } from './game/rating.js';
import { CHAPTER_NAMES, campaignIds, chapters, hasLevel, loadLevel, nextLevelId } from './levels/index.js';
import { LevelSelect } from './ui/LevelSelect.js';
import { TitleScreen } from './ui/TitleScreen.js';
import { TouchControls } from './ui/TouchControls.js';
import { parseLevel } from './levels/schema.js';
import { PLAYTEST_STORAGE_KEY } from './levels/playtest.js';

// Single-floor levels that look busy with nobody playing: they run behind the main menu.
const DEMO_LEVELS = ['09-08', '03-06', '08-08', '06-04', '05-04', '10-08', '02-05'];
const DEMO_TIME = 26;
const FADE_MS = 220;

const game = new Game();
await game.init(document.querySelector('#app'));

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const div = (className, text) => el('div', className, text);

const hud = div('hud');
const intro = div('intro');
const overlay = div('overlay');
// Fades the canvas out and back in around level changes.
const veil = div('veil');
document.body.append(hud, intro, overlay, veil);

const save = new SaveData();
const { input } = game;
input.applySettings(save.data.settings);
applyVisualSettings(save.data.settings);
audio.init();
audio.setVolume(save.data.settings.volume);

// What each level 'fx' cue gets: a sound (same name unless given), camera shake
// (trauma 0..1) and hit-stop (seconds the level freezes). Kept restrained: stealth stays calm.
const FX = {
  takedown: { freeze: 0.05 },
  takedownLoud: { shake: 0.3, freeze: 0.06 },
  parry: { shake: 0.35, freeze: 0.06 },
  bossWound: { shake: 0.3, freeze: 0.1 },
  hurt: { shake: 0.55, freeze: 0.08 },
  shot: { shake: 0.12 },
  alarm: { shake: 0.45 },
  laser: { shake: 0.25 },
  cameraAlarm: { shake: 0.2 },
  spotted: { shake: 0.15 },
};
const MAX_SHAKE = 7; // px at full trauma
let trauma = 0;
let hitStop = 0;

function onFx(name, x, y) {
  const fx = FX[name] ?? {};
  audio.play(fx.sound ?? name, { x, y });
  if (fx.shake) trauma = Math.min(1, trauma + fx.shake);
  if (fx.freeze) hitStop = Math.max(hitStop, fx.freeze);
}
const touch = new TouchControls(input);
const levelSelect = new LevelSelect({
  chapters,
  campaignIds,
  save,
  input,
  onPick: (id) => {
    levelSelect.close({ silent: true });
    goToLevel(id);
  },
  onSkinChange: (id) => {
    if (scene === 'play') level?.player.setSkin(id);
  },
  onHome: () => {
    levelSelect.close({ silent: true });
    showTitle();
  },
  onClose: () => {
    if (scene === 'title') title.show(titleInfo());
  },
});
const title = new TitleScreen({
  input,
  onAction: (id) => {
    if (id === 'play') goToLevel(save.continueId(campaignIds) ?? 'sandbox');
    else {
      title.hide();
      levelSelect.open(null, { tab: id });
    }
  },
});

/** 'title' = main menu over a demo level, 'play' = a level the player controls. */
let scene = 'play';
let levelData = null;
let level = null;
let camera = null;
let hudHtml = '';
let loading = false;
// Editor playtests and non-campaign levels (sandboxes) never touch the save.
let recordsProgress = false;
let demoIndex = 0;
let demoTimer = 0;
let demoClock = 0;
const demoTarget = { x: 0, y: 0 };
let continueName = '';

const escapeHtml = (text) => String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const chapterLabel = (data) => (data.chapter >= 1 && CHAPTER_NAMES[data.chapter - 1] ? `Chapter ${data.chapter} · ${CHAPTER_NAMES[data.chapter - 1]}` : 'Test level');

function formatTime(seconds) {
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// --- overlays (CAUGHT / CLEAR) -------------------------------------------------

/** `actions`: [[action, text], ...] become buttons that also show the key/button for the active input mode. */
function showOverlay(tone, heading, actions, ...middle) {
  const buttons = div('overlay-actions');
  actions.forEach(([action, text], index) => {
    const button = el('button', `overlay-action${index === 0 ? ' primary' : ''}`);
    button.type = 'button';
    button.tabIndex = -1;
    if (input.activeMode !== 'touch') button.append(el('kbd', '', input.label(action)));
    button.append(document.createTextNode(text));
    button.addEventListener('click', () => input.press(action));
    buttons.append(button);
  });
  const card = div('overlay-card');
  card.append(div('overlay-title', heading), ...middle, buttons);
  overlay.className = `overlay visible ${tone}`;
  overlay.replaceChildren(card);
}

// The prompts name keys/buttons, so redraw them when the player switches device.
let overlayRedraw = null;
input.onModeChange(() => {
  if (!overlayRedraw) return;
  overlay.classList.add('instant'); // a redraw, not a new result: no entrance animation
  overlayRedraw();
});

/** CLEAR screen: stars for this run, what cost a star, and what it added to the save. */
function showResults(stats) {
  const { stars } = rateLevel(stats, levelData.targetTime);
  const result = recordsProgress ? save.recordResult(levelData.id, stats, levelData.targetTime) : null;
  const draw = () => drawResults(stats, stars, result);
  overlayRedraw = draw;
  overlay.classList.remove('instant');
  draw();
  audio.play('clear');
  // One chime per star, in step with the stars popping in.
  for (let i = 0; i < stars; i++) setTimeout(() => audio.play('star'), visual.reducedMotion ? 0 : 350 + i * 160);
}

function drawResults(stats, stars, result) {
  const starRow = div('overlay-stars');
  for (let i = 0; i < MAX_STARS; i++) {
    const star = el('span', i < stars ? 'on' : 'off', '★');
    star.style.setProperty('--i', String(i));
    starRow.append(star);
  }

  const lines = div('overlay-lines');
  const addLine = (text, className = '') => lines.append(div(className, text));
  addLine(`${formatTime(stats.elapsed)} / target ${formatTime(levelData.targetTime)}  ·  ${stats.kills} takedowns (${stats.stealthKills} silent)`);
  const missed = missedReasons(stats, levelData.targetTime);
  addLine(missed.length ? `Missed: ${missed.join(', ')}` : 'Perfect: unseen, no body found, in time');
  if (result) {
    if (result.starsGained > 0) addLine(`+${result.starsGained} ★  ·  ${save.currency()} to spend`, 'gain');
    else if (result.bestStars > stars) addLine(`Best: ${'★'.repeat(result.bestStars)}`);
    if (result.newBestTime) addLine(`New best time (${formatTime(result.bestTime)})`, 'gain');
  }

  const next = nextLevelId(levelData.id);
  const campaignDone = recordsProgress && !next;
  if (campaignDone) addLine(`Final mission cleared  ·  ★ ${save.totalStars()} / ${campaignIds.length * MAX_STARS}`, 'gain');
  const actions = [['restart', 'Replay'], ['menu', 'Levels'], ['home', 'Main menu']];
  if (next) actions.unshift(['confirm', 'Next level']);
  showOverlay('clear', campaignDone ? 'CAMPAIGN COMPLETE' : 'CLEAR', actions, starRow, lines);
}

function onFailed() {
  audio.play('fail');
  trauma = Math.min(1, trauma + 0.4);
  overlay.classList.remove('instant');
  showFailed();
}

function showFailed() {
  overlayRedraw = showFailed;
  showOverlay('fail', 'CAUGHT', [['restart', 'Retry'], ['menu', 'Levels'], ['home', 'Main menu']]);
}

function hideOverlay() {
  overlayRedraw = null;
  overlay.className = 'overlay';
}

// --- levels ----------------------------------------------------------------------

function mountLevel(data, options) {
  if (level) {
    game.world.removeChild(level.root);
    level.destroy();
  }
  levelData = data;
  level = new Level(data, options);
  game.world.addChild(level.root);
  game.app.renderer.background.color = level.palette.background;
  hideOverlay();
  hudHtml = '';
  hud.replaceChildren();
}

function startLevel() {
  mountLevel(levelData, { skin: save.selectedSkin() });
  level.on('failed', onFailed);
  level.on('completed', showResults);
  level.on('fx', onFx);
  audio.setAmbience(levelData.chapter ?? 0);
  trauma = 0;
  hitStop = 0;

  camera = new Camera(level.player, { lerpSpeed: 6 });
  // A floor change is a cut, not a pan across the building.
  level.on('transit', () => {
    camera.x = level.player.x;
    camera.y = level.player.y;
  });

  // Mission card: slides in at the start of every attempt.
  intro.replaceChildren(div('intro-tag', chapterLabel(levelData)), div('intro-name', levelData.name));
  intro.classList.remove('show');
  void intro.offsetWidth; // restart the animation
  intro.classList.add('show');

  exposeDebug();
}

function exposeDebug() {
  if (import.meta.env.DEV) window.__debug = { game, level, camera, levelData, save, levelSelect, touch, title, scene, audio };
}

/** Fade to black, run `swap`, fade back. Skipped under reduced motion. */
async function fadeThrough(swap) {
  loading = true;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  try {
    if (!visual.reducedMotion) {
      veil.classList.add('on');
      await wait(FADE_MS);
    }
    await swap();
  } finally {
    veil.classList.remove('on');
    loading = false;
  }
}

async function goToLevel(id) {
  await fadeThrough(async () => {
    const data = await loadLevel(id);
    scene = 'play';
    title.hide();
    levelData = data;
    recordsProgress = campaignIds.includes(id);
    history.replaceState(null, '', `?level=${encodeURIComponent(id)}`);
    startLevel();
  });
}

// --- main menu -------------------------------------------------------------------

function titleInfo() {
  const cleared = campaignIds.filter((id) => save.isCleared(id)).length;
  const next = save.continueId(campaignIds);
  const fresh = cleared === 0;
  const allDone = cleared === campaignIds.length;
  return {
    stars: save.totalStars(),
    maxStars: campaignIds.length * MAX_STARS,
    cleared,
    total: campaignIds.length,
    items: [
      {
        id: 'play',
        label: fresh ? 'Deploy' : 'Continue',
        sub: allDone ? 'every mission cleared: replay the finale' : `${next ?? ''}${continueName ? ` · ${continueName}` : ''}`,
      },
      { id: 'levels', label: 'Missions', sub: `${cleared} of ${campaignIds.length} cleared` },
      { id: 'skins', label: 'Loadout', sub: `${getSkin(save.selectedSkin()).name} · ${save.currency()} ★ to spend` },
      { id: 'settings', label: 'Settings', sub: 'controls, accessibility, progress' },
    ],
  };
}

async function loadDemo() {
  const ids = DEMO_LEVELS.filter(hasLevel);
  const data = await loadLevel(ids[demoIndex % ids.length] ?? campaignIds[0]);
  demoIndex++;
  mountLevel(data, { demo: true });
  demoTimer = DEMO_TIME;
  demoClock = Math.random() * 100;
  demoTarget.x = level.tilemap.pixelWidth / 2;
  demoTarget.y = level.tilemap.pixelHeight / 2;
  camera = new Camera(demoTarget, { lerpSpeed: 1.2 });
  audio.setAmbience(data.chapter ?? 0);
  audio.setTension(0);
  exposeDebug();
}

async function showTitle() {
  await fadeThrough(async () => {
    scene = 'title';
    recordsProgress = false;
    history.replaceState(null, '', location.pathname);
    intro.classList.remove('show');
    await loadDemo();
    const next = save.continueId(campaignIds);
    try {
      continueName = next ? (await loadLevel(next)).name : '';
    } catch {
      continueName = '';
    }
    title.show(titleInfo());
  });
}

/** The menu's backdrop: the camera wanders over the map; the level changes every so often. */
function updateDemo(delta) {
  demoTimer -= delta;
  if (demoTimer <= 0) {
    fadeThrough(loadDemo);
    return;
  }
  demoClock += delta;
  const { tilemap } = level;
  const reachX = Math.max(0, tilemap.pixelWidth - game.app.screen.width * 0.5) / 2;
  const reachY = Math.max(0, tilemap.pixelHeight - game.app.screen.height * 0.6) / 2;
  if (!visual.reducedMotion) {
    demoTarget.x = tilemap.pixelWidth / 2 + Math.sin(demoClock * 0.11) * reachX;
    demoTarget.y = tilemap.pixelHeight / 2 + Math.sin(demoClock * 0.17 + 1) * reachY;
  }
  level.update(delta, input);
  camera.bounds = null;
  camera.update(delta);
  camera.applyTo(game.world);
  // The menu sits on the left, so the map is shown right of centre.
  game.world.pivot.x -= game.app.screen.width * 0.16;
}

// --- HUD -------------------------------------------------------------------------

function updateHud() {
  const objectives = level
    .objectiveStatus()
    .map((s) => {
      const state = s.done ? 'done' : s.locked ? 'locked' : 'open';
      const count = s.total > 0 ? `<b>${s.current}/${s.total}</b>` : '';
      return `<li class="${state}"><i></i>${escapeHtml(s.label)}${count}</li>`;
    })
    .join('');
  const alert = level.fullAlarm ? 'Alarm raised' : level.alarmRunner ? 'A guard is running for the alarm' : '';
  const notes = [level.radioStatus(), level.bossStatus()].filter(Boolean);
  const hint = level.interactionHint();
  const html =
    `<div class="hud-tag">${escapeHtml(chapterLabel(levelData))}</div>` +
    `<div class="hud-name">${escapeHtml(levelData.name)}</div>` +
    `<ul class="hud-objectives">${objectives}</ul>` +
    (alert ? `<div class="hud-alert">${alert}</div>` : '') +
    notes.map((note) => `<div class="hud-note">${escapeHtml(note)}</div>`).join('') +
    (hint ? `<div class="hud-hint"><kbd>${escapeHtml(input.label('interact'))}</kbd>${escapeHtml(hint)}</div>` : '');
  if (html !== hudHtml) {
    hudHtml = html;
    hud.innerHTML = html;
  }
}

// --- boot ------------------------------------------------------------------------

async function boot() {
  const params = new URLSearchParams(location.search);
  try {
    if (params.has('playtest')) {
      levelData = parseLevel(JSON.parse(localStorage.getItem(PLAYTEST_STORAGE_KEY)));
      startLevel();
      return;
    }
    // `?level=` goes straight into a level: any level in dev (tests, editor,
    // verification scripts); a shipped build won't open a campaign level the
    // player hasn't unlocked. Without it, the game opens on the main menu.
    const requested = params.get('level');
    const allowed =
      requested &&
      hasLevel(requested) &&
      (import.meta.env.DEV || !campaignIds.includes(requested) || save.isUnlocked(requested, campaignIds));
    if (allowed) await goToLevel(requested);
    else await showTitle();
  } catch (err) {
    console.error(err);
    showOverlay('fail', 'LEVEL ERROR', [], div('overlay-lines', err.message));
  }
}

await boot();

// Switching apps or tabs mid-level: come back to the pause menu, not to a guard already aiming.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && scene === 'play' && level && !level.finished && !loading && !levelSelect.isOpen) {
    levelSelect.open(levelData.id, { home: true });
  }
});

game.onUpdate((delta) => {
  touch.setVisible(scene === 'play' && input.activeMode === 'touch' && !levelSelect.isOpen);
  if (!level || loading) return;

  // The Esc menu pauses the level underneath it (the demo keeps running behind the main menu).
  if (levelSelect.isOpen) {
    if (input.wasActionPressed('menu') || input.wasActionPressed('back')) levelSelect.close();
    else if (scene === 'play' && input.wasActionPressed('home')) {
      levelSelect.close({ silent: true });
      showTitle();
    } else levelSelect.handleInput(input);
    if (scene === 'title') updateDemo(delta);
    return;
  }

  if (scene === 'title') {
    title.handleInput(input);
    updateDemo(delta);
    return;
  }

  if (input.wasActionPressed('menu')) {
    levelSelect.open(levelData.id, { home: true });
    return;
  }
  if (level.finished && input.wasActionPressed('home')) {
    showTitle();
    return;
  }
  if (input.wasActionPressed('restart')) startLevel();
  if (level.completed && input.wasActionPressed('confirm')) {
    const next = nextLevelId(levelData.id);
    if (next) goToLevel(next);
  }

  // Hit-stop: the level holds for a few frames so a takedown or a hit lands.
  if (hitStop > 0) hitStop -= delta;
  else level.update(delta, input);
  updateHud();

  const { player } = level;
  audio.setListener(player.x, player.y);
  let tension = level.fullAlarm ? 1 : 0;
  if (!level.finished) for (const guard of level.guards) tension = Math.max(tension, guard.state === 'alert' ? 1 : guard.state === 'suspicious' ? 0.5 : 0);
  audio.setTension(level.finished ? 0 : tension);

  const { tilemap } = level;
  const halfW = game.app.screen.width / 2;
  const halfH = game.app.screen.height / 2;
  const fitsX = tilemap.pixelWidth > game.app.screen.width;
  const fitsY = tilemap.pixelHeight > game.app.screen.height;
  camera.bounds = {
    minX: fitsX ? halfW : tilemap.pixelWidth / 2,
    maxX: fitsX ? tilemap.pixelWidth - halfW : tilemap.pixelWidth / 2,
    minY: fitsY ? halfH : tilemap.pixelHeight / 2,
    maxY: fitsY ? tilemap.pixelHeight - halfH : tilemap.pixelHeight / 2,
  };
  camera.update(delta);
  camera.applyTo(game.world);

  if (trauma > 0) {
    if (!visual.reducedMotion) {
      const reach = trauma * trauma * MAX_SHAKE;
      game.world.pivot.x += (Math.random() * 2 - 1) * reach;
      game.world.pivot.y += (Math.random() * 2 - 1) * reach;
    }
    trauma = Math.max(0, trauma - delta * 2.4);
  }
});
