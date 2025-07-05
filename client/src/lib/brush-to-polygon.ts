// Utility functions to convert brush strokes to polygons for radiotherapy contouring

interface Point3D {
  x: number;
  y: number;
  z: number;
}

/**
 * Create a perfect circle polygon at the given center with exact radius
 */
function createPerfectCircle(center: number[], radius: number): number[] {
  const circleSegments = 32; // More segments for smoother circles
  const points: number[] = [];
  
  for (let i = 0; i < circleSegments; i++) {
    const angle = (i / circleSegments) * 2 * Math.PI;
    points.push(
      center[0] + radius * Math.cos(angle),
      center[1] + radius * Math.sin(angle),
      center[2]
    );
  }
  
  return points;
}

/**
 * Convert brush stroke points to perfect circle polygons
 * Creates exact circles without overlapping borders
 */
export function brushStrokeToPolygon(
  brushPoints: number[][],
  brushSize: number
): number[] {
  if (brushPoints.length === 0) {
    return [];
  }
  
  // For a single point, create a perfect circle
  if (brushPoints.length === 1) {
    return createPerfectCircle(brushPoints[0], brushSize);
  }
  
  // Create a smooth capsule shape along the brush stroke
  const result: number[] = [];
  const zValue = brushPoints[0][2];
  
  // Create left and right edge points along the stroke
  const leftEdge: number[][] = [];
  const rightEdge: number[][] = [];
  
  for (let i = 0; i < brushPoints.length; i++) {
    const curr = brushPoints[i];
    
    // Calculate direction vector
    let dx = 0, dy = 0;
    
    if (i === 0 && brushPoints.length > 1) {
      // First point - use direction to next
      dx = brushPoints[1][0] - curr[0];
      dy = brushPoints[1][1] - curr[1];
    } else if (i === brushPoints.length - 1 && i > 0) {
      // Last point - use direction from previous
      dx = curr[0] - brushPoints[i-1][0];
      dy = curr[1] - brushPoints[i-1][1];
    } else if (i > 0 && i < brushPoints.length - 1) {
      // Middle points - average direction
      dx = brushPoints[i+1][0] - brushPoints[i-1][0];
      dy = brushPoints[i+1][1] - brushPoints[i-1][1];
    }
    
    // Normalize direction
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len > 0.001) {
      dx /= len;
      dy /= len;
    } else {
      // Default direction if points are too close
      dx = 1;
      dy = 0;
    }
    
    // Calculate perpendicular vector (normal)
    const nx = -dy;
    const ny = dx;
    
    // Add offset points on both sides
    leftEdge.push([
      curr[0] + nx * brushSize,
      curr[1] + ny * brushSize,
      zValue
    ]);
    
    rightEdge.push([
      curr[0] - nx * brushSize,
      curr[1] - ny * brushSize,
      zValue
    ]);
  }
  
  // Add semicircle cap at start
  const startCap = createSemicircle(
    brushPoints[0], 
    brushSize, 
    Math.atan2(rightEdge[0][1] - brushPoints[0][1], rightEdge[0][0] - brushPoints[0][0]),
    Math.PI
  );
  
  // Add semicircle cap at end
  const endCap = createSemicircle(
    brushPoints[brushPoints.length - 1],
    brushSize,
    Math.atan2(leftEdge[leftEdge.length - 1][1] - brushPoints[brushPoints.length - 1][1], 
               leftEdge[leftEdge.length - 1][0] - brushPoints[brushPoints.length - 1][0]),
    Math.PI
  );
  
  // Combine all points: start cap + left edge + end cap + right edge (reversed)
  for (const pt of startCap) {
    result.push(pt.x, pt.y, zValue);
  }
  
  for (const pt of leftEdge) {
    result.push(pt[0], pt[1], pt[2]);
  }
  
  for (const pt of endCap) {
    result.push(pt.x, pt.y, zValue);
  }
  
  // Add right edge in reverse order
  for (let i = rightEdge.length - 1; i >= 0; i--) {
    result.push(rightEdge[i][0], rightEdge[i][1], rightEdge[i][2]);
  }
  
  return result;
}

/**
 * Create a stroke outline from brush points
 * Creates a continuous polygon that naturally merges overlapping areas
 */
function createStrokeOutline(brushPoints: number[][], brushSize: number): number[] {
  if (brushPoints.length === 0) return [];
  
  // For a single point, just create a circle
  if (brushPoints.length === 1) {
    return createPerfectCircle(brushPoints[0], brushSize);
  }
  
  const zValue = brushPoints[0][2];
  
  // Create left and right edge points along the stroke
  const leftEdge: Array<{x: number, y: number}> = [];
  const rightEdge: Array<{x: number, y: number}> = [];
  
  for (let i = 0; i < brushPoints.length; i++) {
    const curr = brushPoints[i];
    
    // Calculate direction vector
    let dx = 0, dy = 0;
    
    if (i === 0) {
      // First point - use direction to next point
      if (brushPoints.length > 1) {
        dx = brushPoints[1][0] - curr[0];
        dy = brushPoints[1][1] - curr[1];
      }
    } else if (i === brushPoints.length - 1) {
      // Last point - use direction from previous point
      dx = curr[0] - brushPoints[i-1][0];
      dy = curr[1] - brushPoints[i-1][1];
    } else {
      // Middle points - average direction
      dx = brushPoints[i+1][0] - brushPoints[i-1][0];
      dy = brushPoints[i+1][1] - brushPoints[i-1][1];
    }
    
    // Normalize direction
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len > 0) {
      dx /= len;
      dy /= len;
    }
    
    // Calculate perpendicular vector (normal)
    const nx = -dy;
    const ny = dx;
    
    // Add offset points on both sides
    leftEdge.push({
      x: curr[0] + nx * brushSize,
      y: curr[1] + ny * brushSize
    });
    
    rightEdge.push({
      x: curr[0] - nx * brushSize,
      y: curr[1] - ny * brushSize
    });
  }
  
  // Add cap at start
  const startCap = createSemicircle(brushPoints[0], brushSize, Math.atan2(-rightEdge[0].y + brushPoints[0][1], -rightEdge[0].x + brushPoints[0][0]), Math.PI);
  
  // Add cap at end
  const endCap = createSemicircle(brushPoints[brushPoints.length-1], brushSize, Math.atan2(leftEdge[leftEdge.length-1].y - brushPoints[brushPoints.length-1][1], leftEdge[leftEdge.length-1].x - brushPoints[brushPoints.length-1][0]), Math.PI);
  
  // Combine all points into a single polygon
  const result: number[] = [];
  
  // Add start cap
  for (const point of startCap) {
    result.push(point.x, point.y, zValue);
  }
  
  // Add left edge
  for (const point of leftEdge) {
    result.push(point.x, point.y, zValue);
  }
  
  // Add end cap
  for (const point of endCap) {
    result.push(point.x, point.y, zValue);
  }
  
  // Add right edge (reversed)
  for (let i = rightEdge.length - 1; i >= 0; i--) {
    result.push(rightEdge[i].x, rightEdge[i].y, zValue);
  }
  
  return result;
}

/**
 * Create a semicircle for stroke caps
 */
function createSemicircle(center: number[], radius: number, startAngle: number, angleRange: number): Array<{x: number, y: number}> {
  const points: Array<{x: number, y: number}> = [];
  const segments = 16;
  
  for (let i = 0; i <= segments; i++) {
    const angle = startAngle + (i / segments) * angleRange;
    points.push({
      x: center[0] + radius * Math.cos(angle),
      y: center[1] + radius * Math.sin(angle)
    });
  }
  
  return points;
}

/**
 * Create an alpha shape (concave hull) from a set of points
 * This creates a more natural boundary around the brush stroke
 */
function createAlphaShape(points: Point3D[], alpha: number): number[] {
  if (points.length < 3) {
    // Not enough points for a polygon
    return [];
  }
  
  // For simplicity, compute a convex hull first
  // In production, you'd use a proper alpha shape algorithm
  return computeConvexHull(points);
}

/**
 * Compute convex hull of 2D points using Graham scan
 * Returns points as flat array [x1,y1,z1,x2,y2,z2,...]
 */
function computeConvexHull(points: Point3D[]): number[] {
  if (points.length < 3) return [];
  
  // Find the point with lowest y-coordinate (and leftmost if tied)
  let start = 0;
  for (let i = 1; i < points.length; i++) {
    if (points[i].y < points[start].y || 
        (points[i].y === points[start].y && points[i].x < points[start].x)) {
      start = i;
    }
  }
  
  // Swap start point to position 0
  [points[0], points[start]] = [points[start], points[0]];
  
  // Sort points by polar angle with respect to start point
  const sorted = points.slice(1).sort((a, b) => {
    const angleA = Math.atan2(a.y - points[0].y, a.x - points[0].x);
    const angleB = Math.atan2(b.y - points[0].y, b.x - points[0].x);
    if (angleA !== angleB) return angleA - angleB;
    // If angles are equal, sort by distance
    const distA = Math.pow(a.x - points[0].x, 2) + Math.pow(a.y - points[0].y, 2);
    const distB = Math.pow(b.x - points[0].x, 2) + Math.pow(b.y - points[0].y, 2);
    return distA - distB;
  });
  
  // Build convex hull using Graham scan
  const hull: Point3D[] = [points[0], sorted[0]];
  
  for (let i = 1; i < sorted.length; i++) {
    // Remove points that make a right turn
    while (hull.length > 1 && !isLeftTurn(hull[hull.length - 2], hull[hull.length - 1], sorted[i])) {
      hull.pop();
    }
    hull.push(sorted[i]);
  }
  
  // Convert hull points to flat array
  const result: number[] = [];
  for (const p of hull) {
    result.push(p.x, p.y, p.z);
  }
  
  return result;
}

/**
 * Check if three points make a left turn
 */
function isLeftTurn(p1: Point3D, p2: Point3D, p3: Point3D): boolean {
  const cross = (p2.x - p1.x) * (p3.y - p1.y) - (p2.y - p1.y) * (p3.x - p1.x);
  return cross > 0;
}



/**
 * Merge brush stroke with existing contour using polygon union
 * This would need a proper polygon library for production use
 */
export function mergeBrushWithContour(
  existingContour: number[],
  brushPolygon: number[]
): number[] {
  if (!existingContour || existingContour.length === 0) {
    return brushPolygon;
  }
  
  if (!brushPolygon || brushPolygon.length === 0) {
    return existingContour;
  }
  
  // For now, just return the brush polygon as the new contour
  // This will replace the existing contour with the new brush stroke
  // TODO: Implement proper polygon union when ClipperLib is properly configured
  console.log('Replacing contour with new brush stroke');
  return brushPolygon;
}

/**
 * Add brush stroke to contour using polygon expansion
 * This simulates "painting" on an existing contour
 */
export function addBrushToContour(
  existingContour: number[],
  brushPoints: number[][],
  brushSize: number
): number[] {
  // Convert brush stroke to polygon
  const brushPolygon = brushStrokeToPolygon(brushPoints, brushSize);
  
  if (brushPolygon.length === 0) {
    return existingContour;
  }
  
  // Merge with existing contour
  return mergeBrushWithContour(existingContour, brushPolygon);
}

/**
 * Erase brush stroke from contour using polygon subtraction
 * This would need a proper polygon library for production use
 */
export function eraseBrushFromContour(
  existingContour: number[],
  brushPoints: number[][],
  brushSize: number
): number[] {
  // TODO: Implement proper polygon subtraction
  console.warn('Polygon subtraction not yet implemented');
  return existingContour;
}