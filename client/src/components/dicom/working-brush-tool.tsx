import { useEffect, useState, useRef } from 'react';

interface Point {
  x: number;
  y: number;
}

interface WorkingBrushProps {
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

export function WorkingBrushTool({
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
}: WorkingBrushProps) {
  const [isDrawing, setIsDrawing] = useState(false);
  const [mousePosition, setMousePosition] = useState<Point | null>(null);
  const currentStroke = useRef<Point[]>([]);

  // Debug logs
  useEffect(() => {
    console.log('Working Brush Tool:', { 
      isActive, 
      selectedStructure, 
      brushSize,
      rtStructures: !!rtStructures,
      currentSlicePosition
    });
  }, [isActive, selectedStructure, brushSize, rtStructures, currentSlicePosition]);

  // Create a simple circle polygon around a point
  const createCirclePolygon = (centerX: number, centerY: number, radius: number): number[] => {
    const points: number[] = [];
    const numPoints = 16; // Simple circle with 16 points
    
    for (let i = 0; i < numPoints; i++) {
      const angle = (i / numPoints) * 2 * Math.PI;
      const x = centerX + Math.cos(angle) * radius;
      const y = centerY + Math.sin(angle) * radius;
      points.push(x, y, currentSlicePosition); // x, y, z format for DICOM
    }
    
    return points;
  };

  // Convert canvas point to world coordinates
  const canvasToWorld = (canvasX: number, canvasY: number): Point | null => {
    if (!currentImage || !imageMetadata || !canvasRef.current) return null;

    const canvas = canvasRef.current;
    const imageWidth = currentImage.width || 512;
    const imageHeight = currentImage.height || 512;

    // Calculate image display parameters
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

    // Convert to DICOM world coordinates
    if (imageMetadata.imagePosition && imageMetadata.pixelSpacing) {
      const imagePosition = imageMetadata.imagePosition.split('\\').map(Number);
      const pixelSpacing = imageMetadata.pixelSpacing.split('\\').map(Number);

      const worldX = imagePosition[0] + (pixelX * pixelSpacing[0]);
      const worldY = imagePosition[1] + (pixelY * pixelSpacing[1]);

      return { x: worldX, y: worldY };
    }

    return null;
  };

  // Add brush stroke to RT structure
  const addBrushStroke = (canvasPoint: Point) => {
    console.log('Adding brush stroke at:', canvasPoint);
    
    const worldPoint = canvasToWorld(canvasPoint.x, canvasPoint.y);
    if (!worldPoint || !selectedStructure || !rtStructures) {
      console.log('Cannot add stroke:', { worldPoint, selectedStructure, rtStructures: !!rtStructures });
      return;
    }

    // Create circle polygon at world coordinates
    const radius = 5.0; // Fixed radius in world coordinates
    const contourPoints = createCirclePolygon(worldPoint.x, worldPoint.y, radius);

    console.log('Creating contour with points:', contourPoints.length / 3, 'points');

    // Update RT structure
    const updatedStructures = JSON.parse(JSON.stringify(rtStructures));
    const structure = updatedStructures.structures.find((s: any) => s.roiNumber === selectedStructure);
    
    if (!structure) {
      console.log('Structure not found:', selectedStructure);
      return;
    }

    // Find or create contour for current slice
    const tolerance = 2.0;
    let existingContour = structure.contours.find((contour: any) => 
      Math.abs(contour.slicePosition - currentSlicePosition) <= tolerance
    );

    if (existingContour) {
      // Replace existing contour
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

    onContourUpdate(updatedStructures);
  };

  // Mouse event handlers
  const handleMouseDown = (e: MouseEvent) => {
    console.log('Mouse down:', { isActive, selectedStructure, button: e.button });
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
    currentStroke.current = [canvasPoint];
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
      console.log('Brush stroke continue at:', canvasPoint);
      currentStroke.current.push(canvasPoint);
      addBrushStroke(canvasPoint);
    }
  };

  const handleMouseUp = (e: MouseEvent) => {
    if (!isActive || e.button !== 0) return;
    
    console.log('Ending brush stroke');
    setIsDrawing(false);
    currentStroke.current = [];
  };

  // Set up event listeners
  useEffect(() => {
    if (!isActive || !canvasRef.current) return;

    const canvas = canvasRef.current;
    console.log('Setting up brush tool events');
    
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);
    
    // Hide default cursor
    canvas.style.cursor = 'none';
    
    return () => {
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseup', handleMouseUp);
      canvas.style.cursor = 'default';
      console.log('Cleaned up brush tool events');
    };
  }, [isActive, selectedStructure, brushSize, isDrawing]);

  // Draw cursor overlay
  useEffect(() => {
    if (!isActive || !canvasRef.current || !mousePosition) return;

    const mainCanvas = canvasRef.current;
    
    // Create or get cursor overlay
    let cursorCanvas = document.getElementById('brush-cursor') as HTMLCanvasElement;
    if (!cursorCanvas) {
      cursorCanvas = document.createElement('canvas');
      cursorCanvas.id = 'brush-cursor';
      cursorCanvas.style.position = 'absolute';
      cursorCanvas.style.top = '0';
      cursorCanvas.style.left = '0';
      cursorCanvas.style.pointerEvents = 'none';
      cursorCanvas.style.zIndex = '999';
      mainCanvas.parentElement?.appendChild(cursorCanvas);
    }
    
    // Match main canvas size and position
    const rect = mainCanvas.getBoundingClientRect();
    const parentRect = mainCanvas.parentElement?.getBoundingClientRect();
    
    cursorCanvas.width = mainCanvas.width;
    cursorCanvas.height = mainCanvas.height;
    cursorCanvas.style.width = mainCanvas.style.width || `${mainCanvas.width}px`;
    cursorCanvas.style.height = mainCanvas.style.height || `${mainCanvas.height}px`;
    cursorCanvas.style.left = `${rect.left - (parentRect?.left || 0)}px`;
    cursorCanvas.style.top = `${rect.top - (parentRect?.top || 0)}px`;

    const ctx = cursorCanvas.getContext('2d');
    if (!ctx) return;

    // Clear and draw cursor
    ctx.clearRect(0, 0, cursorCanvas.width, cursorCanvas.height);

    if (mousePosition) {
      const centerX = mousePosition.x;
      const centerY = mousePosition.y;
      const radius = brushSize / 2;
      
      // Draw green circle (simple and visible)
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
    }

    return () => {
      cursorCanvas?.remove();
    };
  }, [isActive, mousePosition, brushSize, isDrawing]);

  return null; // This component only handles events and cursor
}