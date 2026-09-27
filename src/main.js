import './style.css';
import { Game } from './core/Game.js';
import { Camera } from './core/Camera.js';
import { Tilemap } from './world/Tilemap.js';
import { Player } from './entities/Player.js';

const game = new Game();
await game.init(document.querySelector('#app'));

const tilemap = new Tilemap();
game.world.addChild(tilemap.view);

const player = new Player(3 * 32 + 16, 3 * 32 + 16);
game.world.addChild(player.view);

const camera = new Camera(player, { lerpSpeed: 6 });

if (import.meta.env.DEV) {
  window.__debug = { game, player, camera, tilemap };
}

game.onUpdate((delta) => {
  const move = game.input.getMoveVector();
  player.update(delta, move, tilemap);

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
