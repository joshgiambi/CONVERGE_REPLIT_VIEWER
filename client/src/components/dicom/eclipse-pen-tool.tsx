// Eclipse TPS-style Pen Tool Implementation
// Following the exhaustive operation manual specifications

import { useCallback, useEffect, useRef, useState } from 'react';
import { PenTool as PenIcon } from 'lucide-react';

// Tool states as per Eclipse TPS specification
enum ToolState {
  IDLE = 'IDLE',
  ACTIVE = 'ACTIVE', 
  DRAWING = 'DRAWING',
  EDITING = 'EDITING',
  COMPLETE = 'COMPLETE'
}

interface Vertex {
  id: string;
  position: [number, number, number];
  index: number;
  polygonId: string;
  connections: string[];
  isFirst: boolean;
  isLast: boolean;
}

interface Segment {
  id: string;
  startVertex: string;
  endVertex: string;
  polygonId: string;
}

interface SnapTarget {
  type: 'vertex' | 'edge' | 'grid';
  target?: any;
  distance: number;
  position: [number, number, number];
}

interface EclipsePenToolProps {
  canvasRef?: React.RefObject<HTMLCanvasElement>;
  isActive: boolean;
  selectedStructure: any;
  rtStructures?: any;
  currentSlicePosition?: number;
  onContourUpdate: (payload: any) => void;
  imageMetadata?: any;
  currentImageIndex?: number;
  zoom?: number;
  panX?: number;
  panY?: number;
}

export function EclipsePenTool({
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
  // State management
  const [toolState, setToolState] = useState<ToolState>(ToolState.IDLE);
  const [vertices, setVertices] = useState<Vertex[]>([]);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [currentPolygonId, setCurrentPolygonId] = useState<string>('');
  const [selectedVertex, setSelectedVertex] = useState<Vertex | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartPos, setDragStartPos] = useState<[number, number] | null>(null);
  const [mousePosition, setMousePosition] = useState<[number, number]>([0, 0]);
  const [snapTarget, setSnapTarget] = useState<SnapTarget | null>(null);
  
  // Canvas refs
  const penCanvasRef = useRef<HTMLCanvasElement>(null);
  const contextRef = useRef<CanvasRenderingContext2D | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayContextRef = useRef<CanvasRenderingContext2D | null>(null);
  
  // Configuration
  const VERTEX_SNAP_RADIUS = 10; // pixels
  const EDGE_SNAP_RADIUS = 8; // pixels
  const GRID_SNAP_RADIUS = 5; // pixels
  const AUTO_CLOSE_THRESHOLD = 15; // pixels
  const DRAG_THRESHOLD = 3; // pixels
  
  // Initialize canvases
  useEffect(() => {
    if (penCanvasRef.current && overlayCanvasRef.current) {
      contextRef.current = penCanvasRef.current.getContext('2d');
      overlayContextRef.current = overlayCanvasRef.current.getContext('2d');
    }
  }, []);
  
  // Coordinate transformation functions
  const screenToWorld = useCallback((screenX: number, screenY: number): [number, number, number] => {
    if (!imageMetadata) {
      console.log('PEN TOOL: No imageMetadata available for screenToWorld');
      return [0, 0, 0];
    }
    
    // Parse imagePosition from string format
    const imagePositionStr = imageMetadata.imagePosition || "0\\0\\0";
    const imagePosition = imagePositionStr.split("\\").map(parseFloat);
    
    // Parse pixelSpacing from string format  
    const pixelSpacingStr = imageMetadata.pixelSpacing || "1\\1";
    const pixelSpacing = pixelSpacingStr.split("\\").map(parseFloat);
    
    // Parse imageOrientation from string format
    const imageOrientationStr = imageMetadata.imageOrientation || "1\\0\\0\\0\\1\\0";
    const imageOrientation = imageOrientationStr.split("\\").map(parseFloat);
    
    // Transform from screen space to image space
    const canvasX = (screenX - panX) / zoom;
    const canvasY = (screenY - panY) / zoom;
    
    console.log('PEN TOOL: ScreenToWorld transform:', {
      screenX, screenY, canvasX, canvasY, imagePosition, pixelSpacing, imageOrientation
    });
    
    // Apply HFS transformation
    const worldX = imagePosition[0] + 
                   canvasX * pixelSpacing[0] * imageOrientation[0] +
                   canvasY * pixelSpacing[1] * imageOrientation[3];
    
    const worldY = imagePosition[1] + 
                   canvasX * pixelSpacing[0] * imageOrientation[1] +
                   canvasY * pixelSpacing[1] * imageOrientation[4];
    
    const worldZ = imagePosition[2];
    
    console.log('PEN TOOL: World coordinates:', { worldX, worldY, worldZ });
    
    return [worldX, worldY, worldZ];
  }, [imageMetadata, zoom, panX, panY]);
  
  const worldToScreen = useCallback((world: [number, number, number]): [number, number] => {
    if (!imageMetadata) {
      console.log('PEN TOOL: No imageMetadata available for worldToScreen');
      return [0, 0];
    }
    
    // Parse imagePosition from string format
    const imagePositionStr = imageMetadata.imagePosition || "0\\0\\0";
    const imagePosition = imagePositionStr.split("\\").map(parseFloat);
    
    // Parse pixelSpacing from string format  
    const pixelSpacingStr = imageMetadata.pixelSpacing || "1\\1";
    const pixelSpacing = pixelSpacingStr.split("\\").map(parseFloat);
    
    // Parse imageOrientation from string format
    const imageOrientationStr = imageMetadata.imageOrientation || "1\\0\\0\\0\\1\\0";
    const imageOrientation = imageOrientationStr.split("\\").map(parseFloat);
    
    console.log('PEN TOOL: WorldToScreen transform:', {
      world,
      imagePosition,
      pixelSpacing,
      imageOrientation
    });
    
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
    
    console.log('PEN TOOL: Screen coordinates:', { screenX, screenY });
    
    return [screenX, screenY];
  }, [imageMetadata, zoom, panX, panY]);
  
  // Generate unique ID
  const generateUUID = () => {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  };
  
  // Distance calculation
  const distance2D = (p1: [number, number], p2: [number, number]): number => {
    return Math.sqrt(Math.pow(p2[0] - p1[0], 2) + Math.pow(p2[1] - p1[1], 2));
  };
  
  // Check for snapping
  const checkForSnapping = useCallback((position: [number, number, number]): SnapTarget | null => {
    const screenPos = worldToScreen(position);
    const snapTargets: SnapTarget[] = [];
    
    // Check vertex snapping
    vertices.forEach(vertex => {
      const vertexScreenPos = worldToScreen(vertex.position);
      const dist = distance2D(screenPos, vertexScreenPos);
      
      if (dist < VERTEX_SNAP_RADIUS) {
        snapTargets.push({
          type: 'vertex',
          target: vertex,
          distance: dist,
          position: vertex.position
        });
      }
    });
    
    // TODO: Add edge snapping and grid snapping
    
    // Return closest snap target
    if (snapTargets.length > 0) {
      return snapTargets.sort((a, b) => a.distance - b.distance)[0];
    }
    
    return null;
  }, [vertices, worldToScreen]);
  
  // Place first vertex
  const placeFirstVertex = useCallback((position: [number, number, number]) => {
    const vertex: Vertex = {
      id: generateUUID(),
      position: position,
      index: 0,
      polygonId: currentPolygonId,
      connections: [],
      isFirst: true,
      isLast: true
    };
    
    setVertices([vertex]);
    setToolState(ToolState.DRAWING);
    
    return vertex;
  }, [currentPolygonId]);
  
  // Place subsequent vertex
  const placeVertex = useCallback((position: [number, number, number]) => {
    // Check proximity to first vertex for auto-close
    if (vertices.length >= 3) {
      const firstVertexScreen = worldToScreen(vertices[0].position);
      const currentScreen = worldToScreen(position);
      const distToFirst = distance2D(firstVertexScreen, currentScreen);
      
      if (distToFirst < AUTO_CLOSE_THRESHOLD) {
        closePolygon();
        return;
      }
    }
    
    const lastVertex = vertices[vertices.length - 1];
    
    const vertex: Vertex = {
      id: generateUUID(),
      position: position,
      index: vertices.length,
      polygonId: currentPolygonId,
      connections: [lastVertex.id],
      isFirst: false,
      isLast: true
    };
    
    // Update previous last vertex
    const updatedVertices = [...vertices];
    updatedVertices[updatedVertices.length - 1] = {
      ...lastVertex,
      isLast: false,
      connections: [...lastVertex.connections, vertex.id]
    };
    updatedVertices.push(vertex);
    
    // Create line segment
    const segment: Segment = {
      id: generateUUID(),
      startVertex: lastVertex.id,
      endVertex: vertex.id,
      polygonId: currentPolygonId
    };
    
    setVertices(updatedVertices);
    setSegments([...segments, segment]);
  }, [vertices, segments, currentPolygonId, worldToScreen]);
  
  // Close polygon
  const closePolygon = useCallback(() => {
    if (vertices.length < 3) return;
    
    // Create closing segment
    const lastVertex = vertices[vertices.length - 1];
    const firstVertex = vertices[0];
    
    const closingSegment: Segment = {
      id: generateUUID(),
      startVertex: lastVertex.id,
      endVertex: firstVertex.id,
      polygonId: currentPolygonId
    };
    
    setSegments([...segments, closingSegment]);
    
    // Convert vertices to flat array for contour update
    const points: number[] = [];
    vertices.forEach(vertex => {
      points.push(vertex.position[0], vertex.position[1], vertex.position[2]);
    });
    
    // Send contour update
    onContourUpdate({
      action: 'add_pen_contour',
      structureId: selectedStructure.roiNumber,
      slicePosition: imageMetadata.imagePosition[2],
      points: points
    });
    
    // Reset tool state
    setToolState(ToolState.IDLE);
    setVertices([]);
    setSegments([]);
    setCurrentPolygonId('');
  }, [vertices, segments, currentPolygonId, onContourUpdate, selectedStructure, imageMetadata]);
  
  // Mouse event handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (!isActive || !imageMetadata || !selectedStructure) return;
    
    const rect = overlayCanvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const worldPos = screenToWorld(screenX, screenY);
    
    console.log('PEN TOOL: Mouse down at screen coords:', screenX, screenY, 'button:', e.button);
    
    // Check for snapping
    const snap = checkForSnapping(worldPos);
    const targetPos = snap ? snap.position : worldPos;
    
    if (e.button === 0) { // Left click
      // Check if clicking on existing vertex
      const clickedVertex = vertices.find(v => {
        const vertexScreen = worldToScreen(v.position);
        return distance2D([screenX, screenY], vertexScreen) < VERTEX_SNAP_RADIUS;
      });
      
      if (clickedVertex) {
        // Check if it's the first vertex and we can close
        if (clickedVertex.isFirst && vertices.length >= 3) {
          console.log('PEN TOOL: Closing polygon by clicking first vertex');
          closePolygon();
        } else {
          // Start editing mode
          setToolState(ToolState.EDITING);
          setSelectedVertex(clickedVertex);
          setDragStartPos([screenX, screenY]);
          setIsDragging(false);
        }
      } else {
        // Place new vertex
        if (toolState === ToolState.IDLE) {
          console.log('PEN TOOL: Starting new polygon');
          setCurrentPolygonId(generateUUID());
          setToolState(ToolState.ACTIVE);
          placeFirstVertex(targetPos);
        } else if (toolState === ToolState.DRAWING) {
          console.log('PEN TOOL: Placing vertex');
          placeVertex(targetPos);
        }
      }
    } else if (e.button === 2) { // Right click
      e.preventDefault();
      console.log('PEN TOOL: Right click - toolState:', toolState, 'vertices:', vertices.length);
      // Right click to complete polygon
      if (toolState === ToolState.DRAWING && vertices.length >= 3) {
        console.log('PEN TOOL: Completing polygon with right click');
        closePolygon();
      }
    }
  }, [isActive, imageMetadata, selectedStructure, toolState, vertices, screenToWorld, 
      worldToScreen, checkForSnapping, placeFirstVertex, placeVertex, closePolygon]);
  
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const rect = overlayCanvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    setMousePosition([screenX, screenY]);
    
    if (!imageMetadata) return;
    
    const worldPos = screenToWorld(screenX, screenY);
    
    // Check for snapping
    const snap = checkForSnapping(worldPos);
    setSnapTarget(snap);
    
    // Handle vertex dragging
    if (toolState === ToolState.EDITING && selectedVertex && dragStartPos) {
      const deltaX = screenX - dragStartPos[0];
      const deltaY = screenY - dragStartPos[1];
      
      if (Math.abs(deltaX) > DRAG_THRESHOLD || Math.abs(deltaY) > DRAG_THRESHOLD) {
        setIsDragging(true);
        
        // Update vertex position
        const newWorldPos = snap ? snap.position : worldPos;
        const updatedVertices = vertices.map(v => 
          v.id === selectedVertex.id ? { ...v, position: newWorldPos } : v
        );
        setVertices(updatedVertices);
      }
    }
  }, [imageMetadata, toolState, selectedVertex, dragStartPos, vertices, 
      screenToWorld, checkForSnapping]);
  
  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if (toolState === ToolState.EDITING) {
      if (isDragging) {
        // Finalize vertex position
        // TODO: Add undo stack
      }
      
      setToolState(ToolState.DRAWING);
      setSelectedVertex(null);
      setDragStartPos(null);
      setIsDragging(false);
    }
  }, [toolState, isDragging]);
  
  // Render functions
  const renderPolygon = useCallback(() => {
    if (!overlayContextRef.current || vertices.length === 0) return;
    
    const ctx = overlayContextRef.current;
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    
    // Set styles
    ctx.strokeStyle = selectedStructure?.color || '#00ff00';
    ctx.fillStyle = `${selectedStructure?.color || '#00ff00'}20`;
    ctx.lineWidth = 2;
    
    // Draw filled polygon if closed
    const isClosed = segments.some(s => 
      s.startVertex === vertices[vertices.length - 1].id && 
      s.endVertex === vertices[0].id
    );
    
    if (isClosed) {
      ctx.beginPath();
      vertices.forEach((vertex, i) => {
        const [x, y] = worldToScreen(vertex.position);
        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else {
      // Draw open polygon
      ctx.beginPath();
      vertices.forEach((vertex, i) => {
        const [x, y] = worldToScreen(vertex.position);
        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });
      ctx.stroke();
      
      // Draw ghost line to cursor
      if (toolState === ToolState.DRAWING) {
        const lastVertex = vertices[vertices.length - 1];
        const [lastX, lastY] = worldToScreen(lastVertex.position);
        
        ctx.strokeStyle = `${selectedStructure?.color || '#00ff00'}80`;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(lastX, lastY);
        
        if (snapTarget) {
          const [snapX, snapY] = worldToScreen(snapTarget.position);
          ctx.lineTo(snapX, snapY);
        } else {
          ctx.lineTo(mousePosition[0], mousePosition[1]);
        }
        
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    
    // Draw vertices with enhanced visibility
    vertices.forEach((vertex, i) => {
      const [x, y] = worldToScreen(vertex.position);
      const radius = vertex.isFirst && vertices.length >= 3 ? 10 : 7;
      
      // Draw white border for visibility
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(x, y, radius + 2, 0, 2 * Math.PI);
      ctx.fill();
      
      // Draw colored center
      ctx.fillStyle = vertex.isFirst ? '#ff00ff' : (
        selectedStructure?.color ? 
        `rgb(${selectedStructure.color.join(',')})` : 
        '#00ff00'
      );
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, 2 * Math.PI);
      ctx.fill();
      
      // Highlight selected vertex
      if (selectedVertex && selectedVertex.id === vertex.id) {
        ctx.strokeStyle = '#ffff00';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(x, y, radius + 5, 0, 2 * Math.PI);
        ctx.stroke();
      }
      
      console.log(`PEN TOOL: Rendered vertex ${i} at screen coords (${x}, ${y})`);
    });
    
    // Draw snap indicator
    if (snapTarget && toolState === ToolState.DRAWING) {
      const [snapX, snapY] = worldToScreen(snapTarget.position);
      ctx.strokeStyle = '#ff00ff';
      ctx.lineWidth = 2;
      
      if (snapTarget.type === 'vertex') {
        ctx.beginPath();
        ctx.arc(snapX, snapY, 12, 0, 2 * Math.PI);
        ctx.stroke();
      }
    }
  }, [vertices, segments, selectedStructure, toolState, selectedVertex, snapTarget, 
      mousePosition, worldToScreen]);
  
  // Update render on state changes
  useEffect(() => {
    renderPolygon();
  }, [renderPolygon]);
  
  // Handle context menu (prevent default)
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    console.log('Right click detected - toolState:', toolState, 'vertices:', vertices.length);
    
    // Right click completes polygon in DRAWING state
    if (toolState === ToolState.DRAWING && vertices.length >= 3) {
      console.log('Completing polygon with right click');
      closePolygon();
    }
  }, [toolState, vertices, closePolygon]);
  
  console.log('EclipsePenTool render - isActive:', isActive, 'selectedStructure:', selectedStructure);
  
  if (!isActive) return null;
  
  return (
    <>
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
      <canvas
        ref={overlayCanvasRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          pointerEvents: isActive ? 'auto' : 'none',
          cursor: toolState === ToolState.EDITING ? 'move' : 'crosshair',
          zIndex: 6,
        }}
        width={1024}
        height={1024}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onContextMenu={handleContextMenu}
        onWheel={(e) => {
          // Allow wheel events to pass through for scrolling
          // Don't call preventDefault or stopPropagation to allow scrolling
        }}
      />
    </>
  );
}