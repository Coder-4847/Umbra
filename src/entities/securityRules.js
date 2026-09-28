// Shared with the level validator and editor, so no Pixi imports here.

/** How close the player must stand to hack a panel. */
export const PANEL_REACH = 30;

/** Whether a laser with this timing is emitting at `time` seconds into the level. */
export function laserActiveAt({ period = 0, onTime = 0, offset = 0 }, time) {
  if (period <= 0) return true;
  return (time + offset) % period < onTime;
}

/** Distance from point (px, py) to segment (x1, y1)-(x2, y2). */
export function distanceToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSq));
  return Math.hypot(px - (x1 + dx * t), py - (y1 + dy * t));
}
