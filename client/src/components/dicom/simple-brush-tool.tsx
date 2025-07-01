

import { useEffect, useState, useRef, useCallback } from 'react';

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
  const cursorCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Convert canvas coordinates to world coordinates
  const canvasToWorld = useCallback((canvasX: number, canvasY: number): Point | null => {
    if (!currentImage || !imageMetadata || !canvasRef.current) return null;

    try {
      const canvas = canvasRef.current;
      const imageWidth = currentImage.width || 512;
      const imageHeight = currentImage.height || 512;

      const baseScale = Math.min(canvas.width / imageWidth, canvas.height / imageHeight);
      const totalScale = baseScale * zoom;
      const scaledWidth = imageWidth * totalScale;
      const scaledHeight = imageHeight * totalScale;

      const imageX = (canvas.width - scaledWidth) / 2 + panX;
      const imageY = (canvas.height - scaledHeight) / 2 + panY;

      const pixelX = (canvasX - imageX) / totalScale;
      const pixelY = (canvasY - imageY) / totalScale;

      // DICOM coordinate transformation
      if (imageMetadata.imagePosition && imageMetadata.pixelSpacing && imageMetadata.imageOrientation) {
        const imagePosition = imageMetadata.imagePosition.split('\\').map(Number);
        const pixelSpacing = imageMetadata.pixelSpacing.split('\\').map(Number);
        const imageOrientation = imageMetadata.imageOrientation.split('\\').map(Number);

        const rowCosines = imageOrientation.slice(0, 3);
        const colCosines = imageOrientation.slice(3, 6);
        
        const worldX = imagePosition[0] + 
                       (pixelX * rowCosines[0] * pixelSpacing[0]) + 
                       (pixelY * colCosines[0] * pixelSpacing[1]);
        
        const worldY = imagePosition[1] + 
                       (pixelX * rowCosines[1] * pixelSpacing[0]) + 
                       (pixelY * colCosines[1] * pixelSpacing[1]);

        return { x: worldX, y: worldY };
      }

      // Fallback coordinate transformation
      if (imageMetadata.imagePosition && imageMetadata.pixelSpacing) {
        const imagePosition = imageMetadata.imagePosition.split('\\').map(Number);
        const pixelSpacing = imageMetadata.pixelSpacing.split('\\').map(Number);

        const worldX = imagePosition[0] + (pixelX * pixelSpacing[0]);
        const worldY = imagePosition[1] + (pixelY * pixelSpacing[1]);

        return { x: worldX, y: worldY };
      }

      return null;
    } catch (error) {
      console.error('Error in coordinate transformation:', error);
      return null;
    }
  }, [currentImage, imageMetadata, zoom, panX, panY]);

  // Create a circle of points for brush painting
  const createBrushCircle = useCallback((center: Point, radius: number): Point[] => {
    const points: Point[] = [];
    const numPoints = Math.max(16, Math.floor(radius / 2)); // More points for larger brushes
    
    for (let i = 0; i < numPoints; i++) {
      const angle = (i / numPoints) * Math.PI * 2;
      points.push({
        x: center.x + Math.cos(angle) * radius,
        y: center.y + Math.sin(angle) * radius
      });
    }
    
    // Close the circle
    if (points.length > 0) {
      points.push(points[0]);
    }
    
    return points;
  }, []);

  // Add brush stroke that creates filled circles
  const addBrushStroke = useCallback((canvasPoint: Point) => {
    const worldPoint = canvasToWorld(canvasPoint.x, canvasPoint.y);
    if (!worldPoint || !selectedStructure || !rtStructures) return;

    try {
      // Convert brush size from pixels to world coordinates
      const worldBrushRadius = brushSize / 20; // Adjust scaling factor as needed
      
      // Create circle points in world coordinates
      const circlePoints = createBrushCircle(worldPoint, worldBrushRadius);
      
      // Convert to DICOM contour format [x,y,z,x,y,z,...]
      const newContourPoints: number[] = [];
      for (const point of circlePoints) {
        newContourPoints.push(point.x, point.y, currentSlicePosition);
      }

      // Update RT structures
      const updatedRTStructures = JSON.parse(JSON.stringify(rtStructures));
      
      let structure;
      if (updatedRTStructures.structures) {
        structure = updatedRTStructures.structures.find((s: any) => s.roiNumber === selectedStructure);
      } else if (updatedRTStructures.roiContourSequence) {
        structure = updatedRTStructures.roiContourSequence.find((s: any) => s.roiNumber === selectedStructure);
      } else {
        structure = updatedRTStructures.find((s: any) => s.roiNumber === selectedStructure);
      }
      
      if (!structure) return;

      // Initialize contours array if it doesn't exist
      if (!structure.contours) {
        structure.contours = [];
      }

      // Find existing contour for this slice
      const tolerance = 2.0;
      let existingContour = structure.contours.find((contour: any) => 
        Math.abs(contour.slicePosition - currentSlicePosition) <= tolerance
      );

      if (existingContour) {
        // ADD to existing contour by creating a new separate contour
        // This simulates brush painting by adding filled circles
        structure.contours.push({
          slicePosition: currentSlicePosition,
          points: newContourPoints,
          numberOfPoints: newContourPoints.length / 3
        });
      } else {
        // Create new contour for this slice
        structure.contours.push({
          slicePosition: currentSlicePosition,
          points: newContourPoints,
          numberOfPoints: newContourPoints.length / 3
        });
      }

      onContourUpdate(updatedRTStructures);
    } catch (error) {
      console.error('Error adding brush stroke:', error);
    }
  }, [canvasToWorld, selectedStructure, rtStructures, currentSlicePosition, onContourUpdate, brushSize, createBrushCircle]);

  // Mouse event handlers
  const handleMouseDown = useCallback((e: MouseEvent) => {
    if (!isActive || !selectedStructure || e.button !== 0) return;
    if (!canvasRef.current) return;
    
    try {
      e.preventDefault();
      e.stopPropagation();
      
      const rect = canvasRef.current.getBoundingClientRect();
      const canvasPoint = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      };
      
      if (canvasPoint.x < 0 || canvasPoint.y < 0 || 
          canvasPoint.x > rect.width || canvasPoint.y > rect.height) {
        return;
      }
      
      setIsDrawing(true);
      addBrushStroke(canvasPoint);
    } catch (error) {
      console.error('Error in mouse down handler:', error);
      setIsDrawing(false);
    }
  }, [isActive, selectedStructure, addBrushStroke]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isActive || !canvasRef.current) return;
    
    try {
      const rect = canvasRef.current.getBoundingClientRect();
      const canvasPoint = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      };
      
      setMousePosition(canvasPoint);
      
      if (isDrawing) {
        // Paint continuously while dragging
        addBrushStroke(canvasPoint);
      }
    } catch (error) {
      console.error('Error in mouse move handler:', error);
    }
  }, [isActive, isDrawing, addBrushStroke]);

  const handleMouseUp = useCallback((e: MouseEvent) => {
    if (!isActive || e.button !== 0) return;
    setIsDrawing(false);
  }, [isActive]);

  // Set up event listeners
  useEffect(() => {
    if (!isActive || !canvasRef.current) return;

    const canvas = canvasRef.current;
    
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);
    
    canvas.style.cursor = 'none';
    
    return () => {
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseup', handleMouseUp);
      canvas.style.cursor = 'default';
    };
  }, [isActive, handleMouseDown, handleMouseMove, handleMouseUp]);

  // Create and manage cursor overlay
  useEffect(() => {
    if (!isActive || !canvasRef.current) return;

    const mainCanvas = canvasRef.current;
    
    if (!cursorCanvasRef.current) {
      const cursorCanvas = document.createElement('canvas');
      cursorCanvas.className = 'brush-cursor';
      cursorCanvas.style.position = 'absolute';
      cursorCanvas.style.top = '0';
      cursorCanvas.style.left = '0';
      cursorCanvas.style.pointerEvents = 'none';
      cursorCanvas.style.zIndex = '999';
      mainCanvas.parentElement?.appendChild(cursorCanvas);
      cursorCanvasRef.current = cursorCanvas;
    }
    
    const cursorCanvas = cursorCanvasRef.current;
    cursorCanvas.width = mainCanvas.width;
    cursorCanvas.height = mainCanvas.height;
    cursorCanvas.style.width = mainCanvas.style.width || `${mainCanvas.width}px`;
    cursorCanvas.style.height = mainCanvas.style.height || `${mainCanvas.height}px`;

    return () => {
      cursorCanvasRef.current?.remove();
      cursorCanvasRef.current = null;
    };
  }, [isActive]);

  // Render brush cursor circle
  useEffect(() => {
    if (!cursorCanvasRef.current || !mousePosition || !isActive) return;

    const ctx = cursorCanvasRef.current.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, cursorCanvasRef.current.width, cursorCanvasRef.current.height);
    
    const centerX = mousePosition.x;
    const centerY = mousePosition.y;
    const radius = brushSize / 2;
    
    ctx.save();
    
    // Brush circle outline
    ctx.strokeStyle = isDrawing ? '#00ff00' : '#ffffff';
    ctx.lineWidth = isDrawing ? 3 : 2;
    ctx.globalAlpha = isDrawing ? 1.0 : 0.8;
    
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
    ctx.stroke();
    
    // Fill area when drawing
    if (isDrawing) {
      ctx.fillStyle = 'rgba(0, 255, 0, 0.2)';
      ctx.fill();
    }
    
    // Center crosshair
    ctx.strokeStyle = isDrawing ? '#00ff00' : '#ffffff';
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.8;
    
    const crossSize = 4;
    ctx.beginPath();
    ctx.moveTo(centerX - crossSize, centerY);
    ctx.lineTo(centerX + crossSize, centerY);
    ctx.moveTo(centerX, centerY - crossSize);
    ctx.lineTo(centerX, centerY + crossSize);
    ctx.stroke();
    
    ctx.restore();
  }, [mousePosition, brushSize, isDrawing, isActive]);

  return null;
}

