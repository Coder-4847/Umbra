import { TILE_SIZE } from './tiles.js';
import { isBoxClear } from './collision.js';

const SQRT2 = Math.SQRT2;
const DIRS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2],
];
const CLEARANCE_MARGIN = 2;
const SEGMENT_SAMPLE_STEP = 6;
// Taking stairs or an elevator costs about as much as walking a few tiles.
const LINK_COST = 4;

/**
 * 8-directional A* over the tile grid (no diagonal corner-cutting), followed
 * by greedy string-pulling so bodies walk straight lines where the space is
 * clear instead of zig-zagging through tile centers.
 *
 * If the map has `links` (stairs/elevators: a Map of tile index -> tile index),
 * paths may use them; the point reached through a link is flagged
 * `teleport: true`, meaning "jump here from the previous point".
 * Returns an array of world-space points ending exactly at the goal, or null.
 */
export function findPath(tilemap, sx, sy, gx, gy, halfSize) {
  const { links } = tilemap;
  const { cols } = tilemap;
  const startX = Math.floor(sx / TILE_SIZE);
  const startY = Math.floor(sy / TILE_SIZE);
  const goalX = Math.floor(gx / TILE_SIZE);
  const goalY = Math.floor(gy / TILE_SIZE);

  if (tilemap.isSolid(goalX, goalY)) return null;
  if (startX === goalX && startY === goalY) return [{ x: gx, y: gy }];

  const size = cols * tilemap.rows;
  const start = startY * cols + startX;
  const goal = goalY * cols + goalX;
  const gScore = new Float64Array(size).fill(Infinity);
  const parent = new Int32Array(size).fill(-1);
  const closed = new Uint8Array(size);
  const open = new MinHeap();

  gScore[start] = 0;
  open.push(start, octile(startX, startY, goalX, goalY));

  let current;
  while (open.size > 0) {
    current = open.pop();
    if (current === goal) break;
    if (closed[current]) continue;
    closed[current] = 1;

    const cx = current % cols;
    const cy = (current - cx) / cols;
    for (const [dx, dy, cost] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (tilemap.isSolid(nx, ny)) continue;
      if (dx !== 0 && dy !== 0 && (tilemap.isSolid(cx + dx, cy) || tilemap.isSolid(cx, cy + dy))) continue;

      relax(ny * cols + nx, cost, nx, ny);
    }
    const linked = links?.get(current);
    if (linked !== undefined) {
      const lx = linked % cols;
      relax(linked, LINK_COST, lx, (linked - lx) / cols);
    }
  }

  function relax(next, cost, nx, ny) {
    if (closed[next]) return;
    const tentative = gScore[current] + cost;
    if (tentative < gScore[next]) {
      gScore[next] = tentative;
      parent[next] = current;
      open.push(next, tentative + octile(nx, ny, goalX, goalY));
    }
  }

  if (parent[goal] === -1) return null;

  const tiles = [];
  for (let node = goal; node !== start; node = parent[node]) tiles.push(node);
  tiles.reverse();

  let previous = start;
  const points = tiles.map((node) => {
    const x = node % cols;
    const y = (node - x) / cols;
    const px = previous % cols;
    const py = (previous - px) / cols;
    previous = node;
    const point = { x: (x + 0.5) * TILE_SIZE, y: (y + 0.5) * TILE_SIZE };
    // Non-adjacent consecutive tiles can only come from a link.
    if (Math.abs(x - px) > 1 || Math.abs(y - py) > 1) point.teleport = true;
    return point;
  });
  const last = points[points.length - 1];
  points[points.length - 1] = { x: gx, y: gy, teleport: last.teleport };

  return smoothPath(tilemap, { x: sx, y: sy }, points, halfSize + CLEARANCE_MARGIN);
}

/** String-pulls the path but never across a link: the pad and the arrival point always stay. */
function smoothPath(tilemap, start, points, half) {
  const result = [];
  let anchor = start;
  if (points[0].teleport) {
    result.push(points[0]);
    anchor = points[0];
  }
  for (let i = 1; i < points.length; i++) {
    if (points[i].teleport) {
      if (result.at(-1) !== points[i - 1]) result.push(points[i - 1]);
      result.push(points[i]);
      anchor = points[i];
      continue;
    }
    if (!isSegmentClear(tilemap, anchor, points[i], half) && result.at(-1) !== points[i - 1]) {
      result.push(points[i - 1]);
      anchor = points[i - 1];
    }
  }
  if (result.at(-1) !== points[points.length - 1]) result.push(points[points.length - 1]);
  return result;
}

function isSegmentClear(tilemap, a, b, half) {
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / SEGMENT_SAMPLE_STEP));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (!isBoxClear(tilemap, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, half)) return false;
  }
  return true;
}

function octile(ax, ay, bx, by) {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  return dx + dy + (SQRT2 - 2) * Math.min(dx, dy);
}

class MinHeap {
  constructor() {
    this.items = [];
    this.priorities = [];
  }

  get size() {
    return this.items.length;
  }

  push(item, priority) {
    const { items, priorities } = this;
    let i = items.length;
    items.push(item);
    priorities.push(priority);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (priorities[p] <= priority) break;
      items[i] = items[p];
      priorities[i] = priorities[p];
      i = p;
    }
    items[i] = item;
    priorities[i] = priority;
  }

  pop() {
    const { items, priorities } = this;
    const top = items[0];
    const lastItem = items.pop();
    const lastPriority = priorities.pop();
    const n = items.length;
    if (n === 0) return top;

    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      if (l >= n) break;
      const r = l + 1;
      const c = r < n && priorities[r] < priorities[l] ? r : l;
      if (priorities[c] >= lastPriority) break;
      items[i] = items[c];
      priorities[i] = priorities[c];
      i = c;
    }
    items[i] = lastItem;
    priorities[i] = lastPriority;
    return top;
  }
}
