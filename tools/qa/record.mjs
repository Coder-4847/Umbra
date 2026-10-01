// node tools/qa/record.mjs '<json>' — merges {id: entry} into tools/qa/verified.json (keys sorted).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const file = path.join(path.dirname(fileURLToPath(import.meta.url)), 'verified.json');
const log = JSON.parse(readFileSync(file, 'utf8'));
const incoming = JSON.parse(process.argv[2]);
for (const [id, entry] of Object.entries(incoming)) log[id] = { ...entry, ...(log[id]?.fix && !entry.fix ? { fix: log[id].fix } : {}) };
const { _about, ...levels } = log;
const out = { _about, ...Object.fromEntries(Object.entries(levels).sort(([a], [b]) => a.localeCompare(b))) };
writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
console.log(Object.keys(levels).length, 'levels recorded');
