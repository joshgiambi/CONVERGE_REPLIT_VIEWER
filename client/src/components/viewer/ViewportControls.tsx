/**
 * ViewportControls Component
 * 
 * Toolbar buttons for viewport operations (zoom, pan, measure, etc.)
 * Extracted from viewer-interface.tsx toolbar handlers
 * 
 * Agent 1: Viewer Core
 * Created: Hour 10-14
 */

import { ZoomIn, ZoomOut, Maximize2, Hand, Crosshair, Ruler } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ViewportControlsProps } from '@/types/viewer';

export function ViewportControls({
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onPan,
  onMeasure,
  onCrosshairs,
  isPanActive = false,
  isCrosshairsActive = false,
  isMeasureActive = false,
  className = '',
}: ViewportControlsProps) {
  return (
    <div className={`flex items-center gap-2 bg-gray-900/90 backdrop-blur-sm px-4 py-2 rounded-lg shadow-lg ${className}`}>
      {/* Zoom Controls */}
      <div className="flex items-center gap-1 border-r border-gray-700 pr-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onZoomIn}
          className="text-white hover:bg-gray-700"
          title="Zoom In (Ctrl+Scroll)"
        >
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onZoomOut}
          className="text-white hover:bg-gray-700"
          title="Zoom Out (Ctrl+Scroll)"
        >
          <ZoomOut className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onResetZoom}
          className="text-white hover:bg-gray-700"
          title="Reset Zoom & Pan"
        >
          <Maximize2 className="h-4 w-4" />
        </Button>
      </div>

      {/* Tool Selection */}
      <div className="flex items-center gap-1 border-r border-gray-700 pr-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onPan}
          className={`text-white hover:bg-gray-700 ${isPanActive ? 'bg-blue-600 hover:bg-blue-700' : ''}`}
          title="Pan Tool (Left Drag)"
        >
          <Hand className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onCrosshairs}
          className={`text-white hover:bg-gray-700 ${isCrosshairsActive ? 'bg-blue-600 hover:bg-blue-700' : ''}`}
          title="Crosshairs"
        >
          <Crosshair className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onMeasure}
          className={`text-white hover:bg-gray-700 ${isMeasureActive ? 'bg-blue-600 hover:bg-blue-700' : ''}`}
          title="Measure Tool"
        >
          <Ruler className="h-4 w-4" />
        </Button>
      </div>

      {/* Rotate/Flip controls removed - not implemented yet */}
      {/* TODO: Add back when rotation/flip implemented in useViewportInteractions */}
    </div>
  );
}

