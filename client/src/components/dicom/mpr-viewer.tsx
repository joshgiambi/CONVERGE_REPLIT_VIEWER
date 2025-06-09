import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { useQuery } from '@tanstack/react-query';

interface MPRViewerProps {
  seriesId: number;
}

interface DICOMImage {
  id: number;
  instanceNumber: number;
  sopInstanceUID: string;
  filePath: string;
  fileName: string;
  imagePosition: number[];
  metadata?: any;
}

interface ImageData {
  pixels: Float32Array;
  width: number;
  height: number;
  windowCenter: number;
  windowWidth: number;
}

export function MPRViewer({ seriesId }: MPRViewerProps) {
  const [axialSlice, setAxialSlice] = useState(76); // Middle slice
  const [sagittalSlice, setSagittalSlice] = useState(256); // Middle sagittal
  const [coronalSlice, setCoronalSlice] = useState(256); // Middle coronal
  const [windowLevel, setWindowLevel] = useState({ window: 400, level: 40 });
  
  const axialCanvasRef = useRef<HTMLCanvasElement>(null);
  const sagittalCanvasRef = useRef<HTMLCanvasElement>(null);
  const coronalCanvasRef = useRef<HTMLCanvasElement>(null);
  
  const [imageCache, setImageCache] = useState<Map<string, ImageData>>(new Map());
  const [volumeData, setVolumeData] = useState<Float32Array | null>(null);
  const [dimensions, setDimensions] = useState({ width: 512, height: 512, depth: 153 });

  // Fetch series images
  const { data: images, isLoading } = useQuery<DICOMImage[]>({
    queryKey: ['/api/series', seriesId, 'images'],
    enabled: !!seriesId,
  });

  // Load and cache DICOM images
  const loadDICOMImage = useCallback(async (sopInstanceUID: string): Promise<ImageData | null> => {
    if (imageCache.has(sopInstanceUID)) {
      return imageCache.get(sopInstanceUID)!;
    }

    try {
      const response = await fetch(`/api/images/${sopInstanceUID}`);
      if (!response.ok) {
        console.error(`Failed to load DICOM image: ${sopInstanceUID}`);
        return null;
      }

      const arrayBuffer = await response.arrayBuffer();
      const byteArray = new Uint8Array(arrayBuffer);
      
      // Use dicom-parser from window global
      const dataSet = (window as any).dicomParser.parseDicom(byteArray);
      
      // Extract image dimensions and pixel data
      const rows = dataSet.uint16('x00280010');
      const cols = dataSet.uint16('x00280011');
      const pixelData = dataSet.elements.x7fe00010;
      const bitsAllocated = dataSet.uint16('x00280100') || 16;
      
      // Extract window/level values
      const windowCenter = parseFloat(dataSet.string('x00281050') || '40');
      const windowWidth = parseFloat(dataSet.string('x00281051') || '400');
      
      let pixels: Float32Array;
      
      if (bitsAllocated === 16) {
        // 16-bit signed data
        const pixelArray = new Int16Array(arrayBuffer, pixelData.dataOffset, pixelData.length / 2);
        pixels = new Float32Array(pixelArray);
      } else {
        // 8-bit data
        const pixelArray = new Uint8Array(arrayBuffer, pixelData.dataOffset, pixelData.length);
        pixels = new Float32Array(pixelArray);
      }

      const imageData: ImageData = {
        pixels,
        width: cols,
        height: rows,
        windowCenter,
        windowWidth,
      };

      // Cache the image data
      setImageCache(prev => new Map(prev).set(sopInstanceUID, imageData));
      
      return imageData;
    } catch (error) {
      console.error(`Error loading DICOM image ${sopInstanceUID}:`, error);
      return null;
    }
  }, [imageCache]);

  // Build 3D volume from loaded images
  const buildVolumeData = useCallback(async () => {
    if (!images || images.length === 0) return;

    console.log('Building volume data from', images.length, 'images');
    
    // Load first image to get dimensions
    const firstImage = await loadDICOMImage(images[0].sopInstanceUID);
    if (!firstImage) return;

    const { width, height } = firstImage;
    const depth = images.length;
    
    setDimensions({ width, height, depth });
    
    // Create volume array
    const volume = new Float32Array(width * height * depth);
    
    // Load and copy each slice into volume
    for (let i = 0; i < images.length; i++) {
      const imageData = await loadDICOMImage(images[i].sopInstanceUID);
      if (imageData) {
        const sliceOffset = i * width * height;
        volume.set(imageData.pixels, sliceOffset);
      }
    }
    
    setVolumeData(volume);
    console.log('Volume data built:', { width, height, depth });
  }, [images, loadDICOMImage]);

  // Render axial slice (original CT slices)
  const renderAxialSlice = useCallback((sliceIndex: number) => {
    if (!volumeData || !axialCanvasRef.current) return;

    const canvas = axialCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height } = dimensions;
    canvas.width = width;
    canvas.height = height;

    // Extract slice data
    const sliceOffset = sliceIndex * width * height;
    const sliceData = volumeData.slice(sliceOffset, sliceOffset + width * height);

    // Apply window/level and convert to displayable format
    const imageData = ctx.createImageData(width, height);
    const data = imageData.data;

    for (let i = 0; i < sliceData.length; i++) {
      const pixelValue = sliceData[i];
      const windowedValue = ((pixelValue - windowLevel.level + windowLevel.window / 2) / windowLevel.window) * 255;
      const clampedValue = Math.max(0, Math.min(255, windowedValue));
      
      const pixelIndex = i * 4;
      data[pixelIndex] = clampedValue;     // R
      data[pixelIndex + 1] = clampedValue; // G
      data[pixelIndex + 2] = clampedValue; // B
      data[pixelIndex + 3] = 255;          // A
    }

    ctx.putImageData(imageData, 0, 0);
  }, [volumeData, dimensions, windowLevel]);

  // Render sagittal slice (side view)
  const renderSagittalSlice = useCallback((sliceIndex: number) => {
    if (!volumeData || !sagittalCanvasRef.current) return;

    const canvas = sagittalCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height, depth } = dimensions;
    canvas.width = depth;
    canvas.height = height;

    // Extract sagittal slice data
    const imageData = ctx.createImageData(depth, height);
    const data = imageData.data;

    for (let z = 0; z < depth; z++) {
      for (let y = 0; y < height; y++) {
        const volumeIndex = z * width * height + y * width + sliceIndex;
        const pixelValue = volumeData[volumeIndex];
        
        const windowedValue = ((pixelValue - windowLevel.level + windowLevel.window / 2) / windowLevel.window) * 255;
        const clampedValue = Math.max(0, Math.min(255, windowedValue));
        
        const pixelIndex = (y * depth + z) * 4;
        data[pixelIndex] = clampedValue;     // R
        data[pixelIndex + 1] = clampedValue; // G
        data[pixelIndex + 2] = clampedValue; // B
        data[pixelIndex + 3] = 255;          // A
      }
    }

    ctx.putImageData(imageData, 0, 0);
  }, [volumeData, dimensions, windowLevel]);

  // Render coronal slice (front view)
  const renderCoronalSlice = useCallback((sliceIndex: number) => {
    if (!volumeData || !coronalCanvasRef.current) return;

    const canvas = coronalCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height, depth } = dimensions;
    canvas.width = width;
    canvas.height = depth;

    // Extract coronal slice data
    const imageData = ctx.createImageData(width, depth);
    const data = imageData.data;

    for (let z = 0; z < depth; z++) {
      for (let x = 0; x < width; x++) {
        const volumeIndex = z * width * height + sliceIndex * width + x;
        const pixelValue = volumeData[volumeIndex];
        
        const windowedValue = ((pixelValue - windowLevel.level + windowLevel.window / 2) / windowLevel.window) * 255;
        const clampedValue = Math.max(0, Math.min(255, windowedValue));
        
        const pixelIndex = (z * width + x) * 4;
        data[pixelIndex] = clampedValue;     // R
        data[pixelIndex + 1] = clampedValue; // G
        data[pixelIndex + 2] = clampedValue; // B
        data[pixelIndex + 3] = 255;          // A
      }
    }

    ctx.putImageData(imageData, 0, 0);
  }, [volumeData, dimensions, windowLevel]);

  // Build volume when images load
  useEffect(() => {
    if (images && images.length > 0) {
      buildVolumeData();
    }
  }, [images, buildVolumeData]);

  // Re-render views when parameters change
  useEffect(() => {
    renderAxialSlice(axialSlice);
  }, [axialSlice, renderAxialSlice]);

  useEffect(() => {
    renderSagittalSlice(sagittalSlice);
  }, [sagittalSlice, renderSagittalSlice]);

  useEffect(() => {
    renderCoronalSlice(coronalSlice);
  }, [coronalSlice, renderCoronalSlice]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-lg">Loading MPR viewer...</div>
      </div>
    );
  }

  if (!images || images.length === 0) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-lg">No images found for this series</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Multi-Planar Reconstruction</h2>
        <div className="flex items-center space-x-4">
          <Badge variant="outline">
            {images.length} slices
          </Badge>
          <Badge variant="outline">
            {dimensions.width} × {dimensions.height}
          </Badge>
        </div>
      </div>

      {/* Window/Level Controls */}
      <Card>
        <CardHeader>
          <CardTitle>Window/Level</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2">
                Window: {windowLevel.window}
              </label>
              <Slider
                value={[windowLevel.window]}
                onValueChange={([value]) => setWindowLevel(prev => ({ ...prev, window: value }))}
                min={1}
                max={2000}
                step={1}
                className="w-full"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">
                Level: {windowLevel.level}
              </label>
              <Slider
                value={[windowLevel.level]}
                onValueChange={([value]) => setWindowLevel(prev => ({ ...prev, level: value }))}
                min={-1000}
                max={1000}
                step={1}
                className="w-full"
              />
            </div>
          </div>
          <div className="flex space-x-2">
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => setWindowLevel({ window: 400, level: 40 })}
            >
              Soft Tissue
            </Button>
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => setWindowLevel({ window: 1500, level: 400 })}
            >
              Bone
            </Button>
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => setWindowLevel({ window: 2000, level: -500 })}
            >
              Lung
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* MPR Views */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Axial View */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              Axial
              <Badge variant="secondary">Slice {axialSlice}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="relative">
              <canvas
                ref={axialCanvasRef}
                className="w-full border border-gray-300 dark:border-gray-600"
                style={{ maxWidth: '300px', height: 'auto' }}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">
                Slice Position
              </label>
              <Slider
                value={[axialSlice]}
                onValueChange={([value]) => setAxialSlice(value)}
                min={0}
                max={dimensions.depth - 1}
                step={1}
                className="w-full"
              />
            </div>
          </CardContent>
        </Card>

        {/* Sagittal View */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              Sagittal
              <Badge variant="secondary">Slice {sagittalSlice}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="relative">
              <canvas
                ref={sagittalCanvasRef}
                className="w-full border border-gray-300 dark:border-gray-600"
                style={{ maxWidth: '300px', height: 'auto' }}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">
                Slice Position
              </label>
              <Slider
                value={[sagittalSlice]}
                onValueChange={([value]) => setSagittalSlice(value)}
                min={0}
                max={dimensions.width - 1}
                step={1}
                className="w-full"
              />
            </div>
          </CardContent>
        </Card>

        {/* Coronal View */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              Coronal
              <Badge variant="secondary">Slice {coronalSlice}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="relative">
              <canvas
                ref={coronalCanvasRef}
                className="w-full border border-gray-300 dark:border-gray-600"
                style={{ maxWidth: '300px', height: 'auto' }}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">
                Slice Position
              </label>
              <Slider
                value={[coronalSlice]}
                onValueChange={([value]) => setCoronalSlice(value)}
                min={0}
                max={dimensions.height - 1}
                step={1}
                className="w-full"
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Status */}
      <div className="text-sm text-muted-foreground">
        Volume: {dimensions.width} × {dimensions.height} × {dimensions.depth} | 
        Cache: {imageCache.size} images loaded
      </div>
    </div>
  );
}