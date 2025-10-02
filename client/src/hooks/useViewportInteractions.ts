/**
 * useViewportInteractions Hook
 * 
 * Manages mouse and keyboard interactions for viewport
 * Extracted from PrimaryViewport component
 * 
 * Agent 1: Viewer Core
 * Created: Hour 10-14
 */

import { useState, useCallback, useEffect } from 'react';
import type { WindowLevel, UseViewportInteractionsResult } from '@/types/viewer';

interface UseViewportInteractionsProps {
  imageCount: number;
  currentIndex: number;
  setCurrentIndex: (index: number | ((prev: number) => number)) => void;
  zoom: number;
  setZoom: (zoom: number | ((prev: number) => number)) => void;
  panX: number;
  setPanX: (x: number | ((prev: number) => number)) => void;
  panY: number;
  setPanY: (y: number | ((prev: number) => number)) => void;
  windowLevel: WindowLevel;
  setWindowLevel: (wl: WindowLevel) => void;
  onWindowLevelChange?: (wl: WindowLevel) => void;
}

export function useViewportInteractions({
  imageCount,
  currentIndex,
  setCurrentIndex,
  zoom,
  setZoom,
  panX,
  setPanX,
  panY,
  setPanY,
  windowLevel,
  setWindowLevel,
  onWindowLevelChange,
}: UseViewportInteractionsProps): UseViewportInteractionsResult {
  // Mouse state
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [lastPanX, setLastPanX] = useState(0);
  const [lastPanY, setLastPanY] = useState(0);

  // Mouse down handler
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    e.stopPropagation();

    if (e.button === 0) {
      // Left click - pan
      setIsDragging(true);
      setDragStart({ x: e.clientX, y: e.clientY });
      setLastPanX(panX);
      setLastPanY(panY);
    } else if (e.button === 2) {
      // Right click - window/level
      const startX = e.clientX;
      const startY = e.clientY;
      const startWindow = windowLevel.window;
      const startLevel = windowLevel.level;

      const handleWindowLevelDrag = (moveEvent: MouseEvent) => {
        moveEvent.preventDefault();
        const deltaX = moveEvent.clientX - startX;
        const deltaY = moveEvent.clientY - startY;

        const newWindow = Math.max(1, startWindow + deltaX * 2);
        const newLevel = startLevel - deltaY * 1.5;

        const newWindowLevel = { window: newWindow, level: newLevel };
        setWindowLevel(newWindowLevel);
        if (onWindowLevelChange) {
          onWindowLevelChange(newWindowLevel);
        }
      };

      const handleWindowLevelEnd = (endEvent: MouseEvent) => {
        endEvent.preventDefault();
        document.removeEventListener('mousemove', handleWindowLevelDrag);
        document.removeEventListener('mouseup', handleWindowLevelEnd);
      };

      document.addEventListener('mousemove', handleWindowLevelDrag);
      document.addEventListener('mouseup', handleWindowLevelEnd);
    }
  }, [panX, panY, windowLevel, setWindowLevel, onWindowLevelChange]);

  // Mouse move handler
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isDragging) {
      const deltaX = e.clientX - dragStart.x;
      const deltaY = e.clientY - dragStart.y;
      setPanX(lastPanX + deltaX);
      setPanY(lastPanY + deltaY);
    }
  }, [isDragging, dragStart, lastPanX, lastPanY, setPanX, setPanY]);

  // Mouse up handler
  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Mouse wheel handler
  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    e.stopPropagation();

    if (e.ctrlKey || e.metaKey) {
      // Zoom
      const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
      setZoom((prev) => Math.max(0.1, Math.min(10, prev * zoomFactor)));
    } else {
      // Slice navigation
      if (e.deltaY > 0) {
        setCurrentIndex(i => Math.min(i + 1, imageCount - 1));
      } else {
        setCurrentIndex(i => Math.max(i - 1, 0));
      }
    }
  }, [imageCount, setZoom, setCurrentIndex]);

  // Context menu handler
  const handleContextMenu = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
  }, []);

  // Keyboard handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        setCurrentIndex(i => Math.max(i - 1, 0));
      }
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        setCurrentIndex(i => Math.min(i + 1, imageCount - 1));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [imageCount, setCurrentIndex]);

  // Controls API
  const controls = {
    zoomIn: () => setZoom(z => Math.min(z * 1.2, 10)),
    zoomOut: () => setZoom(z => Math.max(z / 1.2, 0.1)),
    resetZoom: () => {
      setZoom(1);
      setPanX(0);
      setPanY(0);
    },
    pan: (dx: number, dy: number) => {
      setPanX(x => x + dx);
      setPanY(y => y + dy);
    },
    rotate: (degrees: number) => {
      // TODO: Implement rotation
      console.log('Rotate', degrees);
    },
    flip: (horizontal: boolean) => {
      // TODO: Implement flip
      console.log('Flip', horizontal);
    },
    setWindowLevel: (wl: WindowLevel) => {
      setWindowLevel(wl);
      if (onWindowLevelChange) onWindowLevelChange(wl);
    },
    setTool: (tool: any) => {
      console.log('Set tool', tool);
    },
    nextSlice: () => setCurrentIndex(i => Math.min(i + 1, imageCount - 1)),
    previousSlice: () => setCurrentIndex(i => Math.max(i - 1, 0)),
    goToSlice: (index: number) => setCurrentIndex(Math.max(0, Math.min(index, imageCount - 1))),
  };

  return {
    handlers: {
      onMouseDown: handleMouseDown,
      onMouseMove: handleMouseMove,
      onMouseUp: handleMouseUp,
      onWheel: handleWheel,
    },
    state: {
      isMouseDown: isDragging,
      lastMouseX: dragStart.x,
      lastMouseY: dragStart.y,
      dragStartX: dragStart.x,
      dragStartY: dragStart.y,
      activeTool: 'pan',
    },
    viewportState: {
      zoom,
      panX,
      panY,
      rotation: 0,
      flipH: false,
      flipV: false,
      windowLevel,
      currentIndex,
      crosshairPos: { x: 0, y: 0 },
      crosshairMode: false,
      isPanMode: true,
      activeTool: 'pan',
    },
    controls,
  };
}

