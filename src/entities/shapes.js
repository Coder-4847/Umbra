/**
 * Figures as plain shape lists (the same format as skins.js), drawn top-down
 * facing +x. No Pixi imports: `drawShapes` takes any Pixi Graphics.
 *
 * Shape: { type: 'circle' | 'ellipse' | 'rect' | 'poly', fill, alpha?, stroke?, width?, ... }
 */
export function drawShapes(graphics, shapes, scale = 1) {
  const k = scale;
  for (const s of shapes) {
    if (s.type === 'circle') graphics.circle(s.x * k, s.y * k, s.r * k);
    else if (s.type === 'ellipse') graphics.ellipse(s.x * k, s.y * k, s.rx * k, s.ry * k);
    else if (s.type === 'rect') graphics.rect(s.x * k, s.y * k, s.w * k, s.h * k);
    else graphics.poly(s.points.map((p) => p * k));
    graphics.fill({ color: s.fill, alpha: s.alpha ?? 1 });
    if (s.stroke !== undefined) graphics.stroke({ color: s.stroke, width: (s.width ?? 1) * k });
  }
}

const guard = (uniform, edge, vest, cap, brim, light) => [
  { type: 'rect', x: 4, y: 4.6, w: 11, h: 2.4, fill: 0x14171c }, // rifle, carried on the right
  { type: 'poly', points: [16, 0, 10, -3.4, 10, 3.4], fill: light }, // which way it faces
  { type: 'ellipse', x: -1, y: 0, rx: 7, ry: 10.5, fill: uniform, stroke: edge, width: 1.5 },
  { type: 'rect', x: -5, y: -5, w: 7, h: 10, fill: vest },
  { type: 'poly', points: [4.5, -4.6, 9, -3, 9, 3, 4.5, 4.6], fill: brim },
  { type: 'circle', x: 1, y: 0, r: 5.6, fill: cap, stroke: edge, width: 1 },
];

export const GUARD_SHAPES = guard(0x41639c, 0x1c2b47, 0x2c4470, 0x263c66, 0x182742, 0xdbe7ff);
// Marked targets wear red so they read at a glance.
export const TARGET_SHAPES = guard(0xb04a45, 0x4d1b19, 0x7d2f2b, 0x6e2421, 0x4d1b19, 0xffd9d6);

const GOLD = 0xf5c542;
/** Bosses: a long coat with gold epaulettes and a peaked cap. Drawn at 1.3x. */
export const BOSS_SHAPES = [
  { type: 'poly', points: [16, 0, 10, -3.6, 10, 3.6], fill: GOLD },
  { type: 'poly', points: [-3, -9, -12, -7, -13, 0, -12, 7, -3, 9], fill: 0x45226f }, // coat tails
  { type: 'ellipse', x: -1, y: 0, rx: 7, ry: 10.5, fill: 0x6a37a6, stroke: GOLD, width: 1.6 },
  { type: 'circle', x: -1, y: -8.6, r: 2.4, fill: GOLD },
  { type: 'circle', x: -1, y: 8.6, r: 2.4, fill: GOLD },
  { type: 'poly', points: [4.5, -5, 9.5, -3.2, 9.5, 3.2, 4.5, 5], fill: 0x1f1033 },
  { type: 'circle', x: 1, y: 0, r: 5.8, fill: 0x351a57, stroke: GOLD, width: 1.2 },
  { type: 'circle', x: 3.4, y: 0, r: 1.3, fill: GOLD },
];

/** A downed guard, sprawled. */
export const BODY_SHAPES = [
  { type: 'ellipse', x: -11, y: -3.2, rx: 6, ry: 2.4, fill: 0x222d44 },
  { type: 'ellipse', x: -10, y: 3.6, rx: 6.5, ry: 2.4, fill: 0x222d44 },
  { type: 'ellipse', x: 4, y: -8.5, rx: 5.5, ry: 2.2, fill: 0x2c3c5e },
  { type: 'ellipse', x: 1, y: 8, rx: 5, ry: 2.2, fill: 0x2c3c5e },
  { type: 'ellipse', x: -1, y: 0, rx: 9.5, ry: 6.8, fill: 0x34466b, stroke: 0x1c2b47, width: 1.2 },
  { type: 'circle', x: 10, y: 0.5, r: 4.8, fill: 0x4a5f8c, stroke: 0x1c2b47, width: 1 },
];
