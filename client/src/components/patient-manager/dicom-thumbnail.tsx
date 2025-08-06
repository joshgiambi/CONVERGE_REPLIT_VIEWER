import React, { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import * as dicomParser from 'dicom-parser';

interface DicomThumbnailProps {
  seriesId: number;
  modality: string;
  imageCount: number;
  onClick?: () => void;
}

export function DicomThumbnail({ seriesId, modality, imageCount, onClick }: DicomThumbnailProps) {
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [canvasCount, setCanvasCount] = useState(0);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // Function to render DICOM to canvas
  const renderDicomToCanvas = async (url: string, canvas: HTMLCanvasElement) => {
    try {
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      const byteArray = new Uint8Array(arrayBuffer);
      
      // Parse DICOM
      const dataSet = dicomParser.parseDicom(byteArray);
      
      // Get image dimensions
      const rows = dataSet.uint16('x00280010') || 512;
      const columns = dataSet.uint16('x00280011') || 512;
      const bitsAllocated = dataSet.uint16('x00280100') || 16;
      const pixelDataElement = dataSet.elements.x7fe00010;
      
      if (!pixelDataElement) {
        throw new Error('No pixel data found');
      }
      
      // Get window/level for this modality
      let windowWidth = modality === 'CT' ? 400 : modality === 'MR' ? 800 : 2000;
      let windowCenter = modality === 'CT' ? 50 : modality === 'MR' ? 400 : 1000;
      
      // Try to get from DICOM header
      const wc = dataSet.string('x00281050');
      const ww = dataSet.string('x00281051');
      if (wc) windowCenter = parseFloat(wc.split('\\')[0]);
      if (ww) windowWidth = parseFloat(ww.split('\\')[0]);
      
      // Setup canvas
      canvas.width = 80; // Thumbnail size
      canvas.height = 80;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      
      // Create image data
      const imageData = ctx.createImageData(80, 80);
      
      // Get pixel data
      const pixelData = new DataView(arrayBuffer, pixelDataElement.dataOffset, pixelDataElement.length);
      
      // Calculate scaling
      const scaleX = columns / 80;
      const scaleY = rows / 80;
      
      // Window/level calculations
      const minValue = windowCenter - windowWidth / 2;
      const maxValue = windowCenter + windowWidth / 2;
      
      // Render pixels with downsampling
      for (let y = 0; y < 80; y++) {
        for (let x = 0; x < 80; x++) {
          const srcX = Math.floor(x * scaleX);
          const srcY = Math.floor(y * scaleY);
          const srcIndex = srcY * columns + srcX;
          
          let pixelValue = 0;
          if (bitsAllocated === 16) {
            pixelValue = pixelData.getInt16(srcIndex * 2, true);
          } else if (bitsAllocated === 8) {
            pixelValue = pixelData.getUint8(srcIndex);
          }
          
          // Apply window/level
          let intensity = ((pixelValue - minValue) / (maxValue - minValue)) * 255;
          intensity = Math.max(0, Math.min(255, intensity));
          
          const destIndex = (y * 80 + x) * 4;
          imageData.data[destIndex] = intensity;
          imageData.data[destIndex + 1] = intensity;
          imageData.data[destIndex + 2] = intensity;
          imageData.data[destIndex + 3] = 255;
        }
      }
      
      ctx.putImageData(imageData, 0, 0);
      return true;
    } catch (error) {
      console.error('Error rendering DICOM:', error);
      return false;
    }
  };

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

        // Set canvas count
        setCanvasCount(indices.length);
        
        // Load and render each image
        setTimeout(async () => {
          for (let i = 0; i < indices.length; i++) {
            const targetImage = images[indices[i]];
            const url = `/api/images/${targetImage.sopInstanceUID}/render`;
            const canvas = canvasRefs.current[i];
            if (canvas) {
              await renderDicomToCanvas(url, canvas);
            }
          }
          setIsLoading(false);
        }, 0);
      } catch (error) {
        console.error('Error loading thumbnails:', error);
        setHasError(true);
        setIsLoading(false);
      }
    };

    loadThumbnails();
  }, [seriesId, modality]);

  // Set up image cycling
  useEffect(() => {
    if (canvasCount > 1) {
      intervalRef.current = setInterval(() => {
        setCurrentImageIndex(prev => (prev + 1) % canvasCount);
      }, 2000); // Change image every 2 seconds

      return () => {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
        }
      };
    }
  }, [canvasCount]);

  // Only show placeholder if we've finished loading and still have an error or no canvases
  if (!isLoading && (hasError || canvasCount === 0)) {
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
            {Array.from({ length: canvasCount }).map((_, index) => (
              <canvas
                key={index}
                ref={(el) => { canvasRefs.current[index] = el; }}
                className={`absolute inset-0 w-full h-full transition-opacity duration-500 ${
                  index === currentImageIndex ? 'opacity-100' : 'opacity-0'
                }`}
                width={80}
                height={80}
              />
            ))}
            {/* Progress dots for multiple images */}
            {canvasCount > 1 && (
              <div className="absolute bottom-1 left-0 right-0 flex justify-center gap-1">
                {Array.from({ length: canvasCount }).map((_, index) => (
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