/**
 * Blob Operations Library
 * 
 * Functions for grouping, analyzing, and manipulating contour blobs in 3D space
 */

import { doPolygonsIntersectSimple } from './simple-polygon-operations';
import { SLICE_TOL_MM } from './dicom-spatial-helpers';

export interface BlobContour {
  slicePosition: number;
  points: number[];
  numberOfPoints: number;
}

export interface Blob {
  id: number;
  volumeCc: number;
  contours: BlobContour[];
}

export interface BlobMetrics {
  volumeCc: number;
  sliceRange: [number, number];
  boundingBox: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    minZ: number;
    maxZ: number;
  };
}

/**
 * Group structure contours into connected 3D blobs
 * 
 * Algorithm:
 * 1. Group contours by slice position
 * 2. Within each slice, group intersecting contours
 * 3. Connect groups across adjacent slices using bounding box overlap
 * 
 * @param structure - RT structure with contours
 * @param tolMm - Slice tolerance in millimeters
 * @returns Array of 3D blobs, each containing connected contours
 */
export function groupStructureBlobs(
  structure: any,
  tolMm: number = SLICE_TOL_MM
): BlobContour[][] {
  const contours = Array.isArray(structure?.contours) ? structure.contours : [];
  
  if (contours.length === 0) {
    return [];
  }
  
  // Step 1: Group contours by slice
  const bySlice = new Map<number, BlobContour[]>();
  for (const c of contours) {
    const key = findExistingKeyWithinTolerance(bySlice, c.slicePosition, tolMm);
    const list = bySlice.get(key) || [];
    list.push(c);
    bySlice.set(key, list);
  }
  
  // Step 2: Group contours within each slice by intersection
  const sliceGroups = new Map<number, BlobContour[][]>();
  for (const [slicePos, sliceContours] of bySlice) {
    const groups: BlobContour[][] = [];
    for (const c of sliceContours) {
      let placed = false;
      for (const g of groups) {
        if (g.some((x) => doPolygonsIntersectSimple(x.points, c.points))) {
          g.push(c);
          placed = true;
          break;
        }
      }
      if (!placed) groups.push([c]);
    }
    sliceGroups.set(slicePos, groups);
  }
  
  // Step 3: Connect slice groups across adjacent slices to form 3D blobs
  const blobs3D: BlobContour[][] = [];
  const sortedSlices = Array.from(sliceGroups.keys()).sort((a, b) => a - b);

  // Estimate typical slice spacing so we can detect large gaps introduced by deletions
  const spacingSamples: number[] = [];
  for (let i = 1; i < sortedSlices.length; i++) {
    const gap = Math.abs(sortedSlices[i] - sortedSlices[i - 1]);
    if (Number.isFinite(gap) && gap > 0) {
      spacingSamples.push(gap);
    }
  }
  let typicalSpacing = spacingSamples.length
    ? spacingSamples
        .slice()
        .sort((a, b) => a - b)[Math.floor(spacingSamples.length / 2)]
    : tolMm || 1;
  if (!Number.isFinite(typicalSpacing) || typicalSpacing <= 0) {
    typicalSpacing = Math.max(tolMm, 0.5);
  }
  const maxConnectGap = Math.max(tolMm * 1.5, typicalSpacing * 1.4);
  const processedGroups = new Set<string>();
  
  for (let i = 0; i < sortedSlices.length; i++) {
    const currentSlice = sortedSlices[i];
    const currentGroups = sliceGroups.get(currentSlice) || [];
    
    for (let groupIdx = 0; groupIdx < currentGroups.length; groupIdx++) {
      const groupKey = `${currentSlice}:${groupIdx}`;
      if (processedGroups.has(groupKey)) continue;
      
      // Start a new 3D blob with this group
      const blob: BlobContour[] = [...currentGroups[groupIdx]];
      processedGroups.add(groupKey);
      
      // Recursively find connected groups on adjacent slices
      const findConnected = (sliceIdx: number, prevContours: BlobContour[], prevSlice: number) => {
        // Check next slice
        if (sliceIdx + 1 < sortedSlices.length) {
          const nextSlice = sortedSlices[sliceIdx + 1];

          // Treat large gaps as disconnected blobs (e.g., deleted slices)
          const sliceGap = Math.abs(nextSlice - prevSlice);
          if (sliceGap > maxConnectGap) {
            return;
          }

          const nextGroups = sliceGroups.get(nextSlice) || [];
          
          for (let nextGroupIdx = 0; nextGroupIdx < nextGroups.length; nextGroupIdx++) {
            const nextGroupKey = `${nextSlice}:${nextGroupIdx}`;
            if (processedGroups.has(nextGroupKey)) continue;
            
            const nextGroup = nextGroups[nextGroupIdx];
            
            // Check if any contour in nextGroup overlaps with any contour in prevContours
            const overlaps = prevContours.some(prevC => 
              nextGroup.some(nextC => contoursBoundingBoxOverlap(prevC.points, nextC.points))
            );
            
            if (overlaps) {
              blob.push(...nextGroup);
              processedGroups.add(nextGroupKey);
              findConnected(sliceIdx + 1, nextGroup, nextSlice);
            }
          }
        }
      };
      
      findConnected(i, currentGroups[groupIdx], currentSlice);
      
      if (blob.length > 0) {
        blobs3D.push(blob);
      }
    }
  }
  
  return blobs3D;
}

/**
 * Check if two contours' bounding boxes overlap in 2D space
 */
function contoursBoundingBoxOverlap(points1: number[], points2: number[]): boolean {
  let min1X = Infinity, min1Y = Infinity, max1X = -Infinity, max1Y = -Infinity;
  let min2X = Infinity, min2Y = Infinity, max2X = -Infinity, max2Y = -Infinity;
  
  for (let i = 0; i < points1.length; i += 3) {
    min1X = Math.min(min1X, points1[i]);
    max1X = Math.max(max1X, points1[i]);
    min1Y = Math.min(min1Y, points1[i + 1]);
    max1Y = Math.max(max1Y, points1[i + 1]);
  }
  
  for (let i = 0; i < points2.length; i += 3) {
    min2X = Math.min(min2X, points2[i]);
    max2X = Math.max(max2X, points2[i]);
    min2Y = Math.min(min2Y, points2[i + 1]);
    max2Y = Math.max(max2Y, points2[i + 1]);
  }
  
  return !(max1X < min2X || max2X < min1X || max1Y < min2Y || max2Y < min1Y);
}

/**
 * Find existing key within tolerance
 */
function findExistingKeyWithinTolerance(
  map: Map<number, any>,
  value: number,
  tol: number
): number {
  for (const k of map.keys()) {
    if (Math.abs(k - value) <= tol) return k;
  }
  return value;
}

/**
 * Compute blob volume in cubic centimeters
 * 
 * @param blobContours - Array of contours belonging to the blob
 * @param metadata - Image metadata with pixel spacing and slice thickness
 * @returns Volume in cc
 */
export function computeBlobVolumeCc(
  blobContours: BlobContour[],
  metadata: any
): number {
  if (!blobContours?.length) return 0;
  
  const px = parseFloat(metadata?.pixelSpacing?.split?.("\\")[0]) || metadata?.pixelSpacing?.[0] || 1;
  const py = parseFloat(metadata?.pixelSpacing?.split?.("\\")[1]) || metadata?.pixelSpacing?.[1] || px || 1;
  const dz = parseFloat(metadata?.sliceThickness) || parseFloat(metadata?.spacingBetweenSlices) || 1;
  
  // Polygon area in mm^2 from world points (assumed mm)
  const areaOf = (pts: number[]) => {
    let area = 0;
    for (let i = 0; i < pts.length; i += 3) {
      const j = (i + 3) % pts.length;
      area += pts[i] * pts[j + 1] - pts[j] * pts[i + 1];
    }
    return Math.abs(area / 2);
  };
  
  // Integrate per-slice area * dz
  const slices = new Map<number, number>();
  for (const c of blobContours) {
    slices.set(c.slicePosition, (slices.get(c.slicePosition) || 0) + areaOf(c.points));
  }
  
  let volumeMm3 = 0;
  for (const [, areaMm2] of slices) {
    volumeMm3 += areaMm2 * dz;
  }
  
  return volumeMm3 / 1000; // Convert to cc
}

/**
 * Calculate blob metrics including volume, slice range, and bounding box
 */
export function calculateBlobMetrics(
  blobContours: BlobContour[],
  metadata: any
): BlobMetrics {
  const volumeCc = computeBlobVolumeCc(blobContours, metadata);
  
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  
  blobContours.forEach(c => {
    minZ = Math.min(minZ, c.slicePosition);
    maxZ = Math.max(maxZ, c.slicePosition);
    
    for (let i = 0; i < c.points.length; i += 3) {
      minX = Math.min(minX, c.points[i]);
      maxX = Math.max(maxX, c.points[i]);
      minY = Math.min(minY, c.points[i + 1]);
      maxY = Math.max(maxY, c.points[i + 1]);
    }
  });
  
  return {
    volumeCc,
    sliceRange: [minZ, maxZ],
    boundingBox: { minX, maxX, minY, maxY, minZ, maxZ }
  };
}

/**
 * Create a unique key for a contour (for comparison/tracking)
 */
export function createContourKey(contour: BlobContour): string {
  return `${contour.slicePosition}|${contour.points.length}|${contour.points[0]}|${contour.points[1]}`;
}

/**
 * Check if two contours match based on their unique keys
 */
export function contoursMatch(c1: BlobContour, c2: BlobContour): boolean {
  return createContourKey(c1) === createContourKey(c2);
}

/**
 * Quick check: does a structure have multiple disconnected blobs?
 * Returns the number of blobs detected
 * MUST use same tolerance as blob dialog for consistency
 */
export function countStructureBlobs(structure: any, tolMm: number = SLICE_TOL_MM): number {
  if (!structure?.contours || !Array.isArray(structure.contours) || structure.contours.length === 0) {
    return 0;
  }
  
  const blobs = groupStructureBlobs(structure, tolMm);
  return blobs.length;
}
