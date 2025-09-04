import type { MaskStructure } from './types';
import type { Grid } from '@/margins/types';

export function unionMask(a: MaskStructure, b: MaskStructure): MaskStructure {
  if (!sameGrid(a.grid, b.grid)) throw new Error('Grid mismatch');
  const out = new Uint8Array(a.mask.length);
  const A = a.mask, B = b.mask;
  for (let i = 0; i < out.length; i++) out[i] = (A[i] | B[i]) & 1;
  return { grid: a.grid, mask: out };
}

export function intersectMask(a: MaskStructure, b: MaskStructure): MaskStructure {
  if (!sameGrid(a.grid, b.grid)) throw new Error('Grid mismatch');
  const out = new Uint8Array(a.mask.length);
  const A = a.mask, B = b.mask;
  for (let i = 0; i < out.length; i++) out[i] = (A[i] & B[i]) & 1;
  return { grid: a.grid, mask: out };
}

export function subtractMask(a: MaskStructure, b: MaskStructure): MaskStructure {
  if (!sameGrid(a.grid, b.grid)) throw new Error('Grid mismatch');
  const out = new Uint8Array(a.mask.length);
  const A = a.mask, B = b.mask;
  for (let i = 0; i < out.length; i++) out[i] = (A[i] & (B[i] ^ 1)) & 1;
  return { grid: a.grid, mask: out };
}

function sameGrid(g1: Grid, g2: Grid): boolean {
  return g1.xSize === g2.xSize && g1.ySize === g2.ySize && g1.zSize === g2.zSize;
}


