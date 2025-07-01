
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
  const [strokePoints, setStrokePoints] = useState<Point[]>([]);
  const cursorCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // ✅ FIXED: Proper coordinate transformation with useCallback
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

      // ✅ PROPER DICOM TRANSFORMATION
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

      // Fallback for simple coordinate transformation
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

  // ✅ FIXED: Proper brush stroke handling
  const addBrushStroke = useCallback((canvasPoint: Point) => {
    const worldPoint = canvasToWorld(canvasPoint.x, canvasPoint.y);
    if (!worldPoint || !selectedStructure || !rtStructures) return;

    try {
      setStrokePoints(prev => {
        const updatedPoints = [...prev, worldPoint];
        
        // Create DICOM contour points
        const contourPoints: number[] = [];
        for (const point of updatedPoints) {
          contourPoints.push(point.x, point.y, currentSlicePosition);
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
        
        if (!structure) return prev;

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
          existingContour.points = contourPoints;
          existingContour.numberOfPoints = contourPoints.length / 3;
        } else {
          structure.contours.push({
            slicePosition: currentSlicePosition,
            points: contourPoints,
            numberOfPoints: contourPoints.length / 3
          });
        }

        onContourUpdate(updatedRTStructures);
        return updatedPoints;
      });
    } catch (error) {
      console.error('Error adding brush stroke:', error);
    }
  }, [canvasToWorld, selectedStructure, rtStructures, currentSlicePosition, onContourUpdate]);

  // ✅ FIXED: Proper event handlers with useCallback
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
      setStrokePoints([]);
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
        addBrushStroke(canvasPoint);
      }
    } catch (error) {
      console.error('Error in mouse move handler:', error);
    }
  }, [isActive, isDrawing, addBrushStroke]);

  const handleMouseUp = useCallback((e: MouseEvent) => {
    if (!isActive || e.button !== 0) return;
    
    setIsDrawing(false);
    setStrokePoints([]);
  }, [isActive]);

  // ✅ FIXED: Proper event listener setup with all dependencies
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

  // ✅ FIXED: Stable cursor canvas setup
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

  // ✅ FIXED: Efficient cursor rendering
  useEffect(() => {
    if (!cursorCanvasRef.current || !mousePosition) return;

    const ctx = cursorCanvasRef.current.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, cursorCanvasRef.current.width, cursorCanvasRef.current.height);
    
    const centerX = mousePosition.x;
    const centerY = mousePosition.y;
    const radius = brushSize / 2;
    
    ctx.save();
    
    const operationColor = '#00ff00';
    
    // Draw outer circle
    ctx.strokeStyle = operationColor;
    ctx.lineWidth = isDrawing ? 3 : 2;
    ctx.setLineDash([]);
    ctx.globalAlpha = isDrawing ? 1.0 : 0.7;
    
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
    ctx.stroke();
    
    // Draw inner guide circle
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);
    ctx.globalAlpha = 0.5;
    
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius / 2, 0, 2 * Math.PI);
    ctx.stroke();
    
    // Draw center crosshair
    ctx.setLineDash([]);
    ctx.lineWidth = 2;
    ctx.globalAlpha = 1.0;
    
    const crosshairSize = 8;
    ctx.beginPath();
    ctx.moveTo(centerX - crosshairSize, centerY);
    ctx.lineTo(centerX + crosshairSize, centerY);
    ctx.moveTo(centerX, centerY - crosshairSize);
    ctx.lineTo(centerX, centerY + crosshairSize);
    ctx.stroke();
    
    // Draw operation indicator
    const indicatorSize = 6;
    const indicatorX = centerX + radius * 0.7;
    const indicatorY = centerY - radius * 0.7;
    
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(indicatorX - indicatorSize/2, indicatorY);
    ctx.lineTo(indicatorX + indicatorSize/2, indicatorY);
    ctx.moveTo(indicatorX, indicatorY - indicatorSize/2);
    ctx.lineTo(indicatorX, indicatorY + indicatorSize/2);
    ctx.stroke();
    
    ctx.restore();
  }, [mousePosition, brushSize, isDrawing]);

  return null;
}
