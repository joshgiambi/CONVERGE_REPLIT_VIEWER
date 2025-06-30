import { useEffect, useRef, useState } from 'react';

interface BrushToolProps {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  isActive: boolean;
  brushSize: number;
  onBrushSizeChange: (size: number) => void;
  rtStructures: any;
  selectedStructure: any;
  currentSlicePosition: number;
  imageWidth: number;
  imageHeight: number;
  zoom: number;
  panX: number;
  panY: number;
}

interface BrushStroke {
  points: { x: number; y: number }[];
  isAdditive: boolean;
  structureId: number;
  slicePosition: number;
}

export function BrushTool({
  canvasRef,
  isActive,
  brushSize,
  onBrushSizeChange,
  rtStructures,
  selectedStructure,
  currentSlicePosition,
  imageWidth,
  imageHeight,
  zoom,
  panX,
  panY
}: BrushToolProps) {
  const [isDrawing, setIsDrawing] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [lastPoint, setLastPoint] = useState<{ x: number; y: number } | null>(null);
  const [currentStroke, setCurrentStroke] = useState<BrushStroke | null>(null);
  const [brushStrokes, setBrushStrokes] = useState<BrushStroke[]>([]);
  const [cursorPosition, setCursorPosition] = useState<{ x: number; y: number } | null>(null);
  const [isInsideContour, setIsInsideContour] = useState(false);
  const [overlayCanvas, setOverlayCanvas] = useState<HTMLCanvasElement | null>(null);

  // Create overlay canvas for brush preview
  useEffect(() => {
    if (!canvasRef.current || !isActive) return;

    const canvas = canvasRef.current;
    let overlay = overlayCanvas;

    if (!overlay) {
      overlay = document.createElement('canvas');
      overlay.style.position = 'absolute';
      overlay.style.top = '0';
      overlay.style.left = '0';
      overlay.style.pointerEvents = 'none';
      overlay.style.zIndex = '10';
      canvas.parentElement?.appendChild(overlay);
      setOverlayCanvas(overlay);
    }

    overlay.width = canvas.width;
    overlay.height = canvas.height;
    overlay.style.width = canvas.style.width;
    overlay.style.height = canvas.style.height;

    return () => {
      if (overlay && overlay.parentElement) {
        overlay.parentElement.removeChild(overlay);
        setOverlayCanvas(null);
      }
    };
  }, [canvasRef, isActive]);

  // Convert screen coordinates to world coordinates
  const screenToWorld = (screenX: number, screenY: number) => {
    if (!canvasRef.current) return { x: 0, y: 0 };
    
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    
    // Convert to canvas coordinates
    const canvasX = screenX - rect.left;
    const canvasY = screenY - rect.top;
    
    // Apply inverse transformations
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    
    // Undo pan and zoom transformations
    const worldX = (canvasX - centerX - panX) / zoom + centerX;
    const worldY = (canvasY - centerY - panY) / zoom + centerY;
    
    return { x: worldX, y: worldY };
  };

  // Check if point is inside any contour of the selected structure
  const isPointInsideContour = (x: number, y: number): boolean => {
    if (!selectedStructure || !rtStructures?.structures) return false;

    const structure = rtStructures.structures.find((s: any) => s.roiNumber === selectedStructure.roiNumber);
    if (!structure) return false;

    const tolerance = 2.0;
    for (const contour of structure.contours) {
      if (Math.abs(contour.slicePosition - currentSlicePosition) <= tolerance) {
        // Use point-in-polygon algorithm
        if (pointInPolygon(x, y, contour.points)) {
          return true;
        }
      }
    }
    return false;
  };

  // Point-in-polygon algorithm (ray casting)
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

  // Draw brush preview
  const drawBrushPreview = () => {
    if (!overlayCanvas || !cursorPosition || !isActive) return;

    const ctx = overlayCanvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

    // Apply same transformations as main canvas
    ctx.save();
    ctx.translate(overlayCanvas.width / 2, overlayCanvas.height / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(-overlayCanvas.width / 2 + panX, -overlayCanvas.height / 2 + panY);

    // Draw brush circle
    const color = isInsideContour ? 'rgba(0, 255, 0, 0.5)' : 'rgba(255, 0, 0, 0.5)';
    ctx.strokeStyle = isInsideContour ? 'rgb(0, 255, 0)' : 'rgb(255, 0, 0)';
    ctx.fillStyle = color;
    ctx.lineWidth = 2 / zoom;

    ctx.beginPath();
    ctx.arc(cursorPosition.x, cursorPosition.y, brushSize, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();

    ctx.restore();
  };

  // Handle mouse events
  const handleMouseDown = (e: MouseEvent) => {
    if (!isActive || !canvasRef.current || !selectedStructure) return;

    e.preventDefault();
    
    if (e.button === 2) { // Right click
      setIsResizing(true);
      setLastPoint({ x: e.clientX, y: e.clientY });
      return;
    }

    if (e.button === 0) { // Left click
      const worldPos = screenToWorld(e.clientX, e.clientY);
      const insideContour = isPointInsideContour(worldPos.x, worldPos.y);
      
      setIsDrawing(true);
      setIsInsideContour(insideContour);
      setLastPoint(worldPos);
      
      const newStroke: BrushStroke = {
        points: [worldPos],
        isAdditive: insideContour,
        structureId: selectedStructure.roiNumber,
        slicePosition: currentSlicePosition
      };
      setCurrentStroke(newStroke);
    }
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isActive || !canvasRef.current) return;

    const worldPos = screenToWorld(e.clientX, e.clientY);
    setCursorPosition(worldPos);

    if (!isDrawing && !isResizing) {
      const insideContour = isPointInsideContour(worldPos.x, worldPos.y);
      setIsInsideContour(insideContour);
      return;
    }

    if (isResizing && lastPoint) {
      const deltaY = lastPoint.y - e.clientY;
      const newSize = Math.max(1, Math.min(50, brushSize + deltaY * 0.5));
      onBrushSizeChange(newSize);
      setLastPoint({ x: e.clientX, y: e.clientY });
      return;
    }

    if (isDrawing && currentStroke && lastPoint) {
      const distance = Math.sqrt(
        Math.pow(worldPos.x - lastPoint.x, 2) + Math.pow(worldPos.y - lastPoint.y, 2)
      );
      
      if (distance > 2) { // Minimum distance before adding point
        const updatedStroke = {
          ...currentStroke,
          points: [...currentStroke.points, worldPos]
        };
        setCurrentStroke(updatedStroke);
        setLastPoint(worldPos);
      }
    }
  };

  const handleMouseUp = (e: MouseEvent) => {
    if (!isActive) return;

    if (isResizing) {
      setIsResizing(false);
      setLastPoint(null);
      return;
    }

    if (isDrawing && currentStroke) {
      setBrushStrokes(prev => [...prev, currentStroke]);
      setCurrentStroke(null);
      setIsDrawing(false);
      setLastPoint(null);
      
      // Apply brush stroke to RT structure
      applyBrushStroke(currentStroke);
    }
  };

  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault();
  };

  // Apply brush stroke to RT structure data
  const applyBrushStroke = (stroke: BrushStroke) => {
    console.log('Applying brush stroke:', {
      points: stroke.points.length,
      isAdditive: stroke.isAdditive,
      structureId: stroke.structureId,
      slicePosition: stroke.slicePosition
    });
    
    // Here you would integrate with your RT structure modification system
    // For now, we'll just log the stroke data
  };

  // Set up event listeners
  useEffect(() => {
    if (!isActive || !canvasRef.current) return;

    const canvas = canvasRef.current;
    
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('contextmenu', handleContextMenu);
    
    return () => {
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseup', handleMouseUp);
      canvas.removeEventListener('contextmenu', handleContextMenu);
    };
  }, [isActive, brushSize, selectedStructure, currentSlicePosition, zoom, panX, panY, isDrawing, isResizing]);

  // Update brush preview when cursor moves
  useEffect(() => {
    drawBrushPreview();
  }, [cursorPosition, isInsideContour, brushSize, zoom, panX, panY]);

  return null;
}