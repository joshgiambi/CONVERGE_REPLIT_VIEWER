// Polygon utility functions extracted from routes.ts
export function polygonOverlaps(poly1: number[][], poly2: number[][]): boolean {
  // Check if any point of poly1 is inside poly2
  for (const point of poly1) {
    if (isPointInPolygon(point, poly2)) {
      return true;
    }
  }
  
  // Check if any point of poly2 is inside poly1
  for (const point of poly2) {
    if (isPointInPolygon(point, poly1)) {
      return true;
    }
  }
  
  // Check if any edges intersect
  for (let i = 0; i < poly1.length; i++) {
    const p1 = poly1[i];
    const p2 = poly1[(i + 1) % poly1.length];
    
    for (let j = 0; j < poly2.length; j++) {
      const p3 = poly2[j];
      const p4 = poly2[(j + 1) % poly2.length];
      
      if (lineSegmentsIntersect(p1, p2, p3, p4)) {
        return true;
      }
    }
  }
  
  return false;
}

export function isPointInPolygon(point: number[], polygon: number[][]): boolean {
  let inside = false;
  const x = point[0], y = point[1];
  
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1];
    const xj = polygon[j][0], yj = polygon[j][1];
    
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  
  return inside;
}

export function lineSegmentsIntersect(
  p1: number[], p2: number[], 
  p3: number[], p4: number[]
): boolean {
  const x1 = p1[0], y1 = p1[1];
  const x2 = p2[0], y2 = p2[1];
  const x3 = p3[0], y3 = p3[1];
  const x4 = p4[0], y4 = p4[1];
  
  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  
  if (Math.abs(denom) < 1e-10) {
    return false; // Lines are parallel
  }
  
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
  const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;
  
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

export function lineIntersectsPolygon(
  lineStart: number[], lineEnd: number[], 
  polygon: number[][]
): boolean {
  for (let i = 0; i < polygon.length; i++) {
    const segStart = polygon[i];
    const segEnd = polygon[(i + 1) % polygon.length];
    
    if (lineSegmentsIntersect(lineStart, lineEnd, segStart, segEnd)) {
      return true;
    }
  }
  
  return false;
}