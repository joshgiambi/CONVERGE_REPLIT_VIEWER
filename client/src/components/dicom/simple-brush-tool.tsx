import { useEffect, useRef, useState } from 'react';

interface SimpleBrushToolProps {
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
}: SimpleBrushToolProps) {
  console.log('Brush active?', isActive);
  const [isDrawing, setIsDrawing] = useState(false);
  const [brushMode, setBrushMode] = useState<'add' | 'delete'>('add');
  const [currentStroke, setCurrentStroke] = useState<{x: number, y: number}[]>([]);
  const [mousePosition, setMousePosition] = useState<{ x: number; y: number } | null>(null);
  const brushModeRef = useRef<'add' | 'delete'>('add');

  // Create cursor overlay canvas
  useEffect(() => {
    if (!isActive || !canvasRef.current) return;

    const mainCanvas = canvasRef.current;
    const cursorCanvas = document.createElement('canvas');
    
    // Position overlay canvas
    cursorCanvas.style.position = 'absolute';
    cursorCanvas.style.top = '0';
    cursorCanvas.style.left = '0';
    cursorCanvas.style.pointerEvents = 'none';
    cursorCanvas.style.zIndex = '999';
    
    // Match main canvas dimensions
    cursorCanvas.width = mainCanvas.width;
    cursorCanvas.height = mainCanvas.height;
    cursorCanvas.style.width = mainCanvas.style.width || `${mainCanvas.width}px`;
    cursorCanvas.style.height = mainCanvas.style.height || `${mainCanvas.height}px`;
    
    // Add to parent container
    mainCanvas.parentElement?.appendChild(cursorCanvas);
    
    const ctx = cursorCanvas.getContext('2d');
    if (!ctx) return;

    // Track mouse position and update brush mode
    const updateBrushMode = (e: MouseEvent) => {
      const rect = mainCanvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      setMousePosition({ x, y });
      const mode = detectBrushMode(x, y);
      setBrushMode(mode);
    };

    const clearCursor = () => {
      setMousePosition(null);
    };

    mainCanvas.addEventListener('mousemove', updateBrushMode);
    mainCanvas.addEventListener('mouseleave', clearCursor);
    
    return () => {
      mainCanvas.removeEventListener('mousemove', updateBrushMode);
      mainCanvas.removeEventListener('mouseleave', clearCursor);
      cursorCanvas.remove();
    };
  }, [isActive, selectedStructure, rtStructures, currentSlicePosition]);

  // Draw cursor overlay
  useEffect(() => {
    if (!isActive || !canvasRef.current) return;

    const mainCanvas = canvasRef.current;
    const cursorCanvas = mainCanvas.parentElement?.querySelector('canvas[style*="z-index: 999"]') as HTMLCanvasElement;
    if (!cursorCanvas) return;

    const ctx = cursorCanvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, cursorCanvas.width, cursorCanvas.height);

    // Draw cursor if mouse is over canvas
    if (mousePosition) {
      const color = brushMode === 'add' ? '#10b981' : '#ef4444';
      
      ctx.beginPath();
      ctx.arc(mousePosition.x, mousePosition.y, brushSize, 0, 2 * Math.PI);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }, [isActive, mousePosition, brushMode, brushSize]);

  const detectBrushMode = (canvasX: number, canvasY: number): 'add' | 'delete' => {
    if (!selectedStructure || !rtStructures || !currentImage) return 'add';
    
    // Convert canvas coordinates to DICOM world coordinates
    const worldCoords = canvasToWorld(canvasX, canvasY);
    if (!worldCoords) return 'add';

    // Find the selected structure
    const structure = rtStructures.structures.find((s: any) => s.roiNumber === selectedStructure);
    if (!structure) return 'add';

    // Check if brush is touching any contour of the selected structure on current slice
    const tolerance = 2.0; // mm tolerance for slice matching
    const brushTolerance = brushSize * 0.5; // pixels converted to mm

    for (const contour of structure.contours) {
      if (Math.abs(contour.slicePosition - currentSlicePosition) <= tolerance) {
        // Check if brush center is near any contour point
        for (let i = 0; i < contour.points.length; i += 3) {
          const pointX = contour.points[i];
          const pointY = contour.points[i + 1];
          
          const distance = Math.sqrt(
            Math.pow(worldCoords.x - pointX, 2) + 
            Math.pow(worldCoords.y - pointY, 2)
          );
          
          if (distance <= brushTolerance) {
            return 'add'; // Green brush - touching existing contour
          }
        }
      }
    }
    
    return 'delete'; // Red brush - not touching contour
  };

  const canvasToWorld = (canvasX: number, canvasY: number) => {
    if (!currentImage || !imageMetadata) return null;

    const canvas = canvasRef.current;
    if (!canvas) return null;

    // Get image dimensions
    const imageWidth = currentImage.width || 512;
    const imageHeight = currentImage.height || 512;

    // Calculate scaling (same as image rendering)
    const baseScale = Math.max(canvas.width / imageWidth, canvas.height / imageHeight);
    const totalScale = baseScale * zoom;
    const scaledWidth = imageWidth * totalScale;
    const scaledHeight = imageHeight * totalScale;

    // Calculate image position with pan offset
    const imageX = (canvas.width - scaledWidth) / 2 + panX;
    const imageY = (canvas.height - scaledHeight) / 2 + panY;

    // Convert canvas coordinates to image pixel coordinates
    const pixelX = (canvasX - imageX) / totalScale;
    const pixelY = (canvasY - imageY) / totalScale;

    // Convert to DICOM world coordinates using spatial metadata
    if (imageMetadata.imagePosition && imageMetadata.pixelSpacing && imageMetadata.imageOrientation) {
      const imagePosition = imageMetadata.imagePosition.split('\\').map(Number);
      const pixelSpacing = imageMetadata.pixelSpacing.split('\\').map(Number);
      const imageOrientation = imageMetadata.imageOrientation.split('\\').map(Number);

      // Apply the same coordinate transformation as contour rendering
      const worldX = imagePosition[0] + (pixelX * pixelSpacing[1] * imageOrientation[0]) + (pixelY * pixelSpacing[0] * imageOrientation[3]);
      const worldY = imagePosition[1] + (pixelX * pixelSpacing[1] * imageOrientation[1]) + (pixelY * pixelSpacing[0] * imageOrientation[4]);

      return { x: worldX, y: worldY };
    }

    return null;
  };

  const handleMouseDown = (e: MouseEvent) => {
    if (!isActive || !selectedStructure) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    setIsDrawing(true);
    brushModeRef.current = brushMode; // Lock brush mode for this stroke
    
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    setCurrentStroke([{ x, y }]);
    console.log('Brush tool mouse down:', { x, y, brushMode });
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isDrawing || !isActive || !selectedStructure) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    setCurrentStroke(prev => {
      const newStroke = [...prev, { x, y }];
      console.log('Brush tool drawing:', { x, y, strokeLength: newStroke.length });
      return newStroke;
    });
  };

  const handleMouseUp = () => {
    if (!isDrawing || !selectedStructure || !rtStructures) return;
    
    console.log('Brush tool mouse up, stroke length:', currentStroke.length);
    setIsDrawing(false);
    
    // Convert stroke to contour points and update RT structures
    if (currentStroke.length > 1) {
      updateRTStructureContour();
    }
    
    setCurrentStroke([]);
  };

  const updateRTStructureContour = () => {
    if (!selectedStructure || !rtStructures || currentStroke.length === 0) return;

    const updatedRTStructures = JSON.parse(JSON.stringify(rtStructures));
    const structure = updatedRTStructures.structures.find((s: any) => s.roiNumber === selectedStructure);
    
    if (!structure) return;

    // Convert stroke points to DICOM world coordinates
    const worldPoints: number[] = [];
    
    for (const point of currentStroke) {
      const worldCoords = canvasToWorld(point.x, point.y);
      if (worldCoords) {
        worldPoints.push(worldCoords.x, worldCoords.y, currentSlicePosition);
      }
    }

    if (worldPoints.length < 9) return; // Need at least 3 points (x,y,z each)

    if (brushModeRef.current === 'add') {
      // Add new contour or extend existing one
      const existingContourIndex = structure.contours.findIndex((c: any) => 
        Math.abs(c.slicePosition - currentSlicePosition) <= 2.0
      );

      if (existingContourIndex !== -1) {
        // Extend existing contour
        structure.contours[existingContourIndex].points.push(...worldPoints);
        structure.contours[existingContourIndex].numberOfPoints = structure.contours[existingContourIndex].points.length / 3;
      } else {
        // Create new contour
        structure.contours.push({
          slicePosition: currentSlicePosition,
          points: worldPoints,
          numberOfPoints: worldPoints.length / 3
        });
      }
    } else {
      // Delete mode - remove points near the stroke
      structure.contours.forEach((contour: any) => {
        if (Math.abs(contour.slicePosition - currentSlicePosition) <= 2.0) {
          const filteredPoints: number[] = [];
          
          for (let i = 0; i < contour.points.length; i += 3) {
            const pointX = contour.points[i];
            const pointY = contour.points[i + 1];
            const pointZ = contour.points[i + 2];
            
            let shouldKeepPoint = true;
            
            // Check if this point is near any stroke point
            for (const strokePoint of currentStroke) {
              const worldCoords = canvasToWorld(strokePoint.x, strokePoint.y);
              if (worldCoords) {
                const distance = Math.sqrt(
                  Math.pow(worldCoords.x - pointX, 2) + 
                  Math.pow(worldCoords.y - pointY, 2)
                );
                
                if (distance <= brushSize * 0.5) {
                  shouldKeepPoint = false;
                  break;
                }
              }
            }
            
            if (shouldKeepPoint) {
              filteredPoints.push(pointX, pointY, pointZ);
            }
          }
          
          contour.points = filteredPoints;
          contour.numberOfPoints = filteredPoints.length / 3;
        }
      });
      
      // Remove empty contours
      structure.contours = structure.contours.filter((c: any) => c.numberOfPoints > 0);
    }

    // Update the RT structures
    onContourUpdate(updatedRTStructures);
  };

  // Set up mouse event listeners when active
  useEffect(() => {
    if (!isActive || !canvasRef.current) return;

    const canvas = canvasRef.current;
    
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('mouseleave', handleMouseUp);
    
    return () => {
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseup', handleMouseUp);
      canvas.removeEventListener('mouseleave', handleMouseUp);
    };
  }, [isActive, isDrawing, brushMode, selectedStructure, currentStroke]);

  return null; // This component doesn't render anything visible
}