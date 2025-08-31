/**
 * Contour interpolation utilities matching Eclipse TPS behavior.
 * Strategy:
 * - Resample both source and target closed contours to a fixed number of points by arc-length.
 * - Align start index and orientation (rotation + optional reversal) to minimize L2 distance.
 * - Interpolate corresponding points with optional easing, setting Z to target slice.
 */

type Vec2 = [number, number];

function to2D(points3D: number[]): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < points3D.length; i += 3) out.push([points3D[i], points3D[i + 1]]);
  return out;
}

function to3D(points2D: Vec2[], z: number): number[] {
  const out: number[] = [];
  for (const [x, y] of points2D) { out.push(x, y, z); }
  return out;
}

function perimeter(poly: Vec2[]): number {
  let L = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    const dx = x2 - x1, dy = y2 - y1; L += Math.hypot(dx, dy);
  }
  return L;
}

function resampleClosed(poly: Vec2[], n: number): Vec2[] {
  if (poly.length === 0) return [];
  // Build cumulative lengths
  const N = poly.length;
  const segL: number[] = new Array(N);
  const cum: number[] = [0];
  let total = 0;
  for (let i = 0; i < N; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % N];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    segL[i] = len; total += len; cum.push(total);
  }
  if (total === 0) return Array(n).fill(poly[0]);
  const out: Vec2[] = [];
  for (let k = 0; k < n; k++) {
    const t = (k / n) * total;
    // Find segment containing t
    let idx = 0;
    while (idx < N && cum[idx + 1] < t) idx++;
    const a = poly[idx];
    const b = poly[(idx + 1) % N];
    const l0 = cum[idx];
    const l1 = cum[idx + 1];
    const u = l1 > l0 ? (t - l0) / (l1 - l0) : 0;
    out.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]);
  }
  return out;
}

function cyclicShift<T>(arr: T[], k: number): T[] {
  const n = arr.length;
  if (n === 0) return arr.slice();
  const r = ((k % n) + n) % n;
  return arr.slice(r).concat(arr.slice(0, r));
}

function l2DistSquared(a: Vec2[], b: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const dx = a[i][0] - b[i][0];
    const dy = a[i][1] - b[i][1];
    s += dx * dx + dy * dy;
  }
  return s;
}

function reversed<T>(arr: T[]): T[] { return arr.slice().reverse(); }

function alignContours(a: Vec2[], b: Vec2[]): Vec2[] {
  // Find rotation (and optional reversal) of b minimizing L2 distance to a
  let best: Vec2[] = b;
  let bestCost = Number.POSITIVE_INFINITY;
  const n = b.length;
  const candidates: Vec2[][] = [];
  for (let k = 0; k < Math.min(n, 256); k++) { // limit rotations for performance
    candidates.push(cyclicShift(b, k));
  }
  const revB = reversed(b);
  for (let k = 0; k < Math.min(n, 256); k++) { candidates.push(cyclicShift(revB, k)); }
  for (const cand of candidates) {
    const cost = l2DistSquared(a, cand);
    if (cost < bestCost) { bestCost = cost; best = cand; }
  }
  return best;
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function interpolateBetweenContours(
  contour1: number[],
  z1: number,
  contour2: number[],
  z2: number,
  targetZ: number,
  samples = 128,
  easing = true
): number[] {
  if (!contour1?.length || !contour2?.length) return [];
  // Convert to 2D and resample
  const a2 = to2D(contour1);
  const b2 = to2D(contour2);
  const aR = resampleClosed(a2, samples);
  const bRraw = resampleClosed(b2, samples);
  const bR = alignContours(aR, bRraw);
  // Interpolation factor
  const tRaw = (targetZ - z1) / (z2 - z1);
  const t = easing ? easeInOutCubic(Math.max(0, Math.min(1, tRaw))) : Math.max(0, Math.min(1, tRaw));
  // Interpolate
  const out2: Vec2[] = new Array(samples);
  for (let i = 0; i < samples; i++) {
    out2[i] = [aR[i][0] + (bR[i][0] - aR[i][0]) * t, aR[i][1] + (bR[i][1] - aR[i][1]) * t];
  }
  return to3D(out2, targetZ);
}

// --- Polar/PCA-based interpolation (Eclipse-like) ---

function centroidArea(poly: Vec2[]): Vec2 {
  // Polygon centroid via shoelace; assumes closed (first != last ok)
  let a = 0, cx = 0, cy = 0;
  const n = poly.length;
  if (n === 0) return [0, 0];
  for (let i = 0; i < n; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % n];
    const c = x1 * y2 - x2 * y1;
    a += c;
    cx += (x1 + x2) * c;
    cy += (y1 + y2) * c;
  }
  a *= 0.5;
  if (Math.abs(a) < 1e-9) {
    // Fallback to mean if area near zero
    let sx = 0, sy = 0; for (const [x, y] of poly) { sx += x; sy += y; }
    return [sx / Math.max(1, n), sy / Math.max(1, n)];
  }
  return [cx / (6 * a), cy / (6 * a)];
}

function principalAxis(pts: Vec2[], c: Vec2): Vec2 {
  // 2x2 covariance
  let sxx = 0, sxy = 0, syy = 0;
  for (const [x, y] of pts) {
    const dx = x - c[0];
    const dy = y - c[1];
    sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
  }
  const a = sxx, b = sxy, d = syy;
  // eigenvector of largest eigenvalue
  const T = a + d;
  const D = Math.sqrt(Math.max(0, (a - d) * (a - d) + 4 * b * b));
  const l1 = 0.5 * (T + D);
  // (a - l1) v1 + b v2 = 0 => choose v = [b, l1 - a]
  let vx = b, vy = l1 - a;
  const len = Math.hypot(vx, vy) || 1;
  vx /= len; vy /= len;
  return [vx, vy];
}

function angleOf(v: Vec2): number {
  return Math.atan2(v[1], v[0]);
}

function normalizeAngle(a: number): number {
  // to [0, 2π)
  const twopi = Math.PI * 2;
  a %= twopi; if (a < 0) a += twopi; return a;
}

function polarSampleByRays(poly: Vec2[], center: Vec2, baseAngle: number, bins: number): number[] {
  // Ray-edge intersection to get boundary radius per angle
  const twopi = Math.PI * 2;
  const radii = new Array<number>(bins).fill(0);
  const n = poly.length;
  if (n < 3) return radii;
  for (let k = 0; k < bins; k++) {
    const ang = baseAngle + (k / bins) * twopi;
    const dir: Vec2 = [Math.cos(ang), Math.sin(ang)];
    let rMax = 0;
    for (let i = 0; i < n; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % n];
      // Solve center + u*dir = p + v*(q-p)
      const ux = dir[0], uy = dir[1];
      const px = p[0] - center[0], py = p[1] - center[1];
      const ex = q[0] - p[0], ey = q[1] - p[1];
      // Matrix [[ux, -ex],[uy, -ey]] * [u,v]^T = [px,py]
      const det = ux * (-ey) - (-ex) * uy; // -ux*ey + ex*uy
      if (Math.abs(det) < 1e-12) continue; // parallel
      const invDet = 1 / det;
      const u = (px * (-ey) - (-ex) * py) * invDet;
      const v = (ux * py - uy * px) * invDet;
      if (u >= 0 && v >= 0 && v <= 1) {
        if (u > rMax) rMax = u;
      }
    }
    if (rMax <= 0) {
      // Fallback: minimal positive distance to vertices projected on ray
      for (let i = 0; i < n; i++) {
        const dx = poly[i][0] - center[0];
        const dy = poly[i][1] - center[1];
        const u = dx * dir[0] + dy * dir[1];
        if (u > rMax) rMax = u;
      }
    }
    radii[k] = rMax;
  }
  // Light smoothing to reduce jaggedness
  const win = Math.max(1, Math.floor(bins / 128));
  if (win > 0) {
    const sm = new Array<number>(bins).fill(0);
    for (let i = 0; i < bins; i++) {
      let sum = 0, cnt = 0;
      for (let j = -win; j <= win; j++) { const t = (i + j + bins) % bins; sum += radii[t]; cnt++; }
      sm[i] = sum / cnt;
    }
    for (let i = 0; i < bins; i++) radii[i] = sm[i];
  }
  return radii;
}

export function interpolateBetweenContoursPolar(
  contour1: number[],
  z1: number,
  contour2: number[],
  z2: number,
  targetZ: number,
  angleSamples = 256,
  easing = true,
  allowRotation = false
): number[] {
  if (!contour1?.length || !contour2?.length) return [];
  const a2 = to2D(contour1);
  const b2 = to2D(contour2);
  const c1 = centroidArea(a2);
  const c2 = centroidArea(b2);
  // Interpolate centroid separately
  const tRaw = (targetZ - z1) / (z2 - z1);
  const t = easing ? easeInOutCubic(Math.max(0, Math.min(1, tRaw))) : Math.max(0, Math.min(1, tRaw));
  const ci: Vec2 = [c1[0] + (c2[0] - c1[0]) * t, c1[1] + (c2[1] - c1[1]) * t];

  // Use PCA to define angular zero for both slices
  const u1 = principalAxis(a2, c1);
  const u2 = principalAxis(b2, c2);
  const a1 = angleOf(u1);
  const a2ang = angleOf(u2);
  // Choose reconstruction base angle
  // If allowRotation=false, keep base fixed to a1 to avoid apparent rotation between slices.
  // If true, interpolate base angle smoothly.
  let abase = a1;
  if (allowRotation) {
    let da = a2ang - a1; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
    abase = a1 + da * t;
  }

  // Sample radius on both slices in consistent angular bins
  const r1 = polarSampleByRays(a2, c1, a1, angleSamples);
  let r2 = polarSampleByRays(b2, c2, a2ang, angleSamples);
  // Align r2 to r1 by optimal circular shift; also consider 180° flip (PCA sign ambiguity)
  const shiftForBase = (baseFrom: number, baseTo: number) => {
    const twopi = Math.PI * 2;
    let d = baseFrom - baseTo; while (d < 0) d += twopi; while (d >= twopi) d -= twopi;
    return Math.round((d / twopi) * angleSamples);
  };
  const circShift = (arr: number[], s: number) => {
    const n = arr.length; const out = new Array<number>(n);
    for (let i = 0; i < n; i++) out[(i + s + n) % n] = arr[i];
    return out;
  };
  const l2 = (x: number[], y: number[]) => {
    let s = 0; for (let i = 0; i < x.length; i++) { const d = x[i] - y[i]; s += d * d; } return s;
  };
  // candidate: align a2ang to a1
  const s0 = shiftForBase(a2ang, a1);
  const r2s0 = circShift(r2, s0);
  // candidate: flip by π then align
  const a2flip = a2ang + Math.PI;
  const s1 = shiftForBase(a2flip, a1);
  const r2flip = polarSampleByRays(b2, c2, a2flip, angleSamples);
  const r2s1 = circShift(r2flip, s1);
  // choose better
  r2 = l2(r1, r2s0) <= l2(r1, r2s1) ? r2s0 : r2s1;

  // Interpolate radii per angle
  const ri = new Array<number>(angleSamples);
  for (let k = 0; k < angleSamples; k++) {
    ri[k] = r1[k] + (r2[k] - r1[k]) * t;
  }

  // Area-preserving adjustment (linear area between slices)
  const dtheta = (Math.PI * 2) / angleSamples;
  const areaFromR = (r: number[]) => 0.5 * r.reduce((s, val) => s + val * val * dtheta, 0);
  const A1 = areaFromR(r1);
  const A2 = areaFromR(r2);
  const Agoal = A1 + (A2 - A1) * t;
  const Acurr = areaFromR(ri);
  if (Acurr > 1e-9 && Agoal > 0) {
    let scale = Math.sqrt(Agoal / Acurr);
    // Clamp to avoid shape distortion
    scale = Math.max(0.95, Math.min(1.05, scale));
    for (let k = 0; k < angleSamples; k++) ri[k] *= scale;
  }

  // Reconstruct points from ri around ci using base angle
  const twopi = Math.PI * 2;
  const pts: Vec2[] = new Array(angleSamples);
  for (let k = 0; k < angleSamples; k++) {
    const ang = abase + (k / angleSamples) * twopi;
    const x = ci[0] + ri[k] * Math.cos(ang);
    const y = ci[1] + ri[k] * Math.sin(ang);
    pts[k] = [x, y];
  }
  return to3D(pts, targetZ);
}

/**
 * Fill intermediate slices between two contours at z1 and z2 (exclusive), returning an array
 * of RT-like contour objects { slicePosition, points, numberOfPoints }.
 */
export function interpolateSliceRange(
  contour1: { slicePosition: number; points: number[] },
  contour2: { slicePosition: number; points: number[] },
  sliceThickness: number,
  samples = 128
) {
  const z1 = contour1.slicePosition;
  const z2 = contour2.slicePosition;
  const dz = z2 - z1;
  const results: { slicePosition: number; points: number[]; numberOfPoints: number }[] = [];
  if (dz <= sliceThickness * 1.5) return results;
  const steps = Math.max(1, Math.round(dz / sliceThickness) - 1);
  for (let j = 1; j <= steps; j++) {
    const targetZ = z1 + (dz * (j / (steps + 1)));
    const pts = interpolateBetweenContours(contour1.points, z1, contour2.points, z2, targetZ, samples, true);
    results.push({ slicePosition: targetZ, points: pts, numberOfPoints: pts.length / 3 });
  }
  return results;
}
