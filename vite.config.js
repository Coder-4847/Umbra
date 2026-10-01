import { defineConfig } from 'vite';
import fs from 'node:fs/promises';
import path from 'node:path';

const LEVEL_DIRS = { levels: 'src/levels/data', templates: 'src/levels/templates' };
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,40}$/i;
const MAX_BODY_BYTES = 2 * 1024 * 1024;

/**
 * Dev-only endpoints the level editor (/editor.html) uses to list, load and
 * save level files directly in the repo. Not part of the production build.
 */
function levelFilesPlugin() {
  return {
    name: 'umbra-level-files',
    apply: 'serve',
    configureServer(server) {
      const dirFor = (kind) => LEVEL_DIRS[kind] && path.resolve(server.config.root, LEVEL_DIRS[kind]);

      server.middlewares.use('/__levels', async (req, res) => {
        const send = (status, body) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.end(typeof body === 'string' ? body : JSON.stringify(body));
        };
        try {
          const url = new URL(req.url, 'http://localhost');

          if (req.method === 'GET' && url.pathname === '/list') {
            const list = {};
            for (const kind of Object.keys(LEVEL_DIRS)) {
              const files = await fs.readdir(dirFor(kind)).catch(() => []);
              list[kind] = files.filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();
            }
            return send(200, list);
          }

          const dir = dirFor(url.searchParams.get('kind'));
          const id = url.searchParams.get('id') ?? '';
          if (!dir || !ID_PATTERN.test(id)) return send(400, { error: 'Invalid kind or id' });
          const file = path.join(dir, `${id}.json`);

          if (req.method === 'GET' && url.pathname === '/load') {
            return send(200, await fs.readFile(file, 'utf8'));
          }

          if (req.method === 'POST' && url.pathname === '/save') {
            const text = await readBody(req);
            JSON.parse(text);
            await fs.mkdir(dir, { recursive: true });
            await fs.writeFile(file, text);
            return send(200, { ok: true, file: path.relative(server.config.root, file) });
          }

          send(404, { error: 'Not found' });
        } catch (err) {
          send(500, { error: err.message });
        }
      });
    },
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Level file too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// The build uses relative URLs, so the same `dist/` works on GitHub Pages (served from /Umbra/),
// on a custom domain or from any other folder. The dev server stays at `/`.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? './' : '/',
  plugins: [levelFilesPlugin()],
}));
