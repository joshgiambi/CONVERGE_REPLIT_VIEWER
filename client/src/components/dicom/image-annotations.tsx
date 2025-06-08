import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

interface Annotation {
  id: string;
  x: number;
  y: number;
  text: string;
  timestamp: Date;
  type: 'arrow' | 'text' | 'measurement';
}

interface ImageAnnotationsProps {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  isActive: boolean;
  onAnnotationAdd?: (annotation: Annotation) => void;
}

export function ImageAnnotations({ canvasRef, isActive, onAnnotationAdd }: ImageAnnotationsProps) {
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [isAddingAnnotation, setIsAddingAnnotation] = useState(false);
  const [pendingPosition, setPendingPosition] = useState<{ x: number; y: number } | null>(null);
  const [annotationText, setAnnotationText] = useState('');
  const overlayRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!overlayRef.current || !canvasRef.current) return;

    const overlay = overlayRef.current;
    const mainCanvas = canvasRef.current;
    
    overlay.width = mainCanvas.width;
    overlay.height = mainCanvas.height;
    overlay.style.width = mainCanvas.style.width;
    overlay.style.height = mainCanvas.style.height;

    redrawAnnotations();
  }, [annotations]);

  const redrawAnnotations = () => {
    if (!overlayRef.current) return;
    
    const ctx = overlayRef.current.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, overlayRef.current.width, overlayRef.current.height);
    
    annotations.forEach(annotation => {
      drawAnnotation(ctx, annotation);
    });
  };

  const drawAnnotation = (ctx: CanvasRenderingContext2D, annotation: Annotation) => {
    ctx.strokeStyle = '#00ff00';
    ctx.fillStyle = '#00ff00';
    ctx.lineWidth = 2;
    ctx.font = '14px Arial';

    // Draw arrow pointer
    const arrowSize = 8;
    ctx.beginPath();
    ctx.moveTo(annotation.x, annotation.y);
    ctx.lineTo(annotation.x - arrowSize, annotation.y - arrowSize);
    ctx.moveTo(annotation.x, annotation.y);
    ctx.lineTo(annotation.x + arrowSize, annotation.y - arrowSize);
    ctx.stroke();

    // Draw text background
    const textMetrics = ctx.measureText(annotation.text);
    const textWidth = textMetrics.width;
    const textHeight = 16;
    const padding = 4;
    
    const textX = annotation.x + 15;
    const textY = annotation.y - 10;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.fillRect(textX - padding, textY - textHeight - padding, textWidth + padding * 2, textHeight + padding * 2);
    
    // Draw text
    ctx.fillStyle = '#00ff00';
    ctx.fillText(annotation.text, textX, textY);
  };

  const handleCanvasClick = (e: React.MouseEvent) => {
    if (!isActive || !overlayRef.current) return;

    const rect = overlayRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    setPendingPosition({ x, y });
    setIsAddingAnnotation(true);
  };

  const handleAddAnnotation = () => {
    if (!pendingPosition || !annotationText.trim()) return;

    const newAnnotation: Annotation = {
      id: Date.now().toString(),
      x: pendingPosition.x,
      y: pendingPosition.y,
      text: annotationText.trim(),
      timestamp: new Date(),
      type: 'arrow'
    };

    setAnnotations(prev => [...prev, newAnnotation]);
    
    if (onAnnotationAdd) {
      onAnnotationAdd(newAnnotation);
    }

    // Reset state
    setIsAddingAnnotation(false);
    setPendingPosition(null);
    setAnnotationText('');
  };

  const handleCancelAnnotation = () => {
    setIsAddingAnnotation(false);
    setPendingPosition(null);
    setAnnotationText('');
  };

  const clearAnnotations = () => {
    setAnnotations([]);
  };

  return (
    <div className="relative">
      <canvas
        ref={overlayRef}
        className="absolute top-0 left-0 pointer-events-auto"
        style={{ 
          zIndex: 10,
          cursor: isActive ? 'crosshair' : 'default'
        }}
        onClick={handleCanvasClick}
      />
      
      {/* Annotation Input Modal */}
      {isAddingAnnotation && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center">
          <Card className="bg-gray-900 border-gray-700 p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-white mb-4">Add Annotation</h3>
            <textarea
              value={annotationText}
              onChange={(e) => setAnnotationText(e.target.value)}
              placeholder="Enter annotation text..."
              className="w-full h-24 bg-gray-800 border border-gray-600 rounded p-3 text-white resize-none"
              autoFocus
            />
            <div className="flex justify-end space-x-2 mt-4">
              <Button
                variant="outline"
                size="sm"
                onClick={handleCancelAnnotation}
                className="border-gray-600 text-gray-300 hover:bg-gray-800"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleAddAnnotation}
                disabled={!annotationText.trim()}
                className="bg-green-600 hover:bg-green-700"
              >
                Add Annotation
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Annotations List */}
      {annotations.length > 0 && (
        <div className="absolute top-4 left-4 bg-black/80 text-white p-3 rounded text-sm max-w-xs">
          <div className="flex items-center justify-between mb-2">
            <span className="font-semibold">Annotations ({annotations.length})</span>
            <button
              onClick={clearAnnotations}
              className="text-red-400 hover:text-red-300 text-xs"
            >
              Clear All
            </button>
          </div>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {annotations.map((annotation, index) => (
              <div key={annotation.id} className="text-xs p-1 bg-gray-800 rounded">
                <div className="font-medium">#{index + 1}</div>
                <div className="truncate" title={annotation.text}>
                  {annotation.text}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}