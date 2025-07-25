/**
 * Comprehensive boolean operations for medical contours using js-angusj-clipper
 * Provides union, subtract, intersection, XOR, and complex operations
 */

import * as clipperLib from 'js-angusj-clipper';

const SCALE = 1000000; // Scale factor for ClipperLib (converts to integers)

/**
 * Convert 3D contour points to ClipperLib path format
 */
function contourToClipperPath(points: number[]): clipperLib.Path {
  const path = new clipperLib.Path();
  
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
function clipperPathsToContours(paths: clipperLib.Paths, z: number): number[][] {
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
export function combineContours(contourA: number[], contourB: number[]): number[][] {
  if (contourA.length < 9 || contourB.length < 9) {
    console.warn('Contours must have at least 3 points');
    return contourA.length >= 9 ? [contourA] : contourB.length >= 9 ? [contourB] : [];
  }

  const z = contourA[2]; // Assume same Z plane
  const ClipperClass = clipperLib.Clipper;
  const clipper = new ClipperClass();
  const solution = new clipperLib.Paths();
  
  try {
    // Add both contours
    clipper.AddPath(contourToClipperPath(contourA), clipperLib.PolyType.ptSubject, true);
    clipper.AddPath(contourToClipperPath(contourB), clipperLib.PolyType.ptClip, true);
    
    // Perform union
    clipper.Execute(clipperLib.ClipType.ctUnion, solution, 
      clipperLib.PolyFillType.pftNonZero, 
      clipperLib.PolyFillType.pftNonZero
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
export function subtractContours(contourA: number[], contourB: number[]): number[][] {
  if (contourA.length < 9) {
    console.warn('Base contour must have at least 3 points');
    return [];
  }
  
  if (contourB.length < 9) {
    console.warn('Subtract contour must have at least 3 points');
    return [contourA];
  }

  const z = contourA[2];
  const ClipperClass = clipperLib.Clipper;
  const clipper = new ClipperClass();
  const solution = new clipperLib.Paths();
  
  try {
    clipper.AddPath(contourToClipperPath(contourA), clipperLib.PolyType.ptSubject, true);
    clipper.AddPath(contourToClipperPath(contourB), clipperLib.PolyType.ptClip, true);
    
    // Perform difference
    clipper.Execute(clipperLib.ClipType.ctDifference, solution,
      clipperLib.PolyFillType.pftNonZero,
      clipperLib.PolyFillType.pftNonZero
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
export function intersectContours(contourA: number[], contourB: number[]): number[][] {
  if (contourA.length < 9 || contourB.length < 9) {
    console.warn('Contours must have at least 3 points');
    return [];
  }

  const z = contourA[2];
  const ClipperClass = clipperLib.Clipper;
  const clipper = new ClipperClass();
  const solution = new clipperLib.Paths();
  
  try {
    clipper.AddPath(contourToClipperPath(contourA), clipperLib.PolyType.ptSubject, true);
    clipper.AddPath(contourToClipperPath(contourB), clipperLib.PolyType.ptClip, true);
    
    // Perform intersection
    clipper.Execute(clipperLib.ClipType.ctIntersection, solution,
      clipperLib.PolyFillType.pftNonZero,
      clipperLib.PolyFillType.pftNonZero
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
export function xorContours(contourA: number[], contourB: number[]): number[][] {
  if (contourA.length < 9 || contourB.length < 9) {
    console.warn('Contours must have at least 3 points');
    return contourA.length >= 9 ? [contourA] : [];
  }

  const z = contourA[2];
  const ClipperClass = clipperLib.Clipper;
  const clipper = new ClipperClass();
  const solution = new clipperLib.Paths();
  
  try {
    clipper.AddPath(contourToClipperPath(contourA), clipperLib.PolyType.ptSubject, true);
    clipper.AddPath(contourToClipperPath(contourB), clipperLib.PolyType.ptClip, true);
    
    // Perform XOR
    clipper.Execute(clipperLib.ClipType.ctXor, solution,
      clipperLib.PolyFillType.pftNonZero,
      clipperLib.PolyFillType.pftNonZero
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
export function combineAndSubtract(
  contourA: number[], 
  contourB: number[], 
  contourC: number[]
): number[][] {
  // First combine A and B
  const combined = combineContours(contourA, contourB);
  
  if (combined.length === 0) {
    return [];
  }
  
  // For multiple result contours, we need to subtract C from each
  const results: number[][] = [];
  
  for (const combinedContour of combined) {
    const subtracted = subtractContours(combinedContour, contourC);
    results.push(...subtracted);
  }
  
  return results;
}

/**
 * Complex boolean operation: (A ∩ B) ∪ C
 * Intersects A and B, then combines with C
 */
export function intersectAndCombine(
  contourA: number[], 
  contourB: number[], 
  contourC: number[]
): number[][] {
  // First intersect A and B
  const intersection = intersectContours(contourA, contourB);
  
  if (intersection.length === 0) {
    // If no intersection, just return C
    return contourC.length >= 9 ? [contourC] : [];
  }
  
  // Combine all intersection results with C
  const ClipperClass = clipperLib.Clipper;
  const clipper = new ClipperClass();
  const solution = new clipperLib.Paths();
  const z = contourA[2];
  
  try {
    // Add all intersection results
    for (const intersectContour of intersection) {
      clipper.AddPath(contourToClipperPath(intersectContour), clipperLib.PolyType.ptSubject, true);
    }
    
    // Add C
    clipper.AddPath(contourToClipperPath(contourC), clipperLib.PolyType.ptClip, true);
    
    // Perform union
    clipper.Execute(clipperLib.ClipType.ctUnion, solution,
      clipperLib.PolyFillType.pftNonZero,
      clipperLib.PolyFillType.pftNonZero
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
export function isPointInContour(point: [number, number], contour: number[]): boolean {
  if (contour.length < 9) {
    return false;
  }
  
  const path = contourToClipperPath(contour);
  const testPoint = {
    X: Math.round(point[0] * SCALE),
    Y: Math.round(point[1] * SCALE)
  };
  
  const PointInPolygonClass = clipperLib.PointInPolygon;
  const result = PointInPolygonClass(testPoint, path);
  
  // 0 = outside, 1 = inside, -1 = on boundary
  return result !== 0;
}

/**
 * Simplify a contour by removing redundant points
 */
export function simplifyContour(contour: number[], tolerance: number = 0.5): number[] {
  if (contour.length < 9) {
    return contour;
  }
  
  const z = contour[2];
  const path = contourToClipperPath(contour);
  
  const CleanPolygonClass = clipperLib.CleanPolygon;
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