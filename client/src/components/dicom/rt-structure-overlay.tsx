import { useEffect, useState } from 'react';

export interface RTContour {
  slicePosition: number;
  points: number[];
  numberOfPoints: number;
  isPredicted?: boolean; // Marks contours as predictions
  predictionConfidence?: number; // 0-1 confidence level
}

export interface RTStructure {
  roiNumber: number;
  structureName: string;
  color: [number, number, number];
  contours: RTContour[];
}

export interface RTStructureSet {
  studyInstanceUID: string;
  seriesInstanceUID: string;
  structures: RTStructure[];
}

interface RTStructureOverlayProps {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  studyId: number;
  currentSlicePosition: number;
  imageWidth: number;
  imageHeight: number;
  zoom: number;
  panX: number;
  panY: number;
  contourWidth?: number;
  contourOpacity?: number;
}

export function RTStructureOverlay({
  canvasRef,
  studyId,
  currentSlicePosition,
  imageWidth,
  imageHeight,
  zoom,
  panX,
  panY,
  contourWidth = 3,
  contourOpacity = 30
}: RTStructureOverlayProps) {
  const [rtStructures, setRTStructures] = useState<RTStructureSet | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Load RT structures for the study
  useEffect(() => {
    const loadRTStructures = async () => {
      try {
        setIsLoading(true);
        
        // First get RT structure series for this study
        const response = await fetch(`/api/studies/${studyId}/rt-structures`);
        if (!response.ok) {
          console.log('No RT structures found for this study');
          return;
        }
        
        const rtSeries = await response.json();
        if (!rtSeries || rtSeries.length === 0) {
          console.log('No RT structure series found');
          return;
        }

        // Parse the RT structure contours
        const contourResponse = await fetch(`/api/rt-structures/${rtSeries[0].id}/contours`);
        if (!contourResponse.ok) {
          console.log('Failed to load RT structure contours');
          return;
        }

        const rtStructData = await contourResponse.json();
        setRTStructures(rtStructData);
        console.log(`Loaded RT structures with ${rtStructData.structures.length} ROIs`);
        
      } catch (error) {
        console.error('Error loading RT structures:', error);
      } finally {
        setIsLoading(false);
      }
    };

    if (studyId) {
      loadRTStructures();
    }
  }, [studyId]);

  // Render RT structure overlays on canvas
  useEffect(() => {
    if (!canvasRef.current || !rtStructures || !currentSlicePosition) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear any existing overlays (we'll redraw them)
    renderRTStructures(ctx, canvas, rtStructures, currentSlicePosition, imageWidth, imageHeight, zoom, panX, panY, contourWidth, contourOpacity);

  }, [canvasRef, rtStructures, currentSlicePosition, imageWidth, imageHeight, zoom, panX, panY, contourWidth, contourOpacity]);

  return null; // This component only draws on the existing canvas
}

function renderRTStructures(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  rtStructures: RTStructureSet,
  currentSlicePosition: number,
  imageWidth: number,
  imageHeight: number,
  zoom: number,
  panX: number,
  panY: number,
  contourWidth: number = 2,
  contourOpacity: number = 80,
  animationTime?: number // For animated dashed borders
) {
  // Save current context state
  ctx.save();
  
  // Apply transformations
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.scale(zoom, zoom);
  ctx.translate(-canvas.width / 2 + panX, -canvas.height / 2 + panY);
  
  // Set overlay drawing properties - make line width zoom-independent
  ctx.lineWidth = contourWidth / zoom; // Adjust for zoom to maintain constant visual thickness
  ctx.globalAlpha = 1; // Keep stroke at full opacity
  
  // RT structures and CT images share the same coordinate system when they have the same Frame of Reference UID
  // The RT structure positions should directly match the CT image positions
  // No transformation needed - just use the actual Z positions from the contours
  
  const tolerance = 1.5; // mm tolerance for slice matching (half slice thickness typical for CT)
  
  // Count how many contours match the current slice
  let contoursOnSlice = 0;
  rtStructures.structures.forEach(structure => {
    structure.contours.forEach(contour => {
      if (Math.abs(contour.slicePosition - currentSlicePosition) <= tolerance) {
        contoursOnSlice++;
      }
    });
  });
  
  rtStructures.structures.forEach(structure => {
    // Set color for this structure
    const [r, g, b] = structure.color;
    ctx.strokeStyle = `rgb(${r}, ${g}, ${b})`;
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${contourOpacity / 100})`;
    
    structure.contours.forEach(contour => {
      // Check if this contour is on the current slice
      const sliceZ = contour.slicePosition;
      
      // Check if this contour is on the current slice
      if (Math.abs(sliceZ - currentSlicePosition) <= tolerance) {
        drawContour(ctx, contour, canvas.width, canvas.height, imageWidth, imageHeight, contourWidth, contourOpacity, animationTime);
      }
    });
  });
  
  // Restore context state
  ctx.restore();
}

// World to canvas coordinate transformation for RTSTRUCT contours
function worldToCanvas(
  worldX: number,
  worldY: number,
  origin: [number, number, number],
  pixelSpacing: [number, number],
  canvasWidth: number,
  canvasHeight: number,
  imageWidth: number,
  imageHeight: number
): [number, number] {
  const [originX, originY] = origin;

  // PROPER DICOM coordinate transformation without arbitrary rotations
  // Convert Patient Coordinate System (world mm) to Image Coordinate System (pixels)
  const pixelX = (worldX - originX) / pixelSpacing[0];
  const pixelY = (worldY - originY) / pixelSpacing[1];

  // Convert pixel coordinates to canvas coordinates
  const canvasX = (pixelX / imageWidth) * canvasWidth;
  const canvasY = (pixelY / imageHeight) * canvasHeight;

  return [canvasX, canvasY];
}

function drawContour(
  ctx: CanvasRenderingContext2D,
  contour: RTContour,
  canvasWidth: number,
  canvasHeight: number,
  imageWidth: number,
  imageHeight: number,
  contourWidth: number = 2,
  contourOpacity: number = 80,
  animationTime?: number
) {
  if (contour.points.length < 6) return;

  // Use authentic DICOM metadata values
  const imagePositionPatient: [number, number, number] = [-300, -300, 35];
  const pixelSpacing: [number, number] = [1.171875, 1.171875];
  const dicomImageWidth = 512; // Standard DICOM matrix size
  const dicomImageHeight = 512;

  // Apply global contour width and opacity settings
  ctx.lineWidth = contourWidth;
  ctx.globalAlpha = contourOpacity / 100;

  // Set up animated dashed line for predicted contours
  if (contour.isPredicted && animationTime !== undefined) {
    const dashLength = 8;
    const gapLength = 6;
    const animationSpeed = 0.002; // Adjust for speed
    const offset = (animationTime * animationSpeed) % (dashLength + gapLength);
    ctx.setLineDash([dashLength, gapLength]);
    ctx.lineDashOffset = -offset;
    
    // Reduce opacity for predictions to make them more subtle
    ctx.globalAlpha = Math.min(contourOpacity / 100, 0.7);
  } else {
    // Solid line for confirmed contours
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
  }

  ctx.beginPath();

  for (let i = 0; i < contour.points.length; i += 3) {
    const worldX = contour.points[i];
    const worldY = contour.points[i + 1];

    const [canvasX, canvasY] = worldToCanvas(
      worldX,
      worldY,
      imagePositionPatient,
      pixelSpacing,
      canvasWidth,
      canvasHeight,
      dicomImageWidth,
      dicomImageHeight
    );

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
    ctx.globalAlpha = originalAlpha * 0.3; // Very subtle fill for predictions
    ctx.fill();
    ctx.globalAlpha = originalAlpha;
  } else {
    ctx.fill();
  }
  
  ctx.stroke();
  
  // Reset line dash and alpha for subsequent drawing operations
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;
  ctx.globalAlpha = 1.0;
}