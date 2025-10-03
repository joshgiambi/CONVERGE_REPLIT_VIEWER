/**
 * ViewportMetadataOverlay Component
 * 
 * Displays image metadata overlay on top of viewport:
 * - Slice counter
 * - Window/Level values
 * - Z position
 * - Modality badge
 * 
 * Agent 5B: UI Parity fixes
 */

import { Badge } from '@/components/ui/badge';
import type { WindowLevel } from '@/types/viewer';

interface ViewportMetadataOverlayProps {
  modality?: string;
  currentIndex: number;
  totalSlices: number;
  windowLevel: WindowLevel;
  zPosition?: number | null;
  orientation?: 'axial' | 'sagittal' | 'coronal';
}

export function ViewportMetadataOverlay({
  modality = 'CT',
  currentIndex,
  totalSlices,
  windowLevel,
  zPosition,
  orientation = 'axial',
}: ViewportMetadataOverlayProps) {
  return (
    <div className="absolute top-0 left-0 right-0 z-10 p-3 border-b border-gray-700/50 pointer-events-none">
      <div 
        className="backdrop-blur-md border rounded-xl px-4 py-3 shadow-lg flex items-center justify-between pointer-events-auto"
        style={{ 
          backgroundColor: '#1a1a1a95',
          borderColor: '#4a5568'
        }}
      >
        <div className="flex items-center space-x-2">
          {/* Modality Badge */}
          <Badge className="bg-blue-900/60 text-blue-200 border border-blue-600/30 backdrop-blur-sm">
            {modality} Scan {orientation !== 'axial' && `- ${orientation.charAt(0).toUpperCase() + orientation.slice(1)}`}
          </Badge>
          
          {/* Slice Counter */}
          {totalSlices > 0 && (
            <Badge
              variant="outline"
              className="border-gray-500/50 text-gray-300 bg-gray-800/40 backdrop-blur-sm"
            >
              {currentIndex + 1} / {totalSlices}
            </Badge>
          )}
          
          {/* Window */}
          <Badge className="bg-cyan-900/40 text-cyan-200 border border-cyan-600/30 backdrop-blur-sm">
            W: {Math.round(windowLevel.window)}
          </Badge>
          
          {/* Level */}
          <Badge className="bg-orange-900/40 text-orange-200 border border-orange-600/30 backdrop-blur-sm">
            L: {Math.round(windowLevel.level)}
          </Badge>
          
          {/* Z Position (only for axial) */}
            {orientation === 'axial' && zPosition != null && (
              <Badge className="bg-purple-900/40 text-purple-200 border border-purple-600/30 backdrop-blur-sm">
                Z: {typeof zPosition === 'number' ? zPosition.toFixed(1) : zPosition} mm
              </Badge>
            )}
        </div>

        {/* Right side - could add loading indicators, etc */}
        <div className="flex items-center space-x-2">
          {/* Reserved for future use */}
        </div>
      </div>
    </div>
  );
}

