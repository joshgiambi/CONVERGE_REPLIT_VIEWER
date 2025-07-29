/**
 * Custom hook for loading and managing DICOM images
 * Simplified implementation that matches working-viewer.tsx usage
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchSeriesImages } from '../services/apiService';

/**
 * Simplified DICOM loader hook
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

  const loadingRef = useRef(false);

  /**
   * Load images for the series
   */
  const loadImages = useCallback(async () => {
    if (loadingRef.current || !seriesId) return;

    loadingRef.current = true;
    setIsLoading(true);
    setError(null);

    try {
      // Fetch series images from API
      const response = await fetchSeriesImages(seriesId);
      const rawImages = response.images || response || [];
      
      if (!rawImages.length) {
        throw new Error('No images found for this series');
      }

      // Sort images by spatial position
      const sortedImages = rawImages.sort((a, b) => {
        const aPos = parseFloat(a.sliceLocation || a.imagePosition?.split('\\')[2] || '0');
        const bPos = parseFloat(b.sliceLocation || b.imagePosition?.split('\\')[2] || '0');
        return aPos - bPos;
      });

      setImages(sortedImages);
      
      // Set initial metadata from first image
      if (sortedImages.length > 0 && sortedImages[0].imageMetadata) {
        setImageMetadata(sortedImages[0].imageMetadata);
      }

    } catch (err) {
      console.error('Error loading images:', err);
      setError(err instanceof Error ? err.message : 'Failed to load images');
    } finally {
      setIsLoading(false);
      loadingRef.current = false;
    }
  }, [seriesId]);

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
  }, [seriesId, loadImages]);

  // Update metadata when current image changes
  useEffect(() => {
    if (images[currentIndex]) {
      setImageMetadata(images[currentIndex].imageMetadata || images[currentIndex]);
    }
  }, [currentIndex, images]);

  // Get current image
  const currentImage = images[currentIndex] || null;

  return {
    // State
    images,
    currentImage,
    currentIndex,
    isLoading,
    error,
    imageMetadata,
    
    // Actions
    goToNext,
    goToPrevious,
    goToSlice,
    setCurrentIndex
  };
}