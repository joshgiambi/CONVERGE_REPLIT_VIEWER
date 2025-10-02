/**
 * useSeriesData Hook
 * 
 * Hook for fetching and managing DICOM series data with filtering.
 * Extracted from viewer-interface.tsx series loading logic.
 * 
 * Agent 4: Services & Hooks
 * Created: Hour 10-12
 */

import { useState, useEffect, useCallback } from 'react';
import { SeriesFilterService } from '@/services/SeriesFilterService';
import type {
  DICOMSeries,
  UseSeriesDataResult,
  SeriesFilterCriteria,
} from '@/types/viewer';

interface UseSeriesDataOptions {
  studyIds?: number[];
  patientId?: number;
  autoLoad?: boolean;
  filterCriteria?: SeriesFilterCriteria;
  onLoadComplete?: (series: DICOMSeries[]) => void;
  onError?: (error: Error) => void;
}

/**
 * Hook for fetching and managing series data
 */
export function useSeriesData(options: UseSeriesDataOptions): UseSeriesDataResult {
  const {
    studyIds,
    patientId,
    autoLoad = true,
    filterCriteria = { hideDerived: true, hideResampled: true, hideSecondary: true },
    onLoadComplete,
    onError,
  } = options;

  const [series, setSeries] = useState<DICOMSeries[]>([]);
  const [visibleSeries, setVisibleSeries] = useState<DICOMSeries[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [selectedSeries, setSelectedSeries] = useState<DICOMSeries | null>(null);

  /**
   * Fetch series from API
   */
  const fetchSeries = useCallback(async (): Promise<DICOMSeries[]> => {
    // Determine which endpoint to use
    let url: string;
    
    if (studyIds && studyIds.length > 0) {
      // Fetch for specific studies
      if (studyIds.length === 1) {
        url = `/api/studies/${studyIds[0]}/series`;
      } else {
        // Multiple studies - fetch individually and combine
        const promises = studyIds.map(id => 
          fetch(`/api/studies/${id}/series`).then(r => r.json())
        );
        const results = await Promise.all(promises);
        const allSeries = results.flatMap(r => r.series || []);
        return allSeries;
      }
    } else if (patientId) {
      // Fetch all series for patient
      url = `/api/patients/${patientId}/series`;
    } else {
      throw new Error('Either studyIds or patientId must be provided');
    }

    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch series: ${response.status}`);
    }

    const data = await response.json();
    return data.series || [];
  }, [studyIds, patientId]);

  /**
   * Load series data
   */
  const loadSeries = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const fetchedSeries = await fetchSeries();
      setSeries(fetchedSeries);

      // Apply filters
      const filtered = SeriesFilterService.filterVisibleSeries(
        fetchedSeries,
        filterCriteria
      );

      setVisibleSeries(filtered.visible);
      setIsLoading(false);

      if (onLoadComplete) {
        onLoadComplete(fetchedSeries);
      }

      // Auto-select first visible series
      if (filtered.visible.length > 0 && !selectedSeries) {
        setSelectedSeries(filtered.visible[0]);
      }
    } catch (err: any) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      setIsLoading(false);

      if (onError) {
        onError(error);
      }
    }
  }, [fetchSeries, filterCriteria, onLoadComplete, onError, selectedSeries]);

  /**
   * Select a series
   */
  const selectSeries = useCallback((series: DICOMSeries) => {
    setSelectedSeries(series);
  }, []);

  /**
   * Reload series data
   */
  const reload = useCallback(() => {
    loadSeries();
  }, [loadSeries]);

  /**
   * Update filter criteria and re-filter
   */
  const updateFilters = useCallback(
    (newCriteria: SeriesFilterCriteria) => {
      const filtered = SeriesFilterService.filterVisibleSeries(series, newCriteria);
      setVisibleSeries(filtered.visible);
    },
    [series]
  );

  /**
   * Auto-load series when options change
   */
  useEffect(() => {
    if (autoLoad && (studyIds || patientId)) {
      loadSeries();
    }
  }, [autoLoad, studyIds, patientId, loadSeries]);

  /**
   * Re-filter when criteria changes
   */
  useEffect(() => {
    if (series.length > 0) {
      const filtered = SeriesFilterService.filterVisibleSeries(series, filterCriteria);
      setVisibleSeries(filtered.visible);
    }
  }, [series, filterCriteria]);

  return {
    series,
    visibleSeries,
    isLoading,
    error,
    selectedSeries,
    selectSeries,
    reload,
    updateFilters,
  } as UseSeriesDataResult & {
    reload: () => void;
    updateFilters: (criteria: SeriesFilterCriteria) => void;
  };
}

