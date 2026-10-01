import { Application, Container } from 'pixi.js';
import { InputManager } from './InputManager.js';

// World pixels that must fit across the screen's shorter side, and how far the camera may zoom out to get there.
const MIN_VIEW_SPAN = 540;
const MIN_ZOOM = 0.6;

/**
 * Owns the PixiJS application, the responsive canvas, the input manager,
 * and the update loop. Scene/level logic hooks into `world` and `update`.
 */
export class Game {
  constructor() {
    this.app = new Application();
    this.world = new Container();
    this.input = new InputManager();
    this.updateCallbacks = [];
    this.zoom = 1;
  }

  async init(container) {
    await this.app.init({
      resizeTo: window,
      backgroundColor: 0x0b0b10,
      // On dense screens (phones) the extra pixels already smooth the edges; MSAA there only costs GPU time.
      antialias: (window.devicePixelRatio || 1) < 2,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
    });

    container.appendChild(this.app.canvas);
    this.app.stage.addChild(this.world);

    this.app.ticker.add((ticker) => this._update(ticker.deltaMS / 1000));

    // Pixi's resizeTo uses a ResizeObserver internally, which doesn't always
    // fire a window 'resize' event, so we hook the renderer's own event.
    this.app.renderer.on('resize', () => this._onResize());
    this._onResize();
  }

  /** Register a per-frame callback: (deltaSeconds) => void */
  onUpdate(callback) {
    this.updateCallbacks.push(callback);
    return () => {
      this.updateCallbacks = this.updateCallbacks.filter((cb) => cb !== callback);
    };
  }

  _update(deltaSeconds) {
    this.input.update();
    for (const callback of this.updateCallbacks) {
      callback(deltaSeconds);
    }
    this.input.endFrame();
  }

  _onResize() {
    const { width, height } = this.app.screen;
    // Small screens zoom out: whoever can see the player (sight reaches ~300px when alert) has to be on screen.
    this.zoom = Math.min(1, Math.max(MIN_ZOOM, Math.min(width, height) / MIN_VIEW_SPAN));
    this.world.scale.set(this.zoom);
    this.world.position.set(width / 2, height / 2);
  }

  /** Size of the visible part of the world, in world pixels. */
  get viewWidth() {
    return this.app.screen.width / this.zoom;
  }

  get viewHeight() {
    return this.app.screen.height / this.zoom;
  }

  destroy() {
    this.input.destroy();
    this.app.destroy(true, { children: true });
  }
}
