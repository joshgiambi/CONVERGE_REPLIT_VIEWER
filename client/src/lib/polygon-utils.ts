// Polygon utility functions for RT structure contour operations

/**
 * Convert RT structure contour points to polygon format
 */
export function contourToPolygon(points: number[]): [number, number][] {
  const polygon: [number, number][] = [];
  
  // Points are stored as [x1, y1, z1, x2, y2, z2, ...]
  for (let i = 0; i < points.length; i += 3) {
    polygon.push([points[i], points[i + 1]]);
  }
  
  return polygon;
}

/**
 * Convert polygon back to RT structure contour format
 */
export function polygonToContour(polygon: [number, number][], z: number = 0): number[] {
  const points: number[] = [];
  
  for (const [x, y] of polygon) {
    points.push(x, y, z);
  }
  
  return points;
}

/**
 * Calculate polygon area using shoelace formula
 */
export function calculatePolygonArea(vertices: [number, number][]): number {
  let area = 0;
  const n = vertices.length;
  
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += vertices[i][0] * vertices[j][1];
    area -= vertices[j][0] * vertices[i][1];
  }
  
  return Math.abs(area) / 2;
}

/**
 * Calculate polygon centroid
 */
export function calculatePolygonCentroid(vertices: [number, number][]): [number, number] {
  let cx = 0;
  let cy = 0;
  let area = 0;
  const n = vertices.length;
  
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const factor = vertices[i][0] * vertices[j][1] - vertices[j][0] * vertices[i][1];
    cx += (vertices[i][0] + vertices[j][0]) * factor;
    cy += (vertices[i][1] + vertices[j][1]) * factor;
    area += factor;
  }
  
  area *= 0.5;
  const centroid: [number, number] = [cx / (6 * area), cy / (6 * area)];
  
  return centroid;
}

/**
 * Check if polygon is clockwise
 */
export function isPolygonClockwise(vertices: [number, number][]): boolean {
  let sum = 0;
  const n = vertices.length;
  
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    sum += (vertices[j][0] - vertices[i][0]) * (vertices[j][1] + vertices[i][1]);
  }
  
  return sum > 0;
}

/**
 * Reverse polygon winding order
 */
export function reversePolygon(vertices: [number, number][]): [number, number][] {
  return vertices.slice().reverse();
}

/**
 * Simplify polygon using Douglas-Peucker algorithm
 */
export function simplifyPolygon(vertices: [number, number][], tolerance: number): [number, number][] {
  if (vertices.length <= 2) return vertices;
  
  // Find the point with maximum distance from line between start and end
  let maxDist = 0;
  let maxIndex = 0;
  const n = vertices.length;
  
  for (let i = 1; i < n - 1; i++) {
    const dist = perpendicularDistance(vertices[i], vertices[0], vertices[n - 1]);
    if (dist > maxDist) {
      maxDist = dist;
      maxIndex = i;
    }
  }
  
  // If max distance is greater than tolerance, recursively simplify
  if (maxDist > tolerance) {
    const left = simplifyPolygon(vertices.slice(0, maxIndex + 1), tolerance);
    const right = simplifyPolygon(vertices.slice(maxIndex), tolerance);
    
    // Combine results (removing duplicate point)
    return [...left.slice(0, -1), ...right];
  } else {
    // Return just the endpoints
    return [vertices[0], vertices[n - 1]];
  }
}

/**
 * Calculate perpendicular distance from point to line
 */
function perpendicularDistance(
  point: [number, number],
  lineStart: [number, number],
  lineEnd: [number, number]
): number {
  const dx = lineEnd[0] - lineStart[0];
  const dy = lineEnd[1] - lineStart[1];
  
  if (dx === 0 && dy === 0) {
    // Line start and end are the same
    return Math.sqrt((point[0] - lineStart[0]) ** 2 + (point[1] - lineStart[1]) ** 2);
  }
  
  const t = ((point[0] - lineStart[0]) * dx + (point[1] - lineStart[1]) * dy) / (dx * dx + dy * dy);
  
  let closestPoint: [number, number];
  if (t < 0) {
    closestPoint = lineStart;
  } else if (t > 1) {
    closestPoint = lineEnd;
  } else {
    closestPoint = [lineStart[0] + t * dx, lineStart[1] + t * dy];
  }
  
  return Math.sqrt((point[0] - closestPoint[0]) ** 2 + (point[1] - closestPoint[1]) ** 2);
}

/**
 * Find bounding box of polygon
 */
export function getPolygonBounds(vertices: [number, number][]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  if (vertices.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }
  
  let minX = vertices[0][0];
  let minY = vertices[0][1];
  let maxX = vertices[0][0];
  let maxY = vertices[0][1];
  
  for (const [x, y] of vertices) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  
  return { minX, minY, maxX, maxY };
}

/**
 * Check if two bounding boxes overlap
 */
export function boundingBoxesOverlap(
  bounds1: { minX: number; minY: number; maxX: number; maxY: number },
  bounds2: { minX: number; minY: number; maxX: number; maxY: number }
): boolean {
  return !(
    bounds1.maxX < bounds2.minX ||
    bounds2.maxX < bounds1.minX ||
    bounds1.maxY < bounds2.minY ||
    bounds2.maxY < bounds1.minY
  );
}

/**
 * Find intersection point of two line segments
 */
export function findLineIntersection(
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
  p4: [number, number]
): [number, number] | null {
  const x1 = p1[0], y1 = p1[1];
  const x2 = p2[0], y2 = p2[1];
  const x3 = p3[0], y3 = p3[1];
  const x4 = p4[0], y4 = p4[1];
  
  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  
  if (Math.abs(denom) < 1e-10) {
    // Lines are parallel
    return null;
  }
  
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
  const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;
  
  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
    // Intersection exists
    return [
      x1 + t * (x2 - x1),
      y1 + t * (y2 - y1)
    ];
  }
  
  return null;
}