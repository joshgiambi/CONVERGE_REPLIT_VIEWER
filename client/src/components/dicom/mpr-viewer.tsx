import { useEffect, useRef, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, RotateCw, ZoomIn, ZoomOut } from 'lucide-react';

interface MPRViewerProps {
  seriesId: number;
  rtStructures?: any;
  structureVisibility?: Map<number, boolean>;
}

interface VolumeData {
  width: number;
  height: number;
  depth: number;
  data: Uint16Array;
  spacing: [number, number, number];
  origin: [number, number, number];
}

export function MPRViewer({ seriesId, rtStructures, structureVisibility }: MPRViewerProps) {
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
      const imagePosition = firstDataSet.string('x00200032')?.split('\\') || ['0', '0', '0'];

      const spacing: [number, number, number] = [
        parseFloat(pixelSpacing[0]),
        parseFloat(pixelSpacing[1]),
        sliceThickness
      ];
      const origin: [number, number, number] = [
        parseFloat(imagePosition[0]),
        parseFloat(imagePosition[1]),
        parseFloat(imagePosition[2])
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
        origin
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
    drawAxialContours(ctx);
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
    drawSagittalContours(ctx);
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
    drawCoronalContours(ctx);
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

  const drawAxialContours = (ctx: CanvasRenderingContext2D) => {
    if (!rtStructures || !volumeData) return;
    const zPos = crosshair.z;
    const sliceZ = volumeData.origin[2] + zPos * volumeData.spacing[2];
    for (const structure of rtStructures.structures || []) {
      if (structureVisibility && !structureVisibility.get(structure.roiNumber)) continue;
      ctx.strokeStyle = `rgb(${structure.color.join(',')})`;
      ctx.lineWidth = 1;
      for (const contour of structure.contours) {
        if (Math.abs(contour.slicePosition - sliceZ) > volumeData.spacing[2] / 2) continue;
        ctx.beginPath();
        const pts = contour.points;
        for (let i = 0; i < pts.length; i += 3) {
          const x = (pts[i] - volumeData.origin[0]) / volumeData.spacing[0];
          const y = (pts[i + 1] - volumeData.origin[1]) / volumeData.spacing[1];
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.stroke();
      }
    }
  };

  const drawSagittalContours = (ctx: CanvasRenderingContext2D) => {
    if (!rtStructures || !volumeData) return;
    const planeX = crosshair.x * volumeData.spacing[0] + volumeData.origin[0];
    for (const structure of rtStructures.structures || []) {
      if (structureVisibility && !structureVisibility.get(structure.roiNumber)) continue;
      ctx.strokeStyle = `rgb(${structure.color.join(',')})`;
      ctx.lineWidth = 1;
      for (const contour of structure.contours) {
        const pts = contour.points;
        const zIndex = Math.round((contour.slicePosition - volumeData.origin[2]) / volumeData.spacing[2]);
        const intersections: number[] = [];
        for (let i = 0; i < pts.length; i += 3) {
          const x1 = pts[i];
          const y1 = pts[i + 1];
          const x2 = pts[(i + 3) % pts.length];
          const y2 = pts[(i + 4) % pts.length];
          if ((x1 <= planeX && x2 >= planeX) || (x2 <= planeX && x1 >= planeX)) {
            const t = (planeX - x1) / (x2 - x1);
            const y = y1 + t * (y2 - y1);
            const yPix = (y - volumeData.origin[1]) / volumeData.spacing[1];
            intersections.push(yPix);
          }
        }
        intersections.sort((a, b) => a - b);
        for (let k = 0; k < intersections.length; k += 2) {
          const y1 = intersections[k];
          const y2 = intersections[k + 1];
          if (y2 === undefined) continue;
          ctx.beginPath();
          ctx.moveTo(zIndex, y1);
          ctx.lineTo(zIndex, y2);
          ctx.stroke();
        }
      }
    }
  };

  const drawCoronalContours = (ctx: CanvasRenderingContext2D) => {
    if (!rtStructures || !volumeData) return;
    const planeY = crosshair.y * volumeData.spacing[1] + volumeData.origin[1];
    for (const structure of rtStructures.structures || []) {
      if (structureVisibility && !structureVisibility.get(structure.roiNumber)) continue;
      ctx.strokeStyle = `rgb(${structure.color.join(',')})`;
      ctx.lineWidth = 1;
      for (const contour of structure.contours) {
        const pts = contour.points;
        const zIndex = Math.round((contour.slicePosition - volumeData.origin[2]) / volumeData.spacing[2]);
        const intersections: number[] = [];
        for (let i = 0; i < pts.length; i += 3) {
          const x1 = pts[i];
          const y1 = pts[i + 1];
          const x2 = pts[(i + 3) % pts.length];
          const y2 = pts[(i + 4) % pts.length];
          if ((y1 <= planeY && y2 >= planeY) || (y2 <= planeY && y1 >= planeY)) {
            const t = (planeY - y1) / (y2 - y1);
            const x = x1 + t * (x2 - x1);
            const xPix = (x - volumeData.origin[0]) / volumeData.spacing[0];
            intersections.push(xPix);
          }
        }
        intersections.sort((a, b) => a - b);
        for (let k = 0; k < intersections.length; k += 2) {
          const x1 = intersections[k];
          const x2 = intersections[k + 1];
          if (x2 === undefined) continue;
          ctx.beginPath();
          ctx.moveTo(x1, zIndex);
          ctx.lineTo(x2, zIndex);
          ctx.stroke();
        }
      }
    }
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

      <div className="flex-1 p-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 h-full">
          {/* Axial View */}
          <div className="relative bg-black border border-indigo-700 rounded">
            <div className="absolute top-2 left-2 z-10">
              <Badge className="bg-red-900 text-red-200">Axial View</Badge>
            </div>
            <canvas
              ref={axialCanvasRef}
              onClick={(e) => handleCanvasClick(e, 'axial')}
              className="w-full h-full object-contain cursor-crosshair"
              style={{ imageRendering: 'pixelated' }}
            />
          </div>

          {/* Sagittal View */}
          <div className="relative bg-black border border-indigo-700 rounded hidden md:block">
            <div className="absolute top-2 left-2 z-10">
              <Badge className="bg-green-900 text-green-200">Sagittal View</Badge>
            </div>
            <canvas
              ref={sagittalCanvasRef}
              onClick={(e) => handleCanvasClick(e, 'sagittal')}
              className="w-full h-full object-contain cursor-crosshair"
              style={{ imageRendering: 'pixelated' }}
            />
          </div>

          {/* Coronal View */}
          <div className="relative bg-black border border-indigo-700 rounded hidden md:block">
            <div className="absolute top-2 left-2 z-10">
              <Badge className="bg-blue-900 text-blue-200">Coronal View</Badge>
            </div>
            <canvas
              ref={coronalCanvasRef}
              onClick={(e) => handleCanvasClick(e, 'coronal')}
              className="w-full h-full object-contain cursor-crosshair"
              style={{ imageRendering: 'pixelated' }}
            />
          </div>
        </div>
        {volumeData && (
          <div className="mt-2 text-xs text-indigo-300">
            Size: {volumeData.width} × {volumeData.height} × {volumeData.depth} | Spacing: {volumeData.spacing.map(s => s.toFixed(1)).join(' × ')} mm
          </div>
        )}
      </div>
    </Card>
  );
}

declare global {
  interface Window {
    dicomParser: any;
  }
}