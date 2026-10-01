import { Container, Graphics } from 'pixi.js';
import { moveAndCollide } from '../world/collision.js';
import { turnToward } from '../core/math.js';
import { Figure } from './Figure.js';
import { getSkin } from './skins.js';

const HALF_SIZE = 10;
const MAX_HP = 3;
const INVULN_TIME = 0.6;
const HIT_FLASH_TIME = 0.15;

export const PLAYER_SPEED = Object.freeze({ walk: 180, sprint: 250, drag: 100 });
// Velocity eases toward what the stick or keys ask for (1/s), and the body turns to follow it (rad/s),
// so eight keyboard directions blend into curves instead of snapping.
const ACCELERATION = 16;
const BRAKING = 22;
const TURN_SPEED = 13;

/** The player: eased movement with sliding tile collision, health, and body carrying. */
export class Player {
  constructor(x, y, skinId) {
    this.skinId = getSkin(skinId).id;
    this.x = x;
    this.y = y;
    this.halfSize = HALF_SIZE;
    this.facing = 0;
    this.vx = 0;
    this.vy = 0;
    // QA replays switch this off to place the player exactly (tools/qa/routes.js).
    this.smooth = true;

    this.hp = MAX_HP;
    this.dead = false;
    this.invulnTimer = 0;
    this.hitFlash = 0;
    this.lockTimer = 0;
    this.sprinting = false;
    this.isHidden = false;
    this.dragging = null;
    // Riding an elevator: out of sight and untouchable until the doors open.
    this.inTransit = false;

    this.view = this._buildView();
    this._drawnHp = -1;
    this._syncView();
  }

  update(dt, moveVector, speed, tilemap) {
    this.invulnTimer = Math.max(0, this.invulnTimer - dt);
    this.hitFlash = Math.max(0, this.hitFlash - dt);

    const free = this.lockTimer <= 0 && !this.dead;
    if (this.lockTimer > 0) this.lockTimer -= dt;
    const wantX = free ? moveVector.x * speed : 0;
    const wantY = free ? moveVector.y * speed : 0;
    if (this.smooth) {
      const pushing = wantX !== 0 || wantY !== 0;
      const k = 1 - Math.exp(-(pushing ? ACCELERATION : BRAKING) * dt);
      this.vx += (wantX - this.vx) * k;
      this.vy += (wantY - this.vy) * k;
      if (!pushing && Math.hypot(this.vx, this.vy) < 4) this.vx = this.vy = 0;
    } else {
      this.vx = wantX;
      this.vy = wantY;
    }
    if (free && (this.vx !== 0 || this.vy !== 0)) {
      const heading = Math.atan2(this.vy, this.vx);
      this.facing = this.smooth ? turnToward(this.facing, heading, TURN_SPEED * dt) : heading;
      moveAndCollide(this, this.vx * dt, this.vy * dt, tilemap);
    }

    this._syncView();
  }

  /** Returns true if the hit landed (not dead or invulnerable). */
  takeDamage(amount) {
    if (this.dead || this.invulnTimer > 0) return false;
    this.hp = Math.max(0, this.hp - amount);
    this.invulnTimer = INVULN_TIME;
    this.hitFlash = HIT_FLASH_TIME;
    if (this.hp === 0) this.dead = true;
    return true;
  }

  _buildView() {
    const view = new Container();
    this.figure = new Figure(getSkin(this.skinId).shapes);
    this.body = this.figure.body;
    this.pips = new Graphics();
    view.addChild(this.figure, this.pips);
    return view;
  }

  /** Cosmetic only: swaps the drawing, nothing else. */
  setSkin(skinId) {
    this.skinId = getSkin(skinId).id;
    this._drawSkin();
  }

  _drawSkin() {
    this.figure.setShapes(getSkin(this.skinId).shapes);
  }

  _syncView() {
    this.view.position.set(this.x, this.y);
    this.figure.pose(this.x, this.y, this.facing);
    this.body.tint = this.hitFlash > 0 ? 0xff6b6b : 0xffffff;

    if (this.inTransit) this.view.alpha = 0;
    else if (this.dead) this.view.alpha = 0.35;
    else if (this.invulnTimer > 0 && Math.floor(this.invulnTimer * 20) % 2 === 0) this.view.alpha = 0.3;
    else this.view.alpha = this.isHidden ? 0.5 : 1;

    if (this._drawnHp !== this.hp) {
      this._drawnHp = this.hp;
      this.pips.clear();
      for (let i = 0; i < MAX_HP; i++) {
        this.pips
          .circle(-8 + i * 8, HALF_SIZE + 8, 2.5)
          .fill(i < this.hp ? 0x4ade80 : 0x3a3a48);
      }
    }
  }
}
