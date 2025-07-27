// Multiplanar Reconstruction (MPR) utilities for generating sagittal and coronal views

interface ImageMetadata {
  imagePosition: number[];
  pixelSpacing: number[];
  imageOrientation: number[];
  rows: number;
  columns: number;
  sliceLocation: number;
}

interface MPRData {
  pixelData: Uint16Array;
  width: number;
  height: number;
  metadata: {
    pixelSpacing: number[];
    origin: number[];
    orientation: 'sagittal' | 'coronal';
  };
}

/**
 * Generate a sagittal view from a stack of axial images
 * Sagittal = looking from the side (left/right)
 * Extract a vertical slice through the X axis
 */
export function generateSagittalView(
  images: any[],
  pixelDataCache: Map<number, Uint16Array>,
  xPosition: number // Position along the X axis (0-511)
): MPRData | null {
  if (!images.length || !pixelDataCache.size) return null;

  // Sort images by Z position
  const sortedImages = [...images].sort((a, b) => {
    const zA = a.imagePosition?.[2] || a.sliceLocation || 0;
    const zB = b.imagePosition?.[2] || b.sliceLocation || 0;
    return zA - zB;
  });

  // Get dimensions from first image
  const firstImage = sortedImages[0];
  const rows = firstImage.rows || 512;
  const columns = firstImage.columns || 512;
  const pixelSpacing = firstImage.pixelSpacing || [1, 1];
  
  // Calculate slice thickness (average distance between slices)
  const sliceThickness = calculateSliceThickness(sortedImages);
  
  // Output dimensions: height = original rows, width = number of slices
  const outputHeight = rows;
  const outputWidth = sortedImages.length;
  const outputData = new Uint16Array(outputWidth * outputHeight);

  // Extract sagittal slice
  for (let z = 0; z < sortedImages.length; z++) {
    const image = sortedImages[z];
    const pixelData = pixelDataCache.get(images.indexOf(image));
    
    if (!pixelData) continue;

    // Extract column at xPosition for this slice
    for (let y = 0; y < rows; y++) {
      const sourceIndex = y * columns + Math.floor(xPosition);
      const destIndex = y * outputWidth + z;
      outputData[destIndex] = pixelData[sourceIndex] || 0;
    }
  }

  return {
    pixelData: outputData,
    width: outputWidth,
    height: outputHeight,
    metadata: {
      pixelSpacing: [sliceThickness, pixelSpacing[0]], // [z spacing, y spacing]
      origin: [xPosition * pixelSpacing[1], firstImage.imagePosition[1], firstImage.imagePosition[2]],
      orientation: 'sagittal'
    }
  };
}

/**
 * Generate a coronal view from a stack of axial images
 * Coronal = looking from the front/back
 * Extract a horizontal slice through the Y axis
 */
export function generateCoronalView(
  images: any[],
  pixelDataCache: Map<number, Uint16Array>,
  yPosition: number // Position along the Y axis (0-511)
): MPRData | null {
  if (!images.length || !pixelDataCache.size) return null;

  // Sort images by Z position
  const sortedImages = [...images].sort((a, b) => {
    const zA = a.imagePosition?.[2] || a.sliceLocation || 0;
    const zB = b.imagePosition?.[2] || b.sliceLocation || 0;
    return zA - zB;
  });

  // Get dimensions from first image
  const firstImage = sortedImages[0];
  const rows = firstImage.rows || 512;
  const columns = firstImage.columns || 512;
  const pixelSpacing = firstImage.pixelSpacing || [1, 1];
  
  // Calculate slice thickness
  const sliceThickness = calculateSliceThickness(sortedImages);
  
  // Output dimensions: height = number of slices, width = original columns
  const outputHeight = sortedImages.length;
  const outputWidth = columns;
  const outputData = new Uint16Array(outputWidth * outputHeight);

  // Extract coronal slice
  for (let z = 0; z < sortedImages.length; z++) {
    const image = sortedImages[z];
    const pixelData = pixelDataCache.get(images.indexOf(image));
    
    if (!pixelData) continue;

    // Extract row at yPosition for this slice
    const rowStart = Math.floor(yPosition) * columns;
    for (let x = 0; x < columns; x++) {
      const sourceIndex = rowStart + x;
      const destIndex = z * outputWidth + x;
      outputData[destIndex] = pixelData[sourceIndex] || 0;
    }
  }

  return {
    pixelData: outputData,
    width: outputWidth,
    height: outputHeight,
    metadata: {
      pixelSpacing: [sliceThickness, pixelSpacing[1]], // [z spacing, x spacing]
      origin: [firstImage.imagePosition[0], yPosition * pixelSpacing[0], firstImage.imagePosition[2]],
      orientation: 'coronal'
    }
  };
}

/**
 * Calculate average slice thickness from image stack
 */
function calculateSliceThickness(sortedImages: any[]): number {
  if (sortedImages.length < 2) return 1;

  let totalThickness = 0;
  let count = 0;

  for (let i = 1; i < sortedImages.length; i++) {
    const z1 = sortedImages[i - 1].imagePosition?.[2] || sortedImages[i - 1].sliceLocation || 0;
    const z2 = sortedImages[i].imagePosition?.[2] || sortedImages[i].sliceLocation || 0;
    const thickness = Math.abs(z2 - z1);
    
    if (thickness > 0) {
      totalThickness += thickness;
      count++;
    }
  }

  return count > 0 ? totalThickness / count : 1;
}

/**
 * Convert world coordinates to view-specific pixel coordinates
 */
export function worldToViewPixel(
  worldX: number,
  worldY: number,
  worldZ: number,
  viewType: 'axial' | 'sagittal' | 'coronal',
  imageMetadata: ImageMetadata
): { x: number; y: number } {
  const { imagePosition, pixelSpacing } = imageMetadata;
  const [originX, originY, originZ] = imagePosition;
  const [spacingY, spacingX] = pixelSpacing; // Note: DICOM uses row,col ordering

  switch (viewType) {
    case 'axial':
      return {
        x: (worldX - originX) / spacingX,
        y: (worldY - originY) / spacingY
      };
    
    case 'sagittal':
      // Sagittal view: Y-Z plane at fixed X
      return {
        x: (worldZ - originZ) / spacingY, // Z maps to horizontal
        y: (worldY - originY) / spacingY  // Y stays vertical
      };
    
    case 'coronal':
      // Coronal view: X-Z plane at fixed Y
      return {
        x: (worldX - originX) / spacingX, // X stays horizontal
        y: (worldZ - originZ) / spacingY  // Z maps to vertical
      };
  }
}

/**
 * Project RT structure contours onto orthogonal planes
 */
export function projectContourToView(
  contour: number[], // [x1,y1,z1, x2,y2,z2, ...]
  viewType: 'sagittal' | 'coronal',
  slicePosition: number,
  tolerance: number = 2 // mm tolerance for including points
): number[] | null {
  const projectedPoints: number[] = [];

  for (let i = 0; i < contour.length; i += 3) {
    const x = contour[i];
    const y = contour[i + 1];
    const z = contour[i + 2];

    let include = false;
    let projX = 0, projY = 0;

    if (viewType === 'sagittal') {
      // Check if point is near the sagittal slice position (X coordinate)
      if (Math.abs(x - slicePosition) <= tolerance) {
        include = true;
        projX = z; // Z becomes horizontal
        projY = y; // Y stays vertical
      }
    } else if (viewType === 'coronal') {
      // Check if point is near the coronal slice position (Y coordinate)
      if (Math.abs(y - slicePosition) <= tolerance) {
        include = true;
        projX = x; // X stays horizontal
        projY = z; // Z becomes vertical
      }
    }

    if (include) {
      projectedPoints.push(projX, projY, 0); // Use 0 for Z in 2D projection
    }
  }

  return projectedPoints.length >= 6 ? projectedPoints : null; // Need at least 2 points
}