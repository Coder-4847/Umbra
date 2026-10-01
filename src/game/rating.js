/**
 * Star rating for a cleared level. No Pixi imports, so it runs in Node too.
 *
 *   1★  the level was completed
 *   2★  ... and the full alarm was never raised
 *   3★  ... and nobody ever spotted the player, no body was discovered,
 *       and it was done within the level's target time
 */
export const MAX_STARS = 3;

export function rateLevel(stats, targetTime) {
  const checks = {
    noAlarm: stats.fullAlarms === 0,
    unseen: stats.detections === 0,
    noBodyFound: stats.bodiesDiscovered === 0,
    inTime: stats.elapsed <= targetTime,
  };
  let stars = 1;
  if (checks.noAlarm) stars = 2;
  if (checks.noAlarm && checks.unseen && checks.noBodyFound && checks.inTime) stars = 3;
  return { stars, checks };
}

/** What stood between this run and the next star, as short phrases for the results screen. */
export function missedReasons(stats, targetTime) {
  const { checks } = rateLevel(stats, targetTime);
  const missed = [];
  if (!checks.noAlarm) missed.push('alarm raised');
  if (!checks.unseen) missed.push(`spotted ${stats.detections}×`);
  if (!checks.noBodyFound) missed.push(stats.bodiesDiscovered === 1 ? 'body found' : `${stats.bodiesDiscovered} bodies found`);
  if (!checks.inTime) missed.push('over target time');
  return missed;
}
