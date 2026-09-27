import { Graphics } from 'pixi.js';

export const TILE_SIZE = 32;

export const Tile = Object.freeze({
  FLOOR: 0,
  WALL: 1,
  BUSH: 2,
  SHADOW: 3,
});

export function tileCenter(tx, ty) {
  return { x: (tx + 0.5) * TILE_SIZE, y: (ty + 0.5) * TILE_SIZE };
}

const FLOOR_A = 0x1b1b24;
const FLOOR_B = 0x1f1f2a;
const WALL = 0x33323f;
const WALL_EDGE = 0x45434f;
const BUSH_BASE = 0x1c3326;
const BUSH_LEAF = 0x28523a;
const SHADOW = 0x0d0d13;

/**
 * A placeholder tile-based map: a border of walls, a few interior obstacles,
 * concealment patches (bushes, shadows), and a checkerboard floor so camera
 * movement is easy to read. Phase 4 replaces the hardcoded grid with a
 * JSON-driven level format.
 *
 * Bushes and shadows are walkable and don't block sight lines; they hide
 * whatever is standing (or lying) inside them.
 */
export class Tilemap {
  constructor(cols = 60, rows = 40) {
    this.cols = cols;
    this.rows = rows;
    this.grid = this._buildGrid(cols, rows);
    this.view = this._render();
  }

  _buildGrid(cols, rows) {
    const grid = Array.from({ length: rows }, () => new Array(cols).fill(Tile.FLOOR));
    const fill = (ox, oy, w, h, tile) => {
      for (let y = oy; y < oy + h; y++) {
        for (let x = ox; x < ox + w; x++) {
          if (y > 0 && y < rows - 1 && x > 0 && x < cols - 1) grid[y][x] = tile;
        }
      }
    };

    for (let x = 0; x < cols; x++) {
      grid[0][x] = Tile.WALL;
      grid[rows - 1][x] = Tile.WALL;
    }
    for (let y = 0; y < rows; y++) {
      grid[y][0] = Tile.WALL;
      grid[y][cols - 1] = Tile.WALL;
    }

    const obstacles = [
      [10, 8, 4, 3],
      [20, 15, 3, 6],
      [30, 6, 6, 2],
      [40, 20, 4, 4],
      [15, 25, 8, 2],
      [45, 10, 2, 8],
    ];
    for (const [x, y, w, h] of obstacles) fill(x, y, w, h, Tile.WALL);

    const bushes = [
      [8, 15, 3, 2],
      [26, 16, 2, 3],
      [36, 27, 3, 2],
      [52, 12, 2, 2],
    ];
    for (const [x, y, w, h] of bushes) fill(x, y, w, h, Tile.BUSH);

    const shadows = [
      [26, 9, 3, 4],
      [24, 31, 4, 3],
    ];
    for (const [x, y, w, h] of shadows) fill(x, y, w, h, Tile.SHADOW);

    return grid;
  }

  _render() {
    const graphics = new Graphics();
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        const px = x * TILE_SIZE;
        const py = y * TILE_SIZE;
        switch (this.grid[y][x]) {
          case Tile.WALL:
            graphics.rect(px, py, TILE_SIZE, TILE_SIZE).fill(WALL).stroke({ width: 1, color: WALL_EDGE });
            break;
          case Tile.BUSH:
            graphics.rect(px, py, TILE_SIZE, TILE_SIZE).fill(BUSH_BASE);
            // Deterministic per-tile leaf clusters so bushes don't look like flat squares.
            for (let i = 0; i < 3; i++) {
              const h = hash(x * 7 + i, y * 13 + i);
              graphics
                .circle(px + 6 + (h % 20), py + 6 + ((h >> 5) % 20), 7 + ((h >> 10) % 4))
                .fill(BUSH_LEAF);
            }
            break;
          case Tile.SHADOW:
            graphics.rect(px, py, TILE_SIZE, TILE_SIZE).fill(SHADOW);
            break;
          default:
            graphics.rect(px, py, TILE_SIZE, TILE_SIZE).fill((x + y) % 2 === 0 ? FLOOR_A : FLOOR_B);
        }
      }
    }
    return graphics;
  }

  isSolid(tileX, tileY) {
    if (tileX < 0 || tileY < 0 || tileX >= this.cols || tileY >= this.rows) return true;
    return this.grid[tileY][tileX] === Tile.WALL;
  }

  isSolidAtWorld(x, y) {
    return this.isSolid(Math.floor(x / TILE_SIZE), Math.floor(y / TILE_SIZE));
  }

  isConcealingAtWorld(x, y) {
    const tx = Math.floor(x / TILE_SIZE);
    const ty = Math.floor(y / TILE_SIZE);
    if (tx < 0 || ty < 0 || tx >= this.cols || ty >= this.rows) return false;
    const tile = this.grid[ty][tx];
    return tile === Tile.BUSH || tile === Tile.SHADOW;
  }

  get pixelWidth() {
    return this.cols * TILE_SIZE;
  }

  get pixelHeight() {
    return this.rows * TILE_SIZE;
  }
}

function hash(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}
