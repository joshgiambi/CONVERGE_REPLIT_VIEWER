import { Grid, Mask3D, Structure, idx } from './types';

export function cloneGrid(g: Grid): Grid {
  return { ...g, origin: { ...g.origin }, xDir: g.xDir, yDir: g.yDir, zDir: g.zDir };
}

export function expandGrid(grid: Grid, extraX: number, extraY: number, extraZ: number, limitTo?: Grid): Grid {
  const xSize = grid.xSize + extraX * 2;
  const ySize = grid.ySize + extraY * 2;
  const zSize = grid.zSize + extraZ * 2;
  const origin = {
    x: grid.origin.x - extraX * grid.xRes,
    y: grid.origin.y - extraY * grid.yRes,
    z: grid.origin.z - extraZ * grid.zRes
  };
  return {
    xSize: Math.max(1, xSize),
    ySize: Math.max(1, ySize),
    zSize: Math.max(1, zSize),
    xRes: grid.xRes,
    yRes: grid.yRes,
    zRes: grid.zRes,
    origin,
    xDir: grid.xDir,
    yDir: grid.yDir,
    zDir: grid.zDir
  };
}

export function clampToGrid(x: number, y: number, z: number, grid: Grid): boolean {
  return x >= 0 && x < grid.xSize && y >= 0 && y < grid.ySize && z >= 0 && z < grid.zSize;
}

export function copyMaskToGrid(source: Structure, targetGrid: Grid): Mask3D {
  const out = new Uint8Array(targetGrid.xSize * targetGrid.ySize * targetGrid.zSize);
  const src = source.mask.values;
  const sg = source.grid;
  for (let z = 0; z < sg.zSize; z++) {
    for (let y = 0; y < sg.ySize; y++) {
      for (let x = 0; x < sg.xSize; x++) {
        const sx = x + Math.round((sg.origin.x - targetGrid.origin.x) / sg.xRes);
        const sy = y + Math.round((sg.origin.y - targetGrid.origin.y) / sg.yRes);
        const sz = z + Math.round((sg.origin.z - targetGrid.origin.z) / sg.zRes);
        if (clampToGrid(sx, sy, sz, targetGrid)) {
          out[idx(sx, sy, sz, targetGrid)] = src[idx(x, y, z, sg)];
        }
      }
    }
  }
  return { values: out, grid: targetGrid };
}


