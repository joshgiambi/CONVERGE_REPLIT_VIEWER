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
  const [isDrawing, setIsDrawing] = useState(false);
  const [brushMode, setBrushMode] = useState<'add' | 'delete'>('add');
  const [currentStroke, setCurrentStroke] = useState<{x: number, y: number}[]>([]);
  const brushModeRef = useRef<'add' | 'delete'>('add');

  // Update brush mode based on contour intersection when tool becomes active
  useEffect(() => {
    if (!isActive || !canvasRef.current || !selectedStructure || !rtStructures) return;

    const canvas = canvasRef.current;
    const updateBrushMode = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      const mode = detectBrushMode(x, y);
      setBrushMode(mode);
      canvas.style.cursor = mode === 'add' ? 
        `url("data:image/svg+xml,${encodeURIComponent(`
          <svg xmlns='http://www.w3.org/2000/svg' width='${brushSize * 2}' height='${brushSize * 2}' viewBox='0 0 ${brushSize * 2} ${brushSize * 2}'>
            <circle cx='${brushSize}' cy='${brushSize}' r='${brushSize - 1}' fill='none' stroke='#10b981' stroke-width='2'/>
          </svg>
        `)}")` : 
        `url("data:image/svg+xml,${encodeURIComponent(`
          <svg xmlns='http://www.w3.org/2000/svg' width='${brushSize * 2}' height='${brushSize * 2}' viewBox='0 0 ${brushSize * 2} ${brushSize * 2}'>
            <circle cx='${brushSize}' cy='${brushSize}' r='${brushSize - 1}' fill='none' stroke='#ef4444' stroke-width='2'/>
          </svg>
        `)}")`;
    };

    canvas.addEventListener('mousemove', updateBrushMode);
    return () => canvas.removeEventListener('mousemove', updateBrushMode);
  }, [isActive, brushSize, selectedStructure, rtStructures, currentSlicePosition]);

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

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!isActive || !selectedStructure) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    setIsDrawing(true);
    brushModeRef.current = brushMode; // Lock brush mode for this stroke
    
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    setCurrentStroke([{ x, y }]);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDrawing || !isActive || !selectedStructure) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    setCurrentStroke(prev => [...prev, { x, y }]);
  };

  const handleMouseUp = () => {
    if (!isDrawing || !selectedStructure || !rtStructures) return;
    
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
    
    canvas.addEventListener('mousedown', handleMouseDown as any);
    canvas.addEventListener('mousemove', handleMouseMove as any);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('mouseleave', handleMouseUp);
    
    return () => {
      canvas.removeEventListener('mousedown', handleMouseDown as any);
      canvas.removeEventListener('mousemove', handleMouseMove as any);
      canvas.removeEventListener('mouseup', handleMouseUp);
      canvas.removeEventListener('mouseleave', handleMouseUp);
    };
  }, [isActive, isDrawing, brushMode, selectedStructure, currentStroke]);

  return null; // This component doesn't render anything visible
}