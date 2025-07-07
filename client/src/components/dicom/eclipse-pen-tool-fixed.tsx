// Eclipse TPS-compliant Pen Tool Implementation
// Following the exact specification from Eclipse Treatment Planning System

import { useCallback, useEffect, useRef, useState } from 'react';
import { PenTool as PenIcon } from 'lucide-react';

// Eclipse TPS Tool States - EXACT as specified
enum ToolState {
  IDLE = 'IDLE',           // Tool selected but not engaged
  ACTIVE = 'ACTIVE',       // First click registered
  DRAWING = 'DRAWING',     // One or more vertices placed
  EDITING = 'EDITING',     // Existing vertex selected
  COMPLETE = 'COMPLETE'    // Polygon closed or finalized
}

interface Vertex {
  id: string;
  position: [number, number, number]; // World coordinates [x, y, z]
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
  isClosing?: boolean;
}

interface SnapTarget {
  type: 'vertex' | 'edge' | 'grid';
  target?: any;
  distance: number;
  position: [number, number, number];
}

interface ContextMenuItem {
  label: string;
  action: () => void;
  enabled: boolean;
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
  
  // Eclipse TPS State Machine
  const [toolState, setToolState] = useState<ToolState>(ToolState.IDLE);
  const [vertices, setVertices] = useState<Vertex[]>([]);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [currentPolygonId, setCurrentPolygonId] = useState<string>('');
  
  // Editing state
  const [selectedVertex, setSelectedVertex] = useState<Vertex | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartPos, setDragStartPos] = useState<[number, number] | null>(null);
  const [dragThreshold] = useState(3); // pixels
  
  // Mouse tracking
  const [mousePosition, setMousePosition] = useState<[number, number]>([0, 0]);
  const [snapTarget, setSnapTarget] = useState<SnapTarget | null>(null);
  
  // Context menu
  const [contextMenu, setContextMenu] = useState<{
    visible: boolean;
    position: [number, number];
    items: ContextMenuItem[];
  }>({ visible: false, position: [0, 0], items: [] });
  
  // Canvas refs
  const penCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  
  // Eclipse TPS Configuration
  const VERTEX_SNAP_RADIUS = 10; // pixels
  const EDGE_SNAP_RADIUS = 8; // pixels 
  const AUTO_CLOSE_THRESHOLD = 15; // pixels
  const MAGNETIC_RADIUS = 8; // pixels
  
  // Initialize tool state when activated
  useEffect(() => {
    if (isActive && toolState === ToolState.IDLE) {
      console.log('ECLIPSE PEN: Tool activated, entering IDLE state');
      setCurrentPolygonId(generateUUID());
      // Stay in IDLE until first click
    } else if (!isActive) {
      console.log('ECLIPSE PEN: Tool deactivated, resetting state');
      resetToolState();
    }
  }, [isActive]);
  
  // Generate UUID
  const generateUUID = () => {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  };
  
  // Reset tool to IDLE state
  const resetToolState = useCallback(() => {
    setToolState(ToolState.IDLE);
    setVertices([]);
    setSegments([]);
    setSelectedVertex(null);
    setIsDragging(false);
    setDragStartPos(null);
    setSnapTarget(null);
    setContextMenu({ visible: false, position: [0, 0], items: [] });
    setCurrentPolygonId(generateUUID());
  }, []);
  
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
  
  // Find vertex at screen position
  const findVertexAtPosition = useCallback((screenPos: [number, number]): Vertex | null => {
    for (const vertex of vertices) {
      const vertexScreen = worldToScreen(vertex.position);
      const dist = distance2D(screenPos, vertexScreen);
      if (dist <= VERTEX_SNAP_RADIUS) {
        return vertex;
      }
    }
    return null;
  }, [vertices, worldToScreen]);
  
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
    
    // Return closest snap target
    if (snapTargets.length > 0) {
      return snapTargets.sort((a, b) => a.distance - b.distance)[0];
    }
    
    return null;
  }, [vertices, worldToScreen]);
  
  // Eclipse TPS: Place first vertex (IDLE → ACTIVE → DRAWING)
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
    
    console.log('ECLIPSE PEN: Placing first vertex, IDLE → ACTIVE → DRAWING');
    setVertices([vertex]);
    setToolState(ToolState.DRAWING);
    
    return vertex;
  }, [currentPolygonId]);
  
  // Eclipse TPS: Place subsequent vertex
  const placeVertex = useCallback((position: [number, number, number]) => {
    if (vertices.length === 0) {
      return placeFirstVertex(position);
    }
    
    // Check proximity to first vertex for auto-close
    if (vertices.length >= 3) {
      const firstVertexScreen = worldToScreen(vertices[0].position);
      const currentScreen = worldToScreen(position);
      const distToFirst = distance2D(firstVertexScreen, currentScreen);
      
      if (distToFirst < AUTO_CLOSE_THRESHOLD) {
        console.log('ECLIPSE PEN: Near first vertex, highlighting for auto-close');
        // Visual feedback handled in render
        if (distToFirst < MAGNETIC_RADIUS) {
          // Snap to first vertex and close
          closePolygon();
          return;
        }
      }
    }
    
    const lastVertex = vertices[vertices.length - 1];
    
    const vertex: Vertex = {
      id: generateUUID(),
      position: position, // Could apply snapping here
      index: vertices.length,
      polygonId: currentPolygonId,
      connections: [lastVertex.id],
      isFirst: false,
      isLast: true
    };
    
    // Update previous last vertex
    const updatedVertices = vertices.map(v => 
      v.id === lastVertex.id ? { ...v, isLast: false, connections: [...v.connections, vertex.id] } : v
    );
    
    // Create line segment
    const segment: Segment = {
      id: generateUUID(),
      startVertex: lastVertex.id,
      endVertex: vertex.id,
      polygonId: currentPolygonId
    };
    
    console.log('ECLIPSE PEN: Placing subsequent vertex');
    setVertices([...updatedVertices, vertex]);
    setSegments(prev => [...prev, segment]);
    
  }, [vertices, currentPolygonId, worldToScreen, placeFirstVertex]);
  
  // Eclipse TPS: Close polygon
  const closePolygon = useCallback(() => {
    if (vertices.length < 3) {
      console.log('ECLIPSE PEN: Cannot close polygon - need at least 3 vertices');
      return;
    }
    
    const lastVertex = vertices[vertices.length - 1];
    const firstVertex = vertices[0];
    
    // Create closing segment
    const closingSegment: Segment = {
      id: generateUUID(),
      startVertex: lastVertex.id,
      endVertex: firstVertex.id,
      polygonId: currentPolygonId,
      isClosing: true
    };
    
    console.log('ECLIPSE PEN: Closing polygon, DRAWING → COMPLETE');
    setSegments(prev => [...prev, closingSegment]);
    setToolState(ToolState.COMPLETE);
    
    // Convert to contour and send update
    const contourPoints: number[] = [];
    vertices.forEach(vertex => {
      contourPoints.push(vertex.position[0], vertex.position[1], vertex.position[2]);
    });
    
    // Send contour update
    const payload = {
      action: 'add_contour',
      structureIndex: selectedStructure,
      slicePosition: currentSlicePosition,
      contourPoints: contourPoints
    };
    
    onContourUpdate(payload);
    
    // Reset for next polygon
    setTimeout(() => {
      resetToolState();
    }, 100);
    
  }, [vertices, currentPolygonId, selectedStructure, currentSlicePosition, onContourUpdate, resetToolState]);
  
  // Generate context menu items based on Eclipse TPS spec
  const generateContextMenu = useCallback((screenPos: [number, number], worldPos: [number, number, number]) => {
    const items: ContextMenuItem[] = [];
    const clickedVertex = findVertexAtPosition(screenPos);
    
    if (clickedVertex) {
      // Vertex context menu
      items.push({
        label: "Delete Vertex",
        action: () => {
          // TODO: Implement vertex deletion
          setContextMenu({ visible: false, position: [0, 0], items: [] });
        },
        enabled: vertices.length > 3
      });
      
      items.push({
        label: "Set as Start Point",
        action: () => {
          // TODO: Implement start point change
          setContextMenu({ visible: false, position: [0, 0], items: [] });
        },
        enabled: !clickedVertex.isFirst
      });
      
      if (clickedVertex.isFirst && toolState === ToolState.DRAWING) {
        items.push({
          label: "Close Polygon Here",
          action: () => {
            closePolygon();
            setContextMenu({ visible: false, position: [0, 0], items: [] });
          },
          enabled: vertices.length >= 3
        });
      }
    } else if (toolState === ToolState.DRAWING) {
      // Active polygon context menu
      items.push({
        label: "Close Polygon",
        action: () => {
          closePolygon();
          setContextMenu({ visible: false, position: [0, 0], items: [] });
        },
        enabled: vertices.length >= 3
      });
      
      items.push({
        label: "Cancel Polygon",
        action: () => {
          resetToolState();
          setContextMenu({ visible: false, position: [0, 0], items: [] });
        },
        enabled: true
      });
      
      items.push({
        label: "Delete Last Vertex",
        action: () => {
          if (vertices.length > 1) {
            setVertices(prev => prev.slice(0, -1));
            setSegments(prev => prev.slice(0, -1));
          } else {
            resetToolState();
          }
          setContextMenu({ visible: false, position: [0, 0], items: [] });
        },
        enabled: vertices.length > 0
      });
    } else {
      // Empty area context menu
      items.push({
        label: "Start New Polygon",
        action: () => {
          placeFirstVertex(worldPos);
          setContextMenu({ visible: false, position: [0, 0], items: [] });
        },
        enabled: true
      });
    }
    
    return items;
  }, [findVertexAtPosition, vertices, toolState, closePolygon, resetToolState, placeFirstVertex]);
  
  // Eclipse TPS Mouse Event Handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!isActive) return;
    
    const rect = overlayCanvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const worldPos = screenToWorld(screenX, screenY);
    
    console.log('ECLIPSE PEN: Mouse down at', screenX, screenY, 'button:', e.button);
    
    if (e.button === 0) { // Left mouse button
      const clickedVertex = findVertexAtPosition([screenX, screenY]);
      
      if (clickedVertex) {
        // Eclipse TPS: Clicked on existing vertex → Enter EDITING state
        if (clickedVertex.polygonId === currentPolygonId) {
          console.log('ECLIPSE PEN: Clicked own vertex, entering EDITING state');
          setToolState(ToolState.EDITING);
          setSelectedVertex(clickedVertex);
          setDragStartPos([screenX, screenY]);
          setIsDragging(false);
        }
      } else {
        // Eclipse TPS: Empty space → Place vertex or start new polygon
        if (toolState === ToolState.IDLE) {
          console.log('ECLIPSE PEN: First click, IDLE → ACTIVE → DRAWING');
          placeFirstVertex(worldPos);
        } else if (toolState === ToolState.DRAWING) {
          console.log('ECLIPSE PEN: Placing subsequent vertex');
          placeVertex(worldPos);
        }
      }
    } else if (e.button === 2) { // Right mouse button
      // Eclipse TPS: Show context menu (NOT immediate close!)
      e.preventDefault();
      const menuItems = generateContextMenu([screenX, screenY], worldPos);
      setContextMenu({
        visible: true,
        position: [screenX, screenY],
        items: menuItems
      });
    }
  }, [isActive, screenToWorld, findVertexAtPosition, currentPolygonId, toolState, placeFirstVertex, placeVertex, generateContextMenu]);
  
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isActive) return;
    
    const rect = overlayCanvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const worldPos = screenToWorld(screenX, screenY);
    
    setMousePosition([screenX, screenY]);
    
    // Check for snapping
    const snap = checkForSnapping(worldPos);
    setSnapTarget(snap);
    
    // Handle vertex dragging in EDITING state
    if (toolState === ToolState.EDITING && selectedVertex && dragStartPos) {
      const deltaX = screenX - dragStartPos[0];
      const deltaY = screenY - dragStartPos[1];
      
      if (!isDragging && Math.sqrt(deltaX * deltaX + deltaY * deltaY) > dragThreshold) {
        console.log('ECLIPSE PEN: Started dragging vertex');
        setIsDragging(true);
      }
      
      if (isDragging) {
        // Update vertex position
        const newWorldPos = snap ? snap.position : worldPos;
        setVertices(prev => prev.map(v => 
          v.id === selectedVertex.id ? { ...v, position: newWorldPos } : v
        ));
      }
    }
  }, [isActive, screenToWorld, checkForSnapping, toolState, selectedVertex, dragStartPos, isDragging, dragThreshold]);
  
  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if (!isActive) return;
    
    if (e.button === 0 && toolState === ToolState.EDITING) {
      console.log('ECLIPSE PEN: Mouse up in EDITING state');
      
      if (isDragging) {
        console.log('ECLIPSE PEN: Finalized vertex drag');
        // Vertex drag completed
      } else {
        console.log('ECLIPSE PEN: Just selected vertex (no drag)');
        // Was just a click, vertex already selected
      }
      
      // Return to previous state
      setToolState(ToolState.DRAWING);
      setSelectedVertex(null);
      setIsDragging(false);
      setDragStartPos(null);
    }
  }, [isActive, toolState, isDragging]);
  
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); // Prevent browser context menu
  }, []);
  
  // Render function
  const renderPenTool = useCallback(() => {
    const canvas = penCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !isActive) return;
    
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Get selected structure for color
    const selectedStructureData = rtStructures?.structures?.find((s: any) => s.roiNumber === selectedStructure);
    const structureColor = selectedStructureData?.color || [0, 255, 0];
    
    // Draw line segments
    ctx.strokeStyle = `rgb(${structureColor.join(',')})`;
    ctx.lineWidth = 2;
    
    segments.forEach(segment => {
      const startVertex = vertices.find(v => v.id === segment.startVertex);
      const endVertex = vertices.find(v => v.id === segment.endVertex);
      
      if (startVertex && endVertex) {
        const [startX, startY] = worldToScreen(startVertex.position);
        const [endX, endY] = worldToScreen(endVertex.position);
        
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.stroke();
      }
    });
    
    // Draw ghost line in DRAWING state
    if (toolState === ToolState.DRAWING && vertices.length > 0) {
      const lastVertex = vertices[vertices.length - 1];
      const [lastX, lastY] = worldToScreen(lastVertex.position);
      const [mouseX, mouseY] = mousePosition;
      
      ctx.strokeStyle = snapTarget ? '#ff00ff' : `rgba(${structureColor.join(',')}, 0.7)`;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(lastX, lastY);
      
      if (snapTarget) {
        const [snapX, snapY] = worldToScreen(snapTarget.position);
        ctx.lineTo(snapX, snapY);
      } else {
        ctx.lineTo(mouseX, mouseY);
      }
      
      ctx.stroke();
      ctx.setLineDash([]);
    }
    
    // Draw vertices
    vertices.forEach((vertex, i) => {
      const [x, y] = worldToScreen(vertex.position);
      const radius = vertex.isFirst && vertices.length >= 3 ? 10 : 7;
      
      // Check for auto-close highlight
      const isAutoCloseHighlight = vertex.isFirst && vertices.length >= 3 && toolState === ToolState.DRAWING;
      const nearFirstVertex = isAutoCloseHighlight && vertices.length >= 3;
      
      if (nearFirstVertex) {
        const currentScreen = mousePosition;
        const firstScreen = worldToScreen(vertices[0].position);
        const distToFirst = distance2D(currentScreen, firstScreen);
        
        if (distToFirst < AUTO_CLOSE_THRESHOLD) {
          // Highlight first vertex for auto-close
          ctx.fillStyle = '#ff00ff';
          ctx.beginPath();
          ctx.arc(x, y, radius + 4, 0, 2 * Math.PI);
          ctx.fill();
        }
      }
      
      // Draw white border for visibility
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(x, y, radius + 2, 0, 2 * Math.PI);
      ctx.fill();
      
      // Draw colored center
      ctx.fillStyle = vertex.isFirst ? '#ff00ff' : `rgb(${structureColor.join(',')})`;
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
  }, [isActive, rtStructures, selectedStructure, segments, vertices, worldToScreen, toolState, mousePosition, snapTarget, selectedVertex]);
  
  // Update render on state changes
  useEffect(() => {
    renderPenTool();
  }, [renderPenTool]);
  
  // Handle canvas sizing
  useEffect(() => {
    if (!canvasRef.current || !penCanvasRef.current || !overlayCanvasRef.current) return;
    
    const mainCanvas = canvasRef.current;
    const penCanvas = penCanvasRef.current;
    const overlayCanvas = overlayCanvasRef.current;
    
    // Match main canvas size
    penCanvas.width = mainCanvas.offsetWidth;
    penCanvas.height = mainCanvas.offsetHeight;
    penCanvas.style.width = '100%';
    penCanvas.style.height = '100%';
    
    overlayCanvas.width = mainCanvas.offsetWidth;
    overlayCanvas.height = mainCanvas.offsetHeight;
    overlayCanvas.style.width = '100%';
    overlayCanvas.style.height = '100%';
  }, [canvasRef, zoom, panX, panY]);
  
  console.log('ECLIPSE PEN: Render - isActive:', isActive, 'toolState:', toolState, 'vertices:', vertices.length);
  
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
        }}
      />
      
      {/* Context Menu */}
      {contextMenu.visible && (
        <div
          style={{
            position: 'fixed',
            left: contextMenu.position[0],
            top: contextMenu.position[1],
            zIndex: 1000,
            backgroundColor: '#1a1a1a',
            border: '1px solid #444',
            borderRadius: '4px',
            padding: '4px 0',
            minWidth: '150px',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {contextMenu.items.map((item, index) => (
            <div
              key={index}
              style={{
                padding: '8px 16px',
                cursor: item.enabled ? 'pointer' : 'not-allowed',
                color: item.enabled ? '#ffffff' : '#666666',
                fontSize: '14px',
                backgroundColor: 'transparent',
                borderBottom: index < contextMenu.items.length - 1 ? '1px solid #333' : 'none'
              }}
              onMouseEnter={(e) => {
                if (item.enabled) {
                  e.currentTarget.style.backgroundColor = '#333333';
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
              }}
              onClick={() => {
                if (item.enabled) {
                  item.action();
                }
              }}
            >
              {item.label}
            </div>
          ))}
        </div>
      )}
      
      {/* Click outside to close context menu */}
      {contextMenu.visible && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 999,
          }}
          onClick={() => setContextMenu({ visible: false, position: [0, 0], items: [] })}
        />
      )}
    </>
  );
}