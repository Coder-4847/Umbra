export const TILE_SIZE = 32;

export const Tile = Object.freeze({
  FLOOR: 0,
  WALL: 1,
  BUSH: 2,
  SHADOW: 3,
  SNOW: 4,
  WATER: 5,
  SHALLOW: 6,
});

export function tileCenter(tx, ty) {
  return { x: (tx + 0.5) * TILE_SIZE, y: (ty + 0.5) * TILE_SIZE };
}

/**
 * Renderer-free tile grid: collision, sight lines and pathfinding only need
 * this, so the level validator and editor can use them without Pixi.
 * Bushes and shadows are walkable and don't block sight; they hide what's inside.
 * Snow is walkable open ground that records footprints.
 * Deep water can't be walked on but sight, sound and bullets cross it, so it
 * belongs to the floor around it: `isSolid` (walls) is for sight, `isBlocked`
 * (walls + deep water) for movement. Shallow water is walkable, slow and noisy.
 * Closed gates are barred: they block movement like a wall but, like water, not
 * sight or sound, so they don't split a floor either.
 */
export class GridMap {
  constructor(cols, rows, grid) {
    this.cols = cols;
    this.rows = rows;
    this.grid = grid;
    /** Stairs/elevators: Map of tile index -> tile index, both directions. Used by pathfinding. */
    this.links = null;
    /** Tile indices barred by closed gates (see setGateTiles). */
    this.barred = null;
  }

  /** Marks tiles as barred (a closed gate) or clears them again (opened). */
  setGateTiles(tiles, closed) {
    this.barred ??= new Set();
    for (const { tx, ty } of tiles) {
      const index = ty * this.cols + tx;
      if (closed) this.barred.add(index);
      else this.barred.delete(index);
    }
  }

  /** @param links {{ tx1, ty1, tx2, ty2 }[]} */
  setLinks(links) {
    this.links = new Map();
    for (const { tx1, ty1, tx2, ty2 } of links) {
      const a = ty1 * this.cols + tx1;
      const b = ty2 * this.cols + tx2;
      this.links.set(a, b);
      this.links.set(b, a);
    }
  }

  /**
   * Floor id for every tile: open tiles (water included) that connect without
   * stairs or elevators share an id; walls are -1. A single-floor map is all 0.
   */
  computeFloors() {
    const { cols, rows } = this;
    const floors = new Int32Array(cols * rows).fill(-1);
    let next = 0;
    for (let start = 0; start < floors.length; start++) {
      const sx = start % cols;
      if (floors[start] !== -1 || this.isSolid(sx, (start - sx) / cols)) continue;
      const stack = [start];
      floors[start] = next;
      while (stack.length) {
        const i = stack.pop();
        const x = i % cols;
        const y = (i - x) / cols;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx;
          const ny = y + dy;
          if (this.isSolid(nx, ny)) continue;
          const n = ny * cols + nx;
          if (floors[n] !== -1) continue;
          floors[n] = next;
          stack.push(n);
        }
      }
      next++;
    }
    return floors;
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

  /** Can't be walked through: walls, deep water and closed gates. */
  isBlocked(tileX, tileY) {
    if (tileX < 0 || tileY < 0 || tileX >= this.cols || tileY >= this.rows) return true;
    if (this.barred?.has(tileY * this.cols + tileX)) return true;
    const tile = this.grid[tileY][tileX];
    return tile === Tile.WALL || tile === Tile.WATER;
  }

  isBlockedAtWorld(x, y) {
    return this.isBlocked(Math.floor(x / TILE_SIZE), Math.floor(y / TILE_SIZE));
  }

  isWater(tileX, tileY) {
    if (tileX < 0 || tileY < 0 || tileX >= this.cols || tileY >= this.rows) return false;
    return this.grid[tileY][tileX] === Tile.WATER;
  }

  isWaterAtWorld(x, y) {
    return this.tileAtWorld(x, y) === Tile.WATER;
  }

  isShallowAtWorld(x, y) {
    return this.tileAtWorld(x, y) === Tile.SHALLOW;
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
