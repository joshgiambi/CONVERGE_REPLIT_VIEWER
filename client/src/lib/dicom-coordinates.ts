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
  
  // Convert to world coordinates with HFS radiological viewing convention
  // For HFS: screen X is flipped (patient's left appears on right)
  // Need to unflip X when converting back to world coordinates
  const unflippedPixelX = (imageWidth - 1) - pixelX; // Unflip X for world coords
  
  // DICOM pixel spacing is [row spacing, column spacing] = [deltaY, deltaX]
  const worldX = imagePosition[0] + (unflippedPixelX * pixelSpacing[1]); // column spacing
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
  
  // Convert world to pixel coordinates with HFS radiological viewing convention
  // For HFS: patient's LEFT appears on screen RIGHT (flip X)
  // DICOM pixel spacing is [row spacing, column spacing] = [deltaY, deltaX]
  const pixelX = (imageWidth - 1) - ((worldX - imagePosition[0]) / pixelSpacing[1]); // Flip X for radiological view
  const pixelY = (worldY - imagePosition[1]) / pixelSpacing[0]; // Y maps directly
  
  // Scale to canvas
  const canvasX = (pixelX / imageWidth) * canvasWidth;
  const canvasY = (pixelY / imageHeight) * canvasHeight;
  
  return [canvasX, canvasY];
}