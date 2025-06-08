import { useState, useRef, useEffect } from 'react';
import { Card } from '@/components/ui/card';

interface PixelData {
  x: number;
  y: number;
  value: number;
  hounsfield?: number;
}

interface PixelProbeProps {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  imageData?: { data: Float32Array; width: number; height: number };
  isActive: boolean;
  windowLevel: { window: number; level: number };
}

export function PixelProbe({ canvasRef, imageData, isActive, windowLevel }: PixelProbeProps) {
  const [currentPixel, setCurrentPixel] = useState<PixelData | null>(null);
  const [showProbe, setShowProbe] = useState(false);

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isActive || !canvasRef.current || !imageData) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const canvasX = e.clientX - rect.left;
    const canvasY = e.clientY - rect.top;

    // Convert canvas coordinates to image coordinates
    const scaleX = imageData.width / canvasRef.current.width;
    const scaleY = imageData.height / canvasRef.current.height;
    
    const imageX = Math.floor(canvasX * scaleX);
    const imageY = Math.floor(canvasY * scaleY);

    // Ensure coordinates are within image bounds
    if (imageX >= 0 && imageX < imageData.width && imageY >= 0 && imageY < imageData.height) {
      const pixelIndex = imageY * imageData.width + imageX;
      const rawValue = imageData.data[pixelIndex];
      
      // Convert to Hounsfield Units (for CT images)
      const hounsfield = rawValue - 1024; // Typical CT conversion
      
      setCurrentPixel({
        x: imageX,
        y: imageY,
        value: rawValue,
        hounsfield: hounsfield
      });
      setShowProbe(true);
    }
  };

  const handleMouseLeave = () => {
    setShowProbe(false);
    setCurrentPixel(null);
  };

  if (!isActive) return null;

  return (
    <>
      {/* Invisible overlay for mouse tracking */}
      <div
        className="absolute inset-0 pointer-events-auto"
        style={{ zIndex: 5 }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      />
      
      {/* Pixel value display */}
      {showProbe && currentPixel && (
        <div className="fixed pointer-events-none z-50" style={{ 
          left: '10px', 
          top: '50%', 
          transform: 'translateY(-50%)' 
        }}>
          <Card className="bg-black/90 border-green-500/50 p-3 text-green-400 text-sm">
            <div className="space-y-1">
              <div className="font-semibold text-green-300">Pixel Inspector</div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>X:</div>
                <div className="font-mono">{currentPixel.x}</div>
                <div>Y:</div>
                <div className="font-mono">{currentPixel.y}</div>
                <div>Raw:</div>
                <div className="font-mono">{currentPixel.value.toFixed(1)}</div>
                <div>HU:</div>
                <div className="font-mono">{currentPixel.hounsfield?.toFixed(1)}</div>
              </div>
              <div className="text-xs text-green-500 border-t border-green-700 pt-1 mt-2">
                W/L: {windowLevel.window}/{windowLevel.level}
              </div>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}