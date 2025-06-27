import { useEffect, useRef, useState, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface WorkingViewerProps {
  seriesId: number;
  studyId?: number;
  windowLevel?: { window: number; level: number };
  onWindowLevelChange?: (windowLevel: { window: number; level: number }) => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onResetZoom?: () => void;
  rtStructures?: any;
  structureVisibility?: Map<number, boolean>;
}

declare global {
  interface Window {
    dicomParser: any;
    workingViewerZoomIn?: () => void;
    workingViewerZoomOut?: () => void;
    workingViewerResetZoom?: () => void;
  }
}

export function WorkingViewer({ seriesId, studyId, windowLevel: externalWindowLevel, onWindowLevelChange, onZoomIn, onZoomOut, onResetZoom, rtStructures: externalRTStructures, structureVisibility: externalStructureVisibility }: WorkingViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [images, setImages] = useState<any[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPreloading, setIsPreloading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState({ loaded: 0, total: 0 });
  
  // Use external RT structures if provided, otherwise load our own
  const rtStructures = externalRTStructures;
  const structureVisibility = externalStructureVisibility || new Map();
  const [showStructures, setShowStructures] = useState(true);
  
  // Convert external window/level format to internal width/center format
  const currentWindowLevel = externalWindowLevel 
    ? { width: externalWindowLevel.window, center: externalWindowLevel.level }
    : { width: 400, center: 40 };

  // Function to update external window/level when internal changes
  const updateWindowLevel = useCallback((newWindowLevel: { width: number; center: number }) => {
    if (onWindowLevelChange) {
      onWindowLevelChange({ window: newWindowLevel.width, level: newWindowLevel.center });
    }
  }, [onWindowLevelChange]);

  const [imageCache, setImageCache] = useState<Map<string, { data: Float32Array, width: number, height: number }>>(new Map());
  
  // Zoom and pan state
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [lastPanX, setLastPanX] = useState(0);
  const [lastPanY, setLastPanY] = useState(0);
  const [imageMetadata, setImageMetadata] = useState<any>(null);

  // OPTIMIZED: Fast metadata extraction without full image download
  const extractQuickMetadata = useCallback(async (sopInstanceUID: string) => {
    try {
      // First try to get just the DICOM header (first 2KB should contain metadata)
      const response = await fetch(`/api/images/${sopInstanceUID}`, {
        headers: { 'Range': 'bytes=0-2048' } // Just get header portion
      });
      
      if (response.status === 206 || response.ok) {
        const arrayBuffer = await response.arrayBuffer();
        const byteArray = new Uint8Array(arrayBuffer);
        const dataSet = window.dicomParser.parseDicom(byteArray);
        
        const sliceLocation = dataSet.floatString('x00201041');
        const imagePosition = dataSet.string('x00200032');
        const instanceNumber = dataSet.intString('x00200013');
        
        let zPosition = null;
        if (imagePosition) {
          const positions = imagePosition.split('\\').map((p: string) => parseFloat(p));
          zPosition = positions[2];
        }
        
        return {
          parsedSliceLocation: sliceLocation ? parseFloat(sliceLocation) : null,
          parsedZPosition: zPosition,
          parsedInstanceNumber: instanceNumber ? parseInt(instanceNumber) : null
        };
      }
    } catch (error) {
      // Fallback: if range request fails, use instance number
      console.warn(`Range request failed for ${sopInstanceUID}, using fallback`);
    }
    
    return {
      parsedSliceLocation: null,
      parsedZPosition: null,
      parsedInstanceNumber: null
    };
  }, []);

  const loadDicomParser = useCallback((): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (window.dicomParser) {
        resolve();
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://unpkg.com/dicom-parser@1.8.21/dist/dicomParser.min.js';
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load dicom-parser'));
      document.head.appendChild(script);
    });
  }, []);

  // OPTIMIZED: Fast DICOM parsing with performance improvements
  const parseDicomImageOptimized = useCallback(async (arrayBuffer: ArrayBuffer) => {
    try {
      const byteArray = new Uint8Array(arrayBuffer);
      const dataSet = window.dicomParser.parseDicom(byteArray);
      
      const pixelDataElement = dataSet.elements.x7fe00010;
      if (!pixelDataElement) {
        throw new Error('No pixel data found in DICOM file');
      }
      
      const rows = dataSet.uint16('x00280010') || 512;
      const cols = dataSet.uint16('x00280011') || 512;
      const bitsAllocated = dataSet.uint16('x00280100') || 16;
      
      const rescaleSlope = dataSet.floatString('x00281053') || 1;
      const rescaleIntercept = dataSet.floatString('x00281052') || -1024;
      
      if (bitsAllocated === 16) {
        const rawPixelArray = new Uint16Array(arrayBuffer, pixelDataElement.dataOffset, pixelDataElement.length / 2);
        const huPixelArray = new Float32Array(rawPixelArray.length);
        
        // OPTIMIZED: Unrolled loop for better performance
        const len = rawPixelArray.length;
        const slope = rescaleSlope;
        const intercept = rescaleIntercept;
        
        for (let i = 0; i < len; i += 4) {
          huPixelArray[i] = rawPixelArray[i] * slope + intercept;
          if (i + 1 < len) huPixelArray[i + 1] = rawPixelArray[i + 1] * slope + intercept;
          if (i + 2 < len) huPixelArray[i + 2] = rawPixelArray[i + 2] * slope + intercept;
          if (i + 3 < len) huPixelArray[i + 3] = rawPixelArray[i + 3] * slope + intercept;
        }
        
        return {
          data: huPixelArray,
          width: cols,
          height: rows
        };
      } else {
        throw new Error('Only 16-bit images supported');
      }
    } catch (error) {
      console.error('Error parsing DICOM image:', error);
      return null;
    }
  }, []);

  // OPTIMIZED: Maximum speed preloading with controlled concurrency
  const preloadAllImagesOptimized = useCallback(async (imageList: any[]) => {
    console.log('Starting optimized preload of all images...');
    setIsPreloading(true);
    
    const newCache = new Map();
    const maxConcurrent = 8; // Optimal concurrency for most browsers
    let completed = 0;
    
    // Process images in batches for maximum speed
    const processImage = async (image: any, index: number) => {
      try {
        const imageResponse = await fetch(`/api/images/${image.sopInstanceUID}`);
        if (!imageResponse.ok) {
          throw new Error(`Failed to load image ${index + 1}`);
        }
        
        const arrayBuffer = await imageResponse.arrayBuffer();
        const imageData = await parseDicomImageOptimized(arrayBuffer);
        
        if (imageData) {
          newCache.set(image.sopInstanceUID, imageData);
        }
        
        completed++;
        setLoadingProgress({ loaded: completed, total: imageList.length });
        
        if (completed % 10 === 0) {
          console.log(`Preloaded ${completed}/${imageList.length} images`);
        }
      } catch (error) {
        console.warn(`Failed to preload image ${index + 1}:`, error);
        completed++;
        setLoadingProgress({ loaded: completed, total: imageList.length });
      }
    };
    
    // Process in controlled batches for optimal performance
    for (let i = 0; i < imageList.length; i += maxConcurrent) {
      const batch = imageList.slice(i, i + maxConcurrent);
      const promises = batch.map((image, batchIndex) => 
        processImage(image, i + batchIndex)
      );
      
      await Promise.allSettled(promises);
      
      // Update cache progressively for immediate display
      setImageCache(new Map(newCache));
      
      // Small yield to prevent browser freeze
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    
    setImageCache(newCache);
    setIsPreloading(false);
    console.log(`Preloading complete: ${newCache.size}/${imageList.length} images cached`);
  }, [parseDicomImageOptimized]);

  // OPTIMIZED: Fast image list loading with minimal metadata
  const loadImages = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      setLoadingProgress({ loaded: 0, total: 0 });
      
      // Load DICOM parser first
      await loadDicomParser();
      
      const response = await fetch(`/api/series/${seriesId}/images`);
      if (!response.ok) {
        throw new Error(`Failed to load images: ${response.statusText}`);
      }
      
      const seriesImages = await response.json();
      setLoadingProgress({ loaded: 0, total: seriesImages.length });
      
      // OPTIMIZED: Extract metadata in smaller batches to avoid overwhelming browser
      const batchSize = 10;
      const imagesWithMetadata = [];
      
      for (let i = 0; i < seriesImages.length; i += batchSize) {
        const batch = seriesImages.slice(i, i + batchSize);
        
        const batchResults = await Promise.all(
          batch.map(async (img: any) => {
            try {
              const metadata = await extractQuickMetadata(img.sopInstanceUID);
              return { ...img, ...metadata };
            } catch (error) {
              console.warn(`Failed to parse metadata for ${img.fileName}:`, error);
              return {
                ...img,
                parsedSliceLocation: null,
                parsedZPosition: null,
                parsedInstanceNumber: img.instanceNumber
              };
            }
          })
        );
        
        imagesWithMetadata.push(...batchResults);
        setLoadingProgress({ loaded: imagesWithMetadata.length, total: seriesImages.length });
        
        // Small delay to prevent browser lock-up
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      
      // Sort by spatial position
      const sortedImages = imagesWithMetadata.sort((a: any, b: any) => {
        if (a.parsedSliceLocation !== null && b.parsedSliceLocation !== null) {
          return a.parsedSliceLocation - b.parsedSliceLocation;
        }
        if (a.parsedZPosition !== null && b.parsedZPosition !== null) {
          return a.parsedZPosition - b.parsedZPosition;
        }
        if (a.parsedInstanceNumber !== null && b.parsedInstanceNumber !== null) {
          return a.parsedInstanceNumber - b.parsedInstanceNumber;
        }
        return a.fileName.localeCompare(b.fileName, undefined, { numeric: true });
      });
      
      setImages(sortedImages);
      setCurrentIndex(0);
      
      // Start aggressive preloading immediately
      preloadAllImagesOptimized(sortedImages);
      
    } catch (error: any) {
      setError(error.message);
    } finally {
      setIsLoading(false);
    }
  }, [seriesId, loadDicomParser, extractQuickMetadata, preloadAllImagesOptimized]);

  useEffect(() => {
    loadImages();
  }, [seriesId, loadImages]);

  useEffect(() => {
    if (images.length > 0 && !isPreloading) {
      displayCurrentImage();
      // Load metadata for current image
      const currentImage = images[currentIndex];
      if (currentImage?.id) {
        loadImageMetadata(currentImage.id);
      }
    }
  }, [images, currentIndex, currentWindowLevel, isPreloading]);

  const loadImageMetadata = async (imageId: number) => {
    try {
      const response = await fetch(`/api/images/${imageId}/metadata`);
      if (response.ok) {
        const metadata = await response.json();
        console.log('Image metadata:', metadata);
        setImageMetadata(metadata);
        
        // Debug Frame of Reference UID matching
        if (studyId) {
          const frameRefResponse = await fetch(`/api/studies/${studyId}/frame-references`);
          if (frameRefResponse.ok) {
            const frameRefs = await frameRefResponse.json();
            console.log('Frame of Reference UIDs by modality:', frameRefs);
            
            // Check if CT and RTSTRUCT have matching Frame of Reference UIDs
            if (frameRefs.CT && frameRefs.RTSTRUCT) {
              const ctFrame = frameRefs.CT.frameOfReferenceUID;
              const rtFrame = frameRefs.RTSTRUCT.frameOfReferenceUID;
              if (ctFrame !== rtFrame) {
                console.warn('Frame of Reference UID mismatch!');
                console.warn('CT Frame UID:', ctFrame);
                console.warn('RTSTRUCT Frame UID:', rtFrame);
              } else {
                console.log('Frame of Reference UIDs match - good alignment expected');
              }
            }
          }
        }
      }
    } catch (error) {
      console.error('Failed to load image metadata:', error);
    }
  };

  // OPTIMIZED: Fast image display
  const displayCurrentImage = useCallback(async () => {
    if (!canvasRef.current || images.length === 0) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    setIsLoading(true);
    try {
      const currentImage = images[currentIndex];
      const cacheKey = currentImage.sopInstanceUID;
      
      // Clear canvas
      ctx.fillStyle = 'black';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      let imageData = imageCache.get(cacheKey);
      
      if (!imageData) {
        // Show loading indicator for this specific image
        ctx.fillStyle = 'white';
        ctx.font = '16px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('Loading image...', canvas.width / 2, canvas.height / 2);
        return;
      }
      
      // Keep fixed canvas size for consistent display
      canvas.width = 1024;
      canvas.height = 1024;
      
      // Render with current window/level settings
      render16BitImageOptimized(ctx, imageData.data, imageData.width, imageData.height);
      
      // Render RT structure overlays if available
      if (rtStructures && showStructures) {
        renderRTStructures(ctx, canvas, currentImage);
      }
      
    } catch (error: any) {
      console.error('Error displaying image:', error);
      ctx.fillStyle = 'black';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = 'red';
      ctx.font = '16px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('Error loading DICOM', canvas.width / 2, canvas.height / 2 - 10);
      ctx.fillText(error.message, canvas.width / 2, canvas.height / 2 + 10);
    } finally {
      setIsLoading(false);
    }
  }, [images, currentIndex, imageCache, currentWindowLevel, rtStructures, showStructures]);

  const render16BitImageOptimized = (ctx: CanvasRenderingContext2D, pixelArray: Float32Array, width: number, height: number) => {
    const canvasImageData = ctx.createImageData(1024, 1024);
    const data = canvasImageData.data;
    
    const windowCenter = currentWindowLevel.center;
    const windowWidth = currentWindowLevel.width;
    const windowMin = windowCenter - windowWidth / 2;
    const windowMax = windowCenter + windowWidth / 2;
    
    // Scale factors for resizing
    const scaleX = 1024 / width;
    const scaleY = 1024 / height;
    
    for (let canvasY = 0; canvasY < 1024; canvasY++) {
      for (let canvasX = 0; canvasX < 1024; canvasX++) {
        const sourceX = Math.floor(canvasX / scaleX);
        const sourceY = Math.floor(canvasY / scaleY);
        
        if (sourceX < width && sourceY < height) {
          const sourceIndex = sourceY * width + sourceX;
          const huValue = pixelArray[sourceIndex];
          
          let gray = 0;
          if (huValue <= windowMin) {
            gray = 0;
          } else if (huValue >= windowMax) {
            gray = 255;
          } else {
            gray = Math.round(((huValue - windowMin) / windowWidth) * 255);
          }
          
          const pixelIndex = (canvasY * 1024 + canvasX) * 4;
          data[pixelIndex] = gray;     // R
          data[pixelIndex + 1] = gray; // G
          data[pixelIndex + 2] = gray; // B
          data[pixelIndex + 3] = 255;  // A
        }
      }
    }

    ctx.putImageData(canvasImageData, 0, 0);
  };

  const renderRTStructures = (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, currentImage: any) => {
    if (!rtStructures || !currentImage) return;
    
    // Get current slice position
    const currentSlicePosition = currentImage.parsedSliceLocation || currentImage.parsedZPosition || (currentIndex + 1);
    const tolerance = 2.0; // mm tolerance for slice matching
    
    // Save context state
    ctx.save();
    
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.8;
    
    rtStructures.structures.forEach((structure: any) => {
      // Check if this structure is visible
      const isVisible = structureVisibility.get(structure.roiNumber) ?? true;
      if (!isVisible) return;
      
      // Use the structure's actual color, not hardcoded yellow
      const color = structure.color || [255, 255, 0]; // default to yellow if no color
      ctx.strokeStyle = `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
      ctx.fillStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, 0.2)`;
      
      structure.contours?.forEach((contour: any) => {
        // Check if contour is on current slice (within tolerance)
        const contourZ = contour.z;
        if (Math.abs(contourZ - currentSlicePosition) <= tolerance) {
          drawContour(ctx, contour, canvas.width, canvas.height, currentImage);
        }
      });
    });
    
    ctx.restore();
  };

  const drawContour = (ctx: CanvasRenderingContext2D, contour: any, canvasWidth: number, canvasHeight: number, currentImage: any) => {
    if (!contour.points || contour.points.length < 6) return;
    
    ctx.beginPath();
    
    // Process points in pairs (x, y) - z is already filtered
    for (let i = 0; i < contour.points.length; i += 2) {
      const worldX = contour.points[i];
      const worldY = contour.points[i + 1];
      
      // Transform world coordinates to canvas coordinates
      const canvasCoords = worldToCanvasCoordinates(worldX, worldY, canvasWidth, canvasHeight, currentImage);
      
      if (i === 0) {
        ctx.moveTo(canvasCoords.x, canvasCoords.y);
      } else {
        ctx.lineTo(canvasCoords.x, canvasCoords.y);
      }
    }
    
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  };

  const worldToCanvasCoordinates = (worldX: number, worldY: number, canvasWidth: number, canvasHeight: number, currentImage: any) => {
    // Use image metadata if available, otherwise use defaults
    const imagePosition = imageMetadata?.imagePosition || '-300\\-300\\-150';
    const pixelSpacing = imageMetadata?.pixelSpacing || '1.171875\\1.171875';
    
    // Parse the metadata strings
    const [originX, originY] = imagePosition.split('\\').map((val: string) => parseFloat(val));
    const [spacingX, spacingY] = pixelSpacing.split('\\').map((val: string) => parseFloat(val));
    
    // Standard DICOM to pixel transformation
    const pixelX = (worldX - originX) / spacingX;
    const pixelY = (worldY - originY) / spacingY;
    
    // Apply coordinate transformation for correct anatomical orientation
    const rotatedX = 512 - pixelY; // 90-degree counter-clockwise rotation
    const rotatedY = pixelX;
    
    // Apply horizontal flip for correct anatomical display
    const flippedX = 512 - rotatedX;
    const flippedY = rotatedY;
    
    // Scale to canvas coordinates (512x512 → 1024x1024)
    const canvasX = (flippedX / 512) * canvasWidth;
    const canvasY = (flippedY / 512) * canvasHeight;
    
    return { x: canvasX, y: canvasY };
  };

  const goToNext = () => {
    if (currentIndex < images.length - 1) {
      setCurrentIndex(currentIndex + 1);
    }
  };

  const goToPrevious = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    }
  };

  // Rest of the component continues with event handlers, zoom controls, etc.
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    
    if (e.ctrlKey || e.metaKey) {
      // Ctrl+scroll for zoom
      const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
      setZoom(prev => Math.max(0.1, Math.min(5, prev * zoomFactor)));
    } else {
      // Regular scroll for slice navigation
      if (e.deltaY > 0) {
        goToNext();
      } else {
        goToPrevious();
      }
    }
  };

  return (
    <div className="flex flex-col w-full h-full bg-black relative">
      {/* Image Display Area */}
      <div className="flex-1 relative bg-black overflow-hidden">
        <div 
          className="w-full h-full flex items-center justify-center"
          style={{
            transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
            transformOrigin: 'center'
          }}
        >
          <canvas
            ref={canvasRef}
            width={1024}
            height={1024}
            onWheel={handleWheel}
            className="max-w-full max-h-full object-contain cursor-crosshair"
            style={{
              imageRendering: 'auto',
              userSelect: 'none'
            }}
          />
          {/* Preloading overlay with progress */}
          {isPreloading && (
            <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-50">
              <div className="bg-white p-6 rounded-lg max-w-md w-full mx-4">
                <div className="text-center mb-4">
                  <h3 className="text-lg font-semibold text-gray-800">Loading Medical Images</h3>
                  <p className="text-sm text-gray-600 mt-1">
                    {loadingProgress.loaded} of {loadingProgress.total} images loaded
                  </p>
                </div>
                
                {/* Progress bar */}
                <div className="w-full bg-gray-200 rounded-full h-3 mb-4">
                  <div 
                    className="bg-blue-600 h-3 rounded-full transition-all duration-300"
                    style={{ 
                      width: `${loadingProgress.total > 0 ? (loadingProgress.loaded / loadingProgress.total) * 100 : 0}%` 
                    }}
                  ></div>
                </div>
                
                <div className="flex items-center justify-center space-x-2 text-sm text-gray-600">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                  <span>
                    {Math.round(loadingProgress.total > 0 ? (loadingProgress.loaded / loadingProgress.total) * 100 : 0)}%
                  </span>
                </div>
              </div>
            </div>
          )}
          
          {/* Single image loading overlay */}
          {isLoading && !isPreloading && (
            <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
              <div className="bg-white p-4 rounded-lg">
                <div className="flex items-center space-x-3">
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
                  <span>Loading image...</span>
                </div>
              </div>
            </div>
          )}

          {/* Error display */}
          {error && (
            <div className="absolute top-4 right-4 bg-red-600 text-white p-3 rounded-lg max-w-sm">
              <div className="font-semibold">Error</div>
              <div className="text-sm">{error}</div>
            </div>
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="bg-gray-900 p-4 flex items-center justify-between text-white">
        <div className="flex items-center space-x-4">
          <Button
            variant="outline"
            size="sm"
            onClick={goToPrevious}
            disabled={currentIndex <= 0}
            className="bg-gray-800 border-gray-600 text-white hover:bg-gray-700"
          >
            <ChevronLeft className="h-4 w-4" />
            Previous
          </Button>
          
          <span className="text-sm">
            {currentIndex + 1} / {images.length}
          </span>
          
          <Button
            variant="outline"
            size="sm"
            onClick={goToNext}
            disabled={currentIndex >= images.length - 1}
            className="bg-gray-800 border-gray-600 text-white hover:bg-gray-700"
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex items-center space-x-4">
          <div className="text-sm">
            W: {Math.round(currentWindowLevel.width)} L: {Math.round(currentWindowLevel.center)}
          </div>
          <div className="text-sm">
            Zoom: {Math.round(zoom * 100)}%
          </div>
        </div>
      </div>
    </div>
  );
}