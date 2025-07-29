/**
 * Custom hook for managing contour/RT structure state
 * Extracts contour handling logic from WorkingViewer
 */

import { useState, useCallback } from 'react';

/**
 * Hook for managing contour operations and state
 */
export function useContourState(
  currentImage: any,
  onContourUpdate?: (data: any) => Promise<void>
) {
  const [selectedStructure, setSelectedStructure] = useState<number | null>(null);

  /**
   * Handle contour updates (brush, pen, etc.)
   */
  const handleContourUpdate = useCallback(async (data: any) => {
    try {
      if (onContourUpdate) {
        await onContourUpdate(data);
      }
    } catch (error) {
      console.error('Error updating contour:', error);
      throw error;
    }
  }, [onContourUpdate]);

  /**
   * Calculate current slice position from image metadata
   */
  const currentSlicePos = currentImage?.sliceLocation 
    ? parseFloat(currentImage.sliceLocation)
    : currentImage?.imagePosition?.split('\\')[2] 
      ? parseFloat(currentImage.imagePosition.split('\\')[2])
      : 0;

  return {
    selectedStructure,
    setSelectedStructure,
    handleContourUpdate,
    currentSlicePos
  };
}