/**
 * useDICOMImages Hook
 * 
 * Hook for loading and managing DICOM images with worker-based parsing
 * and intelligent caching. Extracted from working-viewer.tsx.
 * 
 * Agent 4: Services & Hooks
 * Created: Hour 5-8
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { getDicomWorkerManager } from '@/lib/dicom-worker-manager';
import { DICOMMetadataService } from '@/services/DICOMMetadataService';
import type { DICOMImage, UseDICOMImagesResult, ImageMetadata } from '@/types/viewer';

interface UseDICOMImagesOptions {
  seriesId: number;
  autoLoad?: boolean;
  onLoadComplete?: (images: DICOMImage[]) => void;
  onError?: (error: Error) => void;
  cache?: React.MutableRefObject<Map<string, any>>;
}

/**
 * Hook for loading DICOM images with worker-based parsing
 */
export function useDICOMImages(options: UseDICOMImagesOptions): UseDICOMImagesResult {
  const { seriesId, autoLoad = true, onLoadComplete, onError, cache } = options;

  const [images, setImages] = useState<DICOMImage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);

  // Internal cache if not provided
  const internalCache = useRef<Map<string, any>>(new Map());
  const imageCache = cache || internalCache;

  // Abort controller for cleanup
  const abortControllerRef = useRef<AbortController | null>(null);

  /**
   * Fetch image metadata from API
   */
  const fetchImageMetadata = useCallback(async (signal?: AbortSignal): Promise<DICOMImage[]> => {
    const response = await fetch(`/api/series/${seriesId}/images`, { signal });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch images: ${response.status}`);
    }

    const data = await response.json();
    return data.images || [];
  }, [seriesId]);

  /**
   * Parse DICOM image using worker
   */
  const parseDicomImage = useCallback(async (arrayBuffer: ArrayBuffer): Promise<any> => {
    try {
      const workerManager = getDicomWorkerManager();
      const result = await workerManager.parseDicomImage(arrayBuffer);
      return result;
    } catch (err) {
      console.error('Error parsing DICOM image:', err);
      return null;
    }
  }, []);

  /**
   * Fetch and parse a single image
   */
  const fetchAndParseImage = useCallback(
    async (sopInstanceUID: string, signal?: AbortSignal): Promise<any> => {
      // Check cache first
      if (imageCache.current.has(sopInstanceUID)) {
        return imageCache.current.get(sopInstanceUID);
      }

      const response = await fetch(`/api/images/${sopInstanceUID}`, { signal });
      
      if (!response.ok) {
        throw new Error(`Failed to load image: ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const imageData = await parseDicomImage(arrayBuffer);

      if (imageData) {
        // Cache the parsed image
        imageCache.current.set(sopInstanceUID, imageData);
      }

      return imageData;
    },
    [parseDicomImage, imageCache]
  );

  /**
   * Load all images for the series
   */
  const loadImages = useCallback(async () => {
    // Cancel any in-flight requests
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      setIsLoading(true);
      setError(null);

      // Fetch image metadata
      const imageMetadata = await fetchImageMetadata(abortController.signal);

      if (imageMetadata.length === 0) {
        throw new Error('No images found for series');
      }

      // Sort images by slice location or instance number
      const sortedImages = [...imageMetadata].sort((a, b) => {
        const zA = DICOMMetadataService.getSliceZ(a);
        const zB = DICOMMetadataService.getSliceZ(b);

        if (zA !== null && zB !== null) {
          return zA - zB;
        }

        // Fallback to instance number
        const aNum = a.instanceNumber ?? 0;
        const bNum = b.instanceNumber ?? 0;
        return aNum - bNum;
      });

      // Load first image immediately for display
      const firstImage = sortedImages[0];
      const firstImageData = await fetchAndParseImage(
        firstImage.sopInstanceUID,
        abortController.signal
      );

      if (firstImageData) {
        // Merge pixel data into first image
        const enrichedFirst = {
          ...firstImage,
          pixelData: firstImageData.data,
          width: firstImageData.width,
          height: firstImageData.height,
        };

        setImages([enrichedFirst]);
        setCurrentIndex(0);
      }

      // Load remaining images in background
      const loadPromises = sortedImages.slice(1).map(async (img) => {
        try {
          const imageData = await fetchAndParseImage(
            img.sopInstanceUID,
            abortController.signal
          );

          if (imageData) {
            return {
              ...img,
              pixelData: imageData.data,
              width: imageData.width,
              height: imageData.height,
            };
          }
          return img;
        } catch (err: any) {
          if (err.name !== 'AbortError') {
            console.warn(`Failed to load image ${img.sopInstanceUID}:`, err);
          }
          return img;
        }
      });

      // Wait for all images to load
      const loadedImages = await Promise.all(loadPromises);
      const allImages = [
        firstImageData ? { ...firstImage, pixelData: firstImageData.data } : firstImage,
        ...loadedImages,
      ];

      setImages(allImages);
      setIsLoading(false);

      if (onLoadComplete) {
        onLoadComplete(allImages);
      }
    } catch (err: any) {
      // Don't show error for aborted requests
      if (err.name === 'AbortError') {
        console.log('Image load aborted (series switched)');
        return;
      }

      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      setIsLoading(false);

      if (onError) {
        onError(error);
      }
    }
  }, [seriesId, fetchImageMetadata, fetchAndParseImage, onLoadComplete, onError]);

  /**
   * Reload images
   */
  const reload = useCallback(() => {
    loadImages();
  }, [loadImages]);

  /**
   * Get current image
   */
  const currentImage = images[currentIndex] || null;

  /**
   * Get metadata for current image
   */
  const metadata: ImageMetadata | null = currentImage
    ? DICOMMetadataService.extractMetadata(currentImage)
    : null;

  /**
   * Auto-load images when seriesId changes
   */
  useEffect(() => {
    if (autoLoad && seriesId) {
      loadImages();
    }

    // Cleanup on unmount
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [seriesId, autoLoad, loadImages]);

  return {
    images,
    isLoading,
    error,
    currentImage,
    currentIndex,
    setCurrentIndex,
    metadata,
    reload,
  } as UseDICOMImagesResult & { reload: () => void };
}

