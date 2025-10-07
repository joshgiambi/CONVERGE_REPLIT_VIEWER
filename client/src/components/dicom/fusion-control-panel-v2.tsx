import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Zap, Loader2, ChevronDown, ChevronUp, SplitSquareHorizontal, Layers2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FusionSecondaryDescriptor } from '@/types/fusion';
import { useToast } from '@/hooks/use-toast';

interface FusionControlPanelV2Props {
  opacity: number;
  onOpacityChange: (opacity: number) => void;
  secondaryOptions: FusionSecondaryDescriptor[];
  selectedSecondaryId: number | null;
  onSecondarySeriesSelect: (seriesId: number | null) => void;
  secondaryStatuses: Map<number, { status: 'idle' | 'loading' | 'ready' | 'error'; error?: string | null }>;
  manifestLoading?: boolean;
  manifestError?: string | null;
  windowLevel?: { window: number; level: number } | null;
  onWindowLevelPreset?: (preset: { window: number; level: number } | null) => void;
  displayMode?: 'overlay' | 'side-by-side';
  onDisplayModeChange?: (mode: 'overlay' | 'side-by-side') => void;
  primarySeriesId?: number | null;
}

export function FusionControlPanelV2({
  opacity,
  onOpacityChange,
  secondaryOptions,
  selectedSecondaryId,
  onSecondarySeriesSelect,
  secondaryStatuses,
  manifestLoading,
  manifestError,
  windowLevel,
  onWindowLevelPreset,
  displayMode = 'overlay',
  onDisplayModeChange,
  primarySeriesId,
}: FusionControlPanelV2Props) {
  const [isExpanded, setIsExpanded] = useState(false);
  const { toast } = useToast();

  const activeDescriptor = useMemo(() => {
    return secondaryOptions.find((sec) => sec.secondarySeriesId === selectedSecondaryId) ?? null;
  }, [secondaryOptions, selectedSecondaryId]);

  const manifestPreset = useMemo(() => {
    const center = activeDescriptor?.windowCenter?.[0];
    const width = activeDescriptor?.windowWidth?.[0];
    if (!Number.isFinite(center) || !Number.isFinite(width)) return null;
    return { label: 'Auto', window: width, level: center };
  }, [activeDescriptor?.windowCenter, activeDescriptor?.windowWidth]);

  const modalityPresets = useMemo(() => {
    const modality = (activeDescriptor?.secondaryModality || '').toUpperCase();
    const presetsByModality: Record<string, Array<{ label: string; window: number; level: number }>> = {
      MR: [
        { label: 'Brain', window: 80, level: 40 },
        { label: 'Spine', window: 250, level: 50 },
        { label: 'T2', window: 160, level: 80 },
      ],
      CT: [
        { label: 'Tissue', window: 400, level: 40 },
        { label: 'Lung', window: 1500, level: -600 },
        { label: 'Bone', window: 2000, level: 300 },
      ],
      PT: [],
      PET: [],
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

  const getModalityColor = (modality: string) => {
    const mod = modality?.toUpperCase() || '';
    if (mod === 'PT' || mod === 'PET') return 'yellow';
    if (mod === 'MR') return 'purple';
    if (mod === 'CT') return 'blue';
    return 'slate';
  };

  const getModalityStyles = (modality: string, isActive: boolean = false) => {
    const color = getModalityColor(modality);
    const colorMap = {
      yellow: isActive 
        ? 'bg-yellow-600/90 border-yellow-500 text-yellow-50' 
        : 'bg-yellow-900/40 border-yellow-600/40 text-yellow-200 hover:bg-yellow-800/50',
      purple: isActive
        ? 'bg-purple-600/90 border-purple-500 text-purple-50'
        : 'bg-purple-900/40 border-purple-600/40 text-purple-200 hover:bg-purple-800/50',
      blue: isActive
        ? 'bg-blue-600/90 border-blue-500 text-blue-50'
        : 'bg-blue-900/40 border-blue-600/40 text-blue-200 hover:bg-blue-800/50',
      slate: isActive
        ? 'bg-slate-600/90 border-slate-500 text-slate-50'
        : 'bg-slate-800/40 border-slate-600/40 text-slate-200 hover:bg-slate-700/50',
    };
    return colorMap[color as keyof typeof colorMap];
  };

  const handleExport = async () => {
    try {
      const active = activeDescriptor;
      if (!active) {
        toast({ title: 'Select overlay', description: 'Choose a fused overlay to export', variant: 'destructive' });
        return;
      }
      if (!primarySeriesId) {
        toast({ title: 'Missing primary', description: 'Select a primary CT series first', variant: 'destructive' });
        return;
      }
      toast({ title: 'Preparing export…', description: `Fused ${active.secondaryModality} → CT` });
      const res = await fetch('/api/fusion/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ primarySeriesId, secondarySeriesId: active.secondarySeriesId }),
      });
      if (!res.ok) {
        const msg = await res.text().catch(() => '');
        throw new Error(msg || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `fused_${primarySeriesId}_${active.secondarySeriesId}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({ title: 'Export ready', description: 'Downloading fused ZIP...' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast({ title: 'Export failed', description: message || 'Could not export fused series', variant: 'destructive' });
    }
  };

  const renderStatusIndicator = (status: { status: string; error?: string | null }) => {
    if (status.status === 'ready') {
      return <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />;
    }
    if (status.status === 'loading') {
      return <Loader2 className="w-3 h-3 animate-spin text-sky-400" />;
    }
    if (status.status === 'error') {
      return <div className="w-2 h-2 rounded-full bg-amber-400" />;
    }
    return null;
  };

  // Show loading state in panel
  if (manifestLoading) {
    return (
      <div className="absolute right-7 top-44 z-40 w-80 rounded-lg border border-slate-700/50 bg-black/80 backdrop-blur-xl shadow-2xl">
        <div className="p-4 flex items-center gap-3">
          <Loader2 className="w-5 h-5 animate-spin text-cyan-400" />
          <div className="flex-1">
            <div className="text-sm font-medium text-slate-200">Initializing Fusion</div>
            <div className="text-xs text-slate-400">Building overlay manifest...</div>
          </div>
        </div>
      </div>
    );
  }

  // Show error state
  if (manifestError) {
    return (
      <div className="absolute right-7 top-44 z-40 w-80 rounded-lg border border-amber-700/50 bg-black/80 backdrop-blur-xl shadow-2xl">
        <div className="p-4">
          <div className="text-sm font-medium text-amber-300 mb-1">Fusion Error</div>
          <div className="text-xs text-amber-200/70">{manifestError}</div>
        </div>
      </div>
    );
  }

  // Don't show panel if no options available
  if (!secondaryOptions.length) {
    return null;
  }

  // Minimized state - compact horizontal layout
  if (!isExpanded) {
    return (
      <div className="absolute right-7 top-44 z-40 rounded-lg border border-slate-700/50 bg-black/80 backdrop-blur-xl shadow-2xl">
        <div className="p-3 space-y-3">
          {/* Header row */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-cyan-400" />
              <span className="text-xs font-semibold text-slate-200">Fusion</span>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-slate-400 hover:text-slate-200"
                onClick={() => onDisplayModeChange?.(displayMode === 'overlay' ? 'side-by-side' : 'overlay')}
                title={displayMode === 'overlay' ? 'Switch to side-by-side' : 'Switch to overlay'}
              >
                {displayMode === 'overlay' ? (
                  <Layers2 className="w-3.5 h-3.5" />
                ) : (
                  <SplitSquareHorizontal className="w-3.5 h-3.5" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-slate-400 hover:text-slate-200"
                onClick={() => setIsExpanded(true)}
              >
                <ChevronDown className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Opacity slider */}
          {displayMode === 'overlay' && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wide text-slate-400">Opacity</span>
                <span className="text-[10px] text-slate-300">{Math.round(opacity * 100)}%</span>
              </div>
              <Slider 
                value={[opacity]} 
                min={0} 
                max={1} 
                step={0.01} 
                onValueChange={handleOpacityChange}
                className="w-full"
              />
            </div>
          )}

          {/* Series tags */}
          <div className="flex flex-wrap gap-1.5">
            {secondaryOptions.map((descriptor) => {
              const status = secondaryStatuses.get(descriptor.secondarySeriesId);
              const isActive = descriptor.secondarySeriesId === selectedSecondaryId;
              const isReady = status?.status === 'ready';
              
              return (
                <button
                  key={descriptor.secondarySeriesId}
                  onClick={() => isReady ? onSecondarySeriesSelect(isActive ? null : descriptor.secondarySeriesId) : null}
                  disabled={!isReady}
                  className={cn(
                    'flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs font-medium transition-all',
                    getModalityStyles(descriptor.secondaryModality, isActive),
                    !isReady && 'opacity-50 cursor-not-allowed'
                  )}
                >
                  {status && renderStatusIndicator(status)}
                  <span>{descriptor.secondaryModality}</span>
                  <span className="opacity-70">#{descriptor.secondarySeriesId}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // Expanded state - full details
  return (
    <div className="absolute right-7 top-44 z-40 w-96 rounded-lg border border-slate-700/50 bg-black/80 backdrop-blur-xl shadow-2xl max-h-[calc(100vh-12rem)] overflow-y-auto">
      <div className="p-4 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-cyan-400" />
            <span className="text-sm font-semibold text-slate-100">Fusion Control</span>
            <Badge variant="outline" className="bg-slate-800/60 border-slate-600/50 text-[10px] text-slate-300">
              {secondaryOptions.length} available
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={handleExport}
              disabled={!activeDescriptor || !primarySeriesId}
              className="h-7 text-[10px] px-2"
            >
              Export
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-slate-400 hover:text-slate-200"
              onClick={() => setIsExpanded(false)}
            >
              <ChevronUp className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Display mode toggle */}
        <div className="flex items-center gap-2 p-2 bg-gray-800/40 rounded-lg backdrop-blur-sm">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onDisplayModeChange?.('overlay')}
            className={cn(
              'flex-1 h-8 text-xs transition-all duration-200 rounded-lg',
              displayMode === 'overlay' 
                ? 'bg-blue-600/80 hover:bg-blue-700/80 text-white border border-blue-500/50 shadow-sm' 
                : 'text-gray-300 hover:bg-gray-700/50 hover:text-white'
            )}
          >
            <Layers2 className="w-3.5 h-3.5 mr-1" />
            Overlay
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onDisplayModeChange?.('side-by-side')}
            className={cn(
              'flex-1 h-8 text-xs transition-all duration-200 rounded-lg',
              displayMode === 'side-by-side' 
                ? 'bg-blue-600/80 hover:bg-blue-700/80 text-white border border-blue-500/50 shadow-sm' 
                : 'text-gray-300 hover:bg-gray-700/50 hover:text-white'
            )}
          >
            <SplitSquareHorizontal className="w-3.5 h-3.5 mr-1" />
            Side-by-Side
          </Button>
        </div>

        {/* Opacity slider (only in overlay mode) */}
        {displayMode === 'overlay' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-300">Overlay Opacity</span>
              <span className="text-xs text-slate-400">{Math.round(opacity * 100)}%</span>
            </div>
            <Slider 
              value={[opacity]} 
              min={0} 
              max={1} 
              step={0.01} 
              onValueChange={handleOpacityChange}
            />
          </div>
        )}

        {/* Secondary series list */}
        <div className="space-y-2">
          <div className="text-xs font-medium text-slate-300">Available Overlays</div>
          <div className="space-y-1.5">
            {secondaryOptions.map((descriptor) => {
              const status = secondaryStatuses.get(descriptor.secondarySeriesId);
              const isActive = descriptor.secondarySeriesId === selectedSecondaryId;
              const isReady = status?.status === 'ready';
              const isLoading = status?.status === 'loading';

              return (
                <button
                  key={descriptor.secondarySeriesId}
                  onClick={() => isReady ? onSecondarySeriesSelect(isActive ? null : descriptor.secondarySeriesId) : null}
                  disabled={!isReady}
                  className={cn(
                    'w-full p-2.5 rounded-md border text-left transition-all',
                    getModalityStyles(descriptor.secondaryModality, isActive),
                    !isReady && 'opacity-60 cursor-not-allowed'
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-semibold">{descriptor.secondaryModality}</span>
                        <span className="text-[10px] opacity-70">Series {descriptor.secondarySeriesId}</span>
                        {status && renderStatusIndicator(status)}
                      </div>
                      <div className="text-[10px] opacity-80 truncate">
                        {descriptor.secondarySeriesDescription || 'Unnamed series'}
                      </div>
                      <div className="text-[10px] opacity-60 mt-0.5">
                        {descriptor.sliceCount} slices
                      </div>
                    </div>
                  </div>
                  {isLoading && (
                    <div className="mt-1.5 h-1 bg-slate-800/50 rounded-full overflow-hidden">
                      <div className="h-full bg-cyan-500/50 animate-pulse" style={{ width: '60%' }} />
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Window/Level presets (only when active and has presets) */}
        {activeDescriptor && modalityPresets.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-medium text-slate-300">Window / Level</div>
            <div className="flex flex-wrap gap-1.5">
              {modalityPresets.map((preset) => {
                const isActive = windowLevel && 
                  Math.abs(windowLevel.window - preset.window) < 1e-3 && 
                  Math.abs(windowLevel.level - preset.level) < 1e-3;
                return (
                  <Button
                    key={`${preset.label}-${preset.window}-${preset.level}`}
                    size="sm"
                    variant="ghost"
                    className={cn(
                      'h-7 text-[10px] px-2 transition-all duration-200 rounded-md',
                      isActive 
                        ? 'bg-blue-600/80 hover:bg-blue-700/80 text-white border border-blue-500/50' 
                        : 'bg-gray-800/40 hover:bg-gray-700/50 text-gray-300 hover:text-white border border-gray-600/30'
                    )}
                    onClick={() => onWindowLevelPreset?.({ window: preset.window, level: preset.level })}
                  >
                    {preset.label}
                  </Button>
                );
              })}
              <Button
                size="sm"
                variant="ghost"
                className={cn(
                  'h-7 text-[10px] px-2 transition-all duration-200 rounded-md',
                  !windowLevel 
                    ? 'bg-blue-600/80 hover:bg-blue-700/80 text-white border border-blue-500/50' 
                    : 'bg-gray-800/40 hover:bg-gray-700/50 text-gray-300 hover:text-white border border-gray-600/30'
                )}
                onClick={() => onWindowLevelPreset?.(null)}
              >
                Auto
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

