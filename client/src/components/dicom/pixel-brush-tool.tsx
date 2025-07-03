// Pixel-Based Brush Tool - Video Game Style Painting
// Paints pixels directly onto structure masks like a paint brush

import { useEffect, useRef, useState, useCallback } from 'react';
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
  
  // Structure color for painting
  const structureColor = selectedStructure?.color || [255, 0, 0];

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
    
    // Draw brush circle
    const radius = brushSize / 2;
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
  }, [brushSize, operation]);

  // Paint pixels on the mask canvas
  const paintPixels = useCallback((canvasPoint: Point) => {
    if (!maskCanvasRef.current) return;
    
    const ctx = maskCanvasRef.current.getContext('2d');
    if (!ctx) return;
    
    const pixelCoords = canvasToPixel(canvasPoint.x, canvasPoint.y);
    const radius = brushSize / 2;
    
    ctx.save();
    
    if (operation === BrushOperation.ADDITIVE) {
      // Paint with structure color
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = `rgba(${structureColor[0]}, ${structureColor[1]}, ${structureColor[2]}, 0.5)`;
    } else {
      // Erase pixels
      ctx.globalCompositeOperation = 'destination-out';
    }
    
    // Draw filled circle at pixel coordinates
    ctx.beginPath();
    ctx.arc(pixelCoords.x * zoom + panX, pixelCoords.y * zoom + panY, radius, 0, 2 * Math.PI);
    ctx.fill();
    
    ctx.restore();

    // Show the painted result on main canvas
    if (canvasRef.current) {
      const mainCtx = canvasRef.current.getContext('2d');
      if (mainCtx) {
        // Overlay the mask canvas onto the main canvas
        mainCtx.save();
        mainCtx.globalAlpha = 0.5;
        mainCtx.drawImage(maskCanvasRef.current, 0, 0);
        mainCtx.restore();
      }
    }
  }, [canvasToPixel, brushSize, operation, structureColor, zoom, panX, panY]);

  // Paint smooth line between two points
  const paintLine = useCallback((from: Point, to: Point) => {
    const distance = Math.sqrt(Math.pow(to.x - from.x, 2) + Math.pow(to.y - from.y, 2));
    const steps = Math.max(1, Math.floor(distance / (brushSize * 0.3)));
    
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const interpolatedPoint = {
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t
      };
      paintPixels(interpolatedPoint);
    }
  }, [paintPixels, brushSize]);

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

  const handleMouseUp = useCallback(() => {
    if (!isDrawing) return;

    setIsDrawing(false);
    setLastPosition(null);

    // Convert painted pixels to structure data
    if (onContourUpdate && selectedStructure && maskCanvasRef.current) {
      // For now, we'll create a simple update notification
      // In a full implementation, you'd extract the painted pixels and convert to structure format
      const updatedStructure = {
        ...selectedStructure,
        lastModified: Date.now(),
        slice: currentSlicePosition,
        operation: operation
      };
      
      console.log('Pixel brush stroke completed:', {
        structure: selectedStructure,
        slice: currentSlicePosition,
        operation: operation
      });
      
      onContourUpdate(updatedStructure);
    }
  }, [isDrawing, onContourUpdate, selectedStructure, currentSlicePosition, operation]);

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
            borderColor: operation === BrushOperation.ADDITIVE ? '#00ff00' : '#ff0000'
          }}
        >
          <div className="flex items-center gap-2">
            <div 
              className="w-3 h-3 rounded-full border-2"
              style={{
                backgroundColor: operation === BrushOperation.ADDITIVE ? '#00ff00' : '#ff0000',
                borderColor: operation === BrushOperation.ADDITIVE ? '#00ff00' : '#ff0000'
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