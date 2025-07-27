import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Wand2, MousePointer, Check, X, Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

interface SAMSegmentationToolProps {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  isActive: boolean;
  selectedStructure: number;
  rtStructures: any;
  currentSlicePosition: number;
  onContourUpdate: (payload: any) => void;
  imageMetadata: any;
  worldToCanvas: (worldX: number, worldY: number) => { x: number; y: number };
  canvasToWorld: (canvasX: number, canvasY: number) => { x: number; y: number };
  ctTransform: React.RefObject<any>;
}

interface SegmentPoint {
  x: number;
  y: number;
  type: 'include' | 'exclude';
  canvasX: number;
  canvasY: number;
}

export function SAMSegmentationTool({
  canvasRef,
  isActive,
  selectedStructure,
  rtStructures,
  currentSlicePosition,
  onContourUpdate,
  imageMetadata,
  worldToCanvas,
  canvasToWorld,
  ctTransform
}: SAMSegmentationToolProps) {
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const [segmentPoints, setSegmentPoints] = useState<SegmentPoint[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [previewContour, setPreviewContour] = useState<number[] | null>(null);
  const [mode, setMode] = useState<'include' | 'exclude'>('include');
  const [showPreview, setShowPreview] = useState(false);

  // Initialize overlay canvas
  useEffect(() => {
    if (!canvasRef.current || !overlayCanvasRef.current || !isActive) return;

    const canvas = canvasRef.current;
    const overlay = overlayCanvasRef.current;

    // Match overlay canvas size to main canvas
    overlay.width = canvas.width;
    overlay.height = canvas.height;
    overlay.style.width = canvas.style.width;
    overlay.style.height = canvas.style.height;
  }, [canvasRef, isActive]);

  // Draw segment points and preview
  useEffect(() => {
    if (!overlayCanvasRef.current || !isActive) return;

    const ctx = overlayCanvasRef.current.getContext('2d');
    if (!ctx) return;

    // Clear overlay
    ctx.clearRect(0, 0, overlayCanvasRef.current.width, overlayCanvasRef.current.height);

    // Draw segment points
    segmentPoints.forEach(point => {
      ctx.save();
      
      // Draw point marker
      ctx.beginPath();
      ctx.arc(point.canvasX, point.canvasY, 8, 0, 2 * Math.PI);
      
      if (point.type === 'include') {
        ctx.fillStyle = 'rgba(34, 197, 94, 0.8)'; // Green for include
        ctx.strokeStyle = '#22c55e';
      } else {
        ctx.fillStyle = 'rgba(239, 68, 68, 0.8)'; // Red for exclude
        ctx.strokeStyle = '#ef4444';
      }
      
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.stroke();
      
      // Draw icon in center
      ctx.fillStyle = 'white';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(point.type === 'include' ? '+' : '-', point.canvasX, point.canvasY);
      
      ctx.restore();
    });

    // Draw preview contour if available
    if (previewContour && previewContour.length > 0) {
      const structure = rtStructures?.structures?.find((s: any) => s.roiNumber === selectedStructure);
      if (!structure) return;

      ctx.save();
      ctx.strokeStyle = structure.color || '#00ff00';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.globalAlpha = 0.7;

      ctx.beginPath();
      for (let i = 0; i < previewContour.length; i += 3) {
        const worldX = previewContour[i];
        const worldY = previewContour[i + 1];
        const canvasCoords = worldToCanvas(worldX, worldY);
        
        if (i === 0) {
          ctx.moveTo(canvasCoords.x, canvasCoords.y);
        } else {
          ctx.lineTo(canvasCoords.x, canvasCoords.y);
        }
      }
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }
  }, [segmentPoints, previewContour, isActive, selectedStructure, rtStructures, worldToCanvas]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isActive || isProcessing) return;

    const rect = overlayCanvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const canvasX = e.clientX - rect.left;
    const canvasY = e.clientY - rect.top;
    const worldCoords = canvasToWorld(canvasX, canvasY);

    const newPoint: SegmentPoint = {
      x: worldCoords.x,
      y: worldCoords.y,
      type: mode,
      canvasX,
      canvasY
    };

    setSegmentPoints(prev => [...prev, newPoint]);
  };

  const handleRightClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (!isActive) return;

    // Toggle mode on right click
    setMode(prev => prev === 'include' ? 'exclude' : 'include');
  };

  // Simulate SAM segmentation (in real implementation, this would call an AI model)
  const runSegmentation = async () => {
    if (segmentPoints.length === 0) return;

    setIsProcessing(true);
    setShowPreview(true);

    // Simulate processing delay
    await new Promise(resolve => setTimeout(resolve, 500));

    // Create a simulated segmentation based on include/exclude points
    // In real implementation, this would use the actual SAM model
    const includePoints = segmentPoints.filter(p => p.type === 'include');
    const excludePoints = segmentPoints.filter(p => p.type === 'exclude');

    if (includePoints.length > 0) {
      // Create a polygon around include points with some expansion
      const contourPoints: number[] = [];
      const expansionRadius = 30; // mm in world space

      // Create a circular contour around the first include point as demo
      const centerPoint = includePoints[0];
      const numPoints = 32;

      for (let i = 0; i < numPoints; i++) {
        const angle = (i / numPoints) * 2 * Math.PI;
        const x = centerPoint.x + expansionRadius * Math.cos(angle);
        const y = centerPoint.y + expansionRadius * Math.sin(angle);
        contourPoints.push(x, y, currentSlicePosition);
      }

      // Apply exclusions by modifying the contour
      // In real implementation, SAM would handle this automatically
      excludePoints.forEach(excludePoint => {
        // Simple demo: remove points near exclude markers
        for (let i = contourPoints.length - 3; i >= 0; i -= 3) {
          const dx = contourPoints[i] - excludePoint.x;
          const dy = contourPoints[i + 1] - excludePoint.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < expansionRadius * 0.5) {
            contourPoints.splice(i, 3);
          }
        }
      });

      setPreviewContour(contourPoints);
    }

    setIsProcessing(false);
  };

  const acceptSegmentation = () => {
    if (!previewContour || previewContour.length === 0) return;

    // Add the SAM-generated contour
    onContourUpdate({
      action: 'add_contour',
      structureId: selectedStructure,
      contour: {
        slicePosition: currentSlicePosition,
        points: previewContour,
        numberOfPoints: previewContour.length / 3,
        source: 'sam_segmentation'
      }
    });

    // Clear state
    clearSegmentation();
  };

  const clearSegmentation = () => {
    setSegmentPoints([]);
    setPreviewContour(null);
    setShowPreview(false);
  };

  if (!isActive) return null;

  return (
    <>
      {/* Overlay canvas for drawing segment points */}
      <canvas
        ref={overlayCanvasRef}
        onClick={handleCanvasClick}
        onContextMenu={handleRightClick}
        className="absolute inset-0 pointer-events-auto cursor-crosshair"
        style={{ 
          zIndex: 20,
          mixBlendMode: 'normal'
        }}
      />

      {/* Control panel */}
      <Card className="absolute bottom-4 left-1/2 transform -translate-x-1/2 bg-gray-900/95 border-indigo-600 p-3 z-30">
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-2">
            <Badge 
              variant="outline" 
              className={cn(
                "cursor-pointer transition-colors",
                mode === 'include' 
                  ? "bg-green-900 border-green-600 text-green-300" 
                  : "bg-gray-800 border-gray-600 text-gray-400"
              )}
              onClick={() => setMode('include')}
            >
              <MousePointer className="w-3 h-3 mr-1" />
              Include (+)
            </Badge>
            <Badge 
              variant="outline" 
              className={cn(
                "cursor-pointer transition-colors",
                mode === 'exclude' 
                  ? "bg-red-900 border-red-600 text-red-300" 
                  : "bg-gray-800 border-gray-600 text-gray-400"
              )}
              onClick={() => setMode('exclude')}
            >
              <X className="w-3 h-3 mr-1" />
              Exclude (-)
            </Badge>
          </div>

          <div className="w-px h-6 bg-gray-700" />

          <div className="flex items-center space-x-2">
            {segmentPoints.length > 0 && (
              <Badge variant="secondary" className="bg-indigo-900 text-indigo-200">
                {segmentPoints.length} points
              </Badge>
            )}

            <Button
              size="sm"
              onClick={runSegmentation}
              disabled={segmentPoints.length === 0 || isProcessing}
              className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                  Processing
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-1" />
                  Run SAM
                </>
              )}
            </Button>

            {showPreview && previewContour && (
              <>
                <Button
                  size="sm"
                  variant="default"
                  onClick={acceptSegmentation}
                  className="bg-green-600 hover:bg-green-700"
                >
                  <Check className="w-4 h-4 mr-1" />
                  Accept
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={clearSegmentation}
                >
                  <X className="w-4 h-4 mr-1" />
                  Clear
                </Button>
              </>
            )}

            {!showPreview && segmentPoints.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={clearSegmentation}
                className="border-gray-600 hover:bg-gray-800"
              >
                Clear
              </Button>
            )}
          </div>
        </div>

        <div className="mt-2 text-xs text-gray-400">
          <span className="font-medium">Left click:</span> Add {mode} point • 
          <span className="font-medium ml-2">Right click:</span> Toggle mode • 
          <span className="font-medium ml-2">SAM:</span> AI-powered segmentation
        </div>
      </Card>
    </>
  );
}