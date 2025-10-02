/**
 * ViewerV2 Page
 * 
 * Route handler for new refactored viewer
 * URL: /viewer-v2?patientId=X&seriesId=Y
 * 
 * Agent 1: Viewer Core
 * Created: Hour 16-18
 */

import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { ViewerV2 } from '@/components/viewer/ViewerV2';
import { resolveViewerBootstrap, type ViewerBootstrapResult } from '@/lib/viewer-bootstrap';
import type { DICOMSeries } from '@/types/viewer';

export default function ViewerV2Page() {
  const [location] = useLocation();
  const [, rawQuery = ''] = location.split('?');
  const searchParams = useMemo(() => new URLSearchParams(rawQuery), [rawQuery]);

  const studyIdParam = searchParams.get('studyId');
  const patientIdParam = searchParams.get('patientId');
  const seriesIdParam = searchParams.get('seriesId');

  const {
    data: studies,
    isLoading: studiesLoading,
    error: studiesError,
  } = useQuery({
    queryKey: ['/api/studies'],
    queryFn: () => fetch('/api/studies').then((res) => res.json()),
    staleTime: 2 * 60 * 1000,
  });

  const [bootstrap, setBootstrap] = useState<ViewerBootstrapResult | null>(null);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const hydrate = async () => {
      if (!Array.isArray(studies) || studies.length === 0) return;
      try {
        const result = await resolveViewerBootstrap({
          studies,
          studyIdParam,
          patientIdParam,
        });
        if (!cancelled) {
          setBootstrap(result);
          setBootstrapError(null);
        }
      } catch (error) {
        console.warn('[ViewerV2] Failed to resolve viewer context', error);
        if (!cancelled) {
          setBootstrap(null);
          setBootstrapError('Failed to resolve viewer context');
        }
      }
    };

    hydrate();

    return () => {
      cancelled = true;
    };
  }, [studies, studyIdParam, patientIdParam]);

  const patientApiId = useMemo(() => {
    if (bootstrap?.patientDbId) return bootstrap.patientDbId;
    if (patientIdParam && Number.isFinite(Number(patientIdParam))) return String(Number(patientIdParam));
    if (bootstrap?.currentStudy?.patientId != null) return String(bootstrap.currentStudy.patientId);
    return null;
  }, [bootstrap, patientIdParam]);

  const studyIdResolved = useMemo(() => {
    if (studyIdParam) return studyIdParam;
    if (bootstrap?.currentStudy?.id != null) return String(bootstrap.currentStudy.id);
    return null;
  }, [studyIdParam, bootstrap]);

  const { data: studySeriesList = [], isLoading: studySeriesLoading, error: studySeriesError } = useQuery<DICOMSeries[]>({
    queryKey: ['viewer-v2-study-series', bootstrap?.studyData?.studies?.map((s: any) => s.id)],
    queryFn: async () => {
      if (!bootstrap?.studyData?.studies?.length) return [];
      const collected: DICOMSeries[] = [];
      for (const study of bootstrap.studyData.studies) {
        const response = await fetch(`/api/studies/${study.id}/series`);
        if (!response.ok) {
          throw new Error(`Failed to fetch series for study ${study.id}`);
        }
        const payload = await response.json();
        const entries = Array.isArray(payload?.series)
          ? payload.series
          : Array.isArray(payload)
            ? payload
            : [];
        collected.push(
          ...entries.map((s: any) => ({ ...s, studyId: study.id })),
        );
      }
      return collected;
    },
    enabled: !!bootstrap?.studyData?.studies?.length,
    staleTime: 2 * 60 * 1000,
  });

  const { data: patientSeriesList = [], isLoading: patientSeriesLoading, error: patientSeriesError } = useQuery<DICOMSeries[]>({
    queryKey: ['viewer-v2-patient-series', patientApiId],
    queryFn: async () => {
      if (!patientApiId) return [];
      const response = await fetch(`/api/patients/${patientApiId}/series`);
      if (!response.ok) {
        throw new Error('Failed to fetch patient series');
      }
      const payload = await response.json();
      if (Array.isArray(payload?.series)) return payload.series;
      if (Array.isArray(payload)) return payload;
      return [];
    },
    enabled: !!patientApiId,
    staleTime: 2 * 60 * 1000,
  });

  const combinedSeries = useMemo<DICOMSeries[]>(() => {
    if (studySeriesList.length) return studySeriesList as DICOMSeries[];
    return patientSeriesList as DICOMSeries[];
  }, [studySeriesList, patientSeriesList]);

  const fallbackSeriesId = useMemo(() => {
    if (seriesIdParam) return null;
    if (!combinedSeries.length) return null;
    const ctSeries = combinedSeries.find((s) => (s.modality || '').toUpperCase() === 'CT');
    const firstSeries = ctSeries || combinedSeries[0];
    return firstSeries?.id ? String(firstSeries.id) : null;
  }, [combinedSeries, seriesIdParam]);

  const effectiveSeriesId = seriesIdParam || fallbackSeriesId;

  if (studiesLoading || studySeriesLoading || patientSeriesLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-black">
        <div className="text-center text-white">
          <h1 className="text-2xl font-bold mb-4">ViewerV2</h1>
          <p className="text-gray-400">Loading viewer data...</p>
        </div>
      </div>
    );
  }

  if (studiesError || bootstrapError || studySeriesError || patientSeriesError) {
    return (
      <div className="flex items-center justify-center h-screen bg-black">
        <div className="text-center text-white">
          <h1 className="text-2xl font-bold mb-4">ViewerV2</h1>
          <p className="text-gray-400">Unable to load viewer context.</p>
          <p className="text-sm text-gray-500 mt-2">
            Please ensure the provided study or patient exists.
          </p>
        </div>
      </div>
    );
  }

  if (!patientApiId) {
    return (
      <div className="flex items-center justify-center h-screen bg-black">
        <div className="text-center text-white">
          <h1 className="text-2xl font-bold mb-4">ViewerV2</h1>
          <p className="text-gray-400">Missing patient context.</p>
          <p className="text-sm text-gray-500 mt-2">
            Usage: /viewer-v2?patientId=1, /viewer-v2?studyId=2, or /viewer-v2?seriesId=3
          </p>
        </div>
      </div>
    );
  }

  if (!effectiveSeriesId) {
    return (
      <div className="flex items-center justify-center h-screen bg-black">
        <div className="text-center text-white">
          <h1 className="text-2xl font-bold mb-4">ViewerV2</h1>
          <p className="text-gray-400">No series available for the selected patient.</p>
        </div>
      </div>
    );
  }

  return (
    <ViewerV2
      patientId={patientApiId}
      seriesId={parseInt(effectiveSeriesId, 10)}
      studyId={studyIdResolved ? parseInt(studyIdResolved, 10) : undefined}
      initialSeriesList={combinedSeries.length ? combinedSeries : undefined}
    />
  );
}
