import type { VIPStructure, VoxelIndexPair, MaskStructure } from './types';
import type { Grid } from '@/margins/types';
import { indexFromXY, xyFromIndex } from './types';

export function vipsToMask(vips: VoxelIndexPair[][][], grid: Grid): Uint8Array {
  const total = grid.xSize * grid.ySize * grid.zSize;
  const mask = new Uint8Array(total);
  for (let z = 0; z < grid.zSize; z++) {
    const plane = vips[z] || [];
    for (let y = 0; y < Math.min(plane.length, grid.ySize); y++) {
      const row = plane[y] || [];
      for (const p of row) {
        const { x, y: yy } = xyFromIndex(p.index, grid);
        if (yy !== y) continue; // safety
        for (let dx = 0; dx < p.length; dx++) {
          const xPos = x + dx;
          if (xPos < 0 || xPos >= grid.xSize) continue;
          const idx = xPos + y * grid.xSize + z * grid.xSize * grid.ySize;
          mask[idx] = 1;
        }
      }
    }
  }
  return mask;
}

export function maskToVips(mask: Uint8Array, grid: Grid): VoxelIndexPair[][][] {
  const vips: VoxelIndexPair[][][] = Array.from({ length: grid.zSize }, () => Array.from({ length: grid.ySize }, () => [] as VoxelIndexPair[]));
  for (let z = 0; z < grid.zSize; z++) {
    for (let y = 0; y < grid.ySize; y++) {
      let x = 0;
      while (x < grid.xSize) {
        const i = x + y * grid.xSize + z * grid.xSize * grid.ySize;
        if (mask[i]) {
          const start = x;
          while (x < grid.xSize) {
            const ii = x + y * grid.xSize + z * grid.xSize * grid.ySize;
            if (!mask[ii]) break;
            x++;
          }
          const length = x - start;
          vips[z][y].push({ index: indexFromXY(start, y, grid), length });
        } else {
          x++;
        }
      }
    }
  }
  return vips;
}

export function toMaskStructure(vip: VIPStructure): MaskStructure {
  return { grid: vip.grid, mask: vipsToMask(vip.vips, vip.grid) };
}


