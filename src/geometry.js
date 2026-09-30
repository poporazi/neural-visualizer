/** Clip wx*x + wy*y = target to a square viewport. Coordinates are data values. */
export function clipThresholdLine(weightX, weightY, target, min = -.25, max = 1.25) {
  const points = [];
  const add = (x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < min - 1e-9 || x > max + 1e-9 || y < min - 1e-9 || y > max + 1e-9) return;
    if (!points.some((point) => Math.abs(point[0] - x) < 1e-8 && Math.abs(point[1] - y) < 1e-8)) points.push([x, y]);
  };
  if (Math.abs(weightY) > 1e-12) {
    add(min, (target - weightX * min) / weightY);
    add(max, (target - weightX * max) / weightY);
  }
  if (Math.abs(weightX) > 1e-12) {
    add((target - weightY * min) / weightX, min);
    add((target - weightY * max) / weightX, max);
  }
  const degenerate = Math.abs(weightX) < 1e-12 && Math.abs(weightY) < 1e-12 && Math.abs(target) < 1e-12;
  return { points: degenerate ? [] : points.slice(0, 2), degenerate };
}
