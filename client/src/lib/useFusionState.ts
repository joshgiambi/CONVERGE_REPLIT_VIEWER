import { useState, useRef, useCallback } from 'react';
import { log } from '@/lib/log';
import type { FusionManifest } from '@/types/fusion';
import type { DICOMSeries } from '@/lib/dicom-utils';

export interface UseFusionStateReturn {
  // Fusion panel visibility
  showFusionPanel: boolean;
  setShowFusionPanel: (show: boolean) => void;

  // Secondary series selection
  secondarySeriesId: number | null;
  setSecondarySeriesId: (id: number | null) => void;

  // Fusion settings
  fusionOpacity: number;
  setFusionOpacity: (opacity: number) => void;

  // Loading states
  secondaryLoadingStates: Map<number, {progress: number, isLoading: boolean}>;
  setSecondaryLoadingStates: React.Dispatch<React.SetStateAction<Map<number, {progress: number, isLoading: boolean}>>>;
  currentlyLoadingSecondary: number | null;
  setCurrentlyLoadingSecondary: (id: number | null) => void;

  // Manifest state
  fusionManifest: FusionManifest | null;
  setFusionManifest: (manifest: FusionManifest | null) => void;
  fusionManifestError: string | null;
  setFusionManifestError: (error: string | null) => void;
  fusionManifestLoading: boolean;
  setFusionManifestLoading: (loading: boolean) => void;
  fusionWindowLevel: { window: number; level: number } | null;
  setFusionWindowLevel: (level: { window: number; level: number } | null) => void;

  // Status and debug
  manifestActionStatus: string | null;
  setManifestActionStatus: (status: string | null) => void;
  associationsReady: boolean;
  setAssociationsReady: (ready: boolean) => void;
  fusionDebugSnapshot: string | null;
  setFusionDebugSnapshot: (snapshot: string | null) => void;

  // Primary series selection
  fallbackPrimarySeries: DICOMSeries | null;
  setFallbackPrimarySeries: (series: DICOMSeries | null) => void;
  associationPrimarySeries: DICOMSeries | null;
  setAssociationPrimarySeries: (series: DICOMSeries | null) => void;

  // Refs for request tracking
  fusionManifestRequestRef: React.MutableRefObject<number>;
  manifestInitRequestedRef: React.MutableRefObject<boolean>;
  autoPrimarySelectedRef: React.MutableRefObject<boolean>;
  manifestPrimedPatientsRef: React.MutableRefObject<Set<number>>;
  manifestPrimingTasksRef: React.MutableRefObject<Map<number, Promise<void>>>;

  // Utility functions
  resetFusionState: () => void;
  updateLoadingState: (seriesId: number, progress: number, isLoading: boolean) => void;
}

export function useFusionState(): UseFusionStateReturn {
  const [showFusionPanel, setShowFusionPanel] = useState(false);
  const [secondarySeriesId, setSecondarySeriesId] = useState<number | null>(null);
  const [fusionOpacity, setFusionOpacity] = useState(0.5);
  const [secondaryLoadingStates, setSecondaryLoadingStates] = useState<Map<number, {progress: number, isLoading: boolean}>>(new Map());
  const [currentlyLoadingSecondary, setCurrentlyLoadingSecondary] = useState<number | null>(null);
  const [fusionManifest, setFusionManifest] = useState<FusionManifest | null>(null);
  const [fusionManifestError, setFusionManifestError] = useState<string | null>(null);
  const [fusionManifestLoading, setFusionManifestLoading] = useState(false);
  const [fusionWindowLevel, setFusionWindowLevel] = useState<{ window: number; level: number } | null>(null);
  const [manifestActionStatus, setManifestActionStatus] = useState<string | null>(null);
  const [associationsReady, setAssociationsReady] = useState(false);
  const [fusionDebugSnapshot, setFusionDebugSnapshot] = useState<string | null>(null);
  const [fallbackPrimarySeries, setFallbackPrimarySeries] = useState<DICOMSeries | null>(null);
  const [associationPrimarySeries, setAssociationPrimarySeries] = useState<DICOMSeries | null>(null);

  const fusionManifestRequestRef = useRef(0);
  const manifestInitRequestedRef = useRef(false);
  const autoPrimarySelectedRef = useRef(false);
  const manifestPrimedPatientsRef = useRef<Set<number>>(new Set());
  const manifestPrimingTasksRef = useRef<Map<number, Promise<void>>>(new Map());

  const resetFusionState = useCallback(() => {
    log.debug('Resetting fusion state', 'useFusionState');
    setSecondarySeriesId(null);
    setFusionOpacity(0.5);
    setSecondaryLoadingStates(new Map());
    setCurrentlyLoadingSecondary(null);
    setFusionManifest(null);
    setFusionManifestError(null);
    setFusionManifestLoading(false);
    setFusionWindowLevel(null);
    setManifestActionStatus(null);
    setFusionDebugSnapshot(null);
    setFallbackPrimarySeries(null);
    setAssociationPrimarySeries(null);
    manifestInitRequestedRef.current = false;
    autoPrimarySelectedRef.current = false;
    manifestPrimedPatientsRef.current.clear();
    manifestPrimingTasksRef.current.clear();
  }, []);

  const updateLoadingState = useCallback((seriesId: number, progress: number, isLoading: boolean) => {
    setSecondaryLoadingStates(prev => {
      const newMap = new Map(prev);
      newMap.set(seriesId, { progress, isLoading });
      return newMap;
    });
  }, []);

  return {
    showFusionPanel,
    setShowFusionPanel,
    secondarySeriesId,
    setSecondarySeriesId,
    fusionOpacity,
    setFusionOpacity,
    secondaryLoadingStates,
    setSecondaryLoadingStates,
    currentlyLoadingSecondary,
    setCurrentlyLoadingSecondary,
    fusionManifest,
    setFusionManifest,
    fusionManifestError,
    setFusionManifestError,
    fusionManifestLoading,
    setFusionManifestLoading,
    fusionWindowLevel,
    setFusionWindowLevel,
    manifestActionStatus,
    setManifestActionStatus,
    associationsReady,
    setAssociationsReady,
    fusionDebugSnapshot,
    setFusionDebugSnapshot,
    fallbackPrimarySeries,
    setFallbackPrimarySeries,
    associationPrimarySeries,
    setAssociationPrimarySeries,
    fusionManifestRequestRef,
    manifestInitRequestedRef,
    autoPrimarySelectedRef,
    manifestPrimedPatientsRef,
    manifestPrimingTasksRef,
    resetFusionState,
    updateLoadingState,
  };
}