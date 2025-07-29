/**
 * Main viewport component - primary canvas element with rendering
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
    if (!canvasRef.current || !currentImage) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    
    if (!ctx) return;

    // Clear canvas
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    try {
      // Render main DICOM image
      render16BitImage(
        canvas,
        currentImage,
        windowLevel,
        viewportState
      );

      // Render RT structures if available
      if (rtStructures?.structures) {
        renderRTStructures(
          canvas,
          rtStructures,
          currentSlicePosition,
          structureVisibility,
          selectedForEdit,
          contourSettings,
          viewportState
        );
      }

      // Render fusion overlay if available
      if (secondaryImages.length > 0 && fusionOpacity > 0 && registrationMatrix) {
        renderFusionOverlayOnCanvas(
          canvas,
          currentImage,
          secondaryImages,
          registrationMatrix,
          fusionOpacity,
          secondaryWindowLevel || windowLevel,
          viewportState
        );
      }

    } catch (error) {
      console.error('Error rendering frame:', error);
    }
  };

  // Render when dependencies change
  useEffect(() => {
    // Use requestAnimationFrame for smooth rendering
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    
    animationFrameRef.current = requestAnimationFrame(renderFrame);
    
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [currentImage, windowLevel, viewportState, rtStructures, structureVisibility, 
      selectedForEdit, contourSettings, currentSlicePosition, fusionOpacity, 
      secondaryImages, registrationMatrix, secondaryWindowLevel]);

  return (
    <canvas
      ref={canvasRef}
      width={1280}
      height={1280}
      className={`max-w-full max-h-full ${className}`}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onWheel={onWheel}
      onContextMenu={onContextMenu}
      tabIndex={keyboardNavigationDisabled ? -1 : 0}
      style={{
        imageRendering: 'auto',
        cursor: 'crosshair'
      }}
    />
  );
});

MainViewport.displayName = 'MainViewport';