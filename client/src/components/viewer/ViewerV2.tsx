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

import { useRef, useState } from 'react';
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
import { useFusionCandidates } from '@/hooks/use-series-selection';
import { useQuery } from '@tanstack/react-query';

interface ViewerV2Props {
  patientId: string;
  seriesId: number;
  studyId?: number;
}

// Inner component that uses fusion context
function ViewerV2Content({ patientId, seriesId, studyId }: ViewerV2Props) {
  const viewportRef = useRef<any>(null);
  const { activeTool, setMode, isPanMode, isCrosshairMode, isMeasureMode } = useViewportTools();
  const fusion = useFusion();
  const [fusionMinimized, setFusionMinimized] = useState(false);

  // Viewport control handlers
  const handleZoomIn = () => viewportRef.current?.zoomIn();
  const handleZoomOut = () => viewportRef.current?.zoomOut();
  const handleResetZoom = () => viewportRef.current?.resetZoom();
  const handlePan = () => setMode('pan');
  const handleCrosshairs = () => setMode('crosshairs');
  const handleMeasure = () => setMode('measure');

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
            <FusionOverlayLayer opacity={fusion.opacity} />
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
            <div className="text-gray-400 mt-2">Fusion: {fusion.showFusionPanel ? 'Ready' : 'N/A'}</div>
            <div className="text-gray-400">RT: Provider Active</div>
          </div>
          
          {/* Fusion Panel */}
          {fusion.showFusionPanel && (
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

// Main component with FusionProvider wrapper
export function ViewerV2({ patientId, seriesId, studyId }: ViewerV2Props) {
  // Fetch fusion candidates for this series
  const { data: fusionCandidates = [], isLoading: candidatesLoading } = useFusionCandidates(seriesId);
  
  // Fetch registration associations (simplified for now - can be enhanced later)
  const { data: registrationData } = useQuery<Map<number, any[]>>({
    queryKey: ['registration-associations', seriesId],
    queryFn: async () => {
      // For now, return empty Map - registration associations can be added later
      return new Map();
    },
    enabled: !!seriesId,
  });

  const candidateSecondaryIds = fusionCandidates.map(c => c.seriesId);

  return (
    <FusionProvider
      primarySeriesId={seriesId}
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

