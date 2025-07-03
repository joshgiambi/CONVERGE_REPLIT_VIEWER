// OHIF-Enhanced Brush Tool - Clean Implementation
// Medical-grade brush tool with proper functionality

import { useEffect, useRef, useState, useCallback } from 'react';
import { Point, BrushOperation } from '@shared/schema';

interface OHIFEnhancedBrushProps {
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
  interpolationDensity?: number;
  enableSmartMode?: boolean;
  onBrushModeChange?: (mode: BrushOperation) => void;
}

export const OHIFEnhancedBrush: React.FC<OHIFEnhancedBrushProps> = ({
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
  interpolationDensity = 0.25,
  enableSmartMode = true,
  onBrushModeChange
}) => {
  const [isDrawing, setIsDrawing] = useState(false);
  const [operation, setOperation] = useState<BrushOperation>(BrushOperation.ADDITIVE);
  const [mousePosition, setMousePosition] = useState<Point | null>(null);
  const [operationLocked, setOperationLocked] = useState(false);
  const [strokeId, setStrokeId] = useState<string | null>(null);
  const strokePointsRef = useRef<Point[]>([]);
  const lastPositionRef = useRef<Point | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastRenderTime = useRef<number>(0);
  const renderThrottleMs = 16; // 60fps

  // Convert canvas coordinates to world coordinates
  const canvasToWorld = useCallback((canvasX: number, canvasY: number) => {
    if (!imageMetadata) {
      // Fallback to simple canvas coordinates if no metadata
      return { 
        x: (canvasX - panX) / zoom, 
        y: (canvasY - panY) / zoom 
      };
    }

    // Account for zoom and pan
    const adjustedX = (canvasX - panX) / zoom;
    const adjustedY = (canvasY - panY) / zoom;

    // Try to use proper DICOM world coordinates if available
    const imagePosition = imageMetadata.imagePositionPatient || imageMetadata.imagePosition;
    const pixelSpacing = imageMetadata.pixelSpacing;
    
    if (imagePosition && pixelSpacing) {
      const worldX = parseFloat(imagePosition[0]) + adjustedX * parseFloat(pixelSpacing[0]);
      const worldY = parseFloat(imagePosition[1]) + adjustedY * parseFloat(pixelSpacing[1]);
      return { x: worldX, y: worldY };
    }

    // Fallback to adjusted canvas coordinates
    return { x: adjustedX, y: adjustedY };
  }, [imageMetadata, zoom, panX, panY]);

  // Smart brush mode detection
  const detectBrushMode = useCallback((worldPoint: Point): BrushOperation => {
    if (!enableSmartMode || !selectedStructure || !rtStructures?.structures) {
      return operation;
    }

    const structure = rtStructures.structures.find((s: any) => s.roiNumber === selectedStructure);
    if (!structure?.contours?.[currentSlicePosition]) {
      return BrushOperation.ADDITIVE;
    }

    // Check if brush point intersects with any contour
    const contours = structure.contours[currentSlicePosition];
    for (const contour of contours) {
      if (pointInPolygon(worldPoint, contour)) {
        return BrushOperation.ADDITIVE; // Inside contour - add mode
      }
    }

    return BrushOperation.SUBTRACTIVE; // Outside contour - erase mode
  }, [enableSmartMode, selectedStructure, rtStructures, currentSlicePosition, operation]);

  // Point in polygon test
  const pointInPolygon = (point: Point, polygon: Point[]): boolean => {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      if (((polygon[i].y > point.y) !== (polygon[j].y > point.y)) &&
          (point.x < (polygon[j].x - polygon[i].x) * (point.y - polygon[i].y) / (polygon[j].y - polygon[i].y) + polygon[i].x)) {
        inside = !inside;
      }
    }
    return inside;
  };

  // Interpolate points for smooth strokes
  const interpolatePoints = (start: Point, end: Point): Point[] => {
    const distance = Math.sqrt(Math.pow(end.x - start.x, 2) + Math.pow(end.y - start.y, 2));
    const steps = Math.max(1, Math.floor(distance / (brushSize * interpolationDensity)));
    const points: Point[] = [];
    
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      points.push({
        x: start.x + (end.x - start.x) * t,
        y: start.y + (end.y - start.y) * t
      });
    }
    
    return points;
  };

  // Draw brush preview on canvas
  const drawBrushPreview = useCallback((canvasPoint: Point) => {
    if (!canvasRef.current) return;
    
    const now = Date.now();
    if (now - lastRenderTime.current < renderThrottleMs) return;
    
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;
    
    // Save current state
    ctx.save();
    
    // Use globalCompositeOperation to ensure clean brush preview
    ctx.globalCompositeOperation = 'source-over';
    
    // Draw brush circle
    const radius = brushSize / 2;
    const color = operation === BrushOperation.ADDITIVE ? '#00ff00' : '#ff0000';
    
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.globalAlpha = 0.8;
    
    ctx.beginPath();
    ctx.arc(canvasPoint.x, canvasPoint.y, radius, 0, 2 * Math.PI);
    ctx.stroke();
    
    // Draw crosshair in center
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
    lastRenderTime.current = now;
  }, [brushSize, operation, renderThrottleMs]);

  // Helper function to create circle from point
  const createCircleFromPoint = (center: Point, radius: number): Point[] => {
    const points: Point[] = [];
    const steps = 16;
    for (let i = 0; i < steps; i++) {
      const angle = (i / steps) * 2 * Math.PI;
      points.push({
        x: center.x + Math.cos(angle) * radius,
        y: center.y + Math.sin(angle) * radius
      });
    }
    return points;
  };

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

    const worldPoint = canvasToWorld(canvasPoint.x, canvasPoint.y);
    if (!worldPoint) return;

    // Smart brush mode detection
    if (!operationLocked) {
      const detectedOperation = detectBrushMode(worldPoint);
      setOperation(detectedOperation);
      setOperationLocked(true);
      
      if (onBrushModeChange) {
        onBrushModeChange(detectedOperation);
      }
    }

    setIsDrawing(true);
    setStrokeId(`stroke_${Date.now()}`);
    strokePointsRef.current = [worldPoint];
    lastPositionRef.current = worldPoint;

    console.log('Enhanced brush stroke started:', {
      operation: operation,
      position: worldPoint,
      slice: currentSlicePosition,
      brushSize: brushSize
    });
  }, [isActive, selectedStructure, canvasToWorld, detectBrushMode, operationLocked, onBrushModeChange, operation, brushSize, currentSlicePosition]);

  const handleMouseMove = useCallback((event: MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const canvasPoint = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };

    setMousePosition(canvasPoint);

    // Always draw preview when mouse is over canvas
    if (isActive) {
      drawBrushPreview(canvasPoint);
    }

    if (!isDrawing || !lastPositionRef.current) return;

    const worldPoint = canvasToWorld(canvasPoint.x, canvasPoint.y);
    if (!worldPoint) return;

    // Add interpolated points for smooth stroke
    const interpolatedPoints = interpolatePoints(lastPositionRef.current, worldPoint);
    strokePointsRef.current.push(...interpolatedPoints);
    lastPositionRef.current = worldPoint;
  }, [isActive, isDrawing, canvasToWorld, drawBrushPreview]);

  const handleMouseUp = useCallback(() => {
    if (!isDrawing || strokePointsRef.current.length === 0) return;

    setIsDrawing(false);
    setOperationLocked(false);

    // Create stroke polygon
    const strokePolygon = strokePointsRef.current.length > 2 ? 
      strokePointsRef.current : 
      createCircleFromPoint(strokePointsRef.current[0], brushSize / 2);

    console.log('Enhanced brush stroke completed:', {
      pointCount: strokePointsRef.current.length,
      strokePolygon: strokePolygon,
      operation: operation,
      selectedStructure: selectedStructure,
      currentSlicePosition: currentSlicePosition,
      hasOnContourUpdate: !!onContourUpdate
    });

    // Apply to structure if callback provided
    if (onContourUpdate && selectedStructure) {
      const updatedStructure = {
        ...selectedStructure,
        contours: {
          ...selectedStructure.contours,
          [currentSlicePosition]: [
            ...(selectedStructure.contours?.[currentSlicePosition] || []),
            strokePolygon
          ]
        }
      };
      
      console.log('Applying stroke to structure:', updatedStructure);
      onContourUpdate(updatedStructure);
    } else {
      console.warn('Cannot apply stroke - missing callback or structure:', {
        hasCallback: !!onContourUpdate,
        hasStructure: !!selectedStructure
      });
    }

    // Clear stroke data
    strokePointsRef.current = [];
    lastPositionRef.current = null;
    setStrokeId(null);
  }, [isDrawing, brushSize, currentSlicePosition, onContourUpdate, selectedStructure, createCircleFromPoint, operation]);

  // Set up mouse event listeners and cursor style
  useEffect(() => {
    if (!isActive || !canvasRef.current) return;

    const canvas = canvasRef.current;
    
    // Set custom cursor style for brush tool
    canvas.style.cursor = 'none'; // Hide default cursor to show custom brush cursor
    
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMoveUpdated);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('mouseleave', handleMouseUp);

    return () => {
      canvas.style.cursor = 'default'; // Reset cursor when deactivating
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('mousemove', handleMouseMoveUpdated);
      canvas.removeEventListener('mouseup', handleMouseUp);
      canvas.removeEventListener('mouseleave', handleMouseUp);
    };
  }, [isActive, handleMouseDown, handleMouseMoveUpdated, handleMouseUp]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!isActive) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Shift' && !operationLocked) {
        // Invert operation temporarily
        setOperation(prev => prev === BrushOperation.ADDITIVE ? BrushOperation.SUBTRACTIVE : BrushOperation.ADDITIVE);
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Shift' && !operationLocked) {
        // Reset to smart mode
        if (mousePosition) {
          const worldPoint = canvasToWorld(mousePosition.x, mousePosition.y);
          if (worldPoint) {
            const detectedOperation = detectBrushMode(worldPoint);
            setOperation(detectedOperation);
          }
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
    };
  }, [isActive, operationLocked, mousePosition, canvasToWorld, detectBrushMode]);

  // Create overlay canvas for brush cursor
  useEffect(() => {
    if (!isActive || !canvasRef.current) {
      if (previewCanvasRef.current) {
        previewCanvasRef.current.remove();
        previewCanvasRef.current = null;
      }
      return;
    }

    const mainCanvas = canvasRef.current;
    const rect = mainCanvas.getBoundingClientRect();
    
    // Create overlay canvas for brush preview
    const overlayCanvas = document.createElement('canvas');
    overlayCanvas.width = mainCanvas.width;
    overlayCanvas.height = mainCanvas.height;
    overlayCanvas.style.position = 'absolute';
    overlayCanvas.style.top = '0';
    overlayCanvas.style.left = '0';
    overlayCanvas.style.pointerEvents = 'none';
    overlayCanvas.style.zIndex = '10';
    
    mainCanvas.parentElement?.appendChild(overlayCanvas);
    previewCanvasRef.current = overlayCanvas;

    return () => {
      if (overlayCanvas && overlayCanvas.parentElement) {
        overlayCanvas.remove();
      }
    };
  }, [isActive]);

  // Enhanced brush preview with dedicated canvas
  const drawBrushPreviewOnOverlay = useCallback((canvasPoint: Point) => {
    if (!previewCanvasRef.current) return;
    
    const canvas = previewCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Clear entire overlay
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
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
    
    // Draw crosshair in center
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

  // Update mouse move to use overlay canvas
  const handleMouseMoveUpdated = useCallback((event: MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const canvasPoint = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };

    setMousePosition(canvasPoint);

    // Always draw preview when mouse is over canvas and brush is active
    if (isActive) {
      drawBrushPreviewOnOverlay(canvasPoint);
    }

    if (!isDrawing || !lastPositionRef.current) return;

    const worldPoint = canvasToWorld(canvasPoint.x, canvasPoint.y);
    if (!worldPoint) return;

    // Add interpolated points for smooth stroke
    const interpolatedPoints = interpolatePoints(lastPositionRef.current, worldPoint);
    strokePointsRef.current.push(...interpolatedPoints);
    lastPositionRef.current = worldPoint;
  }, [isActive, isDrawing, canvasToWorld, drawBrushPreviewOnOverlay]);

  // Render component
  if (!isActive) return null;

  return (
    <div className="absolute inset-0 pointer-events-none">
      {/* Enhanced brush info overlay */}
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
              {operation === BrushOperation.ADDITIVE ? 'Add' : 'Erase'} • {brushSize}px
            </span>
          </div>
          {enableSmartMode && (
            <div className="text-xs opacity-75 mt-1">
              Smart Mode • Shift to invert
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default OHIFEnhancedBrush;