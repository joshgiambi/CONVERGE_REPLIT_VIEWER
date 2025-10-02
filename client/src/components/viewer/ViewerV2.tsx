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
import { ViewportControls } from './ViewportControls';
import { useViewportTools } from '@/hooks/useViewportTools';
import { RTProvider } from '@/rt-structures/RTProvider';
import RTOverlayLayer from '@/rt-structures/components/RTOverlayLayer';
import RTControlPanel from '@/rt-structures/components/RTControlPanel';
import FusionOverlayLayer from '@/fusion/components/FusionOverlayLayer';
import { FusionProvider, useFusion } from '@/fusion/fusion-context';
import { FusionPanel } from '@/fusion/components/FusionPanel';
import { useFusionCandidates, useSeriesSelection } from '@/hooks/use-series-selection';
import { useRegistrationAssociations } from '@/hooks/useRegistrationAssociations';
import { useQuery } from '@tanstack/react-query';

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

  // Try to get fusion context - may not exist if not a CT series
  let fusion: any = null;
  try {
    fusion = useFusion();
  } catch {
    // FusionProvider not present - this is expected for non-CT series
  }

  // Viewport control handlers
  const handleZoomIn = () => viewportRef.current?.zoomIn();
  const handleZoomOut = () => viewportRef.current?.zoomOut();
  const handleResetZoom = () => viewportRef.current?.resetZoom();
  const handlePan = () => setMode('pan');
  const handleCrosshairs = () => setMode('crosshairs');
  const handleMeasure = () => setMode('measure');

  const fusionOpacity = fusion?.opacity ?? 0.5;
  const showFusionPanel = fusion?.showFusionPanel ?? false;

  return (
    <ViewerShell
      toolbar={
        <ViewportControls
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onResetZoom={handleResetZoom}
          onPan={handlePan}
          onCrosshairs={handleCrosshairs}
          onMeasure={handleMeasure}
          isPanActive={isPanMode}
          isCrosshairsActive={isCrosshairMode}
          isMeasureActive={isMeasureMode}
        />
      }
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
        <div className="text-white p-4">
          <h2 className="text-xl font-bold mb-4">Series Selector</h2>
          <p className="text-gray-400">Series selector will be added by Agent 5 during integration</p>
          <div className="mt-4 p-3 bg-gray-800 rounded">
            <p className="text-sm text-gray-300">Viewing Series {seriesId}</p>
            {studyId && <p className="text-sm text-gray-300">Study {studyId}</p>}
            <p className="text-sm text-gray-300">Patient {patientId}</p>
          </div>
        </div>
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

