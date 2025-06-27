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
}

export function RTStructureOverlay({
  canvasRef,
  studyId,
  currentSlicePosition,
  imageWidth,
  imageHeight,
  zoom,
  panX,
  panY
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
    renderRTStructures(ctx, canvas, rtStructures, currentSlicePosition, imageWidth, imageHeight, zoom, panX, panY);

  }, [canvasRef, rtStructures, currentSlicePosition, imageWidth, imageHeight, zoom, panX, panY]);

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
  panY: number
) {
  // Save current context state
  ctx.save();
  
  // Apply transformations
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.scale(zoom, zoom);
  ctx.translate(-canvas.width / 2 + panX, -canvas.height / 2 + panY);
  
  // Set overlay drawing properties
  ctx.lineWidth = 2 / zoom; // Adjust line width for zoom
  ctx.globalAlpha = 0.8;
  
  // Find contours that match the current slice position (within tolerance)
  const tolerance = 2.0; // mm tolerance for slice matching
  
  rtStructures.structures.forEach(structure => {
    // Set color for this structure
    const [r, g, b] = structure.color;
    ctx.strokeStyle = `rgb(${r}, ${g}, ${b})`;
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.3)`;
    
    structure.contours.forEach(contour => {
      // Check if this contour is on the current slice
      if (Math.abs(contour.slicePosition - currentSlicePosition) <= tolerance) {
        drawContour(ctx, contour, canvas.width, canvas.height, imageWidth, imageHeight);
      }
    });
  });
  
  // Restore context state
  ctx.restore();
}

function drawContour(
  ctx: CanvasRenderingContext2D,
  contour: RTContour,
  canvasWidth: number,
  canvasHeight: number,
  imageWidth: number,
  imageHeight: number
) {
  if (contour.points.length < 6) return; // Need at least 2 points (x,y,z each)
  
  ctx.beginPath();
  
  // Convert DICOM coordinates to canvas coordinates
  for (let i = 0; i < contour.points.length; i += 3) {
    const x = contour.points[i];     // DICOM X coordinate
    const y = contour.points[i + 1]; // DICOM Y coordinate
    // z coordinate (contour.points[i + 2]) is slice position - already filtered
    
    // Convert DICOM coordinates to canvas coordinates
    // DICOM coordinates are typically in mm, canvas is in pixels
    // This is a simplified conversion - in real implementation you'd use
    // the image position and pixel spacing from DICOM metadata
    const canvasX = (x / imageWidth) * canvasWidth;
    const canvasY = (y / imageHeight) * canvasHeight;
    
    if (i === 0) {
      ctx.moveTo(canvasX, canvasY);
    } else {
      ctx.lineTo(canvasX, canvasY);
    }
  }
  
  // Close the contour
  ctx.closePath();
  
  // Fill and stroke the contour
  ctx.fill();
  ctx.stroke();
}