import type { VIPStructure, VoxelIndexPair } from './types';
import type { Grid } from '@/margins/types';
import { rasterizePolygonToMask } from './raster';

export function contoursToVIP(structure: any, grid: Grid): VIPStructure {
  const vips: VoxelIndexPair[][][] = Array.from({ length: grid.zSize }, () => Array.from({ length: grid.ySize }, () => [] as VoxelIndexPair[]));
  if (!structure?.contours) return { grid, vips };
  for (const c of structure.contours) {
    if (!c?.points || c.points.length < 9 || typeof c.slicePosition !== 'number') continue;
    const z = Math.round(c.slicePosition);
    if (z < 0 || z >= grid.zSize) continue;
    const mask2D = rasterizePolygonToMask(c.points, grid);
    for (let y = 0; y < grid.ySize; y++) {
      let x = 0;
      while (x < grid.xSize) {
        const idx = x + y * grid.xSize;
        if (mask2D[idx]) {
          const start = x;
          while (x < grid.xSize && mask2D[x + y * grid.xSize]) x++;
          const length = x - start;
          const index = y * grid.xSize + start;
          vips[z][y].push({ index, length });
        } else {
          x++;
        }
      }
    }
  }
  return { grid, vips };
}

export function contoursToVIPWithZMap(structure: any, grid: Grid): { vip: VIPStructure; zMap: Map<number, number> } {
  const vips: VoxelIndexPair[][][] = Array.from({ length: grid.zSize }, () => Array.from({ length: grid.ySize }, () => [] as VoxelIndexPair[]));
  const zMap = new Map<number, number>();
  if (!structure?.contours) return { vip: { grid, vips }, zMap };
  for (const c of structure.contours) {
    if (!c?.points || c.points.length < 9 || typeof c.slicePosition !== 'number') continue;
    const zIdx = Math.round(c.slicePosition);
    if (zIdx < 0 || zIdx >= grid.zSize) continue;
    if (!zMap.has(zIdx)) zMap.set(zIdx, c.slicePosition);
    const mask2D = rasterizePolygonToMask(c.points, grid);
    for (let y = 0; y < grid.ySize; y++) {
      let x = 0;
      while (x < grid.xSize) {
        const idx = x + y * grid.xSize;
        if (mask2D[idx]) {
          const start = x;
          while (x < grid.xSize && mask2D[x + y * grid.xSize]) x++;
          const length = x - start;
          const index = y * grid.xSize + start;
          vips[zIdx][y].push({ index, length });
        } else {
          x++;
        }
      }
    }
  }
  return { vip: { grid, vips }, zMap };
}


