// Enhanced Brush Tool Component
// Medical-grade brush tool following OHIF standards

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { OHIFEnhancedBrushTool, BrushStroke, RTStructure } from '@/lib/ohif-enhanced-brush-tool';
import { Point, BrushOperation } from '@shared/schema';

interface EnhancedBrushToolProps {
  isActive: boolean;
  brushSize: number;
  operation: BrushOperation;
  selectedStructure: RTStructure | null;
  currentSliceIndex: number;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  onContourUpdate?: (structure: RTStructure) => void;
  onOperationChange?: (operation: BrushOperation) => void;
}

export const EnhancedBrushTool: React.FC<EnhancedBrushToolProps> = ({
  isActive,
  brushSize,
  operation,
  selectedStructure,
  currentSliceIndex,
  canvasRef,
  onContourUpdate,
  onOperationChange
}) => {
  const brushToolRef = useRef<OHIFEnhancedBrushTool | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const [mousePosition, setMousePosition] = useState<Point | null>(null);
  const [currentOperation, setCurrentOperation] = useState<BrushOperation>(operation);
  const [strokeCount, setStrokeCount] = useState(0);
  const [undoCount, setUndoCount] = useState(0);
  const [redoCount, setRedoCount] = useState(0);

  // Initialize brush tool
  useEffect(() => {
    if (!isActive || !canvasRef.current) return;

    const brushTool = new OHIFEnhancedBrushTool({
      brushSize,
      operation,
      activeStrategy: 'FILL_INSIDE_CIRCLE',
      previewEnabled: true,
      smoothing: {
        enabled: true,
        factor: 0.6
      },
      interpolation: {
        enabled: true,
        density: 0.2
      }
    });

    brushTool.initialize(canvasRef.current, previewCanvasRef.current || undefined);
    brushTool.setTargetStructure(selectedStructure);
    brushTool.setCurrentSliceIndex(currentSliceIndex);

    // Set up event handlers
    brushTool.setOnStrokeComplete(handleStrokeComplete);
    brushTool.setOnPreviewUpdate(handlePreviewUpdate);
    brushTool.setOnOperationChange(handleOperationChange);

    brushToolRef.current = brushTool;

    return () => {
      brushTool.destroy();
      brushToolRef.current = null;
    };
  }, [isActive, canvasRef.current, selectedStructure, currentSliceIndex]);

  // Update brush settings when props change
  useEffect(() => {
    if (brushToolRef.current) {
      brushToolRef.current.setBrushSize(brushSize);
      brushToolRef.current.setOperation(operation);
      brushToolRef.current.setTargetStructure(selectedStructure);
      brushToolRef.current.setCurrentSliceIndex(currentSliceIndex);
    }
  }, [brushSize, operation, selectedStructure, currentSliceIndex]);

  // Handle stroke completion
  const handleStrokeComplete = useCallback((stroke: BrushStroke) => {
    if (!selectedStructure || !onContourUpdate) return;

    console.log('Enhanced brush stroke completed:', {
      pointCount: stroke.points.length,
      operation: stroke.operation,
      brushSize: stroke.brushSize,
      slice: stroke.sliceIndex,
      timestamp: new Date(stroke.timestamp).toLocaleTimeString()
    });

    // Apply stroke to structure contours
    const updatedStructure = applyStrokeToStructure(selectedStructure, stroke);
    onContourUpdate(updatedStructure);
    
    setStrokeCount(prev => prev + 1);
    setUndoCount(0);
    setRedoCount(0);
  }, [selectedStructure, onContourUpdate]);

  // Handle preview updates
  const handlePreviewUpdate = useCallback((position: Point, size: number, op: BrushOperation) => {
    setMousePosition(position);
    setCurrentOperation(op);
  }, []);

  // Handle operation changes (smart brush mode)
  const handleOperationChange = useCallback((newOperation: BrushOperation) => {
    setCurrentOperation(newOperation);
    if (onOperationChange) {
      onOperationChange(newOperation);
    }
  }, [onOperationChange]);

  // Apply stroke to structure contours
  const applyStrokeToStructure = (structure: RTStructure, stroke: BrushStroke): RTStructure => {
    const updatedStructure = { ...structure };
    
    // Initialize contours for this slice if not exists
    if (!updatedStructure.contours[stroke.sliceIndex]) {
      updatedStructure.contours[stroke.sliceIndex] = [];
    }

    // Convert stroke points to contour polygon
    const strokePolygon = convertStrokeToPolygon(stroke);
    
    if (stroke.operation === BrushOperation.ADDITIVE) {
      // Add stroke polygon to existing contours
      updatedStructure.contours[stroke.sliceIndex].push(strokePolygon);
    } else {
      // Subtract stroke polygon from existing contours (simplified)
      // In a real implementation, this would use polygon boolean operations
      updatedStructure.contours[stroke.sliceIndex] = 
        updatedStructure.contours[stroke.sliceIndex].filter(contour => 
          !polygonOverlaps(contour, strokePolygon)
        );
    }

    return updatedStructure;
  };

  // Convert stroke points to polygon
  const convertStrokeToPolygon = (stroke: BrushStroke): Point[] => {
    if (stroke.points.length < 3) return stroke.points;
    
    // Create a polygon around the stroke path with brush size
    const radius = stroke.brushSize / 2;
    const polygon: Point[] = [];
    
    // For each point in the stroke, create a circle segment
    for (let i = 0; i < stroke.points.length; i++) {
      const point = stroke.points[i];
      const angle = i * (Math.PI * 2) / stroke.points.length;
      
      polygon.push({
        x: point.x + Math.cos(angle) * radius,
        y: point.y + Math.sin(angle) * radius
      });
    }
    
    return polygon;
  };

  // Check if two polygons overlap (simplified)
  const polygonOverlaps = (poly1: Point[], poly2: Point[]): boolean => {
    // Simplified overlap detection
    for (const point of poly1) {
      if (isPointInPolygon(point, poly2)) {
        return true;
      }
    }
    return false;
  };

  // Point in polygon test
  const isPointInPolygon = (point: Point, polygon: Point[]): boolean => {
    let inside = false;
    const n = polygon.length;
    
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = polygon[i].x;
      const yi = polygon[i].y;
      const xj = polygon[j].x;
      const yj = polygon[j].y;
      
      if (((yi > point.y) !== (yj > point.y)) &&
          (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi)) {
        inside = !inside;
      }
    }
    
    return inside;
  };

  // Undo/Redo functionality
  const handleUndo = useCallback(() => {
    if (brushToolRef.current && brushToolRef.current.canUndo()) {
      const undoStroke = brushToolRef.current.undo();
      if (undoStroke) {
        console.log('Undo stroke:', undoStroke);
        setUndoCount(prev => prev + 1);
        setRedoCount(0);
      }
    }
  }, []);

  const handleRedo = useCallback(() => {
    if (brushToolRef.current && brushToolRef.current.canRedo()) {
      const redoStroke = brushToolRef.current.redo();
      if (redoStroke) {
        console.log('Redo stroke:', redoStroke);
        setRedoCount(prev => prev + 1);
        setUndoCount(0);
      }
    }
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isActive) return;

      if (event.ctrlKey || event.metaKey) {
        if (event.key === 'z' && !event.shiftKey) {
          event.preventDefault();
          handleUndo();
        } else if (event.key === 'z' && event.shiftKey) {
          event.preventDefault();
          handleRedo();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isActive, handleUndo, handleRedo]);

  // Get cursor style based on operation
  const getCursorStyle = () => {
    if (!isActive) return 'default';
    
    const color = currentOperation === BrushOperation.ADDITIVE ? '#00ff00' : '#ff0000';
    const size = Math.max(8, Math.min(32, brushSize));
    
    return `crosshair`;
  };

  if (!isActive) return null;

  return (
    <div className="absolute inset-0 pointer-events-none">
      {/* Preview canvas for brush cursor */}
      <canvas
        ref={previewCanvasRef}
        width={canvasRef.current?.width || 1024}
        height={canvasRef.current?.height || 1024}
        className="absolute inset-0 pointer-events-none"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          zIndex: 10,
          cursor: getCursorStyle()
        }}
      />
      
      {/* Brush info overlay */}
      {mousePosition && (
        <div 
          className="absolute bg-black/90 text-white px-3 py-2 rounded-md text-sm font-medium pointer-events-none shadow-lg"
          style={{
            left: mousePosition.x + 15,
            top: mousePosition.y - 45,
            zIndex: 20
          }}
        >
          <div className="flex items-center gap-2">
            <div 
              className="w-3 h-3 rounded-full border-2"
              style={{
                backgroundColor: currentOperation === BrushOperation.ADDITIVE ? '#00ff00' : '#ff0000',
                borderColor: currentOperation === BrushOperation.ADDITIVE ? '#00ff00' : '#ff0000'
              }}
            />
            <span>
              {currentOperation === BrushOperation.ADDITIVE ? 'Add' : 'Erase'} • {brushSize}px
            </span>
          </div>
          {selectedStructure && (
            <div className="text-xs opacity-75 mt-1">
              {selectedStructure.structureName}
            </div>
          )}
        </div>
      )}
      
      {/* Brush statistics (development mode) */}
      {process.env.NODE_ENV === 'development' && (
        <div className="absolute top-4 right-4 bg-black/80 text-white p-2 rounded text-xs font-mono pointer-events-none">
          <div>Strokes: {strokeCount}</div>
          <div>Undo: {undoCount}</div>
          <div>Redo: {redoCount}</div>
          <div>Slice: {currentSliceIndex}</div>
          <div>Mode: {currentOperation}</div>
        </div>
      )}
      
      {/* Keyboard shortcuts hint */}
      <div className="absolute bottom-4 left-4 bg-black/80 text-white p-2 rounded text-xs pointer-events-none">
        <div className="opacity-75">
          <div>Ctrl+Z: Undo</div>
          <div>Ctrl+Shift+Z: Redo</div>
          <div>Shift: Invert mode</div>
        </div>
      </div>
    </div>
  );
};

export default EnhancedBrushTool;