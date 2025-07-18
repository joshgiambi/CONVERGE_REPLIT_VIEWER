import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';

interface CanvasPreviewProps {
  seriesId: number;
  imageCount: number;
  modality: string;
  seriesNumber: number;
}

export function CanvasPreview({ seriesId, imageCount, modality, seriesNumber }: CanvasPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Fetch middle image for preview
  const middleImageIndex = Math.floor(imageCount / 2);
  const { data: images } = useQuery({
    queryKey: [`/api/series/${seriesId}/images`],
    enabled: imageCount > 0,
  });

  // Fetch pixel data for the middle image
  const middleImage = images?.[middleImageIndex];
  const { data: pixelData, isLoading, error } = useQuery({
    queryKey: [`/api/images/${middleImage?.id}/pixels`],
    enabled: !!middleImage?.id,
    retry: 1,
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size
    canvas.width = 128;
    canvas.height = 128;

    // Fill with dark background
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(0, 0, 128, 128);

    if (isLoading) {
      // Show loading text
      ctx.fillStyle = '#666';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Loading...', 64, 64);
    } else if (error || !pixelData) {
      // Show modality text as fallback
      ctx.fillStyle = '#888';
      ctx.font = 'bold 32px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(modality, 64, 54);
      
      ctx.font = '11px sans-serif';
      ctx.fillStyle = '#555';
      ctx.fillText(`Series ${seriesNumber}`, 64, 74);
    } else {
      try {
        // Create ImageData from pixel data
        const imageData = new ImageData(
          new Uint8ClampedArray(pixelData.pixels),
          pixelData.width,
          pixelData.height
        );

        // Create temporary canvas to hold full-size image
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = pixelData.width;
        tempCanvas.height = pixelData.height;
        const tempCtx = tempCanvas.getContext('2d');
        
        if (tempCtx) {
          tempCtx.putImageData(imageData, 0, 0);
          
          // Clear and draw scaled version to main canvas
          ctx.fillStyle = '#000';
          ctx.fillRect(0, 0, 128, 128);
          ctx.drawImage(tempCanvas, 0, 0, pixelData.width, pixelData.height, 0, 0, 128, 128);
        }
      } catch (err) {
        console.error('Error rendering DICOM preview:', err);
        // Fallback to text
        ctx.fillStyle = '#888';
        ctx.font = 'bold 32px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(modality, 64, 54);
      }
    }
  }, [pixelData, isLoading, error, modality, seriesNumber]);

  return (
    <div className="w-full h-full relative bg-gray-900">
      <canvas 
        ref={canvasRef}
        className="w-full h-full object-contain"
        style={{ imageRendering: 'auto' }}
      />
      {imageCount > 1 && (
        <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-white text-xs px-2 py-1 text-center">
          {imageCount} images
        </div>
      )}
    </div>
  );
}