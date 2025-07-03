import { useCallback, useEffect, useRef, useState } from 'react';
import { BrushOperation } from '@shared/schema';

interface Point {
  x: number;
  y: number;
}

interface PixelBrushToolProps {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  isActive: boolean;
  brushSize: number;
  selectedStructure?: any;
  rtStructures?: any;
  currentSlicePosition: number;
  onContourUpdate?: (updatedStructures: any) => void;
  zoom: number;
  panX: number;
  panY: number;
  imageMetadata?: any;
  smoothingEnabled?: boolean;
  enableSmartMode?: boolean;
  onBrushModeChange?: (mode: BrushOperation) => void;
}

export const PixelBrushTool: React.FC<PixelBrushToolProps> = ({
  canvasRef,
  isActive,
  brushSize,
  selectedStructure,
  rtStructures,
  currentSlicePosition,
  onContourUpdate,
  zoom,
  panX,
  panY,
  imageMetadata,
  smoothingEnabled = true,
  enableSmartMode = false,
  onBrushModeChange
}) => {
  const [isDrawing, setIsDrawing] = useState(false);
  const [operation, setOperation] = useState<BrushOperation>(BrushOperation.ADDITIVE);
  const [mousePosition, setMousePosition] = useState<Point | null>(null);
  const [lastPosition, setLastPosition] = useState<Point | null>(null);
  
  // Canvas for storing the painted mask
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  
  // Track the slice we're painting on to ensure slice-specific visibility
  const [paintingSlice, setPaintingSlice] = useState<number | null>(null);
  
  // Convert millimeter brush size to canvas pixels based on zoom and pixel spacing
  const brushSizePixels = Math.max(1, Math.round(brushSize * zoom * 0.85)); // ~1mm per pixel at zoom=1
  
  // Get structure color
  const structureColor = selectedStructure && rtStructures?.structures 
    ? rtStructures.structures.find((s: any) => s.roiNumber === selectedStructure)?.color || [255, 255, 0]
    : [255, 255, 0];

  // Draw brush preview cursor
  const drawBrushPreview = useCallback((canvasPoint: Point) => {
    if (!previewCanvasRef.current) return;
    
    const ctx = previewCanvasRef.current.getContext('2d');
    if (!ctx) return;
    
    // Clear previous preview
    ctx.clearRect(0, 0, previewCanvasRef.current.width, previewCanvasRef.current.height);
    
    const radius = brushSizePixels / 2;
    const color = structureColor;
    
    ctx.save();
    
    // Draw cursor circle with structure color
    ctx.strokeStyle = operation === BrushOperation.ADDITIVE 
      ? `rgba(${color[0]}, ${color[1]}, ${color[2]}, 0.8)`
      : 'rgba(255, 0, 0, 0.8)'; // Red for subtraction
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    
    ctx.beginPath();
    ctx.arc(canvasPoint.x, canvasPoint.y, radius, 0, 2 * Math.PI);
    ctx.stroke();
    
    // Add center dot
    ctx.fillStyle = ctx.strokeStyle;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(canvasPoint.x, canvasPoint.y, 1, 0, 2 * Math.PI);
    ctx.fill();
    
    ctx.restore();
  }, [brushSizePixels, operation]);

  // Paint pixels matching medical contour style (filled with 3px border)
  const paintPixels = useCallback((canvasPoint: Point) => {
    if (!maskCanvasRef.current) return;
    
    const ctx = maskCanvasRef.current.getContext('2d');
    if (!ctx) return;
    
    const radius = brushSizePixels / 2;
    const color = structureColor;
    
    ctx.save();
    
    if (operation === BrushOperation.ADDITIVE) {
      ctx.globalCompositeOperation = 'source-over';
      
      // Draw filled circle
      ctx.fillStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, 1.0)`;
      ctx.beginPath();
      ctx.arc(canvasPoint.x, canvasPoint.y, radius, 0, 2 * Math.PI);
      ctx.fill();
      
      // Draw 3px border around the filled area
      ctx.strokeStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, 1.0)`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(canvasPoint.x, canvasPoint.y, radius + 1.5, 0, 2 * Math.PI); // Offset for border
      ctx.stroke();
      
    } else {
      // Erase pixels (including border area)
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0, 0, 0, 1.0)';
      ctx.beginPath();
      ctx.arc(canvasPoint.x, canvasPoint.y, radius + 3, 0, 2 * Math.PI); // Include border in erase
      ctx.fill();
    }
    
    ctx.restore();
  }, [brushSizePixels, operation, structureColor]);

  // Paint continuous line matching medical contour style (filled with 3px border)
  const paintLine = useCallback((from: Point, to: Point) => {
    if (!maskCanvasRef.current) return;
    
    const ctx = maskCanvasRef.current.getContext('2d');
    if (!ctx) return;
    
    const color = structureColor;
    const lineWidth = brushSizePixels;
    
    ctx.save();
    
    if (operation === BrushOperation.ADDITIVE) {
      ctx.globalCompositeOperation = 'source-over';
      
      // Draw filled stroke
      ctx.strokeStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, 1.0)`;
      ctx.lineWidth = lineWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      
      // Add filled circles at endpoints for smooth connection
      ctx.fillStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, 1.0)`;
      ctx.beginPath();
      ctx.arc(from.x, from.y, lineWidth / 2, 0, 2 * Math.PI);
      ctx.fill();
      
      ctx.beginPath();
      ctx.arc(to.x, to.y, lineWidth / 2, 0, 2 * Math.PI);
      ctx.fill();
      
      // Draw 3px border around the stroke
      ctx.strokeStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, 1.0)`;
      ctx.lineWidth = lineWidth + 6; // 3px on each side
      ctx.globalCompositeOperation = 'destination-over'; // Draw border behind
      
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      
      // Border circles at endpoints
      ctx.fillStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, 1.0)`;
      ctx.beginPath();
      ctx.arc(from.x, from.y, (lineWidth + 6) / 2, 0, 2 * Math.PI);
      ctx.fill();
      
      ctx.beginPath();
      ctx.arc(to.x, to.y, (lineWidth + 6) / 2, 0, 2 * Math.PI);
      ctx.fill();
      
    } else {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0, 0, 0, 1.0)';
      ctx.fillStyle = 'rgba(0, 0, 0, 1.0)';
      
      // Erase with slightly larger area to include border
      ctx.lineWidth = lineWidth + 6;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      
      ctx.beginPath();
      ctx.arc(from.x, from.y, (lineWidth + 6) / 2, 0, 2 * Math.PI);
      ctx.fill();
      
      ctx.beginPath();
      ctx.arc(to.x, to.y, (lineWidth + 6) / 2, 0, 2 * Math.PI);
      ctx.fill();
    }
    
    ctx.restore();
  }, [brushSizePixels, operation, structureColor]);

  // Convert brush strokes to actual contour points in RT structure data
  const convertBrushToContour = useCallback(() => {
    if (!maskCanvasRef.current || !selectedStructure || !rtStructures || !imageMetadata) return;

    const canvas = maskCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Get the painted pixels from the mask canvas
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    
    // Extract contour points from painted pixels
    const contourPoints = extractContourFromPixels(data, canvas.width, canvas.height);
    
    if (contourPoints.length === 0) return;

    // Convert canvas coordinates to DICOM world coordinates
    const worldPoints = contourPoints.map(point => {
      return canvasToWorldCoordinates(point, imageMetadata, zoom, panX, panY);
    });

    // Update the RT structure data
    updateRTStructureContour(selectedStructure, currentSlicePosition, worldPoints);

    // Clear the brush canvas since it's now part of the structure
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Trigger contour update callback to refresh the display
    if (onContourUpdate && rtStructures) {
      onContourUpdate(rtStructures);
    }
  }, [selectedStructure, currentSlicePosition, rtStructures, imageMetadata, zoom, panX, panY, onContourUpdate]);

  // Extract contour points from painted pixels using edge detection
  const extractContourFromPixels = useCallback((data: Uint8ClampedArray, width: number, height: number) => {
    const contourPoints: Point[] = [];
    
    // Simple edge detection to find contour boundary
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const index = (y * width + x) * 4;
        const alpha = data[index + 3];
        
        // If this pixel is painted
        if (alpha > 0) {
          // Check if it's on the edge (has unpainted neighbors)
          const hasUnpaintedNeighbor = [
            [-1, 0], [1, 0], [0, -1], [0, 1]
          ].some(([dx, dy]) => {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) return true;
            const nIndex = (ny * width + nx) * 4;
            return data[nIndex + 3] === 0;
          });
          
          if (hasUnpaintedNeighbor) {
            contourPoints.push({ x, y });
          }
        }
      }
    }
    
    return contourPoints;
  }, []);

  // Convert canvas coordinates to DICOM world coordinates
  const canvasToWorldCoordinates = useCallback((point: Point, metadata: any, currentZoom: number, currentPanX: number, currentPanY: number) => {
    // Parse DICOM spatial parameters
    const imagePosition = metadata.imagePosition?.split('\\').map(Number) || [-300, -300, 0];
    const pixelSpacing = metadata.pixelSpacing?.split('\\').map(Number) || [1.171875, 1.171875];
    const imageOrientation = metadata.imageOrientation?.split('\\').map(Number) || [1, 0, 0, 0, 1, 0];
    
    // Account for zoom and pan
    const canvasX = (point.x - currentPanX) / currentZoom;
    const canvasY = (point.y - currentPanY) / currentZoom;
    
    // Convert to DICOM patient coordinates
    const worldX = imagePosition[0] + (canvasX * pixelSpacing[0] * imageOrientation[0]) + (canvasY * pixelSpacing[1] * imageOrientation[3]);
    const worldY = imagePosition[1] + (canvasX * pixelSpacing[0] * imageOrientation[1]) + (canvasY * pixelSpacing[1] * imageOrientation[4]);
    const worldZ = imagePosition[2] + (canvasX * pixelSpacing[0] * imageOrientation[2]) + (canvasY * pixelSpacing[1] * imageOrientation[5]);
    
    return [worldX, worldY, worldZ];
  }, []);

  // Update RT structure contour data with new points
  const updateRTStructureContour = useCallback((structureId: number, slicePosition: number, worldPoints: number[][]) => {
    if (!rtStructures) return;

    // Find the structure to update
    const structure = rtStructures.structures.find((s: any) => s.roiNumber === structureId);
    if (!structure) return;

    // Find or create contour for this slice
    let sliceContour = structure.contours.find((c: any) => 
      Math.abs(c.slicePosition - slicePosition) < 1.0
    );

    if (!sliceContour) {
      // Create new contour for this slice
      sliceContour = {
        slicePosition: slicePosition,
        points: worldPoints.flat()
      };
      structure.contours.push(sliceContour);
    } else {
      // Update existing contour
      if (operation === BrushOperation.ADDITIVE) {
        // Merge with existing points
        sliceContour.points = [...sliceContour.points, ...worldPoints.flat()];
      } else {
        // For subtraction, we'd need more complex polygon operations
        // For now, replace the contour
        sliceContour.points = worldPoints.flat();
      }
    }

    console.log('Updated RT structure contour:', {
      structureId,
      slicePosition,
      pointCount: worldPoints.length,
      totalPoints: sliceContour.points.length / 3
    });
  }, [rtStructures, operation]);

  // Mouse event handlers
  const handleMouseDown = useCallback((event: MouseEvent) => {
    if (!isActive || !selectedStructure || event.button !== 0) return;

    event.preventDefault();
    event.stopPropagation();

    const rect = canvasRef.current!.getBoundingClientRect();
    const canvasPoint = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };

    setIsDrawing(true);
    setLastPosition(canvasPoint);
    
    // Set the painting slice to ensure slice-specific visibility
    setPaintingSlice(currentSlicePosition);
    
    // Start painting immediately
    paintPixels(canvasPoint);

    console.log('Pixel brush started painting:', {
      operation: operation,
      position: canvasPoint,
      slice: currentSlicePosition,
      brushSize: brushSize
    });
  }, [isActive, selectedStructure, paintPixels, operation, currentSlicePosition, brushSize]);

  const handleMouseMove = useCallback((event: MouseEvent) => {
    if (!isActive) return;

    const rect = canvasRef.current!.getBoundingClientRect();
    const canvasPoint = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };

    setMousePosition(canvasPoint);
    drawBrushPreview(canvasPoint);

    if (isDrawing && lastPosition) {
      if (smoothingEnabled) {
        paintLine(lastPosition, canvasPoint);
      } else {
        paintPixels(canvasPoint);
      }
      setLastPosition(canvasPoint);
    }
  }, [isActive, isDrawing, lastPosition, drawBrushPreview, paintPixels, paintLine, smoothingEnabled]);

  const handleMouseUp = useCallback((event?: MouseEvent) => {
    console.log('Mouse up event triggered', { isDrawing, selectedStructure });
    
    if (!isDrawing) return;

    setIsDrawing(false);
    setLastPosition(null);

    try {
      // Convert brush strokes to contour data and update RT structures
      convertBrushToContour();
      
      console.log('Pixel brush stroke completed and converted to contour:', {
        structureId: selectedStructure,
        slice: currentSlicePosition,
        operation: operation,
        brushSize: brushSize
      });
      
    } catch (error) {
      console.error('Error in handleMouseUp:', error);
    }
  }, [isDrawing, selectedStructure, currentSlicePosition, operation, brushSize, convertBrushToContour]);

  // Hide mask canvas when not on the painting slice
  useEffect(() => {
    if (maskCanvasRef.current) {
      const isOnPaintingSlice = paintingSlice === null || paintingSlice === currentSlicePosition;
      maskCanvasRef.current.style.visibility = isOnPaintingSlice ? 'visible' : 'hidden';
    }
  }, [currentSlicePosition, paintingSlice]);

  // Create overlay canvases for mask and preview
  useEffect(() => {
    if (!isActive || !canvasRef.current) {
      // Clean up canvases when inactive
      if (maskCanvasRef.current) {
        maskCanvasRef.current.remove();
        maskCanvasRef.current = null;
      }
      if (previewCanvasRef.current) {
        previewCanvasRef.current.remove();
        previewCanvasRef.current = null;
      }
      // Reset painting slice when tool is deactivated
      setPaintingSlice(null);
      return;
    }

    const mainCanvas = canvasRef.current;
    const canvasContainer = mainCanvas.parentElement;
    if (!canvasContainer) return;
    
    // Create mask canvas for painting
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = mainCanvas.width;
    maskCanvas.height = mainCanvas.height;
    maskCanvas.style.position = 'absolute';
    maskCanvas.style.top = '0';
    maskCanvas.style.left = '0';
    maskCanvas.style.pointerEvents = 'none';
    maskCanvas.style.zIndex = '5';
    maskCanvas.style.opacity = '0.3'; // Match medical imaging standard: 30% opacity
    
    // Create preview canvas for cursor
    const previewCanvas = document.createElement('canvas');
    previewCanvas.width = mainCanvas.width;
    previewCanvas.height = mainCanvas.height;
    previewCanvas.style.position = 'absolute';
    previewCanvas.style.top = '0';
    previewCanvas.style.left = '0';
    previewCanvas.style.pointerEvents = 'none';
    previewCanvas.style.zIndex = '10';
    
    canvasContainer.appendChild(maskCanvas);
    canvasContainer.appendChild(previewCanvas);
    
    maskCanvasRef.current = maskCanvas;
    previewCanvasRef.current = previewCanvas;

    return () => {
      if (maskCanvas.parentElement) maskCanvas.remove();
      if (previewCanvas.parentElement) previewCanvas.remove();
    };
  }, [isActive]);

  // Set up mouse event listeners
  useEffect(() => {
    if (!isActive || !canvasRef.current) return;

    const canvas = canvasRef.current;
    
    // Hide default cursor to show custom brush cursor
    canvas.style.cursor = 'none';
    
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('mouseleave', handleMouseUp);

    return () => {
      canvas.style.cursor = 'default';
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseup', handleMouseUp);
      canvas.removeEventListener('mouseleave', handleMouseUp);
    };
  }, [isActive, handleMouseDown, handleMouseMove, handleMouseUp]);

  // Keyboard shortcuts for operation switching
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isActive) return;
      
      if (event.key === 'Shift') {
        setOperation(BrushOperation.SUBTRACTIVE);
        if (onBrushModeChange) onBrushModeChange(BrushOperation.SUBTRACTIVE);
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (!isActive) return;
      
      if (event.key === 'Shift') {
        setOperation(BrushOperation.ADDITIVE);
        if (onBrushModeChange) onBrushModeChange(BrushOperation.ADDITIVE);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
    };
  }, [isActive, onBrushModeChange]);

  return null;
};