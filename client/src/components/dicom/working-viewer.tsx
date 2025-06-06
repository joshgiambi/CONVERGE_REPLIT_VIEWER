import { useEffect, useRef, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, HelpCircle, Keyboard, Info } from 'lucide-react';

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
  const [showInteractionTips, setShowInteractionTips] = useState(false);
  const [tipsDialogOpen, setTipsDialogOpen] = useState(false);
  const [showMetadata, setShowMetadata] = useState(false);

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
        
        // Get rescale parameters for Hounsfield Units
        const rescaleSlope = dataSet.floatString('x00281053') || 1;
        const rescaleIntercept = dataSet.floatString('x00281052') || -1024;
        
        // Get pixel data
        const pixelDataOffset = pixelData.dataOffset;
        const pixelDataLength = pixelData.length;
        
        if (bitsAllocated === 16) {
          const rawPixelArray = new Uint16Array(arrayBuffer, pixelDataOffset, pixelDataLength / 2);
          // Convert to Hounsfield Units
          const huPixelArray = new Float32Array(rawPixelArray.length);
          for (let i = 0; i < rawPixelArray.length; i++) {
            huPixelArray[i] = rawPixelArray[i] * rescaleSlope + rescaleIntercept;
          }
          imageData = { data: huPixelArray, width: cols, height: rows };
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
            width={512}
            height={512}
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

          {/* Toolbar - Bottom Right */}
          <div className="absolute bottom-2 right-2 flex gap-2">
            {/* Metadata Button */}
            <div className="relative group">
              <Button
                variant="outline"
                size="sm"
                className="bg-black bg-opacity-75 text-white border-gray-600 hover:bg-gray-700"
                onClick={() => setShowMetadata(!showMetadata)}
              >
                <Info className="w-4 h-4" />
              </Button>
              
              {/* Metadata Tooltip */}
              <div className="absolute bottom-full right-0 mb-1 px-2 py-1 bg-black bg-opacity-90 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                View DICOM Metadata
              </div>
            </div>

            {/* Interaction Tips Button */}
            <div
              className="relative group"
              onMouseEnter={() => setShowInteractionTips(true)}
              onMouseLeave={() => !tipsDialogOpen && setShowInteractionTips(false)}
            >
              <Button
                variant="outline"
                size="sm"
                className="bg-black bg-opacity-75 text-white border-gray-600 hover:bg-gray-700"
                onClick={() => setTipsDialogOpen(!tipsDialogOpen)}
              >
                <HelpCircle className="w-4 h-4" />
              </Button>
              
              {/* Help Tooltip */}
              <div className="absolute bottom-full right-0 mb-1 px-2 py-1 bg-black bg-opacity-90 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                Interaction Guide
              </div>

              {/* Tips Dialog */}
              {(showInteractionTips || tipsDialogOpen) && (
                <div className="absolute bottom-full right-0 mb-2 bg-black bg-opacity-90 text-white p-4 rounded-lg text-xs w-80 shadow-lg border border-gray-600">
                  <div className="flex items-center mb-3">
                    <Keyboard className="w-4 h-4 mr-2 text-indigo-400" />
                    <h3 className="font-semibold text-indigo-300">Interaction Guide</h3>
                  </div>
                  
                  <div className="space-y-3">
                    <div>
                      <h4 className="font-medium text-yellow-300 mb-1">Navigation</h4>
                      <div className="grid grid-cols-2 gap-2 text-gray-300">
                        <div>• Mouse Wheel: Navigate slices</div>
                        <div>• Arrow Keys: Previous/Next slice</div>
                      </div>
                    </div>
                    
                    <div>
                      <h4 className="font-medium text-yellow-300 mb-1">Window/Level</h4>
                      <div className="text-gray-300">
                        <div>• Drag on image: Adjust contrast</div>
                        <div>• Horizontal: Window width</div>
                        <div>• Vertical: Window level</div>
                      </div>
                    </div>
                    
                    <div>
                      <h4 className="font-medium text-yellow-300 mb-1">Shortcuts (Coming Soon)</h4>
                      <div className="grid grid-cols-2 gap-2 text-gray-400">
                        <div>• R: Reset view</div>
                        <div>• F: Fit to window</div>
                        <div>• 1-8: Preset windows</div>
                        <div>• I: Invert colors</div>
                      </div>
                    </div>
                  </div>
                  
                  {tipsDialogOpen && (
                    <div className="mt-3 pt-2 border-t border-gray-600">
                      <button
                        onClick={() => setTipsDialogOpen(false)}
                        className="text-xs text-indigo-400 hover:text-indigo-300"
                      >
                        Click to close
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Metadata Popup */}
            {showMetadata && images.length > 0 && (
              <div className="absolute bottom-full right-0 mb-2 bg-black bg-opacity-95 text-white p-4 rounded-lg text-xs w-96 shadow-lg border border-gray-600 max-h-80 overflow-y-auto">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center">
                    <Info className="w-4 h-4 mr-2 text-indigo-400" />
                    <h3 className="font-semibold text-indigo-300">DICOM Metadata</h3>
                  </div>
                  <button
                    onClick={() => setShowMetadata(false)}
                    className="text-gray-400 hover:text-white"
                  >
                    ×
                  </button>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="font-semibold text-indigo-300 mb-2">Patient Info</div>
                    <div className="space-y-1 text-gray-300">
                      <div><span className="text-gray-400">Name:</span> DEMO^PATIENT</div>
                      <div><span className="text-gray-400">ID:</span> DM001</div>
                      <div><span className="text-gray-400">DOB:</span> 1970-01-01</div>
                      <div><span className="text-gray-400">Sex:</span> M</div>
                    </div>
                  </div>
                  
                  <div>
                    <div className="font-semibold text-indigo-300 mb-2">Study Info</div>
                    <div className="space-y-1 text-gray-300">
                      <div><span className="text-gray-400">Date:</span> 2024-01-15</div>
                      <div><span className="text-gray-400">Time:</span> 14:30:00</div>
                      <div><span className="text-gray-400">Description:</span> Chest CT</div>
                      <div><span className="text-gray-400">Modality:</span> CT</div>
                    </div>
                  </div>
                  
                  <div>
                    <div className="font-semibold text-indigo-300 mb-2">Image Parameters</div>
                    <div className="space-y-1 text-gray-300">
                      <div><span className="text-gray-400">Matrix:</span> 512 x 512</div>
                      <div><span className="text-gray-400">Slice:</span> {currentIndex + 1} / {images.length}</div>
                      <div><span className="text-gray-400">Thickness:</span> 1.0mm</div>
                      <div><span className="text-gray-400">kVp:</span> 120</div>
                      <div><span className="text-gray-400">mAs:</span> 200</div>
                    </div>
                  </div>
                  
                  <div>
                    <div className="font-semibold text-indigo-300 mb-2">Window/Level</div>
                    <div className="space-y-1 text-gray-300">
                      <div><span className="text-gray-400">Current W/L:</span> {Math.round(currentWindowLevel.width)}/{Math.round(currentWindowLevel.center)}</div>
                      <div><span className="text-gray-400">Range:</span> [-1024, 3071] HU</div>
                      <div><span className="text-gray-400">Reconstruction:</span> FBP</div>
                    </div>
                  </div>
                </div>
              </div>
            )}
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