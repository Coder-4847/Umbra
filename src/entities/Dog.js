import { Text } from 'pixi.js';
import { Guard, GuardState } from './Guard.js';
import { hasLineOfSight, raycast } from '../world/raycast.js';
import { clamp } from '../core/math.js';
import { DOG_SCENT_RADIUS, DOG_VISION_FOV, DOG_VISION_RANGE } from './dogRules.js';

const DOG_TUNING = Object.freeze({
  // Faster than a walking player, slower than a sprinting one.
  speed: Object.freeze({ patrol: 80, suspicious: 115, alert: 205 }),
  visionRange: DOG_VISION_RANGE,
  visionFov: DOG_VISION_FOV,
  // Dogs don't hold back to shoot: they close in to bite.
  standoff: 18,
});

// Scent alone fills the detection meter slowly, and a sniffing dog turns slowly,
// so a player who walks straight in from behind still gets the takedown.
const SCENT_FILL_TIME = 1.5;
const SNIFF_TURN_SPEED = 2;

// Scent marks are noticed in every direction; walls block them.
const TRAIL_NOTICE_RANGE = 110;
const TRAIL_FOLLOW_RADIUS = 130;
const TRAIL_SCAN_INTERVAL = 0.2;
// A dog smells a body further than it smells a live player, concealed or not.
const BODY_SCENT_RANGE = 140;

const BITE_RANGE = 28;
const BITE_WINDUP = 0.3;
const BITE_COOLDOWN = 1.1;

const BARK_INTERVAL = 2.5;
const BARK_FLASH_TIME = 0.6;

const SCENT_RAYS = 40;
const SCENT_COLOR = 0x9be15d;
const FUR = 0x8a5a33;
const FUR_LIGHT = 0xa9774a;
const FUR_DARK = 0x5a3a22;
const COLLAR = 0xe5625e;

/**
 * Patrol dog: a Guard with a nose. It sees less (shorter, wider cone) but
 * smells the player all around it (walls block scent, cover doesn't), follows
 * the player's scent trail, and smells bodies even when they're concealed.
 * Instead of shooting it barks (bringing guards in earshot) and bites.
 *
 * Extra events: 'bark' (dog) repeated while it keeps the player in its senses
 * (the first bark is the Guard 'alert' event); 'bite' (dog).
 */
export class Dog extends Guard {
  constructor(config) {
    super(config);
    this.scent = null;
    this.scentOnly = false;
    this.biteTimer = 0;
    this.barkTimer = 0;
    this.barkFlash = 0;
    this.on('alert', () => this._barked());
  }

  get tuning() {
    return DOG_TUNING;
  }

  get isDog() {
    return true;
  }

  /** @param ctx {{ player, bodies, scent? }} */
  update(dt, ctx) {
    if (this.dead) return;
    this.scent = ctx.scent ?? null;
    this.barkFlash = Math.max(0, this.barkFlash - dt);
    super.update(dt, ctx);

    const engaged = this.state === GuardState.ALERT && this.canSeePlayer;
    if (!engaged) this.biteTimer = 0;
    if (!engaged || !this.confirmedSighting || this.alarmRun) return;
    this.barkTimer -= dt;
    if (this.barkTimer <= 0) {
      this._barked();
      this.emit('bark', this);
    }
  }

  _barked() {
    this.barkTimer = BARK_INTERVAL;
    this.barkFlash = BARK_FLASH_TIME;
  }

  // --- perception -----------------------------------------------------------

  _canSeePlayer(player, sawLastFrame) {
    // Cover only stops working once the dog has actually seen the player; a sniff doesn't count.
    const seen = super._canSeePlayer(player, sawLastFrame && !this.scentOnly);
    this.scentOnly = false;
    if (seen || player.dead || player.inTransit) return seen;
    const smelled =
      this.playerDist <= DOG_SCENT_RADIUS + player.halfSize &&
      hasLineOfSight(this.tilemap, this.x, this.y, player.x, player.y);
    this.scentOnly = smelled;
    return smelled;
  }

  /** A sniff fills the meter at one steady rate, suspicious or not. */
  _raiseMeter(dt, multiplier) {
    if (!this.scentOnly) {
      super._raiseMeter(dt, multiplier);
      return;
    }
    this.meter = Math.min(1, this.meter + dt / SCENT_FILL_TIME);
  }

  _faceToward(x, y, dt, speed) {
    const sniffing = this.scentOnly && this.state !== GuardState.ALERT;
    super._faceToward(x, y, dt, sniffing ? Math.min(speed, SNIFF_TURN_SPEED) : speed);
  }

  _checkBodies(bodies) {
    for (const body of bodies) {
      if (body.discovered) continue;
      const smelled =
        Math.hypot(body.x - this.x, body.y - this.y) <= BODY_SCENT_RANGE &&
        hasLineOfSight(this.tilemap, this.x, this.y, body.x, body.y);
      const seen = !body.concealed && this._canSeePoint(body.x, body.y, this.visionRange);
      if (!smelled && !seen) continue;
      body.discovered = true;
      this._enterSuspicious(body.x, body.y);
      this.meter = Math.max(this.meter, 0.7);
      this._barked();
      this.emit('bodyFound', this, body);
      return;
    }
  }

  /** Picks up the newest scent mark nearby that's newer than any trail already followed. */
  _checkTracks(dt) {
    const marks = this.scent?.marks;
    if (!marks?.length) return;
    this.trackScanTimer -= dt;
    if (this.trackScanTimer > 0) return;
    this.trackScanTimer = TRAIL_SCAN_INTERVAL;

    for (let i = marks.length - 1; i >= 0; i--) {
      const mark = marks[i];
      if (mark.time <= this.trailTime) return;
      if (Math.hypot(mark.x - this.x, mark.y - this.y) > TRAIL_NOTICE_RANGE) continue;
      if (!hasLineOfSight(this.tilemap, this.x, this.y, mark.x, mark.y)) continue;
      this.trailTime = mark.time;
      this._enterSuspicious(mark.x, mark.y);
      this.followingTrail = true;
      return;
    }
  }

  _nextTrailPrint() {
    const marks = this.scent?.marks;
    if (!this.followingTrail || !marks) return null;
    for (let i = marks.length - 1; i >= 0; i--) {
      const mark = marks[i];
      if (mark.time <= this.trailTime) return null;
      if (Math.hypot(mark.x - this.x, mark.y - this.y) > TRAIL_FOLLOW_RADIUS) continue;
      if (hasLineOfSight(this.tilemap, this.x, this.y, mark.x, mark.y)) return mark;
    }
    return null;
  }

  // --- attack ---------------------------------------------------------------

  /** Replaces aiming and shooting: a short lunge wind-up at point-blank range, then a bite. */
  _updateAim(dt) {
    if (this.playerDist > BITE_RANGE || this.fireCooldown > 0) {
      this.biteTimer = 0;
      return;
    }
    this.biteTimer += dt;
    if (this.biteTimer >= BITE_WINDUP) {
      this.biteTimer = 0;
      this.fireCooldown = BITE_COOLDOWN;
      this.emit('bite', this);
    }
  }

  // --- rendering ------------------------------------------------------------

  _buildView() {
    const view = super._buildView();
    const g = this.body.clear();
    g.moveTo(-10, 0).lineTo(-15, -2).lineTo(-18, -6).stroke({ width: 3, color: FUR_DARK });
    g.ellipse(-2, 0, 11, 6.5).fill(FUR);
    g.circle(9, 0, 5.5).fill(FUR_LIGHT);
    g.ellipse(14, 0, 3.6, 2.7).fill(FUR_LIGHT);
    g.circle(17.3, 0, 1.7).fill(0x1a1410);
    g.ellipse(7, -5.2, 2.8, 1.8).fill(FUR_DARK);
    g.ellipse(7, 5.2, 2.8, 1.8).fill(FUR_DARK);
    g.rect(3.2, -5, 1.8, 10).fill(COLLAR);

    this.barkText = new Text({
      text: 'woof!',
      style: {
        fontFamily: 'system-ui, sans-serif',
        fontSize: 13,
        fontWeight: '800',
        fill: 0xffe0b0,
        stroke: { color: 0x0b0b10, width: 3 },
      },
    });
    // Left-anchored beside the state marker ("!" / "?") so the two don't overlap.
    this.barkText.anchor.set(0, 1);
    this.barkText.alpha = 0;
    view.addChild(this.barkText);
    return view;
  }

  _syncView() {
    super._syncView();
    const flash = (this.barkFlash ?? 0) / BARK_FLASH_TIME;
    this.barkText.alpha = flash;
    this.barkText.position.set(9, -12 - (1 - flash) * 8);
  }

  _drawCone() {
    super._drawCone();
    const g = this.coneView;

    // The scent circle, clipped by walls like the cone, brightens while the dog is on the player's scent.
    const points = [];
    for (let i = 0; i < SCENT_RAYS; i++) {
      const angle = (i / SCENT_RAYS) * Math.PI * 2;
      const dirX = Math.cos(angle);
      const dirY = Math.sin(angle);
      const dist = raycast(this.tilemap, this.x, this.y, dirX, dirY, DOG_SCENT_RADIUS);
      points.push(this.x + dirX * dist, this.y + dirY * dist);
    }
    const sniffing = this.scentOnly ?? false;
    g.poly(points)
      .fill({ color: SCENT_COLOR, alpha: sniffing ? 0.08 : 0.035 })
      .stroke({ width: 1.5, color: SCENT_COLOR, alpha: sniffing ? 0.55 : 0.2 });

    // Lunge telegraph: a red ring tightening onto the dog as the bite winds up.
    const biteTimer = this.biteTimer ?? 0;
    if (biteTimer > 0) {
      const progress = clamp(biteTimer / BITE_WINDUP, 0, 1);
      g.circle(this.x, this.y, BITE_RANGE * (1.8 - 0.8 * progress)).stroke({
        width: 2,
        color: 0xff4545,
        alpha: 0.3 + 0.6 * progress,
      });
    }
  }
}
