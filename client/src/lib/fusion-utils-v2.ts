/**
 * Modality-agnostic fusion utilities with geometrically correct calculations
 * Treats planning CT as primary/target stack and supports PET→CT, diagnostic CT→planning CT, MR→CT
 */

import { 
  Vec3, 
  Mat4x4,
  dot, 
  cross, 
  sub,
  parseNums,
  apply4x4,
  getImageGeometry,
  hasValidSpatialMetadata,
  ImageGeometry,
  invertRigid4x4
} from './dicom-geometry-utils';

export interface SecondaryImage {
  sopInstanceUID: string;
  imagePosition: string | number[];
  imageOrientation: string | number[];
  pixelSpacing: string | number[];
  rows?: number;
  columns?: number;
  [key: string]: any;
}

export interface TransformedSecondary {
  dCT: number; // Distance along CT normal (mm), relative to primary origin
  originCT: Vec3; // Secondary slice origin mapped into CT patient space
  image: SecondaryImage;
}

export interface PrimaryGeometry {
  origin: Vec3;
  rowDir: Vec3;
  colDir: Vec3;
  rowSpacing: number;
  colSpacing: number;
  normal: Vec3;
}

/**
 * Build primary (planning CT) geometry from one CT slice header
 */
export function buildPrimaryGeometry(primaryImage: any): PrimaryGeometry | null {
  const ip = parseNums(primaryImage.imagePosition, 3);
  const io = parseNums(primaryImage.imageOrientation, 6);
  const sp = parseNums(primaryImage.pixelSpacing, 2);
  
  if (!ip || !io || !sp) {
    console.warn('Missing spatial metadata in primary image, using defaults:', {
      hasPosition: !!ip,
      hasOrientation: !!io,
      hasSpacing: !!sp
    });
    
    // Use default axial geometry when metadata is missing
    return {
      origin: ip || [0, 0, 0],
      rowDir: io ? io.slice(0, 3) as Vec3 : [1, 0, 0],
      colDir: io ? io.slice(3, 6) as Vec3 : [0, 1, 0],
      rowSpacing: sp ? sp[0] : 1,
      colSpacing: sp ? sp[1] : 1,
      normal: io ? cross(io.slice(0, 3) as Vec3, io.slice(3, 6) as Vec3) : [0, 0, 1]
    };
  }

  const rowDir = io.slice(0, 3) as Vec3;
  const colDir = io.slice(3, 6) as Vec3;
  const normal = cross(rowDir, colDir);
  const rowSpacing = sp[0];
  const colSpacing = sp[1];

  return { 
    origin: ip as Vec3, 
    rowDir, 
    colDir, 
    rowSpacing, 
    colSpacing, 
    normal 
  };
}

/**
 * Compute secondary slice ordering for fusion: distance along CT normal
 * Expects registration M to map secondary patient coords → CT patient coords (^CT M_secondary)
 * If you only have ^secondary M_CT and it's rigid, pass invertRegistration=true
 */
export function computeTransformedSecondaryPositions(
  secondaryImages: SecondaryImage[],
  registrationMatrix: Mat4x4 | null | undefined,
  primaryGeom: PrimaryGeometry | null,
  invertRegistration = false
): TransformedSecondary[] {
  if (!secondaryImages?.length || !primaryGeom) {
    console.warn('Cannot compute transformed secondary positions:', {
      hasSecondary: !!secondaryImages?.length,
      hasGeometry: !!primaryGeom
    });
    return [];
  }

  let M = registrationMatrix && registrationMatrix.length === 16 
    ? registrationMatrix.slice(0, 16) 
    : [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
    
  if (invertRegistration) {
    M = invertRigid4x4(M);
  }

  const out: TransformedSecondary[] = [];
  
  for (const img of secondaryImages) {
    const pos = parseNums(img.imagePosition, 3);
    if (!pos) {
      console.warn('Skipping secondary slice: missing ImagePosition');
      continue;
    }
    
    const originCT = apply4x4(M, pos as Vec3);
    const v = sub(originCT, primaryGeom.origin);
    const dCT = dot(v, primaryGeom.normal); // Signed distance along CT normal
    
    out.push({ dCT, originCT, image: img });
  }
  
  out.sort((a, b) => a.dCT - b.dCT);
  
  // Debug output
  if (out.length > 0) {
    const first = out[0];
    const middle = out[Math.floor(out.length / 2)];
    const last = out[out.length - 1];
    console.log(`🔍 Sample Secondary→CT transformations (along CT normal):`);
    console.log(`  First: dCT=${first.dCT.toFixed(1)}mm`);
    console.log(`  Middle: dCT=${middle.dCT.toFixed(1)}mm`);
    console.log(`  Last: dCT=${last.dCT.toFixed(1)}mm`);
  }
  
  return out;
}

/**
 * Find bracketing indices [i0, i1] such that d[i0] <= ctPlaneD <= d[i1]
 * Clamped at ends
 */
export function bracketByD(
  ctPlaneD: number, 
  arr: TransformedSecondary[]
): [number, number] | null {
  if (!arr.length) return null;
  
  let lo = 0, hi = arr.length - 1;
  
  if (ctPlaneD <= arr[0].dCT) return [0, 0];
  if (ctPlaneD >= arr[hi].dCT) return [hi, hi];
  
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid].dCT <= ctPlaneD) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  
  return [lo, hi];
}

/**
 * Find the nearest secondary slice for a given CT plane position
 */
export function findNearestSecondaryIndex(
  ctPlaneD: number,
  transformed: TransformedSecondary[],
  tolerance: number = 0.5
): number | null {
  if (!transformed.length) return null;

  const pair = bracketByD(ctPlaneD, transformed);
  if (!pair) return null;

  const [i0, i1] = pair;
  
  if (i0 === i1) {
    const dist = Math.abs(transformed[i0].dCT - ctPlaneD);
    return dist <= tolerance ? i0 : null;
  }

  // Find closer of the two
  const dist0 = Math.abs(transformed[i0].dCT - ctPlaneD);
  const dist1 = Math.abs(transformed[i1].dCT - ctPlaneD);
  
  if (dist0 <= dist1 && dist0 <= tolerance) return i0;
  if (dist1 <= tolerance) return i1;
  
  return null;
}

/**
 * Interpolate between two secondary slices based on CT plane position
 */
export function interpolateSecondary(
  ctPlaneD: number,
  transformed: TransformedSecondary[],
  cache: Map<string, { data: Float32Array; width: number; height: number }>,
  maxGapMM: number = 15
): { data: Float32Array; width: number; height: number } | null {
  const pair = bracketByD(ctPlaneD, transformed);
  if (!pair) return null;

  const [i0, i1] = pair;
  const A = transformed[i0];
  const B = transformed[i1];

  // Single slice case
  if (i0 === i1) {
    return cache.get(A.image.sopInstanceUID) ?? null;
  }

  // Check gap
  const gap = B.dCT - A.dCT;
  if (gap > maxGapMM) {
    console.warn(`Gap ${gap.toFixed(1)}mm exceeds max ${maxGapMM}mm`);
    return null;
  }

  // Get cached pixel data
  const frameA = cache.get(A.image.sopInstanceUID);
  const frameB = cache.get(B.image.sopInstanceUID);
  
  if (!frameA || !frameB) return null;
  if (frameA.width !== frameB.width || frameA.height !== frameB.height) {
    console.warn('Frame dimensions mismatch');
    return frameA; // Fallback to nearest
  }

  // Compute blend weight
  const t = gap > 0 ? (ctPlaneD - A.dCT) / gap : 0;
  const w = Math.min(1, Math.max(0, t));

  // Blend pixel data
  const blended = new Float32Array(frameA.data.length);
  for (let i = 0; i < blended.length; i++) {
    blended[i] = frameA.data[i] * (1 - w) + frameB.data[i] * w;
  }

  return {
    data: blended,
    width: frameA.width,
    height: frameA.height
  };
}

/**
 * Map a secondary slice pixel (u, v) to CT pixel coordinates
 */
export function secPixelToCtPixel(
  u: number, 
  v: number,
  secOrigin: Vec3, 
  secRowDir: Vec3, 
  secColDir: Vec3, 
  secRowSp: number, 
  secColSp: number,
  M_ct_from_sec: Mat4x4,
  ctOrigin: Vec3, 
  ctRowDir: Vec3, 
  ctColDir: Vec3, 
  ctRowSp: number, 
  ctColSp: number
): [number, number] {
  // Secondary pixel → secondary patient
  const Ps: Vec3 = [
    secOrigin[0] + secColDir[0] * secColSp * u + secRowDir[0] * secRowSp * v,
    secOrigin[1] + secColDir[1] * secColSp * u + secRowDir[1] * secRowSp * v,
    secOrigin[2] + secColDir[2] * secColSp * u + secRowDir[2] * secRowSp * v
  ];
  
  // → CT patient
  const Pc = apply4x4(M_ct_from_sec, Ps);
  
  // → CT pixel indices
  const vc = sub(Pc, ctOrigin);
  const u_ct = dot(vc, ctColDir) / ctColSp; // x/column
  const v_ct = dot(vc, ctRowDir) / ctRowSp; // y/row
  
  return [u_ct, v_ct];
}

/**
 * Build 2D affine for canvas rendering
 * Maps secondary image pixels → CT pixel coords
 */
export interface Affine2D {
  a: number; b: number; c: number; 
  d: number; e: number; f: number;
}

export function buildSliceAffine2D(
  secImage: SecondaryImage,
  M_ct_from_sec: Mat4x4,
  primaryGeom: PrimaryGeometry,
  secPixelWidth: number,
  secPixelHeight: number
): Affine2D | null {
  const sIOP = parseNums(secImage.imageOrientation, 6);
  const sIP = parseNums(secImage.imagePosition, 3);
  const sSP = parseNums(secImage.pixelSpacing, 2);
  
  if (!sIOP || !sIP || !sSP) return null;

  const sRowDir = sIOP.slice(0, 3) as Vec3;
  const sColDir = sIOP.slice(3, 6) as Vec3;
  const sRowSp = sSP[0], sColSp = sSP[1];

  // Reference points in secondary pixels (top-left, top-right, bottom-left)
  const [u0, v0] = secPixelToCtPixel(
    0, 0, sIP as Vec3, sRowDir, sColDir, sRowSp, sColSp,
    M_ct_from_sec,
    primaryGeom.origin, primaryGeom.rowDir, primaryGeom.colDir, 
    primaryGeom.rowSpacing, primaryGeom.colSpacing
  );
  
  const [u1, v1] = secPixelToCtPixel(
    secPixelWidth, 0, sIP as Vec3, sRowDir, sColDir, sRowSp, sColSp,
    M_ct_from_sec,
    primaryGeom.origin, primaryGeom.rowDir, primaryGeom.colDir, 
    primaryGeom.rowSpacing, primaryGeom.colSpacing
  );
  
  const [u2, v2] = secPixelToCtPixel(
    0, secPixelHeight, sIP as Vec3, sRowDir, sColDir, sRowSp, sColSp,
    M_ct_from_sec,
    primaryGeom.origin, primaryGeom.rowDir, primaryGeom.colDir, 
    primaryGeom.rowSpacing, primaryGeom.colSpacing
  );

  const W = secPixelWidth || 1;
  const H = secPixelHeight || 1;
  const a = (u1 - u0) / W;
  const b = (v1 - v0) / W;
  const c = (u2 - u0) / H;
  const d = (v2 - v0) / H;
  const e = u0;
  const f = v0;

  return { a, b, c, d, e, f };
}

/**
 * Convert Float32 frame to ImageData with proper windowing
 */
export function toImageData(
  frame: { data: Float32Array; width: number; height: number },
  opts?: { 
    windowCenter?: number; 
    windowWidth?: number; 
    min?: number; 
    max?: number;
  }
): ImageData {
  const { data, width, height } = frame;
  let lo: number, hi: number;

  if (opts?.windowCenter !== undefined && opts?.windowWidth !== undefined) {
    lo = opts.windowCenter - opts.windowWidth / 2;
    hi = opts.windowCenter + opts.windowWidth / 2;
  } else if (opts?.min !== undefined && opts?.max !== undefined) {
    lo = opts.min;
    hi = opts.max;
  } else {
    // Auto-window
    let min = data[0], max = data[0];
    for (let i = 1; i < data.length; i++) {
      const v = data[i];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    lo = min;
    hi = max;
  }

  const range = Math.max(hi - lo, 1e-6);
  const out = new Uint8ClampedArray(width * height * 4);
  
  for (let i = 0, k = 0; i < data.length; i++, k += 4) {
    const v = Math.max(0, Math.min(1, (data[i] - lo) / range)) * 255;
    const u = v | 0;
    out[k] = u;
    out[k + 1] = u;
    out[k + 2] = u;
    out[k + 3] = u <= 1 ? 0 : 255; // Transparent background near black
  }
  
  return new ImageData(out, width, height);
}