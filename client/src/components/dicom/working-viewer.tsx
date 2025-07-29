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
    goToSlice 
  } = useDicomLoader(seriesId, orientation);

  // Contour operations state
  const {
    selectedStructure: selectedStructureFromHook,
    handleContourUpdate,
    currentSlicePos
  } = useContourState(currentImage, onContourUpdate);

  // Viewport interaction state (zoom, pan, window/level)
  const viewportState = useViewportState({
    keyboardNavigationDisabled
  });

  // Secondary images for fusion
  const [secondaryImages, setSecondaryImages] = useState<any[]>([]);
  const [registrationMatrix, setRegistrationMatrix] = useState<number[] | null>(null);
  
  // MPR visibility state
  const [isMPRVisible, setIsMPRVisible] = useState(false);
  
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
    <div className={`relative w-full h-full bg-black ${className}`}>
      {/* Viewer toolbar */}
      <ViewerToolbar 
        currentIndex={currentIndex}
        totalImages={images.length}
        currentSlicePosition={currentSlicePos}
        windowLevel={viewportState.windowLevel}
        orientation={orientation}
        isLoading={isLoading}
        onPrevious={goToPrevious}
        onNext={goToNext}
        onMPRToggle={() => setIsMPRVisible(!isMPRVisible)}
        isMPRVisible={isMPRVisible}
      />

      <div className="relative flex-1 overflow-hidden">
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
    </div>
  );
});

WorkingViewer.displayName = 'WorkingViewer';