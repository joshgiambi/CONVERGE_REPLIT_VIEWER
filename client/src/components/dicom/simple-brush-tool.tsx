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

  // Track brush settings and state
  const [currentBrushSize, setCurrentBrushSize] = useState(brushSize);
  const currentBrushPolygon = useRef<Point[]>([]);
  const existingContourPoints = useRef<Point[]>([]);
  const isRightMouseDown = useRef(false);
  const lastMousePos = useRef<Point | null>(null);

  // Add a brush "stamp" at the current position with continuous movement
  const addBrushStroke = (canvasPoint: Point) => {
    const worldPoint = canvasToWorld(canvasPoint.x, canvasPoint.y);
    console.log('Brush stroke:', { canvasPoint, worldPoint });
    if (!worldPoint || !selectedStructure || !rtStructures) {
      console.log('Cannot add stroke - missing data:', { worldPoint: !!worldPoint, selectedStructure, rtStructures: !!rtStructures });
      return;
    }

    // Create brush stamp with zoom-independent world coordinate size
    const radius = currentBrushSize * 0.5; // Base radius in world coordinates (zoom-independent)
    const numCirclePoints = 16;
    const brushStamp: Point[] = [];
    
    for (let i = 0; i < numCirclePoints; i++) {
      const angle = (i / numCirclePoints) * 2 * Math.PI;
      const x = worldPoint.x + Math.cos(angle) * radius;
      const y = worldPoint.y + Math.sin(angle) * radius;
      brushStamp.push({ x, y });
    }

    // For continuous movement, add interpolated stamps between last and current position
    if (lastMousePos.current && isDrawing) {
      const lastWorldPoint = canvasToWorld(lastMousePos.current.x, lastMousePos.current.y);
      if (lastWorldPoint) {
        const dx = worldPoint.x - lastWorldPoint.x;
        const dy = worldPoint.y - lastWorldPoint.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const steps = Math.max(1, Math.floor(distance / (radius * 0.3))); // Overlap stamps for smoothness
        
        for (let step = 0; step <= steps; step++) {
          const t = step / steps;
          const interpX = lastWorldPoint.x + dx * t;
          const interpY = lastWorldPoint.y + dy * t;
          
          for (let i = 0; i < numCirclePoints; i++) {
            const angle = (i / numCirclePoints) * 2 * Math.PI;
            const x = interpX + Math.cos(angle) * radius;
            const y = interpY + Math.sin(angle) * radius;
            currentBrushPolygon.current.push({ x, y });
          }
        }
      }
    } else {
      // First stamp
      currentBrushPolygon.current = currentBrushPolygon.current.concat(brushStamp);
    }
    
    lastMousePos.current = canvasPoint;

    // For now, only use the current brush stroke (complete slice isolation)
    // This prevents contamination from other slices
    const allPoints = [...currentBrushPolygon.current];
    
    // Convert to DICOM contour format
    const contourPoints: number[] = [];
    allPoints.forEach(point => {
      contourPoints.push(point.x, point.y, currentSlicePosition);
    });

    // Update the RT structure
    const updatedRTStructures = JSON.parse(JSON.stringify(rtStructures));
    const structure = updatedRTStructures.structures.find((s: any) => s.roiNumber === selectedStructure);
    
    if (!structure) return;

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
  };

  // Mouse event handlers
  const handleMouseDown = (e: MouseEvent) => {
    console.log('Mouse down event:', { isActive, selectedStructure, button: e.button });
    if (!isActive || !selectedStructure) return;
    
    if (e.button === 2) { // Right click - brush resizing
      isRightMouseDown.current = true;
      lastMousePos.current = {
        x: e.clientX,
        y: e.clientY
      };
      e.preventDefault();
      return;
    }
    
    if (e.button !== 0) return; // Only left click for drawing
    
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
    currentBrushPolygon.current = []; // Clear accumulated brush stamps
    lastMousePos.current = null; // Reset for continuous drawing
    
    // COMPLETELY ISOLATE this slice - start fresh every time for now
    // This prevents any cross-slice contamination
    existingContourPoints.current = [];
    console.log(`Starting completely fresh for slice ${currentSlicePosition} - no existing contours loaded`);
    
    // TODO: Later we can add proper slice-specific contour loading, but for now
    // we ensure complete isolation to fix the propagation bug
    
    addBrushStroke(canvasPoint);
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isActive || !canvasRef.current) return;
    
    // Handle right-click brush resizing
    if (isRightMouseDown.current && lastMousePos.current) {
      const deltaY = lastMousePos.current.y - e.clientY; // Up = positive, Down = negative
      const sizeChange = deltaY * 0.5; // Sensitivity factor
      const newSize = Math.max(1, Math.min(50, currentBrushSize + sizeChange));
      setCurrentBrushSize(newSize);
      console.log('Brush size changed to:', newSize);
      
      lastMousePos.current = {
        x: e.clientX,
        y: e.clientY
      };
      return;
    }
    
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
    if (!isActive) return;
    
    if (e.button === 2) { // Right mouse up - stop resizing
      isRightMouseDown.current = false;
      lastMousePos.current = null;
      console.log('Stopped brush resizing');
      return;
    }
    
    if (e.button !== 0) return; // Only handle left mouse up for drawing
    
    console.log('Ending brush stroke');
    setIsDrawing(false);
    strokePoints.current = []; // Clear stroke
    lastMousePos.current = null; // Reset for next stroke
    // Keep currentBrushPolygon for the finished contour
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
    canvas.addEventListener('contextmenu', (e) => e.preventDefault()); // Disable right-click menu
    
    // Set cursor
    canvas.style.cursor = 'none';
    
    return () => {
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseup', handleMouseUp);
      canvas.removeEventListener('mouseleave', handleMouseUp);
      canvas.removeEventListener('contextmenu', (e) => e.preventDefault());
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

    // Draw simple circle with current brush size
    const centerX = mousePosition.x;
    const centerY = mousePosition.y;
    const radius = Math.max(4, Math.min(50, currentBrushSize / 2));
    
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
  }, [mousePosition, currentBrushSize, isDrawing, isActive]);

  return null; // This component only handles events and cursor
}