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
  { type: 'rect', x: -10, y: -4.6, w: 4.4, h: 9.2, fill: vest, stroke: edge, width: 0.8 }, // radio pack
  { type: 'ellipse', x: -0.5, y: 0, rx: 6.2, ry: 10.6, fill: uniform, stroke: edge, width: 1.4 }, // shoulders
  { type: 'rect', x: -4.6, y: -5.8, w: 7.6, h: 11.6, fill: vest }, // vest
  { type: 'rect', x: -3.2, y: -5.8, w: 1.3, h: 11.6, fill: edge, alpha: 0.5 }, // strap
  { type: 'rect', x: 2, y: 1.8, w: 15, h: 2.6, fill: 0x101318 }, // rifle, held across the body
  { type: 'rect', x: 15.5, y: 2.4, w: 3.6, h: 1.4, fill: 0x2c323c },
  { type: 'ellipse', x: 5.4, y: 6, rx: 4.6, ry: 2.5, fill: uniform, stroke: edge, width: 1 }, // trigger arm
  { type: 'ellipse', x: 7.6, y: -2.6, rx: 4.4, ry: 2.3, fill: uniform, stroke: edge, width: 1 }, // support arm
  { type: 'circle', x: 11.2, y: 1.2, r: 1.7, fill: 0x1b1f26 }, // glove on the fore-grip
  { type: 'circle', x: 0.5, y: 0, r: 5.7, fill: cap, stroke: edge, width: 1 }, // helmet
  { type: 'poly', points: [3.4, -4.3, 6.6, -2.5, 6.6, 2.5, 3.4, 4.3], fill: brim }, // visor
  { type: 'ellipse', x: -1.6, y: -1.8, rx: 2.3, ry: 1.4, fill: light, alpha: 0.3 }, // sheen
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
