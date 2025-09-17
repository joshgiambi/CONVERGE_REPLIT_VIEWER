import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as ClipperLib from 'js-angusj-clipper';
import { isPointInContour } from '../../lib/clipper-boolean-operations';

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
  const [internalState, setInternalState] = useState<InternalPenState>({

  });
  
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
    
  // Track previous Z to detect slice changes  
  const prevZRef = useRef<number>(currentZ);
  
  // Eclipse-style slice change handling - clear everything when slice changes
  useEffect(() => {
    if (prevZRef.current === currentZ) return;   // still on same slice
    prevZRef.current = currentZ;

    // —— clear any stroke-in-progress ——
    setPoints([]);                 // discard unfinished path
    setStartMode(null);
    setHoveredVertex(null);
    setIsDraggingVertex(false);
    setDraggedVertex(null);
    setIsDrawingContinuous(false);
    setCurrentMousePos(null);

    // —— wipe the overlay canvas ——
    if (overlayCanvasRef.current) {
      const ctx = overlayCanvasRef.current.getContext('2d');
      ctx?.clearRect(
        0,
        0,
        overlayCanvasRef.current.width,
        overlayCanvasRef.current.height
      );
    }
  }, [currentZ]);
  
  // Clear/hide overlay when tool deactivates  
  useEffect(() => {
    if (!isActive && overlayCanvasRef.current) {
      const ctx = overlayCanvasRef.current.getContext('2d');
      ctx?.clearRect(0, 0, overlayCanvasRef.current.width, overlayCanvasRef.current.height);
      overlayCanvasRef.current.style.display = 'none';
    } else if (isActive && overlayCanvasRef.current) {
      overlayCanvasRef.current.style.display = 'block';
    }
  }, [isActive]);
  
  // Find existing contours at current slice using slice-thickness tolerance
  const getContoursAtCurrentSlice = useCallback(() => {
    if (!rtStructures?.structures || !selectedStructure) return [];
    
    const structure = rtStructures.structures.find((s: any) => s.roiNumber === selectedStructure);
    
    if (!structure?.contours) return [];
    
    // Eclipse-style slice-thickness tolerance
    const tol = (imageMetadata.sliceThickness ?? 1) / 2;   // mm
    const sameSlice = (z1: number, z2: number) => Math.abs(z1 - z2) < tol;
    
    console.log('🔍 Pen Tool Z-Debug:', {
      currentZ,
      sliceThickness: imageMetadata.sliceThickness,
      tolerance: tol,
      totalContours: structure.contours.length,
      structureId: selectedStructure
    });
    
    const contoursAtSlice = structure.contours.filter((contour: any) => {
      const zDiff = Math.abs(contour.slicePosition - currentZ);
      const matches = sameSlice(contour.slicePosition, currentZ);
      
      // Log near matches for debugging
      if (zDiff < 3) {
        console.log(`📍 Contour Z: ${contour.slicePosition}, Current Z: ${currentZ}, Diff: ${zDiff}mm, Tolerance: ${tol}mm, Match: ${matches}`);
      }
      
      return matches;
    });
    
    console.log(`✅ Found ${contoursAtSlice.length} contours at current slice (tolerance: ${tol}mm)`);
    return contoursAtSlice;
  }, [rtStructures, selectedStructure, currentZ, imageMetadata.sliceThickness]);
  
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
    
    // Current Z in micrometers for exact comparison
    const currentZMicrons = Math.round(currentZ * 1000);
    
    // First check if we're near any contour boundary
    for (let contourIdx = 0; contourIdx < contours.length; contourIdx++) {
      const contour = contours[contourIdx];
      
      // Double-check Z position to prevent ghost contours
      const contourZMicrons = Math.round(contour.slicePosition * 1000);
      if (contourZMicrons !== currentZMicrons) {
        continue; // Skip contours not on current slice
      }
      
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
  }, [getContoursAtCurrentSlice, worldToCanvas, canvasToWorld, currentZ]);
  
  // Check if near first point for closing
  const isNearFirstPoint = useCallback((canvasX: number, canvasY: number) => {
    if (points.length === 0) return false;
    
    const [firstX, firstY] = worldToCanvas(points[0][0], points[0][1]);
    const distance = Math.sqrt((canvasX - firstX) ** 2 + (canvasY - firstY) ** 2);
    
    return distance < CLOSE_THRESHOLD;
  }, [points, worldToCanvas]);
  
  // Check if a point is inside a polygon using ray casting algorithm
  const isPointInPolygon = (point: [number, number], polygon: [number, number][]) => {
    let inside = false;
    const x = point[0], y = point[1];
    
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i][0], yi = polygon[i][1];
      const xj = polygon[j][0], yj = polygon[j][1];
      
      const intersect = ((yi > y) !== (yj > y))
          && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    
    return inside;
  };
  
  // Check if new polygon intersects with any existing contour
  const doesNewPolygonIntersect = useCallback((newPoints: [number, number][], existingContours: any[]) => {
    // Check each existing contour for actual intersection
    for (const contour of existingContours) {
      // Convert contour points to 2D array
      const contourPoints: [number, number][] = [];
      for (let i = 0; i < contour.points.length; i += 3) {
        contourPoints.push([contour.points[i], contour.points[i + 1]]);
      }
      
      // Check if any edge of the new polygon crosses any edge of the existing contour
      for (let i = 0; i < newPoints.length; i++) {
        const p1 = newPoints[i];
        const p2 = newPoints[(i + 1) % newPoints.length];
        
        for (let j = 0; j < contourPoints.length; j++) {
          const p3 = contourPoints[j];
          const p4 = contourPoints[(j + 1) % contourPoints.length];
          
          // Check if line segments p1-p2 and p3-p4 intersect
          const d1 = (p4[0] - p3[0]) * (p1[1] - p3[1]) - (p4[1] - p3[1]) * (p1[0] - p3[0]);
          const d2 = (p4[0] - p3[0]) * (p2[1] - p3[1]) - (p4[1] - p3[1]) * (p2[0] - p3[0]);
          const d3 = (p2[0] - p1[0]) * (p3[1] - p1[1]) - (p2[1] - p1[1]) * (p3[0] - p1[0]);
          const d4 = (p2[0] - p1[0]) * (p4[1] - p1[1]) - (p2[1] - p1[1]) * (p4[0] - p1[0]);
          
          // If signs differ, segments intersect
          if (d1 * d2 < 0 && d3 * d4 < 0) {
            return true; // Found intersection
          }
        }
      }
      
      // Also check if any point of new polygon is inside the contour
      // This handles cases where one polygon is completely inside another
      const firstPoint = newPoints[0];
      if (isPointInPolygon(firstPoint, contourPoints)) {
        return true;
      }
    }
    
    return false;
  }, []);

  // Complete the shape and apply boolean operation
  const completeShape = useCallback(async (addFinalPoint: boolean = false, finalPoint?: [number, number]) => {
    console.log('🎯 COMPLETE SHAPE CALLED:', {
      pointsCount: points.length,
      minRequired: 3,
      willProceed: points.length >= 3,
      selectedStructure,
      startMode,
      currentZ
    });
    

    
    if (points.length < 3) {
      console.log('❌ Not enough points to complete shape');
      return;
    }
    
    console.log('📍 Continuing after alert...');
    
    try {
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
      onContourUpdate('add_pen_stroke', {
        structureId: selectedStructure,
        points: worldPoints,
        slicePosition: currentZ,
        imageMetadata
      });
    } else {
      // Eclipse-style operation detection from first click
      const firstClickPoint = points[0];
      
      // Check if first click was inside any contour
      const startInside = existingContours.some((contour: any) => {
        if (contour.points && contour.points.length >= 9) {
          return isPointInContour(firstClickPoint, contour.points);
        }
        return false;
      });
      
      // Check if new polygon intersects with existing contours
      const intersectsStructure = doesNewPolygonIntersect(finalPoints, existingContours);
      
      // Eclipse-style operation determination: exactly as user specified
      const operation = startInside ? 'union' :           // first click inside → add
                       intersectsStructure ? 'subtract' : // first click outside *and* stroke crosses → carve hole  
                                           'separate';     // first click outside, never touches → new blob
      
      console.log('🎯 ECLIPSE-STYLE OPERATION DETERMINED:', {
        startInside,
        intersectsStructure,
        operation,
        firstClickPoint,
        existingContours: existingContours.length,
        newPolygonPoints: finalPoints.length
      });
      
      // Prepare world points
      const worldPoints: number[] = [];
      finalPoints.forEach(([x, y]) => {
        worldPoints.push(x, y, currentZ);
      });
      
      // Execute the determined operation
      onContourUpdate('pen_boolean_operation', {
        structureId: selectedStructure,
        points: worldPoints,
        slicePosition: currentZ,
        operation,
        imageMetadata
      });
    }
    
    // Reset state
    setPoints([]);
    setIsDrawingContinuous(false);
    setStartMode(null);
    } catch (error) {
      console.error('❌ Error in completeShape:', error);
      alert(`Error completing shape: ${error.message || error}`);
    }
  }, [points, currentZ, startMode, selectedStructure, imageMetadata, onContourUpdate, getContoursAtCurrentSlice, doesNewPolygonIntersect, isPointInsideContour]);
  
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
      const nearFirst = isNearFirstPoint(canvasX, canvasY);
      console.log('🎯 Click near first point check:', {
        nearFirst,
        pointsCount: points.length,
        canRequire3: points.length >= 3
      });
      
      if (nearFirst && points.length >= 3) {
        console.log('✅ Completing shape by clicking near first point');
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
      console.log(`🎯 PEN TOOL START MODE: ${mode} (inside contour: ${insideAnyContour})`, {
        clickPoint: worldPoint,
        numContours: contours.length,
        contourPoints: contours.map((c: any) => c.points?.length || 0)
      });
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
      onContourUpdate('replace_contour', {
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
    
    console.log('🔴 Right-click detected, points:', points.length);
    
    if (points.length < 2) {
      console.log('❌ Not enough points for right-click completion');
      return;
    }
    
    const rect = canvasRef.current!.getBoundingClientRect();
    const canvasX = e.clientX - rect.left;
    const canvasY = e.clientY - rect.top;
    const worldPoint = canvasToWorld(canvasX, canvasY);
    
    console.log('✅ Right click - completing shape with final point:', worldPoint);
    
    // Add final point and complete shape
    setPoints(prev => [...prev, worldPoint]);
    
    // Complete immediately after adding point
    setTimeout(() => {
      console.log('⏱️ Calling completeShape after timeout');
      completeShape(true);
    }, 10);
  }, [points, canvasRef, canvasToWorld, completeShape]);
  
  // Setup overlay canvas
  useEffect(() => {
    if (!canvasRef.current || !isActive) {
      console.log('Pen tool setup skipped:', { hasCanvas: !!canvasRef.current, isActive });
      return;
    }
    
    const mainCanvas = canvasRef.current;
    console.log('Setting up overlay canvas, main canvas:', mainCanvas);
    console.log('Main canvas parent:', mainCanvas.parentElement);
    
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
      overlayCanvas.style.zIndex = '1000'; // Higher z-index to ensure visibility
      overlayCanvas.style.border = '2px solid red'; // DEBUG: Add visible border
      
      console.log('Creating overlay canvas with size:', mainCanvas.width, 'x', mainCanvas.height);
      console.log('Overlay canvas styles:', {
        position: overlayCanvas.style.position,
        zIndex: overlayCanvas.style.zIndex,
        width: overlayCanvas.style.width,
        height: overlayCanvas.style.height
      });
      
      mainCanvas.parentElement?.appendChild(overlayCanvas);
      overlayCanvasRef.current = overlayCanvas;
      console.log('Overlay canvas created and appended to parent:', mainCanvas.parentElement);
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
    
    // Remove debug rectangle - overlay is confirmed working
    
    // Remove verbose render logging
    
    // Get structure color
    const structure = rtStructures?.structures?.find((s: any) => s.roiNumber === selectedStructure);
    const structureColor = structure?.color || [255, 255, 0];
    const colorStr = `rgb(${structureColor[0]}, ${structureColor[1]}, ${structureColor[2]})`;
    
    // Draw existing contours with vertex indicators when hovering
    const contours = getContoursAtCurrentSlice();
    
    // Double-check we're only rendering contours for the exact current slice
    const validContours = contours.filter((contour: any) => {
      const contourZMicrons = Math.round(contour.slicePosition * 1000);
      const currentZMicrons = Math.round(currentZ * 1000);
      return contourZMicrons === currentZMicrons;
    });
    
    validContours.forEach((contour: any, contourIdx: number) => {
      // Draw faint contour outline
      ctx.strokeStyle = colorStr;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.3;
      ctx.beginPath();
      
      const points = contour.points;
      for (let i = 0; i < points.length; i += 3) {
        const [cx, cy] = worldToCanvas(points[i], points[i + 1]);
        if (i === 0) {
          ctx.moveTo(cx, cy);
        } else {
          ctx.lineTo(cx, cy);
        }
      }
      ctx.closePath();
      ctx.stroke();
      
      // Draw vertex dots only if hovering very close to boundary
      if (hoveredVertex && hoveredVertex.contourIdx === contourIdx && !isDrawingContinuous && !isDraggingVertex && currentMousePos) {
        // Check if we're actually near this contour's boundary
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
    if (!isActive) {
      console.log('🔷 Pen tool render loop - not active');
      return;
    }
    
    console.log('🔷 Starting pen tool render loop');
    render();
    
    return () => {
      console.log('🔷 Stopping pen tool render loop');
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