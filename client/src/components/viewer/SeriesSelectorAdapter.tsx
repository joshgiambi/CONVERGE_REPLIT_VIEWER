import React, { useCallback } from 'react';
import { SeriesSelector } from '@/components/dicom/series-selector';
import type { DICOMSeries, WindowLevel } from '@/lib/dicom-utils';
import type { SeriesTreeNode } from '@/lib/series-tree-builder';
import { useRT } from '@/rt-structures/RTProvider';
import { useFusion } from '@/fusion/fusion-context';
import { useFusionPanelState } from '@/fusion/hooks/useFusionPanel';

interface SeriesSelectorAdapterProps {
  series: DICOMSeries[];
  seriesTree?: SeriesTreeNode[];
  selectedSeries: DICOMSeries | null;
  onSeriesSelect: (series: DICOMSeries) => void;
  windowLevel: WindowLevel;
  onWindowLevelChange: (windowLevel: WindowLevel) => void;
  studyId?: number;
  regAssociations?: Record<number, number[]>;
  regCtacSeriesIds?: number[];
  onContourSettingsChange?: (settings: { width: number; opacity: number }) => void;
  onAutoZoom?: (zoom: number) => void;
  onAutoLocalize?: (x: number, y: number, z: number) => void;
  localizationMode?: boolean;
  loadedRTSeriesId?: number | null;
  onRTStructureLoad?: (rtPayload: number | { id?: number; structures?: any }) => void;
  fallbackFusionCandidates?: Map<number, number[]>;
}

export function SeriesSelectorAdapter({
  series,
  seriesTree,
  selectedSeries,
  onSeriesSelect,
  windowLevel,
  onWindowLevelChange,
  studyId,
  regAssociations,
  regCtacSeriesIds,
  onContourSettingsChange,
  onAutoZoom,
  onAutoLocalize,
  localizationMode = false,
  loadedRTSeriesId,
  onRTStructureLoad,
  fallbackFusionCandidates,
}: SeriesSelectorAdapterProps) {
  const rt = useRT();

  let fusionPanel: ReturnType<typeof useFusionPanelState> | null = null;
  let fusionCtx: ReturnType<typeof useFusion> | null = null;
  try {
    fusionPanel = useFusionPanelState();
    fusionCtx = useFusion();
  } catch {
    // Not in a FusionProvider context; that's fine for non-CT series
  }

  // Delegate RT loading to parent (ViewerV2Content) by omitting onRTStructureLoad

  // Build simple candidate map for the currently selected primary (if fusion is active)
  const fusionCandidatesByPrimary = React.useMemo(() => {
    if (fusionCtx && selectedSeries) {
      const ids = (fusionPanel?.secondaries ?? [])
        .map((secondary) => {
          const raw = (secondary as any);
          const candidateId = Number(raw?.secondarySeriesId ?? raw?.seriesId);
          return Number.isFinite(candidateId) ? candidateId : null;
        })
        .filter((value): value is number => value !== null);
      return new Map<number, number[]>([[selectedSeries.id, ids]]);
    }
    return fallbackFusionCandidates;
  }, [fusionCtx, fusionPanel?.secondaries, selectedSeries, fallbackFusionCandidates]);

  return (
    <SeriesSelector
      series={series}
      seriesTree={seriesTree}
      selectedSeries={selectedSeries}
      onSeriesSelect={onSeriesSelect}
      windowLevel={windowLevel}
      onWindowLevelChange={onWindowLevelChange}
      studyId={studyId}
      studyIds={typeof studyId === 'number' ? [studyId] : undefined}
      regAssociations={regAssociations}
      regCtacSeriesIds={regCtacSeriesIds}
      onContourSettingsChange={onContourSettingsChange}
      onAutoZoom={onAutoZoom}
      onAutoLocalize={onAutoLocalize}
      localizationMode={localizationMode}
      rtStructures={rt.rtStructures}
      onRTStructureLoad={onRTStructureLoad}
      loadedRTSeriesId={loadedRTSeriesId ?? null}
      onStructureVisibilityChange={(structureId, visible) => rt.setStructureVisibility(structureId, visible)}
      onStructureColorChange={(structureId, color) => {
        if (!rt.rtStructures) return;
        const updated = structuredClone(rt.rtStructures);
        const target = updated.structures.find((s: any) => s.roiNumber === structureId);
        if (target) {
          target.color = color as any;
          rt.setStructures(updated);
          rt.saveHistory('color_change', structureId);
        }
      }}
      onStructureSelection={(structureId, selected) => rt.selectStructure(structureId, selected)}
      selectedForEdit={rt.selection.selectedForEdit}
      onSelectedForEditChange={rt.setSelectedForEdit}
      onAllStructuresVisibilityChange={rt.setAllStructuresVisible}
      secondarySeriesId={fusionPanel?.selectedSecondaryId ?? null}
      onSecondarySeriesSelect={(id) => fusionPanel?.setSelectedSecondaryId(id ?? null)}
      fusionStatuses={fusionPanel?.secondaryStatuses}
      secondaryLoadingStates={fusionPanel?.secondaryLoadingStates}
      currentlyLoadingSecondary={fusionPanel?.currentlyLoadingSecondary ?? null}
      fusionCandidatesByPrimary={fusionCandidatesByPrimary}
    />
  );
}

export default SeriesSelectorAdapter;
