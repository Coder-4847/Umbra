import { Graphics } from 'pixi.js';
import { GridMap, Tile, TILE_SIZE } from './tiles.js';

const FLOOR_A = 0x1b1b24;
const FLOOR_B = 0x1f1f2a;
const WALL = 0x33323f;
const WALL_EDGE = 0x45434f;
const BUSH_BASE = 0x1c3326;
const BUSH_LEAF = 0x28523a;
const SHADOW = 0x0d0d13;

/** A GridMap with a Pixi view. Per-chapter tilesets replace these placeholder colors later. */
export class Tilemap extends GridMap {
  constructor(cols, rows, grid) {
    super(cols, rows, grid);
    this.view = this._render();
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
}

function hash(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}
