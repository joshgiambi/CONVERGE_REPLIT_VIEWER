// Multi-viewport component for displaying multiple DICOM viewports in a grid
// Foundation for MPR (Multi-Planar Reconstruction) views

import React, { useRef, useEffect, useState } from 'react';
import { useViewportGrid, Viewport } from '@/lib/viewport-grid-service';
import { WorkingViewer } from './working-viewer';
import { Button } from '@/components/ui/button';
import { 
  Maximize2, 
  Grid3X3, 
  Grid2x2,
  LayoutGrid,
  Columns,
  Activity
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface MultiViewportProps {
  studyId: number;
  initialSeriesId?: number;
  rtStructures: any;
  onRTStructureUpdate: (structures: any) => void;
  allStructuresVisible: boolean;
  onAllStructuresVisibilityChange: (visible: boolean) => void;
  imageCache?: React.MutableRefObject<Map<string, { images: any[], metadata: any }>>;
}

const MultiViewport: React.FC<MultiViewportProps> = ({
  studyId,
  initialSeriesId,
  rtStructures,
  onRTStructureUpdate,
  allStructuresVisible,
  onAllStructuresVisibilityChange,
  imageCache
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const { grid, setLayout, setActiveViewport, assignSeries } = useViewportGrid();
  const [viewportDimensions, setViewportDimensions] = useState<Map<string, DOMRect>>(new Map());

  // Calculate viewport dimensions when grid or container changes
  useEffect(() => {
    const calculateDimensions = () => {
      if (!containerRef.current) return;
      
      const { width, height } = containerRef.current.getBoundingClientRect();
      const cellWidth = width / grid.cols;
      const cellHeight = height / grid.rows;
      
      const dimensions = new Map<string, DOMRect>();
      
      grid.viewports.forEach(viewport => {
        const x = viewport.position.col * cellWidth;
        const y = viewport.position.row * cellHeight;
        const width = viewport.position.width * cellWidth;
        const height = viewport.position.height * cellHeight;
        
        dimensions.set(viewport.id, new DOMRect(x, y, width, height));
      });
      
      setViewportDimensions(dimensions);
    };

    calculateDimensions();

    const resizeObserver = new ResizeObserver(calculateDimensions);
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => resizeObserver.disconnect();
  }, [grid]);

  // Handle viewport click
  const handleViewportClick = (viewportId: string) => {
    setActiveViewport(viewportId);
  };

  // Handle series selection for viewport
  const handleSeriesSelect = (viewportId: string, seriesId: number) => {
    // This would be called from series selector
    assignSeries(viewportId, seriesId.toString());
  };

  const renderViewport = (viewport: Viewport) => {
    const dimensions = viewportDimensions.get(viewport.id);
    if (!dimensions) return null;

    const isActive = viewport.isActive;
    const borderColor = isActive ? 'border-blue-500' : 'border-gray-600';
    const borderWidth = isActive ? 'border-2' : 'border';

    return (
      <div
        key={viewport.id}
        className={cn(
          "absolute overflow-hidden bg-black transition-all duration-200",
          borderWidth,
          borderColor,
          isActive && "z-10"
        )}
        style={{
          left: `${dimensions.x}px`,
          top: `${dimensions.y}px`,
          width: `${dimensions.width}px`,
          height: `${dimensions.height}px`,
        }}
        onClick={() => handleViewportClick(viewport.id)}
      >
        {viewport.seriesInstanceUID ? (
          <div className="relative w-full h-full">
            <WorkingViewer
              studyId={studyId}
              seriesId={parseInt(viewport.seriesInstanceUID)}
              rtStructures={rtStructures}
              onContourUpdate={onRTStructureUpdate}
              allStructuresVisible={allStructuresVisible}
              imageCache={imageCache}
              orientation={
                viewport.type === 'MPR_SAGITTAL' ? 'sagittal' :
                viewport.type === 'MPR_CORONAL' ? 'coronal' : 
                'axial'
              }
            />
            
            {/* Viewport overlay info */}
            <div className="absolute top-2 left-2 text-white text-xs bg-black/50 px-2 py-1 rounded">
              {viewport.type === 'MPR_AXIAL' && 'Axial'}
              {viewport.type === 'MPR_SAGITTAL' && 'Sagittal'}
              {viewport.type === 'MPR_CORONAL' && 'Coronal'}
              {viewport.type === 'CT' && `Viewport ${viewport.id.split('-')[1]}`}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-gray-500">
            <div className="text-center">
              <LayoutGrid className="w-12 h-12 mx-auto mb-2" />
              <p className="text-sm">No series selected</p>
              <p className="text-xs mt-1">Drop a series here</p>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full">
      {/* Layout controls */}
      <div className="flex items-center gap-2 p-2 bg-gray-900 border-b border-gray-700">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setLayout('1x1', initialSeriesId?.toString())}
          className={cn(
            "text-gray-400 hover:text-white",
            grid.rows === 1 && grid.cols === 1 && "bg-gray-800 text-white"
          )}
          title="Single viewport"
        >
          <Maximize2 className="w-4 h-4" />
        </Button>
        
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setLayout('1x2', initialSeriesId?.toString())}
          className={cn(
            "text-gray-400 hover:text-white",
            grid.rows === 1 && grid.cols === 2 && "bg-gray-800 text-white"
          )}
          title="Side by side"
        >
          <Columns className="w-4 h-4" />
        </Button>
        
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setLayout('2x2', initialSeriesId?.toString())}
          className={cn(
            "text-gray-400 hover:text-white",
            grid.rows === 2 && grid.cols === 2 && !grid.viewports[0]?.syncGroup && "bg-gray-800 text-white"
          )}
          title="2x2 grid"
        >
          <Grid2x2 className="w-4 h-4" />
        </Button>
        
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setLayout('3x3', initialSeriesId?.toString())}
          className={cn(
            "text-gray-400 hover:text-white",
            grid.rows === 3 && grid.cols === 3 && "bg-gray-800 text-white"
          )}
          title="3x3 grid"
        >
          <Grid3X3 className="w-4 h-4" />
        </Button>

        <div className="h-4 w-px bg-gray-700 mx-1" />
        
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setLayout('MPR', initialSeriesId?.toString())}
          className={cn(
            "text-gray-400 hover:text-white flex items-center gap-1",
            grid.viewports[0]?.syncGroup === 'mpr' && "bg-gray-800 text-white"
          )}
          title="Multi-planar reconstruction"
        >
          <Activity className="w-4 h-4" />
          <span className="text-xs">MPR</span>
        </Button>

        <div className="ml-auto text-xs text-gray-400">
          {grid.viewports.length} viewport{grid.viewports.length !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Viewport grid container */}
      <div 
        ref={containerRef}
        className="flex-1 relative bg-black"
      >
        {grid.viewports.map(renderViewport)}
      </div>
    </div>
  );
};

export default MultiViewport;