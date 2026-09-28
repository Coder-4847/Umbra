export const TILE_SIZE = 32;

export const Tile = Object.freeze({
  FLOOR: 0,
  WALL: 1,
  BUSH: 2,
  SHADOW: 3,
  SNOW: 4,
});

export function tileCenter(tx, ty) {
  return { x: (tx + 0.5) * TILE_SIZE, y: (ty + 0.5) * TILE_SIZE };
}

/**
 * Renderer-free tile grid: collision, sight lines and pathfinding only need
 * this, so the level validator and editor can use them without Pixi.
 * Bushes and shadows are walkable and don't block sight; they hide what's inside.
 * Snow is walkable open ground that records footprints.
 */
export class GridMap {
  constructor(cols, rows, grid) {
    this.cols = cols;
    this.rows = rows;
    this.grid = grid;
  }

  tileAtWorld(x, y) {
    const tx = Math.floor(x / TILE_SIZE);
    const ty = Math.floor(y / TILE_SIZE);
    if (tx < 0 || ty < 0 || tx >= this.cols || ty >= this.rows) return Tile.WALL;
    return this.grid[ty][tx];
  }

  isSolid(tileX, tileY) {
    if (tileX < 0 || tileY < 0 || tileX >= this.cols || tileY >= this.rows) return true;
    return this.grid[tileY][tileX] === Tile.WALL;
  }

  isSolidAtWorld(x, y) {
    return this.isSolid(Math.floor(x / TILE_SIZE), Math.floor(y / TILE_SIZE));
  }

  isConcealingAtWorld(x, y) {
    const tile = this.tileAtWorld(x, y);
    return tile === Tile.BUSH || tile === Tile.SHADOW;
  }

  isSnowAtWorld(x, y) {
    return this.tileAtWorld(x, y) === Tile.SNOW;
  }

  get pixelWidth() {
    return this.cols * TILE_SIZE;
  }

  get pixelHeight() {
    return this.rows * TILE_SIZE;
  }
}
