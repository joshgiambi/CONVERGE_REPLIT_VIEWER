/**
 * ViewerV2 Page
 * 
 * Route handler for new refactored viewer
 * URL: /viewer-v2?patientId=X&seriesId=Y
 * 
 * Agent 1: Viewer Core
 * Created: Hour 16-18
 */

import { useEffect, useMemo, useState, useCallback } from 'react';
import { useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { ViewerV2 } from '@/components/viewer/ViewerV2';
import { resolveViewerBootstrap, type ViewerBootstrapResult } from '@/lib/viewer-bootstrap';
import type { DICOMSeries } from '@/types/viewer';
import { Button } from '@/components/ui/button';
import { List, Save, FolderDown } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';

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
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [seriesDescription, setSeriesDescription] = useState('');
  const [selectedExportItems, setSelectedExportItems] = useState<Set<string>>(new Set());
  const [exportItems, setExportItems] = useState<any[]>([]);
  const [currentRTSeriesId, setCurrentRTSeriesId] = useState<number | null>(null);
  const { toast } = useToast();

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

  const combinedSeries = useMemo<DICOMSeries[]>(() => {
    return studySeriesList as DICOMSeries[];
  }, [studySeriesList]);

  const fallbackSeriesId = useMemo(() => {
    if (seriesIdParam) return null;
    if (!combinedSeries.length) return null;
    const ctSeries = combinedSeries.find((s) => (s.modality || '').toUpperCase() === 'CT');
    const firstSeries = ctSeries || combinedSeries[0];
    return firstSeries?.id ? String(firstSeries.id) : null;
  }, [combinedSeries, seriesIdParam]);

  const effectiveSeriesId = seriesIdParam || fallbackSeriesId;

  const currentStudy = useMemo(() => {
    if (bootstrap?.currentStudy) return bootstrap.currentStudy;
    return bootstrap?.studyData?.studies?.[0] ?? null;
  }, [bootstrap]);

  const handleSave = useCallback(() => {
    const currentDate = new Date();
    const defaultDescription = `RT Structure Set - ${currentDate.toLocaleDateString()} ${currentDate.toLocaleTimeString()}`;
    setSeriesDescription(defaultDescription);
    setShowSaveDialog(true);
  }, []);

  const handleExport = useCallback(async () => {
    if (!currentStudy) return;
    try {
      const response = await fetch(`/api/studies/${currentStudy.id}/series`);
      if (!response.ok) {
        throw new Error('Failed to load export items');
      }
      const payload = await response.json();
      const seriesArray = Array.isArray(payload?.series)
        ? payload.series
        : Array.isArray(payload)
          ? payload
          : [];
      const items = seriesArray.map((s: any) => ({
        id: `series-${s.id}`,
        type: 'series',
        name: `${s.modality} - ${s.seriesDescription || 'Unnamed Series'}`,
        description: `${s.imageCount || 0} images`,
        data: s,
      }));
      setExportItems(items);
      setSelectedExportItems(new Set());
      setShowExportDialog(true);
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to load export items',
        variant: 'destructive',
      });
    }
  }, [currentStudy, toast]);

  const handleSaveConfirm = useCallback(async () => {
    if (!currentStudy || !currentRTSeriesId) {
      toast({ title: 'Error', description: 'No RT Structure Set loaded', variant: 'destructive' });
      return;
    }

    try {
      const res = await fetch(`/api/rt-structures/${currentRTSeriesId}/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: seriesDescription }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast({ title: 'Success', description: `RT Structure Set saved as: ${seriesDescription}` });
      setShowSaveDialog(false);
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to save RT structure set', variant: 'destructive' });
    }
  }, [currentStudy, currentRTSeriesId, seriesDescription, toast]);

  const handleExportConfirm = useCallback(async () => {
    if (selectedExportItems.size === 0) {
      toast({
        title: 'Warning',
        description: 'Please select items to export',
        variant: 'destructive',
      });
      return;
    }

    try {
      if (!currentStudy) return;
      const seriesIds = exportItems
        .filter((item) => selectedExportItems.has(item.id))
        .map((item) => item.data.id);

      const res = await fetch(`/api/studies/${currentStudy.id}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seriesIds }),
      });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `study_${currentStudy.id}_export.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({ title: 'Export started', description: `Exporting ${selectedExportItems.size} items...` });
      setShowExportDialog(false);
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to export files', variant: 'destructive' });
    }
  }, [currentStudy, exportItems, selectedExportItems, toast]);

  if (studiesLoading || studySeriesLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-black">
        <div className="text-center text-white">
          <h1 className="text-2xl font-bold mb-4">ViewerV2</h1>
          <p className="text-gray-400">Loading viewer data...</p>
        </div>
      </div>
    );
  }

  if (studiesError || bootstrapError || studySeriesError) {
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

  const patientName = bootstrap?.studyData?.patient?.patientName
    ?? currentStudy?.patientName
    ?? 'Unknown Patient';
  const patientIdentifier = bootstrap?.studyData?.patient?.patientID
    ?? currentStudy?.patientID
    ?? 'No ID';

  return (
    <div className="min-h-screen bg-dicom-black text-white">
      <header className="fixed top-4 left-4 right-4 bg-gray-950/90 backdrop-blur-xl border border-gray-600/60 rounded-2xl px-6 py-3 z-50 shadow-2xl shadow-black/50 animate-slide-up">
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center space-x-4">
            <div>
              <h1 className="text-xl font-black tracking-widest" style={{ letterSpacing: '0.25em' }}>
                <span style={{ color: 'white', fontWeight: '900' }}>S</span>
                <span style={{ color: 'white', fontWeight: '900' }}>U</span>
                <span style={{ color: 'white', fontWeight: '900' }}>P</span>
                <span style={{ color: 'white', fontWeight: '900' }}>E</span>
                <span style={{ color: 'white', fontWeight: '900' }}>R</span>
                <span
                  style={{
                    background: 'linear-gradient(45deg, #9333ea, #dc2626)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    backgroundClip: 'text',
                    fontWeight: '900',
                  }}
                >
                  B
                </span>
                <span
                  style={{
                    background: 'linear-gradient(45deg, #9333ea, #dc2626)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    backgroundClip: 'text',
                    fontWeight: '900',
                  }}
                >
                  E
                </span>
                <span
                  style={{
                    background: 'linear-gradient(45deg, #9333ea, #dc2626)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    backgroundClip: 'text',
                    fontWeight: '900',
                  }}
                >
                  A
                </span>
                <span
                  style={{
                    background: 'linear-gradient(45deg, #9333ea, #dc2626)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    backgroundClip: 'text',
                    fontWeight: '900',
                  }}
                >
                  M
                </span>
              </h1>
            </div>

            {(bootstrap?.studyData?.patient || currentStudy) && (
              <div className="flex items-center space-x-3 pl-4 border-l border-gray-600">
                <div>
                  <h2 className="text-sm font-semibold text-dicom-yellow">
                    {patientName}
                  </h2>
                  <p className="text-xs text-gray-400">
                    ID: {patientIdentifier}
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center space-x-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => window.open('/', '_blank')}
              className="text-white hover:bg-white/10"
            >
              <List className="h-4 w-4 mr-2" />
              Patient List
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSave}
              className="text-white hover:bg-white/10"
            >
              <Save className="h-4 w-4 mr-2" />
              Save
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleExport}
              className="text-white hover:bg-white/10"
            >
              <FolderDown className="h-4 w-4 mr-2" />
              Export
            </Button>
          </div>
        </div>
      </header>

      <div className="pt-24 pb-8 px-4">
        <ViewerV2
          patientId={patientApiId}
          seriesId={parseInt(effectiveSeriesId, 10)}
          studyId={studyIdResolved ? parseInt(studyIdResolved, 10) : undefined}
          initialSeriesList={combinedSeries.length ? combinedSeries : undefined}
          onLoadedRtSeriesChange={setCurrentRTSeriesId}
        />
      </div>

      <Dialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
        <DialogContent className="sm:max-w-[425px] bg-gray-900 border-gray-700">
          <DialogHeader>
            <DialogTitle className="text-white">Save RT Structure Set</DialogTitle>
            <DialogDescription className="text-gray-400">
              Create a new version of the RT structure set
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="series-description" className="text-right text-white">
                Description
              </Label>
              <Input
                id="series-description"
                value={seriesDescription}
                onChange={(e) => setSeriesDescription(e.target.value)}
                className="col-span-3 bg-gray-800 border-gray-700 text-white"
              />
            </div>
            <div className="text-sm text-gray-400">
              This will create a new version of the RT structure set that can be retrieved later.
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowSaveDialog(false)}
              className="border-gray-600 text-gray-400 hover:bg-gray-800"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveConfirm}
              className="bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showExportDialog} onOpenChange={setShowExportDialog}>
        <DialogContent className="sm:max-w-[600px] max-h-[600px] bg-gray-900 border-gray-700">
          <DialogHeader>
            <DialogTitle className="text-white">Export DICOM Files</DialogTitle>
            <DialogDescription className="text-gray-400">
              Select the series you want to export
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <div className="mb-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (selectedExportItems.size === exportItems.length) {
                    setSelectedExportItems(new Set());
                  } else {
                    setSelectedExportItems(new Set(exportItems.map((item) => item.id)));
                  }
                }}
                className="border-gray-600 text-gray-400 hover:bg-gray-800"
              >
                {selectedExportItems.size === exportItems.length ? 'Deselect All' : 'Select All'}
              </Button>
            </div>
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {exportItems.map((item) => (
                <div key={item.id} className="flex items-center space-x-2 p-2 hover:bg-gray-700/50 rounded transition-colors">
                  <Checkbox
                    id={item.id}
                    checked={selectedExportItems.has(item.id)}
                    onCheckedChange={(checked) => {
                      setSelectedExportItems((prev) => {
                        const next = new Set(prev);
                        if (checked === true) {
                          next.add(item.id);
                        } else {
                          next.delete(item.id);
                        }
                        return next;
                      });
                    }}
                  />
                  <label htmlFor={item.id} className="flex-1">
                    <div className="font-medium text-white">{item.name}</div>
                    <div className="text-xs text-gray-400">{item.description}</div>
                  </label>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowExportDialog(false)}
              className="border-gray-600 text-gray-400 hover:bg-gray-800"
            >
              Cancel
            </Button>
            <Button
              onClick={handleExportConfirm}
              className="bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              Export
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
