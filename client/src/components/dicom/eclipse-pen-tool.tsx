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
    if (!imageMetadata) return [0, 0, 0];
    
    // Transform from screen space to image space
    const canvasX = (screenX - panX) / zoom;
    const canvasY = (screenY - panY) / zoom;
    
    // Apply HFS transformation
    const worldX = imageMetadata.imagePosition[0] + 
                   canvasX * imageMetadata.pixelSpacing[0] * imageMetadata.imageOrientation[0] +
                   canvasY * imageMetadata.pixelSpacing[1] * imageMetadata.imageOrientation[3];
    
    const worldY = imageMetadata.imagePosition[1] + 
                   canvasX * imageMetadata.pixelSpacing[0] * imageMetadata.imageOrientation[1] +
                   canvasY * imageMetadata.pixelSpacing[1] * imageMetadata.imageOrientation[4];
    
    const worldZ = imageMetadata.imagePosition[2];
    
    return [worldX, worldY, worldZ];
  }, [imageMetadata, zoom, panX, panY]);
  
  const worldToScreen = useCallback((world: [number, number, number]): [number, number] => {
    if (!imageMetadata) return [0, 0];
    
    // Transform from world to image coordinates
    const deltaX = world[0] - imageMetadata.imagePosition[0];
    const deltaY = world[1] - imageMetadata.imagePosition[1];
    
    const canvasX = (deltaX * imageMetadata.imageOrientation[0] + 
                     deltaY * imageMetadata.imageOrientation[1]) / imageMetadata.pixelSpacing[0];
    
    const canvasY = (deltaX * imageMetadata.imageOrientation[3] + 
                     deltaY * imageMetadata.imageOrientation[4]) / imageMetadata.pixelSpacing[1];
    
    // Apply zoom and pan
    const screenX = canvasX * zoom + panX;
    const screenY = canvasY * zoom + panY;
    
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
    console.log('🖱️ PEN TOOL MOUSE DOWN:', {
      isActive,
      hasImageMetadata: !!imageMetadata,
      hasSelectedStructure: !!selectedStructure,
      button: e.button,
      toolState
    });
    
    if (!isActive || !imageMetadata || !selectedStructure) {
      console.log('❌ Pen tool click blocked:', {
        isActive,
        imageMetadata: !!imageMetadata,
        selectedStructure: !!selectedStructure
      });
      return;
    }
    
    const rect = penCanvasRef.current?.getBoundingClientRect();
    if (!rect) {
      console.log('❌ No canvas rect found');
      return;
    }
    
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    console.log('📍 Click position:', { screenX, screenY });
    
    const worldPos = screenToWorld(screenX, screenY);
    console.log('🌍 World position:', worldPos);
    
    // Check for snapping
    const snap = checkForSnapping(worldPos);
    const targetPos = snap ? snap.position : worldPos;
    console.log('🎯 Target position:', targetPos, snap ? 'with snap' : 'no snap');
    
    if (e.button === 0) { // Left click
      // Check if clicking on existing vertex
      const clickedVertex = vertices.find(v => {
        const vertexScreen = worldToScreen(v.position);
        return distance2D([screenX, screenY], vertexScreen) < VERTEX_SNAP_RADIUS;
      });
      
      if (clickedVertex) {
        // Check if it's the first vertex and we can close
        if (clickedVertex.isFirst && vertices.length >= 3) {
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
          setCurrentPolygonId(generateUUID());
          setToolState(ToolState.ACTIVE);
          placeFirstVertex(targetPos);
        } else if (toolState === ToolState.DRAWING) {
          placeVertex(targetPos);
        }
      }
    } else if (e.button === 2) { // Right click
      // Right click to complete polygon
      if (toolState === ToolState.DRAWING && vertices.length >= 3) {
        closePolygon();
      }
    }
  }, [isActive, imageMetadata, selectedStructure, toolState, vertices, screenToWorld, 
      worldToScreen, checkForSnapping, placeFirstVertex, placeVertex, closePolygon]);
  
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const rect = penCanvasRef.current?.getBoundingClientRect();
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
    
    // Draw vertices
    vertices.forEach((vertex, i) => {
      const [x, y] = worldToScreen(vertex.position);
      const radius = vertex.isFirst && vertices.length >= 3 ? 8 : 5;
      
      ctx.fillStyle = vertex.isFirst ? '#ff00ff' : selectedStructure?.color || '#00ff00';
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, 2 * Math.PI);
      ctx.fill();
      
      // Highlight selected vertex
      if (selectedVertex && selectedVertex.id === vertex.id) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, radius + 3, 0, 2 * Math.PI);
        ctx.stroke();
      }
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
    
    // Right click completes polygon in DRAWING state
    if (toolState === ToolState.DRAWING && vertices.length >= 3) {
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
          zIndex: 9998,
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
          zIndex: 9999,
        }}
        width={1024}
        height={1024}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onContextMenu={handleContextMenu}
        onWheel={(e) => {
          // Don't prevent wheel events - let them bubble up for scrolling
        }}
      />
    </>
  );
}