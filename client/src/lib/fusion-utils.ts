import dicomParser from 'dicom-parser';
import type {
  FusionManifest,
  FusionSecondaryDescriptor,
  FusionInstanceDescriptor,
  FusionManifestStatus,
  FuseboxTransformSource,
} from '@/types/fusion';

export type FusionPreloadProgress = {
  completed: number;
  total: number;
};

export type FuseboxSlice = {
  width: number;
  height: number;
  min: number;
  max: number;
  data: Float32Array;
  sliceIndex: number;
  secondaryModality: string | null;
  registrationFile: string | null;
  transformSource?: FuseboxTransformSource;
  registrationId?: string;
  primarySopInstanceUID: string | null;
};

export type FuseboxImageData = {
  imageData: ImageData;
  hasSignal: boolean;
};

type SecondaryCacheEntry = {
  descriptor: FusionSecondaryDescriptor;
  slices: Map<string, Promise<FuseboxSlice>>;
  status: FusionManifestStatus | 'idle' | 'loading';
  error?: string;
};

type ManifestCacheEntry = {
  manifest: FusionManifest;
  secondaries: Map<number, SecondaryCacheEntry>;
};

const manifestCache = new Map<number, ManifestCacheEntry>();

type TypedArrayConstructor<T extends ArrayBufferView> = {
  new (buffer: ArrayBufferLike, byteOffset?: number, length?: number): T;
  BYTES_PER_ELEMENT: number;
};

function createAlignedTypedArray<T extends ArrayBufferView>(
  source: Uint8Array,
  dataOffset: number,
  byteLength: number,
  ctor: TypedArrayConstructor<T>,
): T {
  const bytesPerElement = ctor.BYTES_PER_ELEMENT;
  if (byteLength % bytesPerElement !== 0) {
    throw new Error(`Invalid byte length ${byteLength} for ${bytesPerElement}-byte elements`);
  }
  const absoluteOffset = source.byteOffset + dataOffset;
  const elementLength = byteLength / bytesPerElement;
  if (absoluteOffset % bytesPerElement === 0) {
    return new ctor(source.buffer, absoluteOffset, elementLength);
  }
  const copy = source.slice(dataOffset, dataOffset + byteLength);
  return new ctor(copy.buffer, copy.byteOffset, elementLength);
}

function getOrCreateManifestEntry(primarySeriesId: number): ManifestCacheEntry {
  let entry = manifestCache.get(primarySeriesId);
  if (!entry) {
    entry = {
      manifest: {
        manifestVersion: 2,
        studyId: 0,
        patientId: null,
        primarySeriesId,
        primarySeriesInstanceUID: '',
        primarySeriesDescription: null,
        primaryModality: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        settings: {
          interpolation: 'linear',
          preload: true,
        },
        secondaries: [],
      },
      secondaries: new Map(),
    };
    manifestCache.set(primarySeriesId, entry);
  }
  return entry;
}

function parseWindowValues(value: string | null | undefined): number[] | null {
  if (!value) return null;
  const tokens = value.split('\\').map((token) => Number(token.trim())).filter((n) => Number.isFinite(n));
  return tokens.length ? tokens : null;
}

function createSliceFromDicom(
  arrayBuffer: ArrayBuffer,
  descriptor: FusionSecondaryDescriptor,
  instance: FusionInstanceDescriptor,
): FuseboxSlice {
  const byteArray = new Uint8Array(arrayBuffer);
  const dataSet = dicomParser.parseDicom(byteArray, {});

  const rows = dataSet.uint16?.('x00280010') ?? 0;
  const cols = dataSet.uint16?.('x00280011') ?? 0;
  if (!rows || !cols) {
    throw new Error('Fused DICOM missing Rows/Columns');
  }

  const bitsAllocated = dataSet.uint16?.('x00280100') ?? 16;
  const pixelRepresentation = dataSet.uint16?.('x00280103') ?? 0;
  const slope = Number(dataSet.string?.('x00281053') ?? '1') || 1;
  const intercept = Number(dataSet.string?.('x00281052') ?? '0') || 0;

  const pixelElement = dataSet.elements?.['x7fe00010'];
  if (!pixelElement) {
    throw new Error('Fused DICOM missing pixel data');
  }

  const { dataOffset, length } = pixelElement as any;
  let floatPixels: Float32Array;

  if (bitsAllocated === 32) {
    if (pixelRepresentation === 0) {
      const raw = createAlignedTypedArray(byteArray, dataOffset, length, Uint32Array);
      const count = raw.length;
      floatPixels = new Float32Array(count);
      for (let i = 0; i < count; i += 1) {
        floatPixels[i] = raw[i] * slope + intercept;
      }
    } else if (pixelRepresentation === 1) {
      const raw = createAlignedTypedArray(byteArray, dataOffset, length, Int32Array);
      const count = raw.length;
      floatPixels = new Float32Array(count);
      for (let i = 0; i < count; i += 1) {
        floatPixels[i] = raw[i] * slope + intercept;
      }
    } else {
      const raw = createAlignedTypedArray(byteArray, dataOffset, length, Float32Array);
      floatPixels = new Float32Array(raw.length);
      for (let i = 0; i < raw.length; i += 1) {
        floatPixels[i] = raw[i] * slope + intercept;
      }
    }
  } else if (bitsAllocated === 16) {
    if (pixelRepresentation === 0) {
      const raw = createAlignedTypedArray(byteArray, dataOffset, length, Uint16Array);
      const count = raw.length;
      floatPixels = new Float32Array(count);
      for (let i = 0; i < count; i += 1) floatPixels[i] = raw[i] * slope + intercept;
    } else {
      const raw = createAlignedTypedArray(byteArray, dataOffset, length, Int16Array);
      const count = raw.length;
      floatPixels = new Float32Array(count);
      for (let i = 0; i < count; i += 1) floatPixels[i] = raw[i] * slope + intercept;
    }
  } else if (bitsAllocated === 8) {
    const raw = createAlignedTypedArray(byteArray, dataOffset, length, Uint8Array);
    floatPixels = new Float32Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) floatPixels[i] = raw[i] * slope + intercept;
  } else {
    throw new Error(`Unsupported BitsAllocated for fused DICOM: ${bitsAllocated}`);
  }

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < floatPixels.length; i += 1) {
    const value = floatPixels[i];
    if (!Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    min = Number.isFinite(min) ? min : 0;
    max = min + 1;
  }

  const sliceIndex = Number.isFinite(instance.instanceNumber)
    ? Math.max(0, instance.instanceNumber - 1)
    : 0;

  return {
    width: cols,
    height: rows,
    min,
    max,
    data: floatPixels,
    sliceIndex,
    secondaryModality: descriptor.secondaryModality,
    registrationFile: null,
    transformSource: 'helper-cache',
    registrationId: descriptor.registrationId ?? undefined,
    primarySopInstanceUID: instance.primarySopInstanceUID ?? null,
  };
}

async function loadSlice(
  cache: SecondaryCacheEntry,
  instance: FusionInstanceDescriptor,
  primarySeriesId: number,
  secondarySeriesId: number,
): Promise<FuseboxSlice> {
  const cached = cache.slices.get(instance.sopInstanceUID);
  if (cached) return cached;

  const promise = (async () => {
    const response = await fetch(
      `/api/fusion/secondary/${primarySeriesId}/${secondarySeriesId}/${encodeURIComponent(instance.sopInstanceUID)}`,
      { cache: 'no-store' },
    );
    if (!response.ok) {
      throw new Error(`Failed to load fused image ${instance.sopInstanceUID} (${response.status} ${response.statusText})`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return createSliceFromDicom(arrayBuffer, cache.descriptor, instance);
  })();

  cache.slices.set(instance.sopInstanceUID, promise);
  return promise;
}

function updateSecondaryCache(entry: ManifestCacheEntry, descriptor: FusionSecondaryDescriptor) {
  const existing = entry.secondaries.get(descriptor.secondarySeriesId);
  if (existing) {
    existing.descriptor = descriptor;
    if (descriptor.status === 'error') existing.error = descriptor.error;
    if (descriptor.status === 'ready' && existing.status !== 'loading') existing.status = 'idle';
  } else {
    entry.secondaries.set(descriptor.secondarySeriesId, {
      descriptor,
      slices: new Map(),
      status: descriptor.status === 'ready' ? 'idle' : descriptor.status,
      error: descriptor.error,
    });
  }
}

export async function fetchFusionManifest(
  primarySeriesId: number,
  options?: {
    secondarySeriesIds?: number[];
    force?: boolean;
    interpolation?: 'linear' | 'nearest';
    preload?: boolean;
  },
): Promise<FusionManifest> {
  const params = new URLSearchParams({ primarySeriesId: String(primarySeriesId) });
  if (options?.secondarySeriesIds?.length) params.set('secondarySeriesIds', options.secondarySeriesIds.join(','));
  if (options?.force) params.set('force', 'true');
  if (options?.interpolation) params.set('interpolation', options.interpolation);
  if (typeof options?.preload === 'boolean') params.set('preload', String(options.preload));

  const response = await fetch(`/api/fusion/manifest?${params.toString()}`, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Fusion manifest request failed (${response.status} ${response.statusText})`);
  }
  const manifest = (await response.json()) as FusionManifest;

  const entry = getOrCreateManifestEntry(primarySeriesId);
  entry.manifest = manifest;
  manifest.secondaries.forEach((descriptor) => updateSecondaryCache(entry, descriptor));
  return manifest;
}

export async function preloadFusionSecondary(
  primarySeriesId: number,
  secondarySeriesId: number,
  onProgress?: (progress: FusionPreloadProgress) => void,
): Promise<void> {
  const entry = manifestCache.get(primarySeriesId);
  if (!entry) throw new Error('Fusion manifest not loaded');
  const cache = entry.secondaries.get(secondarySeriesId);
  if (!cache) throw new Error('Fusion secondary missing in manifest cache');
  if (cache.status === 'loading') return;

  const { descriptor } = cache;
  if (descriptor.status !== 'ready') {
    throw new Error(`Fusion secondary ${secondarySeriesId} not ready (status=${descriptor.status})`);
  }

  const instances = descriptor.instances;
  cache.status = 'loading';
  cache.error = undefined;

  try {
    const total = instances.length;
    let completed = 0;
    for (const instance of instances) {
      await loadSlice(cache, instance, primarySeriesId, secondarySeriesId);
      completed += 1;
      onProgress?.({ completed, total });
    }
    cache.status = 'ready';
  } catch (error: any) {
    cache.status = 'error';
    cache.error = error?.message || String(error);
    throw error;
  }
}

export async function getFusedSlice(
  primarySeriesId: number,
  secondarySeriesId: number,
  sopInstanceUID: string,
): Promise<FuseboxSlice> {
  const entry = manifestCache.get(primarySeriesId);
  if (!entry) throw new Error('Fusion manifest not loaded');
  const cache = entry.secondaries.get(secondarySeriesId);
  if (!cache) throw new Error('Fusion secondary missing in manifest cache');

  const descriptor = cache.descriptor;
  let instance = descriptor.instances.find((inst) => inst.sopInstanceUID === sopInstanceUID);
  if (!instance) {
    instance = descriptor.instances.find((inst) => inst.primarySopInstanceUID === sopInstanceUID) || null;
  }
  if (!instance) {
    throw new Error(`Fusion SOP ${sopInstanceUID} not found in manifest`);
  }

  return loadSlice(cache, instance, primarySeriesId, secondarySeriesId);
}

// More tolerant lookup that falls back when SOP UIDs differ between primary and fused instances
export async function getFusedSliceSmart(
  primarySeriesId: number,
  secondarySeriesId: number,
  sopInstanceUID: string,
  preferredInstanceNumber?: number | null,
  preferredIndex?: number | null,
  preferredImagePosition?: [number, number, number] | null,
): Promise<FuseboxSlice> {
  const entry = manifestCache.get(primarySeriesId);
  if (!entry) throw new Error('Fusion manifest not loaded');
  const cache = entry.secondaries.get(secondarySeriesId);
  if (!cache) throw new Error('Fusion secondary missing in manifest cache');

  const descriptor = cache.descriptor;
  // 1) Try exact SOP match
  let target = descriptor.instances.find((inst) => inst.sopInstanceUID === sopInstanceUID) || null;
  if (!target) {
    target = descriptor.instances.find((inst) => inst.primarySopInstanceUID === sopInstanceUID) || null;
  }
  // 2) Fall back to instanceNumber match if available
  if (!target && preferredInstanceNumber != null) {
    target = descriptor.instances.find((inst) => inst.instanceNumber === preferredInstanceNumber) || null;
  }
  // 3) Fall back to index if provided and in-bounds
  if (!target && preferredIndex != null) {
    const idx = Math.max(0, Math.min(descriptor.instances.length - 1, preferredIndex));
    target = descriptor.instances[idx] || null;
  }
  // 4) Fall back to closest image position if available
  if (!target && preferredImagePosition && Array.isArray(preferredImagePosition)) {
    let best: { inst: FusionInstanceDescriptor | null; distance: number } = { inst: null, distance: Number.POSITIVE_INFINITY };
    const preferredZ = Number(preferredImagePosition[2]);
    descriptor.instances.forEach((inst) => {
      const pos = Array.isArray(inst.imagePositionPatient) ? inst.imagePositionPatient : null;
      if (!pos || pos.length < 3) return;
      const z = Number(pos[2]);
      if (!Number.isFinite(z)) return;
      const distance = Math.abs(z - preferredZ);
      if (distance < best.distance) {
        best = { inst, distance };
      }
    });
    if (best.inst) {
      target = best.inst;
    }
  }
  // 5) Final fallback: use middle slice
  if (!target && descriptor.instances.length) {
    target = descriptor.instances[Math.floor(descriptor.instances.length / 2)];
  }
  if (!target) throw new Error('Fusion instance not found');
  return loadSlice(cache, target, primarySeriesId, secondarySeriesId);
}

export function fuseboxSliceToImageData(
  slice: FuseboxSlice,
  modality: string | null,
  windowLevel?: { window: number; level: number } | null,
): FuseboxImageData {
  const imageData = new ImageData(slice.width, slice.height);
  const buffer = imageData.data;
  const source = slice.data;
  const windowWidth = windowLevel?.window ?? slice.max - slice.min;
  const windowLevelVal = windowLevel?.level ?? (slice.min + slice.max) / 2;
  const min = windowLevel?.window
    ? windowLevelVal - windowWidth / 2
    : slice.min;
  const max = windowLevel?.window
    ? windowLevelVal + windowWidth / 2
    : slice.max;
  const range = Math.max(1e-6, max - min);
  const mode = (modality || '').toUpperCase();
  const isPET = mode === 'PT' || mode === 'PET';
  const isCT = mode === 'CT';
  let hasSignal = false;

  const applyFdg = (n: number) => {
    const stops = [
      { t: 0.05, c: [0, 0, 0, 0] },
      { t: 0.2, c: [90, 25, 0, 255] },
      { t: 0.5, c: [220, 110, 0, 255] },
      { t: 0.8, c: [255, 200, 0, 255] },
      { t: 1.0, c: [255, 255, 255, 255] },
    ];

    if (n <= stops[0].t) return [0, 0, 0, 0];
    for (let i = 0; i < stops.length - 1; i++) {
      const a = stops[i];
      const b = stops[i + 1];
      if (n <= b.t) {
        const w = (n - a.t) / (b.t - a.t);
        return [
          Math.round(a.c[0] + w * (b.c[0] - a.c[0])),
          Math.round(a.c[1] + w * (b.c[1] - a.c[1])),
          Math.round(a.c[2] + w * (b.c[2] - a.c[2])),
          Math.round(a.c[3] + w * (b.c[3] - a.c[3])),
        ];
      }
    }
    return [255, 255, 255, 255];
  };

  if (isCT) {
    // Make CT overlay transparent where values sit at the minimum (background/no-data),
    // preventing a black sheet from covering the base image when fused slices are empty.
    for (let i = 0; i < source.length; i++) {
      const s = source[i];
      const normalized = Math.max(0, Math.min(1, (s - min) / range));
      const value = Math.round(normalized * 255);
      const offset = i * 4;
      buffer[offset] = value;
      buffer[offset + 1] = value;
      buffer[offset + 2] = value;
      // Transparent if at background; opaque otherwise
      buffer[offset + 3] = normalized <= 0 ? 0 : 255;
      if (!hasSignal && normalized > 0) {
        hasSignal = true;
      }
    }
    return { imageData, hasSignal };
  }

  for (let i = 0; i < source.length; i++) {
    let normalized = (source[i] - min) / range;
    if (!Number.isFinite(normalized)) normalized = 0;
    normalized = Math.max(0, Math.min(1, normalized));
    const offset = i * 4;

    if (isPET) {
      const [r, g, b, a] = applyFdg(normalized);
      buffer[offset] = r;
      buffer[offset + 1] = g;
      buffer[offset + 2] = b;
      buffer[offset + 3] = a;
    } else {
      const value = Math.round(normalized * 255);
      buffer[offset] = value;
      buffer[offset + 1] = value;
      buffer[offset + 2] = value;
      buffer[offset + 3] = 255;
    }

    if (!hasSignal && Math.abs(source[i] - min) > 1e-6) {
      hasSignal = true;
    }
  }

  return { imageData, hasSignal };
}

export function getFusionManifest(primarySeriesId: number): FusionManifest | null {
  return manifestCache.get(primarySeriesId)?.manifest ?? null;
}

export function getFusionSecondaryStatus(primarySeriesId: number, secondarySeriesId: number): FusionManifestStatus | 'idle' | 'loading' | undefined {
  return manifestCache.get(primarySeriesId)?.secondaries.get(secondarySeriesId)?.status;
}

export function clearFusionCaches(primarySeriesId?: number, secondarySeriesId?: number) {
  if (typeof primarySeriesId === 'number' && Number.isFinite(primarySeriesId)) {
    const entry = manifestCache.get(primarySeriesId);
    if (entry) {
      if (typeof secondarySeriesId === 'number' && Number.isFinite(secondarySeriesId)) {
        entry.secondaries.delete(secondarySeriesId);
        entry.manifest.secondaries = entry.manifest.secondaries.filter(
          (sec) => sec.secondarySeriesId !== secondarySeriesId,
        );
      } else {
        manifestCache.delete(primarySeriesId);
      }
    }
  } else {
    manifestCache.clear();
  }

  if (typeof window !== 'undefined') {
    try {
      const url = new URL('/api/fusion/cache', window.location.origin);
      if (typeof primarySeriesId === 'number' && Number.isFinite(primarySeriesId)) {
        url.searchParams.set('primarySeriesId', String(primarySeriesId));
        if (typeof secondarySeriesId === 'number' && Number.isFinite(secondarySeriesId)) {
          url.searchParams.set('secondarySeriesId', String(secondarySeriesId));
        }
      }
      fetch(url.toString(), { method: 'DELETE', keepalive: true }).catch(() => {});
    } catch (error) {
      console.warn('Failed to clear fusion cache on server', error);
    }
  }
}

export function clearFusionSlices(primarySeriesId: number, secondarySeriesId?: number) {
  if (!Number.isFinite(primarySeriesId)) return;
  const entry = manifestCache.get(primarySeriesId);
  if (!entry) return;
  if (typeof secondarySeriesId === 'number' && Number.isFinite(secondarySeriesId)) {
    entry.secondaries.get(secondarySeriesId)?.slices.clear();
    return;
  }
  entry.secondaries.forEach((cache) => {
    cache.slices.clear();
  });
}
