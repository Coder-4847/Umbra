import './style.css';
import { Game } from './core/Game.js';
import { Camera } from './core/Camera.js';
import { Level } from './game/Level.js';
import { SaveData } from './core/SaveData.js';
import { MAX_STARS, missedReasons, rateLevel } from './game/rating.js';
import { campaignIds, chapters, hasLevel, loadLevel, nextLevelId } from './levels/index.js';
import { LevelSelect } from './ui/LevelSelect.js';
import { parseLevel } from './levels/schema.js';
import { PLAYTEST_STORAGE_KEY } from './levels/playtest.js';

const game = new Game();
await game.init(document.querySelector('#app'));

// Minimal HUD and overlays; Phase 12 replaces these with the polished UI.
const hud = document.createElement('div');
hud.className = 'hud';
const overlay = document.createElement('div');
overlay.className = 'overlay';
document.body.append(hud, overlay);

const save = new SaveData();
const levelSelect = new LevelSelect({
  chapters,
  campaignIds,
  save,
  onPick: (id) => {
    levelSelect.close();
    goToLevel(id);
  },
});

let levelData = null;
let level = null;
let camera = null;
let hudText = '';
let loading = false;
// Editor playtests and non-campaign levels (sandboxes) never touch the save.
let recordsProgress = false;

const div = (className, textContent) => Object.assign(document.createElement('div'), { className, textContent });

function showOverlay(tone, title, hint, ...middle) {
  overlay.className = `overlay visible ${tone}`;
  overlay.replaceChildren(div('overlay-title', title), ...middle, div('overlay-hint', hint));
}

/** CLEAR screen: stars for this run, what cost a star, and what it added to the save. */
function showResults(stats) {
  const { stars } = rateLevel(stats, levelData.targetTime);
  const result = recordsProgress ? save.recordResult(levelData.id, stats, levelData.targetTime) : null;

  const starRow = div('overlay-stars');
  for (let i = 0; i < MAX_STARS; i++) {
    starRow.append(Object.assign(document.createElement('span'), { className: i < stars ? 'on' : 'off', textContent: '★' }));
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
  showOverlay('clear', 'CLEAR', `${next ? 'Enter: next level · ' : ''}R: replay · Esc: levels`, starRow, lines);
}

function hideOverlay() {
  overlay.className = 'overlay';
}

function formatTime(seconds) {
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function startLevel() {
  if (level) {
    game.world.removeChild(level.root);
    level.destroy();
  }
  level = new Level(levelData);
  game.world.addChild(level.root);
  hideOverlay();
  hudText = '';

  level.on('failed', () => showOverlay('fail', 'CAUGHT', 'R: retry · Esc: levels'));
  level.on('completed', showResults);

  camera = new Camera(level.player, { lerpSpeed: 6 });
  // A floor change is a cut, not a pan across the building.
  level.on('transit', () => {
    camera.x = level.player.x;
    camera.y = level.player.y;
  });
  if (import.meta.env.DEV) window.__debug = { game, level, camera, levelData, save, levelSelect };
}

async function goToLevel(id) {
  loading = true;
  try {
    levelData = await loadLevel(id);
    recordsProgress = campaignIds.includes(id);
    history.replaceState(null, '', `?level=${encodeURIComponent(id)}`);
    startLevel();
  } finally {
    loading = false;
  }
}

function updateHud() {
  const lines = level.objectiveStatus().map((s) => {
    const mark = s.done ? '✓' : s.locked ? '·' : '○';
    const count = s.total > 0 ? ` (${s.current}/${s.total})` : '';
    return `${mark} ${s.label}${count}`;
  });
  if (level.fullAlarm) lines.push('⚠ ALARM RAISED');
  else if (level.alarmRunner) lines.push('⚠ A guard is running for the alarm!');
  const radio = level.radioStatus();
  if (radio) lines.push(radio);
  const boss = level.bossStatus();
  if (boss) lines.push(boss);
  const hint = level.interactionHint();
  if (hint) lines.push(hint);
  const text = [levelData.name, ...lines].join('\n');
  if (text !== hudText) {
    hudText = text;
    hud.textContent = text;
  }
}

async function boot() {
  const params = new URLSearchParams(location.search);
  try {
    if (params.has('playtest')) {
      levelData = parseLevel(JSON.parse(localStorage.getItem(PLAYTEST_STORAGE_KEY)));
      startLevel();
    } else {
      // No level asked for: carry on where the save left off. `?level=` loads any
      // level in dev (tests, editor, verification scripts); a shipped build won't
      // open a campaign level the player hasn't unlocked.
      const requested = params.get('level');
      const fallback = save.continueId(campaignIds) ?? 'sandbox';
      const allowed =
        requested &&
        hasLevel(requested) &&
        (import.meta.env.DEV || !campaignIds.includes(requested) || save.isUnlocked(requested, campaignIds));
      await goToLevel(allowed ? requested : fallback);
    }
  } catch (err) {
    console.error(err);
    showOverlay('fail', 'LEVEL ERROR', err.message);
  }
}

await boot();

game.onUpdate((delta) => {
  if (!level || loading) return;

  // The level select pauses the game underneath it.
  if (game.input.wasActionPressed('menu')) {
    if (levelSelect.isOpen) levelSelect.close();
    else levelSelect.open(levelData.id);
    return;
  }
  if (levelSelect.isOpen) {
    levelSelect.handleInput(game.input);
    return;
  }

  if (game.input.wasActionPressed('restart')) startLevel();
  if (level.completed && game.input.wasActionPressed('confirm')) {
    const next = nextLevelId(levelData.id);
    if (next) goToLevel(next);
  }

  level.update(delta, game.input);
  updateHud();

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
});
