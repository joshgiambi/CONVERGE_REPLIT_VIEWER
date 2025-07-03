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

  // FIXED coordinate transformation with proper slice isolation
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

    // Strict bounds check to prevent artifacts
    if (pixelX < 0 || pixelX >= imageWidth || pixelY < 0 || pixelY >= imageHeight) {
      return null;
    }

    // Convert to DICOM world coordinates with validation
    if (imageMetadata.imagePosition && imageMetadata.pixelSpacing) {
      const imagePosition = imageMetadata.imagePosition.split('\\').map(Number);
      const pixelSpacing = imageMetadata.pixelSpacing.split('\\').map(Number);
      const imageOrientation = imageMetadata.imageOrientation ? 
        imageMetadata.imageOrientation.split('\\').map(Number) : 
        [1, 0, 0, 0, 1, 0];

      // Validate we have proper numeric values
      if (imagePosition.length < 2 || pixelSpacing.length < 2) {
        console.warn('Invalid DICOM metadata for coordinate transformation');
        return null;
      }

      // Proper DICOM coordinate transformation
      const worldX = imagePosition[0] + 
        (pixelX * pixelSpacing[0] * imageOrientation[0]) + 
        (pixelY * pixelSpacing[1] * imageOrientation[3]);

      const worldY = imagePosition[1] + 
        (pixelX * pixelSpacing[0] * imageOrientation[1]) + 
        (pixelY * pixelSpacing[1] * imageOrientation[4]);

      // Validate output coordinates
      if (isNaN(worldX) || isNaN(worldY)) {
        console.warn('Invalid world coordinates calculated');
        return null;
      }

      return { x: worldX, y: worldY };
    }

    return null;
  };

  const [currentBrushSize, setCurrentBrushSize] = useState(brushSize);
  const currentStroke = useRef<Point[]>([]);
  const lastMousePos = useRef<Point | null>(null);

  // Create brush stroke with proper world coordinates - FIXED VERSION
  const addBrushStroke = (canvasPoint: Point) => {
    const worldPoint = canvasToWorld(canvasPoint.x, canvasPoint.y);
    if (!worldPoint || !selectedStructure || !rtStructures) {
      return;
    }

    // Calculate world-space brush radius
    const pixelSpacing = imageMetadata.pixelSpacing ? 
      imageMetadata.pixelSpacing.split('\\').map(Number) : [1, 1];
    const worldBrushRadius = (currentBrushSize / 2) * pixelSpacing[0];

    // Generate fewer points for cleaner contours
    const numPoints = 8; // Reduced from 16
    const brushPoints: Point[] = [];

    for (let i = 0; i < numPoints; i++) {
      const angle = (i / numPoints) * 2 * Math.PI;
      const x = worldPoint.x + Math.cos(angle) * worldBrushRadius;
      const y = worldPoint.y + Math.sin(angle) * worldBrushRadius;
      brushPoints.push({ x, y });
    }

    // Simplified stroke handling - no interpolation to reduce artifacts
    if (lastMousePos.current && isDrawing) {
      const lastWorldPoint = canvasToWorld(lastMousePos.current.x, lastMousePos.current.y);
      if (lastWorldPoint) {
        // Only add current brush points, no interpolation
        currentStroke.current = currentStroke.current.concat(brushPoints);
      }
    } else {
      // Starting new stroke
      currentStroke.current = brushPoints;
    }

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

    // Convert current stroke to DICOM contour format with FIXED Z-coordinate
    const contourPoints: number[] = [];
    currentStroke.current.forEach(point => {
      // CRITICAL FIX: Use exact currentSlicePosition for Z coordinate
      contourPoints.push(point.x, point.y, currentSlicePosition);
    });

    // Find or create contour for current slice with strict Z matching
    const tolerance = 0.1; // Much stricter tolerance
    let existingContour = structure.contours.find((contour: any) => 
      Math.abs(contour.slicePosition - currentSlicePosition) <= tolerance
    );

    if (existingContour) {
      // Replace existing contour with new brush stroke
      existingContour.points = contourPoints;
      existingContour.numberOfPoints = contourPoints.length / 3;
      // Ensure exact slice position match
      existingContour.slicePosition = currentSlicePosition;
    } else {
      // Create new contour with exact slice position
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

    // Scale brush cursor with zoom level - this makes it show actual brush size in world coordinates
    const radius = (currentBrushSize / 2) * zoom;

    ctx.strokeStyle = isDrawing ? '#00ff00' : '#ffffff';
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.8;

    ctx.beginPath();
    ctx.arc(mousePosition.x, mousePosition.y, radius, 0, 2 * Math.PI);
    ctx.stroke();

    // Draw center dot (keep this small and fixed)
    ctx.fillStyle = ctx.strokeStyle;
    ctx.beginPath();
    ctx.arc(mousePosition.x, mousePosition.y, 2, 0, 2 * Math.PI);
    ctx.fill();
  }, [mousePosition, currentBrushSize, isDrawing, isActive, zoom]);

  // Update brush size
  useEffect(() => {
    setCurrentBrushSize(brushSize);
  }, [brushSize]);

  return null;
}