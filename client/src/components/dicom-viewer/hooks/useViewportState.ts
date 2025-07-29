/**
 * Custom hook for managing viewport state (zoom, pan, window/level)
 * Extracts viewport-related state from WorkingViewer
 */

import { useState, useCallback, useRef, useEffect } from 'react';

export interface ViewportState {
  zoom: number;
  panX: number;
  panY: number;
  windowLevel: { window: number; level: number };
  isDragging: boolean;
  isWindowLeveling: boolean;
  isPanMode: boolean;
  isCrosshairMode: boolean;
  crosshairPosition: { x: number; y: number } | null;
}

export interface ViewportActions {
  setZoom: (zoom: number) => void;
  setPan: (panX: number, panY: number) => void;
  setWindowLevel: (windowLevel: { window: number; level: number }) => void;
  handleZoomIn: () => void;
  handleZoomOut: () => void;
  handleResetZoom: () => void;
  handleMouseDown: (event: React.MouseEvent) => void;
  handleMouseMove: (event: React.MouseEvent) => void;
  handleMouseUp: (event: React.MouseEvent) => void;
  handleWheel: (event: React.WheelEvent) => void;
  togglePanMode: () => void;
  toggleCrosshairMode: () => void;
  setCrosshairPosition: (position: { x: number; y: number } | null) => void;
}

interface UseViewportStateProps {
  initialWindowLevel?: { window: number; level: number };
  onWindowLevelChange?: (windowLevel: { window: number; level: number }) => void;
  onZoomChange?: (zoom: number) => void;
  keyboardNavigationDisabled?: boolean;
}

/**
 * Hook for managing viewport state and interactions
 */
export function useViewportState({
  initialWindowLevel = { window: 400, level: 40 },
  onWindowLevelChange,
  onZoomChange,
  keyboardNavigationDisabled = false
}: UseViewportStateProps = {}): ViewportState & ViewportActions {
  
  const [zoom, setZoomState] = useState(1);
  const [panX, setPanXState] = useState(0);
  const [panY, setPanYState] = useState(0);
  const [windowLevel, setWindowLevelState] = useState(initialWindowLevel);
  const [isDragging, setIsDragging] = useState(false);
  const [isWindowLeveling, setIsWindowLeveling] = useState(false);
  const [isPanMode, setIsPanMode] = useState(true);
  const [isCrosshairMode, setIsCrosshairMode] = useState(false);
  const [crosshairPosition, setCrosshairPositionState] = useState<{ x: number; y: number } | null>(null);

  const lastMousePosRef = useRef({ x: 0, y: 0 });
  const initialWindowLevelRef = useRef(initialWindowLevel);

  /**
   * Set zoom with bounds checking
   */
  const setZoom = useCallback((newZoom: number) => {
    const clampedZoom = Math.max(0.1, Math.min(5, newZoom));
    setZoomState(clampedZoom);
    onZoomChange?.(clampedZoom);
  }, [onZoomChange]);

  /**
   * Set pan position
   */
  const setPan = useCallback((newPanX: number, newPanY: number) => {
    setPanXState(newPanX);
    setPanYState(newPanY);
  }, []);

  /**
   * Set window/level with callback
   */
  const setWindowLevel = useCallback((newWindowLevel: { window: number; level: number }) => {
    setWindowLevelState(newWindowLevel);
    onWindowLevelChange?.(newWindowLevel);
  }, [onWindowLevelChange]);

  /**
   * Zoom in by 20%
   */
  const handleZoomIn = useCallback(() => {
    setZoom(zoom * 1.2);
  }, [zoom, setZoom]);

  /**
   * Zoom out by 20%
   */
  const handleZoomOut = useCallback(() => {
    setZoom(zoom / 1.2);
  }, [zoom, setZoom]);

  /**
   * Reset zoom and pan to defaults
   */
  const handleResetZoom = useCallback(() => {
    setZoom(1);
    setPan(0, 0);
  }, [setZoom, setPan]);

  /**
   * Handle mouse down events for dragging
   */
  const handleMouseDown = useCallback((event: React.MouseEvent) => {
    const canvas = event.currentTarget as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    lastMousePosRef.current = { x, y };
    
    if (event.button === 0) { // Left mouse button
      if (isCrosshairMode) {
        setCrosshairPositionState({ x, y });
      } else {
        setIsDragging(true);
      }
    } else if (event.button === 2) { // Right mouse button
      setIsWindowLeveling(true);
      initialWindowLevelRef.current = windowLevel;
    }
  }, [isCrosshairMode, windowLevel]);

  /**
   * Handle mouse move events for dragging and window/leveling
   */
  const handleMouseMove = useCallback((event: React.MouseEvent) => {
    const canvas = event.currentTarget as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    const deltaX = x - lastMousePosRef.current.x;
    const deltaY = y - lastMousePosRef.current.y;

    if (isDragging && isPanMode) {
      // Pan the image
      setPan(panX + deltaX, panY + deltaY);
      lastMousePosRef.current = { x, y };
    } else if (isWindowLeveling) {
      // Adjust window/level
      const windowSensitivity = 4;
      const levelSensitivity = 4;
      
      const newWindow = Math.max(1, initialWindowLevelRef.current.window + (deltaX * windowSensitivity));
      const newLevel = initialWindowLevelRef.current.level + (deltaY * levelSensitivity);
      
      setWindowLevel({ window: newWindow, level: newLevel });
    }
  }, [isDragging, isWindowLeveling, isPanMode, panX, panY, setPan, setWindowLevel]);

  /**
   * Handle mouse up events
   */
  const handleMouseUp = useCallback((event: React.MouseEvent) => {
    setIsDragging(false);
    setIsWindowLeveling(false);
  }, []);

  /**
   * Handle wheel events for zooming
   */
  const handleWheel = useCallback((event: React.WheelEvent) => {
    event.preventDefault();
    
    const zoomFactor = event.deltaY < 0 ? 1.1 : 0.9;
    
    // Get mouse position relative to canvas
    const canvas = event.currentTarget as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;
    
    // Calculate zoom point
    const canvasCenterX = canvas.width / 2;
    const canvasCenterY = canvas.height / 2;
    
    // Zoom towards mouse position
    const offsetX = (mouseX - canvasCenterX - panX) / zoom;
    const offsetY = (mouseY - canvasCenterY - panY) / zoom;
    
    const newZoom = zoom * zoomFactor;
    const newPanX = mouseX - canvasCenterX - (offsetX * newZoom);
    const newPanY = mouseY - canvasCenterY - (offsetY * newZoom);
    
    setZoom(newZoom);
    setPan(newPanX, newPanY);
  }, [zoom, panX, panY, setZoom, setPan]);

  /**
   * Toggle between pan and crosshair modes
   */
  const togglePanMode = useCallback(() => {
    setIsPanMode(!isPanMode);
    if (isPanMode) {
      setIsCrosshairMode(true);
    } else {
      setIsCrosshairMode(false);
    }
  }, [isPanMode]);

  /**
   * Toggle crosshair mode
   */
  const toggleCrosshairMode = useCallback(() => {
    setIsCrosshairMode(!isCrosshairMode);
    if (!isCrosshairMode) {
      setIsPanMode(false);
    }
  }, [isCrosshairMode]);

  /**
   * Set crosshair position
   */
  const setCrosshairPosition = useCallback((position: { x: number; y: number } | null) => {
    setCrosshairPositionState(position);
  }, []);

  // Expose zoom functions globally for toolbar access
  useEffect(() => {
    (window as any).currentViewerZoom = {
      zoomIn: handleZoomIn,
      zoomOut: handleZoomOut,
      resetZoom: handleResetZoom,
    };

    return () => {
      delete (window as any).currentViewerZoom;
    };
  }, [handleZoomIn, handleZoomOut, handleResetZoom]);

  return {
    // State
    zoom,
    panX,
    panY,
    windowLevel,
    isDragging,
    isWindowLeveling,
    isPanMode,
    isCrosshairMode,
    crosshairPosition,
    
    // Actions
    setZoom,
    setPan,
    setWindowLevel,
    handleZoomIn,
    handleZoomOut,
    handleResetZoom,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleWheel,
    togglePanMode,
    toggleCrosshairMode,
    setCrosshairPosition
  };
}