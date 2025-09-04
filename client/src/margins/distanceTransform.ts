import { Float3D, Grid } from './types';
import { InfinityVal } from './seeds';

// 1D squared Euclidean distance transform with anisotropic res (Felzenszwalb/Huttenlocher)
export function distanceTransform1D(input: Float32Array, size: number, res: number): Float32Array {
  const v = new Int32Array(size);
  const z = new Float32Array(size + 1);
  const output = new Float32Array(size);
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  const res2 = res * res;
  for (let q = 1; q < size; q++) {
    let s: number;
    while (true) {
      const p = v[k];
      s = ((input[q] + (q * q) * res2) - (input[p] + (p * p) * res2)) / (2 * (q - p) * res2);
      if (s <= z[k]) {
        k--;
        if (k < 0) { k = 0; break; }
      } else break;
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < size; q++) {
    while (z[k + 1] < q) k++;
    const p = v[k];
    const dq = (q - p);
    output[q] = input[p] + (dq * dq) * res2;
  }
  return output;
}

export function distanceTransform2D(plane: Float32Array, xSize: number, ySize: number, xRes: number, yRes: number): Float32Array {
  const tmp = new Float32Array(xSize * ySize);
  // columns (y)
  for (let x = 0; x < xSize; x++) {
    const col = new Float32Array(ySize);
    for (let y = 0; y < ySize; y++) col[y] = plane[x + y * xSize];
    const out = distanceTransform1D(col, ySize, yRes);
    for (let y = 0; y < ySize; y++) tmp[x + y * xSize] = out[y];
  }
  // rows (x)
  const outPlane = new Float32Array(xSize * ySize);
  for (let y = 0; y < ySize; y++) {
    const row = new Float32Array(xSize);
    for (let x = 0; x < xSize; x++) row[x] = tmp[x + y * xSize];
    const out = distanceTransform1D(row, xSize, xRes);
    for (let x = 0; x < xSize; x++) outPlane[x + y * xSize] = out[x];
  }
  return outPlane;
}

export function distanceTransform3D(dt: Float3D, grid: Grid): void {
  const { xSize, ySize, zSize, xRes, yRes, zRes } = grid;
  // pass Z planes with 2D DT first
  for (let z = 0; z < zSize; z++) {
    const off = z * xSize * ySize;
    const plane = dt.values.subarray(off, off + xSize * ySize);
    const out = distanceTransform2D(plane, xSize, ySize, xRes, yRes);
    dt.values.set(out, off);
  }
  // pass along Z
  const column = new Float32Array(zSize);
  for (let y = 0; y < ySize; y++) {
    for (let x = 0; x < xSize; x++) {
      for (let z = 0; z < zSize; z++) {
        column[z] = dt.values[x + y * xSize + z * xSize * ySize];
      }
      const out = distanceTransform1D(column, zSize, zRes);
      for (let z = 0; z < zSize; z++) {
        dt.values[x + y * xSize + z * xSize * ySize] = out[z];
      }
    }
  }
}


