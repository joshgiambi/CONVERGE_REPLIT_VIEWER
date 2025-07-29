import { useEffect } from 'react';

export interface RTContour {
  slicePosition: number;
  points: number[];
  numberOfPoints: number;
  isPredicted?: boolean; // Marks contours as predictions
  predictionConfidence?: number; // 0-1 confidence level
}

export interface RTStructure {
  roiNumber: number;
  structureName: string;
  color: [number, number, number];
  contours: RTContour[];
}

export interface RTStructureSet {
  studyInstanceUID: string;
  seriesInstanceUID: string;
  structures: RTStructure[];
}

interface RTStructureOverlayProps {
  rtStructures: any;
  currentSlicePosition: number;
  structureVisibility?: Map<number, boolean>;
  selectedForEdit?: number | null;
  contourSettings?: { width: number; opacity: number };
  onSelectStructure?: (roiNumber: number | null) => void;
}

export function RTStructureOverlay({
  rtStructures,
  currentSlicePosition,
  structureVisibility,
  selectedForEdit,
  contourSettings = { width: 2, opacity: 10 },
  onSelectStructure
}: RTStructureOverlayProps) {
  
  // Simply log RT structure info - actual rendering handled by existing canvas logic
  useEffect(() => {
    if (rtStructures?.structures) {
      console.log(`RT structures available: ${rtStructures.structures.length} structures at slice ${currentSlicePosition}`);
    }
  }, [rtStructures, currentSlicePosition]);

  // Return null for now - RT structure rendering handled elsewhere
  return null;
}