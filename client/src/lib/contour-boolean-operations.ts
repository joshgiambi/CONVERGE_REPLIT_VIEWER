/**
 * Simple/naive boolean operations for medical imaging contours
 * DEPRECATED: Use clipper-boolean-operations.ts for robust operations
 * Kept only for fallback/testing purposes
 */

interface Point2D {
  x: number;
  y: number;
}

/**
 * Combine two contours using union operation
 * @param contour1 - First contour as flat array [x, y, z, ...]
 * @param contour2 - Second contour as flat array [x, y, z, ...]
 * @returns Combined contour as flat array
 */
export function naiveCombineContours(contour1: number[], contour2: number[]): number[] {
  if (!contour1 || contour1.length < 9) return contour2;
  if (!contour2 || contour2.length < 9) return contour1;
  
  // For now, implement a simple approach:
  // Find the convex hull of all points from both contours
  const points1 = flatArrayToPoints(contour1);
  const points2 = flatArrayToPoints(contour2);
  const allPoints = [...points1, ...points2];
  
  // Calculate convex hull of combined points
  const hull = computeConvexHull(allPoints);
  
  // Convert back to flat array
  const zValue = contour1[2]; // Use z from first contour
  return pointsToFlatArray(hull, zValue);
}

/**
 * Subtract one contour from another
 * @param contour1 - Base contour as flat array [x, y, z, ...]
 * @param contour2 - Contour to subtract as flat array [x, y, z, ...]
 * @returns Result contour as flat array
 */
export function naiveSubtractContours(contour1: number[], contour2: number[]): number[] {
  if (!contour1 || contour1.length < 9) return [];
  if (!contour2 || contour2.length < 9) return contour1;
  
  // Convert to points
  const points1 = flatArrayToPoints(contour1);
  const points2 = flatArrayToPoints(contour2);
  
  // Simple implementation: Remove points from contour1 that are inside contour2
  const resultPoints: Point2D[] = [];
  
  for (const point of points1) {
    if (!isPointInPolygon(point, points2)) {
      resultPoints.push(point);
    }
  }
  
  // If too few points remain, return empty
  if (resultPoints.length < 3) return [];
  
  // Rebuild a valid polygon from remaining points
  const hull = computeConvexHull(resultPoints);
  
  const zValue = contour1[2];
  return pointsToFlatArray(hull, zValue);
}

/**
 * Convert flat array to points
 */
function flatArrayToPoints(flatArray: number[]): Point2D[] {
  const points: Point2D[] = [];
  for (let i = 0; i < flatArray.length; i += 3) {
    points.push({
      x: flatArray[i],
      y: flatArray[i + 1]
    });
  }
  return points;
}

/**
 * Convert points to flat array
 */
function pointsToFlatArray(points: Point2D[], z: number): number[] {
  const result: number[] = [];
  for (const point of points) {
    result.push(point.x, point.y, z);
  }
  return result;
}

/**
 * Check if a point is inside a polygon using ray casting algorithm
 */
function isPointInPolygon(point: Point2D, polygon: Point2D[]): boolean {
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

/**
 * Compute convex hull using Graham scan algorithm
 */
function computeConvexHull(points: Point2D[]): Point2D[] {
  if (points.length < 3) return points;
  
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
  const hull: Point2D[] = [points[0], sorted[0]];
  
  for (let i = 1; i < sorted.length; i++) {
    // Remove points that make a right turn
    while (hull.length > 1 && !isLeftTurn(hull[hull.length - 2], hull[hull.length - 1], sorted[i])) {
      hull.pop();
    }
    hull.push(sorted[i]);
  }
  
  return hull;
}

/**
 * Check if three points make a left turn
 */
function isLeftTurn(p1: Point2D, p2: Point2D, p3: Point2D): boolean {
  const cross = (p2.x - p1.x) * (p3.y - p1.y) - (p2.y - p1.y) * (p3.x - p1.x);
  return cross > 0;
}

/**
 * Get bounding box of contour
 * Useful for optimization and visualization
 */
export function getContourBounds(contour: number[]): { minX: number; maxX: number; minY: number; maxY: number } {
  if (!contour || contour.length < 3) {
    return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  }
  
  let minX = contour[0];
  let maxX = contour[0];
  let minY = contour[1];
  let maxY = contour[1];
  
  for (let i = 0; i < contour.length; i += 3) {
    minX = Math.min(minX, contour[i]);
    maxX = Math.max(maxX, contour[i]);
    minY = Math.min(minY, contour[i + 1]);
    maxY = Math.max(maxY, contour[i + 1]);
  }
  
  return { minX, maxX, minY, maxY };
}