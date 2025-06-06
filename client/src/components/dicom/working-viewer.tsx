import { useEffect, useRef, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface WorkingViewerProps {
  seriesId: number;
}

export function WorkingViewer({ seriesId }: WorkingViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [images, setImages] = useState<any[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadImages();
  }, [seriesId]);

  useEffect(() => {
    if (images.length > 0) {
      displayCurrentImage();
    }
  }, [images, currentIndex]);

  const loadImages = async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      const response = await fetch(`/api/series/${seriesId}`);
      if (!response.ok) {
        throw new Error(`Failed to load series: ${response.statusText}`);
      }
      
      const seriesData = await response.json();
      
      // Sort by slice location first, then by instance number
      const sortedImages = seriesData.images.sort((a: any, b: any) => {
        // Try slice location first (more reliable for CT ordering)
        if (a.sliceLocation !== undefined && b.sliceLocation !== undefined) {
          return parseFloat(a.sliceLocation) - parseFloat(b.sliceLocation);
        }
        
        // Fall back to instance number
        if (a.instanceNumber !== undefined && b.instanceNumber !== undefined) {
          return parseInt(a.instanceNumber) - parseInt(b.instanceNumber);
        }
        
        // Fall back to filename comparison
        return a.fileName.localeCompare(b.fileName, undefined, { numeric: true });
      });
      
      setImages(sortedImages);
      setCurrentIndex(0);
      
    } catch (error: any) {
      setError(error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const displayCurrentImage = async () => {
    if (!canvasRef.current || images.length === 0) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    try {
      const currentImage = images[currentIndex];
      
      // Clear canvas
      ctx.fillStyle = 'black';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      // Show loading text
      ctx.fillStyle = 'white';
      ctx.font = '16px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('Loading...', canvas.width / 2, canvas.height / 2);
      
      // Load DICOM file directly
      const response = await fetch(`/api/images/${currentImage.sopInstanceUID}`);
      if (!response.ok) {
        throw new Error(`Failed to load image: ${response.statusText}`);
      }
      
      const arrayBuffer = await response.arrayBuffer();
      
      // Load dicom-parser
      if (!window.dicomParser) {
        await loadDicomParser();
      }
      
      // Parse DICOM
      const byteArray = new Uint8Array(arrayBuffer);
      const dataSet = window.dicomParser.parseDicom(byteArray);
      
      // Extract image data
      const pixelData = dataSet.elements.x7fe00010;
      if (!pixelData) {
        throw new Error('No pixel data found in DICOM');
      }
      
      const rows = dataSet.uint16('x00280010') || 512;
      const cols = dataSet.uint16('x00280011') || 512;
      const bitsAllocated = dataSet.uint16('x00280100') || 16;
      
      // Set canvas size to match DICOM
      canvas.width = cols;
      canvas.height = rows;
      
      // Get pixel data
      const pixelDataOffset = pixelData.dataOffset;
      const pixelDataLength = pixelData.length;
      
      if (bitsAllocated === 16) {
        const pixelArray = new Uint16Array(arrayBuffer, pixelDataOffset, pixelDataLength / 2);
        render16BitImage(ctx, pixelArray, cols, rows);
      } else if (bitsAllocated === 8) {
        const pixelArray = new Uint8Array(arrayBuffer, pixelDataOffset, pixelDataLength);
        render8BitImage(ctx, pixelArray, cols, rows);
      } else {
        throw new Error(`Unsupported bits allocated: ${bitsAllocated}`);
      }
      
    } catch (error: any) {
      console.error('Error displaying image:', error);
      ctx.fillStyle = 'black';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = 'red';
      ctx.font = '16px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('Error loading DICOM', canvas.width / 2, canvas.height / 2 - 10);
      ctx.fillText(error.message, canvas.width / 2, canvas.height / 2 + 10);
    }
  };

  const render16BitImage = (ctx: CanvasRenderingContext2D, pixelArray: Uint16Array, width: number, height: number) => {
    const imageData = ctx.createImageData(width, height);
    const data = imageData.data;

    // Find min/max for auto-windowing
    let min = pixelArray[0];
    let max = pixelArray[0];
    for (let i = 1; i < pixelArray.length; i++) {
      if (pixelArray[i] < min) min = pixelArray[i];
      if (pixelArray[i] > max) max = pixelArray[i];
    }

    const range = max - min;
    
    for (let i = 0; i < pixelArray.length; i++) {
      const normalizedValue = range > 0 ? ((pixelArray[i] - min) / range) * 255 : 0;
      const gray = Math.max(0, Math.min(255, normalizedValue));
      
      const pixelIndex = i * 4;
      data[pixelIndex] = gray;     // R
      data[pixelIndex + 1] = gray; // G
      data[pixelIndex + 2] = gray; // B
      data[pixelIndex + 3] = 255;  // A
    }

    ctx.putImageData(imageData, 0, 0);
  };

  const render8BitImage = (ctx: CanvasRenderingContext2D, pixelArray: Uint8Array, width: number, height: number) => {
    const imageData = ctx.createImageData(width, height);
    const data = imageData.data;

    for (let i = 0; i < pixelArray.length; i++) {
      const gray = pixelArray[i];
      const pixelIndex = i * 4;
      data[pixelIndex] = gray;     // R
      data[pixelIndex + 1] = gray; // G
      data[pixelIndex + 2] = gray; // B
      data[pixelIndex + 3] = 255;  // A
    }

    ctx.putImageData(imageData, 0, 0);
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

  const goToPrevious = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    }
  };

  const goToNext = () => {
    if (currentIndex < images.length - 1) {
      setCurrentIndex(currentIndex + 1);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') goToPrevious();
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') goToNext();
    };

    const handleWheel = (e: WheelEvent) => {
      // Only handle wheel events if mouse is over the canvas
      if (canvasRef.current && canvasRef.current.contains(e.target as Node)) {
        e.preventDefault();
        if (e.deltaY > 0) {
          goToNext();
        } else {
          goToPrevious();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('wheel', handleWheel, { passive: false });
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('wheel', handleWheel);
    };
  }, [currentIndex, images]);

  if (isLoading) {
    return (
      <Card className="h-full bg-black border-indigo-800 flex items-center justify-center">
        <div className="text-center text-white">
          <div className="animate-spin w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full mx-auto mb-2"></div>
          <p>Loading CT scan...</p>
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="h-full bg-black border-indigo-800 flex items-center justify-center">
        <div className="text-center text-red-400">
          <p className="mb-2">Error loading CT scan:</p>
          <p className="text-sm">{error}</p>
          <Button onClick={loadImages} className="mt-4 bg-indigo-600 hover:bg-indigo-700">
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
            CT Scan
          </Badge>
          {images.length > 0 && (
            <Badge variant="outline" className="border-indigo-600 text-indigo-300">
              {currentIndex + 1} / {images.length}
            </Badge>
          )}
        </div>
        
        <div className="flex items-center space-x-2">
          <Button
            size="sm"
            variant="outline"
            onClick={goToPrevious}
            disabled={currentIndex === 0}
            className="border-indigo-600 hover:bg-indigo-800"
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={goToNext}
            disabled={currentIndex === images.length - 1}
            className="border-indigo-600 hover:bg-indigo-800"
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1 p-4 flex items-center justify-center">
        <div className="relative">
          <canvas
            ref={canvasRef}
            width={512}
            height={512}
            className="max-w-full max-h-full object-contain border border-indigo-700 rounded cursor-crosshair"
            style={{ 
              backgroundColor: 'black',
              imageRendering: 'pixelated'
            }}
          />
          {/* Scroll indicator */}
          <div className="absolute top-2 right-2 bg-black bg-opacity-75 text-white px-2 py-1 rounded text-xs">
            Scroll to navigate
          </div>
        </div>
      </div>

      {/* Footer */}
      {images.length > 0 && (
        <div className="p-4 border-t border-indigo-700">
          <div className="flex items-center justify-between text-sm text-indigo-200">
            <div>
              <span className="text-indigo-300">File:</span> {images[currentIndex]?.fileName}
            </div>
            <div>
              <span className="text-indigo-300">Size:</span> {Math.round((images[currentIndex]?.fileSize || 0) / 1024)} KB
            </div>
            <div>
              <span className="text-indigo-300">Instance:</span> {images[currentIndex]?.instanceNumber}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

declare global {
  interface Window {
    dicomParser: any;
  }
}