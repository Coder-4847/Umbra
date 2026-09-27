import './style.css';
import { Graphics } from 'pixi.js';
import { Game } from './core/Game.js';

const game = new Game();
await game.init(document.querySelector('#app'));

// Placeholder sprite to sanity-check the loop, input, and camera until
// Phase 1 replaces this with the real player entity and tilemap.
const placeholder = new Graphics().rect(-16, -16, 32, 32).fill(0x4ade80);
game.world.addChild(placeholder);

const speed = 220;
game.onUpdate((delta) => {
  const move = game.input.getMoveVector();
  placeholder.x += move.x * speed * delta;
  placeholder.y += move.y * speed * delta;
});
