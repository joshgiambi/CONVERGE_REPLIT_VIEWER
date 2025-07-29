/**
 * Refactored Working Viewer - Replacing 4167-line monolithic component
 * Uses modular architecture with Services → Hooks → Components pattern
 */

import { useRef, useState, useEffect, forwardRef, useImperativeHandle, useCallback } from 'react';

// Services
import { fetchSeriesImages } from '../dicom-viewer/services/apiService';

// Custom hooks
import { useDicomLoader } from '../dicom-viewer/hooks/useDicomLoader';
import { useContourState } from '../dicom-viewer/hooks/useContourState';
import { useViewportState } from '../dicom-viewer/hooks/useViewportState';

// UI Components
import { ViewerToolbar } from '../dicom-viewer/components/ViewerToolbar';
import { MainViewport } from '../dicom-viewer/components/MainViewport';

export interface MainViewportRef {
  canvas: HTMLCanvasElement | null;
  getCanvas: () => HTMLCanvasElement | null;
}
import { LoadingSpinner } from '../dicom-viewer/components/LoadingSpinner';
import { ErrorDisplay } from '../dicom-viewer/components/ErrorDisplay';
import { MprCanvases } from '../dicom-viewer/components/MprCanvases';
import { ToolRenderer } from '../dicom-viewer/components/ToolRenderer';

// Legacy tool imports for compatibility with existing interfaces
import { RTStructureOverlay } from './rt-structure-overlay';
import { FusionControlPanel } from './fusion-control-panel';
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";

export interface WorkingViewerProps {
  seriesId: number;
  studyId?: number;
  secondarySeriesId?: number | null;
  orientation?: 'axial' | 'sagittal' | 'coronal';
  onSeriesChange?: (seriesId: number) => void;
  onSecondarySeriesSelect?: (seriesId: number | null) => void;
  onFusionOpacityChange?: (opacity: number) => void;
  onContourUpdate?: (data: any) => Promise<void>;
  onImageMetadataChange?: (metadata: any) => void;
  onCurrentSlicePositionChange?: (position: number) => void;
  rtStructures?: any;
  structureVisibility?: Map<number, boolean>;
  selectedForEdit?: number | null;
  contourSettings?: { width: number; opacity: number };
  brushToolState?: any;
  windowLevel?: { window: number; level: number };
  autoZoomLevel?: number | undefined;
  autoLocalizeTarget?: { x: number; y: number; z: number } | undefined;
  fusionOpacity?: number;
  showFusionPanel?: boolean;
  className?: string;
  keyboardNavigationDisabled?: boolean;
}

export interface WorkingViewerRef {
  getCurrentImage: () => any | null;
  getCanvasTransform: () => any;
  focusOnStructure: (structureId: number) => void;
  autoZoom: (level: number) => void;
  autoLocalize: (target: { x: number; y: number; z: number }) => void;
}

/**
 * Refactored Working Viewer using clean modular architecture
 * Replaces 4167-line monolithic component with maintainable structure
 */
export const WorkingViewer = forwardRef<WorkingViewerRef, WorkingViewerProps>(({
  seriesId,
  studyId,
  secondarySeriesId = null,
  orientation = 'axial',
  onSeriesChange,
  onSecondarySeriesSelect,
  onFusionOpacityChange,
  onContourUpdate,
  onImageMetadataChange,
  onCurrentSlicePositionChange,
  rtStructures,
  structureVisibility = new Map(),
  selectedForEdit = null,
  contourSettings = { width: 2, opacity: 0.1 },
  brushToolState = { tool: null, brushSize: 3, isActive: false },
  windowLevel = { window: 400, level: 40 },
  autoZoomLevel = undefined,
  autoLocalizeTarget = undefined,
  fusionOpacity = 0.5,
  showFusionPanel = false,
  className = '',
  keyboardNavigationDisabled = false
}, ref) => {

  // DICOM data loading
  const { 
    images, 
    currentImage, 
    currentIndex, 
    imageMetadata,
    isLoading, 
    error, 
    goToNext, 
    goToPrevious, 
    goToSlice,
    getCurrentImageWithData,
    imageCacheRef
  } = useDicomLoader(seriesId, orientation);

  // Contour operations state
  const {
    selectedStructure: selectedStructureFromHook,
    handleContourUpdate,
    currentSlicePos
  } = useContourState(currentImage, onContourUpdate);

  // Viewport interaction state (zoom, pan, window/level)
  const viewportState = useViewportState({
    keyboardNavigationDisabled,
    initialWindowLevel: windowLevel,
    onWindowLevelChange: (newWindowLevel) => {
      // Update image metadata if callback provided
      if (onImageMetadataChange) {
        onImageMetadataChange({ windowLevel: newWindowLevel });
      }
    }
  });

  // Override wheel event to handle image scrolling instead of just zoom
  const handleCanvasWheel = (event: React.WheelEvent) => {
    event.preventDefault();
    
    // If Ctrl/Cmd is held, do zoom behavior
    if (event.ctrlKey || event.metaKey) {
      viewportState.handleWheel(event);
    } else {
      // Default: scroll through images
      if (event.deltaY < 0) {
        goToPrevious();
      } else {
        goToNext();
      }
    }
  };

  // Secondary images for fusion
  const [secondaryImages, setSecondaryImages] = useState<any[]>([]);
  const [registrationMatrix, setRegistrationMatrix] = useState<number[] | null>(null);
  
  // MPR visibility state
  const [isMPRVisible, setIsMPRVisible] = useState(false);
  const [showStructures, setShowStructures] = useState(true);
  
  // Canvas reference for direct canvas operations
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // Get current image with parsed data for rendering
  const [currentImageWithData, setCurrentImageWithData] = useState<any>(null);
  
  useEffect(() => {
    if (currentImage && getCurrentImageWithData) {
      getCurrentImageWithData().then(imageData => {
        setCurrentImageWithData(imageData);
      }).catch(err => {
        console.error('Error loading image data:', err);
        setCurrentImageWithData(currentImage);
      });
    }
  }, [currentImage, getCurrentImageWithData]);
  
  // Selected tool state
  const [selectedTool, setSelectedTool] = useState<string | null>(brushToolState?.tool);

  // Transform state refs for tool integration - synchronized with viewport state
  const ctTransform = useRef<any>({ scale: 1, offsetX: 0, offsetY: 0 });
  const mainViewportRef = useRef<MainViewportRef>(null);

  // Update ctTransform when viewport state changes
  useEffect(() => {
    if (viewportState) {
      ctTransform.current = {
        scale: viewportState.zoom,
        offsetX: viewportState.panX,
        offsetY: viewportState.panY
      };
    }
  }, [viewportState.zoom, viewportState.panX, viewportState.panY]);

  // Coordinate transformation functions with proper DICOM handling
  const worldToCanvas = useCallback((worldX: number, worldY: number): [number, number] => {
    if (!imageMetadata) return [0, 0];
    
    const transform = ctTransform.current || { scale: 1, offsetX: 0, offsetY: 0 };
    
    // Parse DICOM metadata
    const imagePosition = imageMetadata.imagePosition.split('\\').map(Number);
    const pixelSpacing = imageMetadata.pixelSpacing.split('\\').map(Number);
    const [rowSpacing, colSpacing] = pixelSpacing;
    
    // Convert world to pixel coordinates
    const pixelX = (worldX - imagePosition[0]) / colSpacing;
    const pixelY = (worldY - imagePosition[1]) / rowSpacing;
    
    // Apply zoom/pan transform
    const canvasX = transform.offsetX + (pixelX * transform.scale);
    const canvasY = transform.offsetY + (pixelY * transform.scale);
    
    return [canvasX, canvasY];
  }, [imageMetadata]);
  
  const canvasToWorld = useCallback((canvasX: number, canvasY: number): [number, number] => {
    if (!imageMetadata) return [0, 0];
    
    const transform = ctTransform.current || { scale: 1, offsetX: 0, offsetY: 0 };
    
    // Parse DICOM metadata
    const imagePosition = imageMetadata.imagePosition.split('\\').map(Number);
    const pixelSpacing = imageMetadata.pixelSpacing.split('\\').map(Number);
    const [rowSpacing, colSpacing] = pixelSpacing;
    
    // Apply inverse CT transform to get raw pixel coordinates
    const pixelX = (canvasX - transform.offsetX) / transform.scale;
    const pixelY = (canvasY - transform.offsetY) / transform.scale;
    
    // Convert pixel coordinates to world coordinates
    const worldX = imagePosition[0] + (pixelX * colSpacing);
    const worldY = imagePosition[1] + (pixelY * rowSpacing);
    
    return [worldX, worldY];
  }, [imageMetadata]);

  // Load secondary images for fusion when secondarySeriesId changes
  useEffect(() => {
    if (secondarySeriesId) {
      fetchSeriesImages(secondarySeriesId)
        .then(data => setSecondaryImages(data))
        .catch(err => console.error('Failed to load secondary images:', err));
      
      // Load registration matrix if available
      if (studyId) {
        fetch(`/api/registrations/${studyId}`)
          .then(res => res.ok ? res.json() : null)
          .then(data => {
            if (data?.transformation_matrix) {
              setRegistrationMatrix(data.transformation_matrix);
            }
          })
          .catch(err => console.error('Failed to load registration:', err));
      }
    } else {
      setSecondaryImages([]);
      setRegistrationMatrix(null);
    }
  }, [secondarySeriesId, studyId]);

  // Update external callbacks when internal state changes
  useEffect(() => {
    if (onImageMetadataChange && imageMetadata) {
      onImageMetadataChange(imageMetadata);
    }
  }, [imageMetadata, onImageMetadataChange]);

  useEffect(() => {
    if (onCurrentSlicePositionChange && currentSlicePos !== undefined) {
      onCurrentSlicePositionChange(currentSlicePos);
    }
  }, [currentSlicePos, onCurrentSlicePositionChange]);

  // Update selected tool when brushToolState changes
  useEffect(() => {
    setSelectedTool(brushToolState?.tool || null);
  }, [brushToolState?.tool]);

  // Expose methods to parent component
  useImperativeHandle(ref, () => ({
    getCurrentImage: () => currentImage,
    getCanvasTransform: () => ctTransform.current,
    focusOnStructure: (structureId: number) => {
      // TODO: Implement focus on structure functionality
    },
    autoZoom: (level: number) => {
      // TODO: Implement auto zoom functionality
    },
    autoLocalize: (target: { x: number; y: number; z: number }) => {
      // TODO: Implement auto localize functionality
    }
  }), [currentImage]);

  // Loading state
  if (isLoading) {
    return <LoadingSpinner message="Loading DICOM images..." />;
  }

  // Error state
  if (error) {
    return <ErrorDisplay error={error} onRetry={() => window.location.reload()} />;
  }

  // No images state
  if (!images.length || !currentImage) {
    return <ErrorDisplay error={{ message: 'No images available' }} />;
  }

  return (
    <Card className="bg-gradient-to-br from-gray-900 to-black border-gray-700/50 shadow-2xl h-full flex flex-col overflow-hidden">
      {/* Titlebar with navigation and info */}
      <div className="bg-gradient-to-r from-gray-800/90 to-gray-900/90 border-b border-gray-700/50 backdrop-blur-sm px-4 py-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <h3 className="text-lg font-semibold text-white tracking-wide">
              CT Scan - {orientation.charAt(0).toUpperCase() + orientation.slice(1)}
            </h3>
            
            {!isLoading && images.length > 0 && (
              <>
                <Badge className="bg-gray-700/60 text-gray-200 border border-gray-600/40 backdrop-blur-sm">
                  {currentIndex + 1} / {images.length}
                </Badge>
                
                {/* Window/Level/Z position pills */}
                <Badge className="bg-cyan-900/40 text-cyan-200 border border-cyan-600/30 backdrop-blur-sm">
                  W: {Math.round(viewportState.windowLevel.window)}
                </Badge>
                <Badge className="bg-orange-900/40 text-orange-200 border border-orange-600/30 backdrop-blur-sm">
                  L: {Math.round(viewportState.windowLevel.level)}
                </Badge>
                {imageMetadata && orientation === 'axial' && (
                  <Badge className="bg-purple-900/40 text-purple-200 border border-purple-600/30 backdrop-blur-sm">
                    Z: {currentSlicePos?.toFixed(1) || (currentIndex + 1)}
                  </Badge>
                )}
              </>
            )}
            {secondarySeriesId && secondaryImages.length > 0 && (
              <Badge className="flex items-center gap-1 border backdrop-blur-sm bg-purple-900/40 text-purple-200 border-purple-600/30">
                <div className="w-2 h-2 rounded-full animate-pulse bg-purple-400" />
                MR Fusion
                <span className="text-purple-300">
                  ({Math.round(fusionOpacity * 100)}%)
                </span>
              </Badge>
            )}
          </div>

          <div className="flex items-center space-x-2">
            {rtStructures && (
              <Button
                size="sm"
                variant={showStructures ? "default" : "ghost"}
                onClick={() => setShowStructures(!showStructures)}
                className={`h-8 px-3 transition-all duration-200 rounded-lg text-gray-300 ${
                  showStructures 
                    ? 'bg-green-600/80 hover:bg-green-700/80 text-white border border-green-500/50 shadow-sm backdrop-blur-sm' 
                    : 'hover:bg-gray-700/50 hover:text-white'
                }`}
              >
                RT ({rtStructures?.structures?.length || 0})
              </Button>
            )}
            
            <Button
              size="sm"
              variant="ghost"
              onClick={goToPrevious}
              disabled={currentIndex === 0}
              className="h-8 px-3 transition-all duration-200 rounded-lg text-gray-300 hover:bg-gray-700/50 hover:text-white disabled:opacity-50 disabled:hover:bg-transparent"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={goToNext}
              disabled={currentIndex >= images.length - 1}
              className="h-8 px-3 transition-all duration-200 rounded-lg text-gray-300 hover:bg-gray-700/50 hover:text-white disabled:opacity-50 disabled:hover:bg-transparent"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1 p-4 flex items-center justify-center relative overflow-hidden">
        <div className="relative w-full h-full flex items-center justify-center">
          <MainViewport
            ref={mainViewportRef}
            currentImage={currentImageWithData || currentImage}
            rtStructures={rtStructures}
            secondaryImages={secondaryImages}
            registrationMatrix={registrationMatrix}
            fusionOpacity={fusionOpacity}
            windowLevel={viewportState.windowLevel}
            viewportState={{
              zoom: viewportState.zoom,
              panX: viewportState.panX,
              panY: viewportState.panY
            }}
            structureVisibility={structureVisibility}
            selectedForEdit={selectedForEdit}
            contourSettings={contourSettings}
            currentSlicePosition={currentSlicePos}
            onMouseDown={viewportState.handleMouseDown}
            onMouseMove={viewportState.handleMouseMove}
            onMouseUp={viewportState.handleMouseUp}
            onWheel={handleCanvasWheel}
            keyboardNavigationDisabled={keyboardNavigationDisabled}
          />
        </div>

        {/* MPR floating canvases */}
        {isMPRVisible && (
          <MprCanvases
            volumeData={images.map(img => img.parsedPixelData)}
            currentSagittalIndex={Math.floor(currentIndex / 2)}
            currentCoronalIndex={Math.floor(currentIndex / 2)}
            windowLevel={viewportState.windowLevel}
            imageMetadata={imageMetadata}
            crosshairPosition={viewportState.crosshairPosition}
            isVisible={isMPRVisible}
          />
        )}

        {/* Tool overlays - only render when tool is selected and canvas is available */}
        {selectedTool && mainViewportRef?.current?.canvas && (
          <ToolRenderer
            selectedTool={selectedTool}
            canvasRef={{ current: mainViewportRef.current.canvas }}
            currentImage={currentImage}
            selectedForEdit={selectedForEdit}
            rtStructures={rtStructures}
            imageMetadata={imageMetadata}
            ctTransform={ctTransform}
            onContourUpdate={handleContourUpdate}
            worldToCanvas={worldToCanvas}
            canvasToWorld={canvasToWorld}
          />
        )}

        {/* Legacy components for compatibility - to be integrated in future versions */}
        {rtStructures && (
          <div className="absolute inset-0 pointer-events-none">
            <RTStructureOverlay
              rtStructures={rtStructures}
              currentSlicePosition={currentSlicePos}
              structureVisibility={structureVisibility}
              selectedForEdit={selectedForEdit}
              contourSettings={contourSettings}
            />
          </div>
        )}

        {/* Fusion control panel */}
        {showFusionPanel && (
          <div className="absolute top-4 right-4">
            <FusionControlPanel
              secondarySeriesId={secondarySeriesId}
              fusionOpacity={fusionOpacity}
              onSecondarySeriesSelect={onSecondarySeriesSelect}
              onFusionOpacityChange={onFusionOpacityChange}
            />
          </div>
        )}
      </div>
    </Card>
  );
});

WorkingViewer.displayName = 'WorkingViewer';