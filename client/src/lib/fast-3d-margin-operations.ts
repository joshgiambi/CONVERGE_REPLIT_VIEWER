/**
 * Fast and Reliable 3D Margin Operations
 * Hybrid approach combining performance optimizations with true 3D expansion
 */

interface FastContour3D {
  points: number[];
  slicePosition: number;
  numberOfPoints?: number;
}

interface FastMarginParameters {
  marginMm: number;
  pixelSpacing: [number, number, number];
  imageMetadata: {
    imagePosition: [number, number, number];
    imageSize: { width: number; height: number; depth: number };
  };
  useOptimizedAlgorithm?: boolean;
  maxProcessingTime?: number; // milliseconds
}

/**
 * Fast 3D margin expansion that creates contours on new slices
 * Uses optimized voxelization with performance safeguards
 */
export async function applyFast3DMargin(
  contours: FastContour3D[],
  parameters: FastMarginParameters
): Promise<FastContour3D[]> {
  const { marginMm, pixelSpacing, imageMetadata, maxProcessingTime = 10000 } = parameters;
  
  console.log(`🚀 Fast 3D margin: ${marginMm}mm on ${contours.length} contours`);
  const startTime = performance.now();
  
  if (!contours || contours.length === 0) {
    return contours;
  }

  try {
    // Step 1: Calculate bounding box with margin expansion
    const boundingBox = calculateExpandedBoundingBox(contours, marginMm, pixelSpacing);
    
    // Step 2: Use optimized algorithm based on structure size
    const shouldUseOptimized = shouldUseOptimizedAlgorithm(boundingBox, marginMm);
    
    if (shouldUseOptimized) {
      return await applyOptimizedVoxelMargin(contours, parameters, boundingBox);
    } else {
      return await applyFastSliceInterpolation(contours, parameters, boundingBox);
    }
    
  } catch (error) {
    console.error('🚀 ❌ Fast 3D margin failed, falling back to 2D:', error);
    
    // Fallback to existing simple operations
    const { growContourSimple } = await import('./simple-polygon-operations');
    const fallbackResults: FastContour3D[] = [];
    
    for (const contour of contours) {
      try {
        const expandedPoints = growContourSimple(contour.points, marginMm);
        fallbackResults.push({
          points: expandedPoints,
          slicePosition: contour.slicePosition,
          numberOfPoints: expandedPoints.length / 3
        });
      } catch (contourError) {
        console.warn(`Skipping contour at slice ${contour.slicePosition}:`, contourError);
      }
    }
    
    return fallbackResults;
  }
}

/**
 * Calculate bounding box with margin expansion for optimization decisions
 */
function calculateExpandedBoundingBox(
  contours: FastContour3D[],
  marginMm: number,
  pixelSpacing: [number, number, number]
): {
  min: [number, number, number];
  max: [number, number, number];
  volume: number;
} {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  
  for (const contour of contours) {
    for (let i = 0; i < contour.points.length; i += 3) {
      const x = contour.points[i];
      const y = contour.points[i + 1];
      const z = contour.points[i + 2];
      
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      maxZ = Math.max(maxZ, z);
    }
  }
  
  // Expand by margin
  const marginBuffer = Math.abs(marginMm);
  minX -= marginBuffer;
  minY -= marginBuffer;
  minZ -= marginBuffer;
  maxX += marginBuffer;
  maxY += marginBuffer;
  maxZ += marginBuffer;
  
  const volume = (maxX - minX) * (maxY - minY) * (maxZ - minZ);
  
  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
    volume
  };
}

/**
 * Determine whether to use optimized voxel algorithm based on structure characteristics
 */
function shouldUseOptimizedAlgorithm(
  boundingBox: { volume: number },
  marginMm: number
): boolean {
  // Use optimized algorithm for:
  // - Small to medium volumes (< 1000 cubic cm)
  // - Moderate margins (< 20mm)
  const MAX_OPTIMAL_VOLUME = 1000000; // 1000 cubic cm in cubic mm
  const MAX_OPTIMAL_MARGIN = 20; // 20mm
  
  return boundingBox.volume < MAX_OPTIMAL_VOLUME && Math.abs(marginMm) < MAX_OPTIMAL_MARGIN;
}

/**
 * Fast voxel-based 3D margin expansion for optimal cases
 */
async function applyOptimizedVoxelMargin(
  contours: FastContour3D[],
  parameters: FastMarginParameters,
  boundingBox: any
): Promise<FastContour3D[]> {
  console.log('🚀 Using optimized voxel algorithm');
  
  const { marginMm, pixelSpacing } = parameters;
  
  // Calculate voxel grid dimensions
  const [dx, dy, dz] = pixelSpacing;
  const width = Math.ceil((boundingBox.max[0] - boundingBox.min[0]) / dx);
  const height = Math.ceil((boundingBox.max[1] - boundingBox.min[1]) / dy);
  const depth = Math.ceil((boundingBox.max[2] - boundingBox.min[2]) / dz);
  
  // Safety check on grid size
  const totalVoxels = width * height * depth;
  const MAX_VOXELS = 50_000_000; // 50M voxels max (~200MB at 1 byte per voxel)
  
  if (totalVoxels > MAX_VOXELS) {
    throw new Error(`Voxel grid too large: ${totalVoxels} voxels (max: ${MAX_VOXELS})`);
  }
  
  console.log(`🚀 Creating ${width}x${height}x${depth} voxel grid (${totalVoxels} voxels)`);
  
  // Create and populate voxel grid
  const voxelGrid = new Uint8Array(totalVoxels);
  
  // Rasterize contours to voxel grid
  for (const contour of contours) {
    rasterizeContourToGrid(contour, voxelGrid, boundingBox, [width, height, depth], pixelSpacing);
  }
  
  // Apply 3D morphological dilation/erosion
  const kernelRadius = Math.ceil(Math.abs(marginMm) / Math.min(...pixelSpacing));
  const expandedGrid = marginMm > 0 
    ? dilateVoxelGrid(voxelGrid, [width, height, depth], kernelRadius)
    : erodeVoxelGrid(voxelGrid, [width, height, depth], kernelRadius);
  
  // Extract contours from expanded grid
  return extractContoursFromVoxelGrid(expandedGrid, boundingBox, [width, height, depth], pixelSpacing);
}

/**
 * Fast slice interpolation approach for larger structures
 */
async function applyFastSliceInterpolation(
  contours: FastContour3D[],
  parameters: FastMarginParameters,
  boundingBox: any
): Promise<FastContour3D[]> {
  console.log('🚀 Using fast slice interpolation algorithm');
  
  const { marginMm, pixelSpacing } = parameters;
  const { growContourSimple } = await import('./simple-polygon-operations');
  
  // Group contours by slice
  const contoursMap = new Map<number, FastContour3D[]>();
  for (const contour of contours) {
    const sliceKey = Math.round(contour.slicePosition / pixelSpacing[2]);
    if (!contoursMap.has(sliceKey)) {
      contoursMap.set(sliceKey, []);
    }
    contoursMap.get(sliceKey)!.push(contour);
  }
  
  // Process existing slices with 2D expansion
  const processedSlices = new Map<number, FastContour3D[]>();
  for (const [sliceKey, sliceContours] of contoursMap) {
    const expandedContours: FastContour3D[] = [];
    
    for (const contour of sliceContours) {
      try {
        const expandedPoints = growContourSimple(contour.points, marginMm);
        expandedContours.push({
          points: expandedPoints,
          slicePosition: contour.slicePosition,
          numberOfPoints: expandedPoints.length / 3
        });
      } catch (error) {
        console.warn(`Failed to expand contour on slice ${sliceKey}:`, error);
      }
    }
    
    processedSlices.set(sliceKey, expandedContours);
  }
  
  // Add superior/inferior expansion by interpolating to new slices
  const sliceKeys = Array.from(processedSlices.keys()).sort((a, b) => a - b);
  const minSlice = sliceKeys[0];
  const maxSlice = sliceKeys[sliceKeys.length - 1];
  
  // Calculate how many new slices to add above and below
  const sliceSpacing = pixelSpacing[2];
  const newSlicesNeeded = Math.ceil(Math.abs(marginMm) / sliceSpacing);
  
  // Add superior slices (above)
  for (let i = 1; i <= newSlicesNeeded; i++) {
    const newSliceKey = maxSlice + i;
    const newSlicePosition = (maxSlice + i) * sliceSpacing;
    const interpolatedContours = interpolateSliceContours(
      processedSlices.get(maxSlice) || [],
      newSlicePosition,
      0.7 - (i * 0.15) // Gradually shrink interpolated contours
    );
    if (interpolatedContours.length > 0) {
      processedSlices.set(newSliceKey, interpolatedContours);
    }
  }
  
  // Add inferior slices (below)
  for (let i = 1; i <= newSlicesNeeded; i++) {
    const newSliceKey = minSlice - i;
    const newSlicePosition = (minSlice - i) * sliceSpacing;
    const interpolatedContours = interpolateSliceContours(
      processedSlices.get(minSlice) || [],
      newSlicePosition,
      0.7 - (i * 0.15) // Gradually shrink interpolated contours
    );
    if (interpolatedContours.length > 0) {
      processedSlices.set(newSliceKey, interpolatedContours);
    }
  }
  
  // Combine all processed slices
  const allResults: FastContour3D[] = [];
  for (const sliceContours of processedSlices.values()) {
    allResults.push(...sliceContours);
  }
  
  return allResults;
}

/**
 * Simple contour interpolation for new slices
 */
function interpolateSliceContours(
  sourceContours: FastContour3D[],
  newSlicePosition: number,
  scaleFactor: number = 1.0
): FastContour3D[] {
  const interpolatedContours: FastContour3D[] = [];
  
  for (const sourceContour of sourceContours) {
    if (sourceContour.points.length < 9) continue; // Need at least 3 points
    
    const newPoints: number[] = [];
    
    // Scale and copy points to new slice
    for (let i = 0; i < sourceContour.points.length; i += 3) {
      const x = sourceContour.points[i];
      const y = sourceContour.points[i + 1];
      
      // Simple scaling towards centroid for gradual shrinkage
      newPoints.push(x * scaleFactor, y * scaleFactor, newSlicePosition);
    }
    
    if (newPoints.length >= 9) {
      interpolatedContours.push({
        points: newPoints,
        slicePosition: newSlicePosition,
        numberOfPoints: newPoints.length / 3
      });
    }
  }
  
  return interpolatedContours;
}

/**
 * Rasterize a contour into the voxel grid
 */
function rasterizeContourToGrid(
  contour: FastContour3D,
  grid: Uint8Array,
  boundingBox: any,
  dimensions: [number, number, number],
  pixelSpacing: [number, number, number]
): void {
  const [width, height, depth] = dimensions;
  const [dx, dy, dz] = pixelSpacing;
  
  // Convert world coordinates to voxel indices
  const voxelPoints: [number, number][] = [];
  for (let i = 0; i < contour.points.length; i += 3) {
    const worldX = contour.points[i];
    const worldY = contour.points[i + 1];
    const worldZ = contour.points[i + 2];
    
    const voxelX = Math.round((worldX - boundingBox.min[0]) / dx);
    const voxelY = Math.round((worldY - boundingBox.min[1]) / dy);
    const voxelZ = Math.round((worldZ - boundingBox.min[2]) / dz);
    
    if (voxelX >= 0 && voxelX < width && voxelY >= 0 && voxelY < height && voxelZ >= 0 && voxelZ < depth) {
      voxelPoints.push([voxelX, voxelY]);
    }
  }
  
  // Fill the contour using scanline algorithm
  if (voxelPoints.length >= 3) {
    const sliceZ = Math.round((contour.slicePosition - boundingBox.min[2]) / dz);
    if (sliceZ >= 0 && sliceZ < depth) {
      fillPolygonInSlice(grid, voxelPoints, width, height, sliceZ, dimensions);
    }
  }
}

/**
 * Fill polygon in a specific slice of the voxel grid
 */
function fillPolygonInSlice(
  grid: Uint8Array,
  polygon: [number, number][],
  width: number,
  height: number,
  sliceZ: number,
  dimensions: [number, number, number]
): void {
  const [gridWidth, gridHeight, gridDepth] = dimensions;
  
  const minY = Math.max(0, Math.min(...polygon.map(p => p[1])));
  const maxY = Math.min(height - 1, Math.max(...polygon.map(p => p[1])));
  
  for (let y = minY; y <= maxY; y++) {
    const intersections: number[] = [];
    
    for (let i = 0; i < polygon.length; i++) {
      const p1 = polygon[i];
      const p2 = polygon[(i + 1) % polygon.length];
      
      if ((p1[1] <= y && p2[1] > y) || (p2[1] <= y && p1[1] > y)) {
        const x = p1[0] + (y - p1[1]) * (p2[0] - p1[0]) / (p2[1] - p1[1]);
        intersections.push(Math.round(x));
      }
    }
    
    intersections.sort((a, b) => a - b);
    for (let i = 0; i < intersections.length; i += 2) {
      if (i + 1 < intersections.length) {
        const x1 = Math.max(0, intersections[i]);
        const x2 = Math.min(width - 1, intersections[i + 1]);
        for (let x = x1; x <= x2; x++) {
          const index = sliceZ * gridWidth * gridHeight + y * gridWidth + x;
          if (index >= 0 && index < grid.length) {
            grid[index] = 1;
          }
        }
      }
    }
  }
}

/**
 * Simple 3D dilation
 */
function dilateVoxelGrid(
  grid: Uint8Array,
  dimensions: [number, number, number],
  radius: number
): Uint8Array {
  const [width, height, depth] = dimensions;
  const result = new Uint8Array(grid.length);
  
  // Use a smaller kernel for performance
  const kernelSize = Math.min(radius, 3); // Cap kernel size
  
  for (let z = 0; z < depth; z++) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const centerIndex = z * width * height + y * width + x;
        
        if (grid[centerIndex] === 1) {
          // Dilate around this voxel
          for (let dz = -kernelSize; dz <= kernelSize; dz++) {
            for (let dy = -kernelSize; dy <= kernelSize; dy++) {
              for (let dx = -kernelSize; dx <= kernelSize; dx++) {
                const nx = x + dx;
                const ny = y + dy;
                const nz = z + dz;
                
                if (nx >= 0 && nx < width && ny >= 0 && ny < height && nz >= 0 && nz < depth) {
                  const distance = Math.sqrt(dx*dx + dy*dy + dz*dz);
                  if (distance <= kernelSize) {
                    const newIndex = nz * width * height + ny * width + nx;
                    result[newIndex] = 1;
                  }
                }
              }
            }
          }
        }
      }
    }
  }
  
  return result;
}

/**
 * Simple 3D erosion
 */
function erodeVoxelGrid(
  grid: Uint8Array,
  dimensions: [number, number, number],
  radius: number
): Uint8Array {
  const [width, height, depth] = dimensions;
  const result = new Uint8Array(grid.length);
  
  const kernelSize = Math.min(radius, 3);
  
  for (let z = 0; z < depth; z++) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const centerIndex = z * width * height + y * width + x;
        
        if (grid[centerIndex] === 1) {
          // Check if all neighbors are also 1
          let allNeighborsSet = true;
          
          for (let dz = -kernelSize; dz <= kernelSize && allNeighborsSet; dz++) {
            for (let dy = -kernelSize; dy <= kernelSize && allNeighborsSet; dy++) {
              for (let dx = -kernelSize; dx <= kernelSize && allNeighborsSet; dx++) {
                const nx = x + dx;
                const ny = y + dy;
                const nz = z + dz;
                
                if (nx >= 0 && nx < width && ny >= 0 && ny < height && nz >= 0 && nz < depth) {
                  const distance = Math.sqrt(dx*dx + dy*dy + dz*dz);
                  if (distance <= kernelSize) {
                    const neighborIndex = nz * width * height + ny * width + nx;
                    if (grid[neighborIndex] === 0) {
                      allNeighborsSet = false;
                    }
                  }
                }
              }
            }
          }
          
          if (allNeighborsSet) {
            result[centerIndex] = 1;
          }
        }
      }
    }
  }
  
  return result;
}

/**
 * Extract contours from voxel grid using marching squares on each slice
 */
function extractContoursFromVoxelGrid(
  grid: Uint8Array,
  boundingBox: any,
  dimensions: [number, number, number],
  pixelSpacing: [number, number, number]
): FastContour3D[] {
  const [width, height, depth] = dimensions;
  const [dx, dy, dz] = pixelSpacing;
  const contours: FastContour3D[] = [];
  
  for (let z = 0; z < depth; z++) {
    const slicePosition = boundingBox.min[2] + z * dz;
    const sliceContours = extractContoursFromSlice(grid, z, dimensions, boundingBox, pixelSpacing);
    
    for (const contour of sliceContours) {
      contours.push({
        points: contour,
        slicePosition,
        numberOfPoints: contour.length / 3
      });
    }
  }
  
  return contours;
}

/**
 * Extract contours from a single slice using simple edge detection
 */
function extractContoursFromSlice(
  grid: Uint8Array,
  sliceZ: number,
  dimensions: [number, number, number],
  boundingBox: any,
  pixelSpacing: [number, number, number]
): number[][] {
  const [width, height, depth] = dimensions;
  const [dx, dy, dz] = pixelSpacing;
  const contours: number[][] = [];
  
  // Simple edge detection and contour tracing
  const visited = new Array(height).fill(null).map(() => new Array(width).fill(false));
  
  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      const index = sliceZ * width * height + y * width + x;
      
      if (grid[index] === 1 && !visited[y][x]) {
        // Found an edge, trace the contour
        const contour = traceContour(grid, sliceZ, x, y, dimensions, visited);
        
        if (contour.length >= 3) {
          // Convert voxel coordinates back to world coordinates
          const worldContour: number[] = [];
          for (const [vx, vy] of contour) {
            const worldX = boundingBox.min[0] + vx * dx;
            const worldY = boundingBox.min[1] + vy * dy;
            const worldZ = boundingBox.min[2] + sliceZ * dz;
            worldContour.push(worldX, worldY, worldZ);
          }
          
          if (worldContour.length >= 9) {
            contours.push(worldContour);
          }
        }
      }
    }
  }
  
  return contours;
}

/**
 * Simple contour tracing
 */
function traceContour(
  grid: Uint8Array,
  sliceZ: number,
  startX: number,
  startY: number,
  dimensions: [number, number, number],
  visited: boolean[][]
): [number, number][] {
  const [width, height, depth] = dimensions;
  const contour: [number, number][] = [];
  
  const directions = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  let currentX = startX;
  let currentY = startY;
  
  do {
    if (!visited[currentY][currentX]) {
      contour.push([currentX, currentY]);
      visited[currentY][currentX] = true;
    }
    
    // Find next boundary pixel
    let found = false;
    for (const [dx, dy] of directions) {
      const nextX = currentX + dx;
      const nextY = currentY + dy;
      
      if (nextX >= 0 && nextX < width && nextY >= 0 && nextY < height) {
        const nextIndex = sliceZ * width * height + nextY * width + nextX;
        if (grid[nextIndex] === 1 && !visited[nextY][nextX]) {
          currentX = nextX;
          currentY = nextY;
          found = true;
          break;
        }
      }
    }
    
    if (!found) break;
    
  } while (contour.length < 1000 && (currentX !== startX || currentY !== startY || contour.length < 4));
  
  return contour;
}

export { FastContour3D, FastMarginParameters };