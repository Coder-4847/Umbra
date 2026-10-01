// node tools/qa/valall.mjs — validates every level file (errors and playability warnings).
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { validateLevel } = await import(pathToFileURL(path.join(root, 'src/levels/schema.js')).href);
const dir = path.join(root, 'src/levels/data');
let bad = 0;
let n = 0;
for (const f of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
  const { errors, warnings } = validateLevel(JSON.parse(readFileSync(path.join(dir, f), 'utf8')));
  n++;
  for (const e of errors) { bad++; console.log(f, 'ERROR', e); }
  for (const w of warnings) { bad++; console.log(f, 'warn', w); }
}
console.log(n, 'levels;', bad ? bad + ' issues' : 'all clean');
