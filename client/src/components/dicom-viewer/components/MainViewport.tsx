/**
 * Main viewport component - primary canvas element with tool overlays
 * Extracted from monolithic WorkingViewer component
 */

import { useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import { render16BitImage, renderRTStructures, renderFusionOverlayOnCanvas } from '../services/renderingService';

export interface MainViewportRef {
  canvas: HTMLCanvasElement | null;
  getCanvas: () => HTMLCanvasElement | null;
}

interface MainViewportProps {
  currentImage: any;
  rtStructures: any;
  secondaryImages?: any[];
  registrationMatrix?: number[] | null;
  fusionOpacity?: number;
  windowLevel: { window: number; level: number };
  secondaryWindowLevel?: { window: number; level: number };
  viewportState: {
    zoom: number;
    panX: number;
    panY: number;
  };
  structureVisibility: Map<number, boolean>;
  selectedForEdit: number | null;
  contourSettings: { width: number; opacity: number };
  currentSlicePosition: number;
  onMouseDown?: (event: React.MouseEvent) => void;
  onMouseMove?: (event: React.MouseEvent) => void;
  onMouseUp?: (event: React.MouseEvent) => void;
  onWheel?: (event: React.WheelEvent) => void;
  onContextMenu?: (event: React.MouseEvent) => void;
  keyboardNavigationDisabled?: boolean;
  className?: string;
}

/**
 * Main viewport canvas component with integrated rendering
 */
export const MainViewport = forwardRef<MainViewportRef, MainViewportProps>(({
  currentImage,
  rtStructures,
  secondaryImages = [],
  registrationMatrix = null,
  fusionOpacity = 0,
  windowLevel,
  secondaryWindowLevel,
  viewportState,
  structureVisibility,
  selectedForEdit,
  contourSettings,
  currentSlicePosition,
  onMouseDown,
  onMouseMove,
  onMouseUp,
  onWheel,
  onContextMenu,
  keyboardNavigationDisabled = false,
  className = ''
}, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number>();

  // Expose canvas reference to parent
  useImperativeHandle(ref, () => ({
    canvas: canvasRef.current,
    getCanvas: () => canvasRef.current
  }));

  /**
   * Render the current frame
   */
  const renderFrame = () => {
    const canvas = canvasRef.current;
    if (!canvas || !currentImage) return;

    try {
      // Clear canvas
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }

      // Render primary image (CT)
      if (currentImage.parsedPixelData) {
        render16BitImage(
          canvas,
          currentImage.parsedPixelData,
          windowLevel,
          viewportState
        );
      }

      // Render fusion overlay (MRI)
      if (fusionOpacity > 0 && secondaryImages.length > 0) {
        renderFusionOverlayOnCanvas(
          canvas,
          currentImage,
          secondaryImages,
          registrationMatrix,
          fusionOpacity,
          viewportState,
          secondaryWindowLevel
        );
      }

      // Render RT structures
      if (rtStructures && structureVisibility.size > 0) {
        renderRTStructures(
          canvas,
          rtStructures,
          currentSlicePosition,
          structureVisibility,
          selectedForEdit,
          viewportState,
          currentImage,
          contourSettings,
          Date.now() // for animation
        );
      }

    } catch (error) {
      console.error('Error rendering viewport:', error);
    }
  };

  /**
   * Request animation frame for smooth rendering
   */
  const requestRender = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    animationFrameRef.current = requestAnimationFrame(renderFrame);
  };

  // Re-render when dependencies change
  useEffect(() => {
    requestRender();
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [
    currentImage,
    rtStructures,
    secondaryImages,
    fusionOpacity,
    windowLevel,
    secondaryWindowLevel,
    viewportState,
    structureVisibility,
    selectedForEdit,
    contourSettings,
    currentSlicePosition
  ]);

  // Handle context menu
  const handleContextMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    onContextMenu?.(event);
  };

  return (
    <div className={`relative ${className}`}>
      <canvas
        ref={canvasRef}
        width={1280}
        height={1280}
        className="border border-gray-700 rounded-lg cursor-crosshair max-w-full max-h-full"
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onWheel={onWheel}
        onContextMenu={handleContextMenu}
        tabIndex={keyboardNavigationDisabled ? -1 : 0}
        style={{
          outline: 'none',
          userSelect: 'none'
        }}
      />
    </div>
  );
});

MainViewport.displayName = 'MainViewport';