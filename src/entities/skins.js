/**
 * Player skins: cosmetic only, bought with stars. No Pixi imports: a skin is
 * a list of plain shapes, drawn top-down with the agent facing +x, so the
 * same data feeds the Pixi player (Player.js) and the SVG previews in the
 * skin screen.
 *
 * Shape: { type: 'circle' | 'ellipse' | 'rect' | 'poly', fill, alpha?, stroke?, width?, ... }
 *   circle  x, y, r          ellipse  x, y, rx, ry
 *   rect    x, y, w, h       poly     points [x0, y0, x1, y1, ...]
 * Keep shapes within ~12px of the centre (the nose wedge may reach 16).
 */
export const DEFAULT_SKIN = 'ninja';

const nose = (fill) => ({ type: 'poly', points: [16, 0, 9, -4, 9, 4], fill });
const shoulders = (fill, stroke) => ({ type: 'ellipse', x: -1, y: 0, rx: 7, ry: 10.5, fill, stroke, width: 1.5 });
const head = (fill, stroke) => ({ type: 'circle', x: 1, y: 0, r: 6, fill, stroke, width: 1 });

const ninjaShapes = (body, trim, hood, band, tip) => [
  { type: 'poly', points: [-4, -1, -12, -6, -10, -1], fill: band },
  { type: 'poly', points: [-4, 1, -13, 3, -10, 6], fill: band },
  nose(tip),
  shoulders(body, trim),
  head(hood),
  { type: 'rect', x: 1.5, y: -6, w: 2.5, h: 12, fill: band },
];

export const SKINS = [
  {
    id: 'ninja',
    name: 'Ninja',
    price: 0,
    blurb: 'The classic. Yours from the start.',
    shapes: ninjaShapes(0x2f3b52, 0x4ade80, 0x1b2333, 0xef4444, 0x4ade80),
  },
  {
    id: 'soldier',
    name: 'Soldier',
    price: 5,
    blurb: 'Helmet, pack, no nonsense.',
    shapes: [
      { type: 'rect', x: -11, y: -5, w: 5, h: 10, fill: 0x3f4a1c },
      nose(0xa3e635),
      shoulders(0x5b7f1e, 0x2a3a0c),
      head(0x3d5a14, 0x84cc16),
      { type: 'rect', x: 5, y: 5.5, w: 10, h: 2.2, fill: 0x1f2937 },
    ],
  },
  {
    id: 'spy',
    name: 'Spy',
    price: 10,
    blurb: 'Sharp suit, sharper hat.',
    shapes: [
      nose(0xe2e8f0),
      shoulders(0x273449, 0x94a3b8),
      { type: 'poly', points: [5, 0, 8, -1.6, 11, 0, 8, 1.6], fill: 0xdc2626 },
      { type: 'circle', x: 0, y: 0, r: 8.5, fill: 0x4b5563 },
      { type: 'circle', x: 0, y: 0, r: 5, fill: 0x1f2937, stroke: 0xdc2626, width: 1.2 },
    ],
  },
  {
    id: 'chef',
    name: 'Chef',
    price: 15,
    blurb: 'Somebody has to work the night shift.',
    shapes: [
      nose(0xf59e0b),
      shoulders(0xf1f5f9, 0x94a3b8),
      { type: 'circle', x: 5, y: -3, r: 0.9, fill: 0x475569 },
      { type: 'circle', x: 5, y: 3, r: 0.9, fill: 0x475569 },
      { type: 'circle', x: -1, y: -3.5, r: 4, fill: 0xffffff, stroke: 0xcbd5e1, width: 0.8 },
      { type: 'circle', x: -1, y: 3.5, r: 4, fill: 0xffffff, stroke: 0xcbd5e1, width: 0.8 },
      { type: 'circle', x: 2, y: 0, r: 4.5, fill: 0xffffff, stroke: 0xcbd5e1, width: 0.8 },
    ],
  },
  {
    id: 'ghost',
    name: 'Ghost',
    price: 20,
    blurb: 'Boo. (The guards can still see you.)',
    shapes: [
      { type: 'poly', points: [-2, -10, -14, -8, -9, -4, -15, 0, -9, 4, -14, 8, -2, 10], fill: 0xe0e7ff, alpha: 0.75 },
      { type: 'circle', x: 0, y: 0, r: 10, fill: 0xe0e7ff, alpha: 0.9, stroke: 0xa5b4fc, width: 1 },
      { type: 'ellipse', x: 5, y: -3.5, rx: 1.6, ry: 2.2, fill: 0x1e1b4b },
      { type: 'ellipse', x: 5, y: 3.5, rx: 1.6, ry: 2.2, fill: 0x1e1b4b },
    ],
  },
  {
    id: 'robot',
    name: 'Robot',
    price: 30,
    blurb: 'Stealth protocol engaged.',
    shapes: [
      nose(0x22d3ee),
      { type: 'rect', x: -9, y: -10, w: 15, h: 20, fill: 0x94a3b8, stroke: 0x38bdf8, width: 1.2 },
      { type: 'rect', x: -4, y: -5.5, w: 10, h: 11, fill: 0x64748b, stroke: 0x334155, width: 1 },
      { type: 'rect', x: 3.5, y: -4, w: 2.2, h: 8, fill: 0x22d3ee },
      { type: 'circle', x: -6, y: 0, r: 1.6, fill: 0xef4444 },
    ],
  },
  {
    id: 'astronaut',
    name: 'Astronaut',
    price: 40,
    blurb: 'One small step, very quietly.',
    shapes: [
      { type: 'rect', x: -12, y: -6, w: 5, h: 12, fill: 0x9ca3af, stroke: 0x6b7280, width: 1 },
      nose(0xf97316),
      shoulders(0xe5e7eb, 0xf97316),
      { type: 'circle', x: 1, y: 0, r: 7, fill: 0xf8fafc, stroke: 0x9ca3af, width: 1 },
      { type: 'ellipse', x: 4, y: 0, rx: 3.2, ry: 5, fill: 0x1d4ed8, stroke: 0xfbbf24, width: 1 },
    ],
  },
  {
    id: 'golden',
    name: 'Golden Agent',
    price: 60,
    blurb: 'Subtle? No. Earned? Absolutely.',
    shapes: ninjaShapes(0xfbbf24, 0xfef3c7, 0xd97706, 0xffffff, 0xfef08a),
  },
];

export function getSkin(id) {
  return SKINS.find((skin) => skin.id === id) ?? SKINS.find((skin) => skin.id === DEFAULT_SKIN);
}

const hex = (color) => `#${color.toString(16).padStart(6, '0')}`;

/** Inline SVG of a skin, facing up, for DOM previews. */
export function skinSvg(skin, size = 72) {
  const paint = (s) =>
    `fill="${hex(s.fill)}"${s.alpha !== undefined ? ` fill-opacity="${s.alpha}"` : ''}` +
    (s.stroke !== undefined ? ` stroke="${hex(s.stroke)}" stroke-width="${s.width ?? 1}"` : '');
  const parts = skin.shapes.map((s) => {
    if (s.type === 'circle') return `<circle cx="${s.x}" cy="${s.y}" r="${s.r}" ${paint(s)}/>`;
    if (s.type === 'ellipse') return `<ellipse cx="${s.x}" cy="${s.y}" rx="${s.rx}" ry="${s.ry}" ${paint(s)}/>`;
    if (s.type === 'rect') return `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" ${paint(s)}/>`;
    return `<polygon points="${s.points.join(' ')}" ${paint(s)}/>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="-20 -20 40 40"><g transform="rotate(-90)">${parts.join('')}</g></svg>`;
}
