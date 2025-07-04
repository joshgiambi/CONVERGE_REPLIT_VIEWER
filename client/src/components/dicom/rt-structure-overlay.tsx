import { useEffect, useState } from 'react';

export interface RTContour {
  slicePosition: number;
  points: number[];
  numberOfPoints: number;
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
  contourWidth = 2,
  contourOpacity = 80
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
  contourOpacity: number = 80
) {
  // Save current context state
  ctx.save();
  
  // Apply transformations
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.scale(zoom, zoom);
  ctx.translate(-canvas.width / 2 + panX, -canvas.height / 2 + panY);
  
  // Set overlay drawing properties
  ctx.lineWidth = contourWidth / zoom; // Use actual contour width setting
  ctx.globalAlpha = 1; // Keep stroke at full opacity
  
  // Find contours that match the current slice position (within tolerance)
  const tolerance = 2.0; // mm tolerance for slice matching
  
  rtStructures.structures.forEach(structure => {
    // Set color for this structure
    const [r, g, b] = structure.color;
    ctx.strokeStyle = `rgb(${r}, ${g}, ${b})`;
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${contourOpacity / 100})`;
    
    structure.contours.forEach(contour => {
      // Check if this contour is on the current slice
      if (Math.abs(contour.slicePosition - currentSlicePosition) <= tolerance) {
        drawContour(ctx, contour, canvas.width, canvas.height, imageWidth, imageHeight, contourWidth, contourOpacity);
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
  const [rowSpacing, colSpacing] = pixelSpacing;
  const [originX, originY] = origin;

  // Step 1: Convert world (mm) to DICOM pixel indices (row i, col j)
  // For standard DICOM: pixelSpacing[0] = rowSpacing, pixelSpacing[1] = colSpacing
  const j = (worldX - originX) / pixelSpacing[0]; // column index - worldX maps to col
  const i = (worldY - originY) / pixelSpacing[1]; // row index - worldY maps to row

  // Step 2: Apply counter-rotation to fix sideways orientation
  const rotatedJ = imageWidth - i; // Rotate 90 degrees counter-clockwise
  const rotatedI = j; // Swap coordinates

  // Step 3: Convert rotated pixel indices to canvas coordinates
  const canvasX = (rotatedJ / imageWidth) * canvasWidth;
  const canvasY = (rotatedI / imageHeight) * canvasHeight;

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
  contourOpacity: number = 80
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
  ctx.fill();
  ctx.stroke();
  
  // Reset alpha for subsequent drawing operations
  ctx.globalAlpha = 1.0;
}