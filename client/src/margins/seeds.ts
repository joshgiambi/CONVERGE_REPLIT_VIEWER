import { Float3D, Grid, Mask3D, Structure, idx } from './types';

export const InfinityVal = 9e21;

export function initializeInfinityMapInside0(structure: Structure, expandedGrid: Grid): Float3D {
  const values = new Float32Array(expandedGrid.xSize * expandedGrid.ySize * expandedGrid.zSize);
  values.fill(InfinityVal);
  const src = structure.mask.values;
  const sg = structure.grid;
  for (let z = 0; z < expandedGrid.zSize; z++) {
    for (let y = 0; y < expandedGrid.ySize; y++) {
      for (let x = 0; x < expandedGrid.xSize; x++) {
        // Map to source grid
        const sx = x - Math.round((sg.origin.x - expandedGrid.origin.x) / sg.xRes);
        const sy = y - Math.round((sg.origin.y - expandedGrid.origin.y) / sg.yRes);
        const sz = z - Math.round((sg.origin.z - expandedGrid.origin.z) / sg.zRes);
        if (sx >= 0 && sx < sg.xSize && sy >= 0 && sy < sg.ySize && sz >= 0 && sz < sg.zSize) {
          if (src[idx(sx, sy, sz, sg)] === 1) {
            values[idx(x, y, z, expandedGrid)] = 0; // inside is zero
          }
        }
      }
    }
  }
  return { values, grid: expandedGrid };
}

export function getJustOutsideVoxels(structure: Structure, expandedGrid: Grid): Uint8Array {
  // Simple 6-neighborhood ring around inside voxels
  const out = new Uint8Array(expandedGrid.xSize * expandedGrid.ySize * expandedGrid.zSize);
  const inside = initializeInfinityMapInside0(structure, expandedGrid);
  for (let z = 0; z < expandedGrid.zSize; z++) {
    for (let y = 0; y < expandedGrid.ySize; y++) {
      for (let x = 0; x < expandedGrid.xSize; x++) {
        const i = idx(x, y, z, expandedGrid);
        if (inside.values[i] === 0) {
          const n = [
            [x + 1, y, z], [x - 1, y, z],
            [x, y + 1, z], [x, y - 1, z],
            [x, y, z + 1], [x, y, z - 1]
          ];
          for (const [nx, ny, nz] of n) {
            if (nx >= 0 && nx < expandedGrid.xSize && ny >= 0 && ny < expandedGrid.ySize && nz >= 0 && nz < expandedGrid.zSize) {
              out[idx(nx, ny, nz, expandedGrid)] = 1;
            }
          }
        }
      }
    }
  }
  return out;
}

export function negateInside(dt: Float3D, structure: Structure, expandedGrid: Grid): void {
  const sg = structure.grid;
  const src = structure.mask.values;
  for (let z = 0; z < expandedGrid.zSize; z++) {
    for (let y = 0; y < expandedGrid.ySize; y++) {
      for (let x = 0; x < expandedGrid.xSize; x++) {
        const sx = x - Math.round((sg.origin.x - expandedGrid.origin.x) / sg.xRes);
        const sy = y - Math.round((sg.origin.y - expandedGrid.origin.y) / sg.yRes);
        const sz = z - Math.round((sg.origin.z - expandedGrid.origin.z) / sg.zRes);
        if (sx >= 0 && sx < sg.xSize && sy >= 0 && sy < sg.ySize && sz >= 0 && sz < sg.zSize) {
          if (src[idx(sx, sy, sz, sg)] === 1) {
            dt.values[idx(x, y, z, expandedGrid)] *= -1;
          }
        }
      }
    }
  }
}


