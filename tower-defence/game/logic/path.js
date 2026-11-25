// Path helpers: distance is measured in tiles walked along the path.

export function pathLength(path) {
  return Math.max(0, path.length - 1);
}

export function positionAt(path, distance) {
  if (path.length === 0) return { x: 0, y: 0 };
  const d = Math.min(Math.max(distance, 0), pathLength(path));
  const i = Math.min(Math.floor(d), path.length - 1);
  const a = path[i];
  const b = path[Math.min(i + 1, path.length - 1)];
  const f = d - i;
  return {
    x: a.x + (b.x - a.x) * f + 0.5,
    y: a.y + (b.y - a.y) * f + 0.5,
  };
}
