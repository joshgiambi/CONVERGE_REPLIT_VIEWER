// Core DICOM geometry transformations with proper ImageOrientationPatient handling
export type Vec3 = [number, number, number];

export interface DicomSpatialMeta {
  rows: number;
  cols: number;
  pixelSpacing: string;                 // "dr\dc"
  imagePositionPatient: string;         // "x\y\z"
  imageOrientationPatient: string;      // "rx\ry\rz\cx\cy\cz" (row, then column)
}

export function parse3(s: string): Vec3 {
  const [a, b, c] = s.split('\\').map(Number);
  return [a, b, c];
}

export function parse2(s: string): [number, number] {
  const [a, b] = s.split('\\').map(Number);
  return [a, b];
}

export const dot = (a: Vec3, b: Vec3) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1]*b[2] - a[2]*b[1],
  a[2]*b[0] - a[0]*b[2],
  a[0]*b[1] - a[1]*b[0]
];

export function buildImageXform(meta: DicomSpatialMeta) {
  const IPP = parse3(meta.imagePositionPatient);
  const [dr, dc] = parse2(meta.pixelSpacing);
  const io = meta.imageOrientationPatient.split('\\').map(Number);
  // Row (R) then Column (C) direction cosines in LPS
  const R: Vec3 = [io[0], io[1], io[2]];
  const C: Vec3 = [io[3], io[4], io[5]];
  const N: Vec3 = cross(R, C); // slice normal

  // Matrix that maps image pixel delta → world (mm)
  // world = IPP + u*dc*C + v*dr*R   (u=column, v=row)
  // To invert: project world point onto the axes.
  function worldToPixelXY(world: Vec3): [number, number] {
    const d = sub(world, IPP);
    const u = dot(d, C) / dc; // columns
    const v = dot(d, R) / dr; // rows
    return [u, v];
  }

  function pixelToWorld(u: number, v: number): Vec3 {
    return [
      IPP[0] + u*dc*C[0] + v*dr*R[0],
      IPP[1] + u*dc*C[1] + v*dr*R[1],
      IPP[2] + u*dc*C[2] + v*dr*R[2],
    ];
  }

  // scalar "slice position" along N to sort/compare slices robustly
  function slicePositionScalar(): number {
    return dot(IPP, N);
  }

  return { R, C, N, dr, dc, IPP, worldToPixelXY, pixelToWorld, slicePositionScalar };
}