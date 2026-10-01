import { Container, Graphics } from 'pixi.js';
import { paletteFor } from './palettes.js';
import { GridMap, Tile, TILE_SIZE } from './tiles.js';

const T = TILE_SIZE;
// Height of the wall face visible below a wall's top (the map is seen from slightly south of overhead).
const FACE = 9;
// Wall groups up to this many tiles are drawn as stacked furniture rather than masonry.
const MAX_CLUMP = 6;

/**
 * A GridMap with a Pixi view, drawn once when the level is built: textured
 * floors (the chapter palette picks slabs, planks, lab tiles or bare ground),
 * walls with a lit top and a darker front face that cast a shadow on the floor
 * below them, lone blocks as crates or machinery, foliage, snow and water.
 * Everything is placed from a hash of the tile position, so a level always looks the same.
 */
export class Tilemap extends GridMap {
  constructor(cols, rows, grid, palette = paletteFor(0)) {
    super(cols, rows, grid);
    this.palette = palette;
    this.view = this._render();
  }

  _kind(x, y) {
    return x < 0 || y < 0 || x >= this.cols || y >= this.rows ? Tile.WALL : this.grid[y][x];
  }

  _render() {
    this._clumps = this._clumpSizes();
    const view = new Container();
    const floor = new Graphics();
    const detail = new Graphics();
    const walls = new Graphics();
    view.addChild(floor, detail, walls);
    const c = this.palette;
    const dark = (alpha) => ({ color: 0x000000, alpha });

    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        const kind = this.grid[y][x];
        if (kind === Tile.WALL) continue;
        const px = x * T;
        const py = y * T;
        const h = hash(x, y);

        if (kind === Tile.WATER || kind === Tile.SHALLOW) this._water(floor, detail, x, y, h, kind === Tile.SHALLOW);
        else if (kind === Tile.SNOW) this._snow(floor, detail, x, y, h);
        else if (kind === Tile.BUSH) this._bush(floor, detail, px, py, h);
        else FLOORS[c.floorStyle](floor, detail, px, py, x, y, h, c);

        if (kind === Tile.SHADOW) detail.rect(px, py, T, T).fill({ color: c.shadow, alpha: 0.74 });

        // Walls throw a shadow onto the floor south and east of them, and darken every corner they make.
        if (this._kind(x, y - 1) === Tile.WALL) {
          detail.rect(px, py, T, 9).fill(dark(0.34));
          detail.rect(px, py + 9, T, 7).fill(dark(0.14));
        }
        if (this._kind(x - 1, y) === Tile.WALL) {
          detail.rect(px, py, 6, T).fill(dark(0.26));
          detail.rect(px + 6, py, 5, T).fill(dark(0.1));
        }
        if (this._kind(x + 1, y) === Tile.WALL) detail.rect(px + T - 4, py, 4, T).fill(dark(0.14));
        if (this._kind(x, y + 1) === Tile.WALL) detail.rect(px, py + T - 4, T, 4).fill(dark(0.14));
      }
    }

    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        if (this.grid[y][x] === Tile.WALL) this._wall(walls, x, y);
      }
    }
    return view;
  }

  /** For every wall tile, the size of the 4-connected group of walls it belongs to. */
  _clumpSizes() {
    const sizes = new Int32Array(this.cols * this.rows);
    const seen = new Uint8Array(this.cols * this.rows);
    for (let start = 0; start < sizes.length; start++) {
      if (seen[start] || this.grid[(start / this.cols) | 0][start % this.cols] !== Tile.WALL) continue;
      const group = [start];
      seen[start] = 1;
      for (let i = 0; i < group.length; i++) {
        const x = group[i] % this.cols;
        const y = (group[i] / this.cols) | 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= this.cols || ny >= this.rows) continue;
          const next = ny * this.cols + nx;
          if (seen[next] || this.grid[ny][nx] !== Tile.WALL) continue;
          seen[next] = 1;
          group.push(next);
        }
      }
      for (const index of group) sizes[index] = group.length;
    }
    return sizes;
  }

  _wall(g, x, y) {
    const c = this.palette;
    const px = x * T;
    const py = y * T;
    const h = hash(x * 3 + 1, y * 5 + 2);
    const open = (dx, dy) => this._kind(x + dx, y + dy) !== Tile.WALL;
    const n = open(0, -1);
    const s = open(0, 1);
    const w = open(-1, 0);
    const e = open(1, 0);
    const top = shade(c.wall, 0.95 + (h % 9) / 100);

    // Small free-standing clumps of wall are furniture: crates, cabinets, pillars.
    if (this._clumps[y * this.cols + x] <= MAX_CLUMP) {
      BLOCKS[c.blockStyle](g, px, py, h, c);
      return;
    }

    g.rect(px, py, T, T).fill(top);
    // Courses of masonry / panel seams, staggered row by row.
    const seam = { color: shade(c.wall, 0.62), alpha: 0.55 };
    g.rect(px, py + 15, T, 1).fill(seam);
    g.rect(px + (y % 2 ? 8 : 24), py, 1, 15).fill(seam);
    g.rect(px + (y % 2 ? 22 : 6), py + 16, 1, 16).fill(seam);
    if (h % 11 === 0) g.rect(px + 9, py + 5, 6, 4).fill({ color: shade(c.wall, 0.7), alpha: 0.7 });

    // Lit edges where the top meets open air, a darker face where the wall drops to the floor.
    if (n) g.rect(px, py, T, 2).fill({ color: c.wallEdge, alpha: 0.95 });
    if (w) g.rect(px, py, 2, T).fill({ color: c.wallEdge, alpha: 0.6 });
    if (e) g.rect(px + T - 2, py, 2, T).fill({ color: shade(c.wall, 0.6), alpha: 0.9 });
    if (s) {
      g.rect(px, py + T - FACE, T, FACE).fill(shade(c.wall, 0.52));
      g.rect(px, py + T - FACE, T, 1.5).fill({ color: c.wallEdge, alpha: 0.9 });
      g.rect(px + ((h >> 4) % 20) + 4, py + T - FACE + 3, 1, FACE - 4).fill({ color: 0x000000, alpha: 0.25 });
    }
  }

  _bush(floor, detail, px, py, h) {
    const c = this.palette;
    floor.rect(px, py, T, T).fill(shade(c.bushBase, 0.8));
    for (let i = 0; i < 6; i++) {
      const k = hash(h + i * 17, i * 29 + 3);
      const bx = px + 5 + (k % 23);
      const by = py + 5 + ((k >> 6) % 23);
      const r = 6 + ((k >> 12) % 5);
      detail.circle(bx + 2, by + 2.5, r).fill({ color: 0x000000, alpha: 0.28 });
      detail.circle(bx, by, r).fill(shade(c.bushLeaf, 0.8 + ((k >> 16) % 30) / 100));
      detail.circle(bx - r * 0.3, by - r * 0.35, r * 0.42).fill({ color: shade(c.bushLeaf, 1.45), alpha: 0.55 });
    }
  }

  _snow(floor, detail, x, y, h) {
    const c = this.palette;
    const px = x * T;
    const py = y * T;
    floor.rect(px, py, T, T).fill(shade(c.snowA, 0.96 + (h % 8) / 100));
    // A wind-blown drift and a couple of glints.
    const dx = px + 3 + (h % 12);
    const dy = py + 10 + ((h >> 5) % 14);
    detail.moveTo(dx, dy).quadraticCurveTo(dx + 9, dy - 5, dx + 18, dy).stroke({ width: 2, color: shade(c.snowA, 1.22), alpha: 0.5 });
    detail.moveTo(dx + 2, dy + 3).quadraticCurveTo(dx + 9, dy - 1, dx + 16, dy + 3).stroke({ width: 1.5, color: shade(c.snowA, 0.78), alpha: 0.4 });
    detail.circle(px + 4 + ((h >> 9) % 24), py + 4 + ((h >> 14) % 24), 1.2).fill(c.snowGlint);
    // Snow spills in soft lumps onto plowed ground next to it.
    for (const [ex, ey] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const other = this._kind(x + ex, y + ey);
      if (other === Tile.SNOW || other === Tile.WALL) continue;
      for (let i = 0; i < 3; i++) {
        const along = 5 + i * 11 + ((h >> (i * 3)) % 5);
        const cx = ex ? px + (ex > 0 ? T : 0) : px + along;
        const cy = ey ? py + (ey > 0 ? T : 0) : py + along;
        detail.circle(cx, cy, 5 + ((h >> (i + 7)) % 3)).fill(shade(c.snowA, 0.98));
      }
    }
  }

  _water(floor, detail, x, y, h, shallow) {
    const c = this.palette;
    const px = x * T;
    const py = y * T;
    const base = shallow ? c.shallowA : c.waterA;
    floor.rect(px, py, T, T).fill(shade(base, 0.93 + (h % 10) / 100));
    const crest = shallow ? c.shallowFleck : c.waterWave;
    for (let i = 0; i < 2; i++) {
      const k = hash(h + i, i * 31 + 7);
      const wx = px + 2 + (k % 16);
      const wy = py + 7 + i * 14 + ((k >> 6) % 6);
      detail.moveTo(wx, wy).quadraticCurveTo(wx + 6, wy - 3, wx + 12, wy).stroke({ width: 1.4, color: crest, alpha: shallow ? 0.45 : 0.7 });
    }
    if (shallow) detail.circle(px + 5 + ((h >> 8) % 22), py + 5 + ((h >> 13) % 22), 1.5).fill({ color: c.shallowFleck, alpha: 0.8 });
    // Foam along the bank, and the bank's shadow on deep water.
    for (const [ex, ey] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const other = this._kind(x + ex, y + ey);
      if (other === Tile.WATER || other === Tile.SHALLOW || other === Tile.WALL) continue;
      const foam = { color: shade(crest, 1.5), alpha: 0.5 };
      if (ex) detail.rect(ex > 0 ? px + T - 3 : px, py, 3, T).fill(foam);
      else detail.rect(px, ey > 0 ? py + T - 3 : py, T, 3).fill(foam);
    }
  }
}

// --- floors: (floor, detail, px, py, x, y, hash, palette) --------------------------------------------

const FLOORS = {
  /** Poured slabs two tiles wide: seams, the odd crack, drain or stain. */
  slab(f, d, px, py, x, y, h, c) {
    f.rect(px, py, T, T).fill(shade(c.floorA, 0.94 + (h % 11) / 100));
    const seam = { color: 0x000000, alpha: 0.3 };
    if (x % 2 === 0) d.rect(px, py, 1, T).fill(seam);
    if (y % 2 === 0) d.rect(px, py, T, 1).fill(seam);
    if (h % 19 === 0) {
      const cx = px + 6 + ((h >> 5) % 10);
      const cy = py + 5 + ((h >> 9) % 8);
      d.moveTo(cx, cy).lineTo(cx + 6, cy + 5).lineTo(cx + 4, cy + 12).lineTo(cx + 11, cy + 18).stroke({ width: 1, color: 0x000000, alpha: 0.4 });
    } else if (h % 43 === 1) {
      d.rect(px + 8, py + 10, 16, 12).fill({ color: 0x000000, alpha: 0.45 }).stroke({ width: 1, color: c.wallEdge, alpha: 0.5 });
      for (let i = 0; i < 3; i++) d.rect(px + 10, py + 12.5 + i * 3.4, 12, 1.2).fill({ color: c.wallEdge, alpha: 0.45 });
    } else if (h % 29 === 2) {
      d.ellipse(px + 16, py + 17, 9 + ((h >> 7) % 4), 6).fill({ color: 0x000000, alpha: 0.14 });
    }
  },

  /** Timber planks, four to a tile, with staggered joints and nail heads. */
  plank(f, d, px, py, x, y, h, c) {
    for (let i = 0; i < 4; i++) {
      const k = hash(x * 4 + i, y * 9 + i * 3);
      f.rect(px, py + i * 8, T, 8).fill(shade(c.floorA, 0.88 + (k % 20) / 100));
      d.rect(px, py + i * 8, T, 1).fill({ color: 0x000000, alpha: 0.32 });
      if (k % 3 === 0) {
        const jx = px + 3 + ((k >> 4) % 26);
        d.rect(jx, py + i * 8, 1, 8).fill({ color: 0x000000, alpha: 0.38 });
        d.circle(jx - 2, py + i * 8 + 4, 0.8).fill({ color: 0x000000, alpha: 0.5 });
        d.circle(jx + 3, py + i * 8 + 4, 0.8).fill({ color: 0x000000, alpha: 0.5 });
      }
    }
    if (h % 37 === 0) d.ellipse(px + 15, py + 18, 10, 6).fill({ color: 0x000000, alpha: 0.16 });
  },

  /** Clean square tiles with pale grout and a faint sheen. */
  lab(f, d, px, py, x, y, h, c) {
    f.rect(px, py, T, T).fill(shade(c.floorA, 0.97 + (h % 6) / 100));
    const grout = { color: c.wallEdge, alpha: 0.2 };
    d.rect(px, py, T, 1).fill(grout);
    d.rect(px, py, 1, T).fill(grout);
    if ((x + y) % 2 === 0) d.poly([px + 4, py + 2, px + 12, py + 2, px + 2, py + 12, px + 2, py + 4]).fill({ color: 0xffffff, alpha: 0.025 });
    if (h % 47 === 0) {
      d.circle(px + 16, py + 16, 5).fill({ color: 0x000000, alpha: 0.4 }).stroke({ width: 1, color: c.wallEdge, alpha: 0.5 });
      d.rect(px + 12, py + 15.4, 8, 1.2).fill({ color: c.wallEdge, alpha: 0.5 });
    }
  },

  /** Bare earth or lawn: mottled, with pebbles and tufts of grass. */
  ground(f, d, px, py, x, y, h, c) {
    // Barely varied per tile (a visible grid would read as paving); the mottling comes from soft patches instead.
    f.rect(px, py, T, T).fill(shade(c.floorA, 0.97 + (h % 5) / 100));
    if (h % 2) d.ellipse(px + 6 + ((h >> 3) % 20), py + 6 + ((h >> 8) % 20), 11 + ((h >> 13) % 6), 8).fill({ color: h % 4 === 1 ? 0x000000 : 0xffffff, alpha: h % 4 === 1 ? 0.1 : 0.03 });
    for (let i = 0; i < 3; i++) {
      const k = hash(h + i * 5, i + 11);
      d.circle(px + 3 + (k % 26), py + 3 + ((k >> 6) % 26), 1 + ((k >> 12) % 2)).fill({ color: i ? 0x000000 : 0xffffff, alpha: i ? 0.22 : 0.07 });
    }
    if (h % 3 === 0) {
      const tx = px + 6 + ((h >> 4) % 20);
      const ty = py + 10 + ((h >> 9) % 18);
      const blade = { width: 1.2, color: shade(c.bushLeaf, 1.15), alpha: 0.6 };
      d.moveTo(tx, ty).lineTo(tx - 2, ty - 5).stroke(blade);
      d.moveTo(tx + 1, ty).lineTo(tx + 1.5, ty - 6).stroke(blade);
      d.moveTo(tx + 2, ty).lineTo(tx + 5, ty - 4).stroke(blade);
    }
  },
};

// --- lone wall tiles: (walls, px, py, hash, palette) -------------------------------------------------

const BLOCKS = {
  /** A wooden shipping crate: boards, a frame and cross braces. */
  crate(g, px, py, h, c) {
    const wood = shade(c.wall, 1.12 + (h % 10) / 100);
    g.rect(px + 1, py + 1, T - 2, T - 2).fill(wood);
    for (let i = 1; i < 4; i++) g.rect(px + 1, py + i * 8, T - 2, 1).fill({ color: 0x000000, alpha: 0.25 });
    const brace = { width: 2.5, color: shade(c.wall, 0.72) };
    g.moveTo(px + 4, py + 4).lineTo(px + T - 4, py + T - FACE - 2).stroke(brace);
    g.moveTo(px + T - 4, py + 4).lineTo(px + 4, py + T - FACE - 2).stroke(brace);
    g.rect(px + 1, py + 1, T - 2, T - 2).stroke({ width: 2.5, color: shade(c.wall, 0.72) });
    g.rect(px + 1, py + T - FACE, T - 2, FACE - 1).fill(shade(c.wall, 0.5));
    g.rect(px + 1, py + 1, T - 2, 2).fill({ color: c.wallEdge, alpha: 0.9 });
  },

  /** A cabinet of equipment: vents and a row of status lights. */
  unit(g, px, py, h, c) {
    g.rect(px + 1, py + 1, T - 2, T - 2).fill(shade(c.wall, 0.9)).stroke({ width: 1.5, color: shade(c.wall, 0.55) });
    g.rect(px + 5, py + 5, T - 10, T - FACE - 9).fill(shade(c.wall, 0.62));
    for (let i = 0; i < 3; i++) g.rect(px + 7, py + 8 + i * 4, T - 14, 1.4).fill({ color: c.wallEdge, alpha: 0.7 });
    g.rect(px + 1, py + T - FACE, T - 2, FACE - 1).fill(shade(c.wall, 0.48));
    for (let i = 0; i < 3; i++) {
      g.circle(px + 8 + i * 5, py + T - FACE + 4, 1.2).fill((h >> i) & 1 ? 0x6fae7a : 0xb9863e);
    }
    g.rect(px + 1, py + 1, T - 2, 2).fill({ color: c.wallEdge, alpha: 0.9 });
  },

  /** A square pillar with a cap. */
  pillar(g, px, py, h, c) {
    g.rect(px, py, T, T).fill(shade(c.wall, 0.86));
    g.rect(px + 4, py + 3, T - 8, T - FACE - 6).fill(shade(c.wall, 1.08)).stroke({ width: 1, color: c.wallEdge, alpha: 0.8 });
    g.rect(px, py + T - FACE, T, FACE).fill(shade(c.wall, 0.5));
    g.rect(px, py, T, 2).fill({ color: c.wallEdge, alpha: 0.9 });
    if (h % 2) g.rect(px + 9, py + T - FACE + 3, 1, FACE - 4).fill({ color: 0x000000, alpha: 0.3 });
  },
};

/** Multiplies a colour's channels by `f` (clamped): darker below 1, lighter above. */
function shade(color, f) {
  const ch = (shift) => Math.min(255, Math.round(((color >> shift) & 255) * f));
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

function hash(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}
