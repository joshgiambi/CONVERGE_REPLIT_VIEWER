import React, { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';

interface DicomThumbnailProps {
  seriesId: number;
  modality: string;
  imageCount: number;
  onClick?: () => void;
}

export function DicomThumbnail({ seriesId, modality, imageCount, onClick }: DicomThumbnailProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);



  useEffect(() => {
    const loadThumbnail = async () => {
      try {
        setIsLoading(true);
        setHasError(false);

        // Get the thumbnail directly from server
        const response = await fetch(`/api/series/${seriesId}/thumbnail`);
        if (!response.ok) throw new Error('Failed to fetch thumbnail');
        
        // The server returns raw DICOM, so we use it as blob URL
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        setThumbnailUrl(url);
        
        setIsLoading(false);
      } catch (error) {
        console.error('Error loading thumbnail:', error);
        setHasError(true);
        setIsLoading(false);
      }
    };

    loadThumbnail();

    // Cleanup
    return () => {
      if (thumbnailUrl) {
        URL.revokeObjectURL(thumbnailUrl);
      }
    };
  }, [seriesId]);

  // Only show placeholder if we've finished loading and still have an error
  if (!isLoading && (hasError || !thumbnailUrl)) {
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
        ) : thumbnailUrl ? (
          <img 
            src={thumbnailUrl}
            alt={`${modality} thumbnail`}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gray-900">
            <span className="text-xs text-gray-400">{modality}</span>
          </div>
        )}
      </div>
    </div>
  );
}