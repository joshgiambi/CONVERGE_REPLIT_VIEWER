// True 3D Margin Operations
// Implements proper spherical expansion by treating the entire structure as a 3D volume
// This replaces the slice-by-slice 2D approach with true 3D radial expansion

import { MarginParameters } from './morphological-margin-operations';

export interface Structure3D {
  contours: Array<{
    points: number[];           // [x1, y1, z1, x2, y2, z2, ...]
    slicePosition: number;      // Z position in world coordinates
  }>;
  boundingBox: {
    min: [number, number, number];
    max: [number, number, number];
  };
}

export interface ImageMetadata3D {
  pixelSpacing: [number, number];    // [row spacing, column spacing] in mm
  sliceThickness: number;            // mm
  imagePosition: [number, number, number]; // World coordinates origin
  imageSize: { width: number; height: number; depth: number };
}

/**
 * Apply true 3D radial margin expansion to an entire structure
 * Uses distance field approach for accurate spherical expansion
 */
export async function applyTrue3DMargin(
  structure: Structure3D,
  marginMm: number,
  imageMetadata: ImageMetadata3D
): Promise<Structure3D> {
  console.log('🔹 🌐 Starting true 3D margin operation:', {
    marginMm,
    contourCount: structure.contours.length,
    imageMetadata: {
      pixelSpacing: imageMetadata.pixelSpacing,
      sliceThickness: imageMetadata.sliceThickness,
      imageSize: imageMetadata.imageSize
    }
  });

  try {
    // Step 1: Convert structure to 3D distance field
    const distanceField = await createDistanceField(structure, imageMetadata);
    
    // Step 2: Apply spherical expansion/contraction
    const expandedField = applySphericalMargin(distanceField, marginMm, imageMetadata);
    
    // Step 3: Extract contours from expanded distance field
    const expandedStructure = await extractContoursFromField(expandedField, imageMetadata);
    
    console.log('🔹 ✅ True 3D margin operation completed:', {
      inputContours: structure.contours.length,
      outputContours: expandedStructure.contours.length,
      marginApplied: marginMm
    });
    
    return expandedStructure;
    
  } catch (error) {
    console.error('🔹 ❌ True 3D margin operation failed:', error);
    throw error;
  }
}

/**
 * Create 3D distance field from structure contours
 * Each voxel contains the signed distance to the nearest surface
 */
async function createDistanceField(
  structure: Structure3D,
  imageMetadata: ImageMetadata3D
): Promise<{
  field: number[][][];
  dimensions: [number, number, number];
  origin: [number, number, number];
  spacing: [number, number, number];
}> {
  const { imageSize, pixelSpacing, sliceThickness, imagePosition } = imageMetadata;
  const { width, height, depth } = imageSize;
  
  // Initialize distance field with large positive values (outside)
  const field: number[][][] = Array(depth).fill(null).map(() =>
    Array(height).fill(null).map(() => Array(width).fill(Infinity))
  );
  
  console.log('🔹 📊 Creating distance field with dimensions:', [width, height, depth]);
  
  // Process each contour slice
  for (const contour of structure.contours) {
    const sliceIndex = Math.round((contour.slicePosition - imagePosition[2]) / sliceThickness);
    
    if (sliceIndex >= 0 && sliceIndex < depth) {
      // Convert world coordinates to pixel coordinates
      const pixelContour: [number, number][] = [];
      
      for (let i = 0; i < contour.points.length; i += 3) {
        const worldX = contour.points[i];
        const worldY = contour.points[i + 1];
        
        const pixelX = Math.round((worldX - imagePosition[0]) / pixelSpacing[1]);
        const pixelY = Math.round((worldY - imagePosition[1]) / pixelSpacing[0]);
        
        if (pixelX >= 0 && pixelX < width && pixelY >= 0 && pixelY < height) {
          pixelContour.push([pixelX, pixelY]);
        }
      }
      
      // Fill inside region with negative distances
      if (pixelContour.length >= 3) {
        fillContourInSlice(field[sliceIndex], pixelContour, width, height);
      }
    }
  }
  
  // Compute true distance field using Euclidean distance transform
  computeEuclideanDistanceTransform(field, pixelSpacing, sliceThickness);
  
  return {
    field,
    dimensions: [width, height, depth],
    origin: imagePosition,
    spacing: [pixelSpacing[1], pixelSpacing[0], sliceThickness]
  };
}

/**
 * Fill contour region in a single slice
 */
function fillContourInSlice(
  slice: number[][],
  contour: [number, number][],
  width: number,
  height: number
): void {
  if (contour.length < 3) return;
  
  // Use scanline fill algorithm
  const minY = Math.max(0, Math.min(...contour.map(p => p[1])));
  const maxY = Math.min(height - 1, Math.max(...contour.map(p => p[1])));
  
  for (let y = minY; y <= maxY; y++) {
    const intersections: number[] = [];
    
    // Find intersections with contour edges
    for (let i = 0; i < contour.length; i++) {
      const p1 = contour[i];
      const p2 = contour[(i + 1) % contour.length];
      
      if ((p1[1] <= y && p2[1] > y) || (p2[1] <= y && p1[1] > y)) {
        const x = p1[0] + (y - p1[1]) * (p2[0] - p1[0]) / (p2[1] - p1[1]);
        intersections.push(Math.round(x));
      }
    }
    
    // Sort and fill between pairs
    intersections.sort((a, b) => a - b);
    for (let i = 0; i < intersections.length; i += 2) {
      if (i + 1 < intersections.length) {
        const x1 = Math.max(0, intersections[i]);
        const x2 = Math.min(width - 1, intersections[i + 1]);
        for (let x = x1; x <= x2; x++) {
          slice[y][x] = -1; // Mark as inside
        }
      }
    }
  }
}

/**
 * Compute Euclidean distance transform to get true distances
 */
function computeEuclideanDistanceTransform(
  field: number[][][],
  pixelSpacing: [number, number],
  sliceThickness: number
): void {
  const [depth, height, width] = [field.length, field[0].length, field[0][0].length];
  
  // For each voxel, compute distance to nearest surface
  for (let z = 0; z < depth; z++) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (field[z][y][x] === Infinity) {
          // Outside point - find distance to nearest inside point
          let minDist = Infinity;
          
          // Search in a reasonable radius
          const searchRadius = 20; // pixels
          for (let dz = -searchRadius; dz <= searchRadius; dz++) {
            for (let dy = -searchRadius; dy <= searchRadius; dy++) {
              for (let dx = -searchRadius; dx <= searchRadius; dx++) {
                const nz = z + dz;
                const ny = y + dy;
                const nx = x + dx;
                
                if (nz >= 0 && nz < depth && ny >= 0 && ny < height && nx >= 0 && nx < width) {
                  if (field[nz][ny][nx] < 0) { // Inside point
                    // Calculate real-world distance
                    const realDx = dx * pixelSpacing[1];
                    const realDy = dy * pixelSpacing[0];
                    const realDz = dz * sliceThickness;
                    const dist = Math.sqrt(realDx*realDx + realDy*realDy + realDz*realDz);
                    minDist = Math.min(minDist, dist);
                  }
                }
              }
            }
          }
          
          field[z][y][x] = minDist === Infinity ? 50 : minDist; // Outside distance in mm
        } else if (field[z][y][x] < 0) {
          // Inside point - find distance to nearest outside point
          let minDist = Infinity;
          
          const searchRadius = 20;
          for (let dz = -searchRadius; dz <= searchRadius; dz++) {
            for (let dy = -searchRadius; dy <= searchRadius; dy++) {
              for (let dx = -searchRadius; dx <= searchRadius; dx++) {
                const nz = z + dz;
                const ny = y + dy;
                const nx = x + dx;
                
                if (nz >= 0 && nz < depth && ny >= 0 && ny < height && nx >= 0 && nx < width) {
                  if (field[nz][ny][nx] > 0) { // Outside point
                    const realDx = dx * pixelSpacing[1];
                    const realDy = dy * pixelSpacing[0];
                    const realDz = dz * sliceThickness;
                    const dist = Math.sqrt(realDx*realDx + realDy*realDy + realDz*realDz);
                    minDist = Math.min(minDist, dist);
                  }
                }
              }
            }
          }
          
          field[z][y][x] = minDist === Infinity ? -50 : -minDist; // Inside distance in mm (negative)
        }
      }
    }
  }
}

/**
 * Apply spherical margin to distance field
 */
function applySphericalMargin(
  distanceField: {
    field: number[][][];
    dimensions: [number, number, number];
    origin: [number, number, number];
    spacing: [number, number, number];
  },
  marginMm: number,
  imageMetadata: ImageMetadata3D
): typeof distanceField {
  console.log('🔹 ⚪ Applying spherical margin:', marginMm, 'mm');
  
  const { field, dimensions, origin, spacing } = distanceField;
  const [width, height, depth] = dimensions;
  
  // Create new field with margin applied
  const expandedField: number[][][] = Array(depth).fill(null).map(() =>
    Array(height).fill(null).map(() => Array(width).fill(0))
  );
  
  // Apply margin by shifting the iso-surface
  for (let z = 0; z < depth; z++) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        // Shift distance by margin amount
        expandedField[z][y][x] = field[z][y][x] - marginMm;
      }
    }
  }
  
  return {
    field: expandedField,
    dimensions,
    origin,
    spacing
  };
}

/**
 * Extract contours from distance field using marching cubes approach
 */
async function extractContoursFromField(
  distanceField: {
    field: number[][][];
    dimensions: [number, number, number];
    origin: [number, number, number];
    spacing: [number, number, number];
  },
  imageMetadata: ImageMetadata3D
): Promise<Structure3D> {
  const { field, dimensions, origin, spacing } = distanceField;
  const [width, height, depth] = dimensions;
  
  const contours: Array<{
    points: number[];
    slicePosition: number;
  }> = [];
  
  console.log('🔹 📊 Extracting contours from distance field...');
  
  // Extract contours slice by slice using marching squares on the zero iso-surface
  for (let z = 0; z < depth; z++) {
    const sliceContours = extractContoursFromSlice(field[z], z, origin, spacing);
    contours.push(...sliceContours);
  }
  
  // Calculate new bounding box
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  
  for (const contour of contours) {
    for (let i = 0; i < contour.points.length; i += 3) {
      const x = contour.points[i];
      const y = contour.points[i + 1];
      const z = contour.points[i + 2];
      
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
  }
  
  return {
    contours,
    boundingBox: {
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ]
    }
  };
}

/**
 * Extract contours from a single slice using marching squares
 */
function extractContoursFromSlice(
  slice: number[][],
  sliceIndex: number,
  origin: [number, number, number],
  spacing: [number, number, number]
): Array<{ points: number[]; slicePosition: number }> {
  const height = slice.length;
  const width = slice[0].length;
  const contours: Array<{ points: number[]; slicePosition: number }> = [];
  
  const visited: boolean[][] = Array(height).fill(null).map(() => Array(width).fill(false));
  
  // Find zero crossings (surface intersections)
  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      // Check for zero crossing in this 2x2 cell
      const vals = [
        slice[y][x],
        slice[y][x + 1],
        slice[y + 1][x],
        slice[y + 1][x + 1]
      ];
      
      const hasPositive = vals.some(v => v > 0);
      const hasNegative = vals.some(v => v < 0);
      
      if (hasPositive && hasNegative && !visited[y][x]) {
        // This cell contains the surface - trace contour
        const contourPoints = traceContourFromCell(slice, x, y, visited);
        
        if (contourPoints.length >= 3) {
          // Convert to world coordinates
          const worldPoints: number[] = [];
          const worldZ = origin[2] + sliceIndex * spacing[2];
          
          for (const [px, py] of contourPoints) {
            const worldX = origin[0] + px * spacing[0];
            const worldY = origin[1] + py * spacing[1];
            worldPoints.push(worldX, worldY, worldZ);
          }
          
          contours.push({
            points: worldPoints,
            slicePosition: worldZ
          });
        }
      }
    }
  }
  
  return contours;
}

/**
 * Trace contour from a cell using simple edge following
 */
function traceContourFromCell(
  slice: number[][],
  startX: number,
  startY: number,
  visited: boolean[][]
): [number, number][] {
  const height = slice.length;
  const width = slice[0].length;
  const points: [number, number][] = [];
  
  // Simple contour tracing - find boundary between positive and negative regions
  const directions = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  let currentX = startX;
  let currentY = startY;
  let direction = 0;
  
  do {
    if (!visited[currentY][currentX]) {
      points.push([currentX + 0.5, currentY + 0.5]); // Center of cell
      visited[currentY][currentX] = true;
    }
    
    // Find next cell along boundary
    let found = false;
    for (let i = 0; i < 4; i++) {
      const testDir = (direction + i) % 4;
      const [dx, dy] = directions[testDir];
      const nextX = currentX + dx;
      const nextY = currentY + dy;
      
      if (nextX >= 0 && nextX < width - 1 && nextY >= 0 && nextY < height - 1) {
        // Check if this cell also contains a zero crossing
        const vals = [
          slice[nextY][nextX],
          slice[nextY][nextX + 1],
          slice[nextY + 1][nextX],
          slice[nextY + 1][nextX + 1]
        ];
        
        const hasPositive = vals.some(v => v > 0);
        const hasNegative = vals.some(v => v < 0);
        
        if (hasPositive && hasNegative && !visited[nextY][nextX]) {
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
 * Simplified interface for single contour margin operation
 */
export async function applyTrue3DMarginToContour(
  contourPoints: number[],
  marginMm: number,
  imageMetadata: ImageMetadata3D
): Promise<number[]> {
  // Create minimal structure from single contour
  const structure: Structure3D = {
    contours: [{
      points: contourPoints,
      slicePosition: contourPoints[2] || 0
    }],
    boundingBox: {
      min: [0, 0, 0],
      max: [100, 100, 100] // Will be calculated properly
    }
  };
  
  const result = await applyTrue3DMargin(structure, marginMm, imageMetadata);
  
  // Return first contour's points, or original if no result
  return result.contours.length > 0 ? result.contours[0].points : contourPoints;
} 