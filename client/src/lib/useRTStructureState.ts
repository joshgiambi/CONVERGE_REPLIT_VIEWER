import { useState, useCallback, useEffect } from 'react';
import { log } from '@/lib/log';

export interface UseRTStructureStateReturn {
  // RT Structure state
  rtStructures: any;
  setRTStructures: (structures: any) => void;

  // Structure visibility and selection
  structureVisibility: Map<number, boolean>;
  setStructureVisibility: React.Dispatch<React.SetStateAction<Map<number, boolean>>>;
  selectedStructures: Set<number>;
  setSelectedStructures: React.Dispatch<React.SetStateAction<Set<number>>>;
  selectedStructureColors: string[];
  setSelectedStructureColors: (colors: string[]) => void;

  // Edit state
  selectedForEdit: number | null;
  setSelectedForEdit: (id: number | null) => void;
  isContourEditMode: boolean;
  setIsContourEditMode: (mode: boolean) => void;

  // Brush tool state
  brushToolState: {
    tool: string | null;
    brushSize: number;
    isActive: boolean;
    predictionEnabled: boolean;
  };
  setBrushToolState: React.Dispatch<React.SetStateAction<{
    tool: string | null;
    brushSize: number;
    isActive: boolean;
    predictionEnabled: boolean;
  }>>;

  // Global visibility state
  allStructuresVisible: boolean;
  setAllStructuresVisible: (visible: boolean) => void;

  // Loaded RT series tracking
  loadedRTSeriesId: number | null;
  setLoadedRTSeriesId: (id: number | null) => void;

  // Utility functions
  resetRTStructureState: () => void;
  toggleStructureVisibility: (structureId: number) => void;
  toggleAllStructuresVisibility: () => void;
  selectStructure: (structureId: number) => void;
  deselectStructure: (structureId: number) => void;
  clearStructureSelection: () => void;
}

export function useRTStructureState(
  patientId: number | undefined,
  onLoadedRTSeriesChange?: (seriesId: number | null) => void
): UseRTStructureStateReturn {
  const [rtStructures, setRTStructures] = useState<any>(null);
  const [structureVisibility, setStructureVisibility] = useState<Map<number, boolean>>(new Map());
  const [selectedStructures, setSelectedStructures] = useState<Set<number>>(new Set());
  const [selectedStructureColors, setSelectedStructureColors] = useState<string[]>([]);
  const [selectedForEdit, setSelectedForEdit] = useState<number | null>(null);
  const [isContourEditMode, setIsContourEditMode] = useState(false);
  const [brushToolState, setBrushToolState] = useState({
    tool: null as string | null,
    brushSize: 3,
    isActive: false,
    predictionEnabled: false
  });
  const [allStructuresVisible, setAllStructuresVisible] = useState(true);
  const [loadedRTSeriesId, setLoadedRTSeriesId] = useState<number | null>(null);

  // Clear RT structures when patient changes
  useEffect(() => {
    log.debug(`Patient changed, clearing RT structures. Patient ID: ${patientId}`, 'useRTStructureState');
    resetRTStructureState();
  }, [patientId]);

  // Notify parent when loaded RT series changes
  useEffect(() => {
    if (onLoadedRTSeriesChange) {
      onLoadedRTSeriesChange(loadedRTSeriesId);
    }
  }, [loadedRTSeriesId, onLoadedRTSeriesChange]);

  // Automatically enter contour edit mode when a structure is selected for editing
  useEffect(() => {
    if (selectedForEdit && rtStructures) {
      setIsContourEditMode(true);
    } else {
      setIsContourEditMode(false);
    }
  }, [selectedForEdit, rtStructures]);

  const resetRTStructureState = useCallback(() => {
    log.debug('Resetting RT structure state', 'useRTStructureState');
    setRTStructures(null);
    setStructureVisibility(new Map());
    setSelectedStructures(new Set());
    setSelectedForEdit(null);
    setSelectedStructureColors([]);
    setIsContourEditMode(false);
    setLoadedRTSeriesId(null);
    setBrushToolState({
      tool: null,
      brushSize: 3,
      isActive: false,
      predictionEnabled: false
    });
  }, []);

  const toggleStructureVisibility = useCallback((structureId: number) => {
    setStructureVisibility(prev => {
      const newMap = new Map(prev);
      newMap.set(structureId, !newMap.get(structureId));
      return newMap;
    });
  }, []);

  const toggleAllStructuresVisibility = useCallback(() => {
    setAllStructuresVisible(prev => !prev);
    setStructureVisibility(prev => {
      const newMap = new Map();
      if (rtStructures?.structures) {
        rtStructures.structures.forEach((structure: any) => {
          newMap.set(structure.id, !allStructuresVisible);
        });
      }
      return newMap;
    });
  }, [allStructuresVisible, rtStructures]);

  const selectStructure = useCallback((structureId: number) => {
    setSelectedStructures(prev => new Set([...prev, structureId]));
  }, []);

  const deselectStructure = useCallback((structureId: number) => {
    setSelectedStructures(prev => {
      const newSet = new Set(prev);
      newSet.delete(structureId);
      return newSet;
    });
  }, []);

  const clearStructureSelection = useCallback(() => {
    setSelectedStructures(new Set());
  }, []);

  return {
    rtStructures,
    setRTStructures,
    structureVisibility,
    setStructureVisibility,
    selectedStructures,
    setSelectedStructures,
    selectedStructureColors,
    setSelectedStructureColors,
    selectedForEdit,
    setSelectedForEdit,
    isContourEditMode,
    setIsContourEditMode,
    brushToolState,
    setBrushToolState,
    allStructuresVisible,
    setAllStructuresVisible,
    loadedRTSeriesId,
    setLoadedRTSeriesId,
    resetRTStructureState,
    toggleStructureVisibility,
    toggleAllStructuresVisibility,
    selectStructure,
    deselectStructure,
    clearStructureSelection,
  };
}