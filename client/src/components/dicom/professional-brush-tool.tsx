import { useEffect, useRef, useState } from 'react';

export enum BrushOperation {
  ADDITIVE = 'ADDITIVE',
  SUBTRACTIVE = 'SUBTRACTIVE',
}

interface ProfessionalBrushToolProps {
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

export function ProfessionalBrushTool({
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
}: ProfessionalBrushToolProps) {
  const [isDrawing, setIsDrawing] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [operation, setOperation] = useState<BrushOperation>(BrushOperation.ADDITIVE);
  const [operationLocked, setOperationLocked] = useState(false);
  const [currentStroke, setCurrentStroke] = useState<{x: number, y: number}[]>([]);
  const [mousePosition, setMousePosition] = useState<{ x: number; y: number } | null>(null);
  const [lastPosition, setLastPosition] = useState<{ x: number; y: number } | null>(null);
  const [startBrushSize, setStartBrushSize] = useState<number | undefined>(undefined);
  const [shiftPressed, setShiftPressed] = useState(false);
  const [ctrlPressed, setCtrlPressed] = useState(false);
  const [fillMode, setFillMode] = useState(true);

  // Generate brush circle points (32-point circle)
  const getBrushPoints = (centerX: number, centerY: number): { x: number; y: number }[] => {
    const points: { x: number; y: number }[] = [];
    const steps = 32;
    const radius = brushSize / 2;

    for (let i = 0; i < steps; i++) {
      const angle = (i / steps) * Math.PI * 2;
      points.push({
        x: centerX + Math.cos(angle) * radius,
        y: centerY + Math.sin(angle) * radius,
      });
    }
    
    // Close the circle
    points.push(points[0]);
    return points;
  };

  // Create cursor overlay canvas
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

  // Update brush operation based on cursor position
  const updateBrushOperation = (canvasX: number, canvasY: number) => {
    if (operationLocked) return;

    const inside = isInsideContour(canvasX, canvasY);
    
    if (!hasContourOnSlice()) {
      setOperation(BrushOperation.ADDITIVE);
      return;
    }

    if (shiftPressed) {
      // Shift inverts behavior
      setOperation(inside ? BrushOperation.SUBTRACTIVE : BrushOperation.ADDITIVE);
    } else {
      // Default behavior
      setOperation(inside ? BrushOperation.ADDITIVE : BrushOperation.SUBTRACTIVE);
    }
  };

  // Check if mouse is inside existing contour
  const isInsideContour = (canvasX: number, canvasY: number): boolean => {
    if (!selectedStructure || !rtStructures) return false;
    
    const worldCoords = canvasToWorld(canvasX, canvasY);
    if (!worldCoords) return false;

    const structure = rtStructures.structures.find((s: any) => s.roiNumber === selectedStructure);
    if (!structure) return false;

    const tolerance = 2.0;
    
    for (const contour of structure.contours) {
      if (Math.abs(contour.slicePosition - currentSlicePosition) <= tolerance) {
        // Use point-in-polygon test for contour points
        if (pointInPolygon(worldCoords, contour.points)) {
          return true;
        }
      }
    }
    
    return false;
  };

  // Simple point-in-polygon test
  const pointInPolygon = (point: { x: number; y: number }, contourPoints: number[]): boolean => {
    if (contourPoints.length < 6) return false; // Need at least 3 points (x,y,z each)
    
    let inside = false;
    const polygon: { x: number; y: number }[] = [];
    
    // Convert contour points to 2D polygon
    for (let i = 0; i < contourPoints.length; i += 3) {
      polygon.push({ x: contourPoints[i], y: contourPoints[i + 1] });
    }
    
    // Ray casting algorithm
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      if (((polygon[i].y > point.y) !== (polygon[j].y > point.y)) &&
          (point.x < (polygon[j].x - polygon[i].x) * (point.y - polygon[i].y) / (polygon[j].y - polygon[i].y) + polygon[i].x)) {
        inside = !inside;
      }
    }
    
    return inside;
  };

  // Check if current slice has contours
  const hasContourOnSlice = (): boolean => {
    if (!selectedStructure || !rtStructures) return false;
    
    const structure = rtStructures.structures.find((s: any) => s.roiNumber === selectedStructure);
    if (!structure) return false;

    const tolerance = 2.0;
    return structure.contours.some((contour: any) => 
      Math.abs(contour.slicePosition - currentSlicePosition) <= tolerance && 
      contour.numberOfPoints > 0
    );
  };

  const canvasToWorld = (canvasX: number, canvasY: number) => {
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

  // Draw cursor overlay with professional styling
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
      const opacity = isResizing ? 0.8 : 0.6;

      // Draw brush circle outline
      const brushPoints = getBrushPoints(mousePosition.x, mousePosition.y);
      
      ctx.strokeStyle = brushColor;
      ctx.globalAlpha = opacity;
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      
      ctx.beginPath();
      ctx.moveTo(brushPoints[0].x, brushPoints[0].y);
      for (let i = 1; i < brushPoints.length; i++) {
        ctx.lineTo(brushPoints[i].x, brushPoints[i].y);
      }
      ctx.stroke();

      // Draw cursor crosshair
      ctx.globalAlpha = 0.8;
      ctx.lineWidth = 1;
      ctx.strokeStyle = brushColor;
      
      const crossSize = Math.min(brushSize / 4, 10);
      
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

      // Draw resize indicator during resize mode
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

  const handleMouseDown = (e: MouseEvent) => {
    if (!isActive || !selectedStructure) return;
    
    e.preventDefault();
    e.stopImmediatePropagation();
    
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    if (e.button === 2) { // Right click - start resizing
      setIsResizing(true);
      setStartBrushSize(brushSize);
      setLastPosition({ x, y });
      
      // Request pointer lock for smooth resize experience
      canvasRef.current?.requestPointerLock();
      
      console.log('Professional brush tool starting resize mode');
      return;
    }
    
    if (e.button === 0) { // Left click - start drawing
      setIsDrawing(true);
      setOperationLocked(true);
      updateBrushOperation(x, y);
      setCurrentStroke([{ x, y }]);
      setLastPosition({ x, y });
      console.log('Professional brush tool drawing started:', { operation });
    }
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isActive || !selectedStructure) return;
    
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Update mouse position for cursor rendering
    setMousePosition({ x, y });
    
    // Update brush operation if not locked
    if (!operationLocked) {
      updateBrushOperation(x, y);
    }
    
    if (isResizing && lastPosition) {
      e.preventDefault();
      e.stopImmediatePropagation();
      
      // Use movement deltas for smooth resizing
      const deltaX = e.movementX || 0;
      const deltaY = e.movementY || 0;
      const delta = (deltaX - deltaY) * 0.3;
      
      const newSize = Math.max(1, Math.min(100, brushSize + delta));
      onBrushSizeChange(newSize);
      
      console.log('Professional brush tool resizing:', { newSize, delta });
      return;
    }
    
    if (isDrawing) {
      e.preventDefault();
      e.stopImmediatePropagation();
      
      setCurrentStroke(prev => {
        const newStroke = [...prev, { x, y }];
        return newStroke;
      });
      
      setLastPosition({ x, y });
    }
  };

  const handleMouseUp = (e: MouseEvent) => {
    if (!isActive || !selectedStructure) return;
    
    e.preventDefault();
    e.stopImmediatePropagation();
    
    if (isResizing) {
      setIsResizing(false);
      setStartBrushSize(undefined);
      setLastPosition(null);
      document.exitPointerLock();
      console.log('Professional brush tool resize complete');
      return;
    }
    
    if (isDrawing && rtStructures) {
      console.log('Professional brush tool completing stroke:', { operation, strokeLength: currentStroke.length });
      setIsDrawing(false);
      setOperationLocked(false);
      
      if (currentStroke.length > 1) {
        updateRTStructureWithBrush();
      }
      
      setCurrentStroke([]);
      setLastPosition(null);
    }
  };

  const updateRTStructureWithBrush = () => {
    if (!selectedStructure || !rtStructures || currentStroke.length === 0) return;

    const updatedRTStructures = JSON.parse(JSON.stringify(rtStructures));
    const structure = updatedRTStructures.structures.find((s: any) => s.roiNumber === selectedStructure);
    
    if (!structure) return;

    // Convert brush stroke to world coordinates
    const worldPoints: number[] = [];
    
    // Create brush path from stroke points
    for (let i = 0; i < currentStroke.length - 1; i++) {
      const currentPoint = currentStroke[i];
      const nextPoint = currentStroke[i + 1];
      
      // Generate brush circle points between current and next position
      const brushPath = generateBrushPath(currentPoint, nextPoint);
      
      for (const point of brushPath) {
        const worldCoords = canvasToWorld(point.x, point.y);
        if (worldCoords) {
          worldPoints.push(worldCoords.x, worldCoords.y, currentSlicePosition);
        }
      }
    }

    if (worldPoints.length < 9) return;

    // Apply brush operation
    if (operation === BrushOperation.ADDITIVE) {
      // Add brush stroke to contours
      const existingContourIndex = structure.contours.findIndex((c: any) => 
        Math.abs(c.slicePosition - currentSlicePosition) <= 2.0
      );

      if (existingContourIndex !== -1) {
        // Extend existing contour (union operation)
        structure.contours[existingContourIndex].points.push(...worldPoints);
        structure.contours[existingContourIndex].numberOfPoints = structure.contours[existingContourIndex].points.length / 3;
      } else {
        // Create new contour
        structure.contours.push({
          slicePosition: currentSlicePosition,
          points: worldPoints,
          numberOfPoints: worldPoints.length / 3
        });
      }
    } else {
      // Subtractive operation - remove points near brush stroke
      structure.contours.forEach((contour: any) => {
        if (Math.abs(contour.slicePosition - currentSlicePosition) <= 2.0) {
          const filteredPoints: number[] = [];
          
          for (let i = 0; i < contour.points.length; i += 3) {
            const pointX = contour.points[i];
            const pointY = contour.points[i + 1];
            const pointZ = contour.points[i + 2];
            
            let shouldKeepPoint = true;
            
            // Check if this point is within brush stroke area
            for (let j = 0; j < worldPoints.length; j += 3) {
              const brushX = worldPoints[j];
              const brushY = worldPoints[j + 1];
              
              const distance = Math.sqrt(
                Math.pow(pointX - brushX, 2) + 
                Math.pow(pointY - brushY, 2)
              );
              
              if (distance <= brushSize / 2) {
                shouldKeepPoint = false;
                break;
              }
            }
            
            if (shouldKeepPoint) {
              filteredPoints.push(pointX, pointY, pointZ);
            }
          }
          
          contour.points = filteredPoints;
          contour.numberOfPoints = filteredPoints.length / 3;
        }
      });
      
      // Remove empty contours
      structure.contours = structure.contours.filter((c: any) => c.numberOfPoints > 0);
    }

    onContourUpdate(updatedRTStructures);
    console.log('Professional RT Structure updated:', { operation, pointsProcessed: worldPoints.length / 3 });
  };

  // Generate brush path between two points (simplified version)
  const generateBrushPath = (start: { x: number; y: number }, end: { x: number; y: number }): { x: number; y: number }[] => {
    const brushPath: { x: number; y: number }[] = [];
    const radius = brushSize / 2;
    const steps = Math.max(8, Math.floor(brushSize / 4)); // Adaptive resolution
    
    // Create circular brush at start position
    for (let i = 0; i < steps; i++) {
      const angle = (i / steps) * Math.PI * 2;
      brushPath.push({
        x: start.x + Math.cos(angle) * radius,
        y: start.y + Math.sin(angle) * radius,
      });
    }
    
    return brushPath;
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
      setFillMode(false);
    }
  };

  const handleKeyUp = (e: KeyboardEvent) => {
    if (e.key === 'Shift') {
      setShiftPressed(false);
    }
    if (e.key === 'Control' || e.key === 'Meta') {
      setCtrlPressed(false);
      setFillMode(true);
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

  // Set up mouse event listeners
  useEffect(() => {
    if (!isActive || !canvasRef.current) return;

    const canvas = canvasRef.current;
    
    canvas.addEventListener('mousedown', handleMouseDown, { capture: true });
    canvas.addEventListener('mousemove', handleMouseMove, { capture: true });
    canvas.addEventListener('mouseup', handleMouseUp, { capture: true });
    canvas.addEventListener('mouseleave', handleMouseUp, { capture: true });
    canvas.addEventListener('contextmenu', handleContextMenu, { capture: true });
    canvas.addEventListener('wheel', handleWheel, { capture: true });
    
    return () => {
      canvas.removeEventListener('mousedown', handleMouseDown, { capture: true });
      canvas.removeEventListener('mousemove', handleMouseMove, { capture: true });
      canvas.removeEventListener('mouseup', handleMouseUp, { capture: true });
      canvas.removeEventListener('mouseleave', handleMouseUp, { capture: true });
      canvas.removeEventListener('contextmenu', handleContextMenu, { capture: true });
      canvas.removeEventListener('wheel', handleWheel, { capture: true });
    };
  }, [isActive, isDrawing, isResizing, operation, selectedStructure, currentStroke, brushSize, shiftPressed, ctrlPressed]);

  // Set up keyboard event listeners
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