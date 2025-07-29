/**
 * MPR canvases component - floating sagittal and coronal viewports
 * Extracted from monolithic WorkingViewer component
 */

import { useRef, useEffect } from 'react';
import { renderMPRSlice } from '../services/renderingService';

interface MprCanvasesProps {
  volumeData: Uint16Array[];
  currentSagittalIndex: number;
  currentCoronalIndex: number;
  windowLevel: { window: number; level: number };
  imageMetadata: any;
  crosshairPosition: { x: number; y: number } | null;
  isVisible: boolean;
  className?: string;
}

/**
 * MPR floating canvases for sagittal and coronal views
 */
export function MprCanvases({
  volumeData,
  currentSagittalIndex,
  currentCoronalIndex,
  windowLevel,
  imageMetadata,
  crosshairPosition,
  isVisible,
  className = ""
}: MprCanvasesProps) {
  const sagittalCanvasRef = useRef<HTMLCanvasElement>(null);
  const coronalCanvasRef = useRef<HTMLCanvasElement>(null);

  /**
   * Render sagittal MPR slice
   */
  const renderSagittal = () => {
    const canvas = sagittalCanvasRef.current;
    if (!canvas || !volumeData.length) return;

    renderMPRSlice(
      canvas,
      volumeData,
      currentSagittalIndex,
      'sagittal',
      windowLevel,
      imageMetadata
    );

    // Draw crosshair if position is available
    if (crosshairPosition) {
      drawCrosshair(canvas, crosshairPosition, 'sagittal');
    }
  };

  /**
   * Render coronal MPR slice
   */
  const renderCoronal = () => {
    const canvas = coronalCanvasRef.current;
    if (!canvas || !volumeData.length) return;

    renderMPRSlice(
      canvas,
      volumeData,
      currentCoronalIndex,
      'coronal',
      windowLevel,
      imageMetadata
    );

    // Draw crosshair if position is available
    if (crosshairPosition) {
      drawCrosshair(canvas, crosshairPosition, 'coronal');
    }
  };

  /**
   * Draw crosshair lines on MPR views
   */
  const drawCrosshair = (
    canvas: HTMLCanvasElement, 
    position: { x: number; y: number },
    orientation: 'sagittal' | 'coronal'
  ) => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.save();
    ctx.strokeStyle = '#00ff00';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);

    if (orientation === 'sagittal') {
      // Vertical line for Y position, horizontal line for Z position
      ctx.beginPath();
      ctx.moveTo(position.y, 0);
      ctx.lineTo(position.y, canvas.height);
      ctx.moveTo(0, canvas.height - position.x); // Invert for proper anatomy
      ctx.lineTo(canvas.width, canvas.height - position.x);
      ctx.stroke();
    } else if (orientation === 'coronal') {
      // Vertical line for X position, horizontal line for Z position
      ctx.beginPath();
      ctx.moveTo(position.x, 0);
      ctx.lineTo(position.x, canvas.height);
      ctx.moveTo(0, canvas.height - position.y); // Invert for proper anatomy
      ctx.lineTo(canvas.width, canvas.height - position.y);
      ctx.stroke();
    }

    ctx.restore();
  };

  // Re-render when dependencies change
  useEffect(() => {
    if (isVisible) {
      renderSagittal();
      renderCoronal();
    }
  }, [
    volumeData,
    currentSagittalIndex,
    currentCoronalIndex,
    windowLevel,
    imageMetadata,
    crosshairPosition,
    isVisible
  ]);

  if (!isVisible) {
    return null;
  }

  return (
    <div className={`absolute bottom-4 right-4 space-y-2 z-10 ${className}`}>
      {/* Sagittal view */}
      <div className="bg-background border border-border rounded-lg p-2 shadow-lg">
        <div className="text-xs font-medium text-muted-foreground mb-1 text-center">
          Sagittal
        </div>
        <canvas
          ref={sagittalCanvasRef}
          width={384}
          height={384}
          className="border border-gray-600 rounded cursor-crosshair"
          style={{ width: '192px', height: '192px' }}
        />
      </div>

      {/* Coronal view */}
      <div className="bg-background border border-border rounded-lg p-2 shadow-lg">
        <div className="text-xs font-medium text-muted-foreground mb-1 text-center">
          Coronal
        </div>
        <canvas
          ref={coronalCanvasRef}
          width={384}
          height={384}
          className="border border-gray-600 rounded cursor-crosshair"
          style={{ width: '192px', height: '192px' }}
        />
      </div>
    </div>
  );
}