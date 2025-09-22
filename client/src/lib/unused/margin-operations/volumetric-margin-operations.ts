/**
 * Volumetric (3D) margin operations for RT structures
 * Provides true 3D dilation/erosion instead of 2D slice-by-slice operations
 */

interface Point3D {
  x: number;
  y: number;
  z: number;
}

interface Contour3D {
  points: number[];
  slicePosition: number;
}

interface VoxelGrid {
  data: Uint8Array;
  dimensions: { x: number; y: number; z: number };
  origin: Point3D;
  spacing: Point3D;
}

/**
 * Apply a true 3D margin to a set of contours using volumetric morphological operations
 * @param contours - Array of contours with their slice positions
 * @param marginMm - Margin in millimeters (positive for expansion, negative for contraction)
 * @param pixelSpacing - Pixel spacing in mm [x, y, z]
 * @returns Modified contours with 3D margin applied
 */
export function apply3DMargin(
  contours: Contour3D[],
  marginMm: number,
  pixelSpacing: [number, number, number] = [1, 1, 2]
): Contour3D[] {
  console.log(`🔹 Applying 3D margin of ${marginMm}mm to ${contours.length} contours`);
  
  if (!contours || contours.length === 0) {
    return contours;
  }

  // Step 1: Convert contours to voxel grid
  const voxelGrid = contoursToVoxelGrid(contours, pixelSpacing);
  
  // Step 2: Apply 3D morphological operation
  const modifiedGrid = marginMm > 0 
    ? dilateVoxelGrid(voxelGrid, marginMm)
    : erodeVoxelGrid(voxelGrid, Math.abs(marginMm));
  
  // Step 3: Extract contours from modified voxel grid
  const newContours = voxelGridToContours(modifiedGrid, contours);
  
  console.log(`✅ Generated ${newContours.length} contours after 3D margin`);
  return newContours;
}

/**
 * Convert contours to a 3D voxel grid for volumetric processing
 */
function contoursToVoxelGrid(
  contours: Contour3D[],
  pixelSpacing: [number, number, number]
): VoxelGrid {
  // Find bounding box
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  
  for (const contour of contours) {
    for (let i = 0; i < contour.points.length; i += 3) {
      minX = Math.min(minX, contour.points[i]);
      maxX = Math.max(maxX, contour.points[i]);
      minY = Math.min(minY, contour.points[i + 1]);
      maxY = Math.max(maxY, contour.points[i + 1]);
    }
    minZ = Math.min(minZ, contour.slicePosition);
    maxZ = Math.max(maxZ, contour.slicePosition);
  }
  
  // Add padding for margin operations
  const padding = 50; // 50mm padding
  minX -= padding; maxX += padding;
  minY -= padding; maxY += padding;
  minZ -= padding; maxZ += padding;
  
  // Calculate grid dimensions
  const dimensions = {
    x: Math.ceil((maxX - minX) / pixelSpacing[0]),
    y: Math.ceil((maxY - minY) / pixelSpacing[1]),
    z: Math.ceil((maxZ - minZ) / pixelSpacing[2])
  };
  
  const origin = { x: minX, y: minY, z: minZ };
  const spacing = { x: pixelSpacing[0], y: pixelSpacing[1], z: pixelSpacing[2] };
  
  // Initialize voxel grid
  const gridSize = dimensions.x * dimensions.y * dimensions.z;
  const data = new Uint8Array(gridSize);
  
  console.log(`🔹 Created voxel grid: ${dimensions.x}×${dimensions.y}×${dimensions.z}`);
  
  // Rasterize contours into voxel grid
  for (const contour of contours) {
    rasterizeContourToGrid(contour, data, dimensions, origin, spacing);
  }
  
  // Fill interior voxels between contours
  fillInteriorVoxels(data, dimensions);
  
  return { data, dimensions, origin, spacing };
}

/**
 * Rasterize a single contour into the voxel grid
 */
function rasterizeContourToGrid(
  contour: Contour3D,
  data: Uint8Array,
  dimensions: { x: number; y: number; z: number },
  origin: Point3D,
  spacing: Point3D
): void {
  const z = Math.round((contour.slicePosition - origin.z) / spacing.z);
  if (z < 0 || z >= dimensions.z) return;
  
  // Convert contour to polygon
  const polygon: [number, number][] = [];
  for (let i = 0; i < contour.points.length; i += 3) {
    const x = (contour.points[i] - origin.x) / spacing.x;
    const y = (contour.points[i + 1] - origin.y) / spacing.y;
    polygon.push([x, y]);
  }
  
  // Fill polygon using scanline algorithm
  const minY = Math.floor(Math.min(...polygon.map(p => p[1])));
  const maxY = Math.ceil(Math.max(...polygon.map(p => p[1])));
  
  for (let y = minY; y <= maxY; y++) {
    const intersections: number[] = [];
    
    // Find intersections with scanline
    for (let i = 0; i < polygon.length; i++) {
      const p1 = polygon[i];
      const p2 = polygon[(i + 1) % polygon.length];
      
      if ((p1[1] <= y && p2[1] > y) || (p2[1] <= y && p1[1] > y)) {
        const x = p1[0] + (y - p1[1]) * (p2[0] - p1[0]) / (p2[1] - p1[1]);
        intersections.push(x);
      }
    }
    
    // Sort intersections and fill between pairs
    intersections.sort((a, b) => a - b);
    for (let i = 0; i < intersections.length - 1; i += 2) {
      const x1 = Math.floor(intersections[i]);
      const x2 = Math.ceil(intersections[i + 1]);
      
      for (let x = x1; x <= x2; x++) {
        if (x >= 0 && x < dimensions.x && y >= 0 && y < dimensions.y) {
          const index = x + y * dimensions.x + z * dimensions.x * dimensions.y;
          data[index] = 1;
        }
      }
    }
  }
}

/**
 * Fill interior voxels between contour slices using interpolation
 */
function fillInteriorVoxels(
  data: Uint8Array,
  dimensions: { x: number; y: number; z: number }
): void {
  // For each column (x,y), interpolate between filled slices
  for (let x = 0; x < dimensions.x; x++) {
    for (let y = 0; y < dimensions.y; y++) {
      let startZ = -1;
      let inStructure = false;
      
      for (let z = 0; z < dimensions.z; z++) {
        const index = x + y * dimensions.x + z * dimensions.x * dimensions.y;
        
        if (data[index] === 1) {
          if (!inStructure) {
            startZ = z;
            inStructure = true;
          }
        } else if (inStructure) {
          // Check if there's another filled voxel ahead
          let endZ = -1;
          for (let zz = z; zz < dimensions.z; zz++) {
            const idx = x + y * dimensions.x + zz * dimensions.x * dimensions.y;
            if (data[idx] === 1) {
              endZ = zz;
              break;
            }
          }
          
          // If found, interpolate between startZ and endZ
          if (endZ > 0 && endZ - startZ < 10) { // Max 10 slice gap for interpolation
            for (let zz = startZ + 1; zz < endZ; zz++) {
              const idx = x + y * dimensions.x + zz * dimensions.x * dimensions.y;
              data[idx] = 1;
            }
            z = endZ - 1; // Skip to endZ
          } else {
            inStructure = false;
          }
        }
      }
    }
  }
}

/**
 * Apply 3D dilation to voxel grid
 */
function dilateVoxelGrid(grid: VoxelGrid, marginMm: number): VoxelGrid {
  const { data, dimensions, origin, spacing } = grid;
  const newData = new Uint8Array(data.length);
  
  // Calculate kernel radius in voxels
  const radiusX = Math.ceil(marginMm / spacing.x);
  const radiusY = Math.ceil(marginMm / spacing.y);
  const radiusZ = Math.ceil(marginMm / spacing.z);
  
  console.log(`🔹 Dilating with radius: ${radiusX}×${radiusY}×${radiusZ} voxels`);
  
  // Apply spherical structuring element
  for (let z = 0; z < dimensions.z; z++) {
    for (let y = 0; y < dimensions.y; y++) {
      for (let x = 0; x < dimensions.x; x++) {
        const index = x + y * dimensions.x + z * dimensions.x * dimensions.y;
        
        // Check if any voxel within the structuring element is set
        let found = false;
        for (let dz = -radiusZ; dz <= radiusZ && !found; dz++) {
          for (let dy = -radiusY; dy <= radiusY && !found; dy++) {
            for (let dx = -radiusX; dx <= radiusX && !found; dx++) {
              const nx = x + dx;
              const ny = y + dy;
              const nz = z + dz;
              
              // Check if within bounds
              if (nx >= 0 && nx < dimensions.x &&
                  ny >= 0 && ny < dimensions.y &&
                  nz >= 0 && nz < dimensions.z) {
                
                // Check if within spherical radius
                const distMm = Math.sqrt(
                  (dx * spacing.x) ** 2 +
                  (dy * spacing.y) ** 2 +
                  (dz * spacing.z) ** 2
                );
                
                if (distMm <= marginMm) {
                  const nIndex = nx + ny * dimensions.x + nz * dimensions.x * dimensions.y;
                  if (data[nIndex] === 1) {
                    newData[index] = 1;
                    found = true;
                  }
                }
              }
            }
          }
        }
      }
    }
  }
  
  return { data: newData, dimensions, origin, spacing };
}

/**
 * Apply 3D erosion to voxel grid
 */
function erodeVoxelGrid(grid: VoxelGrid, marginMm: number): VoxelGrid {
  const { data, dimensions, origin, spacing } = grid;
  const newData = new Uint8Array(data.length);
  
  // Calculate kernel radius in voxels
  const radiusX = Math.ceil(marginMm / spacing.x);
  const radiusY = Math.ceil(marginMm / spacing.y);
  const radiusZ = Math.ceil(marginMm / spacing.z);
  
  console.log(`🔹 Eroding with radius: ${radiusX}×${radiusY}×${radiusZ} voxels`);
  
  // Apply spherical structuring element
  for (let z = 0; z < dimensions.z; z++) {
    for (let y = 0; y < dimensions.y; y++) {
      for (let x = 0; x < dimensions.x; x++) {
        const index = x + y * dimensions.x + z * dimensions.x * dimensions.y;
        
        if (data[index] === 0) continue;
        
        // Check if all voxels within the structuring element are set
        let allSet = true;
        for (let dz = -radiusZ; dz <= radiusZ && allSet; dz++) {
          for (let dy = -radiusY; dy <= radiusY && allSet; dy++) {
            for (let dx = -radiusX; dx <= radiusX && allSet; dx++) {
              const nx = x + dx;
              const ny = y + dy;
              const nz = z + dz;
              
              // Check if within spherical radius
              const distMm = Math.sqrt(
                (dx * spacing.x) ** 2 +
                (dy * spacing.y) ** 2 +
                (dz * spacing.z) ** 2
              );
              
              if (distMm <= marginMm) {
                // Check if within bounds
                if (nx < 0 || nx >= dimensions.x ||
                    ny < 0 || ny >= dimensions.y ||
                    nz < 0 || nz >= dimensions.z) {
                  allSet = false;
                } else {
                  const nIndex = nx + ny * dimensions.x + nz * dimensions.x * dimensions.y;
                  if (data[nIndex] === 0) {
                    allSet = false;
                  }
                }
              }
            }
          }
        }
        
        if (allSet) {
          newData[index] = 1;
        }
      }
    }
  }
  
  return { data: newData, dimensions, origin, spacing };
}

/**
 * Extract contours from voxel grid using marching squares on each slice
 */
function voxelGridToContours(
  grid: VoxelGrid,
  originalContours: Contour3D[]
): Contour3D[] {
  const { data, dimensions, origin, spacing } = grid;
  const newContours: Contour3D[] = [];
  
  // Get unique slice positions from original contours
  const slicePositions = [...new Set(originalContours.map(c => c.slicePosition))].sort((a, b) => a - b);
  
  for (const slicePos of slicePositions) {
    const z = Math.round((slicePos - origin.z) / spacing.z);
    if (z < 0 || z >= dimensions.z) continue;
    
    // Extract 2D slice from voxel grid
    const slice = new Uint8Array(dimensions.x * dimensions.y);
    for (let y = 0; y < dimensions.y; y++) {
      for (let x = 0; x < dimensions.x; x++) {
        const index3D = x + y * dimensions.x + z * dimensions.x * dimensions.y;
        const index2D = x + y * dimensions.x;
        slice[index2D] = data[index3D];
      }
    }
    
    // Find contours in slice using marching squares
    const contourPoints = marchingSquares(slice, dimensions.x, dimensions.y);
    
    if (contourPoints.length > 0) {
      // Convert back to world coordinates
      const worldPoints: number[] = [];
      for (let i = 0; i < contourPoints.length; i += 2) {
        const x = contourPoints[i] * spacing.x + origin.x;
        const y = contourPoints[i + 1] * spacing.y + origin.y;
        worldPoints.push(x, y, slicePos);
      }
      
      newContours.push({
        points: worldPoints,
        slicePosition: slicePos
      });
    }
  }
  
  return newContours;
}

/**
 * Marching squares algorithm to extract contour from 2D binary image
 */
function marchingSquares(
  data: Uint8Array,
  width: number,
  height: number
): number[] {
  const contours: number[] = [];
  const visited = new Uint8Array(width * height);
  
  // Find first boundary pixel
  let startX = -1, startY = -1;
  for (let y = 0; y < height && startX === -1; y++) {
    for (let x = 0; x < width && startX === -1; x++) {
      const index = x + y * width;
      if (data[index] === 1 && !visited[index]) {
        // Check if it's a boundary pixel
        if (x === 0 || x === width - 1 || y === 0 || y === height - 1 ||
            data[index - 1] === 0 || data[index + 1] === 0 ||
            data[index - width] === 0 || data[index + width] === 0) {
          startX = x;
          startY = y;
        }
      }
    }
  }
  
  if (startX === -1) return contours;
  
  // Trace boundary using Moore neighborhood
  let x = startX, y = startY;
  let dir = 0; // Direction: 0=right, 1=down, 2=left, 3=up
  const maxSteps = width * height;
  let steps = 0;
  
  do {
    contours.push(x, y);
    visited[x + y * width] = 1;
    
    // Find next boundary pixel
    let found = false;
    for (let i = 0; i < 8; i++) {
      const newDir = (dir + 6 + i) % 8; // Start from back-left of current direction
      let nx = x, ny = y;
      
      // Move in direction
      switch (newDir) {
        case 0: nx++; break;         // Right
        case 1: nx++; ny++; break;   // Down-right
        case 2: ny++; break;         // Down
        case 3: nx--; ny++; break;   // Down-left
        case 4: nx--; break;         // Left
        case 5: nx--; ny--; break;   // Up-left
        case 6: ny--; break;         // Up
        case 7: nx++; ny--; break;   // Up-right
      }
      
      // Check if valid boundary pixel
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        const nIndex = nx + ny * width;
        if (data[nIndex] === 1) {
          x = nx;
          y = ny;
          dir = newDir;
          found = true;
          break;
        }
      }
    }
    
    if (!found) break;
    steps++;
  } while ((x !== startX || y !== startY) && steps < maxSteps);
  
  // Smooth contour using Douglas-Peucker algorithm
  if (contours.length > 6) {
    return simplifyContour(contours, 0.5);
  }
  
  return contours;
}

/**
 * Simplify contour using Douglas-Peucker algorithm
 */
function simplifyContour(points: number[], epsilon: number): number[] {
  if (points.length <= 4) return points;
  
  // Find point with maximum distance from line between first and last
  let maxDist = 0;
  let maxIndex = 0;
  
  const firstX = points[0], firstY = points[1];
  const lastX = points[points.length - 2], lastY = points[points.length - 1];
  
  for (let i = 2; i < points.length - 2; i += 2) {
    const dist = perpendicularDistance(
      points[i], points[i + 1],
      firstX, firstY, lastX, lastY
    );
    if (dist > maxDist) {
      maxDist = dist;
      maxIndex = i;
    }
  }
  
  // If max distance is greater than epsilon, recursively simplify
  if (maxDist > epsilon) {
    const left = simplifyContour(points.slice(0, maxIndex + 2), epsilon);
    const right = simplifyContour(points.slice(maxIndex), epsilon);
    return [...left.slice(0, -2), ...right];
  }
  
  // Otherwise, return endpoints
  return [firstX, firstY, lastX, lastY];
}

/**
 * Calculate perpendicular distance from point to line
 */
function perpendicularDistance(
  px: number, py: number,
  x1: number, y1: number,
  x2: number, y2: number
): number {
  const A = px - x1;
  const B = py - y1;
  const C = x2 - x1;
  const D = y2 - y1;
  
  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  let param = -1;
  
  if (lenSq !== 0) {
    param = dot / lenSq;
  }
  
  let xx, yy;
  if (param < 0) {
    xx = x1;
    yy = y1;
  } else if (param > 1) {
    xx = x2;
    yy = y2;
  } else {
    xx = x1 + param * C;
    yy = y1 + param * D;
  }
  
  const dx = px - xx;
  const dy = py - yy;
  return Math.sqrt(dx * dx + dy * dy);
}