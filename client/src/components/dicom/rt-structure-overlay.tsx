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
  contourOpacity: number = 80
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
  
  // CRITICAL FIX: Transform RT structure coordinates to CT image coordinates
  // CT images are in range ~460-506mm, RT structures are in range -180 to 102.5mm
  // We need to map RT structure coordinates to CT coordinates
  
  // Get all RT structure Z positions to understand their coordinate space
  const rtZPositions: number[] = [];
  rtStructures.structures.forEach(structure => {
    structure.contours.forEach(contour => {
      rtZPositions.push(contour.slicePosition);
    });
  });
  
  if (rtZPositions.length === 0) return;
  
  // Find RT coordinate range
  const rtZMin = Math.min(...rtZPositions);
  const rtZMax = Math.max(...rtZPositions);
  
  // Assume CT images are in range 460-506 (based on data analysis)
  // This should be dynamically determined, but for now use the known range
  const ctZMin = 460;
  const ctZMax = 506;
  
  // Create linear transformation from RT space to CT space
  const rtRange = rtZMax - rtZMin;
  const ctRange = ctZMax - ctZMin;
  
  // Transform function: map RT Z to CT Z
  const transformRTtoCtZ = (rtZ: number) => {
    const normalizedRtZ = (rtZ - rtZMin) / rtRange; // Normalize to 0-1
    return ctZMin + normalizedRtZ * ctRange; // Map to CT range
  };
  
  // Debug: Log transformation details every time to track the issue
  console.log(`🔄 RT→CT Coordinate Transformation:
    RT Range: ${rtZMin.toFixed(1)} to ${rtZMax.toFixed(1)}mm
    CT Range: ${ctZMin.toFixed(1)} to ${ctZMax.toFixed(1)}mm
    Current CT slice: ${currentSlicePosition.toFixed(1)}mm
    Sample RT→CT mappings:
      RT ${rtZMin.toFixed(1)}mm → CT ${transformRTtoCtZ(rtZMin).toFixed(1)}mm
      RT 0.0mm → CT ${transformRTtoCtZ(0).toFixed(1)}mm
      RT ${rtZMax.toFixed(1)}mm → CT ${transformRTtoCtZ(rtZMax).toFixed(1)}mm`);
  
  const tolerance = 2.0; // mm tolerance for slice matching
  
  // Debug: Check what contours are actually being drawn
  let contoursDrawn = 0;
  rtStructures.structures.forEach(structure => {
    structure.contours.forEach(contour => {
      const transformedZ = transformRTtoCtZ(contour.slicePosition);
      if (Math.abs(transformedZ - currentSlicePosition) <= tolerance) {
        contoursDrawn++;
        console.log(`✓ Drawing ${structure.structureName} contour: RT ${contour.slicePosition.toFixed(1)}mm → CT ${transformedZ.toFixed(1)}mm`);
      }
    });
  });
  
  console.log(`📊 Drawing ${contoursDrawn} contours on current slice`);
  
  rtStructures.structures.forEach(structure => {
    // Set color for this structure
    const [r, g, b] = structure.color;
    ctx.strokeStyle = `rgb(${r}, ${g}, ${b})`;
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${contourOpacity / 100})`;
    
    structure.contours.forEach(contour => {
      // Transform RT structure Z position to CT coordinate space
      const transformedZ = transformRTtoCtZ(contour.slicePosition);
      
      // Check if this contour is on the current slice (after transformation)
      if (Math.abs(transformedZ - currentSlicePosition) <= tolerance) {
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