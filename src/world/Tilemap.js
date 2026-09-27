import { Graphics } from 'pixi.js';

export const TILE_SIZE = 32;

const FLOOR_A = 0x1b1b24;
const FLOOR_B = 0x1f1f2a;
const WALL = 0x33323f;
const WALL_EDGE = 0x45434f;

/**
 * A placeholder tile-based map: a border of walls, a few interior obstacles,
 * and a checkerboard floor so camera movement is easy to read visually.
 * Phase 4 replaces the hardcoded grid with a JSON-driven level format.
 */
export class Tilemap {
  constructor(cols = 60, rows = 40) {
    this.cols = cols;
    this.rows = rows;
    this.grid = this._buildGrid(cols, rows);
    this.view = this._render();
  }

  _buildGrid(cols, rows) {
    const grid = Array.from({ length: rows }, () => new Array(cols).fill(0));

    for (let x = 0; x < cols; x++) {
      grid[0][x] = 1;
      grid[rows - 1][x] = 1;
    }
    for (let y = 0; y < rows; y++) {
      grid[y][0] = 1;
      grid[y][cols - 1] = 1;
    }

    const obstacles = [
      [10, 8, 4, 3],
      [20, 15, 3, 6],
      [30, 6, 6, 2],
      [40, 20, 4, 4],
      [15, 25, 8, 2],
      [45, 10, 2, 8],
    ];
    for (const [ox, oy, w, h] of obstacles) {
      for (let y = oy; y < oy + h; y++) {
        for (let x = ox; x < ox + w; x++) {
          if (y > 0 && y < rows - 1 && x > 0 && x < cols - 1) {
            grid[y][x] = 1;
          }
        }
      }
    }

    return grid;
  }

  _render() {
    const graphics = new Graphics();
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        const solid = this.grid[y][x] === 1;
        const px = x * TILE_SIZE;
        const py = y * TILE_SIZE;
        if (solid) {
          graphics.rect(px, py, TILE_SIZE, TILE_SIZE).fill(WALL).stroke({ width: 1, color: WALL_EDGE });
        } else {
          const color = (x + y) % 2 === 0 ? FLOOR_A : FLOOR_B;
          graphics.rect(px, py, TILE_SIZE, TILE_SIZE).fill(color);
        }
      }
    }
    return graphics;
  }

  isSolid(tileX, tileY) {
    if (tileX < 0 || tileY < 0 || tileX >= this.cols || tileY >= this.rows) return true;
    return this.grid[tileY][tileX] === 1;
  }

  isSolidAtWorld(x, y) {
    return this.isSolid(Math.floor(x / TILE_SIZE), Math.floor(y / TILE_SIZE));
  }

  get pixelWidth() {
    return this.cols * TILE_SIZE;
  }

  get pixelHeight() {
    return this.rows * TILE_SIZE;
  }
}
