import { useState, useEffect, useCallback, useMemo } from 'react';
import { SeriesSelector } from './series-selector';
import { WorkingViewer } from './working-viewer';
import { ViewerToolbar } from './viewer-toolbar';
import { ContourEditToolbar } from './contour-edit-toolbar';
import { FusionControlPanel } from './fusion-control-panel';
import { ErrorModal } from './error-modal';
import { BooleanOperationsToolbar } from './boolean-operations-toolbar-new';
import { log } from '@/lib/log';
import { Button } from '@/components/ui/button';
import { MarginToolbar } from './margin-toolbar';
import { contoursToVIP } from '@/boolean/integrate';
import { union as vipUnion, intersect as vipIntersect, subtract as vipSubtract } from '@/boolean/vipBoolean';
import { vipToRectContours } from '@/boolean/simpleContours';
import { DICOMSeries, DICOMStudy, WindowLevel, WINDOW_LEVEL_PRESETS } from '@/lib/dicom-utils';
import type { RegistrationAssociation, RegistrationSeriesDetail } from '@/types/fusion';
import type { FusionManifest, FusionSecondaryDescriptor } from '@/types/fusion';
import { fetchFusionManifest, preloadFusionSecondary, getFusionManifest, clearFusionCaches } from '@/lib/fusion-utils';
import { cornerstoneConfig } from '@/lib/cornerstone-config';
import { LoadingProgress } from './loading-progress';
import { useFusionState } from '@/lib/useFusionState';
import { useRTStructureState } from '@/lib/useRTStructureState';
import { useSeriesState } from '@/lib/useSeriesState';
import { useViewerState } from '@/lib/useViewerState';

// TypeScript declaration for cornerstone
declare global {
  interface Window {
    cornerstone: any;
  }
}

interface ViewerInterfaceProps {
  studyData: any;
  onContourSettingsChange?: (settings: { width: number; opacity: number }) => void;
  contourSettings?: { width: number; opacity: number };
  onLoadedRTSeriesChange?: (seriesId: number | null) => void;
}

export function OptimizedViewerInterface({ studyData, onContourSettingsChange, contourSettings, onLoadedRTSeriesChange }: ViewerInterfaceProps) {
  // Use custom hooks for state management
  const seriesState = useSeriesState(studyData);
  const viewerState = useViewerState();
  const fusionState = useFusionState();
  const rtStructureState = useRTStructureState(studyData?.patient?.id, onLoadedRTSeriesChange);

  // Additional toolbar states
  const [showBooleanOperations, setShowBooleanOperations] = useState(false);
  const [showMarginToolbar, setShowMarginToolbar] = useState(false);
  const [showLocalizationTool, setShowLocalizationTool] = useState(true);
  const [previewStructureInfo, setPreviewStructureInfo] = useState<{ targetName: string; isNewStructure: boolean } | null>(null);
  const [highlightedStructures, setHighlightedStructures] = useState<{ inputs: string[]; output: string }>({ inputs: [], output: '' });

  // Registration associations state
  const [regCtacIds, setRegCtacIds] = useState<number[]>([]);

  // Watch for secondary series changes to show/hide fusion panel
  useEffect(() => {
    if (fusionState.secondarySeriesId !== null) {
      log.debug('Secondary series selected, showing fusion panel', 'optimized-viewer-interface');
      fusionState.setShowFusionPanel(true);
    }
  }, [fusionState.secondarySeriesId]);

  // Fetch REG associations for this patient and build primary->secondary mapping by series IDs
  useEffect(() => {
    const loadAssociations = async () => {
      fusionState.setAssociationsReady(false);
      fusionState.setAssociationPrimarySeries(null);
      try {
        if (!seriesState.series || !Array.isArray(seriesState.series) || seriesState.series.length === 0) return;

        const ensureString = (value: unknown): string | null => {
          if (typeof value !== 'string') return null;
          const trimmed = value.trim();
          return trimmed ? trimmed : null;
        };

        const normalizeSeriesId = (value: unknown): number | null => {
          if (value === null || value === undefined) return null;
          if (typeof value === 'number' && Number.isFinite(value)) return value;
          if (typeof value === 'bigint') {
            const asNumber = Number(value);
            return Number.isFinite(asNumber) ? asNumber : null;
          }
          if (typeof value === 'string') {
            const trimmed = value.trim();
            if (!trimmed) return null;
            const parsed = Number(trimmed);
            return Number.isFinite(parsed) ? parsed : null;
          }
          const parsed = Number(value);
          return Number.isFinite(parsed) ? parsed : null;
        };

        const normalizeSeriesDetail = (detail: any): RegistrationSeriesDetail | null => {
          if (!detail) return null;
          const id = normalizeSeriesId(detail.id ?? detail.seriesId ?? detail.series_id);
          const uid = ensureString(detail.uid ?? detail.seriesInstanceUID ?? detail.seriesInstanceUid);
          const description = ensureString(detail.description ?? detail.seriesDescription);
          const modality = ensureString(detail.modality);
          const studyId = normalizeSeriesId(detail.studyId ?? detail.study_id);
          const imageCountRaw = detail.imageCount ?? detail.instances ?? detail.image_count;
          const imageCountNumber = Number(imageCountRaw);
          const imageCount = Number.isFinite(imageCountNumber) ? imageCountNumber : null;
          if (id == null && !uid) return null;
          return {
            id,
            uid,
            description,
            modality,
            studyId,
            imageCount,
            seriesInstanceUID: uid,
            seriesDescription: description,
          };
        };

        const associations = await fetch(`/api/registration/associations?patientId=${studyData.patient.id}`).then((res) => res.json());

        const seriesToAssociation = new Map<number, RegistrationAssociation[]>();
        const regFileMap = new Map<string, string>();
        const modalityMap = new Map<number, string>();
        const regCtacIds: number[] = [];

        // Build series to association mapping
        for (const assoc of associations) {
          const primaryDetail = normalizeSeriesDetail(assoc.primary);
          const secondaryDetail = normalizeSeriesDetail(assoc.secondary);

          if (!primaryDetail || !secondaryDetail) {
            log.warn('Invalid association details', { assoc });
            continue;
          }

          const primaryId = primaryDetail.id;
          const secondaryId = secondaryDetail.id;

          if (!primaryId || !secondaryId) continue;

          // Store modality for later use
          modalityMap.set(primaryId, primaryDetail.modality);
          modalityMap.set(secondaryId, secondaryDetail.modality);

          // Track CTAC registrations (PET-CT)
          if (primaryDetail.modality === 'PT' && secondaryDetail.modality === 'CT') {
            regCtacIds.push(secondaryId);
          }

          // Build series to association mapping
          if (!seriesToAssociation.has(primaryId)) {
            seriesToAssociation.set(primaryId, []);
          }
          seriesToAssociation.get(primaryId)!.push({
            relationship: assoc.relationship,
            primary: primaryDetail,
            secondary: secondaryDetail,
            regFile: assoc.regFile,
            matrix: assoc.matrix,
          });

          // Also map secondary series to their primaries for reverse lookup
          if (!seriesToAssociation.has(secondaryId)) {
            seriesToAssociation.set(secondaryId, []);
          }
          seriesToAssociation.get(secondaryId)!.push({
            relationship: assoc.relationship,
            primary: primaryDetail,
            secondary: secondaryDetail,
            regFile: assoc.regFile,
            matrix: assoc.matrix,
          });

          // Store registration file mapping
          if (assoc.regFile) {
            regFileMap.set(assoc.regFile, assoc.regFile);
          }
        }

        // Filter series to only include those that have associations
        const associatedSeriesIds = new Set<number>();
        for (const assocList of seriesToAssociation.values()) {
          for (const assoc of assocList) {
            associatedSeriesIds.add(assoc.primary.id);
            associatedSeriesIds.add(assoc.secondary.id);
          }
        }

        const filteredSeries = seriesState.series.filter((s: any) => associatedSeriesIds.has(s.id));

        // Set associations ready
        fusionState.setAssociationsReady(true);
        fusionState.setAssociationPrimarySeries(filteredSeries.find((s: any) => s.modality === 'CT') || filteredSeries[0] || null);

        // Build primary->secondary mapping by series IDs
        const primaryToSecondary: Record<number, number[]> = {};
        for (const assocList of seriesToAssociation.values()) {
          for (const assoc of assocList) {
            if (assoc.relationship === 'primary') {
              if (!primaryToSecondary[assoc.primary.id]) {
                primaryToSecondary[assoc.primary.id] = [];
              }
              primaryToSecondary[assoc.primary.id].push(assoc.secondary.id);
            }
          }
        }

        seriesState.setRegAssociations(primaryToSecondary);
        seriesState.setRegistrationRelationshipMap(seriesToAssociation);
        setRegCtacIds(regCtacIds);
      } catch (error) {
        console.error('Failed to load registration associations:', error);
        fusionState.setAssociationsReady(false);
        fusionState.setAssociationPrimarySeries(null);
      }
    };
    loadAssociations();
  }, [studyData.patient.id, seriesState.series, fusionState, seriesState]);

  // Handle series selection
  const handleSeriesSelect = useCallback(async (selectedSeries: DICOMSeries) => {
    log.debug(`Selecting series: ${selectedSeries.id}`, 'optimized-viewer-interface');

    try {
      // Clear previous state
      viewerState.setError(null);
      rtStructureState.setRTStructures(null);

      // Load RT structures if this is an RTSTRUCT series
      if (selectedSeries.modality === 'RTSTRUCT') {
        try {
          const rtResponse = await fetch(`/api/series/${selectedSeries.id}/rt-structures`);
          if (rtResponse.ok) {
            const rtData = await rtResponse.json();
            rtStructureState.setRTStructures(rtData);
          }
        } catch (error) {
          log.error('Failed to load RT structures', error);
        }
      }

      seriesState.setSelectedSeries(selectedSeries);
    } catch (error) {
      log.error('Failed to select series', error);
      viewerState.setError(error);
    }
  }, [seriesState, rtStructureState, viewerState]);

  // Handle window level changes
  const handleWindowLevelChange = useCallback((newWindowLevel: { window: number; level: number }) => {
    viewerState.setWindowLevel(newWindowLevel as WindowLevel);
  }, [viewerState]);

  // Handle fusion manifest loading
  const handleLoadFusionManifest = useCallback(async () => {
    if (!fusionState.secondarySeriesId) return;

    fusionState.setFusionManifestLoading(true);
    fusionState.setFusionManifestError(null);

    try {
      const manifest = await fetchFusionManifest(studyData.patient.id, seriesState.selectedSeries?.id, fusionState.secondarySeriesId);
      fusionState.setFusionManifest(manifest);

      // Preload secondary series
      await preloadFusionSecondary(studyData.patient.id, seriesState.selectedSeries?.id, fusionState.secondarySeriesId);

      log.debug('Fusion manifest loaded successfully', 'optimized-viewer-interface');
    } catch (error) {
      log.error('Failed to load fusion manifest', error);
      fusionState.setFusionManifestError(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      fusionState.setFusionManifestLoading(false);
    }
  }, [fusionState, seriesState.selectedSeries, studyData.patient.id]);

  // Handle structure selection for editing
  const handleStructureSelect = useCallback((structureId: number) => {
    rtStructureState.setSelectedForEdit(structureId);
    rtStructureState.setIsContourEditMode(true);
  }, [rtStructureState]);

  // Handle contour updates from working viewer
  const handleContourUpdate = useCallback((update: any) => {
    log.debug('Contour update received', update);

    if (update.action === 'structure_selected') {
      handleStructureSelect(update.structureId);
    } else if (update.action === 'margin_applied') {
      // Handle margin application
      setShowMarginToolbar(false);
    } else if (update.action === 'boolean_operation_applied') {
      // Handle boolean operation
      setShowBooleanOperations(false);
    }
  }, [handleStructureSelect]);

  // Handle boolean operations
  const handleBooleanOperation = useCallback(async (operation: any) => {
    try {
      if (!rtStructureState.rtStructures) return;

      let resultContours;
      switch (operation.type) {
        case 'union':
          resultContours = vipUnion(rtStructureState.rtStructures, operation.structureIds);
          break;
        case 'intersect':
          resultContours = vipIntersect(rtStructureState.rtStructures, operation.structureIds);
          break;
        case 'subtract':
          resultContours = vipSubtract(rtStructureState.rtStructures, operation.structureIds);
          break;
        default:
          throw new Error(`Unknown boolean operation: ${operation.type}`);
      }

      // Apply result to viewer
      if (viewerState.workingViewerRef.current) {
        viewerState.workingViewerRef.current.handleContourUpdate({
          action: 'apply_boolean_result',
          contours: resultContours,
          targetStructureId: operation.targetStructureId,
          parameters: operation.parameters
        });
        setShowBooleanOperations(false);
      }
    } catch (error) {
      log.error('Boolean operation failed', error);
      viewerState.setError(error);
    }
  }, [rtStructureState.rtStructures, viewerState]);

  return (
    <div className="h-full w-full bg-background">
      {/* Series Selector */}
      <SeriesSelector
        series={seriesState.visibleSeries}
        selectedSeries={seriesState.selectedSeries}
        onSeriesSelect={handleSeriesSelect}
        isLoading={seriesState.isLoading}
      />

      {/* Main Viewer */}
      <WorkingViewer
        ref={viewerState.workingViewerRef}
        seriesId={seriesState.selectedSeries?.id}
        windowLevel={viewerState.windowLevel}
        onWindowLevelChange={handleWindowLevelChange}
        rtStructures={rtStructureState.rtStructures}
        structureVisibility={rtStructureState.structureVisibility}
        selectedStructures={rtStructureState.selectedStructures}
        onContourUpdate={handleContourUpdate}
        activeToolMode={viewerState.activeToolMode}
        brushToolState={rtStructureState.brushToolState}
        fusionState={fusionState}
        onFusionUpdate={(update) => {
          if (update.type === 'secondary_selected') {
            fusionState.setSecondarySeriesId(update.seriesId);
          } else if (update.type === 'opacity_changed') {
            fusionState.setFusionOpacity(update.opacity);
          }
        }}
      />

      {/* Toolbars */}
      {showBooleanOperations && (
        <BooleanOperationsToolbar
          onApply={handleBooleanOperation}
          onClose={() => setShowBooleanOperations(false)}
          structures={rtStructureState.rtStructures?.structures || []}
          selectedStructures={rtStructureState.selectedStructures}
        />
      )}

      {showMarginToolbar && (
        <MarginToolbar
          onApply={(operation) => {
            if (viewerState.workingViewerRef.current) {
              viewerState.workingViewerRef.current.handleContourUpdate({
                action: 'apply_margin',
                targetStructureId: operation.targetStructureId,
                parameters: operation.parameters
              });
              setShowMarginToolbar(false);
            }
          }}
          onClose={() => setShowMarginToolbar(false)}
          structures={rtStructureState.rtStructures?.structures || []}
          selectedStructures={rtStructureState.selectedStructures}
        />
      )}

      {/* Fusion Control Panel */}
      {fusionState.showFusionPanel && (
        <FusionControlPanel
          visibleSeries={seriesState.visibleSeries}
          secondarySeriesId={fusionState.secondarySeriesId}
          fusionOpacity={fusionState.fusionOpacity}
          fusionManifest={fusionState.fusionManifest}
          fusionManifestLoading={fusionState.fusionManifestLoading}
          fusionManifestError={fusionState.fusionManifestError}
          associationsReady={fusionState.associationsReady}
          associationPrimarySeries={fusionState.associationPrimarySeries}
          onSecondarySeriesChange={(seriesId) => fusionState.setSecondarySeriesId(seriesId)}
          onOpacityChange={(opacity) => fusionState.setFusionOpacity(opacity)}
          onLoadManifest={handleLoadFusionManifest}
          onClose={() => fusionState.setShowFusionPanel(false)}
          onClearCache={() => clearFusionCaches()}
        />
      )}

      {/* Error Modal */}
      <ErrorModal
        isOpen={!!viewerState.error}
        onClose={() => viewerState.setError(null)}
        onRetry={() => {
          viewerState.setError(null);
          if (seriesState.selectedSeries) {
            handleSeriesSelect(seriesState.selectedSeries);
          }
        }}
        error={viewerState.error || { title: '', message: '' }}
      />

      {/* Background Loading Progress */}
      <LoadingProgress
        loadingStates={fusionState.secondaryLoadingStates}
        className="animate-in slide-in-from-right-2 duration-300"
      />
    </div>
  );
}