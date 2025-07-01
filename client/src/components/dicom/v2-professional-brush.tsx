import { useEffect, useState } from 'react';

// V2 Professional constants
const SCALING_FACTOR = 1000;

interface Point {
  x: number;
  y: number;
}

enum BrushOperation {
  ADDITIVE = 'additive',
  SUBTRACTIVE = 'subtractive'
}

interface V2ProfessionalBrushProps {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  isActive: boolean;
  brushSize: number;
  selectedStructure: number | null;
  rtStructures: any;
  currentSlicePosition: number;
  onContourUpdate: (updatedRTStructures: any) => void;
  onBrushSizeChange: (size: number) => void;
  zoom: number;
  panX: number;
  panY: number;
  currentImage: any;
  imageMetadata: any;
}

export function V2ProfessionalBrush({
  canvasRef,
  isActive,
  brushSize,
  selectedStructure,
  rtStructures,
  currentSlicePosition,
  onContourUpdate,
  onBrushSizeChange,
  zoom,
  panX,
  panY,
  currentImage,
  imageMetadata
}: V2ProfessionalBrushProps) {
  // V2 Professional state management
  const [mousePosition, setMousePosition] = useState<Point | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [operation, setOperation] = useState<BrushOperation>(BrushOperation.ADDITIVE);
  const [currentStroke, setCurrentStroke] = useState<Point[]>([]);
  const [shiftPressed, setShiftPressed] = useState(false);
  const [operationLocked, setOperationLocked] = useState(false);
  const [animationFrame, setAnimationFrame] = useState(0);
  const [isResizing, setIsResizing] = useState(false);
  const [lastPosition, setLastPosition] = useState<Point | null>(null);

  // Convert world coordinates to scaled integer coordinates for medical precision
  const worldToScaled = (worldX: number, worldY: number): Point => ({
    x: Math.round(worldX * SCALING_FACTOR),
    y: Math.round(worldY * SCALING_FACTOR),
  });

  // Convert scaled coordinates back to world coordinates
  const scaledToWorld = (scaledX: number, scaledY: number): Point => ({
    x: scaledX / SCALING_FACTOR,
    y: scaledY / SCALING_FACTOR,
  });

  // Convert canvas coordinates to DICOM world coordinates with medical precision
  const canvasToWorld = (canvasX: number, canvasY: number): Point | null => {
    if (!currentImage || !imageMetadata) return null;

    const canvas = canvasRef.current;
    if (!canvas) return null;

    const imageWidth = currentImage.width || 512;
    const imageHeight = currentImage.height || 512;

    const baseScale = Math.max(canvas.width / imageWidth, canvas.height / imageHeight);
    const totalScale = baseScale * zoom;
    const scaledWidth = imageWidth * totalScale;
    const scaledHeight = imageHeight * totalScale;

    const imageX = (canvas.width - scaledWidth) / 2 + panX;
    const imageY = (canvas.height - scaledHeight) / 2 + panY;

    const pixelX = (canvasX - imageX) / totalScale;
    const pixelY = (canvasY - imageY) / totalScale;

    if (imageMetadata.imagePosition && imageMetadata.pixelSpacing && imageMetadata.imageOrientation) {
      const imagePosition = imageMetadata.imagePosition.split('\\').map(Number);
      const pixelSpacing = imageMetadata.pixelSpacing.split('\\').map(Number);
      const imageOrientation = imageMetadata.imageOrientation.split('\\').map(Number);

      const worldX = imagePosition[0] + (pixelX * pixelSpacing[1] * imageOrientation[0]) + (pixelY * pixelSpacing[0] * imageOrientation[3]);
      const worldY = imagePosition[1] + (pixelX * pixelSpacing[1] * imageOrientation[1]) + (pixelY * pixelSpacing[0] * imageOrientation[4]);

      return { x: worldX, y: worldY };
    }

    return null;
  };

  // Create circle polygon for brush operations
  const createCirclePolygon = (center: Point, radius: number, segments: number = 32): Point[] => {
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

  // Convert DICOM points to polygon
  const dicomPointsToPolygon = (points: number[]): Point[] => {
    const polygon: Point[] = [];
    for (let i = 0; i < points.length; i += 3) {
      polygon.push({ x: points[i], y: points[i + 1] });
    }
    return polygon;
  };

  // Point-in-polygon test for medical precision
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

  // Convert polygon to DICOM points format
  const polygonToDicomPoints = (polygon: Point[], slicePosition: number): number[] => {
    const points: number[] = [];
    for (const point of polygon) {
      points.push(point.x, point.y, slicePosition);
    }
    return points;
  };

  // Get current contour polygons with medical precision
  const getCurrentContourPolygons = (): Point[][] => {
    if (!selectedStructure || !rtStructures) return [];

    const structure = rtStructures.structures.find((s: any) => s.roiNumber === selectedStructure);
    if (!structure) return [];

    const tolerance = 2.0;
    const polygons: Point[][] = [];

    for (const contour of structure.contours) {
      if (Math.abs(contour.slicePosition - currentSlicePosition) <= tolerance && contour.numberOfPoints > 0) {
        const polygon = dicomPointsToPolygon(contour.points);
        if (polygon.length > 2) {
          polygons.push(polygon);
        }
      }
    }

    return polygons;
  };

  // Check if point is inside existing contour with medical precision
  const isInsideContour = (canvasX: number, canvasY: number): boolean => {
    const worldCoords = canvasToWorld(canvasX, canvasY);
    if (!worldCoords) return false;

    const polygons = getCurrentContourPolygons();
    if (polygons.length === 0) return false;

    let insideCount = 0;
    for (const polygon of polygons) {
      if (pointInPolygon(worldCoords, polygon)) {
        insideCount++;
      }
    }

    return insideCount % 2 === 1;
  };

  // Update brush operation with V2 smart detection
  const updateBrushOperation = (canvasX: number, canvasY: number) => {
    if (operationLocked) return;

    const polygons = getCurrentContourPolygons();
    
    if (polygons.length === 0) {
      setOperation(BrushOperation.ADDITIVE);
      return;
    }

    const inside = isInsideContour(canvasX, canvasY);
    
    if (shiftPressed) {
      setOperation(inside ? BrushOperation.SUBTRACTIVE : BrushOperation.ADDITIVE);
    } else {
      setOperation(inside ? BrushOperation.ADDITIVE : BrushOperation.SUBTRACTIVE);
    }
  };

  // Get world brush size in medical coordinates
  const getWorldBrushSize = (): number => {
    return brushSize / 10; // Convert to world units
  };

  // Get display brush size for professional cursor
  const getDisplayBrushSize = (): number => {
    return Math.max(4, Math.min(50, brushSize / 2));
  };

  // Create professional brush stroke with medical precision
  const createBrushStrokePath = (startWorld: Point, endWorld: Point): Point[] => {
    const brushRadius = getWorldBrushSize() / 2;
    
    const dx = endWorld.x - startWorld.x;
    const dy = endWorld.y - startWorld.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    
    if (length < 0.1) {
      return createCirclePolygon(endWorld, brushRadius, 32);
    }
    
    // Create professional stroke with adaptive resolution
    const steps = Math.max(8, Math.floor(length / 2));
    const strokePoints: Point[] = [];
    
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = startWorld.x + (endWorld.x - startWorld.x) * t;
      const y = startWorld.y + (endWorld.y - startWorld.y) * t;
      strokePoints.push({ x, y });
    }
    
    // Create circles at each point for medical-grade coverage
    let combinedPoints: Point[] = [];
    for (const point of strokePoints) {
      const circle = createCirclePolygon(point, brushRadius, 16);
      combinedPoints.push(...circle);
    }
    
    return combinedPoints;
  };

  // Simple brush drawing like a normal drawing application
  const performBrushStroke = (canvasPoint: Point) => {
    if (!selectedStructure || !rtStructures) return;

    const worldPoint = canvasToWorld(canvasPoint.x, canvasPoint.y);
    if (!worldPoint) return;

    // Create a simple brush circle at the current position
    const brushRadius = getWorldBrushSize() / 2;
    const brushCircle = createCirclePolygon(worldPoint, brushRadius, 16);
    
    const updatedRTStructures = JSON.parse(JSON.stringify(rtStructures));
    const structure = updatedRTStructures.structures.find((s: any) => s.roiNumber === selectedStructure);
    
    if (!structure) return;

    const tolerance = 2.0;
    let existingContour = structure.contours.find((contour: any) => 
      Math.abs(contour.slicePosition - currentSlicePosition) <= tolerance
    );

    if (operation === BrushOperation.ADDITIVE) {
      const newPoints = polygonToDicomPoints(brushCircle, currentSlicePosition);
      
      if (newPoints.length >= 9) {
        if (existingContour) {
          // Append new points to existing contour (simple drawing)
          const existingPoints = existingContour.points;
          const combinedPoints = [...existingPoints, ...newPoints];
          existingContour.points = combinedPoints;
          existingContour.numberOfPoints = combinedPoints.length / 3;
        } else {
          // Create new contour
          structure.contours.push({
            slicePosition: currentSlicePosition,
            points: newPoints,
            numberOfPoints: newPoints.length / 3
          });
        }
      }
    } else {
      // For subtractive, just remove the whole contour for now
      structure.contours = structure.contours.filter((contour: any) => 
        Math.abs(contour.slicePosition - currentSlicePosition) > tolerance
      );
    }

    onContourUpdate(updatedRTStructures);
  };

  // Professional mouse event handlers
  const handleMouseDown = (e: MouseEvent) => {
    if (!isActive || !selectedStructure) return;
    
    e.preventDefault();
    e.stopImmediatePropagation();
    
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    if (e.button === 2) { // Right click for professional resizing
      setIsResizing(true);
      setLastPosition({ x, y });
      return;
    }
    
    setIsDrawing(true);
    setOperationLocked(true);
    setCurrentStroke([{ x, y }]);
    setLastPosition({ x, y });
    updateBrushOperation(x, y);
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isActive) return;
    
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    setMousePosition({ x, y });
    
    if (!operationLocked) {
      updateBrushOperation(x, y);
    }
    
    if (isResizing && lastPosition) {
      const deltaY = e.clientY - lastPosition.y;
      const newSize = Math.max(5, Math.min(100, brushSize - deltaY));
      onBrushSizeChange(newSize);
      return;
    }
    
    if (isDrawing) {
      const newStroke = [...currentStroke, { x, y }];
      setCurrentStroke(newStroke);
      performContinuousBrushOperation(newStroke);
    }
    
    setLastPosition({ x, y });
  };

  const handleMouseUp = (e: MouseEvent) => {
    if (!isActive) return;
    
    if (isResizing) {
      setIsResizing(false);
      setLastPosition(null);
      return;
    }
    
    if (isDrawing) {
      setIsDrawing(false);
      setOperationLocked(false);
    }
    
    setCurrentStroke([]);
    setLastPosition(null);
  };

  // Professional keyboard handlers
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

  // V2 Professional event system
  useEffect(() => {
    if (!isActive || !canvasRef.current) return;

    const canvas = canvasRef.current;
    
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    
    // Professional medical cursor
    canvas.style.cursor = 'none';
    
    return () => {
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
      canvas.style.cursor = 'default';
    };
  }, [isActive, selectedStructure, brushSize, operation, shiftPressed, isDrawing, isResizing, currentStroke]);

  // Professional animation system
  useEffect(() => {
    if (!isActive) return;

    const animate = () => {
      setAnimationFrame(prev => (prev + 1) % 360);
      requestAnimationFrame(animate);
    };

    const animationId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationId);
  }, [isActive]);

  // V2 Professional cursor rendering with medical-grade precision
  useEffect(() => {
    if (!isActive || !canvasRef.current) return;

    const mainCanvas = canvasRef.current;
    
    // Create professional cursor overlay
    let cursorCanvas = mainCanvas.parentElement?.querySelector('.v2-brush-cursor') as HTMLCanvasElement;
    if (!cursorCanvas) {
      cursorCanvas = document.createElement('canvas');
      cursorCanvas.className = 'v2-brush-cursor';
      cursorCanvas.style.position = 'absolute';
      cursorCanvas.style.top = '0';
      cursorCanvas.style.left = '0';
      cursorCanvas.style.pointerEvents = 'none';
      cursorCanvas.style.zIndex = '999';
      mainCanvas.parentElement?.appendChild(cursorCanvas);
    }
    
    cursorCanvas.width = mainCanvas.width;
    cursorCanvas.height = mainCanvas.height;
    cursorCanvas.style.width = mainCanvas.style.width || `${mainCanvas.width}px`;
    cursorCanvas.style.height = mainCanvas.style.height || `${mainCanvas.height}px`;

    const ctx = cursorCanvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, cursorCanvas.width, cursorCanvas.height);

    if (mousePosition) {
      const isAdditive = operation === BrushOperation.ADDITIVE;
      const brushColor = isAdditive ? '#00ff00' : '#ff0000';
      const fillColor = isAdditive ? 'rgba(0, 255, 0, 0.25)' : 'rgba(255, 0, 0, 0.25)';

      const radius = getDisplayBrushSize();
      const centerX = mousePosition.x;
      const centerY = mousePosition.y;
      
      // Professional medical-grade cursor with animated gradient
      const gradient = ctx.createConicGradient((animationFrame * Math.PI) / 180, centerX, centerY);
      
      if (isAdditive) {
        gradient.addColorStop(0, '#00ff00');
        gradient.addColorStop(0.25, '#80ff00');
        gradient.addColorStop(0.5, '#ffff00');
        gradient.addColorStop(0.75, '#80ff00');
        gradient.addColorStop(1, '#00ff00');
      } else {
        gradient.addColorStop(0, '#ff0000');
        gradient.addColorStop(0.25, '#ff0080');
        gradient.addColorStop(0.5, '#8000ff');
        gradient.addColorStop(0.75, '#ff0080');
        gradient.addColorStop(1, '#ff0000');
      }

      // Draw professional brush circle
      ctx.globalAlpha = 1.0;
      ctx.fillStyle = fillColor;
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
      ctx.fill();

      // Animated gradient border for V2 professional appearance
      ctx.strokeStyle = gradient;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
      ctx.stroke();

      // Medical-grade cursor indicators
      const crossSize = Math.min(radius / 3, 8);
      ctx.lineWidth = 2;
      ctx.strokeStyle = brushColor;
      
      if (isAdditive) {
        // Full crosshair for additive operations
        ctx.beginPath();
        ctx.moveTo(centerX - crossSize, centerY);
        ctx.lineTo(centerX + crossSize, centerY);
        ctx.moveTo(centerX, centerY - crossSize);
        ctx.lineTo(centerX, centerY + crossSize);
        ctx.stroke();
      } else {
        // Horizontal line for subtractive operations
        ctx.beginPath();
        ctx.moveTo(centerX - crossSize, centerY);
        ctx.lineTo(centerX + crossSize, centerY);
        ctx.stroke();
      }

      // Professional resize indicator
      if (isResizing) {
        const pulse = Math.sin(animationFrame * 0.1) * 0.3 + 0.7;
        ctx.globalAlpha = pulse;
        ctx.setLineDash([6, 6]);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius + 12, 0, 2 * Math.PI);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.globalAlpha = 1.0;
    }

    return () => {
      cursorCanvas?.remove();
    };
  }, [isActive, mousePosition, operation, brushSize, animationFrame, isResizing]);

  return null; // V2 Professional brush manages events and cursor overlay only
}