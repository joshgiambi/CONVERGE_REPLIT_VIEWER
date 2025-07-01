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
  onBrushSizeChange?: (size: number) => void;
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
  onBrushSizeChange,
  zoom,
  panX,
  panY,
  currentImage,
  imageMetadata
}: SimpleBrushProps) {
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentBrushSize, setCurrentBrushSize] = useState(brushSize);
  const [isResizing, setIsResizing] = useState(false);
  const [lastMouseY, setLastMouseY] = useState(0);
  
  // Store the current stroke as a simple array of points
  const currentStroke = useRef<Point[]>([]);
  const lastMousePos = useRef<Point | null>(null);

  // Helper function to get correct mouse coordinates
  const getCanvasCoordinates = (e: MouseEvent): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  };

  // Convert canvas coordinates to DICOM world coordinates
  const canvasToWorld = (canvasPoint: Point): Point => {
    // Simple direct conversion - no complex transformations for now
    // Account for zoom and pan
    const worldX = (canvasPoint.x - panX) / zoom;
    const worldY = (canvasPoint.y - panY) / zoom;
    
    console.log(`Canvas (${canvasPoint.x}, ${canvasPoint.y}) -> World (${worldX}, ${worldY})`);
    return { x: worldX, y: worldY };
  };

  const addPointToStroke = (canvasPoint: Point) => {
    const worldPoint = canvasToWorld(canvasPoint);
    
    // Add point to current stroke
    currentStroke.current.push(worldPoint);
    
    console.log(`Added point to stroke: World (${worldPoint.x}, ${worldPoint.y}), Stroke length: ${currentStroke.current.length}`);
  };

  const finishStroke = () => {
    if (currentStroke.current.length === 0 || !selectedStructure) {
      console.log('No stroke to finish or no structure selected');
      return;
    }

    console.log(`Finishing stroke with ${currentStroke.current.length} points for structure ${selectedStructure} on slice ${currentSlicePosition}`);

    // Create a simple contour from the stroke points
    const contourPoints: number[] = [];
    currentStroke.current.forEach(point => {
      contourPoints.push(point.x, point.y, currentSlicePosition);
    });

    // Find the structure to update
    const updatedStructures = { ...rtStructures };
    if (updatedStructures?.structures) {
      const structureIndex = updatedStructures.structures.findIndex(
        (s: any) => s.roiNumber === selectedStructure
      );

      if (structureIndex >= 0) {
        const structure = updatedStructures.structures[structureIndex];
        
        // CRITICAL: Remove any existing contours for this exact slice to prevent propagation
        structure.contours = structure.contours.filter((contour: any) => 
          Math.abs(contour.slicePosition - currentSlicePosition) > 0.1
        );

        // Add the new contour for this slice only
        const newContour = {
          slicePosition: currentSlicePosition,
          points: contourPoints,
          geometricType: 'CLOSED_PLANAR'
        };

        structure.contours.push(newContour);
        console.log(`Added new contour to structure ${selectedStructure} for slice ${currentSlicePosition}`);
        
        // Update the structures
        onContourUpdate(updatedStructures);
      }
    }

    // Clear the current stroke
    currentStroke.current = [];
  };

  const handleMouseDown = (e: MouseEvent) => {
    console.log('Mouse down event:', {
      isActive,
      selectedStructure,
      button: e.button,
      clientX: e.clientX,
      clientY: e.clientY
    });

    if (!isActive || !selectedStructure) {
      console.log('Brush tool: Ignoring mouse down - not active or no structure selected');
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    const canvasPoint = getCanvasCoordinates(e);
    console.log('Canvas point:', canvasPoint);

    if (e.button === 2) { // Right click for brush resizing
      console.log('Starting brush resize');
      setIsResizing(true);
      setLastMouseY(e.clientY);
      return;
    }

    if (e.button === 0) { // Left click for drawing
      console.log('Starting drawing stroke');
      setIsDrawing(true);
      currentStroke.current = []; // Start fresh stroke
      lastMousePos.current = canvasPoint;
      
      console.log(`Starting new stroke for structure ${selectedStructure} on slice ${currentSlicePosition}`);
      addPointToStroke(canvasPoint);
    }
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isActive || !selectedStructure) return;

    e.preventDefault();

    if (isResizing) {
      const deltaY = lastMouseY - e.clientY;
      const newSize = Math.max(1, Math.min(50, currentBrushSize + deltaY * 0.5));
      setCurrentBrushSize(newSize);
      setLastMouseY(e.clientY);
      if (onBrushSizeChange) {
        onBrushSizeChange(newSize);
      }
      return;
    }

    if (isDrawing) {
      const canvasPoint = getCanvasCoordinates(e);
      
      // Only add points if mouse moved significantly (smooth the stroke)
      if (lastMousePos.current) {
        const distance = Math.sqrt(
          Math.pow(canvasPoint.x - lastMousePos.current.x, 2) +
          Math.pow(canvasPoint.y - lastMousePos.current.y, 2)
        );
        
        if (distance > 2) { // Minimum distance between points
          addPointToStroke(canvasPoint);
          lastMousePos.current = canvasPoint;
        }
      }
    }
  };

  const handleMouseUp = (e: MouseEvent) => {
    if (!isActive) return;

    e.preventDefault();

    if (isResizing) {
      setIsResizing(false);
      return;
    }

    if (isDrawing) {
      setIsDrawing(false);
      finishStroke();
      lastMousePos.current = null;
    }
  };

  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault(); // Prevent context menu when right-clicking for brush resize
  };

  // Set up event listeners
  useEffect(() => {
    const canvas = canvasRef.current;
    
    console.log('Brush tool effect running:', {
      hasCanvas: !!canvas,
      isActive,
      selectedStructure,
      currentSlicePosition
    });

    if (!canvas || !isActive) {
      console.log('Brush tool: Not setting up listeners - missing canvas or not active');
      return;
    }

    console.log('Setting up brush tool event listeners');

    canvas.addEventListener('mousedown', handleMouseDown, { passive: false });
    canvas.addEventListener('mousemove', handleMouseMove, { passive: false });
    canvas.addEventListener('mouseup', handleMouseUp, { passive: false });
    canvas.addEventListener('contextmenu', handleContextMenu, { passive: false });

    return () => {
      console.log('Cleaning up brush tool event listeners');
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseup', handleMouseUp);
      canvas.removeEventListener('contextmenu', handleContextMenu);
    };
  }, [isActive, selectedStructure, currentBrushSize, isDrawing, isResizing, zoom, panX, panY, currentSlicePosition]);

  // Update brush size when prop changes
  useEffect(() => {
    setCurrentBrushSize(brushSize);
  }, [brushSize]);

  // Log when slice position changes
  useEffect(() => {
    console.log(`Brush tool: Slice position changed to ${currentSlicePosition}`);
  }, [currentSlicePosition]);

  return null; // This component only handles events, no visual rendering
}