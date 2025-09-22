// Proper Morphological Margin Operations
// Based on ITK/medical imaging standards using binary masks and spherical kernels
// Implements true dilation/erosion instead of polygon buffering

export interface ImageMetadata {
  pixelSpacing: [number, number];    // [row spacing, column spacing] in mm/pixel
  sliceThickness: number;            // mm/slice
  imagePosition: [number, number, number]; // World coordinates origin [x, y, z]
  imageSize: { width: number; height: number; depth: number };
}

export interface Contour3D {
  points: number[];        // [x1, y1, z1, x2, y2, z2, ...]
  slicePosition: number;   // Z position in world coordinates
}

/**
 * Apply proper morphological margin using binary masks and spherical kernels
 * Based on ITK/medical imaging standards
 */
export async function applyProperMorphologicalMargin(
  contours: Contour3D[],
  marginMm: number,
  imageMetadata: ImageMetadata
): Promise<Contour3D[]> {
  
  console.log('🔹 🧬 Starting proper morphological margin operation:', {
    marginMm,
    contourCount: contours.length,
    imageMetadata: {
      pixelSpacing: imageMetadata.pixelSpacing,
      sliceThickness: imageMetadata.sliceThickness,
      imageSize: imageMetadata.imageSize
    }
  });

  try {
    // Step 1: Convert contours to 3D binary mask
    const binaryMask = await contoursToBinaryMask(contours, imageMetadata);
    console.log('🔹 📊 Created binary mask with dimensions:', binaryMask.dimensions);

    // Step 2: Create spherical kernel for morphological operations
    const kernel = createSphericalKernel(marginMm, imageMetadata);
    console.log('🔹 ⚪ Created spherical kernel with dimensions:', kernel.dimensions);

    // Step 3: Apply morphological operation (dilation for expansion, erosion for shrinkage)
    let resultMask: BinaryMask3D;
    if (marginMm >= 0) {
      console.log('🔹 ➕ Applying binary dilation for expansion');
      resultMask = performBinaryDilation(binaryMask, kernel);
    } else {
      console.log('🔹 ➖ Applying binary erosion for shrinkage');
      resultMask = performBinaryErosion(binaryMask, kernel);
    }

    // Step 4: Extract contours from result mask using marching cubes
    const resultContours = await binaryMaskToContours(resultMask, imageMetadata);
    console.log(`🔹 ✅ Morphological operation completed: ${contours.length} → ${resultContours.length} contours`);

    return resultContours;

  } catch (error) {
    console.error('🔹 ❌ Morphological margin operation failed:', error);
    throw error;
  }
}

/**
 * 3D Binary mask structure
 */
interface BinaryMask3D {
  data: Uint8Array;           // Flattened binary data (0 or 1)
  dimensions: [number, number, number]; // [width, height, depth]
  spacing: [number, number, number];    // [x_spacing, y_spacing, z_spacing] in mm
  origin: [number, number, number];     // World coordinates origin
}

/**
 * Spherical kernel structure
 */
interface SphericalKernel3D {
  data: Uint8Array;           // Flattened binary kernel (0 or 1)
  dimensions: [number, number, number]; // [width, height, depth]
  center: [number, number, number];     // Kernel center coordinates
}

/**
 * Convert contours to 3D binary mask
 * Mathematical: Creates binary volume where interior = 1, exterior = 0
 */
async function contoursToBinaryMask(
  contours: Contour3D[],
  imageMetadata: ImageMetadata
): Promise<BinaryMask3D> {
  
  const { width, height, depth } = imageMetadata.imageSize;
  const { pixelSpacing, sliceThickness, imagePosition } = imageMetadata;
  
  // Create binary mask array
  const data = new Uint8Array(width * height * depth);
  data.fill(0); // Initialize with background (0)
  
  console.log(`🔹 📊 Processing ${contours.length} contours to binary mask`);
  
  // Process each contour slice
  for (const contour of contours) {
    const sliceIndex = Math.round((contour.slicePosition - imagePosition[2]) / sliceThickness);
    
    if (sliceIndex >= 0 && sliceIndex < depth) {
      // Convert world coordinates to pixel coordinates
      const pixelPoints: [number, number][] = [];
      
      for (let i = 0; i < contour.points.length; i += 3) {
        const worldX = contour.points[i];
        const worldY = contour.points[i + 1];
        
        // Convert to pixel coordinates
        const pixelX = Math.round((worldX - imagePosition[0]) / pixelSpacing[1]);
        const pixelY = Math.round((worldY - imagePosition[1]) / pixelSpacing[0]);
        
        if (pixelX >= 0 && pixelX < width && pixelY >= 0 && pixelY < height) {
          pixelPoints.push([pixelX, pixelY]);
        }
      }
      
      // Fill polygon interior using scanline algorithm
      if (pixelPoints.length >= 3) {
        fillPolygonInSlice(data, pixelPoints, width, height, sliceIndex, width * height);
      }
    }
  }
  
  return {
    data,
    dimensions: [width, height, depth],
    spacing: [pixelSpacing[1], pixelSpacing[0], sliceThickness],
    origin: imagePosition
  };
}

/**
 * Fill polygon interior in a single slice using scanline algorithm
 * Mathematical: Point-in-polygon test using ray casting
 */
function fillPolygonInSlice(
  data: Uint8Array,
  polygon: [number, number][],
  width: number,
  height: number,
  sliceIndex: number,
  sliceSize: number
): void {
  
  if (polygon.length < 3) return;
  
  const sliceOffset = sliceIndex * sliceSize;
  const minY = Math.max(0, Math.min(...polygon.map(p => p[1])));
  const maxY = Math.min(height - 1, Math.max(...polygon.map(p => p[1])));
  
  // Scanline fill algorithm
  for (let y = minY; y <= maxY; y++) {
    const intersections: number[] = [];
    
    // Find intersections with polygon edges
    for (let i = 0; i < polygon.length; i++) {
      const p1 = polygon[i];
      const p2 = polygon[(i + 1) % polygon.length];
      
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
          const index = sliceOffset + y * width + x;
          data[index] = 1; // Mark as foreground
        }
      }
    }
  }
}

/**
 * Create spherical kernel for morphological operations
 * Mathematical: S = {(x,y,z) | x²/rx² + y²/ry² + z²/rz² ≤ 1}
 */
function createSphericalKernel(
  radiusMm: number,
  imageMetadata: ImageMetadata
): SphericalKernel3D {
  
  const { pixelSpacing, sliceThickness } = imageMetadata;
  const absRadius = Math.abs(radiusMm);
  
  // Convert radius from mm to pixels in each direction
  const radiusX = Math.ceil(absRadius / pixelSpacing[1]); // Column spacing
  const radiusY = Math.ceil(absRadius / pixelSpacing[0]); // Row spacing
  const radiusZ = Math.ceil(absRadius / sliceThickness);
  
  // Ensure odd dimensions for symmetric kernel
  const dimX = radiusX * 2 + 1;
  const dimY = radiusY * 2 + 1;
  const dimZ = radiusZ * 2 + 1;
  
  console.log('🔹 ⚪ Creating spherical kernel:', {
    radiusMm: absRadius,
    radiusPixels: [radiusX, radiusY, radiusZ],
    dimensions: [dimX, dimY, dimZ],
    pixelSpacing,
    sliceThickness
  });
  
  // Create kernel data
  const data = new Uint8Array(dimX * dimY * dimZ);
  const centerX = radiusX;
  const centerY = radiusY;
  const centerZ = radiusZ;
  
  // Fill spherical kernel
  for (let z = 0; z < dimZ; z++) {
    for (let y = 0; y < dimY; y++) {
      for (let x = 0; x < dimX; x++) {
        // Calculate offset from center in world coordinates (mm)
        const offsetX = (x - centerX) * pixelSpacing[1];
        const offsetY = (y - centerY) * pixelSpacing[0];
        const offsetZ = (z - centerZ) * sliceThickness;
        
        // Calculate Euclidean distance in mm
        const distance = Math.sqrt(offsetX * offsetX + offsetY * offsetY + offsetZ * offsetZ);
        
        // Include point if within radius
        const index = z * dimY * dimX + y * dimX + x;
        data[index] = distance <= absRadius ? 1 : 0;
      }
    }
  }
  
  return {
    data,
    dimensions: [dimX, dimY, dimZ],
    center: [centerX, centerY, centerZ]
  };
}

/**
 * Perform binary dilation
 * Mathematical: (A ⊕ B)(x,y,z) = max{A(x-i,y-j,z-k) | B(i,j,k) = 1}
 */
function performBinaryDilation(
  mask: BinaryMask3D,
  kernel: SphericalKernel3D
): BinaryMask3D {
  
  const [maskW, maskH, maskD] = mask.dimensions;
  const [kernelW, kernelH, kernelD] = kernel.dimensions;
  const [centerX, centerY, centerZ] = kernel.center;
  
  // Create result mask
  const resultData = new Uint8Array(maskW * maskH * maskD);
  resultData.fill(0);
  
  console.log('🔹 ⚡ Performing binary dilation...');
  
  // Apply dilation operation
  for (let z = 0; z < maskD; z++) {
    for (let y = 0; y < maskH; y++) {
      for (let x = 0; x < maskW; x++) {
        let maxValue = 0;
        
        // Check kernel footprint
        for (let kz = 0; kz < kernelD; kz++) {
          for (let ky = 0; ky < kernelH; ky++) {
            for (let kx = 0; kx < kernelW; kx++) {
              const kernelIndex = kz * kernelH * kernelW + ky * kernelW + kx;
              
              if (kernel.data[kernelIndex] === 1) {
                // Calculate source position
                const sourceX = x - (kx - centerX);
                const sourceY = y - (ky - centerY);
                const sourceZ = z - (kz - centerZ);
                
                // Check bounds
                if (sourceX >= 0 && sourceX < maskW &&
                    sourceY >= 0 && sourceY < maskH &&
                    sourceZ >= 0 && sourceZ < maskD) {
                  
                  const sourceIndex = sourceZ * maskH * maskW + sourceY * maskW + sourceX;
                  maxValue = Math.max(maxValue, mask.data[sourceIndex]);
                }
              }
            }
          }
        }
        
        const resultIndex = z * maskH * maskW + y * maskW + x;
        resultData[resultIndex] = maxValue;
      }
    }
  }
  
  return {
    data: resultData,
    dimensions: mask.dimensions,
    spacing: mask.spacing,
    origin: mask.origin
  };
}

/**
 * Perform binary erosion
 * Mathematical: (A ⊖ B)(x,y,z) = min{A(x+i,y+j,z+k) | B(i,j,k) = 1}
 */
function performBinaryErosion(
  mask: BinaryMask3D,
  kernel: SphericalKernel3D
): BinaryMask3D {
  
  const [maskW, maskH, maskD] = mask.dimensions;
  const [kernelW, kernelH, kernelD] = kernel.dimensions;
  const [centerX, centerY, centerZ] = kernel.center;
  
  // Create result mask
  const resultData = new Uint8Array(maskW * maskH * maskD);
  resultData.fill(0);
  
  console.log('🔹 ⚡ Performing binary erosion...');
  
  // Apply erosion operation
  for (let z = 0; z < maskD; z++) {
    for (let y = 0; y < maskH; y++) {
      for (let x = 0; x < maskW; x++) {
        let minValue = 1;
        
        // Check if entire kernel fits within foreground
        for (let kz = 0; kz < kernelD; kz++) {
          for (let ky = 0; ky < kernelH; ky++) {
            for (let kx = 0; kx < kernelW; kx++) {
              const kernelIndex = kz * kernelH * kernelW + ky * kernelW + kx;
              
              if (kernel.data[kernelIndex] === 1) {
                // Calculate source position
                const sourceX = x + (kx - centerX);
                const sourceY = y + (ky - centerY);
                const sourceZ = z + (kz - centerZ);
                
                // Check bounds and value
                if (sourceX < 0 || sourceX >= maskW ||
                    sourceY < 0 || sourceY >= maskH ||
                    sourceZ < 0 || sourceZ >= maskD) {
                  minValue = 0; // Outside bounds considered background
                } else {
                  const sourceIndex = sourceZ * maskH * maskW + sourceY * maskW + sourceX;
                  minValue = Math.min(minValue, mask.data[sourceIndex]);
                }
              }
            }
          }
        }
        
        const resultIndex = z * maskH * maskW + y * maskW + x;
        resultData[resultIndex] = minValue;
      }
    }
  }
  
  return {
    data: resultData,
    dimensions: mask.dimensions,
    spacing: mask.spacing,
    origin: mask.origin
  };
}

/**
 * Extract contours from binary mask using marching cubes approach
 */
async function binaryMaskToContours(
  mask: BinaryMask3D,
  imageMetadata: ImageMetadata
): Promise<Contour3D[]> {
  
  const [width, height, depth] = mask.dimensions;
  const { pixelSpacing, sliceThickness, imagePosition } = imageMetadata;
  const contours: Contour3D[] = [];
  
  console.log('🔹 📊 Extracting contours from binary mask...');
  
  // Extract contours slice by slice using edge detection
  for (let z = 0; z < depth; z++) {
    const sliceContours = extractContoursFromSlice(
      mask.data,
      z,
      width,
      height,
      depth,
      imagePosition,
      pixelSpacing,
      sliceThickness
    );
    
    contours.push(...sliceContours);
  }
  
  console.log(`🔹 ✅ Extracted ${contours.length} contours from binary mask`);
  return contours;
}

/**
 * Extract contours from a single slice using edge detection
 */
function extractContoursFromSlice(
  maskData: Uint8Array,
  sliceIndex: number,
  width: number,
  height: number,
  depth: number,
  imagePosition: [number, number, number],
  pixelSpacing: [number, number],
  sliceThickness: number
): Contour3D[] {
  
  const sliceOffset = sliceIndex * width * height;
  const worldZ = imagePosition[2] + sliceIndex * sliceThickness;
  const contours: Contour3D[] = [];
  
  // Find edge pixels using 4-connectivity
  const edgePixels: [number, number][] = [];
  
  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      const index = sliceOffset + y * width + x;
      
      if (maskData[index] === 1) {
        // Check if this is a boundary pixel
        const neighbors = [
          maskData[sliceOffset + y * width + (x + 1)],       // Right
          maskData[sliceOffset + (y + 1) * width + x],       // Down
          maskData[sliceOffset + y * width + (x - 1)],       // Left
          maskData[sliceOffset + (y - 1) * width + x]        // Up
        ];
        
        // If any neighbor is background, this is an edge pixel
        if (neighbors.some(val => val === 0) || x === 0 || y === 0 || x === width - 1 || y === height - 1) {
          edgePixels.push([x, y]);
        }
      }
    }
  }
  
  if (edgePixels.length < 3) {
    return [];
  }
  
  // Convert edge pixels to world coordinates and create contour
  const worldPoints: number[] = [];
  
  for (const [pixelX, pixelY] of edgePixels) {
    const worldX = imagePosition[0] + pixelX * pixelSpacing[1];
    const worldY = imagePosition[1] + pixelY * pixelSpacing[0];
    worldPoints.push(worldX, worldY, worldZ);
  }
  
  if (worldPoints.length >= 9) {
    contours.push({
      points: worldPoints,
      slicePosition: worldZ
    });
  }
  
  return contours;
}

/**
 * Simplified interface for single contour operation
 */
export async function applyProperMorphologicalMarginToSingleContour(
  contourPoints: number[],
  marginMm: number,
  imageMetadata: ImageMetadata
): Promise<number[]> {
  
  if (!contourPoints || contourPoints.length < 9) {
    return contourPoints;
  }

  const contour: Contour3D = {
    points: contourPoints,
    slicePosition: contourPoints[2] || 0
  };

  const resultContours = await applyProperMorphologicalMargin(
    [contour],
    marginMm,
    imageMetadata
  );

  return resultContours.length > 0 ? resultContours[0].points : contourPoints;
} 