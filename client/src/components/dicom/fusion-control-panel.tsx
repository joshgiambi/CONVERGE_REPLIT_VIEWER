import { useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Layers, Loader2, Maximize2, Minimize2 } from 'lucide-react';
import type { FusionSecondaryDescriptor } from '@/types/fusion';

const cn = (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ');

interface FusionControlPanelProps {
  opacity: number;
  onOpacityChange: (opacity: number) => void;
  secondaryOptions: FusionSecondaryDescriptor[];
  selectedSecondaryId: number | null;
  onSecondarySeriesSelect: (seriesId: number | null) => void;
  secondaryStatuses: Map<number, { status: 'idle' | 'loading' | 'ready' | 'error'; error?: string | null }>;
  manifestLoading?: boolean;
  manifestError?: string | null;
  minimized?: boolean;
  onToggleMinimized?: (minimized: boolean) => void;
  windowLevel?: { window: number; level: number } | null;
  onWindowLevelPreset?: (preset: { window: number; level: number } | null) => void;
  // NEW: registration integration
  registrationOptions?: Array<{ id: string | null; label: string }>;
  selectedRegistrationId?: string | null;
  onRegistrationSelect?: (id: string | null) => void;
}

export function FusionControlPanel({
  opacity,
  onOpacityChange,
  secondaryOptions,
  selectedSecondaryId,
  onSecondarySeriesSelect,
  secondaryStatuses,
  manifestLoading,
  manifestError,
  minimized = false,
  onToggleMinimized,
  windowLevel,
  onWindowLevelPreset,
  registrationOptions = [],
  selectedRegistrationId = null,
  onRegistrationSelect,
}: FusionControlPanelProps) {
  const activeDescriptor = useMemo(() => {
    return secondaryOptions.find((sec) => sec.secondarySeriesId === selectedSecondaryId) ?? null;
  }, [secondaryOptions, selectedSecondaryId]);

  const manifestPreset = useMemo(() => {
    const center = activeDescriptor?.windowCenter?.[0];
    const width = activeDescriptor?.windowWidth?.[0];
    if (!Number.isFinite(center) || !Number.isFinite(width)) return null;
    return { label: 'Manifest', window: width, level: center };
  }, [activeDescriptor?.windowCenter, activeDescriptor?.windowWidth]);

  const modalityPresets = useMemo(() => {
    const modality = (activeDescriptor?.secondaryModality || '').toUpperCase();
    const presetsByModality: Record<string, Array<{ label: string; window: number; level: number }>> = {
      MR: [
        { label: 'Brain', window: 80, level: 40 },
        { label: 'Spine', window: 250, level: 50 },
        { label: 'T2 Tissue', window: 160, level: 80 },
      ],
      CT: [
        { label: 'Soft Tissue', window: 400, level: 40 },
        { label: 'Lung', window: 1500, level: -600 },
        { label: 'Bone', window: 2000, level: 300 },
      ],
      PT: [
        { label: 'SUV 0-5', window: 5, level: 2.5 },
        { label: 'Tumor', window: 4, level: 2 },
        { label: 'Low Dose', window: 3, level: 1.5 },
      ],
      PET: [
        { label: 'SUV 0-5', window: 5, level: 2.5 },
        { label: 'Tumor', window: 4, level: 2 },
        { label: 'Low Dose', window: 3, level: 1.5 },
      ],
    };
    const base = presetsByModality[modality] ?? [];
    if (manifestPreset) {
      return [manifestPreset, ...base];
    }
    return base;
  }, [activeDescriptor?.secondaryModality, manifestPreset]);

  const handleOpacityChange = (values: number[]) => {
    const next = values[0];
    if (typeof next === 'number' && !Number.isNaN(next)) {
      onOpacityChange(Math.max(0, Math.min(1, next)));
    }
  };

  const renderStatusBadge = (secondaryId: number) => {
    const status = secondaryStatuses.get(secondaryId);
    if (!status) return null;
    if (status.status === 'ready') {
      return <Badge variant="outline" className="bg-emerald-900/40 border-emerald-700/50 text-emerald-200">Ready</Badge>;
    }
    if (status.status === 'loading') {
      return (
        <Badge variant="outline" className="bg-sky-900/40 border-sky-700/50 text-sky-200 flex items-center gap-1">
          <Loader2 className="h-3 w-3 animate-spin" /> Building
        </Badge>
      );
    }
    if (status.status === 'error') {
      return <Badge variant="outline" className="bg-amber-900/40 border-amber-700/50 text-amber-200">Error</Badge>;
    }
    return null;
  };

  if (minimized) {
    return (
      <div className="fixed bottom-4 right-6 z-50 flex items-center gap-3 rounded-xl border border-slate-700/40 bg-black/60 px-3 py-2 backdrop-blur">
        <Badge variant="outline" className="bg-slate-900/80 text-slate-200 border-slate-600/50">
          Fusion
        </Badge>
        <div className="w-32">
          <Slider value={[opacity]} min={0} max={1} step={0.01} onValueChange={handleOpacityChange} />
        </div>
        {activeDescriptor ? (
          <span className="text-xs text-slate-200">
            {activeDescriptor.secondaryModality ?? 'Overlay'} · {activeDescriptor.secondarySeriesDescription ?? `Series ${activeDescriptor.secondarySeriesId}`}
          </span>
        ) : (
          <span className="text-xs text-slate-300 opacity-70">No overlay</span>
        )}
        <Button variant="ghost" size="icon" onClick={() => onToggleMinimized?.(false)} className="h-8 w-8 text-slate-200">
          <Maximize2 className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className="fixed bottom-4 right-6 z-50">
      <Card className="w-[22rem] bg-slate-900/80 backdrop-blur border border-slate-700/60 shadow-lg shadow-black/40">
        <div className="flex items-center justify-between border-b border-slate-700/60 px-4 py-3">
          <div className="flex items-center gap-2 text-slate-100">
            <Layers className="h-4 w-4 text-cyan-300" />
            <span className="text-sm font-semibold">Fusion Overlay</span>
            {manifestLoading && (
              <Badge variant="outline" className="bg-sky-900/40 border-sky-700/50 text-sky-200 flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" /> Preparing
              </Badge>
            )}
            {manifestError && (
              <Badge variant="outline" className="bg-amber-900/40 border-amber-700/50 text-amber-200">
                Error
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={() => onToggleMinimized?.(true)} className="h-8 w-8 text-slate-200">
              <Minimize2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="space-y-4 px-4 py-4 text-slate-100">
          {manifestError && (
            <div className="rounded-md border border-amber-700/60 bg-amber-900/30 px-3 py-2 text-sm text-amber-200">
              {manifestError}
            </div>
          )}

          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs uppercase tracking-wide text-slate-400">Overlay Series</span>
              <Badge variant="outline" className="bg-slate-800/60 border-slate-600/50 text-[10px] text-slate-300">
                {secondaryOptions.length} available
              </Badge>
            </div>
            <div className="space-y-2">
              {secondaryOptions.map((descriptor) => {
                const status = secondaryStatuses.get(descriptor.secondarySeriesId);
                const isActive = descriptor.secondarySeriesId === selectedSecondaryId;
                const isReady = status?.status === 'ready';
                const disableBecause = (() => {
                  if (manifestLoading && !isActive) return 'Fusion cache is still preparing';
                  if (!isReady) {
                    if (status?.status === 'loading') return 'Overlay is still generating';
                    if (status?.status === 'error') return status.error || 'Fusion run failed';
                    return 'Overlay not ready yet';
                  }
                  return null;
                })();
                const isDisabled = Boolean(disableBecause) && !isActive;
                const handleClick = () => {
                  if (isDisabled && !isActive) return;
                  onSecondarySeriesSelect(isActive ? null : descriptor.secondarySeriesId);
                };
                return (
                  <Button
                    key={descriptor.secondarySeriesId}
                    variant={isActive ? 'default' : 'secondary'}
                    className={cn(
                      'w-full justify-between text-left text-xs',
                      isActive
                        ? 'bg-cyan-600/70 hover:bg-cyan-600 text-slate-900'
                        : isDisabled
                          ? 'bg-slate-800/50 text-slate-400 cursor-not-allowed'
                          : 'bg-slate-800/70 hover:bg-slate-700 text-slate-200',
                    )}
                    onClick={handleClick}
                    disabled={isDisabled}
                    title={disableBecause ?? undefined}
                  >
                    <div className="flex flex-col">
                      <span className="font-semibold">
                        {descriptor.secondaryModality ?? 'Overlay'} · {descriptor.secondarySeriesId}
                      </span>
                      <span className="text-[10px] opacity-70 line-clamp-1">
                        {descriptor.secondarySeriesDescription || 'Unnamed series'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {renderStatusBadge(descriptor.secondarySeriesId)}
                      {status?.status === 'loading' && <Loader2 className="h-4 w-4 animate-spin text-cyan-200" />}
                      {isDisabled && status?.status === 'error' && status?.error && (
                        <span className="text-[10px] text-amber-200/80">{status.error}</span>
                      )}
                    </div>
                  </Button>
                );
              })}
              {!secondaryOptions.length && !manifestLoading && (
                <div className="rounded-md border border-slate-700/60 bg-slate-900/50 px-3 py-2 text-xs text-slate-300">
                  No registered secondary overlays found for this primary series.
                </div>
              )}
            </div>
            {activeDescriptor && (
              <div className="mt-3 rounded-md border border-slate-700/60 bg-slate-900/40 px-3 py-2 text-[11px] text-slate-300">
                <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wide text-slate-500">
                  <span>Active Overlay Details</span>
                  {secondaryStatuses.get(activeDescriptor.secondarySeriesId)?.status === 'ready' ? (
                    <span className="text-emerald-300">Ready</span>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <span className="rounded bg-slate-800/70 px-2 py-1 font-semibold text-slate-100">
                    {activeDescriptor.secondaryModality ?? 'Overlay'}
                  </span>
                  <span className="rounded bg-slate-800/70 px-2 py-1">Series {activeDescriptor.secondarySeriesId}</span>
                  <span className="rounded bg-slate-800/70 px-2 py-1">{activeDescriptor.sliceCount} slices</span>
                  {activeDescriptor.registrationId && (
                    <span className="rounded bg-slate-800/70 px-2 py-1">Reg {activeDescriptor.registrationId}</span>
                  )}
                </div>
                {activeDescriptor.secondarySeriesDescription && (
                  <div className="mt-2 line-clamp-2 text-[10px] text-slate-400">
                    {activeDescriptor.secondarySeriesDescription}
                  </div>
                )}
              </div>
            )}
          </div>

          {!manifestLoading && secondaryOptions.length > 0 && secondaryOptions.every((descriptor) => secondaryStatuses.get(descriptor.secondarySeriesId)?.status !== 'ready') && (
            <div className="rounded-md border border-slate-700/60 bg-slate-900/40 px-3 py-2 text-[11px] text-slate-300">
              All overlays are still generating. They will enable automatically once the helper cache finishes.
            </div>
          )}

          {modalityPresets.length > 0 && (
            <div>
              <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Window / Level Presets</div>
              <div className="flex flex-wrap gap-2">
                {modalityPresets.map((preset) => {
                  const isActive = windowLevel && Math.abs(windowLevel.window - preset.window) < 1e-3 && Math.abs(windowLevel.level - preset.level) < 1e-3;
                  return (
                    <Button
                      key={`${preset.label}-${preset.window}-${preset.level}`}
                      size="sm"
                      variant={isActive ? 'default' : 'secondary'}
                      className={cn('text-xs', isActive ? 'bg-cyan-600/70 hover:bg-cyan-600 text-slate-900' : 'bg-slate-800/70 hover:bg-slate-700 text-slate-200')}
                      onClick={() => onWindowLevelPreset?.({ window: preset.window, level: preset.level })}
                    >
                      {preset.label}
                    </Button>
                  );
                })}
                <Button
                  size="sm"
                  variant={windowLevel ? 'secondary' : 'default'}
                  className="text-xs"
                  onClick={() => onWindowLevelPreset?.(null)}
                >
                  Auto
                </Button>
              </div>
            </div>
          )}

          {activeDescriptor && registrationOptions.length > 0 && (
            <div>
              <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Registration</div>
              <div className="grid gap-2">
                {registrationOptions.map((opt) => {
                  const isActive = (opt.id ?? null) === (selectedRegistrationId ?? null);
                  return (
                    <Button
                      key={opt.id ?? 'default'}
                      size="sm"
                      variant={isActive ? 'default' : 'secondary'}
                      className={cn('justify-start text-xs', isActive ? 'bg-cyan-600/70 hover:bg-cyan-600 text-slate-900' : 'bg-slate-800/70 hover:bg-slate-700 text-slate-200')}
                      onClick={() => onRegistrationSelect?.(opt.id ?? null)}
                    >
                      {opt.label}
                    </Button>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-wide text-slate-400">
              <span>Overlay Opacity</span>
              <span className="text-slate-200">{Math.round(opacity * 100)}%</span>
            </div>
            <Slider value={[opacity]} min={0} max={1} step={0.01} onValueChange={handleOpacityChange} />
          </div>
        </div>
      </Card>
    </div>
  );
}
