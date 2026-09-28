// Shared with the level validator and editor, so no Pixi imports here.
// The searchlight reaches further than a camera but is much narrower.
export const BOAT_LIGHT_RANGE = 250;
export const BOAT_LIGHT_FOV = (34 * Math.PI) / 180;
// Default swing of the light either side of the boat's heading, in degrees, and seconds per pass.
export const BOAT_DEFAULT_SWEEP = 60;
export const BOAT_DEFAULT_SWEEP_TIME = 2.5;

/** True if the straight line between two tile centers stays over deep water (the boat's route). */
export function isWaterLeg(map, a, b) {
  const steps = Math.max(1, Math.ceil(Math.hypot(b.tx - a.tx, b.ty - a.ty) * 4));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = a.tx + 0.5 + (b.tx - a.tx) * t;
    const y = a.ty + 0.5 + (b.ty - a.ty) * t;
    if (!map.isWater(Math.floor(x), Math.floor(y))) return false;
  }
  return true;
}
