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

  // Apply brush stroke to modify contours
  const applyBrushStroke = () => {
    if (!selectedStructure || !rtStructures || brushStrokes.length === 0) return;

    console.log('Applying brush stroke with', brushStrokes.length, 'points to structure', selectedStructure.roiNumber);
    
    // Create deep copy of RT structures for modification
    const updatedStructures = JSON.parse(JSON.stringify(rtStructures));
    const structure = updatedStructures.structures.find((s: any) => s.roiNumber === selectedStructure.roiNumber);
    
    if (structure && structure.contours) {
      const tolerance = 2.5; // Slice tolerance
      let currentSliceContours = structure.contours.filter((contour: any) => 
        Math.abs(contour.slicePosition - currentSlicePosition) <= tolerance
      );
      
      // Convert brush strokes to world coordinates for proper DICOM storage
      const worldStrokes = brushStrokes.map(stroke => {
        // Convert canvas coordinates back to DICOM world coordinates
        const worldX = (stroke.x - (canvasRef.current?.width || 512) / 2) / zoom + currentSlicePosition;
        const worldY = (stroke.y - (canvasRef.current?.height || 512) / 2) / zoom + currentSlicePosition;
        return {
          worldX,
          worldY,
          z: currentSlicePosition,
          isAdditive: stroke.isAdditive
        };
      });
      
      if (currentSliceContours.length > 0) {
        // Modify existing contours
        currentSliceContours.forEach((contour: any) => {
          worldStrokes.forEach(stroke => {
            if (stroke.isAdditive) {
              // Add points to expand contour
              const newPoints = [stroke.worldX, stroke.worldY, stroke.z];
              contour.points.push(...newPoints);
              console.log('Added point to existing contour:', newPoints);
            } else {
              // Remove nearby points to shrink contour
              const removeRadius = brushSize * 2;
              contour.points = contour.points.filter((_: any, index: number) => {
                if (index % 3 === 0) { // X coordinate
                  const x = contour.points[index];
                  const y = contour.points[index + 1];
                  const distance = Math.sqrt(Math.pow(x - stroke.worldX, 2) + Math.pow(y - stroke.worldY, 2));
                  return distance > removeRadius;
                }
                return true;
              });
              console.log('Removed points near:', stroke.worldX, stroke.worldY);
            }
          });
        });
      } else {
        // Create new contour for this slice from additive strokes
        const additiveStrokes = worldStrokes.filter(s => s.isAdditive);
        if (additiveStrokes.length > 0) {
          // Create circular contour from brush strokes
          const centerX = additiveStrokes.reduce((sum, s) => sum + s.worldX, 0) / additiveStrokes.length;
          const centerY = additiveStrokes.reduce((sum, s) => sum + s.worldY, 0) / additiveStrokes.length;
          const radius = brushSize;
          
          // Generate circular contour points
          const points: number[] = [];
          const numPoints = 16; // Number of points in circle
          for (let i = 0; i < numPoints; i++) {
            const angle = (i / numPoints) * 2 * Math.PI;
            const x = centerX + radius * Math.cos(angle);
            const y = centerY + radius * Math.sin(angle);
            points.push(x, y, currentSlicePosition);
          }
          
          const newContour = {
            slicePosition: currentSlicePosition,
            points: points
          };
          
          structure.contours.push(newContour);
          console.log('Created new circular contour with', numPoints, 'points at slice', currentSlicePosition);
        }
      }
      
      // Notify parent of structure update with modified data
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

  // Draw brush preview cursor with consistent visibility
  const drawBrushCursor = (ctx: CanvasRenderingContext2D, x: number, y: number) => {
    if (!isActive) return;

    ctx.save();
    
    // Choose color based on inside/outside contour - green for add, red for subtract
    const strokeColor = isInsideContour ? 
      `rgba(0, 255, 0, 0.8)` : 
      `rgba(255, 0, 0, 0.8)`;
    
    // Set up stroke style - dashed when inactive, solid when drawing
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 2;
    
    if (isDrawing) {
      // Solid line when actively drawing
      ctx.setLineDash([]);
    } else {
      // Dashed line when inactive
      ctx.setLineDash([5, 5]);
    }
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = isDrawing ? 3 : 2;
    
    // Draw main brush circle (outline only, no fill)
    ctx.beginPath();
    ctx.arc(x, y, brushSize * zoom, 0, 2 * Math.PI);
    ctx.stroke();
    
    // Add center dot for precision
    ctx.fillStyle = strokeColor;
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
    
    // Insert cursor canvas after main canvas
    container.appendChild(cursorCanvas);
    
    // Hide default cursor on main canvas
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
  }, [mousePosition, brushSize, isInsideContour, isDrawing, zoom, isActive]);

  // Handle mouse events
  useEffect(() => {
    if (!isActive || !canvasRef.current) return;

    const canvas = canvasRef.current;

    const handleMouseDown = (e: MouseEvent) => {
      e.preventDefault();
      
      const coords = getCanvasCoordinates(e.clientX, e.clientY);
      
      if (e.button === 2) { // Right click for resizing
        setIsResizing(true);
        setResizeStartPosition(coords); // Store initial position for fixed centroid
        return;
      }

      if (e.button === 0) { // Left click for drawing
        const inside = checkInsideContour(coords.x, coords.y);
        setIsInsideContour(inside);
        setIsDrawing(true);
        setBrushStrokes([{x: coords.x, y: coords.y, isAdditive: !inside}]);
        
        console.log('Brush stroke started:', {
          position: coords,
          isAdditive: !inside,
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

      if (isResizing && resizeStartPosition) {
        // Right-click drag to resize brush - keep centroid fixed
        const deltaY = coords.y - resizeStartPosition.y;
        const newSize = Math.max(1, Math.min(50, brushSize - deltaY * 0.1));
        onBrushSizeChange(newSize);
        // Keep cursor position at the original resize start position for fixed centroid
        setMousePosition(resizeStartPosition);
        return; // Don't update mouse position during resize
      }

      if (isDrawing) {
        // Add brush stroke point for real contour modification
        setBrushStrokes(prev => [...prev, {
          x: coords.x,
          y: coords.y,
          isAdditive: isInsideContour
        }]);
        
        console.log('Brush stroke continue:', {
          position: coords,
          isAdditive: isInsideContour
        });
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