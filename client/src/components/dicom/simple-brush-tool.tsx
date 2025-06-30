import { useEffect, useState } from 'react';

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
  panY
}: SimpleBrushToolProps) {
  const [isDrawing, setIsDrawing] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [mousePosition, setMousePosition] = useState<{ x: number; y: number } | null>(null);
  const [isInsideContour, setIsInsideContour] = useState(false);

  // Convert screen coordinates to canvas coordinates
  const getCanvasCoordinates = (clientX: number, clientY: number) => {
    if (!canvasRef.current) return { x: 0, y: 0 };
    
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    
    return { x, y };
  };

  // Check if point is inside any contour (simplified)
  const checkInsideContour = (x: number, y: number): boolean => {
    if (!selectedStructure || !rtStructures?.structures) return false;
    
    const structure = rtStructures.structures.find((s: any) => s.roiNumber === selectedStructure.roiNumber);
    if (!structure || !structure.contours) return false;

    // For now, return true if we have contours on this slice (simplified logic)
    const tolerance = 2.0;
    const hasContours = structure.contours.some((contour: any) => 
      Math.abs(contour.slicePosition - currentSlicePosition) <= tolerance
    );
    
    // Simple geometric check - if cursor is in central area, assume inside
    if (hasContours && canvasRef.current) {
      const canvas = canvasRef.current;
      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;
      const distance = Math.sqrt(Math.pow(x - centerX, 2) + Math.pow(y - centerY, 2));
      return distance < 150; // Simplified inside detection
    }
    
    return false;
  };

  // Draw brush preview cursor
  const drawBrushCursor = (ctx: CanvasRenderingContext2D, x: number, y: number) => {
    if (!isActive || !mousePosition) return;

    ctx.save();
    
    // Draw brush circle
    const color = isInsideContour ? 'rgba(0, 255, 0, 0.3)' : 'rgba(255, 0, 0, 0.3)';
    const strokeColor = isInsideContour ? 'rgb(0, 255, 0)' : 'rgb(255, 0, 0)';
    
    ctx.fillStyle = color;
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 2;
    
    ctx.beginPath();
    ctx.arc(x, y, brushSize * zoom, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
    
    ctx.restore();
  };

  // Handle mouse events
  useEffect(() => {
    if (!isActive || !canvasRef.current) return;

    const canvas = canvasRef.current;

    const handleMouseDown = (e: MouseEvent) => {
      e.preventDefault();
      
      if (e.button === 2) { // Right click for resizing
        setIsResizing(true);
        return;
      }

      if (e.button === 0) { // Left click for drawing
        const coords = getCanvasCoordinates(e.clientX, e.clientY);
        const inside = checkInsideContour(coords.x, coords.y);
        setIsInsideContour(inside);
        setIsDrawing(true);
        
        console.log('Brush stroke started:', {
          position: coords,
          isAdditive: inside,
          brushSize,
          slicePosition: currentSlicePosition
        });
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      const coords = getCanvasCoordinates(e.clientX, e.clientY);
      setMousePosition(coords);
      
      if (!isDrawing && !isResizing) {
        const inside = checkInsideContour(coords.x, coords.y);
        setIsInsideContour(inside);
      }

      if (isResizing) {
        // Right-click drag to resize brush
        const deltaY = e.movementY;
        const newSize = Math.max(1, Math.min(50, brushSize - deltaY * 0.5));
        onBrushSizeChange(newSize);
      }

      if (isDrawing) {
        console.log('Brush stroke continue:', {
          position: coords,
          isAdditive: isInsideContour
        });
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (isDrawing) {
        console.log('Brush stroke completed');
        setIsDrawing(false);
      }
      if (isResizing) {
        setIsResizing(false);
      }
    };

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    const handleMouseLeave = () => {
      setMousePosition(null);
      setIsDrawing(false);
      setIsResizing(false);
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
  }, [isActive, brushSize, isDrawing, isResizing, currentSlicePosition, selectedStructure, zoom]);

  // Draw cursor overlay
  useEffect(() => {
    if (!isActive || !canvasRef.current || !mousePosition) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // We'll draw the cursor on the next animation frame to avoid conflicts
    const drawCursor = () => {
      // Clear previous cursor (we'd need a separate overlay canvas for proper implementation)
      // For now, just draw on the main canvas
      drawBrushCursor(ctx, mousePosition.x, mousePosition.y);
    };

    const rafId = requestAnimationFrame(drawCursor);
    return () => cancelAnimationFrame(rafId);
  }, [mousePosition, isInsideContour, brushSize, isActive, zoom]);

  return null;
}