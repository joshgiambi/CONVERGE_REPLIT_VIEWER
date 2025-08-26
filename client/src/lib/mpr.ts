// Minimal, correct MPR scaffolding with proper IOP/IPP support
import { Vec3, buildImageXform, dot, sub, cross } from './dicom-geometry';

export interface AxialSlice {
  cols: number;
  rows: number;
  huPixels: Float32Array; // length = rows*cols, row-major: v*cols + u
  meta: {
    pixelSpacing: string;              // dr\dc
    imagePositionPatient: string;      // IPP
    imageOrientationPatient: string;   // IOP (row, col)
  };
}

export interface VolumeGeom {
  originLPS: Vec3;     // world of voxel (0,0,0)
  M_i2w: number[][];   // 3x3 mapping voxel delta (j,i,k) → world (mm)
  M_w2i: number[][];   // inverse 3x3
  dims: { nx: number; ny: number; nz: number }; // (cols, rows, slices)
}

// simple 3x3 inverse for orthonormal-ish matrices
function invert3(m: number[][]): number[][] {
  const [a,b,c] = m;
  const det =
    a[0]*(b[1]*c[2]-b[2]*c[1]) -
    a[1]*(b[0]*c[2]-b[2]*c[0]) +
    a[2]*(b[0]*c[1]-b[1]*c[0]);
  const invDet = 1/det;
  const r00 =  (b[1]*c[2]-b[2]*c[1])*invDet;
  const r01 = -(a[1]*c[2]-a[2]*c[1])*invDet;
  const r02 =  (a[1]*b[2]-a[2]*b[1])*invDet;
  const r10 = -(b[0]*c[2]-b[2]*c[0])*invDet;
  const r11 =  (a[0]*c[2]-a[2]*c[0])*invDet;
  const r12 = -(a[0]*b[2]-a[2]*b[0])*invDet;
  const r20 =  (b[0]*c[1]-b[1]*c[0])*invDet;
  const r21 = -(a[0]*c[1]-a[1]*c[0])*invDet;
  const r22 =  (a[0]*b[1]-a[1]*b[0])*invDet;
  return [[r00,r01,r02],[r10,r11,r12],[r20,r21,r22]];
}

function mul3x3v(m:number[][], v:[number,number,number]): [number,number,number] {
  return [
    m[0][0]*v[0] + m[0][1]*v[1] + m[0][2]*v[2],
    m[1][0]*v[0] + m[1][1]*v[1] + m[1][2]*v[2],
    m[2][0]*v[0] + m[2][1]*v[1] + m[2][2]*v[2],
  ];
}

export function buildAxialVolumeGeom(sortedSlices: AxialSlice[]): VolumeGeom {
  if (!sortedSlices.length) throw new Error('No slices');

  // Use first slice for in-plane geometry
  const first = sortedSlices[0];
  const g0 = buildImageXform({
    rows: first.rows,
    cols: first.cols,
    pixelSpacing: first.meta.pixelSpacing,
    imagePositionPatient: first.meta.imagePositionPatient,
    imageOrientationPatient: first.meta.imageOrientationPatient,
  });
  const { R, C, N, dr, dc, IPP } = g0;

  // Compute slice order along normal using slicePosition scalar
  const slicers = sortedSlices
    .map((s, k) => ({
      k,
      z: buildImageXform({
        rows: s.rows,
        cols: s.cols,
        pixelSpacing: s.meta.pixelSpacing,
        imagePositionPatient: s.meta.imagePositionPatient,
        imageOrientationPatient: s.meta.imageOrientationPatient,
      }).slicePositionScalar(),
    }))
    .sort((a,b) => a.z - b.z);

  // Slice spacing dz from median inter-slice distance
  const dzList: number[] = [];
  for (let i=1;i<slicers.length;i++) dzList.push(slicers[i].z - slicers[i-1].z);
  const dz = dzList.length ? dzList.sort((a,b)=>a-b)[Math.floor(dzList.length/2)] : 1.0;

  const nz = slicers.length;
  const nx = first.cols;
  const ny = first.rows;

  // World of voxel (0,0,0) = IPP of first slice
  const originLPS: Vec3 = IPP;

  // Note: voxel index order (i,j,k) = (col, row, slice)
  // M_i2w columns are basis vectors in world for +i, +j, +k steps:
  // +i (cols) => dc * C, +j (rows) => dr * R, +k (slices) => dz * N
  const M_i2w = [
    [dc*C[0], dr*R[0], dz*N[0]],
    [dc*C[1], dr*R[1], dz*N[1]],
    [dc*C[2], dr*R[2], dz*N[2]],
  ];
  const M_w2i = invert3(M_i2w);

  return { originLPS, M_i2w, M_w2i, dims: { nx, ny, nz } };
}

/** Nearest-neighbor plane sampling.
 * plane: originW + u*Udir + v*Vdir; out size (nu, nv) with spacings (su, sv)
 */
export function samplePlaneNearest(
  vol: VolumeGeom,
  getVoxelHU: (i:number, j:number, k:number)=>number, // supply accessor to your 3D data
  planeOriginW: Vec3,
  UdirW: Vec3, VdirW: Vec3,
  su: number, sv: number,
  nu: number, nv: number,
): Float32Array {
  const out = new Float32Array(nu*nv);
  for (let v=0; v<nv; v++) {
    for (let u=0; u<nu; u++) {
      const world: Vec3 = [
        planeOriginW[0] + u*su*UdirW[0] + v*sv*VdirW[0],
        planeOriginW[1] + u*su*UdirW[1] + v*sv*VdirW[1],
        planeOriginW[2] + u*su*UdirW[2] + v*sv*VdirW[2],
      ];
      // world → index
      const d: Vec3 = [world[0]-vol.originLPS[0], world[1]-vol.originLPS[1], world[2]-vol.originLPS[2]];
      const ijk = mul3x3v(vol.M_w2i, [d[0], d[1], d[2]]);
      const i = Math.round(ijk[0]); // col
      const j = Math.round(ijk[1]); // row
      const k = Math.round(ijk[2]); // slice

      if (i>=0 && i<vol.dims.nx && j>=0 && j<vol.dims.ny && k>=0 && k<vol.dims.nz) {
        out[v*nu + u] = getVoxelHU(i,j,k);
      } else {
        out[v*nu + u] = -1024; // air
      }
    }
  }
  return out;
}

/** Helpers for sagittal / coronal planes around a crosshair (in voxel indices at current axial) */
export function sagittalPlaneAxes(vol: VolumeGeom) {
  // Sagittal plane axes (U along C/AP, V along N/SI), plane is constant LR (R axis)
  // UdirW = unit(C), VdirW = unit(N)
  const C = [vol.M_i2w[0][0], vol.M_i2w[1][0], vol.M_i2w[2][0]] as Vec3;
  const R = [vol.M_i2w[0][1], vol.M_i2w[1][1], vol.M_i2w[2][1]] as Vec3;
  const N = [vol.M_i2w[0][2], vol.M_i2w[1][2], vol.M_i2w[2][2]] as Vec3;
  const norm = (v:Vec3)=>{const L=Math.hypot(v[0],v[1],v[2]); return [v[0]/L,v[1]/L,v[2]/L] as Vec3;};
  return { UdirW: norm(C), VdirW: norm(N), LRdirW: norm(R) };
}

export function coronalPlaneAxes(vol: VolumeGeom) {
  // Coronal plane axes (U along R/LR, V along N/SI), plane is constant AP (C axis)
  const C = [vol.M_i2w[0][0], vol.M_i2w[1][0], vol.M_i2w[2][0]] as Vec3;
  const R = [vol.M_i2w[0][1], vol.M_i2w[1][1], vol.M_i2w[2][1]] as Vec3;
  const N = [vol.M_i2w[0][2], vol.M_i2w[1][2], vol.M_i2w[2][2]] as Vec3;
  const norm = (v:Vec3)=>{const L=Math.hypot(v[0],v[1],v[2]); return [v[0]/L,v[1]/L,v[2]/L] as Vec3;};
  return { UdirW: norm(R), VdirW: norm(N), APdirW: norm(C) };
}