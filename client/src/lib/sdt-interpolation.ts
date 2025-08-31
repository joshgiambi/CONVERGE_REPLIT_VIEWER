/*
 SDT-based contour interpolation between two slices.
 1) Rasterize polygons onto a mm-grid within combined bounds.
 2) Compute signed distance fields (Felzenszwalb 1D EDT x,y passes) for each mask.
 3) Blend signed distances at target Z and extract zero isocontour via marching squares.
 4) Return a single outer polygon (largest area) in world coordinates at targetZ.
*/

type Vec2 = [number, number];
let DEBUG_COUNT = 0;

// Compute bounds across polygons with padding in mm
function computeBounds(polys: Vec2[][], pad = 3): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const poly of polys) {
    for (const [x, y] of poly) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (!Number.isFinite(minX)) {
    minX = minY = 0; maxX = maxY = 1;
  }
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

// Scanline polygon fill into binary mask
function pointInPolygon(pt: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    const inter = ((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi + 1e-12) + xi);
    if (inter) inside = !inside;
  }
  return inside;
}

function fillPolygon(mask: Uint8Array, width: number, height: number, poly: Vec2[]) {
  if (poly.length < 3) return;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cx: Vec2 = [x + 0.5, y + 0.5];
      if (pointInPolygon(cx, poly)) mask[y * width + x] = 1;
    }
  }
}

// Felzenszwalb & Huttenlocher 1D squared distance transform
function dt1d(f: Float32Array, n: number): Float32Array {
  const v = new Int32Array(n);
  const z = new Float32Array(n + 1);
  const g = new Float32Array(n);
  let k = 0;
  v[0] = 0; z[0] = -Infinity; z[1] = +Infinity;
  const sq = (x: number) => x * x;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + sq(q)) - (f[v[k]] + sq(v[k]))) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = ((f[q] + sq(q)) - (f[v[k]] + sq(v[k]))) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = +Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    g[q] = sq(q - v[k]) + f[v[k]];
  }
  return g;
}

// 2D squared distance transform (rows then cols)
function edt2d(grid: Float32Array, width: number, height: number): Float32Array {
  // transform along columns
  const tmp = new Float32Array(width * height);
  const INF = 1e20;
  const col = new Float32Array(height);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) col[y] = grid[y * width + x];
    const dcol = dt1d(col, height);
    for (let y = 0; y < height; y++) tmp[y * width + x] = dcol[y];
  }
  // transform along rows
  const row = new Float32Array(width);
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) row[x] = tmp[y * width + x];
    const drow = dt1d(row, width);
    for (let x = 0; x < width; x++) out[y * width + x] = drow[x];
  }
  return out;
}

function signedDistance(mask: Uint8Array, width: number, height: number, pixelSize: number): Float32Array {
  const INF = 1e12;
  const fIn = new Float32Array(width * height);
  const fOut = new Float32Array(width * height);
  for (let i = 0; i < fIn.length; i++) {
    fIn[i] = mask[i] ? 0 : INF;
    fOut[i] = mask[i] ? INF : 0;
  }
  const dIn = edt2d(fIn, width, height);
  const dOut = edt2d(fOut, width, height);
  // Convert squared pixel distances to mm
  const sdt = new Float32Array(width * height);
  const scale = pixelSize; // each pixel is pixelSize mm
  for (let i = 0; i < sdt.length; i++) {
    const di = Math.sqrt(dIn[i]) * scale;
    const do_ = Math.sqrt(dOut[i]) * scale;
    // positive inside
    sdt[i] = do_ - di;
  }
  return sdt;
}

// Marching Squares iso=0 contour extraction
type Segment = { x1: number; y1: number; x2: number; y2: number };

function marchingSquaresZero(field: Float32Array, width: number, height: number): Segment[] {
  const idx = (x: number, y: number) => y * width + x;
  const segs: Segment[] = [];
  const iso = 0;
  const interp = (v1: number, v2: number) => {
    const t = v1 / (v1 - v2); // v1 + t*(v2-v1) = 0
    return Math.max(0, Math.min(1, t));
  };
  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      const v0 = field[idx(x, y)];
      const v1 = field[idx(x + 1, y)];
      const v2 = field[idx(x + 1, y + 1)];
      const v3 = field[idx(x, y + 1)];
      const c0 = v0 >= iso ? 1 : 0;
      const c1 = v1 >= iso ? 1 : 0;
      const c2 = v2 >= iso ? 1 : 0;
      const c3 = v3 >= iso ? 1 : 0;
      const code = c0 | (c1 << 1) | (c2 << 2) | (c3 << 3);
      if (code === 0 || code === 15) continue;
      // Edges: 0=top (x..x+1,y), 1=right, 2=bottom, 3=left
      const pts: Array<[number, number]> = [];
      if ((code & 1) !== (code >> 1 & 1)) { // top edge crossing between v0-v1
        const t = interp(v0, v1); pts.push([x + t, y]);
      }
      if ((code >> 1 & 1) !== (code >> 2 & 1)) { // right edge crossing v1-v2
        const t = interp(v1, v2); pts.push([x + 1, y + t]);
      }
      if ((code >> 2 & 1) !== (code >> 3 & 1)) { // bottom edge crossing v3-v2
        const t = interp(v3, v2); pts.push([x + t, y + 1]);
      }
      if ((code >> 3 & 1) !== (code & 1)) { // left edge crossing v0-v3
        const t = interp(v0, v3); pts.push([x, y + t]);
      }
      if (pts.length === 2) {
        segs.push({ x1: pts[0][0], y1: pts[0][1], x2: pts[1][0], y2: pts[1][1] });
      } else if (pts.length === 4) {
        // ambiguous case: split into two segments
        segs.push({ x1: pts[0][0], y1: pts[0][1], x2: pts[1][0], y2: pts[1][1] });
        segs.push({ x1: pts[2][0], y1: pts[2][1], x2: pts[3][0], y2: pts[3][1] });
      }
    }
  }
  return segs;
}

// Connect segments into polylines
function segmentsToPolylines(segs: Segment[], tol = 1e-3): Vec2[][] {
  // Build adjacency of endpoints with rounding tolerance
  const fmt = (v: number) => v.toFixed(4);
  const kpt = (x: number, y: number) => `${fmt(x)},${fmt(y)}`;
  const buckets = new Map<string, Array<[number, number]>>();
  const addBucket = (x: number, y: number) => {
    const k = kpt(x, y);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k)!.push([x, y]);
  };
  for (const s of segs) { addBucket(s.x1, s.y1); addBucket(s.x2, s.y2); }
  const snap = (x: number, y: number): [number, number] => {
    const k = kpt(x, y);
    const arr = buckets.get(k);
    if (arr && arr.length) return arr[0] as [number, number];
    return [x, y];
  };
  // Map from point key to list of edges starting there
  type Edge = { a: Vec2; b: Vec2; used: boolean };
  const outAdj = new Map<string, Edge[]>();
  const edges: Edge[] = [];
  for (const s of segs) {
    const a = snap(s.x1, s.y1);
    const b = snap(s.x2, s.y2);
    const e: Edge = { a, b, used: false };
    edges.push(e);
    const ka = kpt(a[0], a[1]);
    if (!outAdj.has(ka)) outAdj.set(ka, []);
    outAdj.get(ka)!.push(e);
  }
  const polylines: Vec2[][] = [];
  const near = (u: Vec2, v: Vec2) => Math.hypot(u[0] - v[0], u[1] - v[1]) <= tol;
  for (const e of edges) {
    if (e.used) continue;
    const poly: Vec2[] = [e.a];
    e.used = true;
    let cur = e.b;
    let guard = 0;
    while (guard++ < 200000) {
      poly.push(cur);
      if (near(poly[0], cur)) break; // closed
      const k = kpt(cur[0], cur[1]);
      const outs = outAdj.get(k) || [];
      let next: Edge | null = null;
      for (const cand of outs) { if (!cand.used) { next = cand; break; } }
      if (!next) break;
      next.used = true; cur = next.b;
    }
    if (poly.length > 3 && near(poly[0], poly[poly.length - 1])) polylines.push(poly);
  }
  return polylines;
}

function areaOf(poly: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) / 2;
}

export function interpolateBetweenContoursSDT(
  contour1: number[], z1: number,
  contour2: number[], z2: number,
  targetZ: number,
  options?: { gridSpacingMm?: number; paddingMm?: number }
): number[] {
  if (!contour1?.length || !contour2?.length) return [];
  const t = (targetZ - z1) / (z2 - z1);
  if (!(t > 0 && t < 1)) return [];
  const spacing = Math.max(0.15, options?.gridSpacingMm ?? 0.25);
  const pad = options?.paddingMm ?? 3;
  // Convert to 2D arrays
  const a: Vec2[] = []; const b: Vec2[] = [];
  for (let i = 0; i < contour1.length; i += 3) a.push([contour1[i], contour1[i + 1]]);
  for (let i = 0; i < contour2.length; i += 3) b.push([contour2[i], contour2[i + 1]]);
  const bounds = computeBounds([a, b], pad);
  const width = Math.max(8, Math.ceil((bounds.maxX - bounds.minX) / spacing));
  const height = Math.max(8, Math.ceil((bounds.maxY - bounds.minY) / spacing));
  // Debug
  // console.log('[SDT] grid', {width, height, spacing, bounds, z1, z2, targetZ});
  // Map world->grid coords
  const toGrid = (poly: Vec2[]): Vec2[] => poly.map(([x, y]) => [ (x - bounds.minX) / spacing, (y - bounds.minY) / spacing ]);
  const aG = toGrid(a);
  const bG = toGrid(b);
  // Rasterize masks
  const m1 = new Uint8Array(width * height);
  const m2 = new Uint8Array(width * height);
  fillPolygon(m1, width, height, aG);
  fillPolygon(m2, width, height, bG);
  // Debug: if either is empty, bail out
  const sum1 = m1.reduce((s, v) => s + v, 0); const sum2 = m2.reduce((s, v) => s + v, 0);
  // SDT
  const sdt1 = signedDistance(m1, width, height, spacing);
  const sdt2 = signedDistance(m2, width, height, spacing);
  // Blend
  const sdt = new Float32Array(width * height);
  let minV = Infinity, maxV = -Infinity;
  for (let i = 0; i < sdt.length; i++) {
    const v = (1 - t) * sdt1[i] + t * sdt2[i];
    sdt[i] = v;
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }
  if (!(minV <= 0 && maxV >= 0)) {
    // Force a zero level by centering
    const shift = (minV + maxV) / 2;
    for (let i = 0; i < sdt.length; i++) sdt[i] -= shift;
  }
  // Extract iso-0
  const segs = marchingSquaresZero(sdt, width, height);
  const polylines = segmentsToPolylines(segs, 1e-2);
  if (DEBUG_COUNT < 6) {
    console.log('[SDT] z', targetZ.toFixed(2), 'grid', width, height, 'maskSums', sum1, sum2, 'min/max', minV.toFixed(3), maxV.toFixed(3), 'segs', segs.length, 'polys', polylines.length);
    DEBUG_COUNT++;
  }
  if (!polylines.length) return [];
  // Choose largest loop by point count as a robust proxy when areas are unreliable
  polylines.sort((p, q) => q.length - p.length);
  const poly = polylines[0];
  // Convert back to world coords (pixel edge coords -> world mm)
  const pts: number[] = [];
  for (const [gx, gy] of poly) {
    const x = bounds.minX + gx * spacing;
    const y = bounds.minY + gy * spacing;
    pts.push(x, y, targetZ);
  }
  return pts;
}

// Multi-loop SDT interpolation with area-matched threshold (Eclipse-like)
export function interpolateBetweenContoursSDTMulti(
  contoursA: Array<{ points: number[] }>, z1: number,
  contoursB: Array<{ points: number[] }>, z2: number,
  targetZ: number,
  options?: { gridSpacingMm?: number; paddingMm?: number; adaptiveMinCells?: number; blend?: 'linear'|'smoothmin'; closingMm?: number; pivotPiecewise?: boolean; pivotMode?: 'euclidean'|'l1'; }
): number[] {
  const t = (targetZ - z1) / (z2 - z1);
  if (!(t > 0 && t < 1)) return [];
  const spacingDefault = options?.gridSpacingMm ?? 0.25;
  const pad = options?.paddingMm ?? 3;
  const minCells = options?.adaptiveMinCells ?? 180;

  // Collect all points
  const polysA: Vec2[][] = [];
  const polysB: Vec2[][] = [];
  const addPoly = (pts: number[]): Vec2[] => {
    const out: Vec2[] = []; for (let i = 0; i < pts.length; i += 3) out.push([pts[i], pts[i + 1]]); return out;
  };
  contoursA.forEach(c => polysA.push(addPoly(c.points)));
  contoursB.forEach(c => polysB.push(addPoly(c.points)));

  const bounds = computeBounds([...polysA, ...polysB], pad);
  const mmW = bounds.maxX - bounds.minX;
  const mmH = bounds.maxY - bounds.minY;
  if (!(mmW > 0 && mmH > 0)) return [];
  const tightSpacing = Math.max(0.10, Math.min(spacingDefault, Math.min(mmW, mmH) / minCells));
  const spacing = Math.min(spacingDefault, tightSpacing);
  const width = Math.max(8, Math.ceil(mmW / spacing));
  const height = Math.max(8, Math.ceil(mmH / spacing));

  // Rasterize union for each side
  const pip = (pt: Vec2, poly: Vec2[]): boolean => {
    let inside = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1]; const xj = poly[j][0], yj = poly[j][1];
      const inter = ((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi + 1e-12) + xi);
      if (inter) inside = !inside;
    } return inside;
  };
  const maskA = new Uint8Array(width * height);
  const maskB = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const wx = bounds.minX + (x + 0.5) * spacing;
      const wy = bounds.minY + (y + 0.5) * spacing;
      const p: Vec2 = [wx, wy];
      for (const poly of polysA) { if (pip(p, poly)) { maskA[y * width + x] = 1; break; } }
      for (const poly of polysB) { if (pip(p, poly)) { maskB[y * width + x] = 1; break; } }
    }
  }

  // Build SDTs
  const INF = 1e20;
  const fInA = new Float32Array(width * height);
  const fOutA = new Float32Array(width * height);
  const fInB = new Float32Array(width * height);
  const fOutB = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    fInA[i] = maskA[i] ? 0 : INF; fOutA[i] = maskA[i] ? INF : 0;
    fInB[i] = maskB[i] ? 0 : INF; fOutB[i] = maskB[i] ? INF : 0;
  }
  const dInA = edt2d(fInA, width, height);
  const dOutA = edt2d(fOutA, width, height);
  const dInB = edt2d(fInB, width, height);
  const dOutB = edt2d(fOutB, width, height);
  const sdtA = new Float32Array(width * height);
  const sdtB = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    sdtA[i] = (Math.sqrt(dOutA[i]) - Math.sqrt(dInA[i])) * spacing;
    sdtB[i] = (Math.sqrt(dOutB[i]) - Math.sqrt(dInB[i])) * spacing;
  }

  // Optional pivot + piecewise SDT: build a mid-slice pivot mask via simple cone-union and area-match, then blend A->P or P->B
  const blendMode = options?.blend;
  const usePivot = !!options?.pivotPiecewise;
  const closingMm = options?.closingMm;
  let bin = new Uint8Array(width * height);
  if (usePivot) {
    // Area of A and B
    let areaA = 0, areaB = 0; for (let i = 0; i < width * height; i++) { if (maskA[i]) areaA++; if (maskB[i]) areaB++; }
    // Build pivot via Euclidean cone-union at t=0.5 with area match
    const dzA = Math.abs((z1 + z2) / 2 - z1); // = |z2-z1|/2
    const dzB = Math.abs(z2 - (z1 + z2) / 2);
    let klo = 0, khi = Math.max(mmW, mmH) * 2;
    const tmp = new Uint8Array(width * height);
    const tmp2 = new Uint8Array(width * height);
    const applyClosing = (src: Uint8Array) => {
      if (!closingMm || closingMm <= 0) return src;
      const rPx = Math.max(1, Math.round(closingMm / spacing));
      // dilate
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          let on = 0; for (let dy=-rPx; dy<=rPx && !on; dy++){ const yy=y+dy; if(yy<0||yy>=height) continue; for(let dx=-rPx; dx<=rPx; dx++){ const xx=x+dx; if(xx<0||xx>=width) continue; if(src[yy*width+xx]){ on=1; break; } } }
          tmp2[y*width+x]=on;
        }
      }
      // erode back into src
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          let keep = 1; for (let dy=-rPx; dy<=rPx && keep; dy++){ const yy=y+dy; if(yy<0||yy>=height){ keep=0; break;} for(let dx=-rPx; dx<=rPx; dx++){ const xx=x+dx; if(xx<0||xx>=width){ keep=0; break;} if(!tmp2[yy*width+xx]){ keep=0; break;} } }
          src[y*width+x]= keep?1:0;
        }
      }
      return src;
    };
    for (let it = 0; it < 24; it++) {
      const k = (klo + khi) / 2;
      const rA = k * dzA, rB = k * dzB;
      // Euclidean cone-union using SDTs: inside if sdtA>=rA or sdtB>=rB
      let cnt = 0;
      for (let i = 0; i < width * height; i++) { const inside = (sdtA[i] - rA) >= 0 || (sdtB[i] - rB) >= 0; tmp[i] = inside ? 1 : 0; if (inside) cnt++; }
      const src = applyClosing(tmp.slice());
      let cnt2 = 0; for (let i = 0; i < width * height; i++) if (src[i]) cnt2++;
      const targetMid = 0.5 * (areaA + areaB);
      if (cnt2 > targetMid) khi = k; else klo = k;
    }
    // finalize pivot
    const k = (klo + khi) / 2; const rA = k * dzA, rB = k * dzB;
    const pivot = new Uint8Array(width * height);
    for (let i = 0; i < width * height; i++) pivot[i] = ((sdtA[i] - rA) >= 0 || (sdtB[i] - rB) >= 0) ? 1 : 0;
    applyClosing(pivot);
    // SDT of pivot
    const fInP = new Float32Array(width * height); const fOutP = new Float32Array(width * height);
    for (let i = 0; i < width * height; i++) { fInP[i] = pivot[i] ? 0 : INF; fOutP[i] = pivot[i] ? INF : 0; }
    const dInP = edt2d(fInP, width, height); const dOutP = edt2d(fOutP, width, height);
    const sdtP = new Float32Array(width * height);
    for (let i = 0; i < width * height; i++) sdtP[i] = (Math.sqrt(dOutP[i]) - Math.sqrt(dInP[i])) * spacing;
    // Blend piecewise to match area between respective endpoints
    // Compute areas for targets
    let areaP = 0; for (let i = 0; i < width * height; i++) if (pivot[i]) areaP++;
    let t2 = t;
    let targetCount = 0;
    const field = new Float32Array(width * height);
    let minV = Infinity, maxV = -Infinity;
    if (t <= 0.5) {
      const u = t * 2; // 0..1
      targetCount = (1 - u) * areaA + u * areaP;
      for (let i = 0; i < width * height; i++) { const v = (1 - u) * sdtA[i] + u * sdtP[i]; field[i] = v; if (v < minV) minV = v; if (v > maxV) maxV = v; }
    } else {
      const u = (t - 0.5) * 2; // 0..1
      targetCount = (1 - u) * areaP + u * areaB;
      for (let i = 0; i < width * height; i++) { const v = (1 - u) * sdtP[i] + u * sdtB[i]; field[i] = v; if (v < minV) minV = v; if (v > maxV) maxV = v; }
    }
    // Threshold by area match
    let lo = minV, hi = maxV;
    for (let it = 0; it < 24; it++) { const mid = (lo + hi) / 2; let cnt = 0; for (let i = 0; i < width * height; i++) if (field[i] - mid >= 0) cnt++; if (cnt > targetCount) lo = mid; else hi = mid; }
    const tau = (lo + hi) / 2;
    bin = new Uint8Array(width * height);
    for (let i = 0; i < width * height; i++) bin[i] = (field[i] - tau) >= 0 ? 1 : 0;
    if (closingMm && closingMm > 0) {
      const rPx = Math.max(1, Math.round(closingMm / spacing));
      const dil = new Uint8Array(width * height);
      for (let y = 0; y < height; y++) { for (let x = 0; x < width; x++) { let on = 0; for (let dy=-rPx; dy<=rPx && !on; dy++){ const yy=y+dy; if(yy<0||yy>=height) continue; for(let dx=-rPx; dx<=rPx; dx++){ const xx=x+dx; if(xx<0||xx>=width) continue; if(bin[yy*width+xx]){ on=1; break; } } } dil[y*width+x]=on; } }
      for (let y = 0; y < height; y++) { for (let x = 0; x < width; x++) { let keep = 1; for (let dy=-rPx; dy<=rPx && keep; dy++){ const yy=y+dy; if(yy<0||yy>=height){ keep=0; break;} for(let dx=-rPx; dx<=rPx; dx++){ const xx=x+dx; if(xx<0||xx>=width){ keep=0; break;} if(!dil[yy*width+xx]){ keep=0; break;} } } bin[y*width+x]= keep?1:0; } }
    }
  } else {
    // Standard SDT blend (linear or smooth-min), then area-match
    const field = new Float32Array(width * height);
    let minV = Infinity, maxV = -Infinity;
    if (blendMode === 'smoothmin') {
      const alpha = Math.max(0.1, spacing * 2);
      for (let i = 0; i < width * height; i++) { const v = -alpha * Math.log((1 - t) * Math.exp(-sdtA[i] / alpha) + t * Math.exp(-sdtB[i] / alpha)); field[i] = v; if (v < minV) minV = v; if (v > maxV) maxV = v; }
    } else {
      for (let i = 0; i < width * height; i++) { const v = (1 - t) * sdtA[i] + t * sdtB[i]; field[i] = v; if (v < minV) minV = v; if (v > maxV) maxV = v; }
    }
    // Area target
    let areaA = 0, areaB = 0; for (let i = 0; i < width * height; i++) { if (maskA[i]) areaA++; if (maskB[i]) areaB++; }
    const targetCount = (1 - t) * areaA + t * areaB;
    let lo = minV, hi = maxV; const iters = 24;
    for (let it = 0; it < iters; it++) { const mid = (lo + hi) / 2; let cnt = 0; for (let i = 0; i < width * height; i++) if (field[i] - mid >= 0) cnt++; if (cnt > targetCount) lo = mid; else hi = mid; }
    const tau = (lo + hi) / 2;
    bin = new Uint8Array(width * height);
    for (let i = 0; i < width * height; i++) bin[i] = (field[i] - tau) >= 0 ? 1 : 0;
    if (closingMm && closingMm > 0) {
      const rPx = Math.max(1, Math.round(closingMm / spacing));
      const dil = new Uint8Array(width * height);
      for (let y = 0; y < height; y++) { for (let x = 0; x < width; x++) { let on = 0; for (let dy=-rPx; dy<=rPx && !on; dy++){ const yy=y+dy; if(yy<0||yy>=height) continue; for(let dx=-rPx; dx<=rPx; dx++){ const xx=x+dx; if(xx<0||xx>=width) continue; if(bin[yy*width+xx]){ on=1; break; } } } dil[y*width+x]=on; } }
      for (let y = 0; y < height; y++) { for (let x = 0; x < width; x++) { let keep = 1; for (let dy=-rPx; dy<=rPx && keep; dy++){ const yy=y+dy; if(yy<0||yy>=height){ keep=0; break;} for(let dx=-rPx; dx<=rPx; dx++){ const xx=x+dx; if(xx<0||xx>=width){ keep=0; break;} if(!dil[yy*width+xx]){ keep=0; break;} } } bin[y*width+x]= keep?1:0; } }
    }
  }
  const fieldBin = new Float32Array(width * height); for (let i = 0; i < width * height; i++) fieldBin[i] = (bin[i] ? 1 : 0) - 0.5;
  const segs = marchingSquaresZero(fieldBin, width, height);
  const polylines = segmentsToPolylines(segs, 1e-2);
  if (!polylines.length) return [];
  // Choose loop: closest centroid to interpolated centroid, tie by area
  const centroid = (poly: Vec2[]): Vec2 => { let a=0,cx=0,cy=0; for (let i=0;i<poly.length;i++){const p=poly[i],q=poly[(i+1)%poly.length]; const c=p[0]*q[1]-q[0]*p[1]; a+=c; cx+=(p[0]+q[0])*c; cy+=(p[1]+q[1])*c;} a*=0.5; if (Math.abs(a)<1e-6) return [poly[0][0],poly[0][1]]; return [cx/(6*a), cy/(6*a)]; };
  const cA = centroid(polysA[0]); const cB = centroid(polysB[0]); const ci: Vec2 = [cA[0]+(cB[0]-cA[0])*t, cA[1]+(cB[1]-cA[1])*t];
  polylines.sort((p,q)=>{ const cp=centroid(p), cq=centroid(q); const dp=(cp[0]-ci[0])**2+(cp[1]-ci[1])**2; const dq=(cq[0]-ci[0])**2+(cq[1]-ci[1])**2; if (dp!==dq) return dp-dq; return areaOf(q)-areaOf(p); });
  const ring = polylines[0];
  const out: number[] = [];
  for (const [gx, gy] of ring) {
    const x = bounds.minX + gx * spacing;
    const y = bounds.minY + gy * spacing;
    out.push(x, y, targetZ);
  }
  return out;
}
