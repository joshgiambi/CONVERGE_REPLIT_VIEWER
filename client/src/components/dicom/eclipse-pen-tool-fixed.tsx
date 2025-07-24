// Advanced Pen Tool Implementation
// Supports continuous drawing, boolean operations, and vertex editing

import { useCallback, useEffect, useRef, useState } from 'react';
import { PenTool as PenIcon } from 'lucide-react';

// Tool States
enum ToolState {
  IDLE = 'IDLE',                   // Tool selected, not drawing
  DRAWING_DISCRETE = 'DRAWING_DISCRETE',     // Placing individual vertices
  DRAWING_CONTINUOUS = 'DRAWING_CONTINUOUS', // Continuous line drawing (mouse down)
  DRAGGING_VERTEX = 'DRAGGING_VERTEX',       // Editing existing vertex
  PREVIEW = 'PREVIEW',             // Polygon complete, preview before accept
}

// Drawing modes based on starting position
enum DrawingMode {
  ADD = 'ADD',         // Started inside existing contour
  SUBTRACT = 'SUBTRACT', // Started outside existing contour
  NEW = 'NEW'          // No existing contours
}

interface Vertex {
  id: string;
  position: [number, number, number]; // World coordinates [x, y, z]
  screenPosition: [number, number];   // Store screen position for editing
  index: number;
}

interface Polygon {
  id: string;
  vertices: Vertex[];
  isClosed: boolean;
  sliceIndex: number;
  drawingMode?: DrawingMode;
}

interface ExistingContour {
  points: [number, number][];
  roiNumber: number;
  color: number[];
}

interface EclipsePenToolProps {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  isActive: boolean;
  selectedStructure: number;
  rtStructures: any;
  currentSlicePosition: number;
  onContourUpdate: (payload: any) => void;
  imageMetadata: any;
  currentImageIndex?: number;
  zoom?: number;
  panX?: number;
  panY?: number;
}

export function EclipsePenToolFixed({
  canvasRef,
  isActive,
  selectedStructure,
  rtStructures,
  currentSlicePosition,
  onContourUpdate,
  imageMetadata,
  currentImageIndex,
  zoom = 1,
  panX = 0,
  panY = 0
}: EclipsePenToolProps) {
  
  // Tool state
  const [toolState, setToolState] = useState<ToolState>(ToolState.IDLE);
  const [currentPolygon, setCurrentPolygon] = useState<Polygon | null>(null);
  const [lastAcceptedPolygon, setLastAcceptedPolygon] = useState<Polygon | null>(null);
  const [drawingMode, setDrawingMode] = useState<DrawingMode>(DrawingMode.NEW);
  
  // Continuous drawing state
  const [isMouseDown, setIsMouseDown] = useState(false);
  const [continuousPoints, setContinuousPoints] = useState<[number, number][]>([]);
  const [lastSampledPoint, setLastSampledPoint] = useState<[number, number] | null>(null);
  
  // Editing state
  const [selectedVertices, setSelectedVertices] = useState<Set<string>>(new Set());
  const [draggedVertexId, setDraggedVertexId] = useState<string | null>(null);
  const [dragStartPos, setDragStartPos] = useState<[number, number] | null>(null);
  const [originalVertexPositions, setOriginalVertexPositions] = useState<Map<string, [number, number]>>(new Map());
  
  // Highlighting state
  const [highlightedContour, setHighlightedContour] = useState<ExistingContour | null>(null);
  const [nearbyVertexId, setNearbyVertexId] = useState<string | null>(null);
  
  // Selection state
  const [selectionBox, setSelectionBox] = useState<{
    start: [number, number];
    end: [number, number];
  } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  
  // Mouse tracking
  const [mousePosition, setMousePosition] = useState<[number, number]>([0, 0]);
  
  // Canvas refs
  const penCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  
  // Configuration
  const VERTEX_RADIUS = 5;
  const VERTEX_SELECT_RADIUS = 10;
  const CLOSE_THRESHOLD = 20; // Larger for initial point
  const INITIAL_POINT_THRESHOLD = 25; // Even larger hit area for first point
  const MIN_VERTICES = 3;
  const CONTINUOUS_SAMPLE_DISTANCE = 5; // Minimum pixels between sampled points
  const CONTOUR_HIGHLIGHT_DISTANCE = 10; // Distance to highlight existing contours
  const VERTEX_INFLUENCE_RADIUS = 50; // Radius for vertex dragging influence
  
  // Initialize when activated
  useEffect(() => {
    if (isActive) {
      console.log('PEN TOOL: Activated');
      // Tool is ready but not drawing yet
    } else {
      console.log('PEN TOOL: Deactivated');
      resetTool();
    }
  }, [isActive]);
  
  // Generate UUID
  const generateUUID = () => {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  };
  
  // Coordinate transformation functions
  const screenToWorld = useCallback((screenX: number, screenY: number): [number, number, number] => {
    if (!imageMetadata) return [0, 0, 0];
    
    const imagePositionStr = imageMetadata.imagePosition || "0\\0\\0";
    const imagePosition = imagePositionStr.split("\\").map(parseFloat);
    
    const pixelSpacingStr = imageMetadata.pixelSpacing || "1\\1";
    const pixelSpacing = pixelSpacingStr.split("\\").map(parseFloat);
    
    const imageOrientationStr = imageMetadata.imageOrientation || "1\\0\\0\\0\\1\\0";
    const imageOrientation = imageOrientationStr.split("\\").map(parseFloat);
    
    // Transform from screen space to image space
    const canvasX = (screenX - panX) / zoom;
    const canvasY = (screenY - panY) / zoom;
    
    // Apply HFS transformation
    const worldX = imagePosition[0] + 
                   canvasX * pixelSpacing[0] * imageOrientation[0] +
                   canvasY * pixelSpacing[1] * imageOrientation[3];
    
    const worldY = imagePosition[1] + 
                   canvasX * pixelSpacing[0] * imageOrientation[1] +
                   canvasY * pixelSpacing[1] * imageOrientation[4];
    
    const worldZ = imagePosition[2];
    
    return [worldX, worldY, worldZ];
  }, [imageMetadata, zoom, panX, panY]);
  
  const worldToScreen = useCallback((world: [number, number, number]): [number, number] => {
    if (!imageMetadata) return [0, 0];
    
    const imagePositionStr = imageMetadata.imagePosition || "0\\0\\0";
    const imagePosition = imagePositionStr.split("\\").map(parseFloat);
    
    const pixelSpacingStr = imageMetadata.pixelSpacing || "1\\1";
    const pixelSpacing = pixelSpacingStr.split("\\").map(parseFloat);
    
    const imageOrientationStr = imageMetadata.imageOrientation || "1\\0\\0\\0\\1\\0";
    const imageOrientation = imageOrientationStr.split("\\").map(parseFloat);
    
    // Transform from world to image coordinates
    const deltaX = world[0] - imagePosition[0];
    const deltaY = world[1] - imagePosition[1];
    
    const canvasX = (deltaX * imageOrientation[0] + 
                     deltaY * imageOrientation[1]) / pixelSpacing[0];
    
    const canvasY = (deltaX * imageOrientation[3] + 
                     deltaY * imageOrientation[4]) / pixelSpacing[1];
    
    // Apply zoom and pan
    const screenX = canvasX * zoom + panX;
    const screenY = canvasY * zoom + panY;
    
    return [screenX, screenY];
  }, [imageMetadata, zoom, panX, panY]);
  
  // Distance calculation
  const distance2D = (p1: [number, number], p2: [number, number]): number => {
    return Math.sqrt(Math.pow(p2[0] - p1[0], 2) + Math.pow(p2[1] - p1[1], 2));
  };
  
  // Get existing contours for current slice
  const getExistingContours = useCallback((): ExistingContour[] => {
    if (!rtStructures?.structures) return [];
    
    const contours: ExistingContour[] = [];
    rtStructures.structures.forEach((structure: any) => {
      const sliceContours = structure.sliceContours?.[currentSlicePosition];
      if (sliceContours && sliceContours.length > 0) {
        sliceContours.forEach((contour: any) => {
          if (contour.points && contour.points.length > 0) {
            const points: [number, number][] = [];
            for (let i = 0; i < contour.points.length; i += 3) {
              points.push([contour.points[i], contour.points[i + 1]]);
            }
            contours.push({
              points,
              roiNumber: structure.roiNumber,
              color: structure.color || [255, 255, 255]
            });
          }
        });
      }
    });
    return contours;
  }, [rtStructures, currentSlicePosition]);
  
  // Check if point is inside any contour
  const isPointInsideContour = useCallback((point: [number, number], contour: ExistingContour): boolean => {
    const { points } = contour;
    let inside = false;
    
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const xi = points[i][0], yi = points[i][1];
      const xj = points[j][0], yj = points[j][1];
      
      const intersect = ((yi > point[1]) !== (yj > point[1]))
          && (point[0] < (xj - xi) * (point[1] - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    
    return inside;
  }, []);
  
  // Find contour at point
  const findContourAtPoint = useCallback((screenX: number, screenY: number): ExistingContour | null => {
    const worldPos = screenToWorld(screenX, screenY);
    const contours = getExistingContours();
    
    for (const contour of contours) {
      if (contour.roiNumber === selectedStructure && isPointInsideContour([worldPos[0], worldPos[1]], contour)) {
        return contour;
      }
    }
    return null;
  }, [getExistingContours, selectedStructure, screenToWorld, isPointInsideContour]);
  
  // Determine drawing mode based on starting position
  const determineDrawingMode = useCallback((screenX: number, screenY: number): DrawingMode => {
    const contour = findContourAtPoint(screenX, screenY);
    if (!contour) return DrawingMode.NEW;
    return contour ? DrawingMode.ADD : DrawingMode.SUBTRACT;
  }, [findContourAtPoint]);
  
  // Find contour near a point
  const findContourNearPoint = useCallback((screenX: number, screenY: number, threshold: number) => {
    const contours = getExistingContours();
    if (!contours.length) return null;
    
    const worldPos = screenToWorld(screenX, screenY);
    
    for (const contour of contours) {
      if (contour.roiNumber === selectedStructure) {
        // Check distance to contour edges
        for (let i = 0; i < contour.points.length; i++) {
          const p1 = contour.points[i];
          const p2 = contour.points[(i + 1) % contour.points.length];
          
          // Convert to screen coordinates
          const [x1, y1] = worldToScreen([p1[0], p1[1], 0]);
          const [x2, y2] = worldToScreen([p2[0], p2[1], 0]);
          
          // Calculate distance to line segment
          const dist = pointToLineDistance([screenX, screenY], [x1, y1], [x2, y2]);
          if (dist < threshold) {
            return contour;
          }
        }
      }
    }
    return null;
  }, [getExistingContours, selectedStructure, screenToWorld, worldToScreen]);
  
  // Distance from point to line segment
  const pointToLineDistance = (point: [number, number], lineStart: [number, number], lineEnd: [number, number]): number => {
    const dx = lineEnd[0] - lineStart[0];
    const dy = lineEnd[1] - lineStart[1];
    const lengthSquared = dx * dx + dy * dy;
    
    if (lengthSquared === 0) return distance2D(point, lineStart);
    
    const t = Math.max(0, Math.min(1, ((point[0] - lineStart[0]) * dx + (point[1] - lineStart[1]) * dy) / lengthSquared));
    const projection: [number, number] = [lineStart[0] + t * dx, lineStart[1] + t * dy];
    
    return distance2D(point, projection);
  };
  
  // Reset tool state
  const resetTool = useCallback(() => {
    setToolState(ToolState.IDLE);
    setCurrentPolygon(null);
    setSelectedVertices(new Set());
    setDraggedVertexId(null);
    setDragStartPos(null);
    setHighlightedContour(null);
    setNearbyVertexId(null);
    setContinuousPoints([]);
    setLastSampledPoint(null);
    setIsMouseDown(false);
    setOriginalVertexPositions(new Map());
  }, []);
  
  // Add vertex to polygon
  const addVertex = useCallback((screenX: number, screenY: number) => {
    const worldPos = screenToWorld(screenX, screenY);
    
    const vertex: Vertex = {
      id: generateUUID(),
      position: worldPos,
      screenPosition: [screenX, screenY],
      index: currentPolygon?.vertices.length || 0
    };
    
    if (!currentPolygon) {
      // Start new polygon
      const newPolygon: Polygon = {
        id: generateUUID(),
        vertices: [vertex],
        isClosed: false,
        sliceIndex: currentSlicePosition
      };
      setCurrentPolygon(newPolygon);
      setToolState(ToolState.DRAWING_DISCRETE);
      console.log('Started new polygon');
    } else {
      // Check if clicking near first vertex to close
      if (currentPolygon.vertices.length >= MIN_VERTICES) {
        const firstVertex = currentPolygon.vertices[0];
        const [firstX, firstY] = worldToScreen(firstVertex.position);
        const dist = distance2D([screenX, screenY], [firstX, firstY]);
        
        if (dist < CLOSE_THRESHOLD) {
          // Close polygon
          setCurrentPolygon(prev => ({
            ...prev!,
            isClosed: true
          }));
          setToolState(ToolState.PREVIEW);
          console.log('Polygon closed');
          return;
        }
      }
      
      // Add vertex
      setCurrentPolygon(prev => ({
        ...prev!,
        vertices: [...prev!.vertices, vertex]
      }));
    }
  }, [currentPolygon, screenToWorld, worldToScreen, currentSlicePosition]);
  
  // Accept polygon (like ITK-SNAP)
  const acceptPolygon = useCallback(() => {
    if (!currentPolygon || !currentPolygon.isClosed) return;
    
    console.log(`Accepting polygon with ${drawingMode} mode`);
    
    // Convert to contour points
    const contourPoints: number[] = [];
    currentPolygon.vertices.forEach(v => {
      contourPoints.push(v.position[0], v.position[1], v.position[2]);
    });
    
    // Determine action based on drawing mode
    let action = 'add_contour';
    if (drawingMode === DrawingMode.SUBTRACT) {
      action = 'subtract_contour';
    } else if (drawingMode === DrawingMode.ADD) {
      // For ADD mode, we should merge with existing contour
      action = 'add_contour';
    }
    
    // Send update
    onContourUpdate({
      action: action,
      structureIndex: selectedStructure,
      slicePosition: currentSlicePosition,
      contourPoints: contourPoints
    });
    
    // Save for paste functionality
    setLastAcceptedPolygon(currentPolygon);
    
    // Reset for next polygon
    resetTool();
  }, [currentPolygon, selectedStructure, currentSlicePosition, onContourUpdate, resetTool, drawingMode]);
  
  // Cancel current polygon
  const cancelPolygon = useCallback(() => {
    console.log('Cancelling polygon');
    resetTool();
  }, [resetTool]);
  
  // Paste last polygon (ITK-SNAP feature)
  const pasteLastPolygon = useCallback(() => {
    if (!lastAcceptedPolygon) return;
    
    console.log('Pasting last polygon');
    
    // Create new polygon with same shape but at current slice
    const newVertices = lastAcceptedPolygon.vertices.map((v, index) => ({
      id: generateUUID(),
      position: [v.position[0], v.position[1], parseFloat(imageMetadata.imagePosition.split("\\")[2])] as [number, number, number],
      screenPosition: worldToScreen([v.position[0], v.position[1], parseFloat(imageMetadata.imagePosition.split("\\")[2])]),
      index: index
    }));
    
    setCurrentPolygon({
      id: generateUUID(),
      vertices: newVertices,
      isClosed: true,
      sliceIndex: currentSlicePosition
    });
    setToolState(ToolState.PREVIEW);
  }, [lastAcceptedPolygon, imageMetadata, worldToScreen, currentSlicePosition]);
  
  // Select vertices in box
  const selectVerticesInBox = useCallback((box: {
    start: [number, number];
    end: [number, number];
  }) => {
    if (!currentPolygon) return;
    
    const minX = Math.min(box.start[0], box.end[0]);
    const maxX = Math.max(box.start[0], box.end[0]);
    const minY = Math.min(box.start[1], box.end[1]);
    const maxY = Math.max(box.start[1], box.end[1]);
    
    const selected = new Set<string>();
    currentPolygon.vertices.forEach(vertex => {
      const [x, y] = worldToScreen(vertex.position);
      if (x >= minX && x <= maxX && y >= minY && y <= maxY) {
        selected.add(vertex.id);
      }
    });
    
    setSelectedVertices(selected);
  }, [currentPolygon, worldToScreen]);
  
  // Mouse event handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!isActive) return;
    
    const rect = overlayCanvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    
    if (e.button === 0) { // Left click
      if (toolState === ToolState.IDLE || toolState === ToolState.DRAWING_DISCRETE) {
        // Check if we should start continuous drawing
        setIsMouseDown(true);
        setLastSampledPoint([screenX, screenY]);
        
        // Determine drawing mode based on starting position
        const mode = determineDrawingMode(screenX, screenY);
        setDrawingMode(mode);
        
        // Add first vertex
        addVertex(screenX, screenY);
        setToolState(ToolState.DRAWING_CONTINUOUS);
      } else if (toolState === ToolState.PREVIEW) {
        // Start selection box for editing
        setDragStartPos([screenX, screenY]);
        setSelectionBox({
          start: [screenX, screenY],
          end: [screenX, screenY]
        });
      }
    } else if (e.button === 2) { // Right click
      e.preventDefault();
      if (toolState === ToolState.PREVIEW) {
        // Right-click to accept (ITK-SNAP behavior)
        acceptPolygon();
      } else if ((toolState === ToolState.DRAWING_DISCRETE || toolState === ToolState.DRAWING_CONTINUOUS) && currentPolygon) {
        // Right-click auto-complete: add point at cursor and close
        if (currentPolygon.vertices.length >= 2) {
          // Add vertex at current mouse position
          addVertex(screenX, screenY);
          
          // Close polygon
          setCurrentPolygon(prev => ({
            ...prev!,
            isClosed: true
          }));
          setToolState(ToolState.PREVIEW);
        }
      }
    }
  }, [isActive, toolState, addVertex, acceptPolygon, currentPolygon]);
  
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isActive) return;
    
    const rect = overlayCanvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    
    setMousePosition([screenX, screenY]);
    
    // Highlight contour when cursor is near
    if (!isMouseDown && (toolState === ToolState.DRAWING_DISCRETE || toolState === ToolState.DRAWING_CONTINUOUS)) {
      const nearContour = findContourNearPoint(screenX, screenY, 10);
      setHighlightedContour(nearContour);
    }
    
    // Continuous drawing mode
    if (isMouseDown && toolState === ToolState.DRAWING_CONTINUOUS && lastSampledPoint) {
      const distance = distance2D([screenX, screenY], lastSampledPoint);
      if (distance >= CONTINUOUS_SAMPLE_DISTANCE) {
        // Add intermediate points
        const steps = Math.floor(distance / CONTINUOUS_SAMPLE_DISTANCE);
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          const interpX = lastSampledPoint[0] + (screenX - lastSampledPoint[0]) * t;
          const interpY = lastSampledPoint[1] + (screenY - lastSampledPoint[1]) * t;
          addVertex(interpX, interpY);
        }
        setLastSampledPoint([screenX, screenY]);
      }
    }
    
    // Update selection box
    if (dragStartPos && toolState === ToolState.PREVIEW && !isDragging) {
      setSelectionBox({
        start: dragStartPos,
        end: [screenX, screenY]
      });
    }
    
    // Drag selected vertices with influence
    if (isDragging && selectedVertices.size > 0 && currentPolygon) {
      const deltaX = screenX - dragStartPos![0];
      const deltaY = screenY - dragStartPos![1];
      
      setCurrentPolygon(prev => {
        if (!prev || !draggedVertexId) return prev;
        
        const draggedVertex = prev.vertices.find(v => v.id === draggedVertexId);
        if (!draggedVertex) return prev;
        
        return {
          ...prev,
          vertices: prev.vertices.map(v => {
            if (selectedVertices.has(v.id)) {
              // Full movement for selected vertices
              const newScreenPos: [number, number] = [
                v.screenPosition[0] + deltaX,
                v.screenPosition[1] + deltaY
              ];
              return {
                ...v,
                screenPosition: newScreenPos,
                position: screenToWorld(newScreenPos[0], newScreenPos[1])
              };
            } else if (originalVertexPositions.has(v.id)) {
              // Apply influence for nearby vertices
              const originalPos = originalVertexPositions.get(v.id)!;
              const distance = distance2D(originalPos, draggedVertex.screenPosition);
              
              if (distance < VERTEX_INFLUENCE_RADIUS) {
                const influence = 1 - (distance / VERTEX_INFLUENCE_RADIUS);
                const influencedDeltaX = deltaX * influence * influence; // Quadratic falloff
                const influencedDeltaY = deltaY * influence * influence;
                
                const newScreenPos: [number, number] = [
                  originalPos[0] + influencedDeltaX,
                  originalPos[1] + influencedDeltaY
                ];
                return {
                  ...v,
                  screenPosition: newScreenPos,
                  position: screenToWorld(newScreenPos[0], newScreenPos[1])
                };
              }
            }
            return v;
          })
        };
      });
      
      setDragStartPos([screenX, screenY]);
    }
  }, [isActive, dragStartPos, toolState, isDragging, selectedVertices, currentPolygon, screenToWorld, 
      isMouseDown, lastSampledPoint, findContourNearPoint, addVertex, draggedVertexId, originalVertexPositions]);
  
  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if (!isActive) return;
    
    const rect = overlayCanvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    
    if (e.button === 0) { // Left button release
      setIsMouseDown(false);
      
      if (toolState === ToolState.DRAWING_CONTINUOUS) {
        // End continuous drawing
        setToolState(ToolState.DRAWING_DISCRETE);
        setLastSampledPoint(null);
      } else if (toolState === ToolState.PREVIEW && selectionBox) {
        // End selection box
        selectVerticesInBox(selectionBox);
        setSelectionBox(null);
        
        // Check if starting drag
        if (selectedVertices.size > 0) {
          // Find the closest selected vertex
          let closestVertex: Vertex | null = null;
          let minDist = Infinity;
          
          currentPolygon?.vertices.forEach(v => {
            if (selectedVertices.has(v.id)) {
              const [vx, vy] = worldToScreen(v.position);
              const dist = distance2D([screenX, screenY], [vx, vy]);
              if (dist < minDist) {
                minDist = dist;
                closestVertex = v;
              }
            }
          });
          
          if (closestVertex && minDist < VERTEX_RADIUS * 2) {
            setIsDragging(true);
            setDraggedVertexId(closestVertex.id);
            setDragStartPos([screenX, screenY]);
            
            // Store original positions for influence calculation
            const positions = new Map<string, [number, number]>();
            currentPolygon?.vertices.forEach(v => {
              positions.set(v.id, [...v.screenPosition]);
            });
            setOriginalVertexPositions(positions);
          }
        }
      } else if (isDragging) {
        // End vertex dragging
        setIsDragging(false);
        setDraggedVertexId(null);
        setDragStartPos(null);
        setOriginalVertexPositions(new Map());
      }
    }
  }, [isActive, toolState, selectionBox, selectedVertices, currentPolygon, isDragging, 
      selectVerticesInBox, worldToScreen]);
  
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!isActive) return;
    
    if (e.key === 'Escape') {
      cancelPolygon();
    } else if (e.key === 'Enter' && toolState === ToolState.PREVIEW) {
      acceptPolygon();
    } else if (e.ctrlKey && e.key === 'v') {
      pasteLastPolygon();
    }
  }, [isActive, toolState, cancelPolygon, acceptPolygon, pasteLastPolygon]);
  
  // Add keyboard listener
  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
  
  // Render function
  const renderTool = useCallback(() => {
    const canvas = penCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !isActive) return;
    
    // Clear canvas
    ctx.clearRect(0, 0, canvas?.width || 0, canvas?.height || 0);
    
    // Get structure color
    const selectedStructureData = rtStructures?.structures?.find((s: any) => s.roiNumber === selectedStructure);
    const structureColor = selectedStructureData?.color || [0, 255, 0];
    
    // Draw highlighted contour if hovering
    if (highlightedContour && !currentPolygon) {
      ctx.strokeStyle = `rgba(${structureColor.join(',')}, 0.3)`;
      ctx.lineWidth = 4;
      ctx.beginPath();
      
      highlightedContour.points.forEach((point, index) => {
        const [x, y] = worldToScreen([point[0], point[1], 0]);
        if (index === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });
      ctx.closePath();
      ctx.stroke();
    }
    
    if (currentPolygon) {
      // Draw polygon edges
      ctx.strokeStyle = toolState === ToolState.PREVIEW ? '#00ff00' : `rgb(${structureColor.join(',')})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      
      currentPolygon.vertices.forEach((vertex, index) => {
        const [x, y] = worldToScreen(vertex.position);
        if (index === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });
      
      if (currentPolygon.isClosed) {
        ctx.closePath();
      } else if (toolState === ToolState.DRAWING_DISCRETE || toolState === ToolState.DRAWING_CONTINUOUS) {
        // Draw ghost line to mouse
        ctx.lineTo(mousePosition[0], mousePosition[1]);
      }
      
      ctx.stroke();
      
      // Draw vertices
      currentPolygon.vertices.forEach((vertex, index) => {
        const [x, y] = worldToScreen(vertex.position);
        const isSelected = selectedVertices.has(vertex.id);
        
        // Highlight first vertex when close to closing
        if (index === 0 && !currentPolygon.isClosed && 
            currentPolygon.vertices.length >= MIN_VERTICES) {
          const dist = distance2D(mousePosition, [x, y]);
          if (dist < CLOSE_THRESHOLD) {
            ctx.fillStyle = '#ff00ff';
            ctx.beginPath();
            ctx.arc(x, y, VERTEX_RADIUS + 3, 0, 2 * Math.PI);
            ctx.fill();
          }
        }
        
        // Draw vertex
        ctx.fillStyle = isSelected ? '#ffff00' : '#ffffff';
        ctx.beginPath();
        ctx.arc(x, y, VERTEX_RADIUS, 0, 2 * Math.PI);
        ctx.fill();
        
        ctx.strokeStyle = isSelected ? '#ffff00' : `rgb(${structureColor.join(',')})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, VERTEX_RADIUS, 0, 2 * Math.PI);
        ctx.stroke();
      });
      
      // Show green rectangle if in preview mode (ITK-SNAP style)
      if (toolState === ToolState.PREVIEW && !selectedVertices.size) {
        const bounds = currentPolygon.vertices.reduce((acc, v) => {
          const [x, y] = worldToScreen(v.position);
          return {
            minX: Math.min(acc.minX, x),
            maxX: Math.max(acc.maxX, x),
            minY: Math.min(acc.minY, y),
            maxY: Math.max(acc.maxY, y)
          };
        }, { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
        
        ctx.strokeStyle = '#00ff00';
        ctx.lineWidth = 1;
        ctx.strokeRect(
          bounds.minX - 5,
          bounds.minY - 5,
          bounds.maxX - bounds.minX + 10,
          bounds.maxY - bounds.minY + 10
        );
      }
    }
    
    // Draw selection box
    if (selectionBox) {
      ctx.strokeStyle = '#ffff00';
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 5]);
      ctx.strokeRect(
        selectionBox.start[0],
        selectionBox.start[1],
        selectionBox.end[0] - selectionBox.start[0],
        selectionBox.end[1] - selectionBox.start[1]
      );
      ctx.setLineDash([]);
    }
  }, [isActive, currentPolygon, worldToScreen, rtStructures, selectedStructure, toolState, mousePosition, selectedVertices, selectionBox]);
  
  // Update render
  useEffect(() => {
    renderTool();
  }, [renderTool]);
  
  // Handle canvas sizing
  useEffect(() => {
    if (!canvasRef.current || !penCanvasRef.current || !overlayCanvasRef.current) return;
    
    const mainCanvas = canvasRef.current;
    const penCanvas = penCanvasRef.current;
    const overlayCanvas = overlayCanvasRef.current;
    
    // Match main canvas size
    penCanvas.width = mainCanvas.offsetWidth;
    penCanvas.height = mainCanvas.offsetHeight;
    overlayCanvas.width = mainCanvas.offsetWidth;
    overlayCanvas.height = mainCanvas.offsetHeight;
  }, [canvasRef, zoom, panX, panY]);
  
  console.log('PEN TOOL: Render - isActive:', isActive, 'toolState:', toolState, 'polygonVertices:', currentPolygon?.vertices.length || 0);
  
  if (!isActive) return null;
  
  return (
    <>
      {/* Drawing canvas */}
      <canvas
        ref={penCanvasRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          zIndex: 5,
        }}
        width={1024}
        height={1024}
      />
      
      {/* Interaction overlay */}
      <canvas
        ref={overlayCanvasRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          pointerEvents: isActive ? 'auto' : 'none',
          cursor: toolState === ToolState.PREVIEW ? 'move' : 'crosshair',
          zIndex: 6,
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onContextMenu={(e) => e.preventDefault()}
      />
      
      {/* UI Buttons (ITK-SNAP style) */}
      {toolState === ToolState.PREVIEW && (
        <div style={{
          position: 'absolute',
          bottom: '10px',
          left: '10px',
          display: 'flex',
          gap: '10px',
          zIndex: 10
        }}>
          <button 
            onClick={acceptPolygon}
            style={{
              padding: '5px 15px',
              backgroundColor: '#4CAF50',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Accept
          </button>
          <button 
            onClick={cancelPolygon}
            style={{
              padding: '5px 15px',
              backgroundColor: '#f44336',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Cancel
          </button>
          {lastAcceptedPolygon && (
            <button 
              onClick={pasteLastPolygon}
              style={{
                padding: '5px 15px',
                backgroundColor: '#2196F3',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              Paste Last
            </button>
          )}
        </div>
      )}
    </>
  );
}