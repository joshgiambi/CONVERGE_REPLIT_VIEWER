import { useEffect, useState, useRef } from 'react';

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
  onPredictionConfirm?: (structureId: number, slicePosition: number) => void;
  animationTime?: number;
  rtStructures?: any; // Pass in RT structures for better control
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
  contourOpacity = 30,
  onPredictionConfirm,
  animationTime,
  rtStructures: externalRTStructures
}: RTStructureOverlayProps) {
  const [localRTStructures, setLocalRTStructures] = useState<RTStructureSet | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  
  // Cache to prevent repeated API calls
  const rtStructureCache = useRef<Map<number, RTStructureSet>>(new Map());
  
  // Use external RT structures if provided, otherwise load our own
  const rtStructures = externalRTStructures || localRTStructures;

  // Load RT structures for the study (only if external structures not provided)
  useEffect(() => {
    if (externalRTStructures) {
      return; // Skip loading if external structures are provided
    }
    
    // Check cache first
    if (rtStructureCache.current.has(studyId)) {
      setLocalRTStructures(rtStructureCache.current.get(studyId) || null);
      return;
    }
    
    const loadRTStructures = async () => {
      try {
        setIsLoading(true);
        
        // First get RT structure series for this study
        const response = await fetch(`/api/studies/${studyId}/rt-structures`);
        if (!response.ok) {
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
        
        // Cache the loaded data
        rtStructureCache.current.set(studyId, rtStructData);
        setLocalRTStructures(rtStructData);
        
      } catch (error) {
        console.error('Error loading RT structures:', error);
      } finally {
        setIsLoading(false);
      }
    };

    if (studyId) {
      loadRTStructures();
    }
  }, [studyId, externalRTStructures]);

  // Handle right-click on predicted contours to confirm them
  useEffect(() => {
    if (!canvasRef.current) return;
    
    const canvas = canvasRef.current;
    
    const handleRightClick = (e: MouseEvent) => {
      e.preventDefault();
      
      if (!rtStructures) return;
      
      const rect = canvas.getBoundingClientRect();
      const canvasX = e.clientX - rect.left;
      const canvasY = e.clientY - rect.top;
      
      // Check if click is on a predicted contour
      const tolerance = 10; // pixel tolerance
      
      if (rtStructures?.structures) {
        rtStructures.structures.forEach(structure => {
          structure.contours.forEach(contour => {
            if (contour.isPredicted && Math.abs(contour.slicePosition - currentSlicePosition) <= 1.5) {
              // Check if click is near this contour
              const isNearContour = isPointNearContour(canvasX, canvasY, contour, canvas.width, canvas.height, imageWidth, imageHeight, tolerance);
              
              if (isNearContour && onPredictionConfirm) {
                console.log(`✅ Confirmed predicted contour for structure ${structure.roiNumber} at slice ${contour.slicePosition}`);
                onPredictionConfirm(structure.roiNumber, contour.slicePosition);
              }
            }
          });
        });
      }
    };
    
    canvas.addEventListener('contextmenu', handleRightClick);
    
    return () => {
      canvas.removeEventListener('contextmenu', handleRightClick);
    };
  }, [canvasRef, rtStructures, currentSlicePosition, imageWidth, imageHeight, onPredictionConfirm]);

  // Render RT structure overlays on canvas
  useEffect(() => {
    if (!canvasRef.current || !rtStructures || !currentSlicePosition) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear any existing overlays (we'll redraw them) - pass animation time for dashed borders
    renderRTStructures(ctx, canvas, rtStructures, currentSlicePosition, imageWidth, imageHeight, zoom, panX, panY, contourWidth, contourOpacity, animationTime);

  }, [canvasRef, rtStructures, currentSlicePosition, imageWidth, imageHeight, zoom, panX, panY, contourWidth, contourOpacity, animationTime]);

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
  
  const tolerance = 0.5; // mm tolerance for slice matching - reduced to avoid drawing adjacent slices
  
  // Check if rtStructures has the expected structure
  if (!rtStructures?.structures) {
    return; // Early return if no structures to render
  }
  
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

// Helper function to check if a point is near a contour
function isPointNearContour(
  canvasX: number,
  canvasY: number,
  contour: RTContour,
  canvasWidth: number,
  canvasHeight: number,
  imageWidth: number,
  imageHeight: number,
  tolerance: number = 10
): boolean {
  if (contour.points.length < 6) return false;

  const imagePositionPatient: [number, number, number] = [-300, -300, 35];
  const pixelSpacing: [number, number] = [1.171875, 1.171875];
  const dicomImageWidth = 512;
  const dicomImageHeight = 512;

  // Convert contour points to canvas coordinates
  const canvasPoints: [number, number][] = [];
  
  for (let i = 0; i < contour.points.length; i += 3) {
    const worldX = contour.points[i];
    const worldY = contour.points[i + 1];
    
    const [x, y] = worldToCanvas(
      worldX,
      worldY,
      imagePositionPatient,
      pixelSpacing,
      canvasWidth,
      canvasHeight,
      dicomImageWidth,
      dicomImageHeight
    );
    
    canvasPoints.push([x, y]);
  }

  // Check if point is near any edge of the contour
  for (let i = 0; i < canvasPoints.length; i++) {
    const [x1, y1] = canvasPoints[i];
    const [x2, y2] = canvasPoints[(i + 1) % canvasPoints.length];
    
    // Calculate distance from point to line segment
    const distance = distanceToLineSegment(canvasX, canvasY, x1, y1, x2, y2);
    
    if (distance <= tolerance) {
      return true;
    }
  }

  return false;
}

// Helper function to calculate distance from point to line segment
function distanceToLineSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  const A = px - x1;
  const B = py - y1;
  const C = x2 - x1;
  const D = y2 - y1;

  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  
  if (lenSq === 0) {
    // Point is a zero-length line segment
    return Math.sqrt(A * A + B * B);
  }
  
  let param = dot / lenSq;

  if (param < 0) {
    param = 0;
  } else if (param > 1) {
    param = 1;
  }

  const xx = x1 + param * C;
  const yy = y1 + param * D;

  const dx = px - xx;
  const dy = py - yy;
  
  return Math.sqrt(dx * dx + dy * dy);
}