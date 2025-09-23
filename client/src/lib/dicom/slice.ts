import { SLICE_TOL_MM } from '@/lib/dicom-spatial-helpers';

export function deriveSlicePosition(image: any, fallbackIndex: number = 0): number {
  if (!image) return fallbackIndex;
  if (image.parsedSliceLocation !== undefined && image.parsedSliceLocation !== null) {
    return Number(image.parsedSliceLocation) || fallbackIndex;
  }
  if (image.parsedZPosition !== undefined && image.parsedZPosition !== null) {
    return Number(image.parsedZPosition) || fallbackIndex;
  }
  const meta = image.imageMetadata ?? image.metadata ?? null;
  if (meta?.sliceLocation !== undefined && meta.sliceLocation !== null) {
    const parsed = parseFloat(String(meta.sliceLocation));
    if (Number.isFinite(parsed)) return parsed;
  }
  const pos = meta?.imagePosition ?? image.imagePosition;
  if (pos) {
    const parts = Array.isArray(pos) ? pos : String(pos).split('\\');
    if (parts.length >= 3) {
      const parsed = parseFloat(String(parts[2]));
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return fallbackIndex;
}

export function getSliceTolerance(meta: any, defaultTol: number = SLICE_TOL_MM): number {
  try {
    const sbsRaw = meta?.spacingBetweenSlices;
    const sthRaw = meta?.sliceThickness;
    const sbs = Number.isFinite(Number(sbsRaw)) ? Number(sbsRaw) : NaN;
    const sth = Number.isFinite(Number(sthRaw)) ? Number(sthRaw) : NaN;
    const zCand = Number.isFinite(sbs) ? sbs * 0.45 : (Number.isFinite(sth) ? sth * 0.45 : 0);
    return Math.max(defaultTol, zCand || 0);
  } catch {
    return defaultTol;
  }
}

