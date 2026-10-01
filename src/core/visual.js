/**
 * Player-chosen display options (Settings tab), shared by everything that
 * draws. No Pixi imports. Mutated through `applyVisualSettings`; entities read
 * the colours every frame, so a change shows at once.
 */
export const visual = { colorblind: false, reducedMotion: false };

const NORMAL = { patrol: 0xfff3b0, suspicious: 0xffa53d, alert: 0xff4545 };
// Okabe-Ito: yellow, sky blue and vermilion stay apart for red-green colour blindness.
const COLORBLIND = { patrol: 0xf0e442, suspicious: 0x56b4e9, alert: 0xd55e00 };

/** Vision cone / alert colours: { patrol, suspicious, alert }. */
export function coneColors() {
  return visual.colorblind ? COLORBLIND : NORMAL;
}

const systemReducedMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** `settings.reducedMotion` unset means "follow the system preference". */
export function applyVisualSettings(settings = {}) {
  visual.colorblind = settings.colorblind === true;
  visual.reducedMotion = typeof settings.reducedMotion === 'boolean' ? settings.reducedMotion : systemReducedMotion();
  globalThis.document?.documentElement.classList.toggle('reduce-motion', visual.reducedMotion);
}
