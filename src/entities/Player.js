import { Graphics } from 'pixi.js';
import { moveAndCollide } from '../world/collision.js';

const HALF_SIZE = 10;
const SPEED = 180;

/** 8-directional player entity with sliding tile collision. */
export class Player {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.halfSize = HALF_SIZE;
    this.speed = SPEED;
    this.facing = 0;

    this.view = this._buildView();
    this._syncView();
  }

  _buildView() {
    const graphics = new Graphics();
    graphics.circle(0, 0, HALF_SIZE).fill(0x4ade80);
    graphics.poly([HALF_SIZE + 6, 0, HALF_SIZE - 4, -5, HALF_SIZE - 4, 5]).fill(0xdcfce7);
    return graphics;
  }

  update(deltaSeconds, moveVector, tilemap) {
    if (moveVector.x !== 0 || moveVector.y !== 0) {
      this.facing = Math.atan2(moveVector.y, moveVector.x);
    }

    moveAndCollide(
      this,
      moveVector.x * this.speed * deltaSeconds,
      moveVector.y * this.speed * deltaSeconds,
      tilemap,
    );

    this._syncView();
  }

  _syncView() {
    this.view.position.set(this.x, this.y);
    this.view.rotation = this.facing;
  }
}
