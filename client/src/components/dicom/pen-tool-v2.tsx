import React, { useRef, useEffect, useState, useCallback } from 'react';
import { combineContours, subtractContours, offsetContour, offsetOpenPath, debugPenToolDelete } from '../../lib/clipper-boolean-operations';
import { subtractContourSimple, doPolygonsIntersectSimple } from '../../lib/simple-polygon-operations';
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
  const [firstPointMode, setFirstPointMode] = useState<'inside' | 'outside' | null>(null);
  const [hasCrossedBoundary, setHasCrossedBoundary] = useState(false);
  const [shouldComplete, setShouldComplete] = useState(false);

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
      
      // Position the overlay canvas exactly on top of the main canvas
      const mainRect = mainCanvas.getBoundingClientRect();
      const parentRect = mainCanvas.parentElement!.getBoundingClientRect();
      overlay.style.top = `${mainRect.top - parentRect.top}px`;
      overlay.style.left = `${mainRect.left - parentRect.left}px`;
      
      overlay.style.pointerEvents = 'none';
      overlay.style.zIndex = '10';
      overlay.className = 'pen-tool-overlay';
      
      mainCanvas.parentElement?.appendChild(overlay);
      (overlayCanvasRef as any).current = overlay;
    }
    
    overlay.width = mainCanvas.width;
    overlay.height = mainCanvas.height;
    
    // Update position in case main canvas moved
    const mainRect = mainCanvas.getBoundingClientRect();
    const parentRect = mainCanvas.parentElement!.getBoundingClientRect();
    overlay.style.top = `${mainRect.top - parentRect.top}px`;
    overlay.style.left = `${mainRect.left - parentRect.left}px`;

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

  // Determine initial operation mode based on first click
  const determineInitialMode = useCallback((firstWorldPoint: Point): 'inside' | 'outside' => {
    if (!selectedStructure || !rtStructures?.structures) return 'outside';
    
    const structure = rtStructures.structures.find(
      (s: any) => s.roiNumber === selectedStructure
    );
    
    if (!structure || !structure.contours) return 'outside';
    
    const tolerance = 1.5;
    const contoursAtSlice = structure.contours.filter(
      (c: any) => Math.abs(c.slicePosition - currentSlicePosition) <= tolerance
    );
    
    if (contoursAtSlice.length === 0) return 'outside';
    
    // Check if first point is inside any existing contour
    for (const contour of contoursAtSlice) {
      const contourPoints: [number, number][] = [];
      for (let i = 0; i < contour.points.length; i += 3) {
        contourPoints.push([contour.points[i], contour.points[i + 1]]);
      }
      
      if (isPointInPolygon([firstWorldPoint.x, firstWorldPoint.y], contourPoints)) {
        return 'inside';
      }
    }
    
    return 'outside';
  }, [selectedStructure, rtStructures, currentSlicePosition]);
  
  // Determine final operation based on polygon path
  const determineFinalOperation = useCallback((vertices: Point[]): 'union' | 'subtract' | 'new' => {
    if (!selectedStructure || !rtStructures?.structures || vertices.length < 3) return 'new';
    
    const structure = rtStructures.structures.find(
      (s: any) => s.roiNumber === selectedStructure
    );
    
    if (!structure || !structure.contours) return 'new';
    
    const tolerance = 1.5;
    const contoursAtSlice = structure.contours.filter(
      (c: any) => Math.abs(c.slicePosition - currentSlicePosition) <= tolerance
    );
    
    if (contoursAtSlice.length === 0) return 'new';
    
    // Convert vertices to world coordinates
    const worldVertices: number[] = [];
    vertices.forEach(v => {
      const world = canvasToWorld(v.x, v.y);
      worldVertices.push(world.x, world.y, world.z);
    });
    
    // Create a proper closed polygon for intersection test
    const closedWorldVertices = [...worldVertices];
    if (closedWorldVertices.length >= 9) {
      // Ensure polygon is closed by adding first point at end if needed
      const firstX = closedWorldVertices[0];
      const firstY = closedWorldVertices[1];
      const lastX = closedWorldVertices[closedWorldVertices.length - 3];
      const lastY = closedWorldVertices[closedWorldVertices.length - 2];
      
      if (firstX !== lastX || firstY !== lastY) {
        closedWorldVertices.push(firstX, firstY, closedWorldVertices[2]);
      }
    }
    
    // Check if polygon intersects with any existing contour
    let intersectsAny = false;
    let crossesIntoContour = false;
    
    for (const contour of contoursAtSlice) {
      if (doPolygonsIntersect(closedWorldVertices, contour.points)) {
        intersectsAny = true;
        
        // Check if the polygon crosses from outside to inside
        // by checking if some vertices are inside and some are outside
        let hasInsideVertex = false;
        let hasOutsideVertex = false;
        
        for (let i = 0; i < closedWorldVertices.length; i += 3) {
          const vertex = [closedWorldVertices[i], closedWorldVertices[i + 1]] as [number, number];
          const contourPoints: [number, number][] = [];
          for (let j = 0; j < contour.points.length; j += 3) {
            contourPoints.push([contour.points[j], contour.points[j + 1]]);
          }
          
          if (isPointInPolygon(vertex, contourPoints)) {
            hasInsideVertex = true;
          } else {
            hasOutsideVertex = true;
          }
          
          if (hasInsideVertex && hasOutsideVertex) {
            crossesIntoContour = true;
            break;
          }
        }
        
        if (crossesIntoContour) break;
      }
    }
    
    // Determine based on first point and intersection
    const firstWorld = canvasToWorld(vertices[0].x, vertices[0].y);
    const firstInside = determineInitialMode(firstWorld) === 'inside';
    
    if (firstInside) {
      return 'union'; // Started inside = always union
    } else if (crossesIntoContour) {
      return 'subtract'; // Started outside + crosses into contour = subtract (carve hole)
    } else if (intersectsAny) {
      return 'new'; // Started outside + just touches edge = new blob
    } else {
      return 'new'; // Started outside + no crossing = new blob
    }
  }, [selectedStructure, rtStructures, currentSlicePosition, canvasToWorld, determineInitialMode]);

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
        setShouldComplete(true);
        return;
      }
      
      // Determine initial mode on first click
      if (vertices.length === 0) {
        const worldPoint = canvasToWorld(canvasPoint.x, canvasPoint.y);
        const mode = determineInitialMode(worldPoint);
        setFirstPointMode(mode);
        console.log(`🔷 First point is ${mode} existing contour`);
      }
      
      // Add vertex
      setVertices((prev: Point[]) => [...prev, canvasPoint]);
      
      // Start continuous drawing if holding down
      setIsDrawingContinuous(true);
      
    } else if (event.button === 2) { // Right click
      event.preventDefault();
      if (vertices.length >= 3) {
        setShouldComplete(true);
      }
    }
  }, [isActive, selectedStructure, vertices.length, firstPointMode, isNearFirstVertex, canvasToWorld, determineInitialMode]);

  const handleMouseMove = useCallback(async (event: MouseEvent) => {
    if (!isActive || !canvasRef.current) return;
    
    const rect = canvasRef.current.getBoundingClientRect();
    const canvasPoint = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
    
    setMousePosition(canvasPoint);
    
    // Check if crossing boundary when drawing from outside
    if (firstPointMode === 'outside' && vertices.length > 1 && !hasCrossedBoundary) {
      const testVertices = [...vertices, canvasPoint];
      const worldTestPoints: number[] = [];
      testVertices.forEach(v => {
        const w = canvasToWorld(v.x, v.y);
        worldTestPoints.push(w.x, w.y, w.z);
      });
      
      const contours = getContoursAtCurrentSlice();
      for (const contour of contours) {
        if (doPolygonsIntersect(worldTestPoints, contour.points)) {
          setHasCrossedBoundary(true);
          console.log('🔷 Pen crossed into existing contour - will subtract');
          break;
        }
      }
    }
    
    // Add points during continuous drawing with better spacing
    if (isDrawingContinuous && vertices.length > 0) {
      // Check if we're near first vertex to close
      if (vertices.length >= 3 && isNearFirstVertex(canvasPoint)) {
        setShouldComplete(true);
        setIsDrawingContinuous(false);
        return;
      }
      
      const lastVertex = vertices[vertices.length - 1];
      const distance = Math.sqrt(
        Math.pow(canvasPoint.x - lastVertex.x, 2) + Math.pow(canvasPoint.y - lastVertex.y, 2)
      );
      
      // Add point if moved enough distance (smoother drawing with larger threshold)
      if (distance > 15) {
        setVertices((prev: Point[]) => [...prev, canvasPoint]);
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
    
    // Determine final operation mode based on polygon path
    const currentMode = determineFinalOperation(vertices);
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
      console.log('🔷 ===== PERFORMING SUBTRACT OPERATION =====');
      console.log('🔷 Existing contours on slice:', existingOnSlice.length);
      const newContours: any[] = [];
      
      // Create closed polygon from vertices (close the polygon for proper subtraction)
      const closedWorldPoints: number[] = [];
      for (const vertex of vertices as Point[]) {
        // Convert canvas coordinates to world coordinates
        const world = canvasToWorld(vertex.x, vertex.y);
        closedWorldPoints.push(world.x, world.y, world.z);
        console.log('🔷 Vertex:', vertex.x, vertex.y, '-> World:', world.x, world.y, world.z);
      }
      
      // Close the polygon by adding the first point at the end if not already closed
      if (closedWorldPoints.length >= 9) {
        const firstX = closedWorldPoints[0];
        const firstY = closedWorldPoints[1]; 
        const firstZ = closedWorldPoints[2];
        const lastX = closedWorldPoints[closedWorldPoints.length - 3];
        const lastY = closedWorldPoints[closedWorldPoints.length - 2];
        
        // Only close if not already closed
        if (firstX !== lastX || firstY !== lastY) {
          closedWorldPoints.push(firstX, firstY, firstZ);
          console.log('🔷 Closed polygon by adding first point');
        } else {
          console.log('🔷 Polygon already closed');
        }
      }
      
      console.log('🔷 Created closed polygon with', closedWorldPoints.length / 3, 'points');
      console.log('🔷 Delete polygon points:', closedWorldPoints);
      
      // Process each existing contour
      for (let contourIndex = 0; contourIndex < existingOnSlice.length; contourIndex++) {
        const contour = existingOnSlice[contourIndex];
        console.log(`🔷 Processing contour ${contourIndex + 1}/${existingOnSlice.length}`);
        
        if (contour.points && contour.points.length >= 9) {
          console.log('🔷 Contour has', contour.points.length / 3, 'points');
          console.log('🔷 Contour points:', contour.points.slice(0, 12), '... (showing first 4 points)');
          
          // Check if the polygons intersect using simple method first
          const intersectsSimple = doPolygonsIntersectSimple(closedWorldPoints, contour.points);
          console.log('🔷 Polygons intersect (simple check):', intersectsSimple);
          
          if (intersectsSimple) {
            try {
              // Try simple subtraction first - much more reliable!
              console.log('🔷 Attempting SIMPLE subtraction (polygon-clipping library)...');
              console.log('🔷   - Original contour:', contour.points.length / 3, 'points');
              console.log('🔷   - Delete polygon:', closedWorldPoints.length / 3, 'points');
              
              let subtracted = subtractContourSimple(contour.points, closedWorldPoints);
              console.log('🔷 Simple subtraction result:', subtracted.length, 'contours');
              
              // If simple method fails or returns unchanged contour, try complex method as fallback
              const isUnchanged = subtracted.length === 1 && subtracted[0].length === contour.points.length;
              
              if (subtracted.length === 0 || isUnchanged) {
                console.log('🔷 ⚠️ Simple method failed/unchanged, trying complex clipper method as fallback...');
                
                // Optional debug mode for complex method
                if (process.env.NODE_ENV === 'development') {
                  console.log('🔷 Running debug analysis...');
                  const debugResult = await debugPenToolDelete(contour.points, closedWorldPoints);
                  console.log('🔷 Debug result:', debugResult);
                }
                
                subtracted = await subtractContours(contour.points, closedWorldPoints);
                console.log('🔷 Complex fallback result:', subtracted.length, 'contours');
              } else {
                console.log('🔷 ✅ Simple subtraction succeeded!');
              }
              console.log('🔷 Final subtraction result:', subtracted.length, 'contours');
              
              if (subtracted.length === 0) {
                console.log('🔷 ⚠️  Subtraction returned empty result!');
              }
              
              // Add valid results
              let validResults = 0;
              for (const res of subtracted) {
                if (res.length >= 9) { // Valid contour with at least 3 points
                  newContours.push({
                    slicePosition: currentSlicePosition,
                    points: res,
                    numberOfPoints: res.length / 3
                  });
                  validResults++;
                  console.log('🔷 ✅ Added subtracted contour with', res.length / 3, 'points');
                } else {
                  console.log('🔷 ❌ Rejected subtracted contour with', res.length / 3, 'points (too small)');
                }
              }
              
              if (validResults === 0) {
                console.log('🔷 ⚠️  No valid results from subtraction, contour completely removed');
              }
              
            } catch (error) {
              console.error('🔷 ❌ Subtraction failed with error:', error);
              console.error('🔷 ❌ Error details:', error instanceof Error ? error.message : String(error));
              // Keep original contour if subtraction fails
              newContours.push(contour);
              console.log('🔷 ↩️  Kept original contour due to error');
            }
          } else {
            // No intersection, keep original contour
            console.log('🔷 ➡️  No intersection, keeping original contour');
            newContours.push(contour);
          }
        } else {
          console.log('🔷 ❌ Invalid contour, skipping (length:', contour.points?.length || 0, ')');
        }
      }
      
      console.log('🔷 ===== SUBTRACT OPERATION SUMMARY =====');
      console.log('🔷 Original contours:', existingOnSlice.length);
      console.log('🔷 Result contours:', newContours.length);
      console.log('🔷 Contours removed:', existingOnSlice.length - newContours.length);
      
      // Remove old contours and add new
      const originalCount = structure.contours.length;
      structure.contours = structure.contours.filter(
        (c: any) => Math.abs(c.slicePosition - currentSlicePosition) > tolerance
      );
      const afterFilterCount = structure.contours.length;
      console.log('🔷 Filtered out', originalCount - afterFilterCount, 'contours from other slices');
      
      structure.contours.push(...newContours);
      console.log('🔷 Final structure has', structure.contours.length, 'total contours');
      
      console.log('🔷 ========================================');
    }
    
    // Verify we're not creating overlapping contours
    console.log(`🔷 Operation complete - Mode: ${currentMode}, Original contours: ${existingOnSlice.length}, Final contours: ${structure.contours.filter((c: any) => Math.abs(c.slicePosition - currentSlicePosition) <= tolerance).length}`);
    
    // Send simple update to trigger save
    if (onContourUpdate) {
      onContourUpdate({
        action: "update_rt_structures",
        structureId: selectedStructure
      });
    }
    
    // Reset state
    setVertices((prev: Point[]) => []);
    setIsDrawingContinuous(false);
    setFirstPointMode(null);
    setHasCrossedBoundary(false);
    setMousePosition(null);
    
    console.log('🔷 PenToolV2: Direct update completed');
  }, [vertices, selectedStructure, currentSlicePosition, canvasToWorld, 
      rtStructures, onContourUpdate, determineFinalOperation]);

  // Reset state on slice change
  useEffect(() => {
    setVertices((prev: Point[]) => []);
    setIsDrawingContinuous(false);
    setFirstPointMode(null);
    setHasCrossedBoundary(false);
    setMousePosition(null);
    setShouldComplete(false);
  }, [currentSlicePosition]);

  // Execute completion when shouldComplete is set
  useEffect(() => {
    if (shouldComplete) {
      completePolygon();
      setShouldComplete(false);
    }
  }, [shouldComplete, completePolygon]);

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
      vertices.forEach((vertex: Point, index: number) => {
        if (index === 0) {
          ctx.moveTo(vertex.x, vertex.y);
        } else {
          ctx.lineTo(vertex.x, vertex.y);
        }
      });
      
      // Draw preview line to mouse
      if (mousePosition && vertices.length > 0) {
        // Always draw preview line to mouse position
        ctx.lineTo(mousePosition.x, mousePosition.y);
      }
      
      ctx.stroke();
      
      // Always draw pulsating first vertex with color coding
      if (vertices.length > 0) {
        const firstVertex = vertices[0];
        const pulseRadius = 4 + Math.sin(Date.now() / 200) * 2;
        ctx.beginPath();
        ctx.arc(firstVertex.x, firstVertex.y, pulseRadius, 0, 2 * Math.PI);
        
        // Color based on mode: green=inside, yellow=outside, red=crossed boundary
        let vertexColor = '#ffff00'; // Default yellow (outside)
        if (firstPointMode === 'inside') {
          vertexColor = '#00ff00'; // Green
        } else if (firstPointMode === 'outside' && hasCrossedBoundary) {
          vertexColor = '#ff0000'; // Red (crossed boundary)
        }
        
        ctx.fillStyle = vertexColor;
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  }, [isActive, vertices, mousePosition, firstPointMode, hasCrossedBoundary, getStructureColor, isNearFirstVertex]);

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
      setVertices((prev: Point[]) => []);
      setIsDrawingContinuous(false);
      setFirstPointMode(null);
      setHasCrossedBoundary(false);
      setMousePosition(null);
    }
  }, [isActive, selectedStructure]);

  return null; // This component only handles interactions
}