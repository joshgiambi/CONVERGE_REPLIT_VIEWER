// Utility functions to convert brush strokes to polygons for radiotherapy contouring

interface Point3D {
  x: number;
  y: number;
  z: number;
}

/**
 * Convert brush stroke points to a polygon contour
 * Uses a convex hull approach for cleaner medical imaging contours
 */
export function brushStrokeToPolygon(
  brushPoints: number[][],
  brushSize: number
): number[] {
  if (brushPoints.length === 0) {
    return [];
  }
  
  // Adjust brush size to match visual preview
  const adjustedBrushSize = brushSize * 0.9;
  
  // Generate circle points around each brush stroke point
  const allPoints: Point3D[] = [];
  const circleSegments = 8; // Fewer segments for smoother result
  
  for (const point of brushPoints) {
    // Add circle points around this brush point
    for (let i = 0; i < circleSegments; i++) {
      const angle = (i / circleSegments) * 2 * Math.PI;
      allPoints.push({
        x: point[0] + adjustedBrushSize * Math.cos(angle),
        y: point[1] + adjustedBrushSize * Math.sin(angle),
        z: point[2]
      });
    }
  }
  
  // If we have very few points, just return a simple polygon
  if (brushPoints.length <= 2) {
    return computeConvexHull(allPoints);
  }

  // Create outline using alpha shape approach
  return createAlphaShape(allPoints, adjustedBrushSize * 2.5);
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