/**
 * ViewerV2 Component
 * 
 * New viewer architecture - composes PrimaryViewport + ViewportControls + ViewerShell
 * This is the main entry point for the refactored viewer.
 * 
 * Agent 1: Viewer Core
 * Created: Hour 14-18
 * Agent 5: Integration (updated to mount legacy UI components)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ViewerShell } from './ViewerShell';
import { PrimaryViewport } from './PrimaryViewport';
import { useViewportTools } from '@/hooks/useViewportTools';
import { RTProvider, useRT } from '@/rt-structures/RTProvider';
import RTOverlayLayer from '@/rt-structures/components/RTOverlayLayer';
import RTControlPanel from '@/rt-structures/components/RTControlPanel';
import FusionOverlayLayer from '@/fusion/components/FusionOverlayLayer';
import { FusionProvider, useFusion, type FusionContextValue } from '@/fusion/fusion-context';
import { FusionPanel } from '@/fusion/components/FusionPanel';
import { useFusionCandidates, useSeriesSelection } from '@/hooks/use-series-selection';
import { useRegistrationAssociations } from '@/hooks/useRegistrationAssociations';
import { useFusionPanelState } from '@/fusion/hooks/useFusionPanel';
import { useQuery } from '@tanstack/react-query';
import { ViewerToolbar } from '@/components/dicom/viewer-toolbar';
import { SeriesSelector } from '@/components/dicom/series-selector';
import { ContourEditToolbar } from '@/components/dicom/contour-edit-toolbar';
import { BooleanOperationsToolbar } from '@/components/dicom/boolean-operations-toolbar-new';
import { MarginToolbar } from '@/components/dicom/margin-toolbar';
import { SimpleBrushTool } from '@/components/dicom/simple-brush-tool';
import { PenToolUnifiedV2 } from '@/components/dicom/pen-tool-unified-v2';
import { WINDOW_LEVEL_PRESETS, type WindowLevel, type DICOMSeries } from '@/lib/dicom-utils';
import type { ImageMetadata } from '@/types/viewer';
import { createContourOperationsService } from '@/rt-structures/services/ContourOperationsService';

interface ViewerV2Props {
  patientId: string;
  seriesId: number;
  studyId?: number;
  initialSeriesList?: DICOMSeries[];
  onLoadedRtSeriesChange?: (seriesId: number | null) => void;
}

type FusionPanelState = ReturnType<typeof useFusionPanelState> | null;

interface ViewerV2ContentProps extends ViewerV2Props {
  fusion?: FusionContextValue | null;
  fusionPanelState?: FusionPanelState;
  candidateSecondaryIds?: number[];
  seriesSelectionData?: any;
  registrationData?: Map<number, any[]> | null;
  selectedRtSeriesId?: number | null;
  onSeriesChange?: (series: DICOMSeries) => void;
}

// Inner component that uses both fusion and RT contexts
function ViewerV2Content({
  patientId,
  seriesId,
  studyId,
  initialSeriesList,
  fusion = null,
  fusionPanelState = null,
  candidateSecondaryIds = [],
  seriesSelectionData,
  registrationData,
  selectedRtSeriesId,
  onSeriesChange,
}: ViewerV2ContentProps) {
  const viewportRef = useRef<any>(null);
  const { setMode, isPanMode, isCrosshairMode, isMeasureMode } = useViewportTools();
  const [fusionMinimized, setFusionMinimized] = useState(false);
  const rt = useRT();

  // State for floating toolbars
  const [isContourEditMode, setIsContourEditMode] = useState(false);
  const [showBooleanOperations, setShowBooleanOperations] = useState(false);
  const [showMarginToolbar, setShowMarginToolbar] = useState(false);
  const [showLocalizationTool, setShowLocalizationTool] = useState(true);

  // State for series selector
  const [windowLevel, setWindowLevel] = useState<WindowLevel>(WINDOW_LEVEL_PRESETS.abdomen);
  const [currentSeriesId, setCurrentSeriesId] = useState<number>(seriesId);
  const [imageMetadata, setImageMetadata] = useState<ImageMetadata | null>(null);
  const [currentSliceIndex, setCurrentSliceIndex] = useState(0);
  const [currentSlicePosition, setCurrentSlicePosition] = useState<number>(0);
  const [previewStructureInfo, setPreviewStructureInfo] = useState<{ targetName: string; isNewStructure: boolean } | null>(null);
  const [highlightedStructures, setHighlightedStructures] = useState<{ inputs: string[]; output: string }>({ inputs: [], output: '' });
  const [loadedRtSeriesId, setLoadedRtSeriesId] = useState<number | null>(null);
  const [autoZoomLevel, setAutoZoomLevel] = useState<number | null>(null);
  const [autoLocalizeTarget, setAutoLocalizeTarget] = useState<{ x: number; y: number; z: number } | null>(null);
  const legacyImageMetadata = useMemo(() => {
    if (!imageMetadata) return null;
    return {
      ...imageMetadata,
      pixelSpacing: `${imageMetadata.pixelSpacing[0]}\\${imageMetadata.pixelSpacing[1]}`,
      imagePosition: `${imageMetadata.imagePositionPatient[0]}\\${imageMetadata.imagePositionPatient[1]}\\${imageMetadata.imagePositionPatient[2]}`,
      Columns: imageMetadata.columns,
      Rows: imageMetadata.rows,
      sliceThickness: imageMetadata.sliceThickness,
    };
  }, [imageMetadata]);

  useEffect(() => {
    if (!imageMetadata) return;
    const nextLevel = Number(imageMetadata.windowCenter);
    const nextWindow = Number(imageMetadata.windowWidth);
    if (!Number.isFinite(nextLevel) || !Number.isFinite(nextWindow)) return;
    setWindowLevel((prev) => {
      if (
        Math.abs(prev.level - nextLevel) < 0.01 &&
        Math.abs(prev.window - nextWindow) < 0.01
      ) {
        return prev;
      }
      return { level: nextLevel, window: nextWindow };
    });
  }, [imageMetadata]);

  useEffect(() => {
    setIsContourEditMode(false);
    setShowBooleanOperations(false);
    setShowMarginToolbar(false);
  }, [seriesId]);

  useEffect(() => {
    if (currentSeriesId !== seriesId) {
      setCurrentSeriesId(seriesId);
    }
  }, [currentSeriesId, seriesId]);

  const contourServiceRef = useRef<ReturnType<typeof createContourOperationsService> | null>(null);
  if (!contourServiceRef.current) {
    contourServiceRef.current = createContourOperationsService();
  }

  const autoZoomTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoLocalizeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (autoZoomTimeoutRef.current) {
        clearTimeout(autoZoomTimeoutRef.current);
        autoZoomTimeoutRef.current = null;
      }
      if (autoLocalizeTimeoutRef.current) {
        clearTimeout(autoLocalizeTimeoutRef.current);
        autoLocalizeTimeoutRef.current = null;
      }
    };
  }, []);

  const selectedStructureIds = useMemo(() => {
    return Array.from(rt.selection.selectedStructureIds ?? new Set<number>());
  }, [rt.selection.selectedStructureIds]);

  const selectedStructureColors = useMemo(() => {
    if (!rt.rtStructures?.structures) return [] as string[];
    return selectedStructureIds
      .map((roiNumber) => {
        const structure = rt.rtStructures?.structures?.find((s: any) => s.roiNumber === roiNumber);
        if (!structure || !Array.isArray(structure.color)) return null;
        return `rgb(${structure.color.join(',')})`;
      })
      .filter((entry): entry is string => Boolean(entry));
  }, [selectedStructureIds, rt.rtStructures]);

  // Fetch all series for the patient
  const hasInitialSeries = Array.isArray(initialSeriesList) && initialSeriesList.length > 0;
  const { data: allSeries = hasInitialSeries ? initialSeriesList! : [] } = useQuery<DICOMSeries[]>({
    queryKey: ['patient-series', patientId],
    queryFn: async () => {
      const response = await fetch(`/api/patients/${patientId}/series`);
      if (!response.ok) return [];
      const data = await response.json();
      if (Array.isArray(data?.series)) return data.series;
      if (Array.isArray(data)) return data;
      return [];
    },
    enabled: !!patientId && !hasInitialSeries,
    initialData: hasInitialSeries ? initialSeriesList : undefined,
    staleTime: 5 * 60 * 1000,
  });

  const seriesById = useMemo(() => {
    const map = new Map<number, DICOMSeries>();
    (allSeries || []).forEach((entry: any) => {
      if (!entry) return;
      const parsed = Number(entry.id);
      if (Number.isFinite(parsed)) {
        map.set(parsed, entry);
      }
    });
    return map;
  }, [allSeries]);

  const fusionCandidatesByPrimary = useMemo(() => {
    const merged = new Map<number, number[]>();
    seriesById.forEach((_value, key) => merged.set(key, []));

    if (fusion?.primarySeriesId) {
      merged.set(fusion.primarySeriesId, [...candidateSecondaryIds]);
    }

    if (seriesSelectionData?.planningCT?.id && Array.isArray(seriesSelectionData?.fusionCandidates)) {
      merged.set(
        seriesSelectionData.planningCT.id,
        seriesSelectionData.fusionCandidates.map((candidate: any) => candidate.seriesId),
      );
    }

    return merged;
  }, [seriesById, fusion?.primarySeriesId, candidateSecondaryIds, seriesSelectionData?.planningCT?.id, seriesSelectionData?.fusionCandidates]);

  const fusionSiblingMap = useMemo(() => {
    if (!registrationData || registrationData.size === 0) {
      return new Map<number, Map<'PET' | 'MR', Map<number, number[]>>>();
    }

    const normalizeSeriesIdLocal = (value: unknown): number | null => {
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

    const modalityOf = (id: number | null): string => {
      if (id == null) return '';
      const entry = seriesById.get(id);
      return (entry?.modality || '').toUpperCase();
    };

    const map = new Map<number, Map<'PET' | 'MR', Map<number, number[]>>>();

    registrationData.forEach((associations, primaryIdKey) => {
      if (!Array.isArray(associations) || primaryIdKey == null) return;

      const petMapping = new Map<number, Set<number>>();
      const mrMapping = new Map<number, Set<number>>();

      (associations ?? []).forEach((assoc: any) => {
        const petIds = new Set<number>();
        const ctIds = new Set<number>();
        const mrIds = new Set<number>();

        const registerByModality = (rawId: unknown, modality: string | null | undefined) => {
          const normalized = normalizeSeriesIdLocal(rawId);
          if (normalized == null || normalized === primaryIdKey) return;
          if (!seriesById.has(normalized)) return;

          const resolvedModality = (modality || modalityOf(normalized)).toUpperCase();
          if (!resolvedModality) return;
          if (resolvedModality === 'CT') {
            ctIds.add(normalized);
          } else if (resolvedModality === 'PT' || resolvedModality === 'PET' || resolvedModality === 'NM') {
            petIds.add(normalized);
          } else if (resolvedModality === 'MR') {
            mrIds.add(normalized);
          }
        };

        if (Array.isArray(assoc?.sourceSeriesDetails)) {
          assoc.sourceSeriesDetails.forEach((detail: any) => registerByModality(detail?.id, detail?.modality));
        }

        if (Array.isArray(assoc?.sourcesSeriesIds)) {
          assoc.sourcesSeriesIds.forEach((value: any) => registerByModality(value, null));
        }

        if (Array.isArray(assoc?.siblingSeriesIds)) {
          assoc.siblingSeriesIds.forEach((value: any) => registerByModality(value, null));
        }

        if (petIds.size) {
          petIds.forEach((petId) => {
            const entry = petMapping.get(petId) ?? new Set<number>();
            ctIds.forEach((ctId) => entry.add(ctId));
            petMapping.set(petId, entry);
          });
        }

        if (mrIds.size) {
          mrIds.forEach((mrId) => {
            const entry = mrMapping.get(mrId) ?? new Set<number>();
            mrIds.forEach((otherMrId) => {
              if (otherMrId !== mrId) entry.add(otherMrId);
            });
            if (petIds.size) {
              ctIds.forEach((ctId) => entry.add(ctId));
            }
            mrMapping.set(mrId, entry);
          });
        }
      });

      const petMap = new Map<number, number[]>();
      petMapping.forEach((set, key) => petMap.set(key, Array.from(set.values())));
      const mrMap = new Map<number, number[]>();
      mrMapping.forEach((set, key) => mrMap.set(key, Array.from(set.values())));

      map.set(primaryIdKey, new Map<'PET' | 'MR', Map<number, number[]>>([
        ['PET', petMap],
        ['MR', mrMap],
      ]));
    });

    return map;
  }, [registrationData, seriesById]);

  // Find the selected series object
  const selectedSeriesObj = useMemo(() => {
    return allSeries.find((s: DICOMSeries) => s.id === currentSeriesId) || null;
  }, [allSeries, currentSeriesId]);

  // Handle series selection change
  const handleSeriesSelect = (series: DICOMSeries) => {
    setCurrentSeriesId(series.id);
    setImageMetadata(null);
    onSeriesChange?.(series);
  };

  useEffect(() => {
    if (rt.selection.selectedForEdit) {
      setIsContourEditMode(true);
    } else if (!showBooleanOperations && !showMarginToolbar) {
      setIsContourEditMode(false);
    }
  }, [rt.selection.selectedForEdit, showBooleanOperations, showMarginToolbar]);

  useEffect(() => {
    const currentImage = viewportRef.current?.getCurrentImage?.();
    const byImage = typeof currentImage?.parsedSliceLocation === 'number' ? currentImage.parsedSliceLocation : null;
    const byMetadata = typeof imageMetadata?.sliceLocation === 'number'
      ? imageMetadata.sliceLocation
      : Array.isArray(imageMetadata?.imagePositionPatient)
        ? Number(imageMetadata?.imagePositionPatient?.[2])
        : null;
    const candidate = byImage ?? byMetadata ?? 0;
    setCurrentSlicePosition(Number.isFinite(candidate) ? candidate : 0);
  }, [imageMetadata, currentSliceIndex]);

  useEffect(() => {
    if (selectedRtSeriesId != null) {
      setLoadedRtSeriesId(Number(selectedRtSeriesId));
    }
  }, [selectedRtSeriesId]);

  // Viewport control handlers
  const handleZoomIn = () => viewportRef.current?.zoomIn();
  const handleZoomOut = () => viewportRef.current?.zoomOut();
  const handleResetZoom = () => viewportRef.current?.resetZoom();
  const handlePan = () => setMode('pan');
  const handleCrosshairs = () => setMode('crosshairs');
  const handleMeasure = () => setMode('measure');

  // Toolbar handlers
  const handleContourEdit = () => {
    setShowBooleanOperations(false);
    setShowMarginToolbar(false);
    
    // Auto-select last structure if none selected
    if (!rt.selection.selectedForEdit && rt.rtStructures?.structures && rt.rtStructures.structures.length > 0) {
      const lastStructure = rt.rtStructures.structures[rt.rtStructures.structures.length - 1];
      rt.setSelectedForEdit(lastStructure.roiNumber);
    }
    
    setIsContourEditMode(true);
  };

  const handleContourOperations = () => {
    setIsContourEditMode(false);
    setShowMarginToolbar(false);
    setShowBooleanOperations(true);
  };

  const handleAdvancedMarginTool = () => {
    setIsContourEditMode(false);
    setShowBooleanOperations(false);
    setShowMarginToolbar(true);
  };

  const fusionOpacity = fusionPanelState?.opacity ?? fusion?.opacity ?? 0.5;
  const showFusionPanel = fusionPanelState?.showPanel ?? fusion?.showFusionPanel ?? false;
  const fusionSecondaryStatuses = fusionPanelState?.secondaryStatuses ?? new Map<number, { status: 'idle' | 'loading' | 'ready' | 'error'; error?: string | null }>();
  const fusionSecondaryLoadingStates = fusionPanelState?.secondaryLoadingStates ?? new Map<number, { progress: number; isLoading: boolean }>();
  const currentlyLoadingSecondary = fusionPanelState?.currentlyLoadingSecondary ?? fusion?.currentlyLoadingSecondary ?? null;
  const selectedSecondaryId = fusionPanelState?.selectedSecondaryId ?? fusion?.selectedSecondaryId ?? null;

  const handleSecondarySeriesSelect = (id: number | null) => {
    if (fusionPanelState?.setSelectedSecondaryId) {
      fusionPanelState.setSelectedSecondaryId(id);
      return;
    }
    if (fusion?.setSelectedSecondaryId) {
      fusion.setSelectedSecondaryId(id);
    }
  };

  const handleMarginOperation = async (operation: {
    type: 'uniform_margin' | 'directional_margin' | 'morphological_margin' | 'anisotropic_margin';
    parameters: any;
    structureId: number;
    targetStructureId?: number | 'new';
    preview?: boolean;
  }) => {
    if (!rt.rtStructures) {
      console.warn('[ViewerV2] Margin operation skipped - no RT structures loaded');
      return;
    }

    const contourService = contourServiceRef.current ?? createContourOperationsService();
    contourServiceRef.current = contourService;

    const baseStructures = rt.rtStructures;
    const sourceStructure = baseStructures.structures?.find((s: any) => s.roiNumber === operation.structureId);
    if (!sourceStructure) {
      console.warn('[ViewerV2] Margin operation skipped - source structure missing', operation.structureId);
      return;
    }

    const shouldSetBusy = !operation.preview;
    if (shouldSetBusy) rt.setBusy(true);

    try {
      let workingSet = structuredClone(baseStructures);

      const marginValues = operation?.parameters?.marginValues ?? {};
      const fallbackMargin = Number(operation?.parameters?.margin ?? marginValues?.uniform ?? 0) || 0;

      switch (operation.type) {
        case 'uniform_margin': {
          const margin = Number(marginValues?.uniform ?? fallbackMargin) || 0;
          workingSet = await contourService.applyUniformMargin(workingSet, operation.structureId, margin);
          break;
        }
        case 'anisotropic_margin': {
          const anisotropicSource = {
            superior: Number(marginValues?.z ?? marginValues?.superior ?? fallbackMargin) || 0,
            inferior: Number(marginValues?.z ?? marginValues?.inferior ?? fallbackMargin) || 0,
            anterior: Number(marginValues?.y ?? marginValues?.anterior ?? fallbackMargin) || 0,
            posterior: Number(marginValues?.y ?? marginValues?.posterior ?? fallbackMargin) || 0,
            left: Number(marginValues?.x ?? marginValues?.left ?? fallbackMargin) || 0,
            right: Number(marginValues?.x ?? marginValues?.right ?? fallbackMargin) || 0,
          };
          workingSet = await contourService.applyAnisotropicMargin(workingSet, operation.structureId, anisotropicSource);
          break;
        }
        case 'directional_margin': {
          const directionEntries = Object.entries(marginValues ?? {});
          for (const [dir, value] of directionEntries) {
            const distance = Number(value) || 0;
            if (!distance) continue;
            const normalized = dir as 'superior' | 'inferior' | 'anterior' | 'posterior' | 'left' | 'right';
            if (!['superior', 'inferior', 'anterior', 'posterior', 'left', 'right'].includes(normalized)) continue;
            workingSet = await contourService.applyGrowStructure(workingSet, operation.structureId, distance, normalized);
          }
          break;
        }
        default: {
          // Unsupported margin types fall back to uniform expansion
          if (fallbackMargin !== 0) {
            workingSet = await contourService.applyUniformMargin(workingSet, operation.structureId, fallbackMargin);
          }
          break;
        }
      }

      const resultStructure = workingSet.structures.find((s: any) => s.roiNumber === operation.structureId);
      const resultContours = structuredClone(resultStructure?.contours ?? []);

      if (operation.preview) {
        rt.setPreviewContours(resultContours.map((contour: any) => ({
          slicePosition: contour.slicePosition,
          points: contour.points,
        })));
        return;
      }

      const finalSet = structuredClone(baseStructures);
      let targetRoiNumber: number;

      if (operation.targetStructureId === 'new') {
        const maxRoi = Math.max(0, ...finalSet.structures.map((s: any) => Number(s.roiNumber) || 0));
        targetRoiNumber = maxRoi + 1;
        finalSet.structures.push({
          roiNumber: targetRoiNumber,
          structureName: `${sourceStructure.structureName}_margin`,
          color: structuredClone(sourceStructure.color ?? [59, 130, 246]),
          contours: resultContours,
        });
      } else {
        targetRoiNumber = typeof operation.targetStructureId === 'number'
          ? operation.targetStructureId
          : operation.structureId;

        const targetStructure = finalSet.structures.find((s: any) => s.roiNumber === targetRoiNumber);
        if (!targetStructure) {
          console.warn('[ViewerV2] Margin operation target structure missing', targetRoiNumber);
          return;
        }
        targetStructure.contours = resultContours;
      }

      rt.setStructures(finalSet);
      rt.saveHistory('margin_operation', targetRoiNumber);
      rt.clearPreview();
      setShowMarginToolbar(false);
    } catch (error) {
      console.error('[ViewerV2] Margin operation failed', error);
    } finally {
      if (shouldSetBusy) rt.setBusy(false);
    }
  };

  const handleRtStructureLoad = (rtStructData: any) => {
    if (!rtStructData) return;
    const cloned = structuredClone(rtStructData);
    rt.setStructures(cloned);
    rt.setAllStructuresVisible(true);
    if (rtStructData?.id != null) {
      setLoadedRtSeriesId(Number(rtStructData.id));
    }
    if (Array.isArray(cloned?.structures)) {
      cloned.structures.forEach((structure: any) => {
        if (structure?.roiNumber != null) {
          rt.setStructureVisibility(structure.roiNumber, true);
        }
      });
      const lastStructure = cloned.structures[cloned.structures.length - 1];
      if (lastStructure?.roiNumber != null) {
        rt.setSelectedForEdit(lastStructure.roiNumber);
      }
    }
  };

  const handleStructureColorChange = (structureId: number, color: [number, number, number]) => {
    if (!rt.rtStructures) return;
    const updated = structuredClone(rt.rtStructures);
    const structure = updated.structures.find((s: any) => s.roiNumber === structureId);
    if (structure) {
      structure.color = color;
      rt.setStructures(updated);
    }
  };

  const handleAllStructuresVisibilityChange = (allVisible: boolean) => {
    rt.setAllStructuresVisible(allVisible);
    if (rt.rtStructures?.structures) {
      rt.rtStructures.structures.forEach((structure: any) => {
        if (structure?.roiNumber != null) {
          rt.setStructureVisibility(structure.roiNumber, allVisible);
        }
      });
    }
  };

  const handleLocalizationToggle = () => {
    setShowLocalizationTool((prev) => !prev);
  };

  const handleStructureLocalization = useCallback((structureId: number) => {
    const structures = rt.rtStructures?.structures;
    if (!structures || !Array.isArray(structures)) {
      console.warn('[ViewerV2] Localization skipped - structures unavailable');
      return;
    }

    const structure = structures.find((s: any) => s?.roiNumber === structureId);
    if (!structure || !Array.isArray(structure.contours) || structure.contours.length === 0) {
      console.warn('[ViewerV2] Localization skipped - structure missing contours', structureId);
      return;
    }

    let minZ = Number.POSITIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;
    let totalX = 0;
    let totalY = 0;
    let totalZ = 0;
    let totalPoints = 0;

    structure.contours.forEach((contour: any) => {
      if (!contour || !Array.isArray(contour.points)) return;

      if (typeof contour.slicePosition === 'number' && Number.isFinite(contour.slicePosition)) {
        minZ = Math.min(minZ, contour.slicePosition);
        maxZ = Math.max(maxZ, contour.slicePosition);
      }

      for (let i = 0; i < contour.points.length; i += 3) {
        const x = Number(contour.points[i]);
        const y = Number(contour.points[i + 1]);
        const z = Number(contour.points[i + 2]);
        if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
          totalX += x;
          totalY += y;
          totalZ += z;
          totalPoints += 1;
        }
      }
    });

    if (totalPoints === 0) {
      console.warn('[ViewerV2] Localization skipped - contour points invalid', structureId);
      return;
    }

    const centroidX = totalX / totalPoints;
    const centroidY = totalY / totalPoints;
    const centroidZ = totalZ / totalPoints;
    const targetZ = Number.isFinite(minZ) && Number.isFinite(maxZ) && minZ <= maxZ
      ? (minZ + maxZ) / 2
      : centroidZ;

    if (autoLocalizeTimeoutRef.current) {
      clearTimeout(autoLocalizeTimeoutRef.current);
    }

    setAutoLocalizeTarget({ x: centroidX, y: centroidY, z: targetZ });
    autoLocalizeTimeoutRef.current = setTimeout(() => {
      setAutoLocalizeTarget(null);
      autoLocalizeTimeoutRef.current = null;
    }, 250);
  }, [rt.rtStructures]);

  const handleAutoZoomRequest = useCallback((zoom: number) => {
    if (!Number.isFinite(zoom)) return;
    if (autoZoomTimeoutRef.current) {
      clearTimeout(autoZoomTimeoutRef.current);
    }
    setAutoZoomLevel(zoom);
    autoZoomTimeoutRef.current = setTimeout(() => {
      setAutoZoomLevel(null);
      autoZoomTimeoutRef.current = null;
    }, 200);
  }, []);

  const handleAutoLocalize = useCallback((x: number, y: number, z: number) => {
    if (!showLocalizationTool) {
      return;
    }

    if ([x, y, z].some((value) => !Number.isFinite(value))) {
      console.warn('[ViewerV2] Auto-localize skipped - invalid centroid', { x, y, z });
      return;
    }

    if (autoLocalizeTimeoutRef.current) {
      clearTimeout(autoLocalizeTimeoutRef.current);
    }

    setAutoLocalizeTarget({ x, y, z });
    autoLocalizeTimeoutRef.current = setTimeout(() => {
      setAutoLocalizeTarget(null);
      autoLocalizeTimeoutRef.current = null;
    }, 200);
  }, [showLocalizationTool]);

  // Wrap entire composition with RTProvider so all components can access useRT()
  return (
    <>
      <ViewerShell
        toolbar={null}
        viewport={
        <div className="relative h-full overflow-hidden">
          <PrimaryViewport
            ref={viewportRef}
            seriesId={seriesId}
            studyId={studyId}
            windowLevel={windowLevel}
            autoZoomLevel={autoZoomLevel ?? undefined}
            autoLocalizeTarget={autoLocalizeTarget ?? undefined}
            onWindowLevelChange={setWindowLevel}
            onImageMetadataChange={setImageMetadata}
            onSliceChange={(index) => setCurrentSliceIndex(index)}
          >
            {/* Order: Fusion first (clears), RT second (strokes) */}
            {fusion && <FusionOverlayLayer opacity={fusionOpacity} />}
            <RTOverlayLayer />

            {/* Brush Tool - Active when brush is enabled in RTProvider */}
            <SimpleBrushTool
              canvasRef={viewportRef}
              isActive={rt.brush.enabled}
              brushSize={rt.brush.size}
              selectedStructure={rt.selection.selectedForEdit}
              rtStructures={rt.rtStructures}
              currentSlicePosition={currentSlicePosition}
              onContourUpdate={async (payload: any) => {
                if (!payload.action || !payload.structureId) return;
                
                try {
                  rt.setBusy(true);
                  const service = createContourOperationsService();
                  
                  let updatedStructures = rt.rtStructures;
                  if (payload.action === 'brush_stroke' || payload.action === 'smart_brush_stroke') {
                    updatedStructures = await service.addBrushStroke(
                      rt.rtStructures,
                      payload.structureId,
                      payload.slicePosition,
                      payload.points
                    );
                  } else if (payload.action === 'erase_stroke') {
                    updatedStructures = await service.eraseBrushStroke(
                      rt.rtStructures,
                      payload.structureId,
                      payload.slicePosition,
                      payload.points
                    );
                  }
                  
                  rt.setStructures(updatedStructures);
                  rt.saveHistory(payload.action, payload.structureId);
                } catch (err) {
                  console.error('[SimpleBrushTool] Error:', err);
                } finally {
                  rt.setBusy(false);
                }
              }}
              zoom={viewportRef.current?.zoom ?? 1}
              panX={viewportRef.current?.panX ?? 0}
              panY={viewportRef.current?.panY ?? 0}
              imageMetadata={legacyImageMetadata}
              isEraseMode={rt.brush.mode === 'erase'}
              onBrushSizeChange={(size: number) => rt.setBrushSize(size)}
              ctTransform={null}
            />
            
            {/* Pen Tool - Active when pen is enabled in RTProvider */}
            <PenToolUnifiedV2
              isActive={rt.pen.enabled}
              canvasRef={viewportRef}
              imageMetadata={legacyImageMetadata}
              worldToCanvas={(x: number, y: number): [number, number] => {
                // TODO: Implement proper world-to-canvas transform using viewport zoom/pan
                return [x, y];
              }}
              canvasToWorld={(x: number, y: number): [number, number] => {
                // TODO: Implement proper canvas-to-world transform using viewport zoom/pan
                return [x, y];
              }}
              rtStructures={rt.rtStructures}
              selectedStructure={rt.selection.selectedForEdit}
              onContourUpdate={async (action: string, payload: any) => {
                if (!payload.structureId) return;
                
                try {
                  rt.setBusy(true);
                  const service = createContourOperationsService();
                  
                  let updatedStructures = rt.rtStructures;
                  if (action === 'add_pen_stroke') {
                    updatedStructures = await service.addPenStroke(
                      rt.rtStructures,
                      payload.structureId,
                      payload.slicePosition,
                      payload.points
                    );
                  } else if (action === 'cut_pen_stroke') {
                    updatedStructures = await service.cutPenStroke(
                      rt.rtStructures,
                      payload.structureId,
                      payload.slicePosition,
                      payload.points
                    );
                  }
                  
                  rt.setStructures(updatedStructures);
                  rt.saveHistory(action, payload.structureId);
                } catch (err) {
                  console.error('[PenToolUnifiedV2] Error:', err);
                } finally {
                  rt.setBusy(false);
                }
              }}
            />
          </PrimaryViewport>

          {selectedStructureColors.length > 0 && (
            <div
              className="absolute inset-0 rounded-lg pointer-events-none border"
              style={{ borderColor: selectedStructureColors[0] ?? 'rgba(59,130,246,0.6)' }}
            />
          )}

          {selectedStructureIds.length > 0 && rt.rtStructures?.structures && (
            <div className="absolute right-2 sm:right-4 top-2 sm:top-4 space-y-2 z-10 max-h-[calc(100vh-12rem)] overflow-y-auto">
              <div className="space-y-2 max-w-[200px] sm:max-w-[250px]">
                {selectedStructureIds.map((structureId) => {
                  const structure = rt.rtStructures?.structures?.find((s: any) => s.roiNumber === structureId);
                  if (!structure) return null;
                  const color = Array.isArray(structure.color) ? `rgb(${structure.color.join(',')})` : 'rgb(59,130,246)';
                  return (
                    <div
                      key={structureId}
                      className="flex items-center space-x-2 bg-black/80 backdrop-blur-sm rounded-lg px-2 sm:px-3 py-1.5 sm:py-2 border"
                      style={{ borderColor: color }}
                    >
                      <div
                        className="w-2.5 sm:w-3 h-2.5 sm:h-3 rounded-full border border-gray-400 flex-shrink-0"
                        style={{ backgroundColor: color }}
                      />
                      <span className="text-xs sm:text-sm text-white font-medium truncate">
                        {structure.structureName}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="absolute left-2 bottom-2 z-20 max-h-[60vh] overflow-y-auto hidden sm:block">
            <RTControlPanel />
          </div>
        </div>
        }
        sidebar={
        <SeriesSelector
          series={allSeries}
          selectedSeries={selectedSeriesObj}
          onSeriesSelect={handleSeriesSelect}
          windowLevel={windowLevel}
          onWindowLevelChange={setWindowLevel}
          studyId={studyId}
          rtStructures={rt.rtStructures}
          onRTStructureLoad={handleRtStructureLoad}
          onStructureVisibilityChange={(structureId, visible) => {
            rt.setStructureVisibility(structureId, visible);
          }}
          onStructureColorChange={handleStructureColorChange}
          onStructureSelection={(structureId, selected) => {
            rt.selectStructure(structureId, selected);
            if (selected && showLocalizationTool) {
              handleStructureLocalization(structureId);
            }
          }}
          selectedForEdit={rt.selection.selectedForEdit}
          onSelectedForEditChange={rt.setSelectedForEdit}
          onAllStructuresVisibilityChange={handleAllStructuresVisibilityChange}
          secondarySeriesId={selectedSecondaryId}
          onSecondarySeriesSelect={handleSecondarySeriesSelect}
          previewStructureInfo={previewStructureInfo}
          highlightedStructures={highlightedStructures}
          loadedRTSeriesId={loadedRtSeriesId}
          secondaryLoadingStates={fusionSecondaryLoadingStates}
          currentlyLoadingSecondary={currentlyLoadingSecondary}
          fusionStatuses={fusionSecondaryStatuses}
          fusionCandidatesByPrimary={fusionCandidatesByPrimary}
          fusionSiblingMap={fusionSiblingMap}
          onAutoZoom={handleAutoZoomRequest}
          onAutoLocalize={handleAutoLocalize}
          localizationMode={showLocalizationTool}
        />
      }
      panels={
        showFusionPanel ? (
          <FusionPanel
            minimized={fusionMinimized}
            onToggleMinimized={setFusionMinimized}
            state={fusionPanelState ?? undefined}
          />
        ) : null
      }
      />

      {/* Floating ViewerToolbar (positions itself at bottom center) */}
      <ViewerToolbar
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onFitToWindow={handleResetZoom}
        onPan={handlePan}
        onMeasure={handleMeasure}
        onCrosshairs={handleCrosshairs}
        onContourEdit={handleContourEdit}
        onContourOperations={handleContourOperations}
        onAdvancedMarginTool={handleAdvancedMarginTool}
        isContourEditActive={isContourEditMode}
        isContourOperationsActive={showBooleanOperations}
        isAdvancedMarginToolActive={showMarginToolbar}
        isPanActive={isPanMode}
        isMeasureActive={isMeasureMode}
        isCrosshairsActive={isCrosshairMode}
        onLocalization={handleLocalizationToggle}
        isLocalizationActive={showLocalizationTool}
        onUndo={() => {
          const entry = rt.undoRedo?.undo();
          if (entry) rt.setStructures(entry.rtStructures);
        }}
        onRedo={() => {
          const entry = rt.undoRedo?.redo();
          if (entry) rt.setStructures(entry.rtStructures);
        }}
        canUndo={rt.undoRedo?.canUndo() ?? false}
        canRedo={rt.undoRedo?.canRedo() ?? false}
        historyItems={rt.undoRedo?.getHistory().map(h => ({
          timestamp: h.timestamp,
          action: h.action,
          structureId: h.structureId ?? 0
        })) ?? []}
        currentHistoryIndex={rt.undoRedo?.getCurrentIndex() ?? -1}
        onSelectHistory={(index) => {
          const entry = rt.undoRedo?.jumpTo(index);
          if (entry) rt.setStructures(entry.rtStructures);
        }}
      />

      {/* Contour Edit Toolbar - wired to RTProvider */}
      {isContourEditMode && rt.selection.selectedForEdit && rt.rtStructures && (
        <ContourEditToolbar
          selectedStructure={rt.rtStructures.structures.find((s: any) => s.roiNumber === rt.selection.selectedForEdit) || null}
          isVisible={isContourEditMode}
          onClose={() => {
            setIsContourEditMode(false);
            rt.setSelectedForEdit(null);
          }}
          onStructureNameChange={(name: string) => {
            if (!rt.rtStructures || !rt.selection.selectedForEdit) return;
            const updated = structuredClone(rt.rtStructures);
            const structure = updated.structures.find((s: any) => s.roiNumber === rt.selection.selectedForEdit);
            if (structure) {
              structure.structureName = name;
              rt.setStructures(updated);
            }
          }}
          onStructureColorChange={(color: string) => {
            if (!rt.rtStructures || !rt.selection.selectedForEdit) return;
            const hex = color.replace('#', '');
            const r = parseInt(hex.substring(0, 2), 16);
            const g = parseInt(hex.substring(2, 4), 16);
            const b = parseInt(hex.substring(4, 6), 16);
            const rgb: [number, number, number] = [
              Number.isFinite(r) ? r : 255,
              Number.isFinite(g) ? g : 255,
              Number.isFinite(b) ? b : 255,
            ];
            const updated = structuredClone(rt.rtStructures);
            const structure = updated.structures.find((s: any) => s.roiNumber === rt.selection.selectedForEdit);
            if (structure) {
              structure.color = rgb;
              rt.setStructures(updated);
            }
          }}
          onToolChange={(toolState) => {
            console.log('[ViewerV2] Tool change:', toolState);
            // Wire tool changes to RTProvider
            if (toolState.tool === 'brush') {
              rt.setBrushMode('add');
              rt.setBrushEnabled(true);
              rt.setPenEnabled(false);
            } else if (toolState.tool === 'eraser') {
              rt.setBrushMode('erase');
              rt.setBrushEnabled(true);
              rt.setPenEnabled(false);
            } else if (toolState.tool === 'pen') {
              rt.setPenMode('add');
              rt.setPenEnabled(true);
              rt.setBrushEnabled(false);
            } else if (toolState.tool === 'scissors') {
              rt.setPenMode('cut');
              rt.setPenEnabled(true);
              rt.setBrushEnabled(false);
            } else {
              // Other tools - disable brush/pen
              rt.setBrushEnabled(false);
              rt.setPenEnabled(false);
            }
            
            // Update brush size if provided
            if (toolState.brushSize !== undefined) {
              rt.setBrushSize(toolState.brushSize);
            }
          }}
          currentSlicePosition={currentSlicePosition}
          onContourUpdate={async (payload) => {
            console.log('[ViewerV2] Contour update:', payload);
            if (!rt.rtStructures) return;
            
            try {
              rt.setBusy(true);
              const { createContourOperationsService } = await import('@/rt-structures/services/ContourOperationsService');
              const service = createContourOperationsService();
              
              let updated = rt.rtStructures;
              
              // Handle different contour operations
              if (payload.action === 'smart_brush_stroke' || payload.action === 'brush_add') {
                updated = await service.addBrushStroke(
                  rt.rtStructures,
                  payload.structureId,
                  payload.slicePosition,
                  payload.points
                );
              } else if (payload.action === 'erase_stroke') {
                updated = await service.eraseBrushStroke(
                  rt.rtStructures,
                  payload.structureId,
                  payload.slicePosition,
                  payload.points
                );
              } else if (payload.action === 'add_pen_stroke') {
                updated = await service.addPenStroke(
                  rt.rtStructures,
                  payload.structureId,
                  payload.slicePosition,
                  payload.points
                );
              } else if (payload.action === 'cut_pen_stroke') {
                updated = await service.cutPenStroke(
                  rt.rtStructures,
                  payload.structureId,
                  payload.slicePosition,
                  payload.points
                );
              }
              
              if (updated !== rt.rtStructures) {
                rt.setStructures(updated);
                rt.saveHistory(payload.action, payload.structureId);
              }
            } catch (err) {
              console.error('[ViewerV2] Contour operation failed:', err);
            } finally {
              rt.setBusy(false);
            }
          }}
          availableStructures={rt.rtStructures.structures}
          onTargetStructureSelect={(structureId) => {
            console.log('[ViewerV2] Target structure selected:', structureId);
          }}
          seriesId={seriesId}
          imageMetadata={legacyImageMetadata}
          onOpenBooleanOperations={() => {
            setIsContourEditMode(false);
            setShowMarginToolbar(false);
            setShowBooleanOperations(true);
          }}
          onOpenAdvancedMarginTool={() => {
            setIsContourEditMode(false);
            setShowBooleanOperations(false);
            setShowMarginToolbar(true);
          }}
        />
      )}

      {/* Boolean Operations Toolbar - wired to RTProvider */}
      {showBooleanOperations && rt.rtStructures && (
        <BooleanOperationsToolbar
          isVisible={showBooleanOperations}
          onClose={() => {
            setShowBooleanOperations(false);
            rt.clearPreview();
            setPreviewStructureInfo(null);
            setHighlightedStructures({ inputs: [], output: '' });
          }}
          availableStructures={rt.rtStructures.structures?.map((s: any) => s.structureName) || []}
          structures={rt.rtStructures.structures}
          grid={{
            xSize: 512,
            ySize: 512,
            zSize: 1,
            xRes: 1,
            yRes: 1,
            zRes: 1,
            origin: { x: 0, y: 0, z: 0 }
          }}
          structureColors={(rt.rtStructures.structures || []).reduce((acc: Record<string, string>, s: any) => {
            if (s?.structureName && Array.isArray(s?.color)) {
              acc[s.structureName] = `rgb(${s.color.join(',')})`;
            }
            return acc;
          }, {})}
          onPreview={(target, contours) => {
            rt.setPreviewContours(contours.map((c: any) => ({
              ...c,
              color: [255, 223, 0]
            })));
            setPreviewStructureInfo({
              targetName: target.name ?? '',
              isNewStructure: target.isNewStructure ?? false,
            });
          }}
          onPreviewStateChange={(previewInfo) => {
            if (!previewInfo.targetName) {
              rt.clearPreview();
              setPreviewStructureInfo(null);
            } else {
              setPreviewStructureInfo({
                targetName: previewInfo.targetName,
                isNewStructure: previewInfo.isNewStructure ?? false,
              });
            }
          }}
          onHighlightStructures={(inputs, output) => {
            setHighlightedStructures({ inputs, output });
          }}
          onApply={(target, contours) => {
            if (!rt.rtStructures) return;
            const updated = structuredClone(rt.rtStructures);
            let targetStruct = updated.structures.find((s: any) => s.structureName?.toLowerCase() === (target.name || '').toLowerCase());
            if (!targetStruct) {
              const maxRoi = Math.max(0, ...updated.structures.map((s: any) => s.roiNumber || 0));
              targetStruct = {
                roiNumber: maxRoi + 1,
                structureName: target.name,
                color: target.color || [59, 130, 246],
                contours: []
              };
              updated.structures.push(targetStruct);
            }
            targetStruct.contours = contours;
            rt.setStructures(updated);
            rt.saveHistory('boolean_operation', targetStruct.roiNumber);
            rt.clearPreview();
            setShowBooleanOperations(false);
            setPreviewStructureInfo(null);
            setHighlightedStructures({ inputs: [], output: '' });
          }}
          onExecuteOperation={(expression) => {
            console.log('[ViewerV2] Execute boolean expression:', expression);
          }}
        />
      )}

      {/* Margin Toolbar - wired to RTProvider */}
      {showMarginToolbar && rt.selection.selectedForEdit && rt.rtStructures && (
        <MarginToolbar
          selectedStructure={rt.rtStructures.structures?.find((s: any) => s.roiNumber === rt.selection.selectedForEdit) ? {
            id: rt.selection.selectedForEdit!,
            structureName: rt.rtStructures.structures.find((s: any) => s.roiNumber === rt.selection.selectedForEdit)?.structureName || 'Unknown',
            color: `rgb(${rt.rtStructures.structures.find((s: any) => s.roiNumber === rt.selection.selectedForEdit)?.color?.join(',') || '255,255,255'})`
          } : null}
          isVisible={showMarginToolbar}
          onClose={() => {
            setShowMarginToolbar(false);
            rt.clearPreview();
            setPreviewStructureInfo(null);
          }}
          availableStructures={rt.rtStructures.structures?.map((s: any) => ({
            id: s.roiNumber,
            name: s.structureName
          })) || []}
          onCreateNewStructure={(basedOnId) => {
            const baseStructure = rt.rtStructures?.structures?.find((s: any) => s.roiNumber === basedOnId);
            if (baseStructure && rt.rtStructures) {
              const newName = `${baseStructure.structureName}_margin`;
              const maxRoi = Math.max(0, ...rt.rtStructures.structures.map((s: any) => s.roiNumber || 0));
              const updated = structuredClone(rt.rtStructures);
              updated.structures.push({
                roiNumber: maxRoi + 1,
                structureName: newName,
                color: baseStructure.color,
                contours: []
              });
              rt.setStructures(updated);
              rt.saveHistory('create_structure', maxRoi + 1);
            }
          }}
          onExecuteOperation={handleMarginOperation}
          onPreviewClear={() => {
            rt.clearPreview();
            setPreviewStructureInfo(null);
          }}
        />
      )}
    </>
  );
}

function ViewerV2FusionContent(props: ViewerV2ContentProps) {
  const fusionContext = useFusion();
  const fusionPanelState = useFusionPanelState();
  return (
    <ViewerV2Content
      {...props}
      fusion={fusionContext}
      fusionPanelState={fusionPanelState}
    />
  );
}

// Main component with conditional FusionProvider wrapper
export function ViewerV2({
  patientId,
  seriesId,
  studyId,
  initialSeriesList,
  onLoadedRtSeriesChange,
}: ViewerV2Props) {
  const [activeSeriesId, setActiveSeriesId] = useState<number>(seriesId);
  const [activeStudyId, setActiveStudyId] = useState<number | undefined>(studyId);

  useEffect(() => {
    if (Number.isFinite(seriesId) && seriesId !== activeSeriesId) {
      setActiveSeriesId(seriesId);
    }
  }, [seriesId, activeSeriesId]);

  useEffect(() => {
    if (studyId == null) {
      if (activeStudyId !== undefined) {
        setActiveStudyId(undefined);
      }
      return;
    }
    if (studyId !== activeStudyId) {
      setActiveStudyId(studyId);
    }
  }, [studyId, activeStudyId]);

  const { data: seriesData } = useQuery<any>({
    queryKey: ['series-metadata', activeSeriesId],
    queryFn: async () => {
      if (!Number.isFinite(activeSeriesId)) return null;
      const response = await fetch(`/api/series/${activeSeriesId}`);
      if (!response.ok) return null;
      return response.json();
    },
    enabled: Number.isFinite(activeSeriesId),
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (seriesData?.studyId == null) return;
    const nextStudyId = Number(seriesData.studyId);
    if (Number.isFinite(nextStudyId) && nextStudyId !== activeStudyId) {
      setActiveStudyId(nextStudyId);
    }
  }, [seriesData?.studyId, activeStudyId]);

  const isCT = useMemo(() => {
    const modality = (seriesData?.modality || '').toUpperCase();
    return modality === 'CT';
  }, [seriesData?.modality]);

  const fusionPrimarySeriesId = isCT ? activeSeriesId : null;

  const { data: seriesSelectionData } = useSeriesSelection(activeStudyId);

  const { data: directFusionCandidates = [] } = useFusionCandidates(
    isCT ? activeSeriesId : undefined,
  );

  const candidateSecondaryIds = useMemo(() => {
    if (!fusionPrimarySeriesId) return [];
    if (seriesSelectionData?.fusionCandidates?.length) {
      return seriesSelectionData.fusionCandidates.map((c: any) => c.seriesId);
    }
    return directFusionCandidates.map((c) => c.seriesId);
  }, [fusionPrimarySeriesId, seriesSelectionData?.fusionCandidates, directFusionCandidates]);

  const studyIds = useMemo(
    () => (Number.isFinite(activeStudyId) ? [activeStudyId as number] : undefined),
    [activeStudyId],
  );
  const { data: registrationData } = useRegistrationAssociations(patientId, studyIds);

  const { data: rtSeriesList = [] } = useQuery({
    queryKey: ['study-rt-series', activeStudyId],
    queryFn: async () => {
      if (!Number.isFinite(activeStudyId)) return [];
      const res = await fetch(`/api/studies/${activeStudyId}/rt-structures`);
      if (!res.ok) {
        if (res.status === 404) return [];
        throw new Error('Failed to load RT structure list');
      }
      return res.json();
    },
    enabled: Number.isFinite(activeStudyId),
    staleTime: 5 * 60 * 1000,
  });

  const selectMostRecent = useMemo(() => {
    return (list: any[]): any | null => {
      if (!Array.isArray(list) || list.length === 0) return null;
      return [...list].sort((a, b) => {
        const dateA = (a?.seriesDate || a?.createdAt || '') as string;
        const dateB = (b?.seriesDate || b?.createdAt || '') as string;
        if (dateA && dateB && dateA !== dateB) {
          return dateB.localeCompare(dateA);
        }
        const numberA = Number(a?.seriesNumber) || 0;
        const numberB = Number(b?.seriesNumber) || 0;
        if (numberA !== numberB) return numberB - numberA;
        const idA = Number(a?.id) || 0;
        const idB = Number(b?.id) || 0;
        return idB - idA;
      })[0] ?? null;
    };
  }, []);

  const referencingRtSeries = useMemo(() => {
    if (!rtSeriesList?.length) return [];
    const primaryUid = seriesData?.seriesInstanceUID;
    return rtSeriesList.filter((rt: any) => {
      const byId = Number(rt?.referencedSeriesId) === activeSeriesId;
      const byUid = primaryUid && rt?.referencedSeriesUID === primaryUid;
      return byId || byUid;
    });
  }, [rtSeriesList, activeSeriesId, seriesData?.seriesInstanceUID]);

  const selectedRtSeries = useMemo(() => {
    if (referencingRtSeries.length) {
      return selectMostRecent(referencingRtSeries);
    }
    return selectMostRecent(rtSeriesList);
  }, [referencingRtSeries, rtSeriesList, selectMostRecent]);

  const selectedRtSeriesId = selectedRtSeries?.id ? Number(selectedRtSeries.id) : null;

  useEffect(() => {
    if (!onLoadedRtSeriesChange) return;
    onLoadedRtSeriesChange(Number.isFinite(selectedRtSeriesId) ? selectedRtSeriesId : null);
  }, [onLoadedRtSeriesChange, selectedRtSeriesId]);

  const { data: rtStructures } = useQuery({
    queryKey: ['rt-structures', selectedRtSeriesId],
    queryFn: async () => {
      if (!Number.isFinite(selectedRtSeriesId)) return null;
      const res = await fetch(`/api/rt-structures/${selectedRtSeriesId}/contours`);
      if (!res.ok) {
        if (res.status === 404) return null;
        throw new Error('RT load failed');
      }
      return res.json();
    },
    enabled: Number.isFinite(selectedRtSeriesId),
    staleTime: 5 * 60 * 1000,
  });

  if (import.meta.env.DEV) {
    console.log('🔧 ViewerV2 Setup:', {
      seriesId: activeSeriesId,
      modality: seriesData?.modality,
      isCT,
      fusionPrimarySeriesId,
      candidateCount: candidateSecondaryIds.length,
      registrationCount: registrationData?.size || 0,
      candidatesSource: seriesSelectionData?.fusionCandidates?.length
        ? 'seriesSelection'
        : (directFusionCandidates.length ? 'directAPI' : 'none'),
      skippedFusionCandidatesAPI: !isCT,
      rtSeriesCount: rtSeriesList?.length ?? 0,
      referencingRtSeriesCount: referencingRtSeries.length,
      selectedRtSeriesId,
      rtStructures: rtStructures
        ? {
            loaded: true,
            structureCount: rtStructures.structures?.length || 0,
            referencedSeriesId: selectedRtSeries?.referencedSeriesId ?? null,
            referencedSeriesUID: selectedRtSeries?.referencedSeriesUID ?? null,
          }
        : { loaded: false },
    });
  }

  const handleSeriesChange = useCallback((series: DICOMSeries) => {
    const nextSeriesId = Number(series?.id);
    if (Number.isFinite(nextSeriesId) && nextSeriesId !== activeSeriesId) {
      setActiveSeriesId(nextSeriesId);
    }
    const nextStudyId = Number(series?.studyId);
    if (Number.isFinite(nextStudyId) && nextStudyId !== activeStudyId) {
      setActiveStudyId(nextStudyId);
    }
  }, [activeSeriesId, activeStudyId]);

  const rtProviderKey = `rt-${activeSeriesId}-${selectedRtSeriesId ?? 'none'}`;

  const contentProps: ViewerV2ContentProps = {
    patientId,
    seriesId: activeSeriesId,
    studyId: activeStudyId,
    initialSeriesList,
    candidateSecondaryIds,
    seriesSelectionData,
    registrationData: registrationData ?? null,
    selectedRtSeriesId,
    onSeriesChange: handleSeriesChange,
  };

  const content = (
    <RTProvider key={rtProviderKey} initialStructures={rtStructures ?? null}>
      {isCT && fusionPrimarySeriesId ? (
        <ViewerV2FusionContent {...contentProps} />
      ) : (
        <ViewerV2Content {...contentProps} />
      )}
    </RTProvider>
  );

  return isCT && fusionPrimarySeriesId ? (
    <FusionProvider
      primarySeriesId={fusionPrimarySeriesId}
      candidateSecondaryIds={candidateSecondaryIds}
      registrationAssociations={registrationData || new Map()}
    >
      {content}
    </FusionProvider>
  ) : content;
}
