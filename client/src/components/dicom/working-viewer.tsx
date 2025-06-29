import { useEffect, useRef, useState, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';

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
  selectedStructure?: number | null;
  editMode?: 'view' | 'brush' | 'eraser' | 'polygon';
}

export function WorkingViewer({ 
  seriesId, 
  studyId, 
  windowLevel: externalWindowLevel, 
  onWindowLevelChange, 
  onZoomIn, 
  onZoomOut, 
  onResetZoom, 
  rtStructures: externalRTStructures, 
  structureVisibility: externalStructureVisibility,
  selectedStructure,
  editMode = 'view'
}: WorkingViewerProps) {
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

  // Get selected structure info for border styling
  const getSelectedStructureInfo = () => {
    if (!selectedStructure || !rtStructures?.structures) return null;
    const structure = rtStructures.structures.find((s: any) => s.roiNumber === selectedStructure);
    return structure ? {
      name: structure.structureName,
      color: `rgb(${structure.color.join(',')})`
    } : null;
  };

  const selectedStructureInfo = getSelectedStructureInfo();

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
  
  // Zoom and pan state
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [lastPanX, setLastPanX] = useState(0);
  const [lastPanY, setLastPanY] = useState(0);

  // Expose zoom functions to external components via global object
  useEffect(() => {
    (window as any).currentViewerZoom = {
      zoomIn: () => setZoom(prev => Math.min(5, prev * 1.25)),
      zoomOut: () => setZoom(prev => Math.max(0.1, prev * 0.8)),
      resetZoom: () => {
        setZoom(1);
        setPanX(0);
        setPanY(0);
      },
      getCurrentZoom: () => zoom
    };
    
    return () => {
      delete (window as any).currentViewerZoom;
    };
  }, [zoom]);

  // Load DICOM parser library
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

  // Extract metadata from DICOM header
  const extractQuickMetadata = useCallback(async (sopInstanceUID: string) => {
    try {
      const response = await fetch(`/api/images/${sopInstanceUID}`, {
        headers: { 'Range': 'bytes=0-2048' }
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
      console.warn(`Range request failed for ${sopInstanceUID}, using fallback`);
    }
    
    return {
      parsedSliceLocation: null,
      parsedZPosition: null,
      parsedInstanceNumber: null
    };
  }, []);

  // Parse DICOM image data
  const parseDicomImage = useCallback(async (arrayBuffer: ArrayBuffer) => {
    try {
      if (!window.dicomParser) {
        await loadDicomParser();
      }
      
      const byteArray = new Uint8Array(arrayBuffer);
      
      // Validate DICOM file format
      if (byteArray.length < 132) {
        throw new Error('File too small to be a valid DICOM file');
      }
      
      // Check for DICM magic number at byte 128
      const dicmMagic = String.fromCharCode(byteArray[128], byteArray[129], byteArray[130], byteArray[131]);
      if (dicmMagic !== 'DICM') {
        throw new Error('Invalid DICOM file format');
      }
      
      const dataSet = window.dicomParser.parseDicom(byteArray);
      
      const pixelDataElement = dataSet.elements.x7fe00010;
      if (!pixelDataElement) {
        throw new Error('No pixel data found in DICOM file');
      }
      
      const rows = dataSet.uint16('x00280010') || 512;
      const cols = dataSet.uint16('x00280011') || 512;
      const bitsAllocated = dataSet.uint16('x00280100') || 16;
      
      const rescaleSlope = parseFloat(dataSet.floatString('x00281053') || '1');
      const rescaleIntercept = parseFloat(dataSet.floatString('x00281052') || '-1024');
      
      if (bitsAllocated === 16) {
        const rawPixelArray = new Uint16Array(arrayBuffer, pixelDataElement.dataOffset, pixelDataElement.length / 2);
        const huPixelArray = new Float32Array(rawPixelArray.length);
        
        // Convert to Hounsfield Units with bounds checking
        for (let i = 0; i < rawPixelArray.length; i++) {
          huPixelArray[i] = rawPixelArray[i] * rescaleSlope + rescaleIntercept;
        }
        
        return {
          data: huPixelArray,
          width: cols,
          height: rows
        };
      } else {
        throw new Error(`Unsupported bit depth: ${bitsAllocated}-bit`);
      }
    } catch (error) {
      console.error('Error parsing DICOM image:', error);
      return null;
    }
  }, [loadDicomParser]);

  // Load images for the series - instant loading with pre-stored metadata
  const loadImages = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`/api/series/${seriesId}/images`);
      if (!response.ok) {
        throw new Error('Failed to load images');
      }
      
      // Images already contain pre-processed metadata from database
      const imageList = await response.json();
      
      // Load DICOM parser for image rendering only
      await loadDicomParser();
      
      // Images are already sorted by the server with proper medical imaging criteria
      setImages(imageList);
      setCurrentIndex(0);
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load images');
    } finally {
      setIsLoading(false);
    }
  }, [seriesId, loadDicomParser]);

  // Load image metadata - skip this since we have pre-processed metadata
  const loadImageMetadata = useCallback(async (imageId: string) => {
    // Skip metadata fetching as images already contain processed metadata
    return;
  }, []);

  // Display current image on canvas
  const displayCurrentImage = useCallback(async () => {
    if (!images.length || !canvasRef.current) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const currentImage = images[currentIndex];
    const cacheKey = currentImage.id;
    
    let imageData = imageCache.get(cacheKey);
    
    if (!imageData) {
      try {
        const response = await fetch(`/api/images/${currentImage.id}`);
        const arrayBuffer = await response.arrayBuffer();
        const parsedData = await parseDicomImage(arrayBuffer);
        
        if (parsedData) {
          imageData = parsedData;
          setImageCache(prev => new Map(prev).set(cacheKey, parsedData));
        }
      } catch (error) {
        console.error('Failed to load image:', error);
        return;
      }
    }
    
    if (!imageData) return;
    
    const { data, width, height } = imageData;
    const imageDataArray = new ImageData(width, height);
    
    // Apply window/level
    const windowWidth = currentWindowLevel.width;
    const windowCenter = currentWindowLevel.center;
    const windowMin = windowCenter - windowWidth / 2;
    const windowMax = windowCenter + windowWidth / 2;
    
    for (let i = 0; i < data.length; i++) {
      let value = data[i];
      
      // Apply windowing
      if (value <= windowMin) {
        value = 0;
      } else if (value >= windowMax) {
        value = 255;
      } else {
        value = ((value - windowMin) / windowWidth) * 255;
      }
      
      const pixelIndex = i * 4;
      imageDataArray.data[pixelIndex] = value;     // Red
      imageDataArray.data[pixelIndex + 1] = value; // Green
      imageDataArray.data[pixelIndex + 2] = value; // Blue
      imageDataArray.data[pixelIndex + 3] = 255;   // Alpha
    }
    
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Calculate display dimensions with zoom and pan
    const scaledWidth = width * zoom;
    const scaledHeight = height * zoom;
    const imageX = (canvas.width - scaledWidth) / 2 + panX;
    const imageY = (canvas.height - scaledHeight) / 2 + panY;
    
    // Create temporary canvas for image data
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d');
    tempCanvas.width = width;
    tempCanvas.height = height;
    
    if (tempCtx) {
      tempCtx.putImageData(imageDataArray, 0, 0);
      ctx.drawImage(tempCanvas, imageX, imageY, scaledWidth, scaledHeight);
    }
    
    // Draw RT structures if enabled
    if (showStructures && rtStructures && structureVisibility) {
      drawRTStructures(ctx, canvas.width, canvas.height, width, height, imageX, imageY, scaledWidth, scaledHeight);
    }
    
  }, [images, currentIndex, imageCache, parseDicomImage, currentWindowLevel, zoom, panX, panY, showStructures, rtStructures, structureVisibility]);

  // Draw RT structures overlay - simplified version that was working
  const drawRTStructures = useCallback((
    ctx: CanvasRenderingContext2D,
    canvasWidth: number,
    canvasHeight: number,
    imageWidth: number,
    imageHeight: number,
    imageX: number,
    imageY: number,
    scaledWidth: number,
    scaledHeight: number
  ) => {
    if (!rtStructures || !structureVisibility) return;
    
    const currentImage = images[currentIndex];
    if (!currentImage) return;
    
    // Get structures array from rtStructures
    const structures = rtStructures.structures || [];
    if (!Array.isArray(structures)) return;
    
    console.log('Drawing RT structures:', structures.length, 'structures for slice', currentIndex);
    
    // Draw structures for current slice
    structures.forEach((structure: any) => {
      if (!structureVisibility.get(structure.roiNumber)) return;
      
      console.log('Drawing structure:', structure.structureName, 'contours:', structure.contours?.length);
      
      const contours = structure.contours || [];
      
      contours.forEach((contour: any, contourIndex: number) => {
        if (!contour.points || contour.points.length === 0) return;
        
        // Draw all contours for testing - remove slice matching for now
        ctx.beginPath();
        ctx.strokeStyle = structure.color ? 
          `rgb(${structure.color[0]}, ${structure.color[1]}, ${structure.color[2]})` : 
          '#00ff00';
        ctx.fillStyle = structure.color ? 
          `rgba(${structure.color[0]}, ${structure.color[1]}, ${structure.color[2]}, 0.2)` : 
          'rgba(0, 255, 0, 0.2)';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        
        let hasValidPoints = false;
        
        // Handle DICOM contour format (x,y,z triplets)
        if (contour.points.length >= 6 && contour.points.length % 3 === 0) {
          for (let i = 0; i < contour.points.length; i += 3) {
            const x = contour.points[i];
            const y = contour.points[i + 1];
            
            // Simple coordinate transformation - scale and center
            const canvasX = imageX + (x / 500) * scaledWidth + scaledWidth / 4;
            const canvasY = imageY + (y / 500) * scaledHeight + scaledHeight / 4;
            
            if (i === 0) {
              ctx.moveTo(canvasX, canvasY);
              hasValidPoints = true;
            } else {
              ctx.lineTo(canvasX, canvasY);
            }
          }
        }
        
        if (hasValidPoints) {
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          console.log('Drew contour', contourIndex, 'for structure', structure.structureName);
        }
      });
    });
  }, [images, currentIndex, zoom, rtStructures, structureVisibility]);

  // Navigation functions with bounds checking
  const goToPrevious = useCallback(() => {
    try {
      if (images.length > 0 && currentIndex > 0) {
        setCurrentIndex(prevIndex => Math.max(0, prevIndex - 1));
      }
    } catch (error) {
      console.error('Error navigating to previous image:', error);
    }
  }, [currentIndex, images.length]);

  const goToNext = useCallback(() => {
    try {
      if (images.length > 0 && currentIndex < images.length - 1) {
        setCurrentIndex(prevIndex => Math.min(images.length - 1, prevIndex + 1));
      }
    } catch (error) {
      console.error('Error navigating to next image:', error);
    }
  }, [currentIndex, images.length]);

  // Mouse event handlers
  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (e.button === 0) { // Left click for pan
      setIsDragging(true);
      setDragStart({ x: e.clientX, y: e.clientY });
      setLastPanX(panX);
      setLastPanY(panY);
    } else if (e.button === 2) { // Right click for window/level
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
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isDragging) {
      const deltaX = e.clientX - dragStart.x;
      const deltaY = e.clientY - dragStart.y;
      setPanX(lastPanX + deltaX);
      setPanY(lastPanY + deltaY);
    }
  };

  const handleCanvasMouseUp = () => {
    setIsDragging(false);
  };

  const handleCanvasWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    try {
      e.preventDefault();
      e.stopPropagation();
      
      if (e.ctrlKey || e.metaKey) {
        // Ctrl+scroll for zoom
        const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
        const newZoom = Math.max(0.1, Math.min(5, zoom * zoomFactor));
        setZoom(newZoom);
        
        // Call external zoom handlers if provided
        if (e.deltaY > 0 && onZoomOut) {
          onZoomOut();
        } else if (e.deltaY < 0 && onZoomIn) {
          onZoomIn();
        }
      } else {
        // Regular scroll for slice navigation
        if (e.deltaY > 0) {
          goToNext();
        } else {
          goToPrevious();
        }
      }
    } catch (error) {
      console.error('Error handling wheel event:', error);
    }
  }, [zoom, goToNext, goToPrevious, onZoomIn, onZoomOut]);

  // Effects
  useEffect(() => {
    loadImages();
  }, [seriesId]);

  useEffect(() => {
    if (images.length > 0 && !isPreloading) {
      displayCurrentImage();
      const currentImage = images[currentIndex];
      if (currentImage?.id) {
        loadImageMetadata(currentImage.id);
      }
    }
  }, [images, currentIndex, currentWindowLevel, zoom, panX, panY, showStructures, rtStructures, structureVisibility, isPreloading]);

  if (isLoading) {
    return (
      <Card className="flex items-center justify-center h-96">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-2"></div>
          <p>Loading images...</p>
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="flex items-center justify-center h-96">
        <div className="text-center text-red-600">
          <p>Error: {error}</p>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-2">
            <Button
              variant="outline"
              size="sm"
              onClick={goToPrevious}
              disabled={currentIndex === 0}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Badge variant="secondary">
              {currentIndex + 1} / {images.length}
            </Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={goToNext}
              disabled={currentIndex === images.length - 1}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          
          <div className="flex items-center space-x-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const newZoom = Math.max(0.1, zoom * 0.8);
                setZoom(newZoom);
                if (onZoomOut) onZoomOut();
              }}
              title="Zoom Out"
            >
              <ZoomOut className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const newZoom = Math.min(5, zoom * 1.25);
                setZoom(newZoom);
                if (onZoomIn) onZoomIn();
              }}
              title="Zoom In"
            >
              <ZoomIn className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setZoom(1);
                setPanX(0);
                setPanY(0);
                if (onResetZoom) onResetZoom();
              }}
              title="Reset Zoom"
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
            <Badge variant="outline">
              W: {Math.round(currentWindowLevel.width)} L: {Math.round(currentWindowLevel.center)}
            </Badge>
            <Badge variant="outline">
              Zoom: {Math.round(zoom * 100)}%
            </Badge>
            <Button
              variant={showStructures ? "default" : "outline"}
              size="sm"
              onClick={() => setShowStructures(!showStructures)}
              title="Toggle All Structures"
            >
              View All
            </Button>
          </div>
        </div>
        
        <div className="relative">
          {/* Structure editing label */}
          {selectedStructureInfo && editMode !== 'view' && (
            <div 
              className="absolute top-2 left-2 z-10 px-3 py-1 rounded-md text-sm font-medium text-white shadow-lg"
              style={{ 
                backgroundColor: selectedStructureInfo.color,
                border: `2px solid ${selectedStructureInfo.color}`
              }}
            >
              Editing: {selectedStructureInfo.name}
            </div>
          )}
          
          <canvas
            ref={canvasRef}
            width={800}
            height={600}
            className={`cursor-grab active:cursor-grabbing transition-all duration-200 bg-black ${
              selectedStructureInfo && editMode !== 'view' 
                ? 'border-4' 
                : 'border border-gray-600'
            }`}
            style={{
              borderColor: selectedStructureInfo && editMode !== 'view' 
                ? selectedStructureInfo.color 
                : undefined
            }}
            onMouseDown={handleCanvasMouseDown}
            onMouseMove={handleCanvasMouseMove}
            onMouseUp={handleCanvasMouseUp}
            onMouseLeave={handleCanvasMouseUp}
            onWheel={handleCanvasWheel}
            onContextMenu={(e) => e.preventDefault()}
          />
        </div>
      </Card>
    </div>
  );
}