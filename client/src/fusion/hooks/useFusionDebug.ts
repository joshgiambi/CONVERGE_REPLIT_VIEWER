import { useMemo } from 'react';
import { useFusion } from '../fusion-context';

export function useFusionDebug() {
  const fusion = useFusion();

  const debug = useMemo(() => {
    const manifest = fusion.manifest;
    const secondaries = manifest?.secondaries ?? [];
    const cache = [] as Array<{ key: string; sliceIndex: number; modality: string; dimensions: string; ageMs: number; hasSignal: boolean; transformSource: string | null }>;
    // We cannot access the internal overlay manager cache here; expose minimal info from manifest/state
    const now = Date.now();
    secondaries.forEach((s) => {
      const status = fusion.secondaryStateMap.get(s.secondarySeriesId);
      cache.push({
        key: `${manifest?.primarySeriesId}:${s.secondarySeriesId}`,
        sliceIndex: -1,
        modality: s.secondaryModality || 'UNKNOWN',
        dimensions: '—',
        ageMs: now - (manifest?.timestamp ?? now),
        hasSignal: status?.status === 'ready',
        transformSource: null,
      });
    });
    return {
      manifest,
      cache,
    };
  }, [fusion.manifest, fusion.secondaryStateMap]);

  return debug;
}


