import './style.css';
import { Container } from 'pixi.js';
import { Game } from './core/Game.js';
import { Camera } from './core/Camera.js';
import { Tilemap, tileCenter } from './world/Tilemap.js';
import { Player } from './entities/Player.js';
import { Guard } from './entities/Guard.js';

const game = new Game();
await game.init(document.querySelector('#app'));

const tilemap = new Tilemap();
const coneLayer = new Container();
const entityLayer = new Container();
game.world.addChild(tilemap.view, coneLayer, entityLayer);

const spawn = tileCenter(3, 3);
const player = new Player(spawn.x, spawn.y);

// Placeholder test routes until Phase 4's JSON level format replaces them.
const DOWN = Math.PI / 2;
const LEFT = Math.PI;
const waypoint = (tx, ty, extra = {}) => ({ ...tileCenter(tx, ty), ...extra });
const guardConfigs = [
  { route: 'pingpong', patrol: [waypoint(6, 13, { wait: 1.5 }), waypoint(18, 13, { wait: 1.5 })] },
  {
    route: 'loop',
    patrol: [
      waypoint(18, 14, { wait: 0.5 }),
      waypoint(24, 14, { wait: 0.5 }),
      waypoint(24, 21, { wait: 0.5 }),
      waypoint(18, 21, { wait: 0.5 }),
    ],
  },
  {
    route: 'loop',
    patrol: [waypoint(33, 12, { wait: 2.5, look: DOWN }), waypoint(33, 12, { wait: 2.5, look: LEFT })],
  },
  {
    route: 'loop',
    patrol: [
      waypoint(30, 30, { wait: 1 }),
      waypoint(50, 30, { wait: 1 }),
      waypoint(50, 35, { wait: 1 }),
      waypoint(30, 35, { wait: 1 }),
    ],
  },
  { route: 'pingpong', patrol: [waypoint(49, 4, { wait: 1 }), waypoint(49, 20, { wait: 1 })] },
];
const guards = guardConfigs.map((config) => new Guard({ tilemap, ...config }));

for (const guard of guards) {
  coneLayer.addChild(guard.coneView);
  entityLayer.addChild(guard.view);
}
entityLayer.addChild(player.view);

const camera = new Camera(player, { lerpSpeed: 6 });

if (import.meta.env.DEV) {
  window.__debug = { game, player, guards, camera, tilemap };
}

game.onUpdate((delta) => {
  const move = game.input.getMoveVector();
  player.update(delta, move, tilemap);

  for (const guard of guards) guard.update(delta, player);

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
