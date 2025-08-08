import { useEffect, useRef, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, RotateCw, ZoomIn, ZoomOut } from 'lucide-react';

interface MPRViewerProps {
  seriesId: number;
}

interface VolumeData {
  width: number;
  height: number;
  depth: number;
  data: Uint16Array;
  spacing: [number, number, number];
  origin: [number, number, number];
}

export function MPRViewer({ seriesId }: MPRViewerProps) {
  const axialCanvasRef = useRef<HTMLCanvasElement>(null);
  const sagittalCanvasRef = useRef<HTMLCanvasElement>(null);
  const coronalCanvasRef = useRef<HTMLCanvasElement>(null);
  
  const [volumeData, setVolumeData] = useState<VolumeData | null>(null);
  const [crosshair, setCrosshair] = useState({ x: 256, y: 256, z: 10 });
  const [windowLevel, setWindowLevel] = useState({ width: 400, center: 40 });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadVolumeData();
  }, [seriesId]);

  useEffect(() => {
    if (volumeData) {
      renderAllViews();
    }
  }, [volumeData, crosshair, windowLevel]);

  const loadVolumeData = async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      // Load dicom-parser if not available
      if (!window.dicomParser) {
        await loadDicomParser();
      }
      
      const response = await fetch(`/api/series/${seriesId}`);
      if (!response.ok) {
        throw new Error(`Failed to load series: ${response.statusText}`);
      }
      
      const seriesData = await response.json();
      const sortedImages = seriesData.images.sort((a: any, b: any) => 
        (a.instanceNumber || 0) - (b.instanceNumber || 0)
      );
      
      if (sortedImages.length === 0) {
        throw new Error('No images found in series');
      }
      
      // Load first image to get dimensions
      const firstImageResponse = await fetch(`/api/images/${sortedImages[0].sopInstanceUID}`);
      const firstImageBuffer = await firstImageResponse.arrayBuffer();
      const firstByteArray = new Uint8Array(firstImageBuffer);
      const firstDataSet = window.dicomParser.parseDicom(firstByteArray);
      
      const width = firstDataSet.uint16('x00280011') || 512;
      const height = firstDataSet.uint16('x00280010') || 512;
      const depth = sortedImages.length;
      
      // Get pixel spacing and slice thickness
      const pixelSpacing = firstDataSet.string('x00280030')?.split('\\') || ['1', '1'];
      const sliceThickness = parseFloat(firstDataSet.string('x00180050') || '1');
      
      const spacing: [number, number, number] = [
        parseFloat(pixelSpacing[0]),
        parseFloat(pixelSpacing[1]),
        sliceThickness
      ];
      
      // Initialize volume data
      const volumeArray = new Uint16Array(width * height * depth);
      
      // Load all slices
      for (let i = 0; i < sortedImages.length; i++) {
        const imageResponse = await fetch(`/api/images/${sortedImages[i].sopInstanceUID}`);
        const imageBuffer = await imageResponse.arrayBuffer();
        const byteArray = new Uint8Array(imageBuffer);
        const dataSet = window.dicomParser.parseDicom(byteArray);
        
        const pixelData = dataSet.elements.x7fe00010;
        if (!pixelData) continue;
        
        const bitsAllocated = dataSet.uint16('x00280100') || 16;
        
        if (bitsAllocated === 16) {
          const slicePixels = new Uint16Array(imageBuffer, pixelData.dataOffset, pixelData.length / 2);
          const sliceOffset = i * width * height;
          volumeArray.set(slicePixels, sliceOffset);
        }
      }
      
      const volume: VolumeData = {
        width,
        height,
        depth,
        data: volumeArray,
        spacing,
        origin: [0, 0, 0]
      };
      
      setVolumeData(volume);
      setCrosshair({ 
        x: Math.floor(width / 2), 
        y: Math.floor(height / 2), 
        z: Math.floor(depth / 2) 
      });
      
    } catch (error: any) {
      console.error('Error loading volume data:', error);
      setError(error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const loadDicomParser = (): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (window.dicomParser) {
        resolve();
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://unpkg.com/dicom-parser@1.8.21/dist/dicomParser.min.js';
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load dicom-parser'));
      document.head.appendChild(script);
    });
  };

  const renderAllViews = () => {
    if (!volumeData) return;
    
    renderAxialView();
    renderSagittalView();
    renderCoronalView();
  };

  const renderAxialView = () => {
    const canvas = axialCanvasRef.current;
    if (!canvas || !volumeData) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    canvas.width = volumeData.width;
    canvas.height = volumeData.height;
    
    const imageData = ctx.createImageData(volumeData.width, volumeData.height);
    const data = imageData.data;
    
    const sliceOffset = crosshair.z * volumeData.width * volumeData.height;
    
    for (let y = 0; y < volumeData.height; y++) {
      for (let x = 0; x < volumeData.width; x++) {
        const volumeIndex = sliceOffset + y * volumeData.width + x;
        const pixelValue = volumeData.data[volumeIndex];
        
        const windowed = applyWindowLevel(pixelValue);
        const pixelIndex = (y * volumeData.width + x) * 4;
        
        data[pixelIndex] = windowed;     // R
        data[pixelIndex + 1] = windowed; // G
        data[pixelIndex + 2] = windowed; // B
        data[pixelIndex + 3] = 255;      // A
      }
    }
    
    ctx.putImageData(imageData, 0, 0);
    drawCrosshair(ctx, crosshair.x, crosshair.y, 'red');
  };

  const renderSagittalView = () => {
    const canvas = sagittalCanvasRef.current;
    if (!canvas || !volumeData) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    canvas.width = volumeData.depth;
    canvas.height = volumeData.height;
    
    const imageData = ctx.createImageData(volumeData.depth, volumeData.height);
    const data = imageData.data;
    
    for (let y = 0; y < volumeData.height; y++) {
      for (let z = 0; z < volumeData.depth; z++) {
        const volumeIndex = z * volumeData.width * volumeData.height + y * volumeData.width + crosshair.x;
        const pixelValue = volumeData.data[volumeIndex];
        
        const windowed = applyWindowLevel(pixelValue);
        const pixelIndex = (y * volumeData.depth + z) * 4;
        
        data[pixelIndex] = windowed;     // R
        data[pixelIndex + 1] = windowed; // G
        data[pixelIndex + 2] = windowed; // B
        data[pixelIndex + 3] = 255;      // A
      }
    }
    
    ctx.putImageData(imageData, 0, 0);
    drawCrosshair(ctx, crosshair.z, crosshair.y, 'green');
  };

  const renderCoronalView = () => {
    const canvas = coronalCanvasRef.current;
    if (!canvas || !volumeData) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    canvas.width = volumeData.width;
    canvas.height = volumeData.depth;
    
    const imageData = ctx.createImageData(volumeData.width, volumeData.depth);
    const data = imageData.data;
    
    for (let z = 0; z < volumeData.depth; z++) {
      for (let x = 0; x < volumeData.width; x++) {
        const volumeIndex = z * volumeData.width * volumeData.height + crosshair.y * volumeData.width + x;
        const pixelValue = volumeData.data[volumeIndex];
        
        const windowed = applyWindowLevel(pixelValue);
        const pixelIndex = (z * volumeData.width + x) * 4;
        
        data[pixelIndex] = windowed;     // R
        data[pixelIndex + 1] = windowed; // G
        data[pixelIndex + 2] = windowed; // B
        data[pixelIndex + 3] = 255;      // A
      }
    }
    
    ctx.putImageData(imageData, 0, 0);
    drawCrosshair(ctx, crosshair.x, crosshair.z, 'blue');
  };

  const applyWindowLevel = (pixelValue: number): number => {
    const { width, center } = windowLevel;
    const min = center - width / 2;
    const max = center + width / 2;
    
    if (pixelValue <= min) return 0;
    if (pixelValue >= max) return 255;
    
    return Math.round(((pixelValue - min) / width) * 255);
  };

  const drawCrosshair = (ctx: CanvasRenderingContext2D, x: number, y: number, color: string) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    
    // Vertical line
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, ctx.canvas.height);
    ctx.stroke();
    
    // Horizontal line
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(ctx.canvas.width, y);
    ctx.stroke();
    
    ctx.setLineDash([]);
  };

  const handleCanvasClick = (event: React.MouseEvent<HTMLCanvasElement>, view: 'axial' | 'sagittal' | 'coronal') => {
    if (!volumeData) return;
    
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    const x = Math.floor((event.clientX - rect.left) * scaleX);
    const y = Math.floor((event.clientY - rect.top) * scaleY);
    
    const newCrosshair = { ...crosshair };
    
    switch (view) {
      case 'axial':
        newCrosshair.x = Math.max(0, Math.min(volumeData.width - 1, x));
        newCrosshair.y = Math.max(0, Math.min(volumeData.height - 1, y));
        break;
      case 'sagittal':
        newCrosshair.z = Math.max(0, Math.min(volumeData.depth - 1, x));
        newCrosshair.y = Math.max(0, Math.min(volumeData.height - 1, y));
        break;
      case 'coronal':
        newCrosshair.x = Math.max(0, Math.min(volumeData.width - 1, x));
        newCrosshair.z = Math.max(0, Math.min(volumeData.depth - 1, y));
        break;
    }
    
    setCrosshair(newCrosshair);
  };

  const adjustWindowLevel = (deltaWidth: number, deltaCenter: number) => {
    setWindowLevel(prev => ({
      width: Math.max(1, prev.width + deltaWidth),
      center: prev.center + deltaCenter
    }));
  };

  if (isLoading) {
    return (
      <Card className="h-full bg-black border-indigo-800 flex items-center justify-center">
        <div className="text-center text-white">
          <div className="animate-spin w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full mx-auto mb-2"></div>
          <p>Loading MPR volume...</p>
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="h-full bg-black border-indigo-800 flex items-center justify-center">
        <div className="text-center text-red-400">
          <p className="mb-2">Error loading MPR:</p>
          <p className="text-sm">{error}</p>
          <Button onClick={loadVolumeData} className="mt-4 bg-indigo-600 hover:bg-indigo-700">
            Retry
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="h-full bg-black border-indigo-800">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-indigo-700">
        <div className="flex items-center space-x-2">
          <Badge className="bg-indigo-900 text-indigo-200">
            Multi-Planar Reconstruction
          </Badge>
          {volumeData && (
            <Badge variant="outline" className="border-indigo-600 text-indigo-300">
              {volumeData.width}×{volumeData.height}×{volumeData.depth}
            </Badge>
          )}
        </div>
        
        <div className="flex items-center space-x-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => adjustWindowLevel(-50, 0)}
            className="border-indigo-600 hover:bg-indigo-800"
          >
            <ZoomOut className="w-4 h-4" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => adjustWindowLevel(50, 0)}
            className="border-indigo-600 hover:bg-indigo-800"
          >
            <ZoomIn className="w-4 h-4" />
          </Button>
          <span className="text-xs text-indigo-300">
            W:{windowLevel.width} L:{windowLevel.center}
          </span>
        </div>
      </div>

      {/* Axial View Only */}
      <div className="flex-1 p-4">
        <div className="relative bg-black border border-indigo-700 rounded h-full">
          <div className="absolute top-2 left-2 z-10">
            <Badge className="bg-red-900 text-red-200">Axial View</Badge>
          </div>
          <div className="absolute top-2 right-2 z-10">
            <Badge variant="outline" className="border-indigo-600 text-indigo-300">
              Slice {crosshair.z + 1} / {volumeData?.depth || 0}
            </Badge>
          </div>
          <canvas
            ref={axialCanvasRef}
            onClick={(e) => handleCanvasClick(e, 'axial')}
            className="w-full h-full object-contain cursor-crosshair"
            style={{ imageRendering: 'pixelated' }}
          />
          
          {/* Volume Info Overlay */}
          {volumeData && (
            <div className="absolute bottom-2 left-2 bg-black bg-opacity-75 text-white px-2 py-1 rounded text-xs">
              <div>Size: {volumeData.width} × {volumeData.height} × {volumeData.depth}</div>
              <div>Spacing: {volumeData.spacing.map(s => s.toFixed(1)).join(' × ')} mm</div>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

declare global {
  interface Window {
    dicomParser: any;
  }
}