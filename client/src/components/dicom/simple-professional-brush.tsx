import { useEffect, useRef, useState } from 'react';
import { pointInPolygon, createCirclePolygon, polygonToDicomPoints, dicomPointsToPolygon, Point } from '@/lib/polygon-utils';

// Medical imaging scaling factor for precision
const SCALING_FACTOR = 1000;

export enum BrushOperation {
  ADDITIVE = 'ADDITIVE',
  SUBTRACTIVE = 'SUBTRACTIVE',
}

interface SimpleProfessionalBrushProps {
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

export function SimpleProfessionalBrush({
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
}: SimpleProfessionalBrushProps) {
  const [isDrawing, setIsDrawing] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [operation, setOperation] = useState<BrushOperation>(BrushOperation.ADDITIVE);
  const [operationLocked, setOperationLocked] = useState(false);
  const [currentStroke, setCurrentStroke] = useState<Point[]>([]);
  const [mousePosition, setMousePosition] = useState<Point | null>(null);
  const [lastPosition, setLastPosition] = useState<Point | null>(null);
  const [shiftPressed, setShiftPressed] = useState(false);
  const [ctrlPressed, setCtrlPressed] = useState(false);
  const [animationFrame, setAnimationFrame] = useState(0);

  // Convert world coordinates to scaled integer coordinates
  const worldToScaled = (worldX: number, worldY: number): Point => ({
    x: Math.round(worldX * SCALING_FACTOR),
    y: Math.round(worldY * SCALING_FACTOR),
  });

  // Convert scaled coordinates back to world coordinates
  const scaledToWorld = (scaledX: number, scaledY: number): Point => ({
    x: scaledX / SCALING_FACTOR,
    y: scaledY / SCALING_FACTOR,
  });

  // Convert canvas coordinates to DICOM world coordinates
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

  // Get current contour as polygons
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

  // Professional point-in-polygon test
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

  // Update brush operation based on Limbus V2 logic
  const updateBrushOperation = (canvasX: number, canvasY: number) => {
    if (operationLocked) return;

    const polygons = getCurrentContourPolygons();
    
    if (polygons.length === 0) {
      setOperation(BrushOperation.ADDITIVE);
      return;
    }

    const inside = isInsideContour(canvasX, canvasY);
    
    if (shiftPressed) {
      // Shift inverts behavior
      setOperation(inside ? BrushOperation.SUBTRACTIVE : BrushOperation.ADDITIVE);
    } else {
      // Default: inside = add, outside = subtract
      setOperation(inside ? BrushOperation.ADDITIVE : BrushOperation.SUBTRACTIVE);
    }
  };

  // Get actual brush size in world coordinates
  const getWorldBrushSize = (): number => {
    // Convert brush size from pixels to world coordinates
    // Based on the current zoom level and pixel spacing
    if (!currentImage || !imageMetadata) return brushSize;
    
    const pixelSpacing = imageMetadata.pixelSpacing ? 
      parseFloat(imageMetadata.pixelSpacing.split('\\')[0]) : 1.0;
    
    // Scale brush size by zoom and pixel spacing
    return (brushSize * pixelSpacing) / zoom;
  };

  // Create simple brush circle (following Limbus V2 pattern)
  const createBrushCircle = (center: Point): Point[] => {
    const worldRadius = getWorldBrushSize() / 2;
    return createCirclePolygon(center, worldRadius, 32);
  };

  // Create buffered stroke path from line segment (simulating ClipperLib.offsetToPolyTree)
  const createBufferedStrokePath = (startWorld: Point, endWorld: Point): Point[] => {
    const brushRadius = getWorldBrushSize() / 2;
    
    // Calculate line direction and perpendicular
    const dx = endWorld.x - startWorld.x;
    const dy = endWorld.y - startWorld.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    
    if (length < 0.001) {
      // For stationary points, return a circle
      return createCirclePolygon(endWorld, brushRadius, 32);
    }
    
    // Normalized perpendicular vector
    const perpX = (-dy / length) * brushRadius;
    const perpY = (dx / length) * brushRadius;
    
    // Create the four corners of the buffered rectangle
    const p1 = { x: startWorld.x + perpX, y: startWorld.y + perpY };
    const p2 = { x: startWorld.x - perpX, y: startWorld.y - perpY };
    const p3 = { x: endWorld.x - perpX, y: endWorld.y - perpY };
    const p4 = { x: endWorld.x + perpX, y: endWorld.y + perpY };
    
    // Add circular end caps
    const startCap = createCirclePolygon(startWorld, brushRadius, 16);
    const endCap = createCirclePolygon(endWorld, brushRadius, 16);
    
    // Combine into a complete stroke path
    return [...startCap, p1, p4, ...endCap, p3, p2];
  };

  // Perform continuous brush operation during mouse movement (exactly like Limbus V2)
  const performContinuousBrushOperation = (strokePoints: Point[]) => {
    if (!selectedStructure || !rtStructures || strokePoints.length < 2) return;

    // Get last two points to create stroke segment (like Limbus V2)
    const currentCanvasPoint = strokePoints[strokePoints.length - 1];
    const lastCanvasPoint = strokePoints[strokePoints.length - 2];
    
    const currentWorldPoint = canvasToWorld(currentCanvasPoint.x, currentCanvasPoint.y);
    const lastWorldPoint = canvasToWorld(lastCanvasPoint.x, lastCanvasPoint.y);
    
    if (!currentWorldPoint || !lastWorldPoint) return;

    // Create buffered stroke path between last two points
    const strokePath = createBufferedStrokePath(lastWorldPoint, currentWorldPoint);
    if (strokePath.length === 0) return;

    const updatedRTStructures = JSON.parse(JSON.stringify(rtStructures));
    const structure = updatedRTStructures.structures.find((s: any) => s.roiNumber === selectedStructure);
    
    if (!structure) return;

    const tolerance = 2.0;
    let existingContour = structure.contours.find((contour: any) => 
      Math.abs(contour.slicePosition - currentSlicePosition) <= tolerance
    );

    if (operation === BrushOperation.ADDITIVE) {
      const strokePoints = polygonToDicomPoints(strokePath, currentSlicePosition);
      
      if (strokePoints.length >= 9) {
        if (existingContour) {
          // Merge with existing contour (simplified union)
          existingContour.points.push(...strokePoints);
          existingContour.numberOfPoints = existingContour.points.length / 3;
        } else {
          // Create new contour
          structure.contours.push({
            slicePosition: currentSlicePosition,
            points: strokePoints,
            numberOfPoints: strokePoints.length / 3
          });
        }
      }
    }
    // Note: subtractive operation would require proper ClipperLib boolean operations

    onContourUpdate(updatedRTStructures);
  };



  // Professional cursor rendering
  useEffect(() => {
    if (!isActive || !canvasRef.current) return;

    const mainCanvas = canvasRef.current;
    const cursorCanvas = document.createElement('canvas');
    
    cursorCanvas.style.position = 'absolute';
    cursorCanvas.style.top = '0';
    cursorCanvas.style.left = '0';
    cursorCanvas.style.pointerEvents = 'none';
    cursorCanvas.style.zIndex = '999';
    
    cursorCanvas.width = mainCanvas.width;
    cursorCanvas.height = mainCanvas.height;
    cursorCanvas.style.width = mainCanvas.style.width || `${mainCanvas.width}px`;
    cursorCanvas.style.height = mainCanvas.style.height || `${mainCanvas.height}px`;
    
    mainCanvas.parentElement?.appendChild(cursorCanvas);
    
    return () => {
      cursorCanvas.remove();
    };
  }, [isActive, selectedStructure]);

  // Animation loop for gradient borders
  useEffect(() => {
    if (!isActive) return;

    const animate = () => {
      setAnimationFrame(prev => (prev + 1) % 360);
      requestAnimationFrame(animate);
    };

    const animationId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationId);
  }, [isActive]);

  // Render cursor overlay with animated gradient borders
  useEffect(() => {
    if (!isActive || !canvasRef.current) return;

    const mainCanvas = canvasRef.current;
    const cursorCanvas = mainCanvas.parentElement?.querySelector('canvas[style*="z-index: 999"]') as HTMLCanvasElement;
    if (!cursorCanvas) return;

    const ctx = cursorCanvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, cursorCanvas.width, cursorCanvas.height);

    if (mousePosition) {
      const isAdditive = operation === BrushOperation.ADDITIVE;
      const brushColor = isAdditive ? '#00ff00' : '#ff0000';
      const fillColor = isAdditive ? 'rgba(0, 255, 0, 0.3)' : 'rgba(255, 0, 0, 0.3)';

      // Create animated gradient border
      const radius = brushSize / 2;
      const centerX = mousePosition.x;
      const centerY = mousePosition.y;
      
      // Create rotating gradient
      const gradient = ctx.createConicGradient((animationFrame * Math.PI) / 180, centerX, centerY);
      
      if (isAdditive) {
        // Green-Yellow rotating gradient for additive
        gradient.addColorStop(0, '#00ff00');    // Green
        gradient.addColorStop(0.25, '#80ff00'); // Green-Yellow
        gradient.addColorStop(0.5, '#ffff00');  // Yellow
        gradient.addColorStop(0.75, '#80ff00'); // Yellow-Green
        gradient.addColorStop(1, '#00ff00');    // Green
      } else {
        // Purple-Red rotating gradient for subtractive
        gradient.addColorStop(0, '#ff0000');    // Red
        gradient.addColorStop(0.25, '#ff0080'); // Red-Purple
        gradient.addColorStop(0.5, '#8000ff');  // Purple
        gradient.addColorStop(0.75, '#ff0080'); // Purple-Red
        gradient.addColorStop(1, '#ff0000');    // Red
      }

      // Draw brush circle with opaque fill
      ctx.globalAlpha = 1.0;
      ctx.fillStyle = fillColor;
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
      ctx.fill();

      // Draw animated gradient border
      ctx.strokeStyle = gradient;
      ctx.lineWidth = 3;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
      ctx.stroke();

      // Professional medical cursor indicators
      ctx.lineWidth = 2;
      ctx.strokeStyle = brushColor;
      
      const crossSize = Math.min(brushSize / 6, 10);
      
      if (isAdditive) {
        // Full crosshair for additive
        ctx.beginPath();
        ctx.moveTo(centerX - crossSize, centerY);
        ctx.lineTo(centerX + crossSize, centerY);
        ctx.moveTo(centerX, centerY - crossSize);
        ctx.lineTo(centerX, centerY + crossSize);
        ctx.stroke();
      } else {
        // Horizontal line for subtractive
        ctx.beginPath();
        ctx.moveTo(centerX - crossSize, centerY);
        ctx.lineTo(centerX + crossSize, centerY);
        ctx.stroke();
      }

      // Resize indicator with pulsing effect
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
  }, [isActive, mousePosition, operation, brushSize, isResizing, animationFrame]);

  // Mouse event handlers
  const handleMouseDown = (e: MouseEvent) => {
    if (!isActive || !selectedStructure) return;
    
    e.preventDefault();
    e.stopImmediatePropagation();
    
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    if (e.button === 2) { // Right click - resizing
      setIsResizing(true);
      setLastPosition({ x, y });
      canvasRef.current?.requestPointerLock();
      return;
    }
    
    if (e.button === 0) { // Left click - drawing
      setIsDrawing(true);
      setOperationLocked(true);
      updateBrushOperation(x, y);
      setCurrentStroke([{ x, y }]);
      setLastPosition({ x, y });
      console.log('Simple professional brush drawing started:', { operation });
    }
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isActive || !selectedStructure) return;
    
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    setMousePosition({ x, y });
    
    if (!operationLocked) {
      updateBrushOperation(x, y);
    }
    
    if (isResizing && lastPosition) {
      e.preventDefault();
      e.stopImmediatePropagation();
      
      const deltaX = e.movementX || 0;
      const deltaY = e.movementY || 0;
      const delta = (deltaX - deltaY) * 0.4;
      
      const newSize = Math.max(1, Math.min(100, brushSize + delta));
      onBrushSizeChange(newSize);
      return;
    }
    
    if (isDrawing) {
      e.preventDefault();
      e.stopImmediatePropagation();
      
      // Add current point to stroke and immediately process it
      const newStroke = [...currentStroke, { x, y }];
      setCurrentStroke(newStroke);
      
      // Perform brush operation only if mouse moved significantly
      if (newStroke.length >= 2) {
        const lastPoint = newStroke[newStroke.length - 2];
        const currentPoint = newStroke[newStroke.length - 1];
        const distance = Math.sqrt(
          Math.pow(currentPoint.x - lastPoint.x, 2) + 
          Math.pow(currentPoint.y - lastPoint.y, 2)
        );
        
        // Only perform operation if mouse moved at least 2 pixels
        if (distance >= 2) {
          performContinuousBrushOperation(newStroke);
        }
      }
      
      setLastPosition({ x, y });
    }
  };

  const handleMouseUp = (e: MouseEvent) => {
    if (!isActive || !selectedStructure) return;
    
    e.preventDefault();
    e.stopImmediatePropagation();
    
    if (isResizing) {
      setIsResizing(false);
      setLastPosition(null);
      document.exitPointerLock();
      return;
    }
    
    if (isDrawing && rtStructures) {
      setIsDrawing(false);
      setOperationLocked(false);
      
      // Drawing complete - continuous operations already handled the stroke
      
      setCurrentStroke([]);
      setLastPosition(null);
    }
  };

  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault();
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Shift') {
      setShiftPressed(true);
    }
    if (e.key === 'Control' || e.key === 'Meta') {
      setCtrlPressed(true);
    }
  };

  const handleKeyUp = (e: KeyboardEvent) => {
    if (e.key === 'Shift') {
      setShiftPressed(false);
    }
    if (e.key === 'Control' || e.key === 'Meta') {
      setCtrlPressed(false);
    }
  };

  const handleWheel = (e: WheelEvent) => {
    if (!ctrlPressed) return;
    
    e.preventDefault();
    e.stopImmediatePropagation();
    
    const delta = e.deltaY > 0 ? -2 : 2;
    const newSize = Math.max(1, Math.min(100, brushSize + delta));
    onBrushSizeChange(newSize);
  };

  // Event listener setup
  useEffect(() => {
    if (!isActive || !canvasRef.current) return;

    const canvas = canvasRef.current;
    
    canvas.addEventListener('mousedown', handleMouseDown, { capture: true });
    canvas.addEventListener('mousemove', handleMouseMove, { capture: true });
    canvas.addEventListener('mouseup', handleMouseUp, { capture: true });
    canvas.addEventListener('mouseleave', handleMouseUp, { capture: true });
    canvas.addEventListener('contextmenu', handleContextMenu, { capture: true });
    canvas.addEventListener('wheel', handleWheel, { capture: true });
    
    console.log('Simple professional brush tool activated');
    
    return () => {
      canvas.removeEventListener('mousedown', handleMouseDown, { capture: true });
      canvas.removeEventListener('mousemove', handleMouseMove, { capture: true });
      canvas.removeEventListener('mouseup', handleMouseUp, { capture: true });
      canvas.removeEventListener('mouseleave', handleMouseUp, { capture: true });
      canvas.removeEventListener('contextmenu', handleContextMenu, { capture: true });
      canvas.removeEventListener('wheel', handleWheel, { capture: true });
      console.log('Simple professional brush tool deactivated');
    };
  }, [isActive, isDrawing, isResizing, operation, selectedStructure, currentStroke, brushSize, shiftPressed, ctrlPressed]);

  // Keyboard event setup
  useEffect(() => {
    if (!isActive) return;

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
    };
  }, [isActive]);

  return null;
}