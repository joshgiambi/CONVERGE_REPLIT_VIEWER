/**
 * Rendering service - handles all canvas drawing operations
 * Extracts canvas logic from the monolithic WorkingViewer component
 */

import { renderFusionOverlay } from "@/lib/fusion-utils";

export interface RenderingContext {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
}

export interface ViewportState {
  zoom: number;
  panX: number;
  panY: number;
}

export interface WindowLevel {
  window: number;
  level: number;
}

/**
 * Render a 16-bit DICOM image to canvas
 */
export function render16BitImage(
  canvas: HTMLCanvasElement,
  imageData: Uint16Array,
  windowLevel: WindowLevel,
  viewportState: ViewportState
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx || !imageData) return;

  const { zoom, panX, panY } = viewportState;
  const { window: windowWidth, level: windowCenter } = windowLevel;

  // Clear canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Calculate window/level bounds
  const minValue = windowCenter - windowWidth / 2;
  const maxValue = windowCenter + windowWidth / 2;
  const range = maxValue - minValue;

  // Create 8-bit display buffer
  const displayData = new Uint8ClampedArray(imageData.length * 4);

  // Apply window/level transformation
  for (let i = 0; i < imageData.length; i++) {
    let pixelValue = imageData[i];
    
    // Apply window/level
    if (range > 0) {
      pixelValue = Math.max(0, Math.min(255, ((pixelValue - minValue) / range) * 255));
    } else {
      pixelValue = pixelValue > windowCenter ? 255 : 0;
    }

    const pixelIndex = i * 4;
    displayData[pixelIndex] = pixelValue;     // R
    displayData[pixelIndex + 1] = pixelValue; // G
    displayData[pixelIndex + 2] = pixelValue; // B
    displayData[pixelIndex + 3] = 255;        // A
  }

  // Create ImageData and render
  const imgData = new ImageData(displayData, 512, 512);
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = 512;
  tempCanvas.height = 512;
  const tempCtx = tempCanvas.getContext('2d')!;
  tempCtx.putImageData(imgData, 0, 0);

  // Apply viewport transformations
  ctx.save();
  
  // Calculate scaled image dimensions
  const baseScale = Math.min(canvas.width / 512, canvas.height / 512);
  const totalScale = baseScale * zoom;
  const scaledWidth = 512 * totalScale;
  const scaledHeight = 512 * totalScale;
  
  // Center the image with pan offset
  const imageX = (canvas.width - scaledWidth) / 2 + panX;
  const imageY = (canvas.height - scaledHeight) / 2 + panY;

  // Draw the transformed image
  ctx.drawImage(tempCanvas, imageX, imageY, scaledWidth, scaledHeight);
  
  ctx.restore();
}

/**
 * Render RT structure contours on canvas
 */
export function renderRTStructures(
  canvas: HTMLCanvasElement,
  rtStructures: any,
  currentSlicePosition: number,
  structureVisibility: Map<number, boolean>,
  selectedForEdit: number | null,
  viewportState: ViewportState,
  currentImage: any,
  contourSettings: { width: number; opacity: number },
  animationTime?: number
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx || !rtStructures?.structures) return;

  const { zoom, panX, panY } = viewportState;
  const fillOpacity = contourSettings.opacity / 100;
  const tolerance = 1.0; // mm tolerance for slice matching

  ctx.save();
  ctx.lineWidth = contourSettings.width;
  ctx.globalAlpha = 1;

  rtStructures.structures.forEach((structure: any) => {
    // Check visibility
    const isVisible = structureVisibility.get(structure.roiNumber);
    const isSelectedForEdit = selectedForEdit === structure.roiNumber;

    if (!isVisible && !isSelectedForEdit) return;

    // Use structure color
    const color = structure.color || [255, 255, 0];
    const [r, g, b] = color;
    ctx.strokeStyle = `rgb(${r}, ${g}, ${b})`;
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${fillOpacity})`;

    structure.contours.forEach((contour: any) => {
      const positionDiff = Math.abs(contour.slicePosition - currentSlicePosition);
      if (positionDiff <= tolerance) {
        drawContour(ctx, contour, canvas, currentImage, viewportState, animationTime);
      }
    });
  });

  ctx.restore();
}

/**
 * Draw a single contour
 */
function drawContour(
  ctx: CanvasRenderingContext2D,
  contour: any,
  canvas: HTMLCanvasElement,
  currentImage: any,
  viewportState: ViewportState,
  animationTime?: number
): void {
  if (contour.points.length < 6) return;

  const { zoom, panX, panY } = viewportState;

  ctx.beginPath();

  // Get image metadata
  const imgMetadata = currentImage?.imageMetadata;
  if (!imgMetadata) return;

  const imagePosition = imgMetadata.imagePosition?.split("\\").map(Number) || [-300, -300, 0];
  const pixelSpacing = imgMetadata.pixelSpacing?.split("\\").map(Number) || [1.171875, 1.171875];

  // Calculate viewport transformations
  const baseScale = Math.min(canvas.width / 512, canvas.height / 512);
  const totalScale = baseScale * zoom;
  const scaledWidth = 512 * totalScale;
  const scaledHeight = 512 * totalScale;
  const imageX = (canvas.width - scaledWidth) / 2 + panX;
  const imageY = (canvas.height - scaledHeight) / 2 + panY;

  // Set up animated dashed line for predicted contours
  if (contour.isPredicted && animationTime !== undefined) {
    const dashLength = 8;
    const gapLength = 6;
    const animationSpeed = 0.002;
    const offset = (animationTime * animationSpeed) % (dashLength + gapLength);
    ctx.setLineDash([dashLength, gapLength]);
    ctx.lineDashOffset = -offset;
  } else {
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
  }

  // Convert DICOM world coordinates to canvas coordinates
  for (let i = 0; i < contour.points.length; i += 3) {
    const worldX = contour.points[i];
    const worldY = contour.points[i + 1];

    // Convert to pixel coordinates
    const pixelX = (worldX - imagePosition[0]) / pixelSpacing[1];
    const pixelY = (worldY - imagePosition[1]) / pixelSpacing[0];
    
    // Apply viewport transformations
    const canvasX = imageX + (pixelX * totalScale);
    const canvasY = imageY + (pixelY * totalScale);

    if (i === 0) {
      ctx.moveTo(canvasX, canvasY);
    } else {
      ctx.lineTo(canvasX, canvasY);
    }
  }

  ctx.closePath();

  // Fill with reduced opacity for predictions
  if (contour.isPredicted) {
    const originalAlpha = ctx.globalAlpha;
    ctx.globalAlpha = originalAlpha * 0.3;
    ctx.fill();
    ctx.globalAlpha = originalAlpha;
  } else {
    ctx.fill();
  }
  
  ctx.stroke();

  // Reset line dash
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;
}

/**
 * Render fusion overlay (MRI over CT)
 */
export function renderFusionOverlayOnCanvas(
  canvas: HTMLCanvasElement,
  primaryImage: any,
  secondaryImages: any[],
  registrationMatrix: number[] | null,
  fusionOpacity: number,
  viewportState: ViewportState,
  secondaryWindowLevel?: WindowLevel
): void {
  if (!registrationMatrix || fusionOpacity === 0 || !secondaryImages.length) {
    return;
  }

  // Use the existing fusion utility with canvas context
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  renderFusionOverlay(
    ctx,
    canvas.width,
    canvas.height,
    primaryImage,
    secondaryImages,
    registrationMatrix,
    fusionOpacity,
    viewportState,
    secondaryWindowLevel
  );
}

/**
 * Render MPR slice (sagittal or coronal reconstruction)
 */
export function renderMPRSlice(
  canvas: HTMLCanvasElement,
  volumeData: Uint16Array[],
  sliceIndex: number,
  orientation: 'sagittal' | 'coronal',
  windowLevel: WindowLevel,
  imageMetadata: any
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx || !volumeData.length) return;

  const { window: windowWidth, level: windowCenter } = windowLevel;

  // Calculate reconstruction parameters
  const dimensions = { width: 512, height: 512, depth: volumeData.length };
  let reconstructedData: Uint16Array;

  if (orientation === 'sagittal') {
    // Reconstruct sagittal slice (fix X, vary Y and Z)
    reconstructedData = new Uint16Array(dimensions.height * dimensions.depth);
    for (let z = 0; z < dimensions.depth; z++) {
      for (let y = 0; y < dimensions.height; y++) {
        const volumeIndex = z * dimensions.width * dimensions.height + y * dimensions.width + sliceIndex;
        const reconIndex = (dimensions.depth - 1 - z) * dimensions.height + y;
        reconstructedData[reconIndex] = volumeData[Math.floor(z)]?.[volumeIndex] || 0;
      }
    }
  } else {
    // Reconstruct coronal slice (fix Y, vary X and Z)
    reconstructedData = new Uint16Array(dimensions.width * dimensions.depth);
    for (let z = 0; z < dimensions.depth; z++) {
      for (let x = 0; x < dimensions.width; x++) {
        const volumeIndex = z * dimensions.width * dimensions.height + sliceIndex * dimensions.width + x;
        const reconIndex = (dimensions.depth - 1 - z) * dimensions.width + x;
        reconstructedData[reconIndex] = volumeData[Math.floor(z)]?.[volumeIndex] || 0;
      }
    }
  }

  // Apply window/level and render
  const minValue = windowCenter - windowWidth / 2;
  const maxValue = windowCenter + windowWidth / 2;
  const range = maxValue - minValue;

  const displayData = new Uint8ClampedArray(reconstructedData.length * 4);
  
  for (let i = 0; i < reconstructedData.length; i++) {
    let pixelValue = reconstructedData[i];
    
    if (range > 0) {
      pixelValue = Math.max(0, Math.min(255, ((pixelValue - minValue) / range) * 255));
    } else {
      pixelValue = pixelValue > windowCenter ? 255 : 0;
    }

    const pixelIndex = i * 4;
    displayData[pixelIndex] = pixelValue;
    displayData[pixelIndex + 1] = pixelValue;
    displayData[pixelIndex + 2] = pixelValue;
    displayData[pixelIndex + 3] = 255;
  }

  // Create and draw the reconstructed image
  const reconWidth = orientation === 'sagittal' ? dimensions.height : dimensions.width;
  const reconHeight = dimensions.depth;
  
  const imgData = new ImageData(displayData, reconWidth, reconHeight);
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = reconWidth;
  tempCanvas.height = reconHeight;
  const tempCtx = tempCanvas.getContext('2d')!;
  tempCtx.putImageData(imgData, 0, 0);

  // Scale to fit canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(tempCanvas, 0, 0, canvas.width, canvas.height);
}

/**
 * Clear canvas
 */
export function clearCanvas(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
}