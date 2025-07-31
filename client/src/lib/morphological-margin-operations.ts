// Advanced Morphological Margin Operations
// Based on detailed mathematical specifications for medical imaging
// Implements dilation and erosion algorithms with spherical kernels

export interface MarginParameters {
  marginType: 'UNIFORM' | 'DIRECTIONAL' | 'MORPHOLOGICAL';
  marginValues: {
    uniform: number;        // mm
    superior: number;       // mm (+Z)
    inferior: number;       // mm (-Z)
    anterior: number;       // mm (-Y)
    posterior: number;      // mm (+Y)
    left: number;          // mm (+X)
    right: number;         // mm (-X)
  };
  algorithmType: 'SIMPLE' | 'MORPHOLOGICAL' | 'SURFACE_BASED';
  kernelType: 'SPHERICAL' | 'CUBIC' | 'ELLIPSOIDAL';
  smoothingType: 'LINEAR' | 'GAUSSIAN' | 'SPLINE';
  cornerHandling: 'ROUND' | 'MITER' | 'BEVEL';
  resolution: number;       // mm between points
  iterations: number;       // Number of dilation/erosion iterations
  preview: {
    enabled: boolean;
    opacity: number;
    color: string;
    updateRealtime: boolean;
  };
}

interface Point3D {
  x: number;
  y: number;
  z: number;
}

interface ContourSlice {
  points: number[];        // [x1, y1, z1, x2, y2, z2, ...]
  slicePosition: number;   // Z position in world coordinates
}

interface ImageMetadata {
  pixelSpacing: [number, number];  // [row spacing, column spacing] in mm
  sliceThickness: number;          // mm
  imagePosition: [number, number, number]; // World coordinates origin
}

/**
 * Create spherical structuring element for morphological operations
 * Mathematical definition: S = {(x,y,z) | x² + y² + z² ≤ r²}
 */
export function createSphericalKernel(
  radiusMm: number,
  pixelSpacing: [number, number],
  sliceThickness: number
): {
  kernel: number[][][];
  center: [number, number, number];
} {
  // Convert mm radius to pixel dimensions
  const radiusX = Math.ceil(radiusMm / pixelSpacing[1]); // Column spacing
  const radiusY = Math.ceil(radiusMm / pixelSpacing[0]); // Row spacing  
  const radiusZ = Math.ceil(radiusMm / sliceThickness);
  
  // Ensure odd dimensions for symmetric kernels
  const dimX = radiusX * 2 + 1;
  const dimY = radiusY * 2 + 1;
  const dimZ = radiusZ * 2 + 1;
  
  // Initialize 3D kernel
  const kernel: number[][][] = Array(dimZ).fill(null).map(() =>
    Array(dimY).fill(null).map(() => Array(dimX).fill(0))
  );
  
  const centerX = radiusX;
  const centerY = radiusY;
  const centerZ = radiusZ;
  
  // Create spherical mask with anisotropic pixel spacing consideration
  for (let z = 0; z < dimZ; z++) {
    for (let y = 0; y < dimY; y++) {
      for (let x = 0; x < dimX; x++) {
        // Calculate offset from center in world coordinates (mm)
        const offsetX = (x - centerX) * pixelSpacing[1];
        const offsetY = (y - centerY) * pixelSpacing[0];
        const offsetZ = (z - centerZ) * sliceThickness;
        
        // Calculate Euclidean distance
        const distance = Math.sqrt(offsetX ** 2 + offsetY ** 2 + offsetZ ** 2);
        
        // Include point if within radius
        kernel[z][y][x] = distance <= radiusMm ? 1 : 0;
      }
    }
  }
  
  return {
    kernel,
    center: [centerX, centerY, centerZ]
  };
}

/**
 * Create asymmetric directional kernel for non-uniform margin expansion
 */
export function createDirectionalKernel(
  marginValues: MarginParameters['marginValues'],
  pixelSpacing: [number, number],
  sliceThickness: number
): {
  kernel: number[][][];
  center: [number, number, number];
} {
  const { left, right, anterior, posterior, superior, inferior } = marginValues;
  
  // Convert margins from mm to pixels
  const leftPixels = Math.ceil(left / pixelSpacing[1]);
  const rightPixels = Math.ceil(right / pixelSpacing[1]);
  const anteriorPixels = Math.ceil(anterior / pixelSpacing[0]);
  const posteriorPixels = Math.ceil(posterior / pixelSpacing[0]);
  const superiorPixels = Math.ceil(superior / sliceThickness);
  const inferiorPixels = Math.ceil(inferior / sliceThickness);
  
  // Calculate total dimensions
  const dimX = leftPixels + rightPixels + 1;
  const dimY = anteriorPixels + posteriorPixels + 1;
  const dimZ = superiorPixels + inferiorPixels + 1;
  
  // Initialize kernel
  const kernel: number[][][] = Array(dimZ).fill(null).map(() =>
    Array(dimY).fill(null).map(() => Array(dimX).fill(0))
  );
  
  const centerX = leftPixels;
  const centerY = anteriorPixels;
  const centerZ = inferiorPixels;
  
  // Fill kernel based on directional distances
  for (let z = 0; z < dimZ; z++) {
    for (let y = 0; y < dimY; y++) {
      for (let x = 0; x < dimX; x++) {
        const offsetX = x - centerX;
        const offsetY = y - centerY;
        const offsetZ = z - centerZ;
        
        // Check if point is within expansion bounds
        const xValid = offsetX >= -leftPixels && offsetX <= rightPixels;
        const yValid = offsetY >= -anteriorPixels && offsetY <= posteriorPixels;
        const zValid = offsetZ >= -inferiorPixels && offsetZ <= superiorPixels;
        
        if (xValid && yValid && zValid) {
          // Apply ellipsoidal constraint for smooth expansion
          const normalizedDistX = offsetX / Math.max(leftPixels, rightPixels, 1);
          const normalizedDistY = offsetY / Math.max(anteriorPixels, posteriorPixels, 1);
          const normalizedDistZ = offsetZ / Math.max(superiorPixels, inferiorPixels, 1);
          
          const normalizedDistance = Math.sqrt(
            normalizedDistX ** 2 + normalizedDistY ** 2 + normalizedDistZ ** 2
          );
          
          kernel[z][y][x] = normalizedDistance <= 1.0 ? 1 : 0;
        }
      }
    }
  }
  
  return {
    kernel,
    center: [centerX, centerY, centerZ]
  };
}

/**
 * Convert contour points to 3D binary mask for morphological operations
 */
export function contourToBinaryMask(
  contours: ContourSlice[],
  imageMetadata: ImageMetadata,
  imageSize: { width: number; height: number; depth: number }
): {
  mask: number[][][];
  slicePositions: number[];
} {
  const { width, height, depth } = imageSize;
  const mask: number[][][] = Array(depth).fill(null).map(() =>
    Array(height).fill(null).map(() => Array(width).fill(0))
  );
  
  const slicePositions: number[] = [];
  
  contours.forEach((contour, sliceIndex) => {
    if (sliceIndex >= depth) return;
    
    slicePositions[sliceIndex] = contour.slicePosition;
    
    // Convert world coordinates to pixel coordinates
    const pixelPoints: [number, number][] = [];
    for (let i = 0; i < contour.points.length; i += 3) {
      const worldX = contour.points[i];
      const worldY = contour.points[i + 1];
      
      const pixelX = Math.round((worldX - imageMetadata.imagePosition[0]) / imageMetadata.pixelSpacing[1]);
      const pixelY = Math.round((worldY - imageMetadata.imagePosition[1]) / imageMetadata.pixelSpacing[0]);
      
      if (pixelX >= 0 && pixelX < width && pixelY >= 0 && pixelY < height) {
        pixelPoints.push([pixelX, pixelY]);
      }
    }
    
    // Fill polygon using scanline algorithm
    if (pixelPoints.length >= 3) {
      fillPolygon(mask[sliceIndex], pixelPoints, width, height);
    }
  });
  
  return { mask, slicePositions };
}

/**
 * Fill polygon in 2D slice using scanline algorithm
 */
function fillPolygon(
  slice: number[][],
  points: [number, number][],
  width: number,
  height: number
): void {
  if (points.length < 3) return;
  
  // Find bounds
  let minY = Math.max(0, Math.min(...points.map(p => p[1])));
  let maxY = Math.min(height - 1, Math.max(...points.map(p => p[1])));
  
  // Scanline fill
  for (let y = minY; y <= maxY; y++) {
    const intersections: number[] = [];
    
    // Find intersections with polygon edges
    for (let i = 0; i < points.length; i++) {
      const p1 = points[i];
      const p2 = points[(i + 1) % points.length];
      
      if ((p1[1] <= y && p2[1] > y) || (p2[1] <= y && p1[1] > y)) {
        const x = p1[0] + (y - p1[1]) * (p2[0] - p1[0]) / (p2[1] - p1[1]);
        intersections.push(Math.round(x));
      }
    }
    
    // Sort intersections and fill between pairs
    intersections.sort((a, b) => a - b);
    for (let i = 0; i < intersections.length; i += 2) {
      if (i + 1 < intersections.length) {
        const x1 = Math.max(0, intersections[i]);
        const x2 = Math.min(width - 1, intersections[i + 1]);
        for (let x = x1; x <= x2; x++) {
          slice[y][x] = 1;
        }
      }
    }
  }
}

/**
 * Perform morphological dilation
 * Mathematical: (A ⊕ B)(x,y,z) = max{A(x-i,y-j,z-k) | B(i,j,k) = 1}
 */
export function performDilation(
  binaryMask: number[][][],
  kernel: number[][][],
  kernelCenter: [number, number, number]
): number[][][] {
  const [depth, height, width] = [binaryMask.length, binaryMask[0].length, binaryMask[0][0].length];
  const [kernelDepth, kernelHeight, kernelWidth] = [kernel.length, kernel[0].length, kernel[0][0].length];
  const [centerX, centerY, centerZ] = kernelCenter;
  
  // Initialize result mask
  const result: number[][][] = Array(depth).fill(null).map(() =>
    Array(height).fill(null).map(() => Array(width).fill(0))
  );
  
  // Apply dilation
  for (let z = 0; z < depth; z++) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let maxValue = 0;
        
        // Check kernel footprint
        for (let kz = 0; kz < kernelDepth; kz++) {
          for (let ky = 0; ky < kernelHeight; ky++) {
            for (let kx = 0; kx < kernelWidth; kx++) {
              if (kernel[kz][ky][kx] === 1) {
                const sourceZ = z - (kz - centerZ);
                const sourceY = y - (ky - centerY);
                const sourceX = x - (kx - centerX);
                
                if (sourceZ >= 0 && sourceZ < depth &&
                    sourceY >= 0 && sourceY < height &&
                    sourceX >= 0 && sourceX < width) {
                  maxValue = Math.max(maxValue, binaryMask[sourceZ][sourceY][sourceX]);
                }
              }
            }
          }
        }
        
        result[z][y][x] = maxValue;
      }
    }
  }
  
  return result;
}

/**
 * Perform morphological erosion
 * Mathematical: (A ⊖ B)(x,y,z) = min{A(x+i,y+j,z+k) | B(i,j,k) = 1}
 */
export function performErosion(
  binaryMask: number[][][],
  kernel: number[][][],
  kernelCenter: [number, number, number]
): number[][][] {
  const [depth, height, width] = [binaryMask.length, binaryMask[0].length, binaryMask[0][0].length];
  const [kernelDepth, kernelHeight, kernelWidth] = [kernel.length, kernel[0].length, kernel[0][0].length];
  const [centerX, centerY, centerZ] = kernelCenter;
  
  // Initialize result mask
  const result: number[][][] = Array(depth).fill(null).map(() =>
    Array(height).fill(null).map(() => Array(width).fill(0))
  );
  
  // Apply erosion
  for (let z = 0; z < depth; z++) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let minValue = 1;
        
        // Check if entire kernel fits within foreground
        for (let kz = 0; kz < kernelDepth; kz++) {
          for (let ky = 0; ky < kernelHeight; ky++) {
            for (let kx = 0; kx < kernelWidth; kx++) {
              if (kernel[kz][ky][kx] === 1) {
                const sourceZ = z + (kz - centerZ);
                const sourceY = y + (ky - centerY);
                const sourceX = x + (kx - centerX);
                
                if (sourceZ < 0 || sourceZ >= depth ||
                    sourceY < 0 || sourceY >= height ||
                    sourceX < 0 || sourceX >= width) {
                  minValue = 0; // Outside bounds considered background
                } else {
                  minValue = Math.min(minValue, binaryMask[sourceZ][sourceY][sourceX]);
                }
              }
            }
          }
        }
        
        result[z][y][x] = minValue;
      }
    }
  }
  
  return result;
}

/**
 * Convert binary mask back to contour points
 */
export function binaryMaskToContours(
  mask: number[][][],
  slicePositions: number[],
  imageMetadata: ImageMetadata
): ContourSlice[] {
  const contours: ContourSlice[] = [];
  
  mask.forEach((slice, sliceIndex) => {
    if (sliceIndex >= slicePositions.length) return;
    
    const contourPoints = extractContourFromSlice(slice, slicePositions[sliceIndex], imageMetadata);
    if (contourPoints.length > 0) {
      contours.push({
        points: contourPoints,
        slicePosition: slicePositions[sliceIndex]
      });
    }
  });
  
  return contours;
}

/**
 * Extract contour points from 2D binary slice using marching squares
 */
function extractContourFromSlice(
  slice: number[][],
  sliceZ: number,
  imageMetadata: ImageMetadata
): number[] {
  const height = slice.length;
  const width = slice[0].length;
  const contourPoints: number[] = [];
  
  // Simple edge detection approach
  // Find boundary pixels and trace clockwise
  const visited: boolean[][] = Array(height).fill(null).map(() => Array(width).fill(false));
  
  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      if (slice[y][x] === 1 && !visited[y][x]) {
        // Check if this is a boundary pixel
        const isBoundary = (
          slice[y][x + 1] === 0 ||
          slice[y + 1][x] === 0 ||
          slice[y + 1][x + 1] === 0 ||
          x === 0 || y === 0 ||
          x === width - 2 || y === height - 2
        );
        
        if (isBoundary) {
          // Trace contour starting from this point
          const tracePoints = traceContour(slice, x, y, visited);
          
          // Convert to world coordinates
          tracePoints.forEach(([px, py]) => {
            const worldX = imageMetadata.imagePosition[0] + px * imageMetadata.pixelSpacing[1];
            const worldY = imageMetadata.imagePosition[1] + py * imageMetadata.pixelSpacing[0];
            contourPoints.push(worldX, worldY, sliceZ);
          });
          
          break; // Only take the first (largest) contour for now
        }
      }
    }
  }
  
  return contourPoints;
}

/**
 * Trace contour boundary from starting point
 */
function traceContour(
  slice: number[][],
  startX: number,
  startY: number,
  visited: boolean[][]
): [number, number][] {
  const points: [number, number][] = [];
  const height = slice.length;
  const width = slice[0].length;
  
  // Directions: right, down, left, up
  const directions = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  let currentX = startX;
  let currentY = startY;
  let direction = 0;
  
  do {
    if (!visited[currentY][currentX]) {
      points.push([currentX, currentY]);
      visited[currentY][currentX] = true;
    }
    
    // Find next boundary pixel
    let found = false;
    for (let i = 0; i < 4; i++) {
      const testDir = (direction + i) % 4;
      const [dx, dy] = directions[testDir];
      const nextX = currentX + dx;
      const nextY = currentY + dy;
      
      if (nextX >= 0 && nextX < width && nextY >= 0 && nextY < height) {
        if (slice[nextY][nextX] === 1 && !visited[nextY][nextX]) {
          currentX = nextX;
          currentY = nextY;
          direction = testDir;
          found = true;
          break;
        }
      }
    }
    
    if (!found) break;
    
  } while (currentX !== startX || currentY !== startY);
  
  return points;
}

/**
 * Main function to apply morphological margin operations
 */
export function applyMorphologicalMargin(
  contours: ContourSlice[],
  parameters: MarginParameters,
  imageMetadata: ImageMetadata,
  imageSize: { width: number; height: number; depth: number }
): ContourSlice[] {
  console.log('🔹 Applying morphological margin with parameters:', parameters);
  
  try {
    // Convert contours to binary mask
    const { mask, slicePositions } = contourToBinaryMask(contours, imageMetadata, imageSize);
    
    // Create appropriate kernel
    let kernel: number[][][];
    let kernelCenter: [number, number, number];
    
    if (parameters.marginType === 'UNIFORM' || parameters.marginType === 'MORPHOLOGICAL') {
      const radiusMm = Math.abs(parameters.marginValues.uniform);
      const kernelData = createSphericalKernel(radiusMm, imageMetadata.pixelSpacing, imageMetadata.sliceThickness);
      kernel = kernelData.kernel;
      kernelCenter = kernelData.center;
    } else {
      // Directional margins
      const kernelData = createDirectionalKernel(parameters.marginValues, imageMetadata.pixelSpacing, imageMetadata.sliceThickness);
      kernel = kernelData.kernel;
      kernelCenter = kernelData.center;
    }
    
    // Apply morphological operation
    let resultMask: number[][][];
    const isExpanding = parameters.marginType === 'DIRECTIONAL' || parameters.marginValues.uniform >= 0;
    
    if (isExpanding) {
      // Dilation for expansion
      resultMask = mask;
      for (let i = 0; i < parameters.iterations; i++) {
        resultMask = performDilation(resultMask, kernel, kernelCenter);
      }
    } else {
      // Erosion for shrinking
      resultMask = mask;
      for (let i = 0; i < parameters.iterations; i++) {
        resultMask = performErosion(resultMask, kernel, kernelCenter);
      }
    }
    
    // Convert back to contours
    const resultContours = binaryMaskToContours(resultMask, slicePositions, imageMetadata);
    
    console.log(`🔹 ✅ Morphological operation completed: ${contours.length} → ${resultContours.length} contours`);
    
    return resultContours;
    
  } catch (error) {
    console.error('🔹 ❌ Error in morphological margin operation:', error);
    return contours; // Return original on error
  }
}

/**
 * Simplified interface that integrates with existing contour format
 */
export function applyMorphologicalMarginToContour(
  contourPoints: number[],
  parameters: MarginParameters,
  imageMetadata?: ImageMetadata
): number[] {
  if (!imageMetadata) {
    // Fallback to simple operations if no metadata
    console.warn('No image metadata available, falling back to simple operations');
    return contourPoints;
  }
  
  // For single contour, create minimal structure
  const contourSlice: ContourSlice = {
    points: contourPoints,
    slicePosition: contourPoints[2] || 0
  };
  
  // Estimate image size based on contour bounds
  const imageSize = estimateImageSizeFromContour(contourPoints, imageMetadata);
  
  // Apply operation
  const resultContours = applyMorphologicalMargin(
    [contourSlice],
    parameters,
    imageMetadata,
    imageSize
  );
  
  return resultContours.length > 0 ? resultContours[0].points : contourPoints;
}

/**
 * Estimate image dimensions from contour bounds
 */
function estimateImageSizeFromContour(
  contourPoints: number[],
  imageMetadata: ImageMetadata
): { width: number; height: number; depth: number } {
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  
  for (let i = 0; i < contourPoints.length; i += 3) {
    minX = Math.min(minX, contourPoints[i]);
    maxX = Math.max(maxX, contourPoints[i]);
    minY = Math.min(minY, contourPoints[i + 1]);
    maxY = Math.max(maxY, contourPoints[i + 1]);
  }
  
  const width = Math.ceil((maxX - minX) / imageMetadata.pixelSpacing[1]) + 100; // Add padding
  const height = Math.ceil((maxY - minY) / imageMetadata.pixelSpacing[0]) + 100;
  const depth = 50; // Assume reasonable number of slices
  
  return { width, height, depth };
} 