import { useState, useCallback, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { log } from '@/lib/log';
import type { DICOMSeries } from '@/lib/dicom-utils';
import type { RegistrationAssociation } from '@/types/fusion';

export interface UseSeriesStateReturn {
  // Series data
  series: DICOMSeries[];
  setSeries: (series: DICOMSeries[]) => void;
  visibleSeries: DICOMSeries[];
  setVisibleSeries: (series: DICOMSeries[]) => void;
  selectedSeries: DICOMSeries | null;
  setSelectedSeries: (series: DICOMSeries | null) => void;

  // Registration associations
  regAssociations: Record<number, number[]>;
  setRegAssociations: (associations: Record<number, number[]>) => void;
  registrationRelationshipMap: Map<number, RegistrationAssociation[]>;
  setRegistrationRelationshipMap: React.Dispatch<React.SetStateAction<Map<number, RegistrationAssociation[]>>>;

  // Loading state
  isLoading: boolean;

  // Computed values
  shouldHideSeries: (entry: any) => boolean;

  // Utility functions
  resetSeriesState: () => void;
  updateSeriesVisibility: (seriesId: number, visible: boolean) => void;
  selectSeries: (series: DICOMSeries | null) => void;
}

export function useSeriesState(
  studyData: any,
  onSeriesChange?: (series: DICOMSeries | null) => void
): UseSeriesStateReturn {
  const [series, setSeries] = useState<DICOMSeries[]>([]);
  const [visibleSeries, setVisibleSeries] = useState<DICOMSeries[]>([]);
  const [selectedSeries, setSelectedSeries] = useState<DICOMSeries | null>(null);
  const [regAssociations, setRegAssociations] = useState<Record<number, number[]>>({});
  const [registrationRelationshipMap, setRegistrationRelationshipMap] = useState<Map<number, RegistrationAssociation[]>>(new Map());

  // Fetch series data for all studies
  const DERIVED_DESCRIPTION_KEYWORDS = useMemo(
    () => [
      'resampled',
      're-sampled',
      'fused',
      'fusion',
      'helper cache',
      'helper-cache',
      'fusion manifest',
      'qa fusion',
      'qcfx',
      'qgfx',
      'manifest overlay',
      'resample cache',
    ],
    [],
  );

  const DERIVED_UID_MARKERS = useMemo(
    () => ['.fused', '.fusion', '.resampled', '.resample', '_fused', '_fusion', '_resamp', '-fused', '-fusion'],
    [],
  );

  const shouldHideSeries = useCallback(
    (entry: any): boolean => {
      if (!entry) return true;
      const modality = (entry.modality || '').toUpperCase();

      if (['RTSTRUCT', 'RT', 'REG'].includes(modality)) {
        return false;
      }

      if (['DERIVED', 'SECONDARY', 'OT'].includes(modality)) {
        return true;
      }

      const metadata = (entry?.metadata ?? {}) as Record<string, any>;
      const description = (entry.seriesDescription || '').toLowerCase();
      const uid = (entry.seriesInstanceUID || '').toLowerCase();

      const derivedByKeywords = DERIVED_DESCRIPTION_KEYWORDS.some((keyword) => description.includes(keyword));
      const derivedByUid = DERIVED_UID_MARKERS.some((marker) => uid.includes(marker));
      const flaggedFusion = Boolean(metadata?.fusion);
      const fusionCandidateModality = ['PT', 'PET', 'MR', 'NM'].includes(modality);

      if (flaggedFusion && !fusionCandidateModality) {
        return true;
      }

      if ((derivedByKeywords || derivedByUid) && !fusionCandidateModality) {
        // Hide derived CT/resampled overlays, but keep PET/MR secondaries available.
        return true;
      }

      return false;
    },
    [DERIVED_DESCRIPTION_KEYWORDS, DERIVED_UID_MARKERS],
  );

  const { data: seriesData, isLoading } = useQuery({
    queryKey: ['/api/studies', studyData.studies?.map((s: any) => s.id), 'series'],
    queryFn: async () => {
      if (!studyData.studies || studyData.studies.length === 0) throw new Error('No studies');

      // Fetch series for all studies and combine them
      const allSeries = [] as any[];
      for (const study of studyData.studies) {
        const response = await fetch(`/api/studies/${study.id}/series`);
        if (!response.ok) {
          throw new Error(`Failed to fetch series for study ${study.id}: ${response.statusText}`);
        }
        const series = await response.json();
        const extractFoR = (input: unknown): string | null => {
          if (typeof input === 'string') {
            const trimmed = input.trim();
            return trimmed.length ? trimmed : null;
          }
          return null;
        };
        // Add study info to each series for reference
        allSeries.push(
          ...series.map((s: any) => {
            const foFromRoot = extractFoR(s?.frameOfReferenceUID ?? s?.frame_of_reference_uid);
            const foFromMetadata = extractFoR(s?.metadata?.frameOfReferenceUID ?? s?.metadata?.FrameOfReferenceUID ?? s?.metadata?.frame_of_reference_uid);
            return {
              ...s,
              studyId: study.id,
              studyDate: study.studyDate,
              frameOfReferenceUID: foFromRoot ?? foFromMetadata ?? null,
            };
          }),
        );
      }
      return allSeries;
    },
    enabled: !!studyData.studies?.length,
  });

  // Update series when data changes
  useEffect(() => {
    if (seriesData) {
      setSeries(seriesData);
      // Filter visible series
      const visible = seriesData.filter((entry: any) => !shouldHideSeries(entry));
      setVisibleSeries(visible);
    }
  }, [seriesData, shouldHideSeries]);

  // Notify parent when selected series changes
  useEffect(() => {
    if (onSeriesChange) {
      onSeriesChange(selectedSeries);
    }
  }, [selectedSeries, onSeriesChange]);

  const resetSeriesState = useCallback(() => {
    log.debug('Resetting series state', 'useSeriesState');
    setSeries([]);
    setVisibleSeries([]);
    setSelectedSeries(null);
    setRegAssociations({});
    setRegistrationRelationshipMap(new Map());
  }, []);

  const updateSeriesVisibility = useCallback((seriesId: number, visible: boolean) => {
    setVisibleSeries(prev => {
      const filtered = prev.filter(s => s.id !== seriesId);
      if (visible) {
        const seriesToAdd = series.find(s => s.id === seriesId);
        if (seriesToAdd) {
          return [...filtered, seriesToAdd];
        }
      }
      return filtered;
    });
  }, [series]);

  const selectSeries = useCallback((series: DICOMSeries | null) => {
    log.debug(`Selecting series: ${series?.id || 'null'}`, 'useSeriesState');
    setSelectedSeries(series);
  }, []);

  return {
    series,
    setSeries,
    visibleSeries,
    setVisibleSeries,
    selectedSeries,
    setSelectedSeries,
    regAssociations,
    setRegAssociations,
    registrationRelationshipMap,
    setRegistrationRelationshipMap,
    isLoading,
    shouldHideSeries,
    resetSeriesState,
    updateSeriesVisibility,
    selectSeries,
  };
}