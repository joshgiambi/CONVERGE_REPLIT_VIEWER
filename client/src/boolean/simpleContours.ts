import type { VIPStructure, VoxelIndexPair } from './types';
import type { Grid } from '@/margins/types';

export function vipToRectContours(vip: VIPStructure): { slicePosition: number; points: number[] }[] {
  const out: { slicePosition: number; points: number[] }[] = [];
  const grid = vip.grid as Grid;
  for (let z = 0; z < Math.min(vip.vips.length, grid.zSize); z++) {
    const plane = vip.vips[z] || [];
    for (let y = 0; y < Math.min(plane.length, grid.ySize); y++) {
      const row = plane[y] || [];
      for (const p of row) {
        const xStart = p.index - y * grid.xSize;
        const xEnd = xStart + p.length;
        const yTop = y;
        const yBottom = y + 1;
        // Rectangle polygon
        const pts = [
          xStart, yTop, z,
          xEnd, yTop, z,
          xEnd, yBottom, z,
          xStart, yBottom, z
        ];
        out.push({ slicePosition: z, points: pts });
      }
    }
  }
  return out;
}


