import { useMemo } from 'react';
import { useFusion } from '../fusion-context';

type SecondaryStatus = 'idle' | 'loading' | 'ready' | 'error';

type SecondaryStatusEntry = {
  status: SecondaryStatus;
  error?: string | null;
};

type SecondaryLoadingEntry = {
  progress: number;
  isLoading: boolean;
};

export function useFusionPanelState() {
  const fusion = useFusion();

  const manifestLoading =
    fusion.manifestStatus === 'loading' || fusion.manifestStatus === 'refreshing';

  const secondaryStatuses = useMemo(() => {
    const map = new Map<number, SecondaryStatusEntry>();
    fusion.secondaries.forEach((descriptor) => {
      const entry = fusion.secondaryStateMap.get(descriptor.secondarySeriesId);
      if (entry?.status === 'error' || descriptor.status === 'error') {
        map.set(descriptor.secondarySeriesId, {
          status: 'error',
          error: entry?.error ?? descriptor.error ?? null,
        });
        return;
      }
      if (entry?.status === 'ready' || descriptor.status === 'ready') {
        map.set(descriptor.secondarySeriesId, { status: 'ready', error: null });
        return;
      }
      if (entry?.status === 'loading' || descriptor.status === 'generating' || descriptor.status === 'pending') {
        map.set(descriptor.secondarySeriesId, { status: 'loading', error: null });
        return;
      }
      map.set(descriptor.secondarySeriesId, { status: 'idle', error: null });
    });
    return map;
  }, [fusion.secondaryStateMap, fusion.secondaries]);

  const secondaryLoadingStates = useMemo(() => {
    const map = new Map<number, SecondaryLoadingEntry>();
    fusion.secondaries.forEach((descriptor) => {
      const entry = fusion.secondaryStateMap.get(descriptor.secondarySeriesId);
      const isLoading = entry?.status === 'loading';
      const progress = entry?.progress ?? (descriptor.status === 'ready' ? 100 : 0);
      map.set(descriptor.secondarySeriesId, {
        progress,
        isLoading,
      });
    });
    return map;
  }, [fusion.secondaryStateMap, fusion.secondaries]);

  const hasSecondaries = fusion.secondaries.length > 0;
  const showPanel =
    fusion.showFusionPanel && (hasSecondaries || manifestLoading || Boolean(fusion.manifestError));

  return {
    opacity: fusion.opacity,
    setOpacity: fusion.setOpacity,
    secondaries: fusion.secondaries,
    selectedSecondaryId: fusion.selectedSecondaryId,
    setSelectedSecondaryId: fusion.setSelectedSecondaryId,
    fusionWindowLevel: fusion.fusionWindowLevel,
    setFusionWindowLevel: fusion.setFusionWindowLevel,
    manifestLoading,
    manifestError: fusion.manifestError,
    secondaryStatuses,
    secondaryLoadingStates,
    showPanel,
    currentlyLoadingSecondary: fusion.currentlyLoadingSecondary,
  };
}
