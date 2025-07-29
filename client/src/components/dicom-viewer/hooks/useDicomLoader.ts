/**
 * Custom hook for loading and managing DICOM images
 * Replaces complex useEffect chains in WorkingViewer
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchSeriesImages, fetchImagesBatch, fetchRTStructures, fetchRegistrationMatrix, fetchImageMetadata } from '../services/apiService';
import { getDicomWorkerManager } from '@/lib/dicom-worker-manager';

export interface DicomLoaderState {
  images: any[];
  currentIndex: number;
  isLoading: boolean;
  error: string | null;
  loadingProgress: { loaded: number; total: number };
  rtStructures: any | null;
  registrationMatrix: number[] | null;
  imageMetadata: any | null;
}

export interface DicomLoaderActions {
  goToNext: () => void;
  goToPrevious: () => void;
  goToSlice: (index: number) => void;
  refreshData: () => void;
  setCurrentIndex: (index: number) => void;
}

interface UseDicomLoaderProps {
  seriesId: number;
  studyId?: number;
  secondarySeriesId?: number | null;
  imageCache?: React.MutableRefObject<Map<string, { images: any[], metadata: any }>>;
  orientation?: 'axial' | 'sagittal' | 'coronal';
}

/**
 * Hook for loading and managing DICOM image data
 */
export function useDicomLoader({
  seriesId,
  studyId,
  secondarySeriesId,
  imageCache,
  orientation = 'axial'
}: UseDicomLoaderProps): DicomLoaderState & DicomLoaderActions {
  const [images, setImages] = useState<any[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingProgress, setLoadingProgress] = useState({ loaded: 0, total: 0 });
  const [rtStructures, setRTStructures] = useState<any | null>(null);
  const [registrationMatrix, setRegistrationMatrix] = useState<number[] | null>(null);
  const [imageMetadata, setImageMetadata] = useState<any>(null);

  const loadingRef = useRef(false);
  const workerManager = useRef(getDicomWorkerManager());

  /**
   * Load images for the series
   */
  const loadImages = useCallback(async () => {
    if (loadingRef.current || !seriesId) return;

    loadingRef.current = true;
    setIsLoading(true);
    setError(null);

    try {
      // Check cache first
      if (imageCache?.current?.has(seriesId.toString())) {
        const cached = imageCache.current.get(seriesId.toString())!;
        setImages(cached.images);
        setImageMetadata(cached.metadata);
        setIsLoading(false);
        loadingRef.current = false;
        return;
      }

      // Fetch series images
      const { images: rawImages } = await fetchSeriesImages(seriesId);
      
      if (!rawImages.length) {
        throw new Error('No images found for this series');
      }

      setLoadingProgress({ loaded: 0, total: rawImages.length });

      // Sort images by spatial position
      const sortedImages = rawImages.sort((a, b) => {
        const aPos = parseFloat(a.sliceLocation || a.imagePosition?.split('\\')[2] || '0');
        const bPos = parseFloat(b.sliceLocation || b.imagePosition?.split('\\')[2] || '0');
        return aPos - bPos;
      });

      // Handle MPR orientation
      let finalImages = sortedImages;
      if (orientation !== 'axial') {
        finalImages = await generateMPRImages(sortedImages, orientation);
      }

      // Load images in batches for performance
      const batchSize = 50;
      const loadedImages: any[] = [];

      for (let i = 0; i < finalImages.length; i += batchSize) {
        const batch = finalImages.slice(i, i + batchSize);
        const imageIds = batch.map(img => img.id);
        
        try {
          const batchData = await fetchImagesBatch(imageIds);
          
          // Process batch with web workers
          const processedBatch = await processBatchWithWorkers(batchData, batch);
          loadedImages.push(...processedBatch);
          
          setLoadingProgress({ loaded: loadedImages.length, total: finalImages.length });
          
          // Update images progressively
          setImages([...loadedImages]);
        } catch (batchError) {
          console.warn(`Failed to load batch ${i}-${i + batchSize}:`, batchError);
        }
      }

      // Cache the results
      if (imageCache?.current) {
        imageCache.current.set(seriesId.toString(), {
          images: loadedImages,
          metadata: loadedImages[0]?.imageMetadata
        });
      }

      setImages(loadedImages);
      if (loadedImages.length > 0) {
        setImageMetadata(loadedImages[0].imageMetadata);
      }

    } catch (err) {
      console.error('Error loading images:', err);
      setError(err instanceof Error ? err.message : 'Failed to load images');
    } finally {
      setIsLoading(false);
      loadingRef.current = false;
    }
  }, [seriesId, imageCache, orientation]);

  /**
   * Load RT structures for the study
   */
  const loadRTStructures = useCallback(async () => {
    if (!studyId) return;

    try {
      const structures = await fetchRTStructures(studyId);
      setRTStructures(structures);
    } catch (err) {
      console.warn('Failed to load RT structures:', err);
    }
  }, [studyId]);

  /**
   * Load registration matrix for fusion
   */
  const loadRegistrationMatrix = useCallback(async () => {
    if (!studyId) return;

    try {
      const registration = await fetchRegistrationMatrix(studyId);
      setRegistrationMatrix(registration?.matrix || null);
    } catch (err) {
      console.warn('Failed to load registration matrix:', err);
    }
  }, [studyId]);

  /**
   * Process images with web workers for performance
   */
  const processBatchWithWorkers = async (batchData: any[], originalBatch: any[]): Promise<any[]> => {
    const processed = [];
    
    for (let i = 0; i < batchData.length; i++) {
      const imageData = batchData[i];
      const originalImage = originalBatch[i];
      
      try {
        // Parse metadata with worker
        const metadata = await workerManager.current.parseDicomMetadata(imageData);
        
        processed.push({
          ...originalImage,
          imageData,
          imageMetadata: metadata,
          parsedPixelData: new Uint16Array(imageData) // Simplified for now
        });
      } catch (err) {
        console.warn(`Failed to process image ${i}:`, err);
        processed.push({
          ...originalImage,
          imageData,
          imageMetadata: {},
          parsedPixelData: new Uint16Array(0)
        });
      }
    }
    
    return processed;
  };

  /**
   * Generate MPR images for sagittal/coronal views
   */
  const generateMPRImages = async (axialImages: any[], orientation: 'sagittal' | 'coronal'): Promise<any[]> => {
    // This would implement MPR reconstruction
    // For now, return the original images (to be implemented)
    return axialImages;
  };

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

  const refreshData = useCallback(() => {
    if (imageCache?.current) {
      imageCache.current.delete(seriesId.toString());
    }
    loadImages();
  }, [loadImages, seriesId, imageCache]);

  // Load data on mount and when dependencies change
  useEffect(() => {
    loadImages();
  }, [loadImages]);

  useEffect(() => {
    loadRTStructures();
  }, [loadRTStructures]);

  useEffect(() => {
    loadRegistrationMatrix();
  }, [loadRegistrationMatrix]);

  // Update metadata when current image changes
  useEffect(() => {
    if (images[currentIndex]?.imageMetadata) {
      setImageMetadata(images[currentIndex].imageMetadata);
    }
  }, [currentIndex, images]);

  return {
    // State
    images,
    currentIndex,
    isLoading,
    error,
    loadingProgress,
    rtStructures,
    registrationMatrix,
    imageMetadata,
    
    // Actions
    goToNext,
    goToPrevious,
    goToSlice,
    refreshData,
    setCurrentIndex
  };
}