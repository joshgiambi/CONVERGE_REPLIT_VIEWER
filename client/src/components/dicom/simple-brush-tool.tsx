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

  // Convert canvas coordinates to DICOM world coordinates
  const canvasToWorld = (canvasX: number, canvasY: number): Point | null => {
    if (!currentImage || !imageMetadata || !canvasRef.current) return null;

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

      return { x: worldX, y: worldY };
    }

    return null;
  };

  // Create a simple brush stroke at the current position
  const addBrushStroke = (canvasPoint: Point) => {
    const worldPoint = canvasToWorld(canvasPoint.x, canvasPoint.y);
    if (!worldPoint || !selectedStructure || !rtStructures) return;

    // Add to current stroke
    strokePoints.current.push(worldPoint);

    // Create DICOM contour points from stroke
    const contourPoints: number[] = [];
    for (const point of strokePoints.current) {
      contourPoints.push(point.x, point.y, currentSlicePosition);
    }

    // Update the RT structure
    const updatedRTStructures = JSON.parse(JSON.stringify(rtStructures));
    const structure = updatedRTStructures.structures.find((s: any) => s.roiNumber === selectedStructure);
    
    if (!structure) return;

    const tolerance = 2.0;
    let existingContour = structure.contours.find((contour: any) => 
      Math.abs(contour.slicePosition - currentSlicePosition) <= tolerance
    );

    if (existingContour) {
      // Replace existing contour with accumulated stroke
      existingContour.points = contourPoints;
      existingContour.numberOfPoints = contourPoints.length / 3;
    } else {
      // Create new contour
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
      addBrushStroke(canvasPoint);
    }
  };

  const handleMouseUp = (e: MouseEvent) => {
    if (!isActive || e.button !== 0) return;
    
    setIsDrawing(false);
    strokePoints.current = []; // Clear stroke
  };

  // Set up event listeners
  useEffect(() => {
    if (!isActive || !canvasRef.current) return;

    const canvas = canvasRef.current;
    
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);
    
    // Set cursor
    canvas.style.cursor = 'none';
    
    return () => {
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseup', handleMouseUp);
      canvas.style.cursor = 'default';
    };
  }, [isActive, selectedStructure, brushSize, isDrawing]);

  // Professional cursor rendering following UI/UX documentation
  useEffect(() => {
    if (!isActive || !canvasRef.current) return;

    const mainCanvas = canvasRef.current;
    
    // Create professional cursor overlay
    let cursorCanvas = mainCanvas.parentElement?.querySelector('.brush-cursor') as HTMLCanvasElement;
    if (!cursorCanvas) {
      cursorCanvas = document.createElement('canvas');
      cursorCanvas.className = 'brush-cursor';
      cursorCanvas.style.position = 'absolute';
      cursorCanvas.style.top = '0';
      cursorCanvas.style.left = '0';
      cursorCanvas.style.pointerEvents = 'none';
      cursorCanvas.style.zIndex = '999';
      mainCanvas.parentElement?.appendChild(cursorCanvas);
    }
    
    cursorCanvas.width = mainCanvas.width;
    cursorCanvas.height = mainCanvas.height;
    cursorCanvas.style.width = mainCanvas.style.width || `${mainCanvas.width}px`;
    cursorCanvas.style.height = mainCanvas.style.height || `${mainCanvas.height}px`;

    const ctx = cursorCanvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, cursorCanvas.width, cursorCanvas.height);

    if (mousePosition) {
      const centerX = mousePosition.x;
      const centerY = mousePosition.y;
      const radius = brushSize / 2;
      
      ctx.save();
      
      // Set operation color following medical imaging standards
      const operationColor = '#00ff00'; // Green for additive (default)
      
      // Draw outer circle - main brush indicator
      ctx.strokeStyle = operationColor;
      ctx.lineWidth = isDrawing ? 3 : 2; // Thicker when drawing
      ctx.setLineDash([]);
      ctx.globalAlpha = isDrawing ? 1.0 : 0.7;
      
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
      ctx.stroke();
      
      // Draw inner guide circle (50% of brush size)
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 5]); // Dashed line
      ctx.globalAlpha = 0.5;
      
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius / 2, 0, 2 * Math.PI);
      ctx.stroke();
      
      // Draw center crosshair for precision
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
      
      // Draw operation indicator (plus sign for additive)
      const indicatorSize = 6;
      const indicatorX = centerX + radius * 0.7;
      const indicatorY = centerY - radius * 0.7;
      
      ctx.lineWidth = 2;
      ctx.beginPath();
      // Plus sign for additive
      ctx.moveTo(indicatorX - indicatorSize/2, indicatorY);
      ctx.lineTo(indicatorX + indicatorSize/2, indicatorY);
      ctx.moveTo(indicatorX, indicatorY - indicatorSize/2);
      ctx.lineTo(indicatorX, indicatorY + indicatorSize/2);
      ctx.stroke();
      
      ctx.restore();
    }

    return () => {
      cursorCanvas?.remove();
    };
  }, [isActive, mousePosition, brushSize, isDrawing]);

  return null; // This component only handles events and cursor
}