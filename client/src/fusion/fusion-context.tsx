import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import type { ReactNode } from 'react';
import { FusionOverlayManager, type OverlayCanvas } from '@/lib/fusion-overlay-manager';
import { fetchFusionManifest, preloadFusionSecondary } from '@/lib/fusion-utils';
import type { FusionManifest, FusionSecondaryDescriptor, RegistrationAssociation, RegistrationOption } from '@/types/fusion';
import { useRegistrationOptions, type RegistrationResolveInfo } from './hooks/useRegistrationOptions';

export type SecondaryState = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  progress: number;
  error?: string | null;
};

export type FusionOverlayRequest = {
  sopInstanceUID: string;
  sliceIndex: number;
  instanceNumber?: number | null;
  position?: [number, number, number] | null;
};

type FusionStatus = 'idle' | 'loading' | 'refreshing' | 'ready' | 'error';

interface FusionState {
  primarySeriesId: number | null;
  manifest: FusionManifest | null;
  manifestStatus: FusionStatus;
  manifestError: string | null;
  selectedSecondaryId: number | null;
  opacity: number;
  secondaryMap: Map<number, SecondaryState>;
  currentlyLoadingSecondary: number | null;
  fusionWindowLevel: { window: number; level: number } | null;
  isPolling: boolean;
}

type Action =
  | { type: 'reset' }
  | { type: 'initializePrimary'; primarySeriesId: number }
  | { type: 'setManifestStatus'; status: FusionStatus }
  | { type: 'setManifest'; manifest: FusionManifest }
  | { type: 'setManifestError'; error: string }
  | { type: 'setSelectedSecondary'; id: number | null }
  | { type: 'setOpacity'; opacity: number }
  | { type: 'setSecondaryMap'; map: Map<number, SecondaryState> }
  | { type: 'setSecondaryState'; secondaryId: number; state: SecondaryState }
  | { type: 'setCurrentlyLoadingSecondary'; id: number | null }
  | { type: 'setFusionWindowLevel'; value: { window: number; level: number } | null }
  | { type: 'setPolling'; value: boolean };

const initialState: FusionState = {
  primarySeriesId: null,
  manifest: null,
  manifestStatus: 'idle',
  manifestError: null,
  selectedSecondaryId: null,
  opacity: 0.5,
  secondaryMap: new Map(),
  currentlyLoadingSecondary: null,
  fusionWindowLevel: null,
  isPolling: false,
};

function cloneSecondaryMap(map: Map<number, SecondaryState>): Map<number, SecondaryState> {
  return new Map(map.entries());
}

function mergeSecondaryMap(
  manifest: FusionManifest,
  previous: Map<number, SecondaryState>,
): Map<number, SecondaryState> {
  const next = new Map<number, SecondaryState>();
  for (const descriptor of manifest.secondaries) {
    const id = descriptor.secondarySeriesId;
    const prev = previous.get(id);
    if (descriptor.status === 'error') {
      next.set(id, {
        status: 'error',
        progress: prev?.progress ?? 0,
        error: descriptor.error ?? prev?.error ?? null,
      });
      continue;
    }
    if (descriptor.status === 'ready') {
      if (prev?.status === 'ready') {
        next.set(id, { status: 'ready', progress: prev.progress, error: null });
      } else if (prev?.status === 'loading') {
        next.set(id, { status: 'loading', progress: prev.progress, error: null });
      } else {
        next.set(id, { status: 'idle', progress: prev?.progress ?? 0, error: null });
      }
      continue;
    }
    // Pending / generating / unknown states treated as loading
    next.set(id, { status: 'loading', progress: prev?.progress ?? 0, error: null });
  }
  return next;
}

function fusionReducer(state: FusionState, action: Action): FusionState {
  switch (action.type) {
    case 'reset':
      return {
        ...state,
        primarySeriesId: null,
        manifest: null,
        manifestStatus: 'idle',
        manifestError: null,
        selectedSecondaryId: null,
        secondaryMap: new Map(),
        currentlyLoadingSecondary: null,
        fusionWindowLevel: null,
        isPolling: false,
      };
    case 'initializePrimary':
      return {
        ...state,
        primarySeriesId: action.primarySeriesId,
        manifest: null,
        manifestStatus: 'loading',
        manifestError: null,
        selectedSecondaryId: null,
        secondaryMap: new Map(),
        currentlyLoadingSecondary: null,
        fusionWindowLevel: null,
        isPolling: false,
      };
    case 'setManifestStatus':
      return { ...state, manifestStatus: action.status };
    case 'setManifest':
      return { ...state, manifest: action.manifest, manifestError: null };
    case 'setManifestError':
      return {
        ...state,
        manifestStatus: 'error',
        manifestError: action.error,
        manifest: null,
        secondaryMap: new Map(),
        selectedSecondaryId: null,
        currentlyLoadingSecondary: null,
        isPolling: false,
      };
    case 'setSelectedSecondary':
      return { ...state, selectedSecondaryId: action.id };
    case 'setOpacity':
      return { ...state, opacity: action.opacity };
    case 'setSecondaryMap':
      return { ...state, secondaryMap: cloneSecondaryMap(action.map) };
    case 'setSecondaryState': {
      const next = cloneSecondaryMap(state.secondaryMap);
      next.set(action.secondaryId, action.state);
      return { ...state, secondaryMap: next };
    }
    case 'setCurrentlyLoadingSecondary':
      return { ...state, currentlyLoadingSecondary: action.id };
    case 'setFusionWindowLevel':
      return { ...state, fusionWindowLevel: action.value };
    case 'setPolling':
      return { ...state, isPolling: action.value };
    default:
      return state;
  }
}

function dedupeAndSort(ids: number[]): number[] {
  const seen = new Set<number>();
  ids.forEach((value) => {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      seen.add(parsed);
    }
  });
  return Array.from(seen).sort((a, b) => a - b);
}

function getDefaultWindowForModality(modality?: string | null): { window: number; level: number } | null {
  const mode = (modality || '').toUpperCase();
  switch (mode) {
    case 'MR':
      return { window: 80, level: 40 };
    case 'PT':
    case 'PET':
      return { window: 5, level: 2.5 };
    case 'CT':
      return { window: 400, level: 40 };
    default:
      return null;
  }
}

interface FusionProviderProps {
  primarySeriesId: number | null;
  candidateSecondaryIds: number[];
  registrationAssociations?: Map<number, RegistrationAssociation[]>;
  children: ReactNode;
}

interface FusionContextValue {
  primarySeriesId: number | null;
  manifest: FusionManifest | null;
  manifestStatus: FusionStatus;
  manifestError: string | null;
  secondaries: FusionSecondaryDescriptor[];
  selectedSecondaryId: number | null;
  setSelectedSecondaryId: (id: number | null) => void;
  opacity: number;
  setOpacity: (opacity: number) => void;
  secondaryStateMap: Map<number, SecondaryState>;
  currentlyLoadingSecondary: number | null;
  fusionWindowLevel: { window: number; level: number } | null;
  setFusionWindowLevel: (value: { window: number; level: number } | null) => void;
  showFusionPanel: boolean;
  refreshManifest: (force?: boolean) => Promise<void>;
  getOverlayForImage: (request: FusionOverlayRequest) => Promise<OverlayCanvas | null>;
  registrationOptions: RegistrationOption[];
  selectedRegistrationId: string | null;
  setSelectedRegistrationId: (id: string | null) => void;
  registrationMatrix: number[] | null;
  registrationResolveInfo: RegistrationResolveInfo | null;
  isPolling: boolean;
}

const FusionContext = createContext<FusionContextValue | undefined>(undefined);

export function FusionProvider({ primarySeriesId, candidateSecondaryIds, registrationAssociations, children }: FusionProviderProps) {
  const [state, dispatch] = useReducer(fusionReducer, initialState);
  const overlayManagerRef = useRef<FusionOverlayManager | null>(null);
  const requestTokenRef = useRef(0);
  const previousPrimaryRef = useRef<number | null>(null);
  const previousCandidateKeyRef = useRef<string>('');
  const secondaryMapRef = useRef<Map<number, SecondaryState>>(state.secondaryMap);

  const normalizedCandidateIds = useMemo(
    () => dedupeAndSort(candidateSecondaryIds),
    [candidateSecondaryIds],
  );

  const candidateKey = useMemo(
    () => normalizedCandidateIds.join(','),
    [normalizedCandidateIds],
  );

  const secondaries = state.manifest?.secondaries ?? [];
  const manifestRef = useRef<FusionManifest | null>(state.manifest);

  const {
    registrationOptions,
    selectedRegistrationId,
    setSelectedRegistrationId,
    registrationMatrix,
    registrationResolveInfo,
  } = useRegistrationOptions({
    primarySeriesId: state.primarySeriesId,
    secondarySeriesId: state.selectedSecondaryId,
    registrationAssociations,
  });

  useEffect(() => {
    secondaryMapRef.current = state.secondaryMap;
  }, [state.secondaryMap]);

  useEffect(() => {
    manifestRef.current = state.manifest;
  }, [state.manifest]);

  const loadManifest = useCallback(
    async (
      primaryId: number,
      { force = false, suppressLoading = false }: { force?: boolean; suppressLoading?: boolean } = {},
    ) => {
      const token = ++requestTokenRef.current;
      dispatch({ type: 'setManifestStatus', status: suppressLoading ? 'refreshing' : 'loading' });
      try {
        const manifest = await fetchFusionManifest(primaryId, {
          secondarySeriesIds: normalizedCandidateIds.length ? normalizedCandidateIds : undefined,
          preload: true,
          force,
        });
        if (requestTokenRef.current !== token) return;
        dispatch({ type: 'setManifest', manifest });
        dispatch({ type: 'setManifestStatus', status: 'ready' });
        const mergedMap = mergeSecondaryMap(manifest, secondaryMapRef.current);
        dispatch({ type: 'setSecondaryMap', map: mergedMap });
      } catch (error: any) {
        if (requestTokenRef.current !== token) return;
        const message = error?.message || 'Fusion manifest request failed';
        dispatch({ type: 'setManifestError', error: message });
      }
    },
    [normalizedCandidateIds],
  );

  useEffect(() => {
    const prevPrimary = previousPrimaryRef.current;
    const prevCandidateKey = previousCandidateKeyRef.current;
    const primaryChanged = primarySeriesId !== prevPrimary;
    const candidateChanged = candidateKey !== prevCandidateKey;
    previousPrimaryRef.current = primarySeriesId ?? null;
    previousCandidateKeyRef.current = candidateKey;

    if (!primarySeriesId) {
      overlayManagerRef.current?.clearCache();
      overlayManagerRef.current = null;
      dispatch({ type: 'reset' });
      return;
    }

    if (primaryChanged) {
      overlayManagerRef.current?.clearCache();
      overlayManagerRef.current = new FusionOverlayManager(primarySeriesId);
      dispatch({ type: 'initializePrimary', primarySeriesId });
      loadManifest(primarySeriesId, { force: false, suppressLoading: false });
      return;
    }

    if (candidateChanged) {
      loadManifest(primarySeriesId, { force: true, suppressLoading: true });
    }
  }, [candidateKey, loadManifest, primarySeriesId]);

  useEffect(() => {
    const manifest = state.manifest;
    if (!manifest) {
      return;
    }
    const merged = mergeSecondaryMap(manifest, state.secondaryMap);
    dispatch({ type: 'setSecondaryMap', map: merged });
  }, [state.manifest]);

  useEffect(() => {
    const manifest = state.manifest;
    if (!manifest || !state.primarySeriesId) {
      return;
    }
    const candidateSet = normalizedCandidateIds.length ? new Set(normalizedCandidateIds) : null;
    const pendingDescriptors = manifest.secondaries.filter((descriptor) => {
      if (descriptor.status === 'ready' || descriptor.status === 'error') return false;
      if (candidateSet && !candidateSet.has(descriptor.secondarySeriesId)) return false;
      return true;
    });
    if (!pendingDescriptors.length) {
      if (state.isPolling) dispatch({ type: 'setPolling', value: false });
      return;
    }

    let cancelled = false;
    let attempt = 0;
    dispatch({ type: 'setPolling', value: true });

    const poll = async () => {
      attempt += 1;
      if (cancelled || attempt > 6) {
        dispatch({ type: 'setPolling', value: false });
        return;
      }
      const delay = Math.min(4000, 600 * Math.pow(1.8, attempt - 1));
      await new Promise((resolve) => setTimeout(resolve, delay));
      if (cancelled) return;
      await loadManifest(state.primarySeriesId!, { force: true, suppressLoading: true });
      if (cancelled) return;
      const refreshed = manifestRef.current;
      if (!refreshed) {
        dispatch({ type: 'setPolling', value: false });
        return;
      }
      const stillPending = refreshed.secondaries.some((descriptor) => {
        if (descriptor.status === 'ready' || descriptor.status === 'error') return false;
        if (candidateSet && !candidateSet.has(descriptor.secondarySeriesId)) return false;
        return true;
      });
      if (stillPending) {
        poll();
      } else {
        dispatch({ type: 'setPolling', value: false });
      }
    };

    poll();

    return () => {
      cancelled = true;
      dispatch({ type: 'setPolling', value: false });
    };
  }, [loadManifest, normalizedCandidateIds, state.manifest, state.primarySeriesId]);

  const idleSecondaryIds = useMemo(() => {
    if (!state.manifest) return [] as number[];
    return state.manifest.secondaries
      .filter((descriptor) => descriptor.status === 'ready')
      .filter((descriptor) => {
        const entry = state.secondaryMap.get(descriptor.secondarySeriesId);
        return !entry || entry.status === 'idle';
      })
      .map((descriptor) => descriptor.secondarySeriesId);
  }, [state.manifest, state.secondaryMap]);

  useEffect(() => {
    if (!state.primarySeriesId || idleSecondaryIds.length === 0) return;
    let cancelled = false;

    const run = async () => {
      for (const secondaryId of idleSecondaryIds) {
        if (cancelled) break;
        dispatch({
          type: 'setSecondaryState',
          secondaryId,
          state: { status: 'loading', progress: 0, error: null },
        });
        dispatch({ type: 'setCurrentlyLoadingSecondary', id: secondaryId });
        try {
          await preloadFusionSecondary(state.primarySeriesId!, secondaryId, ({ completed, total }) => {
            if (cancelled) return;
            const progress = total ? (completed / total) * 100 : 0;
            dispatch({
              type: 'setSecondaryState',
              secondaryId,
              state: { status: 'loading', progress, error: null },
            });
          });
          if (cancelled) break;
          dispatch({
            type: 'setSecondaryState',
            secondaryId,
            state: { status: 'ready', progress: 100, error: null },
          });
        } catch (error: any) {
          if (cancelled) break;
          dispatch({
            type: 'setSecondaryState',
            secondaryId,
            state: {
              status: 'error',
              progress: 0,
              error: error?.message || 'Fusion preload failed',
            },
          });
        }
      }
      if (!cancelled) {
        dispatch({ type: 'setCurrentlyLoadingSecondary', id: null });
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [idleSecondaryIds, state.primarySeriesId]);

  useEffect(() => {
    if (!state.manifest) {
      dispatch({ type: 'setSelectedSecondary', id: null });
      return;
    }
    const descriptors = state.manifest.secondaries;
    if (!descriptors.length) {
      dispatch({ type: 'setSelectedSecondary', id: null });
      return;
    }
    const candidateSet = normalizedCandidateIds.length ? new Set(normalizedCandidateIds) : null;
    const hasSelected = descriptors.some((descriptor) => descriptor.secondarySeriesId === state.selectedSecondaryId);
    if (hasSelected) return;
    const nextReady = descriptors.find((descriptor) => {
      if (candidateSet && !candidateSet.has(descriptor.secondarySeriesId)) return false;
      return descriptor.status === 'ready';
    });
    if (nextReady) {
      dispatch({ type: 'setSelectedSecondary', id: nextReady.secondarySeriesId });
      return;
    }
    dispatch({ type: 'setSelectedSecondary', id: null });
  }, [normalizedCandidateIds, state.manifest, state.selectedSecondaryId]);

  useEffect(() => {
    const manager = overlayManagerRef.current;
    if (!manager) return;
    const descriptor = state.manifest?.secondaries.find((secondary) => secondary.secondarySeriesId === state.selectedSecondaryId) ?? null;
    const modality = descriptor?.secondaryModality ?? undefined;
    manager.setSecondary(state.selectedSecondaryId, modality);
  }, [state.manifest, state.selectedSecondaryId]);

  useEffect(() => {
    if (!state.manifest) {
      dispatch({ type: 'setFusionWindowLevel', value: null });
      return;
    }
    const descriptor = state.manifest.secondaries.find((secondary) => secondary.secondarySeriesId === state.selectedSecondaryId) ?? null;
    if (!descriptor) {
      dispatch({ type: 'setFusionWindowLevel', value: null });
      return;
    }
    const center = descriptor.windowCenter?.[0];
    const width = descriptor.windowWidth?.[0];
    if (Number.isFinite(center) && Number.isFinite(width)) {
      dispatch({ type: 'setFusionWindowLevel', value: { window: Number(width), level: Number(center) } });
      return;
    }
    const fallback = getDefaultWindowForModality(descriptor.secondaryModality);
    dispatch({ type: 'setFusionWindowLevel', value: fallback });
  }, [state.manifest, state.selectedSecondaryId]);

  const setSelectedSecondaryId = useCallback((id: number | null) => {
    dispatch({ type: 'setSelectedSecondary', id });
    const manager = overlayManagerRef.current;
    if (manager) {
      manager.clearCache();
    }
  }, []);

  const setOpacity = useCallback((value: number) => {
    dispatch({ type: 'setOpacity', opacity: Math.max(0, Math.min(1, value)) });
  }, []);

  const setFusionWindowLevel = useCallback((value: { window: number; level: number } | null) => {
    dispatch({ type: 'setFusionWindowLevel', value });
  }, []);

  const refreshManifest = useCallback(
    async (force: boolean = true) => {
      if (!state.primarySeriesId) return;
      await loadManifest(state.primarySeriesId, { force, suppressLoading: false });
    },
    [loadManifest, state.primarySeriesId],
  );

  const getOverlayForImage = useCallback(
    async ({ sopInstanceUID, sliceIndex, instanceNumber = null, position = null }: FusionOverlayRequest): Promise<OverlayCanvas | null> => {
      const manager = overlayManagerRef.current;
      if (!manager) return null;
      if (!state.selectedSecondaryId) return null;
      const descriptor = state.manifest?.secondaries.find((secondary) => secondary.secondarySeriesId === state.selectedSecondaryId);
      if (!descriptor || descriptor.status !== 'ready') return null;
      const status = state.secondaryMap.get(state.selectedSecondaryId);
      if (status?.status === 'error') return null;
      try {
        const overlay = await manager.getOverlay(sopInstanceUID, sliceIndex, instanceNumber, position);
        return overlay;
      } catch (error) {
        console.warn('Fusion overlay fetch failed', error);
        return null;
      }
    },
    [state.manifest, state.secondaryMap, state.selectedSecondaryId],
  );

  const showFusionPanel = state.manifestStatus === 'loading'
    || state.manifestStatus === 'refreshing'
    || (state.manifest?.secondaries?.length ?? 0) > 0;

  const value = useMemo<FusionContextValue>(() => ({
    primarySeriesId: state.primarySeriesId,
    manifest: state.manifest,
    manifestStatus: state.manifestStatus,
    manifestError: state.manifestError,
    secondaries,
    selectedSecondaryId: state.selectedSecondaryId,
    setSelectedSecondaryId,
    opacity: state.opacity,
    setOpacity,
    secondaryStateMap: state.secondaryMap,
    currentlyLoadingSecondary: state.currentlyLoadingSecondary,
    fusionWindowLevel: state.fusionWindowLevel,
    setFusionWindowLevel,
    showFusionPanel,
    refreshManifest,
    getOverlayForImage,
    registrationOptions,
    selectedRegistrationId,
    setSelectedRegistrationId,
    registrationMatrix,
    registrationResolveInfo,
    isPolling: state.isPolling,
  }), [
    getOverlayForImage,
    refreshManifest,
    secondaries,
    setFusionWindowLevel,
    setOpacity,
    setSelectedSecondaryId,
    showFusionPanel,
    state.currentlyLoadingSecondary,
    state.fusionWindowLevel,
    state.manifest,
    state.manifestError,
    state.manifestStatus,
    state.opacity,
    state.primarySeriesId,
    state.secondaryMap,
    state.selectedSecondaryId,
    registrationMatrix,
    registrationOptions,
    registrationResolveInfo,
    selectedRegistrationId,
    setSelectedRegistrationId,
    state.isPolling,
  ]);

  return <FusionContext.Provider value={value}>{children}</FusionContext.Provider>;
}

export function useFusion(): FusionContextValue {
  const context = useContext(FusionContext);
  if (!context) {
    throw new Error('useFusion must be used within a FusionProvider');
  }
  return context;
}
