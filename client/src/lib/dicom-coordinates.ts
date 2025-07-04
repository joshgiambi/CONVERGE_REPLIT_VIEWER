// Shared DICOM coordinate transformation utilities

export interface ImageMetadata {
  imagePosition: string;
  pixelSpacing: string;
  imageOrientation?: string;
}

// Convert canvas coordinates to DICOM world coordinates
export function canvasToWorld(
  canvasX: number,
  canvasY: number,
  canvasWidth: number,
  canvasHeight: number,
  imageMetadata: ImageMetadata,
  slicePosition: number
): [number, number, number] {
  // Parse metadata
  const imagePosition = imageMetadata.imagePosition.split('\\').map(Number);
  const pixelSpacing = imageMetadata.pixelSpacing.split('\\').map(Number);
  
  // Image dimensions (standard CT is 512x512)
  const imageWidth = 512;
  const imageHeight = 512;
  
  // Convert canvas to pixel coordinates
  const pixelX = (canvasX / canvasWidth) * imageWidth;
  const pixelY = (canvasY / canvasHeight) * imageHeight;
  
  // Direct conversion - no flip needed based on user feedback
  // DICOM pixel spacing is [row spacing, column spacing] = [deltaY, deltaX]
  const worldX = imagePosition[0] + (pixelX * pixelSpacing[1]); // column spacing
  const worldY = imagePosition[1] + (pixelY * pixelSpacing[0]); // row spacing
  const worldZ = slicePosition;
  
  return [worldX, worldY, worldZ];
}

// Convert DICOM world coordinates to canvas coordinates
export function worldToCanvas(
  worldX: number,
  worldY: number,
  imagePosition: number[],
  pixelSpacing: number[],
  canvasWidth: number,
  canvasHeight: number
): [number, number] {
  const imageWidth = 512;
  const imageHeight = 512;
  
  // Direct conversion - no flip needed based on user feedback
  // DICOM pixel spacing is [row spacing, column spacing] = [deltaY, deltaX]
  const pixelX = (worldX - imagePosition[0]) / pixelSpacing[1]; // Direct X mapping
  const pixelY = (worldY - imagePosition[1]) / pixelSpacing[0]; // Direct Y mapping
  
  // Scale to canvas
  const canvasX = (pixelX / imageWidth) * canvasWidth;
  const canvasY = (pixelY / imageHeight) * canvasHeight;
  
  return [canvasX, canvasY];
}