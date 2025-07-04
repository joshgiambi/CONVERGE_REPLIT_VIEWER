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
  const [draggedPointIndex, setDraggedPointIndex] = useState<number | null>(null);
  const [hoverPointIndex, setHoverPointIndex] = useState<number | null>(null);
  const [isInsideContour, setIsInsideContour] = useState(false);
  const [showPreview, setShowPreview] = useState(true);

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

    // Apply zoom and pan transformations
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    
    const transformedX = (canvasX - centerX - panX) / zoom + centerX;
    const transformedY = (canvasY - centerY - panY) / zoom + centerY;
    
    const adjustedRelX = transformedX / rect.width;
    const adjustedRelY = transformedY / rect.height;

    // Convert to DICOM coordinates
    const pixelSpacing = imageMetadata.pixelSpacing?.split('\\').map(Number) || [1.171875, 1.171875];
    const imagePosition = imageMetadata.imagePosition?.split('\\').map(Number) || [-300, -300, currentSlicePosition];

    const worldX = imagePosition[0] + (adjustedRelX * 512 * pixelSpacing[0]);
    const worldY = imagePosition[1] + (adjustedRelY * 512 * pixelSpacing[1]);
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
          overlayCanvasRef.current!.width,
          overlayCanvasRef.current!.height
        );

        if (canvasPoint) {
          // Apply zoom and pan to canvas point
          const centerX = overlayCanvasRef.current!.width / 2;
          const centerY = overlayCanvasRef.current!.height / 2;
          
          const displayX = (canvasPoint[0] - centerX) * zoom + centerX + panX;
          const displayY = (canvasPoint[1] - centerY) * zoom + centerY + panY;

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
      
      if (showPreview && currentPoints.length > 2) {
        ctx.closePath();
        ctx.fill();
      }
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
  }, [isActive, currentPoints, getSelectedStructure, isInsideContour, hoverPointIndex, showPreview]);

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

    // Check if clicking on existing point
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
      // Add new point
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
      }
    }
  }, [isActive, currentPoints, canvasToWorld, checkInsideContour]);

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
    } else {
      // Check hover over points
      const hoverIndex = currentPoints.findIndex(point => {
        const dist = Math.sqrt(
          Math.pow(point.canvas.x - canvasX, 2) + 
          Math.pow(point.canvas.y - canvasY, 2)
        );
        return dist < 8;
      });
      setHoverPointIndex(hoverIndex >= 0 ? hoverIndex : null);
    }
  }, [isActive, isDragging, draggedPointIndex, currentPoints, canvasToWorld]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    setDraggedPointIndex(null);
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    
    if (!isActive || currentPoints.length < 3) return;

    // Complete the contour
    const worldPoints: number[] = [];
    currentPoints.forEach(point => {
      worldPoints.push(point.world.x, point.world.y, point.world.z);
    });

    // Send update based on mode
    if (isInsideContour) {
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

    // Clear points
    setCurrentPoints([]);
  }, [isActive, currentPoints, isInsideContour, selectedStructure, currentSlicePosition, onContourUpdate]);

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