import { useMemo, useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Loader2, RefreshCcw } from 'lucide-react';

interface SlicePayload {
  width: number;
  height: number;
  min: number;
  max: number;
  data: string;
  modality?: string | null;
}

interface FusionTestSlice {
  sliceIndex: number;
  primary: SlicePayload;
  secondary: SlicePayload;
  blend: SlicePayload;
}

interface DebugEvent {
  id: number;
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  source: string;
  message: string;
  context?: Record<string, unknown>;
}

const decodeBase64ToFloat32 = (encoded: string): Float32Array => {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
};

const createImageData = (slice: SlicePayload, modality: string | null | undefined) => {
  const data = decodeBase64ToFloat32(slice.data);
  const imageData = new ImageData(slice.width, slice.height);
  const buffer = imageData.data;
  const min = slice.min;
  const max = slice.max;
  const range = Math.max(1e-6, max - min);
  const mode = (modality || '').toUpperCase();
  const isPET = mode === 'PT' || mode === 'PET';
  const isCT = mode === 'CT' || mode === 'MR' || mode === '';

  const applyFdg = (n: number) => {
    // Medical-grade PET colormap (hot metal / FDG standard) - synchronized with fusion-utils.ts
    const stops = [
      { t: 0.0, c: [0, 0, 0, 0] },
      { t: 0.01, c: [0, 0, 0, 0] },
      { t: 0.15, c: [90, 25, 0, 220] },
      { t: 0.4, c: [220, 110, 0, 240] },
      { t: 0.7, c: [255, 200, 0, 250] },
      { t: 1.0, c: [255, 255, 255, 255] },
    ];

    if (n <= stops[1].t) return [0, 0, 0, 0];
    for (let i = 0; i < stops.length - 1; i += 1) {
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

  for (let i = 0; i < data.length; i += 1) {
    const normalized = Math.max(0, Math.min(1, (data[i] - min) / range));
    const offset = i * 4;

    if (isPET) {
      const [r, g, b, a] = applyFdg(normalized);
      buffer[offset] = r;
      buffer[offset + 1] = g;
      buffer[offset + 2] = b;
      buffer[offset + 3] = a;
      continue;
    }

    const gray = Math.round(normalized * 255);
    buffer[offset] = gray;
    buffer[offset + 1] = gray;
    buffer[offset + 2] = gray;
    buffer[offset + 3] = 255;
  }

  return imageData;
};

const SlicePreview = ({ slice, secondaryModality }: { slice: FusionTestSlice; secondaryModality: string | null | undefined }) => {
  const primaryRef = useRef<HTMLCanvasElement | null>(null);
  const secondaryRef = useRef<HTMLCanvasElement | null>(null);
  const blendRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const refs = [
      { ref: primaryRef.current, payload: slice.primary, modality: 'CT' },
      { ref: secondaryRef.current, payload: slice.secondary, modality: secondaryModality },
      { ref: blendRef.current, payload: slice.blend, modality: 'CT' },
    ];

    refs.forEach(({ ref, payload, modality }) => {
      if (!ref || !payload) return;
      ref.width = payload.width;
      ref.height = payload.height;
      const ctx = ref.getContext('2d');
      if (!ctx) return;
      const imageData = createImageData(payload, modality);
      ctx.putImageData(imageData, 0, 0);
    });
  }, [slice, secondaryModality]);

  return (
    <Card className="bg-slate-950/80 border-slate-700/50">
      <CardHeader className="py-3">
        <div className="text-sm text-slate-200 font-semibold">Slice {slice.sliceIndex}</div>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-400 mb-2">Primary CT</div>
          <canvas ref={primaryRef} className="border border-slate-700/60 w-full" />
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-400 mb-2">Resampled Secondary</div>
          <canvas ref={secondaryRef} className="border border-slate-700/60 w-full" />
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-400 mb-2">Blended Overlay</div>
          <canvas ref={blendRef} className="border border-slate-700/60 w-full" />
        </div>
      </CardContent>
    </Card>
  );
};

function parseSliceInput(value: string, maxExclusive: number): number[] {
  if (!value.trim()) {
    return [];
  }
  const parts = value.split(/[\s,]+/).filter(Boolean);
  const indices = new Set<number>();
  for (const part of parts) {
    if (part.includes('-')) {
      const [startStr, endStr] = part.split('-');
      const start = Number(startStr);
      const end = Number(endStr);
      if (Number.isInteger(start) && Number.isInteger(end)) {
        const lo = Math.min(start, end);
        const hi = Math.max(start, end);
        for (let i = lo; i <= hi; i += 1) {
          if (i >= 0 && i < maxExclusive) indices.add(i);
        }
      }
    } else {
      const idx = Number(part);
      if (Number.isInteger(idx) && idx >= 0 && idx < maxExclusive) {
        indices.add(idx);
      }
    }
  }
  return Array.from(indices).sort((a, b) => a - b);
}

const FusionTestPage = () => {
  const [, navigate] = useLocation();
  const searchParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const patientIdParam = searchParams.get('patientId');
  const { toast } = useToast();

  const { data: patients = [], isLoading: patientsLoading } = useQuery<any[]>({ queryKey: ['/api/patients'] });
  const { data: studies = [], isLoading: studiesLoading } = useQuery<any[]>({ queryKey: ['/api/studies'] });
  const { data: series = [], isLoading: seriesLoading } = useQuery<any[]>({ queryKey: ['/api/series'] });

  const [selectedPrimaryId, setSelectedPrimaryId] = useState<number | null>(null);
  const [selectedSecondaryId, setSelectedSecondaryId] = useState<number | null>(null);
  const [sliceInput, setSliceInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [results, setResults] = useState<FusionTestSlice[]>([]);
  const [transformInfo, setTransformInfo] = useState<{
    registrationId: string | null;
    transformSource?: string;
    transformMatrix?: number[] | null;
    transformFile?: string | null;
    primaryFrameOfReferenceUID?: string | null;
    secondaryFrameOfReferenceUID?: string | null;
    sliceIndices?: number[];
  } | null>(null);
  const [debugInfo, setDebugInfo] = useState<any | null>(null);
  const [transformDetails, setTransformDetails] = useState<any | null>(null);
  const [helperLogs, setHelperLogs] = useState<DebugEvent[]>([]);
  const [isInspecting, setIsInspecting] = useState(false);

  const patientRecord = useMemo(() => {
    if (!patientIdParam) return null;
    return patients.find((p) => p.patientID === patientIdParam || String(p.id) === patientIdParam) || null;
  }, [patients, patientIdParam]);

  const patientStudies = useMemo(() => {
    if (!patientRecord) return [];
    return studies.filter((study: any) => study.patientId === patientRecord.id);
  }, [patientRecord, studies]);

  const patientSeries = useMemo(() => {
    if (!patientStudies.length) return [];
    const studyIds = new Set(patientStudies.map((s: any) => s.id));
    return series.filter((s: any) => studyIds.has(s.studyId));
  }, [patientStudies, series]);

  const ctSeries = useMemo(() => patientSeries.filter((s: any) => s.modality === 'CT'), [patientSeries]);
  const secondarySeries = useMemo(
    () => patientSeries.filter((s: any) => s.id !== selectedPrimaryId),
    [patientSeries, selectedPrimaryId],
  );

  useEffect(() => {
    if (!selectedPrimaryId && ctSeries.length > 0) {
      setSelectedPrimaryId(ctSeries[0].id);
    }
  }, [ctSeries, selectedPrimaryId]);

  useEffect(() => {
    if (!selectedSecondaryId && secondarySeries.length > 0) {
      setSelectedSecondaryId(secondarySeries[0].id);
    }
  }, [secondarySeries, selectedSecondaryId]);

  const loading = patientsLoading || studiesLoading || seriesLoading;

  const handleGenerate = async () => {
    if (!selectedPrimaryId || !selectedSecondaryId) {
      toast({ title: 'Select series', description: 'Choose a primary CT and a secondary series first.', variant: 'destructive' });
      return;
    }

    const primary = ctSeries.find((s: any) => s.id === selectedPrimaryId);
    if (!primary) {
      toast({ title: 'Invalid primary series', variant: 'destructive' });
      return;
    }

    const parsedSlices = parseSliceInput(sliceInput, primary.imageCount || 0);
    const sliceIndices = parsedSlices.length > 0 ? parsedSlices : [Math.floor((primary.imageCount || 1) / 2)];

    setIsSubmitting(true);
    setResults([]);
    setTransformInfo(null);
    setDebugInfo(null);
    setTransformDetails(null);

    try {
      const response = await fetch('/api/fusebox/test-slices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          primarySeriesId: selectedPrimaryId,
          secondarySeriesId: selectedSecondaryId,
          sliceIndices,
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || 'Failed to generate fusion test slices');
      }

      const payload = await response.json();
      setResults(payload.slices || []);
      const info = {
        registrationId: payload.registrationId ?? null,
        transformSource: payload.transformSource,
        transformMatrix: payload.transformMatrix ?? null,
        transformFile: payload.transformFile ?? null,
        primaryFrameOfReferenceUID: payload.primaryFrameOfReferenceUID ?? null,
        secondaryFrameOfReferenceUID: payload.secondaryFrameOfReferenceUID ?? null,
        sliceIndices: payload.sliceIndices ?? [],
      };
      setTransformInfo(info);
      setDebugInfo({
        patientId: patientRecord?.patientID ?? patientRecord?.id ?? null,
        primarySeriesId: selectedPrimaryId,
        secondarySeriesId: selectedSecondaryId,
        ...info,
      });
    } catch (error: any) {
      toast({ title: 'Fusion test failed', description: error?.message || 'Unknown error', variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!patientIdParam) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center">
        <Card className="bg-slate-900/80 border-slate-700/60 p-6">
          <CardContent>
            <p className="text-sm">Patient ID missing. Return to patient manager.</p>
            <Button className="mt-3" onClick={() => navigate('/')}>Back to Patients</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center">
        <div className="flex items-center gap-2 text-slate-300">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading patient data…
        </div>
      </div>
    );
  }

  if (!patientRecord) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center">
        <Card className="bg-slate-900/80 border-slate-700/60 p-6">
          <CardContent>
            <p className="text-sm">Patient {patientIdParam} not found.</p>
            <Button className="mt-3" onClick={() => navigate('/')}>Back to Patients</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="h-screen overflow-y-auto">
      <div className="max-w-6xl mx-auto py-8 px-4 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-white">Fusion Test Harness</h1>
            <p className="text-sm text-slate-400">Patient {patientRecord.patientName} · {patientRecord.patientID}</p>
          </div>
          <Button variant="outline" onClick={() => navigate(`/enhanced-viewer?patientId=${patientRecord.patientID}`)}>
            Return to Viewer
          </Button>
        </div>

        <Card className="bg-slate-900/80 border-slate-700/60">
          <CardHeader className="space-y-2">
            <div className="text-sm text-slate-300">Select fusion inputs</div>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-4">
            <div className="space-y-2">
              <label className="text-xs uppercase tracking-wide text-slate-400">Primary CT Series</label>
              <Select value={selectedPrimaryId ? String(selectedPrimaryId) : undefined} onValueChange={(value) => setSelectedPrimaryId(Number(value))}>
                <SelectTrigger className="bg-slate-950/60 border-slate-700/60">
                  <SelectValue placeholder="Select CT series" />
                </SelectTrigger>
                <SelectContent>
                  {ctSeries.map((s: any) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {s.seriesDescription || `CT ${s.id}`} ({s.imageCount || 0} images)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-xs uppercase tracking-wide text-slate-400">Secondary Series</label>
              <Select value={selectedSecondaryId ? String(selectedSecondaryId) : undefined} onValueChange={(value) => setSelectedSecondaryId(Number(value))}>
                <SelectTrigger className="bg-slate-950/60 border-slate-700/60">
                  <SelectValue placeholder="Select secondary" />
                </SelectTrigger>
                <SelectContent>
                  {secondarySeries.map((s: any) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {s.modality} · {s.seriesDescription || `Series ${s.id}`} ({s.imageCount || 0} images)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-xs uppercase tracking-wide text-slate-400">Slice Indices</label>
              <Input
                value={sliceInput}
                onChange={(event) => setSliceInput(event.target.value)}
                placeholder="e.g. 10,20 or 5-15"
                className="bg-slate-950/60 border-slate-700/60"
              />
              <p className="text-[10px] text-slate-500">Leave blank for middle slice.</p>
            </div>
            <div className="flex items-end">
              <Button className="w-full" onClick={handleGenerate} disabled={isSubmitting}>
                {isSubmitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCcw className="h-4 w-4 mr-2" />}
                Generate Test
              </Button>
            </div>
          </CardContent>
        </Card>

        {transformInfo && (
          <Card className="bg-slate-900/80 border-slate-700/60 space-y-2">
            <CardContent className="py-3 text-xs text-slate-400 flex flex-wrap gap-4">
              <span><strong>Registration:</strong> {transformInfo.registrationId ?? 'auto-selected'}</span>
              {transformInfo.transformSource && <span><strong>Transform source:</strong> {transformInfo.transformSource}</span>}
              {transformInfo.primaryFrameOfReferenceUID && (
                <span><strong>Primary FoR:</strong> {transformInfo.primaryFrameOfReferenceUID}</span>
              )}
              {transformInfo.secondaryFrameOfReferenceUID && (
                <span><strong>Secondary FoR:</strong> {transformInfo.secondaryFrameOfReferenceUID}</span>
              )}
            </CardContent>
            {debugInfo && (
              <CardContent className="pt-0 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs uppercase tracking-wide text-slate-500">Debug payload</span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs"
                    onClick={() => {
                      try {
                        navigator.clipboard.writeText(JSON.stringify(debugInfo, null, 2));
                        toast({ title: 'Copied', description: 'Fusion debug info copied to clipboard.' });
                      } catch (err: any) {
                        toast({ title: 'Copy failed', description: err?.message || 'Unable to copy debug info', variant: 'destructive' });
                      }
                    }}
                  >
                    Copy
                  </Button>
                </div>
                <pre className="bg-slate-950/70 border border-slate-800/70 rounded-md p-3 text-[11px] text-slate-300 overflow-x-auto">
{JSON.stringify(debugInfo, null, 2)}
                </pre>
                {transformInfo.transformFile && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs uppercase tracking-wide text-slate-500">Transform</span>
                      <Button
                        size="sm"
                        variant="secondary"
                        className="h-7 px-3 text-xs"
                        disabled={isInspecting}
                        onClick={async () => {
                          setIsInspecting(true);
                          setTransformDetails(null);
                          try {
                            const response = await fetch('/api/fusebox/inspect-transform', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ transformFile: transformInfo.transformFile }),
                            });
                            if (!response.ok) {
                              const text = await response.text();
                              throw new Error(text || 'Transform inspection failed');
                            }
                            const details = await response.json();
                            setTransformDetails(details);
                          } catch (error: any) {
                            toast({ title: 'Inspect failed', description: error?.message || 'Unknown error', variant: 'destructive' });
                          } finally {
                            setIsInspecting(false);
                          }
                        }}
                      >
                        {isInspecting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                        Inspect Transform
                      </Button>
                    </div>
                    {transformDetails && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] text-slate-400">Forward/inverse matrices</span>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-xs"
                            onClick={() => {
                              try {
                                navigator.clipboard.writeText(JSON.stringify(transformDetails, null, 2));
                                toast({ title: 'Copied', description: 'Transform details copied.' });
                              } catch (err: any) {
                                toast({ title: 'Copy failed', description: err?.message || 'Unable to copy transform details', variant: 'destructive' });
                              }
                            }}
                          >
                            Copy
                          </Button>
                        </div>
                        <pre className="bg-slate-950/70 border border-slate-800/70 rounded-md p-3 text-[11px] text-slate-300 overflow-x-auto">
{JSON.stringify(transformDetails, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            )}
          </Card>
        )}

        <Card className="bg-slate-900/80 border-slate-700/60">
          <CardHeader className="py-3 flex justify-between items-center">
            <span className="text-xs uppercase tracking-wide text-slate-500">Helper logs</span>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-3 text-xs"
              onClick={async () => {
                try {
                  const params = new URLSearchParams({ source: 'fusebox', limit: '200' });
                  const response = await fetch(`/api/debug/events?${params.toString()}`);
                  if (!response.ok) {
                    const text = await response.text();
                    throw new Error(text || 'Failed to load logs');
                  }
                  const data = await response.json();
                  setHelperLogs(data.events || data.logs || []);
                } catch (error: any) {
                  toast({ title: 'Log fetch failed', description: error?.message || 'Unknown error', variant: 'destructive' });
                }
              }}
            >
              Refresh
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {helperLogs.length === 0 ? (
              <div className="text-[11px] text-slate-500">No helper logs captured yet.</div>
            ) : (
              <>
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-3 text-xs"
                    onClick={() => {
                      try {
                        navigator.clipboard.writeText(JSON.stringify(helperLogs, null, 2));
                        toast({ title: 'Copied', description: 'Helper logs copied to clipboard.' });
                      } catch (err: any) {
                        toast({ title: 'Copy failed', description: err?.message || 'Unable to copy logs', variant: 'destructive' });
                      }
                    }}
                  >
                    Copy
                  </Button>
                </div>
                <pre className="bg-slate-950/70 border border-slate-800/70 rounded-md p-3 text-[11px] text-slate-300 overflow-y-auto max-h-64">
{JSON.stringify(helperLogs, null, 2)}
                </pre>
              </>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          {results.length === 0 && !isSubmitting && (
            <div className="text-sm text-slate-500">Select series and generate to view comparison canvases.</div>
          )}
          {results.map((slice) => (
            <SlicePreview key={slice.sliceIndex} slice={slice} secondaryModality={slice.secondary?.modality ?? null} />
          ))}
        </div>
      </div>
      </div>
    </div>
  );
};

export default FusionTestPage;
