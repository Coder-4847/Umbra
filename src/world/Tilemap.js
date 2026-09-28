import { Graphics } from 'pixi.js';
import { GridMap, Tile, TILE_SIZE } from './tiles.js';

const FLOOR_A = 0x1b1b24;
const FLOOR_B = 0x1f1f2a;
const WALL = 0x33323f;
const WALL_EDGE = 0x45434f;
const BUSH_BASE = 0x1c3326;
const BUSH_LEAF = 0x28523a;
const SHADOW = 0x0d0d13;
// Moonlit snow: bright enough to read footprints on, dim enough that vision cones still show.
const SNOW_A = 0x6c7788;
const SNOW_B = 0x687384;
const SNOW_GLINT = 0x94a0b2;
// Night water: deep is dark and still-looking, shallows are lighter so the wading line reads at a glance.
const WATER_A = 0x0f2a40;
const WATER_B = 0x102c43;
const WATER_WAVE = 0x22506f;
const SHALLOW_A = 0x1d4a5a;
const SHALLOW_B = 0x1f4d5e;
const SHALLOW_FLECK = 0x3f7a8a;

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
          case Tile.SNOW: {
            graphics.rect(px, py, TILE_SIZE, TILE_SIZE).fill((x + y) % 2 === 0 ? SNOW_A : SNOW_B);
            const h = hash(x * 11, y * 17);
            graphics.circle(px + 4 + (h % 24), py + 4 + ((h >> 6) % 24), 1.2).fill(SNOW_GLINT);
            break;
          }
          case Tile.WATER: {
            graphics.rect(px, py, TILE_SIZE, TILE_SIZE).fill((x + y) % 2 === 0 ? WATER_A : WATER_B);
            // A short wave crest per tile, placed deterministically.
            const h = hash(x * 5, y * 19);
            const wx = px + 5 + (h % 16);
            const wy = py + 8 + ((h >> 6) % 16);
            graphics.moveTo(wx, wy).quadraticCurveTo(wx + 5, wy - 3, wx + 10, wy).stroke({ width: 1.5, color: WATER_WAVE });
            break;
          }
          case Tile.SHALLOW: {
            graphics.rect(px, py, TILE_SIZE, TILE_SIZE).fill((x + y) % 2 === 0 ? SHALLOW_A : SHALLOW_B);
            for (let i = 0; i < 2; i++) {
              const h = hash(x * 9 + i, y * 23 + i);
              graphics.circle(px + 4 + (h % 24), py + 4 + ((h >> 7) % 24), 1.4).fill(SHALLOW_FLECK);
            }
            break;
          }
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
