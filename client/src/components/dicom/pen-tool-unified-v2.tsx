import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as ClipperLib from 'js-angusj-clipper';

interface PenToolUnifiedV2Props {
  isActive: boolean;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  imageMetadata: any;
  worldToCanvas: (x: number, y: number) => [number, number];
  canvasToWorld: (x: number, y: number) => [number, number];
  selectedStructure: number | null;
  rtStructures: any;
  onContourUpdate: (action: string, data: any) => void;
  color?: string;
}

export const PenToolUnifiedV2: React.FC<PenToolUnifiedV2Props> = ({
  isActive,
  canvasRef,
  imageMetadata,
  worldToCanvas,
  canvasToWorld,
  selectedStructure,
  rtStructures,
  onContourUpdate,
  color
}) => {
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  
  // Drawing state
  const [points, setPoints] = useState<[number, number][]>([]);
  const [isDrawingContinuous, setIsDrawingContinuous] = useState(false);
  const [currentMousePos, setCurrentMousePos] = useState<[number, number] | null>(null);
  const [startMode, setStartMode] = useState<'ADD' | 'SUBTRACT' | null>(null);
  
  // Morphing state
  const [hoveredVertex, setHoveredVertex] = useState<{ contourIdx: number; pointIdx: number } | null>(null);
  const [isDraggingVertex, setIsDraggingVertex] = useState(false);
  const [draggedVertex, setDraggedVertex] = useState<{ 
    contourIdx: number; 
    pointIdx: number; 
    originalContour: number[];
  } | null>(null);
  
  const CLOSE_THRESHOLD = 10; // Smaller bubble for first vertex
  const VERTEX_HIT_RADIUS = 8;
  const CONTOUR_HOVER_DISTANCE = 5; // Only show vertices when very close to boundary
  
  // Get current Z position
  const currentZ = imageMetadata?.imagePosition ? 
    parseFloat(imageMetadata.imagePosition.split("\\")[2]) : 0;
  
  // Find existing contours at current slice
  const getContoursAtCurrentSlice = useCallback(() => {
    console.log('getContoursAtCurrentSlice called:', {
      hasRTStructures: !!rtStructures?.structures,
      structuresCount: rtStructures?.structures?.length || 0,
      selectedStructure,
      currentZ
    });
    
    if (!rtStructures?.structures || !selectedStructure) return [];
    
    const structure = rtStructures.structures.find((s: any) => s.roiNumber === selectedStructure);
    console.log('Found structure:', structure ? structure.structureName : 'None');
    
    if (!structure?.contours) return [];
    
    const contoursAtSlice = structure.contours.filter((contour: any) => {
      const contourZ = contour.points[2];
      return Math.abs(contourZ - currentZ) < 0.1;
    });
    
    console.log('Contours at current slice:', contoursAtSlice.length);
    return contoursAtSlice;
  }, [rtStructures, selectedStructure, currentZ]);
  
  // Check if point is inside any contour
  const isPointInsideContour = useCallback((x: number, y: number, contour: number[]) => {
    let inside = false;
    const points = contour;
    
    for (let i = 0, j = points.length - 3; i < points.length; j = i, i += 3) {
      const xi = points[i], yi = points[i + 1];
      const xj = points[j], yj = points[j + 1];
      
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
        inside = !inside;
      }
    }
    
    return inside;
  }, []);
  
  // Find nearest vertex to cursor
  const findNearestVertex = useCallback((canvasX: number, canvasY: number) => {
    const contours = getContoursAtCurrentSlice();
    const worldPoint = canvasToWorld(canvasX, canvasY);
    
    // First check if we're near any contour boundary
    for (let contourIdx = 0; contourIdx < contours.length; contourIdx++) {
      const contour = contours[contourIdx];
      const points = contour.points;
      
      // Check distance to contour edges
      let nearBoundary = false;
      for (let i = 0; i < points.length; i += 3) {
        const j = (i + 3) % points.length;
        const [x1, y1] = worldToCanvas(points[i], points[i + 1]);
        const [x2, y2] = worldToCanvas(points[j], points[j + 1]);
        
        // Distance from point to line segment
        const A = canvasX - x1;
        const B = canvasY - y1;
        const C = x2 - x1;
        const D = y2 - y1;
        
        const dot = A * C + B * D;
        const lenSq = C * C + D * D;
        let param = -1;
        
        if (lenSq !== 0) param = dot / lenSq;
        
        let xx, yy;
        if (param < 0) {
          xx = x1;
          yy = y1;
        } else if (param > 1) {
          xx = x2;
          yy = y2;
        } else {
          xx = x1 + param * C;
          yy = y1 + param * D;
        }
        
        const dx = canvasX - xx;
        const dy = canvasY - yy;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance < CONTOUR_HOVER_DISTANCE) {
          nearBoundary = true;
          break;
        }
      }
      
      // Only check vertices if we're near the boundary
      if (nearBoundary) {
        for (let i = 0; i < points.length; i += 3) {
          const [cx, cy] = worldToCanvas(points[i], points[i + 1]);
          const distance = Math.sqrt((canvasX - cx) ** 2 + (canvasY - cy) ** 2);
          
          if (distance < VERTEX_HIT_RADIUS) {
            return { contourIdx, pointIdx: i };
          }
        }
      }
    }
    
    return null;
  }, [getContoursAtCurrentSlice, worldToCanvas, canvasToWorld]);
  
  // Check if near first point for closing
  const isNearFirstPoint = useCallback((canvasX: number, canvasY: number) => {
    if (points.length === 0) return false;
    
    const [firstX, firstY] = worldToCanvas(points[0][0], points[0][1]);
    const distance = Math.sqrt((canvasX - firstX) ** 2 + (canvasY - firstY) ** 2);
    
    return distance < CLOSE_THRESHOLD;
  }, [points, worldToCanvas]);
  
  // Complete the shape and apply boolean operation
  const completeShape = useCallback(async (addFinalPoint: boolean = false, finalPoint?: [number, number]) => {
    if (points.length < 3) return;
    
    console.log('completeShape called:', {
      selectedStructure,
      pointsCount: points.length,
      startMode,
      currentZ
    });
    
    const finalPoints = [...points];
    if (addFinalPoint && finalPoint) {
      finalPoints.push(finalPoint);
    }
    
    // Convert to ClipperLib format (scale by 1000 for integer precision)
    const SCALE = 1000;
    const newPolygon = finalPoints.map(([x, y]) => ({
      x: Math.round(x * SCALE),
      y: Math.round(y * SCALE)
    }));
    
    // Get existing contours at current slice
    const existingContours = getContoursAtCurrentSlice();
    console.log('Found existing contours:', existingContours.length);
    
    if (existingContours.length === 0) {
      // No existing contours, just add the new one
      const worldPoints: number[] = [];
      finalPoints.forEach(([x, y]) => {
        worldPoints.push(x, y, currentZ);
      });
      
      console.log('Adding new contour:', {
        structureId: selectedStructure,
        points: worldPoints.length,
        imageMetadata
      });
      onContourUpdate({
        action: 'add_contour',
        structureId: selectedStructure,
        points: worldPoints,
        slicePosition: currentZ,
        imageMetadata
      });
    } else {
      // Perform boolean operations with existing contours
      try {
        await ClipperLib.loadNativeClipperLibInstanceAsync(
          ClipperLib.NativeClipperLibRequestedFormat.WasmWithAsmJsFallback
        );
        
        const clipper = new ClipperLib.Clipper();
        const solution: ClipperLib.Path[] = [];
        
        // Convert existing contours to ClipperLib format
        const existingPaths: ClipperLib.Path[] = existingContours.map(contour => {
          const path: ClipperLib.IntPoint[] = [];
          for (let i = 0; i < contour.points.length; i += 3) {
            path.push({
              x: Math.round(contour.points[i] * SCALE),
              y: Math.round(contour.points[i + 1] * SCALE)
            });
          }
          return path;
        });
        
        if (startMode === 'ADD') {
          // Union operation
          clipper.addPaths(existingPaths, ClipperLib.PolyType.Subject);
          clipper.addPath(newPolygon, ClipperLib.PolyType.Clip);
          clipper.execute(ClipperLib.ClipType.Union, solution);
        } else {
          // Difference operation
          clipper.addPaths(existingPaths, ClipperLib.PolyType.Subject);
          clipper.addPath(newPolygon, ClipperLib.PolyType.Clip);
          clipper.execute(ClipperLib.ClipType.Difference, solution);
        }
        
        // Convert solution back to world coordinates
        const resultContours: number[][] = solution.map(path => {
          const worldPoints: number[] = [];
          path.forEach(point => {
            worldPoints.push(point.x / SCALE, point.y / SCALE, currentZ);
          });
          return worldPoints;
        });
        
        // Send updated contours
        console.log('Boolean operation result:', {
          operation: startMode,
          originalContours: existingContours.length,
          resultContours: resultContours.length,
          solutionPaths: solution.length
        });
        
        // Replace all contours at this slice with boolean operation result
        if (resultContours.length > 0) {
          console.log('Calling onContourUpdate with replace_contour');
          // Use replace_contour action for the merged result
          onContourUpdate({
            action: 'replace_contour',
            structureId: selectedStructure,
            points: resultContours[0], // Use the first (usually only) contour result
            slicePosition: currentZ,
            imageMetadata
          });
        } else {
          // If boolean operation resulted in empty contour, delete the slice
          console.log('Boolean operation resulted in empty contour, deleting slice');
          onContourUpdate({
            action: 'delete_slice',
            structureId: selectedStructure,
            slicePosition: currentZ
          });
        }
        
      } catch (error) {
        console.error('Boolean operation failed:', error);
        // Fallback: just add/subtract as before
        const worldPoints: number[] = [];
        finalPoints.forEach(([x, y]) => {
          worldPoints.push(x, y, currentZ);
        });
        
        const action = startMode === 'ADD' ? 'add_contour' : 'subtract_contour';
        onContourUpdate({
          action: action,
          structureId: selectedStructure,
          points: worldPoints,
          slicePosition: currentZ,
          imageMetadata
        });
      }
    }
    
    // Reset state
    setPoints([]);
    setIsDrawingContinuous(false);
    setStartMode(null);
  }, [points, currentZ, startMode, selectedStructure, imageMetadata, onContourUpdate, getContoursAtCurrentSlice]);
  
  // Handle mouse down
  const handleMouseDown = useCallback((e: MouseEvent) => {
    if (!isActive || !canvasRef.current) return;
    
    const rect = canvasRef.current.getBoundingClientRect();
    const canvasX = e.clientX - rect.left;
    const canvasY = e.clientY - rect.top;
    const worldPoint = canvasToWorld(canvasX, canvasY);
    
    console.log('Pen tool click:', { canvasX, canvasY, worldPoint });
    
    // Check if near a vertex for morphing
    const nearVertex = findNearestVertex(canvasX, canvasY);
    if (nearVertex) {
      const contours = getContoursAtCurrentSlice();
      setIsDraggingVertex(true);
      setDraggedVertex({
        contourIdx: nearVertex.contourIdx,
        pointIdx: nearVertex.pointIdx,
        originalContour: [...contours[nearVertex.contourIdx].points]
      });
      return;
    }
    
    // If drawing, check for closing
    if (points.length > 0) {
      if (isNearFirstPoint(canvasX, canvasY) && points.length >= 3) {
        completeShape();
        return;
      }
    }
    
    // Start new shape or add point
    if (!startMode) {
      // Determine if we're inside or outside existing contours
      const contours = getContoursAtCurrentSlice();
      let insideAnyContour = false;
      
      for (const contour of contours) {
        if (contour.points && contour.points.length >= 9) { // Need at least 3 points for a valid contour
          if (isPointInsideContour(worldPoint[0], worldPoint[1], contour.points)) {
            insideAnyContour = true;
            break;
          }
        }
      }
      
      // Set mode based on whether we're starting inside or outside
      const mode = insideAnyContour ? 'ADD' : 'SUBTRACT';
      setStartMode(mode);
      console.log(`Starting pen tool in ${mode} mode (inside contour: ${insideAnyContour})`);
    }
    
    // Add point
    setPoints(prev => [...prev, worldPoint]);
    
    // Start continuous drawing if holding down
    if (e.button === 0) { // Left button
      setIsDrawingContinuous(true);
    }
  }, [isActive, canvasRef, canvasToWorld, findNearestVertex, getContoursAtCurrentSlice, 
      points, isNearFirstPoint, completeShape, startMode, isPointInsideContour]);
  
  // Handle mouse move
  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!canvasRef.current) return;
    
    const rect = canvasRef.current.getBoundingClientRect();
    const canvasX = e.clientX - rect.left;
    const canvasY = e.clientY - rect.top;
    const worldPoint = canvasToWorld(canvasX, canvasY);
    
    setCurrentMousePos([canvasX, canvasY]);
    
    // Handle vertex dragging
    if (isDraggingVertex && draggedVertex) {
      const contours = getContoursAtCurrentSlice();
      const newContour = [...draggedVertex.originalContour];
      
      // Update dragged vertex
      newContour[draggedVertex.pointIdx] = worldPoint[0];
      newContour[draggedVertex.pointIdx + 1] = worldPoint[1];
      
      // Apply proportional movement to nearby vertices
      const draggedX = draggedVertex.originalContour[draggedVertex.pointIdx];
      const draggedY = draggedVertex.originalContour[draggedVertex.pointIdx + 1];
      const deltaX = worldPoint[0] - draggedX;
      const deltaY = worldPoint[1] - draggedY;
      
      const INFLUENCE_RADIUS = 50; // pixels
      
      for (let i = 0; i < newContour.length; i += 3) {
        if (i === draggedVertex.pointIdx) continue;
        
        const vx = draggedVertex.originalContour[i];
        const vy = draggedVertex.originalContour[i + 1];
        const distance = Math.sqrt((vx - draggedX) ** 2 + (vy - draggedY) ** 2);
        
        if (distance < INFLUENCE_RADIUS) {
          const influence = 1 - (distance / INFLUENCE_RADIUS);
          newContour[i] += deltaX * influence * 0.5;
          newContour[i + 1] += deltaY * influence * 0.5;
        }
      }
      
      // Update contour
      onContourUpdate({
        action: 'replace_contour',
        structureId: selectedStructure,
        points: newContour,
        slicePosition: currentZ,
        imageMetadata
      });
      
      return;
    }
    
    // Check for vertex hover
    if (!isDrawingContinuous) {
      const nearVertex = findNearestVertex(canvasX, canvasY);
      setHoveredVertex(nearVertex);
    }
    
    // Add points during continuous drawing
    if (isDrawingContinuous && points.length > 0) {
      // Check if we're dragging into the bubble to complete
      if (points.length >= 3 && isNearFirstPoint(canvasX, canvasY)) {
        completeShape();
        setIsDrawingContinuous(false);
        return;
      }
      
      const lastPoint = points[points.length - 1];
      const distance = Math.sqrt((worldPoint[0] - lastPoint[0]) ** 2 + (worldPoint[1] - lastPoint[1]) ** 2);
      
      // Add point if moved enough distance
      if (distance > 5) { // minimum distance threshold
        setPoints(prev => [...prev, worldPoint]);
      }
    }
  }, [canvasRef, canvasToWorld, isDraggingVertex, draggedVertex, getContoursAtCurrentSlice,
      selectedStructure, imageMetadata, onContourUpdate, isDrawingContinuous, findNearestVertex,
      points, isNearFirstPoint, completeShape]);
  
  // Handle mouse up
  const handleMouseUp = useCallback((e: MouseEvent) => {
    if (e.button === 0) { // Left button
      setIsDrawingContinuous(false);
    }
    
    if (isDraggingVertex) {
      setIsDraggingVertex(false);
      setDraggedVertex(null);
    }
  }, [isDraggingVertex]);
  
  // Handle right click
  const handleRightClick = useCallback((e: MouseEvent) => {
    e.preventDefault();
    
    if (points.length < 2) return;
    
    const rect = canvasRef.current!.getBoundingClientRect();
    const canvasX = e.clientX - rect.left;
    const canvasY = e.clientY - rect.top;
    const worldPoint = canvasToWorld(canvasX, canvasY);
    
    console.log('Right click - completing shape with point:', worldPoint);
    
    // Add final point and complete shape
    setPoints(prev => [...prev, worldPoint]);
    
    // Complete immediately after adding point
    setTimeout(() => {
      completeShape(true);
    }, 10);
  }, [points, canvasRef, canvasToWorld, completeShape]);
  
  // Setup overlay canvas
  useEffect(() => {
    if (!canvasRef.current || !isActive) return;
    
    const mainCanvas = canvasRef.current;
    console.log('Setting up overlay canvas, main canvas:', mainCanvas);
    
    if (!overlayCanvasRef.current) {
      const overlayCanvas = document.createElement('canvas');
      overlayCanvas.style.position = 'absolute';
      overlayCanvas.style.left = '0';
      overlayCanvas.style.top = '0';
      overlayCanvas.style.pointerEvents = 'none';
      overlayCanvas.style.width = mainCanvas.style.width;
      overlayCanvas.style.height = mainCanvas.style.height;
      overlayCanvas.width = mainCanvas.width;
      overlayCanvas.height = mainCanvas.height;
      overlayCanvas.style.zIndex = '10'; // Make sure it's on top
      
      console.log('Creating overlay canvas with size:', mainCanvas.width, 'x', mainCanvas.height);
      mainCanvas.parentElement?.appendChild(overlayCanvas);
      overlayCanvasRef.current = overlayCanvas;
      console.log('Overlay canvas created and appended');
    }
    
    // Update size if needed
    if (overlayCanvasRef.current.width !== mainCanvas.width ||
        overlayCanvasRef.current.height !== mainCanvas.height) {
      overlayCanvasRef.current.width = mainCanvas.width;
      overlayCanvasRef.current.height = mainCanvas.height;
    }
  }, [canvasRef, isActive]);
  
  // Render overlay with animation frame
  const render = useCallback(() => {
    if (!overlayCanvasRef.current) {
      console.log('No overlay canvas');
      return;
    }
    
    const ctx = overlayCanvasRef.current.getContext('2d');
    if (!ctx) {
      console.log('No context');
      return;
    }
    
    // Clear
    ctx.clearRect(0, 0, overlayCanvasRef.current.width, overlayCanvasRef.current.height);
    
    // Get structure color
    const structure = rtStructures?.structures?.find((s: any) => s.roiNumber === selectedStructure);
    const structureColor = structure?.color || [255, 255, 0];
    const colorStr = `rgb(${structureColor[0]}, ${structureColor[1]}, ${structureColor[2]})`;
    
    // Only draw vertex indicators when hovering, not the entire contour
    const contours = getContoursAtCurrentSlice();
    contours.forEach((contour: any, contourIdx: number) => {
      // Draw vertex dots only if hovering very close to boundary
      if (hoveredVertex && hoveredVertex.contourIdx === contourIdx && !isDrawingContinuous && !isDraggingVertex && currentMousePos) {
        // Check if we're actually near this contour's boundary
        const points = contour.points;
        let nearBoundary = false;
        for (let i = 0; i < points.length; i += 3) {
          const j = (i + 3) % points.length;
          const [x1, y1] = worldToCanvas(points[i], points[i + 1]);
          const [x2, y2] = worldToCanvas(points[j], points[j + 1]);
          
          // Distance from cursor to line segment
          const A = currentMousePos[0] - x1;
          const B = currentMousePos[1] - y1;
          const C = x2 - x1;
          const D = y2 - y1;
          
          const dot = A * C + B * D;
          const lenSq = C * C + D * D;
          let param = -1;
          
          if (lenSq !== 0) param = dot / lenSq;
          
          let xx, yy;
          if (param < 0) {
            xx = x1;
            yy = y1;
          } else if (param > 1) {
            xx = x2;
            yy = y2;
          } else {
            xx = x1 + param * C;
            yy = y1 + param * D;
          }
          
          const dx = currentMousePos[0] - xx;
          const dy = currentMousePos[1] - yy;
          const distance = Math.sqrt(dx * dx + dy * dy);
          
          if (distance < CONTOUR_HOVER_DISTANCE * 2) {
            nearBoundary = true;
            break;
          }
        }
        
        if (nearBoundary) {
          // Draw all vertices as small circles
          ctx.fillStyle = colorStr;
          ctx.globalAlpha = 0.8;
          
          for (let i = 0; i < points.length; i += 3) {
            const [x, y] = worldToCanvas(points[i], points[i + 1]);
            
            // Check if this is the hovered vertex
            if (hoveredVertex.pointIdx === i) {
              // Draw larger highlighted vertex
              ctx.fillStyle = '#ffffff';
              ctx.strokeStyle = colorStr;
              ctx.lineWidth = 2;
              ctx.globalAlpha = 1;
              ctx.beginPath();
              ctx.arc(x, y, 6, 0, Math.PI * 2);
              ctx.fill();
              ctx.stroke();
            } else {
              // Draw normal vertex
              ctx.fillStyle = colorStr;
              ctx.globalAlpha = 0.8;
              ctx.beginPath();
              ctx.arc(x, y, 4, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        }
      }
    });
    
    // Draw current shape
    if (points.length > 0) {
      console.log('Drawing pen tool points:', points.length, points);
      ctx.strokeStyle = colorStr;
      ctx.fillStyle = colorStr;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 1;
      
      // Draw lines
      ctx.beginPath();
      for (let i = 0; i < points.length; i++) {
        const [x, y] = worldToCanvas(points[i][0], points[i][1]);
        if (i === 0) {
          ctx.moveTo(x, y);
          
          // Draw mode indicator dot at first point
          const modeColor = startMode === 'ADD' ? '#00ff00' : '#ff0000';
          ctx.save();
          ctx.fillStyle = modeColor;
          ctx.globalAlpha = 1;
          ctx.beginPath();
          ctx.arc(x, y, 4, 0, Math.PI * 2);
          ctx.fill();
          
          // Add white border for visibility
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.restore();
        } else {
          ctx.lineTo(x, y);
        }
      }
      
      // Draw preview line to cursor
      if (currentMousePos && !isNearFirstPoint(currentMousePos[0], currentMousePos[1])) {
        ctx.lineTo(currentMousePos[0], currentMousePos[1]);
      }
      
      ctx.stroke();
      
      // Draw first point larger if we have 3+ points with bubble indicator
      if (points.length >= 3) {
        const [fx, fy] = worldToCanvas(points[0][0], points[0][1]);
        
        // Check if mouse is near first point to show bubble
        if (currentMousePos) {
          const dist = Math.sqrt((currentMousePos[0] - fx) ** 2 + (currentMousePos[1] - fy) ** 2);
          if (dist < CLOSE_THRESHOLD) {
            // Draw smaller purple bubble
            ctx.fillStyle = '#ff00ff';
            ctx.globalAlpha = 0.3;
            ctx.beginPath();
            ctx.arc(fx, fy, CLOSE_THRESHOLD, 0, Math.PI * 2);
            ctx.fill();
            
            // Draw bubble border
            ctx.strokeStyle = '#ff00ff';
            ctx.lineWidth = 1;
            ctx.globalAlpha = 0.6;
            ctx.stroke();
          }
        }
        
        // Draw solid center point
        ctx.fillStyle = '#ff00ff';
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(fx, fy, 6, 0, Math.PI * 2);
        ctx.fill();
        
        // Add white border for visibility
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
    
    // Draw initial cursor when not drawing yet
    if (currentMousePos && points.length === 0 && !isDraggingVertex) {
      // Check if we're inside any contour to show mode
      const worldPoint = canvasToWorld(currentMousePos[0], currentMousePos[1]);
      const contours = getContoursAtCurrentSlice();
      let insideAnyContour = false;
      
      for (const contour of contours) {
        if (contour.points && contour.points.length >= 9) {
          if (isPointInsideContour(worldPoint[0], worldPoint[1], contour.points)) {
            insideAnyContour = true;
            break;
          }
        }
      }
      
      // Draw mode indicator dot
      const modeColor = insideAnyContour ? '#00ff00' : '#ff0000'; // Green for ADD, Red for SUBTRACT
      ctx.save();
      ctx.fillStyle = modeColor;
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.arc(currentMousePos[0], currentMousePos[1], 5, 0, Math.PI * 2);
      ctx.fill();
      
      // Add white border for visibility
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    }
    
    // Set cursor style
    if (hoveredVertex && !isDrawingContinuous) {
      canvasRef.current!.style.cursor = 'grab';
    } else if (isDraggingVertex) {
      canvasRef.current!.style.cursor = 'grabbing';
    } else if (points.length >= 3 && currentMousePos && isNearFirstPoint(currentMousePos[0], currentMousePos[1])) {
      canvasRef.current!.style.cursor = 'pointer';
    } else {
      canvasRef.current!.style.cursor = 'crosshair';
    }
    
    animationFrameRef.current = requestAnimationFrame(render);
  }, [points, currentMousePos, hoveredVertex, isDrawingContinuous, isDraggingVertex,
      rtStructures, selectedStructure, worldToCanvas, getContoursAtCurrentSlice,
      isNearFirstPoint, canvasRef, canvasToWorld, isPointInsideContour, startMode]);
  
  // Start render loop
  useEffect(() => {
    if (!isActive) return;
    
    render();
    
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isActive, render]);
  
  // Setup event listeners
  useEffect(() => {
    if (!isActive || !canvasRef.current) return;
    
    const canvas = canvasRef.current;
    
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('contextmenu', handleRightClick);
    
    const handleGlobalMouseUp = (e: MouseEvent) => {
      handleMouseUp(e);
    };
    window.addEventListener('mouseup', handleGlobalMouseUp);
    
    return () => {
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseup', handleMouseUp);
      canvas.removeEventListener('contextmenu', handleRightClick);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [isActive, canvasRef, handleMouseDown, handleMouseMove, handleMouseUp, handleRightClick]);
  
  // Reset when deactivated
  useEffect(() => {
    if (!isActive) {
      setPoints([]);
      setIsDrawingContinuous(false);
      setCurrentMousePos(null);
      setStartMode(null);
      setHoveredVertex(null);
      setIsDraggingVertex(false);
      setDraggedVertex(null);
    }
  }, [isActive]);
  
  // Cleanup
  useEffect(() => {
    return () => {
      if (overlayCanvasRef.current?.parentElement) {
        overlayCanvasRef.current.parentElement.removeChild(overlayCanvasRef.current);
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);
  
  return null;
};