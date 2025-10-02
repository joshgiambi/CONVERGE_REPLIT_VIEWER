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

  const displayPatientId = patientIdParam ?? patientApiId;

  const studyIdResolved = useMemo(() => {
    if (studyIdParam) return studyIdParam;
    if (bootstrap?.currentStudy?.id != null) return String(bootstrap.currentStudy.id);
    return null;
  }, [studyIdParam, bootstrap]);

  // Fetch series data for all studies in bootstrap
  const { data: allSeriesData, isLoading: seriesLoading } = useQuery({
    queryKey: ['viewer-v2-all-series', bootstrap?.studyData?.studies?.map((s: any) => s.id)],
    queryFn: async () => {
      if (!bootstrap?.studyData?.studies) return [];
      
      // Fetch series for all studies and combine them
      const seriesPromises = bootstrap.studyData.studies.map(async (study: any) => {
        const response = await fetch(`/api/studies/${study.id}/series`);
        if (!response.ok) return [];
        return response.json();
      });
      
      const seriesArrays = await Promise.all(seriesPromises);
      return seriesArrays.flat();
    },
    enabled: !!bootstrap?.studyData?.studies && !seriesIdParam,
    staleTime: 2 * 60 * 1000,
  });

  // Get fallback series ID from fetched series data
  const fallbackSeriesId = useMemo(() => {
    if (seriesIdParam || !allSeriesData?.length) return null;
    
    // Prefer CT series if available, otherwise take first
    const ctSeries = allSeriesData.find((s: any) => s.modality === 'CT');
    const firstSeries = ctSeries || allSeriesData[0];
    
    return firstSeries?.id ? String(firstSeries.id) : null;
  }, [allSeriesData, seriesIdParam]);

  const effectiveSeriesId = seriesIdParam || fallbackSeriesId;

  if (studiesLoading || seriesLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-black">
        <div className="text-center text-white">
          <h1 className="text-2xl font-bold mb-4">ViewerV2</h1>
          <p className="text-gray-400">Loading viewer data...</p>
        </div>
      </div>
    );
  }

  if (studiesError || bootstrapError) {
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
    />
  );
}
