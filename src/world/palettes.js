/**
 * Tile colours per chapter. No Pixi imports. Every palette is dark and muted
 * so vision cones, guards and the player stay the brightest things on screen;
 * chapters differ in hue and in how warm the walls are.
 */
const BASE = {
  // How Tilemap draws floors ('slab' | 'plank' | 'lab' | 'ground') and lone wall tiles ('pillar' | 'crate' | 'unit').
  floorStyle: 'slab',
  blockStyle: 'pillar',
  background: 0x0b0c0e,
  floorA: 0x1b1b24,
  floorB: 0x1f1f2a,
  wall: 0x33323f,
  wallEdge: 0x45434f,
  bushBase: 0x1c3326,
  bushLeaf: 0x28523a,
  shadow: 0x0d0d13,
  // Moonlit snow: light enough to read footprints on, dim enough that vision cones still show.
  snowA: 0x4b5563,
  snowB: 0x475160,
  snowGlint: 0x748092,
  // Night water: deep is dark and still-looking, shallows are lighter so the wading line reads at a glance.
  waterA: 0x0f2a40,
  waterB: 0x102c43,
  waterWave: 0x22506f,
  shallowA: 0x1d4a5a,
  shallowB: 0x1f4d5e,
  shallowFleck: 0x3f7a8a,
};

const CHAPTERS = {
  // Urban Rooftops: slate under a city sky
  1: { background: 0x0a0c11, floorA: 0x1c1f28, floorB: 0x20232d, wall: 0x363a48, wallEdge: 0x4c5163 },
  // Warehouse District: rust and timber
  2: { floorStyle: 'plank', blockStyle: 'crate', background: 0x0e0c0a, floorA: 0x231f1b, floorB: 0x27231e, wall: 0x46392d, wallEdge: 0x5e4d3c, shadow: 0x100e0c },
  // Research Facility: cold clinical teal
  3: { floorStyle: 'lab', blockStyle: 'unit', background: 0x090d0e, floorA: 0x1a2326, floorB: 0x1d272b, wall: 0x33474c, wallEdge: 0x4a6168, shadow: 0x0b1012 },
  // Snowbound Base: plowed concrete between snowfields
  4: { background: 0x0b0d10, floorA: 0x1e232b, floorB: 0x222830, wall: 0x262c36, wallEdge: 0x3f4958 },
  // Jungle Outpost: mud and bamboo
  5: { floorStyle: 'ground', blockStyle: 'crate', background: 0x0a0d09, floorA: 0x1c2219, floorB: 0x20261c, wall: 0x3c3b27, wallEdge: 0x545236, bushBase: 0x1e3a22, bushLeaf: 0x2f5e34, shadow: 0x0c100b },
  // Underground Bunker: raw concrete
  6: { blockStyle: 'unit', background: 0x0b0c0b, floorA: 0x1e201d, floorB: 0x222421, wall: 0x3d403a, wallEdge: 0x565a50, shadow: 0x0d0e0c },
  // Skyscraper Heist: navy carpet and glass
  7: { floorStyle: 'lab', blockStyle: 'unit', background: 0x080a12, floorA: 0x181c2a, floorB: 0x1c2030, wall: 0x2f3a5c, wallEdge: 0x47568a },
  // Private Estate: lawns and stonework
  8: { floorStyle: 'ground', background: 0x090d0a, floorA: 0x1a251c, floorB: 0x1d2a20, wall: 0x4a4640, wallEdge: 0x66605a, bushBase: 0x1d3d26, bushLeaf: 0x2b5a37, shadow: 0x0b100c },
  // Night Harbor: wet planks and steel
  9: { floorStyle: 'plank', blockStyle: 'crate', background: 0x08090c, floorA: 0x201f22, floorB: 0x242326, wall: 0x3b4049, wallEdge: 0x535a66 },
  // Black Site: charcoal with rust-red steel
  10: { blockStyle: 'crate', background: 0x0b0809, floorA: 0x1a1719, floorB: 0x1e1a1d, wall: 0x41292d, wallEdge: 0x603c41, shadow: 0x0c0a0b },
};

const lift = (color, f) =>
  (Math.min(255, Math.round(((color >> 16) & 255) * f)) << 16) |
  (Math.min(255, Math.round(((color >> 8) & 255) * f)) << 8) |
  Math.min(255, Math.round((color & 255) * f));

export function paletteFor(chapter) {
  const palette = { ...BASE, ...(CHAPTERS[chapter] ?? {}) };
  // Floors carry texture now (seams, planks, grout): a little more light so it reads, still well under the cones.
  palette.floorA = lift(palette.floorA, 1.3);
  palette.floorB = lift(palette.floorB, 1.3);
  palette.bushLeaf = lift(palette.bushLeaf, 0.88);
  return palette;
}
