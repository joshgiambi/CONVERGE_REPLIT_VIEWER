import React, { useRef, useEffect, useState, useCallback } from 'react';
import { combineContours, subtractContours } from '../../lib/clipper-boolean-operations';
import { polygonUnion } from '../../lib/polygon-union';

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

// Helper function to check if two polygons intersect
function doPolygonsIntersect(polygon1: number[], polygon2: number[]): boolean {
  // Convert flat arrays to points
  const points1: [number, number][] = [];
  const points2: [number, number][] = [];
  
  for (let i = 0; i < polygon1.length; i += 3) {
    points1.push([polygon1[i], polygon1[i + 1]]);
  }
  
  for (let i = 0; i < polygon2.length; i += 3) {
    points2.push([polygon2[i], polygon2[i + 1]]);
  }
  
  // Check if any point from polygon1 is inside polygon2 or vice versa
  for (const point of points1) {
    if (isPointInPolygon(point, points2)) {
      return true;
    }
  }
  
  for (const point of points2) {
    if (isPointInPolygon(point, points1)) {
      return true;
    }
  }
  
  // Check if any edges intersect
  for (let i = 0; i < points1.length; i++) {
    const a1 = points1[i];
    const a2 = points1[(i + 1) % points1.length];
    
    for (let j = 0; j < points2.length; j++) {
      const b1 = points2[j];
      const b2 = points2[(j + 1) % points2.length];
      
      if (doSegmentsIntersect(a1, a2, b1, b2)) {
        return true;
      }
    }
  }
  
  return false;
}

// Helper function to check if a point is inside a polygon
function isPointInPolygon(point: [number, number], polygon: [number, number][]): boolean {
  let inside = false;
  const [x, y] = point;
  
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  
  return inside;
}

// Helper function to check if two line segments intersect
function doSegmentsIntersect(a1: [number, number], a2: [number, number], b1: [number, number], b2: [number, number]): boolean {
  const ccw = (A: [number, number], B: [number, number], C: [number, number]) => {
    return (C[1] - A[1]) * (B[0] - A[0]) > (B[1] - A[1]) * (C[0] - A[0]);
  };
  
  return ccw(a1, b1, b2) !== ccw(a2, b1, b2) && ccw(a1, a2, b1) !== ccw(a1, a2, b2);
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
    
    // Filter contours at current slice position
    const tolerance = 1.5; // mm tolerance for slice matching
    const contours = structure.contours.filter((contour: any) => {
      return Math.abs(contour.slicePosition - currentSlicePosition) <= tolerance;
    });
    
    // Convert contours to the format expected by boolean operations
    return contours.map((contour: any) => ({
      points: contour.points,
      slicePosition: contour.slicePosition
    }));
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
      (overlayCanvasRef as any).current = overlay;
    }
    
    overlay.width = mainCanvas.width;
    overlay.height = mainCanvas.height;

    return () => {
      const overlayElement = document.querySelector('.pen-tool-overlay');
      if (overlayElement && overlayElement.parentElement) {
        overlayElement.parentElement.removeChild(overlayElement);
      }
      (overlayCanvasRef as any).current = null;
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
  const determineOperationMode = useCallback(async (firstWorldPoint: Point): Promise<'union' | 'subtract' | 'new'> => {
    if (!selectedStructure || !rtStructures?.structures) return 'new';
    
    // Find the selected structure
    const structure = rtStructures.structures.find(
      (s: any) => s.roiNumber === selectedStructure
    );
    
    if (!structure || !structure.contours) return 'new';
    
    // Get contours for selected structure at current slice
    const tolerance = 1.5;
    const contoursAtSlice = structure.contours.filter(
      (c: any) => Math.abs(c.slicePosition - currentSlicePosition) <= tolerance
    );
    
    if (contoursAtSlice.length === 0) {
      console.log('🔷 No existing contours at this slice → NEW mode');
      return 'new';
    }
    
    // Check if first point is inside any existing contour of selected structure
    for (const contour of contoursAtSlice) {
      // Convert contour points to 2D array
      const contourPoints: [number, number][] = [];
      for (let i = 0; i < contour.points.length; i += 3) {
        contourPoints.push([contour.points[i], contour.points[i + 1]]);
      }
      
      // Check if point is inside contour using simple polygon check
      const isInside = isPointInPolygon([firstWorldPoint.x, firstWorldPoint.y], contourPoints);
      if (isInside) {
        console.log('🔷 First click INSIDE existing contour → UNION mode');
        return 'union';
      }
    }
    
    console.log('🔷 First click OUTSIDE existing contours → NEW mode');
    return 'new'; // Simple: outside = new contour
  }, [selectedStructure, rtStructures, currentSlicePosition]);

  // Check if point is near first vertex (for closing polygon)
  const isNearFirstVertex = useCallback((point: Point): boolean => {
    if (vertices.length < 3) return false;
    
    const firstVertex = vertices[0];
    const distance = Math.sqrt(
      Math.pow(point.x - firstVertex.x, 2) + Math.pow(point.y - firstVertex.y, 2)
    );
    
    return distance < 20; // 20 pixel tolerance for easier closing
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
  const handleMouseDown = useCallback(async (event: MouseEvent) => {
    if (!isActive || !selectedStructure || !canvasRef.current) return;
    
    const rect = canvasRef.current.getBoundingClientRect();
    const canvasPoint = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };

    if (event.button === 0) { // Left click
      if (isNearFirstVertex(canvasPoint) && vertices.length >= 3) {
        // Close polygon by clicking near first vertex
        await completePolygon();
        return;
      }
      
      // Determine operation mode on first click BEFORE adding vertex
      if (vertices.length === 0 && !operationMode) {
        const worldPoint = canvasToWorld(canvasPoint.x, canvasPoint.y);
        determineOperationMode(worldPoint).then(mode => {
          setOperationMode(mode);
          console.log(`🔷 Operation mode set to: ${mode}`);
          // Add first vertex after determining mode
          setVertices(prev => [...prev, canvasPoint]);
        });
      } else {
        // Add subsequent vertices
        setVertices(prev => [...prev, canvasPoint]);
      }
      
      // Start continuous drawing if holding down
      setIsDrawingContinuous(true);
      
    } else if (event.button === 2) { // Right click
      event.preventDefault();
      if (vertices.length >= 3) {
        await completePolygon();
      }
    }
  }, [isActive, selectedStructure, vertices, operationMode, isNearFirstVertex, canvasToWorld, determineOperationMode]);

  const handleMouseMove = useCallback(async (event: MouseEvent) => {
    if (!isActive || !canvasRef.current) return;
    
    const rect = canvasRef.current.getBoundingClientRect();
    const canvasPoint = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
    
    setMousePosition(canvasPoint);
    
    // Add points during continuous drawing with better spacing
    if (isDrawingContinuous && vertices.length > 0) {
      // Check if we're near first vertex to close
      if (vertices.length >= 3 && isNearFirstVertex(canvasPoint)) {
        await completePolygon();
        setIsDrawingContinuous(false);
        return;
      }
      
      const lastVertex = vertices[vertices.length - 1];
      const distance = Math.sqrt(
        Math.pow(canvasPoint.x - lastVertex.x, 2) + Math.pow(canvasPoint.y - lastVertex.y, 2)
      );
      
      // Add point if moved enough distance (smoother drawing with larger threshold)
      if (distance > 15) {
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

  // Complete polygon with direct structure updates (like brush tool)
  const completePolygon = useCallback(async () => {
    if (vertices.length < 3 || !selectedStructure || !rtStructures?.structures) {
      console.log(`🔷 Cannot complete: vertices=${vertices.length}, selectedStructure=${selectedStructure}`);
      return;
    }
    
    // Find the structure we're editing
    const structure = rtStructures.structures.find((s: any) => s.roiNumber === selectedStructure);
    if (!structure) {
      console.log('🔷 ERROR: Structure not found');
      return;
    }
    
    // Convert vertices to world coordinates
    const worldPoints: number[] = [];
    const polygon2D: number[] = [];
    
    vertices.forEach(vertex => {
      const world = canvasToWorld(vertex.x, vertex.y);
      worldPoints.push(world.x, world.y, world.z);
      polygon2D.push(world.x, world.y);
    });
    
    // Determine operation mode
    let currentMode = operationMode;
    if (!currentMode) {
      const firstWorldPoint = canvasToWorld(vertices[0].x, vertices[0].y);
      currentMode = await determineOperationMode(firstWorldPoint);
    }
    
    console.log(`🔷 PenToolV2: ${currentMode} operation with ${vertices.length} vertices`);
    
    // Get ALL existing contours at current slice (not just one)
    const tolerance = 1.5;
    const existingOnSlice = structure.contours.filter((c: any) => 
      Math.abs(c.slicePosition - currentSlicePosition) <= tolerance
    );
    
    // Apply operations directly to the structure
    if (currentMode === 'new' || existingOnSlice.length === 0) {
      // Just add new contour
      structure.contours.push({
        slicePosition: currentSlicePosition,
        points: worldPoints,
        numberOfPoints: worldPoints.length / 3
      });
      
    } else if (currentMode === 'union' && existingOnSlice.length > 0) {
      // Use same approach as brush tool - check intersections and merge
      const intersectingContours: any[] = [];
      const nonIntersectingContours: any[] = [];
      
      // Check which contours intersect with the new pen polygon
      for (const contour of existingOnSlice) {
        if (contour.points && contour.points.length >= 9) {
          // Check if pen polygon intersects with this contour
          const intersects = doPolygonsIntersect(worldPoints, contour.points);
          if (intersects) {
            intersectingContours.push(contour);
          } else {
            nonIntersectingContours.push(contour);
          }
        }
      }
      
      // Remove all existing contours at this slice
      structure.contours = structure.contours.filter(
        (c: any) => Math.abs(c.slicePosition - currentSlicePosition) > tolerance
      );
      
      if (intersectingContours.length > 0) {
        // Union pen polygon with intersecting contours using polygonUnion
        const polygonsToUnion: number[][] = [];
        
        // Add intersecting contours
        for (const contour of intersectingContours) {
          polygonsToUnion.push(contour.points);
        }
        
        // Add the new pen polygon
        polygonsToUnion.push(worldPoints);
        
        // Perform union of intersecting polygons
        const unionResult = polygonUnion(polygonsToUnion);
        
        // Add the unified contour
        if (unionResult.length >= 9) {
          structure.contours.push({
            slicePosition: currentSlicePosition,
            points: unionResult,
            numberOfPoints: unionResult.length / 3,
          });
        }
        
        // Re-add non-intersecting contours as separate blobs
        for (const contour of nonIntersectingContours) {
          structure.contours.push({
            slicePosition: currentSlicePosition,
            points: contour.points,
            numberOfPoints: contour.numberOfPoints,
          });
        }
      } else {
        // Pen polygon doesn't intersect - create separate blob
        structure.contours.push({
          slicePosition: currentSlicePosition,
          points: worldPoints,
          numberOfPoints: worldPoints.length / 3
        });
        
        // Re-add all existing contours unchanged
        for (const contour of existingOnSlice) {
          structure.contours.push({
            slicePosition: currentSlicePosition,
            points: contour.points,
            numberOfPoints: contour.numberOfPoints,
          });
        }
      }
      console.log('🔷 Applied union operation using polygonUnion');
      
    } else if (currentMode === 'subtract' && existingOnSlice.length > 0) {
      // Handle subtraction for all contours on slice
      const newContours: any[] = [];
      
      // Process each existing contour
      for (const contour of existingOnSlice) {
        if (contour.points && contour.points.length >= 9) {
          // Check if pen polygon intersects with this contour
          const intersects = doPolygonsIntersect(worldPoints, contour.points);
          
          if (intersects) {
            // Subtract pen polygon from this contour
            const subtractedContours = await subtractContours(contour.points, worldPoints);
            
            // Add all resulting contours (might be multiple if pen splits the contour)
            if (subtractedContours.length > 0) {
              for (const subtracted of subtractedContours) {
                const points: number[] = [];
                for (let i = 0; i < subtracted.length; i += 2) {
                  points.push(subtracted[i], subtracted[i + 1], currentSlicePosition);
                }
                if (points.length >= 9) {
                  newContours.push({
                    slicePosition: currentSlicePosition,
                    points: points,
                    numberOfPoints: points.length / 3
                  });
                }
              }
            }
          } else {
            // No intersection - keep contour unchanged
            newContours.push(contour);
          }
        }
      }
      
      // Remove all existing contours at this slice
      structure.contours = structure.contours.filter(
        (c: any) => Math.abs(c.slicePosition - currentSlicePosition) > tolerance
      );
      
      // Add all new contours
      for (const contour of newContours) {
        structure.contours.push(contour);
      }
      
      console.log('🔷 Applied subtract operation to all intersecting contours');
    }
    
    // Send simple update to trigger save
    if (onContourUpdate) {
      onContourUpdate({
        action: "update_rt_structures",
        structureId: selectedStructure
      });
    }
    
    // Reset state
    setVertices([]);
    setIsDrawingContinuous(false);
    setOperationMode(null);
    setMousePosition(null);
    
    console.log('🔷 PenToolV2: Direct update completed');
  }, [vertices, selectedStructure, operationMode, currentSlicePosition, canvasToWorld, 
      rtStructures, onContourUpdate, determineOperationMode]);

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
        // Solid preview line
        ctx.lineTo(mousePosition.x, mousePosition.y);
        
        // Show close indicator if near first vertex
        if (vertices.length >= 3 && isNearFirstVertex(mousePosition)) {
          ctx.lineTo(vertices[0].x, vertices[0].y);
        }
      }
      
      ctx.stroke();
      
      // Always draw pulsating first vertex
      if (vertices.length > 0) {
        const firstVertex = vertices[0];
        const pulseRadius = 4 + Math.sin(Date.now() / 200) * 2;
        ctx.beginPath();
        ctx.arc(firstVertex.x, firstVertex.y, pulseRadius, 0, 2 * Math.PI);
        
        // Yellow when near closing, structure color otherwise
        const isNearClosing = vertices.length >= 3 && mousePosition && isNearFirstVertex(mousePosition);
        ctx.fillStyle = isNearClosing ? '#ffff00' : structureColor;
        ctx.fill();
        ctx.strokeStyle = isNearClosing ? '#000000' : '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      
      // Show operation mode indicator (show "..." while determining)
      if (vertices.length > 0) {
        ctx.font = '12px Arial';
        if (operationMode) {
          ctx.fillStyle = operationMode === 'union' ? '#00ff00' : 
                         operationMode === 'subtract' ? '#ff0000' : '#0080ff';
          const modeText = operationMode === 'union' ? 'UNION' : 
                          operationMode === 'subtract' ? 'SUBTRACT' : 'NEW';
          ctx.fillText(modeText, vertices[0].x + 10, vertices[0].y - 10);
        } else {
          ctx.fillStyle = '#808080';
          ctx.fillText('...', vertices[0].x + 10, vertices[0].y - 10);
        }
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