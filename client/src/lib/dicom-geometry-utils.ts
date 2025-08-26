/**
 * DICOM Geometry Utilities
 * Provides robust geometric calculations for DICOM images,
 * handling oblique slices and proper coordinate transformations
 */

export type Vec3 = [number, number, number];
export type Mat4x4 = number[]; // 16 elements, row-major

/**
 * Compute dot product of two 3D vectors
 */
export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/**
 * Compute cross product of two 3D vectors
 */
export function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}

/**
 * Subtract two 3D vectors
 */
export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

/**
 * Parse DICOM string or array to numbers
 */
export function parseNums(v: string | number[] | undefined, expected: number): number[] | null {
  if (Array.isArray(v)) {
    const a = v.map(Number);
    return a.length === expected && a.every(n => Number.isFinite(n)) ? a : null;
  }
  if (typeof v === 'string') {
    const a = v.split('\\').map(Number);
    return a.length === expected && a.every(n => Number.isFinite(n)) ? a : null;
  }
  return null;
}

/**
 * Get robust Z-scalar for slice sorting/comparison in patient LPS space
 * This computes the slice position along the slice normal, not raw Z
 * 
 * @param meta Object containing imagePositionPatient and imageOrientationPatient
 * @returns Scalar position along the slice normal
 */
export function getSliceScalarZ(meta: {
  imagePositionPatient: string | number[];
  imageOrientationPatient: string | number[];
}): number | null {
  const position = parseNums(meta.imagePositionPatient, 3);
  const orientation = parseNums(meta.imageOrientationPatient, 6);
  
  if (!position || !orientation) {
    console.warn('Missing spatial metadata for slice scalar computation');
    return null;
  }
  
  const [x, y, z] = position as Vec3;
  const rowDir: Vec3 = [orientation[0], orientation[1], orientation[2]];
  const colDir: Vec3 = [orientation[3], orientation[4], orientation[5]];
  const normal = cross(rowDir, colDir); // Slice normal
  
  return dot([x, y, z], normal); // Scalar position along normal
}

/**
 * Build geometry information for a DICOM image
 */
export interface ImageGeometry {
  origin: Vec3;
  rowDir: Vec3;
  colDir: Vec3;
  normal: Vec3;
  rowSpacing: number;
  colSpacing: number;
  sliceScalar: number; // Distance along normal
}

/**
 * Extract complete geometry from DICOM metadata
 */
export function getImageGeometry(meta: {
  imagePosition: string | number[];
  imageOrientation: string | number[];
  pixelSpacing: string | number[];
}): ImageGeometry | null {
  const position = parseNums(meta.imagePosition, 3);
  const orientation = parseNums(meta.imageOrientation, 6);
  const spacing = parseNums(meta.pixelSpacing, 2);
  
  if (!position || !orientation || !spacing) {
    return null;
  }
  
  const origin = position as Vec3;
  const rowDir: Vec3 = [orientation[0], orientation[1], orientation[2]];
  const colDir: Vec3 = [orientation[3], orientation[4], orientation[5]];
  const normal = cross(rowDir, colDir);
  const sliceScalar = dot(origin, normal);
  
  return {
    origin,
    rowDir,
    colDir,
    normal,
    rowSpacing: spacing[0],
    colSpacing: spacing[1],
    sliceScalar
  };
}

/**
 * Apply 4x4 transformation matrix to a 3D point
 */
export function apply4x4(M: Mat4x4, p: Vec3): Vec3 {
  const X = M[0] * p[0] + M[1] * p[1] + M[2] * p[2] + M[3];
  const Y = M[4] * p[0] + M[5] * p[1] + M[6] * p[2] + M[7];
  const Z = M[8] * p[0] + M[9] * p[1] + M[10] * p[2] + M[11];
  return [X, Y, Z];
}

/**
 * Invert a rigid 4x4 transformation matrix
 */
export function invertRigid4x4(M: Mat4x4): Mat4x4 {
  // Extract rotation and translation
  const r00 = M[0], r01 = M[1], r02 = M[2], t0 = M[3];
  const r10 = M[4], r11 = M[5], r12 = M[6], t1 = M[7];
  const r20 = M[8], r21 = M[9], r22 = M[10], t2 = M[11];
  
  // R^-1 = R^T for rigid transforms
  const i00 = r00, i01 = r10, i02 = r20;
  const i10 = r01, i11 = r11, i12 = r21;
  const i20 = r02, i21 = r12, i22 = r22;
  
  // New translation = -R^T * t
  const nt0 = -(i00 * t0 + i01 * t1 + i02 * t2);
  const nt1 = -(i10 * t0 + i11 * t1 + i12 * t2);
  const nt2 = -(i20 * t0 + i21 * t1 + i22 * t2);
  
  return [
    i00, i01, i02, nt0,
    i10, i11, i12, nt1,
    i20, i21, i22, nt2,
    0, 0, 0, 1
  ];
}

/**
 * Check if metadata is valid for geometric operations
 */
export function hasValidSpatialMetadata(image: any): boolean {
  const position = parseNums(image.imagePosition, 3);
  const orientation = parseNums(image.imageOrientation, 6);
  const spacing = parseNums(image.pixelSpacing, 2);
  return !!(position && orientation && spacing);
}

/**
 * Compute tolerance for slice matching based on slice spacing
 */
export function computeSliceTolerance(images: any[], defaultTol: number = 0.5): number {
  if (images.length < 2) return defaultTol;
  
  // Compute inter-slice distances
  const distances: number[] = [];
  for (let i = 1; i < Math.min(images.length, 10); i++) {
    const z1 = getSliceScalarZ({
      imagePositionPatient: images[i - 1].imagePosition,
      imageOrientationPatient: images[i - 1].imageOrientation
    });
    const z2 = getSliceScalarZ({
      imagePositionPatient: images[i].imagePosition, 
      imageOrientationPatient: images[i].imageOrientation
    });
    if (z1 !== null && z2 !== null) {
      distances.push(Math.abs(z2 - z1));
    }
  }
  
  if (distances.length === 0) return defaultTol;
  
  // Use median spacing * 0.4 for tolerance
  distances.sort((a, b) => a - b);
  const median = distances[Math.floor(distances.length / 2)];
  return Math.max(0.25, 0.4 * median);
}