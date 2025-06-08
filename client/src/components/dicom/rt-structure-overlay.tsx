import { useState, useRef, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Slider } from '@/components/ui/slider';
import { Eye, EyeOff, Layers } from 'lucide-react';

export interface RTStructure {
  roiNumber: number;
  roiName: string;
  roiType: string;
  color: [number, number, number];
  contours: RTContour[];
  isVisible?: boolean;
  opacity?: number;
}

export interface RTContour {
  contourNumber: number;
  geometricType: string;
  numberOfPoints: number;
  contourData: number[][]; // [x,y,z] coordinates
  sliceLocation?: number;
}

interface RTStructureOverlayProps {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  structures: RTStructure[];
  currentSliceLocation: number;
  imageToCanvasTransform?: {
    scaleX: number;
    scaleY: number;
    offsetX: number;
    offsetY: number;
  };
  isVisible: boolean;
  onStructureVisibilityChange?: (roiNumber: number, visible: boolean) => void;
  onClose?: () => void;
}

export function RTStructureOverlay({
  canvasRef,
  structures,
  currentSliceLocation,
  imageToCanvasTransform,
  isVisible,
  onStructureVisibilityChange,
  onClose
}: RTStructureOverlayProps) {
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const [structureStates, setStructureStates] = useState<Map<number, { visible: boolean; opacity: number }>>(
    new Map(structures.map(s => [s.roiNumber, { visible: s.isVisible ?? true, opacity: s.opacity ?? 0.8 }]))
  );
  const [globalOpacity, setGlobalOpacity] = useState(80);

  useEffect(() => {
    if (!overlayRef.current || !canvasRef.current) return;

    const overlay = overlayRef.current;
    const mainCanvas = canvasRef.current;
    
    overlay.width = mainCanvas.width;
    overlay.height = mainCanvas.height;
    overlay.style.width = mainCanvas.style.width;
    overlay.style.height = mainCanvas.style.height;

    if (isVisible) {
      drawStructures();
    } else {
      clearOverlay();
    }
  }, [structures, currentSliceLocation, structureStates, globalOpacity, isVisible, imageToCanvasTransform]);

  const clearOverlay = () => {
    if (!overlayRef.current) return;
    const ctx = overlayRef.current.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, overlayRef.current.width, overlayRef.current.height);
    }
  };

  const drawStructures = () => {
    if (!overlayRef.current) return;
    
    const ctx = overlayRef.current.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, overlayRef.current.width, overlayRef.current.height);

    structures.forEach(structure => {
      const state = structureStates.get(structure.roiNumber);
      if (!state?.visible) return;

      const opacity = (state.opacity * globalOpacity) / 100;
      drawStructureContours(ctx, structure, currentSliceLocation, opacity);
    });
  };

  const drawStructureContours = (
    ctx: CanvasRenderingContext2D,
    structure: RTStructure,
    sliceLocation: number,
    opacity: number
  ) => {
    const tolerance = 5.0; // 5mm tolerance for slice matching
    const [r, g, b] = structure.color;
    
    // Find contours that match the current slice location
    const matchingContours = structure.contours.filter(contour => 
      contour.sliceLocation !== undefined &&
      Math.abs(contour.sliceLocation - sliceLocation) <= tolerance
    );

    if (matchingContours.length === 0) return;

    ctx.globalAlpha = opacity;
    ctx.strokeStyle = `rgb(${r}, ${g}, ${b})`;
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.3)`;
    ctx.lineWidth = 2;

    matchingContours.forEach(contour => {
      if (contour.contourData.length < 3) return;

      ctx.beginPath();
      
      // Convert world coordinates to canvas coordinates
      const firstPoint = worldToCanvas(contour.contourData[0]);
      ctx.moveTo(firstPoint.x, firstPoint.y);

      // Draw contour lines
      for (let i = 1; i < contour.contourData.length; i++) {
        const point = worldToCanvas(contour.contourData[i]);
        ctx.lineTo(point.x, point.y);
      }

      // Close the contour
      ctx.closePath();
      
      // Fill the contour
      ctx.fill();
      
      // Stroke the outline
      ctx.stroke();
    });

    ctx.globalAlpha = 1.0;
  };

  const worldToCanvas = (worldPoint: number[]): { x: number; y: number } => {
    // Convert DICOM world coordinates to canvas pixel coordinates
    // This is a simplified transformation - in production you'd use the actual
    // image position and orientation matrices from the DICOM headers
    
    if (imageToCanvasTransform) {
      return {
        x: worldPoint[0] * imageToCanvasTransform.scaleX + imageToCanvasTransform.offsetX,
        y: worldPoint[1] * imageToCanvasTransform.scaleY + imageToCanvasTransform.offsetY
      };
    }

    // Default transformation assuming image center is at canvas center
    const canvasWidth = overlayRef.current?.width || 512;
    const canvasHeight = overlayRef.current?.height || 512;
    
    return {
      x: (worldPoint[0] + 250) * (canvasWidth / 500), // Assuming 500mm FOV
      y: (worldPoint[1] + 250) * (canvasHeight / 500)
    };
  };

  const toggleStructureVisibility = (roiNumber: number) => {
    setStructureStates(prev => {
      const newStates = new Map(prev);
      const current = newStates.get(roiNumber) || { visible: true, opacity: 0.8 };
      newStates.set(roiNumber, { ...current, visible: !current.visible });
      
      if (onStructureVisibilityChange) {
        onStructureVisibilityChange(roiNumber, !current.visible);
      }
      
      return newStates;
    });
  };

  const setStructureOpacity = (roiNumber: number, opacity: number) => {
    setStructureStates(prev => {
      const newStates = new Map(prev);
      const current = newStates.get(roiNumber) || { visible: true, opacity: 0.8 };
      newStates.set(roiNumber, { ...current, opacity: opacity / 100 });
      return newStates;
    });
  };

  if (!isVisible) return null;

  return (
    <>
      <canvas
        ref={overlayRef}
        className="absolute top-0 left-0 pointer-events-none"
        style={{ zIndex: 15 }}
      />
      
      {/* Structure Control Panel */}
      <div className="fixed top-4 left-4 z-50 max-w-xs">
        <Card className="bg-black/90 border-purple-500/50 p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center">
              <Layers className="w-4 h-4 mr-2 text-purple-400" />
              <h3 className="text-purple-300 font-semibold text-sm">RT Structures</h3>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="text-gray-400 hover:text-white p-1"
            >
              ×
            </Button>
          </div>

          {/* Global Opacity Control */}
          <div className="mb-4">
            <div className="flex items-center justify-between text-xs text-gray-300 mb-1">
              <span>Global Opacity</span>
              <span>{globalOpacity}%</span>
            </div>
            <Slider
              value={[globalOpacity]}
              onValueChange={(value) => setGlobalOpacity(value[0])}
              max={100}
              step={10}
              className="w-full"
            />
          </div>

          {/* Structure List */}
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {structures.map(structure => {
              const state = structureStates.get(structure.roiNumber);
              const [r, g, b] = structure.color;
              
              return (
                <div key={structure.roiNumber} className="space-y-1">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      checked={state?.visible ?? true}
                      onCheckedChange={() => toggleStructureVisibility(structure.roiNumber)}
                      className="w-3 h-3"
                    />
                    <div 
                      className="w-3 h-3 rounded-sm border border-gray-500"
                      style={{ backgroundColor: `rgb(${r}, ${g}, ${b})` }}
                    />
                    <span className="text-xs text-white truncate flex-1" title={structure.roiName}>
                      {structure.roiName}
                    </span>
                    <span className="text-xs text-gray-400 font-mono">
                      {structure.roiType}
                    </span>
                  </div>
                  
                  {state?.visible && (
                    <div className="ml-5">
                      <div className="flex items-center space-x-2">
                        <span className="text-xs text-gray-400 w-12">Opacity</span>
                        <Slider
                          value={[(state.opacity * 100)]}
                          onValueChange={(value) => setStructureOpacity(structure.roiNumber, value[0])}
                          max={100}
                          step={10}
                          className="flex-1"
                        />
                        <span className="text-xs text-gray-400 w-8">
                          {Math.round(state.opacity * 100)}%
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-3 pt-2 border-t border-gray-700 text-xs text-gray-400">
            Slice: {currentSliceLocation.toFixed(1)}mm
          </div>
        </Card>
      </div>
    </>
  );
}