import type { Grid } from '@/margins/types';

// Simple even-odd fill scanline rasterization for one polygon (no holes)
export function rasterizePolygonToMask(points: number[], grid: Grid): Uint8Array {
  const mask = new Uint8Array(grid.xSize * grid.ySize);
  if (!points || points.length < 9) return mask;
  const verts: [number, number][] = [];
  for (let i = 0; i < points.length; i += 3) verts.push([points[i], points[i + 1]]);
  if (verts.length < 3) return mask;

  // For now, assume world == grid coordinates already; in practice convert using image spacing/origin
  for (let y = 0; y < grid.ySize; y++) {
    const scanY = y + 0.5;
    const xs: number[] = [];
    for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
      const [x1, y1] = verts[j];
      const [x2, y2] = verts[i];
      const minY = Math.min(y1, y2);
      const maxY = Math.max(y1, y2);
      if (scanY <= minY || scanY > maxY) continue;
      const t = (scanY - y1) / (y2 - y1);
      const x = x1 + t * (x2 - x1);
      xs.push(x);
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      let xStart = Math.floor(Math.min(xs[k], xs[k + 1]));
      let xEnd = Math.ceil(Math.max(xs[k], xs[k + 1]));
      xStart = Math.max(0, xStart);
      xEnd = Math.min(grid.xSize, xEnd);
      for (let x = xStart; x < xEnd; x++) {
        const idx = x + y * grid.xSize;
        mask[idx] = 1;
      }
    }
  }
  return mask;
}

export function rasterizeContoursToMask(contours: { slicePosition: number; points: number[] }[], grid: Grid): { zIndex: number; mask: Uint8Array }[] {
  const result: { zIndex: number; mask: Uint8Array }[] = [];
  for (const c of contours) {
    const zIndex = Math.round(c.slicePosition); // assume 1mm spacing; adapt as needed
    const mask = rasterizePolygonToMask(c.points, grid);
    result.push({ zIndex, mask });
  }
  return result;
}


