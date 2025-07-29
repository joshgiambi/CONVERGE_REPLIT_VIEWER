/**
 * Custom hook for managing RT structure contour state
 * Extracts contour-related state and operations from WorkingViewer
 */

import { useState, useCallback } from 'react';
import { updateContours, ContourUpdatePayload } from '../services/contourService';
import { undoContourOperation, redoContourOperation } from '../services/apiService';

export interface ContourState {
  selectedForEdit: number | null;
  structureVisibility: Map<number, boolean>;
  allStructuresVisible: boolean;
  contourSettings: { width: number; opacity: number };
  currentSlicePosition: number;
  predictedContours: Map<string, any>;
}

export interface ContourActions {
  selectStructureForEdit: (roiNumber: number | null) => void;
  toggleStructureVisibility: (roiNumber: number) => void;
  toggleAllStructuresVisibility: () => void;
  updateContourSettings: (settings: Partial<{ width: number; opacity: number }>) => void;
  setCurrentSlicePosition: (position: number) => void;
  handleContourUpdate: (payload: ContourUpdatePayload) => Promise<void>;
  undo: () => Promise<boolean>;
  redo: () => Promise<boolean>;
  addPredictedContour: (key: string, contour: any) => void;
  clearPredictedContours: () => void;
}

interface UseContourStateProps {
  initialStructures?: any;
  seriesId: number;
  onStructuresUpdate?: (structures: any) => void;
  onSlicePositionChange?: (position: number) => void;
}

/**
 * Hook for managing RT structure contour state and operations
 */
export function useContourState({
  initialStructures,
  seriesId,
  onStructuresUpdate,
  onSlicePositionChange
}: UseContourStateProps): ContourState & ContourActions & { rtStructures: any } {
  
  const [rtStructures, setRTStructures] = useState(initialStructures);
  const [selectedForEdit, setSelectedForEdit] = useState<number | null>(null);
  const [structureVisibility, setStructureVisibility] = useState<Map<number, boolean>>(new Map());
  const [allStructuresVisible, setAllStructuresVisible] = useState(true);
  const [contourSettings, setContourSettings] = useState({ width: 2, opacity: 10 });
  const [currentSlicePosition, setCurrentSlicePosition] = useState(0);
  const [predictedContours, setPredictedContours] = useState<Map<string, any>>(new Map());

  /**
   * Initialize structure visibility when structures change
   */
  const initializeStructureVisibility = useCallback((structures: any) => {
    if (!structures?.structures) return;

    const newVisibility = new Map<number, boolean>();
    structures.structures.forEach((structure: any) => {
      newVisibility.set(structure.roiNumber, true);
    });
    setStructureVisibility(newVisibility);
  }, []);

  /**
   * Select a structure for editing
   */
  const selectStructureForEdit = useCallback((roiNumber: number | null) => {
    setSelectedForEdit(roiNumber);
    
    // Auto-zoom and localize when selecting structure (if needed)
    if (roiNumber && rtStructures?.structures) {
      const structure = rtStructures.structures.find((s: any) => s.roiNumber === roiNumber);
      if (structure?.contours?.length > 0) {
        // Find a contour close to current slice
        const nearestContour = structure.contours
          .filter((c: any) => Math.abs(c.slicePosition - currentSlicePosition) < 10)
          .sort((a: any, b: any) => Math.abs(a.slicePosition - currentSlicePosition) - Math.abs(b.slicePosition - currentSlicePosition))[0];
        
        if (nearestContour) {
          setCurrentSlicePosition(nearestContour.slicePosition);
          onSlicePositionChange?.(nearestContour.slicePosition);
        }
      }
    }
  }, [rtStructures, currentSlicePosition, onSlicePositionChange]);

  /**
   * Toggle visibility for a specific structure
   */
  const toggleStructureVisibility = useCallback((roiNumber: number) => {
    setStructureVisibility(prev => {
      const newMap = new Map(prev);
      newMap.set(roiNumber, !newMap.get(roiNumber));
      return newMap;
    });
  }, []);

  /**
   * Toggle visibility for all structures
   */
  const toggleAllStructuresVisibility = useCallback(() => {
    const newVisible = !allStructuresVisible;
    setAllStructuresVisible(newVisible);
    
    // Update individual structure visibility
    setStructureVisibility(prev => {
      const newMap = new Map(prev);
      for (const [roiNumber] of newMap) {
        newMap.set(roiNumber, newVisible);
      }
      return newMap;
    });
  }, [allStructuresVisible]);

  /**
   * Update contour rendering settings
   */
  const updateContourSettings = useCallback((settings: Partial<{ width: number; opacity: number }>) => {
    setContourSettings(prev => ({ ...prev, ...settings }));
  }, []);

  /**
   * Set current slice position
   */
  const setSlicePosition = useCallback((position: number) => {
    setCurrentSlicePosition(position);
    onSlicePositionChange?.(position);
  }, [onSlicePositionChange]);

  /**
   * Handle contour updates (main operation handler)
   */
  const handleContourUpdate = useCallback(async (payload: ContourUpdatePayload) => {
    if (!rtStructures) {
      console.warn('No RT structures available for update');
      return;
    }

    try {
      console.log(`🔧 Processing contour operation: ${payload.action}`, payload);

      // Add current slice position to payload if not present
      const enrichedPayload = {
        ...payload,
        seriesId,
        slicePosition: payload.slicePosition ?? currentSlicePosition
      };

      // Update contours using the service
      const updatedStructures = await updateContours(enrichedPayload, rtStructures);
      
      if (updatedStructures !== rtStructures) {
        setRTStructures(updatedStructures);
        onStructuresUpdate?.(updatedStructures);
        
        console.log(`✅ Contour operation ${payload.action} completed successfully`);
      }

      // Clear predicted contours after operations
      if (payload.action !== 'prediction') {
        clearPredictedContours();
      }

    } catch (error) {
      console.error(`❌ Failed to process contour operation ${payload.action}:`, error);
      throw error;
    }
  }, [rtStructures, seriesId, currentSlicePosition, onStructuresUpdate]);

  /**
   * Undo last contour operation
   */
  const undo = useCallback(async (): Promise<boolean> => {
    try {
      const result = await undoContourOperation(seriesId);
      if (result.rtStructures) {
        setRTStructures(result.rtStructures);
        onStructuresUpdate?.(result.rtStructures);
        
        // Clear selection after undo to prevent stale state
        setSelectedForEdit(null);
        
        console.log('✅ Undo operation completed');
        return true;
      }
      return false;
    } catch (error) {
      console.error('❌ Undo operation failed:', error);
      return false;
    }
  }, [seriesId, onStructuresUpdate]);

  /**
   * Redo last contour operation
   */
  const redo = useCallback(async (): Promise<boolean> => {
    try {
      const result = await redoContourOperation(seriesId);
      if (result.rtStructures) {
        setRTStructures(result.rtStructures);
        onStructuresUpdate?.(result.rtStructures);
        
        console.log('✅ Redo operation completed');
        return true;
      }
      return false;
    } catch (error) {
      console.error('❌ Redo operation failed:', error);
      return false;
    }
  }, [seriesId, onStructuresUpdate]);

  /**
   * Add predicted contour for preview
   */
  const addPredictedContour = useCallback((key: string, contour: any) => {
    setPredictedContours(prev => {
      const newMap = new Map(prev);
      newMap.set(key, contour);
      return newMap;
    });
  }, []);

  /**
   * Clear all predicted contours
   */
  const clearPredictedContours = useCallback(() => {
    setPredictedContours(new Map());
  }, []);

  // Initialize visibility when structures change
  if (rtStructures && structureVisibility.size === 0) {
    initializeStructureVisibility(rtStructures);
  }

  return {
    // State
    rtStructures,
    selectedForEdit,
    structureVisibility,
    allStructuresVisible,
    contourSettings,
    currentSlicePosition,
    predictedContours,
    
    // Actions
    selectStructureForEdit,
    toggleStructureVisibility,
    toggleAllStructuresVisibility,
    updateContourSettings,
    setCurrentSlicePosition: setSlicePosition,
    handleContourUpdate,
    undo,
    redo,
    addPredictedContour,
    clearPredictedContours
  };
}