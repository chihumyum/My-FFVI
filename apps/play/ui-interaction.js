// One pointer/focus highlight survives at a time; late leave events cannot clear
// the new owner after a window has been hidden or its controls have moved.
export class SingleHover {
  constructor(changed = () => {}) {
    this.changed = changed;
    this.current = null;
  }
  enter(view) {
    if (view === this.current) return;
    if (this.current) this.current.hover = false;
    this.current = view;
    if (view) view.hover = true;
    this.changed();
  }
  leave(view) {
    if (view === this.current) this.enter(null);
  }
  clear() {
    if (this.current) this.enter(null);
  }
}

// Navigate the actual rendered controls; activation still calls their ordinary
// handlers. This adapter owns no game commands or battle strategy.
export function directionalControl(rows, current, key) {
  if (!rows.length) return null;
  const direction = {
    ArrowUp: [0, -1],
    w: [0, -1],
    ArrowDown: [0, 1],
    s: [0, 1],
    ArrowLeft: [-1, 0],
    a: [-1, 0],
    ArrowRight: [1, 0],
    d: [1, 0],
  }[key.length === 1 ? key.toLowerCase() : key];
  if (!direction) return null;
  const from = rows.find((row) => row.node === current);
  if (!from) return rows[0].node;
  const center = (row) => [row.x + row.width / 2, row.y + row.height / 2];
  const [x, y] = center(from),
    [dx, dy] = direction;
  const candidates = rows
    .filter((row) => row !== from)
    .map((row) => {
      const [nx, ny] = center(row),
        along = (nx - x) * dx + (ny - y) * dy;
      const across = Math.abs((nx - x) * dy - (ny - y) * dx);
      return { row, along, score: along + across * 3 };
    })
    .filter((row) => row.along > 1)
    .sort((a, b) => a.score - b.score);
  return candidates[0]?.row.node || current;
}
