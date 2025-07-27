import React, { useRef, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { generateSagittalView, generateCoronalView } from '@/lib/multiplanar-reconstruction';

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
  pixelDataCache?: Map<number, Uint16Array>;
  onCrosshairChange?: (position: { x: number; y: number; z: number }) => void;
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
  selectedStructure,
  pixelDataCache = new Map(),
  onCrosshairChange
}: FloatingViewPanelsProps) {
  const sagittalCanvasRef = useRef<HTMLCanvasElement>(null);
  const coronalCanvasRef = useRef<HTMLCanvasElement>(null);
  const [hoveredView, setHoveredView] = useState<string | null>(null);
  const [crosshairPosition, setCrosshairPosition] = useState({ x: 256, y: 256, z: currentSliceIndex });

  // Panel size - 20% of viewport width for better visibility
  const panelSize = Math.floor(window.innerWidth * 0.2);

  // Update crosshair z position when slice changes
  useEffect(() => {
    setCrosshairPosition(prev => ({ ...prev, z: currentSliceIndex }));
  }, [currentSliceIndex]);

  useEffect(() => {
    if (!images.length || !axialCanvas) return;

    // Set canvas sizes
    if (sagittalCanvasRef.current) {
      sagittalCanvasRef.current.width = panelSize;
      sagittalCanvasRef.current.height = panelSize;
    }
    if (coronalCanvasRef.current) {
      coronalCanvasRef.current.width = panelSize;
      coronalCanvasRef.current.height = panelSize;
    }

    // Render sagittal view
    if (sagittalCanvasRef.current && activeView !== 'sagittal') {
      renderSagittalView();
    }

    // Render coronal view
    if (coronalCanvasRef.current && activeView !== 'coronal') {
      renderCoronalView();
    }
  }, [currentSliceIndex, images, pixelData, windowWidth, windowCenter, activeView, pixelDataCache, crosshairPosition]);

  const renderSagittalView = () => {
    if (!sagittalCanvasRef.current || images.length === 0 || pixelDataCache.size === 0) return;

    const canvas = sagittalCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, panelSize, panelSize);

    // Generate sagittal reconstruction
    const sagittalColumn = Math.floor(crosshairPosition.x);
    const sagittalData = generateSagittalView(images, pixelDataCache, sagittalColumn);
    
    if (!sagittalData) return;

    // Create temp canvas for the sagittal data
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = sagittalData.width;
    tempCanvas.height = sagittalData.height;
    const tempCtx = tempCanvas.getContext('2d');
    if (!tempCtx) return;

    // Create image data
    const imageData = tempCtx.createImageData(sagittalData.width, sagittalData.height);
    
    // Apply window/level to sagittal data
    const pixelData = sagittalData.pixelData;
    const rgba = new Uint8ClampedArray(pixelData.length * 4);
    const min = windowCenter - windowWidth / 2;
    const max = windowCenter + windowWidth / 2;
    
    for (let i = 0; i < pixelData.length; i++) {
      const value = pixelData[i];
      let normalized = (value - min) / (max - min);
      normalized = Math.max(0, Math.min(1, normalized));
      const gray = Math.floor(normalized * 255);
      
      rgba[i * 4] = gray;
      rgba[i * 4 + 1] = gray;
      rgba[i * 4 + 2] = gray;
      rgba[i * 4 + 3] = 255;
    }
    imageData.data.set(rgba);
    tempCtx.putImageData(imageData, 0, 0);

    // Scale to fit panel
    const scale = Math.min(panelSize / tempCanvas.width, panelSize / tempCanvas.height);
    const scaledWidth = tempCanvas.width * scale;
    const scaledHeight = tempCanvas.height * scale;
    const x = (panelSize - scaledWidth) / 2;
    const y = (panelSize - scaledHeight) / 2;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(tempCanvas, x, y, scaledWidth, scaledHeight);
    
    // Draw crosshair
    ctx.strokeStyle = '#00ff00'; // Green color
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.6; // Semi-transparent
    ctx.setLineDash([5, 5]); // Dashed line
    
    // Vertical line representing current axial slice
    const slicePositionNormalized = currentSliceIndex / images.length;
    const crosshairX = x + (scaledWidth * slicePositionNormalized);
    ctx.beginPath();
    ctx.moveTo(crosshairX, y);
    ctx.lineTo(crosshairX, y + scaledHeight);
    ctx.stroke();
    
    // Horizontal line representing coronal position
    const coronalPositionNormalized = crosshairPosition.y / 512;
    const crosshairY = y + (scaledHeight * coronalPositionNormalized);
    ctx.beginPath();
    ctx.moveTo(x, crosshairY);
    ctx.lineTo(x + scaledWidth, crosshairY);
    ctx.stroke();
    
    ctx.globalAlpha = 1;

    // Draw orientation labels
    ctx.fillStyle = 'white';
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    // S (Superior) - Top
    ctx.fillText('S', panelSize / 2, 15);
    // I (Inferior) - Bottom
    ctx.fillText('I', panelSize / 2, panelSize - 15);
    // P (Posterior) - Left
    ctx.textAlign = 'left';
    ctx.fillText('P', 15, panelSize / 2);
    // A (Anterior) - Right
    ctx.textAlign = 'right';
    ctx.fillText('A', panelSize - 15, panelSize / 2);
  };

  const renderCoronalView = () => {
    if (!coronalCanvasRef.current || images.length === 0 || pixelDataCache.size === 0) return;

    const canvas = coronalCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, panelSize, panelSize);

    // Generate coronal reconstruction
    const coronalRow = Math.floor(crosshairPosition.y);
    const coronalData = generateCoronalView(images, pixelDataCache, coronalRow);
    
    if (!coronalData) return;

    // Create temp canvas for the coronal data
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = coronalData.width;
    tempCanvas.height = coronalData.height;
    const tempCtx = tempCanvas.getContext('2d');
    if (!tempCtx) return;

    // Create image data
    const imageData = tempCtx.createImageData(coronalData.width, coronalData.height);
    
    // Apply window/level to coronal data
    const pixelData = coronalData.pixelData;
    const rgba = new Uint8ClampedArray(pixelData.length * 4);
    const min = windowCenter - windowWidth / 2;
    const max = windowCenter + windowWidth / 2;
    
    for (let i = 0; i < pixelData.length; i++) {
      const value = pixelData[i];
      let normalized = (value - min) / (max - min);
      normalized = Math.max(0, Math.min(1, normalized));
      const gray = Math.floor(normalized * 255);
      
      rgba[i * 4] = gray;
      rgba[i * 4 + 1] = gray;
      rgba[i * 4 + 2] = gray;
      rgba[i * 4 + 3] = 255;
    }
    imageData.data.set(rgba);
    tempCtx.putImageData(imageData, 0, 0);

    // Scale to fit panel
    const scale = Math.min(panelSize / tempCanvas.width, panelSize / tempCanvas.height);
    const scaledWidth = tempCanvas.width * scale;
    const scaledHeight = tempCanvas.height * scale;
    const x = (panelSize - scaledWidth) / 2;
    const y = (panelSize - scaledHeight) / 2;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(tempCanvas, x, y, scaledWidth, scaledHeight);
    
    // Draw crosshair
    ctx.strokeStyle = '#00ff00'; // Green color
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.6; // Semi-transparent
    ctx.setLineDash([5, 5]); // Dashed line
    
    // Vertical line representing current axial slice
    const slicePositionNormalized = currentSliceIndex / images.length;
    const crosshairX = x + (scaledWidth * slicePositionNormalized);
    ctx.beginPath();
    ctx.moveTo(crosshairX, y);
    ctx.lineTo(crosshairX, y + scaledHeight);
    ctx.stroke();
    
    // Horizontal line representing sagittal position
    const sagittalPositionNormalized = crosshairPosition.x / 512;
    const crosshairY = y + (scaledHeight * sagittalPositionNormalized);
    ctx.beginPath();
    ctx.moveTo(x, crosshairY);
    ctx.lineTo(x + scaledWidth, crosshairY);
    ctx.stroke();
    
    ctx.globalAlpha = 1;

    // Draw orientation labels
    ctx.fillStyle = 'white';
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    // S (Superior) - Top
    ctx.fillText('S', panelSize / 2, 15);
    // I (Inferior) - Bottom
    ctx.fillText('I', panelSize / 2, panelSize - 15);
    // R (Right) - Left
    ctx.textAlign = 'left';
    ctx.fillText('R', 15, panelSize / 2);
    // L (Left) - Right
    ctx.textAlign = 'right';
    ctx.fillText('L', panelSize - 15, panelSize / 2);
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