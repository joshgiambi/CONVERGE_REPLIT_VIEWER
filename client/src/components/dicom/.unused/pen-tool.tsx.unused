import React, { useEffect, useRef, useState, useCallback } from 'react';
import { worldToCanvas } from '@/lib/dicom-coordinates';

interface PenToolProps {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  isActive: boolean;
  selectedStructure: number;
  rtStructures: any;
  currentSlicePosition: number;
  onContourUpdate: (payload: any) => void;
  zoom: number;
  panX: number;
  panY: number;
  imageMetadata: any;
}

interface PenPoint {
  canvas: { x: number; y: number };
  world: { x: number; y: number; z: number };
}

export function PenTool({
  canvasRef,
  isActive,
  selectedStructure,
  rtStructures,
  currentSlicePosition,
  onContourUpdate,
  zoom,
  panX,
  panY,
  imageMetadata
}: PenToolProps) {
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const [currentPoints, setCurrentPoints] = useState<PenPoint[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isDrawing, setIsDrawing] = useState(false);
  const [draggedPointIndex, setDraggedPointIndex] = useState<number | null>(null);
  const [hoverPointIndex, setHoverPointIndex] = useState<number | null>(null);
  const [isInsideContour, setIsInsideContour] = useState(false);
  const [showPreview, setShowPreview] = useState(true);
  const [hoveredContour, setHoveredContour] = useState<any | null>(null);
  const [hoveredContourPoints, setHoveredContourPoints] = useState<PenPoint[]>([]);

  // Update overlay canvas size
  useEffect(() => {
    if (!canvasRef.current || !overlayCanvasRef.current) return;
    
    const canvas = canvasRef.current;
    const overlay = overlayCanvasRef.current;
    
    overlay.width = canvas.offsetWidth;
    overlay.height = canvas.offsetHeight;
    overlay.style.position = 'absolute';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.pointerEvents = isActive ? 'auto' : 'none';
    overlay.style.cursor = isActive ? 'crosshair' : 'default';
    
    // Allow wheel events to pass through for scrolling
    const handleWheel = (e: WheelEvent) => {
      e.stopPropagation(); // Stop propagation but don't prevent default
    };
    
    overlay.addEventListener('wheel', handleWheel, { passive: true });
    
    return () => {
      overlay.removeEventListener('wheel', handleWheel);
    };
  }, [canvasRef, isActive, zoom, panX, panY]);

  // Get selected structure
  const getSelectedStructure = useCallback(() => {
    if (!rtStructures?.structures) return null;
    return rtStructures.structures.find((s: any) => s.roiNumber === selectedStructure);
  }, [rtStructures, selectedStructure]);

  // Convert canvas coordinates to world coordinates
  const canvasToWorld = useCallback((canvasX: number, canvasY: number) => {
    if (!imageMetadata || !canvasRef.current) return null;

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    
    // Get relative position within canvas (0-1)
    const relX = canvasX / rect.width;
    const relY = canvasY / rect.height;

    // SIMPLIFIED - NO ZOOM FOR DEBUGGING
    const imgWidth = 512;
    const imgHeight = 512;
    const baseScale = Math.min(canvas.width / imgWidth, canvas.height / imgHeight); // = 2 for 512x512 in 1024x1024
    
    // Only apply base scale, no zoom or pan
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    
    const transformedX = (canvasX - centerX) / baseScale + centerX;
    const transformedY = (canvasY - centerY) / baseScale + centerY;
    
    const adjustedRelX = transformedX / rect.width;
    const adjustedRelY = transformedY / rect.height;

    // Convert to DICOM coordinates
    const pixelSpacing = imageMetadata.pixelSpacing?.split('\\').map(Number) || [1.171875, 1.171875];
    const imagePosition = imageMetadata.imagePosition?.split('\\').map(Number) || [-300, -300, currentSlicePosition];

    // DICOM pixel spacing is [row spacing, column spacing] = [deltaY, deltaX]
    const worldX = imagePosition[0] + (adjustedRelX * imgWidth * pixelSpacing[1]); // column spacing
    const worldY = imagePosition[1] + (adjustedRelY * imgHeight * pixelSpacing[0]); // row spacing
    const worldZ = currentSlicePosition;

    return { x: worldX, y: worldY, z: worldZ };
  }, [imageMetadata, currentSlicePosition, zoom, panX, panY, canvasRef]);

  // Check if point is inside existing contour
  const checkInsideContour = useCallback((worldX: number, worldY: number) => {
    const structure = getSelectedStructure();
    if (!structure?.contours) return false;

    // Find contours on current slice
    const tolerance = 1.5; // mm
    const sliceContours = structure.contours.filter((c: any) => 
      Math.abs(c.slicePosition - currentSlicePosition) <= tolerance
    );

    // Simple point-in-polygon test for each contour
    for (const contour of sliceContours) {
      const points = contour.points;
      let inside = false;
      
      for (let i = 0, j = points.length / 3 - 1; i < points.length / 3; j = i++) {
        const xi = points[i * 3];
        const yi = points[i * 3 + 1];
        const xj = points[j * 3];
        const yj = points[j * 3 + 1];
        
        const intersect = ((yi > worldY) !== (yj > worldY))
          && (worldX < (xj - xi) * (worldY - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
      }
      
      if (inside) return true;
    }
    
    return false;
  }, [getSelectedStructure, currentSlicePosition]);

  // Find nearest point on contour
  const findNearestContourPoint = useCallback((canvasX: number, canvasY: number) => {
    const structure = getSelectedStructure();
    if (!structure?.contours || !imageMetadata) return null;

    const tolerance = 1.5; // mm
    const sliceContours = structure.contours.filter((c: any) => 
      Math.abs(c.slicePosition - currentSlicePosition) <= tolerance
    );

    let nearestPoint = null;
    let minDistance = 20; // pixels threshold

    for (const contour of sliceContours) {
      for (let i = 0; i < contour.points.length; i += 3) {
        const worldPoint = {
          x: contour.points[i],
          y: contour.points[i + 1],
          z: contour.points[i + 2]
        };

        const imagePosition = imageMetadata.imagePosition?.split('\\').map(Number) || [-300, -300, currentSlicePosition];
        const pixelSpacing = imageMetadata.pixelSpacing?.split('\\').map(Number) || [1.171875, 1.171875];
        
        const canvasPoint = worldToCanvas(
          worldPoint.x,
          worldPoint.y,
          imagePosition,
          pixelSpacing,
          canvasRef.current!.width,
          canvasRef.current!.height
        );

        if (canvasPoint) {
          // Calculate base scale to match contour rendering
          const imgWidth = 512;
          const imgHeight = 512;
          const canvasWidth = canvasRef.current!.width;
          const canvasHeight = canvasRef.current!.height;
          const baseScale = Math.min(canvasWidth / imgWidth, canvasHeight / imgHeight); // = 2
          
          // Apply zoom and pan to canvas point  
          const rect = overlayCanvasRef.current!.getBoundingClientRect();
          const centerX = rect.width / 2;
          const centerY = rect.height / 2;
          
          // SIMPLIFIED - NO ZOOM FOR DEBUGGING
          const displayX = (canvasPoint[0] - centerX) * baseScale + centerX;
          const displayY = (canvasPoint[1] - centerY) * baseScale + centerY;

          const dist = Math.sqrt(
            Math.pow(displayX - canvasX, 2) + 
            Math.pow(displayY - canvasY, 2)
          );

          if (dist < minDistance) {
            minDistance = dist;
            nearestPoint = {
              index: i / 3,
              contour: contour,
              worldPoint: worldPoint,
              canvasPoint: { x: displayX, y: displayY }
            };
          }
        }
      }
    }

    return nearestPoint;
  }, [getSelectedStructure, currentSlicePosition, imageMetadata, zoom, panX, panY]);

  // Draw overlay
  const drawOverlay = useCallback(() => {
    if (!overlayCanvasRef.current || !isActive) return;

    const ctx = overlayCanvasRef.current.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, overlayCanvasRef.current.width, overlayCanvasRef.current.height);

    const structure = getSelectedStructure();
    if (!structure) return;

    const color = structure.color || [255, 255, 0];
    const [r, g, b] = color;

    // Draw current pen points
    if (currentPoints.length > 0) {
      ctx.strokeStyle = isInsideContour ? 
        `rgba(${r}, ${g}, ${b}, 0.8)` : 
        `rgba(255, 100, 100, 0.8)`;
      ctx.fillStyle = isInsideContour ? 
        `rgba(${r}, ${g}, ${b}, 0.3)` : 
        `rgba(255, 100, 100, 0.3)`;
      ctx.lineWidth = 2;

      // Draw lines between points
      ctx.beginPath();
      currentPoints.forEach((point, i) => {
        if (i === 0) {
          ctx.moveTo(point.canvas.x, point.canvas.y);
        } else {
          ctx.lineTo(point.canvas.x, point.canvas.y);
        }
      });
      
      // Don't fill while drawing - only show outline
      ctx.stroke();

      // Draw points
      currentPoints.forEach((point, i) => {
        ctx.beginPath();
        ctx.arc(point.canvas.x, point.canvas.y, 
          hoverPointIndex === i ? 6 : 4, 0, Math.PI * 2);
        ctx.fillStyle = hoverPointIndex === i ? 
          `rgb(${r}, ${g}, ${b})` : 
          `rgba(${r}, ${g}, ${b}, 0.8)`;
        ctx.fill();
        ctx.stroke();
      });
    }
    
    // Draw existing contour points when hovering
    if (hoveredContourPoints.length > 0 && currentPoints.length === 0) {
      const [r, g, b] = color;
      
      // Draw the hovered contour line faintly
      ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.3)`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      hoveredContourPoints.forEach((point, index) => {
        if (index === 0) {
          ctx.moveTo(point.canvas.x, point.canvas.y);
        } else {
          ctx.lineTo(point.canvas.x, point.canvas.y);
        }
      });
      ctx.closePath();
      ctx.stroke();
      
      // Draw the contour points as draggable handles
      hoveredContourPoints.forEach((point, index) => {
        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(point.canvas.x, point.canvas.y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      });
    }
  }, [isActive, currentPoints, getSelectedStructure, isInsideContour, hoverPointIndex, showPreview, hoveredContourPoints]);

  // Redraw on changes
  useEffect(() => {
    drawOverlay();
  }, [drawOverlay]);

  // Mouse handlers
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isActive || !overlayCanvasRef.current) return;

    const rect = overlayCanvasRef.current.getBoundingClientRect();
    const canvasX = e.clientX - rect.left;
    const canvasY = e.clientY - rect.top;

    // Check if clicking on existing contour point for morphing
    if (hoveredContourPoints.length > 0 && currentPoints.length === 0) {
      const clickedContourPoint = hoveredContourPoints.findIndex(point => {
        const dist = Math.sqrt(
          Math.pow(point.canvas.x - canvasX, 2) + 
          Math.pow(point.canvas.y - canvasY, 2)
        );
        return dist < 8;
      });
      
      if (clickedContourPoint >= 0) {
        // Start morphing - load the contour as current points
        setCurrentPoints([...hoveredContourPoints]);
        setIsDragging(true);
        setDraggedPointIndex(clickedContourPoint);
        setIsInsideContour(false); // Morphing mode
        return;
      }
    }

    // Check if clicking on existing point in current drawing
    const clickedPointIndex = currentPoints.findIndex(point => {
      const dist = Math.sqrt(
        Math.pow(point.canvas.x - canvasX, 2) + 
        Math.pow(point.canvas.y - canvasY, 2)
      );
      return dist < 8;
    });

    if (clickedPointIndex >= 0) {
      // Start dragging existing point
      setIsDragging(true);
      setDraggedPointIndex(clickedPointIndex);
    } else {
      // Start drawing - add first point
      const worldCoords = canvasToWorld(canvasX, canvasY);
      if (worldCoords) {
        const newPoint: PenPoint = {
          canvas: { x: canvasX, y: canvasY },
          world: worldCoords
        };

        // Check if starting inside or outside contour
        if (currentPoints.length === 0) {
          setIsInsideContour(checkInsideContour(worldCoords.x, worldCoords.y));
        }

        setCurrentPoints([...currentPoints, newPoint]);
        setIsDrawing(true); // Enable continuous drawing
      }
    }
  }, [isActive, currentPoints, canvasToWorld, checkInsideContour, hoveredContourPoints]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isActive || !overlayCanvasRef.current) return;

    const rect = overlayCanvasRef.current.getBoundingClientRect();
    const canvasX = e.clientX - rect.left;
    const canvasY = e.clientY - rect.top;

    if (isDragging && draggedPointIndex !== null) {
      // Update dragged point
      const worldCoords = canvasToWorld(canvasX, canvasY);
      if (worldCoords) {
        const updatedPoints = [...currentPoints];
        updatedPoints[draggedPointIndex] = {
          canvas: { x: canvasX, y: canvasY },
          world: worldCoords
        };
        setCurrentPoints(updatedPoints);
      }
    } else if (isDrawing) {
      // Add points while drawing
      const worldCoords = canvasToWorld(canvasX, canvasY);
      if (worldCoords) {
        // Check minimum distance from last point to avoid too many points
        if (currentPoints.length > 0) {
          const lastPoint = currentPoints[currentPoints.length - 1];
          const dist = Math.sqrt(
            Math.pow(lastPoint.canvas.x - canvasX, 2) + 
            Math.pow(lastPoint.canvas.y - canvasY, 2)
          );
          
          // Only add point if moved at least 5 pixels
          if (dist >= 5) {
            const newPoint: PenPoint = {
              canvas: { x: canvasX, y: canvasY },
              world: worldCoords
            };
            setCurrentPoints([...currentPoints, newPoint]);
          }
        }
      }
    } else {
      // Check hover over current drawing points
      const hoverIndex = currentPoints.findIndex(point => {
        const dist = Math.sqrt(
          Math.pow(point.canvas.x - canvasX, 2) + 
          Math.pow(point.canvas.y - canvasY, 2)
        );
        return dist < 8;
      });
      setHoverPointIndex(hoverIndex >= 0 ? hoverIndex : null);
      
      // If not drawing, check hover over existing contour points
      if (currentPoints.length === 0) {
        const nearestPoint = findNearestContourPoint(canvasX, canvasY);
        if (nearestPoint) {
          // Convert contour to pen points for visualization
          const contourPoints: PenPoint[] = [];
          for (let i = 0; i < nearestPoint.contour.points.length; i += 3) {
            const worldPoint = {
              x: nearestPoint.contour.points[i],
              y: nearestPoint.contour.points[i + 1],
              z: nearestPoint.contour.points[i + 2]
            };
            
            const imagePosition = imageMetadata.imagePosition?.split('\\').map(Number) || [-300, -300, currentSlicePosition];
            const pixelSpacing = imageMetadata.pixelSpacing?.split('\\').map(Number) || [1.171875, 1.171875];
            
            const canvasPoint = worldToCanvas(
              worldPoint.x,
              worldPoint.y,
              imagePosition,
              pixelSpacing,
              canvasRef.current!.width,
              canvasRef.current!.height
            );
            
            if (canvasPoint) {
              // Calculate base scale to match contour rendering
              const imgWidth = 512;
              const imgHeight = 512;
              const canvasWidth = canvasRef.current!.width;
              const canvasHeight = canvasRef.current!.height;
              const baseScale = Math.min(canvasWidth / imgWidth, canvasHeight / imgHeight); // = 2
              
              const rect = overlayCanvasRef.current!.getBoundingClientRect();
              const centerX = rect.width / 2;
              const centerY = rect.height / 2;
              
              // Canvas point is already in canvas space, apply zoom/pan with base scale
              const effectiveZoom = zoom / baseScale;
              const displayX = (canvasPoint[0] - centerX) * baseScale * effectiveZoom + centerX + panX;
              const displayY = (canvasPoint[1] - centerY) * baseScale * effectiveZoom + centerY + panY;
              
              contourPoints.push({
                canvas: { x: displayX, y: displayY },
                world: worldPoint
              });
            }
          }
          setHoveredContour(nearestPoint.contour);
          setHoveredContourPoints(contourPoints);
        } else {
          setHoveredContour(null);
          setHoveredContourPoints([]);
        }
      }
    }
  }, [isActive, isDragging, isDrawing, draggedPointIndex, currentPoints, canvasToWorld]);

  const handleMouseUp = useCallback(() => {
    // Only stop dragging on mouse up - keep drawing active
    setIsDragging(false);
    setDraggedPointIndex(null);
    // Don't stop drawing - continuous drawing until right-click
  }, []);

  const completeContour = useCallback(() => {
    if (!isActive || currentPoints.length < 3) return;

    // Complete the contour
    const worldPoints: number[] = [];
    currentPoints.forEach(point => {
      worldPoints.push(point.world.x, point.world.y, point.world.z);
    });

    // Send update based on mode
    if (hoveredContour) {
      // Replace existing contour (morphing)
      onContourUpdate({
        action: 'replace_contour',
        structureId: selectedStructure,
        points: worldPoints,
        slicePosition: currentSlicePosition,
        oldContourId: hoveredContour.id
      });
    } else if (isInsideContour) {
      // Add to existing contour
      onContourUpdate({
        action: 'add_pen_stroke',
        structureId: selectedStructure,
        points: worldPoints,
        slicePosition: currentSlicePosition
      });
    } else {
      // Cut from existing contour
      onContourUpdate({
        action: 'cut_pen_stroke',
        structureId: selectedStructure,
        points: worldPoints,
        slicePosition: currentSlicePosition
      });
    }

    // Clear points and reset state
    setCurrentPoints([]);
    setIsDrawing(false);
    setHoveredContour(null);
    setHoveredContourPoints([]);
  }, [isActive, currentPoints, isInsideContour, selectedStructure, currentSlicePosition, onContourUpdate, hoveredContour]);

  const handleContextMenu = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    completeContour();
  }, [completeContour]);

  if (!isActive || !canvasRef.current) return null;

  return (
    <canvas
      ref={overlayCanvasRef}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onContextMenu={handleContextMenu}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        pointerEvents: isActive ? 'auto' : 'none',
        cursor: isDragging ? 'grabbing' : (hoverPointIndex !== null ? 'grab' : 'crosshair')
      }}
    />
  );
}