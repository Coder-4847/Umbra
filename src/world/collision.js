import { TILE_SIZE } from './Tilemap.js';

/**
 * Moves an axis-aligned box ({x, y, halfSize}) and resolves tile collisions one
 * axis at a time, so bodies slide along walls instead of stopping dead on
 * diagonal contact.
 */
export function moveAndCollide(body, dx, dy, tilemap) {
  body.x += dx;
  resolveAxis(body, 'x', tilemap);
  body.y += dy;
  resolveAxis(body, 'y', tilemap);
}

function resolveAxis(body, axis, tilemap) {
  const half = body.halfSize;
  const minTileX = Math.floor((body.x - half) / TILE_SIZE);
  const maxTileX = Math.floor((body.x + half) / TILE_SIZE);
  const minTileY = Math.floor((body.y - half) / TILE_SIZE);
  const maxTileY = Math.floor((body.y + half) / TILE_SIZE);

  for (let ty = minTileY; ty <= maxTileY; ty++) {
    for (let tx = minTileX; tx <= maxTileX; tx++) {
      if (!tilemap.isSolid(tx, ty)) continue;

      const tileLeft = tx * TILE_SIZE;
      const tileTop = ty * TILE_SIZE;
      const overlapX = Math.min(body.x + half, tileLeft + TILE_SIZE) - Math.max(body.x - half, tileLeft);
      const overlapY = Math.min(body.y + half, tileTop + TILE_SIZE) - Math.max(body.y - half, tileTop);
      if (overlapX <= 0 || overlapY <= 0) continue;

      if (axis === 'x') {
        body.x += body.x < tileLeft + TILE_SIZE / 2 ? -overlapX : overlapX;
      } else {
        body.y += body.y < tileTop + TILE_SIZE / 2 ? -overlapY : overlapY;
      }
    }
  }
}

/** True if a box of the given half-size centered at (x, y) overlaps no solid tile. Assumes half < TILE_SIZE. */
export function isBoxClear(tilemap, x, y, half) {
  return (
    !tilemap.isSolidAtWorld(x - half, y - half) &&
    !tilemap.isSolidAtWorld(x + half, y - half) &&
    !tilemap.isSolidAtWorld(x - half, y + half) &&
    !tilemap.isSolidAtWorld(x + half, y + half)
  );
}
