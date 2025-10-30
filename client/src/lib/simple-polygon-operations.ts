import polygonClipping from 'polygon-clipping';

const DUPLICATE_EPSILON = 1e-3;
const AREA_EPSILON = 1e-4;

const polygonArea = (polygon: [number, number][]): number => {
  if (polygon.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < polygon.length - 1; i += 1) {
    const [x1, y1] = polygon[i];
    const [x2, y2] = polygon[i + 1];
    area += x1 * y2 - x2 * y1;
  }
  return area / 2;
};

const pointsAlmostEqual = (a: [number, number], b: [number, number]): boolean => {
  return Math.abs(a[0] - b[0]) <= DUPLICATE_EPSILON && Math.abs(a[1] - b[1]) <= DUPLICATE_EPSILON;
};

const sanitizePolygon = (polygon: [number, number][]): [number, number][] => {
  if (!polygon.length) return [];

  const sanitized: [number, number][] = [];
  let lastPoint: [number, number] | null = null;
  for (const point of polygon) {
    if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) continue;
    if (lastPoint && pointsAlmostEqual(lastPoint, point)) continue;
    sanitized.push([point[0], point[1]]);
    lastPoint = point;
  }
  if (sanitized.length < 3) return [];

  const first = sanitized[0];
  const last = sanitized[sanitized.length - 1];
  if (!pointsAlmostEqual(first, last)) {
    sanitized.push([first[0], first[1]]);
  }

  if (sanitized.length < 4) return [];
  if (Math.abs(polygonArea(sanitized)) <= AREA_EPSILON) return [];
  return sanitized;
};

/**
 * Simple polygon operations using the polygon-clipping library
 * Much more reliable than js-angusj-clipper for basic operations
 */

/**
 * Convert 3D contour points (x,y,z format) to 2D polygon format for polygon-clipping
 */
export function contourToPolygon(points: number[]): [number, number][] {
  if (!Array.isArray(points) || points.length < 6) return [];

  const polygon: [number, number][] = [];
  let lastPoint: [number, number] | null = null;
  for (let i = 0; i < points.length; i += 3) {
    const x = Number(points[i]);
    const y = Number(points[i + 1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const current: [number, number] = [x, y];
    if (lastPoint && pointsAlmostEqual(lastPoint, current)) continue;
    polygon.push(current);
    lastPoint = current;
  }

  return sanitizePolygon(polygon);
}

/**
 * Convert polygon-clipping result back to 3D contour points
 */
export function polygonToContour(polygon: [number, number][], z: number = 0): number[] {
  const contour: number[] = [];
  if (!Array.isArray(polygon) || polygon.length === 0) return contour;

  const sanitized = sanitizePolygon(polygon);
  if (!sanitized.length) return contour;

  // Drop the closing point to avoid duplicating in contour representation
  const limit = sanitized.length - 1;
  for (let i = 0; i < limit; i += 1) {
    const point = sanitized[i];
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

    if (!originalPolygon.length) {
      console.warn('🔹 ⚠️ Original contour invalid for subtraction');
      return [originalContour];
    }
    if (!deletePolygon.length) {
      console.warn('🔹 ⚠️ Delete contour invalid, returning original');
      return [originalContour];
    }
    
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

    if (!polygon1.length || !polygon2.length) {
      console.warn('🔹 ⚠️ Union received invalid polygon geometry');
      return [contour1, contour2];
    }
    
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

    // Convert and iteratively union into an accumulated MultiPolygon
    type Ring = [number, number][];
    type Polygon = Ring[];
    type MultiPolygon = Polygon[];

    const toPolygon = (c: number[]): Polygon => {
      const ring = contourToPolygon(c);
      return ring.length ? [ring] : [];
    };
    const toMultiPolygon = (c: number[]): MultiPolygon => {
      const polygon = toPolygon(c);
      return polygon.length ? [polygon] : [];
    };

    const z = contours[0][2] || 0;
    if (!toPolygon(contours[0]).length) {
      console.warn('🔹 ⚠️ First contour invalid, aborting union');
      return contours;
    }

    let accum: MultiPolygon = toMultiPolygon(contours[0]);
    for (let i = 1; i < contours.length; i++) {
      const nextMp: MultiPolygon = toMultiPolygon(contours[i]);
      if (!nextMp.length) {
        console.warn(`🔹 ⚠️ Skipping invalid contour during union at index ${i}`);
        continue;
      }
      accum = polygonClipping.union(accum as any, nextMp as any) as MultiPolygon;
    }

    // Convert only outer rings of each polygon back to contours (ignore holes)
    const resultContours: number[][] = [];
    for (const polygon of accum) {
      const outer: Ring | undefined = polygon[0];
      if (outer && outer.length >= 3) {
        resultContours.push(polygonToContour(outer, z));
      }
    }

    console.log('🔹 ✅ Multiple union completed with', resultContours.length, 'blob(s)');
    return resultContours;

  } catch (error) {
    console.error('🔹 ❌ Multiple union failed:', error);
    return contours; // Preserve originals if operation fails
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

    if (!poly1.length || !poly2.length) {
      return false;
    }
    
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
    
    // Input validation
    if (polygon.length < 3) {
      console.warn('🔹 ⚠️ Invalid polygon with less than 3 points');
      return contour;
    }
    
    // Safety check: prevent extremely large operations that could crash the app
    const absDistance = Math.abs(distance);
    const MAX_SAFE_MARGIN = 100; // 100mm maximum
    const MAX_POINTS = 1000; // Maximum points to prevent memory issues
    
    if (absDistance > MAX_SAFE_MARGIN) {
      console.warn(`🔹 ⚠️ Margin ${absDistance}mm exceeds safe limit ${MAX_SAFE_MARGIN}mm, clamping`);
      distance = distance > 0 ? MAX_SAFE_MARGIN : -MAX_SAFE_MARGIN;
    }
    
    if (polygon.length > MAX_POINTS) {
      console.warn(`🔹 ⚠️ Input polygon has ${polygon.length} points, exceeds safe limit ${MAX_POINTS}, simplifying`);
      // Simplify by taking every nth point to reduce complexity
      const skipFactor = Math.ceil(polygon.length / MAX_POINTS);
      const simplifiedPolygon: [number, number][] = [];
      for (let i = 0; i < polygon.length; i += skipFactor) {
        simplifiedPolygon.push(polygon[i]);
      }
      polygon.length = 0;
      polygon.push(...simplifiedPolygon);
    }
    
    // Standard logic: positive values expand, negative values shrink  
    const isGrowing = distance > 0;
    
    console.log(`🔹 ${isGrowing ? 'Expanding' : 'Shrinking'} by ${Math.abs(distance)}mm`);
    
    // For very small distances, just return original
    if (Math.abs(distance) < 0.1) {
      console.log('🔹 Distance too small, returning original');
      return contour;
    }
    
    // Simplified approach: use fewer layers for performance and stability
    // Cap the number of layers to prevent excessive computation
    const maxLayers = 5; // Reduced from 10
    const baseLayerCount = Math.min(maxLayers, Math.max(2, Math.ceil(Math.abs(distance) / 3.0)));
    const layers = Math.abs(distance) > 10.0 ? 2 : baseLayerCount; // Use only 2 layers for large margins
    const stepDistance = distance / layers;
    
    console.log(`🔹 📊 Using ${layers} layers with step distance ${stepDistance.toFixed(3)}mm for performance`);
    
    let currentPolygon = polygon;
    let operationCount = 0;
    const MAX_OPERATIONS = 20; // Prevent infinite loops
    
    // Apply buffering in small steps with performance monitoring
    const startTime = performance.now();
    const MAX_PROCESSING_TIME = 5000; // 5 seconds maximum
    
    for (let i = 0; i < layers && operationCount < MAX_OPERATIONS; i++) {
      // Check processing time to prevent hangs
      if (performance.now() - startTime > MAX_PROCESSING_TIME) {
        console.warn('🔹 ⚠️ Processing time exceeded limit, stopping early');
        break;
      }
      
      const layerDistance = isGrowing ? stepDistance : -stepDistance;
      const newPolygon = bufferPolygon(currentPolygon, layerDistance);
      operationCount++;
      
      // Validate result
      if (newPolygon.length >= 3 && newPolygon.length <= MAX_POINTS) {
        currentPolygon = newPolygon;
        
        // Apply limited smoothing only for small polygons
        if (currentPolygon.length <= 200) {
          currentPolygon = smoothPolygon(currentPolygon);
          operationCount++;
        }
      } else {
        console.warn(`🔹 ⚠️ Layer ${i} produced invalid result (${newPolygon.length} points), stopping early`);
        break;
      }
    }
    
    // Apply final cleanup only if polygon is manageable size
    if (currentPolygon.length <= 500) {
      try {
        // Light smoothing
        currentPolygon = smoothPolygon(currentPolygon);
        
        // Simple self-intersection removal with timeout
        const cleanupStart = performance.now();
        currentPolygon = removeSelfIntersections(currentPolygon);
        
        // Final smoothing only if cleanup was fast
        if (performance.now() - cleanupStart < 100) { // 100ms limit
          currentPolygon = smoothPolygon(currentPolygon);
        }
      } catch (cleanupError) {
        console.warn('🔹 ⚠️ Cleanup operations failed, using raw result:', cleanupError);
      }
    } else {
      console.log('🔹 ⚡ Skipping cleanup for large polygon to maintain performance');
    }
    
    const result = polygonToContour(currentPolygon, z);
    const processingTime = performance.now() - startTime;
    
    console.log(`🔹 ✅ Contour ${isGrowing ? 'grown' : 'shrunk'} from ${contour.length/3} to ${result.length/3} points in ${processingTime.toFixed(1)}ms`);
    
    // Final validation
    if (result.length < 9) {
      console.warn('🔹 ⚠️ Result too small, returning original contour');
      return contour;
    }
    
    return result;
    
  } catch (error) {
    console.error('🔹 ❌ Grow operation failed:', error);
    console.error('🔹 📋 Stack trace:', (error as Error)?.stack);
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
    
    // Calculate normals for adjacent edges
    const normal1 = getNormal(prev, curr);
    const normal2 = getNormal(curr, next);
    
    // Calculate the angle between edges to handle sharp corners better
    const edgeVec1 = [curr[0] - prev[0], curr[1] - prev[1]];
    const edgeVec2 = [next[0] - curr[0], next[1] - curr[1]];
    
    const edge1Length = Math.sqrt(edgeVec1[0] * edgeVec1[0] + edgeVec1[1] * edgeVec1[1]);
    const edge2Length = Math.sqrt(edgeVec2[0] * edgeVec2[0] + edgeVec2[1] * edgeVec2[1]);
    
    if (edge1Length < 0.001 || edge2Length < 0.001) {
      // Skip degenerate edges
      continue;
    }
    
    // Average normal with better handling of sharp angles
    let avgNormalX = (normal1[0] + normal2[0]) / 2;
    let avgNormalY = (normal1[1] + normal2[1]) / 2;
    
    // Normalize average normal
    const avgLength = Math.sqrt(avgNormalX * avgNormalX + avgNormalY * avgNormalY);
    if (avgLength > 0.001) {
      avgNormalX /= avgLength;
      avgNormalY /= avgLength;
    } else {
      // Fallback to first normal if averaging failed
      avgNormalX = normal1[0];
      avgNormalY = normal1[1];
    }
    
    // Apply offset with bounds checking for stability
    const offsetX = curr[0] + avgNormalX * distance;
    const offsetY = curr[1] + avgNormalY * distance;
    
    // Validate the offset point isn't too far from original (prevents wild offsets)
    const maxOffset = Math.abs(distance) * 3; // Allow up to 3x the expected offset
    const actualOffset = Math.sqrt(
      (offsetX - curr[0]) ** 2 + (offsetY - curr[1]) ** 2
    );
    
    if (actualOffset <= maxOffset) {
      buffered.push([offsetX, offsetY]);
    } else {
      // Use a clamped offset for stability
      const clampFactor = maxOffset / actualOffset;
      buffered.push([
        curr[0] + avgNormalX * distance * clampFactor,
        curr[1] + avgNormalY * distance * clampFactor
      ]);
    }
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
  
  // Perpendicular vector (rotated 90 degrees clockwise for outward normal)
  // Fixed: was [-dy/length, dx/length] which gives left normal (inward)
  // Now: [dy/length, -dx/length] which gives right normal (outward)
  return [dy / length, -dx / length];
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
 * Remove self-intersections from polygon to prevent loops and artifacts
 */
function removeSelfIntersections(polygon: [number, number][]): [number, number][] {
  if (polygon.length < 4) return polygon;
  
  const cleaned: [number, number][] = [];
  
  // Simple approach: remove points that create acute angles or very short segments
  for (let i = 0; i < polygon.length; i++) {
    const prev = polygon[(i - 1 + polygon.length) % polygon.length];
    const curr = polygon[i];
    const next = polygon[(i + 1) % polygon.length];
    
    // Calculate vectors
    const v1 = [curr[0] - prev[0], curr[1] - prev[1]];
    const v2 = [next[0] - curr[0], next[1] - curr[1]];
    
    // Calculate distances
    const dist1 = Math.sqrt(v1[0] * v1[0] + v1[1] * v1[1]);
    const dist2 = Math.sqrt(v2[0] * v2[0] + v2[1] * v2[1]);
    
    // Skip points that create very short segments (likely artifacts)
    if (dist1 < 0.1 || dist2 < 0.1) {
      continue;
    }
    
    // Calculate angle between vectors
    const dot = v1[0] * v2[0] + v1[1] * v2[1];
    const cross = v1[0] * v2[1] - v1[1] * v2[0];
    const angle = Math.atan2(cross, dot);
    
    // Skip points that create very sharp turns (likely self-intersections)
    if (Math.abs(angle) > Math.PI * 0.9) { // More than 162 degrees
      continue;
    }
    
    cleaned.push(curr);
  }
  
  // Ensure we have at least 3 points for a valid polygon
  return cleaned.length >= 3 ? cleaned : polygon;
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
