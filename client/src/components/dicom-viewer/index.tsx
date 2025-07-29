/**
 * Refactored DICOM Viewer - Main component using modular architecture
 * Replaces the monolithic 4000+ line WorkingViewer component
 */

import { useRef, useState, useEffect, forwardRef, useImperativeHandle, useCallback } from 'react';

// Services
import { fetchSeriesImages } from './services/apiService';

// Custom hooks
import { useDicomLoader } from './hooks/useDicomLoader';
import { useContourState } from './hooks/useContourState';
import { useViewportState } from './hooks/useViewportState';

// UI Components
import { ViewerToolbar } from './components/ViewerToolbar';
import { MainViewport, MainViewportRef } from './components/MainViewport';
import { LoadingSpinner } from './components/LoadingSpinner';
import { ErrorDisplay } from './components/ErrorDisplay';
import { MprCanvases } from './components/MprCanvases';
import { ToolRenderer } from './components/ToolRenderer';

// Tool components successfully integrated with modular architecture via ToolRenderer
// Legacy imports removed - tools now managed through ToolRenderer component

export interface RefactoredViewerProps {
  seriesId: number;
  studyId?: number;
  secondarySeriesId?: number | null;
  orientation?: 'axial' | 'sagittal' | 'coronal';
  onSeriesChange?: (seriesId: number) => void;
  onSecondarySeriesSelect?: (seriesId: number | null) => void;
  onFusionOpacityChange?: (opacity: number) => void;
  className?: string;
  keyboardNavigationDisabled?: boolean;
}

export interface RefactoredViewerRef {
  getCurrentImage: () => any | null;
  goToSlice: (index: number) => void;
  refreshData: () => void;
}

/**
 * Main refactored DICOM viewer component
 */
export const RefactoredViewer = forwardRef<RefactoredViewerRef, RefactoredViewerProps>(({
  seriesId,
  studyId,
  secondarySeriesId = null,
  orientation = 'axial',
  onSeriesChange,
  onSecondarySeriesSelect,
  onFusionOpacityChange,
  className = '',
  keyboardNavigationDisabled = false
}, ref) => {
  
  // Local state
  const [secondaryImages, setSecondaryImages] = useState<any[]>([]);
  const [isMPRVisible, setIsMPRVisible] = useState(false);
  const [fusionOpacity, setFusionOpacity] = useState(0);
  const [selectedTool, setSelectedTool] = useState<string | null>(null);
  const [brushToolState, setBrushToolState] = useState({ tool: null, settings: {} });

  // Refs
  const imageCache = useRef(new Map());
  const mainViewportRef = useRef<MainViewportRef>(null);

  // Custom hooks
  const {
    images,
    currentIndex,
    isLoading,
    error,
    loadingProgress,
    rtStructures,
    registrationMatrix,
    imageMetadata,
    goToNext,
    goToPrevious,
    goToSlice,
    refreshData,
    setCurrentIndex
  } = useDicomLoader({
    seriesId,
    studyId,
    secondarySeriesId,
    imageCache,
    orientation
  });

  const {
    selectedForEdit,
    structureVisibility,
    allStructuresVisible,
    contourSettings,
    currentSlicePosition,
    predictedContours,
    selectStructureForEdit,
    toggleStructureVisibility,
    toggleAllStructuresVisibility,
    updateContourSettings,
    setCurrentSlicePosition,
    handleContourUpdate,
    undo,
    redo,
    addPredictedContour,
    clearPredictedContours
  } = useContourState({
    initialStructures: rtStructures,
    seriesId,
    onStructuresUpdate: (structures) => {
      // Handle structure updates
      console.log('Structures updated:', structures);
    },
    onSlicePositionChange: (position) => {
      // Find the image index that matches this position
      const matchingIndex = images.findIndex(img => {
        const imgPos = parseFloat(img.sliceLocation || img.imagePosition?.split('\\')[2] || '0');
        return Math.abs(imgPos - position) < 1.0;
      });
      if (matchingIndex >= 0) {
        setCurrentIndex(matchingIndex);
      }
    }
  });

  const viewportState = useViewportState({
    initialWindowLevel: { window: 400, level: 40 },
    onWindowLevelChange: (windowLevel) => {
      console.log('Window/Level changed:', windowLevel);
    },
    onZoomChange: (zoom) => {
      console.log('Zoom changed:', zoom);
    },
    keyboardNavigationDisabled
  });

  // Transform state refs for tool integration - must be synchronized with MainViewport  
  const ctTransform = useRef<any>({ scale: 1, offsetX: 0, offsetY: 0 });

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

  // Proper coordinate transformation functions
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

  // Expose methods to parent component
  useImperativeHandle(ref, () => ({
    getCurrentImage: () => images[currentIndex] || null,
    goToSlice,
    refreshData
  }));

  // Handle MPR toggle
  const handleMPRToggle = () => {
    setIsMPRVisible(!isMPRVisible);
  };

  // Handle fusion opacity change
  const handleFusionOpacityChange = (opacity: number) => {
    setFusionOpacity(opacity);
    onFusionOpacityChange?.(opacity);
  };

  // Get current image and slice position
  const currentImage = images[currentIndex];
  const currentSlicePos = currentImage ? 
    parseFloat(currentImage.sliceLocation || currentImage.imagePosition?.split('\\')[2] || '0') : 0;

  // Handle loading state
  if (isLoading && images.length === 0) {
    return (
      <div className={className}>
        <LoadingSpinner 
          message="Loading DICOM images..." 
          progress={loadingProgress}
        />
      </div>
    );
  }

  // Handle error state
  if (error) {
    return (
      <div className={className}>
        <ErrorDisplay 
          error={error} 
          onRetry={refreshData}
        />
      </div>
    );
  }

  // Handle no images
  if (!currentImage) {
    return (
      <div className={className}>
        <ErrorDisplay 
          error="No images available for this series"
          onRetry={refreshData}
        />
      </div>
    );
  }

  return (
    <div className={`w-full h-full flex flex-col ${className}`}>
      {/* Toolbar */}
      <ViewerToolbar
        currentIndex={currentIndex}
        totalImages={images.length}
        currentSlicePosition={currentSlicePos}
        windowLevel={viewportState.windowLevel}
        orientation={orientation}
        isLoading={isLoading}
        onPrevious={goToPrevious}
        onNext={goToNext}
        onMPRToggle={handleMPRToggle}
        isMPRVisible={isMPRVisible}
      />

      {/* Main content area */}
      <div className="flex-1 relative">
        {/* Main viewport */}
        <div className="flex justify-center items-center h-full">
          <MainViewport
            ref={mainViewportRef}
            currentImage={currentImage}
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
            onWheel={viewportState.handleWheel}
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

        {/* Tool overlays integrated with new architecture */}
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

        {/* RT Structure overlay and Fusion controls - integration planned for next phase */}
        {/* TODO: Integrate RTStructureOverlay and FusionControlPanel with modular architecture */}
      </div>
    </div>
  );
});

RefactoredViewer.displayName = 'RefactoredViewer';