
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
  imageMetadata
}: SimpleBrushProps) {
  const [isDrawing, setIsDrawing] = useState(false);
  const [mousePosition, setMousePosition] = useState<Point | null>(null);
  const [operation, setOperation] = useState<BrushOperation>(BrushOperation.ADDITIVE);
  const [lastPosition, setLastPosition] = useState<Point | null>(null);
  const [shiftPressed, setShiftPressed] = useState(false);
  const cursorCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // ✅ FIXED: Proper coordinate transformation
  const canvasToWorld = useCallback((canvasX: number, canvasY: number): Point | null => {
    if (!currentImage || !imageMetadata || !canvasRef.current) return null;

    try {
      const canvas = canvasRef.current;
      const imageWidth = currentImage.width || 512;
      const imageHeight = currentImage.height || 512;

      const baseScale = Math.min(canvas.width / imageWidth, canvas.height / imageHeight);
      const totalScale = baseScale * zoom;
      const scaledWidth = imageWidth * totalScale;
      const scaledHeight = imageHeight * totalScale;

      const imageX = (canvas.width - scaledWidth) / 2 + panX;
      const imageY = (canvas.height - scaledHeight) / 2 + panY;

      const pixelX = (canvasX - imageX) / totalScale;
      const pixelY = (canvasY - imageY) / totalScale;

      // DICOM coordinate transformation
      if (imageMetadata.imagePosition && imageMetadata.pixelSpacing) {
        const imagePosition = imageMetadata.imagePosition.split('\\').map(Number);
        const pixelSpacing = imageMetadata.pixelSpacing.split('\\').map(Number);

        const worldX = imagePosition[0] + (pixelX * pixelSpacing[0]);
        const worldY = imagePosition[1] + (pixelY * pixelSpacing[1]);

        return { x: worldX, y: worldY };
      }

      return null;
    } catch (error) {
      console.error('Error in coordinate transformation:', error);
      return null;
    }
  }, [currentImage, imageMetadata, zoom, panX, panY]);

  // ✅ Create brush circle polygon (like professional version)
  const createBrushCircle = useCallback((center: Point, radius: number): Point[] => {
    const points: Point[] = [];
    const steps = 32;

    for (let i = 0; i < steps; i++) {
      const angle = (i / steps) * Math.PI * 2;
      points.push({
        x: center.x + Math.cos(angle) * radius,
        y: center.y + Math.sin(angle) * radius
      });
    }

    // Close the polygon
    points.push(points[0]);
    return points;
  }, []);

  // ✅ Point-in-polygon test for smart operation detection
  const pointInPolygon = useCallback((point: Point, polygon: Point[]): boolean => {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      if (((polygon[i].y > point.y) !== (polygon[j].y > point.y)) &&
          (point.x < (polygon[j].x - polygon[i].x) * (point.y - polygon[i].y) / (polygon[j].y - polygon[i].y) + polygon[i].x)) {
        inside = !inside;
      }
    }
    return inside;
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

      // Convert DICOM points to 2D polygon
      const polygon: Point[] = [];
      for (let i = 0; i < currentContour.points.length; i += 3) {
        polygon.push({
          x: currentContour.points[i],
          y: currentContour.points[i + 1]
        });
      }

      return pointInPolygon(worldPoint, polygon);
    } catch (error) {
      return false;
    }
  }, [selectedStructure, rtStructures, currentSlicePosition, pointInPolygon]);

  // ✅ Smart operation detection (like professional version)
  const updateBrushOperation = useCallback((worldPoint: Point) => {
    const inside = isInsideContour(worldPoint);

    if (shiftPressed) {
      setOperation(inside ? BrushOperation.SUBTRACTIVE : BrushOperation.ADDITIVE);
    } else {
      setOperation(inside ? BrushOperation.ADDITIVE : BrushOperation.SUBTRACTIVE);
    }
  }, [isInsideContour, shiftPressed]);

  // ✅ Apply brush stroke with polygon union (like professional version)
  const applyBrushStroke = useCallback((startPoint: Point, endPoint: Point) => {
    const worldStart = canvasToWorld(startPoint.x, startPoint.y);
    const worldEnd = canvasToWorld(endPoint.x, endPoint.y);
    
    if (!worldStart || !worldEnd || !selectedStructure || !rtStructures) return;

    try {
      // Create brush circle at end position
      const worldBrushRadius = (brushSize / 2) * 0.1; // Convert to world units
      const brushCircle = createBrushCircle(worldEnd, worldBrushRadius);

      // Convert brush circle to DICOM points
      const brushContourPoints: number[] = [];
      for (const point of brushCircle) {
        brushContourPoints.push(point.x, point.y, currentSlicePosition);
      }

      const updatedRTStructures = JSON.parse(JSON.stringify(rtStructures));
      
      let structure;
      if (updatedRTStructures.structures) {
        structure = updatedRTStructures.structures.find((s: any) => s.roiNumber === selectedStructure);
      } else if (updatedRTStructures.roiContourSequence) {
        structure = updatedRTStructures.roiContourSequence.find((s: any) => s.roiNumber === selectedStructure);
      } else {
        structure = updatedRTStructures.find((s: any) => s.roiNumber === selectedStructure);
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
          // ✅ UNION: Combine with existing contour (simplified)
          // In a real implementation, you'd use ClipperLib for proper polygon union
          // For now, we'll append the new brush circle
          const combinedPoints = [...existingContour.points, ...brushContourPoints];
          existingContour.points = combinedPoints;
          existingContour.numberOfPoints = combinedPoints.length / 3;
        } else {
          // Create new contour
          structure.contours.push({
            slicePosition: currentSlicePosition,
            points: brushContourPoints,
            numberOfPoints: brushContourPoints.length / 3
          });
        }
      } else if (operation === BrushOperation.SUBTRACTIVE) {
        // ✅ DIFFERENCE: Remove from existing contour
        // For demonstration, we'll skip subtraction if no existing contour
        if (existingContour) {
          // In a real implementation, you'd use ClipperLib for proper polygon difference
          // For now, we'll clear the contour if subtracting
          existingContour.points = [];
          existingContour.numberOfPoints = 0;
        }
      }

      onContourUpdate(updatedRTStructures);
    } catch (error) {
      console.error('Error applying brush stroke:', error);
    }
  }, [canvasToWorld, selectedStructure, rtStructures, currentSlicePosition, onContourUpdate, brushSize, operation, createBrushCircle]);

  // ✅ Handle keyboard for shift detection
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        setShiftPressed(true);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        setShiftPressed(false);
      }
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

  // ✅ Mouse event handlers
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
    if (worldPoint) {
      updateBrushOperation(worldPoint);
    }
    
    setIsDrawing(true);
    setLastPosition(canvasPoint);
    applyBrushStroke(canvasPoint, canvasPoint);
  }, [isActive, selectedStructure, canvasToWorld, updateBrushOperation, applyBrushStroke]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isActive || !canvasRef.current) return;
    
    const rect = canvasRef.current.getBoundingClientRect();
    const canvasPoint = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
    
    setMousePosition(canvasPoint);
    
    if (isDrawing && lastPosition) {
      applyBrushStroke(lastPosition, canvasPoint);
      setLastPosition(canvasPoint);
    }
  }, [isActive, isDrawing, lastPosition, applyBrushStroke]);

  const handleMouseUp = useCallback((e: MouseEvent) => {
    if (!isActive || e.button !== 0) return;
    
    setIsDrawing(false);
    setLastPosition(null);
  }, [isActive]);

  // ✅ Event listener setup
  useEffect(() => {
    if (!isActive || !canvasRef.current) return;

    const canvas = canvasRef.current;
    
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);
    
    canvas.style.cursor = 'none';
    
    return () => {
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseup', handleMouseUp);
      canvas.style.cursor = 'default';
    };
  }, [isActive, handleMouseDown, handleMouseMove, handleMouseUp]);

  // ✅ Professional cursor rendering (like the professional version)
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

  // ✅ Professional cursor rendering
  useEffect(() => {
    if (!cursorCanvasRef.current || !mousePosition) return;

    const ctx = cursorCanvasRef.current.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, cursorCanvasRef.current.width, cursorCanvasRef.current.height);
    
    const centerX = mousePosition.x;
    const centerY = mousePosition.y;
    const radius = brushSize / 2;
    
    ctx.save();
    
    // Set operation color
    const operationColor = operation === BrushOperation.ADDITIVE ? '#00ff00' : '#ff0000';
    
    // Draw brush circle
    ctx.strokeStyle = operationColor;
    ctx.lineWidth = isDrawing ? 3 : 2;
    ctx.setLineDash([5, 5]);
    ctx.globalAlpha = isDrawing ? 1.0 : 0.7;
    
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
    ctx.stroke();
    
    // Draw operation indicator (+ for add, - for subtract)
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
    
    ctx.restore();
  }, [mousePosition, brushSize, isDrawing, operation]);

  return null;
}
