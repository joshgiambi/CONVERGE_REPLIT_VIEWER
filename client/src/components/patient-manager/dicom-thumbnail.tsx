import React, { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';

interface DicomThumbnailProps {
  seriesId: number;
  modality: string;
  imageCount: number;
  onClick?: () => void;
}

export function DicomThumbnail({ seriesId, modality, imageCount, onClick }: DicomThumbnailProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [thumbnailUrls, setThumbnailUrls] = useState<string[]>([]);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const loadThumbnails = async () => {
      try {
        setIsLoading(true);
        setHasError(false);

        // Fetch images from the series
        const imagesResponse = await fetch(`/api/series/${seriesId}/images`);
        if (!imagesResponse.ok) throw new Error('Failed to fetch images');
        
        const images = await imagesResponse.json();
        if (!images || images.length === 0) throw new Error('No images found');

        // Calculate which images to load (max 4, evenly distributed)
        const numPreviewImages = Math.min(4, images.length);
        const indices: number[] = [];
        
        if (images.length <= 4) {
          // Load all images if 4 or fewer
          for (let i = 0; i < images.length; i++) {
            indices.push(i);
          }
        } else {
          // Select 4 evenly distributed images
          const step = (images.length - 1) / (numPreviewImages - 1);
          for (let i = 0; i < numPreviewImages; i++) {
            indices.push(Math.round(i * step));
          }
        }

        // Load the selected images with better windowing
        const urls = indices.map(idx => {
          const targetImage = images[idx];
          // Apply modality-specific windowing
          const windowParams = modality === 'CT' ? 'window=400&level=50' :
                              modality === 'MR' ? 'window=800&level=400' :
                              modality === 'PT' ? 'window=auto&level=auto' :
                              'window=auto&level=auto';
          return `/api/images/${targetImage.sopInstanceUID}/render?size=thumbnail&${windowParams}`;
        });

        setThumbnailUrls(urls);
        setIsLoading(false);
      } catch (error) {
        console.error('Error loading thumbnails:', error);
        setHasError(true);
        setIsLoading(false);
      }
    };

    loadThumbnails();

    // Cleanup
    return () => {
      thumbnailUrls.forEach(url => {
        if (url && url.startsWith('blob:')) {
          URL.revokeObjectURL(url);
        }
      });
    };
  }, [seriesId, modality]);

  // Set up image cycling
  useEffect(() => {
    if (thumbnailUrls.length > 1) {
      intervalRef.current = setInterval(() => {
        setCurrentImageIndex(prev => (prev + 1) % thumbnailUrls.length);
      }, 2000); // Change image every 2 seconds

      return () => {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
        }
      };
    }
  }, [thumbnailUrls]);

  if (hasError || thumbnailUrls.length === 0) {
    // Fallback to styled placeholder
    const modalityIcon = modality === 'CT' ? '🔷' : 
                         modality === 'MR' ? '🟣' : 
                         modality === 'PT' ? '🟡' : '⚪';
    
    return (
      <div 
        className={`w-20 h-20 rounded-lg overflow-hidden border cursor-pointer hover:scale-105 transition-transform duration-200 ${
          modality === 'CT' ? 'bg-gradient-to-br from-blue-950 to-blue-900 border-blue-700' :
          modality === 'MR' ? 'bg-gradient-to-br from-purple-950 to-purple-900 border-purple-700' :
          modality === 'PT' ? 'bg-gradient-to-br from-yellow-950 to-yellow-900 border-yellow-700' :
          'bg-gradient-to-br from-gray-950 to-gray-900 border-gray-700'
        } flex items-center justify-center`}
        onClick={onClick}
      >
        <div className="flex flex-col items-center justify-center text-center p-2">
          <span className="text-2xl mb-1">{modalityIcon}</span>
          <span className="text-xs text-gray-300 font-medium">{imageCount}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="relative group">
      <div 
        className="w-20 h-20 bg-black rounded-lg overflow-hidden border border-gray-700 cursor-pointer hover:scale-105 transition-transform duration-200"
        onClick={onClick}
      >
        {isLoading ? (
          <div className="w-full h-full flex items-center justify-center bg-gray-900">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        ) : (
          <div className="relative w-full h-full">
            {thumbnailUrls.map((url, index) => (
              <img
                key={url}
                src={url}
                alt={`${modality} scan ${index + 1}`}
                className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ${
                  index === currentImageIndex ? 'opacity-100' : 'opacity-0'
                }`}
                onError={() => {
                  if (index === 0) setHasError(true);
                }}
              />
            ))}
            {/* Progress dots for multiple images */}
            {thumbnailUrls.length > 1 && (
              <div className="absolute bottom-1 left-0 right-0 flex justify-center gap-1">
                {thumbnailUrls.map((_, index) => (
                  <div
                    key={index}
                    className={`w-1 h-1 rounded-full transition-colors ${
                      index === currentImageIndex ? 'bg-white' : 'bg-white/30'
                    }`}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}