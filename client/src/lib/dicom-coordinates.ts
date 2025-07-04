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
  const imageOrientation = imageMetadata.imageOrientation?.split('\\').map(Number) || [1, 0, 0, 0, 1, 0];
  
  // Image dimensions (standard CT is 512x512)
  const imageWidth = 512;
  const imageHeight = 512;
  
  // Convert canvas to pixel coordinates
  const pixelX = (canvasX / canvasWidth) * imageWidth;
  const pixelY = (canvasY / canvasHeight) * imageHeight;
  
  // For standard axial images with orientation [1,0,0,0,1,0]
  // and the rotation/flip applied in rendering, we need to reverse it
  
  // The RT overlay applies these transforms to go from DICOM to canvas:
  // 1. DICOM world → pixel: pixelX = (worldX - originX) / spacingX
  // 2. 90° rotation: displayX = imageHeight - pixelY, displayY = pixelX  
  // 3. Horizontal flip: displayX = imageWidth - displayX
  // 4. Scale to canvas
  
  // So to go from canvas to DICOM world, we reverse:
  // 1. Unscale from canvas
  // 2. Undo horizontal flip
  const unflippedX = imageWidth - pixelX;
  
  // 3. Undo 90° rotation
  const origPixelX = pixelY;
  const origPixelY = imageHeight - unflippedX;
  
  // 4. Convert pixel to world coordinates
  const worldX = imagePosition[0] + (origPixelX * pixelSpacing[0]);
  const worldY = imagePosition[1] + (origPixelY * pixelSpacing[1]);
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
  
  // Convert world to pixel coordinates
  const pixelX = (worldX - imagePosition[0]) / pixelSpacing[0];
  const pixelY = (worldY - imagePosition[1]) / pixelSpacing[1];
  
  // Apply 90° rotation
  let displayX = imageHeight - pixelY;
  let displayY = pixelX;
  
  // Apply horizontal flip
  displayX = imageWidth - displayX;
  
  // Scale to canvas
  const canvasX = (displayX / imageWidth) * canvasWidth;
  const canvasY = (displayY / imageHeight) * canvasHeight;
  
  return [canvasX, canvasY];
}