import { useEffect, useRef, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  Brush, 
  Eraser, 
  Circle, 
  Square, 
  MousePointer, 
  Undo2, 
  Redo2, 
  Save,
  Eye,
  EyeOff,
  Settings,
  Palette
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
  hardness: number;
  opacity: number;
  mode: 'paint' | 'erase' | 'smart';
}

interface ContourEditorProps {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  currentImage: any;
  currentSliceIndex: number;
  rtStructures: any[];
  structureVisibility: Map<number, boolean>;
  onStructureUpdate: (structureId: number, contours: ContourSegment[]) => void;
  onVisibilityToggle: (structureId: number) => void;
}

export function ContourEditor({
  canvasRef,
  currentImage,
  currentSliceIndex,
  rtStructures,
  structureVisibility,
  onStructureUpdate,
  onVisibilityToggle
}: ContourEditorProps) {
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const [editMode, setEditMode] = useState<'view' | 'brush' | 'eraser' | 'polygon' | 'circle'>('view');
  const [selectedStructure, setSelectedStructure] = useState<number | null>(null);
  const [brushSettings, setBrushSettings] = useState<BrushSettings>({
    size: 10,
    hardness: 0.8,
    opacity: 1.0,
    mode: 'paint'
  });
  
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentStroke, setCurrentStroke] = useState<ContourPoint[]>([]);
  const [contourSegments, setContourSegments] = useState<Map<string, ContourSegment[]>>(new Map());
  const [undoStack, setUndoStack] = useState<Map<string, ContourSegment[]>[]>([]);
  const [redoStack, setRedoStack] = useState<Map<string, ContourSegment[]>[]>([]);

  // Initialize overlay canvas
  useEffect(() => {
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
    
    // Position overlay canvas
    const rect = main.getBoundingClientRect();
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;
  }, [editMode, brushSettings.size]);

  const getCursor = () => {
    switch (editMode) {
      case 'brush':
        const brushSvg = `<svg width="${brushSettings.size * 2}" height="${brushSettings.size * 2}" xmlns="http://www.w3.org/2000/svg">
            <circle cx="${brushSettings.size}" cy="${brushSettings.size}" r="${brushSettings.size - 1}" 
                    fill="none" stroke="white" stroke-width="2" opacity="0.8"/>
            <circle cx="${brushSettings.size}" cy="${brushSettings.size}" r="${brushSettings.size - 1}" 
                    fill="none" stroke="black" stroke-width="1" opacity="0.8"/>
          </svg>`;
        return `url("data:image/svg+xml,${encodeURIComponent(brushSvg)}") ${brushSettings.size} ${brushSettings.size}, crosshair`;
      case 'eraser':
        const eraserSvg = `<svg width="${brushSettings.size * 2}" height="${brushSettings.size * 2}" xmlns="http://www.w3.org/2000/svg">
            <circle cx="${brushSettings.size}" cy="${brushSettings.size}" r="${brushSettings.size - 1}" 
                    fill="none" stroke="red" stroke-width="2" opacity="0.8"/>
          </svg>`;
        return `url("data:image/svg+xml,${encodeURIComponent(eraserSvg)}") ${brushSettings.size} ${brushSettings.size}, crosshair`;
      default:
        return 'crosshair';
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

  // Handle mouse down - start drawing
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (editMode === 'view' || !selectedStructure) return;
    
    setIsDrawing(true);
    const coords = screenToImageCoords(e.clientX, e.clientY);
    setCurrentStroke([coords]);
    
    // Save state for undo
    const currentState = new Map(contourSegments);
    setUndoStack(prev => [...prev, currentState]);
    setRedoStack([]); // Clear redo stack when new action starts
  }, [editMode, selectedStructure, screenToImageCoords, contourSegments]);

  // Handle mouse move - continue drawing
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDrawing || editMode === 'view' || !selectedStructure) return;
    
    const coords = screenToImageCoords(e.clientX, e.clientY);
    setCurrentStroke(prev => [...prev, coords]);
    
    // Real-time drawing preview
    drawStrokePreview(coords);
  }, [isDrawing, editMode, selectedStructure, screenToImageCoords]);

  // Handle mouse up - finish drawing
  const handleMouseUp = useCallback(() => {
    if (!isDrawing || currentStroke.length === 0) return;
    
    setIsDrawing(false);
    
    // Convert stroke to contour segment
    const selectedStructureData = rtStructures.find(s => s.roiNumber === selectedStructure);
    if (selectedStructureData) {
      const newSegment: ContourSegment = {
        points: currentStroke,
        structureId: selectedStructure!,
        sliceIndex: currentSliceIndex,
        color: selectedStructureData.color ? 
          `rgb(${selectedStructureData.color[0]}, ${selectedStructureData.color[1]}, ${selectedStructureData.color[2]})` : 
          '#00ff00',
        name: selectedStructureData.structureName || `Structure ${selectedStructure}`
      };
      
      // Add to contour segments
      const sliceKey = `${selectedStructure}-${currentSliceIndex}`;
      const existingSegments = contourSegments.get(sliceKey) || [];
      
      if (editMode === 'brush') {
        // Add new contour
        setContourSegments(prev => new Map(prev.set(sliceKey, [...existingSegments, newSegment])));
      } else if (editMode === 'eraser') {
        // Remove overlapping contours
        const filteredSegments = existingSegments.filter(segment => 
          !segmentsOverlap(segment, newSegment)
        );
        setContourSegments(prev => new Map(prev.set(sliceKey, filteredSegments)));
      }
      
      // Notify parent component
      if (selectedStructure !== null) {
        onStructureUpdate(selectedStructure, contourSegments.get(sliceKey) || []);
      }
    }
    
    setCurrentStroke([]);
    redrawContours();
  }, [isDrawing, currentStroke, selectedStructure, currentSliceIndex, rtStructures, contourSegments, editMode, onStructureUpdate]);

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
    // Simple bounding box overlap check
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

  // Redraw all contours on overlay
  const redrawContours = useCallback(() => {
    if (!overlayCanvasRef.current) return;
    
    const ctx = overlayCanvasRef.current.getContext('2d');
    if (!ctx) return;
    
    ctx.clearRect(0, 0, overlayCanvasRef.current.width, overlayCanvasRef.current.height);
    
    // Draw all visible contours for current slice
    rtStructures.forEach(structure => {
      if (!structureVisibility.get(structure.roiNumber)) return;
      
      const sliceKey = `${structure.roiNumber}-${currentSliceIndex}`;
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
  }, [contourSegments, currentSliceIndex, rtStructures, structureVisibility]);

  // Redraw contours when slice changes
  useEffect(() => {
    redrawContours();
  }, [currentSliceIndex, redrawContours]);

  // Undo functionality
  const handleUndo = () => {
    if (undoStack.length === 0) return;
    
    setRedoStack(prev => [...prev, new Map(contourSegments)]);
    const previousState = undoStack[undoStack.length - 1];
    setUndoStack(prev => prev.slice(0, -1));
    setContourSegments(new Map(previousState));
  };

  // Redo functionality
  const handleRedo = () => {
    if (redoStack.length === 0) return;
    
    setUndoStack(prev => [...prev, new Map(contourSegments)]);
    const nextState = redoStack[redoStack.length - 1];
    setRedoStack(prev => prev.slice(0, -1));
    setContourSegments(new Map(nextState));
  };

  // Save contours to backend
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
          studyId: currentImage?.studyId
        })
      });
      
      if (response.ok) {
        console.log('Contours saved successfully');
      }
    } catch (error) {
      console.error('Error saving contours:', error);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Overlay Canvas */}
      <canvas
        ref={overlayCanvasRef}
        className="absolute top-0 left-0 z-10"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => setIsDrawing(false)}
      />
      
      {/* Tools Panel */}
      <div className="flex flex-col gap-4 p-4 bg-gray-900 text-white">
        {/* Tool Selection */}
        <div className="flex gap-2">
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
          <Button
            variant={editMode === 'polygon' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setEditMode('polygon')}
          >
            <Square className="w-4 h-4" />
          </Button>
          <Button
            variant={editMode === 'circle' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setEditMode('circle')}
          >
            <Circle className="w-4 h-4" />
          </Button>
        </div>

        <Separator />

        {/* Structure Selection */}
        <div>
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
          <div className="space-y-3">
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

        <Separator />

        {/* Action Buttons */}
        <div className="flex gap-2">
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

        {/* Structure Visibility */}
        <div>
          <label className="text-sm font-medium mb-2 block">Structure Visibility</label>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {rtStructures.map(structure => (
              <div key={structure.roiNumber} className="flex items-center gap-2 text-xs">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onVisibilityToggle(structure.roiNumber)}
                  className="p-1 h-6 w-6"
                >
                  {structureVisibility.get(structure.roiNumber) ? 
                    <Eye className="w-3 h-3" /> : 
                    <EyeOff className="w-3 h-3" />
                  }
                </Button>
                <div 
                  className="w-2 h-2 rounded" 
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