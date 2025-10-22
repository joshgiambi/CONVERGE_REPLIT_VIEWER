/**
 * Fast Polar Interpolation for Contours
 * 
 * Optimized polar-space interpolation for near-instant contour interpolation.
 * Trades some quality for speed (~5-10ms per slice vs 100-500ms for SDT).
 * Good enough for human anatomy, works reliably for most clinical cases.
 */

type Vec2 = [number, number];

/**
 * Calculate polygon centroid using shoelace formula
 */
function centroid(poly: Vec2[]): Vec2 {
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
    let sx = 0, sy = 0;
    for (const [x, y] of poly) { sx += x; sy += y; }
    return [sx / Math.max(1, n), sy / Math.max(1, n)];
  }
  
  return [cx / (6 * a), cy / (6 * a)];
}

/**
 * Calculate polygon area using shoelace formula
 */
function area(poly: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) / 2;
}

/**
 * Find principal axis of a point cloud (for alignment)
 */
function principalAxis(pts: Vec2[], c: Vec2): Vec2 {
  let sxx = 0, sxy = 0, syy = 0;
  for (const [x, y] of pts) {
    const dx = x - c[0];
    const dy = y - c[1];
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  
  const a = sxx, b = sxy, d = syy;
  const T = a + d;
  const D = Math.sqrt(Math.max(0, (a - d) * (a - d) + 4 * b * b));
  const l1 = 0.5 * (T + D);
  
  let vx = b, vy = l1 - a;
  const len = Math.hypot(vx, vy) || 1;
  vx /= len;
  vy /= len;
  
  return [vx, vy];
}

/**
 * Sample contour in polar space using ray casting
 */
function polarSample(poly: Vec2[], center: Vec2, baseAngle: number, bins: number): number[] {
  const twopi = Math.PI * 2;
  const radii = new Array<number>(bins).fill(0);
  const n = poly.length;
  
  if (n < 3) return radii;
  
  for (let k = 0; k < bins; k++) {
    const ang = baseAngle + (k / bins) * twopi;
    const dir: Vec2 = [Math.cos(ang), Math.sin(ang)];
    let rMax = 0;
    
    // Ray-edge intersection
    for (let i = 0; i < n; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % n];
      
      const ux = dir[0], uy = dir[1];
      const px = p[0] - center[0], py = p[1] - center[1];
      const ex = q[0] - p[0], ey = q[1] - p[1];
      
      const det = ux * (-ey) - (-ex) * uy;
      if (Math.abs(det) < 1e-12) continue; // parallel
      
      const invDet = 1 / det;
      const u = (px * (-ey) - (-ex) * py) * invDet;
      const v = (ux * py - uy * px) * invDet;
      
      if (u >= 0 && v >= 0 && v <= 1) {
        if (u > rMax) rMax = u;
      }
    }
    
    // Fallback: project vertices onto ray
    if (rMax <= 0) {
      for (let i = 0; i < n; i++) {
        const dx = poly[i][0] - center[0];
        const dy = poly[i][1] - center[1];
        const u = dx * dir[0] + dy * dir[1];
        if (u > rMax) rMax = u;
      }
    }
    
    radii[k] = rMax;
  }
  
  return radii;
}

/**
 * Smooth radii array using simple moving average
 */
function smoothRadii(radii: number[], windowSize: number = 3): number[] {
  const n = radii.length;
  const smoothed = new Array<number>(n);
  const halfWin = Math.floor(windowSize / 2);
  
  for (let i = 0; i < n; i++) {
    let sum = 0, count = 0;
    for (let j = -halfWin; j <= halfWin; j++) {
      const idx = (i + j + n) % n;
      sum += radii[idx];
      count++;
    }
    smoothed[i] = sum / count;
  }
  
  return smoothed;
}

/**
 * Reconstruct polygon from polar representation
 */
function polarToCartesian(radii: number[], center: Vec2, baseAngle: number, z: number): number[] {
  const twopi = Math.PI * 2;
  const n = radii.length;
  const points: number[] = [];
  
  for (let i = 0; i < n; i++) {
    const ang = baseAngle + (i / n) * twopi;
    const r = radii[i];
    const x = center[0] + r * Math.cos(ang);
    const y = center[1] + r * Math.sin(ang);
    points.push(x, y, z);
  }
  
  return points;
}

/**
 * Convert flat 3D points array to 2D Vec2 array
 */
function to2D(points: number[]): Vec2[] {
  const result: Vec2[] = [];
  for (let i = 0; i < points.length; i += 3) {
    result.push([points[i], points[i + 1]]);
  }
  return result;
}

/**
 * Fast polar interpolation between two contours
 * 
 * @param contour1 - First contour points [x,y,z,...]
 * @param z1 - Z position of first contour
 * @param contour2 - Second contour points [x,y,z,...]
 * @param z2 - Z position of second contour
 * @param targetZ - Target Z position for interpolation
 * @param bins - Number of angular bins (default: 128)
 * @returns Interpolated contour points [x,y,z,...]
 */
export function fastPolarInterpolate(
  contour1: number[],
  z1: number,
  contour2: number[],
  z2: number,
  targetZ: number,
  bins: number = 128
): number[] {
  if (!contour1?.length || !contour2?.length) return [];
  
  const t = (targetZ - z1) / (z2 - z1);
  if (!(t > 0 && t < 1)) return [];
  
  // Convert to 2D
  const poly1 = to2D(contour1);
  const poly2 = to2D(contour2);
  
  if (poly1.length < 3 || poly2.length < 3) return [];
  
  // Compute centroids
  const c1 = centroid(poly1);
  const c2 = centroid(poly2);
  const ci: Vec2 = [
    c1[0] + (c2[0] - c1[0]) * t,
    c1[1] + (c2[1] - c1[1]) * t
  ];
  
  // Use a CONSISTENT base angle for both contours (use first contour's axis)
  // This prevents rotation artifacts during interpolation
  const axis1 = principalAxis(poly1, c1);
  const baseAngle = Math.atan2(axis1[1], axis1[0]);
  
  // Sample BOTH contours with the SAME base angle
  // This ensures rays are aligned and prevents spinning
  const radii1 = polarSample(poly1, c1, baseAngle, bins);
  const radii2 = polarSample(poly2, c2, baseAngle, bins);
  
  // Smooth radii to reduce jaggedness
  const smooth1 = smoothRadii(radii1, 3);
  const smooth2 = smoothRadii(radii2, 3);
  
  // Interpolate radii
  const radiiInterp = new Array<number>(bins);
  for (let i = 0; i < bins; i++) {
    radiiInterp[i] = smooth1[i] + (smooth2[i] - smooth1[i]) * t;
  }
  
  // Area preservation: scale radii to match interpolated area
  const area1 = area(poly1);
  const area2 = area(poly2);
  const targetArea = area1 + (area2 - area1) * t;
  
  // Approximate current area from radii (using polygon approximation)
  let currentArea = 0;
  const twopi = Math.PI * 2;
  for (let i = 0; i < bins; i++) {
    const r1 = radiiInterp[i];
    const r2 = radiiInterp[(i + 1) % bins];
    const dtheta = twopi / bins;
    currentArea += 0.5 * r1 * r2 * Math.sin(dtheta);
  }
  
  // Scale radii to match target area
  if (currentArea > 1e-6) {
    const scale = Math.sqrt(targetArea / currentArea);
    for (let i = 0; i < bins; i++) {
      radiiInterp[i] *= scale;
    }
  }
  
  // Convert back to cartesian
  return polarToCartesian(radiiInterp, ci, baseAngle, targetZ);
}

/**
 * Fast polar interpolation for multi-loop contours
 * Handles structures with multiple contours per slice by taking the largest
 * 
 * @param contoursA - Array of contours at z1
 * @param z1 - Z position of first slice
 * @param contoursB - Array of contours at z2
 * @param z2 - Z position of second slice
 * @param targetZ - Target Z position
 * @param bins - Number of angular bins (default: 128)
 * @returns Interpolated contour points [x,y,z,...]
 */
export function fastPolarInterpolateMulti(
  contoursA: Array<{ points: number[] }>,
  z1: number,
  contoursB: Array<{ points: number[] }>,
  z2: number,
  targetZ: number,
  bins: number = 128
): number[] {
  if (!contoursA?.length || !contoursB?.length) return [];
  
  // Select largest contour from each slice by area
  let largestA = contoursA[0];
  let maxAreaA = 0;
  for (const c of contoursA) {
    const poly = to2D(c.points);
    const a = area(poly);
    if (a > maxAreaA) {
      maxAreaA = a;
      largestA = c;
    }
  }
  
  let largestB = contoursB[0];
  let maxAreaB = 0;
  for (const c of contoursB) {
    const poly = to2D(c.points);
    const a = area(poly);
    if (a > maxAreaB) {
      maxAreaB = a;
      largestB = c;
    }
  }
  
  return fastPolarInterpolate(largestA.points, z1, largestB.points, z2, targetZ, bins);
}

