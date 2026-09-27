import { Graphics } from 'pixi.js';
import { TILE_SIZE } from '../world/Tilemap.js';

const HALF_SIZE = 10;
const SPEED = 180;

/**
 * 8-directional player entity with axis-separated AABB collision against
 * the tilemap, resolved one axis at a time so it slides along walls
 * instead of stopping dead on diagonal contact.
 */
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

    this.x += moveVector.x * this.speed * deltaSeconds;
    this._resolveAxis('x', tilemap);

    this.y += moveVector.y * this.speed * deltaSeconds;
    this._resolveAxis('y', tilemap);

    this._syncView();
  }

  _resolveAxis(axis, tilemap) {
    const half = this.halfSize;
    const minTileX = Math.floor((this.x - half) / TILE_SIZE);
    const maxTileX = Math.floor((this.x + half) / TILE_SIZE);
    const minTileY = Math.floor((this.y - half) / TILE_SIZE);
    const maxTileY = Math.floor((this.y + half) / TILE_SIZE);

    for (let ty = minTileY; ty <= maxTileY; ty++) {
      for (let tx = minTileX; tx <= maxTileX; tx++) {
        if (!tilemap.isSolid(tx, ty)) continue;

        const tileLeft = tx * TILE_SIZE;
        const tileRight = tileLeft + TILE_SIZE;
        const tileTop = ty * TILE_SIZE;
        const tileBottom = tileTop + TILE_SIZE;

        const overlapX = Math.min(this.x + half, tileRight) - Math.max(this.x - half, tileLeft);
        const overlapY = Math.min(this.y + half, tileBottom) - Math.max(this.y - half, tileTop);
        if (overlapX <= 0 || overlapY <= 0) continue;

        if (axis === 'x') {
          const tileCenterX = tileLeft + TILE_SIZE / 2;
          this.x += this.x < tileCenterX ? -overlapX : overlapX;
        } else {
          const tileCenterY = tileTop + TILE_SIZE / 2;
          this.y += this.y < tileCenterY ? -overlapY : overlapY;
        }
      }
    }
  }

  _syncView() {
    this.view.position.set(this.x, this.y);
    this.view.rotation = this.facing;
  }
}
