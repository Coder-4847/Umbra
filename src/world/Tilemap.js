import { Graphics } from 'pixi.js';
import { paletteFor } from './palettes.js';
import { GridMap, Tile, TILE_SIZE } from './tiles.js';

/** A GridMap with a Pixi view, coloured by a chapter palette (palettes.js). */
export class Tilemap extends GridMap {
  constructor(cols, rows, grid, palette = paletteFor(0)) {
    super(cols, rows, grid);
    this.palette = palette;
    this.view = this._render();
  }

  _render() {
    const graphics = new Graphics();
    const c = this.palette;
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        const px = x * TILE_SIZE;
        const py = y * TILE_SIZE;
        switch (this.grid[y][x]) {
          case Tile.WALL:
            graphics.rect(px, py, TILE_SIZE, TILE_SIZE).fill(c.wall).stroke({ width: 1, color: c.wallEdge });
            break;
          case Tile.BUSH:
            graphics.rect(px, py, TILE_SIZE, TILE_SIZE).fill(c.bushBase);
            // Deterministic per-tile leaf clusters so bushes don't look like flat squares.
            for (let i = 0; i < 3; i++) {
              const h = hash(x * 7 + i, y * 13 + i);
              graphics
                .circle(px + 6 + (h % 20), py + 6 + ((h >> 5) % 20), 7 + ((h >> 10) % 4))
                .fill(c.bushLeaf);
            }
            break;
          case Tile.SHADOW:
            graphics.rect(px, py, TILE_SIZE, TILE_SIZE).fill(c.shadow);
            break;
          case Tile.SNOW: {
            graphics.rect(px, py, TILE_SIZE, TILE_SIZE).fill((x + y) % 2 === 0 ? c.snowA : c.snowB);
            const h = hash(x * 11, y * 17);
            graphics.circle(px + 4 + (h % 24), py + 4 + ((h >> 6) % 24), 1.2).fill(c.snowGlint);
            break;
          }
          case Tile.WATER: {
            graphics.rect(px, py, TILE_SIZE, TILE_SIZE).fill((x + y) % 2 === 0 ? c.waterA : c.waterB);
            // A short wave crest per tile, placed deterministically.
            const h = hash(x * 5, y * 19);
            const wx = px + 5 + (h % 16);
            const wy = py + 8 + ((h >> 6) % 16);
            graphics.moveTo(wx, wy).quadraticCurveTo(wx + 5, wy - 3, wx + 10, wy).stroke({ width: 1.5, color: c.waterWave });
            break;
          }
          case Tile.SHALLOW: {
            graphics.rect(px, py, TILE_SIZE, TILE_SIZE).fill((x + y) % 2 === 0 ? c.shallowA : c.shallowB);
            for (let i = 0; i < 2; i++) {
              const h = hash(x * 9 + i, y * 23 + i);
              graphics.circle(px + 4 + (h % 24), py + 4 + ((h >> 7) % 24), 1.4).fill(c.shallowFleck);
            }
            break;
          }
          default:
            graphics.rect(px, py, TILE_SIZE, TILE_SIZE).fill((x + y) % 2 === 0 ? c.floorA : c.floorB);
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
