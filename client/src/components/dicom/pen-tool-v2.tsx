import React, { useRef, useEffect, useState, useCallback } from 'react';
import { isPointInContour, combineContours, subtractContours } from '../../lib/clipper-boolean-operations';

interface PenToolV2Props {
  isActive: boolean;
  selectedStructure: number | null;
  rtStructures: any;
  currentSlicePosition: number;
  imageMetadata: any;
  onContourUpdate: (payload: any) => void;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  ctTransform: React.RefObject<any>;
}

interface Point {
  x: number;
  y: number;
}

// Eclipse Pen Tool V2 - Clean implementation with proper boolean operations
export default function PenToolV2({
  isActive,
  selectedStructure,
  rtStructures,
  currentSlicePosition,
  imageMetadata,
  onContourUpdate,
  canvasRef,
  ctTransform
}: PenToolV2Props) {
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  
  // Drawing state
  const [vertices, setVertices] = useState<Point[]>([]);
  const [mousePosition, setMousePosition] = useState<Point | null>(null);
  const [isDrawingContinuous, setIsDrawingContinuous] = useState(false);
  const [operationMode, setOperationMode] = useState<'union' | 'subtract' | 'new' | null>(null);

  // Get contours at current slice
  const getContoursAtCurrentSlice = useCallback(() => {
    if (!selectedStructure || !rtStructures?.structures) return [];
    
    const structure = rtStructures.structures.find((s: any) => s.roiNumber === selectedStructure);
    if (!structure?.contours) return [];
    
    // Convert currentSlicePosition to micrometers for exact comparison
    const currentZMicro = Math.round(currentSlicePosition * 1000);
    
    return structure.contours.filter((contour: any) => {
      if (!contour.imagePosition) return false;
      const contourZMicro = Math.round(contour.imagePosition * 1000);
      return contourZMicro === currentZMicro;
    });
  }, [selectedStructure, rtStructures, currentSlicePosition]);

  // Initialize overlay canvas
  useEffect(() => {
    if (!canvasRef.current || !isActive) return;

    const mainCanvas = canvasRef.current;
    let overlay = overlayCanvasRef.current;
    
    if (!overlay) {
      overlay = document.createElement('canvas');
      overlay.style.position = 'absolute';
      overlay.style.top = '0';
      overlay.style.left = '0';
      overlay.style.pointerEvents = 'none';
      overlay.style.zIndex = '10';
      overlay.className = 'pen-tool-overlay';
      
      mainCanvas.parentElement?.appendChild(overlay);
      overlayCanvasRef.current = overlay;
    }
    
    overlay.width = mainCanvas.width;
    overlay.height = mainCanvas.height;

    return () => {
      const overlayElement = document.querySelector('.pen-tool-overlay');
      if (overlayElement && overlayElement.parentElement) {
        overlayElement.parentElement.removeChild(overlayElement);
      }
      overlayCanvasRef.current = null;
    };
  }, [isActive, canvasRef]);

  // Convert canvas coordinates to world coordinates
  const canvasToWorld = useCallback((canvasX: number, canvasY: number) => {
    if (!imageMetadata) return { x: 0, y: 0, z: currentSlicePosition };
    
    const transform = ctTransform?.current || { scale: 1, offsetX: 0, offsetY: 0 };
    
    // Convert canvas to pixel coordinates (undo zoom/pan)
    const pixelX = (canvasX - transform.offsetX) / transform.scale;
    const pixelY = (canvasY - transform.offsetY) / transform.scale;
    
    // Parse DICOM metadata
    const imagePosition = imageMetadata.imagePosition.split('\\').map(Number);
    const pixelSpacing = imageMetadata.pixelSpacing.split('\\').map(Number);
    const [rowSpacing, colSpacing] = pixelSpacing;
    
    // Convert to world coordinates
    const worldX = imagePosition[0] + (pixelX * colSpacing);
    const worldY = imagePosition[1] + (pixelY * rowSpacing);
    
    return { x: worldX, y: worldY, z: currentSlicePosition };
  }, [imageMetadata, currentSlicePosition, ctTransform]);

  // Convert world coordinates to canvas coordinates  
  const worldToCanvas = useCallback((worldX: number, worldY: number) => {
    if (!imageMetadata) return { x: 0, y: 0 };
    
    const transform = ctTransform?.current || { scale: 1, offsetX: 0, offsetY: 0 };
    
    // Parse DICOM metadata
    const imagePosition = imageMetadata.imagePosition.split('\\').map(Number);
    const pixelSpacing = imageMetadata.pixelSpacing.split('\\').map(Number);
    const [rowSpacing, colSpacing] = pixelSpacing;
    
    // Convert world to pixel coordinates
    const pixelX = (worldX - imagePosition[0]) / colSpacing;
    const pixelY = (worldY - imagePosition[1]) / rowSpacing;
    
    // Apply zoom/pan transform
    const canvasX = transform.offsetX + (pixelX * transform.scale);
    const canvasY = transform.offsetY + (pixelY * transform.scale);
    
    return { x: canvasX, y: canvasY };
  }, [imageMetadata, ctTransform]);

  // Determine operation mode based on first click context
  const determineOperationMode = useCallback((firstWorldPoint: Point): 'union' | 'subtract' | 'new' => {
    const contours = getContoursAtCurrentSlice();
    if (contours.length === 0) return 'new';
    
    // Check if first point is inside any existing contour
    for (const contour of contours) {
      if (isPointInContour([firstWorldPoint.x, firstWorldPoint.y], contour.points)) {
        console.log('🔷 First click INSIDE existing contour → UNION mode');
        return 'union';
      }
    }
    
    console.log('🔷 First click OUTSIDE existing contours → Will check for crossing when complete');
    return 'subtract'; // Will be refined when polygon is complete
  }, [getContoursAtCurrentSlice]);

  // Check if point is near first vertex (for closing polygon)
  const isNearFirstVertex = useCallback((point: Point): boolean => {
    if (vertices.length < 3) return false;
    
    const firstVertex = vertices[0];
    const distance = Math.sqrt(
      Math.pow(point.x - firstVertex.x, 2) + Math.pow(point.y - firstVertex.y, 2)
    );
    
    return distance < 12; // 12 pixel tolerance for easy closing
  }, [vertices]);

  // Get structure color
  const getStructureColor = useCallback(() => {
    if (!selectedStructure || !rtStructures?.structures) return '#00ff00';
    
    const structure = rtStructures.structures.find(
      (s: any) => s.roiNumber === selectedStructure
    );
    
    if (structure?.color) {
      const [r, g, b] = structure.color;
      return `rgb(${r}, ${g}, ${b})`;
    }
    
    return '#00ff00';
  }, [selectedStructure, rtStructures]);

  // Check if new polygon crosses existing contours
  const doesPolygonCrossExisting = useCallback((newVertices: Point[]): boolean => {
    const contours = getContoursAtCurrentSlice();
    if (contours.length === 0) return false;
    
    // Convert vertices to world coordinates for intersection testing
    const worldVertices = newVertices.map(v => canvasToWorld(v.x, v.y));
    
    for (const contour of contours) {
      // Convert contour points to 2D array for intersection testing
      const contourPoints: [number, number][] = [];
      for (let i = 0; i < contour.points.length; i += 3) {
        contourPoints.push([contour.points[i], contour.points[i + 1]]);
      }
      
      // Check if any edge of new polygon crosses any edge of existing contour
      for (let i = 0; i < worldVertices.length; i++) {
        const p1 = worldVertices[i];
        const p2 = worldVertices[(i + 1) % worldVertices.length];
        
        for (let j = 0; j < contourPoints.length; j++) {
          const p3 = contourPoints[j];
          const p4 = contourPoints[(j + 1) % contourPoints.length];
          
          // Line intersection check
          if (doLinesIntersect(p1, p2, p3, p4)) {
            return true;
          }
        }
      }
    }
    
    return false;
  }, [getContoursAtCurrentSlice, canvasToWorld]);

  // Line intersection helper
  const doLinesIntersect = (p1: Point, p2: Point, p3: [number, number], p4: [number, number]): boolean => {
    const denom = (p1.x - p2.x) * (p3[1] - p4[1]) - (p1.y - p2.y) * (p3[0] - p4[0]);
    if (Math.abs(denom) < 1e-10) return false; // Parallel lines
    
    const t = ((p1.x - p3[0]) * (p3[1] - p4[1]) - (p1.y - p3[1]) * (p3[0] - p4[0])) / denom;
    const u = -((p1.x - p2.x) * (p1.y - p3[1]) - (p1.y - p2.y) * (p1.x - p3[0])) / denom;
    
    return t >= 0 && t <= 1 && u >= 0 && u <= 1;
  };

  // Handle mouse events
  const handleMouseDown = useCallback((event: MouseEvent) => {
    if (!isActive || !selectedStructure || !canvasRef.current) return;
    
    const rect = canvasRef.current.getBoundingClientRect();
    const canvasPoint = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };

    if (event.button === 0) { // Left click
      if (isNearFirstVertex(canvasPoint) && vertices.length >= 3) {
        // Close polygon by clicking near first vertex
        completePolygon();
        return;
      }
      
      // Add vertex
      setVertices(prev => [...prev, canvasPoint]);
      
      // Determine operation mode on first click
      if (vertices.length === 0 && !operationMode) {
        const worldPoint = canvasToWorld(canvasPoint.x, canvasPoint.y);
        const mode = determineOperationMode(worldPoint);
        setOperationMode(mode);
        console.log(`🔷 Operation mode set to: ${mode}`);
      }
      
      // Start continuous drawing if holding down
      setIsDrawingContinuous(true);
      
    } else if (event.button === 2) { // Right click
      event.preventDefault();
      if (vertices.length >= 3) {
        completePolygon();
      }
    }
  }, [isActive, selectedStructure, vertices, operationMode, isNearFirstVertex, canvasToWorld, determineOperationMode]);

  const handleMouseMove = useCallback((event: MouseEvent) => {
    if (!isActive || !canvasRef.current) return;
    
    const rect = canvasRef.current.getBoundingClientRect();
    const canvasPoint = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
    
    setMousePosition(canvasPoint);
    
    // Add points during continuous drawing
    if (isDrawingContinuous && vertices.length > 0) {
      // Check if we're near first vertex to close
      if (vertices.length >= 3 && isNearFirstVertex(canvasPoint)) {
        completePolygon();
        setIsDrawingContinuous(false);
        return;
      }
      
      const lastVertex = vertices[vertices.length - 1];
      const distance = Math.sqrt(
        Math.pow(canvasPoint.x - lastVertex.x, 2) + Math.pow(canvasPoint.y - lastVertex.y, 2)
      );
      
      // Add point if moved enough distance (continuous drawing)
      if (distance > 8) {
        setVertices(prev => [...prev, canvasPoint]);
      }
    }
  }, [isActive, isDrawingContinuous, vertices, isNearFirstVertex]);

  const handleMouseUp = useCallback((event: MouseEvent) => {
    if (event.button === 0) { // Left button
      setIsDrawingContinuous(false);
    }
  }, []);

  const handleContextMenu = useCallback((event: Event) => {
    if (isActive) {
      event.preventDefault();
    }
  }, [isActive]);

  // Complete polygon with proper Eclipse boolean operations
  const completePolygon = useCallback(async () => {
    if (vertices.length < 3 || !selectedStructure || !operationMode) return;
    
    console.log(`🔷 PenToolV2: Completing polygon with ${vertices.length} vertices, mode: ${operationMode}`);
    
    // Convert vertices to world coordinates
    const worldPoints: number[] = [];
    vertices.forEach(vertex => {
      const world = canvasToWorld(vertex.x, vertex.y);
      worldPoints.push(world.x, world.y, world.z);
    });
    
    const contours = getContoursAtCurrentSlice();
    
    // Refine operation mode if it was initially set to 'subtract'
    let finalMode = operationMode;
    if (operationMode === 'subtract') {
      const crosses = doesPolygonCrossExisting(vertices);
      if (crosses) {
        finalMode = 'subtract';
        console.log('🔷 Polygon CROSSES existing contours → SUBTRACT mode (carve hole)');
      } else {
        finalMode = 'new';
        console.log('🔷 Polygon SEPARATE from existing contours → NEW BLOB mode');
      }
    }
    
    // Apply boolean operations
    let resultContours: number[][] = [];
    
    if (finalMode === 'new' || contours.length === 0) {
      // Simple addition - new separate contour
      resultContours = [worldPoints];
      console.log('🔷 Adding new separate contour');
      
    } else if (finalMode === 'union') {
      // Union with existing contours
      console.log('🔷 Performing UNION operation');
      if (contours.length > 0) {
        // Combine new polygon with first existing contour
        const existingContour = contours[0].points;
        resultContours = await combineContours(existingContour, worldPoints);
      } else {
        resultContours = [worldPoints];
      }
      
    } else if (finalMode === 'subtract') {
      // Subtract from existing contours
      console.log('🔷 Performing SUBTRACT operation');
      if (contours.length > 0) {
        const existingContour = contours[0].points;
        resultContours = await subtractContours(existingContour, worldPoints);
      }
    }
    
    // Send boolean operation result to parent
    if (onContourUpdate && resultContours.length > 0) {
      onContourUpdate({
        action: "pen_boolean_operation",
        operation: finalMode,
        structureId: selectedStructure,
        slicePosition: currentSlicePosition,
        resultContours: resultContours,
        originalPolygon: worldPoints
      });
    }
    
    // Reset state
    setVertices([]);
    setIsDrawingContinuous(false);
    setOperationMode(null);
    setMousePosition(null);
    
    console.log('🔷 PenToolV2: Polygon completed and boolean operation applied');
  }, [vertices, selectedStructure, operationMode, currentSlicePosition, canvasToWorld, 
      getContoursAtCurrentSlice, doesPolygonCrossExisting, onContourUpdate]);

  // Reset state on slice change
  useEffect(() => {
    setVertices([]);
    setIsDrawingContinuous(false);
    setOperationMode(null);
    setMousePosition(null);
  }, [currentSlicePosition]);

  // Set up event listeners
  useEffect(() => {
    if (!isActive || !canvasRef.current) return;
    
    const canvas = canvasRef.current;
    
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('contextmenu', handleContextMenu);
    
    return () => {
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseup', handleMouseUp);
      canvas.removeEventListener('contextmenu', handleContextMenu);
    };
  }, [isActive, handleMouseDown, handleMouseMove, handleMouseUp, handleContextMenu]);

  // Draw overlay with Eclipse-style visual feedback
  const drawOverlay = useCallback(() => {
    const overlay = overlayCanvasRef.current;
    if (!overlay || !isActive) return;
    
    const ctx = overlay.getContext('2d');
    if (!ctx) return;
    
    // Clear canvas
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    
    const structureColor = getStructureColor();
    
    // Draw completed vertices
    if (vertices.length > 0) {
      ctx.strokeStyle = structureColor;
      ctx.fillStyle = structureColor;
      ctx.lineWidth = 2;
      
      // Draw polygon edges
      ctx.beginPath();
      vertices.forEach((vertex, index) => {
        if (index === 0) {
          ctx.moveTo(vertex.x, vertex.y);
        } else {
          ctx.lineTo(vertex.x, vertex.y);
        }
      });
      
      // Draw preview line to mouse
      if (mousePosition && vertices.length > 0) {
        ctx.setLineDash([5, 3]); // Dashed preview line
        ctx.lineTo(mousePosition.x, mousePosition.y);
        
        // Show close indicator if near first vertex
        if (vertices.length >= 3 && isNearFirstVertex(mousePosition)) {
          ctx.lineTo(vertices[0].x, vertices[0].y);
        }
      }
      
      ctx.stroke();
      ctx.setLineDash([]); // Reset to solid line
      
      // Draw vertices as circles
      vertices.forEach((vertex, index) => {
        ctx.beginPath();
        ctx.arc(vertex.x, vertex.y, 4, 0, 2 * Math.PI);
        
        if (index === 0 && vertices.length >= 3) {
          // Highlight first vertex for closing with pulsing effect
          const pulseRadius = 4 + Math.sin(Date.now() / 200) * 2;
          ctx.beginPath();
          ctx.arc(vertex.x, vertex.y, pulseRadius, 0, 2 * Math.PI);
          ctx.fillStyle = '#ffff00'; // Yellow highlight
          ctx.fill();
          ctx.strokeStyle = '#000000';
          ctx.lineWidth = 2;
          ctx.stroke();
        } else {
          ctx.fillStyle = structureColor;
          ctx.fill();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      });
      
      // Show operation mode indicator
      if (operationMode && vertices.length > 0) {
        ctx.font = '12px Arial';
        ctx.fillStyle = operationMode === 'union' ? '#00ff00' : 
                       operationMode === 'subtract' ? '#ff0000' : '#0080ff';
        const modeText = operationMode === 'union' ? 'UNION' : 
                        operationMode === 'subtract' ? 'SUBTRACT' : 'NEW';
        ctx.fillText(modeText, vertices[0].x + 10, vertices[0].y - 10);
      }
    }
  }, [isActive, vertices, mousePosition, operationMode, getStructureColor, isNearFirstVertex]);

  // Animation loop for smooth visual feedback
  useEffect(() => {
    let animationId: number;
    
    const animate = () => {
      drawOverlay();
      animationId = requestAnimationFrame(animate);
    };

    if (isActive && (vertices.length > 0 || mousePosition)) {
      animate();
    }

    return () => {
      if (animationId) {
        cancelAnimationFrame(animationId);
      }
    };
  }, [isActive, drawOverlay, vertices.length, mousePosition]);

  // Reset when switching structures or becoming inactive
  useEffect(() => {
    if (!isActive) {
      setVertices([]);
      setIsDrawingContinuous(false);
      setOperationMode(null);
      setMousePosition(null);
    }
  }, [isActive, selectedStructure]);

  return null; // This component only handles interactions
}