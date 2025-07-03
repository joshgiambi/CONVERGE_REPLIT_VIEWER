// Pixel-Based Brush Tool - Video Game Style Painting
// Paints pixels directly onto structure masks like a paint brush

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Point, BrushOperation } from '@shared/schema';

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
  enableSmartMode = true,
  onBrushModeChange
}) => {
  const [isDrawing, setIsDrawing] = useState(false);
  const [operation, setOperation] = useState<BrushOperation>(BrushOperation.ADDITIVE);
  const [mousePosition, setMousePosition] = useState<Point | null>(null);
  const [lastPosition, setLastPosition] = useState<Point | null>(null);
  
  // Canvas for storing the painted mask
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  
  // Get the actual structure object from rtStructures using the selectedStructure ID
  const selectedStructureData = useMemo(() => {
    if (!selectedStructure || !rtStructures?.structures) return null;
    return rtStructures.structures.find((s: any) => s.roiNumber === selectedStructure);
  }, [selectedStructure, rtStructures]);
  
  // Structure color for painting (use the selected structure's color)
  const structureColor = selectedStructureData?.color || [255, 0, 0];
  
  // Debug logging for structure color
  useEffect(() => {
    if (selectedStructureData) {
      console.log('Brush tool selected structure:', {
        roiNumber: selectedStructureData.roiNumber,
        structureName: selectedStructureData.structureName,
        color: selectedStructureData.color,
        structureColor: structureColor
      });
    }
  }, [selectedStructureData, structureColor]);

  // Get pixel spacing in mm from image metadata
  const pixelSpacingMm = useMemo(() => {
    if (!imageMetadata?.pixelSpacing) return 1.171875; // HN-ATLAS default
    const spacing = imageMetadata.pixelSpacing.split('\\');
    return parseFloat(spacing[0]) || 1.171875;
  }, [imageMetadata]);

  // Convert brush size from pixels to millimeters for consistent physical sizing
  const brushSizeMm = useMemo(() => {
    return brushSize * pixelSpacingMm; // Convert pixels to mm
  }, [brushSize, pixelSpacingMm]);

  // Convert millimeters to pixels for current zoom level
  const brushSizePixels = useMemo(() => {
    return (brushSizeMm / pixelSpacingMm) * zoom;
  }, [brushSizeMm, pixelSpacingMm, zoom]);

  // Convert canvas coordinates to image pixel coordinates
  const canvasToPixel = useCallback((canvasX: number, canvasY: number) => {
    // Account for zoom and pan to get actual image coordinates
    const imageX = Math.round((canvasX - panX) / zoom);
    const imageY = Math.round((canvasY - panY) / zoom);
    return { x: imageX, y: imageY };
  }, [zoom, panX, panY]);

  // Draw brush preview cursor
  const drawBrushPreview = useCallback((canvasPoint: Point) => {
    if (!previewCanvasRef.current) return;
    
    const ctx = previewCanvasRef.current.getContext('2d');
    if (!ctx) return;
    
    // Clear entire preview canvas
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    
    // Draw brush circle using millimeter-based sizing
    const radius = brushSizePixels / 2;
    const color = operation === BrushOperation.ADDITIVE ? '#00ff00' : '#ff0000';
    
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.globalAlpha = 0.8;
    
    ctx.beginPath();
    ctx.arc(canvasPoint.x, canvasPoint.y, radius, 0, 2 * Math.PI);
    ctx.stroke();
    
    // Draw crosshair
    ctx.setLineDash([]);
    ctx.lineWidth = 1;
    ctx.globalAlpha = 1;
    
    ctx.beginPath();
    ctx.moveTo(canvasPoint.x - 6, canvasPoint.y);
    ctx.lineTo(canvasPoint.x + 6, canvasPoint.y);
    ctx.moveTo(canvasPoint.x, canvasPoint.y - 6);
    ctx.lineTo(canvasPoint.x, canvasPoint.y + 6);
    ctx.stroke();
    
    ctx.restore();
  }, [brushSizePixels, operation]);

  // Paint pixels on the mask canvas with continuous brush strokes
  const paintPixels = useCallback((canvasPoint: Point) => {
    if (!maskCanvasRef.current) return;
    
    const ctx = maskCanvasRef.current.getContext('2d');
    if (!ctx) return;
    
    const radius = brushSizePixels / 2;
    
    ctx.save();
    
    // Use proper structure color from selected structure
    const color = structureColor;
    
    if (operation === BrushOperation.ADDITIVE) {
      // Paint with exact structure color
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, 1.0)`;
    } else {
      // Erase pixels
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0, 0, 0, 1.0)';
    }
    
    // Draw filled circle with smooth edges
    ctx.beginPath();
    ctx.arc(canvasPoint.x, canvasPoint.y, radius, 0, 2 * Math.PI);
    ctx.fill();
    
    ctx.restore();

    // Don't modify the main canvas directly - let the mask canvas handle the overlay
    // The mask canvas will be composited later
  }, [brushSizePixels, operation, selectedStructure]);

  // Paint continuous line using rectangle for smooth strokes instead of overlapping circles
  const paintLine = useCallback((from: Point, to: Point) => {
    if (!maskCanvasRef.current) return;
    
    const ctx = maskCanvasRef.current.getContext('2d');
    if (!ctx) return;
    
    const color = structureColor;
    const lineWidth = brushSizePixels;
    
    ctx.save();
    
    if (operation === BrushOperation.ADDITIVE) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, 1.0)`;
      ctx.fillStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, 1.0)`;
    } else {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0, 0, 0, 1.0)';
      ctx.fillStyle = 'rgba(0, 0, 0, 1.0)';
    }
    
    // Draw line with round caps for smooth continuous strokes
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    
    // Add round end caps
    ctx.beginPath();
    ctx.arc(from.x, from.y, lineWidth / 2, 0, 2 * Math.PI);
    ctx.fill();
    
    ctx.beginPath();
    ctx.arc(to.x, to.y, lineWidth / 2, 0, 2 * Math.PI);
    ctx.fill();
    
    ctx.restore();
  }, [brushSizePixels, operation, selectedStructure]);

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
    const rect = canvasRef.current!.getBoundingClientRect();
    const canvasPoint = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };

    setMousePosition(canvasPoint);

    // Always show preview when brush is active
    if (isActive) {
      drawBrushPreview(canvasPoint);
    }

    // Continue painting if drawing
    if (isDrawing && lastPosition) {
      if (smoothingEnabled) {
        paintLine(lastPosition, canvasPoint);
      } else {
        paintPixels(canvasPoint);
      }
      setLastPosition(canvasPoint);
    }
  }, [isActive, isDrawing, lastPosition, drawBrushPreview, paintPixels, paintLine, smoothingEnabled]);

  // Flood fill for enclosed regions
  const floodFillEnclosedRegions = useCallback(() => {
    if (!maskCanvasRef.current) return;
    
    const ctx = maskCanvasRef.current.getContext('2d');
    if (!ctx) return;
    
    const canvas = maskCanvasRef.current;
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    
    // Simple flood fill algorithm to fill enclosed regions
    // This would be implemented with a proper seed fill algorithm
    // For now, we'll just update the display
    ctx.putImageData(imageData, 0, 0);
    
    // The mask canvas will be automatically visible as an overlay
  }, []);

  const handleMouseUp = useCallback((event?: MouseEvent) => {
    console.log('Mouse up event triggered', { isDrawing, selectedStructure });
    
    if (!isDrawing) return;

    setIsDrawing(false);
    setLastPosition(null);

    try {
      // Apply flood fill to enclosed regions after stroke completion
      setTimeout(() => {
        try {
          floodFillEnclosedRegions();
        } catch (error) {
          console.error('Error in flood fill:', error);
        }
      }, 50);

      // Skip contour update callback to avoid DICOM parsing errors
      // The painted pixels are already visible on the mask canvas
      console.log('Pixel brush stroke completed:', {
        structureId: selectedStructure,
        slice: currentSlicePosition,
        operation: operation,
        brushSize: brushSize
      });
      
    } catch (error) {
      console.error('Error in handleMouseUp:', error);
    }
  }, [isDrawing, selectedStructure, currentSlicePosition, operation, brushSize, floodFillEnclosedRegions]);

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
    maskCanvas.style.opacity = '0.6'; // Make it semi-transparent so we can see the underlying image
    
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
    if (!isActive) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Shift') {
        setOperation(BrushOperation.SUBTRACTIVE);
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Shift') {
        setOperation(BrushOperation.ADDITIVE);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
    };
  }, [isActive]);

  // Render component
  if (!isActive) return null;

  return (
    <div className="absolute inset-0 pointer-events-none">
      {/* Brush info overlay */}
      {mousePosition && (
        <div 
          className="absolute bg-black/90 text-white px-3 py-2 rounded-md text-sm font-medium pointer-events-none shadow-lg border"
          style={{
            left: mousePosition.x + 15,
            top: mousePosition.y - 45,
            zIndex: 20,
            borderColor: operation === BrushOperation.ADDITIVE ? `rgb(${structureColor.join(',')})` : '#ff0000'
          }}
        >
          <div className="flex items-center gap-2">
            <div 
              className="w-3 h-3 rounded-full border-2"
              style={{
                backgroundColor: operation === BrushOperation.ADDITIVE ? `rgb(${structureColor.join(',')})` : '#ff0000',
                borderColor: operation === BrushOperation.ADDITIVE ? `rgb(${structureColor.join(',')})` : '#ff0000'
              }}
            />
            <span>
              {operation === BrushOperation.ADDITIVE ? 'Paint' : 'Erase'} • {brushSize}px
            </span>
          </div>
          <div className="text-xs opacity-75 mt-1">
            Hold Shift to erase
          </div>
        </div>
      )}
    </div>
  );
};

export default PixelBrushTool;