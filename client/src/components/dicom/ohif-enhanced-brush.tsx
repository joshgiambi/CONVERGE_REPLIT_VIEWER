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
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
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
  }, [enableSmartMode, selectedStructure, rtStructures, currentSlicePosition, brushSize, operation]);

  // Mouse event handlers - OHIF style
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

    // Detect brush mode based on existing contours
    const currentOperation = detectBrushMode(worldPoint);
    setOperation(currentOperation);

    setIsDrawing(true);
    strokePointsRef.current = [worldPoint];
    lastPositionRef.current = worldPoint;

    console.log('OHIF brush stroke started:', {
      operation: currentOperation,
      position: worldPoint,
      slice: currentSlicePosition
    });
  }, [isActive, selectedStructure, canvasToWorld, detectBrushMode, currentSlicePosition]);

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
  }, [isDrawing, canvasToWorld]);

  const handleMouseUp = useCallback(() => {
    if (!isDrawing || strokePointsRef.current.length === 0) return;

    setIsDrawing(false);

    // Convert stroke to polygon and apply to structure
    const strokePolygon = strokeToPolygon(strokePointsRef.current, brushSize);
    applyBrushStroke(strokePolygon, operation);

    // Clear stroke data
    strokePointsRef.current = [];
    lastPositionRef.current = null;

    console.log('OHIF brush stroke completed');
  }, [isDrawing, brushSize, operation]);

  // Interpolate points for smooth strokes
  const interpolatePoints = (start: Point, end: Point): Point[] => {
    const distance = Math.sqrt(Math.pow(end.x - start.x, 2) + Math.pow(end.y - start.y, 2));
    const steps = Math.max(1, Math.floor(distance / (brushSize * 0.3)));
    
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

  // Convert stroke points to polygon
  const strokeToPolygon = (points: Point[], radius: number): Point[] => {
    if (points.length === 1) {
      // Single point - create circle
      return createCircle(points[0], radius / 2);
    }

    // Create stroke path with rounded ends
    const polygon: Point[] = [];
    const halfRadius = radius / 2;

    for (let i = 0; i < points.length; i++) {
      const current = points[i];
      
      if (i === 0) {
        // First point - add circle
        const circle = createCircle(current, halfRadius);
        polygon.push(...circle);
      } else {
        // Create rectangular section between points
        const prev = points[i - 1];
        const dx = current.x - prev.x;
        const dy = current.y - prev.y;
        const length = Math.sqrt(dx * dx + dy * dy);
        
        if (length > 0) {
          const perpX = -dy / length * halfRadius;
          const perpY = dx / length * halfRadius;
          
          polygon.push(
            { x: current.x + perpX, y: current.y + perpY },
            { x: current.x - perpX, y: current.y - perpY }
          );
        }
      }
    }

    return polygon;
  };

  // Create circle points
  const createCircle = (center: Point, radius: number, segments = 16): Point[] => {
    const points: Point[] = [];
    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * 2 * Math.PI;
      points.push({
        x: center.x + Math.cos(angle) * radius,
        y: center.y + Math.sin(angle) * radius
      });
    }
    return points;
  };

  // Apply brush stroke to structure
  const applyBrushStroke = (strokePolygon: Point[], brushOperation: BrushOperation) => {
    if (!selectedStructure || !rtStructures || !onContourUpdate) return;

    const updatedStructures = { ...rtStructures };
    const structure = updatedStructures.structures.find((s: any) => s.roiNumber === selectedStructure);
    
    if (!structure) return;

    if (!structure.contours) structure.contours = {};
    if (!structure.contours[currentSlicePosition]) structure.contours[currentSlicePosition] = [];

    const currentContours = structure.contours[currentSlicePosition];

    if (brushOperation === BrushOperation.ADDITIVE) {
      // Add new contour
      currentContours.push(strokePolygon);
    } else {
      // Subtract from existing contours (simplified - in full implementation would use proper clipping)
      // For now, remove intersecting contours
      structure.contours[currentSlicePosition] = currentContours.filter((contour: Point[]) => 
        !polygonsIntersect(contour, strokePolygon)
      );
    }

    onContourUpdate(updatedStructures);
  };

  // Simple polygon intersection check
  const polygonsIntersect = (poly1: Point[], poly2: Point[]): boolean => {
    // Simplified - would need proper polygon intersection in production
    return false;
  };

  // Draw brush preview cursor
  const drawBrushPreview = (canvasPoint: Point) => {
    if (!canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear previous preview (would need proper overlay system)
    const color = operation === BrushOperation.ADDITIVE ? '#00ff00' : '#ff0000';
    
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    
    ctx.beginPath();
    ctx.arc(canvasPoint.x, canvasPoint.y, brushSize / 2, 0, 2 * Math.PI);
    ctx.stroke();
    
    ctx.restore();
  };

  // Setup event listeners
  useEffect(() => {
    if (!canvasRef.current || !isActive) return;

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

  // Render cursor preview overlay
  if (!isActive || !mousePosition) return null;

  const cursorColor = operation === BrushOperation.ADDITIVE ? '#00ff00' : '#ff0000';
  const operationText = operation === BrushOperation.ADDITIVE ? 'Add' : 'Erase';

  return (
    <div className="absolute inset-0 pointer-events-none">
      {/* Brush cursor indicator */}
      <div
        className="absolute border-2 rounded-full pointer-events-none"
        style={{
          left: mousePosition.x - brushSize / 2,
          top: mousePosition.y - brushSize / 2,
          width: brushSize,
          height: brushSize,
          borderColor: cursorColor,
          borderStyle: 'dashed'
        }}
      />
      
      {/* Operation indicator */}
      <div
        className="absolute bg-black/80 text-white px-2 py-1 rounded text-xs pointer-events-none"
        style={{
          left: mousePosition.x + 15,
          top: mousePosition.y - 30,
          color: cursorColor
        }}
      >
        {operationText} • {brushSize}px
      </div>
    </div>
  );
};