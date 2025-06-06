import { useEffect, useRef, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Move, RotateCw, Maximize2, ChevronLeft, ChevronRight } from 'lucide-react';
import { dicomLoader } from '@/lib/dicom-loader';

interface MPRViewerProps {
  seriesId: number;
}

interface VolumeData {
  imageStack: ImageData[];
  dimensions: { width: number; height: number; depth: number };
  spacing: { x: number; y: number; z: number };
}

interface CrosshairPosition {
  x: number;
  y: number;
  z: number;
}

export function MPRViewer({ seriesId }: MPRViewerProps) {
  const axialRef = useRef<HTMLCanvasElement>(null);
  const sagittalRef = useRef<HTMLCanvasElement>(null);
  const coronalRef = useRef<HTMLCanvasElement>(null);
  
  const [volumeData, setVolumeData] = useState<VolumeData | null>(null);
  const [crosshair, setCrosshair] = useState<CrosshairPosition>({ x: 256, y: 256, z: 10 });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [windowLevel, setWindowLevel] = useState({ center: 40, width: 400 });

  useEffect(() => {
    loadVolumeData();
  }, [seriesId]);

  useEffect(() => {
    if (volumeData) {
      renderAllPlanes();
    }
  }, [volumeData, crosshair, windowLevel]);

  const loadVolumeData = async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      const response = await fetch(`/api/series/${seriesId}`);
      if (!response.ok) {
        throw new Error(`Failed to load series: ${response.statusText}`);
      }
      
      const seriesData = await response.json();
      const sortedImages = seriesData.images.sort((a: any, b: any) => 
        (a.instanceNumber || 0) - (b.instanceNumber || 0)
      );
      
      // Load all DICOM images and extract pixel data
      const imageStack: ImageData[] = [];
      let dimensions = { width: 512, height: 512, depth: sortedImages.length };
      
      for (const image of sortedImages) {
        try {
          const canvas = await dicomLoader.loadDICOMImage(image.sopInstanceUID);
          const ctx = canvas.getContext('2d');
          if (ctx) {
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            imageStack.push(imageData);
            
            // Update dimensions from first image
            if (imageStack.length === 1) {
              dimensions.width = canvas.width;
              dimensions.height = canvas.height;
            }
          }
        } catch (error) {
          console.warn(`Failed to load image ${image.sopInstanceUID}:`, error);
        }
      }
      
      if (imageStack.length === 0) {
        throw new Error('No images could be loaded');
      }
      
      const volume: VolumeData = {
        imageStack,
        dimensions,
        spacing: { x: 1, y: 1, z: 2.5 } // Typical CT spacing
      };
      
      setVolumeData(volume);
      setCrosshair({
        x: Math.floor(dimensions.width / 2),
        y: Math.floor(dimensions.height / 2),
        z: Math.floor(dimensions.depth / 2)
      });
      
    } catch (error: any) {
      console.error('Error loading volume data:', error);
      setError(error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const renderAllPlanes = () => {
    if (!volumeData) return;
    
    renderAxialPlane();
    renderSagittalPlane();
    renderCoronalPlane();
  };

  const renderAxialPlane = () => {
    if (!volumeData || !axialRef.current) return;
    
    const canvas = axialRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Get the axial slice at current Z position
    const sliceIndex = Math.min(crosshair.z, volumeData.imageStack.length - 1);
    const sourceImageData = volumeData.imageStack[sliceIndex];
    
    if (sourceImageData) {
      // Apply window/level and draw
      const processedData = applyWindowLevel(sourceImageData, windowLevel);
      ctx.putImageData(processedData, 0, 0);
      
      // Draw crosshairs
      drawCrosshairs(ctx, crosshair.x, crosshair.y, canvas.width, canvas.height);
    }
  };

  const renderSagittalPlane = () => {
    if (!volumeData || !sagittalRef.current) return;
    
    const canvas = sagittalRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Create sagittal reconstruction
    const width = volumeData.dimensions.depth;
    const height = volumeData.dimensions.height;
    const imageData = ctx.createImageData(width, height);
    
    // Sample along sagittal plane (constant X)
    const x = crosshair.x;
    for (let z = 0; z < volumeData.dimensions.depth && z < volumeData.imageStack.length; z++) {
      const sourceSlice = volumeData.imageStack[z];
      if (!sourceSlice) continue;
      
      for (let y = 0; y < height; y++) {
        if (y >= sourceSlice.height || x >= sourceSlice.width) continue;
        
        const sourceIndex = (y * sourceSlice.width + x) * 4;
        const targetIndex = (y * width + z) * 4;
        
        imageData.data[targetIndex] = sourceSlice.data[sourceIndex];
        imageData.data[targetIndex + 1] = sourceSlice.data[sourceIndex + 1];
        imageData.data[targetIndex + 2] = sourceSlice.data[sourceIndex + 2];
        imageData.data[targetIndex + 3] = sourceSlice.data[sourceIndex + 3];
      }
    }
    
    const processedData = applyWindowLevel(imageData, windowLevel);
    ctx.putImageData(processedData, 0, 0);
    
    // Draw crosshairs
    drawCrosshairs(ctx, crosshair.z, crosshair.y, width, height);
  };

  const renderCoronalPlane = () => {
    if (!volumeData || !coronalRef.current) return;
    
    const canvas = coronalRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Create coronal reconstruction
    const width = volumeData.dimensions.width;
    const height = volumeData.dimensions.depth;
    const imageData = ctx.createImageData(width, height);
    
    // Sample along coronal plane (constant Y)
    const y = crosshair.y;
    for (let z = 0; z < volumeData.dimensions.depth && z < volumeData.imageStack.length; z++) {
      const sourceSlice = volumeData.imageStack[z];
      if (!sourceSlice) continue;
      
      for (let x = 0; x < width; x++) {
        if (y >= sourceSlice.height || x >= sourceSlice.width) continue;
        
        const sourceIndex = (y * sourceSlice.width + x) * 4;
        const targetIndex = ((height - 1 - z) * width + x) * 4; // Flip Z for proper orientation
        
        imageData.data[targetIndex] = sourceSlice.data[sourceIndex];
        imageData.data[targetIndex + 1] = sourceSlice.data[sourceIndex + 1];
        imageData.data[targetIndex + 2] = sourceSlice.data[sourceIndex + 2];
        imageData.data[targetIndex + 3] = sourceSlice.data[sourceIndex + 3];
      }
    }
    
    const processedData = applyWindowLevel(imageData, windowLevel);
    ctx.putImageData(processedData, 0, 0);
    
    // Draw crosshairs
    drawCrosshairs(ctx, crosshair.x, height - 1 - crosshair.z, width, height);
  };

  const applyWindowLevel = (imageData: ImageData, wl: { center: number; width: number }): ImageData => {
    const data = new ImageData(imageData.width, imageData.height);
    const min = wl.center - wl.width / 2;
    const max = wl.center + wl.width / 2;
    const range = max - min;
    
    for (let i = 0; i < imageData.data.length; i += 4) {
      // Convert RGB back to grayscale value (assuming it was stored as grayscale)
      const gray = imageData.data[i];
      
      // Apply window/level
      let normalized = 0;
      if (range > 0) {
        normalized = Math.max(0, Math.min(1, (gray - min) / range));
      }
      
      const value = Math.round(normalized * 255);
      
      data.data[i] = value;
      data.data[i + 1] = value;
      data.data[i + 2] = value;
      data.data[i + 3] = imageData.data[i + 3];
    }
    
    return data;
  };

  const drawCrosshairs = (ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number) => {
    ctx.strokeStyle = '#8B5CF6';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    
    // Vertical line
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
    
    // Horizontal line
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
    
    ctx.setLineDash([]);
  };

  const handleCanvasClick = (event: React.MouseEvent<HTMLCanvasElement>, plane: 'axial' | 'sagittal' | 'coronal') => {
    if (!volumeData) return;
    
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    const clickX = (event.clientX - rect.left) * scaleX;
    const clickY = (event.clientY - rect.top) * scaleY;
    
    let newCrosshair = { ...crosshair };
    
    switch (plane) {
      case 'axial':
        newCrosshair.x = Math.round(clickX);
        newCrosshair.y = Math.round(clickY);
        break;
      case 'sagittal':
        newCrosshair.z = Math.round(clickX);
        newCrosshair.y = Math.round(clickY);
        break;
      case 'coronal':
        newCrosshair.x = Math.round(clickX);
        newCrosshair.z = volumeData.dimensions.depth - 1 - Math.round(clickY);
        break;
    }
    
    // Clamp values
    newCrosshair.x = Math.max(0, Math.min(volumeData.dimensions.width - 1, newCrosshair.x));
    newCrosshair.y = Math.max(0, Math.min(volumeData.dimensions.height - 1, newCrosshair.y));
    newCrosshair.z = Math.max(0, Math.min(volumeData.dimensions.depth - 1, newCrosshair.z));
    
    setCrosshair(newCrosshair);
  };

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center bg-black border border-indigo-800 rounded-lg">
        <div className="text-center text-white">
          <div className="animate-spin w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full mx-auto mb-2"></div>
          <p>Loading DICOM volume...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center bg-black border border-indigo-800 rounded-lg">
        <div className="text-center text-red-400">
          <p className="mb-2">Error loading DICOM volume:</p>
          <p className="text-sm">{error}</p>
          <Button onClick={loadVolumeData} className="mt-4 bg-indigo-600 hover:bg-indigo-700">
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full grid grid-cols-2 gap-2 p-2 bg-black border border-indigo-800 rounded-lg">
      {/* Axial View */}
      <div className="relative bg-black border border-indigo-700 rounded overflow-hidden">
        <div className="absolute top-2 left-2 z-10">
          <Badge className="bg-indigo-900 text-indigo-200">
            Axial (Z: {crosshair.z + 1})
          </Badge>
        </div>
        <canvas
          ref={axialRef}
          width={volumeData?.dimensions.width || 512}
          height={volumeData?.dimensions.height || 512}
          className="w-full h-full object-contain cursor-crosshair"
          onClick={(e) => handleCanvasClick(e, 'axial')}
          style={{ imageRendering: 'pixelated' }}
        />
      </div>
      
      {/* Sagittal View */}
      <div className="relative bg-black border border-indigo-700 rounded overflow-hidden">
        <div className="absolute top-2 left-2 z-10">
          <Badge className="bg-indigo-900 text-indigo-200">
            Sagittal (X: {crosshair.x + 1})
          </Badge>
        </div>
        <canvas
          ref={sagittalRef}
          width={volumeData?.dimensions.depth || 20}
          height={volumeData?.dimensions.height || 512}
          className="w-full h-full object-contain cursor-crosshair"
          onClick={(e) => handleCanvasClick(e, 'sagittal')}
          style={{ imageRendering: 'pixelated' }}
        />
      </div>
      
      {/* Coronal View */}
      <div className="relative bg-black border border-indigo-700 rounded overflow-hidden">
        <div className="absolute top-2 left-2 z-10">
          <Badge className="bg-indigo-900 text-indigo-200">
            Coronal (Y: {crosshair.y + 1})
          </Badge>
        </div>
        <canvas
          ref={coronalRef}
          width={volumeData?.dimensions.width || 512}
          height={volumeData?.dimensions.depth || 20}
          className="w-full h-full object-contain cursor-crosshair"
          onClick={(e) => handleCanvasClick(e, 'coronal')}
          style={{ imageRendering: 'pixelated' }}
        />
      </div>
      
      {/* Volume Info */}
      <div className="relative bg-black border border-indigo-700 rounded flex items-center justify-center">
        <div className="text-center text-indigo-400">
          <div className="w-16 h-16 mx-auto mb-2 border-2 border-indigo-600 rounded-lg flex items-center justify-center">
            <div className="w-8 h-8 bg-gradient-to-br from-indigo-500 to-purple-600 rounded opacity-70"></div>
          </div>
          <p className="text-sm font-medium">Volume Info</p>
          {volumeData && (
            <div className="text-xs mt-2 space-y-1">
              <p>{volumeData.dimensions.width} × {volumeData.dimensions.height} × {volumeData.dimensions.depth}</p>
              <p>Position: ({crosshair.x}, {crosshair.y}, {crosshair.z})</p>
              <p>W/L: {windowLevel.width}/{windowLevel.center}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}