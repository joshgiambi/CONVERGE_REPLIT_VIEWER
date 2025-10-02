/**
 * PrimaryViewport Component
 * 
 * Core DICOM image viewer with canvas rendering, zoom/pan, and window/level.
 * This component is fusion-agnostic and RT-agnostic - it only handles basic CT viewing.
 * 
 * Agent 1: Viewer Core
 * Created: Hour 2-6
 */

import { useRef, useEffect, useState, useCallback, forwardRef, useImperativeHandle, createContext, useContext, useMemo } from 'react';
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
  
  // Calculate scale to fit canvas with zoom
  const baseScale = Math.min(canvas.width / width, canvas.height / height);
  const totalScale = baseScale * zoom;
  const scaledWidth = width * totalScale;
  const scaledHeight = height * totalScale;
  
  // Center image with pan offset
  const x = (canvas.width - scaledWidth) / 2 + panX;
  const y = (canvas.height - scaledHeight) / 2 + panY;

  // Draw to temporary canvas for scaling
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = width;
  tempCanvas.height = height;
  const tempCtx = tempCanvas.getContext('2d');
  if (!tempCtx) return;
  
  tempCtx.putImageData(imageData, 0, 0);
  
  // Clear main canvas
  ctx.fillStyle = 'black';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  // Draw scaled image
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(tempCanvas, x, y, scaledWidth, scaledHeight);
}

/**
 * Parse DICOM image position
 * EXTRACTED FROM: working-viewer.tsx (parseImagePosition function)
 */
function parseImagePosition(image: DICOMImage): [number, number, number] | null {
  if (!image) return null;
  
  // Try direct imagePositionPatient
  const direct = image.imagePositionPatient;
  if (direct && Array.isArray(direct) && direct.length >= 3) {
    const coords = direct.map(Number) as [number, number, number];
    if (coords.every(v => Number.isFinite(v))) return coords;
  }
  
  // Try metadata
  const metaArray = (image.metadata as any)?.imagePositionPatient;
  if (metaArray && Array.isArray(metaArray) && metaArray.length >= 3) {
    const coords = metaArray.map(Number) as [number, number, number];
    if (coords.every(v => Number.isFinite(v))) return coords;
  }
  
  return null;
}

// ============================================================================
// PrimaryViewport Component
// ============================================================================

type ViewportContextValue = {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  images: DICOMImage[];
  currentImage: DICOMImage | null;
  currentIndex: number;
  windowLevel: WindowLevel;
  zoom: number;
  panX: number;
  panY: number;
  imageMetadata: ImageMetadata | null;
};

const ViewportContext = createContext<ViewportContextValue | null>(null);

export function useViewport() {
  const ctx = useContext(ViewportContext);
  if (!ctx) throw new Error('useViewport must be used within PrimaryViewport');
  return ctx;
}

export function useOptionalViewport() {
  return useContext(ViewportContext);
}

export const PrimaryViewport = forwardRef<any, PrimaryViewportProps>(function PrimaryViewport(props, ref) {
  const {
    seriesId,
    studyId,
    orientation = 'axial',
    windowLevel: externalWindowLevel,
    onWindowLevelChange,
    onSliceChange,
    onImageMetadataChange,
    autoZoomLevel,
    autoLocalizeTarget,
    imageCache,
    children,
  } = props;

  // Canvas ref
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // Image state
  const [images, setImages] = useState<DICOMImage[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Viewport state
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [windowLevel, setWindowLevel] = useState<WindowLevel>(
    externalWindowLevel || { window: 350, level: 40 }
  );
  
  // Image metadata
  const [imageMetadata, setImageMetadata] = useState<ImageMetadata | null>(null);
  
  // Mouse interaction state
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [lastPanX, setLastPanX] = useState(0);
  const [lastPanY, setLastPanY] = useState(0);
  
  // Cache refs
  const imageCacheRef = useRef<Map<string, any>>(new Map());

  // ============================================================================
  // Image Loading
  // ============================================================================

  /**
   * Load images for the series
   * TODO: This will be replaced by Agent 4's useDICOMImages hook at hour 18
   */
  const loadImages = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`/api/series/${seriesId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch series');
      }
      
      const seriesData = await response.json();
      const loadedImages: DICOMImage[] = seriesData.images || [];
      
      if (loadedImages.length === 0) {
        throw new Error('No images in series');
      }
      
      setImages(loadedImages);
      setCurrentIndex(0);
      
      // Extract metadata from first image
      if (loadedImages[0] && onImageMetadataChange) {
        const meta: ImageMetadata = {
          columns: loadedImages[0].columns,
          rows: loadedImages[0].rows,
          pixelSpacing: (loadedImages[0].metadata as any)?.pixelSpacing || [1, 1],
          sliceThickness: (loadedImages[0].metadata as any)?.sliceThickness || 1,
          imageOrientation: (loadedImages[0].metadata as any)?.imageOrientation || [],
          imagePositionPatient: parseImagePosition(loadedImages[0]) || [0, 0, 0],
          rescaleSlope: loadedImages[0].rescaleSlope || 1,
          rescaleIntercept: loadedImages[0].rescaleIntercept || 0,
          windowCenter: loadedImages[0].windowCenter || 40,
          windowWidth: loadedImages[0].windowWidth || 350,
          bitsAllocated: loadedImages[0].bitsAllocated || 16,
          bitsStored: loadedImages[0].bitsStored || 16,
          pixelRepresentation: loadedImages[0].pixelRepresentation || 1,
          photometricInterpretation: loadedImages[0].photometricInterpretation || 'MONOCHROME2',
          frameOfReferenceUID: (loadedImages[0].metadata as any)?.frameOfReferenceUID || null,
          sopInstanceUID: loadedImages[0].sopInstanceUID,
          instanceNumber: loadedImages[0].instanceNumber,
        };
        setImageMetadata(meta);
        onImageMetadataChange(meta);
      }
    } catch (err) {
      console.error('Error loading images:', err);
      setError(err instanceof Error ? err.message : 'Failed to load images');
    } finally {
      setIsLoading(false);
    }
  }, [seriesId, onImageMetadataChange]);

  // Load images when series changes
  useEffect(() => {
    loadImages();
  }, [loadImages]);

  // ============================================================================
  // Image Rendering
  // ============================================================================

  /**
   * Fetch and parse DICOM pixel data
   * TODO: This will use Agent 4's DICOM worker at hour 18
   */
  const fetchAndParseImage = useCallback(async (sopInstanceUID: string) => {
    // Check cache first
    const cached = imageCacheRef.current.get(sopInstanceUID);
    if (cached) return cached;
    
    try {
      const response = await fetch(`/api/dicom/pixel-data/${sopInstanceUID}`);
      if (!response.ok) throw new Error('Failed to fetch pixel data');
      
      const buffer = await response.arrayBuffer();
      const currentImage = images.find(img => img.sopInstanceUID === sopInstanceUID);
      
      const imageData = {
        data: new Int16Array(buffer),
        width: currentImage?.columns || 512,
        height: currentImage?.rows || 512,
      };
      
      // Cache it
      imageCacheRef.current.set(sopInstanceUID, imageData);
      return imageData;
    } catch (err) {
      console.error('Error fetching pixel data:', err);
      return null;
    }
  }, [images]);

  /**
   * Display current image on canvas
   */
  const displayCurrentImage = useCallback(async () => {
    if (!canvasRef.current || images.length === 0) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    try {
      const safeIndex = Math.max(0, Math.min(currentIndex, images.length - 1));
      const currentImage = images[safeIndex];
      
      if (!currentImage) {
        console.error('No image available');
        return;
      }
      
      // Fetch pixel data
      const imageData = await fetchAndParseImage(currentImage.sopInstanceUID);
      if (!imageData) {
        throw new Error('Failed to load pixel data');
      }
      
      // Set canvas size
      canvas.width = 1024;
      canvas.height = 1024;
      
      // Render image with window/level, zoom, pan
      render16BitImage(
        ctx,
        imageData.data,
        imageData.width,
        imageData.height,
        windowLevel.window,
        windowLevel.level,
        currentImage.rescaleSlope || 1,
        currentImage.rescaleIntercept || 0,
        zoom,
        panX,
        panY,
      );
    } catch (err) {
      console.error('Error displaying image:', err);
      ctx.fillStyle = 'black';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = 'red';
      ctx.font = '16px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('Error loading DICOM', canvas.width / 2, canvas.height / 2);
    }
  }, [images, currentIndex, windowLevel, zoom, panX, panY, fetchAndParseImage]);

  // Trigger render when dependencies change
  useEffect(() => {
    displayCurrentImage();
  }, [displayCurrentImage]);

  // ============================================================================
  // Mouse & Keyboard Interactions
  // EXTRACTED FROM: working-viewer.tsx (handleCanvasMouseDown, handleCanvasMouseMove, etc.)
  // ============================================================================

  /**
   * Handle mouse down - initiate pan or window/level adjustment
   */
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    e.stopPropagation();

    if (e.button === 0) {
      // Left click - pan mode
      setIsDragging(true);
      setDragStart({ x: e.clientX, y: e.clientY });
      setLastPanX(panX);
      setLastPanY(panY);
    } else if (e.button === 2) {
      // Right click - window/level adjustment
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
  }, [panX, panY, windowLevel, onWindowLevelChange]);

  /**
   * Handle mouse move - update pan during drag
   */
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isDragging) {
      const deltaX = e.clientX - dragStart.x;
      const deltaY = e.clientY - dragStart.y;
      setPanX(lastPanX + deltaX);
      setPanY(lastPanY + deltaY);
    }
  }, [isDragging, dragStart, lastPanX, lastPanY]);

  /**
   * Handle mouse up - end pan drag
   */
  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  /**
   * Handle mouse wheel - zoom with Ctrl/Cmd, slice navigation without
   */
  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    e.stopPropagation();

    if (e.ctrlKey || e.metaKey) {
      // Ctrl/Cmd + scroll for zoom
      const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
      setZoom((prev) => Math.max(0.1, Math.min(10, prev * zoomFactor)));
    } else {
      // Regular scroll for slice navigation
      if (e.deltaY > 0) {
        setCurrentIndex(i => Math.min(i + 1, images.length - 1));
      } else {
        setCurrentIndex(i => Math.max(i - 1, 0));
      }
    }
  }, [images.length]);

  /**
   * Handle context menu - prevent right click menu
   */
  const handleContextMenu = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
  }, []);

  /**
   * Keyboard shortcuts for slice navigation
   */
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        setCurrentIndex(i => Math.max(i - 1, 0));
      }
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        setCurrentIndex(i => Math.min(i + 1, images.length - 1));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [images.length]);

  // ============================================================================
  // Public API (exposed via ref)
  // ============================================================================

  useImperativeHandle(ref, () => ({
    zoomIn: () => setZoom(z => Math.min(z * 1.2, 10)),
    zoomOut: () => setZoom(z => Math.max(z / 1.2, 0.1)),
    resetZoom: () => {
      setZoom(1);
      setPanX(0);
      setPanY(0);
    },
    nextSlice: () => setCurrentIndex(i => Math.min(i + 1, images.length - 1)),
    previousSlice: () => setCurrentIndex(i => Math.max(i - 1, 0)),
    goToSlice: (index: number) => setCurrentIndex(Math.max(0, Math.min(index, images.length - 1))),
    getCurrentIndex: () => currentIndex,
    getImageCount: () => images.length,
  }));

  // Notify parent of slice changes
  useEffect(() => {
    if (onSliceChange) {
      onSliceChange(currentIndex);
    }
  }, [currentIndex, onSliceChange]);

  // ============================================================================
  // Render
  // ============================================================================

  if (isLoading) {
    return (
      <div className="flex items-center justify-center w-full h-full bg-black">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
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
          <p className="text-gray-400">{error}</p>
        </div>
      </div>
    );
  }

  const contextValue = useMemo<ViewportContextValue>(() => ({
    canvasRef,
    images,
    currentImage: images[currentIndex] ?? null,
    currentIndex,
    windowLevel,
    zoom,
    panX,
    panY,
    imageMetadata,
  }), [canvasRef, images, currentIndex, windowLevel, zoom, panX, panY, imageMetadata]);

  return (
    <ViewportContext.Provider value={contextValue}>
      <div className="relative w-full h-full bg-black">
        <canvas
          ref={canvasRef}
          className="w-full h-full cursor-move"
          style={{ imageRendering: 'pixelated' }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
          onContextMenu={handleContextMenu}
        />
        
        {/* Slice info overlay */}
        <div className="absolute top-4 left-4 text-white text-sm font-mono bg-black/50 px-2 py-1 rounded">
          Slice {currentIndex + 1} / {images.length}
        </div>
        
        {/* Window/Level info */}
        <div className="absolute top-4 right-4 text-white text-sm font-mono bg-black/50 px-2 py-1 rounded">
          W: {windowLevel.window} | L: {windowLevel.level}
        </div>
        
        {/* Zoom info */}
        <div className="absolute bottom-4 right-4 text-white text-sm font-mono bg-black/50 px-2 py-1 rounded">
          Zoom: {(zoom * 100).toFixed(0)}%
        </div>
        
        {/* Children (overlays will be added here by Agents 2 & 3) */}
        {children}
      </div>
    </ViewportContext.Provider>
  );
});

PrimaryViewport.displayName = 'PrimaryViewport';

