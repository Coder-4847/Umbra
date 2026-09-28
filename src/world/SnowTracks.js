import { Graphics } from 'pixi.js';

/** Seconds a print stays visible. Guards only notice prints the player can still see. */
export const TRACK_LIFETIME = 14;

const STEP_SPACING = 22;
const STEP_OFFSET = 4;
const DRAG_SPACING = 12;
const PRINT_COLOR = 0x323c4c;
const FOOT_ALPHA = 0.6;
const DRAG_ALPHA = 0.4;

/**
 * Footprints and drag marks left in snow. Prints are kept in time order so
 * guards can scan newest-first and follow a trail forward in time.
 * Each print: { x, y, angle, time, kind: 'foot' | 'drag' }.
 */
export class SnowTracks {
  constructor(tilemap) {
    this.tilemap = tilemap;
    this.prints = [];
    this.now = 0;
    this.view = new Graphics();
    this._lastStep = null;
    this._stepSide = 1;
    this._dragLast = new WeakMap();
  }

  update(dt, player, bodies) {
    this.now += dt;
    while (this.prints.length && this.now - this.prints[0].time > TRACK_LIFETIME) this.prints.shift();

    if (!player.dead) this._trackPlayer(player);
    for (const body of bodies) {
      if (body.carried) this._trackDrag(body);
      else this._dragLast.delete(body);
    }
    this._draw();
  }

  _trackPlayer(player) {
    const last = this._lastStep;
    if (!last) {
      this._lastStep = { x: player.x, y: player.y };
      return;
    }
    const dx = player.x - last.x;
    const dy = player.y - last.y;
    if (dx * dx + dy * dy < STEP_SPACING * STEP_SPACING) return;
    this._lastStep = { x: player.x, y: player.y };
    if (!this.tilemap.isSnowAtWorld(player.x, player.y)) return;

    // Alternate left and right of the walking line so it reads as a stride.
    const angle = Math.atan2(dy, dx);
    this._stepSide = -this._stepSide;
    this.prints.push({
      x: player.x - Math.sin(angle) * STEP_OFFSET * this._stepSide,
      y: player.y + Math.cos(angle) * STEP_OFFSET * this._stepSide,
      angle,
      time: this.now,
      kind: 'foot',
    });
  }

  _trackDrag(body) {
    const last = this._dragLast.get(body);
    if (!last) {
      this._dragLast.set(body, { x: body.x, y: body.y });
      return;
    }
    const dx = body.x - last.x;
    const dy = body.y - last.y;
    if (dx * dx + dy * dy < DRAG_SPACING * DRAG_SPACING) return;
    this._dragLast.set(body, { x: body.x, y: body.y });
    if (!this.tilemap.isSnowAtWorld(body.x, body.y)) return;
    this.prints.push({ x: body.x, y: body.y, angle: Math.atan2(dy, dx), time: this.now, kind: 'drag' });
  }

  _draw() {
    const g = this.view;
    g.clear();
    for (const print of this.prints) {
      const life = 1 - (this.now - print.time) / TRACK_LIFETIME;
      const foot = print.kind === 'foot';
      // Along the direction of travel, then across it.
      const along = foot ? 4.5 : 8;
      const across = foot ? 2.4 : 5.5;
      g.poly(ellipsePoints(print.x, print.y, along, across, print.angle)).fill({
        color: PRINT_COLOR,
        alpha: (foot ? FOOT_ALPHA : DRAG_ALPHA) * Math.sqrt(life),
      });
    }
  }
}

function ellipsePoints(cx, cy, rx, ry, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const points = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const lx = Math.cos(a) * rx;
    const ly = Math.sin(a) * ry;
    points.push(cx + lx * cos - ly * sin, cy + lx * sin + ly * cos);
  }
  return points;
}
