import type { VIPStructure, VoxelIndexPair } from './types';
import type { Grid } from '@/margins/types';
import { cloneVIP } from './types';
import { updateAddToTransverseSlice, updateSubtractFromTransverseSlice, clearStructureFromPlane, computeIntersectionPlane } from './vipEditing';

export function union(a: VIPStructure, b: VIPStructure): VIPStructure {
  if (!sameGrid(a.grid, b.grid)) throw new Error('Grid mismatch');
  const out = cloneVIP(a);
  const grid = a.grid as Grid;
  for (let z = 0; z < grid.zSize; z++) {
    const rows = b.vips[z] || [];
    if (!rows.some(r => r && r.length)) continue;
    updateAddToTransverseSlice(out, z, rows);
  }
  return out;
}

export function intersect(a: VIPStructure, b: VIPStructure): VIPStructure {
  if (!sameGrid(a.grid, b.grid)) throw new Error('Grid mismatch');
  const grid = a.grid as Grid;
  const out: VIPStructure = { grid, vips: Array.from({ length: grid.zSize }, () => Array.from({ length: grid.ySize }, () => [] as VoxelIndexPair[])) };
  for (let z = 0; z < grid.zSize; z++) {
    const aPlane = a.vips[z] || [];
    const bPlane = b.vips[z] || [];
    if (!bPlane.some(r => r && r.length)) {
      clearStructureFromPlane(out, z);
    } else {
      const rows = computeIntersectionPlane(aPlane, bPlane, grid);
      updateAddToTransverseSlice(out, z, rows);
    }
  }
  return out;
}

export function subtract(a: VIPStructure, b: VIPStructure): VIPStructure {
  if (!sameGrid(a.grid, b.grid)) throw new Error('Grid mismatch');
  const out = cloneVIP(a);
  const grid = a.grid as Grid;
  for (let z = 0; z < grid.zSize; z++) {
    const rows = b.vips[z] || [];
    if (!rows.some(r => r && r.length)) continue;
    updateSubtractFromTransverseSlice(out, z, rows);
  }
  return out;
}

function sameGrid(g1: Grid, g2: Grid): boolean {
  return g1.xSize === g2.xSize && g1.ySize === g2.ySize && g1.zSize === g2.zSize;
}


