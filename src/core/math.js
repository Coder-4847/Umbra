const TAU = Math.PI * 2;

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/** Signed shortest difference a - b, in [-PI, PI]. */
export function angleDiff(a, b) {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d < -Math.PI) d += TAU;
  return d;
}

/** Rotates `current` toward `target` by at most `maxStep` radians, taking the short way around. */
export function turnToward(current, target, maxStep) {
  const d = angleDiff(target, current);
  if (Math.abs(d) <= maxStep) return target;
  return current + Math.sign(d) * maxStep;
}

export function lerpColor(a, b, t) {
  t = clamp(t, 0, 1);
  const r = ((a >> 16) & 0xff) + ((((b >> 16) & 0xff) - ((a >> 16) & 0xff)) * t);
  const g = ((a >> 8) & 0xff) + ((((b >> 8) & 0xff) - ((a >> 8) & 0xff)) * t);
  const bl = (a & 0xff) + (((b & 0xff) - (a & 0xff)) * t);
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
}
