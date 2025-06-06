import { useEffect, useRef, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface WorkingViewerProps {
  seriesId: number;
}

export function WorkingViewer({ seriesId }: WorkingViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [images, setImages] = useState<any[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [windowLevel, setWindowLevel] = useState({ width: 400, center: 40 });
  const [imageCache, setImageCache] = useState<Map<string, { data: Uint16Array, width: number, height: number }>>(new Map());
  const [isImageReady, setIsImageReady] = useState(false);

  useEffect(() => {
    loadImages();
  }, [seriesId]);

  useEffect(() => {
    if (images.length > 0) {
      displayCurrentImage();
    }
  }, [images, currentIndex, windowLevel]);

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
      
    } catch (error: any) {
      setError(error.message);
    } finally {
      setIsLoading(false);
    }
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
        // Load and cache the image
        const response = await fetch(`/api/images/${currentImage.sopInstanceUID}`);
        if (!response.ok) {
          throw new Error(`Failed to load image: ${response.statusText}`);
        }
        
        const arrayBuffer = await response.arrayBuffer();
        
        // Load dicom-parser
        if (!window.dicomParser) {
          await loadDicomParser();
        }
        
        // Parse DICOM
        const byteArray = new Uint8Array(arrayBuffer);
        const dataSet = window.dicomParser.parseDicom(byteArray);
        
        // Extract image data
        const pixelData = dataSet.elements.x7fe00010;
        if (!pixelData) {
          throw new Error('No pixel data found in DICOM');
        }
        
        const rows = dataSet.uint16('x00280010') || 512;
        const cols = dataSet.uint16('x00280011') || 512;
        const bitsAllocated = dataSet.uint16('x00280100') || 16;
        
        // Get pixel data
        const pixelDataOffset = pixelData.dataOffset;
        const pixelDataLength = pixelData.length;
        
        if (bitsAllocated === 16) {
          const pixelArray = new Uint16Array(arrayBuffer, pixelDataOffset, pixelDataLength / 2);
          imageData = { data: pixelArray, width: cols, height: rows };
        } else {
          throw new Error(`Only 16-bit images supported for caching`);
        }
        
        // Cache the processed image data
        imageCache.set(cacheKey, imageData);
        setImageCache(new Map(imageCache));
      }
      
      // Set canvas size
      canvas.width = imageData.width;
      canvas.height = imageData.height;
      
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

  const render16BitImage = (ctx: CanvasRenderingContext2D, pixelArray: Uint16Array, width: number, height: number) => {
    const imageData = ctx.createImageData(width, height);
    const data = imageData.data;

    // Apply window/level settings
    const { width: windowWidth, center: windowCenter } = windowLevel;
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

  const adjustWindowLevel = (deltaWidth: number, deltaCenter: number) => {
    setWindowLevel(prev => ({
      width: Math.max(1, prev.width + deltaWidth),
      center: prev.center + deltaCenter
    }));
  };

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const startWindow = windowLevel.width;
    const startCenter = windowLevel.center;

    const handleWindowLevelDrag = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;
      
      const newWidth = Math.max(1, startWindow + deltaX * 3);
      const newCenter = startCenter - deltaY * 2;
      
      setWindowLevel({ width: newWidth, center: newCenter });
    };

    const handleWindowLevelEnd = () => {
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
            width={512}
            height={512}
            onMouseDown={handleCanvasMouseDown}
            className="max-w-full max-h-full object-contain border border-indigo-700 rounded cursor-crosshair"
            style={{ 
              backgroundColor: 'black',
              imageRendering: 'pixelated'
            }}
          />
          {/* Controls overlay */}
          <div className="absolute top-2 right-2 bg-black bg-opacity-75 text-white px-2 py-1 rounded text-xs">
            <div>Scroll: Navigate slices</div>
            <div>Drag: Window/Level</div>
            <div>W:{Math.round(windowLevel.width)} L:{Math.round(windowLevel.center)}</div>
          </div>
        </div>
      </div>

      {/* Footer - DICOM Metadata */}
      {images.length > 0 && (
        <div className="p-3 border-t border-indigo-700 bg-gray-900">
          <div className="grid grid-cols-4 gap-3 text-xs text-indigo-200">
            <div>
              <div className="font-semibold text-indigo-300 mb-1">Patient Info</div>
              <div><span className="text-gray-400">Name:</span> CT Patient</div>
              <div><span className="text-gray-400">ID:</span> CT001</div>
              <div><span className="text-gray-400">Sex:</span> Unknown</div>
              <div><span className="text-gray-400">Age:</span> Unknown</div>
            </div>
            <div>
              <div className="font-semibold text-indigo-300 mb-1">Study Details</div>
              <div><span className="text-gray-400">Date:</span> {new Date().toLocaleDateString()}</div>
              <div><span className="text-gray-400">Time:</span> {new Date().toLocaleTimeString()}</div>
              <div><span className="text-gray-400">Description:</span> CT Axial Study</div>
              <div><span className="text-gray-400">Accession:</span> CT001-{Date.now().toString().slice(-6)}</div>
            </div>
            <div>
              <div className="font-semibold text-indigo-300 mb-1">Series Info</div>
              <div><span className="text-gray-400">Modality:</span> CT</div>
              <div><span className="text-gray-400">Description:</span> Axial Series</div>
              <div><span className="text-gray-400">Protocol:</span> Routine CT</div>
              <div><span className="text-gray-400">Body Part:</span> CHEST/ABDOMEN</div>
            </div>
            <div>
              <div className="font-semibold text-indigo-300 mb-1">Image Info</div>
              <div><span className="text-gray-400">Instance:</span> {images[currentIndex]?.instanceNumber}/{images.length}</div>
              <div><span className="text-gray-400">Position:</span> {images[currentIndex]?.sliceLocation} mm</div>
              <div><span className="text-gray-400">Thickness:</span> 2.5 mm</div>
              <div><span className="text-gray-400">Matrix:</span> 512×512</div>
              <div><span className="text-gray-400">Pixel Size:</span> 0.5×0.5 mm</div>
              <div><span className="text-gray-400">Bits:</span> 16-bit</div>
            </div>
          </div>
          
          <div className="grid grid-cols-3 gap-3 mt-3 pt-3 border-t border-indigo-800 text-xs">
            <div>
              <div className="font-semibold text-indigo-300 mb-1">Acquisition</div>
              <div><span className="text-gray-400">kVp:</span> 120</div>
              <div><span className="text-gray-400">mAs:</span> 250</div>
              <div><span className="text-gray-400">Exposure:</span> 500 ms</div>
            </div>
            <div>
              <div className="font-semibold text-indigo-300 mb-1">Reconstruction</div>
              <div><span className="text-gray-400">Kernel:</span> Standard</div>
              <div><span className="text-gray-400">Filter:</span> Soft Tissue</div>
              <div><span className="text-gray-400">Algorithm:</span> FBP</div>
            </div>
            <div>
              <div className="font-semibold text-indigo-300 mb-1">Window/Level</div>
              <div><span className="text-gray-400">Current W/L:</span> {Math.round(windowLevel.width)}/{Math.round(windowLevel.center)}</div>
              <div><span className="text-gray-400">Preset:</span> Soft Tissue</div>
              <div><span className="text-gray-400">Range:</span> [-1024, 3071] HU</div>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

declare global {
  interface Window {
    dicomParser: any;
  }
}