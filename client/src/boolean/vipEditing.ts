import type { Grid } from '@/margins/types';
import type { VoxelIndexPair, VIPStructure } from './types';
import { mergeIndexPairs, subtractVoxelIndexPairs, getOverlappingVoxelIndexPairs } from './vipHelpers';

export function updateAddToTransverseSlice(struct: VIPStructure, zIndex: number, rows: VoxelIndexPair[][]): void {
  const grid = struct.grid as Grid;
  const plane = struct.vips[zIndex] || (struct.vips[zIndex] = Array.from({ length: grid.ySize }, () => []));
  for (let y = 0; y < Math.min(rows.length, grid.ySize); y++) {
    if (!rows[y] || rows[y].length === 0) continue;
    const merged = mergeIndexPairs([...(plane[y] || []), ...rows[y]], grid);
    plane[y] = merged;
  }
}

export function updateSubtractFromTransverseSlice(struct: VIPStructure, zIndex: number, rows: VoxelIndexPair[][]): void {
  const grid = struct.grid as Grid;
  const plane = struct.vips[zIndex] || (struct.vips[zIndex] = Array.from({ length: grid.ySize }, () => []));
  for (let y = 0; y < Math.min(rows.length, grid.ySize); y++) {
    const toSubtract = rows[y] || [];
    if (toSubtract.length === 0) continue;
    const updated = subtractVoxelIndexPairs(plane[y] || [], toSubtract);
    plane[y] = updated;
  }
}

export function clearStructureFromPlane(struct: VIPStructure, zIndex: number): void {
  const grid = struct.grid as Grid;
  struct.vips[zIndex] = Array.from({ length: grid.ySize }, () => []);
}

export function computeIntersectionPlane(aPlane: VoxelIndexPair[][], bPlane: VoxelIndexPair[][], grid: Grid): VoxelIndexPair[][] {
  const rows: VoxelIndexPair[][] = Array.from({ length: grid.ySize }, () => []);
  for (let y = 0; y < grid.ySize; y++) {
    const row = getOverlappingVoxelIndexPairs(aPlane[y] || [], bPlane[y] || []);
    rows[y] = mergeIndexPairs(row, grid);
  }
  return rows;
}


