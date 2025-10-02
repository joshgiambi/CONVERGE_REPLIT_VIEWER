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

  applyAnisotropicMargin(
    structures: RTStructureSet,
    roiNumber: number,
    params: {
      superior?: number;
      inferior?: number;
      anterior?: number;
      posterior?: number;
      left?: number;
      right?: number;
      mode?: 'DISCRETE' | 'SMOOTH';
    }
  ): Promise<RTStructureSet>;

  applyGrowStructure(
    structures: RTStructureSet,
    roiNumber: number,
    distanceMm: number,
    direction?: 'all' | 'superior' | 'inferior' | 'anterior' | 'posterior' | 'left' | 'right',
  ): Promise<RTStructureSet>;

  booleanOperationMultiSlice(
    structures: RTStructureSet,
    sourceRoiNumber: number,
    targetRoiNumber: number,
    op: BooleanOperation,
  ): Promise<RTStructureSet>;

  previewBooleanOperation(
    structures: RTStructureSet,
    sourceRoiNumber: number,
    targetRoiNumber: number,
    op: BooleanOperation,
  ): Promise<Array<{ slicePosition: number; points: number[] }>>;

  addBrushStroke(
    structures: RTStructureSet,
    roiNumber: number,
    slicePosition: number,
    brushPolygon: number[],
  ): Promise<RTStructureSet>;

  eraseBrushStroke(
    structures: RTStructureSet,
    roiNumber: number,
    slicePosition: number,
    erasePolygon: number[],
  ): Promise<RTStructureSet>;

  addPenStroke(
    structures: RTStructureSet,
    roiNumber: number,
    slicePosition: number,
    points: number[],
  ): Promise<RTStructureSet>;

  cutPenStroke(
    structures: RTStructureSet,
    roiNumber: number,
    slicePosition: number,
    cutPath: number[],
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

    async applyAnisotropicMargin(structures, roiNumber, params) {
      const cloned = deepClone(structures);
      const structure = cloned.structures.find((s) => s.roiNumber === roiNumber);
      if (!structure) return cloned;

      // Per-slice directional expansion fallback (fast 3D anisotropic not guaranteed)
      const { growContourSimple } = await import('@/lib/simple-polygon-operations');
      const distance = Math.max(
        params.superior ?? 0,
        params.inferior ?? 0,
        params.anterior ?? 0,
        params.posterior ?? 0,
        params.left ?? 0,
        params.right ?? 0,
      );
      for (const contour of structure.contours || []) {
        if (!contour.points || contour.points.length < 6) continue;
        const expanded = growContourSimple(contour.points, distance);
        contour.points = expanded;
        contour.numberOfPoints = expanded.length / 3;
      }
      return cloned;
    },

    async applyGrowStructure(structures, roiNumber, distanceMm, direction = 'all') {
      const cloned = deepClone(structures);
      const structure = cloned.structures.find((s) => s.roiNumber === roiNumber);
      if (!structure) return cloned;

      if (direction === 'all') {
        const { growContourSimple } = await import('@/lib/simple-polygon-operations');
        for (const contour of structure.contours || []) {
          if (!contour.points || contour.points.length < 6) continue;
          const updated = growContourSimple(contour.points, distanceMm);
          contour.points = updated;
          contour.numberOfPoints = updated.length / 3;
        }
        return cloned;
      }

      // Directional grow/shrink with optional smoothing
      const { applyDirectionalGrow } = await import('@/lib/contour-directional-grow');
      const { gaussianSmoothContour } = await import('@/lib/contour-smooth-simple');
      for (const contour of structure.contours || []) {
        if (!contour.points || contour.points.length < 6) continue;
        let updatedPoints = applyDirectionalGrow(
          contour.points,
          distanceMm,
          direction,
          undefined // imageOrientation optional; can be added via provider context later
        );
        const smoothed = gaussianSmoothContour({ points: updatedPoints, slicePosition: contour.slicePosition }, 0.15);
        updatedPoints = smoothed.points;
        contour.points = updatedPoints;
        contour.numberOfPoints = updatedPoints.length / 3;
      }
      return cloned;
    },

    async booleanOperationMultiSlice(structures, sourceRoiNumber, targetRoiNumber, op) {
      const cloned = deepClone(structures);
      const source = cloned.structures.find((s) => s.roiNumber === sourceRoiNumber);
      const target = cloned.structures.find((s) => s.roiNumber === targetRoiNumber);
      if (!source || !target) return cloned;

      const bySlice = new Map<number, { source: number[][]; target: number[][] }>();
      const add = (map: Map<number, { source: number[][]; target: number[][] }>, key: number, kind: 'source' | 'target', pts: number[]) => {
        const bucket = map.get(key) || { source: [], target: [] };
        bucket[kind].push(pts);
        map.set(key, bucket);
      };
      for (const c of source.contours || []) {
        if (c.points && c.points.length >= 9) add(bySlice, c.slicePosition, 'source', c.points);
      }
      for (const c of target.contours || []) {
        if (c.points && c.points.length >= 9) add(bySlice, c.slicePosition, 'target', c.points);
      }

      const clipper = await import('@/lib/clipper-boolean-operations');

      const newSourceContours: { slicePosition: number; points: number[] }[] = [];
      for (const [sliceZ, pair] of bySlice.entries()) {
        const sources = pair.source;
        const targets = pair.target;
        if (!sources.length) continue;

        // Start with union of all source contours on this slice
        let mergedSources: number[][] = [sources[0]];
        for (let i = 1; i < sources.length; i++) {
          const acc: number[][] = [];
          for (const existing of mergedSources) {
            const result = await clipper.combineContours(existing, sources[i]);
            acc.push(...result);
          }
          mergedSources = acc.length ? acc : mergedSources;
        }

        // Apply operation against all target contours
        let current: number[][] = mergedSources;
        for (const tgt of targets) {
          const next: number[][] = [];
          for (const src of current) {
            if (op === 'union') {
              const r = await clipper.combineContours(src, tgt);
              next.push(...r);
            } else if (op === 'subtract') {
              const r = await clipper.subtractContours(src, tgt);
              next.push(...r);
            } else {
              const r = await clipper.intersectContours(src, tgt);
              next.push(...r);
            }
          }
          current = next.length ? next : current;
        }

        for (const pts of current) {
          if (pts.length >= 9) newSourceContours.push({ slicePosition: sliceZ, points: pts });
        }
      }

      // Replace source structure contours with results on slices we touched; keep untouched slices
      const touched = new Set(Array.from(bySlice.keys()));
      source.contours = [
        ...((source.contours || []).filter((c) => !touched.has(c.slicePosition))),
        ...newSourceContours.map((c) => ({ slicePosition: c.slicePosition, points: c.points, numberOfPoints: c.points.length / 3 })),
      ];
      return cloned;
    },

    async previewBooleanOperation(structures, sourceRoiNumber, targetRoiNumber, op) {
      const src = structures.structures.find((s) => s.roiNumber === sourceRoiNumber);
      const tgt = structures.structures.find((s) => s.roiNumber === targetRoiNumber);
      if (!src || !tgt) return [];
      const byZ = new Map<number, { s: number[][]; t: number[][] }>();
      const acc = (z: number, kind: 's' | 't', pts: number[]) => {
        const bucket = byZ.get(z) || { s: [], t: [] };
        bucket[kind].push(pts);
        byZ.set(z, bucket);
      };
      for (const c of src.contours || []) if (c.points?.length >= 9) acc(c.slicePosition, 's', c.points);
      for (const c of tgt.contours || []) if (c.points?.length >= 9) acc(c.slicePosition, 't', c.points);
      const clipper = await import('@/lib/clipper-boolean-operations');
      const previews: Array<{ slicePosition: number; points: number[] }> = [];
      for (const [z, pair] of byZ.entries()) {
        let merged: number[][] = pair.s.length ? [pair.s[0]] : [];
        for (let i = 1; i < pair.s.length; i++) {
          const tmp: number[][] = [];
          for (const m of merged) tmp.push(...(await clipper.combineContours(m, pair.s[i])));
          merged = tmp.length ? tmp : merged;
        }
        let out = merged;
        for (const t of pair.t) {
          const tmp: number[][] = [];
          for (const s of out) {
            if (op === 'union') tmp.push(...(await clipper.combineContours(s, t)));
            else if (op === 'subtract') tmp.push(...(await clipper.subtractContours(s, t)));
            else tmp.push(...(await clipper.intersectContours(s, t)));
          }
          out = tmp.length ? tmp : out;
        }
        for (const pts of out) if (pts.length >= 9) previews.push({ slicePosition: z, points: pts });
      }
      return previews;
    },

    async addBrushStroke(structures, roiNumber, slicePosition, brushPolygon) {
      const cloned = deepClone(structures);
      const structure = cloned.structures.find((s) => s.roiNumber === roiNumber);
      if (!structure || !brushPolygon || brushPolygon.length < 9) return cloned;

      const clipper = await import('@/lib/clipper-boolean-operations');
      const onSlice: any[] = (structure.contours || []).filter((c) => Math.abs(c.slicePosition - slicePosition) < 0.5);
      const offSlice: any[] = (structure.contours || []).filter((c) => Math.abs(c.slicePosition - slicePosition) >= 0.5);

      // Union brush with all on-slice contours
      let merged: number[][] = [brushPolygon];
      for (const c of onSlice) {
        if (!c.points || c.points.length < 9) continue;
        const next: number[][] = [];
        for (const m of merged) {
          const r = await clipper.combineContours(m, c.points);
          next.push(...r);
        }
        merged = next.length ? next : merged;
      }

      // Replace slice with merged results
      const newOnSlice = merged.map((pts) => ({ slicePosition, points: pts, numberOfPoints: pts.length / 3 }));
      structure.contours = [...offSlice, ...newOnSlice];
      return cloned;
    },

    async eraseBrushStroke(structures, roiNumber, slicePosition, erasePolygon) {
      const cloned = deepClone(structures);
      const structure = cloned.structures.find((s) => s.roiNumber === roiNumber);
      if (!structure || !erasePolygon || erasePolygon.length < 9) return cloned;

      const clipper = await import('@/lib/clipper-boolean-operations');
      const onSlice: any[] = (structure.contours || []).filter((c) => Math.abs(c.slicePosition - slicePosition) < 0.5);
      const offSlice: any[] = (structure.contours || []).filter((c) => Math.abs(c.slicePosition - slicePosition) >= 0.5);

      const results: any[] = [];
      for (const c of onSlice) {
        if (!c.points || c.points.length < 9) continue;
        const r = await clipper.subtractContours(c.points, erasePolygon);
        for (const pts of r) {
          if (pts.length >= 9) {
            results.push({ slicePosition, points: pts, numberOfPoints: pts.length / 3 });
          }
        }
      }
      structure.contours = [...offSlice, ...results];
      return cloned;
    },

    async addPenStroke(structures, roiNumber, slicePosition, points) {
      const cloned = deepClone(structures);
      const structure = cloned.structures.find((s) => s.roiNumber === roiNumber);
      if (!structure || !points || points.length < 6) return cloned;
      const tol = 0.1;
      const existing = (structure.contours || []).find((c) => Math.abs(c.slicePosition - slicePosition) <= tol);
      if (existing) {
        existing.points = [...existing.points, ...points];
        existing.numberOfPoints = existing.points.length / 3;
      } else {
        structure.contours.push({ slicePosition, points, numberOfPoints: points.length / 3 });
      }
      return cloned;
    },

    async cutPenStroke(structures, roiNumber, slicePosition, cutPath) {
      const cloned = deepClone(structures);
      const structure = cloned.structures.find((s) => s.roiNumber === roiNumber);
      if (!structure || !cutPath || cutPath.length < 9) return cloned;

      const clipper = await import('@/lib/clipper-boolean-operations');
      const tol = 0.5;
      const onSlice: any[] = (structure.contours || []).filter((c) => Math.abs(c.slicePosition - slicePosition) < tol);
      const offSlice: any[] = (structure.contours || []).filter((c) => Math.abs(c.slicePosition - slicePosition) >= tol);

      // Subtract cut path from all contours on this slice (cookie cutter operation)
      const results: any[] = [];
      for (const c of onSlice) {
        if (!c.points || c.points.length < 9) continue;
        const cutResults = await clipper.subtractContours(c.points, cutPath);
        for (const pts of cutResults) {
          if (pts.length >= 9) {
            results.push({ slicePosition, points: pts, numberOfPoints: pts.length / 3 });
          }
        }
      }

      structure.contours = [...offSlice, ...results];
      return cloned;
    },
  };
}


