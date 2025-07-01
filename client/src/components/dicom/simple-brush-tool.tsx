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

  console.log('SimpleBrushTool render:', { isActive, selectedStructure, brushSize });

  // Convert canvas coordinates to DICOM world coordinates
  const canvasToWorld = (canvasX: number, canvasY: number): Point | null => {
    if (!currentImage || !imageMetadata || !canvasRef.current) {
      console.log('canvasToWorld failed - missing data');
      return null;
    }

    const canvas = canvasRef.current;
    const imageWidth = currentImage.width || 512;
    const imageHeight = currentImage.height || 512;

    // Calculate how the image is displayed on canvas
    const baseScale = Math.min(canvas.width / imageWidth, canvas.height / imageHeight);
    const totalScale = baseScale * zoom;
    const scaledWidth = imageWidth * totalScale;
    const scaledHeight = imageHeight * totalScale;

    // Image position on canvas (centered)
    const imageX = (canvas.width - scaledWidth) / 2 + panX;
    const imageY = (canvas.height - scaledHeight) / 2 + panY;

    // Convert canvas point to image pixel coordinates
    const pixelX = (canvasX - imageX) / totalScale;
    const pixelY = (canvasY - imageY) / totalScale;

    // Convert pixel coordinates to DICOM world coordinates
    if (imageMetadata.imagePosition && imageMetadata.pixelSpacing) {
      const imagePosition = imageMetadata.imagePosition.split('\\').map(Number);
      const pixelSpacing = imageMetadata.pixelSpacing.split('\\').map(Number);

      const worldX = imagePosition[0] + (pixelX * pixelSpacing[0]);
      const worldY = imagePosition[1] + (pixelY * pixelSpacing[1]);

      console.log('Converted coordinates:', { canvasX, canvasY, worldX, worldY });
      return { x: worldX, y: worldY };
    }

    return null;
  };

  // Create a simple brush stroke that builds a polygon
  const addBrushStroke = (canvasPoint: Point) => {
    console.log('addBrushStroke called:', canvasPoint);
    
    const worldPoint = canvasToWorld(canvasPoint.x, canvasPoint.y);
    if (!worldPoint || !selectedStructure || !rtStructures) {
      console.log('Cannot add stroke - missing requirements');
      return;
    }

    // Add to current stroke
    strokePoints.current.push(worldPoint);
    console.log('Current stroke has', strokePoints.current.length, 'points');

    // Create polygon contour from stroke points (like a real paint brush)
    const contourPoints: number[] = [];
    
    if (strokePoints.current.length >= 3) {
      // Create a polygon that follows the brush stroke path
      strokePoints.current.forEach(point => {
        contourPoints.push(point.x, point.y, currentSlicePosition);
      });
      
      // Close the polygon by adding the first point at the end
      if (strokePoints.current.length > 0) {
        const firstPoint = strokePoints.current[0];
        contourPoints.push(firstPoint.x, firstPoint.y, currentSlicePosition);
      }
    } else {
      // For the first few points, create a small circle
      const radius = 2.0;
      const numCirclePoints = 8;
      const centerPoint = strokePoints.current[strokePoints.current.length - 1];
      
      for (let i = 0; i < numCirclePoints; i++) {
        const angle = (i / numCirclePoints) * 2 * Math.PI;
        const x = centerPoint.x + Math.cos(angle) * radius;
        const y = centerPoint.y + Math.sin(angle) * radius;
        contourPoints.push(x, y, currentSlicePosition);
      }
    }

    console.log('Created polygon with', contourPoints.length / 3, 'points');

    // Update the RT structure
    const updatedRTStructures = JSON.parse(JSON.stringify(rtStructures));
    const structure = updatedRTStructures.structures.find((s: any) => s.roiNumber === selectedStructure);
    
    if (!structure) {
      console.log('Structure not found:', selectedStructure);
      return;
    }

    const tolerance = 2.0;
    let existingContour = structure.contours.find((contour: any) => 
      Math.abs(contour.slicePosition - currentSlicePosition) <= tolerance
    );

    if (existingContour) {
      // Replace existing contour with growing polygon
      existingContour.points = contourPoints;
      existingContour.numberOfPoints = contourPoints.length / 3;
      console.log('Updated existing contour');
    } else {
      // Create new contour
      structure.contours.push({
        slicePosition: currentSlicePosition,
        points: contourPoints,
        numberOfPoints: contourPoints.length / 3
      });
      console.log('Created new contour');
    }

    onContourUpdate(updatedRTStructures);
  };

  // Mouse event handlers
  const handleMouseDown = (e: MouseEvent) => {
    console.log('Mouse down event:', { isActive, selectedStructure, button: e.button });
    if (!isActive || !selectedStructure || e.button !== 0) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    const rect = canvasRef.current!.getBoundingClientRect();
    const canvasPoint = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
    
    console.log('Starting brush stroke at:', canvasPoint);
    setIsDrawing(true);
    strokePoints.current = []; // Start new stroke
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
    
    if (isDrawing) {
      console.log('Continuing brush stroke at:', canvasPoint);
      addBrushStroke(canvasPoint);
    }
  };

  const handleMouseUp = (e: MouseEvent) => {
    if (!isActive || e.button !== 0) return;
    
    console.log('Ending brush stroke');
    setIsDrawing(false);
    strokePoints.current = []; // Clear stroke
  };

  // Set up event listeners
  useEffect(() => {
    console.log('Setting up event listeners:', { isActive, selectedStructure });
    if (!isActive || !canvasRef.current) return;

    const canvas = canvasRef.current;
    
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('mouseleave', handleMouseUp); // Stop drawing when leaving canvas
    
    // Set cursor
    canvas.style.cursor = 'none';
    
    return () => {
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseup', handleMouseUp);
      canvas.removeEventListener('mouseleave', handleMouseUp);
      canvas.style.cursor = 'default';
    };
  }, [isActive, selectedStructure, brushSize, isDrawing]);

  // Create cursor overlay canvas
  useEffect(() => {
    if (!isActive || !canvasRef.current) {
      // Clean up cursor canvas
      if (cursorCanvasRef.current) {
        cursorCanvasRef.current.remove();
        cursorCanvasRef.current = null;
      }
      return;
    }

    const mainCanvas = canvasRef.current;
    
    // Create cursor canvas if it doesn't exist
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

    // Get the computed styles to avoid flashing issues
    const computedStyle = window.getComputedStyle(mainCanvas);
    const rect = mainCanvas.getBoundingClientRect();

    // Set canvas dimensions to match main canvas exactly
    cursorCanvas.width = mainCanvas.width;
    cursorCanvas.height = mainCanvas.height;
    cursorCanvas.style.width = computedStyle.width;
    cursorCanvas.style.height = computedStyle.height;
    cursorCanvas.style.left = `${rect.left - mainCanvas.parentElement!.getBoundingClientRect().left}px`;
    cursorCanvas.style.top = `${rect.top - mainCanvas.parentElement!.getBoundingClientRect().top}px`;

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

    // Clear canvas
    ctx.clearRect(0, 0, cursorCanvasRef.current.width, cursorCanvasRef.current.height);

    // Draw simple green circle
    const centerX = mousePosition.x;
    const centerY = mousePosition.y;
    const radius = Math.max(4, Math.min(50, brushSize / 2));
    
    ctx.strokeStyle = isDrawing ? '#00ff00' : '#ffffff';
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.8;
    
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
    ctx.stroke();

    // Draw center dot
    ctx.fillStyle = ctx.strokeStyle;
    ctx.beginPath();
    ctx.arc(centerX, centerY, 2, 0, 2 * Math.PI);
    ctx.fill();
  }, [mousePosition, brushSize, isDrawing, isActive]);

  return null; // This component only handles events and cursor
}