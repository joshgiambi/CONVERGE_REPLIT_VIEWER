
import { useEffect, useState, useRef } from 'react';

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
  const strokePoints = useRef<Point[]>([]);
  const cursorCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Fixed coordinate transformation
  const canvasToWorld = (canvasX: number, canvasY: number): Point | null => {
    if (!currentImage || !imageMetadata || !canvasRef.current) {
      return null;
    }

    const canvas = canvasRef.current;
    const imageWidth = currentImage.width || 512;
    const imageHeight = currentImage.height || 512;

    // Calculate image display parameters
    const baseScale = Math.min(canvas.width / imageWidth, canvas.height / imageHeight);
    const totalScale = baseScale * zoom;
    const scaledWidth = imageWidth * totalScale;
    const scaledHeight = imageHeight * totalScale;

    // Center the image on canvas
    const imageX = (canvas.width - scaledWidth) / 2 + panX;
    const imageY = (canvas.height - scaledHeight) / 2 + panY;

    // Convert canvas coordinates to image pixel coordinates
    const pixelX = (canvasX - imageX) / totalScale;
    const pixelY = (canvasY - imageY) / totalScale;

    // Bounds check
    if (pixelX < 0 || pixelX >= imageWidth || pixelY < 0 || pixelY >= imageHeight) {
      return null;
    }

    // Use simplified coordinate system - just return pixel coordinates scaled to world space
    // This avoids complex DICOM transformations that cause coordinate misalignment
    if (imageMetadata.pixelSpacing) {
      const pixelSpacing = imageMetadata.pixelSpacing.split('\\').map(Number);
      return {
        x: pixelX * pixelSpacing[0],
        y: pixelY * pixelSpacing[1]
      };
    }

    // Fallback to pixel coordinates
    return { x: pixelX, y: pixelY };
  };

  const [currentBrushSize, setCurrentBrushSize] = useState(brushSize);
  const currentStroke = useRef<Point[]>([]);
  const lastMousePos = useRef<Point | null>(null);

  // Create brush stroke with proper world coordinates
  const addBrushStroke = (canvasPoint: Point) => {
    const worldPoint = canvasToWorld(canvasPoint.x, canvasPoint.y);
    if (!worldPoint || !selectedStructure || !rtStructures) {
      return;
    }

    // Calculate appropriate brush radius in world coordinates
    const pixelSpacing = imageMetadata.pixelSpacing ? 
      imageMetadata.pixelSpacing.split('\\').map(Number) : [1, 1];
    
    // Scale brush size properly - make it much smaller
    const worldBrushRadius = (currentBrushSize / 4) * Math.min(pixelSpacing[0], pixelSpacing[1]);

    // Generate smaller, more precise brush points
    const numPoints = 8; // Fewer points for smaller brush
    const brushPoints: Point[] = [];
    
    for (let i = 0; i < numPoints; i++) {
      const angle = (i / numPoints) * 2 * Math.PI;
      const x = worldPoint.x + Math.cos(angle) * worldBrushRadius;
      const y = worldPoint.y + Math.sin(angle) * worldBrushRadius;
      brushPoints.push({ x, y });
    }

    // Add interpolated points for smooth strokes only when moving
    if (lastMousePos.current && isDrawing) {
      const lastWorldPoint = canvasToWorld(lastMousePos.current.x, lastMousePos.current.y);
      if (lastWorldPoint) {
        const dx = worldPoint.x - lastWorldPoint.x;
        const dy = worldPoint.y - lastWorldPoint.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        // Only interpolate if we moved a significant distance
        if (distance > worldBrushRadius * 0.3) {
          const steps = Math.max(1, Math.floor(distance / (worldBrushRadius * 0.8)));
          
          for (let step = 1; step <= steps; step++) {
            const t = step / steps;
            const interpX = lastWorldPoint.x + dx * t;
            const interpY = lastWorldPoint.y + dy * t;
            
            // Add just the center point for interpolation, not full circles
            currentStroke.current.push({ x: interpX, y: interpY });
          }
        }
      }
    }
    
    // Add current brush points
    currentStroke.current = currentStroke.current.concat(brushPoints);
    lastMousePos.current = canvasPoint;

    // Update RT structure immediately
    updateRTStructure();
  };

  // Fixed RT structure update
  const updateRTStructure = () => {
    if (!selectedStructure || !rtStructures || currentStroke.current.length === 0) {
      return;
    }

    const updatedRTStructures = JSON.parse(JSON.stringify(rtStructures));
    const structure = updatedRTStructures.structures.find((s: any) => s.roiNumber === selectedStructure);
    
    if (!structure) {
      return;
    }

    // Only add stroke points if we have a reasonable number (avoid huge blobs)
    if (currentStroke.current.length > 100) {
      console.warn('Stroke too large, skipping to prevent blob creation');
      return;
    }

    // Convert current stroke to DICOM contour format
    const contourPoints: number[] = [];
    currentStroke.current.forEach(point => {
      contourPoints.push(point.x, point.y, currentSlicePosition);
    });

    // Find existing contour for current slice
    const tolerance = 1.0;
    let existingContour = structure.contours.find((contour: any) => 
      Math.abs(contour.slicePosition - currentSlicePosition) <= tolerance
    );

    if (existingContour && existingContour.points.length > 0) {
      // Merge with existing contour instead of replacing
      const existingPoints = [];
      for (let i = 0; i < existingContour.points.length; i += 3) {
        existingPoints.push({
          x: existingContour.points[i],
          y: existingContour.points[i + 1],
          z: existingContour.points[i + 2]
        });
      }
      
      // Add new stroke points to existing contour
      const mergedPoints: number[] = [];
      
      // Add existing points
      existingContour.points.forEach((point: number) => {
        mergedPoints.push(point);
      });
      
      // Add new stroke points
      contourPoints.forEach((point: number) => {
        mergedPoints.push(point);
      });
      
      existingContour.points = mergedPoints;
      existingContour.numberOfPoints = mergedPoints.length / 3;
    } else {
      // Create new contour only if it's reasonably sized
      structure.contours.push({
        slicePosition: currentSlicePosition,
        points: contourPoints,
        numberOfPoints: contourPoints.length / 3
      });
    }

    onContourUpdate(updatedRTStructures);
  };

  // Mouse event handlers
  const handleMouseDown = (e: MouseEvent) => {
    if (!isActive || !selectedStructure || e.button !== 0) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    const rect = canvasRef.current!.getBoundingClientRect();
    const canvasPoint = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
    
    setIsDrawing(true);
    currentStroke.current = [];
    lastMousePos.current = null;
    
    addBrushStroke(canvasPoint);
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isActive || !canvasRef.current) return;
    
    const rect = canvasRef.current.getBoundingClientRect();
    const canvasPoint = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
    
    setMousePosition(canvasPoint);
    
    if (isDrawing && selectedStructure) {
      addBrushStroke(canvasPoint);
    }
  };

  const handleMouseUp = (e: MouseEvent) => {
    if (!isActive || e.button !== 0) return;
    
    setIsDrawing(false);
    lastMousePos.current = null;
    currentStroke.current = [];
  };

  // Set up event listeners
  useEffect(() => {
    if (!isActive || !canvasRef.current) return;

    const canvas = canvasRef.current;
    
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('mouseleave', handleMouseUp);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    
    canvas.style.cursor = 'none';
    
    return () => {
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseup', handleMouseUp);
      canvas.removeEventListener('mouseleave', handleMouseUp);
      canvas.removeEventListener('contextmenu', (e) => e.preventDefault());
      canvas.style.cursor = 'default';
    };
  }, [isActive, selectedStructure, currentBrushSize, isDrawing, currentSlicePosition]);

  // Create and manage cursor overlay
  useEffect(() => {
    if (!isActive || !canvasRef.current) {
      if (cursorCanvasRef.current) {
        cursorCanvasRef.current.remove();
        cursorCanvasRef.current = null;
      }
      return;
    }

    const mainCanvas = canvasRef.current;
    
    if (!cursorCanvasRef.current) {
      const cursorCanvas = document.createElement('canvas');
      cursorCanvas.style.position = 'absolute';
      cursorCanvas.style.top = '0';
      cursorCanvas.style.left = '0';
      cursorCanvas.style.pointerEvents = 'none';
      cursorCanvas.style.zIndex = '999';
      mainCanvas.parentElement?.appendChild(cursorCanvas);
      cursorCanvasRef.current = cursorCanvas;
    }

    const cursorCanvas = cursorCanvasRef.current;
    const rect = mainCanvas.getBoundingClientRect();
    const parentRect = mainCanvas.parentElement!.getBoundingClientRect();

    cursorCanvas.width = mainCanvas.width;
    cursorCanvas.height = mainCanvas.height;
    cursorCanvas.style.width = `${rect.width}px`;
    cursorCanvas.style.height = `${rect.height}px`;
    cursorCanvas.style.left = `${rect.left - parentRect.left}px`;
    cursorCanvas.style.top = `${rect.top - parentRect.top}px`;

    return () => {
      if (cursorCanvasRef.current) {
        cursorCanvasRef.current.remove();
        cursorCanvasRef.current = null;
      }
    };
  }, [isActive]);

  // Draw cursor
  useEffect(() => {
    if (!cursorCanvasRef.current || !mousePosition || !isActive) return;

    const ctx = cursorCanvasRef.current.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, cursorCanvasRef.current.width, cursorCanvasRef.current.height);

    // Draw brush cursor circle
    const radius = currentBrushSize / 2;
    
    ctx.strokeStyle = isDrawing ? '#00ff00' : '#ffffff';
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.8;
    
    ctx.beginPath();
    ctx.arc(mousePosition.x, mousePosition.y, radius, 0, 2 * Math.PI);
    ctx.stroke();

    // Draw center dot
    ctx.fillStyle = ctx.strokeStyle;
    ctx.beginPath();
    ctx.arc(mousePosition.x, mousePosition.y, 2, 0, 2 * Math.PI);
    ctx.fill();
  }, [mousePosition, currentBrushSize, isDrawing, isActive]);

  // Update brush size
  useEffect(() => {
    setCurrentBrushSize(brushSize);
  }, [brushSize]);

  return null;
}
