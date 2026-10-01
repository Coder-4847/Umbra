import { BOSS_SHAPES } from './shapes.js';
import { Graphics, Text } from 'pixi.js';
import { Guard, GuardState } from './Guard.js';
import { VISION_FOV, VISION_RANGE } from './vision.js';
import { BOSS_VISION_MULT } from './bossRules.js';

const BOSS_TUNING = Object.freeze({
  speed: Object.freeze({ patrol: 75, suspicious: 105, alert: 160 }),
  visionRange: VISION_RANGE * BOSS_VISION_MULT,
  visionFov: VISION_FOV,
  standoff: 110,
});

// Seconds the boss is gone in a cloud of smoke before turning up at the next phase's post.
const RELOCATE_TIME = 1.4;
const BODY_RADIUS = 13;
const GOLD = 0xf5c542;

/**
 * A chapter boss: a guard that survives several silent takedowns. Each phase
 * is a patrol (the first is its `patrol`, the rest come from `phases`). A silent
 * stab from behind wounds it: it vanishes in smoke and turns up at the start of
 * the next phase's patrol, unaware of the player. The stab that lands in the
 * last phase takes it down for good. Anything else it shrugs off (the level
 * decides what that costs the player).
 *
 * Extra events: 'reappear' (boss, phaseIndex) when it turns up at a new post.
 */
export class Boss extends Guard {
  constructor(config) {
    super(config);
    this.name = config.name ?? 'The Boss';
    this.phases = [{ route: this.route, patrol: this.patrol, hint: null }, ...(config.phases ?? [])];
    this.maxHp = this.phases.length;
    this.hp = this.maxHp;
    this.phaseIndex = 0;
    this.hidden = false;
    this.relocateTimer = 0;
    this._drawHp();
  }

  get tuning() {
    return BOSS_TUNING;
  }

  get isBoss() {
    return true;
  }

  get hits() {
    return this.maxHp - this.hp;
  }

  investigate(x, y) {
    if (!this.hidden) super.investigate(x, y);
  }

  alertTo(x, y) {
    if (!this.hidden) super.alertTo(x, y);
  }

  /** A silent stab that doesn't finish it: off it goes to the next phase's post. */
  wound() {
    this.hp--;
    this.phaseIndex++;
    this.hidden = true;
    this.relocateTimer = RELOCATE_TIME;
    this.alarmRun = null;
    this.aimTarget = null;
    this.view.visible = false;
    this.coneView.visible = false;
    this._drawHp();
  }

  update(dt, ctx) {
    if (this.dead) return;
    if (this.hidden) {
      this.relocateTimer -= dt;
      if (this.relocateTimer <= 0) this._reappear();
      return;
    }
    super.update(dt, ctx);
  }

  _reappear() {
    const phase = this.phases[this.phaseIndex];
    this.patrol = phase.patrol.length === 1 ? [{ ...phase.patrol[0], wait: Infinity }] : phase.patrol;
    this.route = phase.route ?? 'loop';
    const start = this.patrol[0];
    this.x = start.x;
    this.y = start.y;
    this.facing = this._initialFacing();
    this.state = GuardState.PATROL;
    this.meter = 0;
    this.canSeePlayer = false;
    this.confirmedSighting = false;
    this.searching = false;
    this.followingTrail = false;
    this.waypointIndex = 0;
    this.waypointStep = 1;
    this.waitTimer = 0;
    this.lastKnown = { x: this.x, y: this.y };
    this._setDestination(this.x, this.y);
    this.hidden = false;
    this.view.visible = true;
    this.coneView.visible = true;
    this._syncView();
    this.emit('reappear', this, this.phaseIndex);
  }

  _buildView() {
    const view = super._buildView();
    // Bigger, gold-trimmed, and wearing its remaining health.
    this.figure.setShapes(BOSS_SHAPES, 1.3);
    this.hpPips = new Graphics();
    this.nameTag = new Text({
      text: '',
      style: {
        fontFamily: 'system-ui, sans-serif',
        fontSize: 11,
        fontWeight: '700',
        fill: GOLD,
        stroke: { color: 0x0b0b10, width: 3 },
      },
    });
    this.nameTag.anchor.set(0.5, 0);
    this.nameTag.position.set(0, BODY_RADIUS + 10);
    view.addChild(this.hpPips, this.nameTag);
    return view;
  }

  _drawHp() {
    if (!this.hpPips) return;
    this.nameTag.text = this.name;
    this.hpPips.clear();
    const gap = 8;
    const left = -((this.maxHp - 1) * gap) / 2;
    for (let i = 0; i < this.maxHp; i++) {
      this.hpPips.circle(left + i * gap, BODY_RADIUS + 5, 2.5).fill(i < this.hp ? GOLD : 0x3a3a48);
    }
  }
}
