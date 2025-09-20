import { useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Layers, Loader2, AlertTriangle, Maximize2, Minimize2, Eye, EyeOff, Activity, Palette } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FusionSecondaryDescriptor } from '@/types/fusion';

interface FusionControlPanelProps {
  opacity: number;
  onOpacityChange: (opacity: number) => void;
  secondaryOptions: FusionSecondaryDescriptor[];
  selectedSecondaryId: number | null;
  onSecondarySeriesSelect: (seriesId: number | null) => void;
  secondaryStatuses: Map<number, { status: 'idle' | 'loading' | 'ready' | 'error'; error?: string | null }>;
  manifestLoading?: boolean;
  manifestError?: string | null;
  onOpenDebug?: () => void;
  minimized?: boolean;
  onToggleMinimized?: (minimized: boolean) => void;
  windowLevel?: { window: number; level: number } | null;
  onWindowLevelPreset?: (preset: { window: number; level: number } | null) => void;
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
  onOpenDebug,
  minimized = false,
  onToggleMinimized,
  windowLevel,
  onWindowLevelPreset,
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
      <div className="fixed bottom-4 right-6 z-50 flex items-center gap-3 rounded-lg border border-slate-700/40 bg-slate-950/95 px-3 py-2 backdrop-blur shadow-lg shadow-black/40">
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
    <div className="fixed bottom-4 right-6 z-50" style={{ animationName: 'fadeInScale', animationDuration: '300ms', animationTimingFunction: 'ease-out', animationFillMode: 'both' }}>
      <div className="backdrop-blur-md border border-cyan-500/60 rounded-xl px-4 py-3 shadow-2xl bg-gray-900/90 w-[24rem]">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div 
              className="w-4 h-4 rounded border-2 border-white/60 shadow-sm"
              style={{ backgroundColor: '#06b6d4' }}
            />
            <span className="text-white text-sm font-medium">Fusion Overlay</span>
            {manifestLoading && (
              <Badge variant="outline" className="bg-cyan-900/40 border-cyan-400/60 text-cyan-200 flex items-center gap-1 backdrop-blur-sm shadow-sm">
                <Loader2 className="h-3 w-3 animate-spin" /> Preparing
              </Badge>
            )}
            {manifestError && (
              <Badge variant="outline" className="bg-red-900/40 border-red-400/60 text-red-200 backdrop-blur-sm shadow-sm">
                <AlertTriangle className="h-3 w-3 mr-1" />
                Error
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            {onOpenDebug && (
              <Button 
                variant="outline" 
                size="sm" 
                onClick={onOpenDebug} 
                className="h-7 px-2 bg-orange-900/30 border-2 border-orange-400/60 text-orange-200 hover:text-orange-100 hover:bg-orange-800/40 rounded-lg backdrop-blur-sm shadow-sm"
              >
                <AlertTriangle className="w-3 h-3 mr-1" />
                <span className="text-xs font-medium">Debug</span>
              </Button>
            )}
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={() => onToggleMinimized?.(true)} 
              className="h-7 w-7 p-0 text-white/70 hover:text-white hover:bg-white/20 rounded-lg backdrop-blur-sm shadow-sm"
            >
              <Minimize2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="space-y-3">
          {manifestError && (
            <div className="rounded-lg border border-red-400/60 bg-red-900/30 px-3 py-2 text-sm text-red-200 backdrop-blur-sm shadow-sm">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                <span className="font-medium">Fusion Error</span>
              </div>
              <div className="mt-1 text-xs text-red-200/80">{manifestError}</div>
            </div>
          )}

          <div>
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Eye className="h-4 w-4 text-cyan-300" />
                <span className="text-sm font-medium text-white">Overlay Series</span>
              </div>
              <Badge variant="outline" className="bg-purple-900/40 border-purple-400/60 text-purple-200 backdrop-blur-sm shadow-sm text-xs">
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
                const modalityColor = (() => {
                  const modality = (descriptor.secondaryModality || '').toUpperCase();
                  switch (modality) {
                    case 'PT':
                    case 'PET':
                      return { bg: 'bg-yellow-900/30', border: 'border-yellow-400/60', text: 'text-yellow-200', hover: 'hover:bg-yellow-800/40' };
                    case 'MR':
                      return { bg: 'bg-purple-900/30', border: 'border-purple-400/60', text: 'text-purple-200', hover: 'hover:bg-purple-800/40' };
                    case 'CT':
                      return { bg: 'bg-blue-900/30', border: 'border-blue-400/60', text: 'text-blue-200', hover: 'hover:bg-blue-800/40' };
                    default:
                      return { bg: 'bg-cyan-900/30', border: 'border-cyan-400/60', text: 'text-cyan-200', hover: 'hover:bg-cyan-800/40' };
                  }
                })();

                return (
                  <Button
                    key={descriptor.secondarySeriesId}
                    variant="outline"
                    className={cn(
                      'w-full justify-between text-left h-auto p-3 rounded-lg backdrop-blur-sm shadow-sm border-2 transition-all duration-200',
                      isActive
                        ? `${modalityColor.bg} ${modalityColor.border} ${modalityColor.text} hover:text-white ${modalityColor.hover} shadow-lg`
                        : isDisabled
                          ? 'bg-gray-800/30 border-gray-600/40 text-gray-500 cursor-not-allowed'
                          : `bg-white/10 border-white/30 text-white hover:text-white hover:bg-white/20 hover:shadow-lg`,
                    )}
                    onClick={handleClick}
                    disabled={isDisabled}
                    title={disableBecause ?? undefined}
                  >
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        "w-3 h-3 rounded border border-white/60 shadow-sm",
                      )} style={{ backgroundColor: isActive ? (modalityColor.text === 'text-yellow-200' ? '#fbbf24' : modalityColor.text === 'text-purple-200' ? '#a855f7' : modalityColor.text === 'text-blue-200' ? '#3b82f6' : '#06b6d4') : '#6b7280' }} />
                      <div className="flex flex-col">
                        <span className="font-semibold text-sm">
                          {descriptor.secondaryModality ?? 'Overlay'} · {descriptor.secondarySeriesId}
                        </span>
                        <span className="text-xs opacity-80 line-clamp-1">
                          {descriptor.secondarySeriesDescription || 'Unnamed series'}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {renderStatusBadge(descriptor.secondarySeriesId)}
                      {status?.status === 'loading' && <Loader2 className="h-4 w-4 animate-spin text-cyan-300" />}
                    </div>
                  </Button>
                );
              })}
              {!secondaryOptions.length && !manifestLoading && (
                <div className="rounded-lg border border-gray-400/40 bg-gray-800/30 px-3 py-2 text-sm text-gray-300 backdrop-blur-sm shadow-sm">
                  <div className="flex items-center gap-2">
                    <EyeOff className="h-4 w-4 text-gray-400" />
                    <span className="font-medium">No Overlay Available</span>
                  </div>
                  <div className="mt-1 text-xs text-gray-400">No registered secondary overlays found for this primary series.</div>
                </div>
              )}
            </div>
            {activeDescriptor && (
              <div className="mt-3 rounded-lg border border-white/20 bg-white/5 px-3 py-3 backdrop-blur-sm shadow-sm">
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Layers className="h-4 w-4 text-cyan-300" />
                    <span className="text-sm font-medium text-white">Active Overlay</span>
                  </div>
                  {secondaryStatuses.get(activeDescriptor.secondarySeriesId)?.status === 'ready' ? (
                    <Badge variant="outline" className="bg-emerald-900/40 border-emerald-400/60 text-emerald-200 backdrop-blur-sm shadow-sm">
                      Ready
                    </Badge>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-lg bg-cyan-900/40 border border-cyan-400/60 px-2 py-1 font-semibold text-cyan-200 text-xs backdrop-blur-sm shadow-sm">
                    {activeDescriptor.secondaryModality ?? 'Overlay'}
                  </span>
                  <span className="rounded-lg bg-purple-900/40 border border-purple-400/60 px-2 py-1 text-purple-200 text-xs backdrop-blur-sm shadow-sm">
                    Series {activeDescriptor.secondarySeriesId}
                  </span>
                  <span className="rounded-lg bg-green-900/40 border border-green-400/60 px-2 py-1 text-green-200 text-xs backdrop-blur-sm shadow-sm">
                    {activeDescriptor.sliceCount} slices
                  </span>
                  {activeDescriptor.registrationId && (
                    <span className="rounded-lg bg-orange-900/40 border border-orange-400/60 px-2 py-1 text-orange-200 text-xs backdrop-blur-sm shadow-sm">
                      Reg {activeDescriptor.registrationId}
                    </span>
                  )}
                </div>
                {activeDescriptor.secondarySeriesDescription && (
                  <div className="mt-2 p-2 rounded bg-white/5 border border-white/10 backdrop-blur-sm">
                    <div className="text-xs text-white/80 line-clamp-2 leading-relaxed">
                      {activeDescriptor.secondarySeriesDescription}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {!manifestLoading && secondaryOptions.length > 0 && secondaryOptions.every((descriptor) => secondaryStatuses.get(descriptor.secondarySeriesId)?.status !== 'ready') && (
            <div className="rounded-lg border border-blue-400/40 bg-blue-900/30 px-3 py-2 text-sm text-blue-200 backdrop-blur-sm shadow-sm">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="font-medium">Processing Overlays</span>
              </div>
              <div className="mt-1 text-xs text-blue-200/80">All overlays are still generating. They will enable automatically once the helper cache finishes.</div>
            </div>
          )}

          {modalityPresets.length > 0 && (
            <div>
              <div className="mb-3 flex items-center gap-2">
                <div className="w-px h-4 bg-white/30" />
                <span className="text-sm font-medium text-white">Window / Level Presets</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {modalityPresets.map((preset) => {
                  const isActive = windowLevel && Math.abs(windowLevel.window - preset.window) < 1e-3 && Math.abs(windowLevel.level - preset.level) < 1e-3;
                  return (
                    <Button
                      key={`${preset.label}-${preset.window}-${preset.level}`}
                      variant="outline"
                      size="sm"
                      className={cn(
                        'h-8 text-xs rounded-lg backdrop-blur-sm shadow-sm border-2 transition-all duration-200',
                        isActive 
                          ? 'bg-indigo-900/30 border-indigo-400/60 text-indigo-200 hover:text-white hover:bg-indigo-800/40'
                          : 'bg-white/10 border-white/30 text-white hover:text-white hover:bg-white/20'
                      )}
                      onClick={() => onWindowLevelPreset?.({ window: preset.window, level: preset.level })}
                    >
                      <span className="font-medium">{preset.label}</span>
                    </Button>
                  );
                })}
                <Button
                  variant="outline"
                  size="sm"
                  className={cn(
                    'h-8 text-xs rounded-lg backdrop-blur-sm shadow-sm border-2 transition-all duration-200',
                    !windowLevel 
                      ? 'bg-green-900/30 border-green-400/60 text-green-200 hover:text-white hover:bg-green-800/40'
                      : 'bg-white/10 border-white/30 text-white hover:text-white hover:bg-white/20'
                  )}
                  onClick={() => onWindowLevelPreset?.(null)}
                >
                  <span className="font-medium">Auto</span>
                </Button>
              </div>
            </div>
          )}

          <div>
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-px h-4 bg-white/30" />
                <span className="text-sm font-medium text-white">Overlay Opacity</span>
              </div>
              <Badge variant="outline" className="bg-cyan-900/40 border-cyan-400/60 text-cyan-200 backdrop-blur-sm shadow-sm text-xs">
                {Math.round(opacity * 100)}%
              </Badge>
            </div>
            <div className="px-1">
              <Slider 
                value={[opacity]} 
                min={0} 
                max={1} 
                step={0.01} 
                onValueChange={handleOpacityChange}
                className="[&_[role=slider]]:bg-cyan-400 [&_[role=slider]]:border-2 [&_[role=slider]]:border-white/60 [&_[role=slider]]:shadow-lg [&_[role=slider]]:backdrop-blur-sm"
              />
            </div>
            <div className="mt-2 flex justify-between text-xs text-white/60">
              <span>Transparent</span>
              <span>Opaque</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
