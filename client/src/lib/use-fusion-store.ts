import type { FusionManifest } from '@/types/fusion';
import { fetchFusionManifest, getFusionManifest, preloadFusionSecondary, getFusedSlice, getFusedSliceSmart, fuseboxSliceToImageData } from '@/lib/fusion-utils';

type OverlayResult = {
  canvas: HTMLCanvasElement;
  hasSignal: boolean;
  registrationId: string | null;
  transformSource: string | null;
};

let primarySeriesId: number | null = null;
let secondarySeriesId: number | null = null;
let secondaryModality: string | null = null;
let manifest: FusionManifest | null = null;
let manifestLoading = false;
let manifestError: string | null = null;
const secondaryStatuses = new Map<number, { status: 'idle' | 'loading' | 'ready' | 'error'; error?: string | null }>();

export function setPrimary(seriesId: number | null) {
  primarySeriesId = seriesId;
  manifest = null;
  manifestError = null;
}

export function setSecondary(seriesId: number | null, modality?: string | null) {
  secondarySeriesId = seriesId;
  secondaryModality = modality ?? secondaryModality;
}

export async function refreshManifest(opts?: { secondarySeriesIds?: number[]; force?: boolean; preload?: boolean }) {
  if (!primarySeriesId) return;
  manifestLoading = true;
  manifestError = null;
  try {
    const m = await fetchFusionManifest(primarySeriesId, {
      secondarySeriesIds: opts?.secondarySeriesIds,
      force: opts?.force ?? true,
      preload: opts?.preload ?? true,
    });
    manifest = m;
    manifestLoading = false;
    secondaryStatuses.clear();
    m.secondaries.forEach((sec) => {
      const status = sec.status === 'ready' ? 'idle' : (sec.status as any);
      secondaryStatuses.set(sec.secondarySeriesId, { status, error: sec.error });
    });
    const readyIds = m.secondaries.filter(s => s.status === 'ready').map(s => s.secondarySeriesId);
    for (const sid of readyIds) {
      try {
        await preloadFusionSecondary(primarySeriesId, sid);
        secondaryStatuses.set(sid, { status: 'ready' });
      } catch (e: any) {
        secondaryStatuses.set(sid, { status: 'error', error: String(e?.message || e) });
      }
    }
  } catch (e: any) {
    manifestError = String(e?.message || e);
    manifestLoading = false;
  }
}

export async function getOverlayForSop(args: {
  sopInstanceUID: string;
  index: number;
  instanceNumber: number | null;
  imagePosition: [number, number, number] | null;
}): Promise<OverlayResult | null> {
  if (!primarySeriesId || !secondarySeriesId) return null;
  const m = getFusionManifest(primarySeriesId);
  const ready = m?.secondaries.some((s) => s.secondarySeriesId === secondarySeriesId && s.status === 'ready');
  if (!ready) return null;
  const { sopInstanceUID, index, instanceNumber, imagePosition } = args;
  try {
    let slice;
    try {
      slice = await getFusedSlice(primarySeriesId, secondarySeriesId, sopInstanceUID);
    } catch {
      slice = await getFusedSliceSmart(primarySeriesId, secondarySeriesId, sopInstanceUID, instanceNumber ?? undefined, index, imagePosition ?? undefined as any);
    }
    const overlay = fuseboxSliceToImageData(slice, secondaryModality ?? 'PT');
    const canvas = document.createElement('canvas');
    canvas.width = overlay.imageData.width;
    canvas.height = overlay.imageData.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.putImageData(overlay.imageData, 0, 0);
    return {
      canvas,
      hasSignal: overlay.hasSignal,
      registrationId: slice.registrationId ?? null,
      transformSource: slice.transformSource ?? null,
    };
  } catch {
    return null;
  }
}

export function getManifest(): FusionManifest | null { return manifest; }
export function getStatuses() { return secondaryStatuses; }
export function isManifestLoading() { return manifestLoading; }
export function getManifestError() { return manifestError; }

