/**
 * ViewerV2 Component
 * 
 * New viewer architecture - composes PrimaryViewport + ViewportControls + ViewerShell
 * This is the main entry point for the refactored viewer.
 * 
 * Agent 1: Viewer Core
 * Created: Hour 14-18
 */

import { useRef } from 'react';
import { ViewerShell } from './ViewerShell';
import { PrimaryViewport } from './PrimaryViewport';
import { ViewportControls } from './ViewportControls';
import { useViewportTools } from '@/hooks/useViewportTools';

interface ViewerV2Props {
  patientId: string;
  seriesId: number;
  studyId?: number;
}

export function ViewerV2({ patientId, seriesId, studyId }: ViewerV2Props) {
  const viewportRef = useRef<any>(null);
  const { activeTool, setMode, isPanMode, isCrosshairMode, isMeasureMode } = useViewportTools();

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
        <PrimaryViewport
          ref={viewportRef}
          seriesId={seriesId}
          studyId={studyId}
        />
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
        <div className="absolute bottom-4 right-4 bg-gray-900/90 backdrop-blur-sm p-3 rounded text-white text-xs font-mono">
          <div className="text-green-400 font-bold mb-1">✓ ViewerV2 Active</div>
          <div>Tool: {activeTool}</div>
          <div className="text-gray-400 mt-2">Fusion: Agent 2</div>
          <div className="text-gray-400">RT: Agent 3</div>
        </div>
      }
    />
  );
}

