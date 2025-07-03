import React, { useRef, useEffect, useState } from 'react';

interface SimpleBrushToolProps {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  isActive: boolean;
  brushSize: number;
  selectedStructure: number | null;
  rtStructures: any;
  currentSlicePosition: number;
  onContourUpdate: (updatedStructures: any) => void;
  zoom: number;
  panX: number;
  panY: number;
  imageMetadata: any;
  smoothingEnabled: boolean;
  enableSmartMode: boolean;
  onBrushModeChange: (mode: any) => void;
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
  panY
}: SimpleBrushToolProps) {
  const [isDrawing, setIsDrawing] = useState(false);
  const [cursorPosition, setCursorPosition] = useState<{ x: number; y: number } | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const brushPoints = useRef<Array<{ x: number; y: number }>>([]);
  
  // Create overlay canvas for cursor and brush strokes
  useEffect(() => {
    if (!canvasRef.current || !isActive) return;
    
    const mainCanvas = canvasRef.current;
    
    // Create overlay canvas
    let overlayCanvas = overlayCanvasRef.current;
    if (!overlayCanvas) {
      overlayCanvas = document.createElement('canvas');
      overlayCanvas.style.position = 'absolute';
      overlayCanvas.style.top = '0';
      overlayCanvas.style.left = '0';
      overlayCanvas.style.pointerEvents = 'none';
      overlayCanvas.style.zIndex = '10';
      overlayCanvas.width = mainCanvas.width;
      overlayCanvas.height = mainCanvas.height;
      
      // Match canvas styling
      const computedStyle = window.getComputedStyle(mainCanvas);
      overlayCanvas.style.width = computedStyle.width;
      overlayCanvas.style.height = computedStyle.height;
      overlayCanvas.style.imageRendering = 'auto';
      
      mainCanvas.parentElement?.appendChild(overlayCanvas);
      overlayCanvasRef.current = overlayCanvas;
    }
    
    return () => {
      if (overlayCanvas && overlayCanvas.parentElement) {
        overlayCanvas.parentElement.removeChild(overlayCanvas);
        overlayCanvasRef.current = null;
      }
    };
  }, [isActive, canvasRef]);
  
  // Get structure color
  const getStructureColor = () => {
    if (!selectedStructure || !rtStructures?.structures) return '#00ff00';
    const structure = rtStructures.structures.find((s: any) => s.roiNumber === selectedStructure);
    if (!structure?.color) return '#00ff00';
    return `rgb(${structure.color.join(',')})`;
  };
  
  // Draw cursor and brush strokes
  useEffect(() => {
    if (!overlayCanvasRef.current || !isActive) return;
    
    const ctx = overlayCanvasRef.current.getContext('2d');
    if (!ctx) return;
    
    // Clear canvas
    ctx.clearRect(0, 0, overlayCanvasRef.current.width, overlayCanvasRef.current.height);
    
    const structureColor = getStructureColor();
    
    // Draw brush cursor
    if (cursorPosition) {
      ctx.beginPath();
      ctx.arc(cursorPosition.x, cursorPosition.y, brushSize, 0, 2 * Math.PI);
      ctx.strokeStyle = structureColor;
      ctx.lineWidth = 2;
      ctx.stroke();
      
      // Draw center dot
      ctx.beginPath();
      ctx.arc(cursorPosition.x, cursorPosition.y, 2, 0, 2 * Math.PI);
      ctx.fillStyle = structureColor;
      ctx.fill();
    }
    
    // Draw current brush stroke
    if (brushPoints.current.length > 0) {
      ctx.strokeStyle = structureColor;
      ctx.lineWidth = brushSize * 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalAlpha = 0.7;
      
      ctx.beginPath();
      brushPoints.current.forEach((point, index) => {
        if (index === 0) {
          ctx.moveTo(point.x, point.y);
        } else {
          ctx.lineTo(point.x, point.y);
        }
      });
      ctx.stroke();
      ctx.globalAlpha = 1.0;
    }
  }, [cursorPosition, brushSize, isActive, brushPoints.current.length]);
  
  // Handle mouse events
  useEffect(() => {
    if (!canvasRef.current || !isActive) return;
    
    const canvas = canvasRef.current;
    
    const getCanvasCoords = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
      const y = ((e.clientY - rect.top) / rect.height) * canvas.height;
      return { x, y };
    };
    
    const handleMouseMove = (e: MouseEvent) => {
      const coords = getCanvasCoords(e);
      setCursorPosition(coords);
      
      if (isDrawing) {
        brushPoints.current.push(coords);
        addBrushPoint(coords.x, coords.y);
      }
    };
    
    const handleMouseDown = (e: MouseEvent) => {
      if (e.button === 0) { // Left click
        e.preventDefault();
        setIsDrawing(true);
        const coords = getCanvasCoords(e);
        brushPoints.current = [coords];
        addBrushPoint(coords.x, coords.y);
      }
    };
    
    const handleMouseUp = () => {
      if (isDrawing) {
        finalizeBrushStroke();
      }
      setIsDrawing(false);
    };
    
    const handleMouseLeave = () => {
      setCursorPosition(null);
      if (isDrawing) {
        finalizeBrushStroke();
      }
      setIsDrawing(false);
    };
    
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('mouseleave', handleMouseLeave);
    
    return () => {
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('mouseup', handleMouseUp);
      canvas.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, [isActive, isDrawing, brushSize]);
  
  const addBrushPoint = (x: number, y: number) => {
    if (!selectedStructure || !rtStructures?.structures) return;
    
    // Convert canvas coordinates to world coordinates (DICOM coordinate system)
    // Canvas center is at (512, 512), world center is at (-300, -300)
    const worldX = ((x - 512) * 1.171875) - 300;
    const worldY = (-(y - 512) * 1.171875) - 300; // Flip Y axis
    const worldZ = currentSlicePosition;
    
    console.log(`Brush point: Canvas(${x.toFixed(1)}, ${y.toFixed(1)}) -> World(${worldX.toFixed(1)}, ${worldY.toFixed(1)}, ${worldZ})`);
  };
  
  const finalizeBrushStroke = () => {
    if (!selectedStructure || !rtStructures?.structures || brushPoints.current.length === 0) return;
    
    // Convert all brush points to world coordinates
    const worldPoints = brushPoints.current.map(point => {
      const worldX = ((point.x - 512) * 1.171875) - 300;
      const worldY = (-(point.y - 512) * 1.171875) - 300;
      const worldZ = currentSlicePosition;
      return [worldX, worldY, worldZ];
    });
    
    // Find the structure to update
    const structure = rtStructures.structures.find((s: any) => s.roiNumber === selectedStructure);
    if (!structure) return;
    
    // Ensure contours array exists
    if (!structure.contours) {
      structure.contours = [];
    }
    
    // Find existing contour for current slice
    let sliceContour = structure.contours.find((c: any) => Math.abs(c.slice - currentSlicePosition) < 0.1);
    
    if (!sliceContour) {
      // Create new contour for this slice
      sliceContour = {
        slice: currentSlicePosition,
        points: []
      };
      structure.contours.push(sliceContour);
    }
    
    // Add all brush points to the contour
    sliceContour.points.push(...worldPoints);
    
    // Notify parent component
    onContourUpdate({
      action: 'brush_stroke',
      structureId: selectedStructure,
      slicePosition: currentSlicePosition,
      points: worldPoints,
      updatedStructures: rtStructures
    });
    
    console.log(`Added ${worldPoints.length} brush points to ${structure.name} at slice ${currentSlicePosition}mm`);
    
    // Clear brush points
    brushPoints.current = [];
  };
  
  return null; // This component only handles interactions, no visual rendering
}