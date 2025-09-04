export interface Grid {
  xSize: number;
  ySize: number;
  zSize: number;
  xRes: number; // mm per voxel in X (columns)
  yRes: number; // mm per voxel in Y (rows)
  zRes: number; // mm per slice in Z
  origin: { x: number; y: number; z: number };
  xDir?: [number, number, number];
  yDir?: [number, number, number];
  zDir?: [number, number, number];
}

export interface Mask3D {
  values: Uint8Array; // length = x*y*z, 1=in, 0=out
  grid: Grid;
}

export interface Float3D {
  values: Float32Array;
  grid: Grid;
}

export interface Structure {
  grid: Grid;
  mask: Mask3D;
}

export type PerSideMargins = {
  post: number; // +Y
  ant: number;  // -Y
  left: number; // +X
  right: number;// -X
  sup: number;  // +Z
  inf: number;  // -Z
}

export type MarginRequest =
  | { mode: 'symmetric'; marginMM: number; eclipseFudge?: boolean }
  | { mode: 'asymmetric'; isOuter: boolean; perSide: PerSideMargins; eclipseFudge?: boolean };

export interface MarginResult {
  mask: Mask3D;
  grid: Grid;
}

export function idx(x: number, y: number, z: number, grid: Grid): number {
  return x + y * grid.xSize + z * grid.xSize * grid.ySize;
}


