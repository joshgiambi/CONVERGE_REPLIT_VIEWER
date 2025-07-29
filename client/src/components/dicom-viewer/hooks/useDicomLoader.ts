/**
 * Custom hook for loading and managing DICOM images
 * Restored full functionality from working backup
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchSeriesImages } from '../services/apiService';
import { getDicomWorkerManager } from '@/lib/dicom-worker-manager';

/**
 * Complete DICOM loader hook with parsing and caching
 */
export function useDicomLoader(
  seriesId: number,
  orientation: 'axial' | 'sagittal' | 'coronal' = 'axial'
) {
  const [images, setImages] = useState<any[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageMetadata, setImageMetadata] = useState<any>(null);

  // Image caching system (restored from backup)
  const imageCacheRef = useRef(new Map<string, any>());
  const loadingRef = useRef(false);
  const seriesAbortRef = useRef<AbortController | null>(null);

  /**
   * Parse DICOM image using web worker
   */
  const parseDicomImage = useCallback(async (arrayBuffer: ArrayBuffer) => {
    try {
      const workerManager = getDicomWorkerManager();
      const result = await workerManager.parseDicomImage(arrayBuffer);
      return result;
    } catch (error) {
      console.error("Error parsing DICOM image:", error);
      return null;
    }
  }, []);

  /**
   * Fetch and parse a single DICOM image
   */
  const fetchAndParseImage = useCallback(async (sopInstanceUID: string, signal?: AbortSignal) => {
    // Check if already in cache
    if (imageCacheRef.current.has(sopInstanceUID)) {
      return imageCacheRef.current.get(sopInstanceUID);
    }
    
    const response = await fetch(`/api/images/${sopInstanceUID}`, { signal });
    if (!response.ok) {
      throw new Error(`Failed to load image: ${response.status}`);
    }
    
    const arrayBuffer = await response.arrayBuffer();
    const imageData = await parseDicomImage(arrayBuffer);
    
    if (imageData) {
      imageCacheRef.current.set(sopInstanceUID, imageData);
    }
    
    return imageData;
  }, [parseDicomImage]);

  /**
   * Load images for the series with complete DICOM processing
   */
  const loadImages = useCallback(async () => {
    if (loadingRef.current || !seriesId) return;

    loadingRef.current = true;
    setIsLoading(true);
    setError(null);

    try {
      // Cancel any existing series load
      if (seriesAbortRef.current) {
        seriesAbortRef.current.abort();
      }
      
      // Create new abort controller for this series
      seriesAbortRef.current = new AbortController();
      const signal = seriesAbortRef.current.signal;

      const response = await fetch(`/api/series/${seriesId}/images`, { signal });
      if (!response.ok) {
        throw new Error(`Failed to load images: ${response.statusText}`);
      }

      const seriesImages = await response.json();

      // Parse DICOM metadata for proper spatial ordering
      const workerManager = getDicomWorkerManager();
      const imagesWithMetadata = await Promise.all(
        seriesImages.map(async (img: any) => {
          try {
            const response = await fetch(`/api/images/${img.sopInstanceUID}`, { signal });
            const arrayBuffer = await response.arrayBuffer();

            // Use web worker for metadata parsing
            const metadata = await workerManager.parseDicomMetadata(arrayBuffer);

            return {
              ...img,
              parsedSliceLocation: metadata.parsedSliceLocation,
              parsedZPosition: metadata.parsedZPosition,
              parsedInstanceNumber: metadata.parsedInstanceNumber ?? img.instanceNumber,
            };
          } catch (error) {
            console.warn(`Failed to parse DICOM metadata for ${img.fileName}:`, error);
            return {
              ...img,
              parsedSliceLocation: null,
              parsedZPosition: null,
              parsedInstanceNumber: img.instanceNumber,
            };
          }
        }),
      );

      // Sort by spatial position
      const sortedImages = imagesWithMetadata.sort((a: any, b: any) => {
        // Primary: slice location
        if (a.parsedSliceLocation !== null && b.parsedSliceLocation !== null) {
          return a.parsedSliceLocation - b.parsedSliceLocation;
        }

        // Secondary: z-position from image position
        if (a.parsedZPosition !== null && b.parsedZPosition !== null) {
          return a.parsedZPosition - b.parsedZPosition;
        }

        // Tertiary: instance number
        if (a.parsedInstanceNumber !== null && b.parsedInstanceNumber !== null) {
          return a.parsedInstanceNumber - b.parsedInstanceNumber;
        }

        // Final fallback: filename
        return a.fileName.localeCompare(b.fileName, undefined, { numeric: true });
      });

      setImages(sortedImages);
      setCurrentIndex(0);
      
      // Load the first image to get it into cache
      if (sortedImages.length > 0) {
        try {
          const firstImage = sortedImages[0];
          const imageData = await fetchAndParseImage(firstImage.sopInstanceUID, signal);
          if (imageData && sortedImages[0].imageMetadata) {
            setImageMetadata(sortedImages[0].imageMetadata);
          }
        } catch (err) {
          console.error('Failed to load first image:', err);
        }
      }

    } catch (err: any) {
      // Don't show error for aborted requests
      if (err.name === 'AbortError') {
        console.log('Series load aborted (user switched series)');
        return;
      }
      console.error('Error loading images:', err);
      setError(err.message || 'Failed to load images');
    } finally {
      setIsLoading(false);
      loadingRef.current = false;
    }
  }, [seriesId, fetchAndParseImage]);

  /**
   * Navigation functions
   */
  const goToNext = useCallback(() => {
    setCurrentIndex(prev => Math.min(images.length - 1, prev + 1));
  }, [images.length]);

  const goToPrevious = useCallback(() => {
    setCurrentIndex(prev => Math.max(0, prev - 1));
  }, []);

  const goToSlice = useCallback((index: number) => {
    setCurrentIndex(Math.max(0, Math.min(images.length - 1, index)));
  }, [images.length]);

  // Load images when seriesId changes
  useEffect(() => {
    if (seriesId) {
      loadImages();
    }
    
    // Cleanup on unmount
    return () => {
      if (seriesAbortRef.current) {
        seriesAbortRef.current.abort();
      }
    };
  }, [seriesId, loadImages]);

  // Get current image with parsed pixel data
  const getCurrentImageWithData = useCallback(async () => {
    const currentImage = images[currentIndex];
    if (!currentImage) return null;

    // Try to get from cache first
    const cachedData = imageCacheRef.current.get(currentImage.sopInstanceUID);
    if (cachedData) {
      return {
        ...currentImage,
        parsedPixelData: cachedData.data,
        width: cachedData.width,
        height: cachedData.height,
        columns: cachedData.width,
        rows: cachedData.height
      };
    }

    // If not cached, fetch and parse
    try {
      const imageData = await fetchAndParseImage(currentImage.sopInstanceUID);
      if (imageData) {
        return {
          ...currentImage,
          parsedPixelData: imageData.data,
          width: imageData.width,
          height: imageData.height,
          columns: imageData.width,
          rows: imageData.height
        };
      }
    } catch (error) {
      console.error('Failed to load current image data:', error);
    }

    return currentImage;
  }, [images, currentIndex, fetchAndParseImage]);

  return {
    images,
    currentImage: images[currentIndex] || null,
    currentIndex,
    imageMetadata,
    isLoading,
    error,
    goToNext,
    goToPrevious,
    goToSlice,
    fetchAndParseImage,
    getCurrentImageWithData,
    imageCacheRef
  };
}