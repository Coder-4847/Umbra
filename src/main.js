import './style.css';
import { Game } from './core/Game.js';
import { Camera } from './core/Camera.js';
import { Level } from './game/Level.js';
import { campaignIds, hasLevel, loadLevel, nextLevelId } from './levels/index.js';
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

let levelData = null;
let level = null;
let camera = null;
let hudText = '';

function showOverlay(tone, title, hint) {
  overlay.className = `overlay visible ${tone}`;
  overlay.replaceChildren(
    Object.assign(document.createElement('div'), { className: 'overlay-title', textContent: title }),
    Object.assign(document.createElement('div'), { className: 'overlay-hint', textContent: hint }),
  );
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

  level.on('failed', () => showOverlay('fail', 'CAUGHT', 'Press R to retry'));
  level.on('completed', (stats) => {
    const next = nextLevelId(levelData.id);
    const summary = `${formatTime(stats.elapsed)} · ${stats.kills} kills (${stats.stealthKills} silent) · spotted ${stats.detections}×`;
    showOverlay('clear', 'CLEAR', `${summary}  —  ${next ? 'Enter: next level · ' : ''}R: replay`);
  });

  camera = new Camera(level.player, { lerpSpeed: 6 });
  if (import.meta.env.DEV) window.__debug = { game, level, camera, levelData };
}

async function goToLevel(id) {
  levelData = await loadLevel(id);
  history.replaceState(null, '', `?level=${encodeURIComponent(id)}`);
  startLevel();
}

function updateHud() {
  const lines = level.objectiveStatus().map((s) => {
    const mark = s.done ? '✓' : s.locked ? '·' : '○';
    const count = s.total > 0 ? ` (${s.current}/${s.total})` : '';
    return `${mark} ${s.label}${count}`;
  });
  if (level.fullAlarm) lines.push('⚠ ALARM RAISED');
  else if (level.alarmRunner) lines.push('⚠ A guard is running for the alarm!');
  if (!level.finished && !level.player.dragging && level.hackablePanel()) lines.push('E — disable alarm panel');
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
      const requested = params.get('level');
      const id = requested && hasLevel(requested) ? requested : (campaignIds[0] ?? 'sandbox');
      await goToLevel(id);
    }
  } catch (err) {
    console.error(err);
    showOverlay('fail', 'LEVEL ERROR', err.message);
  }
}

await boot();

game.onUpdate((delta) => {
  if (!level) return;

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
