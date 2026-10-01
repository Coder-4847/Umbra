import { parseLevel } from './schema.js';

// Each level is its own lazily-loaded chunk, so 100+ levels don't bloat startup.
const loaders = Object.fromEntries(
  Object.entries(import.meta.glob('./data/*.json', { import: 'default' })).map(([path, load]) => [
    path.match(/([^/]+)\.json$/)[1],
    load,
  ]),
);

/** Campaign levels in play order ("CC-LL" ids); other files (e.g. "sandbox") are reachable by id only. */
export const campaignIds = Object.keys(loaders)
  .filter((id) => /^\d{2}-\d{2}$/.test(id))
  .sort();

export const CHAPTER_NAMES = [
  'Urban Rooftops',
  'Warehouse District',
  'Research Facility',
  'Snowbound Base',
  'Jungle Outpost',
  'Underground Bunker',
  'Skyscraper Heist',
  'Private Estate',
  'Night Harbor',
  'Black Site',
];

/** Campaign ids grouped by chapter, in play order: [{ number, name, ids }]. */
export const chapters = [];
for (const id of campaignIds) {
  const number = Number(id.slice(0, 2));
  let chapter = chapters.at(-1);
  if (!chapter || chapter.number !== number) {
    chapter = { number, name: CHAPTER_NAMES[number - 1] ?? `Chapter ${number}`, ids: [] };
    chapters.push(chapter);
  }
  chapter.ids.push(id);
}

export function hasLevel(id) {
  return id in loaders;
}

export async function loadLevel(id) {
  if (!hasLevel(id)) throw new Error(`No level with id "${id}"`);
  const json = await loaders[id]();
  if (json.id !== id) throw new Error(`Level file "${id}.json" declares id "${json.id}"`);
  return parseLevel(json);
}

export function nextLevelId(id) {
  const index = campaignIds.indexOf(id);
  return index >= 0 ? (campaignIds[index + 1] ?? null) : null;
}
