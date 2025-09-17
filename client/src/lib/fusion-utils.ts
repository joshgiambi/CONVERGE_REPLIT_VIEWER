import type { FuseboxTransformSource, RegistrationAssociation } from '@/types/fusion';

export type FuseboxSliceRequest = {
  primarySeriesId: number;
  secondarySeriesId: number;
  sopInstanceUID: string;
  interpolation?: 'linear' | 'nearest';
  registrationId?: string | null;
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
  associations?: RegistrationAssociation[];
};

export type FuseboxImageData = {
  imageData: ImageData;
  hasSignal: boolean;
};

const fuseboxSliceCache = new Map<string, Promise<FuseboxSlice>>();

function decodeBase64ToFloat32(encoded: string): Float32Array {
  let binary: string;
  if (typeof atob === 'function') {
    binary = atob(encoded);
  } else if (typeof Buffer !== 'undefined') {
    binary = Buffer.from(encoded, 'base64').toString('binary');
  } else {
    throw new Error('No base64 decoder available in this environment');
  }

  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
}

const toCacheKey = (request: FuseboxSliceRequest) =>
  [
    request.primarySeriesId,
    request.secondarySeriesId,
    request.sopInstanceUID,
    request.interpolation ?? 'linear',
    request.registrationId ?? '',
  ].join(':');

export function clearFuseboxCache() {
  fuseboxSliceCache.clear();
}

export async function fetchFuseboxSlice(request: FuseboxSliceRequest): Promise<FuseboxSlice> {
  const key = toCacheKey(request);
  let pending = fuseboxSliceCache.get(key);

  if (!pending) {
    pending = (async () => {
      const params = new URLSearchParams({
        primarySeriesId: String(request.primarySeriesId),
        secondarySeriesId: String(request.secondarySeriesId),
        primarySOP: request.sopInstanceUID,
      });

      if (request.interpolation) {
        params.set('interpolation', request.interpolation);
      }
      if (request.registrationId) {
        params.set('registrationId', request.registrationId);
      }

      const response = await fetch(`/api/fusebox/resampled-slice?${params.toString()}`, {
        cache: 'no-store',
      });

      if (!response.ok) {
        throw new Error(`Fusebox request failed (${response.status} ${response.statusText})`);
      }

      const payload = await response.json();
      if (!payload || typeof payload.data !== 'string') {
        throw new Error('Fusebox payload missing image data');
      }

      return {
        width: Number(payload.width) || 0,
        height: Number(payload.height) || 0,
        min: typeof payload.min === 'number' ? payload.min : 0,
        max: typeof payload.max === 'number' ? payload.max : 1,
        data: decodeBase64ToFloat32(payload.data),
        sliceIndex: Number(payload.sliceIndex) || 0,
        secondaryModality: payload.secondaryModality ?? null,
        registrationFile: payload.registrationFile ?? null,
        transformSource: payload.transformSource === 'helper-generated' || payload.transformSource === 'helper-cache'
          ? payload.transformSource
          : undefined,
        registrationId: typeof payload.registrationId === 'string' ? payload.registrationId : undefined,
        associations: Array.isArray(payload.associations) ? payload.associations : undefined,
      } as FuseboxSlice;
    })();

    fuseboxSliceCache.set(key, pending);
  }

  try {
    return await pending;
  } catch (error) {
    fuseboxSliceCache.delete(key);
    throw error;
  }
}

export function fuseboxSliceToImageData(slice: FuseboxSlice, modality: string | null): FuseboxImageData {
  const imageData = new ImageData(slice.width, slice.height);
  const buffer = imageData.data;
  const source = slice.data;
  const min = slice.min;
  const max = slice.max;
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
    for (let i = 0; i < source.length; i++) {
      const normalized = Math.max(0, Math.min(1, (source[i] - min) / range));
      const value = Math.round(normalized * 255);
      const offset = i * 4;
      buffer[offset] = value;
      buffer[offset + 1] = value;
      buffer[offset + 2] = value;
      buffer[offset + 3] = 255;
      if (!hasSignal && Math.abs(source[i] - min) > 1e-6) {
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
