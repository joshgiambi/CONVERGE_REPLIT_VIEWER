/**
 * PrimaryViewport Component
 * 
 * Core DICOM image viewer with canvas rendering, zoom/pan, and window/level.
 * This component is fusion-agnostic and RT-agnostic - it only handles basic CT viewing.
 * 
 * Agent 1: Viewer Core
 * Created: Hour 2-6
 * REVISED: Based on Agent 1 feedback (rounds 1 & 2)
 */

import { useRef, useEffect, useState, useCallback, forwardRef, useImperativeHandle, createContext, useContext, useMemo } from 'react';
import { useDICOMImages } from '@/hooks/useDICOMImages';
import { useViewportInteractions } from '@/hooks/useViewportInteractions';
import { DICOMMetadataService } from '@/services/DICOMMetadataService';
import type {
  PrimaryViewportProps,
  DICOMImage,
  WindowLevel,
  ImageMetadata,
  ViewportState,
} from '@/types/viewer';

// ============================================================================
// EXTRACTED FROM working-viewer.tsx - Core rendering functions
// ============================================================================

/**
 * Render 16-bit DICOM image data to canvas with window/level
 * EXTRACTED FROM: working-viewer.tsx (render16BitImage function)
 * 
 * NOTE: This function works in CSS pixel space (not physical pixels)
 * The canvas context should be scaled by devicePixelRatio before calling this
 */
function render16BitImage(
  ctx: CanvasRenderingContext2D,
  pixelData: ArrayBuffer | Uint8Array | Int16Array,
  width: number,
  height: number,
  windowWidth: number = 350,
  windowCenter: number = 40,
  rescaleSlope: number = 1,
  rescaleIntercept: number = 0,
  zoom: number = 1,
  panX: number = 0,
  panY: number = 0,
): void {
  const canvas = ctx.canvas;
  
  // Convert to Int16Array if needed
  let data16: Int16Array;
  if (pixelData instanceof Int16Array) {
    data16 = pixelData;
  } else if (pixelData instanceof Uint8Array) {
    data16 = new Int16Array(pixelData.buffer);
  } else {
    data16 = new Int16Array(pixelData);
  }

  // Calculate window/level parameters
  const windowMin = windowCenter - windowWidth / 2;
  const windowMax = windowCenter + windowWidth / 2;
  const windowRange = windowMax - windowMin;

  // Create 8-bit display buffer
  const displayData = new Uint8ClampedArray(width * height * 4);

  // Apply window/level transformation
  for (let i = 0; i < width * height; i++) {
    const pixelValue = data16[i] * rescaleSlope + rescaleIntercept;
    let displayValue = 0;

    if (pixelValue <= windowMin) {
      displayValue = 0;
    } else if (pixelValue >= windowMax) {
      displayValue = 255;
    } else {
      displayValue = Math.round(((pixelValue - windowMin) / windowRange) * 255);
    }

    const idx = i * 4;
    displayData[idx] = displayValue;     // R
    displayData[idx + 1] = displayValue; // G
    displayData[idx + 2] = displayValue; // B
    displayData[idx + 3] = 255;          // A
  }

  // Create ImageData and render with zoom/pan
  const imageData = new ImageData(displayData, width, height);
  
  // FIXED: Work in CSS pixel space (canvas already scaled by DPR)
  // Get CSS dimensions (not physical dimensions)
  const cssWidth = canvas.width / (window.devicePixelRatio || 1);
  const cssHeight = canvas.height / (window.devicePixelRatio || 1);
  
  // Calculate scale to fit canvas with zoom
  const baseScale = Math.min(cssWidth / width, cssHeight / height);
  const totalScale = baseScale * zoom;
  const scaledWidth = width * totalScale;
  const scaledHeight = height * totalScale;
  
  // Center image with pan offset
  const x = (cssWidth - scaledWidth) / 2 + panX;
  const y = (cssHeight - scaledHeight) / 2 + panY;

  // Draw to temporary canvas for scaling
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = width;
  tempCanvas.height = height;
  const tempCtx = tempCanvas.getContext('2d');
  if (!tempCtx) return;
  
  tempCtx.putImageData(imageData, 0, 0);

  // Clear and draw scaled image (in CSS pixel space)
  ctx.fillStyle = 'black';
  ctx.fillRect(0, 0, cssWidth, cssHeight);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tempCanvas, x, y, scaledWidth, scaledHeight);
}

/**
 * Parse DICOM image position patient tag
 * EXTRACTED FROM: working-viewer.tsx (parseImagePosition function)
 */
function parseImagePosition(image: DICOMImage): [number, number, number] | null {
  if (!image) return null;
  
  if (image.imagePositionPatient && Array.isArray(image.imagePositionPatient)) {
    const coords = image.imagePositionPatient.map(Number) as [number, number, number];
    if (coords.every(v => Number.isFinite(v))) {
      return coords;
    }
  }
  
  if ((image.metadata as any)?.imagePositionPatient) {
    const metaArray = (image.metadata as any).imagePositionPatient;
    if (Array.isArray(metaArray) && metaArray.length >= 3) {
      const coords = metaArray.map(Number) as [number, number, number];
      if (coords.every(v => Number.isFinite(v))) {
        return coords;
      }
    }
  }
  
  return null;
}

// ============================================================================
// Viewport Context (for Agent 2 & 3 overlay integration)
// ============================================================================

interface ViewportContextValue {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  overlayCanvasRef: React.RefObject<HTMLCanvasElement>;
  currentImage: DICOMImage | null;
  currentIndex: number;
  images: DICOMImage[];
  zoom: number;
  panX: number;
  panY: number;
  windowLevel: WindowLevel;
  // FIXED: Added metadata for Agent 2/3
  imageMetadata: ImageMetadata | null;
}

const ViewportContext = createContext<ViewportContextValue | null>(null);

export function useViewport() {
  const ctx = useContext(ViewportContext);
  if (!ctx) throw new Error('useViewport must be used within PrimaryViewport');
  return ctx;
}

// ============================================================================
// PrimaryViewport Component
// ============================================================================

export const PrimaryViewport = forwardRef<any, PrimaryViewportProps>(
  function PrimaryViewport(
    {
      seriesId,
      studyId,
      windowLevel: initialWindowLevel,
      autoZoomLevel = 1,
      onWindowLevelChange,
      onSliceChange,
      onImageMetadataChange,
      imageCache,
      children,
    },
    ref,
  ) {
    // Canvas refs
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const overlayCanvasRef = useRef<HTMLCanvasElement>(null);

    // Viewport state
    const [windowLevel, setWindowLevel] = useState<WindowLevel>(
      initialWindowLevel || { window: 350, level: 40 }
    );

    useEffect(() => {
      if (!initialWindowLevel) return;
      setWindowLevel((prev) => {
        if (
          Math.abs(prev.window - initialWindowLevel.window) < 0.01 &&
          Math.abs(prev.level - initialWindowLevel.level) < 0.01
        ) {
          return prev;
        }
        return { window: initialWindowLevel.window, level: initialWindowLevel.level };
      });
    }, [initialWindowLevel?.window, initialWindowLevel?.level]);
    const [zoom, setZoom] = useState(autoZoomLevel);
    const [panX, setPanX] = useState(0);
    const [panY, setPanY] = useState(0);

    // FIXED: Use Agent 4's useDICOMImages hook instead of manual loading
    const {
      images,
      isLoading,
      error,
      currentImage,
      currentIndex,  // FIXED: Use hook's currentIndex as single source of truth
      setCurrentIndex,
      metadata,
    } = useDICOMImages({
      seriesId,
      autoLoad: true,
      cache: imageCache,
      onLoadComplete: (loadedImages) => {
        if (loadedImages.length > 0 && onImageMetadataChange && metadata) {
          onImageMetadataChange(metadata);
        }
      },
      onError: (err) => {
        console.error('Error loading DICOM images:', err);
      },
    });

    // FIXED: Use useViewportInteractions hook instead of duplicate handlers
    const interactions = useViewportInteractions({
      imageCount: images.length,
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
    });

    // Expose API to parent via ref
    useImperativeHandle(ref, () => ({
      ...interactions.controls,
      getCurrentImage: () => currentImage,
      getMetadata: () => metadata,
      getImages: () => images,
    }));

    // ============================================================================
    // Image Rendering (using pixel data from useDICOMImages)
    // ============================================================================

    const displayCurrentImage = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // FIXED: Work in CSS pixel space
      const cssWidth = canvas.width / (window.devicePixelRatio || 1);
      const cssHeight = canvas.height / (window.devicePixelRatio || 1);

      // Clear canvas
      ctx.fillStyle = 'black';
      ctx.fillRect(0, 0, cssWidth, cssHeight);

      // FIXED: Use hook's currentImage (single source of truth)
      if (!currentImage) return;

      try {
        // FIXED: Use pixel data already loaded by useDICOMImages
        const pixelData = (currentImage as any).pixelData;
        if (!pixelData) {
          throw new Error('No pixel data available');
        }

        // Render image with window/level, zoom, pan (in CSS pixel space)
        render16BitImage(
          ctx,
          pixelData,
          currentImage.columns,
          currentImage.rows,
          windowLevel.window,
          windowLevel.level,
          currentImage.rescaleSlope || 1,
          currentImage.rescaleIntercept || 0,
          zoom,
          panX,
          panY,
        );

        // Notify parent of slice change
        if (onSliceChange) {
          onSliceChange(currentIndex);
        }
      } catch (err) {
        console.error('Error displaying image:', err);
        ctx.fillStyle = 'red';
        ctx.font = '16px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('Error rendering DICOM', cssWidth / 2, cssHeight / 2);
      }
    }, [currentImage, currentIndex, windowLevel, zoom, panX, panY, onSliceChange]);

    // Trigger render when dependencies change
    useEffect(() => {
      displayCurrentImage();
    }, [displayCurrentImage]);

    // Update metadata when current image changes
    useEffect(() => {
      if (currentImage && onImageMetadataChange) {
        const meta = DICOMMetadataService.extractMetadata(currentImage);
        onImageMetadataChange(meta);
      }
    }, [currentImage, onImageMetadataChange]);

    // FIXED: Implement proper canvas sizing with device pixel ratio
    // FIXED: Include displayCurrentImage in deps so resize observer uses latest closure
    useEffect(() => {
      const container = containerRef.current;
      const canvas = canvasRef.current;
      const overlayCanvas = overlayCanvasRef.current;
      if (!container || !canvas || !overlayCanvas) return;

      const updateCanvasSize = () => {
        const rect = container.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        
        // Set display size (CSS pixels)
        canvas.style.width = `${rect.width}px`;
        canvas.style.height = `${rect.height}px`;
        overlayCanvas.style.width = `${rect.width}px`;
        overlayCanvas.style.height = `${rect.height}px`;
        
        // Set actual size (physical pixels = CSS pixels * DPR)
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        overlayCanvas.width = rect.width * dpr;
        overlayCanvas.height = rect.height * dpr;
        
        // FIXED: Scale context by DPR so we can work in CSS pixels
        const ctx = canvas.getContext('2d');
        const overlayCtx = overlayCanvas.getContext('2d');
        if (ctx) {
          ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset transform
          ctx.scale(dpr, dpr);
        }
        if (overlayCtx) {
          overlayCtx.setTransform(1, 0, 0, 1, 0, 0); // Reset transform
          overlayCtx.scale(dpr, dpr);
        }
        
        // FIXED: Trigger re-render with latest closure
        displayCurrentImage();
      };

      // Initial size
      updateCanvasSize();

      // Watch for resize
      const resizeObserver = new ResizeObserver(updateCanvasSize);
      resizeObserver.observe(container);

      return () => resizeObserver.disconnect();
    }, [displayCurrentImage]); // FIXED: Include displayCurrentImage in deps

    // Reload helper (refetch series images)
    const handleReload = useCallback(() => {
      setCurrentIndex(0);
      window.location.reload();
    }, [setCurrentIndex]);

    // FIXED: Provide viewport context with imageMetadata for Agent 2 & 3 overlays
    const viewportContext = useMemo<ViewportContextValue>(() => ({
      canvasRef,
      overlayCanvasRef,
      currentImage: currentImage || null,
      currentIndex,
      images,
      zoom,
      panX,
      panY,
      windowLevel,
      imageMetadata: metadata,  // FIXED: Include metadata
    }), [canvasRef, overlayCanvasRef, currentImage, currentIndex, images, zoom, panX, panY, windowLevel, metadata]);

    // ============================================================================
    // Render
    // ============================================================================

    if (isLoading) {
      return (
        <div className="flex items-center justify-center w-full h-full bg-black">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
            <p className="text-white">Loading DICOM images...</p>
          </div>
        </div>
      );
    }

    if (error) {
      return (
        <div className="flex items-center justify-center w-full h-full bg-black">
          <div className="text-center">
            <p className="text-red-500 text-lg mb-2">Error</p>
            <p className="text-gray-400">{error.message || String(error)}</p>
            <button
              onClick={handleReload}
              className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Retry
            </button>
          </div>
        </div>
      );
    }

    return (
      <ViewportContext.Provider value={viewportContext}>
        <div ref={containerRef} className="relative w-full h-full bg-black">
          {/* Main CT canvas */}
          <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full"
            style={{ imageRendering: 'pixelated' }}
            {...interactions.handlers}
            onContextMenu={(e) => e.preventDefault()}
          />
          
          {/* FIXED: Dedicated overlay canvas for fusion/RT layers (Agent 2 & 3) */}
          <canvas
            ref={overlayCanvasRef}
            className="absolute inset-0 w-full h-full pointer-events-none"
            style={{ imageRendering: 'pixelated' }}
          />
          
          {/* Slice info overlay */}
          <div className="absolute top-4 left-4 text-white text-sm font-mono bg-black/50 px-2 py-1 rounded pointer-events-none">
            Slice {currentIndex + 1} / {images.length}
          </div>
          
          {/* Window/Level info */}
          <div className="absolute top-4 right-4 text-white text-sm font-mono bg-black/50 px-2 py-1 rounded pointer-events-none">
            W: {windowLevel.window.toFixed(0)} | L: {windowLevel.level.toFixed(0)}
          </div>
          
          {/* Zoom info */}
          <div className="absolute bottom-4 right-4 text-white text-sm font-mono bg-black/50 px-2 py-1 rounded pointer-events-none">
            Zoom: {(zoom * 100).toFixed(0)}%
          </div>
          
          {/* Children (for Agent 2 & 3 overlay components) */}
          {children}
        </div>
      </ViewportContext.Provider>
    );
  }
);

PrimaryViewport.displayName = 'PrimaryViewport';

export default PrimaryViewport;
