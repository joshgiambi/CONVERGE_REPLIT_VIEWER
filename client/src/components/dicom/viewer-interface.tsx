import { useState, useEffect, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SeriesSelector } from './series-selector';
import { WorkingViewer } from './working-viewer';
import { ViewerToolbar } from './viewer-toolbar';
import { ContourEditToolbar } from './contour-edit-toolbar';

import { ErrorModal } from './error-modal';
import { DICOMSeries, DICOMStudy, WindowLevel, WINDOW_LEVEL_PRESETS } from '@/lib/dicom-utils';
import { cornerstoneConfig } from '@/lib/cornerstone-config';


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
  const [selectedStructures, setSelectedStructures] = useState<Set<number>>(new Set());
  const [selectedStructureColors, setSelectedStructureColors] = useState<string[]>([]);
  const [selectedForEdit, setSelectedForEdit] = useState<number | null>(null);
  const [isContourEditMode, setIsContourEditMode] = useState(false);
  const [contourSettings, setContourSettings] = useState({ thickness: 2, opacity: 0.8 });
  const [brushToolState, setBrushToolState] = useState({
    tool: null as string | null,
    brushSize: 3,
    isActive: false
  });
  const [currentSlicePosition, setCurrentSlicePosition] = useState<number>(0);

  // Automatically enter contour edit mode when a structure is selected for editing
  useEffect(() => {
    if (selectedForEdit && rtStructures) {
      setIsContourEditMode(true);
    } else {
      setIsContourEditMode(false);
    }
  }, [selectedForEdit, rtStructures]);

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
      
      // Auto-select first series only once when data loads
      if (seriesData.length > 0 && !selectedSeries) {
        handleSeriesSelect(seriesData[0]);
      }
    }
  }, [seriesData]); // Remove selectedSeries from dependencies to prevent infinite loop

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

  const handleZoomIn = () => {
    try {
      if ((window as any).currentViewerZoom?.zoomIn) {
        (window as any).currentViewerZoom.zoomIn();
      }
    } catch (error) {
      console.warn('Error zooming in:', error);
    }
  };

  const handleZoomOut = () => {
    try {
      if ((window as any).currentViewerZoom?.zoomOut) {
        (window as any).currentViewerZoom.zoomOut();
      }
    } catch (error) {
      console.warn('Error zooming out:', error);
    }
  };

  const handleResetZoom = () => {
    try {
      if ((window as any).currentViewerZoom?.resetZoom) {
        (window as any).currentViewerZoom.resetZoom();
      }
    } catch (error) {
      console.warn('Error resetting zoom:', error);
    }
  };

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
  };

  const handleStructureSelection = (structureId: number, selected: boolean) => {
    const newSelection = new Set(selectedStructures);
    if (selected) {
      newSelection.add(structureId);
    } else {
      newSelection.delete(structureId);
    }
    setSelectedStructures(newSelection);
    
    // Update selected structure colors for viewer border
    if (rtStructures?.structures) {
      const colors = Array.from(newSelection).map(id => {
        const structure = rtStructures.structures.find((s: any) => s.roiNumber === id);
        return structure ? `rgb(${structure.color.join(',')})` : '';
      }).filter(Boolean);
      setSelectedStructureColors(colors);
    }
  };

  const handleStructureVisibilityChange = (structureId: number, visible: boolean) => {
    setStructureVisibility(prev => {
      const next = new Map(prev);
      next.set(structureId, visible);
      return next;
    });
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

  const handleContourUpdate = (updatedRTStructures: any) => {
    console.log('Contour update received:', updatedRTStructures);
    // Update the RT structures state with the modified contours
    setRTStructures(updatedRTStructures);
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
            onStructureSelection={handleStructureSelection}
            selectedForEdit={selectedForEdit}
            onSelectedForEditChange={setSelectedForEdit}
          />
        </div>

        {/* DICOM Viewer with Dynamic Border */}
        <div className="lg:col-span-3 relative">
          {selectedSeries ? (
            <div className="relative h-full">
              {/* Dynamic Border Based on Selected Structures */}
              <div 
                className="absolute inset-0 rounded-lg pointer-events-none"
                style={{
                  border: selectedStructureColors.length > 0 
                    ? `3px solid ${selectedStructureColors[0]}` 
                    : '1px solid #374151',
                  zIndex: 1
                }}
              />
              
              {/* Multi-color border effect for multiple selections */}
              {selectedStructureColors.length > 1 && (
                <div className="absolute inset-0 rounded-lg pointer-events-none" style={{ zIndex: 1 }}>
                  {selectedStructureColors.map((color, index) => (
                    <div
                      key={index}
                      className="absolute inset-0 rounded-lg"
                      style={{
                        border: `3px solid ${color}`,
                        transform: `scale(${1 - (index * 0.02)})`,
                        opacity: 0.8 - (index * 0.2)
                      }}
                    />
                  ))}
                </div>
              )}
              
              {/* Main Viewer */}
              <WorkingViewer 
                seriesId={selectedSeries.id}
                studyId={studyData.studies[0]?.id}
                windowLevel={windowLevel}
                onWindowLevelChange={setWindowLevel}
                rtStructures={rtStructures}
                structureVisibility={structureVisibility}
                brushToolState={brushToolState}
                selectedForEdit={selectedForEdit}
                onBrushSizeChange={(size) => setBrushToolState(prev => ({ ...prev, brushSize: size }))}
                onContourUpdate={handleContourUpdate}
              />
              
              {/* Structure Tags on Right Side */}
              {selectedStructures.size > 0 && rtStructures?.structures && (
                <div className="absolute right-4 top-4 space-y-2 z-10">
                  {Array.from(selectedStructures).map(structureId => {
                    const structure = rtStructures.structures.find((s: any) => s.roiNumber === structureId);
                    if (!structure) return null;
                    
                    return (
                      <div 
                        key={structureId}
                        className="flex items-center space-x-2 bg-black/80 backdrop-blur-sm rounded-lg px-3 py-2 border"
                        style={{ borderColor: `rgb(${structure.color.join(',')})` }}
                      >
                        <div 
                          className="w-3 h-3 rounded-full border border-gray-400"
                          style={{ backgroundColor: `rgb(${structure.color.join(',')})` }}
                        />
                        <span className="text-sm text-white font-medium">
                          {structure.structureName}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <div className="h-full flex items-center justify-center bg-black border border-indigo-800 rounded-lg">
              <p className="text-indigo-400">Select a series to view DICOM images</p>
            </div>
          )}
        </div>
      </div>

      {/* Floating Toolbar */}
      {selectedSeries && (
        <ViewerToolbar
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onResetZoom={handleResetZoom}
          onPanTool={handlePanTool}
          onMeasureTool={handleMeasureTool}
          onAnnotateTool={handleAnnotateTool}
          onContourEdit={() => {
            if (selectedForEdit) {
              setIsContourEditMode(true);
            }
          }}
          onContourSettings={() => {
            // Open contour settings dialog
          }}
          currentSlice={1}
          totalSlices={selectedSeries.imageCount}
          windowLevel={windowLevel}
          isContourEditActive={selectedForEdit !== null}
        />
      )}

      {/* Contour Edit Toolbar */}
      {selectedForEdit && rtStructures && rtStructures.structures && (
        <ContourEditToolbar
          selectedStructure={rtStructures.structures.find((s: any) => s.roiNumber === selectedForEdit)}
          isVisible={isContourEditMode}
          onClose={() => {
            setIsContourEditMode(false);
            setSelectedForEdit(null);
          }}
          onStructureNameChange={(name: string) => {
            // Update structure name
          }}
          onStructureColorChange={(color: string) => {
            // Update structure color
          }}
          onToolChange={(toolState) => {
            setBrushToolState(toolState);
          }}
          currentSlicePosition={currentSlicePosition}
          onContourUpdate={handleContourUpdate}
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
