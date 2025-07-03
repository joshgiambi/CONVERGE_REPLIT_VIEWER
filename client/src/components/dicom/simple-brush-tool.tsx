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
  const cursorCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const currentStroke = useRef<Point[]>([]);

  // FIXED: Proper canvas to world coordinate transformation
  const canvasToWorld = (canvasX: number, canvasY: number): Point | null => {
    if (!currentImage || !imageMetadata || !canvasRef.current) {
      return null;
    }

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();

    // Convert canvas coordinates to normalized coordinates (0-1)
    const normalizedX = canvasX / canvas.width;
    const normalizedY = canvasY / canvas.height;

    // Get image dimensions
    const imageWidth = currentImage.width || 512;
    const imageHeight = currentImage.height || 512;

    // Apply zoom and pan transformations
    const scaledImageWidth = imageWidth * zoom;
    const scaledImageHeight = imageHeight * zoom;

    // Calculate the display area that shows the image
    const displayWidth = canvas.width;
    const displayHeight = canvas.height;

    // Center the scaled image in the display
    const offsetX = (displayWidth - scaledImageWidth) / 2 + panX;
    const offsetY = (displayHeight - scaledImageHeight) / 2 + panY;

    // Convert canvas coordinates to image pixel coordinates
    const imagePixelX = (canvasX - offsetX) / zoom;
    const imagePixelY = (canvasY - offsetY) / zoom;

    // Check if coordinates are within image bounds
    if (imagePixelX < 0 || imagePixelX >= imageWidth || imagePixelY < 0 || imagePixelY >= imageHeight) {
      return null;
    }

    // Convert to DICOM world coordinates using proper DICOM transformations
    if (imageMetadata.imagePosition && imageMetadata.pixelSpacing) {
      try {
        const imagePosition = imageMetadata.imagePosition.split('\\').map(Number);
        const pixelSpacing = imageMetadata.pixelSpacing.split('\\').map(Number);
        const imageOrientation = imageMetadata.imageOrientation ? 
          imageMetadata.imageOrientation.split('\\').map(Number) : 
          [1, 0, 0, 0, 1, 0];

        if (imagePosition.length >= 3 && pixelSpacing.length >= 2) {
          // DICOM Patient Coordinate System transformation
          const worldX = imagePosition[0] + 
            (imagePixelX * pixelSpacing[0] * imageOrientation[0]) + 
            (imagePixelY * pixelSpacing[1] * imageOrientation[3]);

          const worldY = imagePosition[1] + 
            (imagePixelX * pixelSpacing[0] * imageOrientation[1]) + 
            (imagePixelY * pixelSpacing[1] * imageOrientation[4]);

          return { x: worldX, y: worldY };
        }
      } catch (error) {
        console.warn('DICOM coordinate transformation failed:', error);
      }
    }

    // Fallback: use pixel coordinates scaled by pixel spacing
    const pixelSpacing = imageMetadata.pixelSpacing ? 
      imageMetadata.pixelSpacing.split('\\').map(Number) : [1, 1];

    return { 
      x: imagePixelX * pixelSpacing[0], 
      y: imagePixelY * pixelSpacing[1] 
    };
  };

  // Generate brush stroke points in world coordinates
  const generateBrushStroke = (worldPoint: Point): Point[] => {
    if (!imageMetadata) return [];

    // Calculate world-space brush radius
    const pixelSpacing = imageMetadata.pixelSpacing ? 
      imageMetadata.pixelSpacing.split('\\').map(Number) : [1, 1];
    const worldBrushRadius = (brushSize / 2) * pixelSpacing[0];

    // Generate circular brush stroke
    const numPoints = Math.max(8, Math.floor(brushSize / 2)); // More points for larger brushes
    const brushPoints: Point[] = [];

    for (let i = 0; i < numPoints; i++) {
      const angle = (i / numPoints) * 2 * Math.PI;
      const x = worldPoint.x + Math.cos(angle) * worldBrushRadius;
      const y = worldPoint.y + Math.sin(angle) * worldBrushRadius;
      brushPoints.push({ x, y });
    }

    return brushPoints;
  };

  // Update RT structure with new contour data
  const updateRTStructure = () => {
    if (!selectedStructure || !rtStructures || currentStroke.current.length === 0) {
      return;
    }

    const updatedRTStructures = JSON.parse(JSON.stringify(rtStructures));
    const structure = updatedRTStructures.structures.find((s: any) => s.roiNumber === selectedStructure);

    if (!structure) {
      console.warn('Selected structure not found:', selectedStructure);
      return;
    }

    // Convert stroke points to DICOM contour format
    const contourPoints: number[] = [];
    currentStroke.current.forEach(point => {
      // CRITICAL: Use exact currentSlicePosition for Z coordinate
      contourPoints.push(point.x, point.y, currentSlicePosition);
    });

    // Find existing contour for current slice (strict Z matching)
    const tolerance = 0.01; // Very strict tolerance
    let existingContourIndex = structure.contours.findIndex((contour: any) => 
      Math.abs(contour.slicePosition - currentSlicePosition) <= tolerance
    );

    if (existingContourIndex !== -1) {
      // Replace existing contour
      structure.contours[existingContourIndex] = {
        slicePosition: currentSlicePosition,
        points: contourPoints,
        numberOfPoints: contourPoints.length / 3
      };
    } else {
      // Add new contour
      structure.contours.push({
        slicePosition: currentSlicePosition,
        points: contourPoints,
        numberOfPoints: contourPoints.length / 3
      });
    }

    console.log('Updated contour for slice:', currentSlicePosition, 'with', contourPoints.length / 3, 'points');
    onContourUpdate(updatedRTStructures);
  };

  // Handle brush stroke at canvas position
  const addBrushStroke = (canvasPoint: Point) => {
    const worldPoint = canvasToWorld(canvasPoint.x, canvasPoint.y);
    if (!worldPoint || !selectedStructure) {
      return;
    }

    const brushPoints = generateBrushStroke(worldPoint);

    if (isDrawing) {
      // Add to existing stroke
      currentStroke.current = [...currentStroke.current, ...brushPoints];
    } else {
      // Start new stroke
      currentStroke.current = brushPoints;
    }

    // Update contours immediately for real-time feedback
    updateRTStructure();
  };

  // Mouse event handlers
  const handleMouseDown = (e: MouseEvent) => {
    if (!isActive || !selectedStructure || e.button !== 0) return;

    e.preventDefault();
    e.stopPropagation();

    const rect = canvasRef.current!.getBoundingClientRect();
    const canvasPoint = {
      x: (e.clientX - rect.left) * (canvasRef.current!.width / rect.width),
      y: (e.clientY - rect.top) * (canvasRef.current!.height / rect.height)
    };

    setIsDrawing(true);
    currentStroke.current = [];
    addBrushStroke(canvasPoint);
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isActive || !canvasRef.current) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const canvasPoint = {
      x: (e.clientX - rect.left) * (canvasRef.current.width / rect.width),
      y: (e.clientY - rect.top) * (canvasRef.current.height / rect.height)
    };

    setMousePosition(canvasPoint);

    if (isDrawing && selectedStructure) {
      addBrushStroke(canvasPoint);
    }
  };

  const handleMouseUp = (e: MouseEvent) => {
    if (!isActive || e.button !== 0) return;

    setIsDrawing(false);
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
  }, [isActive, selectedStructure, brushSize, zoom, panX, panY, currentSlicePosition]);

  // Create and manage cursor overlay canvas
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

    // Match canvas dimensions exactly
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
  }, [isActive, zoom, panX, panY]);

  // Draw brush cursor
  useEffect(() => {
    if (!cursorCanvasRef.current || !mousePosition || !isActive) return;

    const ctx = cursorCanvasRef.current.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, cursorCanvasRef.current.width, cursorCanvasRef.current.height);

    // Calculate cursor size based on zoom level
    const radius = (brushSize / 2) * zoom;

    // Draw cursor
    ctx.strokeStyle = isDrawing ? '#00ff00' : '#ffffff';
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.8;
    ctx.setLineDash([4, 4]);

    ctx.beginPath();
    ctx.arc(mousePosition.x, mousePosition.y, radius, 0, 2 * Math.PI);
    ctx.stroke();

    // Draw center dot
    ctx.setLineDash([]);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.beginPath();
    ctx.arc(mousePosition.x, mousePosition.y, 2, 0, 2 * Math.PI);
    ctx.fill();
  }, [mousePosition, brushSize, isDrawing, isActive, zoom]);

  return null;
}