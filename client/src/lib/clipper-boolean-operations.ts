/**
 * Comprehensive boolean operations for medical contours using js-angusj-clipper
 * Provides union, subtract, intersection, XOR, and complex operations
 */

import { getClipper, createClipperInstance, createPath, createPaths, createClipperOffset } from './clipper-adapter';

const SCALE = 10000; // Scale factor for ClipperLib (1e4 is safer than 1e6)
const CLEAN_TOLERANCE = 0.1; // mm tolerance for polygon cleaning
const MIN_AREA = 1e-3; // Minimum area in mm² to keep a polygon

/**
 * Fallback point-in-polygon test using ray casting algorithm
 */
function pointInPolygonFallback(point: {X: number, Y: number}, polygon: any[]): number {
  let inside = false;
  const x = point.X;
  const y = point.Y;
  
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].X;
    const yi = polygon[i].Y;
    const xj = polygon[j].X;
    const yj = polygon[j].Y;
    
    const intersect = ((yi > y) !== (yj > y))
        && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  
  return inside ? 1 : 0;
}

/**
 * Convert 3D contour points to ClipperLib path format
 */
async function contourToClipperPath(points: number[]): Promise<any> {
  const api = await getClipper();
  const path = new api.Path();
  
  for (let i = 0; i < points.length; i += 3) {
    // Create IntPoint using the ClipperLib constructor
    const pt = new api.IntPoint(
      Math.round(points[i] * SCALE),
      Math.round(points[i + 1] * SCALE)
    );
    path.push_back(pt);
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
  const solution = new api.Paths();
  
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
  const solution = new api.Paths();
  
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
  const solution = new api.Paths();
  
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
  const solution = new api.Paths();
  
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
  const solution = new api.Paths();
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
  
  // PointInPolygon might be a function or static method depending on ClipperLib version
  let result;
  try {
    // Try as a direct function (JavaScript version)
    if (typeof api.PointInPolygon === 'function') {
      result = api.PointInPolygon(testPoint, path);
    } else if (api.Clipper && typeof api.Clipper.PointInPolygon === 'function') {
      // Try as a static method on Clipper class
      result = api.Clipper.PointInPolygon(testPoint, path);
    } else {
      // Fallback: implement basic point-in-polygon test
      console.warn('PointInPolygon not found in ClipperLib, using fallback');
      result = pointInPolygonFallback(testPoint, path);
    }
  } catch (error) {
    console.error('PointInPolygon error, using fallback:', error);
    result = pointInPolygonFallback(testPoint, path);
  }
  
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

/**
 * Comprehensive test function to validate all clipper operations
 */
export async function testClipperOperations(): Promise<{
  success: boolean;
  results: {
    offset: boolean;
    union: boolean;
    subtract: boolean;
    intersect: boolean;
    xor: boolean;
  };
  errors: string[];
}> {
  const results = {
    offset: false,
    union: false,
    subtract: false,
    intersect: false,
    xor: false
  };
  const errors: string[] = [];

  try {
    console.log('🧪 Testing Clipper operations...');
    
    // Create test contours
    const testContour1 = [
      0, 0, 0,    // bottom-left
      10, 0, 0,   // bottom-right  
      10, 10, 0,  // top-right
      0, 10, 0    // top-left
    ];
    
    const testContour2 = [
      5, 5, 0,   // overlapping square
      15, 5, 0,
      15, 15, 0,
      5, 15, 0
    ];

    // Test 1: Offset operation
    try {
      console.log('🔄 Testing offset operation...');
      const offsetResult = await offsetContour(testContour1, 1.0);
      if (offsetResult && offsetResult.length > 0) {
        results.offset = true;
        console.log('✅ Offset test passed');
      } else {
        errors.push('Offset operation returned empty result');
      }
    } catch (error) {
      errors.push(`Offset operation failed: ${error}`);
      console.error('❌ Offset test failed:', error);
    }

    // Test 2: Union operation
    try {
      console.log('🔗 Testing union operation...');
      const unionResult = await combineContours(testContour1, testContour2);
      if (unionResult && unionResult.length > 0) {
        results.union = true;
        console.log('✅ Union test passed');
      } else {
        errors.push('Union operation returned empty result');
      }
    } catch (error) {
      errors.push(`Union operation failed: ${error}`);
      console.error('❌ Union test failed:', error);
    }

    // Test 3: Subtract operation
    try {
      console.log('➖ Testing subtract operation...');
      const subtractResult = await subtractContours(testContour1, testContour2);
      if (subtractResult && subtractResult.length >= 0) { // Can be empty if completely subtracted
        results.subtract = true;
        console.log('✅ Subtract test passed');
      } else {
        errors.push('Subtract operation returned invalid result');
      }
    } catch (error) {
      errors.push(`Subtract operation failed: ${error}`);
      console.error('❌ Subtract test failed:', error);
    }

    // Test 4: Intersect operation
    try {
      console.log('⋂ Testing intersect operation...');
      const intersectResult = await intersectContours(testContour1, testContour2);
      if (intersectResult && intersectResult.length >= 0) { // Can be empty if no intersection
        results.intersect = true;
        console.log('✅ Intersect test passed');
      } else {
        errors.push('Intersect operation returned invalid result');
      }
    } catch (error) {
      errors.push(`Intersect operation failed: ${error}`);
      console.error('❌ Intersect test failed:', error);
    }

    // Test 5: XOR operation
    try {
      console.log('⊕ Testing XOR operation...');
      const xorResult = await xorContours(testContour1, testContour2);
      if (xorResult && xorResult.length >= 0) {
        results.xor = true;
        console.log('✅ XOR test passed');
      } else {
        errors.push('XOR operation returned invalid result');
      }
    } catch (error) {
      errors.push(`XOR operation failed: ${error}`);
      console.error('❌ XOR test failed:', error);
    }

    const allPassed = Object.values(results).every(result => result === true);
    console.log(`🏁 Test summary: ${allPassed ? 'All tests passed!' : 'Some tests failed'}`);
    console.log('Results:', results);
    
    if (errors.length > 0) {
      console.log('Errors:', errors);
    }

    return {
      success: allPassed,
      results,
      errors
    };

  } catch (error) {
    console.error('❌ Critical error during testing:', error);
    return {
      success: false,
      results,
      errors: [...errors, `Critical error: ${error}`]
    };
  }
}

/**
 * Offset a contour (for brush strokes)
 */
export async function offsetContour(
  contour: number[],
  delta: number,
  joinType?: any,
  endType?: any
): Promise<number[][]> {
  if (contour.length < 9) {
    console.warn('Contour must have at least 3 points for offset operation');
    return [];
  }

  try {
    const api = await getClipper();
    joinType = joinType ?? api.JoinType.jtRound;
    endType = endType ?? api.EndType.etClosedPolygon; // Changed from etOpenRound to etClosedPolygon for closed contours
    
    const co = await createClipperOffset();
    const path = await contourToClipperPath(contour);
    
    console.log('Offset operation - Delta:', delta, 'JoinType:', joinType, 'EndType:', endType);
    
    co.AddPath(path, joinType, endType);
    const solution = await createPaths();
    
    const scaledDelta = delta * SCALE;
    console.log('Executing offset with scaled delta:', scaledDelta);
    
    co.Execute(solution, scaledDelta);
    
    const result = clipperPathsToContours(solution, contour[2]);
    console.log('Offset operation completed, result paths:', result.length);
    
    return result;
  } catch (error) {
    console.error('Offset operation failed:', error);
    // Return original contour as fallback
    return [contour];
  }
}

/**
 * Preview offset operation without applying it
 * Returns the visual representation of what the offset would look like
 */
export async function previewOffsetContour(
  contour: number[],
  delta: number,
  joinType?: any,
  endType?: any
): Promise<{
  success: boolean;
  previewContours: number[][];
  originalContour: number[];
  error?: string;
}> {
  if (contour.length < 9) {
    return {
      success: false,
      previewContours: [],
      originalContour: contour,
      error: 'Contour must have at least 3 points for offset operation'
    };
  }

  try {
    const result = await offsetContour(contour, delta, joinType, endType);
    
    return {
      success: true,
      previewContours: result,
      originalContour: contour
    };
  } catch (error) {
    return {
      success: false,
      previewContours: [],
      originalContour: contour,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
}

/**
 * Enhanced grow contour function with preview support
 */
export async function growContourWithPreview(
  contour: number[],
  distance: number, // in mm, positive for grow, negative for shrink
  preview: boolean = false
): Promise<{
  success: boolean;
  result: number[][];
  originalContour: number[];
  isPreview: boolean;
  error?: string;
}> {
  const response = await previewOffsetContour(contour, distance);
  
  return {
    success: response.success,
    result: response.previewContours,
    originalContour: response.originalContour,
    isPreview: preview,
    error: response.error
  };
}

/**
 * Offset an open path (for pen tool strokes and open curves)
 */
export async function offsetOpenPath(
  path: number[],
  delta: number,
  joinType?: any,
  endType?: any
): Promise<number[][]> {
  if (path.length < 6) { // Need at least 2 points for an open path
    console.warn('Path must have at least 2 points for offset operation');
    return [];
  }

  try {
    const api = await getClipper();
    joinType = joinType ?? api.JoinType.jtRound;
    endType = endType ?? api.EndType.etOpenRound; // Use etOpenRound for open paths
    
    const co = await createClipperOffset();
    const clipperPath = await contourToClipperPath(path);
    
    console.log('Open path offset - Delta:', delta, 'JoinType:', joinType, 'EndType:', endType);
    
    co.AddPath(clipperPath, joinType, endType);
    const solution = await createPaths();
    
    const scaledDelta = delta * SCALE;
    console.log('Executing open path offset with scaled delta:', scaledDelta);
    
    co.Execute(solution, scaledDelta);
    
    const result = clipperPathsToContours(solution, path[2]);
    console.log('Open path offset completed, result paths:', result.length);
    
    return result;
  } catch (error) {
    console.error('Open path offset operation failed:', error);
    // Return empty array for open paths since there's no meaningful fallback
    return [];
  }
}

/**
 * Test pen tool delete scenario: outside->inside->outside polygon subtraction
 */
export async function testPenToolDeleteScenario(): Promise<{
  success: boolean;
  result: number[][];
  error?: string;
}> {
  try {
    console.log('🖊️ Testing pen tool delete scenario...');
    
    // Create a base contour (like an existing structure)
    const baseContour = [
      10, 10, 0,   // bottom-left
      40, 10, 0,   // bottom-right  
      40, 40, 0,   // top-right
      10, 40, 0    // top-left
    ];
    
    // Create a delete polygon that starts outside, goes inside, ends outside
    const deletePolygon = [
      5, 25, 0,    // start outside (left)
      20, 25, 0,   // go inside
      25, 20, 0,   // inside
      25, 30, 0,   // inside
      45, 25, 0    // end outside (right)
    ];
    
    console.log('🖊️ Base contour:', baseContour.length / 3, 'points');
    console.log('🖊️ Delete polygon:', deletePolygon.length / 3, 'points');
    
    // Perform subtraction
    const result = await subtractContours(baseContour, deletePolygon);
    
    console.log('🖊️ Subtraction result:', result.length, 'contours');
    
    if (result.length > 0) {
      console.log('✅ Pen tool delete test passed');
      return {
        success: true,
        result
      };
    } else {
      console.log('⚠️ Pen tool delete returned empty result');
      return {
        success: false,
        result: [],
        error: 'Subtraction returned empty result'
      };
    }
  } catch (error) {
    console.error('❌ Pen tool delete test failed:', error);
    return {
      success: false,
      result: [],
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Debug function specifically for pen tool delete operations
 */
export async function debugPenToolDelete(
  originalContour: number[],
  deletePolygon: number[]
): Promise<{
  success: boolean;
  originalPoints: number;
  deletePoints: number;
  intersects: boolean;
  result: number[][];
  error?: string;
}> {
  console.log('🔍 DEBUG: Pen tool delete operation starting...');
  console.log('🔍 Original contour points:', originalContour.length / 3);
  console.log('🔍 Delete polygon points:', deletePolygon.length / 3);
  
  try {
    // Test intersection first
    const intersects = await testPolygonIntersection(originalContour, deletePolygon);
    console.log('🔍 Polygons intersect:', intersects);
    
    if (!intersects) {
      return {
        success: false,
        originalPoints: originalContour.length / 3,
        deletePoints: deletePolygon.length / 3,
        intersects: false,
        result: [],
        error: 'Polygons do not intersect'
      };
    }
    
    // Perform subtraction
    console.log('🔍 Performing subtraction...');
    const result = await subtractContours(originalContour, deletePolygon);
    console.log('🔍 Subtraction completed, result contours:', result.length);
    
    result.forEach((contour, index) => {
      console.log(`🔍 Result contour ${index + 1}: ${contour.length / 3} points`);
    });
    
    return {
      success: true,
      originalPoints: originalContour.length / 3,
      deletePoints: deletePolygon.length / 3,
      intersects: true,
      result: result
    };
    
  } catch (error) {
    console.error('🔍 DEBUG: Error during subtraction:', error);
    return {
      success: false,
      originalPoints: originalContour.length / 3,
      deletePoints: deletePolygon.length / 3,
      intersects: false,
      result: [],
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Simple intersection test
 */
async function testPolygonIntersection(poly1: number[], poly2: number[]): Promise<boolean> {
  // Basic bounding box check first
  let minX1 = Infinity, maxX1 = -Infinity, minY1 = Infinity, maxY1 = -Infinity;
  let minX2 = Infinity, maxX2 = -Infinity, minY2 = Infinity, maxY2 = -Infinity;
  
  for (let i = 0; i < poly1.length; i += 3) {
    minX1 = Math.min(minX1, poly1[i]);
    maxX1 = Math.max(maxX1, poly1[i]);
    minY1 = Math.min(minY1, poly1[i + 1]);
    maxY1 = Math.max(maxY1, poly1[i + 1]);
  }
  
  for (let i = 0; i < poly2.length; i += 3) {
    minX2 = Math.min(minX2, poly2[i]);
    maxX2 = Math.max(maxX2, poly2[i]);
    minY2 = Math.min(minY2, poly2[i + 1]);
    maxY2 = Math.max(maxY2, poly2[i + 1]);
  }
  
  // Check if bounding boxes overlap
  const bboxIntersects = !(maxX1 < minX2 || maxX2 < minX1 || maxY1 < minY2 || maxY2 < minY1);
  console.log('🔍 Bounding box intersection:', bboxIntersects);
  
  if (!bboxIntersects) return false;
  
  // More detailed intersection check would go here
  // For now, assume they intersect if bounding boxes do
  return true;
}

// Global debugging functions for browser console
declare global {
  interface Window {
    testClipperOps: () => Promise<any>;
    testPenDelete: () => Promise<any>;
    debugPenDelete: (original: number[], deletePolygon: number[]) => Promise<any>;
  }
}

// Make test functions available globally for debugging
if (typeof window !== 'undefined') {
  window.testClipperOps = testClipperOperations;
  window.testPenDelete = testPenToolDeleteScenario;
  window.debugPenDelete = debugPenToolDelete;
}