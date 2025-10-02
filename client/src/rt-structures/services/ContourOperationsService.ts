import type { RTStructureSet } from '@/types/rt-structures';

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
  ): Promise<RTStructureSet>;

  applyUniformMargin(
    structures: RTStructureSet,
    roiNumber: number,
    marginMm: number,
  ): Promise<RTStructureSet>;
}

function deepClone<T>(obj: T): T {
  return (globalThis as any).structuredClone ? (structuredClone as any)(obj) : JSON.parse(JSON.stringify(obj));
}

// NOTE: Stubs – wire to existing helpers during integration
export function createContourOperationsService(): ContourServiceApi {
  return {
    async booleanOperation(structures, sourceRoiNumber, targetRoiNumber, op) {
      const cloned = deepClone(structures);
      const source = cloned.structures.find((s) => s.roiNumber === sourceRoiNumber);
      const target = cloned.structures.find((s) => s.roiNumber === targetRoiNumber);
      if (!source || !target) return cloned;
      const sliceZ = (source.contours?.[0]?.slicePosition ?? target.contours?.[0]?.slicePosition ?? 0);

      // Find first contours on same slice for simplicity (matches current usage)
      const sourceContour = (source.contours || []).find(c => Math.abs(c.slicePosition - sliceZ) < 0.5);
      const targetContour = (target.contours || []).find(c => Math.abs(c.slicePosition - sliceZ) < 0.5);
      if (!sourceContour || !targetContour) return cloned;

      const clipper = await import('@/lib/clipper-boolean-operations');
      let resultContours: number[][] = [];
      if (op === 'union') {
        resultContours = await clipper.combineContours(sourceContour.points, targetContour.points);
      } else if (op === 'subtract') {
        resultContours = await clipper.subtractContours(sourceContour.points, targetContour.points);
      } else if (op === 'intersect') {
        resultContours = await clipper.intersectContours(sourceContour.points, targetContour.points);
      }

      // Replace source contour on slice with results
      const idx = (source.contours || []).findIndex(c => Math.abs(c.slicePosition - sliceZ) < 0.5);
      if (idx >= 0) {
        source.contours.splice(idx, 1);
      }
      for (const pts of resultContours) {
        if (pts.length >= 9) {
          source.contours.push({ slicePosition: sliceZ, points: pts, numberOfPoints: pts.length / 3 });
        }
      }

      return cloned;
    },

    async applyUniformMargin(structures, roiNumber, marginMm) {
      const cloned = deepClone(structures);
      const structure = cloned.structures.find((s) => s.roiNumber === roiNumber);
      if (!structure) return cloned;

      const { growContourSimple } = await import('@/lib/simple-polygon-operations');
      for (const contour of structure.contours || []) {
        if (!contour.points || contour.points.length < 6) continue;
        const expanded = growContourSimple(contour.points, marginMm);
        contour.points = expanded;
        contour.numberOfPoints = expanded.length / 3;
      }
      return cloned;
    },
  };
}


