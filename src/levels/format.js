/**
 * Serializes a level for saving. Like JSON.stringify(v, null, 2) but keeps
 * flat arrays/objects (e.g. waypoints) on one line, and puts each tile row on
 * its own line so the map reads as a picture in diffs and code review.
 */
export function formatLevelJson(level) {
  return `${format(level, '', null)}\n`;
}

function format(value, indent, key) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);

  const isArray = Array.isArray(value);
  const entries = isArray
    ? value.map((item) => [null, item])
    : Object.entries(value).filter(([, item]) => item !== undefined);
  const [open, close] = isArray ? ['[', ']'] : ['{', '}'];
  if (entries.length === 0) return open + close;

  const label = (k) => (k === null ? '' : `${JSON.stringify(k)}: `);
  const flat = entries.every(([, item]) => item === null || typeof item !== 'object');
  if (flat && key !== 'tiles') {
    return open + entries.map(([k, item]) => label(k) + JSON.stringify(item)).join(', ') + close;
  }

  const inner = `${indent}  `;
  const lines = entries.map(([k, item]) => inner + label(k) + format(item, inner, k ?? key));
  return `${open}\n${lines.join(',\n')}\n${indent}${close}`;
}
