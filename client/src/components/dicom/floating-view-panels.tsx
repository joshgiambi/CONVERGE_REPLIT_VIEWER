import React, { useRef, useEffect, useCallback, useState } from 'react';
import { cn } from '@/lib/utils';
import { generateSagittalView, generateCoronalView, projectContourToView } from '@/lib/multiplanar-reconstruction';

interface FloatingViewPanelsProps {
  images: any[];
  currentSliceIndex: number;
  pixelData: Uint16Array | null;
  windowWidth: number;
  windowCenter: number;
  activeView: 'axial' | 'sagittal' | 'coronal';
  onViewChange: (view: 'axial' | 'sagittal' | 'coronal') => void;
  pixelDataCache: Map<number, Uint16Array>;
  crosshairPosition: { x: number; y: number };
  rtStructures?: any;
  visibleStructures?: Set<number>;
  ctTransform?: any;
  isValid?: boolean;
}

export const FloatingViewPanels: React.FC<FloatingViewPanelsProps> = ({
  images,
  currentSliceIndex,
  pixelData,
  windowWidth,
  windowCenter,
  activeView,
  onViewChange,
  pixelDataCache,
  crosshairPosition,
  rtStructures,
  visibleStructures,
  ctTransform,
  isValid = true
}) => {
  const sagittalCanvasRef = useRef<HTMLCanvasElement>(null);
  const coronalCanvasRef = useRef<HTMLCanvasElement>(null);
  const [hoveredView, setHoveredView] = useState<'sagittal' | 'coronal' | null>(null);
  
  // Fixed dimensions for tall MPR views to match aspect ratio
  const panelWidth = 512;
  const panelHeight = 214;

  // Render MPR views when data changes
  useEffect(() => {
    if (!images.length || !pixelDataCache.size) {
      console.log('[MPR] Skipping render - no images or cache');
      return;
    }

    if (!isValid) {
      console.log('[MPR] Skipping render - invalid state');
      return;
    }

    console.log('[MPR] Rendering views with cache size:', pixelDataCache.size);
    
    // Only render views that are not active
    if (activeView !== 'sagittal') {
      renderSagittalView();
    }
    
    if (activeView !== 'coronal') {
      renderCoronalView();
    }
  }, [currentSliceIndex, images, pixelData, windowWidth, windowCenter, activeView, pixelDataCache, crosshairPosition, rtStructures, visibleStructures, ctTransform, isValid]);

  const renderSagittalView = () => {
    if (!sagittalCanvasRef.current || images.length === 0 || pixelDataCache.size === 0) return;

    const canvas = sagittalCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, panelWidth, panelHeight);

    // Generate sagittal reconstruction
    const sagittalData = generateSagittalView(images, pixelDataCache, crosshairPosition.x);
    if (!sagittalData) {
      console.log('[MPR] Failed to generate sagittal view');
      return;
    }

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
    
    // For PET scans, use different default window/level if values are extreme
    let adjustedWindowWidth = windowWidth;
    let adjustedWindowCenter = windowCenter;
    
    // PET scans often have different intensity ranges
    if (windowWidth > 10000 || windowCenter > 5000) {
      // Auto-calculate from pixel data if window/level seems wrong
      let minPixel = Infinity;
      let maxPixel = -Infinity;
      for (let i = 0; i < pixelData.length; i++) {
        if (pixelData[i] < minPixel) minPixel = pixelData[i];
        if (pixelData[i] > maxPixel) maxPixel = pixelData[i];
      }
      adjustedWindowWidth = maxPixel - minPixel;
      adjustedWindowCenter = (maxPixel + minPixel) / 2;
      console.log('[MPR] Auto-adjusted window/level for PET:', {
        original: { width: windowWidth, center: windowCenter },
        adjusted: { width: adjustedWindowWidth, center: adjustedWindowCenter },
        pixelRange: { min: minPixel, max: maxPixel }
      });
    }
    
    const min = adjustedWindowCenter - adjustedWindowWidth / 2;
    const max = adjustedWindowCenter + adjustedWindowWidth / 2;
    
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
    const scale = Math.min(panelWidth / tempCanvas.width, panelHeight / tempCanvas.height);
    const scaledWidth = tempCanvas.width * scale;
    const scaledHeight = tempCanvas.height * scale;
    const x = (panelWidth - scaledWidth) / 2;
    const y = (panelHeight - scaledHeight) / 2;

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
    ctx.fillText('S', panelWidth / 2, 15);
    // I (Inferior) - Bottom
    ctx.fillText('I', panelWidth / 2, panelHeight - 15);
    // P (Posterior) - Left
    ctx.textAlign = 'left';
    ctx.fillText('P', 15, panelHeight / 2);
    // A (Anterior) - Right
    ctx.textAlign = 'right';
    ctx.fillText('A', panelWidth - 15, panelHeight / 2);

    // Draw contours on sagittal view
    if (rtStructures && visibleStructures && ctTransform) {
      renderContoursOnSagittalView(ctx, x, y, scaledWidth, scaledHeight, sagittalData);
    }
  };

  const renderCoronalView = () => {
    if (!coronalCanvasRef.current || images.length === 0 || pixelDataCache.size === 0) return;

    const canvas = coronalCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, panelWidth, panelHeight);

    // Generate coronal reconstruction
    const coronalData = generateCoronalView(images, pixelDataCache, crosshairPosition.y);
    if (!coronalData) {
      console.log('[MPR] Failed to generate coronal view');
      return;
    }

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
    
    // For PET scans, use different default window/level if values are extreme
    let adjustedWindowWidth = windowWidth;
    let adjustedWindowCenter = windowCenter;
    
    // PET scans often have different intensity ranges
    if (windowWidth > 10000 || windowCenter > 5000) {
      // Auto-calculate from pixel data if window/level seems wrong
      let minPixel = Infinity;
      let maxPixel = -Infinity;
      for (let i = 0; i < pixelData.length; i++) {
        if (pixelData[i] < minPixel) minPixel = pixelData[i];
        if (pixelData[i] > maxPixel) maxPixel = pixelData[i];
      }
      adjustedWindowWidth = maxPixel - minPixel;
      adjustedWindowCenter = (maxPixel + minPixel) / 2;
      console.log('[MPR] Auto-adjusted window/level for PET (coronal):', {
        original: { width: windowWidth, center: windowCenter },
        adjusted: { width: adjustedWindowWidth, center: adjustedWindowCenter },
        pixelRange: { min: minPixel, max: maxPixel }
      });
    }
    
    const min = adjustedWindowCenter - adjustedWindowWidth / 2;
    const max = adjustedWindowCenter + adjustedWindowWidth / 2;
    
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
    const scale = Math.min(panelWidth / tempCanvas.width, panelHeight / tempCanvas.height);
    const scaledWidth = tempCanvas.width * scale;
    const scaledHeight = tempCanvas.height * scale;
    const x = (panelWidth - scaledWidth) / 2;
    const y = (panelHeight - scaledHeight) / 2;

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
    ctx.fillText('S', panelWidth / 2, 15);
    // I (Inferior) - Bottom
    ctx.fillText('I', panelWidth / 2, panelHeight - 15);
    // R (Right) - Left
    ctx.textAlign = 'left';
    ctx.fillText('R', 15, panelHeight / 2);
    // L (Left) - Right
    ctx.textAlign = 'right';
    ctx.fillText('L', panelWidth - 15, panelHeight / 2);

    // Draw contours on coronal view
    if (rtStructures && visibleStructures && ctTransform) {
      renderContoursOnCoronalView(ctx, x, y, scaledWidth, scaledHeight, coronalData);
    }
  };

  const renderContoursOnSagittalView = (
    ctx: CanvasRenderingContext2D,
    offsetX: number,
    offsetY: number,
    scaledWidth: number,
    scaledHeight: number,
    sagittalData: any
  ) => {
    if (!images.length || !rtStructures || !visibleStructures) return;
    
    const firstImage = images[0];
    const imagePosition = firstImage.imagePosition?.split('\\').map(Number) || [0, 0, 0];
    const pixelSpacing = firstImage.pixelSpacing?.split('\\').map(Number) || [1, 1];
    
    // Calculate physical X position from pixel coordinate
    const physicalX = imagePosition[0] + (crosshairPosition.x * pixelSpacing[0]);
    
    ctx.save();
    
    // Iterate through visible structures
    rtStructures.structures?.forEach((structure: any) => {
      if (!visibleStructures.has(structure.id)) return;
      
      const color = structure.color || '#FF0000';
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.8;
      
      // Project each contour to sagittal view
      structure.contours?.forEach((contour: any) => {
        const projectedPoints = projectContourToView(
          contour.points,
          'sagittal',
          physicalX,
          5 // 5mm tolerance
        );
        
        if (projectedPoints && projectedPoints.length >= 6) {
          // Convert projected world coordinates to canvas coordinates
          ctx.beginPath();
          for (let i = 0; i < projectedPoints.length; i += 3) {
            const z = projectedPoints[i];
            const y = projectedPoints[i + 1];
            
            // Calculate normalized positions using sagittal data bounds
            const normalizedZ = (z - sagittalData.bounds.zMin) / (sagittalData.bounds.zMax - sagittalData.bounds.zMin);
            const normalizedY = (y - sagittalData.bounds.yMin) / (sagittalData.bounds.yMax - sagittalData.bounds.yMin);
            
            // Map to canvas coordinates
            const canvasX = offsetX + normalizedZ * scaledWidth;
            const canvasY = offsetY + (1 - normalizedY) * scaledHeight; // Flip Y for display
            
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
    
    ctx.restore();
  };

  const renderContoursOnCoronalView = (
    ctx: CanvasRenderingContext2D,
    offsetX: number,
    offsetY: number,
    scaledWidth: number,
    scaledHeight: number,
    coronalData: any
  ) => {
    if (!images.length || !rtStructures || !visibleStructures) return;
    
    const firstImage = images[0];
    const imagePosition = firstImage.imagePosition?.split('\\').map(Number) || [0, 0, 0];
    const pixelSpacing = firstImage.pixelSpacing?.split('\\').map(Number) || [1, 1];
    
    // Calculate physical Y position from pixel coordinate
    const physicalY = imagePosition[1] + (crosshairPosition.y * pixelSpacing[1]);
    
    ctx.save();
    
    // Iterate through visible structures
    rtStructures.structures?.forEach((structure: any) => {
      if (!visibleStructures.has(structure.id)) return;
      
      const color = structure.color || '#FF0000';
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.8;
      
      // Project each contour to coronal view
      structure.contours?.forEach((contour: any) => {
        const projectedPoints = projectContourToView(
          contour.points,
          'coronal',
          physicalY,
          5 // 5mm tolerance
        );
        
        if (projectedPoints && projectedPoints.length >= 6) {
          // Convert projected world coordinates to canvas coordinates
          ctx.beginPath();
          for (let i = 0; i < projectedPoints.length; i += 3) {
            const x = projectedPoints[i];
            const z = projectedPoints[i + 1];
            
            // Calculate normalized positions using coronal data bounds
            const normalizedX = (x - coronalData.bounds.xMin) / (coronalData.bounds.xMax - coronalData.bounds.xMin);
            const normalizedZ = (z - coronalData.bounds.zMin) / (coronalData.bounds.zMax - coronalData.bounds.zMin);
            
            // Map to canvas coordinates
            const canvasX = offsetX + normalizedX * scaledWidth;
            const canvasY = offsetY + (1 - normalizedZ) * scaledHeight; // Flip Z for display
            
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
    
    ctx.restore();
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
          style={{ width: panelWidth, height: panelHeight }}
        >
          <canvas
            ref={sagittalCanvasRef}
            width={panelWidth}
            height={panelHeight}
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
          style={{ width: panelWidth, height: panelHeight }}
        >
          <canvas
            ref={coronalCanvasRef}
            width={panelWidth}
            height={panelHeight}
            className="w-full h-full"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent pointer-events-none" />
          <div className="absolute bottom-1 left-1 text-xs text-white font-medium">
            COR
          </div>
        </div>
      )}
    </div>
  );
};