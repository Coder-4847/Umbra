import { TILE_SIZE } from './tiles.js';

/**
 * Grid raycast (Amanatides & Woo DDA). Walks the exact sequence of tiles the
 * ray crosses, so it can't skip thin walls the way fixed-step sampling can.
 * (dirX, dirY) must be a unit vector. Returns distance to the first solid
 * tile boundary, or maxDist if nothing is hit.
 */
export function raycast(tilemap, x0, y0, dirX, dirY, maxDist) {
  let tx = Math.floor(x0 / TILE_SIZE);
  let ty = Math.floor(y0 / TILE_SIZE);
  const stepX = dirX > 0 ? 1 : -1;
  const stepY = dirY > 0 ? 1 : -1;
  const tDeltaX = dirX !== 0 ? Math.abs(TILE_SIZE / dirX) : Infinity;
  const tDeltaY = dirY !== 0 ? Math.abs(TILE_SIZE / dirY) : Infinity;

  let tMaxX = Infinity;
  if (dirX > 0) tMaxX = ((tx + 1) * TILE_SIZE - x0) / dirX;
  else if (dirX < 0) tMaxX = (tx * TILE_SIZE - x0) / dirX;

  let tMaxY = Infinity;
  if (dirY > 0) tMaxY = ((ty + 1) * TILE_SIZE - y0) / dirY;
  else if (dirY < 0) tMaxY = (ty * TILE_SIZE - y0) / dirY;

  for (;;) {
    let dist;
    if (tMaxX < tMaxY) {
      tx += stepX;
      dist = tMaxX;
      tMaxX += tDeltaX;
    } else {
      ty += stepY;
      dist = tMaxY;
      tMaxY += tDeltaY;
    }
    if (dist >= maxDist) return maxDist;
    if (tilemap.isSolid(tx, ty)) return dist;
  }
}

export function hasLineOfSight(tilemap, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const dist = Math.hypot(dx, dy);
  if (dist === 0) return true;
  return raycast(tilemap, ax, ay, dx / dist, dy / dist, dist) >= dist;
}
