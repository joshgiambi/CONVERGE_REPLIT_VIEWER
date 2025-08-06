import React, { useEffect, useState } from 'react';
import { X, ChevronLeft, ChevronRight, Loader2, Play, Pause } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface DicomPreviewModalProps {
  seriesId: number | null;
  onClose: () => void;
}

export function DicomPreviewModal({ seriesId, onClose }: DicomPreviewModalProps) {
  const [images, setImages] = useState<any[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [isAutoPlaying, setIsAutoPlaying] = useState(false);
  const [imageUrls, setImageUrls] = useState<string[]>([]);

  useEffect(() => {
    if (!seriesId) return;

    const loadSeries = async () => {
      try {
        setIsLoading(true);
        setHasError(false);

        // Fetch all images from the series
        const response = await fetch(`/api/series/${seriesId}/images`);
        if (!response.ok) throw new Error('Failed to fetch images');
        
        const imageList = await response.json();
        if (!imageList || imageList.length === 0) throw new Error('No images found');

        setImages(imageList);
        
        // Generate URLs for all images
        const urls = imageList.map((img: any) => `/api/images/${img.sopInstanceUID}`);
        setImageUrls(urls);
        
        setIsLoading(false);
        
        // Start auto-play if multiple images
        if (imageList.length > 1) {
          setIsAutoPlaying(true);
        }
      } catch (error) {
        console.error('Error loading series:', error);
        setHasError(true);
        setIsLoading(false);
      }
    };

    loadSeries();

    // Cleanup
    return () => {
      stopAutoPlay();
    };
  }, [seriesId]);

  useEffect(() => {
    if (isAutoPlaying && images.length > 1) {
      const interval = setInterval(() => {
        setCurrentIndex(prev => (prev + 1) % images.length);
      }, 200); // Change image every 200ms

      return () => clearInterval(interval);
    }
  }, [isAutoPlaying, images.length]);

  const stopAutoPlay = () => {
    setIsAutoPlaying(false);
  };

  const handlePrevious = () => {
    stopAutoPlay();
    const newIndex = currentIndex > 0 ? currentIndex - 1 : images.length - 1;
    setCurrentIndex(newIndex);
  };

  const handleNext = () => {
    stopAutoPlay();
    const newIndex = (currentIndex + 1) % images.length;
    setCurrentIndex(newIndex);
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (e.deltaY > 0) {
      handleNext();
    } else {
      handlePrevious();
    }
  };

  if (!seriesId) return null;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div 
        className="relative bg-gray-900 rounded-lg shadow-2xl border border-gray-700 p-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <Button
          size="sm"
          variant="ghost"
          className="absolute top-2 right-2 z-10 h-8 w-8 p-0 hover:bg-gray-800"
          onClick={onClose}
        >
          <X className="h-5 w-5" />
        </Button>

        {/* Navigation info */}
        <div className="absolute top-2 left-2 z-10 text-sm text-gray-400">
          {images.length > 0 && `${currentIndex + 1} / ${images.length}`}
        </div>

        {/* Image Display */}
        <div 
          className="bg-black rounded relative"
          style={{ width: '512px', height: '512px' }}
          onWheel={handleWheel}
        >
          {isLoading ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
            </div>
          ) : hasError ? (
            <div className="absolute inset-0 flex items-center justify-center text-red-400">
              Failed to load images
            </div>
          ) : imageUrls.length > 0 ? (
            <img 
              src={imageUrls[currentIndex]}
              alt={`Slice ${currentIndex + 1}`}
              className="w-full h-full object-contain"
              onError={() => setHasError(true)}
            />
          ) : null}
        </div>

        {/* Navigation buttons */}
        {images.length > 1 && !isAutoPlaying && (
          <div className="flex justify-between mt-4">
            <Button
              size="sm"
              variant="outline"
              onClick={handlePrevious}
              className="flex items-center gap-1"
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setIsAutoPlaying(true);
              }}
            >
              <Play className="h-4 w-4 mr-1" />
              Auto Play
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleNext}
              className="flex items-center gap-1"
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}

        {/* Instructions */}
        <div className="text-center text-xs text-gray-500 mt-2">
          Use mouse wheel to scroll through images • Click outside to close
        </div>
      </div>
    </div>
  );
}