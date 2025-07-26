/**
 * Comprehensive boolean operations for medical contours using js-angusj-clipper
 * Provides union, subtract, intersection, XOR, and complex operations
 */

import { getClipper, createClipperInstance, createPath, createPaths } from './clipper-adapter';

const SCALE = 10000; // Scale factor for ClipperLib (1e4 is safer than 1e6)
const CLEAN_TOLERANCE = 0.1; // mm tolerance for polygon cleaning
const MIN_AREA = 1e-3; // Minimum area in mm² to keep a polygon

/**
 * Convert 3D contour points to ClipperLib path format
 */
async function contourToClipperPath(points: number[]): Promise<any> {
  const api = await getClipper();
  const path = new api.Path();
  
  for (let i = 0; i < points.length; i += 3) {
    path.push({
      X: Math.round(points[i] * SCALE),
      Y: Math.round(points[i + 1] * SCALE)
    });
  }
  
  return path;
}

/**
 * Convert ClipperLib paths back to contour format
 */
function clipperPathsToContours(paths: any, z: number): number[][] {
  const contours: number[][] = [];
  
  for (let i = 0; i < paths.size(); i++) {
    const path = paths.get(i);
    const contour: number[] = [];
    
    for (let j = 0; j < path.size(); j++) {
      const point = path.get(j);
      contour.push(
        point.X / SCALE,
        point.Y / SCALE,
        z
      );
    }
    
    if (contour.length >= 9) { // At least 3 points
      contours.push(contour);
    }
  }
  
  return contours;
}

/**
 * Union (Combine) - Merges two contours into one, including all area covered by either
 * This is what Eclipse TPS calls "OR" operation
 */
export async function combineContours(contourA: number[], contourB: number[]): Promise<number[][]> {
  if (contourA.length < 9 || contourB.length < 9) {
    console.warn('Contours must have at least 3 points');
    return contourA.length >= 9 ? [contourA] : contourB.length >= 9 ? [contourB] : [];
  }

  const z = contourA[2]; // Assume same Z plane
  const api = await getClipper();
  const clipper = await createClipperInstance();
  const solution = await createPaths();
  
  try {
    // Add both contours
    const pathA = await contourToClipperPath(contourA);
    const pathB = await contourToClipperPath(contourB);
    
    clipper.AddPath(pathA, api.PolyType.ptSubject, true);
    clipper.AddPath(pathB, api.PolyType.ptClip, true);
    
    // Perform union
    clipper.Execute(api.ClipType.ctUnion, solution, 
      api.PolyFillType.pftNonZero, 
      api.PolyFillType.pftNonZero
    );
    
    return clipperPathsToContours(solution, z);
    
  } catch (error) {
    console.error('Union operation failed:', error);
    return [contourA];
  }
}

/**
 * Subtract - Removes area of contourB from contourA
 * This is what Eclipse TPS calls "SUB" operation
 */
export async function subtractContours(contourA: number[], contourB: number[]): Promise<number[][]> {
  if (contourA.length < 9) {
    console.warn('Base contour must have at least 3 points');
    return [];
  }
  
  if (contourB.length < 9) {
    console.warn('Subtract contour must have at least 3 points');
    return [contourA];
  }

  const z = contourA[2];
  const api = await getClipper();
  const clipper = await createClipperInstance();
  const solution = await createPaths();
  
  try {
    const pathA = await contourToClipperPath(contourA);
    const pathB = await contourToClipperPath(contourB);
    
    clipper.AddPath(pathA, api.PolyType.ptSubject, true);
    clipper.AddPath(pathB, api.PolyType.ptClip, true);
    
    // Perform difference
    clipper.Execute(api.ClipType.ctDifference, solution,
      api.PolyFillType.pftNonZero,
      api.PolyFillType.pftNonZero
    );
    
    return clipperPathsToContours(solution, z);
    
  } catch (error) {
    console.error('Subtract operation failed:', error);
    return [contourA];
  }
}

/**
 * Intersection - Returns only the overlapping area of two contours
 * This is what Eclipse TPS calls "AND" operation
 */
export async function intersectContours(contourA: number[], contourB: number[]): Promise<number[][]> {
  if (contourA.length < 9 || contourB.length < 9) {
    console.warn('Contours must have at least 3 points');
    return [];
  }

  const z = contourA[2];
  const api = await getClipper();
  const clipper = await createClipperInstance();
  const solution = await createPaths();
  
  try {
    const pathA = await contourToClipperPath(contourA);
    const pathB = await contourToClipperPath(contourB);
    
    clipper.AddPath(pathA, api.PolyType.ptSubject, true);
    clipper.AddPath(pathB, api.PolyType.ptClip, true);
    
    // Perform intersection
    clipper.Execute(api.ClipType.ctIntersection, solution,
      api.PolyFillType.pftNonZero,
      api.PolyFillType.pftNonZero
    );
    
    return clipperPathsToContours(solution, z);
    
  } catch (error) {
    console.error('Intersection operation failed:', error);
    return [];
  }
}

/**
 * XOR (Exclusive OR) - Returns areas covered by either contour but not both
 * Removes the overlapping region
 */
export async function xorContours(contourA: number[], contourB: number[]): Promise<number[][]> {
  if (contourA.length < 9 || contourB.length < 9) {
    console.warn('Contours must have at least 3 points');
    return contourA.length >= 9 ? [contourA] : [];
  }

  const z = contourA[2];
  const api = await getClipper();
  const clipper = await createClipperInstance();
  const solution = await createPaths();
  
  try {
    const pathA = await contourToClipperPath(contourA);
    const pathB = await contourToClipperPath(contourB);
    
    clipper.AddPath(pathA, api.PolyType.ptSubject, true);
    clipper.AddPath(pathB, api.PolyType.ptClip, true);
    
    // Perform XOR
    clipper.Execute(api.ClipType.ctXor, solution,
      api.PolyFillType.pftNonZero,
      api.PolyFillType.pftNonZero
    );
    
    return clipperPathsToContours(solution, z);
    
  } catch (error) {
    console.error('XOR operation failed:', error);
    return [contourA];
  }
}

/**
 * Complex boolean operation: (A ∪ B) - C
 * Combines A and B, then subtracts C from the result
 */
export async function combineAndSubtract(
  contourA: number[], 
  contourB: number[], 
  contourC: number[]
): Promise<number[][]> {
  // First combine A and B
  const combined = await combineContours(contourA, contourB);
  
  if (combined.length === 0) {
    return [];
  }
  
  // For multiple result contours, we need to subtract C from each
  const results: number[][] = [];
  
  for (const combinedContour of combined) {
    const subtracted = await subtractContours(combinedContour, contourC);
    results.push(...subtracted);
  }
  
  return results;
}

/**
 * Complex boolean operation: (A ∩ B) ∪ C
 * Intersects A and B, then combines with C
 */
export async function intersectAndCombine(
  contourA: number[], 
  contourB: number[], 
  contourC: number[]
): Promise<number[][]> {
  // First intersect A and B
  const intersection = await intersectContours(contourA, contourB);
  
  if (intersection.length === 0) {
    // If no intersection, just return C
    return contourC.length >= 9 ? [contourC] : [];
  }
  
  // Combine all intersection results with C
  const api = await getClipper();
  const clipper = await createClipperInstance();
  const solution = await createPaths();
  const z = contourA[2];
  
  try {
    // Add all intersection results
    for (const intersectContour of intersection) {
      const path = await contourToClipperPath(intersectContour);
      clipper.AddPath(path, api.PolyType.ptSubject, true);
    }
    
    // Add C
    const pathC = await contourToClipperPath(contourC);
    clipper.AddPath(pathC, api.PolyType.ptClip, true);
    
    // Perform union
    clipper.Execute(api.ClipType.ctUnion, solution,
      api.PolyFillType.pftNonZero,
      api.PolyFillType.pftNonZero
    );
    
    return clipperPathsToContours(solution, z);
    
  } catch (error) {
    console.error('Intersect and combine operation failed:', error);
    return intersection;
  }
}

/**
 * Check if a point is inside a contour using ClipperLib
 */
export async function isPointInContour(point: [number, number], contour: number[]): Promise<boolean> {
  if (contour.length < 9) {
    return false;
  }
  
  const api = await getClipper();
  const path = await contourToClipperPath(contour);
  const testPoint = {
    X: Math.round(point[0] * SCALE),
    Y: Math.round(point[1] * SCALE)
  };
  
  const PointInPolygonClass = api.PointInPolygon;
  const result = PointInPolygonClass(testPoint, path);
  
  // 0 = outside, 1 = inside, -1 = on boundary
  return result !== 0;
}

/**
 * Simplify a contour by removing redundant points
 */
export async function simplifyContour(contour: number[], tolerance: number = 0.5): Promise<number[]> {
  if (contour.length < 9) {
    return contour;
  }
  
  const z = contour[2];
  const api = await getClipper();
  const path = await contourToClipperPath(contour);
  
  const CleanPolygonClass = api.CleanPolygon;
  const cleanedPath = CleanPolygonClass(path, tolerance * SCALE);
  
  const result: number[] = [];
  for (let i = 0; i < cleanedPath.size(); i++) {
    const point = cleanedPath.get(i);
    result.push(
      point.X / SCALE,
      point.Y / SCALE,
      z
    );
  }
  
  return result;
}