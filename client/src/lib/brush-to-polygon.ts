// Utility functions to convert brush strokes to polygons for radiotherapy contouring
import { polygonUnion } from './polygon-union';

interface Point3D {
  x: number;
  y: number;
  z: number;
}

/**
 * Create a perfect circle polygon at the given center with exact radius
 * Following Eclipse TPS and 3D Slicer specifications
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
 * Convert brush stroke points to a merged polygon
 * This implements the Eclipse TPS and 3D Slicer brush tool behavior:
 * - Each brush position creates a perfect circle
 * - Overlapping circles merge seamlessly with no interior boundaries
 */
export function brushStrokeToPolygon(
  brushPoints: number[][],
  brushSize: number
): number[] {
  if (brushPoints.length === 0) {
    return [];
  }
  
  // Create circles for each brush point
  const circles: number[][] = [];
  
  for (const point of brushPoints) {
    const circle = createPerfectCircle(point, brushSize);
    circles.push(circle);
  }
  
  // Union all circles together to create seamless boundary
  return polygonUnion(circles);
}

/**
 * Compute convex hull of 2D points using Graham scan algorithm
 */
function computeConvexHull2D(points: Array<{x: number, y: number}>): Array<{x: number, y: number}> {
  if (points.length < 3) return points;
  
  // Find the bottom-most point (and left-most if tied)
  let start = points[0];
  for (let i = 1; i < points.length; i++) {
    if (points[i].y < start.y || (points[i].y === start.y && points[i].x < start.x)) {
      start = points[i];
    }
  }
  
  // Sort points by polar angle with respect to start point
  const sorted = points.filter(p => p !== start).sort((a, b) => {
    const angleA = Math.atan2(a.y - start.y, a.x - start.x);
    const angleB = Math.atan2(b.y - start.y, b.x - start.x);
    if (angleA !== angleB) return angleA - angleB;
    
    // If angles are equal, sort by distance
    const distA = Math.hypot(a.x - start.x, a.y - start.y);
    const distB = Math.hypot(b.x - start.x, b.y - start.y);
    return distA - distB;
  });
  
  // Build the hull
  const hull = [start];
  
  for (const point of sorted) {
    // Remove points that make a right turn
    while (hull.length > 1) {
      const p1 = hull[hull.length - 2];
      const p2 = hull[hull.length - 1];
      const cross = (p2.x - p1.x) * (point.y - p1.y) - (p2.y - p1.y) * (point.x - p1.x);
      if (cross > 0) break; // Left turn, keep the point
      hull.pop(); // Right turn or collinear, remove the point
    }
    hull.push(point);
  }
  
  return hull;
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
  
  // Use proper polygon union to merge the contours
  // This creates seamless boundaries with no interior lines
  // Following Eclipse TPS specification
  return polygonUnion([existingContour, brushPolygon]);
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