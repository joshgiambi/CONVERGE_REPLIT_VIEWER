// Eclipse TPS Draw Planar Contour Tool Implementation
// Following Eclipse Treatment Planning System specification

import { useCallback, useEffect, useRef, useState } from 'react';
import { PenTool as PenIcon } from 'lucide-react';

// Eclipse Drawing Modes
enum DrawingMode {
  POINT_BY_POINT = 'POINT_BY_POINT',    // Click to place points
  CONTINUOUS = 'CONTINUOUS',             // Click and drag to draw
  MODIFY = 'MODIFY'                      // Modify existing contours
}

// Eclipse Tool States
enum ToolState {
  IDLE = 'IDLE',                         // Tool ready
  DRAWING_STRAIGHT = 'DRAWING_STRAIGHT', // Drawing straight line segments
  DRAWING_CURVED = 'DRAWING_CURVED',     // Drawing continuous curved lines
  MODIFYING = 'MODIFYING'                // Modifying existing contour
}

// Eclipse Modification Actions
enum ModificationAction {
  MOVE_CONTOUR = 'MOVE_CONTOUR',         // Shift + drag entire contour
  RESHAPE_CONTOUR = 'RESHAPE_CONTOUR',   // Click + drag to reshape
  ADD_SEGMENT = 'ADD_SEGMENT',           // Ctrl + draw inside contour
  REMOVE_SEGMENT = 'REMOVE_SEGMENT'      // Shift + draw outside contour
}

interface ContourPoint {
  id: string;
  position: [number, number, number]; // World coordinates
  screenPosition: [number, number];   // Screen coordinates
  index: number;
  timestamp: number;
}

interface ContourSegment {
  id: string;
  points: ContourPoint[];
  isClosed: boolean;
  isComplete: boolean;
  sliceIndex: number;
  modificationAction?: ModificationAction;
}

interface EclipsePlanarContourProps {
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

export function EclipsePlanarContourTool({
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
}: EclipsePlanarContourProps) {
  
  // Tool state management
  const [toolState, setToolState] = useState<ToolState>(ToolState.IDLE);
  const [drawingMode, setDrawingMode] = useState<DrawingMode>(DrawingMode.POINT_BY_POINT);
  const [currentSegment, setCurrentSegment] = useState<ContourSegment | null>(null);
  const [completedSegments, setCompletedSegments] = useState<ContourSegment[]>([]);
  const [clipboardContour, setClipboardContour] = useState<ContourSegment | null>(null);
  
  // Drawing state
  const [isMouseDown, setIsMouseDown] = useState(false);
  const [startPoint, setStartPoint] = useState<[number, number] | null>(null);
  const [currentPath, setCurrentPath] = useState<ContourPoint[]>([]);
  const [modificationAction, setModificationAction] = useState<ModificationAction | null>(null);
  
  // Mouse tracking
  const [mousePosition, setMousePosition] = useState<[number, number]>([0, 0]);
  const [keyboardState, setKeyboardState] = useState({
    ctrl: false,
    shift: false,
    alt: false
  });
  
  // Canvas refs
  const contourCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  
  // Eclipse Configuration
  const DEFORMATION_PERCENTAGE = 50; // Default deformation for reshaping
  const CONNECTION_THRESHOLD = 15; // Pixels for connection highlighting
  const SMOOTHING_FACTOR = 0.8; // Curve smoothing
  const POINT_RADIUS = 4;
  
  // Initialize when activated
  useEffect(() => {
    if (isActive) {
      console.log('ECLIPSE PLANAR: Tool activated');
      setToolState(ToolState.IDLE);
    } else {
      console.log('ECLIPSE PLANAR: Tool deactivated');
      resetTool();
    }
  }, [isActive]);
  
  // Generate UUID
  const generateUUID = () => {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  };
  
  // Reset tool state
  const resetTool = useCallback(() => {
    setToolState(ToolState.IDLE);
    setCurrentSegment(null);
    setCurrentPath([]);
    setIsMouseDown(false);
    setStartPoint(null);
    setModificationAction(null);
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
    
    // Apply transformation
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
  
  // Eclipse: Check if point is near starting point for closure
  const isNearStartPoint = useCallback((screenPos: [number, number]): boolean => {
    if (!startPoint || currentPath.length < 3) return false;
    
    const dist = distance2D(screenPos, startPoint);
    return dist < CONNECTION_THRESHOLD;
  }, [startPoint, currentPath]);
  
  // Eclipse: Create contour point
  const createContourPoint = useCallback((screenX: number, screenY: number): ContourPoint => {
    const worldPos = screenToWorld(screenX, screenY);
    
    return {
      id: generateUUID(),
      position: worldPos,
      screenPosition: [screenX, screenY],
      index: currentPath.length,
      timestamp: Date.now()
    };
  }, [screenToWorld, currentPath]);
  
  // Eclipse: Start new contour segment
  const startNewSegment = useCallback((point: ContourPoint) => {
    const newSegment: ContourSegment = {
      id: generateUUID(),
      points: [point],
      isClosed: false,
      isComplete: false,
      sliceIndex: currentSlicePosition,
      modificationAction: modificationAction || undefined
    };
    
    setCurrentSegment(newSegment);
    setCurrentPath([point]);
    setStartPoint([point.screenPosition[0], point.screenPosition[1]]);
    
    console.log('ECLIPSE PLANAR: Started new segment', newSegment.id);
  }, [currentSlicePosition, modificationAction]);
  
  // Eclipse: Add point to current segment
  const addPointToSegment = useCallback((point: ContourPoint) => {
    if (!currentSegment) return;
    
    setCurrentPath(prev => [...prev, point]);
    setCurrentSegment(prev => ({
      ...prev!,
      points: [...prev!.points, point]
    }));
  }, [currentSegment]);
  
  // Eclipse: Close current segment
  const closeCurrentSegment = useCallback(() => {
    if (!currentSegment || currentPath.length < 3) return;
    
    const closedSegment: ContourSegment = {
      ...currentSegment,
      isClosed: true,
      isComplete: true,
      points: currentPath
    };
    
    setCompletedSegments(prev => [...prev, closedSegment]);
    
    // Convert to contour and send update
    const contourPoints: number[] = [];
    currentPath.forEach(point => {
      contourPoints.push(point.position[0], point.position[1], point.position[2]);
    });
    
    // Determine action based on modification mode
    let action = 'add_contour';
    if (modificationAction === ModificationAction.ADD_SEGMENT) {
      action = 'add_segment';
    } else if (modificationAction === ModificationAction.REMOVE_SEGMENT) {
      action = 'remove_segment';
    }
    
    const payload = {
      action: action,
      structureIndex: selectedStructure,
      slicePosition: currentSlicePosition,
      contourPoints: contourPoints
    };
    
    onContourUpdate(payload);
    
    console.log('ECLIPSE PLANAR: Closed segment with', currentPath.length, 'points');
    
    // Reset drawing state
    setCurrentSegment(null);
    setCurrentPath([]);
    setStartPoint(null);
    setToolState(ToolState.IDLE);
    setModificationAction(null);
  }, [currentSegment, currentPath, modificationAction, selectedStructure, currentSlicePosition, onContourUpdate]);
  
  // Eclipse: Handle keyboard modifiers for modification actions
  const updateModificationAction = useCallback(() => {
    if (keyboardState.ctrl && !keyboardState.shift) {
      setModificationAction(ModificationAction.ADD_SEGMENT);
    } else if (keyboardState.shift && !keyboardState.ctrl) {
      setModificationAction(ModificationAction.REMOVE_SEGMENT);
    } else if (keyboardState.shift && !keyboardState.ctrl) {
      setModificationAction(ModificationAction.MOVE_CONTOUR);
    } else {
      setModificationAction(null);
    }
  }, [keyboardState]);
  
  useEffect(() => {
    updateModificationAction();
  }, [updateModificationAction]);
  
  // Eclipse: Mouse event handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!isActive) return;
    
    const rect = overlayCanvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    
    setMousePosition([screenX, screenY]);
    setIsMouseDown(true);
    
    if (e.button === 0) { // Left mouse button
      const point = createContourPoint(screenX, screenY);
      
      if (toolState === ToolState.IDLE) {
        // Start new drawing
        if (e.ctrlKey) {
          // Hold Ctrl: Add segment to structure
          setDrawingMode(DrawingMode.CONTINUOUS);
          setToolState(ToolState.DRAWING_CURVED);
          console.log('ECLIPSE PLANAR: Starting continuous drawing (Ctrl held)');
        } else {
          // Point-by-point drawing
          setDrawingMode(DrawingMode.POINT_BY_POINT);
          setToolState(ToolState.DRAWING_STRAIGHT);
          console.log('ECLIPSE PLANAR: Starting point-by-point drawing');
        }
        
        startNewSegment(point);
      } else if (toolState === ToolState.DRAWING_STRAIGHT) {
        // Add point in straight line mode
        addPointToSegment(point);
        
        // Check for closure
        if (isNearStartPoint([screenX, screenY])) {
          console.log('ECLIPSE PLANAR: Near start point, closing segment');
          closeCurrentSegment();
        }
      } else if (toolState === ToolState.DRAWING_CURVED) {
        // Start continuous curve drawing
        if (!currentSegment) {
          startNewSegment(point);
        }
      }
    } else if (e.button === 2) { // Right mouse button
      e.preventDefault();
      
      if (toolState === ToolState.DRAWING_STRAIGHT || toolState === ToolState.DRAWING_CURVED) {
        // Right-click to close segment
        if (isNearStartPoint([screenX, screenY]) || currentPath.length >= 3) {
          console.log('ECLIPSE PLANAR: Right-click closing segment');
          closeCurrentSegment();
        }
      }
    }
  }, [isActive, toolState, createContourPoint, startNewSegment, addPointToSegment, isNearStartPoint, closeCurrentSegment, currentSegment, currentPath]);
  
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isActive) return;
    
    const rect = overlayCanvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    
    setMousePosition([screenX, screenY]);
    
    // Eclipse: Continuous drawing mode
    if (isMouseDown && toolState === ToolState.DRAWING_CURVED && currentSegment) {
      const point = createContourPoint(screenX, screenY);
      
      // Add point if mouse moved enough distance
      const lastPoint = currentPath[currentPath.length - 1];
      if (lastPoint) {
        const dist = distance2D([screenX, screenY], lastPoint.screenPosition);
        if (dist > 5) { // Minimum distance for new point
          addPointToSegment(point);
        }
      }
    }
  }, [isActive, isMouseDown, toolState, currentSegment, createContourPoint, addPointToSegment, currentPath]);
  
  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if (!isActive) return;
    
    const rect = overlayCanvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    
    setIsMouseDown(false);
    
    if (e.button === 0 && toolState === ToolState.DRAWING_CURVED) {
      // End continuous drawing on mouse up
      if (isNearStartPoint([screenX, screenY]) && currentPath.length >= 3) {
        console.log('ECLIPSE PLANAR: Mouse up near start, closing curved segment');
        closeCurrentSegment();
      }
    }
  }, [isActive, toolState, isNearStartPoint, closeCurrentSegment, currentPath]);
  
  // Eclipse: Keyboard event handlers
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!isActive) return;
    
    // Update keyboard state
    setKeyboardState(prev => ({
      ...prev,
      ctrl: e.ctrlKey,
      shift: e.shiftKey,
      alt: e.altKey
    }));
    
    if (e.key === 'Delete') {
      // Delete key: Erase all contours
      console.log('ECLIPSE PLANAR: Delete key - erasing all contours');
      setCompletedSegments([]);
      resetTool();
      
      const payload = {
        action: 'clear_all_contours',
        structureIndex: selectedStructure,
        slicePosition: currentSlicePosition
      };
      onContourUpdate(payload);
    } else if (e.ctrlKey && e.key === 'x') {
      // Ctrl+X: Cut contours
      if (completedSegments.length > 0) {
        setClipboardContour(completedSegments[completedSegments.length - 1]);
        setCompletedSegments(prev => prev.slice(0, -1));
        console.log('ECLIPSE PLANAR: Cut last contour');
      }
    } else if (e.ctrlKey && e.key === 'c') {
      // Ctrl+C: Copy contours
      if (completedSegments.length > 0) {
        setClipboardContour(completedSegments[completedSegments.length - 1]);
        console.log('ECLIPSE PLANAR: Copied last contour');
      }
    } else if (e.ctrlKey && e.key === 'v') {
      // Ctrl+V: Paste contours
      if (clipboardContour) {
        console.log('ECLIPSE PLANAR: Pasting contour');
        
        // Create new segment from clipboard
        const pastedSegment: ContourSegment = {
          ...clipboardContour,
          id: generateUUID(),
          sliceIndex: currentSlicePosition,
          points: clipboardContour.points.map((p, index) => ({
            ...p,
            id: generateUUID(),
            index: index,
            position: [p.position[0], p.position[1], parseFloat(imageMetadata.imagePosition.split("\\")[2])]
          }))
        };
        
        setCompletedSegments(prev => [...prev, pastedSegment]);
        
        // Send paste update
        const contourPoints: number[] = [];
        pastedSegment.points.forEach(point => {
          contourPoints.push(point.position[0], point.position[1], point.position[2]);
        });
        
        const payload = {
          action: 'add_contour',
          structureIndex: selectedStructure,
          slicePosition: currentSlicePosition,
          contourPoints: contourPoints
        };
        onContourUpdate(payload);
      }
    }
  }, [isActive, completedSegments, clipboardContour, selectedStructure, currentSlicePosition, onContourUpdate, imageMetadata, resetTool]);
  
  const handleKeyUp = useCallback((e: KeyboardEvent) => {
    if (!isActive) return;
    
    // Update keyboard state
    setKeyboardState(prev => ({
      ...prev,
      ctrl: e.ctrlKey,
      shift: e.shiftKey,
      alt: e.altKey
    }));
  }, [isActive]);
  
  // Add keyboard listeners
  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [handleKeyDown, handleKeyUp]);
  
  // Render function
  const renderTool = useCallback(() => {
    const canvas = contourCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !isActive) return;
    
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Get structure color
    const selectedStructureData = rtStructures?.structures?.find((s: any) => s.roiNumber === selectedStructure);
    const structureColor = selectedStructureData?.color || [0, 255, 0];
    
    // Draw completed segments
    completedSegments.forEach(segment => {
      if (segment.points.length < 2) return;
      
      ctx.strokeStyle = `rgb(${structureColor.join(',')})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      
      segment.points.forEach((point, index) => {
        const [x, y] = worldToScreen(point.position);
        if (index === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });
      
      if (segment.isClosed) {
        ctx.closePath();
      }
      
      ctx.stroke();
      
      // Draw points
      segment.points.forEach(point => {
        const [x, y] = worldToScreen(point.position);
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(x, y, POINT_RADIUS, 0, 2 * Math.PI);
        ctx.fill();
        
        ctx.strokeStyle = `rgb(${structureColor.join(',')})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x, y, POINT_RADIUS, 0, 2 * Math.PI);
        ctx.stroke();
      });
    });
    
    // Draw current segment being drawn
    if (currentSegment && currentPath.length > 0) {
      ctx.strokeStyle = modificationAction ? '#ff00ff' : `rgb(${structureColor.join(',')})`;
      ctx.lineWidth = 2;
      ctx.setLineDash(modificationAction ? [5, 5] : []);
      ctx.beginPath();
      
      currentPath.forEach((point, index) => {
        const [x, y] = worldToScreen(point.position);
        if (index === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });
      
      // Draw line to mouse position if drawing straight lines
      if (toolState === ToolState.DRAWING_STRAIGHT && currentPath.length > 0) {
        ctx.lineTo(mousePosition[0], mousePosition[1]);
      }
      
      ctx.stroke();
      ctx.setLineDash([]);
      
      // Draw points
      currentPath.forEach((point, index) => {
        const [x, y] = worldToScreen(point.position);
        
        // Highlight first point if near for closure
        if (index === 0 && isNearStartPoint(mousePosition)) {
          ctx.fillStyle = '#ff00ff';
          ctx.beginPath();
          ctx.arc(x, y, POINT_RADIUS + 3, 0, 2 * Math.PI);
          ctx.fill();
        }
        
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(x, y, POINT_RADIUS, 0, 2 * Math.PI);
        ctx.fill();
        
        ctx.strokeStyle = `rgb(${structureColor.join(',')})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x, y, POINT_RADIUS, 0, 2 * Math.PI);
        ctx.stroke();
      });
    }
  }, [isActive, completedSegments, currentSegment, currentPath, rtStructures, selectedStructure, worldToScreen, toolState, mousePosition, isNearStartPoint, modificationAction]);
  
  // Update render
  useEffect(() => {
    renderTool();
  }, [renderTool]);
  
  // Handle canvas sizing
  useEffect(() => {
    if (!canvasRef.current || !contourCanvasRef.current || !overlayCanvasRef.current) return;
    
    const mainCanvas = canvasRef.current;
    const contourCanvas = contourCanvasRef.current;
    const overlayCanvas = overlayCanvasRef.current;
    
    // Match main canvas size
    contourCanvas.width = mainCanvas.offsetWidth;
    contourCanvas.height = mainCanvas.offsetHeight;
    overlayCanvas.width = mainCanvas.offsetWidth;
    overlayCanvas.height = mainCanvas.offsetHeight;
  }, [canvasRef, zoom, panX, panY]);
  
  console.log('ECLIPSE PLANAR: Render - isActive:', isActive, 'toolState:', toolState, 'segments:', completedSegments.length, 'currentPath:', currentPath.length);
  
  if (!isActive) return null;
  
  return (
    <>
      {/* Drawing canvas */}
      <canvas
        ref={contourCanvasRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          zIndex: 5,
        }}
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
          cursor: modificationAction ? 'move' : 'crosshair',
          zIndex: 6,
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onContextMenu={(e) => e.preventDefault()}
      />
      
      {/* Eclipse Tool Status */}
      {(toolState !== ToolState.IDLE || modificationAction) && (
        <div style={{
          position: 'absolute',
          top: '10px',
          left: '10px',
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
          color: 'white',
          padding: '8px 12px',
          borderRadius: '4px',
          fontSize: '12px',
          zIndex: 10
        }}>
          {modificationAction === ModificationAction.ADD_SEGMENT && 'ADD SEGMENT (Ctrl)'}
          {modificationAction === ModificationAction.REMOVE_SEGMENT && 'REMOVE SEGMENT (Shift)'}
          {modificationAction === ModificationAction.MOVE_CONTOUR && 'MOVE CONTOUR (Shift+Drag)'}
          {!modificationAction && toolState === ToolState.DRAWING_STRAIGHT && 'STRAIGHT LINES - Click points, Right-click to close'}
          {!modificationAction && toolState === ToolState.DRAWING_CURVED && 'CURVED LINES - Hold and drag, Release near start to close'}
          {!modificationAction && toolState === ToolState.IDLE && 'PLANAR CONTOUR - Click to start, Ctrl+Click for curves'}
        </div>
      )}
      
      {/* Eclipse Keyboard Shortcuts */}
      <div style={{
        position: 'absolute',
        bottom: '10px',
        right: '10px',
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        color: 'white',
        padding: '8px 12px',
        borderRadius: '4px',
        fontSize: '11px',
        zIndex: 10,
        lineHeight: '1.4'
      }}>
        <div><strong>Eclipse Shortcuts:</strong></div>
        <div>Ctrl: Add segment | Shift: Remove segment</div>
        <div>Del: Erase all | Ctrl+C/V: Copy/Paste</div>
        <div>Right-click: Close contour</div>
      </div>
    </>
  );
}