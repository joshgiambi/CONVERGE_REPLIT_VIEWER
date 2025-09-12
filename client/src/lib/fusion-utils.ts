/*
 * Utility functions to reliably map CT slices to MRI slices and perform interpolation,
 * ensuring correct ordering and sequential behavior.
 */

/**
 * Multiply a 4x4 matrix by a 4-vector.
 */
function multiplyMatrixVector(matrix: number[][], vector: number[]): number[] {
  const result = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      result[i] += matrix[i][j] * vector[j];
    }
  }
  return result;
}

/**
 * Precompute and sort MRI slice positions in CT coordinates.
 * @param secondaryImages Array of MRI image metadata objects (must include imagePosition)
 * @param registrationMatrix Flat length-16 array representing 4x4 DICOM registration matrix
 * @returns Array of { zInCT: number, image } sorted by zInCT ascending
 */
export function computeTransformedMRIPositions(
  secondaryImages: any[],
  registrationMatrix: number[],
  ctImageOrientation?: string | number[] | null,
  ctImagePosition?: string | number[] | null,
  secondaryCache?: Map<string, { data: Float32Array; width: number; height: number; metadata?: any }>
) {
  // Build 4x4 matrix
  const M = [
    [registrationMatrix[0], registrationMatrix[1], registrationMatrix[2], registrationMatrix[3]],
    [registrationMatrix[4], registrationMatrix[5], registrationMatrix[6], registrationMatrix[7]],
    [registrationMatrix[8], registrationMatrix[9], registrationMatrix[10], registrationMatrix[11]],
    [registrationMatrix[12], registrationMatrix[13], registrationMatrix[14], registrationMatrix[15]]
  ];

  // Prepare CT orientation normal if provided
  let ctNormal: [number, number, number] | null = null;
  let ctOrigin: [number, number, number] | null = null;
  try {
    if (ctImageOrientation) {
      const iop = Array.isArray(ctImageOrientation)
        ? (ctImageOrientation as number[]).map(Number)
        : String(ctImageOrientation).split("\\").map(Number);
      if (iop.length >= 6) {
        const rx = iop[0], ry = iop[1], rz = iop[2]; // row direction cosines
        const cx = iop[3], cy = iop[4], cz = iop[5]; // column direction cosines
        // normal = row x column
        const nx = ry * cz - rz * cy;
        const ny = rz * cx - rx * cz;
        const nz = rx * cy - ry * cx;
        const len = Math.hypot(nx, ny, nz) || 1;
        ctNormal = [nx / len, ny / len, nz / len];
      }
    }
    if (ctImagePosition) {
      const pos = Array.isArray(ctImagePosition)
        ? (ctImagePosition as number[]).map(Number)
        : String(ctImagePosition).split("\\").map(Number);
      if (pos.length >= 3) ctOrigin = [pos[0], pos[1], pos[2]];
    }
  } catch (_) {
    ctNormal = null;
    ctOrigin = null;
  }

  // Pre-extract 3x3 rotation (or linear) part for transforming MRI direction cosines
  const R = [
    [M[0][0], M[0][1], M[0][2]],
    [M[1][0], M[1][1], M[1][2]],
    [M[2][0], M[2][1], M[2][2]]
  ];

  const dot3 = (a: number[], b: number[]) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
  const cross3 = (a: number[], b: number[]) => [
    a[1]*b[2] - a[2]*b[1],
    a[2]*b[0] - a[0]*b[2],
    a[0]*b[1] - a[1]*b[0]
  ];
  const norm3 = (v: number[]) => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0]/l, v[1]/l, v[2]/l];
  };

  let transformed = secondaryImages.map(img => {
    // Parse imagePosition into [x,y,z] with null safety
    let pos: number[] | null = null;
    try {
      if (Array.isArray(img.imagePosition)) {
        pos = (img.imagePosition as number[]).map(Number);
      } else if (img.imagePosition && typeof img.imagePosition === 'string') {
        pos = String(img.imagePosition).split('\\').map(Number);
      } else if (img.imageMetadata?.imagePosition) {
        const v = img.imageMetadata.imagePosition;
        pos = Array.isArray(v) ? v.map(Number) : String(v).split('\\').map(Number);
      } else if (secondaryCache && img.sopInstanceUID) {
        const cached = secondaryCache.get(img.sopInstanceUID);
        const meta = cached?.metadata;
        if (meta?.imagePosition) {
          const v = meta.imagePosition;
          pos = Array.isArray(v) ? v.map(Number) : String(v).split('\\').map(Number);
        }
      }
    } catch {}

    if (!pos || pos.length < 3 || !isFinite(pos[0]) || !isFinite(pos[1]) || !isFinite(pos[2])) {
      // STRICT: do not use synthetic Z; exclude this slice from fusion
      console.warn('Missing ImagePositionPatient for MRI image — excluded from fusion');
      return null as any;
    }
    const hom = [pos[0], pos[1], pos[2], 1];
    const [xInCT, yInCT, zInCTPoint] = multiplyMatrixVector(M, hom).slice(0, 3);

    let zInCT = zInCTPoint;
    let planeInfo: { nCT: number[]; denom: number; cMRI: number } | undefined = undefined;
    if (ctNormal && ctOrigin) {
      // Geometry-driven plane distance: compute MRI slice plane normal in CT coords if possible
      let mriRow: number[] | null = null;
      let mriCol: number[] | null = null;
      try {
        let iopVal: any = (img.imageOrientation ?? img.imageMetadata?.imageOrientation);
        if ((!iopVal) && secondaryCache && img.sopInstanceUID) {
          iopVal = secondaryCache.get(img.sopInstanceUID)?.metadata?.imageOrientation;
        }
        const iopArr: number[] = Array.isArray(iopVal)
          ? (iopVal as number[]).map(Number)
          : (typeof iopVal === 'string' ? (iopVal as string).split('\\').map(Number) : []);
        if (iopArr.length >= 6 && iopArr.every(v => isFinite(v))) {
          mriRow = [iopArr[0], iopArr[1], iopArr[2]];
          mriCol = [iopArr[3], iopArr[4], iopArr[5]];
        }
      } catch {}

      if (mriRow && mriCol) {
        // Transform MRI row/col direction cosines into CT space using R
        const rowCT = [
          R[0][0]*mriRow[0] + R[0][1]*mriRow[1] + R[0][2]*mriRow[2],
          R[1][0]*mriRow[0] + R[1][1]*mriRow[1] + R[1][2]*mriRow[2],
          R[2][0]*mriRow[0] + R[2][1]*mriRow[1] + R[2][2]*mriRow[2],
        ];
        const colCT = [
          R[0][0]*mriCol[0] + R[0][1]*mriCol[1] + R[0][2]*mriCol[2],
          R[1][0]*mriCol[0] + R[1][1]*mriCol[1] + R[1][2]*mriCol[2],
          R[2][0]*mriCol[0] + R[2][1]*mriCol[1] + R[2][2]*mriCol[2],
        ];
        const nMRI_CT = norm3(cross3(rowCT, colCT));
        const denom = dot3(nMRI_CT, ctNormal);
        if (isFinite(denom) && Math.abs(denom) > 1e-6) {
          // Plane equation for MRI slice in CT: nMRI_CT · X = c, with c = nMRI_CT · pMRI_CT
          const c = dot3(nMRI_CT, [xInCT, yInCT, zInCTPoint]);
          const c0 = dot3(nMRI_CT, ctOrigin);
          // Signed distance along CT normal from CT origin plane to MRI plane
          zInCT = (c - c0) / denom;
          planeInfo = { nCT: nMRI_CT, denom, cMRI: c };
        } else {
          // Fallback to point-projection if planes are nearly parallel to avoid noise
          const dx = xInCT - ctOrigin[0];
          const dy = yInCT - ctOrigin[1];
          const dz = zInCTPoint - ctOrigin[2];
          zInCT = dx * ctNormal[0] + dy * ctNormal[1] + dz * ctNormal[2];
        }
      } else {
        // Fallback: project MRI origin onto CT normal
        const dx = xInCT - ctOrigin[0];
        const dy = yInCT - ctOrigin[1];
        const dz = zInCTPoint - ctOrigin[2];
        zInCT = dx * ctNormal[0] + dy * ctNormal[1] + dz * ctNormal[2];
      }
    }
    return { xInCT, yInCT, zInCT, image: img, _plane: planeInfo, zInCTPoint } as any;
  });

  // Remove any images we could not position safely
  const before = transformed.length;
  transformed = (transformed.filter(Boolean) as Array<{ xInCT: number; yInCT: number; zInCT: number; image: any }>);
  if (before !== transformed.length) {
    console.warn(`Skipped ${before - transformed.length} MRI slices without valid ImagePositionPatient during fusion prep`);
  }

  // Second pass: approximate plane normals for slices missing orientation using neighbors
  if (ctNormal && ctOrigin && transformed.length >= 2) {
    for (let i = 0; i < transformed.length; i++) {
      const t: any = transformed[i];
      if (!t._plane) {
        const nb = transformed[i+1] || transformed[i-1];
        if (nb) {
          const v = [
            (nb as any).xInCT - t.xInCT,
            (nb as any).yInCT - t.yInCT,
            (nb as any).zInCTPoint - t.zInCTPoint
          ];
          const vlen = Math.hypot(v[0], v[1], v[2]) || 1;
          const nCT = [v[0]/vlen, v[1]/vlen, v[2]/vlen];
          const denom = nCT[0]*ctNormal[0] + nCT[1]*ctNormal[1] + nCT[2]*ctNormal[2];
          if (isFinite(denom) && Math.abs(denom) > 1e-6) {
            const cMRI = nCT[0]*t.xInCT + nCT[1]*t.yInCT + nCT[2]*t.zInCTPoint;
            const c0 = nCT[0]*ctOrigin[0] + nCT[1]*ctOrigin[1] + nCT[2]*ctOrigin[2];
            const z = (cMRI - c0) / denom;
            t.zInCT = z;
            t._plane = { nCT, denom, cMRI };
          }
        }
      }
    }
  }

  // Sort ascending by zInCT
  transformed.sort((a, b) => a.zInCT - b.zInCT);
  
  // Debug: Log sample transformed coordinates
  if (transformed.length > 0) {
    const first = transformed[0];
    const middle = transformed[Math.floor(transformed.length / 2)];
    const last = transformed[transformed.length - 1];
    console.log(`🔍 Sample MRI→CT coordinate transformations:`);
    console.log(`  First: (${first.xInCT.toFixed(1)}, ${first.yInCT.toFixed(1)}, ${first.zInCT.toFixed(1)})mm in CT space`);
    console.log(`  Middle: (${middle.xInCT.toFixed(1)}, ${middle.yInCT.toFixed(1)}, ${middle.zInCT.toFixed(1)})mm in CT space`);
    console.log(`  Last: (${last.xInCT.toFixed(1)}, ${last.yInCT.toFixed(1)}, ${last.zInCT.toFixed(1)})mm in CT space`);
  }
  
  return transformed;
}

/**
 * Invert a 4x4 matrix provided as a flat 16-element array (row-major).
 * Returns null if the matrix is non-invertible.
 */
export function invertMatrix4x4(m: number[]): number[] | null {
  if (!Array.isArray(m) || m.length !== 16) return null;
  const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3];
  const a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
  const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];
  const a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];

  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;

  // Calculate the determinant
  const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!isFinite(det) || Math.abs(det) < 1e-12) return null;
  const invDet = 1.0 / det;

  const inv = new Array<number>(16);
  inv[0]  = ( a11 * b11 - a12 * b10 + a13 * b09) * invDet;
  inv[1]  = (-a01 * b11 + a02 * b10 - a03 * b09) * invDet;
  inv[2]  = ( a31 * b05 - a32 * b04 + a33 * b03) * invDet;
  inv[3]  = (-a21 * b05 + a22 * b04 - a23 * b03) * invDet;
  inv[4]  = (-a10 * b11 + a12 * b08 - a13 * b07) * invDet;
  inv[5]  = ( a00 * b11 - a02 * b08 + a03 * b07) * invDet;
  inv[6]  = (-a30 * b05 + a32 * b02 - a33 * b01) * invDet;
  inv[7]  = ( a20 * b05 - a22 * b02 + a23 * b01) * invDet;
  inv[8]  = ( a10 * b10 - a11 * b08 + a13 * b06) * invDet;
  inv[9]  = (-a00 * b10 + a01 * b08 - a03 * b06) * invDet;
  inv[10] = ( a30 * b04 - a31 * b02 + a33 * b00) * invDet;
  inv[11] = (-a20 * b04 + a21 * b02 - a23 * b00) * invDet;
  inv[12] = (-a10 * b09 + a11 * b07 - a12 * b06) * invDet;
  inv[13] = ( a00 * b09 - a01 * b07 + a02 * b06) * invDet;
  inv[14] = (-a30 * b03 + a31 * b01 - a32 * b00) * invDet;
  inv[15] = ( a20 * b03 - a21 * b01 + a22 * b00) * invDet;

  return inv;
}

/**
 * Transpose a 4x4 matrix provided as a flat 16-element array (row-major).
 * Returns a new flat array representing the transposed matrix.
 */
export function transposeMatrix4x4(m: number[]): number[] {
  if (!Array.isArray(m) || m.length !== 16) return m;
  return [
    m[0], m[4], m[8],  m[12],
    m[1], m[5], m[9],  m[13],
    m[2], m[6], m[10], m[14],
    m[3], m[7], m[11], m[15],
  ];
}

/**
 * Find the index of the MRI slice closest to a given CT z-coordinate.
 * Uses binary search on the sorted transformed array.
 * @param ctZ CT slice z-coordinate in patient space
 * @param transformed Array from computeTransformedMRIPositions
 * @returns Index of best match, or null if none
 */
export function findNearestMRIIndex(ctZ: number, transformed: Array<{xInCT: number, yInCT: number, zInCT: number, image: any}>): number | null {
  if (!transformed.length) return null;
  let low = 0, high = transformed.length - 1, bestIdx = 0;
  let bestDist = Infinity;

  // Binary search to approximate
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const dist = Math.abs(transformed[mid].zInCT - ctZ);
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = mid;
    }
    if (transformed[mid].zInCT < ctZ) low = mid + 1;
    else high = mid - 1;
  }

  // Check neighbors in case of tie
  if (bestIdx > 0) {
    const d2 = Math.abs(transformed[bestIdx - 1].zInCT - ctZ);
    if (d2 < bestDist) {
      bestDist = d2;
      bestIdx = bestIdx - 1;
    }
  }
  if (bestIdx < transformed.length - 1) {
    const d2 = Math.abs(transformed[bestIdx + 1].zInCT - ctZ);
    if (d2 < bestDist) {
      bestIdx = bestIdx + 1;
    }
  }

  return bestIdx;
}

/**
 * Compute CT basis vectors from ImageOrientationPatient.
 */
function basisFromIOP(iop: number[] | undefined | null): { row: number[]; col: number[]; normal: number[] } | null {
  if (!iop || iop.length < 6 || iop.some(v => !isFinite(v))) return null;
  const row = [iop[0], iop[1], iop[2]];
  const col = [iop[3], iop[4], iop[5]];
  const nx = row[1]*col[2] - row[2]*col[1];
  const ny = row[2]*col[0] - row[0]*col[2];
  const nz = row[0]*col[1] - row[1]*col[0];
  const nlen = Math.hypot(nx, ny, nz) || 1;
  const normal = [nx/nlen, ny/nlen, nz/nlen];
  return { row, col, normal };
}

/**
 * Find nearest MRI index using exact plane-to-plane distance along CT normal.
 * Falls back to zInCT if plane parameters are missing.
 */
export function findNearestMRIIndexByPlane(
  ctZ: number,
  ctNormal: number[] | null | undefined,
  ctOrigin: number[] | null | undefined,
  transformed: Array<{xInCT: number, yInCT: number, zInCT: number, image: any, _plane?: { nCT: number[]; denom: number; cMRI: number; }}> 
): number | null {
  if (!transformed.length) return null;
  if (!ctNormal || !ctOrigin || ctNormal.length < 3 || ctOrigin.length < 3) {
    return findNearestMRIIndex(ctZ, transformed);
  }
  let best = 0;
  let bestAbs = Infinity;
  for (let i = 0; i < transformed.length; i++) {
    const t = transformed[i] as any;
    let zPlane: number;
    if (t._plane && t._plane.denom && Math.abs(t._plane.denom) > 1e-6) {
      // Distance of MRI plane from CT origin along CT normal
      const c0 = t._plane.nCT[0]*ctOrigin[0] + t._plane.nCT[1]*ctOrigin[1] + t._plane.nCT[2]*ctOrigin[2];
      zPlane = (t._plane.cMRI - c0) / t._plane.denom;
    } else {
      // Fallback: project the transformed slice point
      const dx = t.xInCT - ctOrigin[0];
      const dy = t.yInCT - ctOrigin[1];
      const dz = (t as any).zInCTPoint !== undefined ? (t as any).zInCTPoint - ctOrigin[2] : transformed[i].zInCT; // best effort
      zPlane = dx*ctNormal[0] + dy*ctNormal[1] + dz*ctNormal[2];
    }
    const d = Math.abs(zPlane - ctZ);
    if (d < bestAbs) { bestAbs = d; best = i; }
  }
  return best;
}

/**
 * Interpolate MRI image data for a given CT slice.
 * If CT z is closest to an MRI slice, returns that image data; otherwise linearly interpolates between neighbors.
 * @param ctZ CT slice position
 * @param transformed Output of computeTransformedMRIPositions
 * @param cache Map from sopInstanceUID to MRIData { data: Float32Array, width, height }
 * @returns MRIData for drawing
 */
export function interpolateMRI(
  ctZ: number, 
  transformed: Array<{xInCT: number, yInCT: number, zInCT: number, image: any}>, 
  cache: Map<string, {data: Float32Array, width: number, height: number, min?: number, max?: number}>,
  opts?: { ctNormal?: number[] | null; ctOrigin?: number[] | null; mode?: 'nearest'|'blend' }
): {data: Float32Array, width: number, height: number, uid?: string, min?: number, max?: number} | null {
  // Use plane-based nearest if CT geometry provided
  const idx = (opts?.ctNormal && opts?.ctOrigin)
    ? findNearestMRIIndexByPlane(ctZ, opts.ctNormal, opts.ctOrigin, transformed as any)
    : findNearestMRIIndex(ctZ, transformed);
  if (idx === null) {
    console.log(`No MRI index found for CT Z=${ctZ}mm`);
    return null;
  }

  const best = transformed[idx];
  const distance = Math.abs(best.zInCT - ctZ);
  console.log(`Found MRI slice for CT ${ctZ}mm: MRI Z=${best.zInCT.toFixed(1)}mm (distance: ${distance.toFixed(1)}mm)`);
  
  const baseData = cache.get(best.image.sopInstanceUID);
  if (!baseData) {
    console.error(`CRITICAL: MRI image data not found in cache: ${best.image.sopInstanceUID}`);
    console.log(`Cache keys available:`, Array.from(cache.keys()).slice(0, 5));
    console.log(`Cache size:`, cache.size);
    return null;
  }
  
  console.log(`✓ Found MRI data in cache: ${baseData.width}x${baseData.height}, ${baseData.data.length} pixels`);

  // Fast path: nearest only (default for performance)
  if ((opts?.mode ?? 'nearest') === 'nearest') {
    return { ...baseData, uid: best.image.sopInstanceUID };
  }

  // Determine neighbor spacing
  const prev = transformed[idx - 1];
  const next = transformed[idx + 1];

  // If no neighbors or CT is exactly on slice, return base
  if (!prev || !next) return { ...baseData, uid: best.image.sopInstanceUID };

  const lowerZ = prev.zInCT;
  const upperZ = next.zInCT;
  if (upperZ === lowerZ) return { ...baseData, uid: best.image.sopInstanceUID };

  // Linear weight between prev and next
  const w = (ctZ - lowerZ) / (upperZ - lowerZ);

  const prevData = cache.get(prev.image.sopInstanceUID);
  const nextData = cache.get(next.image.sopInstanceUID);
  if (!prevData || !nextData) return { ...baseData, uid: best.image.sopInstanceUID };

  // Always blend with weight w (0→1) no matter how small - eliminates sudden jumps
  const length = baseData.data.length;
  const interp = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    interp[i] = prevData.data[i] * (1 - w) + nextData.data[i] * w;
  }
  // Provide conservative min/max from neighbors to avoid scanning
  const min = Math.min(prevData.min ?? prevData.data[0], nextData.min ?? nextData.data[0]);
  const max = Math.max(prevData.max ?? prevData.data[0], nextData.max ?? nextData.data[0]);
  return { data: interp, width: baseData.width, height: baseData.height, min, max };
}

/**
 * Simplified fusion render function using the above utilities.
 * Call inside your render loop and after computing transformed positions once.
 */
export async function renderFusionOverlay(
  ctx: CanvasRenderingContext2D,
  primaryImage: any,
  transformedMRI: Array<{xInCT: number, yInCT: number, zInCT: number, image: any}>,
  secondaryImageCache: Map<string, {data: Float32Array, width: number, height: number, metadata?: any}>,
  ctSliceZ: number,
  fusionOpacity: number,
  panX: number,
  panY: number,
  canvasWidth: number,
  canvasHeight: number,
  registrationMatrix?: number[],
  ctTransform?: {scale: number, offsetX: number, offsetY: number, imageWidth: number, imageHeight: number} | null,
  ctSeriesOrigin?: number[] | null,
  ctSeriesIOP?: number[] | string | null,
  isPET?: boolean,
  isCT?: boolean
) {
  // NO TRANSFORMS HERE - we assume the CT transform is already applied by the caller
  console.log('🎯 Rendering fusion overlay in CT coordinate space');

  // Z-range handling: do NOT clamp. If CT is outside the secondary coverage, skip rendering overlay.
  let ctZForInterp = ctSliceZ;
  if (transformedMRI.length > 0) {
    const zValues = transformedMRI.map(t => t.zInCT);
    const minZ = Math.min(...zValues);
    const maxZ = Math.max(...zValues);
    if (!Number.isFinite(ctZForInterp)) return; // invalid position
    if (ctZForInterp < minZ || ctZForInterp > maxZ) {
      // Outside coverage -> no overlay
      return;
    }
  }

  // Get the interpolated MRI data for this CT slice
  // Compute CT normal and origin for plane-based nearest selection
  const toNum = (v: any): number[] => Array.isArray(v) ? v.map(Number) : (typeof v === 'string' ? v.split('\\').map(Number) : []);
  let iopArr = toNum((primaryImage as any).imageOrientation ?? (primaryImage as any).imageMetadata?.imageOrientation);
  if (iopArr.length < 6 && ctSeriesIOP) {
    iopArr = toNum(ctSeriesIOP);
  }
  const posArr = toNum((primaryImage as any).imagePosition ?? (primaryImage as any).imageMetadata?.imagePosition);
  let ctNormalForInterp: number[] | null = null;
  if (iopArr.length >= 6) {
    const r = [iopArr[0], iopArr[1], iopArr[2]];
    const c = [iopArr[3], iopArr[4], iopArr[5]];
    const nx = r[1]*c[2] - r[2]*c[1];
    const ny = r[2]*c[0] - r[0]*c[2];
    const nz = r[0]*c[1] - r[1]*c[0];
    const nlen = Math.hypot(nx, ny, nz) || 1;
    ctNormalForInterp = [nx/nlen, ny/nlen, nz/nlen];
  }
  const mriData = interpolateMRI(ctZForInterp, transformedMRI, secondaryImageCache, {
    ctNormal: ctNormalForInterp,
    // Use provided series origin if available to match caller's ctSliceZ reference
    ctOrigin: (ctSeriesOrigin && ctSeriesOrigin.length >= 3) ? ctSeriesOrigin : (posArr.length >= 3 ? posArr : null)
  });
  if (!mriData) return; // nothing to draw

  // Create temp canvas
  const temp = document.createElement('canvas');
  temp.width = mriData.width;
  temp.height = mriData.height;
  const tctx = temp.getContext('2d');
  if (!tctx) return;

  // Draw secondary (MR/PT/CT) as colored overlay with enhanced contrast
  const imgData = tctx.createImageData(mriData.width, mriData.height);
  const { data } = imgData;
  
  // Guard
  if (!mriData.data || mriData.data.length === 0) {
    console.warn('MRI data is empty or invalid');
    return;
  }

  // Compute or reuse per-slice min/max for MRI normalization (not used for CT/PET LUTs)
  let min = (mriData as any).min as number | undefined;
  let max = (mriData as any).max as number | undefined;
  if (min === undefined || max === undefined) {
    let tmin = mriData.data[0], tmax = mriData.data[0];
    for (let i = 0; i < mriData.data.length; i++) {
      const v = mriData.data[i];
      if (v < tmin) tmin = v;
      if (v > tmax) tmax = v;
    }
    min = tmin; max = tmax;
    // Cache back into secondary cache if we know the UID
    try {
      const uid = (mriData as any).uid;
      if (uid && secondaryImageCache.has(uid)) {
        const prev = secondaryImageCache.get(uid)!;
        secondaryImageCache.set(uid, { ...prev, min, max });
      }
    } catch {}
  }
  const range = (max! - min!);
  
  const applyFdgLUT = (n: number) => {
    // Piecewise linear FDG-like LUT from dark orange to yellow-white
    const stops = [
      { t: 0.05, c: [0, 0, 0] },
      { t: 0.20, c: [90, 25, 0] },
      { t: 0.50, c: [220, 110, 0] },
      { t: 0.80, c: [255, 200, 0] },
      { t: 1.00, c: [255, 255, 255] },
    ];
    if (n <= stops[0].t) return { r: 0, g: 0, b: 0, a: 0 };
    for (let s = 0; s < stops.length - 1; s++) {
      const a = stops[s], b = stops[s + 1];
      if (n <= b.t) {
        const w = (n - a.t) / (b.t - a.t);
        const r = Math.round(a.c[0] + w * (b.c[0] - a.c[0]));
        const g = Math.round(a.c[1] + w * (b.c[1] - a.c[1]));
        const bb = Math.round(a.c[2] + w * (b.c[2] - a.c[2]));
        return { r, g, b: bb, a: 255 };
      }
    }
    return { r: 255, g: 255, b: 255, a: 255 };
  };

  // Secondary CT: apply default window/level on Hounsfield values; MRI: simple min-max normalization
  if (isCT) {
    const WW = 350; // default
    const WC = 40;  // default
    const minHU = WC - WW / 2;
    const maxHU = WC + WW / 2;
    const widthHU = maxHU - minHU || 1;
    for (let i = 0; i < mriData.data.length; i++) {
      const vHU = mriData.data[i];
      const n = Math.max(0, Math.min(1, (vHU - minHU) / widthHU));
      const v = Math.round(n * 255);
      const idx4 = i * 4;
      data[idx4] = data[idx4 + 1] = data[idx4 + 2] = v;
      data[idx4 + 3] = 255; // alpha controlled globally by fusionOpacity
    }
  } else {
    for (let i = 0; i < mriData.data.length; i++) {
      const normalized = range > 0 ? (mriData.data[i] - (min as number)) / range : 0;
      const idx4 = i * 4;
      if (isPET) {
        const { r, g, b, a } = applyFdgLUT(normalized);
        data[idx4] = r;
        data[idx4 + 1] = g;
        data[idx4 + 2] = b;
        data[idx4 + 3] = a;
      } else {
        const v = Math.max(0, Math.min(255, Math.round(normalized * 255)));
        data[idx4] = data[idx4 + 1] = data[idx4 + 2] = v;
        data[idx4 + 3] = 255; // remove per-pixel alpha thresholding to avoid islands
      }
    }
  }
  tctx.putImageData(imgData, 0, 0);

  // PROPER PHYSICAL SCALING using pixel spacings
  const w = mriData.width;
  const h = mriData.height;
  
  console.log(`MRI dimensions: ${w}x${h}, Canvas: ${canvasWidth}x${canvasHeight}`);
  
  // Helper function to normalize spacing arrays
  function normalizeSpacing(sp: string|string[]|number[]|undefined|null) {
    if (Array.isArray(sp)) return sp.map(Number);
    if (typeof sp === "string") return sp.split("\\").map(Number);
    return [1, 1];
  }
  
  // Get normalized pixel spacings for CT (with fallbacks)
  const ctSpacingArr = normalizeSpacing(
    (primaryImage as any).pixelSpacing ?? (primaryImage as any).imageMetadata?.pixelSpacing
  );
  
  // Use the same coordinate system as CT rendering - NO independent centering
  let drawX: number = 0;
  let drawY: number = 0;
  let drawW: number = w;
  let drawH: number = h;
  
  // Get the actual secondary image that was used for interpolation to access its metadata
  let actualSecondaryImage = null;
  if (transformedMRI.length > 0) {
    // Find the MRI image closest to this CT slice
    const distances = transformedMRI.map(t => ({
      image: t.image,
      distance: Math.abs(t.zInCT - ctSliceZ)
    }));
    distances.sort((a, b) => a.distance - b.distance);
    actualSecondaryImage = distances[0]?.image;
  }

  // Get MRI pixel spacing from the actual MRI metadata with robust fallbacks
  let mriSpacingArr: number[] | null = null;
  if (actualSecondaryImage) {
    const psTop = (actualSecondaryImage as any).pixelSpacing;
    const psMeta = (actualSecondaryImage as any).imageMetadata?.pixelSpacing;
    let psCache: any = undefined;
    try {
      if (secondaryImageCache?.has((actualSecondaryImage as any).sopInstanceUID)) {
        psCache = secondaryImageCache.get((actualSecondaryImage as any).sopInstanceUID)?.metadata?.pixelSpacing;
      }
    } catch {}
    const ps = psTop ?? psMeta ?? psCache;
    mriSpacingArr = normalizeSpacing(ps);
  }
  
  if (!mriSpacingArr || mriSpacingArr.length !== 2 || mriSpacingArr.some(v => !isFinite(v) || v <= 0)) {
    console.error('Invalid or missing MRI pixel spacing - cannot safely render fusion overlay');
    return; // Do not render fusion without valid pixel spacing
  }
  
  console.log(`CT spacing: [${ctSpacingArr[0]}, ${ctSpacingArr[1]}]mm, MRI spacing: [${mriSpacingArr[0]}, ${mriSpacingArr[1]}]mm`);
  
  // Calculate scale factors - MRI should appear at same physical size as CT
  // If CT spacing is 0.97mm and MRI spacing is 1.95mm, then 1 MRI pixel = 2 CT pixels
  const scaleX = mriSpacingArr[1] / ctSpacingArr[1]; // How many CT pixels per MRI pixel
  const scaleY = mriSpacingArr[0] / ctSpacingArr[0]; 
  
  // Calculate MRI size in canvas pixels - need to apply both physical scaling AND CT zoom
  const ctScale = ctTransform?.scale || 1;
  drawW = w * scaleX * ctScale;  // Apply physical scaling AND CT zoom
  drawH = h * scaleY * ctScale;
  
  console.log(`Physical scale: X=${scaleX.toFixed(3)}, Y=${scaleY.toFixed(3)}, CT zoom=${ctScale}, Final MRI size: ${drawW.toFixed(1)}x${drawH.toFixed(1)}`);

  // Helper function to normalize arrays
  const toNumberArray = (sp: string|string[]|number[]|undefined|null) => {
    if (Array.isArray(sp)) return sp.map(Number);
    if (typeof sp === "string") return sp.split("\\").map(Number);
    return [0, 0, 0]; // safer fallback for positions/origins
  };
  const toNumberArrayFlexible = (val: any): number[] => {
    if (Array.isArray(val)) return val.map(Number);
    if (typeof val === 'string') return val.split('\\').map(Number);
    return [];
  };
  
  // Matrix multiplication helper
  const multiplyMatrixVector = (matrix: number[], vector: number[]): number[] => {
    const [x, y, z, w] = vector;
    return [
      matrix[0] * x + matrix[1] * y + matrix[2] * z + matrix[3] * w,
      matrix[4] * x + matrix[5] * y + matrix[6] * z + matrix[7] * w,
      matrix[8] * x + matrix[9] * y + matrix[10] * z + matrix[11] * w,
      matrix[12] * x + matrix[13] * y + matrix[14] * z + matrix[15] * w
    ];
  };

  // Apply full 2D affine derived from 3D registration (includes rotation) when orientations are available
  if (registrationMatrix && registrationMatrix.length === 16 && actualSecondaryImage && ctTransform) {
    // CT orientation/origin with robust fallbacks to series-level values
    let ctOrigin = toNumberArray((primaryImage as any).imagePosition || (primaryImage as any).imageMetadata?.imagePosition);
    if ((!ctOrigin || ctOrigin.length < 3) && Array.isArray(ctSeriesOrigin) && ctSeriesOrigin.length >= 3) {
      ctOrigin = ctSeriesOrigin.map(Number) as number[];
    }
    let ctIOP = toNumberArrayFlexible((primaryImage.imageOrientation ?? primaryImage.imageMetadata?.imageOrientation) as any);
    if ((!ctIOP || ctIOP.length < 6) && (ctSeriesIOP as any)) {
      ctIOP = toNumberArrayFlexible(ctSeriesIOP as any);
    }
    const hasCTDirs = ctIOP.length >= 6;
    // MRI orientation/origin: use interpolation across bracketing slices so XY placement matches the intensity plane
    const getIPP = (img: any): number[] | null => {
      let arr = toNumberArrayFlexible(img?.imagePosition);
      if ((!arr || arr.length < 3) && secondaryImageCache?.has(img?.sopInstanceUID)) {
        const meta = secondaryImageCache.get(img.sopInstanceUID)?.metadata;
        const v = meta?.imagePosition;
        if (v) arr = toNumberArrayFlexible(v);
      }
      return (arr && arr.length >= 3) ? arr : null;
    };
    // Bracketing frames and linear weight
    let prev = transformedMRI[0];
    let next = transformedMRI[0];
    for (let i = 0; i < transformedMRI.length - 1; i++) {
      if (transformedMRI[i].zInCT <= ctZForInterp && ctZForInterp <= transformedMRI[i + 1].zInCT) {
        prev = transformedMRI[i];
        next = transformedMRI[i + 1];
        break;
      }
      if (ctZForInterp < transformedMRI[0].zInCT) { prev = next = transformedMRI[0]; break; }
      if (ctZForInterp > transformedMRI[transformedMRI.length - 1].zInCT) { prev = next = transformedMRI[transformedMRI.length - 1]; break; }
    }
    const lowerZ = prev.zInCT;
    const upperZ = next.zInCT;
    const wPlane = (upperZ !== lowerZ) ? (ctZForInterp - lowerZ) / (upperZ - lowerZ) : 0;
    const ippPrev = getIPP(prev.image) || [0, 0, lowerZ];
    const ippNext = getIPP(next.image) || [0, 0, upperZ];
    const mriOrigin = [
      ippPrev[0] * (1 - wPlane) + ippNext[0] * wPlane,
      ippPrev[1] * (1 - wPlane) + ippNext[1] * wPlane,
      ippPrev[2] * (1 - wPlane) + ippNext[2] * wPlane,
    ];
    let mriIOP = toNumberArrayFlexible((actualSecondaryImage.imageOrientation ?? actualSecondaryImage.imageMetadata?.imageOrientation) as any);
    if ((!mriIOP || mriIOP.length < 6) && secondaryImageCache?.has(actualSecondaryImage.sopInstanceUID)) {
      const meta = secondaryImageCache.get(actualSecondaryImage.sopInstanceUID)?.metadata;
      const v = meta?.imageOrientation;
      if (v) mriIOP = toNumberArrayFlexible(v as any);
    }
    let hasMRIDirs = mriIOP.length >= 6;

    // Fallback: derive MRI row/col from CT row/col using registration rotation if MRI IOP is missing
    let mriRowFromReg: number[] | null = null;
    let mriColFromReg: number[] | null = null;
    if (!hasMRIDirs && hasCTDirs) {
      try {
        const R = [
          [registrationMatrix[0], registrationMatrix[1], registrationMatrix[2]],
          [registrationMatrix[4], registrationMatrix[5], registrationMatrix[6]],
          [registrationMatrix[8], registrationMatrix[9], registrationMatrix[10]],
        ];
        // Inverse of a proper rotation is its transpose
        const Rt = [
          [R[0][0], R[1][0], R[2][0]],
          [R[0][1], R[1][1], R[2][1]],
          [R[0][2], R[1][2], R[2][2]],
        ];
        const ctRowDir = [ctIOP[0], ctIOP[1], ctIOP[2]];
        const ctColDir = [ctIOP[3], ctIOP[4], ctIOP[5]];
        const mul = (A: number[][], v: number[]) => [
          A[0][0]*v[0] + A[0][1]*v[1] + A[0][2]*v[2],
          A[1][0]*v[0] + A[1][1]*v[1] + A[1][2]*v[2],
          A[2][0]*v[0] + A[2][1]*v[1] + A[2][2]*v[2],
        ];
        const norm = (v: number[]) => {
          const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0]/l, v[1]/l, v[2]/l];
        };
        mriRowFromReg = norm(mul(Rt, ctRowDir));
        mriColFromReg = norm(mul(Rt, ctColDir));
      } catch {}
    }

    if (hasCTDirs && (hasMRIDirs || (mriRowFromReg && mriColFromReg))) {
      // Ensure CT origin exists for projection math
      if (!ctOrigin || ctOrigin.length < 3) {
        // As a last resort, fall back to [0,0,0] to avoid NaNs; placement may be off but deterministic
        ctOrigin = [0, 0, 0];
      }
      // Direction cosines
      const ctRow = [ctIOP[0], ctIOP[1], ctIOP[2]];
      const ctCol = [ctIOP[3], ctIOP[4], ctIOP[5]];
      const [ctRowSp, ctColSp] = ctSpacingArr; // [row spacing, col spacing]
      const mriRow = hasMRIDirs ? [mriIOP[0], mriIOP[1], mriIOP[2]] : (mriRowFromReg as number[]);
      const mriCol = hasMRIDirs ? [mriIOP[3], mriIOP[4], mriIOP[5]] : (mriColFromReg as number[]);
      const [mriRowSp, mriColSp] = mriSpacingArr; // [row spacing, col spacing]

      const dot = (a: number[], b: number[]) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];

      // Map MRI pixel (u,v) to CT canvas using full chain
      const swapRC = !!(window as any).__FUSION_SWAP_RC__;
      const mapPoint = (u: number, v: number): [number, number] => {
        // DICOM mapping: P(i=row=v, j=col=u) = IPP + j*ColDir*ColSpacing + i*RowDir*RowSpacing
        const j = u, i = v;
        const col = swapRC ? mriRow : mriCol;
        const row = swapRC ? mriCol : mriRow;
        const colSp = swapRC ? mriRowSp : mriColSp;
        const rowSp = swapRC ? mriColSp : mriRowSp;
        const Xw = mriOrigin[0] + j * col[0] * colSp + i * row[0] * rowSp;
        const Yw = mriOrigin[1] + j * col[1] * colSp + i * row[1] * rowSp;
        const Zw = mriOrigin[2] + j * col[2] * colSp + i * row[2] * rowSp;
        const [cx, cy, cz] = multiplyMatrixVector(registrationMatrix, [Xw, Yw, Zw, 1]).slice(0, 3);
        const worldOffset = [cx - ctOrigin[0], cy - ctOrigin[1], cz - ctOrigin[2]];
        // Pixel X along CT column dir; Pixel Y along CT row dir (optionally swapped)
        const Xdir = swapRC ? ctRow : ctCol;
        const Ydir = swapRC ? ctCol : ctRow;
        const Xsp = swapRC ? ctRowSp : ctColSp;
        const Ysp = swapRC ? ctColSp : ctRowSp;
        const px = dot(worldOffset, Xdir) / (Xsp || 1);
        const py = dot(worldOffset, Ydir) / (Ysp || 1);
        return [ctTransform.offsetX + px * ctTransform.scale, ctTransform.offsetY + py * ctTransform.scale];
      };

      // Map pixel center (0,0); anchor needs top-left corner → subtract half-step along each basis
      const [x0c, y0c] = mapPoint(0, 0);
      const [xU, yU] = mapPoint(1, 0); // +1 col pixel
      const [xV, yV] = mapPoint(0, 1); // +1 row pixel
      const Ux = xU - x0c, Uy = yU - y0c; // column basis in canvas
      const Vx = xV - x0c, Vy = yV - y0c; // row basis in canvas
      const halfPixel = !!(window as any).__FUSION_HALF_PIXEL__;
      const x0 = halfPixel ? (x0c - 0.5 * Ux - 0.5 * Vx) : x0c;
      const y0 = halfPixel ? (y0c - 0.5 * Uy - 0.5 * Vy) : y0c;

      // Draw with affine transform
      ctx.save();
      ctx.globalAlpha = fusionOpacity;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.setTransform(Ux, Uy, Vx, Vy, x0, y0);
      ctx.drawImage(temp, 0, 0);
      ctx.restore();

      // Optional axis overlay when debugging
      try {
        if ((window as any).__FUSION_DEBUG__ || (window as any).FUSION_DEBUG) {
          const len = 50; // pixels in secondary image space
          const ux = Ux * len, uy = Uy * len;
          const vx = Vx * len, vy = Vy * len;
          ctx.save();
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.globalAlpha = 0.9;
          ctx.lineWidth = 2;
          // U axis (columns) - red
          ctx.strokeStyle = '#ff5555';
          ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + ux, y0 + uy); ctx.stroke();
          // V axis (rows) - lime
          ctx.strokeStyle = '#55ff55';
          ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + vx, y0 + vy); ctx.stroke();
          ctx.restore();
        }
      } catch {}

      try { if ((window as any).__FUSION_DEBUG__ || (window as any).FUSION_DEBUG) {
        console.log(`✅ AFFINE REGISTRATION:`);
        console.log(`  Canvas basis U=(${Ux.toFixed(3)}, ${Uy.toFixed(3)}), V=(${Vx.toFixed(3)}, ${Vy.toFixed(3)}) at (${x0.toFixed(1)}, ${y0.toFixed(1)})`);
      }} catch {}
      return; // Avoid double-draw; we've rendered using affine mapping
    }
  }

  // SIMPLIFIED: Apply registration matrix directly
  if (registrationMatrix && registrationMatrix.length === 16 && actualSecondaryImage && ctTransform) {
    
    // Get CT and MRI origins in world coordinates
    const ctOrigin = toNumberArray((primaryImage as any).imagePosition || (primaryImage as any).imageMetadata?.imagePosition);  // [X0, Y0, Z0]
    // Try to get MRI origin from secondary image metadata or cache
    let mriOriginArr: number[] = toNumberArrayFlexible((actualSecondaryImage as any).imagePosition);
    if ((!mriOriginArr || mriOriginArr.length < 3) && secondaryImageCache?.has(actualSecondaryImage.sopInstanceUID)) {
      const meta = secondaryImageCache.get(actualSecondaryImage.sopInstanceUID)?.metadata;
      const v = meta?.imagePosition;
      if (v) mriOriginArr = toNumberArrayFlexible(v);
    }
    const mriOrigin = (mriOriginArr && mriOriginArr.length >= 3) ? mriOriginArr : [0,0,ctSliceZ];
    const [rowSpacing, colSpacing] = ctSpacingArr; // CT pixel spacing [row, col]

    // Transform MRI origin to CT space using registration matrix
    const [mriCT_x, mriCT_y, mriCT_z] = multiplyMatrixVector(registrationMatrix, [...mriOrigin, 1]);
    
    // Calculate world-space offset vector between transformed MRI origin and CURRENT CT slice origin
    const worldOffset = [
      mriCT_x - ctOrigin[0],
      mriCT_y - ctOrigin[1],
      mriCT_z - ctOrigin[2]
    ];

    // Parse CT image orientation to get row/column direction cosines
    const iop = toNumberArrayFlexible(
      (primaryImage.imageOrientation ?? primaryImage.imageMetadata?.imageOrientation) as any
    );
    let pixelOffsetX = 0;
    let pixelOffsetY = 0;
    if (iop.length >= 6) {
      const r = [iop[0], iop[1], iop[2]]; // row direction
      const c = [iop[3], iop[4], iop[5]]; // column direction
      // Project world offset onto CT column/row axes and convert to pixels
      const dot = (a: number[], b: number[]) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
      // Pixel X (columns) varies along CT column direction; Pixel Y (rows) varies along CT row direction
      const offsetAlongColMM = dot(worldOffset, c);
      const offsetAlongRowMM = dot(worldOffset, r);
      pixelOffsetX = offsetAlongColMM / (colSpacing || 1);
      pixelOffsetY = offsetAlongRowMM / (rowSpacing || 1);
    } else {
      // Fallback: assume axes aligned with patient X/Y (less accurate)
      pixelOffsetX = worldOffset[0] / (colSpacing || 1);
      pixelOffsetY = worldOffset[1] / (rowSpacing || 1);
    }
    
    // Apply CT's canvas transform to the MRI position
    drawX = ctTransform.offsetX + (pixelOffsetX * ctTransform.scale);
    drawY = ctTransform.offsetY + (pixelOffsetY * ctTransform.scale);
    
    try { if ((window as any).__FUSION_DEBUG__ || (window as any).FUSION_DEBUG) {
      console.log(`✅ SIMPLIFIED REGISTRATION:`);
      console.log(`  CT origin (slice): [${ctOrigin[0].toFixed(1)}, ${ctOrigin[1].toFixed(1)}, ${ctOrigin[2].toFixed(1)}]`);
      console.log(`  MRI origin: [${mriOrigin[0].toFixed(1)}, ${mriOrigin[1].toFixed(1)}, ${mriOrigin[2].toFixed(1)}]`);
      console.log(`  MRI→CT origin: [${mriCT_x.toFixed(1)}, ${mriCT_y.toFixed(1)}, ${mriCT_z.toFixed(1)}]`);
      console.log(`  World offset (mm): [${worldOffset[0].toFixed(1)}, ${worldOffset[1].toFixed(1)}, ${worldOffset[2].toFixed(1)}]`);
      console.log(`  Pixel offset (proj): [${pixelOffsetX.toFixed(1)}, ${pixelOffsetY.toFixed(1)}]px`);
      console.log(`  Canvas position: [${drawX.toFixed(1)}, ${drawY.toFixed(1)}]`);
      console.log(`  MRI size: [${drawW.toFixed(1)}, ${drawH.toFixed(1)}]`);
    }} catch {}
  } else if (!ctTransform) {
    console.warn('⚠️ No CT transform available for fusion alignment');
    // Fallback: center the MRI
    drawX = (canvasWidth - drawW) / 2;
    drawY = (canvasHeight - drawH) / 2;
  }

  // Standard draw without rotation - using proper physical scaling
  ctx.save();
  ctx.globalAlpha = fusionOpacity;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  
  // Draw the MRI using the already calculated position and size
  if (drawX !== undefined && drawY !== undefined && drawW !== undefined && drawH !== undefined) {
    ctx.drawImage(temp, drawX, drawY, drawW, drawH);
    try { if ((window as any).__FUSION_DEBUG__ || (window as any).FUSION_DEBUG) console.log(`✓ MRI overlay drawn: size=${drawW.toFixed(1)}x${drawH.toFixed(1)}, pos=(${drawX.toFixed(1)},${drawY.toFixed(1)}), opacity=${fusionOpacity}`); } catch {}
  } else {
    // Fallback to centered positioning if calculations failed
    const centerX = (canvasWidth - w) / 2;
    const centerY = (canvasHeight - h) / 2;
    ctx.drawImage(temp, centerX, centerY, w, h);
    try { if ((window as any).__FUSION_DEBUG__ || (window as any).FUSION_DEBUG) console.log(`✓ MRI overlay drawn (fallback): centered at (${centerX.toFixed(1)},${centerY.toFixed(1)})`); } catch {}
  }
  
  try { if ((window as any).__FUSION_DEBUG__ || (window as any).FUSION_DEBUG) console.log(`✓ Fusion complete: opacity=${fusionOpacity}, scale=${scaleX.toFixed(3)}x${scaleY.toFixed(3)}`); } catch {}
  // NO RESTORE - caller manages the transform state

  // Optional on-canvas debug overlay when window.__FUSION_DEBUG__ is truthy
  try {
    if ((window as any).__FUSION_DEBUG__ || (window as any).FUSION_DEBUG) {
      const fontSize = Math.max(10, Math.round(12 * (ctTransform?.scale || 1)));
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.setTransform(1, 0, 0, 1, 0, 0); // screen space for text
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(8, 8, 420, 84);
      ctx.fillStyle = '#0ff';
      ctx.font = `${fontSize}px monospace`;
      const zVals = transformedMRI.map(t => t.zInCT);
      const minZ = Math.min(...zVals);
      const maxZ = Math.max(...zVals);
      const mode = (function(){
        // crude detection by last logs: if draw via setTransform happened, basis vectors non-zero
        // we can't read them here easily; infer by registration presence and CT dirs
        return (registrationMatrix && registrationMatrix.length === 16 && (Array.isArray(ctSeriesIOP) || (primaryImage as any).imageOrientation)) ? 'AFFINE' : 'SIMPLE';
      })();
      const flags = `${(window as any).__FUSION_SWAP_RC__ ? 'SwapRC ' : ''}${(window as any).__FUSION_HALF_PIXEL__ ? 'HalfPx ' : ''}`.trim();
      ctx.fillText(`Fusion Z: CT=${ctSliceZ.toFixed(2)}${clamped ? ' (clamped)' : ''} | Secondary=[${minZ.toFixed(1)}, ${maxZ.toFixed(1)}]`, 14, 28);
      ctx.fillText(`Size=${drawW?.toFixed(0)}x${drawH?.toFixed(0)}  Opacity=${Math.round(fusionOpacity*100)}%  Mode=${mode}${flags? '  '+flags : ''}`, 14, 28+fontSize+2);
      ctx.fillText(`CT sp=[${ctSpacingArr.map(v=>v.toFixed(3)).join(', ')}]  Sec sp=[${mriSpacingArr?.map(v=>v.toFixed(3)).join(', ')}]`, 14, 28+2*(fontSize+2));
      ctx.restore();
    }
  } catch { /* noop */ }
}
