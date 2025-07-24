// Unified Pen Tool - Single mode with continuous/point drawing
// Right-click places point then closes, immediate contour merging

import { useCallback, useEffect, useRef, useState } from 'react';

interface PenToolUnifiedProps {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  isActive: boolean;
  selectedStructure: number;
  rtStructures: any;
  currentSlicePosition: number;
  onContourUpdate: (payload: any) => void;
  imageMetadata: any;
  zoom?: number;
  panX?: number;
  panY?: number;
}

export function PenToolUnified({
  canvasRef,
  isActive,
  selectedStructure,
  rtStructures,
  currentSlicePosition,
  onContourUpdate,
  imageMetadata,
  zoom = 1,
  panX = 0,
  panY = 0
}: PenToolUnifiedProps) {
  
  // Drawing state
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentPath, setCurrentPath] = useState<[number, number, number][]>([]);
  const [isMouseDown, setIsMouseDown] = useState(false);
  const [lastPoint, setLastPoint] = useState<[number, number] | null>(null);
  
  // Morphing state
  const [isMorphing, setIsMorphing] = useState(false);
  const [morphingContour, setMorphingContour] = useState<any>(null);
  const [dragStartPoint, setDragStartPoint] = useState<[number, number] | null>(null);
  const [nearbyVertex, setNearbyVertex] = useState<{index: number, distance: number} | null>(null);
  
  // Highlighted region state
  const [highlightedContour, setHighlightedContour] = useState<any>(null);
  const [mousePosition, setMousePosition] = useState<[number, number]>([0, 0]);
  
  // Canvas refs
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  
  // Configuration
  const MORPH_INFLUENCE_RADIUS = 50;
  const VERTEX_DETECTION_RADIUS = 10;
  const MIN_MOVE_DISTANCE = 2;
  
  // Coordinate transformation
  const canvasToWorld = useCallback((canvasX: number, canvasY: number): [number, number, number] => {
    if (!imageMetadata) return [0, 0, 0];
    
    const imagePositionStr = imageMetadata.imagePosition || "0\\0\\0";
    const imagePosition = imagePositionStr.split("\\").map(parseFloat);
    
    const pixelSpacingStr = imageMetadata.pixelSpacing || "1\\1";
    const pixelSpacing = pixelSpacingStr.split("\\").map(parseFloat);
    
    // Transform to world coordinates
    const worldX = imagePosition[0] + (canvasX - panX) / zoom * pixelSpacing[0];
    const worldY = imagePosition[1] + (canvasY - panY) / zoom * pixelSpacing[1];
    const worldZ = currentSlicePosition;
    
    return [worldX, worldY, worldZ];
  }, [imageMetadata, zoom, panX, panY, currentSlicePosition]);
  
  const worldToCanvas = useCallback((worldX: number, worldY: number): [number, number] => {
    if (!imageMetadata) return [0, 0];
    
    const imagePositionStr = imageMetadata.imagePosition || "0\\0\\0";
    const imagePosition = imagePositionStr.split("\\").map(parseFloat);
    
    const pixelSpacingStr = imageMetadata.pixelSpacing || "1\\1";
    const pixelSpacing = pixelSpacingStr.split("\\").map(parseFloat);
    
    const canvasX = (worldX - imagePosition[0]) / pixelSpacing[0] * zoom + panX;
    const canvasY = (worldY - imagePosition[1]) / pixelSpacing[1] * zoom + panY;
    
    return [canvasX, canvasY];
  }, [imageMetadata, zoom, panX, panY]);
  
  // Find nearby vertex for morphing
  const findNearbyVertex = useCallback((point: [number, number]): {contour: any, index: number, distance: number} | null => {
    if (!rtStructures?.structures) return null;
    
    let nearestVertex = null;
    let minDistance = VERTEX_DETECTION_RADIUS;
    
    const structure = rtStructures.structures.find((s: any) => s.roiNumber === selectedStructure);
    if (!structure?.contours) return null;
    
    structure.contours.forEach((contour: any) => {
      if (Math.abs(contour.slicePosition - currentSlicePosition) < 0.5) {
        for (let i = 0; i < contour.points.length; i += 3) {
          const [cx, cy] = worldToCanvas(contour.points[i], contour.points[i + 1]);
          const dist = Math.sqrt(Math.pow(cx - point[0], 2) + Math.pow(cy - point[1], 2));
          
          if (dist < minDistance) {
            minDistance = dist;
            nearestVertex = {
              contour,
              index: i / 3,
              distance: dist
            };
          }
        }
      }
    });
    
    return nearestVertex;
  }, [rtStructures, selectedStructure, currentSlicePosition, worldToCanvas, VERTEX_DETECTION_RADIUS]);
  
  // Check if point is inside contour
  const isPointInsideContour = useCallback((point: [number, number, number], contour: any): boolean => {
    const points = contour.points;
    let inside = false;
    
    for (let i = 0, j = points.length - 3; i < points.length; j = i, i += 3) {
      const xi = points[i], yi = points[i + 1];
      const xj = points[j], yj = points[j + 1];
      
      const intersect = ((yi > point[1]) !== (yj > point[1])) &&
                       (point[0] < (xj - xi) * (point[1] - yi) / (yj - yi) + xi);
      
      if (intersect) inside = !inside;
    }
    
    return inside;
  }, []);
  
  // Handle mouse down
  const handleMouseDown = useCallback((e: MouseEvent) => {
    if (!isActive || !canvasRef.current) return;
    if (e.button !== 0) return; // Only left click
    
    const rect = canvasRef.current.getBoundingClientRect();
    const canvasX = e.clientX - rect.left;
    const canvasY = e.clientY - rect.top;
    const worldPoint = canvasToWorld(canvasX, canvasY);
    
    // Check for nearby vertex to morph
    const nearby = findNearbyVertex([canvasX, canvasY]);
    if (nearby && nearby.distance < VERTEX_DETECTION_RADIUS) {
      setIsMorphing(true);
      setMorphingContour(nearby.contour);
      setNearbyVertex(nearby);
      setDragStartPoint([canvasX, canvasY]);
      setIsMouseDown(true);
      
      // Disable scrolling during morphing
      if (canvasRef.current) {
        canvasRef.current.style.pointerEvents = 'none';
      }
    } else {
      // Start drawing
      setIsDrawing(true);
      setCurrentPath([worldPoint]);
      setIsMouseDown(true);
      setLastPoint([canvasX, canvasY]);
      
      // Disable scrolling during drawing
      if (canvasRef.current) {
        canvasRef.current.style.pointerEvents = 'none';
      }
    }
  }, [isActive, canvasRef, canvasToWorld, findNearbyVertex]);
  
  // Handle mouse move
  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!canvasRef.current) return;
    
    const rect = canvasRef.current.getBoundingClientRect();
    const canvasX = e.clientX - rect.left;
    const canvasY = e.clientY - rect.top;
    setMousePosition([canvasX, canvasY]);
    
    // Highlight nearby contours
    if (!isDrawing && !isMorphing) {
      const nearby = findNearbyVertex([canvasX, canvasY]);
      setHighlightedContour(nearby?.contour || null);
      setNearbyVertex(nearby);
    }
    
    // Handle morphing
    if (isMorphing && isMouseDown && morphingContour && dragStartPoint && nearbyVertex) {
      const dx = canvasX - dragStartPoint[0];
      const dy = canvasY - dragStartPoint[1];
      
      // Apply morphing with influence falloff
      const newPoints = [...morphingContour.points];
      const vertexIndex = nearbyVertex.index * 3;
      
      for (let i = 0; i < newPoints.length; i += 3) {
        const [px, py] = worldToCanvas(newPoints[i], newPoints[i + 1]);
        const dist = Math.sqrt(
          Math.pow(px - worldToCanvas(morphingContour.points[vertexIndex], morphingContour.points[vertexIndex + 1])[0], 2) +
          Math.pow(py - worldToCanvas(morphingContour.points[vertexIndex], morphingContour.points[vertexIndex + 1])[1], 2)
        );
        
        if (dist < MORPH_INFLUENCE_RADIUS) {
          const influence = 1 - (dist / MORPH_INFLUENCE_RADIUS);
          const [wx, wy] = canvasToWorld(px + dx * influence, py + dy * influence);
          newPoints[i] = wx;
          newPoints[i + 1] = wy;
        }
      }
      
      // Update contour
      onContourUpdate({
        action: 'replace_contour',
        structureId: selectedStructure,
        sliceIndex: currentSlicePosition,
        contourData: newPoints
      });
      
      setDragStartPoint([canvasX, canvasY]);
    }
    
    // Handle continuous drawing
    if (isDrawing && isMouseDown && lastPoint) {
      const dist = Math.sqrt(
        Math.pow(canvasX - lastPoint[0], 2) + 
        Math.pow(canvasY - lastPoint[1], 2)
      );
      
      if (dist > MIN_MOVE_DISTANCE) {
        const worldPoint = canvasToWorld(canvasX, canvasY);
        setCurrentPath(prev => [...prev, worldPoint]);
        setLastPoint([canvasX, canvasY]);
      }
    }
  }, [isDrawing, isMorphing, isMouseDown, morphingContour, dragStartPoint, nearbyVertex, 
      canvasRef, findNearbyVertex, worldToCanvas, canvasToWorld, onContourUpdate, 
      selectedStructure, currentSlicePosition, lastPoint]);
  
  // Handle mouse up
  const handleMouseUp = useCallback((e: MouseEvent) => {
    if (!canvasRef.current) return;
    
    setIsMouseDown(false);
    
    // Re-enable scrolling
    if (canvasRef.current) {
      canvasRef.current.style.pointerEvents = 'auto';
    }
    
    if (isMorphing) {
      setIsMorphing(false);
      setMorphingContour(null);
      setDragStartPoint(null);
    }
    
    // For drawing, mouse up just stops continuous mode but doesn't close polygon
    if (isDrawing && e.button === 0) {
      // Add a point if we just clicked without dragging
      if (currentPath.length === 1) {
        const rect = canvasRef.current.getBoundingClientRect();
        const canvasX = e.clientX - rect.left;
        const canvasY = e.clientY - rect.top;
        const worldPoint = canvasToWorld(canvasX, canvasY);
        setCurrentPath(prev => [...prev, worldPoint]);
      }
    }
  }, [canvasRef, isMorphing, isDrawing, currentPath, canvasToWorld]);
  
  // Handle right click - place point at cursor then close
  const handleRightClick = useCallback((e: MouseEvent) => {
    e.preventDefault();
    
    if (!isDrawing || currentPath.length < 2) return;
    if (!canvasRef.current) return;
    
    // Add point at current cursor position
    const rect = canvasRef.current.getBoundingClientRect();
    const canvasX = e.clientX - rect.left;
    const canvasY = e.clientY - rect.top;
    const worldPoint = canvasToWorld(canvasX, canvasY);
    
    const finalPath = [...currentPath, worldPoint];
    
    // Determine if we're adding or subtracting based on starting point
    const structure = rtStructures?.structures?.find((s: any) => s.roiNumber === selectedStructure);
    let mode = 'new';
    
    if (structure?.contours) {
      const startPoint = finalPath[0];
      const isInside = structure.contours.some((contour: any) => 
        Math.abs(contour.slicePosition - currentSlicePosition) < 0.5 &&
        isPointInsideContour(startPoint, contour)
      );
      mode = isInside ? 'subtract' : 'add';
    }
    
    // Convert to contour format
    const contourPoints: number[] = [];
    finalPath.forEach(point => {
      contourPoints.push(point[0], point[1], point[2]);
    });
    
    // Send update with mode
    onContourUpdate({
      action: mode === 'subtract' ? 'delete_from_contour' : 'add_to_contour',
      structureId: selectedStructure,
      sliceIndex: currentSlicePosition,
      contourData: contourPoints
    });
    
    // Reset drawing state
    setIsDrawing(false);
    setCurrentPath([]);
    setLastPoint(null);
    
    // Re-enable scrolling
    if (canvasRef.current) {
      canvasRef.current.style.pointerEvents = 'auto';
    }
  }, [isDrawing, currentPath, canvasRef, canvasToWorld, rtStructures, selectedStructure, 
      currentSlicePosition, isPointInsideContour, onContourUpdate]);
  
  // Handle click (for adding individual points)
  const handleClick = useCallback((e: MouseEvent) => {
    if (!isActive || !isDrawing || isMouseDown) return;
    if (e.button !== 0) return;
    
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    
    const canvasX = e.clientX - rect.left;
    const canvasY = e.clientY - rect.top;
    const worldPoint = canvasToWorld(canvasX, canvasY);
    
    setCurrentPath(prev => [...prev, worldPoint]);
    setLastPoint([canvasX, canvasY]);
  }, [isActive, isDrawing, isMouseDown, canvasRef, canvasToWorld]);
  
  // Setup event listeners
  useEffect(() => {
    if (!isActive || !canvasRef.current) return;
    
    const canvas = canvasRef.current;
    
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      handleRightClick(e);
    };
    
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('click', handleClick);
    canvas.addEventListener('contextmenu', handleContextMenu);
    
    // Global mouse up to handle mouse leaving canvas
    const handleGlobalMouseUp = (e: MouseEvent) => {
      handleMouseUp(e);
    };
    window.addEventListener('mouseup', handleGlobalMouseUp);
    
    return () => {
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseup', handleMouseUp);
      canvas.removeEventListener('click', handleClick);
      canvas.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [isActive, canvasRef, handleMouseDown, handleMouseMove, handleMouseUp, handleClick, handleRightClick]);
  
  // Reset when deactivated
  useEffect(() => {
    if (!isActive) {
      setIsDrawing(false);
      setCurrentPath([]);
      setIsMouseDown(false);
      setIsMorphing(false);
      setHighlightedContour(null);
      
      // Re-enable scrolling
      if (canvasRef.current) {
        canvasRef.current.style.pointerEvents = 'auto';
      }
    }
  }, [isActive, canvasRef]);
  
  // Setup overlay canvas
  useEffect(() => {
    if (!canvasRef.current || !overlayCanvasRef.current) return;
    
    const canvas = canvasRef.current;
    const overlay = overlayCanvasRef.current;
    
    // Match overlay canvas size to main canvas
    overlay.width = canvas.width;
    overlay.height = canvas.height;
    overlay.style.position = 'absolute';
    overlay.style.left = canvas.offsetLeft + 'px';
    overlay.style.top = canvas.offsetTop + 'px';
    overlay.style.pointerEvents = 'none';
    overlay.style.zIndex = '1000';
    
    if (canvas.parentElement && !canvas.parentElement.contains(overlay)) {
      canvas.parentElement.appendChild(overlay);
    }
    
    return () => {
      if (overlay.parentElement) {
        overlay.parentElement.removeChild(overlay);
      }
    };
  }, [canvasRef]);
  
  // Render overlay
  useEffect(() => {
    if (!overlayCanvasRef.current) return;
    
    const ctx = overlayCanvasRef.current.getContext('2d');
    if (!ctx) return;
    
    // Clear overlay
    ctx.clearRect(0, 0, overlayCanvasRef.current.width, overlayCanvasRef.current.height);
    
    // Get structure color
    const structure = rtStructures?.structures?.find((s: any) => s.roiNumber === selectedStructure);
    const color = structure?.color || [255, 255, 0];
    const colorStr = `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
    
    // Draw highlighted contour region
    if (highlightedContour && !isDrawing && !isMorphing) {
      ctx.save();
      ctx.strokeStyle = colorStr;
      ctx.lineWidth = 3;
      ctx.globalAlpha = 0.5;
      ctx.setLineDash([5, 5]);
      
      ctx.beginPath();
      const points = highlightedContour.points;
      for (let i = 0; i < points.length; i += 3) {
        const [x, y] = worldToCanvas(points[i], points[i + 1]);
        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }
    
    // Draw current path
    if (isDrawing && currentPath.length > 0) {
      ctx.save();
      ctx.strokeStyle = colorStr;
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      
      ctx.beginPath();
      currentPath.forEach((point, i) => {
        const [x, y] = worldToCanvas(point[0], point[1]);
        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });
      
      // Draw line to cursor
      if (mousePosition) {
        ctx.lineTo(mousePosition[0], mousePosition[1]);
      }
      
      ctx.stroke();
      
      // Draw vertices
      ctx.fillStyle = colorStr;
      currentPath.forEach(point => {
        const [x, y] = worldToCanvas(point[0], point[1]);
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();
      });
      
      ctx.restore();
    }
    
    // Draw morph influence radius
    if (isMorphing && nearbyVertex && mousePosition) {
      ctx.save();
      ctx.strokeStyle = colorStr;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.3;
      ctx.setLineDash([3, 3]);
      
      ctx.beginPath();
      ctx.arc(mousePosition[0], mousePosition[1], MORPH_INFLUENCE_RADIUS, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    
  }, [overlayCanvasRef, highlightedContour, isDrawing, isMorphing, currentPath, 
      mousePosition, nearbyVertex, rtStructures, selectedStructure, worldToCanvas]);
  
  return <canvas ref={overlayCanvasRef} style={{ pointerEvents: 'none' }} />;
}