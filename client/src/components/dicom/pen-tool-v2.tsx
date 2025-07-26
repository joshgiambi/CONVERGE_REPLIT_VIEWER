import React, { useRef, useEffect, useState, useCallback } from 'react';
import { isPointInContour, unionContours, subtractContours } from '../../lib/clipper-boolean-operations';

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
    setMousePosition({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    });
  }, [isActive]);

  const handleContextMenu = useCallback((event: Event) => {
    if (isActive) {
      event.preventDefault();
    }
  }, [isActive]);

  // Complete polygon and send to parent
  const completePolygon = useCallback(() => {
    if (vertices.length < 3 || !selectedStructure) return;
    
    console.log(`PenToolV2: Completing polygon with ${vertices.length} vertices`);
    
    // Convert vertices to world coordinates
    const worldPoints: number[] = [];
    vertices.forEach(vertex => {
      const world = canvasToWorld(vertex.x, vertex.y);
      worldPoints.push(world.x, world.y, world.z);
    });
    
    console.log('PenToolV2: First 3 world points:', worldPoints.slice(0, 9));
    
    // Send to parent component
    if (onContourUpdate) {
      onContourUpdate({
        action: "add_pen_stroke",
        structureId: selectedStructure,
        slicePosition: currentSlicePosition,
        points: worldPoints,
        pointCount: vertices.length
      });
    }
    
    // Reset state
    setVertices([]);
    setIsDrawing(false);
    setIsComplete(true);
  }, [vertices, selectedStructure, currentSlicePosition, canvasToWorld, onContourUpdate]);

  // Set up event listeners
  useEffect(() => {
    if (!isActive || !canvasRef.current) return;
    
    const canvas = canvasRef.current;
    
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('contextmenu', handleContextMenu);
    
    return () => {
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('contextmenu', handleContextMenu);
    };
  }, [isActive, handleMouseDown, handleMouseMove, handleContextMenu]);

  // Draw overlay
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
      if (isDrawing && mousePosition && vertices.length > 0) {
        ctx.lineTo(mousePosition.x, mousePosition.y);
      }
      
      ctx.stroke();
      
      // Draw vertices as circles
      vertices.forEach((vertex, index) => {
        ctx.beginPath();
        ctx.arc(vertex.x, vertex.y, 4, 0, 2 * Math.PI);
        
        if (index === 0 && vertices.length >= 3) {
          // First vertex - highlight in purple for close indication
          ctx.fillStyle = '#8b5cf6';
          ctx.fill();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2;
          ctx.stroke();
        } else {
          ctx.fillStyle = structureColor;
          ctx.fill();
        }
      });
    }
    
    // Draw cursor
    if (mousePosition && isDrawing) {
      ctx.strokeStyle = structureColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(mousePosition.x, mousePosition.y, 3, 0, 2 * Math.PI);
      ctx.stroke();
      
      // Show close indicator if near first vertex
      if (isNearFirstVertex(mousePosition)) {
        ctx.strokeStyle = '#8b5cf6';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(vertices[0].x, vertices[0].y, 8, 0, 2 * Math.PI);
        ctx.stroke();
      }
    }
  }, [isActive, vertices, mousePosition, isDrawing, getStructureColor, isNearFirstVertex]);

  // Animation loop
  useEffect(() => {
    const animate = () => {
      drawOverlay();
      animationFrameRef.current = requestAnimationFrame(animate) as number;
    };

    if (isActive) {
      animate();
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isActive, drawOverlay]);

  // Reset when switching structures or becoming inactive
  useEffect(() => {
    if (!isActive) {
      setVertices([]);
      setIsDrawing(false);
      setIsComplete(false);
      setMousePosition(null);
    }
  }, [isActive, selectedStructure]);

  return null; // This component only handles interactions
}