import React, { useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Layers, Maximize2, Minimize2, Brain, AlertTriangle } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

interface FusionControlPanelProps {
  primarySeriesId: number;
  studyId: number;
  onSecondarySeriesSelect: (seriesId: number | null) => void;
  opacity: number;
  onOpacityChange: (opacity: number) => void;
  isVisible: boolean;
  mriWindowLevel?: { width: number; center: number };
  onMriWindowLevelChange?: (windowLevel: { width: number; center: number }) => void;
  selectedSecondaryId?: number | null;
  onOpenDebug?: () => void;
  secondaryModality?: string;
  allowedSecondaryIds?: number[];
  transformSource?: 'helper-generated' | 'helper-cache' | null;
  availableSeries?: SeriesItem[];
  registrationOptions?: Array<{ id: string | null; label: string; relationship: 'registered' | 'shared-frame' }>;
  selectedRegistrationId?: string | null;
  onRegistrationSelect?: (id: string | null) => void;
}

type SeriesItem = {
  id: number;
  modality: string;
  seriesDescription?: string;
  imageCount?: number;
};

const imagingModalities = new Set(['MR', 'PT', 'PET', 'CT', 'NM', 'US', 'XA']);
const excludedModalities = new Set(['RTSTRUCT', 'REG', 'PLAN', 'RTPLAN', 'RTDOSE', 'RTIMAGE', 'PR', 'KO', 'SR']);

export function FusionControlPanel({
  primarySeriesId,
  studyId,
  onSecondarySeriesSelect,
  opacity,
  onOpacityChange,
  isVisible,
  mriWindowLevel: _mriWindowLevel,
  onMriWindowLevelChange: _onMriWindowLevelChange,
  selectedSecondaryId,
  onOpenDebug,
  secondaryModality = 'MR',
  allowedSecondaryIds,
  transformSource,
  availableSeries,
  registrationOptions,
  selectedRegistrationId,
  onRegistrationSelect,
}: FusionControlPanelProps) {
  const [isMinimized, setIsMinimized] = useState(true);

  const { data: fetchedSeries } = useQuery({
    queryKey: [`/api/studies/${studyId}/series`],
    enabled: !availableSeries && !!studyId,
  });

  const candidateSeries = useMemo(() => {
    const seriesList = (availableSeries as SeriesItem[]) ?? ((fetchedSeries as SeriesItem[]) ?? []);
    const filtered = seriesList.filter((series) => {
      if (series.id === primarySeriesId) return false;
      if (!series.modality) return false;
      if (excludedModalities.has(series.modality)) return false;
      return imagingModalities.has(series.modality);
    });

    if (Array.isArray(allowedSecondaryIds)) {
      const allowed = new Set(allowedSecondaryIds);
      return filtered
        .filter((series) => allowed.has(series.id))
        .sort((a, b) => allowedSecondaryIds.indexOf(a.id) - allowedSecondaryIds.indexOf(b.id));
    }

    return filtered;
  }, [availableSeries, fetchedSeries, primarySeriesId, allowedSecondaryIds]);

  const selectedSeries = candidateSeries.find((series) => series.id === selectedSecondaryId);
  const overlayLabel = selectedSeries?.modality ?? (selectedSecondaryId != null ? secondaryModality : null);
  const resolvedRegistrationOptions = registrationOptions ?? [];

  const handleOpacityChange = (values: number[]) => {
    const next = values[0];
    if (typeof next === 'number' && !Number.isNaN(next)) {
      onOpacityChange(Math.max(0, Math.min(1, next)));
    }
  };

  const selectSeries = (seriesId: number | null) => {
    onSecondarySeriesSelect(seriesId);
  };

  if (!isVisible) return null;

  if (isMinimized) {
    return (
      <div className="fixed bottom-4 right-6 z-50 flex items-center gap-3 rounded-xl border border-slate-700/40 bg-black/60 px-3 py-2 backdrop-blur">
        <Badge variant="outline" className="bg-slate-900/80 text-slate-200 border-slate-600/50">
          Fusebox
        </Badge>
        <div className="w-32">
          <Slider value={[opacity]} min={0} max={1} step={0.01} onValueChange={handleOpacityChange} />
        </div>
        {overlayLabel ? (
          <span className="text-xs text-slate-200">
            {overlayLabel}
            {selectedSeries && (
              <> · {selectedSeries.seriesDescription || `Series ${selectedSeries.id}`}</>
            )}
          </span>
        ) : (
          <span className="text-xs text-slate-300 opacity-70">No overlay</span>
        )}
        <Button variant="ghost" size="icon" onClick={() => setIsMinimized(false)} className="h-8 w-8 text-slate-200">
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
            <span className="text-sm font-semibold">Fusebox Overlay</span>
            {overlayLabel && (
              <Badge variant="outline" className="bg-cyan-900/40 border-cyan-700/40 text-cyan-200">
                {overlayLabel}
              </Badge>
            )}
            {transformSource === 'helper-generated' && (
              <Badge variant="outline" className="bg-emerald-900/50 border-emerald-700/60 text-emerald-100">
                Helper fresh
              </Badge>
            )}
            {transformSource === 'helper-cache' && (
              <Badge variant="outline" className="bg-sky-900/40 border-sky-700/50 text-sky-200">
                Helper cache
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            {onOpenDebug && (
              <Button variant="ghost" size="icon" onClick={onOpenDebug} className="h-8 w-8 text-amber-300 hover:text-amber-200">
                <AlertTriangle className="h-4 w-4" />
              </Button>
            )}
            <Button variant="ghost" size="icon" onClick={() => setIsMinimized(true)} className="h-8 w-8 text-slate-200">
              <Minimize2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="space-y-4 px-4 py-4 text-slate-100">
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs uppercase tracking-wide text-slate-400">Overlay Series</span>
              <Badge variant="outline" className="bg-slate-800/60 border-slate-600/50 text-[10px] text-slate-300">
                {candidateSeries.length} available
              </Badge>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {candidateSeries.map((series) => {
                const isActive = series.id === selectedSecondaryId;
                return (
                  <Button
                    key={series.id}
                    variant={isActive ? 'default' : 'secondary'}
                    className={`h-auto justify-start gap-2 text-left text-xs ${
                      isActive
                        ? 'bg-cyan-600/70 hover:bg-cyan-600 text-slate-900'
                        : 'bg-slate-800/70 hover:bg-slate-700 text-slate-200'
                    }`}
                    onClick={() => selectSeries(series.id)}
                  >
                    <Brain className={`h-4 w-4 ${isActive ? 'text-slate-900' : 'text-cyan-300'}`} />
                    <div className="flex flex-col">
                      <span className="font-medium">{series.modality}</span>
                      <span className="text-[10px] opacity-70 line-clamp-1">
                        {series.seriesDescription || `Series ${series.id}`}
                      </span>
                    </div>
                  </Button>
                );
              })}
              <Button
                variant={selectedSecondaryId == null ? 'default' : 'secondary'}
                className={`h-auto justify-start gap-2 text-left text-xs ${
                  selectedSecondaryId == null
                    ? 'bg-slate-200 text-slate-900 hover:bg-slate-300'
                    : 'bg-slate-800/70 hover:bg-slate-700 text-slate-200'
                }`}
                onClick={() => selectSeries(null)}
              >
                <Layers className="h-4 w-4" />
                <div className="flex flex-col">
                  <span className="font-medium">Disable</span>
                  <span className="text-[10px] opacity-70">Show CT only</span>
                </div>
              </Button>
            </div>
            {candidateSeries.length === 0 && (
              <p className="mt-2 text-xs text-slate-400">No compatible secondary series found for Fusebox.</p>
            )}
          </div>

          {resolvedRegistrationOptions.length > 0 && (
            <div className="space-y-2">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs uppercase tracking-wide text-slate-400">Registration</span>
                <Badge variant="outline" className="bg-slate-800/60 border-slate-600/50 text-[10px] text-slate-300">
                  {resolvedRegistrationOptions.length}
                </Badge>
              </div>
              <div className="flex flex-col gap-2">
                {resolvedRegistrationOptions.map((option) => {
                  const isActive = (option.id ?? null) === (selectedRegistrationId ?? null);
                  return (
                    <Button
                      key={`${option.id ?? 'shared'}-${option.label}`}
                      variant={isActive ? 'default' : 'secondary'}
                      className={`h-auto justify-between text-left text-xs ${
                        isActive
                          ? 'bg-cyan-600/70 hover:bg-cyan-600 text-slate-900'
                          : 'bg-slate-800/70 hover:bg-slate-700 text-slate-200'
                      }`}
                      disabled={!onRegistrationSelect}
                      onClick={() => onRegistrationSelect?.(option.id ?? null)}
                    >
                      <span className="font-medium">{option.label}</span>
                      <Badge variant="outline" className="text-[10px] border-slate-500/40 bg-slate-900/40 text-slate-200">
                        {option.relationship === 'shared-frame' ? 'Shared FoR' : 'REG'}
                      </Badge>
                    </Button>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs uppercase tracking-wide text-slate-400">Overlay Opacity</span>
              <span className="text-xs text-cyan-200 font-medium">{Math.round(opacity * 100)}%</span>
            </div>
            <Slider
              value={[opacity]}
              min={0}
              max={1}
              step={0.01}
              onValueChange={handleOpacityChange}
            />
          </div>

          <div className="text-xs text-slate-400 border-t border-slate-700/60 pt-3">
            <p>Fusebox overlays combine the selected modality with the CT viewport using the server resampled slice API.</p>
          </div>
        </div>
      </Card>
    </div>
  );
}
