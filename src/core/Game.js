import { Application, Container } from 'pixi.js';
import { InputManager } from './InputManager.js';

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
  }

  async init(container) {
    await this.app.init({
      resizeTo: window,
      backgroundColor: 0x0b0b10,
      antialias: true,
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
    for (const callback of this.updateCallbacks) {
      callback(deltaSeconds);
    }
    this.input.endFrame();
  }

  _onResize() {
    this.world.position.set(this.app.screen.width / 2, this.app.screen.height / 2);
  }

  destroy() {
    this.input.destroy();
    this.app.destroy(true, { children: true });
  }
}
