/**
 * DICOM Spatial Helper Utilities
 * Centralizes spatial operations for consistent slice matching and coordinate handling
 */

// Global slice tolerance in mm - used consistently across all slice operations
export const SLICE_TOL_MM = 0.5;

/**
 * Extract Z position from DICOM image metadata with consistent fallback logic
 */
export function getSliceZ(img: any): number {
  // Priority 1: Pre-parsed slice location
  if (img?.parsedSliceLocation != null) return img.parsedSliceLocation;
  
  // Priority 2: Pre-parsed Z position
  if (img?.parsedZPosition != null) return img.parsedZPosition;
  
  // Priority 3: Direct metadata access
  const m = img?.imageMetadata || img;
  
  // Try slice location from metadata
  if (m?.sliceLocation != null) {
    const v = parseFloat(m.sliceLocation);
    if (!Number.isNaN(v)) return v;
  }
  
  // Try image position Z coordinate
  const pos = typeof m?.imagePosition === 'string' 
    ? m.imagePosition?.split('\\') 
    : m?.imagePosition;
    
  if (Array.isArray(pos) && pos.length >= 3) {
    const z = parseFloat(pos[2]);
    if (!Number.isNaN(z)) return z;
  }
  
  // Return NaN to indicate no valid Z found - handle explicitly in calling code
  return NaN;
}

/**
 * Check if two Z positions represent the same slice within tolerance
 */
export function sameSlice(aZ: number, bZ: number, tol = SLICE_TOL_MM): boolean {
  return Number.isFinite(aZ) && Number.isFinite(bZ) && Math.abs(aZ - bZ) <= tol;
}

/**
 * Extract proper spacing values from DICOM metadata
 */
export function getSpacing(imgMeta: any): { row: number; col: number; z: number } {
  // Parse pixel spacing (row, column)
  const ps = typeof imgMeta?.pixelSpacing === 'string'
    ? imgMeta.pixelSpacing.split('\\').map(Number)
    : imgMeta?.pixelSpacing;
    
  const row = ps?.[0] || 1; // Row spacing (Δy)
  const col = ps?.[1] || 1; // Column spacing (Δx)
  
  // Prefer SpacingBetweenSlices over SliceThickness for Z spacing
  const z = parseFloat(
    imgMeta?.spacingBetweenSlices ?? 
    imgMeta?.sliceThickness ?? 
    '3'
  );
  
  return { row, col, z };
}

/**
 * Get rescale parameters for proper HU conversion
 */
export function getRescaleParams(metadata: any): { slope: number; intercept: number } {
  const slope = metadata?.rescaleSlope ? parseFloat(metadata.rescaleSlope) : 1;
  const intercept = metadata?.rescaleIntercept ? parseFloat(metadata.rescaleIntercept) : 0;
  return { slope, intercept };
}

/**
 * Convert flat contour array to 2D polygon format
 * Ensures polygon is closed (first point equals last)
 */
export function flatTo2D(polyFlat: number[]): [number, number][] {
  const out: [number, number][] = [];
  
  for (let i = 0; i < polyFlat.length; i += 3) {
    out.push([polyFlat[i], polyFlat[i + 1]]);
  }
  
  // Ensure closed polygon
  if (out.length > 0) {
    const first = out[0];
    const last = out[out.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      out.push([first[0], first[1]]);
    }
  }
  
  return out;
}

/**
 * Convert 2D polygon back to flat array format with Z coordinate
 */
export function twoDToFlat(poly2D: [number, number][], z: number): number[] {
  const res: number[] = [];
  
  for (const [x, y] of poly2D) {
    res.push(x, y, z);
  }
  
  return res;
}

/**
 * Create a sorted Z array from images and compute bounds
 */
export function computeZBounds(images: any[]): {
  zArray: number[];
  zMin: number;
  zMax: number;
  validCount: number;
} {
  const zArray = images.map(getSliceZ);
  const finiteZ = zArray.filter(Number.isFinite);
  
  if (finiteZ.length === 0) {
    return {
      zArray,
      zMin: 0,
      zMax: 0,
      validCount: 0
    };
  }
  
  return {
    zArray,
    zMin: Math.min(...finiteZ),
    zMax: Math.max(...finiteZ),
    validCount: finiteZ.length
  };
}

/**
 * Binary search to find closest slice index for a given Z position
 */
export function findClosestSliceIndex(targetZ: number, zArray: number[]): number {
  if (zArray.length === 0) return -1;
  
  let closestIndex = 0;
  let minDiff = Math.abs(targetZ - zArray[0]);
  
  for (let i = 1; i < zArray.length; i++) {
    const diff = Math.abs(targetZ - zArray[i]);
    if (diff < minDiff) {
      minDiff = diff;
      closestIndex = i;
    }
  }
  
  return closestIndex;
}

/**
 * Check if a Z position is within valid bounds
 */
export function isZInBounds(z: number, zMin: number, zMax: number, tolerance = SLICE_TOL_MM): boolean {
  return z >= (zMin - tolerance) && z <= (zMax + tolerance);
}

/**
 * Scale coordinates for integer-based polygon operations (e.g., Clipper)
 */
export const CLIPPER_SCALE = 1000000; // 6 decimal places precision

export function scaleToClipper(value: number): number {
  return Math.round(value * CLIPPER_SCALE);
}

export function scaleFromClipper(value: number): number {
  return value / CLIPPER_SCALE;
}

/**
 * Ensure polygon is properly oriented (counter-clockwise for outer rings)
 */
export function ensurePolygonOrientation(points: [number, number][]): [number, number][] {
  // Calculate signed area
  let area = 0;
  const n = points.length;
  
  for (let i = 0; i < n - 1; i++) {
    area += (points[i + 1][0] - points[i][0]) * (points[i + 1][1] + points[i][1]);
  }
  
  // If clockwise (negative area), reverse
  if (area < 0) {
    return points.slice().reverse();
  }
  
  return points;
}