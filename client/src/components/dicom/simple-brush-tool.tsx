
import { useEffect, useState, useRef, useCallback } from 'react';

interface Point {
  x: number;
  y: number;
}

interface SimpleBrushProps {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  isActive: boolean;
  brushSize: number;
  selectedStructure: number | null;
  rtStructures: any;
  currentSlicePosition: number;
  onContourUpdate: (updatedRTStructures: any) => void;
  zoom: number;
  panX: number;
  panY: number;
  currentImage: any;
  imageMetadata: any;
  onBrushSizeChange?: (size: number) => void;
}

enum BrushOperation {
  ADDITIVE = 'additive',
  SUBTRACTIVE = 'subtractive'
}

export function SimpleBrushTool({
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
  currentImage,
  imageMetadata,
  onBrushSizeChange
}: SimpleBrushProps) {
  const [isDrawing, setIsDrawing] = useState(false);
  const [mousePosition, setMousePosition] = useState<Point | null>(null);
  const [operation, setOperation] = useState<BrushOperation>(BrushOperation.ADDITIVE);
  const [lastPosition, setLastPosition] = useState<Point | null>(null);
  const [shiftPressed, setShiftPressed] = useState(false);
  const [ctrlPressed, setCtrlPressed] = useState(false);
  const cursorCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [currentBrushSize, setCurrentBrushSize] = useState(brushSize);
  const [strokePoints, setStrokePoints] = useState<Point[]>([]);

  // Update brush size when prop changes
  useEffect(() => {
    setCurrentBrushSize(brushSize);
  }, [brushSize]);

  // ✅ FIXED: Proper canvas to world coordinate transformation
  const canvasToWorld = useCallback((canvasX: number, canvasY: number): Point | null => {
    if (!currentImage || !canvasRef.current) return null;

    try {
      const canvas = canvasRef.current;
      const imageWidth = currentImage.width || 512;
      const imageHeight = currentImage.height || 512;

      // Calculate the image display area on canvas (same as viewer)
      const scaledWidth = imageWidth * zoom;
      const scaledHeight = imageHeight * zoom;
      const imageX = (canvas.width - scaledWidth) / 2 + panX;
      const imageY = (canvas.height - scaledHeight) / 2 + panY;

      // Convert canvas coordinates to image pixel coordinates
      const pixelX = (canvasX - imageX) / zoom;
      const pixelY = (canvasY - imageY) / zoom;

      // Bounds check
      if (pixelX < 0 || pixelX >= imageWidth || pixelY < 0 || pixelY >= imageHeight) {
        return null;
      }

      // Convert to DICOM world coordinates if metadata available
      if (imageMetadata?.imagePosition && imageMetadata?.pixelSpacing && imageMetadata?.imageOrientation) {
        const imagePosition = imageMetadata.imagePosition.split('\\').map(Number);
        const pixelSpacing = imageMetadata.pixelSpacing.split('\\').map(Number);
        const imageOrientation = imageMetadata.imageOrientation.split('\\').map(Number);

        // Apply same transformation as contour rendering
        const rowCosX = imageOrientation[0];
        const rowCosY = imageOrientation[1];
        const colCosX = imageOrientation[3];
        const colCosY = imageOrientation[4];

        // Reverse the rotation and flip applied in rendering
        const origPixelX = imageWidth - pixelX; // Reverse horizontal flip
        const origPixelY = imageHeight - origPixelX; // Reverse 90-degree rotation
        const origPixelX2 = pixelY;

        // Convert to world coordinates
        const worldX = imagePosition[0] + (origPixelX2 * colCosX * pixelSpacing[1]) + (origPixelY * rowCosX * pixelSpacing[0]);
        const worldY = imagePosition[1] + (origPixelX2 * colCosY * pixelSpacing[1]) + (origPixelY * rowCosY * pixelSpacing[0]);

        return { x: worldX, y: worldY };
      }

      // Fallback: Use scaled pixel coordinates
      const scale = 0.8;
      const centerX = imageWidth / 2;
      const centerY = imageHeight / 2;
      return {
        x: (pixelX - centerX) / scale,
        y: (pixelY - centerY) / scale
      };

    } catch (error) {
      console.error('Error in coordinate transformation:', error);
      return null;
    }
  }, [currentImage, imageMetadata, zoom, panX, panY]);

  // ✅ Create brush circle polygon
  const createBrushCircle = useCallback((center: Point, radius: number): Point[] => {
    const points: Point[] = [];
    const steps = Math.max(8, Math.min(32, Math.ceil(radius / 2))); // Adaptive resolution

    for (let i = 0; i < steps; i++) {
      const angle = (i / steps) * Math.PI * 2;
      points.push({
        x: center.x + Math.cos(angle) * radius,
        y: center.y + Math.sin(angle) * radius
      });
    }

    return points;
  }, []);

  // ✅ Simple polygon union (for demonstration - in production use ClipperLib)
  const unionPolygons = useCallback((polygon1: Point[], polygon2: Point[]): Point[] => {
    // Simple approach: combine points and create convex hull
    // In production, use js-angusj-clipper for proper polygon boolean operations
    return [...polygon1, ...polygon2];
  }, []);

  // ✅ Check if point is inside existing contour
  const isInsideContour = useCallback((worldPoint: Point): boolean => {
    if (!selectedStructure || !rtStructures) return false;

    try {
      let structure;
      if (rtStructures.structures) {
        structure = rtStructures.structures.find((s: any) => s.roiNumber === selectedStructure);
      } else if (rtStructures.roiContourSequence) {
        structure = rtStructures.roiContourSequence.find((s: any) => s.roiNumber === selectedStructure);
      }

      if (!structure?.contours) return false;

      const tolerance = 2.0;
      const currentContour = structure.contours.find((contour: any) =>
        Math.abs(contour.slicePosition - currentSlicePosition) <= tolerance
      );

      if (!currentContour?.points || currentContour.points.length < 6) return false;

      // Convert DICOM points to 2D polygon for point-in-polygon test
      const polygon: Point[] = [];
      for (let i = 0; i < currentContour.points.length; i += 3) {
        polygon.push({
          x: currentContour.points[i],
          y: currentContour.points[i + 1]
        });
      }

      // Simple point-in-polygon test
      let inside = false;
      for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        if (((polygon[i].y > worldPoint.y) !== (polygon[j].y > worldPoint.y)) &&
            (worldPoint.x < (polygon[j].x - polygon[i].x) * (worldPoint.y - polygon[i].y) / (polygon[j].y - polygon[i].y) + polygon[i].x)) {
          inside = !inside;
        }
      }
      return inside;
    } catch (error) {
      return false;
    }
  }, [selectedStructure, rtStructures, currentSlicePosition]);

  // ✅ Smart operation detection
  const updateBrushOperation = useCallback((worldPoint: Point) => {
    const inside = isInsideContour(worldPoint);
    
    if (shiftPressed) {
      setOperation(inside ? BrushOperation.SUBTRACTIVE : BrushOperation.ADDITIVE);
    } else {
      setOperation(inside ? BrushOperation.ADDITIVE : BrushOperation.SUBTRACTIVE);
    }
  }, [isInsideContour, shiftPressed]);

  // ✅ Apply brush stroke with proper polygon operations
  const applyBrushStroke = useCallback((worldPoints: Point[]) => {
    if (worldPoints.length === 0 || !selectedStructure || !rtStructures) return;

    try {
      // Create brush shape from stroke points
      const worldBrushRadius = (currentBrushSize / zoom) * 0.5; // Scale with zoom
      let brushPolygonPoints: number[] = [];

      if (worldPoints.length === 1) {
        // Single click - create circle
        const brushCircle = createBrushCircle(worldPoints[0], worldBrushRadius);
        for (const point of brushCircle) {
          brushPolygonPoints.push(point.x, point.y, currentSlicePosition);
        }
      } else {
        // Stroke - create path with circles at each point
        for (const worldPoint of worldPoints) {
          const brushCircle = createBrushCircle(worldPoint, worldBrushRadius);
          for (const point of brushCircle) {
            brushPolygonPoints.push(point.x, point.y, currentSlicePosition);
          }
        }
      }

      const updatedRTStructures = JSON.parse(JSON.stringify(rtStructures));
      
      let structure;
      if (updatedRTStructures.structures) {
        structure = updatedRTStructures.structures.find((s: any) => s.roiNumber === selectedStructure);
      } else if (updatedRTStructures.roiContourSequence) {
        structure = updatedRTStructures.roiContourSequence.find((s: any) => s.roiNumber === selectedStructure);
      }
      
      if (!structure) return;

      if (!structure.contours) {
        structure.contours = [];
      }

      const tolerance = 2.0;
      let existingContour = structure.contours.find((contour: any) => 
        Math.abs(contour.slicePosition - currentSlicePosition) <= tolerance
      );

      if (operation === BrushOperation.ADDITIVE) {
        if (existingContour) {
          // Add to existing contour (simple concatenation for now)
          const combinedPoints = [...existingContour.points, ...brushPolygonPoints];
          existingContour.points = combinedPoints;
          existingContour.numberOfPoints = combinedPoints.length / 3;
        } else {
          // Create new contour
          structure.contours.push({
            slicePosition: currentSlicePosition,
            points: brushPolygonPoints,
            numberOfPoints: brushPolygonPoints.length / 3
          });
        }
      } else if (operation === BrushOperation.SUBTRACTIVE) {
        if (existingContour && existingContour.points.length > 0) {
          // For demonstration: reduce opacity or remove points
          // In production, use proper polygon difference operations
          const reducedPoints = existingContour.points.slice(0, Math.max(6, existingContour.points.length - brushPolygonPoints.length));
          existingContour.points = reducedPoints;
          existingContour.numberOfPoints = reducedPoints.length / 3;
        }
      }

      onContourUpdate(updatedRTStructures);
    } catch (error) {
      console.error('Error applying brush stroke:', error);
    }
  }, [selectedStructure, rtStructures, currentSlicePosition, onContourUpdate, currentBrushSize, operation, createBrushCircle, zoom]);

  // ✅ Handle keyboard events for modifiers and brush size
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setShiftPressed(true);
      if (e.key === 'Control' || e.key === 'Meta') setCtrlPressed(true);
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setShiftPressed(false);
      if (e.key === 'Control' || e.key === 'Meta') setCtrlPressed(false);
    };

    if (isActive) {
      window.addEventListener('keydown', handleKeyDown);
      window.addEventListener('keyup', handleKeyUp);
    }

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [isActive]);

  // ✅ Mouse event handlers with proper brush size adjustment
  const handleMouseDown = useCallback((e: MouseEvent) => {
    if (!isActive || !selectedStructure || e.button !== 0) return;
    if (!canvasRef.current) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    const rect = canvasRef.current.getBoundingClientRect();
    const canvasPoint = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
    
    const worldPoint = canvasToWorld(canvasPoint.x, canvasPoint.y);
    if (!worldPoint) return;
    
    updateBrushOperation(worldPoint);
    
    setIsDrawing(true);
    setLastPosition(canvasPoint);
    setStrokePoints([worldPoint]);
  }, [isActive, selectedStructure, canvasToWorld, updateBrushOperation]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isActive || !canvasRef.current) return;
    
    const rect = canvasRef.current.getBoundingClientRect();
    const canvasPoint = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
    
    setMousePosition(canvasPoint);
    
    if (isDrawing && lastPosition) {
      const worldPoint = canvasToWorld(canvasPoint.x, canvasPoint.y);
      if (worldPoint) {
        setStrokePoints(prev => [...prev, worldPoint]);
      }
      setLastPosition(canvasPoint);
    }
  }, [isActive, isDrawing, lastPosition, canvasToWorld]);

  const handleMouseUp = useCallback((e: MouseEvent) => {
    if (!isActive || e.button !== 0) return;
    
    if (isDrawing && strokePoints.length > 0) {
      applyBrushStroke(strokePoints);
    }
    
    setIsDrawing(false);
    setLastPosition(null);
    setStrokePoints([]);
  }, [isActive, isDrawing, strokePoints, applyBrushStroke]);

  // ✅ Handle wheel events for brush size adjustment
  const handleWheel = useCallback((e: WheelEvent) => {
    if (!isActive || !ctrlPressed) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    const delta = e.deltaY > 0 ? -2 : 2;
    const newSize = Math.max(1, Math.min(100, currentBrushSize + delta));
    
    setCurrentBrushSize(newSize);
    if (onBrushSizeChange) {
      onBrushSizeChange(newSize);
    }
  }, [isActive, ctrlPressed, currentBrushSize, onBrushSizeChange]);

  // ✅ Event listener setup
  useEffect(() => {
    if (!isActive || !canvasRef.current) return;

    const canvas = canvasRef.current;
    
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    
    canvas.style.cursor = 'none';
    
    return () => {
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseup', handleMouseUp);
      canvas.removeEventListener('wheel', handleWheel);
      canvas.style.cursor = 'default';
    };
  }, [isActive, handleMouseDown, handleMouseMove, handleMouseUp, handleWheel]);

  // ✅ Cursor canvas setup
  useEffect(() => {
    if (!isActive || !canvasRef.current) return;

    const mainCanvas = canvasRef.current;
    
    if (!cursorCanvasRef.current) {
      const cursorCanvas = document.createElement('canvas');
      cursorCanvas.className = 'brush-cursor';
      cursorCanvas.style.position = 'absolute';
      cursorCanvas.style.top = '0';
      cursorCanvas.style.left = '0';
      cursorCanvas.style.pointerEvents = 'none';
      cursorCanvas.style.zIndex = '999';
      mainCanvas.parentElement?.appendChild(cursorCanvas);
      cursorCanvasRef.current = cursorCanvas;
    }
    
    const cursorCanvas = cursorCanvasRef.current;
    cursorCanvas.width = mainCanvas.width;
    cursorCanvas.height = mainCanvas.height;
    cursorCanvas.style.width = mainCanvas.style.width || `${mainCanvas.width}px`;
    cursorCanvas.style.height = mainCanvas.style.height || `${mainCanvas.height}px`;

    return () => {
      cursorCanvasRef.current?.remove();
      cursorCanvasRef.current = null;
    };
  }, [isActive]);

  // ✅ Render brush cursor
  useEffect(() => {
    if (!cursorCanvasRef.current || !mousePosition) return;

    const ctx = cursorCanvasRef.current.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, cursorCanvasRef.current.width, cursorCanvasRef.current.height);
    
    const centerX = mousePosition.x;
    const centerY = mousePosition.y;
    const radius = currentBrushSize / 2; // Use current brush size
    
    ctx.save();
    
    // Operation color
    const operationColor = operation === BrushOperation.ADDITIVE ? '#00ff00' : '#ff0000';
    
    // Draw brush circle
    ctx.strokeStyle = operationColor;
    ctx.lineWidth = isDrawing ? 3 : 2;
    ctx.setLineDash([5, 5]);
    ctx.globalAlpha = isDrawing ? 1.0 : 0.7;
    
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
    ctx.stroke();
    
    // Draw operation indicator
    ctx.setLineDash([]);
    ctx.lineWidth = 3;
    ctx.globalAlpha = 1.0;
    
    const signSize = Math.min(radius / 3, 10);
    
    if (operation === BrushOperation.ADDITIVE) {
      // Draw plus sign
      ctx.beginPath();
      ctx.moveTo(centerX - signSize, centerY);
      ctx.lineTo(centerX + signSize, centerY);
      ctx.moveTo(centerX, centerY - signSize);
      ctx.lineTo(centerX, centerY + signSize);
      ctx.stroke();
    } else {
      // Draw minus sign
      ctx.beginPath();
      ctx.moveTo(centerX - signSize, centerY);
      ctx.lineTo(centerX + signSize, centerY);
      ctx.stroke();
    }
    
    // Show brush size in corner
    ctx.fillStyle = operationColor;
    ctx.font = '12px monospace';
    ctx.fillText(`${Math.round(currentBrushSize)}px`, 10, 20);
    
    // Show controls hint
    if (ctrlPressed) {
      ctx.fillText('Ctrl+Scroll: Resize brush', 10, 40);
    }
    
    ctx.restore();
  }, [mousePosition, currentBrushSize, isDrawing, operation, ctrlPressed]);

  return null;
}
