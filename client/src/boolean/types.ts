import type { Grid } from '@/margins/types';

export interface VoxelIndexPair {
  // Encodes a contiguous run on a single row (y) of voxels starting at xStart
  // Using index and length for parity with C#: index = y * xSize + xStart
  index: number;
  length: number;
}

// VIP volume representation: per z, per y, list of runs
// Dimensions: vips[z][y] = VoxelIndexPair[]
export interface VIPStructure {
  grid: Grid;
  vips: VoxelIndexPair[][][];
}

export interface MaskStructure {
  grid: Grid;
  // Packed XYZ with row-major index: x + y*xSize + z*xSize*ySize
  mask: Uint8Array;
}

export type BooleanOp = 'union' | 'intersect' | 'subtract' | 'xor';

export function xyFromIndex(index: number, grid: Grid): { x: number; y: number } {
  const rowIndex = Math.floor(index);
  const y = Math.floor(rowIndex / grid.xSize);
  const x = rowIndex - y * grid.xSize;
  return { x, y };
}

export function indexFromXY(x: number, y: number, grid: Grid): number {
  return y * grid.xSize + x;
}

export function cloneVIP(v: VIPStructure): VIPStructure {
  return {
    grid: v.grid,
    vips: v.vips.map(plane => plane.map(row => row.map(p => ({ index: p.index, length: p.length })) ))
  };
}


