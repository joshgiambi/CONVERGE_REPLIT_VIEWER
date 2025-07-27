import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Maximize2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { generateSagittalView, generateCoronalView } from '@/lib/multiplanar-reconstruction';

export interface MPRThreePaneViewProps {
  axialCanvas: HTMLCanvasElement | null;
  currentSliceIndex: number;
  images: any[];
  pixelData: Uint16Array | null;
  windowWidth: number;
  windowCenter: number;
  onViewMaximize: (view: 'axial' | 'sagittal' | 'coronal') => void;
  pixelDataCache: Map<number, Uint16Array>;
  crosshairPosition?: { x: number; y: number; z: number };
  onCrosshairChange?: (position: { x: number; y: number; z: number }) => void;
}

export function MPRThreePaneView({
  axialCanvas,
  currentSliceIndex,
  images,
  pixelData,
  windowWidth,
  windowCenter,
  onViewMaximize,
  pixelDataCache,
  crosshairPosition = { x: 256, y: 256, z: 0 },
  onCrosshairChange
}: MPRThreePaneViewProps) {
  const sagittalCanvasRef = useRef<HTMLCanvasElement>(null);
  const coronalCanvasRef = useRef<HTMLCanvasElement>(null);
  const axialPaneCanvasRef = useRef<HTMLCanvasElement>(null);
  const [hoveredView, setHoveredView] = useState<'axial' | 'sagittal' | 'coronal' | null>(null);

  // Copy axial view to the left pane
  useEffect(() => {
    if (!axialCanvas || !axialPaneCanvasRef.current) return;
    
    const destCanvas = axialPaneCanvasRef.current;
    const destCtx = destCanvas.getContext('2d');
    if (!destCtx) return;

    // Get the parent container dimensions
    const container = destCanvas.parentElement;
    if (!container) return;

    // Set canvas size to fill container
    const rect = container.getBoundingClientRect();
    destCanvas.width = rect.width;
    destCanvas.height = rect.height;

    // Clear canvas
    destCtx.fillStyle = 'black';
    destCtx.fillRect(0, 0, destCanvas.width, destCanvas.height);

    // Calculate scaling to fit the image
    const scale = Math.min(
      destCanvas.width / axialCanvas.width,
      destCanvas.height / axialCanvas.height
    );

    const scaledWidth = axialCanvas.width * scale;
    const scaledHeight = axialCanvas.height * scale;
    const x = (destCanvas.width - scaledWidth) / 2;
    const y = (destCanvas.height - scaledHeight) / 2;

    // Draw the scaled axial image
    destCtx.imageSmoothingEnabled = true;
    destCtx.imageSmoothingQuality = 'high';
    destCtx.drawImage(axialCanvas, x, y, scaledWidth, scaledHeight);
  }, [axialCanvas, currentSliceIndex]);

  // Reconstruct sagittal view
  useEffect(() => {
    console.log('🔍 MPR Sagittal reconstruction triggered:', {
      hasCanvas: !!sagittalCanvasRef.current,
      imagesLength: images.length,
      pixelDataCacheSize: pixelDataCache.size
    });
    
    if (!sagittalCanvasRef.current || images.length === 0 || !pixelDataCache.size) {
      console.log('❌ MPR Sagittal reconstruction early return:', {
        canvas: !sagittalCanvasRef.current ? 'missing' : 'present',
        images: images.length === 0 ? 'empty' : `${images.length} images`,
        cache: pixelDataCache.size === 0 ? 'empty' : `${pixelDataCache.size} entries`
      });
      return;
    }

    const canvas = sagittalCanvasRef.current;
    const container = canvas.parentElement;
    if (!container) return;

    // Set canvas size to fill container
    const rect = container.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Get the middle column for sagittal reconstruction
    const imageWidth = 512; // Standard DICOM image width
    const middleColumn = Math.floor(imageWidth / 2);

    const sagittalData = generateSagittalView(
      images,
      pixelDataCache,
      middleColumn
    );

    console.log('📊 MPR Sagittal data generated:', {
      hasData: !!sagittalData,
      width: sagittalData?.width,
      height: sagittalData?.height,
      pixelDataLength: sagittalData?.pixelData?.length,
      metadata: sagittalData?.metadata
    });

    if (!sagittalData) {
      console.log('❌ No sagittal data generated');
      return;
    }

    // Create image data
    const imageData = ctx.createImageData(sagittalData.width, sagittalData.height);
    
    // Convert Uint16Array to RGBA
    const pixelData = sagittalData.pixelData;
    const rgba = new Uint8ClampedArray(pixelData.length * 4);
    for (let i = 0; i < pixelData.length; i++) {
      // Apply window/level
      const value = pixelData[i];
      const min = windowCenter - windowWidth / 2;
      const max = windowCenter + windowWidth / 2;
      let normalized = (value - min) / (max - min);
      normalized = Math.max(0, Math.min(1, normalized));
      const gray = Math.floor(normalized * 255);
      
      rgba[i * 4] = gray;     // R
      rgba[i * 4 + 1] = gray; // G
      rgba[i * 4 + 2] = gray; // B
      rgba[i * 4 + 3] = 255;  // A
    }
    imageData.data.set(rgba);

    // Create temp canvas for the reconstructed image
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = sagittalData.width;
    tempCanvas.height = sagittalData.height;
    const tempCtx = tempCanvas.getContext('2d');
    if (!tempCtx) return;
    tempCtx.putImageData(imageData, 0, 0);

    // Scale to fit canvas
    const scale = Math.min(
      canvas.width / tempCanvas.width,
      canvas.height / tempCanvas.height
    );

    const scaledWidth = tempCanvas.width * scale;
    const scaledHeight = tempCanvas.height * scale;
    const x = (canvas.width - scaledWidth) / 2;
    const y = (canvas.height - scaledHeight) / 2;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(tempCanvas, x, y, scaledWidth, scaledHeight);
  }, [images, pixelDataCache, windowWidth, windowCenter]);

  // Reconstruct coronal view
  useEffect(() => {
    console.log('🔍 MPR Coronal reconstruction triggered:', {
      hasCanvas: !!coronalCanvasRef.current,
      imagesLength: images.length,
      pixelDataCacheSize: pixelDataCache.size
    });
    
    if (!coronalCanvasRef.current || images.length === 0 || !pixelDataCache.size) {
      console.log('❌ MPR Coronal reconstruction early return:', {
        canvas: !coronalCanvasRef.current ? 'missing' : 'present',
        images: images.length === 0 ? 'empty' : `${images.length} images`,
        cache: pixelDataCache.size === 0 ? 'empty' : `${pixelDataCache.size} entries`
      });
      return;
    }

    const canvas = coronalCanvasRef.current;
    const container = canvas.parentElement;
    if (!container) return;

    // Set canvas size to fill container
    const rect = container.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Get the middle row for coronal reconstruction
    const imageHeight = 512; // Standard DICOM image height
    const middleRow = Math.floor(imageHeight / 2);

    const coronalData = generateCoronalView(
      images,
      pixelDataCache,
      middleRow
    );

    console.log('📊 MPR Coronal data generated:', {
      hasData: !!coronalData,
      width: coronalData?.width,
      height: coronalData?.height,
      pixelDataLength: coronalData?.pixelData?.length,
      metadata: coronalData?.metadata
    });

    if (!coronalData) {
      console.log('❌ No coronal data generated');
      return;
    }

    // Create image data
    const imageData = ctx.createImageData(coronalData.width, coronalData.height);
    
    // Convert Uint16Array to RGBA
    const pixelData = coronalData.pixelData;
    const rgba = new Uint8ClampedArray(pixelData.length * 4);
    for (let i = 0; i < pixelData.length; i++) {
      // Apply window/level
      const value = pixelData[i];
      const min = windowCenter - windowWidth / 2;
      const max = windowCenter + windowWidth / 2;
      let normalized = (value - min) / (max - min);
      normalized = Math.max(0, Math.min(1, normalized));
      const gray = Math.floor(normalized * 255);
      
      rgba[i * 4] = gray;     // R
      rgba[i * 4 + 1] = gray; // G
      rgba[i * 4 + 2] = gray; // B
      rgba[i * 4 + 3] = 255;  // A
    }
    imageData.data.set(rgba);

    // Create temp canvas for the reconstructed image
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = coronalData.width;
    tempCanvas.height = coronalData.height;
    const tempCtx = tempCanvas.getContext('2d');
    if (!tempCtx) return;
    tempCtx.putImageData(imageData, 0, 0);

    // Scale to fit canvas
    const scale = Math.min(
      canvas.width / tempCanvas.width,
      canvas.height / tempCanvas.height
    );

    const scaledWidth = tempCanvas.width * scale;
    const scaledHeight = tempCanvas.height * scale;
    const x = (canvas.width - scaledWidth) / 2;
    const y = (canvas.height - scaledHeight) / 2;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(tempCanvas, x, y, scaledWidth, scaledHeight);
  }, [images, pixelDataCache, windowWidth, windowCenter]);

  return (
    <div className="absolute inset-0 flex bg-black">
      {/* Left pane - Axial (70% width) */}
      <div className="relative flex-[7] border-r border-gray-700">
        <canvas
          ref={axialPaneCanvasRef}
          className="w-full h-full"
          onMouseEnter={() => setHoveredView('axial')}
          onMouseLeave={() => setHoveredView(null)}
          onWheel={(e) => {
            // Handle wheel events to allow scrolling through slices
            e.preventDefault();
            if (!onCrosshairChange) return;
            
            const delta = e.deltaY > 0 ? 1 : -1;
            const newZ = Math.max(0, Math.min(images.length - 1, currentSliceIndex + delta));
            
            // Update crosshair position with new Z index
            onCrosshairChange({
              ...crosshairPosition,
              z: newZ
            });
          }}
        />
        
        {/* Maximize button */}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onViewMaximize('axial')}
          className={cn(
            "absolute top-2 right-2 p-1 transition-opacity",
            "bg-black/50 hover:bg-black/70 text-white",
            hoveredView === 'axial' ? 'opacity-100' : 'opacity-0'
          )}
        >
          <Maximize2 className="w-4 h-4" />
        </Button>
        
        {/* View label */}
        <div className="absolute bottom-2 left-2 text-xs text-white font-medium bg-black/50 px-2 py-1 rounded">
          AXIAL
        </div>
      </div>

      {/* Right pane - Sagittal and Coronal (30% width) */}
      <div className="flex-[3] flex flex-col">
        {/* Sagittal (top half) */}
        <div className="relative flex-1 border-b border-gray-700">
          <canvas
            ref={sagittalCanvasRef}
            className="w-full h-full"
            onMouseEnter={() => setHoveredView('sagittal')}
            onMouseLeave={() => setHoveredView(null)}
          />
          
          {/* Maximize button */}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onViewMaximize('sagittal')}
            className={cn(
              "absolute top-2 right-2 p-1 transition-opacity",
              "bg-black/50 hover:bg-black/70 text-white",
              hoveredView === 'sagittal' ? 'opacity-100' : 'opacity-0'
            )}
          >
            <Maximize2 className="w-4 h-4" />
          </Button>
          
          {/* View label */}
          <div className="absolute bottom-2 left-2 text-xs text-white font-medium bg-black/50 px-2 py-1 rounded">
            SAG
          </div>
        </div>

        {/* Coronal (bottom half) */}
        <div className="relative flex-1">
          <canvas
            ref={coronalCanvasRef}
            className="w-full h-full"
            onMouseEnter={() => setHoveredView('coronal')}
            onMouseLeave={() => setHoveredView(null)}
          />
          
          {/* Maximize button */}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onViewMaximize('coronal')}
            className={cn(
              "absolute top-2 right-2 p-1 transition-opacity",
              "bg-black/50 hover:bg-black/70 text-white",
              hoveredView === 'coronal' ? 'opacity-100' : 'opacity-0'
            )}
          >
            <Maximize2 className="w-4 h-4" />
          </Button>
          
          {/* View label */}
          <div className="absolute bottom-2 left-2 text-xs text-white font-medium bg-black/50 px-2 py-1 rounded">
            COR
          </div>
        </div>
      </div>
    </div>
  );
}