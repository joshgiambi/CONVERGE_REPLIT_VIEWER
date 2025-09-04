import { Grid, Structure, Mask3D } from './types';

function computeBounds(contours: Array<{ points: number[]; slicePosition: number }>) {
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  for (const c of contours) {
    const pts = c.points;
    for (let i = 0; i < pts.length; i += 3) {
      const x = pts[i];
      const y = pts[i + 1];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    if (c.slicePosition < minZ) minZ = c.slicePosition;
    if (c.slicePosition > maxZ) maxZ = c.slicePosition;
  }
  return { minX, maxX, minY, maxY, minZ, maxZ };
}

export function contoursToStructure(
  contours: Array<{ points: number[]; slicePosition: number }>,
  pixelSpacing: [number, number, number],
  paddingMm: number
): Structure {
  const { minX, maxX, minY, maxY, minZ, maxZ } = computeBounds(contours);
  const [xRes, yRes, zRes] = pixelSpacing;
  const padX = Math.ceil(paddingMm / xRes);
  const padY = Math.ceil(paddingMm / yRes);
  const padZ = Math.ceil(paddingMm / zRes);
  const xSize = Math.max(1, Math.ceil((maxX - minX) / xRes) + 1 + 2 * padX);
  const ySize = Math.max(1, Math.ceil((maxY - minY) / yRes) + 1 + 2 * padY);
  const zSize = Math.max(1, Math.ceil((maxZ - minZ) / zRes) + 1 + 2 * padZ);
  const origin = {
    x: minX - padX * xRes,
    y: minY - padY * yRes,
    z: minZ - padZ * zRes
  };
  const grid: Grid = { xSize, ySize, zSize, xRes, yRes, zRes, origin };
  const mask = new Uint8Array(xSize * ySize * zSize);

  // Rasterize each contour into the grid using scanline fill
  for (const c of contours) {
    const zIndex = Math.round((c.slicePosition - origin.z) / zRes);
    if (zIndex < 0 || zIndex >= zSize) continue;
    // Convert to grid coordinates
    const poly: [number, number][] = [];
    const pts = c.points;
    for (let i = 0; i < pts.length; i += 3) {
      const gx = (pts[i] - origin.x) / xRes;
      const gy = (pts[i + 1] - origin.y) / yRes;
      poly.push([gx, gy]);
    }
    if (poly.length < 3) continue;
    const minYg = Math.floor(Math.min(...poly.map(p => p[1])));
    const maxYg = Math.ceil(Math.max(...poly.map(p => p[1])));
    for (let gy = minYg; gy <= maxYg; gy++) {
      if (gy < 0 || gy >= ySize) continue;
      const xs: number[] = [];
      for (let i = 0; i < poly.length; i++) {
        const p1 = poly[i];
        const p2 = poly[(i + 1) % poly.length];
        if ((p1[1] <= gy && p2[1] > gy) || (p2[1] <= gy && p1[1] > gy)) {
          const x = p1[0] + (gy - p1[1]) * (p2[0] - p1[0]) / (p2[1] - p1[1]);
          xs.push(x);
        }
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k < xs.length - 1; k += 2) {
        const x1 = Math.max(0, Math.floor(xs[k]));
        const x2 = Math.min(xSize - 1, Math.ceil(xs[k + 1]));
        const rowOff = zIndex * xSize * ySize + gy * xSize;
        for (let gx = x1; gx <= x2; gx++) mask[rowOff + gx] = 1;
      }
    }
  }
  return { grid, mask: { values: mask, grid } };
}

export function structureToContours(
  mask: Mask3D,
  originalSlicePositions: number[],
  toleranceMm?: number,
  includeNewSlices: boolean = true
) : Array<{ points: number[]; slicePosition: number }> {
  const { grid } = mask;
  const contours: Array<{ points: number[]; slicePosition: number }> = [];
  const eps = typeof toleranceMm === 'number' ? toleranceMm : Math.max(grid.zRes * 0.4, 0.1);
  const sliceSet = Array.from(new Set(originalSlicePositions)).sort((a, b) => a - b);
  const used = new Set<number>();
  const xy = grid.xSize * grid.ySize;
  for (let zi = 0; zi < grid.zSize; zi++) {
    const zWorld = grid.origin.z + zi * grid.zRes;
    // Find nearest unmatched slice within tolerance
    let matchedZ: number | undefined = undefined;
    let bestDelta = Infinity;
    for (const z of sliceSet) {
      if (used.has(z)) continue;
      const d = Math.abs(z - zWorld);
      if (d <= eps && d < bestDelta) { bestDelta = d; matchedZ = z; }
    }
    if (matchedZ === undefined && !includeNewSlices) continue;
    const targetZ = matchedZ !== undefined ? matchedZ : zWorld;
    if (matchedZ !== undefined) used.add(matchedZ);
    const slice = mask.values.subarray(zi * xy, zi * xy + xy);
    // Moore-neighbor boundary tracing; gather all contours and pick the largest
    const visited = new Uint8Array(slice.length);
    const contoursOnSlice: number[][] = [];
    const neighbors = [
      [1, 0], [1, 1], [0, 1], [-1, 1],
      [-1, 0], [-1, -1], [0, -1], [1, -1]
    ];

    for (let sy = 1; sy < grid.ySize - 1; sy++) {
      for (let sx = 1; sx < grid.xSize - 1; sx++) {
        const si = sx + sy * grid.xSize;
        if (slice[si] !== 1 || visited[si]) continue;
        // start boundary only if neighbor has background
        if (slice[si - 1] && slice[si + 1] && slice[si - grid.xSize] && slice[si + grid.xSize]) continue;

        let cx = sx, cy = sy;
        let dir = 0; // initial direction
        const chain: number[] = [];
        const maxSteps = slice.length * 4;

        for (let steps = 0; steps < maxSteps; steps++) {
          const idxPix = cx + cy * grid.xSize;
          if (!visited[idxPix]) {
            visited[idxPix] = 1;
            const wx = grid.origin.x + cx * grid.xRes;
            const wy = grid.origin.y + cy * grid.yRes;
            chain.push(wx, wy, targetZ);
          }
          // find next boundary neighbor, prefer turning left
          let moved = false;
          for (let i = 0; i < 8; i++) {
            const nd = (dir + 7 + i) % 8; // bias to left-hand rule
            const nx = cx + neighbors[nd][0];
            const ny = cy + neighbors[nd][1];
            if (nx <= 0 || nx >= grid.xSize - 1 || ny <= 0 || ny >= grid.ySize - 1) continue;
            const nidx = nx + ny * grid.xSize;
            if (slice[nidx] === 1) {
              cx = nx; cy = ny; dir = nd; moved = true; break;
            }
          }
          if (!moved || (cx === sx && cy === sy)) break;
        }
        if (chain.length >= 9) contoursOnSlice.push(chain);
      }
    }

    if (contoursOnSlice.length > 0) {
      // pick the largest by area (shoelace)
      let best = contoursOnSlice[0];
      let bestArea = -Infinity;
      for (const c of contoursOnSlice) {
        let area = 0;
        for (let i = 0; i < c.length; i += 3) {
          const j = (i + 3) % c.length;
          area += c[i] * c[j + 1] - c[j] * c[i + 1];
        }
        area = Math.abs(area) * 0.5;
        if (area > bestArea) { bestArea = area; best = c; }
      }
      contours.push({ points: best, slicePosition: targetZ });
    }
  }
  return contours;
}


