import { rateLevel } from '../game/rating.js';

export const SAVE_KEY = 'umbra.save.v1';
const SAVE_VERSION = 1;

function emptySave() {
  return {
    version: SAVE_VERSION,
    levels: {}, // id -> { stars, bestTime, completions }
    starsSpent: 0, // Phase 10 spends stars on skins
    selectedSkin: null,
    settings: {},
  };
}

/** Bring a stored blob up to the current shape; anything unreadable starts a fresh save. */
function migrate(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.levels !== 'object' || raw.levels === null) return emptySave();
  // Future versions convert older blobs here before the merge below.
  return { ...emptySave(), ...raw, version: SAVE_VERSION };
}

/**
 * Player progress, kept in localStorage. Storage can be missing or throw
 * (private windows, blocked site data), in which case progress just lasts
 * for the session. `storage` is injectable so this can be checked from Node.
 */
export class SaveData {
  constructor(storage = globalThis.localStorage) {
    this.storage = storage;
    this.data = emptySave();
    this.load();
  }

  load() {
    try {
      this.data = migrate(JSON.parse(this.storage.getItem(SAVE_KEY)));
    } catch {
      this.data = emptySave();
    }
    return this.data;
  }

  save() {
    try {
      this.storage.setItem(SAVE_KEY, JSON.stringify(this.data));
    } catch {
      // Nothing to do: keep playing with the in-memory copy.
    }
  }

  reset() {
    this.data = emptySave();
    this.save();
  }

  record(id) {
    return this.data.levels[id] ?? null;
  }

  stars(id) {
    return this.data.levels[id]?.stars ?? 0;
  }

  isCleared(id) {
    return id in this.data.levels;
  }

  /**
   * Store a cleared run, keeping the best stars and the best time.
   * Returns what changed, for the results screen. `starsGained` is what the
   * run adds to the star currency: only an improvement pays out.
   */
  recordResult(id, stats, targetTime) {
    const { stars } = rateLevel(stats, targetTime);
    const previous = this.data.levels[id];
    const previousStars = previous?.stars ?? 0;
    const previousTime = previous?.bestTime ?? Infinity;
    this.data.levels[id] = {
      stars: Math.max(stars, previousStars),
      bestTime: Math.min(stats.elapsed, previousTime),
      completions: (previous?.completions ?? 0) + 1,
    };
    this.save();
    return {
      stars,
      bestStars: this.data.levels[id].stars,
      starsGained: Math.max(0, stars - previousStars),
      firstClear: !previous,
      bestTime: this.data.levels[id].bestTime,
      newBestTime: Boolean(previous) && stats.elapsed < previousTime,
    };
  }

  totalStars() {
    return Object.values(this.data.levels).reduce((sum, level) => sum + level.stars, 0);
  }

  /** Spendable stars: everything earned minus what skins have cost. */
  currency() {
    return this.totalStars() - this.data.starsSpent;
  }

  /**
   * Linear campaign: a level opens once the one before it is cleared. Because
   * `campaignIds` is in play order, that also means a boss opens after its
   * chapter's nine levels and a chapter opens after the previous boss.
   */
  isUnlocked(id, campaignIds) {
    const index = campaignIds.indexOf(id);
    if (index < 0) return false;
    return index === 0 || this.isCleared(campaignIds[index - 1]);
  }

  /** Where "continue" goes: the first unlocked level not yet cleared (the last level once all are). */
  continueId(campaignIds) {
    return campaignIds.find((id) => !this.isCleared(id)) ?? campaignIds.at(-1) ?? null;
  }
}
