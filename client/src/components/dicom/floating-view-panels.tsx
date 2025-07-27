import React, { useRef, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

interface FloatingViewPanelsProps {
  axialCanvas: HTMLCanvasElement | null;
  currentSliceIndex: number;
  images: any[];
  pixelData: Uint16Array | null;
  windowWidth: number;
  windowCenter: number;
  activeView: 'axial' | 'sagittal' | 'coronal';
  onViewChange: (view: 'axial' | 'sagittal' | 'coronal') => void;
  rtStructures?: any;
  selectedStructure?: string | null;
}

export function FloatingViewPanels({
  axialCanvas,
  currentSliceIndex,
  images,
  pixelData,
  windowWidth,
  windowCenter,
  activeView,
  onViewChange,
  rtStructures,
  selectedStructure
}: FloatingViewPanelsProps) {
  const sagittalCanvasRef = useRef<HTMLCanvasElement>(null);
  const coronalCanvasRef = useRef<HTMLCanvasElement>(null);
  const [hoveredView, setHoveredView] = useState<string | null>(null);

  // Panel size - 10% of viewport width
  const panelSize = Math.floor(window.innerWidth * 0.1);

  useEffect(() => {
    if (!images.length || !axialCanvas) return;

    // Render sagittal view
    if (sagittalCanvasRef.current && activeView !== 'sagittal') {
      renderSagittalView();
    }

    // Render coronal view
    if (coronalCanvasRef.current && activeView !== 'coronal') {
      renderCoronalView();
    }
  }, [currentSliceIndex, images, pixelData, windowWidth, windowCenter, activeView]);

  const renderSagittalView = () => {
    const canvas = sagittalCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // For now, show a placeholder with view label
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, panelSize, panelSize);
    
    // Draw crosshair
    ctx.strokeStyle = '#00ff00';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(panelSize / 2, 0);
    ctx.lineTo(panelSize / 2, panelSize);
    ctx.moveTo(0, panelSize / 2);
    ctx.lineTo(panelSize, panelSize / 2);
    ctx.stroke();

    // Label
    ctx.fillStyle = '#ffffff';
    ctx.font = '12px Arial';
    ctx.fillText('Sagittal', 5, 15);
  };

  const renderCoronalView = () => {
    const canvas = coronalCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // For now, show a placeholder with view label
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, panelSize, panelSize);
    
    // Draw crosshair
    ctx.strokeStyle = '#00ff00';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(panelSize / 2, 0);
    ctx.lineTo(panelSize / 2, panelSize);
    ctx.moveTo(0, panelSize / 2);
    ctx.lineTo(panelSize, panelSize / 2);
    ctx.stroke();

    // Label
    ctx.fillStyle = '#ffffff';
    ctx.font = '12px Arial';
    ctx.fillText('Coronal', 5, 15);
  };

  const handleViewClick = (view: 'axial' | 'sagittal' | 'coronal') => {
    if (view !== activeView) {
      onViewChange(view);
    }
  };

  return (
    <div className="absolute right-1 top-2 space-y-2 z-50">
      {/* Sagittal View Panel */}
      {activeView !== 'sagittal' && (
        <div
          className={cn(
            "relative cursor-pointer transition-all duration-200",
            "border rounded-lg overflow-hidden shadow-lg",
            hoveredView === 'sagittal' ? "border-blue-500 scale-110 shadow-2xl" : "border-gray-700"
          )}
          onMouseEnter={() => setHoveredView('sagittal')}
          onMouseLeave={() => setHoveredView(null)}
          onClick={() => handleViewClick('sagittal')}
          style={{ width: panelSize, height: panelSize }}
        >
          <canvas
            ref={sagittalCanvasRef}
            width={panelSize}
            height={panelSize}
            className="w-full h-full"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent pointer-events-none" />
          <div className="absolute bottom-1 left-1 text-xs text-white font-medium">
            SAG
          </div>
        </div>
      )}

      {/* Coronal View Panel */}
      {activeView !== 'coronal' && (
        <div
          className={cn(
            "relative cursor-pointer transition-all duration-200",
            "border rounded-lg overflow-hidden shadow-lg",
            hoveredView === 'coronal' ? "border-blue-500 scale-110 shadow-2xl" : "border-gray-700"
          )}
          onMouseEnter={() => setHoveredView('coronal')}
          onMouseLeave={() => setHoveredView(null)}
          onClick={() => handleViewClick('coronal')}
          style={{ width: panelSize, height: panelSize }}
        >
          <canvas
            ref={coronalCanvasRef}
            width={panelSize}
            height={panelSize}
            className="w-full h-full"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent pointer-events-none" />
          <div className="absolute bottom-1 left-1 text-xs text-white font-medium">
            COR
          </div>
        </div>
      )}

      {/* Axial View Panel (when not active) */}
      {activeView !== 'axial' && (
        <div
          className={cn(
            "relative cursor-pointer transition-all duration-200",
            "border-2 rounded-lg overflow-hidden shadow-lg",
            hoveredView === 'axial' ? "border-blue-500 scale-110" : "border-gray-600"
          )}
          onMouseEnter={() => setHoveredView('axial')}
          onMouseLeave={() => setHoveredView(null)}
          onClick={() => handleViewClick('axial')}
          style={{ width: panelSize, height: panelSize }}
        >
          <div className="w-full h-full bg-gray-800 flex items-center justify-center">
            <div className="text-white text-center">
              <div className="text-xs font-medium">AXIAL</div>
              <div className="text-[10px] opacity-60">Slice {currentSliceIndex + 1}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}