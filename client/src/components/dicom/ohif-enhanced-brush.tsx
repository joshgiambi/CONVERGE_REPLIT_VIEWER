// OHIF-Enhanced Brush Tool - Professional medical segmentation
// Following OHIF patterns for smooth brush operations with improved functionality

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
  const brushHistoryRef = useRef<Array<{id: string, points: Point[], operation: BrushOperation}>>([]);
  
  // Performance tracking
  const lastRenderTime = useRef<number>(0);
  const renderThrottleMs = 16; // 60fps

  // Convert millimeters to world space coordinates
  const mmToWorldSpace = useCallback((mm: number): number => {
    if (!imageMetadata?.pixelSpacing) return mm;
    return mm / Math.min(imageMetadata.pixelSpacing[0], imageMetadata.pixelSpacing[1]);
  }, [imageMetadata]);

  // Distance from point to line segment
  const distanceToLineSegment = (point: Point, lineStart: Point, lineEnd: Point): number => {
    const A = point.x - lineStart.x;
    const B = point.y - lineStart.y;
    const C = lineEnd.x - lineStart.x;
    const D = lineEnd.y - lineStart.y;

    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    
    if (lenSq === 0) return Math.sqrt(A * A + B * B);
    
    let param = dot / lenSq;
    
    if (param < 0) {
      return Math.sqrt(A * A + B * B);
    } else if (param > 1) {
      const dx = point.x - lineEnd.x;
      const dy = point.y - lineEnd.y;
      return Math.sqrt(dx * dx + dy * dy);
    } else {
      const projX = lineStart.x + param * C;
      const projY = lineStart.y + param * D;
      const dx = point.x - projX;
      const dy = point.y - projY;
      return Math.sqrt(dx * dx + dy * dy);
    }
  };

  // Point in polygon test with improved precision
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

  // Enhanced brush-contour intersection detection
  const brushIntersectsContour = useCallback((center: Point, radius: number, contour: Point[]): boolean => {
    // Check if brush circle intersects with polygon edges
    for (let i = 0; i < contour.length; i++) {
      const p1 = contour[i];
      const p2 = contour[(i + 1) % contour.length];
      
      if (distanceToLineSegment(center, p1, p2) <= radius) {
        return true;
      }
    }
    
    // Check if center is inside polygon
    return pointInPolygon(center, contour);
  }, []);

  // Convert canvas coordinates to world coordinates
  const canvasToWorld = useCallback((canvasX: number, canvasY: number) => {
    if (!imageMetadata) return null;

    // Account for zoom and pan
    const adjustedX = (canvasX - panX) / zoom;
    const adjustedY = (canvasY - panY) / zoom;

    // Convert to world coordinates using image metadata
    const { imagePositionPatient, pixelSpacing } = imageMetadata;
    if (!imagePositionPatient || !pixelSpacing) return null;

    const worldX = imagePositionPatient[0] + adjustedX * pixelSpacing[0];
    const worldY = imagePositionPatient[1] + adjustedY * pixelSpacing[1];

    return { x: worldX, y: worldY };
  }, [imageMetadata, zoom, panX, panY]);

  // Enhanced Smart brush mode detection - Following OHIF standards
  const detectBrushMode = useCallback((worldPoint: Point): BrushOperation => {
    if (!enableSmartMode || !selectedStructure || !rtStructures?.structures) {
      return operation;
    }

    const structure = rtStructures.structures.find((s: any) => s.roiNumber === selectedStructure);
    if (!structure?.contours?.[currentSlicePosition]) {
      return BrushOperation.ADDITIVE;
    }

    // Enhanced contour intersection detection with brush radius consideration
    const contours = structure.contours[currentSlicePosition];
    const brushRadiusInWorld = mmToWorldSpace(brushSize / 2);
    
    for (const contour of contours) {
      // Check if brush circle intersects with contour polygon
      if (brushIntersectsContour(worldPoint, brushRadiusInWorld, contour)) {
        return BrushOperation.ADDITIVE; // Green cursor - touching contour
      }
    }

    return BrushOperation.SUBTRACTIVE; // Red cursor - not touching contour
  }, [enableSmartMode, selectedStructure, rtStructures, currentSlicePosition, brushSize, operation, mmToWorldSpace, brushIntersectsContour]);

  // Enhanced stroke interpolation - OHIF style
  const interpolatePoints = useCallback((start: Point, end: Point): Point[] => {
    const distance = Math.sqrt(Math.pow(end.x - start.x, 2) + Math.pow(end.y - start.y, 2));
    const steps = Math.max(1, Math.floor(distance / (brushSize * interpolationDensity)));
    const points: Point[] = [];
    
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      let interpolatedPoint = {
        x: start.x + (end.x - start.x) * t,
        y: start.y + (end.y - start.y) * t
      };
      
      // Apply smoothing if enabled
      if (smoothingEnabled && strokePointsRef.current.length > 0) {
        const prevPoint = strokePointsRef.current[strokePointsRef.current.length - 1];
        const smoothingFactor = 0.6;
        interpolatedPoint = {
          x: prevPoint.x + (interpolatedPoint.x - prevPoint.x) * smoothingFactor,
          y: prevPoint.y + (interpolatedPoint.y - prevPoint.y) * smoothingFactor
        };
      }
      
      points.push(interpolatedPoint);
    }
    
    return points;
  }, [brushSize, interpolationDensity, smoothingEnabled]);

  // Enhanced brush preview rendering
  const drawBrushPreview = useCallback((canvasPoint: Point) => {
    if (!canvasRef.current) return;
    
    const now = Date.now();
    if (now - lastRenderTime.current < renderThrottleMs) return;
    
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;
    
    // Clear previous preview (simplified)
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
    
    // Draw operation indicator
    const size = 8;
    ctx.setLineDash([]);
    ctx.lineWidth = 3;
    ctx.beginPath();
    
    if (operation === BrushOperation.ADDITIVE) {
      // Draw cross for additive
      ctx.moveTo(canvasPoint.x - size, canvasPoint.y);
      ctx.lineTo(canvasPoint.x + size, canvasPoint.y);
      ctx.moveTo(canvasPoint.x, canvasPoint.y - size);
      ctx.lineTo(canvasPoint.x, canvasPoint.y + size);
    } else {
      // Draw minus for subtractive
      ctx.moveTo(canvasPoint.x - size, canvasPoint.y);
      ctx.lineTo(canvasPoint.x + size, canvasPoint.y);
    }
    
    ctx.stroke();
    ctx.restore();
    
    lastRenderTime.current = now;
  }, [brushSize, operation, renderThrottleMs]);

  // Helper function to create circle from point
  const createCircleFromPoint = (center: Point, radius: number): Point[] => {
    const points: Point[] = [];
    const steps = 12;
    for (let i = 0; i < steps; i++) {
      const angle = (i / steps) * 2 * Math.PI;
      points.push({
        x: center.x + Math.cos(angle) * radius,
        y: center.y + Math.sin(angle) * radius
      });
    }
    return points;
  };

  // Mouse event handlers - Enhanced OHIF style
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

    // Smart brush mode detection with operation locking
    if (!operationLocked) {
      const detectedOperation = detectBrushMode(worldPoint);
      setOperation(detectedOperation);
      setOperationLocked(true);
      
      // Notify parent of operation change
      if (onBrushModeChange) {
        onBrushModeChange(detectedOperation);
      }
    }

    setIsDrawing(true);
    setStrokeId(`stroke_${Date.now()}`);
    strokePointsRef.current = [worldPoint];
    lastPositionRef.current = worldPoint;

    console.log('Enhanced OHIF brush stroke started:', {
      operation: operation,
      position: worldPoint,
      slice: currentSlicePosition,
      strokeId: strokeId,
      brushSize: brushSize
    });
  }, [isActive, selectedStructure, canvasToWorld, detectBrushMode, operationLocked, onBrushModeChange, operation, strokeId, brushSize, currentSlicePosition]);

  const handleMouseMove = useCallback((event: MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const canvasPoint = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };

    setMousePosition(canvasPoint);

    if (!isDrawing || !lastPositionRef.current) return;

    const worldPoint = canvasToWorld(canvasPoint.x, canvasPoint.y);
    if (!worldPoint) return;

    // Add interpolated points for smooth stroke
    const interpolatedPoints = interpolatePoints(lastPositionRef.current, worldPoint);
    strokePointsRef.current.push(...interpolatedPoints);
    lastPositionRef.current = worldPoint;

    // Visual feedback on canvas
    drawBrushPreview(canvasPoint);
  }, [isDrawing, canvasToWorld, interpolatePoints, drawBrushPreview]);

  const handleMouseUp = useCallback(() => {
    if (!isDrawing || strokePointsRef.current.length === 0) return;

    setIsDrawing(false);
    setOperationLocked(false);

    // Create brush stroke data
    const strokeData = {
      id: strokeId || `stroke_${Date.now()}`,
      points: [...strokePointsRef.current],
      operation: operation,
      brushSize: brushSize,
      timestamp: Date.now(),
      slice: currentSlicePosition
    };

    // Store in history
    brushHistoryRef.current.push(strokeData);

    // Apply to structure if callback provided
    if (onContourUpdate && selectedStructure) {
      // Create simplified polygon from stroke points
      const strokePolygon = strokePointsRef.current.length > 2 ? 
        strokePointsRef.current : 
        createCircleFromPoint(strokePointsRef.current[0], brushSize / 2);
      
      // Apply stroke to structure (simplified implementation)
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
      
      onContourUpdate(updatedStructure);
    }

    // Clear stroke data
    strokePointsRef.current = [];
    lastPositionRef.current = null;
    setStrokeId(null);

    console.log('Enhanced OHIF brush stroke completed:', {
      pointCount: strokeData.points.length,
      operation: strokeData.operation,
      slice: strokeData.slice
    });
  }, [isDrawing, brushSize, operation, strokeId, currentSlicePosition, onContourUpdate, selectedStructure, createCircleFromPoint]);

  // Set up mouse event listeners
  useEffect(() => {
    if (!isActive || !canvasRef.current) return;

    const canvas = canvasRef.current;
    
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('mouseleave', handleMouseUp);

    return () => {
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseup', handleMouseUp);
      canvas.removeEventListener('mouseleave', handleMouseUp);
    };
  }, [isActive, handleMouseDown, handleMouseMove, handleMouseUp]);

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