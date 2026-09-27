import './style.css';
import { Game } from './core/Game.js';
import { Camera } from './core/Camera.js';
import { Level } from './game/Level.js';
import { testLevel } from './levels/testLevel.js';

const game = new Game();
await game.init(document.querySelector('#app'));

// Minimal fail screen; Phase 12 replaces this with the polished results/fail UI.
const overlay = document.createElement('div');
overlay.className = 'overlay';
overlay.innerHTML = '<div class="overlay-title">CAUGHT</div><div class="overlay-hint">Press R to retry</div>';
document.body.appendChild(overlay);

let level;
let camera;

function startLevel() {
  if (level) {
    game.world.removeChild(level.root);
    level.destroy();
  }
  level = new Level(testLevel);
  game.world.addChild(level.root);
  level.on('failed', () => overlay.classList.add('visible'));
  overlay.classList.remove('visible');

  camera = new Camera(level.player, { lerpSpeed: 6 });
  if (import.meta.env.DEV) window.__debug = { game, level, camera };
}

startLevel();

game.onUpdate((delta) => {
  if (game.input.wasActionPressed('restart')) startLevel();

  level.update(delta, game.input);

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
