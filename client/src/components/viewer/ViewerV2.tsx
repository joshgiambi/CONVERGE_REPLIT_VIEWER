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
import { WINDOW_LEVEL_PRESETS, type WindowLevel, type DICOMSeries } from '@/lib/dicom-utils';

interface ViewerV2Props {
  patientId: string;
  seriesId: number;
  studyId?: number;
}

// Inner component that uses fusion context (if available)
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

  // Try to get RT context for undo/redo
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

  return (
    <>
      <ViewerShell
        toolbar={null}
        viewport={
        <RTProvider>
          <PrimaryViewport
            ref={viewportRef}
            seriesId={seriesId}
            studyId={studyId}
          >
            {/* Order: Fusion first (clears), RT second (strokes) */}
            {fusion && <FusionOverlayLayer opacity={fusionOpacity} />}
            <RTOverlayLayer />
          </PrimaryViewport>
        </RTProvider>
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

  // Fetch fusion candidates - use series selection data if available, otherwise direct API
  const { data: directFusionCandidates = [] } = useFusionCandidates(seriesId);

  // Merge fusion candidates from series selection and direct API
  const candidateSecondaryIds = useMemo(() => {
    if (!fusionPrimarySeriesId) return [];
    
    // Prefer series selection data (includes relationship types and confidence)
    if (seriesSelectionData?.fusionCandidates?.length) {
      return seriesSelectionData.fusionCandidates.map((c: any) => c.seriesId);
    }
    
    // Fallback to direct API call
    return directFusionCandidates.map(c => c.seriesId);
  }, [fusionPrimarySeriesId, seriesSelectionData?.fusionCandidates, directFusionCandidates]);

  // Fetch registration associations for this patient/study
  const studyIds = useMemo(() => studyId ? [studyId] : undefined, [studyId]);
  const { data: registrationData } = useRegistrationAssociations(patientId, studyIds);

  if (import.meta.env.DEV) {
    console.log('🔧 ViewerV2 Fusion Setup:', {
      seriesId,
      modality: seriesData?.modality,
      isCT,
      fusionPrimarySeriesId,
      candidateCount: candidateSecondaryIds.length,
      registrationCount: registrationData?.size || 0,
    });
  }

  // Only wrap with FusionProvider if this is a CT series
  if (!isCT || !fusionPrimarySeriesId) {
    return (
      <ViewerV2Content 
        patientId={patientId}
        seriesId={seriesId}
        studyId={studyId}
      />
    );
  }

  return (
    <FusionProvider
      primarySeriesId={fusionPrimarySeriesId}
      candidateSecondaryIds={candidateSecondaryIds}
      registrationAssociations={registrationData || new Map()}
    >
      <ViewerV2Content 
        patientId={patientId}
        seriesId={seriesId}
        studyId={studyId}
      />
    </FusionProvider>
  );
}

