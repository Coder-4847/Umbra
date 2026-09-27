/**
 * Smoothly follows a target position and drives a container's pivot so the
 * target appears to stay centered on screen. Frame-rate independent lerp:
 * the smoothing factor is derived from deltaSeconds rather than a fixed
 * per-frame constant, so camera feel doesn't change with framerate.
 */
export class Camera {
  constructor(target, { lerpSpeed = 6, bounds = null } = {}) {
    this.target = target;
    this.lerpSpeed = lerpSpeed;
    this.bounds = bounds;
    this.x = target.x;
    this.y = target.y;
  }

  update(deltaSeconds) {
    const t = 1 - Math.exp(-this.lerpSpeed * deltaSeconds);
    this.x += (this.target.x - this.x) * t;
    this.y += (this.target.y - this.y) * t;

    if (this.bounds) {
      this.x = Math.min(Math.max(this.x, this.bounds.minX), this.bounds.maxX);
      this.y = Math.min(Math.max(this.y, this.bounds.minY), this.bounds.maxY);
    }
  }

  applyTo(container) {
    container.pivot.set(this.x, this.y);
  }
}
