import { useEffect, useRef, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface WorkingViewerProps {
  seriesId: number;
  windowLevel?: { window: number; level: number };
  onWindowLevelChange?: (windowLevel: { window: number; level: number }) => void;
}

export function WorkingViewer({ seriesId, windowLevel: externalWindowLevel, onWindowLevelChange }: WorkingViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [images, setImages] = useState<any[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Convert external window/level format to internal width/center format
  const currentWindowLevel = externalWindowLevel 
    ? { width: externalWindowLevel.window, center: externalWindowLevel.level }
    : { width: 400, center: 40 };

  // Function to update external window/level when internal changes
  const updateWindowLevel = (newWindowLevel: { width: number; center: number }) => {
    if (onWindowLevelChange) {
      onWindowLevelChange({ window: newWindowLevel.width, level: newWindowLevel.center });
    }
  };
  const [imageCache, setImageCache] = useState<Map<string, { data: Float32Array, width: number, height: number }>>(new Map());
  const [isImageReady, setIsImageReady] = useState(false);


  useEffect(() => {
    loadImages();
  }, [seriesId]);

  useEffect(() => {
    if (images.length > 0) {
      displayCurrentImage();
    }
  }, [images, currentIndex, currentWindowLevel]);

  const loadImages = async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      const response = await fetch(`/api/series/${seriesId}`);
      if (!response.ok) {
        throw new Error(`Failed to load series: ${response.statusText}`);
      }
      
      const seriesData = await response.json();
      
      // Sort by slice location first, then by instance number
      const sortedImages = seriesData.images.sort((a: any, b: any) => {
        // Try slice location first (more reliable for CT ordering)
        if (a.sliceLocation !== undefined && b.sliceLocation !== undefined) {
          return parseFloat(a.sliceLocation) - parseFloat(b.sliceLocation);
        }
        
        // Fall back to instance number
        if (a.instanceNumber !== undefined && b.instanceNumber !== undefined) {
          return parseInt(a.instanceNumber) - parseInt(b.instanceNumber);
        }
        
        // Fall back to filename comparison
        return a.fileName.localeCompare(b.fileName, undefined, { numeric: true });
      });
      
      setImages(sortedImages);
      setCurrentIndex(0);
      
      // Preload all images immediately
      preloadAllImages(sortedImages);
      
    } catch (error: any) {
      setError(error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const parseDicomImage = async (arrayBuffer: ArrayBuffer) => {
    try {
      // Load dicom-parser if not already loaded
      if (!window.dicomParser) {
        await loadDicomParser();
      }
      
      const byteArray = new Uint8Array(arrayBuffer);
      const dataSet = window.dicomParser.parseDicom(byteArray);
      
      // Extract image data
      const pixelDataElement = dataSet.elements.x7fe00010;
      if (!pixelDataElement) {
        throw new Error('No pixel data found in DICOM file');
      }
      
      const pixelData = new Uint16Array(dataSet.byteArray.buffer, pixelDataElement.dataOffset, pixelDataElement.length / 2);
      
      // Get image dimensions
      const rows = dataSet.uint16('x00280010');
      const cols = dataSet.uint16('x00280011');
      const bitsStored = dataSet.uint16('x00280101') || 16;
      const pixelRepresentation = dataSet.uint16('x00280103') || 0;
      
      // Convert to signed if needed
      let processedData: Float32Array;
      if (pixelRepresentation === 1 && bitsStored === 16) {
        // Signed 16-bit data
        const signedData = new Int16Array(pixelData.buffer, pixelData.byteOffset, pixelData.length);
        processedData = new Float32Array(signedData);
      } else {
        // Unsigned data
        processedData = new Float32Array(pixelData);
      }
      
      return {
        data: processedData,
        width: cols || 512,
        height: rows || 512
      };
    } catch (error) {
      console.error('Error parsing DICOM image:', error);
      return null;
    }
  };

  const preloadAllImages = async (imageList: any[]) => {
    console.log('Starting to preload all images...');
    const newCache = new Map();
    
    // Load all images in parallel
    const loadPromises = imageList.map(async (image, index) => {
      try {
        const imageResponse = await fetch(`/api/images/${image.sopInstanceUID}`);
        if (!imageResponse.ok) {
          throw new Error(`Failed to load image ${index + 1}`);
        }
        
        const arrayBuffer = await imageResponse.arrayBuffer();
        const imageData = await parseDicomImage(arrayBuffer);
        
        if (imageData) {
          newCache.set(image.sopInstanceUID, imageData);
          console.log(`Preloaded image ${index + 1}/${imageList.length}`);
        }
      } catch (error) {
        console.warn(`Failed to preload image ${index + 1}:`, error);
      }
    });
    
    // Wait for all images to load
    await Promise.allSettled(loadPromises);
    setImageCache(newCache);
    console.log(`Preloading complete: ${newCache.size}/${imageList.length} images cached`);
  };

  const displayCurrentImage = async () => {
    if (!canvasRef.current || images.length === 0) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    try {
      const currentImage = images[currentIndex];
      const cacheKey = currentImage.sopInstanceUID;
      
      // Clear canvas
      ctx.fillStyle = 'black';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      let imageData = imageCache.get(cacheKey);
      
      if (!imageData) {
        // Image should be preloaded, but fallback just in case
        console.warn('Image not in cache, this should not happen after preloading:', cacheKey);
        throw new Error('Image not available in cache');
      }
      
      // Keep fixed canvas size for consistent display
      canvas.width = 768;
      canvas.height = 768;
      
      // Render with current window/level settings
      render16BitImage(ctx, imageData.data, imageData.width, imageData.height);
      
    } catch (error: any) {
      console.error('Error displaying image:', error);
      ctx.fillStyle = 'black';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = 'red';
      ctx.font = '16px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('Error loading DICOM', canvas.width / 2, canvas.height / 2 - 10);
      ctx.fillText(error.message, canvas.width / 2, canvas.height / 2 + 10);
    }
  };

  const render16BitImage = (ctx: CanvasRenderingContext2D, pixelArray: Float32Array, width: number, height: number) => {
    const imageData = ctx.createImageData(width, height);
    const data = imageData.data;

    // Apply window/level settings
    const { width: windowWidth, center: windowCenter } = currentWindowLevel;
    const min = windowCenter - windowWidth / 2;
    const max = windowCenter + windowWidth / 2;
    
    for (let i = 0; i < pixelArray.length; i++) {
      const pixelValue = pixelArray[i];
      
      // Apply windowing
      let normalizedValue;
      if (pixelValue <= min) {
        normalizedValue = 0;
      } else if (pixelValue >= max) {
        normalizedValue = 255;
      } else {
        normalizedValue = ((pixelValue - min) / windowWidth) * 255;
      }
      
      const gray = Math.max(0, Math.min(255, normalizedValue));
      
      const pixelIndex = i * 4;
      data[pixelIndex] = gray;     // R
      data[pixelIndex + 1] = gray; // G
      data[pixelIndex + 2] = gray; // B
      data[pixelIndex + 3] = 255;  // A
    }

    ctx.putImageData(imageData, 0, 0);
  };

  const render8BitImage = (ctx: CanvasRenderingContext2D, pixelArray: Uint8Array, width: number, height: number) => {
    const imageData = ctx.createImageData(width, height);
    const data = imageData.data;

    for (let i = 0; i < pixelArray.length; i++) {
      const gray = pixelArray[i];
      const pixelIndex = i * 4;
      data[pixelIndex] = gray;     // R
      data[pixelIndex + 1] = gray; // G
      data[pixelIndex + 2] = gray; // B
      data[pixelIndex + 3] = 255;  // A
    }

    ctx.putImageData(imageData, 0, 0);
  };

  const loadDicomParser = (): Promise<void> => {
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
  };

  const goToPrevious = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    }
  };

  const goToNext = () => {
    if (currentIndex < images.length - 1) {
      setCurrentIndex(currentIndex + 1);
    }
  };



  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    e.stopPropagation();
    
    const startX = e.clientX;
    const startY = e.clientY;
    const startWindow = currentWindowLevel.width;
    const startCenter = currentWindowLevel.center;

    const handleWindowLevelDrag = (moveEvent: MouseEvent) => {
      moveEvent.preventDefault();
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;
      
      const newWidth = Math.max(1, startWindow + deltaX * 2);
      const newCenter = startCenter - deltaY * 1.5;
      
      updateWindowLevel({ width: newWidth, center: newCenter });
    };

    const handleWindowLevelEnd = (endEvent: MouseEvent) => {
      endEvent.preventDefault();
      document.removeEventListener('mousemove', handleWindowLevelDrag);
      document.removeEventListener('mouseup', handleWindowLevelEnd);
    };

    document.addEventListener('mousemove', handleWindowLevelDrag);
    document.addEventListener('mouseup', handleWindowLevelEnd);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') goToPrevious();
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') goToNext();
    };

    const handleWheel = (e: WheelEvent) => {
      // Only handle wheel events if mouse is over the canvas
      if (canvasRef.current && canvasRef.current.contains(e.target as Node)) {
        e.preventDefault();
        if (e.deltaY > 0) {
          goToNext();
        } else {
          goToPrevious();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('wheel', handleWheel, { passive: false });
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('wheel', handleWheel);
    };
  }, [currentIndex, images]);

  if (isLoading) {
    return (
      <Card className="h-full bg-black border-indigo-800 flex items-center justify-center">
        <div className="text-center text-white">
          <div className="animate-spin w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full mx-auto mb-2"></div>
          <p>Loading CT scan...</p>
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="h-full bg-black border-indigo-800 flex items-center justify-center">
        <div className="text-center text-red-400">
          <p className="mb-2">Error loading CT scan:</p>
          <p className="text-sm">{error}</p>
          <Button onClick={loadImages} className="mt-4 bg-indigo-600 hover:bg-indigo-700">
            Retry
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="h-full bg-black border-indigo-800">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-indigo-700">
        <div className="flex items-center space-x-2">
          <Badge className="bg-indigo-900 text-indigo-200">
            CT Scan
          </Badge>
          {images.length > 0 && (
            <Badge variant="outline" className="border-indigo-600 text-indigo-300">
              {currentIndex + 1} / {images.length}
            </Badge>
          )}
        </div>
        
        <div className="flex items-center space-x-2">
          <Button
            size="sm"
            variant="outline"
            onClick={goToPrevious}
            disabled={currentIndex === 0}
            className="border-indigo-600 hover:bg-indigo-800"
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={goToNext}
            disabled={currentIndex === images.length - 1}
            className="border-indigo-600 hover:bg-indigo-800"
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1 p-4 flex items-center justify-center">
        <div className="relative">
          <canvas
            ref={canvasRef}
            width={768}
            height={768}
            onMouseDown={handleCanvasMouseDown}
            className="max-w-full max-h-full object-contain border border-indigo-700 rounded cursor-move"
            style={{ 
              backgroundColor: 'black',
              imageRendering: 'pixelated',
              userSelect: 'none'
            }}
          />
          {/* Current Window/Level display */}
          <div className="absolute top-2 right-2 bg-black bg-opacity-75 text-white px-2 py-1 rounded text-xs">
            <div>W:{Math.round(currentWindowLevel.width)} L:{Math.round(currentWindowLevel.center)}</div>
          </div>




        </div>
      </div>

    </Card>
  );
}

declare global {
  interface Window {
    dicomParser: any;
  }
}