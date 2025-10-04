// Polygon union operations for medical imaging brush tools
// Based on Eclipse TPS and 3D Slicer behavior specifications

/**
 * Simple polygon union using a grid-based approach
 * This creates the "paint bucket fill" effect for overlapping circles
 */
export function polygonUnion(polygons: number[][], brushRadiusInMm?: number): number[] {
  if (polygons.length === 0) return [];
  if (polygons.length === 1 && !brushRadiusInMm) return polygons[0];

  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;

  // If a brushRadiusInMm is provided, we are unioning circles from a brush stroke.
  // In this case, we can optimize the bounding box calculation.
  if (brushRadiusInMm) {
    for (const polygon of polygons) {
      // Since these are circles, we can calculate the bounding box from the center point.
      const centerX = polygon[0];
      const centerY = polygon[1];
      minX = Math.min(minX, centerX - brushRadiusInMm);
      maxX = Math.max(maxX, centerX + brushRadiusInMm);
      minY = Math.min(minY, centerY - brushRadiusInMm);
      maxY = Math.max(maxY, centerY + brushRadiusInMm);
    }
  } else {
    // Find bounding box of all polygons
    for (const polygon of polygons) {
      for (let i = 0; i < polygon.length; i += 3) {
        minX = Math.min(minX, polygon[i]);
        maxX = Math.max(maxX, polygon[i]);
        minY = Math.min(minY, polygon[i + 1]);
        maxY = Math.max(maxY, polygon[i + 1]);
      }
    }
  }

  const zValue = polygons[0][2]; // Assume all on same slice
  
  // Create a grid for rasterization
  // Use adaptive grid size based on complexity: coarser for many polygons (faster), finer for few (more accurate)
  const gridSize = polygons.length > 20 ? 0.4 : 0.25; // mm resolution
  const width = Math.ceil((maxX - minX) / gridSize) + 2;
  const height = Math.ceil((maxY - minY) / gridSize) + 2;
  
  // Safety check to prevent excessive memory allocation
  const maxGridCells = 2000 * 2000; // 4 million cells max
  if (width * height > maxGridCells) {
    console.warn(`Grid too large (${width}x${height}), using coarser resolution`);
    const scaleFactor = Math.sqrt((width * height) / maxGridCells);
    const adjustedGridSize = gridSize * scaleFactor;
    const adjustedWidth = Math.ceil((maxX - minX) / adjustedGridSize) + 2;
    const adjustedHeight = Math.ceil((maxY - minY) / adjustedGridSize) + 2;
    const grid = new Uint8Array(adjustedWidth * adjustedHeight);
    for (const polygon of polygons) {
      fillPolygonOnGrid(polygon, grid, adjustedWidth, adjustedHeight, minX, minY, adjustedGridSize);
    }
    return extractBoundaryFromGrid(grid, adjustedWidth, adjustedHeight, minX, minY, adjustedGridSize, zValue);
  }
  
  const grid = new Uint8Array(width * height);
  
  // Rasterize all polygons onto the grid
  for (const polygon of polygons) {
    fillPolygonOnGrid(polygon, grid, width, height, minX, minY, gridSize);
  }
  
  // Extract the outer boundary from the grid
  const boundary = extractBoundaryFromGrid(grid, width, height, minX, minY, gridSize, zValue);
  
  return boundary;
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