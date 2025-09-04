import { Float3D, Grid, Mask3D, Structure, MarginResult, PerSideMargins } from './types';
import { expandGrid, copyMaskToGrid } from './grid';
import { initializeInfinityMapInside0, getJustOutsideVoxels, negateInside, InfinityVal } from './seeds';
import { distanceTransform3D } from './distanceTransform';

function cloneStructure(structure: Structure): Structure {
  return {
    grid: { ...structure.grid, origin: { ...structure.grid.origin } },
    mask: { values: new Uint8Array(structure.mask.values), grid: structure.grid }
  };
}

function thresholdToMask(dt: Float3D, grid: Grid, thresholdSq: number): Mask3D {
  const out = new Uint8Array(grid.xSize * grid.ySize * grid.zSize);
  for (let i = 0; i < dt.values.length; i++) {
    out[i] = dt.values[i] <= thresholdSq ? 1 : 0;
  }
  return { values: out, grid };
}

export function marginSymmetric(structure: Structure, marginMM: number, eclipseFudge: boolean = true): Structure {
  if (!structure?.mask?.values?.length || marginMM === 0) {
    return cloneStructure(structure);
  }

  const g = structure.grid;
  if (marginMM > 0 && eclipseFudge) {
    // Apply Eclipse fudge and redirect to asymmetric-like outer with equal per-axis
    const abs = Math.abs(marginMM);
    const leftRight = Math.max(g.xRes, abs + g.xRes / 2);
    const antPos = Math.max(g.yRes, abs + g.yRes / 2);
    const supInf = Math.max(g.zRes, abs + g.zRes / 2);
    return marginAsymmetric(structure, true, { post: antPos, ant: antPos, left: leftRight, right: leftRight, sup: supInf, inf: supInf }, false);
  }

  if (marginMM > 0) {
    // Outer: expand grid, inside=0, run DT, threshold <= r^2
    const extraX = Math.ceil(marginMM / g.xRes);
    const extraY = Math.ceil(marginMM / g.yRes);
    const extraZ = Math.ceil(marginMM / g.zRes);
    const eg = expandGrid(g, extraX, extraY, extraZ);
    const dt = initializeInfinityMapInside0(structure, eg);
    distanceTransform3D(dt, eg);
    const mask = thresholdToMask(dt, eg, marginMM * marginMM);
    return { grid: eg, mask };
  } else {
    // Inner (erosion): expand grid by 1 voxel band, ring seeds=0 outside, negate inside distances, threshold < -r^2
    const extraX = 1, extraY = 1, extraZ = 1;
    const eg = expandGrid(g, extraX, extraY, extraZ);
    const ring = getJustOutsideVoxels(structure, eg);
    const dt: Float3D = { values: new Float32Array(eg.xSize * eg.ySize * eg.zSize), grid: eg };
    for (let i = 0; i < dt.values.length; i++) dt.values[i] = ring[i] ? 0 : InfinityVal;
    distanceTransform3D(dt, eg);
    negateInside(dt, structure, eg);
    const thr = -marginMM * marginMM; // marginMM is negative
    const out = new Uint8Array(eg.xSize * eg.ySize * eg.zSize);
    for (let i = 0; i < dt.values.length; i++) out[i] = dt.values[i] < -thr ? 1 : 0;
    return { grid: eg, mask: { values: out, grid: eg } };
  }
}

export function marginAsymmetric(structure: Structure, isOuter: boolean, perSide: PerSideMargins, eclipseFudge: boolean = true): Structure {
  // NOTE: Forward-only asymmetric DT not implemented yet; approximate via symmetric anisotropic with max radius
  const g = structure.grid;
  const maxR = Math.max(perSide.left, perSide.right, perSide.post, perSide.ant, perSide.sup, perSide.inf);
  if (isOuter && eclipseFudge) {
    const leftRight = Math.max(g.xRes, maxR + g.xRes / 2);
    const antPos = Math.max(g.yRes, maxR + g.yRes / 2);
    const supInf = Math.max(g.zRes, maxR + g.zRes / 2);
    // fall through with updated maxR
  }
  // Use symmetric margin as placeholder (to be replaced with forward-only DT)
  return marginSymmetric(structure, Math.sign(isOuter ? 1 : -1) * maxR, false);
}


