/**
 * Rendering service for DICOM canvas operations
 * Extracted from WorkingViewer's complex rendering logic
 */

/**
 * Render 16-bit DICOM image to canvas
 */
export function render16BitImage(
  canvas: HTMLCanvasElement,
  imageData: any,
  windowLevel: { window: number; level: number },
  viewportState?: { zoom: number; panX: number; panY: number }
) {
  if (!canvas || !imageData) return;
  
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // Handle image data formats exactly like the working backup
  let pixelArray, width, height;
  
  if (imageData.parsedPixelData) {
    // Standard parsed format from DICOM loader
    pixelArray = imageData.parsedPixelData;
    width = imageData.columns || imageData.width || 512;
    height = imageData.rows || imageData.height || 512;
  } else if (imageData.data && Array.isArray(imageData.data)) {
    // Direct pixel data format
    pixelArray = imageData.data;
    width = imageData.width || 512;
    height = imageData.height || 512;
  } else {
    // Try to extract from image cache or handle missing data
    console.warn('Image data format not recognized, available keys:', Object.keys(imageData));
    console.warn('Image data sample:', {
      hasData: !!imageData.data,
      dataType: typeof imageData.data,
      hasPixelData: !!imageData.parsedPixelData,
      width: imageData.width || imageData.columns,
      height: imageData.height || imageData.rows
    });
    return;
  }

  // Create image data at original size
  const canvasImageData = ctx.createImageData(width, height);
  const data = canvasImageData.data;

  // Apply window/level settings
  const { window: windowWidth, level: windowCenter } = windowLevel;
  const min = windowCenter - windowWidth / 2;
  const max = windowCenter + windowWidth / 2;

  for (let i = 0; i < pixelArray.length; i++) {
    const pixelValue = pixelArray[i];

    // Apply windowing
    let normalizedValue;
    if (pixelValue <= min) {
      normalizedValue = 0;
    } else if (pixelValue >= max) {
      normalizedValue = 255;
    } else {
      normalizedValue = ((pixelValue - min) / windowWidth) * 255;
    }

    const gray = Math.max(0, Math.min(255, normalizedValue));

    const pixelIndex = i * 4;
    data[pixelIndex] = gray; // R
    data[pixelIndex + 1] = gray; // G
    data[pixelIndex + 2] = gray; // B
    data[pixelIndex + 3] = 255; // A
  }

  // Create a temporary canvas for the original image
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = width;
  tempCanvas.height = height;
  const tempCtx = tempCanvas.getContext("2d");
  if (!tempCtx) return;

  tempCtx.putImageData(canvasImageData, 0, 0);

  // Scale and draw to the main canvas with zoom and pan
  const canvasWidth = ctx.canvas.width;
  const canvasHeight = ctx.canvas.height;

  // Calculate scale with zoom factor (default to 1 if no viewport state)
  const zoom = viewportState?.zoom || 1;
  const panX = viewportState?.panX || 0;
  const panY = viewportState?.panY || 0;
  
  const baseScale = Math.min(canvasWidth / width, canvasHeight / height);
  const totalScale = baseScale * zoom;
  const scaledWidth = width * totalScale;
  const scaledHeight = height * totalScale;

  // Center the image on canvas with pan offset
  const x = (canvasWidth - scaledWidth) / 2 + panX;
  const y = (canvasHeight - scaledHeight) / 2 + panY;

  // Enable smooth scaling for better zoom quality while preserving medical image integrity
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(tempCanvas, x, y, scaledWidth, scaledHeight);

  console.log('Rendering DICOM image with window/level:', windowLevel);
}

/**
 * Render RT structures overlay
 */
export function renderRTStructures(
  canvas: HTMLCanvasElement,
  rtStructures: any,
  currentSlicePosition: number,
  structureVisibility: Map<number, boolean>,
  selectedForEdit: number | null,
  contourSettings: { width: number; opacity: number },
  viewportState: { zoom: number; panX: number; panY: number }
) {
  if (!canvas || !rtStructures?.structures) return;
  
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  
  console.log('Rendering RT structures at slice:', currentSlicePosition, 'Total structures:', rtStructures.structures.length);
  
  // Use the exact same transform logic as the working backup
  const canvasWidth = canvas.width;
  const canvasHeight = canvas.height;
  const { zoom, panX, panY } = viewportState;
  
  // Calculate scaling exactly like the working backup
  const imageWidth = 512;  // Standard DICOM size from backup
  const imageHeight = 512;
  const baseScale = Math.min(canvasWidth / imageWidth, canvasHeight / imageHeight);
  const totalScale = baseScale * zoom;
  const scaledWidth = imageWidth * totalScale;
  const scaledHeight = imageHeight * totalScale;
  
  // Center position with pan offset (exactly like backup)
  const imageX = (canvasWidth - scaledWidth) / 2 + panX;
  const imageY = (canvasHeight - scaledHeight) / 2 + panY;
  
  let structuresRendered = 0;
  
  // Render each structure's contours at current slice
  rtStructures.structures.forEach((structure: any) => {
    // Use structure.roiNumber for visibility check (like backup)
    const isVisible = structureVisibility.get(structure.roiNumber) !== false;
    if (!isVisible) return;
    
    const contours = structure.contours || [];
    const structureColor = `rgb(${structure.color[0]}, ${structure.color[1]}, ${structure.color[2]})`;
    
    // Find contours at current slice position (exactly like backup)
    const contoursAtSlice = contours.filter((contour: any) => {
      return Math.abs(contour.slicePosition - currentSlicePosition) < 1.0; // Slightly more tolerance
    });
    
    if (contoursAtSlice.length === 0) return;
    
    // Set drawing style exactly like backup
    ctx.strokeStyle = structureColor;
    ctx.lineWidth = contourSettings.width;
    ctx.globalAlpha = selectedForEdit === structure.roiNumber ? 1.0 : contourSettings.opacity;
    
    // Draw each contour exactly like backup
    contoursAtSlice.forEach((contour: any) => {
      if (!contour.points || contour.points.length < 6) return;
      
      ctx.beginPath();
      let isFirstPoint = true;
      
      // Process points in triplets (x, y, z coordinates) - backup used i += 3
      for (let i = 0; i < contour.points.length; i += 3) {
        const worldX = contour.points[i];
        const worldY = contour.points[i + 1];
        
        // Apply exact coordinate transformation from backup
        const canvasX = imageX + (worldX * totalScale);
        const canvasY = imageY + (worldY * totalScale);
        
        if (isFirstPoint) {
          ctx.moveTo(canvasX, canvasY);
          isFirstPoint = false;
        } else {
          ctx.lineTo(canvasX, canvasY);
        }
      }
      
      ctx.closePath();
      ctx.stroke();
      structuresRendered++;
    });
    
    // Reset alpha
    ctx.globalAlpha = 1.0;
  });
  
  console.log('✅ RT structures rendered:', structuresRendered, 'contours at slice', currentSlicePosition);
}

/**
 * Render fusion overlay on canvas
 */
export function renderFusionOverlayOnCanvas(
  canvas: HTMLCanvasElement,
  primaryImage: any,
  secondaryImages: any[],
  registrationMatrix: number[] | null,
  fusionOpacity: number,
  secondaryWindowLevel: { window: number; level: number },
  viewportState: { zoom: number; panX: number; panY: number }
) {
  if (!canvas || !primaryImage || !secondaryImages.length || !registrationMatrix || fusionOpacity === 0) return;
  
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  
  console.log('Rendering fusion overlay with opacity:', fusionOpacity);
  
  // TODO: Implement actual fusion overlay rendering
  // For now, just placeholder to prevent errors
}