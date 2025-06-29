import { useEffect, useRef, useState, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  ChevronLeft, 
  ChevronRight, 
  Brush, 
  Eraser, 
  MousePointer, 
  Undo2, 
  Redo2, 
  Save,
  Eye,
  EyeOff,
  ZoomIn,
  ZoomOut,
  RotateCcw
} from 'lucide-react';

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
  seriesId: number;
  studyId?: number;
  rtStructures?: any[];
}

export function EnhancedViewerWithContours({ seriesId, studyId, rtStructures = [] }: EnhancedViewerProps) {
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
          // Load first image
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

  // Load DICOM image data
  const loadImageData = async (imageInfo: any) => {
    try {
      const response = await fetch(`/api/images/${imageInfo.sopInstanceUID}`);
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
      script.onerror = () => reject(new Error('Failed to load dicom-parser'));
      document.head.appendChild(script);
    });
  };

  // Render DICOM image to canvas
  const renderImage = (pixelData: Float32Array, width: number, height: number) => {
    if (!canvasRef.current) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    canvas.width = width;
    canvas.height = height;
    
    // Apply window/level
    const imageData = ctx.createImageData(width, height);
    const data = imageData.data;
    
    for (let i = 0; i < pixelData.length; i++) {
      const pixelValue = pixelData[i];
      const windowedValue = ((pixelValue - windowLevel.center) / windowLevel.width + 0.5) * 255;
      const clampedValue = Math.max(0, Math.min(255, windowedValue));
      
      const pixelIndex = i * 4;
      data[pixelIndex] = clampedValue;     // R
      data[pixelIndex + 1] = clampedValue; // G
      data[pixelIndex + 2] = clampedValue; // B
      data[pixelIndex + 3] = 255;          // A
    }
    
    ctx.putImageData(imageData, 0, 0);
    
    // Setup overlay canvas
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
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    return {
      x: (screenX - rect.left) * scaleX,
      y: (screenY - rect.top) * scaleY
    };
  }, []);

  // Mouse event handlers for contour editing
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (editMode === 'view' || !selectedStructure) return;
    
    setIsDrawing(true);
    const coords = screenToImageCoords(e.clientX, e.clientY);
    setCurrentStroke([coords]);
    
    // Save state for undo
    const currentState = new Map(contourSegments);
    setUndoStack(prev => [...prev, currentState]);
    setRedoStack([]);
  }, [editMode, selectedStructure, screenToImageCoords, contourSegments]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDrawing || editMode === 'view' || !selectedStructure) return;
    
    const coords = screenToImageCoords(e.clientX, e.clientY);
    setCurrentStroke(prev => [...prev, coords]);
    
    // Real-time drawing preview
    drawStrokePreview(coords);
  }, [isDrawing, editMode, selectedStructure, screenToImageCoords]);

  const handleMouseUp = useCallback(() => {
    if (!isDrawing || currentStroke.length === 0) return;
    
    setIsDrawing(false);
    
    // Convert stroke to contour segment
    const selectedStructureData = rtStructures.find(s => s.roiNumber === selectedStructure);
    if (selectedStructureData && selectedStructure !== null) {
      const newSegment: ContourSegment = {
        points: currentStroke,
        structureId: selectedStructure,
        sliceIndex: currentIndex,
        color: selectedStructureData.color ? 
          `rgb(${selectedStructureData.color[0]}, ${selectedStructureData.color[1]}, ${selectedStructureData.color[2]})` : 
          '#00ff00',
        name: selectedStructureData.structureName || `Structure ${selectedStructure}`
      };
      
      const sliceKey = `${selectedStructure}-${currentIndex}`;
      const existingSegments = contourSegments.get(sliceKey) || [];
      
      if (editMode === 'brush') {
        setContourSegments(prev => new Map(prev.set(sliceKey, [...existingSegments, newSegment])));
      } else if (editMode === 'eraser') {
        // Remove overlapping contours (simplified implementation)
        const filteredSegments = existingSegments.filter(segment => 
          !segmentsOverlap(segment, newSegment)
        );
        setContourSegments(prev => new Map(prev.set(sliceKey, filteredSegments)));
      }
    }
    
    setCurrentStroke([]);
    redrawContours();
  }, [isDrawing, currentStroke, selectedStructure, currentIndex, rtStructures, contourSegments, editMode]);

  // Draw stroke preview
  const drawStrokePreview = (currentPoint: ContourPoint) => {
    if (!overlayCanvasRef.current) return;
    
    const ctx = overlayCanvasRef.current.getContext('2d');
    if (!ctx) return;
    
    ctx.clearRect(0, 0, overlayCanvasRef.current.width, overlayCanvasRef.current.height);
    
    // Draw existing contours first
    redrawContours();
    
    // Draw current stroke
    if (currentStroke.length > 1) {
      const selectedStructureData = rtStructures.find(s => s.roiNumber === selectedStructure);
      const color = selectedStructureData?.color ? 
        `rgba(${selectedStructureData.color[0]}, ${selectedStructureData.color[1]}, ${selectedStructureData.color[2]}, ${brushSettings.opacity})` : 
        `rgba(0, 255, 0, ${brushSettings.opacity})`;
      
      ctx.strokeStyle = editMode === 'eraser' ? 'rgba(255, 0, 0, 0.5)' : color;
      ctx.lineWidth = brushSettings.size;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      
      ctx.beginPath();
      ctx.moveTo(currentStroke[0].x, currentStroke[0].y);
      for (let i = 1; i < currentStroke.length; i++) {
        ctx.lineTo(currentStroke[i].x, currentStroke[i].y);
      }
      ctx.lineTo(currentPoint.x, currentPoint.y);
      ctx.stroke();
    }
  };

  // Check if two segments overlap (simplified)
  const segmentsOverlap = (segment1: ContourSegment, segment2: ContourSegment): boolean => {
    const getBounds = (points: ContourPoint[]) => {
      const xs = points.map(p => p.x);
      const ys = points.map(p => p.y);
      return {
        minX: Math.min(...xs),
        maxX: Math.max(...xs),
        minY: Math.min(...ys),
        maxY: Math.max(...ys)
      };
    };
    
    const bounds1 = getBounds(segment1.points);
    const bounds2 = getBounds(segment2.points);
    
    return !(bounds1.maxX < bounds2.minX || bounds2.maxX < bounds1.minX || 
             bounds1.maxY < bounds2.minY || bounds2.maxY < bounds1.minY);
  };

  // Redraw all contours
  const redrawContours = useCallback(() => {
    if (!overlayCanvasRef.current) return;
    
    const ctx = overlayCanvasRef.current.getContext('2d');
    if (!ctx) return;
    
    ctx.clearRect(0, 0, overlayCanvasRef.current.width, overlayCanvasRef.current.height);
    
    // Draw all visible contours for current slice
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
  }, [contourSegments, currentIndex, rtStructures, structureVisibility]);

  // Navigation functions
  const goToPrevious = () => {
    if (currentIndex > 0) {
      const newIndex = currentIndex - 1;
      setCurrentIndex(newIndex);
      loadImageData(images[newIndex]);
    }
  };

  const goToNext = () => {
    if (currentIndex < images.length - 1) {
      const newIndex = currentIndex + 1;
      setCurrentIndex(newIndex);
      loadImageData(images[newIndex]);
    }
  };

  // Undo/Redo functions
  const handleUndo = () => {
    if (undoStack.length === 0) return;
    
    setRedoStack(prev => [...prev, new Map(contourSegments)]);
    const previousState = undoStack[undoStack.length - 1];
    setUndoStack(prev => prev.slice(0, -1));
    setContourSegments(new Map(previousState));
  };

  const handleRedo = () => {
    if (redoStack.length === 0) return;
    
    setUndoStack(prev => [...prev, new Map(contourSegments)]);
    const nextState = redoStack[redoStack.length - 1];
    setRedoStack(prev => prev.slice(0, -1));
    setContourSegments(new Map(nextState));
  };

  // Save contours
  const handleSave = async () => {
    try {
      const contoursToSave = Array.from(contourSegments.entries()).map(([key, segments]) => ({
        key,
        segments
      }));
      
      const response = await fetch('/api/contours/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contours: contoursToSave,
          studyId: studyId
        })
      });
      
      if (response.ok) {
        console.log('Contours saved successfully');
      }
    } catch (error) {
      console.error('Error saving contours:', error);
    }
  };

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
            <Button variant="outline" size="sm">
              <ZoomIn className="w-4 h-4" />
            </Button>
            <Button variant="outline" size="sm">
              <ZoomOut className="w-4 h-4" />
            </Button>
            <Button variant="outline" size="sm">
              <RotateCcw className="w-4 h-4" />
            </Button>
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
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={() => setIsDrawing(false)}
          />
        </div>
      </div>

      {/* Contour Editing Panel */}
      <div className="w-80 bg-white border-l flex flex-col">
        <div className="p-4 border-b">
          <h3 className="font-semibold mb-4">Contour Editor</h3>
          
          {/* Tool Selection */}
          <div className="flex gap-2 mb-4">
            <Button
              variant={editMode === 'view' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setEditMode('view')}
            >
              <MousePointer className="w-4 h-4" />
            </Button>
            <Button
              variant={editMode === 'brush' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setEditMode('brush')}
            >
              <Brush className="w-4 h-4" />
            </Button>
            <Button
              variant={editMode === 'eraser' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setEditMode('eraser')}
            >
              <Eraser className="w-4 h-4" />
            </Button>
          </div>

          {/* Structure Selection */}
          <div className="mb-4">
            <label className="text-sm font-medium mb-2 block">Active Structure</label>
            <Select value={selectedStructure?.toString()} onValueChange={(value) => setSelectedStructure(parseInt(value))}>
              <SelectTrigger>
                <SelectValue placeholder="Select structure to edit" />
              </SelectTrigger>
              <SelectContent>
                {rtStructures.map(structure => (
                  <SelectItem key={structure.roiNumber} value={structure.roiNumber.toString()}>
                    <div className="flex items-center gap-2">
                      <div 
                        className="w-3 h-3 rounded" 
                        style={{ 
                          backgroundColor: structure.color ? 
                            `rgb(${structure.color[0]}, ${structure.color[1]}, ${structure.color[2]})` : 
                            '#00ff00' 
                        }}
                      />
                      {structure.structureName}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Brush Settings */}
          {(editMode === 'brush' || editMode === 'eraser') && (
            <div className="space-y-3 mb-4">
              <div>
                <label className="text-sm font-medium mb-2 block">Brush Size</label>
                <Slider
                  value={[brushSettings.size]}
                  onValueChange={(value) => setBrushSettings(prev => ({ ...prev, size: value[0] }))}
                  min={1}
                  max={50}
                  step={1}
                  className="w-full"
                />
                <div className="text-xs text-gray-400 mt-1">{brushSettings.size}px</div>
              </div>
              
              <div>
                <label className="text-sm font-medium mb-2 block">Opacity</label>
                <Slider
                  value={[brushSettings.opacity * 100]}
                  onValueChange={(value) => setBrushSettings(prev => ({ ...prev, opacity: value[0] / 100 }))}
                  min={10}
                  max={100}
                  step={5}
                  className="w-full"
                />
                <div className="text-xs text-gray-400 mt-1">{Math.round(brushSettings.opacity * 100)}%</div>
              </div>
            </div>
          )}

          <Separator className="my-4" />

          {/* Action Buttons */}
          <div className="flex gap-2 mb-4">
            <Button
              variant="outline"
              size="sm"
              onClick={handleUndo}
              disabled={undoStack.length === 0}
            >
              <Undo2 className="w-4 h-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRedo}
              disabled={redoStack.length === 0}
            >
              <Redo2 className="w-4 h-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleSave}
            >
              <Save className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Structure Visibility */}
        <div className="flex-1 p-4 overflow-y-auto">
          <h4 className="font-medium mb-3">Structures</h4>
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