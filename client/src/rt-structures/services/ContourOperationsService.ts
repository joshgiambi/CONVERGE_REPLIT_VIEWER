import type { RTContour, RTStructure, RTStructureSet } from '@/types/rt-structures';

export type BooleanOperation = 'union' | 'intersect' | 'subtract';

export interface MarginParams {
  uniform: number; // mm
}

export interface ContourServiceApi {
  booleanOperation(
    structures: RTStructureSet,
    sourceRoiNumber: number,
    targetRoiNumber: number,
    op: BooleanOperation,
  ): RTStructureSet;

  applyUniformMargin(
    structures: RTStructureSet,
    roiNumber: number,
    marginMm: number,
  ): RTStructureSet;
}

function deepClone<T>(obj: T): T {
  return (globalThis as any).structuredClone ? (structuredClone as any)(obj) : JSON.parse(JSON.stringify(obj));
}

// NOTE: Stubs – wire to existing helpers during integration
export function createContourOperationsService(): ContourServiceApi {
  return {
    booleanOperation(structures, sourceRoiNumber, targetRoiNumber, op) {
      const cloned = deepClone(structures);
      const source = cloned.structures.find((s) => s.roiNumber === sourceRoiNumber);
      const target = cloned.structures.find((s) => s.roiNumber === targetRoiNumber);
      if (!source || !target) return cloned;
      // TODO: Integrate with existing boolean ops once extracted
      // For now, no-op and return cloned set
      return cloned;
    },

    applyUniformMargin(structures, roiNumber, marginMm) {
      const cloned = deepClone(structures);
      const structure = cloned.structures.find((s) => s.roiNumber === roiNumber);
      if (!structure) return cloned;
      // TODO: Integrate with margin helpers (e.g., grow/smooth) for each contour on each slice
      // For now, return cloned without modification
      return cloned;
    },
  };
}


