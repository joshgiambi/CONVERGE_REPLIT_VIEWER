import { useEffect, useState, useRef } from 'react';

interface SimpleBrushToolProps {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  isActive: boolean;
  brushSize: number;
  onBrushSizeChange: (size: number) => void;
  rtStructures: any;
  selectedStructure: any;
  currentSlicePosition: number;
  zoom: number;
  panX: number;
  panY: number;
  onContourUpdate?: (updatedStructures: any) => void;
}

export function SimpleBrushTool({
  canvasRef,
  isActive,
  brushSize,
  onBrushSizeChange,
  rtStructures,
  selectedStructure,
  currentSlicePosition,
  zoom,
  panX,
  panY,
  onContourUpdate
}: SimpleBrushToolProps) {
  const [isDrawing, setIsDrawing] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [mousePosition, setMousePosition] = useState<{ x: number; y: number } | null>(null);
  const [resizeStartPosition, setResizeStartPosition] = useState<{ x: number; y: number } | null>(null);
  const [isInsideContour, setIsInsideContour] = useState(false);
  const [brushStrokes, setBrushStrokes] = useState<Array<{x: number, y: number, isAdditive: boolean}>>([]);
  const cursorCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Point-in-polygon algorithm for contour boundary detection
  const pointInPolygon = (x: number, y: number, points: number[]): boolean => {
    let inside = false;
    const numPoints = points.length / 3; // x,y,z coordinates

    for (let i = 0, j = numPoints - 1; i < numPoints; j = i++) {
      const xi = points[i * 3];     // x coordinate
      const yi = points[i * 3 + 1]; // y coordinate
      const xj = points[j * 3];     // x coordinate of previous point
      const yj = points[j * 3 + 1]; // y coordinate of previous point

      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
        inside = !inside;
      }
    }
    return inside;
  };

  // Check if brush center or edge intersects with contour boundaries
  const checkBrushContourIntersection = (mouseX: number, mouseY: number): boolean => {
    if (!selectedStructure || !rtStructures) return false;

    const structure = rtStructures.structures.find((s: any) => s.roiNumber === selectedStructure.roiNumber);
    if (!structure || !structure.contours) return false;

    // Convert mouse position to world coordinates
    const canvas = canvasRef.current;
    if (!canvas) return false;

    const canvasCenterX = canvas.width / 2;
    const canvasCenterY = canvas.height / 2;

    // Convert canvas coordinates to world coordinates
    const worldX = (mouseX - canvasCenterX - panX) / zoom;
    const worldY = (mouseY - canvasCenterY - panY) / zoom;

    // Find contours for current slice
    const tolerance = 2.5;
    const currentSliceContours = structure.contours.filter((contour: any) => 
      Math.abs(contour.slicePosition - currentSlicePosition) <= tolerance
    );

    if (currentSliceContours.length === 0) return false;

    // Check if brush center or any point on brush edge is inside any contour
    const brushRadius = brushSize / zoom; // Convert to world coordinates

    for (const contour of currentSliceContours) {
      if (!contour.points || contour.points.length < 9) continue; // Need at least 3 points (x,y,z each)

      // Check if brush center is inside contour
      if (pointInPolygon(worldX, worldY, contour.points)) {
        return true;
      }

      // Check if any point on brush circumference is inside contour
      const numSamples = 8; // Sample 8 points around brush edge
      for (let i = 0; i < numSamples; i++) {
        const angle = (i / numSamples) * 2 * Math.PI;
        const edgeX = worldX + brushRadius * Math.cos(angle);
        const edgeY = worldY + brushRadius * Math.sin(angle);

        if (pointInPolygon(edgeX, edgeY, contour.points)) {
          return true;
        }
      }
    }

    return false;
  };

  // Apply brush stroke to modify contours
  const applyBrushStroke = () => {
    if (!selectedStructure || !rtStructures || brushStrokes.length === 0) return;

    console.log('Applying brush stroke with', brushStrokes.length, 'points to structure', selectedStructure.roiNumber);

    // Create deep copy of RT structures for modification
    const updatedStructures = JSON.parse(JSON.stringify(rtStructures));
    const structure = updatedStructures.structures.find((s: any) => s.roiNumber === selectedStructure.roiNumber);

    if (structure) {
      const tolerance = 2.5;
      const firstStroke = brushStrokes[0];

      // Convert canvas coordinates to world coordinates
      const canvas = canvasRef.current;
      if (!canvas) return;

      const canvasCenterX = canvas.width / 2;
      const canvasCenterY = canvas.height / 2;
      const worldX = (firstStroke.x - canvasCenterX - panX) / zoom;
      const worldY = (firstStroke.y - canvasCenterY - panY) / zoom;
      const worldRadius = brushSize / zoom;

      // Find existing contour for this slice
      let targetContour = structure.contours?.find((contour: any) => 
        Math.abs(contour.slicePosition - currentSlicePosition) <= tolerance
      );

      if (firstStroke.isAdditive) {
        // ADD MODE: Create or expand contour
        if (!targetContour) {
          // Create new contour if none exists
          if (!structure.contours) structure.contours = [];

          targetContour = {
            points: [],
            slicePosition: currentSlicePosition,
            geometricType: 'CLOSED_PLANAR'
          };
          structure.contours.push(targetContour);
        }

        // Generate circular brush contour
        const numPoints = Math.max(16, Math.floor(worldRadius * 8));
        const newPoints: number[] = [];

        for (let i = 0; i < numPoints; i++) {
          const angle = (i / numPoints) * 2 * Math.PI;
          const x = worldX + worldRadius * Math.cos(angle);
          const y = worldY + worldRadius * Math.sin(angle);
          const z = currentSlicePosition;
          newPoints.push(x, y, z);
        }

        // For simplicity, replace existing contour with new circular one
        // In a more sophisticated implementation, you'd merge overlapping regions
        targetContour.points = newPoints;

        console.log('Added circular contour at slice', currentSlicePosition, 'with', numPoints, 'points');
      } else {
        // DELETE MODE: Remove or shrink contour
        if (targetContour && targetContour.points && targetContour.points.length > 0) {
          // Simple approach: clear the entire contour if brush intersects
          // In a more sophisticated implementation, you'd subtract the brush area
          targetContour.points = [];
          console.log('Removed contour at slice', currentSlicePosition);
        }
      }

      // Notify parent of structure update
      if (onContourUpdate) {
        onContourUpdate(updatedStructures);
      }
    }
  };

  // Convert screen coordinates to canvas coordinates
  const getCanvasCoordinates = (clientX: number, clientY: number) => {
    if (!canvasRef.current) return { x: 0, y: 0 };

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    return { x, y };
  };

  // Draw brush preview cursor
  const drawBrushCursor = (ctx: CanvasRenderingContext2D, x: number, y: number) => {
    if (!isActive) return;

    ctx.save();

    // Check if brush intersects with contour boundaries
    const intersectsContour = checkBrushContourIntersection(x, y);

    // Green when brush intersects contour (add mode), Red when not (delete mode)
    const strokeColor = intersectsContour ? '#00ff00' : '#ff0000';
    const fillColor = intersectsContour ? 'rgba(0, 255, 0, 0.2)' : 'rgba(255, 0, 0, 0.2)';

    // Draw brush circle
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = isDrawing ? 3 : 2;
    ctx.fillStyle = fillColor;

    if (isDrawing) {
      ctx.setLineDash([]);
    } else {
      ctx.setLineDash([5, 5]);
    }

    ctx.beginPath();
    ctx.arc(x, y, brushSize, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();

    // Add center dot for precision
    ctx.fillStyle = strokeColor;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(x, y, 2, 0, 2 * Math.PI);
    ctx.fill();

    ctx.restore();
  };

  // Create cursor overlay canvas
  useEffect(() => {
    if (!canvasRef.current || !isActive) return;

    const mainCanvas = canvasRef.current;
    const container = mainCanvas.parentElement;
    if (!container) return;

    // Create cursor overlay canvas
    const cursorCanvas = document.createElement('canvas');
    cursorCanvas.width = mainCanvas.width;
    cursorCanvas.height = mainCanvas.height;
    cursorCanvas.style.position = 'absolute';
    cursorCanvas.style.top = '0';
    cursorCanvas.style.left = '0';
    cursorCanvas.style.pointerEvents = 'none';
    cursorCanvas.style.zIndex = '10';
    cursorCanvasRef.current = cursorCanvas;

    container.appendChild(cursorCanvas);
    mainCanvas.style.cursor = 'none';

    return () => {
      if (cursorCanvasRef.current && container.contains(cursorCanvasRef.current)) {
        container.removeChild(cursorCanvasRef.current);
      }
      mainCanvas.style.cursor = 'default';
      cursorCanvasRef.current = null;
    };
  }, [isActive]);

  // Render cursor on overlay canvas
  useEffect(() => {
    if (!isActive || !mousePosition || !cursorCanvasRef.current) return;

    const cursorCanvas = cursorCanvasRef.current;
    const ctx = cursorCanvas.getContext('2d');
    if (!ctx) return;

    // Clear previous cursor
    ctx.clearRect(0, 0, cursorCanvas.width, cursorCanvas.height);

    // Draw new cursor at mouse position
    drawBrushCursor(ctx, mousePosition.x, mousePosition.y);
  }, [mousePosition, brushSize, isDrawing, zoom, isActive, selectedStructure, currentSlicePosition]);

  // Handle mouse events
  useEffect(() => {
    if (!isActive || !canvasRef.current) return;

    const canvas = canvasRef.current;

    const handleMouseDown = (e: MouseEvent) => {
      e.preventDefault();

      const coords = getCanvasCoordinates(e.clientX, e.clientY);

      if (e.button === 2) { // Right click for resizing
        setIsResizing(true);
        setResizeStartPosition(coords);
        return;
      }

      if (e.button === 0) { // Left click for drawing
        const intersectsContour = checkBrushContourIntersection(coords.x, coords.y);

        setIsDrawing(true);
        setBrushStrokes([{x: coords.x, y: coords.y, isAdditive: intersectsContour}]);

        console.log('Brush stroke started:', {
          position: coords,
          isAdditive: intersectsContour,
          brushSize,
          slicePosition: currentSlicePosition
        });
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      const coords = getCanvasCoordinates(e.clientX, e.clientY);
      setMousePosition(coords);

      if (isResizing && resizeStartPosition) {
        const deltaY = coords.y - resizeStartPosition.y;
        const newSize = Math.max(5, Math.min(100, brushSize - deltaY * 0.5));
        onBrushSizeChange(newSize);
        setMousePosition(resizeStartPosition);
        return;
      }

      if (isDrawing) {
        // Continue brush stroke with consistent mode
        const firstStroke = brushStrokes[0];
        setBrushStrokes(prev => [...prev, {
          x: coords.x,
          y: coords.y,
          isAdditive: firstStroke.isAdditive
        }]);
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (isDrawing) {
        console.log('Brush stroke completed, applying changes');
        applyBrushStroke();
        setIsDrawing(false);
        setBrushStrokes([]);
      }
      if (isResizing) {
        setIsResizing(false);
        setResizeStartPosition(null);
      }
    };

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    const handleMouseLeave = () => {
      setMousePosition(null);
      if (isDrawing) {
        console.log('Mouse left canvas, completing brush stroke');
        applyBrushStroke();
        setIsDrawing(false);
        setBrushStrokes([]);
      }
      if (isResizing) {
        setIsResizing(false);
        setResizeStartPosition(null);
      }
    };

    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('contextmenu', handleContextMenu);
    canvas.addEventListener('mouseleave', handleMouseLeave);

    return () => {
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseup', handleMouseUp);
      canvas.removeEventListener('contextmenu', handleContextMenu);
      canvas.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, [isActive, brushSize, isDrawing, isResizing, currentSlicePosition, selectedStructure, zoom, panX, panY, brushStrokes]);

  return null;
}