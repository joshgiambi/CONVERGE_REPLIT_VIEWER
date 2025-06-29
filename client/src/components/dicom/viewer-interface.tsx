import { useState, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SeriesSelector } from './series-selector';
import { WorkingViewer } from './working-viewer';
import { EnhancedViewerWithContours } from './enhanced-viewer-with-contours';
import { ViewerToolbar } from './viewer-toolbar';
import { ErrorModal } from './error-modal';
import { ContourEditorPanel } from './contour-editor-panel';
import { DICOMSeries, DICOMStudy, WindowLevel, WINDOW_LEVEL_PRESETS } from '@/lib/dicom-utils';
import { cornerstoneConfig } from '@/lib/cornerstone-config';
import { Button } from '@/components/ui/button';

interface ViewerInterfaceProps {
  studyData: any;
}

export function ViewerInterface({ studyData }: ViewerInterfaceProps) {
  const [selectedSeries, setSelectedSeries] = useState<DICOMSeries | null>(null);
  const [windowLevel, setWindowLevel] = useState<WindowLevel>(WINDOW_LEVEL_PRESETS.abdomen);
  const [error, setError] = useState<any>(null);
  const [series, setSeries] = useState<DICOMSeries[]>([]);
  const [viewMode, setViewMode] = useState<'single' | 'mpr'>('single');
  const [rtStructures, setRTStructures] = useState<any>(null);
  const [structureVisibility, setStructureVisibility] = useState<Map<number, boolean>>(new Map());
  
  // Contour editing state
  const [contourMode, setContourMode] = useState<boolean>(false);
  const [editMode, setEditMode] = useState<'view' | 'brush' | 'eraser' | 'polygon'>('view');
  const [selectedStructure, setSelectedStructure] = useState<number | null>(null);
  const [brushSettings, setBrushSettings] = useState({
    size: 10,
    opacity: 1.0,
    mode: 'paint' as 'paint' | 'erase'
  });

  // Fetch series data for the study
  const { data: seriesData, isLoading } = useQuery({
    queryKey: ['/api/studies', studyData.studies[0]?.id, 'series'],
    queryFn: async () => {
      const studyId = studyData.studies[0]?.id;
      if (!studyId) throw new Error('No study ID');
      
      const response = await fetch(`/api/studies/${studyId}/series`);
      if (!response.ok) {
        throw new Error(`Failed to fetch series: ${response.statusText}`);
      }
      return response.json();
    },
    enabled: !!studyData.studies?.[0]?.id,
  });

  useEffect(() => {
    if (seriesData && Array.isArray(seriesData)) {
      setSeries(seriesData);
      
      // Auto-select first series
      if (seriesData.length > 0 && !selectedSeries) {
        handleSeriesSelect(seriesData[0]);
      }
    }
  }, [seriesData, selectedSeries]);

  const handleSeriesSelect = async (seriesData: DICOMSeries) => {
    try {
      // Fetch images for the selected series
      const response = await fetch(`/api/series/${seriesData.id}`);
      if (!response.ok) {
        throw new Error('Failed to fetch series images');
      }
      
      const seriesWithImages = await response.json();
      setSelectedSeries(seriesWithImages);
      
      // Apply default window/level if available from first image
      if (seriesWithImages.images?.length > 0) {
        const firstImage = seriesWithImages.images[0];
        if (firstImage.windowCenter && firstImage.windowWidth) {
          setWindowLevel({
            level: parseFloat(firstImage.windowCenter),
            window: parseFloat(firstImage.windowWidth)
          });
        }
      }
      
    } catch (error) {
      console.error('Error selecting series:', error);
      setError({
        title: 'Error Loading Series',
        message: 'Failed to load the selected series.',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  };

  // Zoom handlers for toolbar
  const handleZoomIn = useCallback(() => {
    try {
      // Pass zoom command to working viewer
      if ((window as any).currentViewerZoom?.zoomIn) {
        (window as any).currentViewerZoom.zoomIn();
      }
    } catch (error) {
      console.warn('Error zooming in:', error);
    }
  }, []);

  const handleZoomOut = useCallback(() => {
    try {
      // Pass zoom command to working viewer  
      if ((window as any).currentViewerZoom?.zoomOut) {
        (window as any).currentViewerZoom.zoomOut();
      }
    } catch (error) {
      console.warn('Error zooming out:', error);
    }
  }, []);

  const handleResetZoom = useCallback(() => {
    try {
      // Pass reset zoom command to working viewer
      if ((window as any).currentViewerZoom?.resetZoom) {
        (window as any).currentViewerZoom.resetZoom();
      }
    } catch (error) {
      console.warn('Error resetting zoom:', error);
    }
  }, []);

  const setActiveTool = (toolName: string) => {
    try {
      const cornerstoneTools = cornerstoneConfig.getCornerstoneTools();
      const elements = document.querySelectorAll('.cornerstone-viewport');
      
      elements.forEach((element: any) => {
        if (element) {
          cornerstoneTools.setToolActiveForElement(element, toolName, { mouseButtonMask: 1 });
        }
      });
    } catch (error) {
      console.warn('Error setting active tool:', error);
    }
  };

  const handlePanTool = () => setActiveTool('Pan');
  const handleMeasureTool = () => setActiveTool('Length');
  const handleAnnotateTool = () => setActiveTool('ArrowAnnotate');

  const handleRotate = () => {
    try {
      const cornerstone = cornerstoneConfig.getCornerstone();
      const elements = document.querySelectorAll('.cornerstone-viewport');
      
      elements.forEach((element: any) => {
        if (element) {
          const viewport = cornerstone.getViewport(element);
          if (viewport) {
            viewport.rotation += 90;
            cornerstone.setViewport(element, viewport);
          }
        }
      });
    } catch (error) {
      console.warn('Error rotating image:', error);
    }
  };

  const handleFlip = () => {
    try {
      const cornerstone = cornerstoneConfig.getCornerstone();
      const elements = document.querySelectorAll('.cornerstone-viewport');
      
      elements.forEach((element: any) => {
        if (element) {
          const viewport = cornerstone.getViewport(element);
          if (viewport) {
            viewport.hflip = !viewport.hflip;
            cornerstone.setViewport(element, viewport);
          }
        }
      });
    } catch (error) {
      console.warn('Error flipping image:', error);
    }
  };



  const handleRTStructureLoad = (rtStructData: any) => {
    setRTStructures(rtStructData);
    // Initialize visibility for all structures
    const visibilityMap = new Map();
    rtStructData.structures.forEach((structure: any) => {
      visibilityMap.set(structure.roiNumber, true);
    });
    setStructureVisibility(visibilityMap);
    
    // Auto-launch contour editing when RT structures are loaded
    setContourMode(true);
    // Select the first structure by default
    if (rtStructData.structures.length > 0) {
      setSelectedStructure(rtStructData.structures[0].roiNumber);
    }
  };

  const handleStructureVisibilityChange = (structureId: number, visible: boolean) => {
    setStructureVisibility(prev => new Map(prev.set(structureId, visible)));
  };

  const handleStructureColorChange = (structureId: number, color: [number, number, number]) => {
    if (rtStructures) {
      const updatedStructures = { ...rtStructures };
      const structure = updatedStructures.structures.find((s: any) => s.roiNumber === structureId);
      if (structure) {
        structure.color = color;
        setRTStructures(updatedStructures);
      }
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <div className="w-8 h-8 border border-dicom-yellow border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-dicom-yellow">Loading study...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-in fade-in-50 duration-500">
      {/* Three-column layout when contour editor is active */}
      {contourMode && rtStructures ? (
        <div className="flex gap-4" style={{ height: 'calc(100vh - 8rem)' }}>
          {/* Series Selector - Left Sidebar */}
          <div className="w-80 flex-shrink-0">
            <SeriesSelector
              series={series}
              selectedSeries={selectedSeries}
              onSeriesSelect={handleSeriesSelect}
              windowLevel={windowLevel}
              onWindowLevelChange={setWindowLevel}
              studyId={studyData.studies[0]?.id}
              rtStructures={rtStructures}
              onRTStructureLoad={handleRTStructureLoad}
              onStructureVisibilityChange={handleStructureVisibilityChange}
              onStructureColorChange={handleStructureColorChange}
              selectedStructure={selectedStructure}
              onSelectedStructureChange={setSelectedStructure}
              editMode={editMode}
            />
          </div>

          {/* DICOM Viewer - Center */}
          <div className="flex-1">
            {selectedSeries ? (
              <WorkingViewer 
                seriesId={selectedSeries.id}
                studyId={studyData.studies[0]?.id}
                windowLevel={windowLevel}
                onWindowLevelChange={setWindowLevel}
                rtStructures={rtStructures}
                structureVisibility={structureVisibility}
                selectedStructure={selectedStructure}
                editMode={editMode}
              />
            ) : (
              <div className="h-full flex items-center justify-center bg-black border border-indigo-800 rounded-lg">
                <p className="text-indigo-400">Select a series to view DICOM images</p>
              </div>
            )}
          </div>

          {/* Contour Editor - Right Sidebar */}
          <div className="w-80 flex-shrink-0">
            <ContourEditorPanel
              seriesId={selectedSeries?.id || 0}
              studyId={studyData.studies[0]?.id}
              rtStructures={rtStructures}
              selectedStructure={selectedStructure}
              onSelectedStructureChange={setSelectedStructure}
              editMode={editMode}
              onEditModeChange={setEditMode}
              brushSettings={brushSettings}
              onBrushSettingsChange={setBrushSettings}
              structureVisibility={structureVisibility}
              onStructureVisibilityChange={handleStructureVisibilityChange}
            />
          </div>
        </div>
      ) : (
        /* Two-column layout when contour editor is not active */
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4" style={{ height: 'calc(100vh - 8rem)' }}>
          {/* Series Selector */}
          <div className="lg:col-span-1">
            <SeriesSelector
              series={series}
              selectedSeries={selectedSeries}
              onSeriesSelect={handleSeriesSelect}
              windowLevel={windowLevel}
              onWindowLevelChange={setWindowLevel}
              studyId={studyData.studies[0]?.id}
              rtStructures={rtStructures}
              onRTStructureLoad={handleRTStructureLoad}
              onStructureVisibilityChange={handleStructureVisibilityChange}
              onStructureColorChange={handleStructureColorChange}
              selectedStructure={selectedStructure}
              onSelectedStructureChange={setSelectedStructure}
              editMode={editMode}
            />
          </div>

          {/* DICOM Viewer */}
          <div className="lg:col-span-3">
            {selectedSeries ? (
              <WorkingViewer 
                seriesId={selectedSeries.id}
                studyId={studyData.studies[0]?.id}
                windowLevel={windowLevel}
                onWindowLevelChange={setWindowLevel}
                rtStructures={rtStructures}
                structureVisibility={structureVisibility}
                selectedStructure={selectedStructure}
                editMode={editMode}
              />
            ) : (
              <div className="h-full flex items-center justify-center bg-black border border-indigo-800 rounded-lg">
                <p className="text-indigo-400">Select a series to view DICOM images</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Floating Toolbar */}
      {selectedSeries && (
        <ViewerToolbar
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onResetZoom={handleResetZoom}
          onPanTool={handlePanTool}
          onMeasureTool={handleMeasureTool}
          onAnnotateTool={handleAnnotateTool}
          onRotate={handleRotate}
          onFlip={handleFlip}
          currentSlice={1}
          totalSlices={selectedSeries.imageCount}
          windowLevel={windowLevel}
          onContourModeToggle={() => setContourMode(!contourMode)}
          contourMode={contourMode}
          hasRTStructures={!!rtStructures}
        />
      )}



      {/* Error Modal */}
      <ErrorModal
        isOpen={!!error}
        onClose={() => setError(null)}
        onRetry={() => {
          setError(null);
          if (selectedSeries) {
            handleSeriesSelect(selectedSeries);
          }
        }}
        error={error || { title: '', message: '' }}
      />
    </div>
  );
}
