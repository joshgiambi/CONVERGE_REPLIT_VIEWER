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

import { useRef, useState, useMemo } from 'react';
import { ViewerShell } from './ViewerShell';
import { PrimaryViewport } from './PrimaryViewport';
import { useViewportTools } from '@/hooks/useViewportTools';
import { RTProvider, useRT } from '@/rt-structures/RTProvider';
import RTOverlayLayer from '@/rt-structures/components/RTOverlayLayer';
import RTControlPanel from '@/rt-structures/components/RTControlPanel';
import FusionOverlayLayer from '@/fusion/components/FusionOverlayLayer';
import { FusionProvider, useFusion } from '@/fusion/fusion-context';
import { FusionPanel } from '@/fusion/components/FusionPanel';
import { useFusionCandidates, useSeriesSelection } from '@/hooks/use-series-selection';
import { useRegistrationAssociations } from '@/hooks/useRegistrationAssociations';
import { useQuery } from '@tanstack/react-query';
import { ViewerToolbar } from '@/components/dicom/viewer-toolbar';
import { SeriesSelector } from '@/components/dicom/series-selector';
import { ContourEditToolbar } from '@/components/dicom/contour-edit-toolbar';
import { BooleanOperationsToolbar } from '@/components/dicom/boolean-operations-toolbar-new';
import { MarginToolbar } from '@/components/dicom/margin-toolbar';
import { WINDOW_LEVEL_PRESETS, type WindowLevel, type DICOMSeries } from '@/lib/dicom-utils';
import { createContourOperationsService } from '@/rt-structures/services/ContourOperationsService';

interface ViewerV2Props {
  patientId: string;
  seriesId: number;
  studyId?: number;
}

// Inner component that uses both fusion and RT contexts
function ViewerV2Content({ patientId, seriesId, studyId }: ViewerV2Props) {
  const viewportRef = useRef<any>(null);
  const { activeTool, setMode, isPanMode, isCrosshairMode, isMeasureMode } = useViewportTools();
  const [fusionMinimized, setFusionMinimized] = useState(false);
  
  // State for floating toolbars
  const [isContourEditMode, setIsContourEditMode] = useState(false);
  const [showBooleanOperations, setShowBooleanOperations] = useState(false);
  const [showMarginToolbar, setShowMarginToolbar] = useState(false);

  // State for series selector
  const [windowLevel, setWindowLevel] = useState<WindowLevel>(WINDOW_LEVEL_PRESETS.abdomen);
  const [currentSeriesId, setCurrentSeriesId] = useState<number>(seriesId);

  // Fetch all series for the patient
  const { data: allSeries = [], isLoading: seriesLoading } = useQuery<DICOMSeries[]>({
    queryKey: ['patient-series', patientId],
    queryFn: async () => {
      const response = await fetch(`/api/patients/${patientId}/series`);
      if (!response.ok) return [];
      const data = await response.json();
      return data.series || [];
    },
    enabled: !!patientId,
    staleTime: 5 * 60 * 1000,
  });

  // Find the selected series object
  const selectedSeriesObj = useMemo(() => {
    return allSeries.find((s: DICOMSeries) => s.id === currentSeriesId) || null;
  }, [allSeries, currentSeriesId]);

  // Handle series selection change
  const handleSeriesSelect = (series: DICOMSeries) => {
    setCurrentSeriesId(series.id);
    // TODO: Navigate to new series (would need to update URL or notify parent)
  };

  // Try to get fusion context - may not exist if not a CT series
  let fusion: any = null;
  try {
    fusion = useFusion();
  } catch {
    // FusionProvider not present - this is expected for non-CT series
  }

  // Get RT context - now safe because RTProvider wraps this component
  const rt = useRT();

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

  const fusionOpacity = fusion?.opacity ?? 0.5;
  const showFusionPanel = fusion?.showFusionPanel ?? false;

  // Wrap entire composition with RTProvider so all components can access useRT()
  return (
    <>
      <ViewerShell
        toolbar={null}
        viewport={
          <PrimaryViewport
            ref={viewportRef}
            seriesId={seriesId}
            studyId={studyId}
          >
            {/* Order: Fusion first (clears), RT second (strokes) */}
            {fusion && <FusionOverlayLayer opacity={fusionOpacity} />}
            <RTOverlayLayer />
          </PrimaryViewport>
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
          onStructureVisibilityChange={(structureId, visible) => {
            rt.setStructureVisibility(structureId, visible);
          }}
          selectedForEdit={rt.selection.selectedForEdit}
          onSelectedForEditChange={rt.setSelectedForEdit}
          onAllStructuresVisibilityChange={rt.setAllStructuresVisible}
        />
      }
      panels={
        <div className="absolute bottom-4 right-4 space-y-2">
          {/* Debug badge */}
          <div className="bg-gray-900/90 backdrop-blur-sm p-3 rounded text-white text-xs font-mono">
            <div className="text-green-400 font-bold mb-1">✓ ViewerV2 Active</div>
            <div>Tool: {activeTool}</div>
            <div className="text-gray-400 mt-2">Fusion: {showFusionPanel ? 'Ready' : 'N/A'}</div>
            <div className="text-gray-400">RT: Provider Active</div>
          </div>
          
          {/* Fusion Panel */}
          {showFusionPanel && (
            <div className="bg-black/80 border border-gray-700 rounded-md p-2">
              <FusionPanel 
                minimized={fusionMinimized}
                onToggleMinimized={setFusionMinimized}
              />
            </div>
          )}
          
          {/* RT Control Panel */}
          <div className="bg-black/70 border border-gray-700 rounded-md p-2">
            <RTControlPanel />
          </div>
        </div>
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
          currentSlicePosition={0}
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
          imageMetadata={null}
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
          }}
          onPreviewStateChange={(previewInfo) => {
            if (!previewInfo.targetName) {
              rt.clearPreview();
            }
          }}
          onHighlightStructures={(inputs, output) => {
            console.log('[ViewerV2] Highlight structures:', inputs, output);
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
          onClose={() => setShowMarginToolbar(false)}
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
          onExecuteOperation={(operation) => {
            console.log('[ViewerV2] Margin operation:', operation);
            if (operation.preview) {
              // TODO: Wire to margin preview
            } else {
              // TODO: Wire to margin execution
              setShowMarginToolbar(false);
            }
          }}
          onPreviewClear={() => {
            rt.clearPreview();
          }}
        />
      )}
    </>
  );
}

// Main component with conditional FusionProvider wrapper
export function ViewerV2({ patientId, seriesId, studyId }: ViewerV2Props) {
  // Fetch series metadata to check modality
  const { data: seriesData } = useQuery<any>({
    queryKey: ['series-metadata', seriesId],
    queryFn: async () => {
      const response = await fetch(`/api/series/${seriesId}`);
      if (!response.ok) return null;
      return response.json();
    },
    enabled: !!seriesId,
    staleTime: 5 * 60 * 1000,
  });

  // Determine if this is a CT series (required for fusion primary)
  const isCT = useMemo(() => {
    const modality = (seriesData?.modality || '').toUpperCase();
    return modality === 'CT';
  }, [seriesData?.modality]);

  // Only compute fusion data if this is a CT series
  const fusionPrimarySeriesId = isCT ? seriesId : null;

  // Fetch series selection data (includes planning CT and fusion candidates)
  const { data: seriesSelectionData } = useSeriesSelection(studyId);

  // Only fetch fusion candidates if this is a CT series (optimization)
  const { data: directFusionCandidates = [] } = useFusionCandidates(
    isCT ? seriesId : undefined // Skip API call if not CT
  );

  // Merge fusion candidates from series selection and direct API
  const candidateSecondaryIds = useMemo(() => {
    if (!fusionPrimarySeriesId) return [];
    
    // Prefer series selection data (includes relationship types and confidence)
    if (seriesSelectionData?.fusionCandidates?.length) {
      return seriesSelectionData.fusionCandidates.map((c: any) => c.seriesId);
    }
    
    // Fallback to direct API call (only happens for CT series)
    return directFusionCandidates.map(c => c.seriesId);
  }, [fusionPrimarySeriesId, seriesSelectionData?.fusionCandidates, directFusionCandidates]);

  // Fetch registration associations for this patient/study
  const studyIds = useMemo(() => studyId ? [studyId] : undefined, [studyId]);
  const { data: registrationData } = useRegistrationAssociations(patientId, studyIds);

  // Fetch RT structure series for the study (mirrors legacy viewer flow)
  const { data: rtSeriesList = [] } = useQuery({
    queryKey: ['study-rt-series', studyId],
    queryFn: async () => {
      if (!Number.isFinite(studyId)) return [];
      const res = await fetch(`/api/studies/${studyId}/rt-structures`);
      if (!res.ok) {
        if (res.status === 404) return [];
        throw new Error('Failed to load RT structure list');
      }
      return res.json();
    },
    enabled: Number.isFinite(studyId),
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
      const byId = Number(rt?.referencedSeriesId) === seriesId;
      const byUid = primaryUid && rt?.referencedSeriesUID === primaryUid;
      return byId || byUid;
    });
  }, [rtSeriesList, seriesId, seriesData?.seriesInstanceUID]);

  const selectedRtSeries = useMemo(() => {
    if (referencingRtSeries.length) {
      return selectMostRecent(referencingRtSeries);
    }
    return selectMostRecent(rtSeriesList);
  }, [referencingRtSeries, rtSeriesList, selectMostRecent]);

  const selectedRtSeriesId = selectedRtSeries?.id ? Number(selectedRtSeries.id) : null;

  // Fetch RT structures for the chosen RTSTRUCT series
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
      seriesId,
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
      rtStructures: rtStructures ? {
        loaded: true,
        structureCount: rtStructures.structures?.length || 0,
        referencedSeriesId: selectedRtSeries?.referencedSeriesId ?? null,
        referencedSeriesUID: selectedRtSeries?.referencedSeriesUID ?? null,
      } : { loaded: false },
    });
  }

  // RTProvider wraps entire viewer composition so all components can access useRT()
  // Pass fetched RT structures as initialStructures to avoid null state issues
  const content = (
    <RTProvider initialStructures={rtStructures ?? null}>
      <ViewerV2Content 
        patientId={patientId}
        seriesId={seriesId}
        studyId={studyId}
      />
    </RTProvider>
  );

  // Conditionally wrap with FusionProvider for CT series
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
