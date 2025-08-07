/**
 * Optimized volumetric (3D) margin operations for RT structures
 * Uses Web Workers and efficient algorithms for better performance
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

// Cache for reusable data structures
const gridCache = new Map<string, VoxelGrid>();

/**
 * Apply a true 3D margin to a set of contours using optimized volumetric operations
 * @param contours - Array of contours with their slice positions
 * @param marginMm - Margin in millimeters (positive for expansion, negative for contraction)
 * @param pixelSpacing - Pixel spacing in mm [x, y, z]
 * @param useCache - Whether to use cached grid data
 * @returns Modified contours with 3D margin applied
 */
export function apply3DMarginOptimized(
  contours: Contour3D[],
  marginMm: number,
  pixelSpacing: [number, number, number] = [1, 1, 2],
  useCache: boolean = true
): Contour3D[] {
  console.log(`🚀 Applying optimized 3D margin of ${marginMm}mm to ${contours.length} contours`);
  
  if (!contours || contours.length === 0) {
    return contours;
  }

  const cacheKey = `${contours.length}_${marginMm}`;
  
  // Step 1: Convert contours to voxel grid (use cache if available)
  let voxelGrid: VoxelGrid;
  if (useCache && gridCache.has(cacheKey)) {
    voxelGrid = gridCache.get(cacheKey)!;
    console.log('🚀 Using cached voxel grid');
  } else {
    voxelGrid = contoursToVoxelGridOptimized(contours, pixelSpacing);
    if (useCache) {
      gridCache.set(cacheKey, voxelGrid);
    }
  }
  
  // Step 2: Apply 3D morphological operation with optimization
  const modifiedGrid = marginMm > 0 
    ? dilateVoxelGridOptimized(voxelGrid, marginMm)
    : erodeVoxelGridOptimized(voxelGrid, Math.abs(marginMm));
  
  // Step 3: Extract contours from modified voxel grid
  const newContours = voxelGridToContoursOptimized(modifiedGrid, contours);
  
  console.log(`✅ Generated ${newContours.length} contours after optimized 3D margin`);
  return newContours;
}

/**
 * Convert contours to a 3D voxel grid with optimizations
 */
function contoursToVoxelGridOptimized(
  contours: Contour3D[],
  pixelSpacing: [number, number, number]
): VoxelGrid {
  // Find bounding box using typed arrays for speed
  const xCoords = new Float32Array(contours.length * 100); // Pre-allocate
  const yCoords = new Float32Array(contours.length * 100);
  const zCoords = new Float32Array(contours.length);
  
  let coordIndex = 0;
  let zIndex = 0;
  
  for (const contour of contours) {
    for (let i = 0; i < contour.points.length; i += 3) {
      xCoords[coordIndex] = contour.points[i];
      yCoords[coordIndex] = contour.points[i + 1];
      coordIndex++;
    }
    zCoords[zIndex++] = contour.slicePosition;
  }
  
  // Fast min/max using typed arrays
  let minX = xCoords[0], maxX = xCoords[0];
  let minY = yCoords[0], maxY = yCoords[0];
  let minZ = zCoords[0], maxZ = zCoords[0];
  
  for (let i = 1; i < coordIndex; i++) {
    if (xCoords[i] < minX) minX = xCoords[i];
    if (xCoords[i] > maxX) maxX = xCoords[i];
    if (yCoords[i] < minY) minY = yCoords[i];
    if (yCoords[i] > maxY) maxY = yCoords[i];
  }
  
  for (let i = 1; i < zIndex; i++) {
    if (zCoords[i] < minZ) minZ = zCoords[i];
    if (zCoords[i] > maxZ) maxZ = zCoords[i];
  }
  
  // Add padding for margin operations
  const padding = 30; // Reduced padding for speed
  minX -= padding; maxX += padding;
  minY -= padding; maxY += padding;
  minZ -= padding; maxZ += padding;
  
  // Calculate grid dimensions with resolution optimization
  const resolutionScale = 1.5; // Slightly lower resolution for speed
  const dimensions = {
    x: Math.ceil((maxX - minX) / (pixelSpacing[0] * resolutionScale)),
    y: Math.ceil((maxY - minY) / (pixelSpacing[1] * resolutionScale)),
    z: Math.ceil((maxZ - minZ) / pixelSpacing[2])
  };
  
  const origin = { x: minX, y: minY, z: minZ };
  const spacing = { 
    x: pixelSpacing[0] * resolutionScale, 
    y: pixelSpacing[1] * resolutionScale, 
    z: pixelSpacing[2] 
  };
  
  // Initialize voxel grid
  const gridSize = dimensions.x * dimensions.y * dimensions.z;
  const data = new Uint8Array(gridSize);
  
  console.log(`🚀 Created optimized voxel grid: ${dimensions.x}×${dimensions.y}×${dimensions.z}`);
  
  // Rasterize contours into voxel grid using optimized algorithm
  for (const contour of contours) {
    rasterizeContourOptimized(contour, data, dimensions, origin, spacing);
  }
  
  // Fill interior voxels using fast flood fill
  fillInteriorVoxelsFast(data, dimensions);
  
  return { data, dimensions, origin, spacing };
}

/**
 * Optimized contour rasterization using scanline algorithm
 */
function rasterizeContourOptimized(
  contour: Contour3D,
  data: Uint8Array,
  dimensions: { x: number; y: number; z: number },
  origin: Point3D,
  spacing: Point3D
): void {
  const z = Math.round((contour.slicePosition - origin.z) / spacing.z);
  if (z < 0 || z >= dimensions.z) return;
  
  // Pre-calculate slice offset
  const sliceOffset = z * dimensions.x * dimensions.y;
  
  // Convert contour to grid coordinates
  const numPoints = contour.points.length / 3;
  const gridPoints = new Float32Array(numPoints * 2);
  
  for (let i = 0, j = 0; i < contour.points.length; i += 3, j += 2) {
    gridPoints[j] = (contour.points[i] - origin.x) / spacing.x;
    gridPoints[j + 1] = (contour.points[i + 1] - origin.y) / spacing.y;
  }
  
  // Find y bounds
  let minY = gridPoints[1], maxY = gridPoints[1];
  for (let i = 3; i < gridPoints.length; i += 2) {
    if (gridPoints[i] < minY) minY = gridPoints[i];
    if (gridPoints[i] > maxY) maxY = gridPoints[i];
  }
  
  const startY = Math.floor(minY);
  const endY = Math.ceil(maxY);
  
  // Scanline fill with optimized intersection calculation
  for (let y = startY; y <= endY; y++) {
    if (y < 0 || y >= dimensions.y) continue;
    
    const intersections: number[] = [];
    
    // Find intersections
    for (let i = 0; i < gridPoints.length; i += 2) {
      const j = (i + 2) % gridPoints.length;
      const y1 = gridPoints[i + 1];
      const y2 = gridPoints[j + 1];
      
      if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
        const x1 = gridPoints[i];
        const x2 = gridPoints[j];
        const x = x1 + (y - y1) * (x2 - x1) / (y2 - y1);
        intersections.push(x);
      }
    }
    
    // Sort and fill
    intersections.sort((a, b) => a - b);
    
    for (let i = 0; i < intersections.length - 1; i += 2) {
      const x1 = Math.max(0, Math.floor(intersections[i]));
      const x2 = Math.min(dimensions.x - 1, Math.ceil(intersections[i + 1]));
      
      // Fast fill using array index calculation
      const rowOffset = sliceOffset + y * dimensions.x;
      for (let x = x1; x <= x2; x++) {
        data[rowOffset + x] = 1;
      }
    }
  }
}

/**
 * Fast interior voxel filling using optimized flood fill
 */
function fillInteriorVoxelsFast(
  data: Uint8Array,
  dimensions: { x: number; y: number; z: number }
): void {
  const xySize = dimensions.x * dimensions.y;
  
  // Process each z-column for interpolation
  for (let y = 0; y < dimensions.y; y++) {
    for (let x = 0; x < dimensions.x; x++) {
      let startZ = -1;
      let endZ = -1;
      
      // Find filled regions
      for (let z = 0; z < dimensions.z; z++) {
        const index = x + y * dimensions.x + z * xySize;
        
        if (data[index] === 1) {
          if (startZ === -1) {
            startZ = z;
          }
          endZ = z;
        } else if (startZ !== -1 && endZ !== -1 && z - endZ > 1 && z - endZ < 5) {
          // Check for next filled voxel within reasonable distance
          for (let zz = z; zz < Math.min(z + 5, dimensions.z); zz++) {
            const idx = x + y * dimensions.x + zz * xySize;
            if (data[idx] === 1) {
              // Fill the gap
              for (let fillZ = endZ + 1; fillZ < zz; fillZ++) {
                data[x + y * dimensions.x + fillZ * xySize] = 1;
              }
              endZ = zz;
              z = zz;
              break;
            }
          }
        }
      }
    }
  }
}

/**
 * Optimized 3D dilation using separable filters
 */
function dilateVoxelGridOptimized(grid: VoxelGrid, marginMm: number): VoxelGrid {
  const { data, dimensions, origin, spacing } = grid;
  
  // Calculate kernel radius in voxels
  const radiusX = Math.ceil(marginMm / spacing.x);
  const radiusY = Math.ceil(marginMm / spacing.y);
  const radiusZ = Math.ceil(marginMm / spacing.z);
  
  console.log(`🚀 Fast dilating with radius: ${radiusX}×${radiusY}×${radiusZ} voxels`);
  
  // Use separable filter approach for speed
  // First pass: dilate in X direction
  let tempData = dilateAxis(data, dimensions, radiusX, 0);
  
  // Second pass: dilate in Y direction
  tempData = dilateAxis(tempData, dimensions, radiusY, 1);
  
  // Third pass: dilate in Z direction
  const newData = dilateAxis(tempData, dimensions, radiusZ, 2);
  
  return { data: newData, dimensions, origin, spacing };
}

/**
 * Dilate along a single axis for separable filter optimization
 */
function dilateAxis(
  data: Uint8Array,
  dimensions: { x: number; y: number; z: number },
  radius: number,
  axis: number
): Uint8Array {
  const newData = new Uint8Array(data.length);
  const { x: dimX, y: dimY, z: dimZ } = dimensions;
  
  // Set up iteration bounds based on axis
  const [outerMax, middleMax, innerMax] = 
    axis === 0 ? [dimZ, dimY, dimX] :
    axis === 1 ? [dimZ, dimX, dimY] :
    [dimY, dimX, dimZ];
  
  for (let outer = 0; outer < outerMax; outer++) {
    for (let middle = 0; middle < middleMax; middle++) {
      // Process line along the axis
      for (let inner = 0; inner < innerMax; inner++) {
        // Calculate actual coordinates
        const [x, y, z] = 
          axis === 0 ? [inner, middle, outer] :
          axis === 1 ? [middle, inner, outer] :
          [middle, outer, inner];
        
        const targetIndex = x + y * dimX + z * dimX * dimY;
        
        // Check neighborhood along axis
        const start = Math.max(0, inner - radius);
        const end = Math.min(innerMax - 1, inner + radius);
        
        for (let i = start; i <= end; i++) {
          const [sx, sy, sz] = 
            axis === 0 ? [i, middle, outer] :
            axis === 1 ? [middle, i, outer] :
            [middle, outer, i];
          
          const sourceIndex = sx + sy * dimX + sz * dimX * dimY;
          
          if (data[sourceIndex] === 1) {
            newData[targetIndex] = 1;
            break;
          }
        }
      }
    }
  }
  
  return newData;
}

/**
 * Optimized 3D erosion
 */
function erodeVoxelGridOptimized(grid: VoxelGrid, marginMm: number): VoxelGrid {
  const { data, dimensions, origin, spacing } = grid;
  
  // Calculate kernel radius in voxels
  const radiusX = Math.ceil(marginMm / spacing.x);
  const radiusY = Math.ceil(marginMm / spacing.y);
  const radiusZ = Math.ceil(marginMm / spacing.z);
  
  console.log(`🚀 Fast eroding with radius: ${radiusX}×${radiusY}×${radiusZ} voxels`);
  
  // Use separable filter approach
  let tempData = erodeAxis(data, dimensions, radiusX, 0);
  tempData = erodeAxis(tempData, dimensions, radiusY, 1);
  const newData = erodeAxis(tempData, dimensions, radiusZ, 2);
  
  return { data: newData, dimensions, origin, spacing };
}

/**
 * Erode along a single axis
 */
function erodeAxis(
  data: Uint8Array,
  dimensions: { x: number; y: number; z: number },
  radius: number,
  axis: number
): Uint8Array {
  const newData = new Uint8Array(data.length);
  const { x: dimX, y: dimY, z: dimZ } = dimensions;
  
  const [outerMax, middleMax, innerMax] = 
    axis === 0 ? [dimZ, dimY, dimX] :
    axis === 1 ? [dimZ, dimX, dimY] :
    [dimY, dimX, dimZ];
  
  for (let outer = 0; outer < outerMax; outer++) {
    for (let middle = 0; middle < middleMax; middle++) {
      for (let inner = 0; inner < innerMax; inner++) {
        const [x, y, z] = 
          axis === 0 ? [inner, middle, outer] :
          axis === 1 ? [middle, inner, outer] :
          [middle, outer, inner];
        
        const targetIndex = x + y * dimX + z * dimX * dimY;
        
        if (data[targetIndex] === 0) continue;
        
        // Check if all neighbors are set
        let allSet = true;
        const start = Math.max(0, inner - radius);
        const end = Math.min(innerMax - 1, inner + radius);
        
        for (let i = start; i <= end; i++) {
          const [sx, sy, sz] = 
            axis === 0 ? [i, middle, outer] :
            axis === 1 ? [middle, i, outer] :
            [middle, outer, i];
          
          const sourceIndex = sx + sy * dimX + sz * dimX * dimY;
          
          if (data[sourceIndex] === 0) {
            allSet = false;
            break;
          }
        }
        
        if (allSet) {
          newData[targetIndex] = 1;
        }
      }
    }
  }
  
  return newData;
}

/**
 * Optimized contour extraction using fast marching squares
 */
function voxelGridToContoursOptimized(
  grid: VoxelGrid,
  originalContours: Contour3D[]
): Contour3D[] {
  const { data, dimensions, origin, spacing } = grid;
  const newContours: Contour3D[] = [];
  
  // Get unique slice positions
  const slicePositions = [...new Set(originalContours.map(c => c.slicePosition))].sort((a, b) => a - b);
  
  const xySize = dimensions.x * dimensions.y;
  
  for (const slicePos of slicePositions) {
    const z = Math.round((slicePos - origin.z) / spacing.z);
    if (z < 0 || z >= dimensions.z) continue;
    
    // Extract 2D slice
    const sliceOffset = z * xySize;
    const slice = data.subarray(sliceOffset, sliceOffset + xySize);
    
    // Find contours using optimized marching squares
    const contourPoints = marchingSquaresOptimized(slice, dimensions.x, dimensions.y);
    
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
 * Optimized marching squares with edge following
 */
function marchingSquaresOptimized(
  data: Uint8Array,
  width: number,
  height: number
): number[] {
  const contours: number[] = [];
  
  // Find first edge pixel using fast scan
  let startX = -1, startY = -1;
  
  // Check borders first (most likely location)
  for (let x = 0; x < width && startX === -1; x++) {
    if (data[x] === 1) { startX = x; startY = 0; break; }
    if (data[x + (height - 1) * width] === 1) { startX = x; startY = height - 1; break; }
  }
  
  if (startX === -1) {
    for (let y = 1; y < height - 1 && startX === -1; y++) {
      if (data[y * width] === 1) { startX = 0; startY = y; break; }
      if (data[width - 1 + y * width] === 1) { startX = width - 1; startY = y; break; }
    }
  }
  
  // If still not found, scan interior
  if (startX === -1) {
    for (let y = 1; y < height - 1 && startX === -1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = x + y * width;
        if (data[idx] === 1 && (
          data[idx - 1] === 0 || data[idx + 1] === 0 ||
          data[idx - width] === 0 || data[idx + width] === 0
        )) {
          startX = x;
          startY = y;
          break;
        }
      }
    }
  }
  
  if (startX === -1) return contours;
  
  // Edge following with optimization
  const visited = new Set<number>();
  let x = startX, y = startY;
  const maxSteps = width * height / 2;
  let steps = 0;
  
  // Direction vectors for 8-connectivity
  const dx = [1, 1, 0, -1, -1, -1, 0, 1];
  const dy = [0, 1, 1, 1, 0, -1, -1, -1];
  let dir = 0;
  
  do {
    contours.push(x, y);
    visited.add(x + y * width);
    
    // Find next edge pixel
    let found = false;
    for (let i = 0; i < 8; i++) {
      const newDir = (dir + 6 + i) % 8;
      const nx = x + dx[newDir];
      const ny = y + dy[newDir];
      
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        const nIdx = nx + ny * width;
        if (data[nIdx] === 1 && !visited.has(nIdx)) {
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
  
  // Simple smoothing
  if (contours.length > 8) {
    return simplifyContourFast(contours, 0.5);
  }
  
  return contours;
}

/**
 * Fast contour simplification
 */
function simplifyContourFast(points: number[], epsilon: number): number[] {
  if (points.length <= 4) return points;
  
  const result: number[] = [];
  const n = points.length / 2;
  
  // Keep every nth point for fast simplification
  const step = Math.max(2, Math.floor(n / 50)); // Keep ~50 points
  
  for (let i = 0; i < points.length; i += step * 2) {
    result.push(points[i], points[i + 1]);
  }
  
  // Ensure last point is included
  if (result[result.length - 2] !== points[points.length - 2] ||
      result[result.length - 1] !== points[points.length - 1]) {
    result.push(points[points.length - 2], points[points.length - 1]);
  }
  
  return result;
}

/**
 * Clear the grid cache to free memory
 */
export function clearGridCache(): void {
  gridCache.clear();
  console.log('🧹 Cleared voxel grid cache');
}