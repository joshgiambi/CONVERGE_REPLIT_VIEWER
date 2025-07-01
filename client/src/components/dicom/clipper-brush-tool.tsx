import { useEffect, useRef, useState } from 'react';
import { loadNativeClipperLibInstanceAsync, ClipperLibWrapper, ClipType, EndType, JoinType, PolyFillType, PointInPolygonResult } from 'js-angusj-clipper';

// Medical imaging scaling factor for precision (matches Limbus V2)
const SCALING_FACTOR = 1000;

export enum BrushOperation {
  ADDITIVE = 'ADDITIVE',
  SUBTRACTIVE = 'SUBTRACTIVE',
}

interface ClipperBrushToolProps {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  isActive: boolean;
  brushSize: number;
  selectedStructure: number | null;
  rtStructures: any;
  currentSlicePosition: number;
  onContourUpdate: (updatedRTStructures: any) => void;
  onBrushSizeChange: (size: number) => void;
  zoom: number;
  panX: number;
  panY: number;
  currentImage: any;
  imageMetadata: any;
}

export function ClipperBrushTool({
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
}: ClipperBrushToolProps) {
  const [isDrawing, setIsDrawing] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [operation, setOperation] = useState<BrushOperation>(BrushOperation.ADDITIVE);
  const [operationLocked, setOperationLocked] = useState(false);
  const [currentStroke, setCurrentStroke] = useState<{x: number, y: number}[]>([]);
  const [mousePosition, setMousePosition] = useState<{ x: number; y: number } | null>(null);
  const [lastPosition, setLastPosition] = useState<{ x: number; y: number } | null>(null);
  const [shiftPressed, setShiftPressed] = useState(false);
  const [ctrlPressed, setCtrlPressed] = useState(false);
  const [fillMode, setFillMode] = useState(true);
  const [clipperLib, setClipperLib] = useState<ClipperLibWrapper | null>(null);

  // Initialize ClipperLib
  useEffect(() => {
    let mounted = true;
    
    const initClipperLib = async () => {
      try {
        const lib = await loadNativeClipperLibInstanceAsync();
        if (mounted) {
          setClipperLib(lib);
          console.log('ClipperLib loaded successfully');
        }
      } catch (error) {
        console.error('Failed to load ClipperLib:', error);
      }
    };

    initClipperLib();
    
    return () => {
      mounted = false;
    };
  }, []);

  // Convert world coordinates to scaled integer coordinates (Limbus V2 approach)
  const worldToScaled = (worldX: number, worldY: number): { x: number; y: number } => ({
    x: Math.round(worldX * SCALING_FACTOR),
    y: Math.round(worldY * SCALING_FACTOR),
  });

  // Convert scaled coordinates back to world coordinates
  const scaledToWorld = (scaledX: number, scaledY: number): { x: number; y: number } => ({
    x: scaledX / SCALING_FACTOR,
    y: scaledY / SCALING_FACTOR,
  });

  // Generate 32-point circle for brush outline (professional medical standard)
  const getBrushPoints = (centerX: number, centerY: number): { x: number; y: number }[] => {
    const points: { x: number; y: number }[] = [];
    const steps = 32; // Professional medical imaging standard
    const radius = brushSize / 2;

    for (let i = 0; i < steps; i++) {
      const angle = (i / steps) * Math.PI * 2;
      points.push({
        x: centerX + Math.cos(angle) * radius,
        y: centerY + Math.sin(angle) * radius,
      });
    }
    
    return points;
  };

  // Convert canvas coordinates to DICOM world coordinates
  const canvasToWorld = (canvasX: number, canvasY: number) => {
    if (!currentImage || !imageMetadata) return null;

    const canvas = canvasRef.current;
    if (!canvas) return null;

    const imageWidth = currentImage.width || 512;
    const imageHeight = currentImage.height || 512;

    const baseScale = Math.max(canvas.width / imageWidth, canvas.height / imageHeight);
    const totalScale = baseScale * zoom;
    const scaledWidth = imageWidth * totalScale;
    const scaledHeight = imageHeight * totalScale;

    const imageX = (canvas.width - scaledWidth) / 2 + panX;
    const imageY = (canvas.height - scaledHeight) / 2 + panY;

    const pixelX = (canvasX - imageX) / totalScale;
    const pixelY = (canvasY - imageY) / totalScale;

    if (imageMetadata.imagePosition && imageMetadata.pixelSpacing && imageMetadata.imageOrientation) {
      const imagePosition = imageMetadata.imagePosition.split('\\').map(Number);
      const pixelSpacing = imageMetadata.pixelSpacing.split('\\').map(Number);
      const imageOrientation = imageMetadata.imageOrientation.split('\\').map(Number);

      const worldX = imagePosition[0] + (pixelX * pixelSpacing[1] * imageOrientation[0]) + (pixelY * pixelSpacing[0] * imageOrientation[3]);
      const worldY = imagePosition[1] + (pixelX * pixelSpacing[1] * imageOrientation[1]) + (pixelY * pixelSpacing[0] * imageOrientation[4]);

      return { x: worldX, y: worldY };
    }

    return null;
  };

  // Get current contour as scaled polygon paths (Limbus V2 format)
  const getCurrentContourPolygons = (): any[] => {
    if (!selectedStructure || !rtStructures) return [];

    const structure = rtStructures.structures.find((s: any) => s.roiNumber === selectedStructure);
    if (!structure) return [];

    const tolerance = 2.0;
    const polygons: any[] = [];

    for (const contour of structure.contours) {
      if (Math.abs(contour.slicePosition - currentSlicePosition) <= tolerance && contour.numberOfPoints > 0) {
        const path: { X: number; Y: number }[] = [];
        
        // Convert DICOM contour points to scaled polygon
        for (let i = 0; i < contour.points.length; i += 3) {
          const worldX = contour.points[i];
          const worldY = contour.points[i + 1];
          path.push(worldToScaled(worldX, worldY));
        }
        
        if (path.length > 2) {
          polygons.push(path);
        }
      }
    }

    return polygons;
  };

  // Professional point-in-polygon test using ClipperLib
  const isInsideContour = (canvasX: number, canvasY: number): boolean => {
    if (!clipperLib) return false;
    
    const worldCoords = canvasToWorld(canvasX, canvasY);
    if (!worldCoords) return false;

    const polygons = getCurrentContourPolygons();
    if (polygons.length === 0) return false;

    const testPoint = worldToScaled(worldCoords.x, worldCoords.y);
    
    let insideCount = 0;
    for (const polygon of polygons) {
      try {
        const result = clipperLib.pointInPolygon(testPoint, polygon);
        if (result === clipperLib.PointInPolygonResult.Inside) {
          insideCount++;
        }
      } catch (error) {
        console.warn('Point-in-polygon test failed:', error);
      }
    }

    // Use odd/even rule for complex polygons
    return insideCount % 2 === 1;
  };

  // Update brush operation based on Limbus V2 logic
  const updateBrushOperation = (canvasX: number, canvasY: number) => {
    if (operationLocked) return;

    const polygons = getCurrentContourPolygons();
    
    if (polygons.length === 0) {
      setOperation(BrushOperation.ADDITIVE);
      return;
    }

    const inside = isInsideContour(canvasX, canvasY);
    
    if (shiftPressed) {
      // Shift inverts behavior (Limbus V2 standard)
      setOperation(inside ? BrushOperation.SUBTRACTIVE : BrushOperation.ADDITIVE);
    } else {
      // Default behavior: inside = add (fill holes), outside = subtract
      setOperation(inside ? BrushOperation.ADDITIVE : BrushOperation.SUBTRACTIVE);
    }
  };

  // Create brush stroke polygon using offset operations (Limbus V2 approach)
  const createBrushStroke = (strokePoints: { x: number; y: number }[]): any[] => {
    if (!clipperLib || strokePoints.length < 2) return [];

    // Convert stroke to world coordinates
    const worldStroke: { X: number; Y: number }[] = [];
    for (const point of strokePoints) {
      const worldCoords = canvasToWorld(point.x, point.y);
      if (worldCoords) {
        worldStroke.push(worldToScaled(worldCoords.x, worldCoords.y));
      }
    }

    if (worldStroke.length < 2) return [];

    try {
      // Create rounded brush stroke using offset operation
      const offsetDelta = Math.round((brushSize / 2) * SCALING_FACTOR);
      
      const offsetResult = clipperLib.offsetToPaths({
        delta: offsetDelta,
        offsetInputs: [{
          data: [worldStroke],
          joinType: clipperLib.JoinType.Round,
          endType: clipperLib.EndType.OpenRound,
        }],
      });

      return offsetResult || [];
    } catch (error) {
      console.error('Brush stroke creation failed:', error);
      return [];
    }
  };

  // Apply boolean operations to update contours (Limbus V2 approach)
  const updateRTStructureWithPolygons = () => {
    if (!clipperLib || !selectedStructure || !rtStructures || currentStroke.length < 2) return;

    const brushStroke = createBrushStroke(currentStroke);
    if (brushStroke.length === 0) return;

    const currentPolygons = getCurrentContourPolygons();
    
    try {
      let resultPolygons: any[];

      if (operation === BrushOperation.ADDITIVE) {
        // Union operation for additive mode
        if (currentPolygons.length === 0) {
          resultPolygons = brushStroke;
        } else {
          resultPolygons = clipperLib.clipToPaths({
            clipType: clipperLib.ClipType.Union,
            subjectInputs: currentPolygons.map((polygon: any) => ({ data: polygon, closed: true })),
            clipInputs: brushStroke.map((polygon: any) => ({ data: polygon, closed: true })),
            subjectFillType: clipperLib.PolyFillType.NonZero,
          });
        }
      } else {
        // Difference operation for subtractive mode
        if (currentPolygons.length === 0) return; // Nothing to subtract from
        
        resultPolygons = clipperLib.clipToPaths({
          clipType: clipperLib.ClipType.Difference,
          subjectInputs: currentPolygons.map((polygon: any) => ({ data: polygon, closed: true })),
          clipInputs: brushStroke.map((polygon: any) => ({ data: polygon, closed: true })),
          subjectFillType: clipperLib.PolyFillType.NonZero,
        });
      }

      // Clean and simplify polygons (professional quality)
      resultPolygons = clipperLib.cleanPolygons(resultPolygons, 2);
      resultPolygons = clipperLib.simplifyPolygons(resultPolygons, clipperLib.PolyFillType.NonZero);

      // Handle fill mode for additive operations
      if (fillMode && operation === BrushOperation.ADDITIVE) {
        // Keep only exterior rings (remove holes)
        resultPolygons = resultPolygons.filter((_: any, index: number) => index % 2 === 0);
      }

      // Update RT structure data
      updateRTStructureData(resultPolygons);
      
      console.log('Professional polygon brush operation completed:', { 
        operation, 
        inputPolygons: currentPolygons.length, 
        resultPolygons: resultPolygons.length 
      });

    } catch (error) {
      console.error('Polygon operation failed:', error);
    }
  };

  // Update RT structure data with new polygons
  const updateRTStructureData = (polygons: any[]) => {
    const updatedRTStructures = JSON.parse(JSON.stringify(rtStructures));
    const structure = updatedRTStructures.structures.find((s: any) => s.roiNumber === selectedStructure);
    
    if (!structure) return;

    // Remove existing contours on current slice
    const tolerance = 2.0;
    structure.contours = structure.contours.filter((contour: any) => 
      Math.abs(contour.slicePosition - currentSlicePosition) > tolerance
    );

    // Add new contours from polygons
    for (const polygon of polygons) {
      if (polygon.length > 2) {
        const points: number[] = [];
        
        // Convert scaled polygon back to DICOM coordinates
        for (const point of polygon) {
          const worldCoords = scaledToWorld(point.X, point.Y);
          points.push(worldCoords.x, worldCoords.y, currentSlicePosition);
        }
        
        if (points.length >= 9) { // At least 3 points
          structure.contours.push({
            slicePosition: currentSlicePosition,
            points: points,
            numberOfPoints: points.length / 3
          });
        }
      }
    }

    onContourUpdate(updatedRTStructures);
  };

  // Create cursor overlay canvas
  useEffect(() => {
    if (!isActive || !canvasRef.current) return;

    const mainCanvas = canvasRef.current;
    const cursorCanvas = document.createElement('canvas');
    
    cursorCanvas.style.position = 'absolute';
    cursorCanvas.style.top = '0';
    cursorCanvas.style.left = '0';
    cursorCanvas.style.pointerEvents = 'none';
    cursorCanvas.style.zIndex = '999';
    
    cursorCanvas.width = mainCanvas.width;
    cursorCanvas.height = mainCanvas.height;
    cursorCanvas.style.width = mainCanvas.style.width || `${mainCanvas.width}px`;
    cursorCanvas.style.height = mainCanvas.style.height || `${mainCanvas.height}px`;
    
    mainCanvas.parentElement?.appendChild(cursorCanvas);
    
    return () => {
      cursorCanvas.remove();
    };
  }, [isActive, selectedStructure]);

  // Professional cursor rendering with medical imaging standards
  useEffect(() => {
    if (!isActive || !canvasRef.current) return;

    const mainCanvas = canvasRef.current;
    const cursorCanvas = mainCanvas.parentElement?.querySelector('canvas[style*="z-index: 999"]') as HTMLCanvasElement;
    if (!cursorCanvas) return;

    const ctx = cursorCanvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, cursorCanvas.width, cursorCanvas.height);

    if (mousePosition) {
      const isAdditive = operation === BrushOperation.ADDITIVE;
      const brushColor = isAdditive ? '#00ff00' : '#ff0000'; // Green/Red medical standard
      const opacity = isResizing ? 0.8 : 0.6;

      // Draw 32-point brush circle outline (medical standard)
      const brushPoints = getBrushPoints(mousePosition.x, mousePosition.y);
      
      ctx.strokeStyle = brushColor;
      ctx.globalAlpha = opacity;
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      
      ctx.beginPath();
      ctx.moveTo(brushPoints[0].x, brushPoints[0].y);
      for (let i = 1; i < brushPoints.length; i++) {
        ctx.lineTo(brushPoints[i].x, brushPoints[i].y);
      }
      ctx.closePath();
      ctx.stroke();

      // Professional medical cursor indicators
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = 1;
      ctx.strokeStyle = brushColor;
      
      const crossSize = Math.min(brushSize / 6, 10);
      
      if (isAdditive) {
        // Full crosshair for additive (Limbus V2 standard)
        ctx.beginPath();
        ctx.moveTo(mousePosition.x - crossSize, mousePosition.y);
        ctx.lineTo(mousePosition.x + crossSize, mousePosition.y);
        ctx.moveTo(mousePosition.x, mousePosition.y - crossSize);
        ctx.lineTo(mousePosition.x, mousePosition.y + crossSize);
        ctx.stroke();
      } else {
        // Horizontal line for subtractive (Limbus V2 standard)
        ctx.beginPath();
        ctx.moveTo(mousePosition.x - crossSize, mousePosition.y);
        ctx.lineTo(mousePosition.x + crossSize, mousePosition.y);
        ctx.stroke();
      }

      // Resize indicator during pointer lock
      if (isResizing) {
        ctx.globalAlpha = 0.4;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.arc(mousePosition.x, mousePosition.y, brushSize / 2 + 8, 0, 2 * Math.PI);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.globalAlpha = 1.0;
    }
  }, [isActive, mousePosition, operation, brushSize, isResizing]);

  // Mouse event handlers with professional medical standards
  const handleMouseDown = (e: MouseEvent) => {
    if (!isActive || !selectedStructure || !clipperLib) return;
    
    e.preventDefault();
    e.stopImmediatePropagation();
    
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    if (e.button === 2) { // Right click - professional brush sizing
      setIsResizing(true);
      setLastPosition({ x, y });
      
      // Request pointer lock for smooth professional experience
      canvasRef.current?.requestPointerLock();
      
      console.log('Professional ClipperLib brush resizing started');
      return;
    }
    
    if (e.button === 0) { // Left click - polygon drawing
      setIsDrawing(true);
      setOperationLocked(true);
      updateBrushOperation(x, y);
      setCurrentStroke([{ x, y }]);
      setLastPosition({ x, y });
      console.log('Professional ClipperLib brush drawing started:', { operation });
    }
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isActive || !selectedStructure) return;
    
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    setMousePosition({ x, y });
    
    if (!operationLocked) {
      updateBrushOperation(x, y);
    }
    
    if (isResizing && lastPosition) {
      e.preventDefault();
      e.stopImmediatePropagation();
      
      // Professional smooth resizing with movement deltas
      const deltaX = e.movementX || 0;
      const deltaY = e.movementY || 0;
      const delta = (deltaX - deltaY) * 0.4; // Professional sensitivity
      
      const newSize = Math.max(1, Math.min(100, brushSize + delta));
      onBrushSizeChange(newSize);
      return;
    }
    
    if (isDrawing) {
      e.preventDefault();
      e.stopImmediatePropagation();
      
      setCurrentStroke(prev => [...prev, { x, y }]);
      setLastPosition({ x, y });
    }
  };

  const handleMouseUp = (e: MouseEvent) => {
    if (!isActive || !selectedStructure) return;
    
    e.preventDefault();
    e.stopImmediatePropagation();
    
    if (isResizing) {
      setIsResizing(false);
      setLastPosition(null);
      document.exitPointerLock();
      console.log('Professional ClipperLib brush resize complete');
      return;
    }
    
    if (isDrawing && rtStructures && clipperLib) {
      console.log('Professional ClipperLib brush stroke completing:', { operation, strokeLength: currentStroke.length });
      setIsDrawing(false);
      setOperationLocked(false);
      
      if (currentStroke.length > 1) {
        updateRTStructureWithPolygons();
      }
      
      setCurrentStroke([]);
      setLastPosition(null);
    }
  };

  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault();
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Shift') {
      setShiftPressed(true);
    }
    if (e.key === 'Control' || e.key === 'Meta') {
      setCtrlPressed(true);
      setFillMode(false); // Disable fill mode with Ctrl (Limbus V2 standard)
    }
  };

  const handleKeyUp = (e: KeyboardEvent) => {
    if (e.key === 'Shift') {
      setShiftPressed(false);
    }
    if (e.key === 'Control' || e.key === 'Meta') {
      setCtrlPressed(false);
      setFillMode(true);
    }
  };

  const handleWheel = (e: WheelEvent) => {
    if (!ctrlPressed) return; // Ctrl+Wheel for brush sizing (Limbus V2 standard)
    
    e.preventDefault();
    e.stopImmediatePropagation();
    
    const delta = e.deltaY > 0 ? -2 : 2;
    const newSize = Math.max(1, Math.min(100, brushSize + delta));
    onBrushSizeChange(newSize);
  };

  // Event listener setup
  useEffect(() => {
    if (!isActive || !canvasRef.current || !clipperLib) return;

    const canvas = canvasRef.current;
    
    canvas.addEventListener('mousedown', handleMouseDown, { capture: true });
    canvas.addEventListener('mousemove', handleMouseMove, { capture: true });
    canvas.addEventListener('mouseup', handleMouseUp, { capture: true });
    canvas.addEventListener('mouseleave', handleMouseUp, { capture: true });
    canvas.addEventListener('contextmenu', handleContextMenu, { capture: true });
    canvas.addEventListener('wheel', handleWheel, { capture: true });
    
    console.log('Professional ClipperLib polygon brush tool activated');
    
    return () => {
      canvas.removeEventListener('mousedown', handleMouseDown, { capture: true });
      canvas.removeEventListener('mousemove', handleMouseMove, { capture: true });
      canvas.removeEventListener('mouseup', handleMouseUp, { capture: true });
      canvas.removeEventListener('mouseleave', handleMouseUp, { capture: true });
      canvas.removeEventListener('contextmenu', handleContextMenu, { capture: true });
      canvas.removeEventListener('wheel', handleWheel, { capture: true });
      console.log('Professional ClipperLib polygon brush tool deactivated');
    };
  }, [isActive, isDrawing, isResizing, operation, selectedStructure, currentStroke, brushSize, shiftPressed, ctrlPressed, clipperLib]);

  // Keyboard event setup
  useEffect(() => {
    if (!isActive) return;

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
    };
  }, [isActive]);

  return null;
}