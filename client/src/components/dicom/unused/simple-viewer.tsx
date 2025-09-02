import { useEffect, useRef, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Move, RotateCw, Maximize2, ChevronLeft, ChevronRight } from 'lucide-react';
import { dicomLoader } from '@/lib/dicom-loader';

interface SimpleViewerProps {
  seriesId: number;
}

export function SimpleViewer({ seriesId }: SimpleViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [images, setImages] = useState<any[]>([]);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadSeriesImages();
  }, [seriesId]);

  const loadSeriesImages = async () => {
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
      
      setImages(sortedImages);
      
      if (sortedImages.length > 0) {
        loadDicomImage(sortedImages[0]);
      }
      
    } catch (error: any) {
      console.error('Error loading series images:', error);
      setError(error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const loadDicomImage = async (image: any) => {
    try {
      setError(null);
      
      if (!canvasRef.current) return;
      
      const ctx = canvasRef.current.getContext('2d');
      if (!ctx) return;
      
      // Clear canvas
      ctx.fillStyle = 'black';
      ctx.fillRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      
      // Show loading text
      ctx.fillStyle = 'white';
      ctx.font = '16px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('Loading DICOM...', canvasRef.current.width / 2, canvasRef.current.height / 2);
      
      // Load DICOM image
      const dicomCanvas = await dicomLoader.loadDICOMImage(image.sopInstanceUID);
      
      // Draw the DICOM image onto our canvas
      ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      ctx.drawImage(dicomCanvas, 0, 0, canvasRef.current.width, canvasRef.current.height);
      
    } catch (error: any) {
      console.error('Error loading DICOM image:', error);
      setError(`Failed to load image: ${error.message}`);
      
      // Show error on canvas
      if (canvasRef.current) {
        const ctx = canvasRef.current.getContext('2d');
        if (ctx) {
          ctx.fillStyle = 'black';
          ctx.fillRect(0, 0, canvasRef.current.width, canvasRef.current.height);
          ctx.fillStyle = 'red';
          ctx.font = '16px Arial';
          ctx.textAlign = 'center';
          ctx.fillText('Error loading DICOM', canvasRef.current.width / 2, canvasRef.current.height / 2 - 10);
          ctx.fillText(error.message, canvasRef.current.width / 2, canvasRef.current.height / 2 + 10);
        }
      }
    }
  };

  const goToPreviousImage = () => {
    if (images.length > 0 && currentImageIndex > 0) {
      const newIndex = currentImageIndex - 1;
      setCurrentImageIndex(newIndex);
      loadDicomImage(images[newIndex]);
    }
  };

  const goToNextImage = () => {
    if (images.length > 0 && currentImageIndex < images.length - 1) {
      const newIndex = currentImageIndex + 1;
      setCurrentImageIndex(newIndex);
      loadDicomImage(images[newIndex]);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        goToPreviousImage();
      } else if (e.key === 'ArrowRight') {
        goToNextImage();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentImageIndex, images]);

  return (
    <div className="h-full flex flex-col bg-black">
      <div className="flex items-center justify-between p-4 bg-gradient-to-r from-indigo-950 to-purple-950 border-b border-indigo-800">
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
            <Move className="w-5 h-5 text-indigo-400" />
            <span className="text-white font-medium">DICOM Viewer</span>
          </div>
          {images.length > 0 && (
            <Badge variant="secondary" className="bg-indigo-900 text-indigo-100">
              {currentImageIndex + 1} / {images.length}
            </Badge>
          )}
        </div>
        
        <div className="flex items-center space-x-2">
          <Button
            size="sm"
            variant="outline"
            onClick={goToPreviousImage}
            disabled={currentImageIndex === 0}
            className="border-indigo-600 hover:bg-indigo-800"
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={goToNextImage}
            disabled={currentImageIndex === images.length - 1}
            className="border-indigo-600 hover:bg-indigo-800"
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div className="flex-1 p-4">
        <Card className="h-full bg-black border-indigo-800">
          <div className="h-full p-4 flex items-center justify-center">
            {isLoading ? (
              <div className="text-white text-center">
                <div className="animate-spin w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full mx-auto mb-2"></div>
                <p>Loading DICOM images...</p>
              </div>
            ) : error ? (
              <div className="text-red-400 text-center">
                <p className="mb-2">Error loading DICOM viewer:</p>
                <p className="text-sm">{error}</p>
                <Button 
                  onClick={loadSeriesImages}
                  className="mt-4 bg-indigo-600 hover:bg-indigo-700"
                >
                  Retry
                </Button>
              </div>
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <canvas
                  ref={canvasRef}
                  width={512}
                  height={512}
                  className="max-w-full max-h-full object-contain border border-indigo-700 rounded"
                  style={{ 
                    backgroundColor: 'black',
                    imageRendering: 'pixelated'
                  }}
                />
              </div>
            )}
          </div>
        </Card>
      </div>

      {images.length > 0 && (
        <div className="p-4 bg-gradient-to-r from-indigo-950 to-purple-950 border-t border-indigo-800">
          <div className="flex items-center justify-between text-sm text-indigo-200">
            <div>
              <span className="text-indigo-300">Image:</span> {images[currentImageIndex]?.fileName}
            </div>
            <div>
              <span className="text-indigo-300">Size:</span> {Math.round((images[currentImageIndex]?.fileSize || 0) / 1024)} KB
            </div>
            <div>
              <span className="text-indigo-300">Instance:</span> {images[currentImageIndex]?.instanceNumber}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}