import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SeriesSelector } from './series-selector';
import { WorkingViewer } from './working-viewer';
import MultiViewport from './multi-viewport';
import { ViewerToolbar } from './viewer-toolbar';
import { ContourEditToolbar } from './contour-edit-toolbar';
import { FusionControlPanel } from './fusion-control-panel';
import { ErrorModal } from './error-modal';
import { BooleanOperationsToolbar } from './boolean-operations-toolbar-new';
import { X, Target } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MarginToolbar } from './margin-toolbar';
import { DICOMSeries, DICOMStudy, WindowLevel, WINDOW_LEVEL_PRESETS } from '@/lib/dicom-utils';
import { cornerstoneConfig } from '@/lib/cornerstone-config';

// TypeScript declaration for cornerstone
declare global {
  interface Window {
    cornerstone: any;
  }
}


interface ViewerInterfaceProps {
  studyData: any;
  onContourSettingsChange?: (settings: { width: number; opacity: number }) => void;
  contourSettings?: { width: number; opacity: number };
}

export function ViewerInterface({ studyData, onContourSettingsChange, contourSettings }: ViewerInterfaceProps) {
  const [selectedSeries, setSelectedSeries] = useState<DICOMSeries | null>(null);
  const [windowLevel, setWindowLevel] = useState<WindowLevel>(WINDOW_LEVEL_PRESETS.abdomen);
  const [error, setError] = useState<any>(null);
  const [series, setSeries] = useState<DICOMSeries[]>([]);
  const [viewMode, setViewMode] = useState<'single' | 'mpr'>('single');
  const [activeToolMode, setActiveToolMode] = useState<'pan' | 'crosshairs' | 'measure'>('pan'); // Default to pan mode
  
  // Shared image cache to prevent reloading when switching modes
  const imageCache = useRef<Map<string, { images: any[], metadata: any }>>(new Map());
  
  const [rtStructures, setRTStructures] = useState<any>(null);
  const [structureVisibility, setStructureVisibility] = useState<Map<number, boolean>>(new Map());
  const [selectedStructures, setSelectedStructures] = useState<Set<number>>(new Set());
  const [selectedStructureColors, setSelectedStructureColors] = useState<string[]>([]);
  const [selectedForEdit, setSelectedForEdit] = useState<number | null>(null);
  const [isContourEditMode, setIsContourEditMode] = useState(false);
  const [brushToolState, setBrushToolState] = useState({
    tool: null as string | null,
    brushSize: 3,
    isActive: false,
    predictionEnabled: false
  });
  const [currentSlicePosition, setCurrentSlicePosition] = useState<number>(0);
  const [autoZoomLevel, setAutoZoomLevel] = useState<number | undefined>(undefined);
  const [autoLocalizeTarget, setAutoLocalizeTarget] = useState<{ x: number; y: number; z: number } | undefined>(undefined);
  const workingViewerRef = useRef<any>(null);
  const [imageMetadata, setImageMetadata] = useState<any>(null);
  
  // Fusion state
  const [showFusionPanel, setShowFusionPanel] = useState(false);
  const [secondarySeriesId, setSecondarySeriesId] = useState<number | null>(null);
  const [fusionOpacity, setFusionOpacity] = useState(0.5);
  
  // All structures visibility state for syncing between RT button and hide all button
  const [allStructuresVisible, setAllStructuresVisible] = useState(true);
  
  // MPR visibility state
  const [mprVisible, setMprVisible] = useState(false);
  
  // Boolean operations state
  const [showBooleanOperations, setShowBooleanOperations] = useState(false);
  const [showMarginToolbar, setShowMarginToolbar] = useState(false);
  const [showLocalizationTool, setShowLocalizationTool] = useState(false);

  // Clear RT structures when patient changes
  useEffect(() => {
    console.log('Patient changed, clearing RT structures. Patient ID:', studyData?.patient?.id);
    setRTStructures(null);
    setStructureVisibility(new Map());
    setSelectedStructures(new Set());
    setSelectedForEdit(null);
    setSelectedStructureColors([]);
    setIsContourEditMode(false);
  }, [studyData?.patient?.id]);

  // Automatically enter contour edit mode when a structure is selected for editing
  useEffect(() => {
    if (selectedForEdit && rtStructures) {
      setIsContourEditMode(true);
    } else {
      setIsContourEditMode(false);
    }
  }, [selectedForEdit, rtStructures]);

  // Fetch series data for all studies
  const { data: seriesData, isLoading } = useQuery({
    queryKey: ['/api/studies', studyData.studies?.map((s: any) => s.id), 'series'],
    queryFn: async () => {
      if (!studyData.studies || studyData.studies.length === 0) throw new Error('No studies');
      
      // Fetch series for all studies and combine them
      const allSeries = [];
      for (const study of studyData.studies) {
        const response = await fetch(`/api/studies/${study.id}/series`);
        if (!response.ok) {
          throw new Error(`Failed to fetch series for study ${study.id}: ${response.statusText}`);
        }
        const series = await response.json();
        // Add study info to each series for reference
        allSeries.push(...series.map((s: any) => ({ ...s, studyId: study.id, studyDate: study.studyDate })));
      }
      return allSeries;
    },
    enabled: !!studyData.studies?.length,
  });

  useEffect(() => {
    if (seriesData && Array.isArray(seriesData)) {
      setSeries(seriesData);
      
      // Auto-select CT series as primary, fallback to first series
      // IMPORTANT: Always load CT as primary for fusion dataset
      if (!selectedSeries) {
        const ctSeries = seriesData.find((s: any) => s.modality === 'CT');
        if (ctSeries) {
          console.log('Auto-selecting CT series as primary:', ctSeries);
          handleSeriesSelect(ctSeries);
        } else if (seriesData.length > 0) {
          console.log('No CT series found, selecting first series:', seriesData[0]);
          handleSeriesSelect(seriesData[0]);
        }
      }
      
      // Auto-load RT structures if available
      const rtSeries = seriesData.find((s: any) => s.modality === 'RTSTRUCT');
      if (rtSeries) {
        console.log(`Loading RT structures for study ${rtSeries.studyId}`);
        handleRTSeriesSelect(rtSeries);
      } else {
        // Clear RT structures if no RT series found
        console.log(`No RT structures found in any study`);
        setRTStructures(null);
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

  const handlePanTool = () => {
    if (workingViewerRef.current?.setPanMode) {
      workingViewerRef.current.setPanMode();
      setActiveToolMode('pan');
    }
  };
  
  const handleMeasureTool = () => {
    setActiveTool('Length');
    setActiveToolMode('measure');
  };
  const handleAnnotateTool = () => setActiveTool('ArrowAnnotate');
  
  const handleCrosshairsTool = () => {
    if (workingViewerRef.current?.setCrosshairMode) {
      workingViewerRef.current.setCrosshairMode();
      setActiveToolMode('crosshairs');
    }
  };

  const handleRotate = () => {
    try {
      if (!window.cornerstone) {
        console.warn('Cornerstone not available for rotation');
        return;
      }
      const cornerstone = window.cornerstone;
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
      if (!window.cornerstone) {
        console.warn('Cornerstone not available for flip');
        return;
      }
      const cornerstone = window.cornerstone;
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
    console.log('Loading RT structures:', rtStructData);
    setRTStructures(rtStructData);
    // Initialize visibility for all structures
    const visibilityMap = new Map();
    rtStructData.structures.forEach((structure: any) => {
      visibilityMap.set(structure.roiNumber, true);
    });
    setStructureVisibility(visibilityMap);
  };
  
  const handleRTSeriesSelect = async (rtSeries: any) => {
    try {
      console.log('Auto-loading RT structures for series:', rtSeries.id);
      
      // Load RT structure contours
      const response = await fetch(`/api/rt-structures/${rtSeries.id}/contours`);
      if (response.ok) {
        const rtStructData = await response.json();
        console.log('RT structures loaded successfully:', rtStructData);
        handleRTStructureLoad(rtStructData);
      } else {
        console.error('Failed to load RT structures:', response.status);
      }
    } catch (error) {
      console.error('Error loading RT structure contours:', error);
    }
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

  const handleAllStructuresVisibilityChange = (allVisible: boolean) => {
    setAllStructuresVisible(allVisible);
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

  const handleContourUpdate = (payload: any) => {
    console.log('Contour update received:', payload);
    
    // Check if this is an action payload from ContourEditToolbar or full structures from WorkingViewer
    if (payload && payload.action) {
      // This is an action payload from ContourEditToolbar
      // Pass it directly to WorkingViewer's handleContourUpdate
      console.log(`Received action: ${payload.action} for structure ${payload.structureId}`);
      if (workingViewerRef.current && workingViewerRef.current.handleContourUpdate) {
        workingViewerRef.current.handleContourUpdate(payload);
      }
      return;
    }
    
    // This is the full updated RT structures from WorkingViewer after processing
    if (payload && payload.structures) {
      setRTStructures(payload);
    }
  };

  // Auto-zoom functionality based on structure bounds
  const getStructureBounds = (structure: any) => {
    let xMin = Infinity, xMax = -Infinity;
    let yMin = Infinity, yMax = -Infinity;
    let zSum = 0, xSum = 0, ySum = 0, n = 0;

    for (const contour of structure.contours) {
      for (let i = 0; i < contour.points.length; i += 3) {
        const x = contour.points[i];
        const y = contour.points[i + 1];
        const z = contour.points[i + 2];
        xMin = Math.min(xMin, x);
        xMax = Math.max(xMax, x);
        yMin = Math.min(yMin, y);
        yMax = Math.max(yMax, y);
        xSum += x;
        ySum += y;
        zSum += z;
        n++;
      }
    }

    return {
      centroid: { x: xSum / n, y: ySum / n, z: zSum / n },
      widthMM: xMax - xMin,
      heightMM: yMax - yMin
    };
  };

  const getAutoZoomForBounds = (widthMM: number, heightMM: number, canvasWidth: number, canvasHeight: number, pixelSpacing: [number, number]) => {
    const fillFactor = 0.4; // target % of canvas to fill
    const targetPixelWidth = canvasWidth * fillFactor;
    const targetPixelHeight = canvasHeight * fillFactor;

    const widthInPixels = widthMM / pixelSpacing[0];
    const heightInPixels = heightMM / pixelSpacing[1];

    const zoomX = targetPixelWidth / widthInPixels;
    const zoomY = targetPixelHeight / heightInPixels;

    return Math.min(zoomX, zoomY, 5); // cap max zoom at 5x
  };

  // Auto-zoom effect disabled per user request
  // useEffect(() => {
  //   if (!selectedForEdit || !rtStructures?.structures) return;

  //   const structure = rtStructures.structures.find((s: any) => s.roiNumber === selectedForEdit);
  //   if (!structure || !structure.contours || structure.contours.length === 0) return;

  //   try {
  //     const { centroid, widthMM, heightMM } = getStructureBounds(structure);
      
  //     // Only auto-zoom if we have valid bounds
  //     if (isFinite(widthMM) && isFinite(heightMM) && widthMM > 0 && heightMM > 0) {
  //       console.log(`Auto-zooming to structure ${structure.structureName}: ${widthMM.toFixed(1)}mm x ${heightMM.toFixed(1)}mm`);
        
  //       // Focus on the structure's centroid slice
  //       const newSlice = Math.round(centroid.z);
        
  //       // For now, we'll just log the auto-zoom intent
  //       // The actual zoom/pan implementation would need to be integrated 
  //       // with the WorkingViewer component's zoom and pan state
  //       console.log(`Centering on slice ${newSlice}, structure centroid:`, centroid);
  //       console.log(`Recommended zoom for structure size: ${widthMM.toFixed(1)}mm x ${heightMM.toFixed(1)}mm`);
  //     }
  //   } catch (error) {
  //     console.warn('Error calculating auto-zoom for structure:', error);
  //   }
  // }, [selectedForEdit, rtStructures]);

  // Handle structure localization
  const handleStructureLocalization = useCallback((structureId: number) => {
    if (!rtStructures?.structures || !workingViewerRef.current) {
      console.warn('🎯 Cannot localize: missing structures or viewer ref');
      return;
    }

    const structure = rtStructures.structures.find((s: any) => s.roiNumber === structureId);
    if (!structure || !structure.contours || structure.contours.length === 0) {
      console.warn(`🎯 Cannot localize: structure ${structureId} not found or has no contours`);
      return;
    }

    console.log(`🎯 Localizing to structure "${structure.structureName}"...`);

    // Calculate structure bounds and centroid
    let minZ = Infinity, maxZ = -Infinity;
    let totalX = 0, totalY = 0, totalZ = 0, totalPoints = 0;
    
    structure.contours.forEach((contour: any) => {
      if (contour.points && contour.points.length >= 6) {
        // Track Z bounds for finding middle slice
        if (contour.slicePosition !== undefined) {
          minZ = Math.min(minZ, contour.slicePosition);
          maxZ = Math.max(maxZ, contour.slicePosition);
        }
        
        // Calculate centroid
        for (let i = 0; i < contour.points.length; i += 3) {
          totalX += contour.points[i];
          totalY += contour.points[i + 1];
          totalZ += contour.points[i + 2];
          totalPoints++;
        }
      }
    });
    
    if (totalPoints === 0) {
      console.warn(`🎯 Cannot localize: structure ${structureId} has no valid points`);
      return;
    }

    // Calculate centroid
    const centroidX = totalX / totalPoints;
    const centroidY = totalY / totalPoints;
    const centroidZ = totalZ / totalPoints;
    
    // Use middle Z slice if we have slice position bounds, otherwise use centroid Z
    const targetZ = (minZ !== Infinity && maxZ !== -Infinity) ? (minZ + maxZ) / 2 : centroidZ;
    
    console.log(`🎯 Localizing to "${structure.structureName}":`, {
      centroid: `(${centroidX.toFixed(1)}, ${centroidY.toFixed(1)}, ${centroidZ.toFixed(1)})`,
      sliceBounds: minZ !== Infinity ? `${minZ.toFixed(1)} to ${maxZ.toFixed(1)}` : 'unknown',
      targetZ: targetZ.toFixed(1)
    });
    
    // Navigate to the structure by finding the closest slice
    if (workingViewerRef.current && workingViewerRef.current.navigateToSlice) {
      workingViewerRef.current.navigateToSlice(targetZ);
    } else {
      console.warn('🎯 WorkingViewer navigateToSlice method not available');
    }
    
    console.log(`🎯 ✅ Localization completed for "${structure.structureName}"`);
  }, [rtStructures, workingViewerRef]);

  // Handle localization button toggle
  const handleLocalizationToggle = useCallback(() => {
    const newState = !showLocalizationTool;
    setShowLocalizationTool(newState);
    
    if (newState) {
      console.log('🎯 Localization mode ACTIVATED - click any structure to navigate to its center');
    } else {
      console.log('🎯 Localization mode DEACTIVATED');
    }
  }, [showLocalizationTool]);

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
      <div className="flex gap-4" style={{ height: 'calc(100vh - 8rem)' }}>
        
        {/* Series Selector - Responsive Width */}
        <div className="w-full md:w-96 h-full overflow-hidden flex-shrink-0 hidden md:block">
          <SeriesSelector
            series={series}
            selectedSeries={selectedSeries}
            onSeriesSelect={handleSeriesSelect}
            windowLevel={windowLevel}
            onWindowLevelChange={setWindowLevel}
            studyId={studyData.studies[0]?.id}
            studyIds={studyData.studies.map((s: any) => s.id)}
            rtStructures={rtStructures}
            onRTStructureLoad={handleRTStructureLoad}
            onStructureVisibilityChange={handleStructureVisibilityChange}
            onStructureColorChange={handleStructureColorChange}
            onStructureSelection={handleStructureSelection}
            selectedForEdit={selectedForEdit}
            onSelectedForEditChange={(structureId) => {
              setSelectedForEdit(structureId);
              
              // If localization mode is active, auto-navigate to the selected structure
              if (showLocalizationTool && structureId && rtStructures?.structures) {
                handleStructureLocalization(structureId);
              }
            }}
            onContourSettingsChange={onContourSettingsChange}
            onAutoZoom={(zoom) => {
              // Set auto-zoom level for WorkingViewer
              setAutoZoomLevel(zoom);
              // Clear after a short delay to allow component to react
              setTimeout(() => setAutoZoomLevel(undefined), 100);
            }}
            onAutoLocalize={(x, y, z) => {
              // Set auto-localize target for WorkingViewer
              setAutoLocalizeTarget({ x, y, z });
              // Clear after a short delay to allow component to react
              setTimeout(() => setAutoLocalizeTarget(undefined), 100);
            }}
            secondarySeriesId={secondarySeriesId}
            onSecondarySeriesSelect={setSecondarySeriesId}
            preventRTLoading={false}
            onAllStructuresVisibilityChange={handleAllStructuresVisibilityChange}
            // Pass localization mode to highlight when active
            localizationMode={showLocalizationTool}
          />
        </div>

        {/* DICOM Viewer with Dynamic Border - Flexible Width */}
        <div className="flex-1 relative overflow-hidden">
          {selectedSeries ? (
            <div className="relative h-full overflow-hidden">
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
              
              {/* Main Viewer - Single or Multi-viewport based on view mode */}
              {viewMode === 'single' ? (
                <WorkingViewer 
                  ref={workingViewerRef}
                  seriesId={selectedSeries.id}
                  studyId={studyData.studies[0]?.id}
                  windowLevel={windowLevel}
                  onWindowLevelChange={setWindowLevel}
                  rtStructures={rtStructures}
                  structureVisibility={structureVisibility}
                  brushToolState={brushToolState}
                  selectedForEdit={selectedForEdit}
                  selectedStructures={selectedStructures}
                  onBrushSizeChange={(size) => setBrushToolState(prev => ({ ...prev, brushSize: size }))}
                  onContourUpdate={handleContourUpdate}
                  onSlicePositionChange={setCurrentSlicePosition}
                  contourSettings={contourSettings}
                  autoZoomLevel={autoZoomLevel}
                  autoLocalizeTarget={autoLocalizeTarget}
                  secondarySeriesId={secondarySeriesId}
                  fusionOpacity={fusionOpacity}
                  onSecondarySeriesSelect={setSecondarySeriesId}
                  onFusionOpacityChange={setFusionOpacity}
                  hasSecondarySeriesForFusion={series.filter(s => s.id !== selectedSeries.id).length > 0}
                  onImageMetadataChange={setImageMetadata}
                  allStructuresVisible={allStructuresVisible}
                  imageCache={imageCache}
                  onMPRToggle={() => setMprVisible(!mprVisible)}
                  isMPRVisible={mprVisible}
                />
              ) : (
                <MultiViewport
                  studyId={studyData.studies[0]?.id}
                  initialSeriesId={selectedSeries.id}
                  rtStructures={rtStructures}
                  onRTStructureUpdate={handleContourUpdate}
                  allStructuresVisible={allStructuresVisible}
                  onAllStructuresVisibilityChange={handleAllStructuresVisibilityChange}
                  imageCache={imageCache}
                />
              )}
              
              {/* Structure Tags on Right Side - Responsive */}
              {selectedStructures.size > 0 && rtStructures?.structures && (
                <div className="absolute right-2 sm:right-4 top-2 sm:top-4 space-y-2 z-10 max-h-[calc(100vh-12rem)] overflow-y-auto">
                  <div className="space-y-2 max-w-[200px] sm:max-w-[250px]">
                    {Array.from(selectedStructures).map(structureId => {
                      const structure = rtStructures.structures.find((s: any) => s.roiNumber === structureId);
                      if (!structure) return null;
                      
                      return (
                        <div 
                          key={structureId}
                          className="flex items-center space-x-2 bg-black/80 backdrop-blur-sm rounded-lg px-2 sm:px-3 py-1.5 sm:py-2 border"
                          style={{ borderColor: `rgb(${structure.color.join(',')})` }}
                        >
                          <div 
                            className="w-2.5 sm:w-3 h-2.5 sm:h-3 rounded-full border border-gray-400 flex-shrink-0"
                            style={{ backgroundColor: `rgb(${structure.color.join(',')})` }}
                          />
                          <span className="text-xs sm:text-sm text-white font-medium truncate">
                            {structure.structureName}
                          </span>
                        </div>
                      );
                    })}
                  </div>
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
          onFitToWindow={handleResetZoom}
          onPan={handlePanTool}
          onMeasure={handleMeasureTool}
          onCrosshairs={handleCrosshairsTool}
          onContourEdit={() => {
            // Close boolean operations toolbar when opening contour edit
            setShowBooleanOperations(false);
            // Close margin toolbar when opening contour edit
            setShowMarginToolbar(false);
            // Close localization tool when opening contour edit
            setShowLocalizationTool(false);
            
            // If no structure is selected, select the first one or last loaded
            if (!selectedForEdit && rtStructures?.structures && rtStructures.structures.length > 0) {
              // Try to get the last loaded structure or default to first
              const lastStructure = rtStructures.structures[rtStructures.structures.length - 1];
              setSelectedForEdit(lastStructure.roiNumber);
            }
            
            setIsContourEditMode(true);
          }}
          onContourOperations={() => {
            // Close contour edit toolbar when opening boolean operations
            setIsContourEditMode(false);
            // Close margin toolbar when opening boolean operations
            setShowMarginToolbar(false);
            // Close localization tool when opening boolean operations
            setShowLocalizationTool(false);
            setShowBooleanOperations(true);
          }}
          onAdvancedMarginTool={() => {
            // Close contour edit toolbar when opening margin toolbar
            setIsContourEditMode(false);
            // Close boolean operations toolbar when opening margin toolbar
            setShowBooleanOperations(false);
            // Close localization tool when opening margin toolbar
            setShowLocalizationTool(false);
            setShowMarginToolbar(true);
          }}
          onMPRToggle={() => {
            setMprVisible(!mprVisible);
          }}
          isMPRActive={mprVisible}
          isPanActive={activeToolMode === 'pan'}
          isCrosshairsActive={activeToolMode === 'crosshairs'}
          isMeasureActive={activeToolMode === 'measure'}
          isContourEditActive={isContourEditMode}
          isContourOperationsActive={showBooleanOperations}
          isAdvancedMarginToolActive={showMarginToolbar}
          onLocalization={handleLocalizationToggle}
          isLocalizationActive={showLocalizationTool}
          className="toolbar-custom"
        />
      )}

      {/* Contour Edit Toolbar and Fusion Control are handled inside WorkingViewer */}

      {/* Contour Edit Toolbar */}
      {selectedForEdit && rtStructures && rtStructures.structures && !showBooleanOperations && !showMarginToolbar && (
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
            setBrushToolState({
              ...brushToolState,
              ...toolState,
              predictionEnabled: toolState.predictionEnabled ?? brushToolState.predictionEnabled
            });
          }}
          currentSlicePosition={currentSlicePosition}
          onContourUpdate={handleContourUpdate}
          availableStructures={rtStructures.structures}
          onTargetStructureSelect={(structureId) => {
            // Handle target structure selection for boolean operations
            console.log('Target structure selected:', structureId);
          }}
          seriesId={selectedSeries?.id}
          imageMetadata={imageMetadata}
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

      {/* Boolean Operations Toolbar */}
      {showBooleanOperations && !showMarginToolbar && (
        <BooleanOperationsToolbar
          isVisible={showBooleanOperations}
          onClose={() => setShowBooleanOperations(false)}
          availableStructures={rtStructures?.structures?.map((s: any) => s.structureName) || []}
          onExecuteOperation={(expression, newStructure) => {
            console.log('Executing boolean operation:', expression, newStructure);
            // TODO: Implement boolean operation execution
            if (newStructure?.createNewStructure) {
              console.log('Creating new structure:', newStructure.name, 'with color:', newStructure.color);
            }
            setShowBooleanOperations(false);
          }}
        />
      )}

      {/* Margin Toolbar */}
      {showMarginToolbar && rtStructures && selectedForEdit && !showBooleanOperations && !isContourEditMode && (
        <MarginToolbar
          isVisible={showMarginToolbar}
          onClose={() => setShowMarginToolbar(false)}
          selectedStructure={rtStructures.structures?.find((s: any) => s.roiNumber === selectedForEdit) ? {
            id: selectedForEdit,
            structureName: rtStructures.structures.find((s: any) => s.roiNumber === selectedForEdit)?.structureName || 'Unknown',
            color: rtStructures.structures.find((s: any) => s.roiNumber === selectedForEdit)?.color ? 
              `rgb(${rtStructures.structures.find((s: any) => s.roiNumber === selectedForEdit)?.color.join(',')})` : 
              undefined
          } : undefined}
          onExecuteOperation={(operation) => {
            // Handle execute operation
            console.log('🔹 🎯 Viewer Interface: Handling margin operation:', operation);
            if (workingViewerRef.current) {
              console.log('🔹 ✅ Working viewer ref found, calling handleContourUpdate');
              if (operation.preview) {
                workingViewerRef.current.handleContourUpdate({
                  action: 'preview_margin',
                  structureId: operation.structureId,
                  parameters: operation.parameters
                });
              } else {
                workingViewerRef.current.handleContourUpdate({
                  action: 'execute_margin',
                  structureId: operation.structureId,
                  parameters: operation.parameters
                });
                setShowMarginToolbar(false);
              }
            } else {
              console.error('🔹 ❌ Working viewer ref not found!');
            }
          }}
          onPreviewClear={() => {
            // Handle clear preview
            if (workingViewerRef.current) {
              workingViewerRef.current.handleContourUpdate({
                action: 'clear_preview'
              });
            }
          }}
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
