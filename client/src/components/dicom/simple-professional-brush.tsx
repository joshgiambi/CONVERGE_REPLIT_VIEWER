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

  // Create brush stroke as circle polygon
  const createBrushStroke = (strokePoints: Point[]): Point[] => {
    if (strokePoints.length === 0) return [];

    // Get center point of stroke
    const centerCanvas = strokePoints[Math.floor(strokePoints.length / 2)];
    const centerWorld = canvasToWorld(centerCanvas.x, centerCanvas.y);
    if (!centerWorld) return [];

    // Create brush circle in world coordinates
    const brushRadius = brushSize / 2;
    return createCirclePolygon(centerWorld, brushRadius);
  };

  // Simple brush operation - add or remove points
  const updateRTStructureWithSimpleBrush = () => {
    if (!selectedStructure || !rtStructures || currentStroke.length < 2) return;

    const brushStroke = createBrushStroke(currentStroke);
    if (brushStroke.length === 0) return;

    const updatedRTStructures = JSON.parse(JSON.stringify(rtStructures));
    const structure = updatedRTStructures.structures.find((s: any) => s.roiNumber === selectedStructure);
    
    if (!structure) return;

    // Remove existing contours on current slice
    const tolerance = 2.0;
    structure.contours = structure.contours.filter((contour: any) => 
      Math.abs(contour.slicePosition - currentSlicePosition) > tolerance
    );

    if (operation === BrushOperation.ADDITIVE) {
      // Add new brush stroke contour
      const points = polygonToDicomPoints(brushStroke, currentSlicePosition);
      
      if (points.length >= 9) { // At least 3 points
        structure.contours.push({
          slicePosition: currentSlicePosition,
          points: points,
          numberOfPoints: points.length / 3
        });
      }
    }
    // For subtractive, we just remove existing contours (simplified approach)

    onContourUpdate(updatedRTStructures);
    
    console.log('Simple professional brush operation completed:', { 
      operation, 
      strokeLength: currentStroke.length,
      brushStrokePoints: brushStroke.length 
    });
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

  // Render cursor overlay
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
      const brushColor = isAdditive ? '#00ff00' : '#ff0000'; // Green/Red medical standard
      const opacity = isResizing ? 0.8 : 0.6;

      // Draw brush circle outline
      ctx.strokeStyle = brushColor;
      ctx.globalAlpha = opacity;
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      
      ctx.beginPath();
      ctx.arc(mousePosition.x, mousePosition.y, brushSize / 2, 0, 2 * Math.PI);
      ctx.stroke();

      // Professional medical cursor indicators
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = 1;
      ctx.strokeStyle = brushColor;
      
      const crossSize = Math.min(brushSize / 6, 10);
      
      if (isAdditive) {
        // Full crosshair for additive
        ctx.beginPath();
        ctx.moveTo(mousePosition.x - crossSize, mousePosition.y);
        ctx.lineTo(mousePosition.x + crossSize, mousePosition.y);
        ctx.moveTo(mousePosition.x, mousePosition.y - crossSize);
        ctx.lineTo(mousePosition.x, mousePosition.y + crossSize);
        ctx.stroke();
      } else {
        // Horizontal line for subtractive
        ctx.beginPath();
        ctx.moveTo(mousePosition.x - crossSize, mousePosition.y);
        ctx.lineTo(mousePosition.x + crossSize, mousePosition.y);
        ctx.stroke();
      }

      // Resize indicator
      if (isResizing) {
        ctx.globalAlpha = 0.4;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.arc(mousePosition.x, mousePosition.y, brushSize / 2 + 8, 0, 2 * Math.PI);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.globalAlpha = 1.0;
    }
  }, [isActive, mousePosition, operation, brushSize, isResizing]);

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
      
      setCurrentStroke(prev => [...prev, { x, y }]);
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
      
      if (currentStroke.length > 1) {
        updateRTStructureWithSimpleBrush();
      }
      
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