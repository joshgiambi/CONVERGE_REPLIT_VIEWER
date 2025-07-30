import polygonClipping from 'polygon-clipping';

/**
 * Simple polygon operations using the polygon-clipping library
 * Much more reliable than js-angusj-clipper for basic operations
 */

/**
 * Convert 3D contour points (x,y,z format) to 2D polygon format for polygon-clipping
 */
function contourToPolygon(points: number[]): [number, number][] {
  const polygon: [number, number][] = [];
  for (let i = 0; i < points.length; i += 3) {
    polygon.push([points[i], points[i + 1]]);
  }
  
  // Ensure polygon is closed
  if (polygon.length > 0) {
    const first = polygon[0];
    const last = polygon[polygon.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      polygon.push([first[0], first[1]]);
    }
  }
  
  return polygon;
}

/**
 * Convert polygon-clipping result back to 3D contour points
 */
function polygonToContour(polygon: [number, number][], z: number = 0): number[] {
  const contour: number[] = [];
  for (const point of polygon) {
    contour.push(point[0], point[1], z);
  }
  return contour;
}

/**
 * Subtract one contour from another (delete operation)
 */
export function subtractContourSimple(
  originalContour: number[],
  deleteContour: number[]
): number[][] {
  try {
    console.log('🔹 Using simple polygon subtraction');
    console.log('🔹 Original points:', originalContour.length / 3);
    console.log('🔹 Delete points:', deleteContour.length / 3);
    
    const z = originalContour[2] || 0;
    
    // Convert to polygon format
    const originalPolygon = contourToPolygon(originalContour);
    const deletePolygon = contourToPolygon(deleteContour);
    
    console.log('🔹 Converted polygons - Original:', originalPolygon.length, 'Delete:', deletePolygon.length);
    
    // Perform difference operation
    const result = polygonClipping.difference(
      [originalPolygon], // Subject polygon (array of rings)
      [deletePolygon]    // Clip polygon (array of rings) 
    );
    
    console.log('🔹 Subtraction result:', result.length, 'polygons');
    
    // Convert results back to contour format
    const resultContours: number[][] = [];
    
    for (const multiPolygon of result) {
      for (const ring of multiPolygon) {
        if (ring.length >= 3) { // Valid polygon needs at least 3 points
          const contour = polygonToContour(ring, z);
          resultContours.push(contour);
          console.log('🔹 ✅ Added result contour with', ring.length, 'points');
        }
      }
    }
    
    return resultContours;
    
  } catch (error) {
    console.error('🔹 ❌ Simple subtraction failed:', error);
    return [originalContour]; // Return original if operation fails
  }
}

/**
 * Union two contours together
 */
export function unionContoursSimple(
  contour1: number[],
  contour2: number[]
): number[][] {
  try {
    const z = contour1[2] || 0;
    
    const polygon1 = contourToPolygon(contour1);
    const polygon2 = contourToPolygon(contour2);
    
    const result = polygonClipping.union(
      [polygon1],
      [polygon2]
    );
    
    const resultContours: number[][] = [];
    for (const multiPolygon of result) {
      for (const ring of multiPolygon) {
        if (ring.length >= 3) {
          resultContours.push(polygonToContour(ring, z));
        }
      }
    }
    
    return resultContours;
    
  } catch (error) {
    console.error('🔹 Union failed:', error);
    return [contour1, contour2];
  }
}

/**
 * Union multiple contours together (for brush operations)
 */
export function unionMultipleContoursSimple(contours: number[][]): number[][] {
  if (contours.length === 0) return [];
  if (contours.length === 1) return contours;
  
  try {
    console.log('🔹 Union multiple contours:', contours.length);
    
    // Use iterative approach - union pairs
    let result = contours[0];
    for (let i = 1; i < contours.length; i++) {
      const unionResult = unionContoursSimple(result, contours[i]);
      if (unionResult.length > 0) {
        result = unionResult[0]; // Take first result
      }
    }
    
    console.log('🔹 ✅ Multiple union completed');
    return [result];
    
  } catch (error) {
    console.error('🔹 ❌ Multiple union failed:', error);
    return contours; // Return originals if operation fails
  }
}

/**
 * Check if two polygons intersect (simple bounding box + more detailed check)
 */
export function doPolygonsIntersectSimple(polygon1: number[], polygon2: number[]): boolean {
  try {
    // Quick bounding box check first
    let minX1 = Infinity, maxX1 = -Infinity, minY1 = Infinity, maxY1 = -Infinity;
    let minX2 = Infinity, maxX2 = -Infinity, minY2 = Infinity, maxY2 = -Infinity;
    
    for (let i = 0; i < polygon1.length; i += 3) {
      minX1 = Math.min(minX1, polygon1[i]);
      maxX1 = Math.max(maxX1, polygon1[i]);
      minY1 = Math.min(minY1, polygon1[i + 1]);
      maxY1 = Math.max(maxY1, polygon1[i + 1]);
    }
    
    for (let i = 0; i < polygon2.length; i += 3) {
      minX2 = Math.min(minX2, polygon2[i]);
      maxX2 = Math.max(maxX2, polygon2[i]);
      minY2 = Math.min(minY2, polygon2[i + 1]);
      maxY2 = Math.max(maxY2, polygon2[i + 1]);
    }
    
    // Check if bounding boxes overlap
    const bboxIntersects = !(maxX1 < minX2 || maxX2 < minX1 || maxY1 < minY2 || maxY2 < minY1);
    
    if (!bboxIntersects) {
      return false;
    }
    
    // If bounding boxes overlap, try actual intersection
    const poly1 = contourToPolygon(polygon1);
    const poly2 = contourToPolygon(polygon2);
    
    const intersection = polygonClipping.intersection([poly1], [poly2]);
    
    return intersection.length > 0;
    
  } catch (error) {
    console.warn('🔹 Intersection check failed, assuming no intersection:', error);
    return false;
  }
}

/**
 * Grow/expand or shrink contour by specified distance (margin operation)
 * This replaces the complex clipper offsetting with simpler buffering
 */
export function growContourSimple(contour: number[], distance: number): number[] {
  try {
    console.log('🔹 Processing contour by', distance, 'mm');
    
    const z = contour[2] || 0;
    const polygon = contourToPolygon(contour);
    
    // Use absolute distance for buffering operations
    const absDistance = Math.abs(distance);
    const isGrowing = distance > 0;
    
    console.log(`🔹 ${isGrowing ? 'Growing' : 'Shrinking'} by ${absDistance}mm`);
    
    // For very small distances, just return original
    if (absDistance < 0.1) {
      console.log('🔹 Distance too small, returning original');
      return contour;
    }
    
    // Create multiple offset layers for smoother results
    const layers = Math.max(5, Math.ceil(absDistance / 1.0)); // More layers for much smoother results
    const stepDistance = absDistance / layers;
    
    let currentPolygon = polygon;
    
    // Apply buffering in small steps for smoother results
    for (let i = 0; i < layers; i++) {
      const layerDistance = isGrowing ? stepDistance : -stepDistance;
      const newPolygon = bufferPolygon(currentPolygon, layerDistance);
      
      // Check if buffering produced a valid result
      if (newPolygon.length >= 3) {
        currentPolygon = newPolygon;
        
        // Apply smoothing every layer for better results
        currentPolygon = smoothPolygon(currentPolygon);
      }
    }
    
    // Multiple final smoothing passes for preview contours
    currentPolygon = smoothPolygon(currentPolygon);
    currentPolygon = smoothPolygon(currentPolygon);
    currentPolygon = smoothPolygon(currentPolygon);
    
    const result = polygonToContour(currentPolygon, z);
    console.log(`🔹 ✅ Contour ${isGrowing ? 'grown' : 'shrunk'} from ${contour.length/3} to ${result.length/3} points`);
    
    return result;
    
  } catch (error) {
    console.error('🔹 ❌ Grow operation failed:', error);
    return contour; // Return original if operation fails
  }
}

/**
 * Simple polygon buffering/offsetting
 */
function bufferPolygon(polygon: [number, number][], distance: number): [number, number][] {
  if (polygon.length < 3) return polygon;
  
  const buffered: [number, number][] = [];
  
  for (let i = 0; i < polygon.length; i++) {
    const prev = polygon[(i - 1 + polygon.length) % polygon.length];
    const curr = polygon[i];
    const next = polygon[(i + 1) % polygon.length];
    
    // Calculate normals
    const normal1 = getNormal(prev, curr);
    const normal2 = getNormal(curr, next);
    
    // Average normal
    const avgNormalX = (normal1[0] + normal2[0]) / 2;
    const avgNormalY = (normal1[1] + normal2[1]) / 2;
    
    // Normalize
    const length = Math.sqrt(avgNormalX * avgNormalX + avgNormalY * avgNormalY);
    const normalizedX = length > 0 ? avgNormalX / length : 0;
    const normalizedY = length > 0 ? avgNormalY / length : 1;
    
    // Apply offset
    buffered.push([
      curr[0] + normalizedX * distance,
      curr[1] + normalizedY * distance
    ]);
  }
  
  return buffered;
}

/**
 * Get outward normal for a line segment
 */
function getNormal(p1: [number, number], p2: [number, number]): [number, number] {
  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  const length = Math.sqrt(dx * dx + dy * dy);
  
  if (length === 0) return [0, 1];
  
  // Perpendicular vector (rotated 90 degrees)
  return [-dy / length, dx / length];
}

/**
 * Simple polygon smoothing using moving average
 */
function smoothPolygon(polygon: [number, number][]): [number, number][] {
  if (polygon.length < 4) return polygon;
  
  const smoothed: [number, number][] = [];
  const smoothingRadius = 1; // Number of points to average
  
  for (let i = 0; i < polygon.length; i++) {
    let sumX = 0, sumY = 0, count = 0;
    
    // Average with neighboring points
    for (let j = -smoothingRadius; j <= smoothingRadius; j++) {
      const idx = (i + j + polygon.length) % polygon.length;
      sumX += polygon[idx][0];
      sumY += polygon[idx][1];
      count++;
    }
    
    smoothed.push([sumX / count, sumY / count]);
  }
  
  return smoothed;
}

/**
 * Test the simple polygon operations
 */
export function testSimplePolygonOps(): void {
  console.log('🔹 Testing simple polygon operations...');
  
  // Create a simple square
  const square = [0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 10, 0];
  
  // Create an overlapping rectangle  
  const rect = [5, 5, 0, 15, 5, 0, 15, 15, 0, 5, 15, 0];
  
  // Test intersection
  const intersects = doPolygonsIntersectSimple(square, rect);
  console.log('🔹 Polygons intersect:', intersects);
  
  // Test subtraction
  const subtracted = subtractContourSimple(square, rect);
  console.log('🔹 Subtraction result:', subtracted.length, 'contours');
  
  // Test union
  const union = unionContoursSimple(square, rect);
  console.log('🔹 Union result:', union.length, 'contours');
  
  // Test multiple union
  const multiUnion = unionMultipleContoursSimple([square, rect]);
  console.log('🔹 Multiple union result:', multiUnion.length, 'contours');
  
  // Test grow
  const grown = growContourSimple(square, 2);
  console.log('🔹 Grow result:', grown.length / 3, 'points');
}

// Make functions available globally for debugging
if (typeof window !== 'undefined') {
  (window as any).testSimplePolygonOps = testSimplePolygonOps;
  (window as any).subtractContourSimple = subtractContourSimple;
  (window as any).doPolygonsIntersectSimple = doPolygonsIntersectSimple;
  (window as any).unionContoursSimple = unionContoursSimple;
  (window as any).unionMultipleContoursSimple = unionMultipleContoursSimple;
  (window as any).growContourSimple = growContourSimple;
} 