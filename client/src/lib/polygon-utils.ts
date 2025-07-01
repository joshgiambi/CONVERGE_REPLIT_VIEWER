// Simple polygon utilities for medical imaging contour editing
// Used as fallback when ClipperLib is loading or as backup implementation

export interface Point {
  x: number;
  y: number;
}

/**
 * Simple point-in-polygon test using ray casting algorithm
 * @param point Point to test
 * @param polygon Array of polygon vertices
 * @returns true if point is inside polygon
 */
export function pointInPolygon(point: Point, polygon: Point[]): boolean {
  if (polygon.length < 3) return false;
  
  let inside = false;
  
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    
    if (((yi > point.y) !== (yj > point.y)) &&
        (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  
  return inside;
}

/**
 * Create a circular polygon approximation for brush strokes
 * @param center Center point
 * @param radius Radius in pixels
 * @param segments Number of segments (default 32 for medical grade)
 * @returns Array of points forming a circle
 */
export function createCirclePolygon(center: Point, radius: number, segments = 32): Point[] {
  const points: Point[] = [];
  
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    points.push({
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius
    });
  }
  
  // Close the polygon
  points.push(points[0]);
  
  return points;
}

/**
 * Simple polygon union operation for basic brush strokes
 * @param polygons Array of polygons to union
 * @returns Combined polygon (simplified approach)
 */
export function simplePolygonUnion(polygons: Point[][]): Point[][] {
  // For now, return the largest polygon as a fallback
  // This is a simplified approach while ClipperLib loads
  if (polygons.length === 0) return [];
  if (polygons.length === 1) return polygons;
  
  // Find polygon with most points (likely the largest)
  let largestPolygon = polygons[0];
  let maxPoints = largestPolygon.length;
  
  for (const polygon of polygons) {
    if (polygon.length > maxPoints) {
      largestPolygon = polygon;
      maxPoints = polygon.length;
    }
  }
  
  return [largestPolygon];
}

/**
 * Convert polygon points to DICOM contour format
 * @param polygon Array of 2D points
 * @param zPosition Z coordinate for all points
 * @returns Flat array of [x,y,z,x,y,z,...] coordinates
 */
export function polygonToDicomPoints(polygon: Point[], zPosition: number): number[] {
  const points: number[] = [];
  
  for (const point of polygon) {
    points.push(point.x, point.y, zPosition);
  }
  
  return points;
}

/**
 * Convert DICOM contour points to polygon format
 * @param points Flat array of [x,y,z,x,y,z,...] coordinates
 * @returns Array of 2D points
 */
export function dicomPointsToPolygon(points: number[]): Point[] {
  const polygon: Point[] = [];
  
  for (let i = 0; i < points.length; i += 3) {
    polygon.push({
      x: points[i],
      y: points[i + 1]
      // z coordinate (points[i + 2]) is ignored for 2D polygon
    });
  }
  
  return polygon;
}