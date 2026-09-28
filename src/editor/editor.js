import './editor.css';
import { COMPASS, FORMAT_VERSION, LEGEND, OBJECTIVES, validateLevel } from '../levels/schema.js';
import { formatLevelJson } from '../levels/format.js';
import { PLAYTEST_STORAGE_KEY } from '../levels/playtest.js';
import { GridMap, TILE_SIZE } from '../world/tiles.js';
import { raycast } from '../world/raycast.js';
import { CAMERA_FOV, CAMERA_RANGE, VISION_FOV, VISION_RANGE } from '../entities/vision.js';
import { BIRD_PROXIMITY } from '../entities/wildlifeRules.js';
import { distanceToSegment } from '../entities/securityRules.js';

const DRAFT_KEY = 'umbra.editor.draft';
const HISTORY_LIMIT = 200;
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,40}$/i;
const MIN_SIZE = 5;
const MAX_SIZE = 200;
const CONE_RAYS = 40;

const TOOLS = [
  { id: 'wall', key: '1', label: 'Wall', char: '#' },
  { id: 'floor', key: '2', label: 'Floor', char: '.' },
  { id: 'bush', key: '3', label: 'Bush', char: '%' },
  { id: 'shadow', key: '4', label: 'Shadow', char: ':' },
  { id: 'spawn', key: '5', label: 'Spawn', char: 'P' },
  { id: 'exit', key: '6', label: 'Exit', char: 'E' },
  { id: 'intel', key: '7', label: 'Intel', char: 'i' },
  { id: 'snow', key: '8', label: 'Snow', char: '*' },
  { id: 'birds', key: '9', label: 'Birds', char: 'b' },
  { id: 'guard', key: 'g', label: 'Guard' },
  { id: 'camera', key: 'c', label: 'Camera' },
  { id: 'laser', key: 'l', label: 'Laser' },
  { id: 'panel', key: 'p', label: 'Panel' },
  { id: 'link', key: 't', label: 'Stairs' },
  { id: 'select', key: 'v', label: 'Select' },
];
const TOOL_BY_ID = Object.fromEntries(TOOLS.map((t) => [t.id, t]));
const PAINT_TOOLS = new Set(['wall', 'floor', 'bush', 'shadow', 'snow']);
const TOGGLE_MARKERS = { exit: 'E', intel: 'i', birds: 'b' };

const TILE_COLORS = { '#': '#3b3a48', '.': '#1d1d27', '%': '#24422f', ':': '#0a0a0f', '*': '#6c7788' };
const COLOR = {
  guard: '#5b8def',
  target: '#e5625e',
  spawn: '#4ade80',
  exit: '#4ade80',
  intel: '#ffd166',
  birds: '#d6cbb3',
  birdRange: 'rgba(214, 203, 179, 0.35)',
  cone: 'rgba(255, 243, 176, 0.13)',
  coneFaint: 'rgba(255, 243, 176, 0.05)',
  camera: '#7dd3fc',
  laser: '#ff4d4d',
  panel: '#4ade80',
  link: '#c4b5fd',
  cameraCone: 'rgba(125, 211, 252, 0.16)',
  cameraConeFaint: 'rgba(125, 211, 252, 0.06)',
};

const TOOL_HINTS = {
  wall: 'Drag to paint · Shift+drag for a rectangle · right-drag erases to floor',
  floor: 'Drag to paint · Shift+drag for a rectangle',
  bush: 'Bushes hide bodies and the player · Shift+drag for a rectangle',
  shadow: 'Shadows hide bodies and the player · Shift+drag for a rectangle',
  spawn: 'Click to place the player spawn',
  exit: 'Click to toggle an exit tile',
  intel: 'Click to toggle an intel pickup',
  snow: 'Snow records footprints and drag marks that guards follow · floor tiles are plowed paths · Shift+drag for a rectangle',
  birds: 'Click to toggle a flock · the dashed ring is how close the player can walk before it flushes',
  guard: 'Click to place a guard, keep clicking to add waypoints · Esc or right-click to finish',
  camera: 'Click a floor tile to add a ceiling camera, or click one to select and drag it · set facing and sweep in the panel',
  laser: 'Click one end, then the other, to string a tripwire · right-click cancels · set pulse timing and panel link in the panel',
  panel: 'Click a floor tile to add an alarm panel, or click one to select and drag it · give it an id to wire lasers and cameras to it',
  link: 'Click one end, then the other, to connect floors with stairs or an elevator · right-click cancels · pick the kind in the panel',
  select: 'Click a waypoint or camera to select, drag to move · Del removes it (Shift+Del removes the whole guard)',
};

// --- document model ------------------------------------------------------------
// The editor works on a mutable "doc" (tiles as char grids, waypoints as objects)
// and converts to/from the file format at the edges.

function blankDoc(cols = 40, rows = 28) {
  const tiles = Array.from({ length: rows }, (_, y) =>
    Array.from({ length: cols }, (_, x) => (x === 0 || y === 0 || x === cols - 1 || y === rows - 1 ? '#' : '.')),
  );
  tiles[2][2] = 'P';
  return { id: '', name: '', chapter: 1, targetTime: 90, objectives: ['eliminateAll'], tiles, guards: [], cameras: [], panels: [], lasers: [], links: [] };
}

function docFromJson(json) {
  return {
    id: typeof json.id === 'string' ? json.id : '',
    name: typeof json.name === 'string' ? json.name : '',
    chapter: json.chapter ?? 0,
    targetTime: json.targetTime ?? 90,
    objectives: Array.isArray(json.objectives) ? [...json.objectives] : [],
    tiles: (json.tiles ?? []).map((row) => [...row]),
    guards: (json.guards ?? []).map((g) => ({
      route: g.route ?? 'loop',
      target: g.target === true,
      radio: g.radio,
      patrol: (g.patrol ?? []).map((wp) =>
        Array.isArray(wp) ? { x: wp[0], y: wp[1], wait: wp[2], look: wp[3] } : { ...wp },
      ),
    })),
    cameras: (json.cameras ?? []).map((c) => ({ ...c })),
    panels: (json.panels ?? []).map((p) => ({ ...p })),
    lasers: (json.lasers ?? []).map((l) => ({ ...l })),
    links: (json.links ?? []).map((l) => ({ ...l })),
  };
}

function jsonFromDoc(doc) {
  return {
    version: FORMAT_VERSION,
    id: doc.id,
    name: doc.name || undefined,
    chapter: doc.chapter,
    targetTime: doc.targetTime,
    objectives: doc.objectives,
    tiles: doc.tiles.map((row) => row.join('')),
    guards: doc.guards.map((g) => ({
      route: g.route,
      target: g.target || undefined,
      radio: g.radio || undefined,
      patrol: g.patrol.map(({ x, y, wait, look }) => ({ x, y, wait: wait || undefined, look: look ?? undefined })),
    })),
    cameras: doc.cameras.length
      ? doc.cameras.map(({ x, y, look, sweep, sweepTime, pause, panel }) => ({
          x, y, look, sweep, sweepTime, pause, panel: panel || undefined,
        }))
      : undefined,
    panels: doc.panels.length ? doc.panels.map(({ x, y, id }) => ({ x, y, id: id || undefined })) : undefined,
    lasers: doc.lasers.length
      ? doc.lasers.map(({ x1, y1, x2, y2, period, onTime, offset, panel }) => ({
          x1, y1, x2, y2, period: period || undefined, onTime: period ? onTime : undefined,
          offset: offset || undefined, panel: panel || undefined,
        }))
      : undefined,
    links: doc.links.length
      ? doc.links.map(({ x1, y1, x2, y2, kind }) => ({ x1, y1, x2, y2, kind: kind === 'elevator' ? kind : undefined }))
      : undefined,
  };
}

const docText = (doc) => formatLevelJson(jsonFromDoc(doc));

// --- state ---------------------------------------------------------------------

/** At most one thing is selected: a guard (optionally one of its waypoints), a camera, a laser or a panel. */
const noSelection = () => ({ guard: -1, wp: -1, camera: -1, laser: -1, panel: -1, link: -1 });

const state = {
  doc: blankDoc(),
  savedText: null,
  tool: 'wall',
  sel: noSelection(),
  zoom: 20,
  panX: 20,
  panY: 20,
  hover: null,
  drag: null,
  showAllCones: true,
  validation: { errors: [], warnings: [] },
  fileList: { levels: [], templates: [] },
};
const undoStack = [];
const redoStack = [];
let gridMapCache = null;
let spaceHeld = false;

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const panel = document.getElementById('panel');
const toolsNav = document.getElementById('tools');
const statusEl = document.getElementById('status');
const toastEl = document.getElementById('toast');
const docLabel = document.getElementById('doc-label');
const openSelect = document.getElementById('open-select');
const importInput = document.getElementById('import-file');

const cols = () => state.doc.tiles[0]?.length ?? 0;
const rows = () => state.doc.tiles.length;
const isDirty = () => docText(state.doc) !== state.savedText;

function gridMap() {
  if (!gridMapCache) {
    const grid = state.doc.tiles.map((row) => row.map((ch) => (LEGEND[ch] ?? LEGEND['#']).tile));
    gridMapCache = new GridMap(cols(), rows(), grid);
  }
  return gridMapCache;
}

// --- history & change propagation ----------------------------------------------

function checkpoint() {
  undoStack.push(JSON.stringify(state.doc));
  if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
  redoStack.length = 0;
}

function restore(from, to) {
  if (!from.length) return;
  to.push(JSON.stringify(state.doc));
  state.doc = JSON.parse(from.pop());
  clampSelection();
  onDocChanged(true);
}

const undo = () => restore(undoStack, redoStack);
const redo = () => restore(redoStack, undoStack);

let validationTimer = 0;
let draftTimer = 0;

function onDocChanged(structural = false) {
  gridMapCache = null;
  if (structural) renderPanel();
  render();
  updateDocLabel();
  clearTimeout(validationTimer);
  validationTimer = setTimeout(runValidation, 150);
  clearTimeout(draftTimer);
  draftTimer = setTimeout(saveDraft, 400);
}

function loadDoc(doc, savedText) {
  // Drafts autosaved before cameras existed have no cameras list.
  doc.cameras ??= [];
  doc.panels ??= [];
  doc.lasers ??= [];
  doc.links ??= [];
  state.doc = doc;
  state.savedText = savedText;
  undoStack.length = 0;
  redoStack.length = 0;
  state.sel = noSelection();
  fitView();
  onDocChanged(true);
}

function runValidation() {
  const { errors, warnings } = validateLevel(jsonFromDoc({ ...state.doc, id: state.doc.id || 'untitled' }));
  state.validation = { errors, warnings };
  renderValidation();
}

function saveDraft() {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ doc: state.doc, savedText: state.savedText }));
  } catch {
    // Storage full or unavailable: the draft is a convenience, not the source of truth.
  }
}

function updateDocLabel() {
  const name = state.doc.id || 'untitled';
  const dirty = isDirty();
  docLabel.textContent = `${name}${dirty ? ' • unsaved' : ''}`;
  document.title = `${name}${dirty ? ' •' : ''} — UMBRA Editor`;
}

// --- selection -----------------------------------------------------------------

function select(guard, wp) {
  state.sel = { ...noSelection(), guard, wp };
  renderPanel();
  render();
}

function selectCamera(camera) {
  state.sel = { ...noSelection(), camera };
  renderPanel();
  render();
}

function selectItem(kind, index) {
  state.sel = { ...noSelection(), [kind]: index };
  renderPanel();
  render();
}

function clampSelection() {
  for (const [kind, list] of [['camera', 'cameras'], ['laser', 'lasers'], ['panel', 'panels'], ['link', 'links']]) {
    if (state.sel[kind] >= 0) {
      if (!state.doc[list][state.sel[kind]]) state.sel = noSelection();
      return;
    }
  }
  const guard = state.doc.guards[state.sel.guard];
  if (!guard) state.sel = noSelection();
  else if (state.sel.wp >= guard.patrol.length) state.sel.wp = guard.patrol.length - 1;
}

function findCamera(cell) {
  return state.doc.cameras.findIndex((c) => c.x === cell.x && c.y === cell.y);
}

function findPanel(cell) {
  return state.doc.panels.findIndex((p) => p.x === cell.x && p.y === cell.y);
}

/** Index of a laser whose beam passes within half a tile of the cell's center, if any. */
function findLaser(cell) {
  return state.doc.lasers.findIndex(
    (l) => distanceToSegment(cell.x + 0.5, cell.y + 0.5, l.x1 + 0.5, l.y1 + 0.5, l.x2 + 0.5, l.y2 + 0.5) <= 0.5,
  );
}

function findLink(cell) {
  return state.doc.links.findIndex(
    (l) => (l.x1 === cell.x && l.y1 === cell.y) || (l.x2 === cell.x && l.y2 === cell.y),
  );
}

function nextPanelId() {
  const used = new Set(state.doc.panels.map((p) => p.id));
  for (let i = 0; i < 26; i++) {
    const id = String.fromCharCode(65 + i);
    if (!used.has(id)) return id;
  }
  return `P${state.doc.panels.length + 1}`;
}

function findWaypoint(cell) {
  const order = state.doc.guards.map((_, i) => i);
  if (state.sel.guard >= 0) order.unshift(state.sel.guard);
  for (const gi of order) {
    const wi = state.doc.guards[gi].patrol.findIndex((wp) => wp.x === cell.x && wp.y === cell.y);
    if (wi >= 0) return { guard: gi, wp: wi };
  }
  return null;
}

function deleteSelection(wholeGuard) {
  const { doc, sel } = state;
  if (sel.camera >= 0 || sel.laser >= 0 || sel.panel >= 0 || sel.link >= 0) {
    if (sel.link >= 0) {
      checkpoint();
      doc.links.splice(sel.link, 1);
      state.sel = noSelection();
      onDocChanged(true);
      return;
    }
    checkpoint();
    if (sel.camera >= 0) doc.cameras.splice(sel.camera, 1);
    if (sel.laser >= 0) doc.lasers.splice(sel.laser, 1);
    if (sel.panel >= 0) {
      const [removed] = doc.panels.splice(sel.panel, 1);
      // Don't leave lasers and cameras wired to a panel that no longer exists.
      for (const item of [...doc.lasers, ...doc.cameras]) if (item.panel === removed.id) delete item.panel;
    }
    state.sel = noSelection();
    onDocChanged(true);
    return;
  }
  const { guard: gi, wp: wi } = state.sel;
  const guard = state.doc.guards[gi];
  if (!guard) return;
  checkpoint();
  if (!wholeGuard && wi >= 0 && guard.patrol.length > 1) {
    guard.patrol.splice(wi, 1);
    state.sel.wp = Math.min(wi, guard.patrol.length - 1);
  } else {
    state.doc.guards.splice(gi, 1);
    state.sel = noSelection();
  }
  onDocChanged(true);
}

// --- tools & canvas input --------------------------------------------------------

function setTool(id) {
  state.tool = id;
  for (const btn of toolsNav.querySelectorAll('button')) btn.classList.toggle('active', btn.dataset.tool === id);
  state.laserStart = null;
  state.linkStart = null;
  if (!['guard', 'camera', 'laser', 'panel', 'link', 'select'].includes(id)) state.sel = noSelection();
  renderPanel();
  render();
  renderStatus();
}

function cellAt(e) {
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor((e.clientX - rect.left - state.panX) / state.zoom);
  const y = Math.floor((e.clientY - rect.top - state.panY) / state.zoom);
  return { x, y, inside: x >= 0 && y >= 0 && x < cols() && y < rows() };
}

function setTile(cell, ch) {
  if (cell.x < 0 || cell.y < 0 || cell.x >= cols() || cell.y >= rows()) return;
  state.doc.tiles[cell.y][cell.x] = ch;
}

/** Cells on the line between two cells (Bresenham), so fast strokes don't leave gaps. */
function lineCells(a, b) {
  const cells = [];
  let { x, y } = a;
  const dx = Math.abs(b.x - x);
  const dy = -Math.abs(b.y - y);
  const sx = x < b.x ? 1 : -1;
  const sy = y < b.y ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    cells.push({ x, y });
    if (x === b.x && y === b.y) return cells;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

function onPointerDown(e) {
  canvas.setPointerCapture(e.pointerId);
  if (e.button === 1 || spaceHeld) {
    state.drag = { mode: 'pan', sx: e.clientX, sy: e.clientY, px: state.panX, py: state.panY };
    return;
  }
  const cell = cellAt(e);
  const erase = e.button === 2;
  const { tool, doc } = state;

  if (tool === 'guard') {
    if (erase) {
      select(-1, -1);
      return;
    }
    if (!cell.inside) return;
    const current = doc.guards[state.sel.guard];
    if (current) {
      const last = current.patrol.at(-1);
      if (last.x === cell.x && last.y === cell.y) return;
      checkpoint();
      current.patrol.push({ x: cell.x, y: cell.y });
      state.sel.wp = current.patrol.length - 1;
    } else {
      checkpoint();
      doc.guards.push({ route: 'loop', target: false, patrol: [{ x: cell.x, y: cell.y }] });
      state.sel = { ...noSelection(), guard: doc.guards.length - 1, wp: 0 };
    }
    onDocChanged(true);
    return;
  }

  if (tool === 'camera') {
    if (erase) {
      select(-1, -1);
      return;
    }
    if (!cell.inside) return;
    const hit = findCamera(cell);
    if (hit >= 0) {
      selectCamera(hit);
      state.drag = { mode: 'move-camera', checkpointed: false };
      return;
    }
    checkpoint();
    doc.cameras.push({ x: cell.x, y: cell.y, look: 'S', sweep: 90 });
    state.sel = { ...noSelection(), camera: doc.cameras.length - 1 };
    onDocChanged(true);
    return;
  }

  if (tool === 'panel') {
    if (erase) {
      select(-1, -1);
      return;
    }
    if (!cell.inside) return;
    const hit = findPanel(cell);
    if (hit >= 0) {
      selectItem('panel', hit);
      state.drag = { mode: 'move-panel', checkpointed: false };
      return;
    }
    checkpoint();
    doc.panels.push({ x: cell.x, y: cell.y, id: nextPanelId() });
    state.sel = { ...noSelection(), panel: doc.panels.length - 1 };
    onDocChanged(true);
    return;
  }

  if (tool === 'laser') {
    if (erase) {
      state.laserStart = null;
      select(-1, -1);
      return;
    }
    if (!cell.inside) return;
    if (!state.laserStart) {
      state.laserStart = { x: cell.x, y: cell.y };
      render();
      return;
    }
    const start = state.laserStart;
    state.laserStart = null;
    if (start.x === cell.x && start.y === cell.y) {
      render();
      return;
    }
    checkpoint();
    doc.lasers.push({ x1: start.x, y1: start.y, x2: cell.x, y2: cell.y });
    state.sel = { ...noSelection(), laser: doc.lasers.length - 1 };
    onDocChanged(true);
    return;
  }

  if (tool === 'link') {
    if (erase) {
      state.linkStart = null;
      select(-1, -1);
      return;
    }
    if (!cell.inside) return;
    const hit = findLink(cell);
    if (!state.linkStart && hit >= 0) {
      selectItem('link', hit);
      return;
    }
    if (!state.linkStart) {
      state.linkStart = { x: cell.x, y: cell.y };
      render();
      return;
    }
    const start = state.linkStart;
    state.linkStart = null;
    if (start.x === cell.x && start.y === cell.y) {
      render();
      return;
    }
    checkpoint();
    doc.links.push({ x1: start.x, y1: start.y, x2: cell.x, y2: cell.y, kind: 'stairs' });
    state.sel = { ...noSelection(), link: doc.links.length - 1 };
    onDocChanged(true);
    return;
  }

  if (tool === 'select') {
    if (!cell.inside) {
      select(-1, -1);
      return;
    }
    const linkHit = findLink(cell);
    if (linkHit >= 0 && findWaypoint(cell) === null) {
      selectItem('link', linkHit);
      return;
    }
    const hit = findWaypoint(cell);
    const cameraHit = hit ? -1 : findCamera(cell);
    const panelHit = hit || cameraHit >= 0 ? -1 : findPanel(cell);
    const laserHit = hit || cameraHit >= 0 || panelHit >= 0 ? -1 : findLaser(cell);
    if (hit) {
      select(hit.guard, hit.wp);
      state.drag = { mode: 'move', checkpointed: false };
    } else if (cameraHit >= 0) {
      selectCamera(cameraHit);
      state.drag = { mode: 'move-camera', checkpointed: false };
    } else if (panelHit >= 0) {
      selectItem('panel', panelHit);
      state.drag = { mode: 'move-panel', checkpointed: false };
    } else if (laserHit >= 0) {
      selectItem('laser', laserHit);
    } else {
      select(-1, -1);
    }
    return;
  }

  if (!cell.inside) return;

  if (PAINT_TOOLS.has(tool) || erase) {
    const ch = erase ? '.' : TOOL_BY_ID[tool].char;
    checkpoint();
    if (e.shiftKey) {
      state.drag = { mode: 'rect', ch, start: cell, end: cell };
      render();
    } else {
      state.drag = { mode: 'paint', ch, last: cell };
      setTile(cell, ch);
      onDocChanged();
    }
    return;
  }

  checkpoint();
  if (tool === 'spawn') {
    for (const row of doc.tiles) row.forEach((ch, x) => ch === 'P' && (row[x] = '.'));
    setTile(cell, 'P');
  } else if (tool in TOGGLE_MARKERS) {
    const marker = TOGGLE_MARKERS[tool];
    setTile(cell, doc.tiles[cell.y][cell.x] === marker ? '.' : marker);
  }
  onDocChanged();
}

function onPointerMove(e) {
  const cell = cellAt(e);
  state.hover = cell.inside ? cell : null;
  const { drag } = state;

  if (drag?.mode === 'pan') {
    state.panX = drag.px + (e.clientX - drag.sx);
    state.panY = drag.py + (e.clientY - drag.sy);
  } else if (drag?.mode === 'paint' && cell.inside) {
    for (const c of lineCells(drag.last, cell)) setTile(c, drag.ch);
    drag.last = cell;
    onDocChanged();
  } else if (drag?.mode === 'rect') {
    drag.end = {
      x: Math.min(Math.max(cell.x, 0), cols() - 1),
      y: Math.min(Math.max(cell.y, 0), rows() - 1),
    };
  } else if (['move', 'move-camera', 'move-panel'].includes(drag?.mode) && cell.inside) {
    const item =
      drag.mode === 'move'
        ? state.doc.guards[state.sel.guard]?.patrol[state.sel.wp]
        : drag.mode === 'move-camera'
          ? state.doc.cameras[state.sel.camera]
          : state.doc.panels[state.sel.panel];
    if (item && (item.x !== cell.x || item.y !== cell.y)) {
      if (!drag.checkpointed) {
        checkpoint();
        drag.checkpointed = true;
      }
      item.x = cell.x;
      item.y = cell.y;
      onDocChanged(true);
    }
  }
  render();
  renderStatus();
}

function onPointerUp() {
  const { drag } = state;
  if (drag?.mode === 'rect') {
    const x0 = Math.min(drag.start.x, drag.end.x);
    const x1 = Math.max(drag.start.x, drag.end.x);
    const y0 = Math.min(drag.start.y, drag.end.y);
    const y1 = Math.max(drag.start.y, drag.end.y);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) setTile({ x, y }, drag.ch);
    onDocChanged();
  }
  state.drag = null;
  render();
}

function onWheel(e) {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const old = state.zoom;
  const next = Math.min(48, Math.max(6, old * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
  state.panX = mx - ((mx - state.panX) * next) / old;
  state.panY = my - ((my - state.panY) * next) / old;
  state.zoom = next;
  render();
}

function onKeyDown(e) {
  if (e.target.matches('input, select, textarea')) return;
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();

  if (mod && key === 'z') {
    e.preventDefault();
    if (e.shiftKey) redo();
    else undo();
  } else if (mod && key === 'y') {
    e.preventDefault();
    redo();
  } else if (mod && key === 's') {
    e.preventDefault();
    save();
  } else if (mod && e.key === 'Enter') {
    e.preventDefault();
    playtest();
  } else if (e.code === 'Space') {
    e.preventDefault();
    spaceHeld = true;
    canvas.style.cursor = 'grab';
  } else if (e.key === 'Escape') {
    state.laserStart = null;
    state.linkStart = null;
    select(-1, -1);
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    deleteSelection(e.shiftKey);
  } else if (key === 'o' && !mod) {
    state.showAllCones = !state.showAllCones;
    render();
  } else if (key === 'f' && !mod) {
    fitView();
    render();
  } else if (!mod) {
    const tool = TOOLS.find((t) => t.key === key);
    if (tool) setTool(tool.id);
  }
}

function onKeyUp(e) {
  if (e.code === 'Space') {
    spaceHeld = false;
    canvas.style.cursor = '';
  }
}

// --- rendering -----------------------------------------------------------------

function lookRadians(look) {
  if (look == null || look === '') return null;
  const degrees = typeof look === 'number' ? look : COMPASS[String(look).toUpperCase()];
  return degrees == null ? null : (degrees * Math.PI) / 180;
}

function waypointFacing(patrol, wi) {
  const wp = patrol[wi];
  const look = lookRadians(wp.look);
  if (look != null) return look;
  const next = patrol[(wi + 1) % patrol.length];
  if (next && (next.x !== wp.x || next.y !== wp.y)) return Math.atan2(next.y - wp.y, next.x - wp.x);
  return 0;
}

function fitView() {
  const rect = canvas.getBoundingClientRect();
  const w = rect.width || 800;
  const h = rect.height || 600;
  state.zoom = Math.min(32, Math.max(6, Math.min((w - 40) / cols(), (h - 60) / rows())));
  state.panX = (w - cols() * state.zoom) / 2;
  state.panY = (h - rows() * state.zoom) / 2;
}

function render() {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  if (canvas.width !== Math.round(rect.width * dpr) || canvas.height !== Math.round(rect.height * dpr)) {
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#07070a';
  ctx.fillRect(0, 0, rect.width, rect.height);

  const z = state.zoom;
  const { doc } = state;
  ctx.save();
  ctx.translate(state.panX, state.panY);

  for (let y = 0; y < rows(); y++) {
    for (let x = 0; x < cols(); x++) {
      const ch = doc.tiles[y][x];
      ctx.fillStyle = TILE_COLORS[ch] ?? TILE_COLORS['.'];
      if (!LEGEND[ch]) ctx.fillStyle = '#ff00ff';
      ctx.fillRect(x * z, y * z, z, z);
    }
  }

  if (z >= 10) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= cols(); x++) {
      ctx.moveTo(x * z + 0.5, 0);
      ctx.lineTo(x * z + 0.5, rows() * z);
    }
    for (let y = 0; y <= rows(); y++) {
      ctx.moveTo(0, y * z + 0.5);
      ctx.lineTo(cols() * z, y * z + 0.5);
    }
    ctx.stroke();
  }

  drawCones(z);

  for (let y = 0; y < rows(); y++) {
    for (let x = 0; x < cols(); x++) {
      const ch = doc.tiles[y][x];
      const cx = (x + 0.5) * z;
      const cy = (y + 0.5) * z;
      if (ch === 'P') {
        ctx.fillStyle = COLOR.spawn;
        ctx.beginPath();
        ctx.arc(cx, cy, z * 0.35, 0, Math.PI * 2);
        ctx.fill();
      } else if (ch === 'E') {
        ctx.fillStyle = 'rgba(74, 222, 128, 0.2)';
        ctx.fillRect(x * z + 2, y * z + 2, z - 4, z - 4);
        ctx.strokeStyle = COLOR.exit;
        ctx.lineWidth = 2;
        ctx.strokeRect(x * z + 2, y * z + 2, z - 4, z - 4);
      } else if (ch === 'i') {
        ctx.fillStyle = COLOR.intel;
        ctx.beginPath();
        ctx.moveTo(cx, cy - z * 0.35);
        ctx.lineTo(cx + z * 0.25, cy);
        ctx.lineTo(cx, cy + z * 0.35);
        ctx.lineTo(cx - z * 0.25, cy);
        ctx.fill();
      } else if (ch === 'b') {
        ctx.fillStyle = COLOR.birds;
        for (const [ox, oy] of [[-0.18, -0.1], [0.15, -0.16], [0.02, 0.14], [-0.2, 0.2]]) {
          ctx.beginPath();
          ctx.ellipse(cx + ox * z, cy + oy * z, z * 0.12, z * 0.08, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.strokeStyle = COLOR.birdRange;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.arc(cx, cy, (BIRD_PROXIMITY / TILE_SIZE) * z, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  drawGuards(z);
  drawCameras(z);
  drawSecurity(z);

  if (state.drag?.mode === 'rect') {
    const { start, end, ch } = state.drag;
    const x0 = Math.min(start.x, end.x);
    const y0 = Math.min(start.y, end.y);
    const w = Math.abs(end.x - start.x) + 1;
    const h = Math.abs(end.y - start.y) + 1;
    ctx.fillStyle = TILE_COLORS[ch];
    ctx.globalAlpha = 0.6;
    ctx.fillRect(x0 * z, y0 * z, w * z, h * z);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#ffffff';
    ctx.strokeRect(x0 * z + 0.5, y0 * z + 0.5, w * z - 1, h * z - 1);
  }

  if (state.hover) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.lineWidth = 1;
    ctx.strokeRect(state.hover.x * z + 0.5, state.hover.y * z + 0.5, z - 1, z - 1);
  }

  ctx.restore();
}

function drawCones(z) {
  const map = gridMap();
  const scale = z / TILE_SIZE;
  state.doc.guards.forEach((guard, gi) => {
    const selected = gi === state.sel.guard;
    if (!selected && !state.showAllCones) return;
    const wi = selected && state.sel.wp >= 0 ? state.sel.wp : 0;
    const wp = guard.patrol[wi];
    if (!wp || map.isSolid(wp.x, wp.y)) return;
    const ox = (wp.x + 0.5) * TILE_SIZE;
    const oy = (wp.y + 0.5) * TILE_SIZE;
    const facing = waypointFacing(guard.patrol, wi);
    ctx.fillStyle = selected ? COLOR.cone : COLOR.coneFaint;
    ctx.beginPath();
    ctx.moveTo(ox * scale, oy * scale);
    for (let i = 0; i <= CONE_RAYS; i++) {
      const angle = facing - VISION_FOV / 2 + (VISION_FOV * i) / CONE_RAYS;
      const dx = Math.cos(angle);
      const dy = Math.sin(angle);
      const dist = raycast(map, ox, oy, dx, dy, VISION_RANGE);
      ctx.lineTo((ox + dx * dist) * scale, (oy + dy * dist) * scale);
    }
    ctx.closePath();
    ctx.fill();
  });
}

function drawGuards(z) {
  state.doc.guards.forEach((guard, gi) => {
    const selected = gi === state.sel.guard;
    const color = guard.target ? COLOR.target : COLOR.guard;
    const points = guard.patrol.map((wp) => [(wp.x + 0.5) * z, (wp.y + 0.5) * z]);

    if (points.length > 1) {
      ctx.strokeStyle = color;
      ctx.globalAlpha = selected ? 0.95 : 0.45;
      ctx.lineWidth = selected ? 2 : 1.5;
      ctx.setLineDash(guard.route === 'pingpong' ? [6, 4] : []);
      ctx.beginPath();
      points.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
      if (guard.route === 'loop' && points.length > 2) ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    guard.patrol.forEach((wp, wi) => {
      const [px, py] = points[wi];
      const radius = wi === 0 ? z * 0.4 : z * 0.2;
      ctx.fillStyle = color;
      ctx.globalAlpha = wi === 0 || selected ? 1 : 0.7;
      ctx.beginPath();
      ctx.arc(px, py, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;

      const look = lookRadians(wp.look);
      if (look != null) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + Math.cos(look) * z * 0.7, py + Math.sin(look) * z * 0.7);
        ctx.stroke();
      }

      if (selected && wi === state.sel.wp) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(px, py, radius + 3, 0, Math.PI * 2);
        ctx.stroke();
      }

      if (z >= 14 && guard.patrol.length > 1) {
        ctx.fillStyle = '#ffffff';
        ctx.font = `${Math.round(z * 0.45)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(wi + 1), px, py - z * 0.62);
      }
    });
  });
}

/** Cameras show everything their sweep can ever cover, which is what matters when designing around them. */
function drawCameras(z) {
  const map = gridMap();
  const scale = z / TILE_SIZE;
  state.doc.cameras.forEach((camera, ci) => {
    const selected = ci === state.sel.camera;
    const cx = (camera.x + 0.5) * z;
    const cy = (camera.y + 0.5) * z;
    const look = lookRadians(camera.look) ?? 0;
    const sweep = ((camera.sweep ?? 90) * Math.PI) / 180;

    if ((selected || state.showAllCones) && !map.isSolid(camera.x, camera.y)) {
      const ox = (camera.x + 0.5) * TILE_SIZE;
      const oy = (camera.y + 0.5) * TILE_SIZE;
      const arc = Math.min(Math.PI * 2, sweep + CAMERA_FOV);
      const rays = Math.max(CONE_RAYS, Math.ceil((arc * 180) / Math.PI / 3));
      ctx.fillStyle = selected ? COLOR.cameraCone : COLOR.cameraConeFaint;
      ctx.beginPath();
      ctx.moveTo(ox * scale, oy * scale);
      for (let i = 0; i <= rays; i++) {
        const angle = look - arc / 2 + (arc * i) / rays;
        const dx = Math.cos(angle);
        const dy = Math.sin(angle);
        const dist = raycast(map, ox, oy, dx, dy, CAMERA_RANGE);
        ctx.lineTo((ox + dx * dist) * scale, (oy + dy * dist) * scale);
      }
      ctx.closePath();
      ctx.fill();
    }

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(look);
    ctx.fillStyle = '#2a2d38';
    ctx.strokeStyle = COLOR.camera;
    ctx.lineWidth = 1.5;
    ctx.fillRect(-z * 0.3, -z * 0.22, z * 0.6, z * 0.44);
    ctx.strokeRect(-z * 0.3, -z * 0.22, z * 0.6, z * 0.44);
    ctx.fillStyle = COLOR.camera;
    ctx.beginPath();
    ctx.arc(z * 0.32, 0, z * 0.12, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    if (selected) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, z * 0.55, 0, Math.PI * 2);
      ctx.stroke();
    }
  });
}

/** Lasers (dashed when pulsing) and alarm panels, plus the in-progress laser from the Laser tool. */
function drawSecurity(z) {
  const center = (x, y) => [(x + 0.5) * z, (y + 0.5) * z];

  state.doc.lasers.forEach((laser, li) => {
    const selected = li === state.sel.laser;
    const [ax, ay] = center(laser.x1, laser.y1);
    const [bx, by] = center(laser.x2, laser.y2);
    ctx.strokeStyle = COLOR.laser;
    ctx.lineWidth = selected ? 3 : 2;
    ctx.setLineDash(laser.period > 0 ? [6, 4] : []);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.setLineDash([]);
    for (const [ex, ey] of [[ax, ay], [bx, by]]) {
      ctx.fillStyle = '#3a3f4c';
      ctx.fillRect(ex - z * 0.2, ey - z * 0.2, z * 0.4, z * 0.4);
      ctx.fillStyle = COLOR.laser;
      ctx.fillRect(ex - z * 0.08, ey - z * 0.08, z * 0.16, z * 0.16);
    }
    if (laser.panel && z >= 12) {
      ctx.fillStyle = COLOR.panel;
      ctx.font = `${Math.round(z * 0.45)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(laser.panel, (ax + bx) / 2, (ay + by) / 2 - z * 0.45);
    }
    if (selected) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.strokeRect(Math.min(ax, bx) - z * 0.3, Math.min(ay, by) - z * 0.3, Math.abs(bx - ax) + z * 0.6, Math.abs(by - ay) + z * 0.6);
    }
  });

  if (state.laserStart) {
    const [ax, ay] = center(state.laserStart.x, state.laserStart.y);
    ctx.fillStyle = COLOR.laser;
    ctx.fillRect(ax - z * 0.2, ay - z * 0.2, z * 0.4, z * 0.4);
    if (state.hover) {
      const [bx, by] = center(state.hover.x, state.hover.y);
      ctx.strokeStyle = COLOR.laser;
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  state.doc.links.forEach((link, li) => {
    const selected = li === state.sel.link;
    const [ax, ay] = center(link.x1, link.y1);
    const [bx, by] = center(link.x2, link.y2);
    ctx.strokeStyle = COLOR.link;
    ctx.globalAlpha = selected ? 0.9 : 0.4;
    ctx.lineWidth = selected ? 2 : 1.5;
    ctx.setLineDash([3, 5]);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    for (const [ex, ey] of [[ax, ay], [bx, by]]) {
      ctx.fillStyle = '#1a1830';
      ctx.fillRect(ex - z * 0.4, ey - z * 0.4, z * 0.8, z * 0.8);
      ctx.strokeStyle = selected ? '#ffffff' : COLOR.link;
      ctx.lineWidth = selected ? 2 : 1.5;
      ctx.strokeRect(ex - z * 0.4, ey - z * 0.4, z * 0.8, z * 0.8);
      if (z >= 10) {
        ctx.fillStyle = COLOR.link;
        ctx.font = `bold ${Math.round(z * 0.45)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(link.kind === 'elevator' ? 'E' : 'S', ex, ey + 1);
      }
    }
  });

  if (state.linkStart) {
    const [ax, ay] = center(state.linkStart.x, state.linkStart.y);
    ctx.strokeStyle = COLOR.link;
    ctx.lineWidth = 2;
    ctx.strokeRect(ax - z * 0.4, ay - z * 0.4, z * 0.8, z * 0.8);
    if (state.hover) {
      const [bx, by] = center(state.hover.x, state.hover.y);
      ctx.globalAlpha = 0.6;
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
  }

  state.doc.panels.forEach((panel, pi) => {
    const [cx, cy] = center(panel.x, panel.y);
    ctx.fillStyle = '#2a2d38';
    ctx.strokeStyle = COLOR.panel;
    ctx.lineWidth = 1.5;
    ctx.fillRect(cx - z * 0.28, cy - z * 0.36, z * 0.56, z * 0.72);
    ctx.strokeRect(cx - z * 0.28, cy - z * 0.36, z * 0.56, z * 0.72);
    ctx.fillStyle = COLOR.panel;
    ctx.fillRect(cx - z * 0.18, cy - z * 0.26, z * 0.36, z * 0.24);
    if (panel.id && z >= 10) {
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${Math.round(z * 0.4)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(panel.id, cx, cy + z * 0.16);
    }
    if (pi === state.sel.panel) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.strokeRect(cx - z * 0.42, cy - z * 0.5, z * 0.84, z);
    }
  });
}

function renderStatus() {
  const hint = TOOL_HINTS[state.tool];
  if (!state.hover) {
    statusEl.textContent = hint;
    return;
  }
  const { x, y } = state.hover;
  const tile = LEGEND[state.doc.tiles[y][x]]?.label ?? 'Unknown';
  statusEl.textContent = `(${x}, ${y}) ${tile} — ${hint}`;
}

// --- side panel -----------------------------------------------------------------

const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function lookOptions(look, allowNone = true) {
  const options = allowNone ? ['<option value="">—</option>'] : [];
  for (const dir of Object.keys(COMPASS)) {
    options.push(`<option value="${dir}" ${String(look).toUpperCase() === dir ? 'selected' : ''}>${dir}</option>`);
  }
  if (typeof look === 'number') options.push(`<option value="${look}" selected>${look}°</option>`);
  return options.join('');
}

function panelOptions(selected) {
  const ids = state.doc.panels.map((p) => p.id).filter(Boolean);
  return ['<option value="">— none —</option>']
    .concat(ids.map((id) => `<option value="${esc(id)}" ${id === selected ? 'selected' : ''}>${esc(id)}</option>`))
    .join('');
}

function renderPanel() {
  const { doc, sel } = state;
  const guard = doc.guards[sel.guard];
  const camera = doc.cameras[sel.camera];
  const laser = doc.lasers[sel.laser];
  const alarmPanel = doc.panels[sel.panel];
  const link = doc.links[sel.link];

  const linkSection = link
    ? `<section>
        <h2>Link ${sel.link + 1} <span style="font-weight:400;text-transform:none;letter-spacing:0">(${link.x1},${link.y1}) ↔ (${link.x2},${link.y2})</span></h2>
        <label>Kind
          <select data-link="kind">
            <option value="stairs" ${link.kind !== 'elevator' ? 'selected' : ''}>stairs — instant, silent</option>
            <option value="elevator" ${link.kind === 'elevator' ? 'selected' : ''}>elevator — short ride, dings on arrival</option>
          </select>
        </label>
        <button data-action="delete-link" class="danger">Delete link</button>
      </section>`
    : '';

  const laserSection = laser
    ? `<section>
        <h2>Laser ${sel.laser + 1} <span style="font-weight:400;text-transform:none;letter-spacing:0">(${laser.x1},${laser.y1}) → (${laser.x2},${laser.y2})</span></h2>
        <div class="row">
          <label>Period (s) <input type="number" min="0" step="0.5" data-laser="period" value="${laser.period ?? ''}" placeholder="0 = always on"></label>
          <label>On for (s) <input type="number" min="0" step="0.5" data-laser="onTime" value="${laser.onTime ?? ''}" ${laser.period > 0 ? '' : 'disabled'}></label>
        </div>
        <div class="row">
          <label>Offset (s) <input type="number" min="0" step="0.25" data-laser="offset" value="${laser.offset ?? ''}" placeholder="0" ${laser.period > 0 ? '' : 'disabled'}></label>
          <label>Wired to panel <select data-laser="panel">${panelOptions(laser.panel)}</select></label>
        </div>
        <button data-action="delete-laser" class="danger">Delete laser</button>
      </section>`
    : '';

  const wired = alarmPanel?.id
    ? [...doc.lasers, ...doc.cameras].filter((item) => item.panel === alarmPanel.id).length
    : 0;
  const panelSection = alarmPanel
    ? `<section>
        <h2>Alarm panel ${sel.panel + 1}</h2>
        <label>Id <input data-panel-field="id" value="${esc(alarmPanel.id ?? '')}" placeholder="A"></label>
        <span style="color:var(--muted)">Wired to ${wired} laser${wired === 1 ? '' : 's'}/camera${wired === 1 ? '' : 's'}. Guards run here to raise the alarm; the player can hack it.</span>
        <button data-action="delete-panel" class="danger">Delete panel</button>
      </section>`
    : '';

  const cameraSection = camera
    ? `<section>
        <h2>Camera ${sel.camera + 1}</h2>
        <div class="row">
          <label>Facing <select data-cam="look">${lookOptions(camera.look, false)}</select></label>
          <label>Sweep (°) <input type="number" min="0" max="360" step="15" data-cam="sweep" value="${camera.sweep ?? ''}" placeholder="90"></label>
        </div>
        <div class="row">
          <label>Pass time (s) <input type="number" min="0.5" step="0.5" data-cam="sweepTime" value="${camera.sweepTime ?? ''}" placeholder="3"></label>
          <label>End pause (s) <input type="number" min="0" step="0.5" data-cam="pause" value="${camera.pause ?? ''}" placeholder="1"></label>
        </div>
        <label>Wired to panel <select data-cam="panel">${panelOptions(camera.panel)}</select></label>
        <button data-action="delete-camera" class="danger">Delete camera</button>
      </section>`
    : '';

  const guardSection = guard
    ? `<section>
        <h2>Guard ${sel.guard + 1}</h2>
        <div class="row">
          <label>Route
            <select data-guard="route">
              <option value="loop" ${guard.route === 'loop' ? 'selected' : ''}>loop</option>
              <option value="pingpong" ${guard.route === 'pingpong' ? 'selected' : ''}>pingpong</option>
            </select>
          </label>
          <label class="check"><input type="checkbox" data-guard="target" ${guard.target ? 'checked' : ''}> Target</label>
        </div>
        <label>Radio channel <input data-guard="radio" value="${esc(guard.radio ?? '')}" placeholder="none — e.g. red"></label>
        <table class="waypoints">
          <thead><tr><th>#</th><th>Tile</th><th>Wait (s)</th><th>Look</th><th></th></tr></thead>
          <tbody>
            ${guard.patrol
              .map(
                (wp, wi) => `<tr data-wp="${wi}" class="${wi === sel.wp ? 'selected' : ''}">
                  <td>${wi + 1}</td>
                  <td>${wp.x}, ${wp.y}</td>
                  <td><input type="number" min="0" step="0.5" data-wp-field="wait" value="${wp.wait ?? ''}" placeholder="0"></td>
                  <td><select data-wp-field="look">${lookOptions(wp.look)}</select></td>
                  <td><button data-action="delete-wp" title="Delete waypoint">✕</button></td>
                </tr>`,
              )
              .join('')}
          </tbody>
        </table>
        <button data-action="delete-guard" class="danger">Delete guard</button>
      </section>`
    : '';

  panel.innerHTML = `
    <section>
      <h2>Level</h2>
      <div class="row">
        <label>Id <input data-field="id" value="${esc(doc.id)}" placeholder="01-02"></label>
        <label>Chapter <input type="number" min="0" data-field="chapter" value="${doc.chapter}"></label>
      </div>
      <label>Name <input data-field="name" value="${esc(doc.name)}" placeholder="Level name"></label>
      <label>Target time for 3 stars (s) <input type="number" min="1" data-field="targetTime" value="${doc.targetTime}"></label>
      <div class="objectives">
        ${OBJECTIVES.map(
          (o) => `<label class="check"><input type="checkbox" data-objective="${o}" ${doc.objectives.includes(o) ? 'checked' : ''}> ${o}</label>`,
        ).join('')}
      </div>
      <div class="row">
        <label>Cols <input type="number" min="${MIN_SIZE}" max="${MAX_SIZE}" data-size="cols" value="${cols()}"></label>
        <label>Rows <input type="number" min="${MIN_SIZE}" max="${MAX_SIZE}" data-size="rows" value="${rows()}"></label>
        <button data-action="resize">Resize</button>
      </div>
      <button data-action="border">Wall the border</button>
    </section>
    ${guardSection}
    ${cameraSection}
    ${laserSection}
    ${panelSection}
    ${linkSection}
    <section>
      <h2>Validation</h2>
      <div id="validation"></div>
    </section>
    <section class="help">
      <h2>Shortcuts</h2>
      <dl>
        <dt>1–9, G, C, L, P, T, V</dt><dd>Tools</dd>
        <dt>Shift+drag</dt><dd>Rectangle fill</dd>
        <dt>Right-drag</dt><dd>Erase to floor</dd>
        <dt>Space+drag / wheel</dt><dd>Pan / zoom</dd>
        <dt>F / O</dt><dd>Fit view / toggle all cones</dd>
        <dt>Del, Shift+Del</dt><dd>Delete waypoint / guard</dd>
        <dt>Ctrl+Z / Ctrl+Y</dt><dd>Undo / redo</dd>
        <dt>Ctrl+S / Ctrl+Enter</dt><dd>Save / playtest</dd>
      </dl>
    </section>`;
  renderValidation();
}

function renderValidation() {
  const el = document.getElementById('validation');
  if (!el) return;
  const { errors, warnings } = state.validation;
  if (errors.length === 0 && warnings.length === 0) {
    el.innerHTML = '<span class="ok">✓ Ready to play</span>';
    return;
  }
  el.innerHTML = `<ul>${errors.map((m) => `<li class="error">✕ ${esc(m)}</li>`).join('')}${warnings
    .map((m) => `<li class="warning">! ${esc(m)}</li>`)
    .join('')}</ul>`;
}

function onPanelChange(e) {
  const el = e.target;
  const { doc } = state;

  if (el.dataset.field) {
    checkpoint();
    const field = el.dataset.field;
    doc[field] = field === 'chapter' || field === 'targetTime' ? Number(el.value) : el.value.trim();
    onDocChanged();
  } else if (el.dataset.objective) {
    checkpoint();
    const chosen = new Set(doc.objectives);
    if (el.checked) chosen.add(el.dataset.objective);
    else chosen.delete(el.dataset.objective);
    doc.objectives = OBJECTIVES.filter((o) => chosen.has(o));
    onDocChanged();
  } else if (el.dataset.guard) {
    checkpoint();
    const guard = doc.guards[state.sel.guard];
    if (el.dataset.guard === 'route') guard.route = el.value;
    else if (el.dataset.guard === 'radio') guard.radio = el.value.trim() || undefined;
    else guard.target = el.checked;
    onDocChanged();
  } else if (el.dataset.link) {
    checkpoint();
    doc.links[state.sel.link].kind = el.value;
    onDocChanged(true);
  } else if (el.dataset.wpField) {
    checkpoint();
    const wi = Number(el.closest('tr').dataset.wp);
    const wp = doc.guards[state.sel.guard].patrol[wi];
    if (el.dataset.wpField === 'wait') {
      wp.wait = el.value === '' ? undefined : Math.max(0, Number(el.value));
    } else {
      wp.look = el.value === '' ? undefined : Number.isNaN(Number(el.value)) ? el.value : Number(el.value);
    }
    onDocChanged();
  } else if (el.dataset.cam) {
    checkpoint();
    const camera = doc.cameras[state.sel.camera];
    const field = el.dataset.cam;
    if (field === 'look') camera.look = Number.isNaN(Number(el.value)) ? el.value : Number(el.value);
    else if (field === 'panel') camera.panel = el.value || undefined;
    else camera[field] = el.value === '' ? undefined : Math.max(0, Number(el.value));
    onDocChanged();
  } else if (el.dataset.laser) {
    checkpoint();
    const laser = doc.lasers[state.sel.laser];
    const field = el.dataset.laser;
    if (field === 'panel') {
      laser.panel = el.value || undefined;
    } else {
      laser[field] = el.value === '' ? undefined : Math.max(0, Number(el.value));
      // A freshly pulsing laser needs an on-time to be valid; default to half the period.
      if (field === 'period' && laser.period > 0 && !(laser.onTime > 0 && laser.onTime < laser.period)) {
        laser.onTime = laser.period / 2;
      }
    }
    // Period toggles whether the timing inputs are enabled.
    onDocChanged(field === 'period');
  } else if (el.dataset.panelField) {
    checkpoint();
    const alarmPanel = doc.panels[state.sel.panel];
    const oldId = alarmPanel.id;
    const newId = el.value.trim() || undefined;
    alarmPanel.id = newId;
    // Keep wiring intact when a panel is renamed.
    for (const item of [...doc.lasers, ...doc.cameras]) if (oldId && item.panel === oldId) item.panel = newId;
    onDocChanged(true);
  }
}

function onPanelClick(e) {
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (action === 'resize') {
    const newCols = Number(panel.querySelector('[data-size="cols"]').value);
    const newRows = Number(panel.querySelector('[data-size="rows"]').value);
    resize(newCols, newRows);
    return;
  }
  if (action === 'border') {
    checkpoint();
    const { tiles } = state.doc;
    tiles.forEach((row, y) =>
      row.forEach((_, x) => {
        if (x === 0 || y === 0 || x === cols() - 1 || y === rows() - 1) row[x] = '#';
      }),
    );
    onDocChanged();
    return;
  }
  if (action === 'delete-wp') {
    state.sel.wp = Number(e.target.closest('tr').dataset.wp);
    deleteSelection(false);
    return;
  }
  if (['delete-guard', 'delete-camera', 'delete-laser', 'delete-panel', 'delete-link'].includes(action)) {
    deleteSelection(true);
    return;
  }
  const row = e.target.closest('tr[data-wp]');
  if (row && !e.target.matches('input, select, button')) select(state.sel.guard, Number(row.dataset.wp));
}

function resize(newCols, newRows) {
  if (!(newCols >= MIN_SIZE && newRows >= MIN_SIZE && newCols <= MAX_SIZE && newRows <= MAX_SIZE)) {
    toast(`Size must be ${MIN_SIZE}–${MAX_SIZE} on each side`, true);
    return;
  }
  checkpoint();
  const old = state.doc.tiles;
  state.doc.tiles = Array.from({ length: newRows }, (_, y) =>
    Array.from({ length: newCols }, (_, x) => old[y]?.[x] ?? '.'),
  );
  onDocChanged(true);
}

// --- files ----------------------------------------------------------------------

function toast(message, isError = false) {
  toastEl.textContent = message;
  toastEl.className = `visible${isError ? ' error' : ''}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (toastEl.className = ''), 2500);
}

async function api(path, options) {
  const res = await fetch(`/__levels${path}`, options);
  const body = await res.text();
  if (!res.ok) throw new Error(JSON.parse(body).error ?? res.statusText);
  return body;
}

async function refreshFileList() {
  try {
    state.fileList = JSON.parse(await api('/list'));
  } catch (err) {
    toast(`Can't reach the dev server level API: ${err.message}`, true);
    return;
  }
  const group = (label, kind) =>
    state.fileList[kind].length
      ? `<optgroup label="${label}">${state.fileList[kind]
          .map((id) => `<option value="${kind}:${esc(id)}">${esc(id)}</option>`)
          .join('')}</optgroup>`
      : '';
  openSelect.innerHTML = `<option value="">Open…</option>${group('Levels', 'levels')}${group('Templates (new level from…)', 'templates')}`;
}

function confirmDiscard() {
  return !isDirty() || confirm('Discard unsaved changes to this level?');
}

async function openFile(kind, id) {
  if (!confirmDiscard()) return;
  try {
    const doc = docFromJson(JSON.parse(await api(`/load?kind=${kind}&id=${encodeURIComponent(id)}`)));
    if (kind === 'templates') {
      doc.id = '';
      loadDoc(doc, null);
      toast(`New level from template "${id}" — set an id and save`);
    } else {
      loadDoc(doc, docText(doc));
      toast(`Opened ${id}`);
    }
  } catch (err) {
    toast(`Couldn't open ${id}: ${err.message}`, true);
  }
}

async function writeFile(kind, id, json) {
  await api(`/save?kind=${kind}&id=${encodeURIComponent(id)}`, { method: 'POST', body: formatLevelJson(json) });
  await refreshFileList();
}

function askId(message, initial) {
  const id = prompt(message, initial)?.trim();
  if (!id) return null;
  if (!ID_PATTERN.test(id)) {
    toast('Ids may only use letters, digits and dashes', true);
    return null;
  }
  return id;
}

async function save({ forceNewId = false } = {}) {
  let id = state.doc.id;
  if (forceNewId || !id) {
    id = askId('Level id (campaign levels are CC-LL, e.g. 02-07):', id);
    if (!id) return;
    if (id !== state.doc.id && state.fileList.levels.includes(id) && !confirm(`Level "${id}" exists. Overwrite it?`)) return;
    checkpoint();
    state.doc.id = id;
    renderPanel();
  }
  runValidation();
  const { errors } = state.validation;
  if (errors.length && !confirm(`This level has ${errors.length} error(s) and won't load in the game yet. Save anyway?`)) return;
  try {
    await writeFile('levels', id, jsonFromDoc(state.doc));
    state.savedText = docText(state.doc);
    updateDocLabel();
    saveDraft();
    toast(`Saved src/levels/data/${id}.json`);
  } catch (err) {
    toast(`Save failed: ${err.message}`, true);
  }
}

async function saveTemplate() {
  const id = askId('Template id (e.g. ch2-warehouse-a):', '');
  if (!id) return;
  if (state.fileList.templates.includes(id) && !confirm(`Template "${id}" exists. Overwrite it?`)) return;
  try {
    await writeFile('templates', id, { ...jsonFromDoc(state.doc), id });
    toast(`Saved template src/levels/templates/${id}.json`);
  } catch (err) {
    toast(`Save failed: ${err.message}`, true);
  }
}

function newLevel() {
  if (!confirmDiscard()) return;
  const answer = prompt('Size in tiles (cols x rows):', '40x28');
  if (!answer) return;
  const [c, r] = answer.split(/[x×, ]+/).map(Number);
  if (!(c >= MIN_SIZE && r >= MIN_SIZE && c <= MAX_SIZE && r <= MAX_SIZE)) {
    toast(`Size must be ${MIN_SIZE}–${MAX_SIZE} on each side`, true);
    return;
  }
  loadBlank(c, r);
}

/** A fresh blank level has nothing worth losing, so it starts out "saved". */
function loadBlank(c, r) {
  const doc = blankDoc(c, r);
  loadDoc(doc, docText(doc));
}

function exportFile() {
  const blob = new Blob([docText(state.doc)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${state.doc.id || 'level'}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function importFile(file) {
  if (!file || !confirmDiscard()) return;
  try {
    loadDoc(docFromJson(JSON.parse(await file.text())), null);
    toast(`Imported ${file.name}`);
  } catch (err) {
    toast(`Import failed: ${err.message}`, true);
  }
}

function playtest() {
  const json = jsonFromDoc({ ...state.doc, id: state.doc.id || 'playtest' });
  const { errors } = validateLevel(json);
  if (errors.length) {
    toast(`Fix ${errors.length} error(s) before playtesting`, true);
    return;
  }
  localStorage.setItem(PLAYTEST_STORAGE_KEY, JSON.stringify(json));
  window.open('/?playtest=1', 'umbra-playtest');
}

// --- boot -----------------------------------------------------------------------

function buildToolbar() {
  toolsNav.innerHTML = TOOLS.map((tool) => {
    const swatch = tool.char && TILE_COLORS[tool.char] ? `<span class="swatch" style="background:${TILE_COLORS[tool.char]}"></span>` : '';
    return `<button data-tool="${tool.id}" title="${tool.label} (${tool.key.toUpperCase()})">${swatch}${tool.label}<kbd>${tool.key.toUpperCase()}</kbd></button>`;
  }).join('');
  toolsNav.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-tool]');
    if (btn) setTool(btn.dataset.tool);
  });
}

function bindTopbar() {
  const actions = {
    new: newLevel,
    save: () => save(),
    'save-as': () => save({ forceNewId: true }),
    'save-template': saveTemplate,
    import: () => importInput.click(),
    export: exportFile,
    undo,
    redo,
    playtest,
  };
  document.getElementById('topbar').addEventListener('click', (e) => {
    const action = e.target.closest('button[data-action]')?.dataset.action;
    if (action) actions[action]();
  });
  openSelect.addEventListener('focus', refreshFileList);
  openSelect.addEventListener('change', () => {
    const [kind, id] = openSelect.value.split(':');
    openSelect.value = '';
    if (id) openFile(kind, id);
  });
  importInput.addEventListener('change', () => {
    importFile(importInput.files[0]);
    importInput.value = '';
  });
}

function boot() {
  buildToolbar();
  bindTopbar();

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointerleave', () => {
    state.hover = null;
    render();
  });
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('resize', render);
  window.addEventListener('beforeunload', (e) => {
    if (isDirty()) e.preventDefault();
  });
  panel.addEventListener('change', onPanelChange);
  panel.addEventListener('click', onPanelClick);

  let draft = null;
  try {
    draft = JSON.parse(localStorage.getItem(DRAFT_KEY));
  } catch {
    draft = null;
  }
  if (draft?.doc?.tiles?.length) loadDoc(draft.doc, draft.savedText);
  else loadBlank();

  setTool('wall');
  refreshFileList();
}

boot();
