import { useEffect, useRef, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, RotateCcw, Eye, EyeOff, Brush, Eraser, MousePointer, Undo2, Redo2, Save } from 'lucide-react';

interface RTStructureContour {
  roiNumber: number;
  structureName: string;
  color: [number, number, number];
  contours?: any[];
}

interface ContourPoint {
  x: number;
  y: number;
}

interface ContourSegment {
  points: ContourPoint[];
  structureId: number;
  sliceIndex: number;
  color: string;
  name: string;
}

interface BrushSettings {
  size: number;
  opacity: number;
  mode: 'paint' | 'erase';
}

interface EnhancedViewerProps {
  seriesId: string;
  studyId: string;
  rtStructures: RTStructureContour[];
}

export function EnhancedViewerFixed({ seriesId, studyId, rtStructures }: EnhancedViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  
  const [images, setImages] = useState<any[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Contour editing state
  const [editMode, setEditMode] = useState<'view' | 'brush' | 'eraser'>('view');
  const [selectedStructure, setSelectedStructure] = useState<number | null>(null);
  const [brushSettings, setBrushSettings] = useState<BrushSettings>({
    size: 10,
    opacity: 1.0,
    mode: 'paint'
  });
  
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentStroke, setCurrentStroke] = useState<ContourPoint[]>([]);
  const [contourSegments, setContourSegments] = useState<Map<string, ContourSegment[]>>(new Map());
  const [undoStack, setUndoStack] = useState<Map<string, ContourSegment[]>[]>([]);
  const [redoStack, setRedoStack] = useState<Map<string, ContourSegment[]>[]>([]);
  const [structureVisibility, setStructureVisibility] = useState<Map<number, boolean>>(new Map());
  
  // Viewer state
  const [windowLevel, setWindowLevel] = useState({ width: 400, center: 40 });
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [imageCache, setImageCache] = useState<Map<string, { data: Float32Array, width: number, height: number }>>(new Map());

  // Initialize structure visibility
  useEffect(() => {
    const visibility = new Map<number, boolean>();
    rtStructures.forEach(structure => {
      visibility.set(structure.roiNumber, true);
    });
    setStructureVisibility(visibility);
  }, [rtStructures]);

  // Navigation functions
  const goToPrevious = useCallback(() => {
    if (currentIndex > 0) {
      const newIndex = currentIndex - 1;
      setCurrentIndex(newIndex);
      if (images[newIndex]) {
        loadImageData(images[newIndex]);
      }
    }
  }, [currentIndex, images]);

  const goToNext = useCallback(() => {
    if (currentIndex < images.length - 1) {
      const newIndex = currentIndex + 1;
      setCurrentIndex(newIndex);
      if (images[newIndex]) {
        loadImageData(images[newIndex]);
      }
    }
  }, [currentIndex, images]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowUp':
        case 'ArrowLeft':
          e.preventDefault();
          goToPrevious();
          break;
        case 'ArrowDown':
        case 'ArrowRight':
          e.preventDefault();
          goToNext();
          break;
        case ' ':
          e.preventDefault();
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [goToPrevious, goToNext]);

  // Load images with pre-stored metadata
  useEffect(() => {
    const loadImages = async () => {
      setIsLoading(true);
      setError(null);
      
      try {
        const response = await fetch(`/api/series/${seriesId}/images`);
        if (!response.ok) {
          throw new Error('Failed to load images');
        }
        
        const imageData = await response.json();
        setImages(imageData);
        
        if (imageData.length > 0) {
          await loadImageData(imageData[0]);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load images');
      } finally {
        setIsLoading(false);
      }
    };
    
    if (seriesId) {
      loadImages();
    }
  }, [seriesId]);

  // Load image data from server
  const loadImageData = async (imageInfo: any) => {
    try {
      // Check cache first
      const cached = imageCache.get(imageInfo.sopInstanceUID);
      if (cached) {
        renderImage(cached.data, cached.width, cached.height);
        return;
      }
      
      const response = await fetch(`/api/images/${imageInfo.id}/data`, {
        headers: { 'Range': 'bytes=0-' }
      });
      
      if (!response.ok) {
        throw new Error('Failed to load image data');
      }
      
      const arrayBuffer = await response.arrayBuffer();
      const byteArray = new Uint8Array(arrayBuffer);
      
      // Parse DICOM using dicom-parser
      await loadDicomParser();
      const dataSet = (window as any).dicomParser.parseDicom(byteArray);
      
      const pixelData = dataSet.elements.x7fe00010;
      if (!pixelData) {
        throw new Error('No pixel data found');
      }
      
      const rows = dataSet.uint16('x00280010');
      const columns = dataSet.uint16('x00280011');
      const pixelArray = new Uint16Array(byteArray.buffer, pixelData.dataOffset, pixelData.length / 2);
      
      // Convert to Float32Array for processing
      const floatArray = new Float32Array(pixelArray.length);
      for (let i = 0; i < pixelArray.length; i++) {
        floatArray[i] = pixelArray[i];
      }
      
      // Cache the image data
      setImageCache(prev => new Map(prev.set(imageInfo.sopInstanceUID, {
        data: floatArray,
        width: columns,
        height: rows
      })));
      
      // Render the image
      renderImage(floatArray, columns, rows);
      
    } catch (error) {
      console.error('Error loading image data:', error);
    }
  };

  // Load dicom-parser library
  const loadDicomParser = async () => {
    return new Promise<void>((resolve, reject) => {
      if ((window as any).dicomParser) {
        resolve();
        return;
      }
      
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/dicom-parser@1.8.21/dist/dicomParser.min.js';
      script.onload = () => resolve();
      script.onerror = () => reject();
      document.head.appendChild(script);
    });
  };

  // Render image to canvas
  const renderImage = (pixelData: Float32Array, width: number, height: number) => {
    if (!canvasRef.current) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    canvas.width = width;
    canvas.height = height;
    
    const imageData = ctx.createImageData(width, height);
    const data = imageData.data;
    
    // Apply window/level
    const { center, width: windowWidth } = windowLevel;
    const min = center - windowWidth / 2;
    const max = center + windowWidth / 2;
    
    for (let i = 0; i < pixelData.length; i++) {
      const value = pixelData[i];
      const clampedValue = Math.max(0, Math.min(255, ((value - min) / (max - min)) * 255));
      
      const pixelIndex = i * 4;
      data[pixelIndex] = clampedValue;     // R
      data[pixelIndex + 1] = clampedValue; // G
      data[pixelIndex + 2] = clampedValue; // B
      data[pixelIndex + 3] = 255;          // A
    }
    
    ctx.putImageData(imageData, 0, 0);
    
    // Setup overlay canvas and draw contours
    setupOverlayCanvas();
    redrawContours();
  };

  // Setup overlay canvas for contours
  const setupOverlayCanvas = () => {
    if (!overlayCanvasRef.current || !canvasRef.current) return;
    
    const overlay = overlayCanvasRef.current;
    const main = canvasRef.current;
    
    overlay.width = main.width;
    overlay.height = main.height;
    overlay.style.position = 'absolute';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.pointerEvents = editMode === 'view' ? 'none' : 'auto';
    overlay.style.cursor = getCursor();
    
    const rect = main.getBoundingClientRect();
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;
  };

  // Get cursor based on edit mode
  const getCursor = () => {
    switch (editMode) {
      case 'brush':
        return 'crosshair';
      case 'eraser':
        return 'crosshair';
      default:
        return 'default';
    }
  };

  // Convert screen coordinates to image coordinates
  const screenToImageCoords = useCallback((screenX: number, screenY: number) => {
    if (!canvasRef.current) return { x: 0, y: 0 };
    
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    
    const x = ((screenX - rect.left) / rect.width) * canvas.width;
    const y = ((screenY - rect.top) / rect.height) * canvas.height;
    
    return { x, y };
  }, []);

  // Redraw all contours
  const redrawContours = useCallback(() => {
    if (!overlayCanvasRef.current || !canvasRef.current) return;
    
    const ctx = overlayCanvasRef.current.getContext('2d');
    if (!ctx) return;
    
    ctx.clearRect(0, 0, overlayCanvasRef.current.width, overlayCanvasRef.current.height);
    
    const currentImage = images[currentIndex];
    if (!currentImage) return;
    
    // Draw RT structures from DICOM data
    rtStructures.forEach(structure => {
      if (!structureVisibility.get(structure.roiNumber)) return;
      
      // Find contours for this slice
      const contours = structure.contours?.filter((contour: any) => {
        // Match by slice position (Z coordinate)
        const sliceZ = currentImage.imagePosition?.[2] || currentImage.sliceLocation || 0;
        return Math.abs(contour.slicePosition - sliceZ) < 1.0; // Within 1mm tolerance
      }) || [];
      
      contours.forEach((contour: any) => {
        if (contour.points && contour.points.length >= 6) { // At least 3 points (x,y,z each)
          ctx.strokeStyle = structure.color ? 
            `rgb(${structure.color[0]}, ${structure.color[1]}, ${structure.color[2]})` : 
            '#00ff00';
          ctx.lineWidth = 2;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          
          ctx.beginPath();
          
          // Convert DICOM coordinates to canvas coordinates
          for (let i = 0; i < contour.points.length; i += 3) {
            const x = contour.points[i];
            const y = contour.points[i + 1];
            
            // Convert from DICOM patient coordinates to image pixel coordinates
            const canvasX = (x - (currentImage.imagePosition?.[0] || 0)) / (currentImage.pixelSpacing?.[0] || 1);
            const canvasY = (y - (currentImage.imagePosition?.[1] || 0)) / (currentImage.pixelSpacing?.[1] || 1);
            
            if (i === 0) {
              ctx.moveTo(canvasX, canvasY);
            } else {
              ctx.lineTo(canvasX, canvasY);
            }
          }
          
          ctx.closePath();
          ctx.stroke();
        }
      });
    });
    
    // Draw user-created contour segments
    rtStructures.forEach(structure => {
      if (!structureVisibility.get(structure.roiNumber)) return;
      
      const sliceKey = `${structure.roiNumber}-${currentIndex}`;
      const segments = contourSegments.get(sliceKey) || [];
      
      segments.forEach(segment => {
        if (segment.points.length < 2) return;
        
        ctx.strokeStyle = segment.color;
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        
        ctx.beginPath();
        ctx.moveTo(segment.points[0].x, segment.points[0].y);
        for (let i = 1; i < segment.points.length; i++) {
          ctx.lineTo(segment.points[i].x, segment.points[i].y);
        }
        ctx.stroke();
      });
    });
  }, [contourSegments, currentIndex, rtStructures, structureVisibility, images]);

  // Toggle structure visibility
  const toggleStructureVisibility = (structureId: number) => {
    setStructureVisibility(prev => {
      const newVisibility = new Map(prev);
      newVisibility.set(structureId, !prev.get(structureId));
      return newVisibility;
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-2 text-gray-600">Loading CT images...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center text-red-600">
          <p>Error: {error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-gray-100">
      {/* Main Viewer */}
      <div className="flex-1 flex flex-col">
        {/* Toolbar */}
        <div className="flex items-center justify-between p-4 bg-white border-b">
          <div className="flex items-center gap-4">
            <Badge variant="outline">
              Slice {currentIndex + 1} of {images.length}
            </Badge>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={goToPrevious}
                disabled={currentIndex === 0}
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={goToNext}
                disabled={currentIndex === images.length - 1}
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => setZoom(prev => Math.min(5, prev * 1.25))}
              title="Zoom In"
            >
              <ZoomIn className="w-4 h-4" />
            </Button>
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => setZoom(prev => Math.max(0.1, prev * 0.8))}
              title="Zoom Out"
            >
              <ZoomOut className="w-4 h-4" />
            </Button>
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => {
                setZoom(1);
                setPanX(0);
                setPanY(0);
              }}
              title="Reset Zoom"
            >
              <RotateCcw className="w-4 h-4" />
            </Button>
            <Badge variant="outline" className="ml-2">
              {Math.round(zoom * 100)}%
            </Badge>
          </div>
        </div>

        {/* Canvas Container */}
        <div className="flex-1 relative bg-black overflow-hidden">
          <canvas
            ref={canvasRef}
            className="absolute inset-0 m-auto max-w-full max-h-full"
            style={{ imageRendering: 'pixelated' }}
          />
          <canvas
            ref={overlayCanvasRef}
            className="absolute inset-0 m-auto max-w-full max-h-full z-10"
          />
        </div>
      </div>

      {/* Structure Visibility Panel */}
      <div className="w-80 bg-white border-l flex flex-col">
        <div className="p-4 border-b">
          <h3 className="font-semibold mb-4">RT Structures</h3>
        </div>

        {/* Structure List */}
        <div className="flex-1 p-4 overflow-y-auto">
          <div className="space-y-2">
            {rtStructures.map(structure => (
              <div key={structure.roiNumber} className="flex items-center gap-2 text-sm">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => toggleStructureVisibility(structure.roiNumber)}
                  className="p-1 h-6 w-6"
                >
                  {structureVisibility.get(structure.roiNumber) ? 
                    <Eye className="w-3 h-3" /> : 
                    <EyeOff className="w-3 h-3" />
                  }
                </Button>
                <div 
                  className="w-3 h-3 rounded" 
                  style={{ 
                    backgroundColor: structure.color ? 
                      `rgb(${structure.color[0]}, ${structure.color[1]}, ${structure.color[2]})` : 
                      '#00ff00' 
                  }}
                />
                <span className="truncate">{structure.structureName}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}