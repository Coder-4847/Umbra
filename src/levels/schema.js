/**
 * UMBRA level file format, version 1. One file per level: src/levels/data/<id>.json
 * (campaign ids are "CC-LL", e.g. "03-10" = chapter 3 boss). Templates live in
 * src/levels/templates/ and use the same format.
 *
 * {
 *   "version": 1,
 *   "id": "01-03",
 *   "name": "Night Shift",
 *   "chapter": 1,
 *   "targetTime": 75,                               // seconds, for the 3-star rating
 *   "objectives": ["eliminateTargets", "exit"],
 *   "tiles": ["#######", "#P..%E#", "#######"],     // one string per row, see LEGEND
 *   "guards": [
 *     { "route": "pingpong", "target": true,
 *       "patrol": [{ "x": 2, "y": 1, "wait": 1.5, "look": "S" }, [4, 1]] }
 *   ],
 *   "cameras": [
 *     { "x": 5, "y": 1, "look": "S", "sweep": 90, "sweepTime": 3, "pause": 1, "panel": "A" }
 *   ],
 *   "panels": [{ "x": 1, "y": 1, "id": "A" }],
 *   "lasers": [
 *     { "x1": 3, "y1": 1, "x2": 3, "y2": 4, "period": 3, "onTime": 1.5, "offset": 0, "panel": "A" }
 *   ]
 * }
 *
 * Waypoints are tile coordinates, as { x, y, wait?, look? } or [x, y, wait?, look?].
 * `look` is a compass direction (N, NE, E, ...) or degrees clockwise from east,
 * held while waiting. route is "loop" (default) or "pingpong".
 * Cameras are ceiling-mounted on a floor tile: `look` (required) is the center
 * of the sweep, `sweep` its width in degrees (default 90, 0 = fixed),
 * `sweepTime` seconds per pass (default 3), `pause` seconds held at each end (default 1).
 * Birds ("b" in tiles) are a resting flock on a floor tile: walking right past them
 * or making noise near them flushes them, and guards come to check the spot.
 * Alarm panels sit on a floor tile. A guard who spots the player may run to one to
 * raise a full alarm; the player can hack one (E) to disable it along with every
 * laser and camera whose `panel` names its `id`.
 * Lasers are tripwire beams between two tile centers (x1,y1)-(x2,y2) that must have
 * a clear line between them. `period` > 0 makes one pulse: on for `onTime` seconds
 * of every `period`, shifted by `offset`; period 0 (default) means always on.
 * Links connect two floor tiles as stairs or an elevator:
 *   "links": [{ "x1": 3, "y1": 2, "x2": 20, "y2": 2, "kind": "stairs" }]   // kind: stairs | elevator
 * Walkable areas that only links connect are separate floors: sound doesn't carry
 * between them, radios and security systems do. Guards path through links too.
 * A guard's optional "radio": "<channel>" puts it on a radio net: the channel shares
 * sightings and found bodies level-wide, and checks in every few seconds, sending
 * someone to look when a member has gone silent.
 * Objectives: eliminateAll | eliminateTargets | collect (all intel) | exit (reach an
 * exit tile; always evaluated last, after the others are complete).
 */
import { BIRD_PROXIMITY } from '../entities/wildlifeRules.js';
import { GridMap, Tile, tileCenter } from '../world/tiles.js';
import { findPath } from '../world/pathfinding.js';
import { hasLineOfSight } from '../world/raycast.js';
import { angleDiff } from '../core/math.js';
import { CAMERA_FOV, CAMERA_RANGE, VISION_FOV, VISION_RANGE } from '../entities/vision.js';
import { distanceToSegment, laserActiveAt } from '../entities/securityRules.js';

export const FORMAT_VERSION = 1;

export const LEGEND = Object.freeze({
  '#': { tile: Tile.WALL, label: 'Wall' },
  '.': { tile: Tile.FLOOR, label: 'Floor' },
  '%': { tile: Tile.BUSH, label: 'Bush' },
  ':': { tile: Tile.SHADOW, label: 'Shadow' },
  '*': { tile: Tile.SNOW, label: 'Snow' },
  P: { tile: Tile.FLOOR, marker: 'spawn', label: 'Player spawn' },
  E: { tile: Tile.FLOOR, marker: 'exit', label: 'Exit' },
  i: { tile: Tile.FLOOR, marker: 'intel', label: 'Intel' },
  b: { tile: Tile.FLOOR, marker: 'wildlife', label: 'Birds' },
});

export const OBJECTIVES = Object.freeze(['eliminateAll', 'eliminateTargets', 'collect', 'exit']);

export const COMPASS = Object.freeze({ E: 0, SE: 45, S: 90, SW: 135, W: 180, NW: 225, N: 270, NE: 315 });

const ROUTES = ['loop', 'pingpong'];
const BODY_HALF_SIZE = 10;
const DEFAULT_TARGET_TIME = 90;
const MIN_SIZE = 5;
const MAX_SIZE = 200;

export class LevelError extends Error {
  constructor(id, errors) {
    super(`Level "${id ?? '?'}" is invalid:\n- ${errors.join('\n- ')}`);
    this.errors = errors;
  }
}

/** Parses level JSON into runtime data (world-space positions, radians). Throws LevelError. */
export function parseLevel(json) {
  const errors = [];
  const level = readLevel(json, errors);
  if (errors.length) throw new LevelError(json?.id, errors);
  return level;
}

/**
 * Full authoring check: format errors plus playability problems (unreachable
 * exits, broken patrol legs, a guard watching the spawn). Never throws.
 */
export function validateLevel(json) {
  const errors = [];
  const warnings = [];
  const level = readLevel(json, errors);
  if (level && errors.length === 0) checkPlayability(level, errors, warnings);
  return { errors, warnings, level: errors.length === 0 ? level : null };
}

function readLevel(json, errors) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    errors.push('Level must be a JSON object');
    return null;
  }
  if (json.version !== FORMAT_VERSION) errors.push(`"version" must be ${FORMAT_VERSION}`);
  if (typeof json.id !== 'string' || json.id === '') errors.push('"id" must be a non-empty string');

  const targetTime = json.targetTime ?? DEFAULT_TARGET_TIME;
  if (typeof targetTime !== 'number' || targetTime <= 0) errors.push('"targetTime" must be a positive number of seconds');
  const chapter = json.chapter ?? 0;
  if (!Number.isInteger(chapter) || chapter < 0) errors.push('"chapter" must be a whole number');

  const tiles = readTiles(json.tiles, errors);
  if (!tiles) return null;
  const map = new GridMap(tiles.cols, tiles.rows, tiles.grid);
  const guards = readGuards(json.guards ?? [], map, errors);
  const panels = readPanels(json.panels ?? [], map, errors);
  const panelIds = new Set(panels.map((p) => p.id).filter(Boolean));
  const cameras = readCameras(json.cameras ?? [], map, panelIds, errors);
  const lasers = readLasers(json.lasers ?? [], map, panelIds, errors);
  const links = readLinks(json.links ?? [], map, errors);
  const objectives = readObjectives(json.objectives, tiles, guards, errors);

  return {
    id: json.id,
    name: typeof json.name === 'string' && json.name ? json.name : json.id,
    chapter,
    targetTime,
    objectives,
    ...tiles,
    guards,
    cameras,
    panels,
    lasers,
    links,
  };
}

const LINK_KINDS = ['stairs', 'elevator'];

function readLinks(list, map, errors) {
  if (!Array.isArray(list)) {
    errors.push('"links" must be an array');
    return [];
  }
  const links = [];
  const usedTiles = new Set();
  list.forEach((link, li) => {
    const label = `Link ${li + 1}`;
    const { x1, y1, x2, y2 } = link ?? {};
    if (![x1, y1, x2, y2].every(Number.isInteger)) {
      errors.push(`${label}: x1, y1, x2, y2 must be whole tile coordinates`);
      return;
    }
    const kind = link.kind ?? 'stairs';
    if (!LINK_KINDS.includes(kind)) errors.push(`${label}: kind must be "stairs" or "elevator"`);
    if (map.isSolid(x1, y1) || map.isSolid(x2, y2)) errors.push(`${label}: both ends must be on floor tiles`);
    if (x1 === x2 && y1 === y2) errors.push(`${label}: its two ends must be different tiles`);
    for (const key of new Set([`${x1},${y1}`, `${x2},${y2}`])) {
      if (usedTiles.has(key)) errors.push(`${label}: tile (${key}) is already the end of another link`);
      usedTiles.add(key);
    }
    links.push({
      kind,
      tx1: x1, ty1: y1, tx2: x2, ty2: y2,
      a: { ...tileCenter(x1, y1), tx: x1, ty: y1 },
      b: { ...tileCenter(x2, y2), tx: x2, ty: y2 },
    });
  });
  return links;
}

function readPanelLink(value, label, panelIds, errors) {
  if (value == null) return null;
  if (typeof value !== 'string' || !panelIds.has(value)) {
    errors.push(`${label}: "panel" must be the id of an alarm panel in this level`);
    return null;
  }
  return value;
}

function readPanels(list, map, errors) {
  if (!Array.isArray(list)) {
    errors.push('"panels" must be an array');
    return [];
  }
  const panels = [];
  const seen = new Set();
  list.forEach((panel, pi) => {
    const label = `Panel ${pi + 1}`;
    const { x, y } = panel ?? {};
    if (!Number.isInteger(x) || !Number.isInteger(y)) {
      errors.push(`${label}: x and y must be whole tile coordinates`);
      return;
    }
    if (map.isSolid(x, y)) errors.push(`${label} at (${x},${y}) must be on a floor tile`);
    const id = panel.id ?? null;
    if (id !== null && (typeof id !== 'string' || id === '')) errors.push(`${label}: id must be a non-empty string`);
    else if (id !== null && seen.has(id)) errors.push(`${label}: id "${id}" is used by another panel`);
    if (id) seen.add(id);
    panels.push({ ...tileCenter(x, y), tx: x, ty: y, id });
  });
  return panels;
}

function readLasers(list, map, panelIds, errors) {
  if (!Array.isArray(list)) {
    errors.push('"lasers" must be an array');
    return [];
  }
  const lasers = [];
  list.forEach((laser, li) => {
    const label = `Laser ${li + 1}`;
    const { x1, y1, x2, y2 } = laser ?? {};
    if (![x1, y1, x2, y2].every(Number.isInteger)) {
      errors.push(`${label}: x1, y1, x2, y2 must be whole tile coordinates`);
      return;
    }
    if (map.isSolid(x1, y1) || map.isSolid(x2, y2)) errors.push(`${label}: both ends must be on floor tiles`);
    if (x1 === x2 && y1 === y2) errors.push(`${label}: its two ends must be different tiles`);
    const a = tileCenter(x1, y1);
    const b = tileCenter(x2, y2);
    if (!hasLineOfSight(map, a.x, a.y, b.x, b.y)) errors.push(`${label}: the beam from (${x1},${y1}) to (${x2},${y2}) passes through a wall`);

    const period = laser.period ?? 0;
    const onTime = laser.onTime ?? 0;
    const offset = laser.offset ?? 0;
    if (typeof period !== 'number' || period < 0) errors.push(`${label}: period must be seconds >= 0`);
    else if (period > 0 && !(typeof onTime === 'number' && onTime > 0 && onTime < period)) {
      errors.push(`${label}: onTime must be more than 0 and less than period`);
    }
    if (typeof offset !== 'number' || offset < 0) errors.push(`${label}: offset must be seconds >= 0`);
    const panel = readPanelLink(laser.panel, label, panelIds, errors);
    lasers.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, tx1: x1, ty1: y1, tx2: x2, ty2: y2, period, onTime, offset, panel });
  });
  return lasers;
}

function readCameras(list, map, panelIds, errors) {
  if (!Array.isArray(list)) {
    errors.push('"cameras" must be an array');
    return [];
  }
  const cameras = [];
  list.forEach((camera, ci) => {
    const label = `Camera ${ci + 1}`;
    if (!camera || typeof camera !== 'object') {
      errors.push(`${label} must be an object`);
      return;
    }
    const { x, y } = camera;
    if (!Number.isInteger(x) || !Number.isInteger(y)) {
      errors.push(`${label}: x and y must be whole tile coordinates`);
      return;
    }
    if (map.isSolid(x, y)) errors.push(`${label} at (${x},${y}) must be on a floor tile (cameras hang from the ceiling)`);
    if (camera.look == null) {
      errors.push(`${label}: "look" is required`);
      return;
    }
    const look = readLook(camera.look, label, errors);
    const sweep = camera.sweep ?? 90;
    const sweepTime = camera.sweepTime ?? 3;
    const pause = camera.pause ?? 1;
    if (typeof sweep !== 'number' || sweep < 0 || sweep > 360) errors.push(`${label}: sweep must be 0–360 degrees`);
    if (typeof sweepTime !== 'number' || sweepTime <= 0) errors.push(`${label}: sweepTime must be a positive number of seconds`);
    if (typeof pause !== 'number' || pause < 0) errors.push(`${label}: pause must be seconds >= 0`);
    const panel = readPanelLink(camera.panel, label, panelIds, errors);
    if (look === null) return;
    cameras.push({ ...tileCenter(x, y), tx: x, ty: y, look, sweep: (sweep * Math.PI) / 180, sweepTime, pause, panel });
  });
  return cameras;
}

function readTiles(tiles, errors) {
  if (!Array.isArray(tiles) || tiles.length === 0 || !tiles.every((row) => typeof row === 'string')) {
    errors.push('"tiles" must be a non-empty array of strings');
    return null;
  }
  const rows = tiles.length;
  const cols = tiles[0].length;
  if (rows < MIN_SIZE || cols < MIN_SIZE || rows > MAX_SIZE || cols > MAX_SIZE) {
    errors.push(`Map must be between ${MIN_SIZE} and ${MAX_SIZE} tiles on each side (is ${cols}x${rows})`);
    return null;
  }

  const grid = [];
  const spawns = [];
  const exits = [];
  const intel = [];
  const wildlife = [];
  let malformed = false;

  for (let y = 0; y < rows; y++) {
    const row = tiles[y];
    if (row.length !== cols) {
      errors.push(`Tile row ${y} has ${row.length} columns, expected ${cols}`);
      malformed = true;
      continue;
    }
    const gridRow = [];
    for (let x = 0; x < cols; x++) {
      const entry = LEGEND[row[x]];
      if (!entry) {
        errors.push(`Unknown tile "${row[x]}" at (${x},${y})`);
        gridRow.push(Tile.WALL);
        continue;
      }
      gridRow.push(entry.tile);
      const point = { tx: x, ty: y, ...tileCenter(x, y) };
      if (entry.marker === 'spawn') spawns.push(point);
      else if (entry.marker === 'exit') exits.push(point);
      else if (entry.marker === 'intel') intel.push(point);
      else if (entry.marker === 'wildlife') wildlife.push(point);
    }
    grid.push(gridRow);
  }

  if (malformed) return null;
  if (spawns.length !== 1) errors.push(`Exactly one player spawn "P" is required (found ${spawns.length})`);
  return { cols, rows, grid, spawn: spawns[0] ?? null, exits, intel, wildlife };
}

function readGuards(list, map, errors) {
  if (!Array.isArray(list)) {
    errors.push('"guards" must be an array');
    return [];
  }
  const guards = [];
  list.forEach((guard, gi) => {
    const label = `Guard ${gi + 1}`;
    if (!guard || typeof guard !== 'object') {
      errors.push(`${label} must be an object`);
      return;
    }
    const route = guard.route ?? 'loop';
    if (!ROUTES.includes(route)) errors.push(`${label}: route must be "loop" or "pingpong"`);
    if (!Array.isArray(guard.patrol) || guard.patrol.length === 0) {
      errors.push(`${label}: needs at least one patrol waypoint`);
      return;
    }
    const patrol = guard.patrol.map((wp, wi) => readWaypoint(wp, `${label} waypoint ${wi + 1}`, map, errors));
    if (patrol.includes(null)) return;
    const radio = guard.radio ?? null;
    if (radio !== null && (typeof radio !== 'string' || radio === '')) errors.push(`${label}: radio must be a channel name`);
    guards.push({ route, target: guard.target === true, radio, patrol });
  });
  return guards;
}

function readWaypoint(wp, label, map, errors) {
  const [x, y, wait, look] = Array.isArray(wp) ? wp : [wp?.x, wp?.y, wp?.wait, wp?.look];
  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    errors.push(`${label}: x and y must be whole tile coordinates`);
    return null;
  }
  if (map.isSolid(x, y)) errors.push(`${label} at (${x},${y}) is inside a wall or off the map`);
  if (wait != null && !(typeof wait === 'number' && wait >= 0)) errors.push(`${label}: wait must be seconds >= 0`);
  return { ...tileCenter(x, y), tx: x, ty: y, wait: wait ?? 0, look: readLook(look, label, errors) };
}

function readLook(look, label, errors) {
  if (look == null) return null;
  let degrees = null;
  if (typeof look === 'number') degrees = look;
  else if (typeof look === 'string' && look.toUpperCase() in COMPASS) degrees = COMPASS[look.toUpperCase()];
  if (degrees === null) {
    errors.push(`${label}: look must be a compass direction (N, NE, E, ...) or degrees`);
    return null;
  }
  return (degrees * Math.PI) / 180;
}

function readObjectives(list, tiles, guards, errors) {
  if (!Array.isArray(list) || list.length === 0) {
    errors.push('"objectives" must be a non-empty array');
    return [];
  }
  for (const objective of list) {
    if (!OBJECTIVES.includes(objective)) errors.push(`Unknown objective "${objective}"`);
  }
  if (new Set(list).size !== list.length) errors.push('Objectives must not repeat');
  if (list.includes('exit') && tiles.exits.length === 0) errors.push('The "exit" objective needs at least one exit tile "E"');
  if (list.includes('collect') && tiles.intel.length === 0) errors.push('The "collect" objective needs at least one intel tile "i"');
  if (list.includes('eliminateTargets') && !guards.some((g) => g.target)) {
    errors.push('The "eliminateTargets" objective needs at least one guard with "target": true');
  }
  const ordered = list.filter((o) => o !== 'exit');
  if (list.includes('exit')) ordered.push('exit');
  return ordered;
}

function checkPlayability(level, errors, warnings) {
  const map = new GridMap(level.cols, level.rows, level.grid);
  map.setLinks(level.links);
  const { spawn } = level;
  const reachable = (p) => findPath(map, spawn.x, spawn.y, p.x, p.y, BODY_HALF_SIZE) !== null;

  for (const exit of level.exits) {
    if (!reachable(exit)) errors.push(`Exit at (${exit.tx},${exit.ty}) can't be reached from the spawn`);
  }
  for (const item of level.intel) {
    if (!reachable(item)) errors.push(`Intel at (${item.tx},${item.ty}) can't be reached from the spawn`);
  }

  const mustEliminate = (g) =>
    level.objectives.includes('eliminateAll') || (g.target && level.objectives.includes('eliminateTargets'));

  level.guards.forEach((guard, gi) => {
    const label = `Guard ${gi + 1}`;
    const { patrol } = guard;
    if (mustEliminate(guard) && !reachable(patrol[0])) errors.push(`${label} can't be reached, so it can't be eliminated`);

    const legs = guard.route === 'loop' ? patrol.length : patrol.length - 1;
    for (let i = 0; i < legs && patrol.length > 1; i++) {
      const a = patrol[i];
      const b = patrol[(i + 1) % patrol.length];
      if (a.tx === b.tx && a.ty === b.ty) continue;
      if (!findPath(map, a.x, a.y, b.x, b.y, BODY_HALF_SIZE)) {
        warnings.push(`${label}: no walkable path from waypoint ${i + 1} to ${((i + 1) % patrol.length) + 1}`);
      }
    }

    const start = patrol[0];
    const facing = initialFacing(patrol);
    const dist = Math.hypot(spawn.x - start.x, spawn.y - start.y);
    const inCone = Math.abs(angleDiff(Math.atan2(spawn.y - start.y, spawn.x - start.x), facing)) <= VISION_FOV / 2;
    if (dist <= VISION_RANGE && inCone && hasLineOfSight(map, start.x, start.y, spawn.x, spawn.y)) {
      warnings.push(`${label} can see the player spawn at the start`);
    }
  });

  level.cameras.forEach((camera, ci) => {
    const dist = Math.hypot(spawn.x - camera.x, spawn.y - camera.y);
    if (dist > CAMERA_RANGE) return;
    const reach = camera.sweep / 2 + CAMERA_FOV / 2;
    const angle = Math.atan2(spawn.y - camera.y, spawn.x - camera.x);
    if (Math.abs(angleDiff(angle, camera.look)) <= reach && hasLineOfSight(map, camera.x, camera.y, spawn.x, spawn.y)) {
      warnings.push(`Camera ${ci + 1}'s sweep covers the player spawn`);
    }
  });

  level.lasers.forEach((laser, li) => {
    const onSpawn = distanceToSegment(spawn.x, spawn.y, laser.x1, laser.y1, laser.x2, laser.y2) <= BODY_HALF_SIZE;
    if (onSpawn && laserActiveAt(laser, 0)) errors.push(`Laser ${li + 1} passes over the player spawn and is on at the start`);
  });
  for (const panel of level.panels) {
    if (!reachable(panel)) warnings.push(`Panel at (${panel.tx},${panel.ty}) can't be reached, so the player can never hack it`);
  }

  const floors = map.computeFloors();
  level.links.forEach((link, li) => {
    if (floors[link.ty1 * level.cols + link.tx1] === floors[link.ty2 * level.cols + link.tx2]) {
      warnings.push(`Link ${li + 1} connects two spots on the same floor`);
    }
    if (!reachable(link.a) && !reachable(link.b)) warnings.push(`Link ${li + 1} can't be reached from the spawn`);
  });

  const channels = new Map();
  for (const guard of level.guards) if (guard.radio) channels.set(guard.radio, (channels.get(guard.radio) ?? 0) + 1);
  for (const [channel, count] of channels) {
    if (count === 1) warnings.push(`Radio channel "${channel}" has only one guard, so nobody hears it`);
  }

  for (const flock of level.wildlife) {
    if (Math.hypot(flock.x - spawn.x, flock.y - spawn.y) <= BIRD_PROXIMITY * 1.5) {
      warnings.push(`Birds at (${flock.tx},${flock.ty}) are right next to the spawn and will flush on the first step`);
    }
  }

  if (level.guards.length === 0 && level.cameras.length === 0) warnings.push('Level has no guards or cameras');
  if (level.exits.length > 0 && !level.objectives.includes('exit')) warnings.push('Exit tiles are placed but "exit" is not an objective');
  if (level.intel.length > 0 && !level.objectives.includes('collect')) warnings.push('Intel is placed but "collect" is not an objective');
}

function initialFacing(patrol) {
  const [first, second] = patrol;
  if (first.look != null) return first.look;
  if (second && (second.x !== first.x || second.y !== first.y)) {
    return Math.atan2(second.y - first.y, second.x - first.x);
  }
  return 0;
}
