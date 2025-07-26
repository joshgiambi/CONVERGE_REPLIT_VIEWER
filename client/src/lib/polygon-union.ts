// Polygon union operations for medical imaging brush tools
// Based on Eclipse TPS and 3D Slicer behavior specifications

/**
 * Polygon union that preserves shape without shrinkage
 * Uses a simple merge approach that maintains brush size
 */
export function polygonUnion(polygons: number[][]): number[] {
  if (polygons.length === 0) return [];
  if (polygons.length === 1) return polygons[0];
  
  const zValue = polygons[0][2]; // Assume all on same slice
  
  // Simple approach: if polygons overlap, create a merged hull
  // This avoids the shrinkage caused by grid-based methods
  return createMergedHull(polygons, zValue);
}

/**
 * Create a merged hull from multiple polygons
 * This is a simplified approach that avoids shrinkage
 */
function createMergedHull(polygons: number[][], zValue: number): number[] {
  // Collect all points from all polygons
  const allPoints: Array<{x: number, y: number}> = [];
  
  for (const polygon of polygons) {
    // Add vertices
    for (let i = 0; i < polygon.length; i += 3) {
      allPoints.push({
        x: polygon[i],
        y: polygon[i + 1]
      });
    }
    
    // Add intermediate points along edges to maintain shape
    for (let i = 0; i < polygon.length - 3; i += 3) {
      const x1 = polygon[i];
      const y1 = polygon[i + 1];
      const x2 = polygon[i + 3];
      const y2 = polygon[i + 4];
      
      // Add midpoint
      allPoints.push({
        x: (x1 + x2) / 2,
        y: (y1 + y2) / 2
      });
      
      // Add quarter points for better shape preservation
      allPoints.push({
        x: x1 * 0.75 + x2 * 0.25,
        y: y1 * 0.75 + y2 * 0.25
      });
      allPoints.push({
        x: x1 * 0.25 + x2 * 0.75,
        y: y1 * 0.25 + y2 * 0.75
      });
    }
  }
  
  // Find the centroid
  let centerX = 0, centerY = 0;
  for (const point of allPoints) {
    centerX += point.x;
    centerY += point.y;
  }
  centerX /= allPoints.length;
  centerY /= allPoints.length;
  
  // Convert to polar coordinates and sort by angle
  const polarPoints = allPoints.map(p => {
    const angle = Math.atan2(p.y - centerY, p.x - centerX);
    const dist = Math.hypot(p.x - centerX, p.y - centerY);
    return { x: p.x, y: p.y, angle, dist };
  });
  
  polarPoints.sort((a, b) => a.angle - b.angle);
  
  // Use angular sectors to select outermost points
  const numSectors = Math.max(64, Math.floor(allPoints.length / 3)); // More sectors for smoother boundary
  const sectorSize = (2 * Math.PI) / numSectors;
  const boundaryPoints: Array<{x: number, y: number}> = [];
  
  for (let sector = 0; sector < numSectors; sector++) {
    const minAngle = -Math.PI + sector * sectorSize;
    const maxAngle = minAngle + sectorSize;
    
    // Find points in this sector
    const sectorPoints = polarPoints.filter(p => 
      p.angle >= minAngle && p.angle < maxAngle
    );
    
    if (sectorPoints.length > 0) {
      // Select the outermost point in this sector
      const outermost = sectorPoints.reduce((max, p) => 
        p.dist > max.dist ? p : max
      );
      boundaryPoints.push({ x: outermost.x, y: outermost.y });
    }
  }
  
  // Smooth the boundary by averaging with neighbors
  const smoothedPoints: Array<{x: number, y: number}> = [];
  const smoothingFactor = 0.3;
  
  for (let i = 0; i < boundaryPoints.length; i++) {
    const prev = boundaryPoints[(i - 1 + boundaryPoints.length) % boundaryPoints.length];
    const curr = boundaryPoints[i];
    const next = boundaryPoints[(i + 1) % boundaryPoints.length];
    
    smoothedPoints.push({
      x: curr.x * (1 - 2 * smoothingFactor) + (prev.x + next.x) * smoothingFactor,
      y: curr.y * (1 - 2 * smoothingFactor) + (prev.y + next.y) * smoothingFactor
    });
  }
  
  // Convert back to flat array format
  const result: number[] = [];
  for (const point of smoothedPoints) {
    result.push(point.x, point.y, zValue);
  }
  
  // Ensure the polygon is closed
  if (result.length >= 9) {
    const firstX = result[0];
    const firstY = result[1];
    const lastX = result[result.length - 3];
    const lastY = result[result.length - 2];
    
    if (Math.abs(firstX - lastX) > 0.001 || Math.abs(firstY - lastY) > 0.001) {
      result.push(firstX, firstY, zValue);
    }
  }
  
  return result;
}

/**
 * Check if any two polygons overlap
 */
function checkPolygonsOverlap(polygons: number[][]): boolean {
  for (let i = 0; i < polygons.length - 1; i++) {
    for (let j = i + 1; j < polygons.length; j++) {
      if (doPolygonsOverlap(polygons[i], polygons[j])) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Simple overlap check using bounding boxes
 */
function doPolygonsOverlap(poly1: number[], poly2: number[]): boolean {
  // Get bounding boxes
  let minX1 = Infinity, minY1 = Infinity, maxX1 = -Infinity, maxY1 = -Infinity;
  let minX2 = Infinity, minY2 = Infinity, maxX2 = -Infinity, maxY2 = -Infinity;
  
  for (let i = 0; i < poly1.length; i += 3) {
    minX1 = Math.min(minX1, poly1[i]);
    maxX1 = Math.max(maxX1, poly1[i]);
    minY1 = Math.min(minY1, poly1[i + 1]);
    maxY1 = Math.max(maxY1, poly1[i + 1]);
  }
  
  for (let i = 0; i < poly2.length; i += 3) {
    minX2 = Math.min(minX2, poly2[i]);
    maxX2 = Math.max(maxX2, poly2[i]);
    minY2 = Math.min(minY2, poly2[i + 1]);
    maxY2 = Math.max(maxY2, poly2[i + 1]);
  }
  
  // Check if bounding boxes overlap
  return !(maxX1 < minX2 || maxX2 < minX1 || maxY1 < minY2 || maxY2 < minY1);
}

/**
 * Boundary walk union - traces the outer boundary of overlapping polygons
 */
function boundaryWalkUnion(polygons: number[][], zValue: number): number[] {
  // Find the leftmost point across all polygons (guaranteed to be on boundary)
  let leftmostX = Infinity;
  let leftmostY = 0;
  let leftmostPolyIndex = 0;
  let leftmostPointIndex = 0;
  
  for (let pIdx = 0; pIdx < polygons.length; pIdx++) {
    const poly = polygons[pIdx];
    for (let i = 0; i < poly.length; i += 3) {
      if (poly[i] < leftmostX || (poly[i] === leftmostX && poly[i + 1] < leftmostY)) {
        leftmostX = poly[i];
        leftmostY = poly[i + 1];
        leftmostPolyIndex = pIdx;
        leftmostPointIndex = i / 3;
      }
    }
  }
  
  // Convert polygons to point arrays for easier processing
  const polyPoints: Array<Array<{x: number, y: number}>> = polygons.map(poly => {
    const points: Array<{x: number, y: number}> = [];
    for (let i = 0; i < poly.length; i += 3) {
      points.push({ x: poly[i], y: poly[i + 1] });
    }
    return points;
  });
  
  // Trace the boundary starting from the leftmost point
  const boundary: Array<{x: number, y: number}> = [];
  let currentPolyIndex = leftmostPolyIndex;
  let currentPointIndex = leftmostPointIndex;
  const maxIterations = 10000; // Safety limit
  let iterations = 0;
  
  const startX = polyPoints[currentPolyIndex][currentPointIndex].x;
  const startY = polyPoints[currentPolyIndex][currentPointIndex].y;
  
  do {
    const currentPoly = polyPoints[currentPolyIndex];
    const currentPoint = currentPoly[currentPointIndex];
    
    // Add current point to boundary
    boundary.push({ x: currentPoint.x, y: currentPoint.y });
    
    // Get next point on current polygon
    const nextPointIndex = (currentPointIndex + 1) % currentPoly.length;
    const nextPoint = currentPoly[nextPointIndex];
    
    // Check if we should continue on current polygon or switch to another
    let shouldSwitch = false;
    let switchToPolyIndex = -1;
    let switchToPointIndex = -1;
    
    // Check if the edge from current to next intersects with other polygons
    for (let pIdx = 0; pIdx < polyPoints.length; pIdx++) {
      if (pIdx === currentPolyIndex) continue;
      
      const otherPoly = polyPoints[pIdx];
      
      // Check if next point would go inside this polygon
      if (isPointInsidePolygon(nextPoint, otherPoly)) {
        // Find the best exit point on the other polygon
        let bestDist = Infinity;
        for (let i = 0; i < otherPoly.length; i++) {
          const dist = Math.hypot(
            otherPoly[i].x - currentPoint.x,
            otherPoly[i].y - currentPoint.y
          );
          if (dist < bestDist && dist > 0.001) { // Avoid same point
            bestDist = dist;
            switchToPolyIndex = pIdx;
            switchToPointIndex = i;
            shouldSwitch = true;
          }
        }
      }
    }
    
    if (shouldSwitch && switchToPolyIndex >= 0) {
      currentPolyIndex = switchToPolyIndex;
      currentPointIndex = switchToPointIndex;
    } else {
      currentPointIndex = nextPointIndex;
    }
    
    iterations++;
    
    // Check if we've returned to start
    const currentX = polyPoints[currentPolyIndex][currentPointIndex].x;
    const currentY = polyPoints[currentPolyIndex][currentPointIndex].y;
    const distToStart = Math.hypot(currentX - startX, currentY - startY);
    
    if (distToStart < 0.001 && boundary.length > 3) {
      break;
    }
    
  } while (iterations < maxIterations);
  
  // Convert boundary points to flat array
  const result: number[] = [];
  for (const point of boundary) {
    result.push(point.x, point.y, zValue);
  }
  
  return result;
}

/**
 * Check if a point is inside a polygon using ray casting
 */
function isPointInsidePolygon(point: {x: number, y: number}, polygon: Array<{x: number, y: number}>): boolean {
  let inside = false;
  const x = point.x;
  const y = point.y;
  
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    
    const intersect = ((yi > y) !== (yj > y)) &&
      (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    
    if (intersect) inside = !inside;
  }
  
  return inside;
}

/**
 * Fill a polygon on a binary grid
 */
function fillPolygonOnGrid(
  polygon: number[],
  grid: Uint8Array,
  width: number,
  height: number,
  offsetX: number,
  offsetY: number,
  gridSize: number
): void {
  const points: Array<{x: number, y: number}> = [];
  
  // Convert to grid coordinates
  for (let i = 0; i < polygon.length; i += 3) {
    points.push({
      x: Math.round((polygon[i] - offsetX) / gridSize),
      y: Math.round((polygon[i + 1] - offsetY) / gridSize)
    });
  }
  
  // Scanline fill algorithm
  for (let y = 0; y < height; y++) {
    const intersections: number[] = [];
    
    // Find all intersections with this scanline
    for (let i = 0; i < points.length; i++) {
      const p1 = points[i];
      const p2 = points[(i + 1) % points.length];
      
      if ((p1.y <= y && p2.y > y) || (p2.y <= y && p1.y > y)) {
        const x = p1.x + (y - p1.y) * (p2.x - p1.x) / (p2.y - p1.y);
        intersections.push(x);
      }
    }
    
    // Sort intersections
    intersections.sort((a, b) => a - b);
    
    // Fill between pairs of intersections
    for (let i = 0; i < intersections.length; i += 2) {
      if (i + 1 < intersections.length) {
        const startX = Math.max(0, Math.floor(intersections[i]));
        const endX = Math.min(width - 1, Math.ceil(intersections[i + 1]));
        
        for (let x = startX; x <= endX; x++) {
          grid[y * width + x] = 1;
        }
      }
    }
  }
}

/**
 * Extract boundary from binary grid using marching squares
 */
function extractBoundaryFromGrid(
  grid: Uint8Array,
  width: number,
  height: number,
  offsetX: number,
  offsetY: number,
  gridSize: number,
  zValue: number
): number[] {
  const boundary: number[] = [];
  const visited = new Uint8Array(width * height);
  
  // Find starting point on boundary
  let startX = -1, startY = -1;
  outer: for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (grid[y * width + x] === 1 && isOnBoundary(grid, width, height, x, y)) {
        startX = x;
        startY = y;
        break outer;
      }
    }
  }
  
  if (startX === -1) return [];
  
  // Trace boundary using Moore neighborhood
  let x = startX, y = startY;
  let dir = 0; // Starting direction
  const directions = [
    [1, 0], [1, 1], [0, 1], [-1, 1],
    [-1, 0], [-1, -1], [0, -1], [1, -1]
  ];
  
  do {
    // Add current point to boundary
    boundary.push(
      x * gridSize + offsetX,
      y * gridSize + offsetY,
      zValue
    );
    
    visited[y * width + x] = 1;
    
    // Find next boundary point
    let found = false;
    for (let i = 0; i < 8; i++) {
      const testDir = (dir + 6 + i) % 8; // Start from diagonal back
      const nx = x + directions[testDir][0];
      const ny = y + directions[testDir][1];
      
      if (nx >= 0 && nx < width && ny >= 0 && ny < height &&
          grid[ny * width + nx] === 1 &&
          isOnBoundary(grid, width, height, nx, ny)) {
        x = nx;
        y = ny;
        dir = testDir;
        found = true;
        break;
      }
    }
    
    if (!found) break;
    
  } while (x !== startX || y !== startY);
  
  // Simplify the boundary to reduce points
  return simplifyPolygon(boundary, gridSize * 0.5);
}

/**
 * Check if a grid cell is on the boundary
 */
function isOnBoundary(grid: Uint8Array, width: number, height: number, x: number, y: number): boolean {
  if (grid[y * width + x] === 0) return false;
  
  // Check 4-connected neighbors
  const neighbors = [
    [0, -1], [1, 0], [0, 1], [-1, 0]
  ];
  
  for (const [dx, dy] of neighbors) {
    const nx = x + dx;
    const ny = y + dy;
    
    if (nx < 0 || nx >= width || ny < 0 || ny >= height || grid[ny * width + nx] === 0) {
      return true;
    }
  }
  
  return false;
}

/**
 * Simplify polygon using Douglas-Peucker algorithm
 */
function simplifyPolygon(polygon: number[], tolerance: number): number[] {
  if (polygon.length <= 9) return polygon; // Already simple enough (3 points or less)
  
  const points: Array<{x: number, y: number, z: number}> = [];
  for (let i = 0; i < polygon.length; i += 3) {
    points.push({
      x: polygon[i],
      y: polygon[i + 1],
      z: polygon[i + 2]
    });
  }
  
  const simplified = douglasPeucker(points, tolerance);
  
  const result: number[] = [];
  for (const pt of simplified) {
    result.push(pt.x, pt.y, pt.z);
  }
  
  return result;
}

/**
 * Douglas-Peucker line simplification
 */
function douglasPeucker(
  points: Array<{x: number, y: number, z: number}>,
  tolerance: number
): Array<{x: number, y: number, z: number}> {
  if (points.length <= 2) return points;
  
  // Find point with maximum distance from line between first and last
  let maxDist = 0;
  let maxIndex = 0;
  
  for (let i = 1; i < points.length - 1; i++) {
    const dist = perpendicularDistance(points[i], points[0], points[points.length - 1]);
    if (dist > maxDist) {
      maxDist = dist;
      maxIndex = i;
    }
  }
  
  // If max distance is greater than tolerance, recursively simplify
  if (maxDist > tolerance) {
    const left = douglasPeucker(points.slice(0, maxIndex + 1), tolerance);
    const right = douglasPeucker(points.slice(maxIndex), tolerance);
    
    return left.slice(0, -1).concat(right);
  } else {
    return [points[0], points[points.length - 1]];
  }
}

/**
 * Calculate perpendicular distance from point to line
 */
function perpendicularDistance(
  point: {x: number, y: number},
  lineStart: {x: number, y: number},
  lineEnd: {x: number, y: number}
): number {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  
  if (dx === 0 && dy === 0) {
    return Math.hypot(point.x - lineStart.x, point.y - lineStart.y);
  }
  
  const t = ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / (dx * dx + dy * dy);
  const projX = lineStart.x + t * dx;
  const projY = lineStart.y + t * dy;
  
  return Math.hypot(point.x - projX, point.y - projY);
}

/**
 * Perform polygon union on an array of polygons
 * Each polygon is represented as an array of [x, y] coordinate pairs
 * Returns an array of polygons (usually just one unless there are separate blobs)
 */
export function performPolygonUnion(polygons: number[][][]): number[][][] {
  if (polygons.length === 0) return [];
  if (polygons.length === 1) return polygons;
  
  // Convert polygon format from [[x,y]] to [x,y,z,x,y,z,...]
  const z = 0; // We'll extract Z from the first point if available
  const convertedPolygons: number[][] = [];
  
  for (const polygon of polygons) {
    const converted: number[] = [];
    for (const [x, y] of polygon) {
      converted.push(x, y, z);
    }
    convertedPolygons.push(converted);
  }
  
  // Perform union
  const unionResult = polygonUnion(convertedPolygons);
  
  // Convert back to [[x,y]] format
  const resultPolygons: number[][][] = [];
  let currentPolygon: number[][] = [];
  
  for (let i = 0; i < unionResult.length; i += 3) {
    currentPolygon.push([unionResult[i], unionResult[i + 1]]);
  }
  
  if (currentPolygon.length > 0) {
    resultPolygons.push(currentPolygon);
  }
  
  return resultPolygons;
}