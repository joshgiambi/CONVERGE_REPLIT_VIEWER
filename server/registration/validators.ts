export function isApproximately(value: number, target: number, epsilon = 1e-3): boolean {
  return Math.abs(value - target) <= epsilon;
}

export function isIdentity4x4(matrix: number[], epsilon = 1e-6): boolean {
  if (!Array.isArray(matrix) || matrix.length !== 16) return false;
  const id = [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
  for (let i = 0; i < 16; i++) {
    if (Math.abs(matrix[i] - id[i]) > epsilon) return false;
  }
  return true;
}

export function isOrthonormal3x3(r: number[][], epsilon = 1e-2): boolean {
  if (!r || r.length !== 3 || r[0].length !== 3 || r[1].length !== 3 || r[2].length !== 3) return false;
  // DICOM Supplement 73: columns are direction cosines of B axes in A
  const c0 = [r[0][0], r[1][0], r[2][0]]; // X axis of B in A
  const c1 = [r[0][1], r[1][1], r[2][1]]; // Y axis of B in A
  const c2 = [r[0][2], r[1][2], r[2][2]]; // Z axis of B in A
  const norm = (v: number[]) => Math.hypot(v[0], v[1], v[2]);
  const dot = (a: number[], b: number[]) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
  const det =
    r[0][0] * (r[1][1] * r[2][2] - r[1][2] * r[2][1]) -
    r[0][1] * (r[1][0] * r[2][2] - r[1][2] * r[2][0]) +
    r[0][2] * (r[1][0] * r[2][1] - r[1][1] * r[2][0]);

  if (Math.abs(norm(c0) - 1) > epsilon) return false;
  if (Math.abs(norm(c1) - 1) > epsilon) return false;
  if (Math.abs(norm(c2) - 1) > epsilon) return false;
  if (Math.abs(dot(c0, c1)) > epsilon) return false;
  if (Math.abs(dot(c0, c2)) > epsilon) return false;
  if (Math.abs(dot(c1, c2)) > epsilon) return false;
  if (Math.abs(det - 1) > epsilon) return false;
  return true;
}

export function isRigidRowMajor4x4(matrix: number[], epsilon = 1e-2): boolean {
  if (!Array.isArray(matrix) || matrix.length !== 16) return false;
  const r = [
    [matrix[0], matrix[1], matrix[2]],
    [matrix[4], matrix[5], matrix[6]],
    [matrix[8], matrix[9], matrix[10]],
  ];
  return isOrthonormal3x3(r, epsilon);
}

export function toRowMajorFlat(matrix: number[][] | number): number[] | null {
  if (Array.isArray(matrix) && Array.isArray(matrix[0])) {
    const m = matrix as number[][];
    if (m.length !== 4 || m.some(row => !Array.isArray(row) || row.length !== 4)) return null;
    return [...m[0], ...m[1], ...m[2], ...m[3]];
  }
  return null;
}


