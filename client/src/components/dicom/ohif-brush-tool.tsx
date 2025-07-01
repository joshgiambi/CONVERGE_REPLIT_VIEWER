// OHIF-style Brush Tool React Component
// Medical-grade segmentation brush tool following OHIF standards

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { OHIFStyleBrushTool, BrushStroke } from '@/lib/ohif-style-brush-tool';
import { Point, BrushOperation } from '@shared/schema';
import { RTStructure } from '@/lib/ohif-style-brush-tool';

interface OHIFBrushToolProps {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  isActive: boolean;
  brushSize: number;
  operation?: BrushOperation;
  selectedStructure?: RTStructure | null;
  onContourUpdate?: (updatedStructure: RTStructure) => void;
  onBrushSizeChange?: (size: number) => void;
  currentSlicePosition: number;
  zoom: number;
  panX: number;
  panY: number;
}

export const OHIFBrushTool: React.FC<OHIFBrushToolProps> = ({
  canvasRef,
  isActive,
  brushSize,
  operation = BrushOperation.ADDITIVE,
  selectedStructure,
  onContourUpdate,
  onBrushSizeChange,
  currentSlicePosition,
  zoom,
  panX,
  panY
}) => {
  const brushToolRef = useRef<OHIFStyleBrushTool | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewContextRef = useRef<CanvasRenderingContext2D | null>(null);
  const [mousePosition, setMousePosition] = useState<Point | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);

  // Initialize brush tool
  useEffect(() => {
    if (!canvasRef.current || !isActive) return;

    const brushTool = new OHIFStyleBrushTool({
      brushSize,
      operation,
      previewEnabled: true
    });

    brushTool.initialize(canvasRef.current);
    brushTool.setTargetStructure(selectedStructure);

    // Set up stroke completion callback
    brushTool.setOnStrokeComplete((stroke: BrushStroke) => {
      handleStrokeComplete(stroke);
    });

    // Set up preview update callback
    brushTool.setOnPreviewUpdate((position: Point, size: number) => {
      setMousePosition(position);
      updatePreviewCursor(position, size);
    });

    brushToolRef.current = brushTool;

    return () => {
      brushTool.destroy();
      brushToolRef.current = null;
    };
  }, [isActive, canvasRef.current, selectedStructure]);

  // Update brush settings when props change
  useEffect(() => {
    if (brushToolRef.current) {
      brushToolRef.current.setBrushSize(brushSize);
      brushToolRef.current.setOperation(operation);
      brushToolRef.current.setTargetStructure(selectedStructure);
    }
  }, [brushSize, operation, selectedStructure]);

  // Handle stroke completion
  const handleStrokeComplete = useCallback((stroke: BrushStroke) => {
    if (!selectedStructure || !onContourUpdate) return;

    console.log('OHIF brush stroke completed:', {
      pointCount: stroke.points.length,
      operation: stroke.operation,
      brushSize: stroke.brushSize,
      slice: currentSlicePosition
    });

    // Apply stroke to structure contours
    const updatedStructure = applyStrokeToStructure(selectedStructure, stroke);
    onContourUpdate(updatedStructure);
  }, [selectedStructure, onContourUpdate, currentSlicePosition]);

  // Apply brush stroke to structure contours
  const applyStrokeToStructure = (structure: RTStructure, stroke: BrushStroke): RTStructure => {
    // Convert brush stroke to polygon points
    const brushPolygon = convertStrokeToPolygon(stroke);
    
    // Get existing contours for current slice
    const existingContours = structure.contours?.[currentSlicePosition] || [];
    
    let updatedContours: Point[][];
    
    if (stroke.operation === BrushOperation.ADDITIVE) {
      // Add brush polygon to existing contours
      updatedContours = [...existingContours, brushPolygon];
    } else {
      // Subtract brush polygon from existing contours
      updatedContours = subtractPolygonFromContours(existingContours, brushPolygon);
    }

    return {
      ...structure,
      contours: {
        ...structure.contours,
        [currentSlicePosition]: updatedContours
      }
    };
  };

  // Convert brush stroke points to polygon
  const convertStrokeToPolygon = (stroke: BrushStroke): Point[] => {
    if (stroke.points.length === 0) return [];
    
    // For single point, create a circle
    if (stroke.points.length === 1) {
      const center = stroke.points[0];
      const radius = stroke.brushSize / 2;
      return createCirclePolygon(center, radius);
    }
    
    // For multiple points, create stroke path with rounded endpoints
    return createStrokePolygon(stroke.points, stroke.brushSize);
  };

  // Create circle polygon around a point
  const createCirclePolygon = (center: Point, radius: number, segments = 16): Point[] => {
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

  // Create stroke polygon from path points
  const createStrokePolygon = (pathPoints: Point[], brushSize: number): Point[] => {
    if (pathPoints.length < 2) return createCirclePolygon(pathPoints[0], brushSize / 2);
    
    const radius = brushSize / 2;
    const leftSide: Point[] = [];
    const rightSide: Point[] = [];
    
    for (let i = 0; i < pathPoints.length; i++) {
      const current = pathPoints[i];
      let direction: Point;
      
      if (i === 0) {
        const next = pathPoints[i + 1];
        direction = { x: next.x - current.x, y: next.y - current.y };
      } else if (i === pathPoints.length - 1) {
        const prev = pathPoints[i - 1];
        direction = { x: current.x - prev.x, y: current.y - prev.y };
      } else {
        const prev = pathPoints[i - 1];
        const next = pathPoints[i + 1];
        direction = { x: next.x - prev.x, y: next.y - prev.y };
      }
      
      // Normalize direction
      const length = Math.sqrt(direction.x * direction.x + direction.y * direction.y);
      if (length > 0) {
        direction.x /= length;
        direction.y /= length;
      }
      
      // Perpendicular vector
      const perpendicular = { x: -direction.y, y: direction.x };
      
      leftSide.push({
        x: current.x + perpendicular.x * radius,
        y: current.y + perpendicular.y * radius
      });
      
      rightSide.unshift({
        x: current.x - perpendicular.x * radius,
        y: current.y - perpendicular.y * radius
      });
    }
    
    return [...leftSide, ...rightSide];
  };

  // Subtract polygon from existing contours (simplified implementation)
  const subtractPolygonFromContours = (contours: Point[][], subtractPolygon: Point[]): Point[][] => {
    // This is a simplified implementation
    // In a full implementation, you would use a proper polygon clipping library
    return contours.filter(contour => !polygonsIntersect(contour, subtractPolygon));
  };

  // Check if two polygons intersect (simplified)
  const polygonsIntersect = (poly1: Point[], poly2: Point[]): boolean => {
    // Simplified intersection check - would need proper polygon intersection algorithm
    return false; // Placeholder
  };

  // Update preview cursor
  const updatePreviewCursor = (position: Point, size: number) => {
    if (!previewCanvasRef.current || !previewContextRef.current) return;
    
    const canvas = previewCanvasRef.current;
    const context = previewContextRef.current;
    
    // Clear previous preview
    context.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw preview circle
    const radius = size / 2;
    const color = operation === BrushOperation.ADDITIVE ? '#00ff00' : '#ff0000';
    
    context.strokeStyle = color;
    context.lineWidth = 2;
    context.setLineDash([4, 4]);
    
    context.beginPath();
    context.arc(position.x, position.y, radius, 0, 2 * Math.PI);
    context.stroke();
  };

  // Handle brush size change with mouse wheel
  const handleWheel = useCallback((event: WheelEvent) => {
    if (!isActive || !event.ctrlKey) return;
    
    event.preventDefault();
    const delta = event.deltaY > 0 ? -2 : 2;
    const newSize = Math.max(5, Math.min(100, brushSize + delta));
    
    if (onBrushSizeChange) {
      onBrushSizeChange(newSize);
    }
  }, [isActive, brushSize, onBrushSizeChange]);

  // Setup wheel event listener
  useEffect(() => {
    if (!canvasRef.current || !isActive) return;
    
    const canvas = canvasRef.current;
    canvas.addEventListener('wheel', handleWheel);
    
    return () => {
      canvas.removeEventListener('wheel', handleWheel);
    };
  }, [handleWheel, isActive]);

  // Render preview canvas overlay
  if (!isActive) return null;

  return (
    <div className="absolute inset-0 pointer-events-none">
      {/* Preview canvas for cursor */}
      <canvas
        ref={previewCanvasRef}
        width={canvasRef.current?.width || 1024}
        height={canvasRef.current?.height || 1024}
        className="absolute inset-0 pointer-events-none"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          zIndex: 10
        }}
      />
      
      {/* Brush tool info overlay */}
      {mousePosition && (
        <div 
          className="absolute bg-black/80 text-white px-2 py-1 rounded text-xs pointer-events-none"
          style={{
            left: mousePosition.x + 10,
            top: mousePosition.y - 30,
            zIndex: 20
          }}
        >
          {operation === BrushOperation.ADDITIVE ? 'Add' : 'Erase'} • Size: {brushSize}px
        </div>
      )}
    </div>
  );
};