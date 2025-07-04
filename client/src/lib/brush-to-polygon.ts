// Utility functions to convert brush strokes to polygons for radiotherapy contouring

interface Point3D {
  x: number;
  y: number;
  z: number;
}

/**
 * Convert brush stroke points to a polygon contour using a simplified convex hull approach
 * This is suitable for radiotherapy contouring where we need closed polygons
 */
export function brushStrokeToPolygon(
  brushPoints: number[][],
  brushSize: number
): number[] {
  if (brushPoints.length < 3) {
    console.warn('Not enough points to create a polygon');
    return [];
  }

  // Convert to Point3D format for easier manipulation
  const points: Point3D[] = brushPoints.map(p => ({
    x: p[0],
    y: p[1],
    z: p[2]
  }));

  // Generate outline points by creating a buffer around the stroke
  const outlinePoints: Point3D[] = [];
  
  // For each point in the stroke, generate circle points around it
  const circleSegments = 8; // Number of points around each brush center
  
  points.forEach((center, idx) => {
    // Calculate direction vector for this segment
    let direction = { x: 0, y: 1 }; // Default direction
    
    if (idx > 0 && idx < points.length - 1) {
      // Calculate tangent direction
      const prev = points[idx - 1];
      const next = points[idx + 1];
      const dx = next.x - prev.x;
      const dy = next.y - prev.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      
      if (len > 0) {
        // Perpendicular to the stroke direction
        direction = { x: -dy / len, y: dx / len };
      }
    }
    
    // Generate points on both sides of the stroke
    for (let side = -1; side <= 1; side += 2) {
      const angle = Math.atan2(direction.y, direction.x) + side * Math.PI / 2;
      const px = center.x + brushSize * Math.cos(angle);
      const py = center.y + brushSize * Math.sin(angle);
      outlinePoints.push({ x: px, y: py, z: center.z });
    }
  });

  // Simplify the outline using a basic convex hull algorithm
  const hull = computeConvexHull2D(outlinePoints);
  
  // Convert back to flattened array format (x,y,z,x,y,z,...)
  const result: number[] = [];
  hull.forEach(point => {
    result.push(point.x, point.y, point.z);
  });
  
  return result;
}

/**
 * Simple 2D convex hull using Graham scan algorithm
 * Projects 3D points to 2D for hull computation
 */
function computeConvexHull2D(points: Point3D[]): Point3D[] {
  if (points.length < 3) return points;

  // Find the starting point (lowest y, then leftmost x)
  let start = points[0];
  for (let i = 1; i < points.length; i++) {
    if (points[i].y < start.y || (points[i].y === start.y && points[i].x < start.x)) {
      start = points[i];
    }
  }

  // Sort points by polar angle with respect to start point
  const sorted = points.slice().sort((a, b) => {
    if (a === start) return -1;
    if (b === start) return 1;
    
    const angleA = Math.atan2(a.y - start.y, a.x - start.x);
    const angleB = Math.atan2(b.y - start.y, b.x - start.x);
    
    if (angleA !== angleB) return angleA - angleB;
    
    // If angles are equal, sort by distance
    const distA = Math.hypot(a.x - start.x, a.y - start.y);
    const distB = Math.hypot(b.x - start.x, b.y - start.y);
    return distA - distB;
  });

  // Build the hull
  const hull: Point3D[] = [];
  
  for (const point of sorted) {
    // Remove points that make a right turn
    while (hull.length >= 2 && !isLeftTurn(hull[hull.length - 2], hull[hull.length - 1], point)) {
      hull.pop();
    }
    hull.push(point);
  }
  
  return hull;
}

/**
 * Check if three points make a left turn (counter-clockwise)
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
  // For now, return the brush polygon as the new contour
  // In production, this would use a proper polygon union algorithm
  // like Clipper or similar computational geometry library
  
  if (!existingContour || existingContour.length === 0) {
    return brushPolygon;
  }
  
  // TODO: Implement proper polygon union
  console.warn('Polygon union not yet implemented - replacing contour with brush stroke');
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