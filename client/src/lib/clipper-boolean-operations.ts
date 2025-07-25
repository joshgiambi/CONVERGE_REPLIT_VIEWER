/**
 * ClipperLib-based boolean operations for medical imaging contours
 * Provides accurate union and difference operations for RT structure contours
 */

import ClipperLib from 'js-angusj-clipper';

// Initialize ClipperLib
let clipperInstance: any = null;

async function getClipper() {
  if (!clipperInstance) {
    clipperInstance = await ClipperLib.loadNativeClipperLibInstanceAsync(
      ClipperLib.NativeClipperLibRequestedFormat.WasmWithAsmJsFallback
    );
  }
  return clipperInstance;
}

interface Point2D {
  x: number;
  y: number;
}

// Scaling factor for integer conversion (ClipperLib uses integers)
const SCALE_FACTOR = 100000;

/**
 * Convert DICOM contour points to ClipperLib path format
 */
function contourToClipperPath(contour: number[]): Array<{X: number, Y: number}> {
  const path: Array<{X: number, Y: number}> = [];
  
  for (let i = 0; i < contour.length - 2; i += 3) {
    path.push({
      X: Math.round(contour[i] * SCALE_FACTOR),
      Y: Math.round(contour[i + 1] * SCALE_FACTOR)
    });
  }
  
  return path;
}

/**
 * Convert ClipperLib paths back to DICOM contour format
 */
function clipperPathsToContour(paths: Array<Array<{X: number, Y: number}>>, zValue: number): number[] {
  if (!paths || paths.length === 0) return [];
  
  // Take the first path (largest area) as the main contour
  let largestPath = paths[0];
  let largestArea = 0;
  
  for (const path of paths) {
    const area = Math.abs(ClipperLib.Clipper.Area(path));
    if (area > largestArea) {
      largestArea = area;
      largestPath = path;
    }
  }
  
  const result: number[] = [];
  for (const point of largestPath) {
    result.push(
      point.X / SCALE_FACTOR,
      point.Y / SCALE_FACTOR,
      zValue
    );
  }
  
  return result;
}

/**
 * Combine two contours using ClipperLib union operation
 */
export async function combineContoursClipper(contour1: number[], contour2: number[]): Promise<number[]> {
  if (!contour1 || contour1.length < 9) return contour2;
  if (!contour2 || contour2.length < 9) return contour1;
  
  try {
    const clipper = await getClipper();
    
    // Convert contours to ClipperLib paths
    const path1 = contourToClipperPath(contour1);
    const path2 = contourToClipperPath(contour2);
    
    // Create clipper instance
    const cpr = new clipper.Clipper();
    cpr.AddPath(path1, clipper.PolyType.ptSubject, true);
    cpr.AddPath(path2, clipper.PolyType.ptClip, true);
    
    // Perform union operation
    const solution = new clipper.Paths();
    const success = cpr.Execute(
      clipper.ClipType.ctUnion,
      solution,
      clipper.PolyFillType.pftNonZero,
      clipper.PolyFillType.pftNonZero
    );
    
    if (!success || solution.size() === 0) {
      console.warn('ClipperLib union operation failed');
      return contour1; // Return original on failure
    }
    
    // Convert solution to array
    const solutionArray: Array<Array<{X: number, Y: number}>> = [];
    for (let i = 0; i < solution.size(); i++) {
      const path = solution.get(i);
      const pathArray: Array<{X: number, Y: number}> = [];
      for (let j = 0; j < path.size(); j++) {
        pathArray.push(path.get(j));
      }
      solutionArray.push(pathArray);
    }
    
    // Clean up
    solution.delete();
    cpr.delete();
    
    // Convert back to DICOM format
    const zValue = contour1[2];
    return clipperPathsToContour(solutionArray, zValue);
    
  } catch (error) {
    console.error('Error in ClipperLib union operation:', error);
    return contour1; // Return original on error
  }
}

/**
 * Subtract one contour from another using ClipperLib difference operation
 */
export async function subtractContoursClipper(contour1: number[], contour2: number[]): Promise<number[]> {
  if (!contour1 || contour1.length < 9) return [];
  if (!contour2 || contour2.length < 9) return contour1;
  
  try {
    const clipper = await getClipper();
    
    // Convert contours to ClipperLib paths
    const path1 = contourToClipperPath(contour1);
    const path2 = contourToClipperPath(contour2);
    
    // Create clipper instance
    const cpr = new clipper.Clipper();
    cpr.AddPath(path1, clipper.PolyType.ptSubject, true);
    cpr.AddPath(path2, clipper.PolyType.ptClip, true);
    
    // Perform difference operation
    const solution = new clipper.Paths();
    const success = cpr.Execute(
      clipper.ClipType.ctDifference,
      solution,
      clipper.PolyFillType.pftNonZero,
      clipper.PolyFillType.pftNonZero
    );
    
    if (!success || solution.size() === 0) {
      console.warn('ClipperLib difference operation resulted in empty contour');
      return [];
    }
    
    // Convert solution to array
    const solutionArray: Array<Array<{X: number, Y: number}>> = [];
    for (let i = 0; i < solution.size(); i++) {
      const path = solution.get(i);
      const pathArray: Array<{X: number, Y: number}> = [];
      for (let j = 0; j < path.size(); j++) {
        pathArray.push(path.get(j));
      }
      solutionArray.push(pathArray);
    }
    
    // Clean up
    solution.delete();
    cpr.delete();
    
    // Convert back to DICOM format
    const zValue = contour1[2];
    return clipperPathsToContour(solutionArray, zValue);
    
  } catch (error) {
    console.error('Error in ClipperLib difference operation:', error);
    return contour1; // Return original on error
  }
}

/**
 * Merge a pen stroke (polygon) with existing contour
 * Handles both additive (union) and subtractive (difference) operations
 */
export async function mergePenStrokeWithContour(
  existingContour: number[], 
  penStroke: number[], 
  isAdditive: boolean
): Promise<number[]> {
  if (!penStroke || penStroke.length < 9) return existingContour;
  
  if (!existingContour || existingContour.length < 9) {
    // No existing contour, just return the pen stroke
    return isAdditive ? penStroke : [];
  }
  
  // Use appropriate operation based on mode
  if (isAdditive) {
    return await combineContoursClipper(existingContour, penStroke);
  } else {
    return await subtractContoursClipper(existingContour, penStroke);
  }
}

/**
 * Check if a point is inside a contour
 */
export function isPointInContour(point: Point2D, contour: number[]): boolean {
  if (!contour || contour.length < 9) return false;
  
  // Convert to polygon points
  const polygon: Point2D[] = [];
  for (let i = 0; i < contour.length - 2; i += 3) {
    polygon.push({
      x: contour[i],
      y: contour[i + 1]
    });
  }
  
  // Ray casting algorithm
  let inside = false;
  const n = polygon.length;
  let p1 = polygon[0];
  
  for (let i = 1; i <= n; i++) {
    const p2 = polygon[i % n];
    
    if (point.y > Math.min(p1.y, p2.y)) {
      if (point.y <= Math.max(p1.y, p2.y)) {
        if (point.x <= Math.max(p1.x, p2.x)) {
          let xIntersection: number;
          
          if (p1.y !== p2.y) {
            xIntersection = (point.y - p1.y) * (p2.x - p1.x) / (p2.y - p1.y) + p1.x;
          } else {
            xIntersection = point.x;
          }
          
          if (p1.x === p2.x || point.x <= xIntersection) {
            inside = !inside;
          }
        }
      }
    }
    
    p1 = p2;
  }
  
  return inside;
}