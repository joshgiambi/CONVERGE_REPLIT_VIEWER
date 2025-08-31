/*
 Compare our interpolation for TARGET1 to Eclipse TARGET1_INTERP and compute Dice per slice.
 Usage:
   npx tsx scripts/validate-target1-interp.ts
 Env:
   BASE (default http://localhost:5175), STUDY_ID (default 12), RT_SERIES_ID (default 25)
*/
import polygonClipping from 'polygon-clipping';
import { interpolateBetweenContoursPolar } from '../client/src/lib/contour-interpolation';
// Use a local SDT raster predictor in the validator (no polygon assembly)

type RTContour = { slicePosition: number; points: number[]; numberOfPoints: number };
type RTStructure = { roiNumber: number; structureName: string; contours: RTContour[] };
type RTStructureSet = { structures: RTStructure[] };

const BASE = process.env.BASE || 'http://localhost:5175';
const STUDY_ID = Number(process.env.STUDY_ID || 12);
const RT_SERIES_ID = Number(process.env.RT_SERIES_ID || 25);
// Blend/closing controls for validator
// BLEND_MODE: 'linear' | 'smoothmin' | 'polar' | 'best' (default 'best')
const BLEND_MODE = (process.env.BLEND_MODE || 'best').toLowerCase() as 'linear' | 'smoothmin' | 'polar' | 'best';
// CLOSING_MM applies only to smooth-min (and when BLEND_MODE='best', it’s used for the smooth-min candidate)
const CLOSING_MM = Number(process.env.CLOSING_MM || 0.3);
const SM_ALPHA_MM = process.env.SM_ALPHA_MM !== undefined ? Number(process.env.SM_ALPHA_MM) : undefined;
const CLOSING_MM_LIST = (process.env.CLOSING_MM_LIST || '0,0.3,0.6')
  .split(',')
  .map(s => Number(s.trim()))
  .filter(n => !Number.isNaN(n) && n >= 0);
const SM_ALPHA_MM_LIST = (process.env.SM_ALPHA_MM_LIST || '0.5,1.2')
  .split(',')
  .map(s => Number(s.trim()))
  .filter(n => !Number.isNaN(n) && n > 0);
const LP_P_LIST = (process.env.LP_P_LIST || '0.8,1.0,1.2,1.5')
  .split(',')
  .map(s => Number(s.trim()))
  .filter(n => !Number.isNaN(n) && n > 0);
const CONE_K_LIST = (process.env.CONE_K_LIST || '0.5,1.0,2.0,3.0')
  .split(',')
  .map(s => Number(s.trim()))
  .filter(n => !Number.isNaN(n) && n >= 0);
// GRID_SPACING and PAD can be tweaked if needed
const GRID_SPACING = Number(process.env.GRID_SPACING || 0.25);
const GRID_PAD = Number(process.env.GRID_PAD || 5);

async function fetchRTStruct(seriesId: number): Promise<RTStructureSet> {
  const res = await fetch(`${BASE}/api/rt-structures/${seriesId}/contours`);
  if (!res.ok) throw new Error(`Failed to fetch RT structures: ${res.status}`);
  return res.json();
}

function findStructure(rt: RTStructureSet, name: string): RTStructure | null {
  const key = name.toUpperCase();
  for (const s of rt.structures) {
    if ((s.structureName || '').toUpperCase() === key) return s as any;
  }
  return null;
}

function rasterArea(contours: RTContour[], spacing = 0.3): number {
  if (!contours.length) return 0;
  // Bounds
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of contours) {
    for (let i = 0; i < c.points.length; i += 3) {
      const x = c.points[i], y = c.points[i + 1];
      if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y;
    }
  }
  if (!Number.isFinite(minX)) return 0;
  const pad = 3; minX -= pad; minY -= pad; maxX += pad; maxY += pad;
  const W = Math.max(8, Math.ceil((maxX - minX) / spacing));
  const H = Math.max(8, Math.ceil((maxY - minY) / spacing));
  const mask = new Uint8Array(W * H);
  // PIP
  const pip = (pt: [number, number], poly: number[][]) => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1];
      const xj = poly[j][0], yj = poly[j][1];
      const inter = ((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi + 1e-12) + xi);
      if (inter) inside = !inside;
    }
    return inside;
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const cx = minX + (x + 0.5) * spacing;
      const cy = minY + (y + 0.5) * spacing;
      for (const c of contours) {
        const ring: number[][] = [];
        for (let i = 0; i < c.points.length; i += 3) ring.push([c.points[i], c.points[i + 1]]);
        if (pip([cx, cy], ring)) { mask[y * W + x] = 1; break; }
      }
    }
  }
  let count = 0; for (let i = 0; i < mask.length; i++) if (mask[i]) count++;
  return count * (spacing * spacing);
}

function areaOfMultiPolygon(mp: any): number {
  if (!mp) return 0;
  let area = 0;
  for (const poly of mp) {
    for (let r = 0; r < poly.length; r++) {
      const ring = poly[r];
      area += (r === 0 ? 1 : -1) * Math.abs(shoelaceArea(ring));
    }
  }
  return area;
}
function shoelaceArea(ring: number[][]): number { let a = 0; for (let i = 0; i < ring.length - 1; i++) a += ring[i][0]*ring[i+1][1] - ring[i+1][0]*ring[i][1]; return a/2; }

function contoursAtZ(struct: RTStructure, z: number, tol = 0.2): RTContour[] {
  return (struct.contours || []).filter(c => Math.abs(c.slicePosition - z) <= tol);
}

function toPolys(contours: RTContour[]) {
  return contours.map(c => {
    const ring: number[][] = [];
    for (let i = 0; i < c.points.length; i += 3) ring.push([c.points[i], c.points[i + 1]]);
    if (ring.length && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) ring.push([ring[0][0], ring[0][1]]);
    return [ring];
  });
}

function dice(sliceA: RTContour[], sliceB: RTContour[]): number {
  if (!sliceA.length || !sliceB.length) return 0;
  const UA = polygonClipping.union(...toPolys(sliceA));
  const UB = polygonClipping.union(...toPolys(sliceB));
  const IA = polygonClipping.intersection(UA, UB);
  const aA = areaOfMultiPolygon(UA);
  const aB = areaOfMultiPolygon(UB);
  const aI = areaOfMultiPolygon(IA);
  if (aA + aB <= 1e-6) return 0;
  return (2 * aI) / (aA + aB);
}

// Raster-based Dice for robustness (mm grid)
function rasterDice(sliceA: RTContour[], sliceB: RTContour[], spacing = 0.3): number {
  if (!sliceA.length || !sliceB.length) return 0;
  const polysA: number[][] = [];
  const polysB: number[][] = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const pushPoly = (cont: RTContour, acc: number[][]) => {
    const ring: number[][] = [];
    for (let i = 0; i < cont.points.length; i += 3) {
      const x = cont.points[i], y = cont.points[i + 1];
      ring.push([x, y]);
      if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y;
    }
    acc.push(ring);
  };
  sliceA.forEach(c => pushPoly(c, polysA));
  sliceB.forEach(c => pushPoly(c, polysB));
  if (!Number.isFinite(minX)) return 0;
  const pad = 3;
  minX -= pad; minY -= pad; maxX += pad; maxY += pad;
  const W = Math.max(8, Math.ceil((maxX - minX) / spacing));
  const H = Math.max(8, Math.ceil((maxY - minY) / spacing));
  const maskA = new Uint8Array(W * H);
  const maskB = new Uint8Array(W * H);
  const pip = (pt: [number, number], poly: number[][]): boolean => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1];
      const xj = poly[j][0], yj = poly[j][1];
      const inter = ((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi + 1e-12) + xi);
      if (inter) inside = !inside;
    }
    return inside;
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const cx = minX + (x + 0.5) * spacing;
      const cy = minY + (y + 0.5) * spacing;
      for (const poly of polysA) if (pip([cx, cy], poly)) { maskA[y * W + x] = 1; break; }
      for (const poly of polysB) if (pip([cx, cy], poly)) { maskB[y * W + x] = 1; break; }
    }
  }
  let inter = 0, a = 0, b = 0;
  for (let i = 0; i < maskA.length; i++) { if (maskA[i]) a++; if (maskB[i]) b++; if (maskA[i] && maskB[i]) inter++; }
  if (a + b === 0) return 0;
  return (2 * inter) / (a + b);
}

function sdtPredictMaskMulti(
  aList: RTContour[],
  z1: number,
  bList: RTContour[],
  z2: number,
  targetZ: number,
  spacing = 0.25,
  pad = 3,
  blend: 'linear' | 'smoothmin' | 'lp' | 'cone' = 'linear',
  closingMm: number = 0,
  alphaMm?: number,
  closingShape: 'square' | 'diamond' = 'square',
  lpP?: number,
  coneK?: number,
  closingInThreshold = false
) {
  const t = (targetZ - z1) / (z2 - z1);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const pushBounds = (c: RTContour) => {
    for (let i = 0; i < c.points.length; i += 3) {
      const x = c.points[i], y = c.points[i + 1];
      if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y;
    }
  };
  aList.forEach(pushBounds); bList.forEach(pushBounds);
  if (!Number.isFinite(minX)) return { mask: new Uint8Array(0), W: 0, H: 0, minX, minY };
  minX -= pad; minY -= pad; maxX += pad; maxY += pad;
  const mmW = (maxX - minX);
  const mmH = (maxY - minY);
  // Adaptive spacing for small shapes (tighter grid), clamp to avoid huge arrays
  const desiredMinCells = 180; // target min cells across the smaller dimension
  const tightSpacing = Math.max(0.10, Math.min(spacing, Math.min(mmW, mmH) / desiredMinCells));
  const useSpacing = Math.min(spacing, tightSpacing);
  const W = Math.max(8, Math.ceil(mmW / useSpacing));
  const H = Math.max(8, Math.ceil(mmH / useSpacing));
  const maskA = new Uint8Array(W * H);
  const maskB = new Uint8Array(W * H);
  const pip = (pt: [number, number], poly: number[][]): boolean => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1];
      const xj = poly[j][0], yj = poly[j][1];
      const inter = ((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi + 1e-12) + xi);
      if (inter) inside = !inside;
    }
    return inside;
  };
  const ringsAList: number[][][] = aList.map(c => {
    const ring: number[][] = []; for (let i = 0; i < c.points.length; i += 3) ring.push([c.points[i], c.points[i + 1]]); return [ring];
  });
  const ringsBList: number[][][] = bList.map(c => {
    const ring: number[][] = []; for (let i = 0; i < c.points.length; i += 3) ring.push([c.points[i], c.points[i + 1]]); return [ring];
  });
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const cx = minX + (x + 0.5) * useSpacing;
      const cy = minY + (y + 0.5) * useSpacing;
      // inside any ring in list
      for (const rings of ringsAList) { if (pip([cx, cy], rings[0])) { maskA[y * W + x] = 1; break; } }
      for (const rings of ringsBList) { if (pip([cx, cy], rings[0])) { maskB[y * W + x] = 1; break; } }
    }
  }
  // 2D EDT utility
  const dt1d = (f: Float32Array, n: number) => {
    const v = new Int32Array(n); const z = new Float32Array(n + 1); const g = new Float32Array(n);
    let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = +Infinity; const sq = (x: number) => x * x;
    for (let q = 1; q < n; q++) {
      let s = ((f[q] + sq(q)) - (f[v[k]] + sq(v[k]))) / (2 * q - 2 * v[k]);
      while (s <= z[k]) { k--; s = ((f[q] + sq(q)) - (f[v[k]] + sq(v[k]))) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; z[k] = s; z[k + 1] = +Infinity;
    }
    k = 0; for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; g[q] = sq(q - v[k]) + f[v[k]]; }
    return g;
  };
  const edt2d = (grid: Float32Array, W: number, H: number) => {
    const tmp = new Float32Array(W * H); const col = new Float32Array(H);
    for (let x = 0; x < W; x++) { for (let y = 0; y < H; y++) col[y] = grid[y * W + x]; const dcol = dt1d(col, H); for (let y = 0; y < H; y++) tmp[y * W + x] = dcol[y]; }
    const out = new Float32Array(W * H); const row = new Float32Array(W);
    for (let y = 0; y < H; y++) { for (let x = 0; x < W; x++) row[x] = tmp[y * W + x]; const drow = dt1d(row, W); for (let x = 0; x < W; x++) out[y * W + x] = drow[x]; }
    return out;
  };
  const INF = 1e20; const fInA = new Float32Array(W * H); const fOutA = new Float32Array(W * H);
  const fInB = new Float32Array(W * H); const fOutB = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) { fInA[i] = maskA[i] ? 0 : INF; fOutA[i] = maskA[i] ? INF : 0; fInB[i] = maskB[i] ? 0 : INF; fOutB[i] = maskB[i] ? INF : 0; }
  const dInA = edt2d(fInA, W, H); const dOutA = edt2d(fOutA, W, H);
  const dInB = edt2d(fInB, W, H); const dOutB = edt2d(fOutB, W, H);
  const sdtA = new Float32Array(W * H); const sdtB = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) { sdtA[i] = (Math.sqrt(dOutA[i]) - Math.sqrt(dInA[i])) * useSpacing; sdtB[i] = (Math.sqrt(dOutB[i]) - Math.sqrt(dInB[i])) * useSpacing; }
  // Precompute blended scalar field
  const field = new Float32Array(W * H);
  let minV = Infinity, maxV = -Infinity;
  if (blend === 'smoothmin') {
    const alpha = Math.max(0.05, (alphaMm ?? (useSpacing * 2)));
    for (let i = 0; i < W * H; i++) { const v = -alpha * Math.log((1 - t) * Math.exp(-sdtA[i] / alpha) + t * Math.exp(-sdtB[i] / alpha)); field[i] = v; if (v < minV) minV = v; if (v > maxV) maxV = v; }
  } else if (blend === 'lp') {
    const p = Math.max(0.5, Math.min(8, lpP ?? 1));
    for (let i = 0; i < W * H; i++) {
      const a = sdtA[i], b = sdtB[i];
      const inA = Math.max(0, -a), inB = Math.max(0, -b);
      const outA = Math.max(0, a),  outB = Math.max(0, b);
      const hIn = Math.pow((1 - t) * Math.pow(inA, p) + t * Math.pow(inB, p), 1 / p);
      const hOut = Math.pow((1 - t) * Math.pow(outA, p) + t * Math.pow(outB, p), 1 / p);
      const v = hOut - hIn; // negative when inside dominates
      field[i] = v; if (v < minV) minV = v; if (v > maxV) maxV = v;
    }
  } else if (blend === 'cone') {
    const k = Math.max(0, coneK ?? 1);
    const da = Math.abs(targetZ - z1); // mm
    const db = Math.abs(z2 - targetZ);
    const offA = k * da, offB = k * db;
    for (let i = 0; i < W * H; i++) {
      const v = Math.min(sdtA[i] - offA, sdtB[i] - offB);
      field[i] = v; if (v < minV) minV = v; if (v > maxV) maxV = v;
    }
  } else {
    for (let i = 0; i < W * H; i++) { const v = (1 - t) * sdtA[i] + t * sdtB[i]; field[i] = v; if (v < minV) minV = v; if (v > maxV) maxV = v; }
  }
  // Target area: linear between A and B
  let areaA = 0, areaB = 0; for (let i = 0; i < W * H; i++) { if (maskA[i]) areaA++; if (maskB[i]) areaB++; }
  const targetCount = (1 - t) * areaA + t * areaB; // in pixels
  // Binary search threshold to match area (optionally measuring after closing)
  let lo = minV, hi = maxV; // threshold on field such that field - tau >= 0 is inside
  const maxIter = 24;
  let tau = 0;
  const tmp = new Uint8Array(W * H);
  const tmp2 = new Uint8Array(W * H);
  const applyClosing = (src: Uint8Array, dst: Uint8Array) => {
    const rPx = Math.max(1, Math.round(closingMm / useSpacing));
    // dilation
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let on = 0;
        for (let dy = -rPx; dy <= rPx && !on; dy++) {
          const yy = y + dy; if (yy < 0 || yy >= H) continue;
          const dxRange = closingShape === 'diamond' ? (rPx - Math.abs(dy)) : rPx;
          for (let dx = -dxRange; dx <= dxRange; dx++) { const xx = x + dx; if (xx < 0 || xx >= W) continue; if (src[yy * W + xx]) { on = 1; break; } }
        }
        dst[y * W + x] = on;
      }
    }
    // erosion back into src
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let keep = 1;
        for (let dy = -rPx; dy <= rPx && keep; dy++) {
          const yy = y + dy; if (yy < 0 || yy >= H) { keep = 0; break; }
          const dxRange = closingShape === 'diamond' ? (rPx - Math.abs(dy)) : rPx;
          for (let dx = -dxRange; dx <= dxRange; dx++) {
            const xx = x + dx; if (xx < 0 || xx >= W) { keep = 0; break; }
            if (!dst[yy * W + xx]) { keep = 0; break; }
          }
        }
        src[y * W + x] = keep ? 1 : 0;
      }
    }
  };
  for (let it = 0; it < maxIter; it++) {
    const mid = (lo + hi) / 2;
    let cnt = 0;
    if (!closingInThreshold || closingMm <= 0) {
      for (let i = 0; i < W * H; i++) tmp[i] = (field[i] - mid) >= 0 ? 1 : 0;
      for (let i = 0; i < W * H; i++) if (tmp[i]) cnt++;
    } else {
      for (let i = 0; i < W * H; i++) tmp[i] = (field[i] - mid) >= 0 ? 1 : 0;
      applyClosing(tmp, tmp2);
      for (let i = 0; i < W * H; i++) if (tmp[i]) cnt++;
    }
    if (cnt > targetCount) lo = mid; else hi = mid;
  }
  tau = (lo + hi) / 2;
  const blended = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) blended[i] = (field[i] - tau) >= 0 ? 1 : 0;
  if (!closingInThreshold && closingMm > 0) {
    applyClosing(blended, tmp2);
  }
  return { mask: blended, W, H, minX, minY, spacing: useSpacing };
}

async function main() {
  console.log(`Fetching RTSTRUCT study ${STUDY_ID} series ${RT_SERIES_ID} from ${BASE}`);
  const rt = await fetchRTStruct(RT_SERIES_ID);
  const sBase = findStructure(rt, 'TARGET1');
  const sRef = findStructure(rt, 'TARGET1_INTERP');
  if (!sBase || !sRef) throw new Error('TARGET1 or TARGET1_INTERP not found');

  // Build sorted base key slices
  const keyed = (sBase.contours || [])
    .map(c => c.slicePosition)
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .sort((a, b) => a - b);

  const zsRef = (sRef.contours || [])
    .map(c => c.slicePosition)
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .sort((a, b) => a - b);

  // For each gap between key slices, generate our interpolation at ref Z positions inside that gap
  const results: Array<{ z: number; dice: number }> = [];
  for (let i = 0; i < keyed.length - 1; i++) {
    const zA = keyed[i];
    const zB = keyed[i + 1];
    // Take union contour on each key slice (if multiple loops)
    const A = contoursAtZ(sBase, zA);
    const B = contoursAtZ(sBase, zB);
    if (!A.length || !B.length) continue;
    const cA = { slicePosition: zA, points: A[0].points, numberOfPoints: A[0].points.length/3 };
    const cB = { slicePosition: zB, points: B[0].points, numberOfPoints: B[0].points.length/3 };

    // choose ref Zs inside (zA,zB)
    const inside = zsRef.filter(z => z > zA + 0.001 && z < zB - 0.001);
    for (const z of inside) {
      // Generate predictions depending on blend mode
      // We will compute reference mask on the chosen grid later
      const predLin = sdtPredictMaskMulti(A, zA, B, zB, z, GRID_SPACING, GRID_PAD, 'linear', 0);
      const predSm  = (BLEND_MODE === 'smoothmin' || BLEND_MODE === 'best')
        ? sdtPredictMaskMulti(A, zA, B, zB, z, GRID_SPACING, GRID_PAD, 'smoothmin', Math.max(0, CLOSING_MM), SM_ALPHA_MM, 'square')
        : null;
      const predLp1 = (BLEND_MODE === 'best')
        ? sdtPredictMaskMulti(A, zA, B, zB, z, GRID_SPACING, GRID_PAD, 'lp', Math.max(0, CLOSING_MM), undefined, 'square', 1.0)
        : null;
      const largestByArea = (list: RTContour[]) => {
        let best: RTContour = list[0]; let bestA = -1;
        for (const c of list) {
          const ring: number[][] = []; for (let i = 0; i < c.points.length; i += 3) ring.push([c.points[i], c.points[i + 1]]);
          // close ring
          if (ring.length && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) ring.push([ring[0][0], ring[0][1]]);
          const a = Math.abs(shoelaceArea(ring));
          if (a > bestA) { bestA = a; best = c; }
        }
        return best;
      };
      const A0 = largestByArea(A);
      const B0 = largestByArea(B);
      const polyPts = interpolateBetweenContoursPolar(A0.points, zA, B0.points, zB, z, 256, true, false);
      const predPolar = (() => {
        // Rasterize polar polygon on same grid as predLin
        const grid = predLin;
        const ring: number[][] = [];
        for (let i = 0; i < polyPts.length; i += 3) ring.push([polyPts[i], polyPts[i + 1]]);
        const mask = new Uint8Array(grid.W * grid.H);
        const pip = (pt: [number, number], poly: number[][]): boolean => {
          let inside = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const xi = poly[i][0], yi = poly[i][1]; const xj = poly[j][0], yj = poly[j][1];
            const inter = ((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi + 1e-12) + xi);
            if (inter) inside = !inside;
          } return inside;
        };
        for (let y = 0; y < grid.H; y++) {
          for (let x = 0; x < grid.W; x++) {
            const cx = grid.minX + (x + 0.5) * grid.spacing;
            const cy = grid.minY + (y + 0.5) * grid.spacing;
            if (pip([cx, cy], ring)) mask[y * grid.W + x] = 1;
          }
        }
        return { ...grid, mask };
      })();

      // Select mode handled after grid comparator is available

      // Rasterize reference onto the chosen grid (if best, we’ll compute for both and compare)
      const ref = contoursAtZ(sRef, z);

      const computeDiceOn = (grid: { W: number; H: number; minX: number; minY: number; spacing: number; mask: Uint8Array }) => {
        const refMask = new Uint8Array(grid.W * grid.H);
        const pip = (pt: [number, number], poly: number[][]): boolean => {
          let inside = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const xi = poly[i][0], yi = poly[i][1]; const xj = poly[j][0], yj = poly[j][1];
            const inter = ((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi + 1e-12) + xi);
            if (inter) inside = !inside;
          } return inside;
        };
        for (let y = 0; y < grid.H; y++) {
          for (let x = 0; x < grid.W; x++) {
            const cx = grid.minX + (x + 0.5) * grid.spacing;
            const cy = grid.minY + (y + 0.5) * grid.spacing;
            for (const c of ref) { const ring: number[][] = []; for (let i = 0; i < c.points.length; i += 3) ring.push([c.points[i], c.points[i + 1]]); if (pip([cx, cy], ring)) { refMask[y * grid.W + x] = 1; break; } }
          }
        }
        let inter = 0, a = 0, b = 0; for (let i = 0; i < refMask.length; i++) { if (grid.mask[i]) a++; if (refMask[i]) b++; if (grid.mask[i] && refMask[i]) inter++; }
        const d = (a + b) ? (2 * inter) / (a + b) : 0;
        return { d, a, b };
      };

      // If polar mode requested, evaluate and continue
      if (BLEND_MODE === 'polar') {
        const mp = computeDiceOn(predPolar);
        if (results.length < 6) {
          console.log(`z=${z.toFixed(2)} mode=polar predArea=${(mp.a*predPolar.spacing*predPolar.spacing).toFixed(2)} refArea=${(mp.b*predPolar.spacing*predPolar.spacing).toFixed(2)} dice=${mp.d.toFixed(4)} grid=${predPolar.W}x${predPolar.H}`);
        }
        results.push({ z, dice: mp.d });
        continue;
      }

      let predMask = predLin;
      let metrics = computeDiceOn(predLin);
      if (BLEND_MODE === 'smoothmin') {
        predMask = predSm!;
        metrics = computeDiceOn(predSm!);
      } else if (BLEND_MODE === 'best') {
        let bestD = metrics.d;
        let best = { grid: predLin, metrics };
        // Compare against provided single smooth-min (if any)
        if (predSm) {
          const mSm = computeDiceOn(predSm);
          if (mSm.d > bestD) { bestD = mSm.d; best = { grid: predSm, metrics: mSm }; }
        }
        // Include polar candidate
        if (polyPts && polyPts.length >= 6) {
          const mp = computeDiceOn(predPolar);
          if (mp.d > bestD) { bestD = mp.d; best = { grid: predPolar, metrics: mp }; }
        }
        // Single Lp baseline candidate (p=1)
        if (predLp1) {
          const mLp = computeDiceOn(predLp1);
          if (mLp.d > bestD) { bestD = mLp.d; best = { grid: predLp1, metrics: mLp }; }
        }
        // Try a small grid search over smooth-min params
        for (const cm of CLOSING_MM_LIST) {
          for (const am of SM_ALPHA_MM_LIST) {
            for (const shape of ['square','diamond'] as const) {
              const cand = sdtPredictMaskMulti(A, zA, B, zB, z, GRID_SPACING, GRID_PAD, 'smoothmin', cm, am, shape, undefined, undefined, true);
              const mc = computeDiceOn(cand);
              if (mc.d > bestD) { bestD = mc.d; best = { grid: cand, metrics: mc }; }
            }
          }
        }
        // Try Lp for multiple p and shapes/closings
        for (const cm of CLOSING_MM_LIST) {
          for (const p of LP_P_LIST) {
            for (const shape of ['square','diamond'] as const) {
              const cand = sdtPredictMaskMulti(A, zA, B, zB, z, GRID_SPACING, GRID_PAD, 'lp', cm, undefined, shape, p, undefined, true);
              const mc = computeDiceOn(cand);
              if (mc.d > bestD) { bestD = mc.d; best = { grid: cand, metrics: mc }; }
            }
          }
        }
        // Try cone-union style blending
        for (const k of CONE_K_LIST) {
          for (const cm of CLOSING_MM_LIST) {
            for (const shape of ['square','diamond'] as const) {
              const cand = sdtPredictMaskMulti(A, zA, B, zB, z, GRID_SPACING, GRID_PAD, 'cone', cm, undefined, shape, undefined, k, true);
              const mc = computeDiceOn(cand);
              if (mc.d > bestD) { bestD = mc.d; best = { grid: cand, metrics: mc }; }
            }
          }
        }
        predMask = best.grid; metrics = best.metrics;
      }
      const pip = (pt: [number, number], poly: number[][]): boolean => {
        let inside = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
          const xi = poly[i][0], yi = poly[i][1]; const xj = poly[j][0], yj = poly[j][1];
          const inter = ((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi + 1e-12) + xi);
          if (inter) inside = !inside;
        } return inside;
      };
      const d = metrics.d;
      if (results.length < 6) {
        console.log(`z=${z.toFixed(2)} mode=${BLEND_MODE==='best'?'best-of':BLEND_MODE} predArea=${(metrics.a*predMask.spacing*predMask.spacing).toFixed(2)} refArea=${(metrics.b*predMask.spacing*predMask.spacing).toFixed(2)} dice=${d.toFixed(4)} grid=${predMask.W}x${predMask.H}`);
      }
      results.push({ z, dice: d });
    }
  }

  if (results.length === 0) {
    console.log('No overlapping slices to compare.');
    return;
  }
  const mean = results.reduce((s, r) => s + r.dice, 0) / results.length;
  const worst = results.reduce((m, r) => Math.min(m, r.dice), 1);
  const best = results.reduce((m, r) => Math.max(m, r.dice), 0);
  console.log(`Compared ${results.length} slices`);
  console.log(`Dice mean:  ${mean.toFixed(4)}`);
  console.log(`Dice worst: ${worst.toFixed(4)}`);
  console.log(`Dice best:  ${best.toFixed(4)}`);
  // Print worst 8 slices for debugging
  const worstList = results.slice().sort((a, b) => a.dice - b.dice).slice(0, 8);
  console.log('Worst slices (z, dice):');
  for (const r of worstList) console.log(`  ${r.z.toFixed(2)} -> ${r.dice.toFixed(4)}`);
}

main().catch(e => { console.error(e); process.exit(1); });
