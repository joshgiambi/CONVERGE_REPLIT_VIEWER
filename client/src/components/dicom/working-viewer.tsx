import { useEffect, useRef, useState, forwardRef, useImperativeHandle, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Ruler } from "lucide-react";
import { SimpleBrushTool } from "./simple-brush-tool";
import { PenToolUnifiedV2 } from "./pen-tool-unified-v2";
import { EclipsePlanarContourTool } from "./eclipse-planar-contour-tool";
import { PenTool } from "./pen-tool";
import PenToolV2 from "./pen-tool-v2";

import { FusionControlPanel } from "./fusion-control-panel";
import { MeasurementTool } from "./measurement-tool";
import { MPRFloating } from './mpr-floating';
import { BrushOperation } from "@shared/schema";
import { growContour } from "@/lib/contour-grow";
import { gaussianSmoothContour as smoothContour } from "@/lib/contour-smooth-simple";
import {
  addBrushToContour,
  eraseBrushFromContour,
  mergeBrushWithContour,
  brushStrokeToPolishedPolygon,
} from "@/lib/brush-to-polygon";
import { applyDirectionalGrow } from "@/lib/contour-directional-grow";
import { naiveCombineContours as combineContours, naiveSubtractContours as subtractContours } from "@/lib/contour-boolean-operations";
import { predictNextSliceContour } from "@/lib/contour-prediction";
import { computeTransformedMRIPositions, renderFusionOverlay, invertMatrix4x4, transposeMatrix4x4, findNearestMRIIndexByPlane } from "@/lib/fusion-utils";
import { performPolygonUnion, polygonUnion } from "@/lib/polygon-union";
import { doPolygonsIntersectSimple, unionMultipleContoursSimple, growContourSimple } from "@/lib/simple-polygon-operations";
import { undoRedoManager } from "@/lib/undo-system";
import { attachDiceDebug } from "@/lib/dice-utils";
import { 
  isGPUAccelerationAvailable,
  initializeCornerstone3D,
  render16BitImageGPU
} from "@/lib/cornerstone3d-adapter";
import { log } from '@/lib/log';
import { createOrUpdateGPUViewport, hideGPUViewport, cleanupGPUViewports } from "@/lib/gpu-viewport-manager";
import { getDicomWorkerManager, destroyDicomWorkerManager } from '@/lib/dicom-worker-manager';
import { getSliceZ, sameSlice, getSpacing, getRescaleParams, SLICE_TOL_MM } from "@/lib/dicom-spatial-helpers";

// Debug flag - set to true in development, false in production
const DEBUG = process.env.NODE_ENV !== 'production';

// Typed preview contour interface for consistency
type PreviewContour = { 
  points: number[]; 
  slicePosition: number; 
  meta?: { margin?: number; type?: string };
};

// Using doPolygonsIntersectSimple from simple-polygon-operations for consistency

interface WorkingViewerProps {
  seriesId: number;
  studyId?: number;
  windowLevel?: { window: number; level: number };
  onWindowLevelChange?: (windowLevel: {
    window: number;
    level: number;
  }) => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onResetZoom?: () => void;
  rtStructures?: any;
  structureVisibility?: Map<number, boolean>;
  brushToolState?: {
    tool: string | null;
    brushSize: number;
    isActive: boolean;
    predictionEnabled?: boolean;
    smartBrushEnabled?: boolean;
  };
  selectedForEdit?: number | null;
  selectedStructures?: Set<number>;
  onBrushSizeChange?: (size: number) => void;
  onBrushToolChange?: (state: {
    tool: string | null;
    brushSize: number;
    isActive: boolean;
    predictionEnabled?: boolean;
    smartBrushEnabled?: boolean;
  }) => void;
  onContourUpdate?: (updatedStructures: any) => void;
  onRTStructureUpdate?: (structures: any) => Promise<void>;
  contourSettings?: { width: number; opacity: number };
  autoZoomLevel?: number;
  autoLocalizeTarget?: { x: number; y: number; z: number };
  onSlicePositionChange?: (slicePosition: number) => void;
  secondarySeriesId?: number | null;
  fusionOpacity?: number;
  onSecondarySeriesSelect?: (id: number | null) => void;
  onFusionOpacityChange?: (opacity: number) => void;
  hasSecondarySeriesForFusion?: boolean;
  onImageMetadataChange?: (metadata: any) => void;
  allStructuresVisible?: boolean;
  imageCache?: React.MutableRefObject<Map<string, { images: any[], metadata: any }>>;
  orientation?: 'axial' | 'sagittal' | 'coronal';
  onMPRToggle?: () => void;
  isMPRVisible?: boolean;
}

const WorkingViewer = forwardRef(function WorkingViewerComponent(props: WorkingViewerProps, ref: any) {
  const {
    seriesId,
    studyId,
    windowLevel: externalWindowLevel,
    onWindowLevelChange,
    onZoomIn,
    onZoomOut,
    onResetZoom,
    rtStructures: externalRTStructures,
    structureVisibility: externalStructureVisibility,
    brushToolState,
    selectedForEdit,
    selectedStructures,
    onBrushSizeChange,
    onBrushToolChange,
    onContourUpdate,
    onRTStructureUpdate,
    contourSettings,
    autoZoomLevel,
    autoLocalizeTarget,
    onSlicePositionChange,
    secondarySeriesId: externalSecondarySeriesId,
    fusionOpacity: externalFusionOpacity = 0.5,
    onSecondarySeriesSelect,
    onFusionOpacityChange,
    hasSecondarySeriesForFusion,
    onImageMetadataChange,
    allStructuresVisible = true,
    imageCache,
    orientation = 'axial',
  } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sagittalCanvasRef = useRef<HTMLCanvasElement>(null);
  const coronalCanvasRef = useRef<HTMLCanvasElement>(null);
  const [images, setImages] = useState<any[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Use external RT structures if provided, otherwise load our own
  const [localRTStructures, setLocalRTStructures] =
    useState(externalRTStructures);
  const rtStructures = localRTStructures || externalRTStructures;
  const structureVisibility = externalStructureVisibility || new Map();
  // Use prop directly instead of local state
  const showStructures = allStructuresVisible ?? true;
  const [renderTrigger, setRenderTrigger] = useState(0);
  const [animationTime, setAnimationTime] = useState(0);
  const [predictedContours, setPredictedContours] = useState<Map<string, any>>(new Map());
  const [previewContours, setPreviewContours] = useState<PreviewContour[]>([]);
  const [testPredictionAdded, setTestPredictionAdded] = useState(false);
  const [fusionAvailable, setFusionAvailable] = useState(true);
  const [imageMetadata, setImageMetadata] = useState<any>(null);
  const [dicomPixelData, setDicomPixelData] = useState<any>(null);
  
  // GPU acceleration state for hybrid rendering
  const [isGPUMode, setIsGPUMode] = useState(false);
  const [gpuCheckComplete, setGpuCheckComplete] = useState(false);
  const [cornerstone3DInitialized, setCornerstone3DInitialized] = useState(false);
  const [prefetchProgress, setPrefetchProgress] = useState({ loaded: 0, total: 0 });

  // Initialize Cornerstone3D when GPU is available
  useEffect(() => {
    if (gpuCheckComplete && isGPUMode && !cornerstone3DInitialized) {
      log.debug('Initializing Cornerstone3D for GPU-accelerated rendering...', 'viewer');
      initializeCornerstone3D().then((success) => {
        if (success) {
          log.debug('✅ Cornerstone3D initialized successfully', 'viewer');
          setCornerstone3DInitialized(true);
        } else {
          log.warn('❌ Failed to initialize Cornerstone3D, falling back to Cornerstone Core', 'viewer');
          setIsGPUMode(false);
        }
      });
    }
  }, [gpuCheckComplete, isGPUMode, cornerstone3DInitialized]);

  // Update local structures when external ones change
  useEffect(() => {
    // Only update if actually changed to prevent unnecessary re-renders
    log.debug('RT Structures update received', 'viewer');
    if (externalRTStructures && externalRTStructures !== localRTStructures) {
      log.debug('Setting local RT structures', 'viewer');
      setLocalRTStructures(externalRTStructures);
    }
  }, [externalRTStructures]);

  // Attach global dice helpers for quick validation
  useEffect(() => {
    attachDiceDebug(() => rtStructures);
  }, [rtStructures]);

  // No longer need to load RT structures here - handled by parent component
  // Convert external window/level format to internal width/center format
  const currentWindowLevel = externalWindowLevel
    ? { width: externalWindowLevel.window, center: externalWindowLevel.level }
    : { width: 400, center: 40 };

  // Function to update external window/level when internal changes
  const updateWindowLevel = (newWindowLevel: {
    width: number;
    center: number;
  }) => {
    if (onWindowLevelChange) {
      onWindowLevelChange({
        window: newWindowLevel.width,
        level: newWindowLevel.center,
      });
    }
  };
  // Use refs for caches to avoid expensive React re-renders
  const imageCacheRef = useRef<Map<string, { data: Float32Array; width: number; height: number }>>(new Map());
  const secondaryImageCacheRef = useRef<Map<string, { data: Float32Array; width: number; height: number }>>(new Map());
  const mprCacheRef = useRef<Map<string, { data: Uint16Array; width: number; height: number }>>(new Map());
  // Expose cache for MPRFloating (read-only reference)
  useEffect(() => {
    try {
      (window as any).__WV_CACHE__ = imageCacheRef.current;
    } catch {}
  }, []);
  const [isPreloading, setIsPreloading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isMeasurementToolActive, setIsMeasurementToolActive] = useState(false);
  const [isLoadingMPR, setIsLoadingMPR] = useState(false);
  // Use external MPR visibility state or fallback to internal state
  const mprVisible = props.isMPRVisible ?? false;
  
  // Secondary series state for fusion
  const [secondaryImages, setSecondaryImages] = useState<any[]>([]);
  const secondarySeriesId = externalSecondarySeriesId; // Use external prop directly instead of local state
  const fusionOpacity = externalFusionOpacity !== undefined ? externalFusionOpacity : 0.5;
  const [mriWindowLevel, setMriWindowLevel] = useState({ width: 0, center: 0 }); // Use auto-calculated values by default
  const [registrationMatrix, setRegistrationMatrix] = useState<number[] | null>(null);
  const registrationMatrixRef = useRef<number[] | null>(null);
  const [secondaryModality, setSecondaryModality] = useState<string>('MR');
  
  // Cache for MRI slice mappings to prevent recalculation during scrolling
  const mriSliceMappingCache = useRef<Map<number, { mriIndex: number; distance: number } | null>>(new Map());
  // Pre-computed MRI Z-range in CT space for performance
  const mriZRangeInCTSpace = useRef<{ min: number; max: number } | null>(null);
  // Pre-computed transformed MRI positions for fast lookup
  const transformedMRIPositions = useRef<Array<{ xInCT: number; yInCT: number; zInCT: number; image: any }>>([]); 
  // CT transform for fusion coordinate system alignment
  const ctTransform = useRef<{scale: number, offsetX: number, offsetY: number, imageWidth: number, imageHeight: number} | null>(null);

  // Zoom and pan state
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  
  // Crosshair position for MPR views (in pixel coordinates)
  const [crosshairPos, setCrosshairPos] = useState({ x: 256, y: 256 });
  const [crosshairMode, setCrosshairMode] = useState(false);
  const [isPanMode, setIsPanMode] = useState(true); // Pan mode is default
  
  // Render scheduling to prevent redundant renders
  const needsRenderRef = useRef(false);
  const displayCurrentImageRef = useRef<() => Promise<void>>();
  const prefetchCompleteRef = useRef(false);
  
  // Frame rate limiting for smoother scrolling
  const lastRenderTimeRef = useRef<number>(0);
  const RENDER_THROTTLE_MS = 16; // 60fps max
  const fusionRenderDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const isScrollingRef = useRef(false);
  
  const scheduleRender = useCallback(() => {
    if (needsRenderRef.current) return;
    needsRenderRef.current = true;
    
    // Mark as scrolling for fusion optimization
    isScrollingRef.current = true;
    if (fusionRenderDebounceRef.current) {
      clearTimeout(fusionRenderDebounceRef.current);
    }
    
    // Throttle renders during rapid scrolling
    const now = performance.now();
    const timeSinceLastRender = now - lastRenderTimeRef.current;
    
    if (timeSinceLastRender < RENDER_THROTTLE_MS) {
      // Delay render to maintain frame rate
      setTimeout(() => {
        needsRenderRef.current = false;
        if (displayCurrentImageRef.current) {
          displayCurrentImageRef.current();
        }
        lastRenderTimeRef.current = performance.now();
      }, RENDER_THROTTLE_MS - timeSinceLastRender);
    } else {
      requestAnimationFrame(async () => {
        needsRenderRef.current = false;
        if (displayCurrentImageRef.current) {
          await displayCurrentImageRef.current();
        }
        lastRenderTimeRef.current = performance.now();
        
        // Debounce fusion rendering for smoother scrolling
        fusionRenderDebounceRef.current = setTimeout(() => {
          isScrollingRef.current = false;
          // Re-render with full quality fusion after scrolling stops
          if (fusionOpacity > 0 && secondarySeriesId) {
            scheduleRender();
          }
        }, 100);
      });
    }
  }, [fusionOpacity, secondarySeriesId]);
  
  // Abort controller for series changes
  const seriesAbortRef = useRef<AbortController | null>(null);
  
  // Optimized rendering with cached LUT and offscreen canvas
  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const cachedLUTRef = useRef<{ key: string; lut: Uint8Array } | null>(null);
  
  // Secondary image prefetch optimization
  const secondaryPrefetchCompleteRef = useRef(false);
  const lastFusionRenderRef = useRef<{ ctZ: number; mriIndex: number } | null>(null);



  // Save contour updates using debounced save
  const saveContourUpdates = (updatedStructures: any, action?: string) => {
    log.debug(`Queuing save for ${action || 'unknown action'}`, 'viewer');
    if (debouncedSaveRef.current) {
      debouncedSaveRef.current(updatedStructures);
    } else {
      log.warn('Debounced save not initialized', 'viewer');
    }
  };

  // Handle boolean operations (combine/subtract) between structures
  const handleBooleanOperation = async (payload: any) => {
    if (!rtStructures) {
      log.error('RT structures not available for boolean operation', 'viewer');
      return;
    }

    const { operation, sourceStructureId, targetStructureId, slicePosition } = payload;
    log.debug(`🔶 Performing ${operation} op between ${sourceStructureId} and ${targetStructureId} @ slice ${slicePosition}`, 'viewer');

    // Create a deep copy of RT structures to avoid mutation
    const updatedRTStructures = structuredClone ? structuredClone(rtStructures) : JSON.parse(JSON.stringify(rtStructures));

    // Find the source and target structures
    const sourceStructure = updatedRTStructures.structures?.find(
      (s: any) => s.roiNumber === sourceStructureId,
    );
    const targetStructure = updatedRTStructures.structures?.find(
      (s: any) => s.roiNumber === targetStructureId,
    );

    if (!sourceStructure || !targetStructure) {
      log.error('Source or target structure not found', 'viewer');
      return;
    }

    // Find contours on the specified slice for both structures
    const sourceContour = sourceStructure.contours?.find(
      (c: any) => Math.abs(c.slicePosition - slicePosition) < SLICE_TOL_MM,
    );
    const targetContour = targetStructure.contours?.find(
      (c: any) => Math.abs(c.slicePosition - slicePosition) < SLICE_TOL_MM,
    );

    if (!sourceContour || !sourceContour.points || sourceContour.points.length < 9) {
      log.warn(`No source contour found on slice ${slicePosition}`, 'viewer');
      return;
    }

    if (!targetContour || !targetContour.points || targetContour.points.length < 9) {
      log.warn(`No target contour found on slice ${slicePosition}`, 'viewer');
      return;
    }

    try {
      let resultContours: number[][];

      // Import the boolean operations
      const { combineContours, subtractContours } = await import('@/lib/clipper-boolean-operations');

      if (operation === 'combine') {
        // Combine the two contours
        resultContours = await combineContours(sourceContour.points, targetContour.points);
        log.debug(`🔶 Combine returned ${resultContours.length} contours`, 'viewer');
      } else if (operation === 'subtract') {
        // Subtract target from source
        resultContours = await subtractContours(sourceContour.points, targetContour.points);
        log.debug(`🔶 Subtract returned ${resultContours.length} contours`, 'viewer');
      } else {
        log.error(`Unknown boolean operation: ${operation}`, 'viewer');
        return;
      }

      // Remove the source contour from current slice
      const sourceContourIndex = sourceStructure.contours.findIndex(
        (c: any) => Math.abs(c.slicePosition - slicePosition) < SLICE_TOL_MM
      );
      
      if (sourceContourIndex >= 0) {
        sourceStructure.contours.splice(sourceContourIndex, 1);
      }

      // Add all result contours
      if (resultContours && resultContours.length > 0) {
        resultContours.forEach((contourPoints: number[]) => {
          if (contourPoints.length >= 9) {
            sourceStructure.contours.push({
              slicePosition: slicePosition,
              points: contourPoints,
              numberOfPoints: contourPoints.length / 3,
            });
          }
        });
        
        log.debug(`✅ Boolean ${operation} completed: ${resultContours.length} contours`, 'viewer');
      } else {
        log.debug(`✅ Boolean ${operation} completed: empty`, 'viewer');
      }

      // Update local structures and save to server
      setLocalRTStructures(updatedRTStructures);
      saveContourUpdates(updatedRTStructures, 'boolean_operation');
      
      // Pass the updated structures up to parent component
      if (onContourUpdate) {
        onContourUpdate(updatedRTStructures);
      }

      // Save state to undo system
      if (seriesId) {
        undoRedoManager.saveState(seriesId, 'boolean_operation', sourceStructureId, updatedRTStructures);
      }

    } catch (error) {
      log.error(`Error performing ${operation} op: ${String(error)}`, 'viewer');
    }
  };

  // Handle Eclipse TPS margin operation
  const handleMarginOperation = (payload: any) => {
    log.debug('🔹 handleMarginOperation called', 'viewer');
    
    if (!localRTStructures && !rtStructures) {
      log.error('RT structures not available for margin operation', 'viewer');
      return;
    }

    const structures = localRTStructures || rtStructures;
    const { structureId, parameters } = payload;
    
    // Check if this is an execute operation (applying preview)
    if (payload.action === 'apply_margin' && !payload.isPreview && previewContours.length > 0) {
      log.debug('🔹 Executing margin operation - applying preview contours', 'viewer');
      
      // Create a deep copy of RT structures
      const updatedRTStructures = structuredClone ? structuredClone(structures) : JSON.parse(JSON.stringify(structures));
      
      // Find the target structure
      const structure = updatedRTStructures.structures?.find(
        (s: any) => s.roiNumber === structureId,
      );
      
      if (!structure) {
        log.error(`Structure ${structureId} not found`, 'viewer');
        return;
      }
      
      // Replace structure contours with preview contours
      structure.contours = previewContours.map((preview: any) => ({
        slicePosition: preview.slicePosition,
        points: preview.points,
        numberOfPoints: preview.points.length / 3
      }));
      
      log.debug(`🔹 Replaced ${structure.contours.length} contours with preview contours`, 'viewer');
      
      // Clear preview
      setPreviewContours([]);
      
      // Update local structures and save
      setLocalRTStructures(updatedRTStructures);
      saveContourUpdates(updatedRTStructures, 'apply_margin');
      
      // Pass the updated structures up to parent component
      if (onContourUpdate) {
        onContourUpdate(updatedRTStructures);
      }
      
      log.debug(`✅ Applied margin to structure ${structureId}`, 'viewer');
      return;
    }
    
    // For single slice margin operations (legacy)
    if (payload.slicePosition !== undefined) {
      log.debug('🔹 Single slice margin operation (legacy)', 'viewer');
      
      const { slicePosition, marginParams } = payload;
      const updatedRTStructures = structuredClone ? structuredClone(structures) : JSON.parse(JSON.stringify(structures));
      
      const structure = updatedRTStructures.structures?.find(
        (s: any) => s.roiNumber === structureId,
      );
      
      if (!structure) {
        log.error(`Structure ${structureId} not found`, 'viewer');
        return;
      }
      
      const contour = structure.contours.find(
        (c: any) => Math.abs(c.slicePosition - slicePosition) <= SLICE_TOL_MM,
      );
      
      if (!contour || !contour.points || contour.points.length === 0) {
        log.warn(`No contour found for structure ${structureId} at slice ${slicePosition}`, 'viewer');
        return;
      }
      
      try {
        const marginValueMm = marginParams.marginValues.uniform;
        
        const grownContour = growContour(
          {
            points: contour.points,
            slicePosition: slicePosition,
          },
          marginValueMm,
        );
        
        let smoothingFactor = 0.15;
        if (marginParams.interpolationType === 'SMOOTH') {
          smoothingFactor = 0.25;
        } else if (marginParams.interpolationType === 'DISCRETE') {
          smoothingFactor = 0.05;
        }
        
        const smoothedContour = smoothContour(grownContour, smoothingFactor);
        
        contour.points = smoothedContour.points;
        contour.numberOfPoints = smoothedContour.points.length / 3;
        
        setLocalRTStructures(updatedRTStructures);
        saveContourUpdates(updatedRTStructures, 'apply_margin');
        
        if (onContourUpdate) {
          onContourUpdate(updatedRTStructures);
        }
        
        log.debug(`Applied margin of ${marginValueMm}mm to structure ${structureId}`, 'viewer');
      } catch (error) {
        log.error(`Error applying margin operation: ${String(error)}`, 'viewer');
      }
    }
  };

  // Handle preview grow contour operation
  const handlePreviewGrowOperation = async (payload: any) => {
    if (!localRTStructures) {
      log.error('RT structures not available for preview', 'viewer');
      return;
    }

    const { structureId, slicePosition, distance, direction = 'all' } = payload;
    log.debug(`🔹 Generating preview for structure ${structureId} by ${distance}mm @ slice ${slicePosition}`, 'viewer');

    // Find the target structure
    const structure = localRTStructures.structures?.find(
      (s: any) => s.roiNumber === structureId,
    );
    if (!structure) {
      console.error(`Structure ${structureId} not found`);
      return;
    }

    // Find the contour for the specified slice
    const contour = structure.contours?.find(
      (c: any) => Math.abs(c.slicePosition - slicePosition) < SLICE_TOL_MM,
    );

    if (!contour || !contour.points || contour.points.length < 9) {
      console.error(`No contour found for structure ${structureId} at slice ${slicePosition}`);
      return;
    }

    try {
      // Use the simple grow operation for preview
      let previewPoints: number[];
      
      if (distance > 0) {
        // Growing - use simple operations
        const { growContourSimple } = await import('@/lib/simple-polygon-operations');
        previewPoints = growContourSimple(contour.points, distance);
      } else {
        // For shrinking, use the original algorithm for now
        const grownContour = growContour(
          {
            points: contour.points,
            slicePosition: slicePosition,
          },
          distance,
        );
        previewPoints = grownContour.points;
      }

      // Set preview contours for rendering
      setPreviewContours([{
        points: previewPoints,
        slicePosition: slicePosition,
        meta: { type: 'grow_preview' }
      }]);
      
      console.log(`🔹 ✅ Generated preview with ${previewPoints.length / 3} points`);
      
    } catch (error) {
      console.error(`🔹 ❌ Error generating preview:`, error);
    }
  };

  // Handle grow contour operation using medical imaging algorithms
  const handleGrowContour = (payload: any) => {
    if (!localRTStructures) {
      console.error("RT structures not available for growing");
      return;
    }

    const { structureId, slicePosition, distance, direction = 'all' } = payload;
    const isGrowing = distance > 0;
    if (DEBUG) console.log(
      `${isGrowing ? 'Growing' : 'Shrinking'} contour for structure ${structureId} by ${Math.abs(distance)}mm ${direction !== 'all' ? `in ${direction} direction` : 'in all directions'} at slice ${slicePosition}`,
    );

    // Create a deep copy of RT structures to avoid mutation
    const updatedRTStructures = structuredClone ? structuredClone(localRTStructures) : JSON.parse(JSON.stringify(localRTStructures));

    // Find the target structure
    const structure = updatedRTStructures.structures?.find(
      (s: any) => s.roiNumber === structureId,
    );
    if (!structure) {
      console.error(`Structure ${structureId} not found`);
      return;
    }

    // Find the contour for the specified slice
    const contour = structure.contours?.find(
      (c: any) => Math.abs(c.slicePosition - slicePosition) < SLICE_TOL_MM,
    );

    if (!contour || !contour.points || contour.points.length < 9) {
      console.warn(
        `No contour found on slice ${slicePosition} or insufficient points`,
      );
      return;
    }

    try {
      let updatedPoints: number[];
      
      if (direction === 'all') {
        // For single slice operations, still use 2D for speed
        // But note this is a single-slice operation, not volumetric
        updatedPoints = growContourSimple(contour.points, distance);
      } else {
        // Use directional grow/shrink
        updatedPoints = applyDirectionalGrow(
          contour.points,
          distance,
          direction,
          imageMetadata?.imageOrientation
        );
        
        // Apply smoothing
        const smoothedContour = smoothContour(
          {
            points: updatedPoints,
            slicePosition: slicePosition,
          },
          0.15
        );
        updatedPoints = smoothedContour.points;
      }

      // Update the contour with grown/shrunk points
      contour.points = updatedPoints;
      contour.numberOfPoints = updatedPoints.length / 3;

      // Update local structures and save to server
      setLocalRTStructures(updatedRTStructures);
      saveContourUpdates(updatedRTStructures, 'grow_contour');
      
      // Pass the updated structures up to parent component
      if (onContourUpdate) {
        onContourUpdate(updatedRTStructures);
      }

      console.log(`Successfully ${isGrowing ? 'grew' : 'shrunk'} contour by ${Math.abs(distance)}mm`);
    } catch (error) {
      console.error(`Error ${isGrowing ? 'growing' : 'shrinking'} contour:`, error);
    }
  };

  // Handle preview grow structure operation - works on ALL slices
  const handlePreviewGrowStructure = async (payload: any) => {
    console.log('🔹 🚀 handlePreviewGrowStructure called with payload:', payload);
    
    if (!localRTStructures) {
      console.error("🔹 ❌ RT structures not available for structure preview");
      console.log('🔹 localRTStructures is:', localRTStructures);
      return;
    }

    console.log('🔹 ✅ localRTStructures available:', localRTStructures);
    console.log('🔹 Available structures:', localRTStructures.structures?.map((s: any) => ({
      roiNumber: s.roiNumber,
      structureName: s.structureName,
      contourCount: s.contours?.length || 0
    })));

    const { structureId, targetStructureId, parameters } = payload;
    const marginValue = parameters?.marginValues?.uniform || parameters?.margin || 5;
    console.log(`🔹 Generating simple margin preview for structure ${structureId} by ${marginValue}mm`);
    console.log(`🔹 Target structure: ${targetStructureId || 'same structure'}`);

    // Find the target structure
    const structure = localRTStructures.structures?.find(
      (s: any) => s.roiNumber === structureId,
    );
    if (!structure) {
      console.error(`🔹 ❌ Structure ${structureId} not found`);
      return;
    }

    console.log(`🔹 ✅ Found structure:`, {
      roiNumber: structure.roiNumber,
      structureName: structure.structureName,
      contourCount: structure.contours?.length || 0
    });

    // Get all contours for this structure
    const allContours = structure.contours || [];
    if (allContours.length === 0) {
      console.error(`🔹 ❌ No contours found for structure ${structureId}`);
      return;
    }

    console.log(`🔹 ✅ Found ${allContours.length} contours for processing`);

    try {
      const previewContoursWithSlices: Array<{points: number[], slicePosition: number}> = [];
      
      for (const contour of allContours) {
        if (!contour.points || contour.points.length < 9) {
          console.log('🔹 ⚠️ Skipping contour with insufficient points:', contour.points?.length);
          continue;
        }
        
        console.log(`🔹 Processing contour with ${contour.points.length / 3} points on slice ${contour.slicePosition}`);
        
        let previewPoints: number[];
        
        // Use simple grow operation for consistent results
        const { growContourSimple } = await import('@/lib/simple-polygon-operations');
        previewPoints = growContourSimple(contour.points, marginValue);
        
        // Store preview contour with slice position metadata
        previewContoursWithSlices.push({
          points: previewPoints,
          slicePosition: contour.slicePosition
        });
        console.log(`🔹 ✅ Generated preview contour with ${previewPoints.length / 3} points for slice ${contour.slicePosition}`);
      }

      // Convert to the format expected by the renderer
      setPreviewContours(previewContoursWithSlices as any);
      console.log(`🔹 ✅ Set ${previewContoursWithSlices.length} preview contours for rendering`);
      
      console.log(`🔹 ✅ Generated structure preview with ${previewContoursWithSlices.length} slices`);
      
    } catch (error) {
      console.error(`🔹 ❌ Error generating structure preview:`, error);
    }
  };

  // Handle advanced margin preview operation
  const handleAdvancedMarginPreview = async (payload: any) => {
    console.log('🔹 🎯 Working Viewer: handleAdvancedMarginPreview called with payload:', payload);
    
    // Use rtStructures from props if localRTStructures is not available
    const structures = localRTStructures || rtStructures;
    
    if (!structures) {
      console.error("🔹 ❌ RT structures not available for margin preview");
      return;
    }

    const { structureId, parameters } = payload;
    console.log(`🔹 📊 Generating 3D volumetric margin preview for structure ${structureId} with parameters:`, parameters);
    console.log('🔹 📊 Parameters detail:', JSON.stringify(parameters, null, 2));

    try {
      // Find the target structure
      const structure = structures.structures?.find(
        (s: any) => s.roiNumber === structureId,
      );
      if (!structure) {
        console.error(`🔹 ❌ Structure ${structureId} not found`);
        return;
      }
      
      console.log(`🔹 ✅ Found structure: ${structure.structureName || structure.name} with ${structure.contours?.length || 0} contours`);

      // Clear any existing preview
      setPreviewContours([]);

      const marginValue = parameters.margin || 5;
      console.log('🔹 📊 Margin value:', marginValue);

      // Uniform margin preview: use DT worker for large |margin|, otherwise fast 2D offset
      if (parameters?.marginType === 'UNIFORM') {
        const useWorker = Math.abs(marginValue) >= 3;
        if (useWorker) {
          try {
            // Abort any in-flight preview worker
            if ((window as any).__marginPreviewWorker) {
              try { (window as any).__marginPreviewWorker.terminate(); } catch {}
            }
            const worker = new Worker(new URL('@/margins/margin-worker.ts', import.meta.url), { type: 'module' });
            (window as any).__marginPreviewWorker = worker;
            const px = imageMetadata?.pixelSpacing || [1, 1];
            const th = imageMetadata?.sliceThickness || 2;
            const spacing: [number, number, number] = [px[1] ?? px[0], px[0], th];
            const jobId = `prev-${Date.now()}`;
            const padding = Math.abs(marginValue) + 5;
            const srcContours = structure.contours || [];
            const previewPromise: Promise<any> = new Promise((resolve, reject) => {
              worker.onmessage = (ev: MessageEvent<any>) => {
                if (!ev.data || ev.data.jobId !== jobId) return;
                try { worker.terminate(); } catch {}
                (window as any).__marginPreviewWorker = null;
                if (ev.data.ok) resolve(ev.data.contours); else reject(ev.data.error);
              };
              worker.onerror = (err) => {
                try { worker.terminate(); } catch {}
                (window as any).__marginPreviewWorker = null;
                reject(err);
              };
            });
            worker.postMessage({ jobId, kind: 'UNIFORM', contours: srcContours, spacing, padding, margin: marginValue });
            const workerContours = await previewPromise;
            const previewContoursWithSlices: any[] = (workerContours || []).map((c: any) => ({
              points: c.points,
              slicePosition: c.slicePosition,
              isPreview: true,
              previewColor: '#FFFF00'
            }));
            setPreviewContours(previewContoursWithSlices);
            return;
          } catch (err) {
            console.warn('DT preview worker failed, falling back to 2D offset:', err);
          }
        }
        // Fallback/fast path: 2D offset per slice
        const { offsetContour } = await import('@/lib/clipper-boolean-operations');
        const previewContoursWithSlices: any[] = [];
        for (const contour of structure.contours) {
          if (!contour.points || contour.points.length < 9) continue;
          try {
            const outs = await offsetContour(contour.points, marginValue);
            outs?.forEach(out => {
              if (out.length >= 9) {
                previewContoursWithSlices.push({
                  points: out,
                  slicePosition: contour.slicePosition,
                  isPreview: true,
                  previewColor: '#FFFF00'
                });
              }
            });
          } catch (err) {
            console.warn(`Offset preview failed for slice ${contour.slicePosition}:`, err);
          }
        }
        setPreviewContours(previewContoursWithSlices);
        return;
      }

      // Import the optimized 3D volumetric margin operation handler
      const { apply3DMarginOptimized } = await import('@/lib/volumetric-margin-operations-optimized');
      
      // Get pixel spacing from image metadata
      const pixelSpacing: [number, number, number] = imageMetadata?.pixelSpacing 
        ? [imageMetadata.pixelSpacing[0], imageMetadata.pixelSpacing[1], imageMetadata.sliceThickness || 2]
        : [1, 1, 2];
      
      console.log('🔹 Using pixel spacing for optimized 3D operation:', pixelSpacing);
      
      // Use fast 3D algorithm for preview if margin is large enough
      const useFast3D = Math.abs(marginValue) > 1;
      
      if (useFast3D) {
        console.log(`🚀 Using fast 3D preview for ${marginValue}mm margin`);
        
        const { applyFast3DMargin } = await import('@/lib/fast-3d-margin-operations');
        
        // Get image metadata for 3D processing
        const imgPixelSpacing = imageMetadata?.pixelSpacing || [1, 1];
        const sliceThickness = imageMetadata?.sliceThickness || 2;
        
        const fast3DResults = await applyFast3DMargin(
          structure.contours,
          {
            marginMm: marginValue,
            pixelSpacing: [imgPixelSpacing[0], imgPixelSpacing[1], sliceThickness],
            imageMetadata: {
              imagePosition: [0, 0, 0], // Will be calculated from contours
              imageSize: { width: 512, height: 512, depth: 100 }
            },
            useOptimizedAlgorithm: true,
            maxProcessingTime: 5000 // 5 seconds max for preview
          }
        );
        
        // Create preview contours
        const previewContoursWithSlices: any[] = fast3DResults.map((contour: any) => ({
          points: contour.points,
          slicePosition: contour.slicePosition,
          isPreview: true,
          previewColor: '#FFFF00'  // Yellow for preview
        }));
        
        console.log(`🚀 ✅ Generated ${previewContoursWithSlices.length} fast 3D preview contours`);
        setPreviewContours(previewContoursWithSlices);
        
      } else {
        // Use existing simple 2D preview for small margins
        console.log(`🔹 Using 2D preview for small ${marginValue}mm margin`);
        
        const { growContourSimple } = await import('@/lib/simple-polygon-operations');
        const previewContoursWithSlices: any[] = [];
        
        for (const contour of structure.contours) {
          if (!contour.points || contour.points.length < 9) continue;
          
          try {
            const expandedPoints = growContourSimple(contour.points, marginValue);
            previewContoursWithSlices.push({
              points: expandedPoints,
              slicePosition: contour.slicePosition,
              isPreview: true,
              previewColor: '#FFFF00'  // Yellow for preview
            });
          } catch (error) {
            console.warn(`Preview failed for contour at slice ${contour.slicePosition}:`, error);
          }
        }
        
        console.log(`🔹 ✅ Generated ${previewContoursWithSlices.length} 2D preview contours`);
        setPreviewContours(previewContoursWithSlices);
      }
    } catch (error) {
      console.error('🔹 ❌ 3D margin preview failed:', error);
      setPreviewContours([]);
    }
  };

  // Handle advanced margin execution operation
  const handleAdvancedMarginExecution = async (payload: any) => {
    console.log('🔹 🎯 Working Viewer: handleAdvancedMarginExecution called with payload:', payload);
    
    // Use local structures or props structures
    const structures = localRTStructures || rtStructures;
    
    if (!structures) {
      console.error("🔹 ❌ RT structures not available for margin execution");
      return;
    }
    
    const { structureId, targetStructureId, parameters } = payload;
    
    console.log(`🔹 📊 Executing margin operation for structure ${structureId} with parameters:`, parameters);
    console.log(`🔹 Target structure ID: ${targetStructureId || 'same structure'}`);
    
    try {
      // Create a deep copy of RT structures
      const updatedRTStructures = structuredClone ? structuredClone(structures) : JSON.parse(JSON.stringify(structures));
      
      // Find the source structure
      const sourceStructure = updatedRTStructures.structures?.find(
        (s: any) => s.roiNumber === structureId,
      );
      
      if (!sourceStructure) {
        console.error(`Source structure ${structureId} not found`);
        return;
      }
      
      // Determine target structure
      let targetStructure = sourceStructure;
      if (targetStructureId && targetStructureId !== structureId) {
        targetStructure = updatedRTStructures.structures?.find(
          (s: any) => s.roiNumber === targetStructureId,
        );
        if (!targetStructure) {
          console.error(`Target structure ${targetStructureId} not found`);
          return;
        }
      }
      
      const marginValue = parameters.marginValues?.uniform || parameters.margin || 5;
      console.log(`🔹 Applying margin of ${marginValue}mm to ${sourceStructure.contours?.length || 0} contours`);

      // Uniform margin: prefer fast 3D execution to match Eclipse volumetric margin
      if (parameters?.marginType === 'UNIFORM') {
        try {
          const { applyFast3DMargin } = await import('@/lib/fast-3d-margin-operations');
          const px = imageMetadata?.pixelSpacing || [1, 1];
          const th = imageMetadata?.sliceThickness || 2;
          const fast3DResults = await applyFast3DMargin(
            sourceStructure.contours || [],
            {
              marginMm: marginValue,
              pixelSpacing: [px[0], px[1], th],
              imageMetadata: {
                imagePosition: [0, 0, 0],
                imageSize: { width: 512, height: 512, depth: 100 }
              },
              useOptimizedAlgorithm: true,
              maxProcessingTime: 15000
            }
          );
          const processedContours = fast3DResults.map((c: any) => ({
            slicePosition: c.slicePosition,
            points: c.points,
            numberOfPoints: c.numberOfPoints || c.points.length / 3
          }));
          targetStructure.contours = processedContours;
        } catch (e2) {
          console.warn('Fast 3D execution failed, falling back to 2D offset:', e2);
          const { offsetContour } = await import('@/lib/clipper-boolean-operations');
          const processedContours: any[] = [];
          for (const contour of sourceStructure.contours || []) {
            if (!contour.points || contour.points.length < 9) continue;
            try {
              const outs = await offsetContour(contour.points, marginValue);
              outs?.forEach(out => {
                if (out.length >= 9) {
                  processedContours.push({
                    slicePosition: contour.slicePosition,
                    points: out,
                    numberOfPoints: out.length / 3
                  });
                }
              });
            } catch (err) {
              console.warn('Offset execution failed; preserving original contour:', err);
              processedContours.push({
                slicePosition: contour.slicePosition,
                points: contour.points,
                numberOfPoints: contour.points.length / 3
              });
            }
          }
          targetStructure.contours = processedContours;
        }

        // Clear preview and persist
        setPreviewContours([]);
        if (seriesId) {
          undoRedoManager.saveState(seriesId, 'apply_margin', structureId, updatedRTStructures);
        }
        setLocalRTStructures(updatedRTStructures);
        saveContourUpdates(updatedRTStructures, 'apply_margin');
        if (onContourUpdate) {
          onContourUpdate(updatedRTStructures);
        }
        console.log(`✅ Successfully applied uniform margin to structure ${targetStructure.roiNumber}`);
        return;
      }
      
      // Choose algorithm based on margin parameters and structure size
      let use3D = Math.abs(marginValue) > 2 || (sourceStructure.contours?.length || 0) > 5;
      let processedContours: any[] = [];
      
      if (use3D) {
        console.log(`🚀 Using fast 3D margin algorithm for ${marginValue}mm margin`);
        try {
          // Use fast 3D algorithm for true volumetric expansion
          const { applyFast3DMargin } = await import('@/lib/fast-3d-margin-operations');
          
          // Get image metadata for 3D processing
          const pixelSpacing = imageMetadata?.pixelSpacing || [1, 1];
          const sliceThickness = imageMetadata?.sliceThickness || 2;
          
          const fast3DResults = await applyFast3DMargin(
            sourceStructure.contours || [],
            {
              marginMm: marginValue,
              pixelSpacing: [pixelSpacing[0], pixelSpacing[1], sliceThickness],
              imageMetadata: {
                imagePosition: [0, 0, 0], // Will be calculated from contours
                imageSize: { width: 512, height: 512, depth: 100 }
              },
              useOptimizedAlgorithm: true,
              maxProcessingTime: 15000 // 15 seconds max
            }
          );
          
          processedContours = fast3DResults.map(contour => ({
            slicePosition: contour.slicePosition,
            points: contour.points,
            numberOfPoints: contour.numberOfPoints || contour.points.length / 3
          }));
          
          console.log(`🚀 ✅ Fast 3D margin generated ${processedContours.length} contours`);
          
        } catch (error) {
          console.warn('🚀 ⚠️ Fast 3D margin failed, falling back to 2D:', error);
          use3D = false; // Fall back to 2D
        }
      }
      
      if (!use3D || processedContours.length === 0) {
        console.log(`🔹 Using 2D simple algorithm for ${marginValue}mm margin`);
        
        // Import the simple grow operation
        const { growContourSimple } = await import('@/lib/simple-polygon-operations');
        
        // Process each contour using the simple algorithm
        processedContours = [];
        for (const contour of sourceStructure.contours || []) {
          if (!contour.points || contour.points.length < 9) {
            continue;
          }
          
          try {
            const expandedPoints = growContourSimple(contour.points, marginValue);
            
            processedContours.push({
              slicePosition: contour.slicePosition,
              points: expandedPoints,
              numberOfPoints: expandedPoints.length / 3
            });
          } catch (error) {
            console.warn(`Failed to process contour at slice ${contour.slicePosition}:`, error);
          }
        }
      }
      
      // Apply results to target structure
      targetStructure.contours = processedContours;
      
      console.log(`🔹 ✅ Applied simple/3D margin, generated ${processedContours.length} contours`);
      
      // Clear preview contours
      setPreviewContours([]);
      
      // Save to undo/redo and persist
      if (seriesId) {
        undoRedoManager.saveState(seriesId, 'apply_margin', structureId, updatedRTStructures);
      }
      setLocalRTStructures(updatedRTStructures);
      saveContourUpdates(updatedRTStructures, 'apply_margin');
      
      // Pass the updated structures up to parent component
      if (onContourUpdate) {
        onContourUpdate(updatedRTStructures);
      }
      
      console.log(`✅ Successfully applied simple margin to structure ${targetStructure.roiNumber}`);
    } catch (error) {
      console.error("🔹 ❌ Error applying simple margin operation:", error);
    }
  };

  // Handle grow structure operation - works on ALL slices
  const handleGrowStructure = (payload: any) => {
    if (!localRTStructures) {
      console.error("RT structures not available for structure growing");
      return;
    }

    const { structureId, distance, direction = 'all' } = payload;
    const isGrowing = distance > 0;
    if (DEBUG) console.log(
      `🔹 ${isGrowing ? 'Growing' : 'Shrinking'} ENTIRE STRUCTURE ${structureId} by ${Math.abs(distance)}mm on ALL slices`,
    );

    // Create a deep copy of RT structures to avoid mutation
    const updatedRTStructures = structuredClone ? structuredClone(localRTStructures) : JSON.parse(JSON.stringify(localRTStructures));

    // Find the target structure
    const structure = updatedRTStructures.structures?.find(
      (s: any) => s.roiNumber === structureId,
    );
    if (!structure) {
      console.error(`Structure ${structureId} not found`);
      return;
    }

    // Get all contours for this structure
    const allContours = structure.contours || [];
    if (allContours.length === 0) {
      console.error(`No contours found for structure ${structureId}`);
      return;
    }

    try {
      let processedSlices = 0;
      
      for (const contour of allContours) {
        if (!contour.points || contour.points.length < 9) continue;
        
        let updatedPoints: number[];
        
        if (direction === 'all') {
          // Use new simple polygon grow/shrink algorithm for better results
          updatedPoints = growContourSimple(contour.points, distance);
        } else {
          // Use directional grow/shrink
          updatedPoints = applyDirectionalGrow(
            contour.points,
            distance,
            direction,
            imageMetadata?.imageOrientation
          );
          
          // Apply smoothing
          const smoothedContour = smoothContour(
            {
              points: updatedPoints,
              slicePosition: contour.slicePosition,
            },
            0.15
          );
          updatedPoints = smoothedContour.points;
        }

        // Update the contour with grown/shrunk points
        contour.points = updatedPoints;
        contour.numberOfPoints = updatedPoints.length / 3;
        processedSlices++;
      }

      // Update local structures and save to server
      setLocalRTStructures(updatedRTStructures);
      saveContourUpdates(updatedRTStructures, 'grow_structure');
      
      // Pass the updated structures up to parent component
      if (onContourUpdate) {
        onContourUpdate(updatedRTStructures);
      }

      console.log(`🔹 ✅ Successfully ${isGrowing ? 'grew' : 'shrunk'} structure ${structureId} on ${processedSlices} slices by ${Math.abs(distance)}mm`);
    } catch (error) {
      console.error(`🔹 ❌ Error ${isGrowing ? 'growing' : 'shrinking'} structure:`, error);
    }
  };

  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [lastPanX, setLastPanX] = useState(0);
  const [lastPanY, setLastPanY] = useState(0);

  // Simple debounce implementation
  const debounce = (func: Function, wait: number) => {
    let timeout: NodeJS.Timeout;
    const debounced = (...args: any[]) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => func(...args), wait);
    };
    debounced.cancel = () => clearTimeout(timeout);
    return debounced;
  };

  // Create debounced save function
  const debouncedSaveRef = useRef<any>(null);
  const lastSavedHashRef = useRef<string>("");
  
  // Initialize debounced save on mount
  useEffect(() => {
    const saveToServer = async (structures: any) => {
      if (!structures) return;
      
      // Create hash of structures to check for changes
      const structuresHash = JSON.stringify({
        count: structures.structures?.length || 0,
        contourCounts: structures.structures?.map((s: any) => ({
          id: s.roiNumber,
          count: s.contours?.length || 0
        }))
      });
      
      // Skip if no changes since last save
      if (structuresHash === lastSavedHashRef.current) {
        console.log("Skipping save - no changes detected");
        return;
      }
      
      try {
        console.log("Saving contour updates to server...");
        if (onRTStructureUpdate) {
          await onRTStructureUpdate(structures);
        }
        lastSavedHashRef.current = structuresHash;
      } catch (error) {
        console.error("Failed to save contour updates:", error);
      }
    };
    
    // Create debounced function with 500ms delay
    debouncedSaveRef.current = debounce(saveToServer, 500);
    
    return () => {
      if (debouncedSaveRef.current?.cancel) {
        debouncedSaveRef.current.cancel();
      }
    };
  }, [onRTStructureUpdate]);

  // Handle contour updates from brush tool and other contour editing operations
  const handleContourUpdate = async (payload: any) => {
    // Handle margin toolbar operations
    if (payload && payload.type && payload.type.includes('margin')) {
      if (payload.preview) {
        console.log("🔹 Margin preview request from toolbar:", payload);
        await handlePreviewGrowStructure({
          structureId: payload.structureId,
          targetStructureId: payload.targetStructureId,
          parameters: payload.parameters
        });
        return;
      } else {
        console.log("🔹 Margin execution request from toolbar:", payload);
        await handleAdvancedMarginExecution({
          action: 'execute_margin',
          structureId: payload.structureId,
          targetStructureId: payload.targetStructureId,
          parameters: payload.parameters
        });
        return;
      }
    }

    // Handle refresh action from undo/redo
    if (payload && payload.action === 'refresh' && payload.rtStructures) {
      console.log('Refreshing RT structures from undo/redo');
      setLocalRTStructures(payload.rtStructures);
      // Pass the updated structures up to parent component
      if (onContourUpdate) {
        onContourUpdate(payload.rtStructures);
      }
      return;
    }

    // Handle preview operations
    if (payload && payload.action === "preview_grow_contour") {
      console.log("🔹 Preview grow contour request:", payload);
      await handlePreviewGrowOperation(payload);
      return;
    }

    if (payload && payload.action === "preview_grow_structure") {
      console.log("🔹 Preview grow STRUCTURE request:", payload);
      await handlePreviewGrowStructure(payload);
      return;
    }

    if (payload && payload.action === "clear_preview") {
      console.log("🔹 Clearing preview contours");
      setPreviewContours([]);
      return;
    }

    // Handle advanced margin preview operations
    if (payload && payload.action === "preview_margin") {
      console.log("🔹 Advanced margin preview request:", payload);
      await handleAdvancedMarginPreview(payload);
      return;
    }

    // Handle advanced margin execution operations
    if (payload && payload.action === "execute_margin") {
      console.log("🔹 Advanced margin execution request:", payload);
      await handleAdvancedMarginExecution(payload);
      return;
    }
    
    // Special handling for undo/redo results which return full RT structures
    if (payload && payload.structures && !payload.action) {
      console.log('Applying undo/redo result with', payload.structures.length, 'structures');
      
      // Optimize update to only change modified structures
      setLocalRTStructures((prevStructures: any) => {
        if (!prevStructures) return payload;
        
        // Create a new object with the same reference for unchanged properties
        const updatedStructures = {
          ...prevStructures,
          structures: prevStructures.structures.map((oldStruct: any) => {
            // Find the corresponding structure in the new data
            const newStruct = payload.structures.find((s: any) => s.roiNumber === oldStruct.roiNumber);
            
            // If structure wasn't changed, keep the same reference
            if (newStruct && JSON.stringify(oldStruct) === JSON.stringify(newStruct)) {
              return oldStruct;
            }
            
            // If structure was changed or removed, use the new one
            return newStruct || oldStruct;
          })
        };
        
        // Add any new structures that weren't in the old data
        payload.structures.forEach((newStruct: any) => {
          if (!updatedStructures.structures.find((s: any) => s.roiNumber === newStruct.roiNumber)) {
            updatedStructures.structures.push(newStruct);
          }
        });
        
        return updatedStructures;
      });
      
      // Pass the updated structures up to parent component
      if (onContourUpdate) {
        onContourUpdate(payload);
      }
      return;
    }
    
    // Check if two polygons intersect by checking if any points are close
    const checkPolygonIntersection = (polygon1: number[], polygon2: number[]) => {
      const threshold = 2.0; // Distance threshold in world coordinates (mm) - reduced for more accurate contours
      
      // Check each point in polygon1 against polygon2
      for (let i = 0; i < polygon1.length; i += 3) {
        const p1x = polygon1[i];
        const p1y = polygon1[i + 1];
        
        for (let j = 0; j < polygon2.length; j += 3) {
          const p2x = polygon2[j];
          const p2y = polygon2[j + 1];
          
          const distance = Math.sqrt(
            Math.pow(p1x - p2x, 2) + Math.pow(p1y - p2y, 2)
          );
          
          if (distance < threshold) {
            return true; // Found intersection
          }
        }
      }
      
      return false; // No intersection found
    };
    log.debug('Handling contour update', 'viewer');

    if (!rtStructures || !rtStructures.structures) {
      log.error('No RT structures available', 'viewer');
      return;
    }

    // Handle refresh action for undo/redo
    if (payload.action === "refresh") {
      log.debug('Refreshing RT structures after undo/redo', 'viewer');
      // Update with the RT structures from the payload
      if (payload.rtStructures) {
        setLocalRTStructures(payload.rtStructures);
        // Force re-render of the canvas
        if (images.length > 0) {
          // Add a small delay to ensure state updates are processed
          setTimeout(() => {
            scheduleRender();
          }, 50);
        }
      }
      return;
    }

    // Create a deep copy to avoid mutations
    const updatedStructures = structuredClone ? structuredClone(rtStructures) : JSON.parse(JSON.stringify(rtStructures));

    if (payload.action === "brush_stroke") {
      // Handle brush stroke - add points to contour
      const structure = updatedStructures.structures.find(
        (s: any) => s.roiNumber === payload.structureId,
      );
      if (!structure) {
        log.error(`Structure ${payload.structureId} not found`, 'viewer');
        return;
      }

      // Convert brush stroke to polished polygon for smooth edges
      let brushPolygon: number[];
      
      // CRITICAL FIX: The brush size should NOT be converted to world coordinates here
      // The brush size is already in screen pixels and should remain that way
      // The polygon creation function will handle coordinate transformation internally
      
      log.debug(`Brush size: ${payload.brushSize}px (pixel units)`, 'viewer');
      log.debug('Sample brush point coordinates present', 'viewer');
      
      // TEMPORARILY DISABLED: Polishing causing structure morphing/shrinking
      // Use unpolished brush stroke until polishing is fixed
      brushPolygon = addBrushToContour(
        [], // Empty array to get just the brush polygon
        payload.points,
        payload.brushSize, // Use pixel size directly - let polygon function handle conversion
      );
      log.debug('Using unpolished brush stroke (polishing temporarily disabled)', 'viewer');
      
      // TODO: Fix polishing ClipperLib compatibility issue
      // The polishing function is failing with "Error polishing contour" 
      // and causing structures to morph/shrink when multiple strokes are added

      // Collect all contours on this slice
      const existingOnSlice = structure.contours.filter(
        (c: any) => Math.abs(c.slicePosition - payload.slicePosition) <= SLICE_TOL_MM
      );

      // Check if brush stroke intersects with any existing contour
      let intersectsWithExisting = false;
      const intersectingContours: any[] = [];
      const nonIntersectingContours: any[] = [];
      
      for (const contour of existingOnSlice) {
        if (contour.points && contour.points.length >= 9) {
          // Check if brush polygon intersects with this contour
          const intersects = doPolygonsIntersectSimple(brushPolygon, contour.points);
          if (intersects) {
            intersectsWithExisting = true;
            intersectingContours.push(contour);
          } else {
            nonIntersectingContours.push(contour);
          }
        }
      }

      // Remove all existing contours at this slice
      structure.contours = structure.contours.filter(
        (c: any) => Math.abs(c.slicePosition - payload.slicePosition) > SLICE_TOL_MM
      );

      if (intersectsWithExisting) {
        // Union brush with intersecting contours only
        const polygonsToUnion: number[][] = [];
        
        // Add intersecting contours
        for (const contour of intersectingContours) {
          polygonsToUnion.push(contour.points);
        }
        
        // Add the new brush polygon
        polygonsToUnion.push(brushPolygon);

        // Perform union of intersecting polygons using simple operations
        const unionResults = unionMultipleContoursSimple(polygonsToUnion);
        const unionResult = unionResults.length > 0 ? unionResults[0] : [];
        
        // Add the unified contour
        if (unionResult.length >= 9) {
          structure.contours.push({
            slicePosition: payload.slicePosition,
            points: unionResult,
            numberOfPoints: unionResult.length / 3,
          });
        }
        
        // Re-add non-intersecting contours as separate blobs
        for (const contour of nonIntersectingContours) {
          structure.contours.push({
            slicePosition: payload.slicePosition,
            points: contour.points,
            numberOfPoints: contour.numberOfPoints,
          });
        }
      } else {
        // Brush doesn't intersect - create separate blob
        // Add brush as new separate contour
        structure.contours.push({
          slicePosition: payload.slicePosition,
          points: brushPolygon,
          numberOfPoints: brushPolygon.length / 3,
        });
        
        // Re-add all existing contours unchanged
        for (const contour of existingOnSlice) {
          structure.contours.push({
            slicePosition: payload.slicePosition,
            points: contour.points,
            numberOfPoints: contour.numberOfPoints,
          });
        }
      }

      console.log(`Structure now has ${structure.contours.length} contours`);
      setLocalRTStructures(updatedStructures);
      
      // Handle next slice prediction if enabled
      if (payload.predictionEnabled) {
        console.log("Next slice prediction is enabled, predicting contours for adjacent slices");
        
        // Get the final contour on this slice
        // Find the contour we just created
        const finalContour = structure.contours[structure.contours.length - 1];
        
        if (finalContour && finalContour.points && finalContour.points.length > 0) {
          // Calculate next slice positions (assuming 3mm slice spacing as typical)
          const sliceSpacing = 3; // mm
          const nextSlicePosition = payload.slicePosition + sliceSpacing;
          const prevSlicePosition = payload.slicePosition - sliceSpacing;
          
          // Predict for next slice
          const nextPrediction = predictNextSliceContour({
            currentContour: finalContour.points,
            currentSlicePosition: payload.slicePosition,
            targetSlicePosition: nextSlicePosition,
            anatomicalRegion: 'head', // You could determine this from metadata
            predictionMode: 'simple',
            confidenceThreshold: 0.5
          });
          
          // If prediction has good confidence, apply it
          if (nextPrediction.confidence > 0.5 && nextPrediction.predictedContour.length > 0) {
            // Check if there's already a contour on the next slice
            const nextSliceContourIndex = structure.contours.findIndex(
              (c: any) => Math.abs(c.slicePosition - nextSlicePosition) < SLICE_TOL_MM
            );
            
            if (nextSliceContourIndex === -1) {
              // No existing contour, add the predicted one
              structure.contours.push({
                slicePosition: nextSlicePosition,
                points: nextPrediction.predictedContour,
                numberOfPoints: nextPrediction.predictedContour.length / 3,
                isPredicted: true // Mark as predicted
              });
              console.log(`Added predicted contour to next slice ${nextSlicePosition} with confidence ${nextPrediction.confidence.toFixed(2)}`);
            }
          }
          
          // Also predict for previous slice
          const prevPrediction = predictNextSliceContour({
            currentContour: finalContour.points,
            currentSlicePosition: payload.slicePosition,
            targetSlicePosition: prevSlicePosition,
            anatomicalRegion: 'head',
            predictionMode: 'simple',
            confidenceThreshold: 0.5
          });
          
          if (prevPrediction.confidence > 0.5 && prevPrediction.predictedContour.length > 0) {
            const prevSliceContourIndex = structure.contours.findIndex(
              (c: any) => Math.abs(c.slicePosition - prevSlicePosition) < SLICE_TOL_MM
            );
            
            if (prevSliceContourIndex === -1) {
              structure.contours.push({
                slicePosition: prevSlicePosition,
                points: prevPrediction.predictedContour,
                numberOfPoints: prevPrediction.predictedContour.length / 3,
                isPredicted: true
              });
              console.log(`Added predicted contour to previous slice ${prevSlicePosition} with confidence ${prevPrediction.confidence.toFixed(2)}`);
            }
          }
          
          // Update the structures again with predictions
          setLocalRTStructures(updatedStructures);
        }
      }
      // Save state to new undo system
      if (seriesId) {
        undoRedoManager.saveState(seriesId, 'add_brush_stroke', payload.structureId, updatedStructures);
      }
      saveContourUpdates(updatedStructures, 'add_brush_stroke');
    } else if (payload.action === "smart_brush_stroke") {
      // Handle smart brush stroke - add already processed contour points
      if (DEBUG) console.log("🎯 Processing smart brush stroke:", payload);
      
      const structure = updatedStructures.structures.find(
        (s: any) => s.roiNumber === payload.structureId,
      );
      if (!structure) {
        console.error(`Structure ${payload.structureId} not found`);
        return;
      }

      // The smart brush now provides a pre-unified polygon. We will process it
      // with the same robust logic as a regular brush stroke to correctly handle
      // intersections and the creation of multiple blobs.
      const brushPolygon: number[] = payload.points;

      // Collect all contours on this slice
      const existingOnSlice = structure.contours.filter(
        (c: any) => Math.abs(c.slicePosition - payload.slicePosition) <= SLICE_TOL_MM
      );

      // Check if brush stroke intersects with any existing contour
      let intersectsWithExisting = false;
      const intersectingContours: any[] = [];
      const nonIntersectingContours: any[] = [];

      for (const contour of existingOnSlice) {
        if (contour.points && contour.points.length >= 9) {
          const intersects = doPolygonsIntersectSimple(brushPolygon, contour.points);
          if (intersects) {
            intersectsWithExisting = true;
            intersectingContours.push(contour);
          } else {
            nonIntersectingContours.push(contour);
          }
        }
      }

      // Remove all existing contours at this slice; we will add them back.
      structure.contours = structure.contours.filter(
        (c: any) => Math.abs(c.slicePosition - payload.slicePosition) > SLICE_TOL_MM
      );

      if (intersectsWithExisting) {
        // If the new stroke intersects, union it with all intersecting contours
        const polygonsToUnion = [brushPolygon, ...intersectingContours.map(c => c.points)];
        const unionResults = unionMultipleContoursSimple(polygonsToUnion);
        
        // Add the new unified contour(s)
        if (unionResults && unionResults.length > 0) {
          unionResults.forEach((polygonPoints: number[]) => {
            if (polygonPoints.length >= 9) {
              structure.contours.push({
                slicePosition: payload.slicePosition,
                points: polygonPoints,
                numberOfPoints: polygonPoints.length / 3,
              });
            }
          });
        }
        
        // Re-add the contours that did not intersect
        for (const contour of nonIntersectingContours) {
          structure.contours.push(contour);
        }
      } else {
        // If there's no intersection, add the new brush stroke as a new contour
        structure.contours.push({
          slicePosition: payload.slicePosition,
          points: brushPolygon,
          numberOfPoints: brushPolygon.length / 3,
        });
        
        // And re-add all the other existing contours as they were
        for (const contour of existingOnSlice) {
          structure.contours.push(contour);
        }
      }

      if (DEBUG) console.log(`Structure now has ${structure.contours.length} contours after smart brush`);
      setLocalRTStructures(updatedStructures);
      
      // Save state to undo system
      if (seriesId) {
        undoRedoManager.saveState(seriesId, 'smart_brush_stroke', payload.structureId, updatedStructures);
      }
      saveContourUpdates(updatedStructures, 'smart_brush_stroke');
    } else if (payload.action === "erase_stroke") {
      // Handle erase stroke - subtract points from contour
      console.log("🔹 Processing erase stroke:", payload);
      
      const structure = updatedStructures.structures.find(
        (s: any) => s.roiNumber === payload.structureId,
      );
      if (!structure) {
        console.error(`Structure ${payload.structureId} not found`);
        return;
      }

      // Convert erase stroke to polygon for subtraction
      const erasePolygon = addBrushToContour(
        [], // Empty array to get just the erase polygon
        payload.points,
        payload.brushSize,
      );
      
      console.log(`Erase polygon created with ${erasePolygon.length / 3} points`);

      // Collect all contours on this slice
      const tol = 0.5;
      const existingOnSlice = structure.contours.filter(
        (c: any) => Math.abs(c.slicePosition - payload.slicePosition) <= tol
      );

      // Remove all existing contours at this slice
      structure.contours = structure.contours.filter(
        (c: any) => Math.abs(c.slicePosition - payload.slicePosition) > tol
      );

      // Process each existing contour - subtract the erase area
      for (const contour of existingOnSlice) {
        if (contour.points && contour.points.length >= 9) {
          // Check if erase polygon intersects with this contour
          const intersects = doPolygonsIntersectSimple(erasePolygon, contour.points);
          
          if (intersects) {
            // Subtract erase area from this contour
            const { subtractContourSimple } = await import('@/lib/simple-polygon-operations');
            const subtractResults = subtractContourSimple(contour.points, erasePolygon);
            
            // Add resulting contours (there may be multiple after subtraction)
            for (const resultContour of subtractResults) {
              if (resultContour.length >= 9) {
                structure.contours.push({
                  slicePosition: payload.slicePosition,
                  points: resultContour,
                  numberOfPoints: resultContour.length / 3,
                });
              }
            }
          } else {
            // No intersection - keep original contour
            structure.contours.push({
              slicePosition: payload.slicePosition,
              points: contour.points,
              numberOfPoints: contour.numberOfPoints,
            });
          }
        }
      }

      console.log(`Erase completed - structure now has ${structure.contours.length} contours`);

      // Update state
      setLocalRTStructures(updatedStructures);

      // Pass the updated structures up to parent component
      if (onContourUpdate) {
        onContourUpdate(updatedStructures);
      }

      // Save state to undo system
      if (seriesId) {
        undoRedoManager.saveState(seriesId, 'erase_brush_stroke', payload.structureId, updatedStructures);
      }
      saveContourUpdates(updatedStructures, 'erase_brush_stroke');
    } else if (
      payload.action === "add_pen_stroke" ||
      payload.action === "cut_pen_stroke"
    ) {
      // Handle pen tool operations
      const structure = updatedStructures.structures.find(
        (s: any) => s.roiNumber === payload.structureId,
      );
      if (!structure) return;

      // Find contour on current slice - use very tight tolerance to avoid affecting adjacent slices
      const tolerance = 0.1; // 0.1mm tolerance - much tighter to prevent multi-slice issues
      const sliceContour = structure.contours.find(
        (c: any) =>
          Math.abs(c.slicePosition - payload.slicePosition) <= tolerance,
      );

      if (payload.action === "add_pen_stroke") {
        if (sliceContour) {
          // Just append the new pen stroke without connecting
          // This creates a separate blob on the same slice
          const mergedPoints = [...sliceContour.points, ...payload.points];
          sliceContour.points = mergedPoints;
          sliceContour.numberOfPoints = mergedPoints.length / 3;
        } else {
          // Create new contour from pen stroke
          structure.contours.push({
            slicePosition: payload.slicePosition,
            points: payload.points,
            numberOfPoints: payload.points.length / 3,
          });
        }
      } else if (payload.action === "cut_pen_stroke") {
        // TODO: Implement contour cutting logic
        console.log("Cut pen stroke not yet implemented");
      }

      setLocalRTStructures(updatedStructures);
      // Save state to new undo system
      if (seriesId) {
        undoRedoManager.saveState(seriesId, payload.action, payload.structureId, updatedStructures);
      }
      // Save contour updates to server
      saveContourUpdates(updatedStructures, payload.action);
    } else if (payload.action === "pen_boolean_operation") {
      // Handle pen tool boolean operations (union/subtract)
      const structure = updatedStructures.structures.find(
        (s: any) => s.roiNumber === payload.structureId,
      );
      if (!structure) return;

      // Find contour on current slice - use tight tolerance to prevent multi-slice operations
      const tolerance = 0.1;
      const contourIndex = structure.contours.findIndex(
        (c: any) =>
          Math.abs(c.slicePosition - payload.slicePosition) <= tolerance,
      );

      if (payload.operation === 'union' && contourIndex >= 0) {
        // For union, use polygon union to merge overlapping areas properly
        const existingContour = structure.contours[contourIndex];
        const existingPolygons: number[][][] = [];
        
        // Convert existing contour points to polygons
        for (let i = 0; i < existingContour.points.length; i += 3) {
          if (i === 0 || (i > 0 && existingContour.points[i-3] === undefined)) {
            // Start of a new polygon
            existingPolygons.push([]);
          }
          existingPolygons[existingPolygons.length - 1].push([
            existingContour.points[i],
            existingContour.points[i+1]
          ]);
        }
        
        // Convert new pen stroke to polygon
        const newPolygon = [];
        for (let i = 0; i < payload.points.length; i += 3) {
          newPolygon.push([payload.points[i], payload.points[i+1]]);
        }
        
        // Perform polygon union
        const allPolygons = [...existingPolygons, newPolygon];
        const unionResult = performPolygonUnion(allPolygons);
        
        // Convert union result back to points array
        const unionPoints: number[] = [];
        unionResult.forEach(polygon => {
          polygon.forEach(([x, y]) => {
            unionPoints.push(x, y, payload.slicePosition);
          });
        });
        
        // Update contour with union result
        structure.contours[contourIndex] = {
          slicePosition: payload.slicePosition,
          points: unionPoints,
          numberOfPoints: unionPoints.length / 3,
        };
        
        console.log('Pen union operation completed');
      } else if (payload.operation === 'separate') {
        // For separate blobs, always create a new contour object
        // This keeps them visually separate without complex NaN handling
        structure.contours.push({
          slicePosition: payload.slicePosition,
          points: payload.points,
          numberOfPoints: payload.points.length / 3,
        });
        console.log('Added separate blob as new contour');
      } else if (payload.operation === 'union' && contourIndex === -1) {
        // First contour on slice
        structure.contours.push({
          slicePosition: payload.slicePosition,
          points: payload.points,
          numberOfPoints: payload.points.length / 3,
        });
      } else if (payload.operation === 'new') {
        // Handle the simple case - just add new contour from resultContours
        if (payload.resultContours && payload.resultContours.length > 0) {
          // resultContours is an array of polygons
          // For 'new' operation, we expect a single polygon
          const polygon = payload.resultContours[0];
          const points = [];
          
          // Convert polygon points to flat array
          for (let i = 0; i < polygon.length; i += 2) {
            points.push(polygon[i], polygon[i + 1], payload.slicePosition);
          }
          
          structure.contours.push({
            slicePosition: payload.slicePosition,
            points: points,
            numberOfPoints: points.length / 3,
          });
        }
      } else if (payload.operation === 'subtract') {
        // For subtraction, calculate the result using ClipperLib
        console.log('🔴 STARTING SUBTRACTION OPERATION:', {
          contourIndex,
          existingContoursAtSlice: structure.contours.filter((c: any) => 
            Math.abs(c.slicePosition - payload.slicePosition) <= tolerance
          ).length,
          slicePosition: payload.slicePosition
        });
        
        if (contourIndex >= 0) {
          // Get the existing contour to subtract from
          const existingContour = structure.contours[contourIndex];
          
          // Convert points to polygons for ClipperLib
          const existingPolygon = [];
          for (let i = 0; i < existingContour.points.length; i += 3) {
            existingPolygon.push([existingContour.points[i], existingContour.points[i+1]]);
          }
          
          const newPolygon = [];
          for (let i = 0; i < payload.points.length; i += 3) {
            newPolygon.push([payload.points[i], payload.points[i+1]]);
          }
          
          // Perform subtraction using ClipperLib
          const subtractResult = subtractContours(
            existingContour.points,
            payload.points
          );
          
          console.log('📐 Subtraction result:', {
            existingPoints: existingContour.points.length / 3,
            newPoints: payload.points.length / 3,
            resultPoints: subtractResult.length / 3
          });
          
          // Remove the original contour
          structure.contours.splice(contourIndex, 1);
          
          if (subtractResult.length === 0) {
            console.log('🗑️ Subtraction resulted in empty contour, removed slice');
          } else {
            // Add the subtraction result as new contour
            structure.contours.push({
              slicePosition: payload.slicePosition,
              points: subtractResult,
              numberOfPoints: subtractResult.length / 3,
            });
            console.log(`✅ Pen subtraction completed, replaced contour with ${subtractResult.length / 3} points`);
          }
        } else {
          console.warn('⚠️ Subtraction operation called but no existing contour found');
        }
      }

      setLocalRTStructures(updatedStructures);
      saveContourUpdates(updatedStructures, 'pen_boolean_operation');
    } else if (payload.action === "update_rt_structures") {
      // Simple update after pen tool operations - structure already modified directly
      setLocalRTStructures(updatedStructures);
      // Save state to undo system
      if (seriesId && payload.structureId) {
        undoRedoManager.saveState(seriesId, 'pen_tool', payload.structureId, updatedStructures);
      }
      // Save to server
      saveContourUpdates(updatedStructures, 'pen_tool');
    } else if (payload.action === "replace_contour") {
      // Handle contour replacement (morphing)
      const structure = updatedStructures.structures.find(
        (s: any) => s.roiNumber === payload.structureId,
      );
      if (!structure) return;

      // Find and replace the contour on current slice
      const contourIndex = structure.contours.findIndex(
        (c: any) =>
          Math.abs(c.slicePosition - payload.slicePosition) <= SLICE_TOL_MM,
      );

      if (contourIndex >= 0) {
        // Replace existing contour with new points
        structure.contours[contourIndex] = {
          slicePosition: payload.slicePosition,
          points: payload.points,
          numberOfPoints: payload.points.length / 3,
        };
        console.log(
          `Replaced contour at slice ${payload.slicePosition} with ${payload.points.length / 3} points`,
        );
      } else {
        // Create new contour if none exists
        structure.contours.push({
          slicePosition: payload.slicePosition,
          points: payload.points,
          numberOfPoints: payload.points.length / 3,
        });
        console.log(
          `Created new contour at slice ${payload.slicePosition} with ${payload.points.length / 3} points`,
        );
      }

      setLocalRTStructures(updatedStructures);
    } else if (payload.action === "merge_contours") {
      // Handle boolean merge operation (union) - properly merges multiple contours into one
      const structure = updatedStructures.structures.find(
        (s: any) => s.roiNumber === payload.structureId,
      );
      if (!structure) return;

      // Replace all contours at this slice with the merged result
      
      // Remove all existing contours at this slice
      structure.contours = structure.contours.filter(
        (c: any) => Math.abs(c.slicePosition - payload.slicePosition) > SLICE_TOL_MM
      );

      // Add the merged contours from the boolean operation
      if (payload.contours && payload.contours.length > 0) {
        payload.contours.forEach((contourPoints: number[]) => {
          if (contourPoints.length >= 9) {
            structure.contours.push({
              slicePosition: payload.slicePosition,
              points: contourPoints,
              numberOfPoints: contourPoints.length / 3,
            });
          }
        });
        console.log(`Merged contours at slice ${payload.slicePosition}: ${payload.contours.length} contours added`);
      }

      setLocalRTStructures(updatedStructures);
      saveContourUpdates(updatedStructures, 'merge_contours');
    } else if (payload.action === "subtract_contours") {
      // Handle boolean subtract operation (difference)
      const structure = updatedStructures.structures.find(
        (s: any) => s.roiNumber === payload.structureId,
      );
      if (!structure) return;

      // Replace all contours at this slice with the subtraction result
      
      // Remove all existing contours at this slice
      structure.contours = structure.contours.filter(
        (c: any) => Math.abs(c.slicePosition - payload.slicePosition) > SLICE_TOL_MM
      );

      // Add the resulting contours from the boolean operation
      if (payload.contours && payload.contours.length > 0) {
        payload.contours.forEach((contourPoints: number[]) => {
          if (contourPoints.length >= 9) {
            structure.contours.push({
              slicePosition: payload.slicePosition,
              points: contourPoints,
              numberOfPoints: contourPoints.length / 3,
            });
          }
        });
        console.log(`Subtraction result at slice ${payload.slicePosition}: ${payload.contours.length} contours added`);
      } else {
        console.log(`Subtraction result at slice ${payload.slicePosition}: all contours removed`);
      }

      setLocalRTStructures(updatedStructures);
      saveContourUpdates(updatedStructures, 'subtract_contours');
    } else if (payload.action === "grow_contour") {
      // Handle contour growing
      handleGrowContour(payload);
    } else if (payload.action === "apply_grow_contour") {
      // Handle applying previewed grow/shrink operation (single slice - legacy)
      console.log("🔹 Applying grow/shrink operation:", payload);
      handleGrowContour(payload);
      // Clear preview after applying
      setPreviewContours([]);
    } else if (payload.action === "apply_grow_structure") {
      // Handle applying grow/shrink to entire structure
      console.log("🔹 Applying grow/shrink to ENTIRE STRUCTURE:", payload);
      handleGrowStructure(payload);
      // Clear preview after applying
      setPreviewContours([]);
    } else if (payload.action === "apply_margin") {
      // Handle margin operation (Eclipse TPS style)
      handleMarginOperation(payload);
    } else if (payload.action === "boolean_operation") {
      // Handle boolean operations (combine/subtract)
      await handleBooleanOperation(payload);
    } else if (payload.action === "delete_slice") {
      // Handle delete slice action - only delete the contour for the selected structure
      const structure = updatedStructures.structures.find(
        (s: any) => s.roiNumber === payload.structureId,
      );
      if (!structure) {
        console.warn(`Structure ${payload.structureId} not found for delete operation`);
        return;
      }

      // Log current state before deletion
      console.log(`Before delete: Structure ${payload.structureId} has ${structure.contours.length} contours`);
      
      // Remove contour at specified slice position for this structure only - tight tolerance
      const originalLength = structure.contours.length;
      structure.contours = structure.contours.filter(
        (c: any) => Math.abs(c.slicePosition - payload.slicePosition) > SLICE_TOL_MM
      );

      const deletedCount = originalLength - structure.contours.length;
      console.log(`Deleted ${deletedCount} contour(s) for structure ${payload.structureId} (${structure.structureName}) at slice ${payload.slicePosition}`);
      console.log(`After delete: Structure ${payload.structureId} has ${structure.contours.length} contours`);
      
      // Log all structures to verify others are not affected
      console.log("All structures after delete:", updatedStructures.structures.map((s: any) => ({
        id: s.roiNumber,
        name: s.structureName,
        contourCount: s.contours.length
      })));
      
      setLocalRTStructures(updatedStructures);
      // Pass the full updated structures to parent
      if (onContourUpdate) {
        onContourUpdate(updatedStructures);
      }
      saveContourUpdates(updatedStructures, 'delete_slice');
    } else if (payload.action === "clear_all") {
      // Handle clear all slices action
      const structure = updatedStructures.structures.find(
        (s: any) => s.roiNumber === payload.structureId,
      );
      if (!structure) return;

      // Clear all contours for this structure
      structure.contours = [];

      console.log(`Cleared all contours for structure ${payload.structureId}`);
      
      setLocalRTStructures(updatedStructures);
      saveContourUpdates(updatedStructures, 'clear_all');
    } else if (payload.action === "interpolate") {
      // Handle interpolate missing slices (SDT multi-loop with CT-grid targeting)
      const structure = updatedStructures.structures.find((s: any) => s.roiNumber === payload.structureId);
      if (!structure || !structure.contours || structure.contours.length < 2) {
        console.log("Not enough contours to interpolate");
        return;
      }

      // Group contours by slice position
      const byZ = new Map<number, any[]>();
      for (const c of structure.contours) {
        const arr = byZ.get(c.slicePosition) || [];
        arr.push(c);
        byZ.set(c.slicePosition, arr);
      }
      const zKeys = Array.from(byZ.keys()).sort((a, b) => a - b);

      // Build CT Z array (mm) for real slice targeting
      const zArrayRaw: number[] = images.map((img: any) => {
        let z = img.parsedSliceLocation ?? img.parsedZPosition;
        if (z == null) {
          const m = img.imageMetadata || img;
          if (m?.sliceLocation != null) z = parseFloat(m.sliceLocation);
          else if (m?.imagePosition) {
            const pos = typeof m.imagePosition === 'string' ? m.imagePosition.split('\\').map(Number) : m.imagePosition;
            if (Array.isArray(pos) && pos.length >= 3) z = Number(pos[2]);
          }
        }
        return Number(z);
      }).filter((z: any) => Number.isFinite(z));
      const zArray = [...zArrayRaw].sort((a, b) => a - b);
      const tol = SLICE_TOL_MM;

      const newContours: any[] = [];
      for (let i = 0; i < zKeys.length - 1; i++) {
        const zA = zKeys[i];
        const zB = zKeys[i + 1];
        const listA = byZ.get(zA)!;
        const listB = byZ.get(zB)!;
        // Keep originals
        newContours.push(...listA);
        const zMin = Math.min(zA, zB) + tol;
        const zMax = Math.max(zA, zB) - tol;
        for (const z of zArray) {
          if (z > zMin && z < zMax) {
            let pts: number[] = [];
            try {
              const { interpolateBetweenContoursSDTMulti } = await import('@/lib/sdt-interpolation');
              pts = interpolateBetweenContoursSDTMulti(
                listA, zA, listB, zB, z,
                { gridSpacingMm: 0.25, paddingMm: 3, adaptiveMinCells: 180, pivotPiecewise: true, pivotMode: 'euclidean', closingMm: 0.3 }
              );
            } catch {}
            if (!pts || pts.length < 9) {
              // fallback to polar using largest contour of each slice
              const a0 = listA[0], b0 = listB[0];
              const { interpolateBetweenContoursPolar } = await import('@/lib/contour-interpolation');
              pts = interpolateBetweenContoursPolar(a0.points, zA, b0.points, zB, z, 512, true, false);
            }
            if (pts && pts.length >= 9) newContours.push({ slicePosition: z, points: pts, numberOfPoints: pts.length / 3 });
          }
        }
      }
      // push last originals
      const lastZ = zKeys[zKeys.length - 1];
      newContours.push(...(byZ.get(lastZ) || []));
      structure.contours = newContours;
      console.log(`Interpolated ${newContours.length - structure.contours.length} new slices for structure ${payload.structureId}`);
      setLocalRTStructures(updatedStructures);
      saveContourUpdates(updatedStructures, 'interpolate');
      try { scheduleRender(); } catch {}
    } else if (payload.action === "delete_nth_slice") {
      // Handle delete every nth slice
      const structure = updatedStructures.structures.find(
        (s: any) => s.roiNumber === payload.structureId,
      );
      if (!structure) return;

      // Sort contours by slice position
      const sortedContours = [...structure.contours].sort((a: any, b: any) => a.slicePosition - b.slicePosition);
      
      // Keep only contours that are not at nth positions
      const filteredContours = sortedContours.filter((_, index) => {
        // Keep the first contour (index 0), delete every nth after that
        return index === 0 || (index % payload.nth) !== 0;
      });
      
      structure.contours = filteredContours;
      const deletedCount = sortedContours.length - filteredContours.length;
      console.log(`Deleted ${deletedCount} contours (every ${payload.nth} slice) for structure ${payload.structureId}`);
      
      setLocalRTStructures(updatedStructures);
      saveContourUpdates(updatedStructures, 'delete_nth_slice');
    } else if (payload.action === "clear_below") {
      // Handle clear below current slice
      const structure = updatedStructures.structures.find(
        (s: any) => s.roiNumber === payload.structureId,
      );
      if (!structure) return;

      const originalCount = structure.contours.length;
      structure.contours = structure.contours.filter(
        (c: any) => c.slicePosition >= payload.slicePosition
      );
      
      const deletedCount = originalCount - structure.contours.length;
      console.log(`Cleared ${deletedCount} contours below slice ${payload.slicePosition} for structure ${payload.structureId}`);
      
      setLocalRTStructures(updatedStructures);
      saveContourUpdates(updatedStructures, 'clear_below');
    } else if (payload.action === "clear_above") {
      // Handle clear above current slice
      const structure = updatedStructures.structures.find(
        (s: any) => s.roiNumber === payload.structureId,
      );
      if (!structure) return;

      const originalCount = structure.contours.length;
      structure.contours = structure.contours.filter(
        (c: any) => c.slicePosition <= payload.slicePosition
      );
      
      const deletedCount = originalCount - structure.contours.length;
      console.log(`Cleared ${deletedCount} contours above slice ${payload.slicePosition} for structure ${payload.structureId}`);
      
      setLocalRTStructures(updatedStructures);
      saveContourUpdates(updatedStructures, 'clear_above');
    } else if (payload.action === "smooth") {
      // Handle contour smoothing
      const structure = updatedStructures.structures.find(
        (s: any) => s.roiNumber === payload.structureId,
      );
      if (!structure) {
        console.error(`Structure ${payload.structureId} not found`);
        return;
      }

      // Apply smoothing to all contours in the structure
      const { smoothContour } = await import('@/lib/contour-smooth-simple');
      const smoothingFactor = payload.smoothingFactor || 0.15;
      
      structure.contours = structure.contours.map((contour: any) => {
        if (contour.points && contour.points.length >= 9) {
          const smoothedContour = smoothContour(
            {
              points: contour.points,
              slicePosition: contour.slicePosition
            },
            smoothingFactor
          );
          
          return {
            ...contour,
            points: smoothedContour.points,
            numberOfPoints: smoothedContour.points.length / 3
          };
        }
        return contour;
      });

      console.log(`Applied smoothing to structure ${payload.structureId} with factor ${smoothingFactor}`);
      
      setLocalRTStructures(updatedStructures);
      
      // Pass the updated structures up to parent component
      if (onContourUpdate) {
        onContourUpdate(updatedStructures);
      }

      // Save state to undo system
      if (seriesId) {
        undoRedoManager.saveState(seriesId, 'smooth', payload.structureId, updatedStructures);
      }
      saveContourUpdates(updatedStructures, 'smooth');
    }
  };

  // Expose methods to parent component
  useImperativeHandle(ref, () => ({
    handleContourUpdate,
    setPanMode: () => {
      setIsPanMode(true);
      setCrosshairMode(false);
      console.log('Pan mode activated');
    },
    setCrosshairMode: () => {
      setIsPanMode(false);
      setCrosshairMode(true);
      console.log('Crosshair mode activated');
    },
    navigateToSlice: (targetZ: number) => {
      if (!images || images.length === 0) {
        console.warn('🎯 Cannot navigate: no images available');
        return;
      }

      console.log(`🎯 Navigating to Z position: ${targetZ.toFixed(1)}`);

      // Find the closest slice to the target Z position
      let closestIndex = 0;
      let closestDistance = Infinity;

      images.forEach((image, index) => {
        // Get Z position from image metadata
        let imageZ = index; // fallback to index (synthetic)
        
        if (image.imageMetadata?.imagePosition || image.imagePosition) {
          const pos = Array.isArray(image.imagePosition)
            ? image.imagePosition
            : (typeof image.imagePosition === 'string' ? image.imagePosition.split("\\").map(Number) : (Array.isArray(image.imageMetadata?.imagePosition) ? image.imageMetadata.imagePosition : String(image.imageMetadata?.imagePosition||'').split("\\").map(Number)));
          if (pos && pos.length >= 3 && isFinite(pos[2])) imageZ = pos[2];
        } else if (image.parsedSliceLocation !== undefined && image.parsedSliceLocation !== null) {
          imageZ = image.parsedSliceLocation;
        } else if (image.parsedZPosition !== undefined && image.parsedZPosition !== null) {
          imageZ = image.parsedZPosition;
        } else if (image.imageMetadata?.sliceLocation !== undefined) {
          const parsed = parseFloat(image.imageMetadata.sliceLocation);
          if (!isNaN(parsed)) {
            imageZ = parsed;
          }
        } else if (image.imageMetadata?.imagePosition) {
          const imagePos = typeof image.imageMetadata.imagePosition === 'string'
            ? image.imageMetadata.imagePosition.split("\\")
            : image.imageMetadata.imagePosition;
          if (imagePos && imagePos.length >= 3) {
            const parsed = parseFloat(imagePos[2]);
            if (!isNaN(parsed)) {
              imageZ = parsed;
            }
          }
        }

        const distance = Math.abs(imageZ - targetZ);
        if (distance < closestDistance) {
          closestDistance = distance;
          closestIndex = index;
        }
      });

      console.log(`🎯 Found closest slice: index ${closestIndex}, distance ${closestDistance.toFixed(1)}mm`);
      
      // Navigate to the closest slice
      setCurrentIndex(closestIndex);
    },
  }), [rtStructures, images, setCurrentIndex]);

  // Handle auto-zoom when autoZoomLevel prop changes - DISABLED FOR DEBUGGING
  /*
  useEffect(() => {
    if (autoZoomLevel && autoZoomLevel !== zoom) {
      setZoom(autoZoomLevel);
      if (images.length > 0) {
        scheduleRender();
      }
    }
  }, [autoZoomLevel, zoom, images.length]);
  */

  // Handle auto-localize when autoLocalizeTarget prop changes
  useEffect(() => {
    if (autoLocalizeTarget) {
      const { x, y, z } = autoLocalizeTarget;
      // Convert world coordinates to pan offsets
      // Scale the coordinates appropriately for the canvas
      const scaleFactor = 0.1; // Adjust this value as needed
      setPanX(-x * scaleFactor);
      setPanY(-y * scaleFactor);
      setLastPanX(-x * scaleFactor);
      setLastPanY(-y * scaleFactor);
      if (images.length > 0) {
        scheduleRender();
      }
    }
  }, [autoLocalizeTarget, images.length]);

  useEffect(() => {
    loadImages();
  }, [seriesId]);

  // Load registration matrix for fusion - check multiple studies
  useEffect(() => {
    const loadRegistration = async () => {
      if (!studyId) return;
      
      console.log(`🔍 Looking for registration matrix starting with study ${studyId}`);
      console.log('🔍 FUSION DEBUG: Starting registration search');
      console.log('🔍 FUSION DEBUG: Current study ID:', studyId);
      
      // Try the current study first
      let registrationData = null;
      
      try {
        console.log(`🔍 FUSION DEBUG: Fetching /api/registrations/${studyId}`);
        const res = await fetch(`/api/registrations/${studyId}`);
        const data = await res.json();
        console.log(`🔍 FUSION DEBUG: Registration response from study ${studyId}:`, data);
        
        // Handle both direct registration data and wrapped format
        if (data && data.transformationMatrix) {
          console.log(`✅ Found registration in current study ${studyId} (direct format)`);
          registrationData = data;
        } else if (data && data.registration && data.registration.transformationMatrix) {
          console.log(`✅ Found registration in current study ${studyId} (wrapped format)`);
          registrationData = data.registration;
        } else {
          console.log(`❌ No registration in study ${studyId}, checking related studies...`);
          console.log('🔍 FUSION DEBUG: No registration in current study, starting cross-study search');
          
          // If no registration in current study, check all studies for this patient
          // This handles the case where MRI is in study 18 but registration is in study 17
          // First get the patient ID for this study
          console.log(`🔍 FUSION DEBUG: Fetching study info from /api/studies/${studyId}`);
          const studyRes = await fetch(`/api/studies/${studyId}`);
          const studyData = await studyRes.json();
          console.log('🔍 FUSION DEBUG: Study data:', studyData);
          const patientId = studyData?.patientId;
          
          if (!patientId) {
            console.log('❌ FUSION DEBUG: Could not determine patient ID from study data');
            return;
          }
          
          console.log(`🔍 FUSION DEBUG: Patient ID is ${patientId}, fetching patient data...`);
          // Get all studies for this patient
          const patientsRes = await fetch(`/api/patients/${patientId}`);
          const patientData = await patientsRes.json();
          console.log('🔍 FUSION DEBUG: Patient data response:', patientData);
          const studiesData = patientData?.studies || [];
          
          console.log(`🔍 FUSION DEBUG: Found ${studiesData.length} studies for patient ${patientId}:`, studiesData.map((s: any) => s.id));
          
          for (const study of studiesData || []) {
            if (study.id !== studyId) {
              console.log(`🔍 FUSION DEBUG: Checking study ${study.id} for registration...`);
              const otherRes = await fetch(`/api/registrations/${study.id}`);
              const otherData = await otherRes.json();
              console.log(`🔍 FUSION DEBUG: Registration response from study ${study.id}:`, otherData);
              
              // Handle both direct registration data and wrapped format
              if (otherData && otherData.transformationMatrix) {
                console.log(`✅ Found registration in related study ${study.id} (direct format)`);
                registrationData = otherData;
                break;
              } else if (otherData && otherData.registration && otherData.registration.transformationMatrix) {
                console.log(`✅ Found registration in related study ${study.id} (wrapped format)`);
                registrationData = otherData.registration;
                break;
              }
            }
          }
        }
        
        if (registrationData && registrationData.transformationMatrix) {
          console.log(`📊 Registration data:`, registrationData);
          
          // Parse the transformation matrix if it's a string
          let matrix = registrationData.transformationMatrix;
          if (typeof matrix === 'string') {
            try {
              const parsed = JSON.parse(matrix);
              if (Array.isArray(parsed) && parsed.length === 4) {
                matrix = parsed.flat();
              } else if (parsed['0'] && parsed['1'] && parsed['2'] && parsed['3']) {
                matrix = [...parsed['0'], ...parsed['1'], ...parsed['2'], ...parsed['3']];
              }
              console.log('✅ Parsed registration matrix:', matrix);
            } catch (e) {
              console.error('Failed to parse registration matrix:', e);
              matrix = null;
            }
          }
          setRegistrationMatrix(matrix);
          registrationMatrixRef.current = matrix;
        } else {
          console.log(`❌ No registration found in any study`);
          setRegistrationMatrix(null);
          registrationMatrixRef.current = null;
        }
      } catch (error) {
        console.error('❌ Error loading registration:', error);
        setRegistrationMatrix(null);
        registrationMatrixRef.current = null;
      }
    };
    
    loadRegistration();
  }, [studyId]);
  
  // Re-render fusion overlay when registration matrix is loaded
  useEffect(() => {
    console.log('🔥 FUSION DEBUG: Registration matrix useEffect triggered');
    console.log('🔥 FUSION DEBUG: Registration matrix:', registrationMatrix);
    console.log('🔥 FUSION DEBUG: State check:', {
      hasMatrix: !!registrationMatrix,
      matrixLength: registrationMatrix?.length,
      secondarySeriesId,
      secondarySeriesType: typeof secondarySeriesId,
      imagesLength: images.length,
      secondaryImagesLength: secondaryImages.length,
      fusionOpacity
    });
    
    if (registrationMatrix && registrationMatrix.length === 16 && secondarySeriesId && Number(secondarySeriesId) && images.length > 0) {
      console.log('Registration matrix loaded, re-rendering fusion overlay');
      
      // Pre-compute MRI transformations if we have secondary images loaded
      if (secondaryImages.length > 0) {
        // Helper: compute CT z-range in mm using CT orientation
        const toNum = (v: any): number[] => Array.isArray(v) ? v.map(Number) : (typeof v === 'string' ? v.split('\\').map(Number) : []);
        const iop = toNum(images[0]?.imageOrientation || images[0]?.imageMetadata?.imageOrientation);
        const origin = toNum(images[0]?.imagePosition || images[0]?.imageMetadata?.imagePosition);
        let ctZMin = -Infinity, ctZMax = Infinity;
        if (iop.length >= 6 && origin.length >= 3) {
          const r = [iop[0], iop[1], iop[2]];
          const c = [iop[3], iop[4], iop[5]];
          const n = [
            r[1] * c[2] - r[2] * c[1],
            r[2] * c[0] - r[0] * c[2],
            r[0] * c[1] - r[1] * c[0]
          ];
          const nlen = Math.hypot(n[0], n[1], n[2]) || 1;
          const nn = [n[0]/nlen, n[1]/nlen, n[2]/nlen];
          const zVals: number[] = [];
          for (const img of images) {
            const p = toNum(img.imagePosition || img.imageMetadata?.imagePosition);
            if (p.length >= 3) {
              const dx = p[0] - origin[0], dy = p[1] - origin[1], dz = p[2] - origin[2];
              zVals.push(dx*nn[0] + dy*nn[1] + dz*nn[2]);
            }
          }
          if (zVals.length) { ctZMin = Math.min(...zVals); ctZMax = Math.max(...zVals); }
        }

        const overlap = (aMin: number, aMax: number, bMin: number, bMax: number, tol = 5) => !(aMax < bMin - tol || bMax < aMin - tol);

        // Compute with provided matrix
        // Always reference CT series origin/orientation from the first CT slice
        // to keep CT Z-axis consistent across precomputation and per-slice matching
        const ctSeriesIOP = images[0]?.imageOrientation || images[0]?.imageMetadata?.imageOrientation;
        const ctSeriesIPP = images[0]?.imagePosition || images[0]?.imageMetadata?.imagePosition;
        let transformed = computeTransformedMRIPositions(
          secondaryImages,
          registrationMatrix,
          ctSeriesIOP,
          ctSeriesIPP,
          secondaryImageCacheRef.current
        );

        // Validate Z-overlap; if present, align any constant Z bias using median offset
        if (isFinite(ctZMin) && isFinite(ctZMax) && transformed.length > 0) {
          const zMin = Math.min(...transformed.map(t => t.zInCT));
          const zMax = Math.max(...transformed.map(t => t.zInCT));
          console.log(`🔎 Z-range check (on reg load): CT=[${ctZMin.toFixed(1)}, ${ctZMax.toFixed(1)}], MRI→CT=[${zMin.toFixed(1)}, ${zMax.toFixed(1)}]`);
          if (!overlap(ctZMin, ctZMax, zMin, zMax, 5)) {
            console.error('❌ Registration matrix yields no Z-overlap. Aborting fusion until a valid REG is provided.');
            transformed = [];
          } else {
            // Compute median Z offset between MRI planes and nearest CT planes and correct it
            const ctZs: number[] = [];
            const toNum2 = (v: any): number[] => Array.isArray(v) ? v.map(Number) : (typeof v === 'string' ? v.split('\\').map(Number) : []);
            const iop2 = toNum2(images[0]?.imageOrientation || images[0]?.imageMetadata?.imageOrientation);
            const origin2 = toNum2(images[0]?.imagePosition || images[0]?.imageMetadata?.imagePosition);
            if (iop2.length >= 6 && origin2.length >= 3) {
              const r2 = [iop2[0], iop2[1], iop2[2]]; const c2 = [iop2[3], iop2[4], iop2[5]];
              const n2 = [r2[1]*c2[2]-r2[2]*c2[1], r2[2]*c2[0]-r2[0]*c2[2], r2[0]*c2[1]-r2[1]*c2[0]];
              const n2l = Math.hypot(n2[0], n2[1], n2[2]) || 1; const nn2 = [n2[0]/n2l, n2[1]/n2l, n2[2]/n2l];
              for (const img of images) {
                const p = toNum2(img.imagePosition || img.imageMetadata?.imagePosition);
                if (p.length >= 3) { const dx=p[0]-origin2[0], dy=p[1]-origin2[1], dz=p[2]-origin2[2]; ctZs.push(dx*nn2[0]+dy*nn2[1]+dz*nn2[2]); }
              }
              ctZs.sort((a,b)=>a-b);
            }
            if (ctZs.length > 1) {
              const nearest = (val: number) => {
                let lo=0, hi=ctZs.length-1, best=ctZs[0];
                while (lo<=hi){const mid=(lo+hi>>1); const v=ctZs[mid]; if (Math.abs(v-val)<Math.abs(best-val)) best=v; if (v<val) lo=mid+1; else hi=mid-1;}
                return best;
              };
              const diffs = transformed.map(t => t.zInCT - nearest(t.zInCT)).filter(d => isFinite(d));
              if (diffs.length) {
                const s = diffs.slice().sort((a,b)=>a-b); const median = s[Math.floor(s.length/2)];
                if (Math.abs(median) > 0.25) {
                  console.log(`⚙️ Applying median Z-offset correction (reg-load path): ${median.toFixed(2)}mm`);
                  transformed = transformed.map(t => ({...t, zInCT: t.zInCT - median}));
                }
              }
            }
          }
        }

        transformedMRIPositions.current = transformed;
        
        // Calculate and store Z-range
        if (transformed.length > 0) {
          const zValues = transformed.map(item => item.zInCT);
          mriZRangeInCTSpace.current = {
            min: Math.min(...zValues),
            max: Math.max(...zValues)
          };
        }
        
        // Clear cache to force recomputation with new data
        mriSliceMappingCache.current.clear();
      }
      
      scheduleRender();
    }
  }, [registrationMatrix, secondarySeriesId, images.length]);
  
  // Trigger pre-computation when both registration matrix and secondary images are available
  useEffect(() => {
    if (registrationMatrix && registrationMatrix.length === 16 && secondaryImages.length > 0) {
      console.log('Both registration matrix and secondary images available, pre-computing transformations...');
      // Helper: compute CT z-range in mm using CT orientation
      const toNum = (v: any): number[] => Array.isArray(v) ? v.map(Number) : (typeof v === 'string' ? v.split('\\').map(Number) : []);
      const iop = toNum(images[0]?.imageOrientation || images[0]?.imageMetadata?.imageOrientation);
      const origin = toNum(images[0]?.imagePosition || images[0]?.imageMetadata?.imagePosition);
      let ctZMin = -Infinity, ctZMax = Infinity;
      if (iop.length >= 6 && origin.length >= 3) {
        const r = [iop[0], iop[1], iop[2]];
        const c = [iop[3], iop[4], iop[5]];
        const n = [
          r[1] * c[2] - r[2] * c[1],
          r[2] * c[0] - r[0] * c[2],
          r[0] * c[1] - r[1] * c[0]
        ];
        const nlen = Math.hypot(n[0], n[1], n[2]) || 1;
        const nn = [n[0]/nlen, n[1]/nlen, n[2]/nlen];
        const zVals: number[] = [];
        for (const img of images) {
          const p = toNum(img.imagePosition || img.imageMetadata?.imagePosition);
          if (p.length >= 3) {
            const dx = p[0] - origin[0], dy = p[1] - origin[1], dz = p[2] - origin[2];
            zVals.push(dx*nn[0] + dy*nn[1] + dz*nn[2]);
          }
        }
        if (zVals.length) { ctZMin = Math.min(...zVals); ctZMax = Math.max(...zVals); }
      }

      const overlap = (aMin: number, aMax: number, bMin: number, bMax: number, tol = 5) => !(aMax < bMin - tol || bMax < aMin - tol);

      // Use CT series' first slice for a stable CT origin/orientation
      const ctSeriesIOP2 = images[0]?.imageOrientation || images[0]?.imageMetadata?.imageOrientation;
      const ctSeriesIPP2 = images[0]?.imagePosition || images[0]?.imageMetadata?.imagePosition;
      let transformed = computeTransformedMRIPositions(
        secondaryImages,
        registrationMatrix,
        ctSeriesIOP2,
        ctSeriesIPP2,
        secondaryImageCacheRef.current
      );

      if (isFinite(ctZMin) && isFinite(ctZMax) && transformed.length > 0) {
        const zMin = Math.min(...transformed.map(t => t.zInCT));
        const zMax = Math.max(...transformed.map(t => t.zInCT));
        console.log(`🔎 Z-range check (precompute): CT=[${ctZMin.toFixed(1)}, ${ctZMax.toFixed(1)}], MRI→CT=[${zMin.toFixed(1)}, ${zMax.toFixed(1)}]`);
        if (!overlap(ctZMin, ctZMax, zMin, zMax, 5)) {
          console.warn(`No MRI→CT Z overlap detected (MRI ${zMin.toFixed(1)}–${zMax.toFixed(1)} vs CT ${ctZMin.toFixed(1)}–${ctZMax.toFixed(1)}). Trying inverted matrix.`);
          const inv = invertMatrix4x4(registrationMatrix);
          if (inv) {
            const transformedInv = computeTransformedMRIPositions(
              secondaryImages,
              inv,
              ctSeriesIOP2,
              ctSeriesIPP2,
              secondaryImageCacheRef.current
            );
            if (transformedInv.length > 0) {
              const ziMin = Math.min(...transformedInv.map(t => t.zInCT));
              const ziMax = Math.max(...transformedInv.map(t => t.zInCT));
              console.log(`🔎 Z-range (inverted): CT=[${ctZMin.toFixed(1)}, ${ctZMax.toFixed(1)}], MRI→CT=[${ziMin.toFixed(1)}, ${ziMax.toFixed(1)}]`);
              if (overlap(ctZMin, ctZMax, ziMin, ziMax, 5)) {
                console.log('✅ Inverted matrix provides valid Z overlap. Using inverted registration.');
                transformed = transformedInv;
                setRegistrationMatrix(inv);
                registrationMatrixRef.current = inv;
              } else {
                console.warn('Inverted matrix also fails Z overlap. Keeping original matrix.');
              }
            }
          }
        } else {
          console.log('✅ MRI→CT Z overlap OK — keeping provided matrix');
          // Apply median Z offset correction to remove constant bias
          const ctZs: number[] = [];
          const toNum2 = (v: any): number[] => Array.isArray(v) ? v.map(Number) : (typeof v === 'string' ? v.split('\\').map(Number) : []);
          const iop2 = toNum2(images[0]?.imageOrientation || images[0]?.imageMetadata?.imageOrientation);
          const origin2 = toNum2(images[0]?.imagePosition || images[0]?.imageMetadata?.imagePosition);
          if (iop2.length >= 6 && origin2.length >= 3) {
            const r2 = [iop2[0], iop2[1], iop2[2]]; const c2 = [iop2[3], iop2[4], iop2[5]];
            const n2 = [r2[1]*c2[2]-r2[2]*c2[1], r2[2]*c2[0]-r2[0]*c2[2], r2[0]*c2[1]-r2[1]*c2[0]];
            const n2l = Math.hypot(n2[0], n2[1], n2[2]) || 1; const nn2 = [n2[0]/n2l, n2[1]/n2l, n2[2]/n2l];
            for (const img of images) {
              const p = toNum2(img.imagePosition || img.imageMetadata?.imagePosition);
              if (p.length >= 3) { const dx=p[0]-origin2[0], dy=p[1]-origin2[1], dz=p[2]-origin2[2]; ctZs.push(dx*nn2[0]+dy*nn2[1]+dz*nn2[2]); }
            }
            ctZs.sort((a,b)=>a-b);
          }
          if (ctZs.length > 1) {
            const nearest = (val: number) => {
              let lo=0, hi=ctZs.length-1, best=ctZs[0];
              while (lo<=hi){const mid=(lo+hi>>1); const v=ctZs[mid]; if (Math.abs(v-val)<Math.abs(best-val)) best=v; if (v<val) lo=mid+1; else hi=mid-1;}
              return best;
            };
            const diffs = transformed.map(t => t.zInCT - nearest(t.zInCT)).filter(d => isFinite(d));
            if (diffs.length) {
              const s = diffs.slice().sort((a,b)=>a-b); const median = s[Math.floor(s.length/2)];
              if (Math.abs(median) > 0.25) {
                console.log(`⚙️ Applying median Z-offset correction (precompute path): ${median.toFixed(2)}mm`);
                transformed = transformed.map(t => ({...t, zInCT: t.zInCT - median}));
              }
            }
          }
        }
      }
      transformedMRIPositions.current = transformed;
      
      // Calculate and store Z-range
      if (transformed.length > 0) {
        const zValues = transformed.map(item => item.zInCT);
        mriZRangeInCTSpace.current = {
          min: Math.min(...zValues),
          max: Math.max(...zValues)
        };
        console.log(`MRI Z-range after transformation: ${mriZRangeInCTSpace.current.min.toFixed(1)}mm to ${mriZRangeInCTSpace.current.max.toFixed(1)}mm`);
      }
      
      // Clear cache to force recomputation with new data
      mriSliceMappingCache.current.clear();
    }
  }, [registrationMatrix, secondaryImages]);
  
  // Re-render current image when secondary images are loaded
  useEffect(() => {
    if (secondaryImages.length > 0 && images.length > 0) {
      console.log('Secondary images loaded, triggering re-render for fusion');
      displayCurrentImage();
    }
  }, [secondaryImages]);

  // Load secondary series images for fusion
  useEffect(() => {
    console.log('🎯 secondarySeriesId changed to:', secondarySeriesId, 'Type:', typeof secondarySeriesId);
    
    const loadSecondaryImages = async () => {
      // Check if secondarySeriesId is valid (not null)
      if (!secondarySeriesId) {
        console.log('❌ No secondary series ID, clearing secondary images');
        setSecondaryImages([]);
        secondaryImageCacheRef.current = new Map();
        mriSliceMappingCache.current.clear(); // Clear MRI mapping cache
        setSecondaryModality('MR'); // Reset to default
        return;
      }

      console.log('✅ Loading secondary series images for series:', secondarySeriesId);
      try {
        // First fetch series info to get modality
        const seriesResponse = await fetch(`/api/series/${secondarySeriesId}`);
        if (seriesResponse.ok) {
          const seriesData = await seriesResponse.json();
          setSecondaryModality(seriesData.modality || 'MR');
          console.log(`Secondary series modality: ${seriesData.modality}`);
        }
        
        const response = await fetch(`/api/series/${secondarySeriesId}/images`);
        if (!response.ok) {
          throw new Error(`Failed to load secondary images: ${response.statusText}`);
        }

        const imageList = await response.json();
        
        // Robust ordering using ImagePositionPatient projected along MRI series normal
        const toNum = (v: any): number[] => Array.isArray(v) ? v.map(Number) : (typeof v === 'string' ? v.split('\\').map(Number) : []);
        // Derive a base origin and normal from the first image that has orientation + position
        let baseOrigin: number[] | null = null;
        let normal: number[] | null = null;
        for (const img of imageList) {
          const iop = toNum(img.imageOrientation || img.imageMetadata?.imageOrientation);
          const ipp = toNum(img.imagePosition || img.imageMetadata?.imagePosition);
          if (iop.length >= 6 && ipp.length >= 3) {
            const r = [iop[0], iop[1], iop[2]];
            const c = [iop[3], iop[4], iop[5]];
            const n = [r[1]*c[2]-r[2]*c[1], r[2]*c[0]-r[0]*c[2], r[0]*c[1]-r[1]*c[0]];
            const nlen = Math.hypot(n[0], n[1], n[2]) || 1;
            normal = [n[0]/nlen, n[1]/nlen, n[2]/nlen];
            baseOrigin = ipp;
            break;
          }
        }

        // Filter to images that have a valid ImagePositionPatient; skip others
        const withPositions = imageList
          .map((img: any) => {
            const ipp = toNum(img.imagePosition || img.imageMetadata?.imagePosition);
            return { img, ipp };
          })
          .filter(({ ipp }: any) => ipp.length >= 3 && ipp.every((v: number) => isFinite(v)));

        let sortedImages: any[];
        if (withPositions.length > 0 && normal && baseOrigin) {
          // Project each image position onto the series normal and sort by that scalar
          sortedImages = withPositions
            .map(({ img, ipp }: any) => {
              const dx = ipp[0] - baseOrigin![0];
              const dy = ipp[1] - baseOrigin![1];
              const dz = ipp[2] - baseOrigin![2];
              const proj = dx*normal![0] + dy*normal![1] + dz*normal![2];
              return { img, proj };
            })
            .sort((a: any, b: any) => a.proj - b.proj)
            .map((o: any) => o.img);
        } else {
          console.warn("Falling back to instanceNumber ordering for MRI (positions/orientation not available yet)");
          sortedImages = [...imageList].sort((a: any, b: any) => (a.instanceNumber || 0) - (b.instanceNumber || 0));
        }

        setSecondaryImages(sortedImages);
        mriSliceMappingCache.current.clear(); // Clear MRI mapping cache when new images loaded
        console.log(`Loaded ${sortedImages.length} secondary images for fusion`);
        console.log("Secondary series ID:", secondarySeriesId);
        console.log("Images available:", sortedImages.length > 0 ? "YES" : "NO");
        
        // Debug log the sorted order
        console.log('MRI sorted order (first 5 and last 5):');
        const debugImages = [...sortedImages.slice(0, 5), ...sortedImages.slice(-5)];
        debugImages.forEach((img: any, idx: number) => {
          console.log(`  [${idx < 5 ? idx : sortedImages.length - 5 + (idx - 5)}] Instance ${img.instanceNumber}, SliceLoc: ${img.sliceLocation}`);
        });
        
        // Preload secondary images with concurrency limits
        const newCache = new Map();
        const CONCURRENT_LIMIT = 4;
        
        // Process secondary images in chunks
        for (let i = 0; i < sortedImages.length; i += CONCURRENT_LIMIT) {
          const chunk = sortedImages.slice(i, i + CONCURRENT_LIMIT);
          
          await Promise.all(chunk.map(async (image: any, chunkIndex: number) => {
            const index = i + chunkIndex;
            try {
              // Create a dedicated fetch for secondary images
              const response = await fetch(`/api/images/${image.sopInstanceUID}`);
              if (!response.ok) {
                console.error(`Failed to fetch secondary image ${index}:`, response.status);
                return;
              }
              
              const arrayBuffer = await response.arrayBuffer();
              const imageData = await parseDicomImage(arrayBuffer);
              
              if (imageData) {
                // Attach essential spatial metadata from DB for fusion geometry
                const meta = {
                  imagePosition: image.imagePosition || image.imageMetadata?.imagePosition || null,
                  imageOrientation: image.imageOrientation || image.imageMetadata?.imageOrientation || null,
                  pixelSpacing: image.pixelSpacing || image.imageMetadata?.pixelSpacing || null,
                };
                newCache.set(image.sopInstanceUID, { ...imageData, metadata: meta });
                if (index < 3) {
                  console.log(`Cached secondary image ${index}: ${image.sopInstanceUID}`);
                }
              } else {
                console.error(`Failed to parse secondary image ${index}`);
              }
            } catch (error) {
              console.warn(`Failed to preload secondary image ${index}:`, error);
            }
          }));
        }
        
        secondaryImageCacheRef.current = newCache;
        console.log(`Preloaded ${newCache.size} secondary images`);
        console.log("First few cache keys:", Array.from(newCache.keys()).slice(0, 3));
        
        // Store cache reference to avoid closure issues
        (window as any).secondaryImageCacheRef = newCache;
        
        // Trigger re-render of current image to show fusion
        // Note: The current image will be re-rendered automatically when secondary images state changes
        console.log('Secondary images loaded, fusion should now be available');
        
        // Pre-compute MRI positions in CT space if registration matrix is available
        if (registrationMatrix && registrationMatrix.length === 16) {
          // Clear cache to force fresh computation with debug logs
          transformedMRIPositions.current = [];
          mriZRangeInCTSpace.current = null;
          mriSliceMappingCache.current.clear();
          console.log("=== FORCING FRESH MRI TRANSFORMATION COMPUTATION ===");

          // Compute CT z-range
          const toNum = (v: any): number[] => Array.isArray(v) ? v.map(Number) : (typeof v === 'string' ? v.split('\\').map(Number) : []);
          const iop = toNum(images[0]?.imageOrientation || images[0]?.imageMetadata?.imageOrientation);
          const origin = toNum(images[0]?.imagePosition || images[0]?.imageMetadata?.imagePosition);
          let ctZMin = -Infinity, ctZMax = Infinity;
          if (iop.length >= 6 && origin.length >= 3) {
            const r = [iop[0], iop[1], iop[2]];
            const c = [iop[3], iop[4], iop[5]];
            const n = [
              r[1] * c[2] - r[2] * c[1],
              r[2] * c[0] - r[0] * c[2],
              r[0] * c[1] - r[1] * c[0]
            ];
            const nlen = Math.hypot(n[0], n[1], n[2]) || 1;
            const nn = [n[0]/nlen, n[1]/nlen, n[2]/nlen];
            const zVals: number[] = [];
            for (const img of images) {
              const p = toNum(img.imagePosition || img.imageMetadata?.imagePosition);
              if (p.length >= 3) {
                const dx = p[0] - origin[0], dy = p[1] - origin[1], dz = p[2] - origin[2];
                zVals.push(dx*nn[0] + dy*nn[1] + dz*nn[2]);
              }
            }
            if (zVals.length) { ctZMin = Math.min(...zVals); ctZMax = Math.max(...zVals); }
          }
          const overlap = (aMin: number, aMax: number, bMin: number, bMax: number, tol = 5) => !(aMax < bMin - tol || bMax < aMin - tol);

          // Compute transformed MRI positions and store in ref
          // Always use CT series reference (first slice) here as well
          let transformed = computeTransformedMRIPositions(
            sortedImages,
            registrationMatrix,
            images[0]?.imageOrientation || images[0]?.imageMetadata?.imageOrientation,
            images[0]?.imagePosition || images[0]?.imageMetadata?.imagePosition,
            secondaryImageCacheRef.current
          );

          if (isFinite(ctZMin) && isFinite(ctZMax) && transformed.length > 0) {
            const zMin = Math.min(...transformed.map(t => t.zInCT));
            const zMax = Math.max(...transformed.map(t => t.zInCT));
            console.log(`🔎 Z-range check (on secondary load): CT=[${ctZMin.toFixed(1)}, ${ctZMax.toFixed(1)}], MRI→CT=[${zMin.toFixed(1)}, ${zMax.toFixed(1)}]`);
            if (!overlap(ctZMin, ctZMax, zMin, zMax, 5)) {
              console.warn(`No MRI→CT Z overlap detected (MRI ${zMin.toFixed(1)}–${zMax.toFixed(1)} vs CT ${ctZMin.toFixed(1)}–${ctZMax.toFixed(1)}). Trying inverted matrix.`);
              const tryMatrix = (m: number[]) => computeTransformedMRIPositions(
                sortedImages,
                m,
                images[0]?.imageOrientation || images[0]?.imageMetadata?.imageOrientation,
                images[0]?.imagePosition || images[0]?.imageMetadata?.imagePosition,
                secondaryImageCacheRef.current
              );
              const checkOverlapAndAdopt = (cand: {mat: number[]; tag: string}) => {
                const tr = tryMatrix(cand.mat);
                if (tr.length > 0) {
                  const a = Math.min(...tr.map(t => t.zInCT));
                  const b = Math.max(...tr.map(t => t.zInCT));
                  console.log(`🔎 Z-range (${cand.tag}): CT=[${ctZMin.toFixed(1)}, ${ctZMax.toFixed(1)}], MRI→CT=[${a.toFixed(1)}, ${b.toFixed(1)}]`);
                  if (overlap(ctZMin, ctZMax, a, b, 5)) {
                    console.log(`✅ ${cand.tag} matrix provides valid Z overlap. Using it.`);
                    transformed = tr;
                    setRegistrationMatrix(cand.mat);
                    registrationMatrixRef.current = cand.mat;
                    return true;
                  }
                }
                return false;
              };

              const inv = invertMatrix4x4(registrationMatrix);
              if (inv && checkOverlapAndAdopt({ mat: inv, tag: 'inverted' })) {
                // adopted
              } else {
                const trn = transposeMatrix4x4(registrationMatrix);
                if (checkOverlapAndAdopt({ mat: trn, tag: 'transposed' })) {
                  // adopted
                } else if (inv) {
                  const invTrn = transposeMatrix4x4(inv);
                  checkOverlapAndAdopt({ mat: invTrn, tag: 'inverted+transposed' });
                }
              }
            } else {
              console.log('✅ MRI→CT Z overlap OK — keeping provided matrix');
            }
          }

          // Z-offset alignment like above path
          if (isFinite(ctZMin) && isFinite(ctZMax) && transformed.length > 0) {
            const ctZs: number[] = [];
            const toNum = (v: any): number[] => Array.isArray(v) ? v.map(Number) : (typeof v === 'string' ? v.split('\\').map(Number) : []);
            const iop = toNum(images[0]?.imageOrientation || images[0]?.imageMetadata?.imageOrientation);
            const origin = toNum(images[0]?.imagePosition || images[0]?.imageMetadata?.imagePosition);
            if (iop.length >= 6 && origin.length >= 3) {
              const r = [iop[0], iop[1], iop[2]]; const c = [iop[3], iop[4], iop[5]];
              const n = [r[1]*c[2]-r[2]*c[1], r[2]*c[0]-r[0]*c[2], r[0]*c[1]-r[1]*c[0]];
              const nlen = Math.hypot(n[0], n[1], n[2]) || 1; const nn = [n[0]/nlen, n[1]/nlen, n[2]/nlen];
              for (const img of images) {
                const p = toNum(img.imagePosition || img.imageMetadata?.imagePosition);
                if (p.length >= 3) { const dx = p[0]-origin[0], dy=p[1]-origin[1], dz=p[2]-origin[2]; ctZs.push(dx*nn[0] + dy*nn[1] + dz*nn[2]); }
              }
              ctZs.sort((a,b)=>a-b);
            }
            if (ctZs.length > 1) {
              const nearest = (val: number) => {
                let lo=0, hi=ctZs.length-1, best=ctZs[0];
                while (lo<=hi) { const mid=(lo+hi>>1); const v=ctZs[mid]; if (Math.abs(v-val) < Math.abs(best-val)) best=v; if (v<val) lo=mid+1; else hi=mid-1; }
                return best;
              };
              const diffs = transformed.map(t => t.zInCT - nearest(t.zInCT)).filter(d => isFinite(d));
              if (diffs.length) {
                const sorted = diffs.slice().sort((a,b)=>a-b);
                const median = sorted[Math.floor(sorted.length/2)];
                if (Math.abs(median) > 0.5) {
                  console.log(`⚙️ Applying Z-offset correction: ${median.toFixed(2)}mm`);
                  transformed = transformed.map(t => ({...t, zInCT: t.zInCT - median}));
                }
              }
            }
          }

          transformedMRIPositions.current = transformed;
          console.log(`✓ Computed ${transformed.length} transformed MRI positions`);
          
          // Compute Z-range bounds for optimization
          if (transformed.length > 0) {
            const zValues = transformed.map(t => t.zInCT);
            mriZRangeInCTSpace.current = {
              min: Math.min(...zValues),
              max: Math.max(...zValues)
            };
            console.log(`✓ MRI Z-range in CT space: ${mriZRangeInCTSpace.current.min.toFixed(1)}mm to ${mriZRangeInCTSpace.current.max.toFixed(1)}mm`);
          }
        }
        
        // Trigger re-render to show fusion overlay with delay to ensure state is updated
        if (newCache.size > 0) {
          setTimeout(() => {
            scheduleRender();
          }, 100);
        }
      } catch (err) {
        console.error("Error loading secondary images:", err);
      }
    };

    loadSecondaryImages();
  }, [secondarySeriesId]);

  useEffect(() => {
    if (images.length > 0 && !isPreloading) {
      // Add a small delay to ensure state is stable after contour operations
      const timeoutId = setTimeout(() => {
        scheduleRender();
        // Load metadata for current image
        const currentImage = images[currentIndex];
        if (currentImage?.id) {
          loadImageMetadata(currentImage.id);
        }
      }, 10);
      
      return () => clearTimeout(timeoutId);
    }
  }, [images, currentIndex, isPreloading]); // Removed currentWindowLevel from dependencies to prevent infinite loop

  // Separate effect for window level changes - only re-render, don't reload metadata
  useEffect(() => {
    if (images.length > 0 && !isPreloading) {
      // Clear MPR cache on window/level change for proper updates
      if (mprCacheRef.current.size > 0) {
        if (DEBUG) console.log('Clearing MPR cache due to window/level change');
        mprCacheRef.current.clear();
      }
      scheduleRender();
    }
  }, [currentWindowLevel, zoom, panX, panY, images.length, isPreloading]);

  const loadImages = async () => {
    try {
      // Check if images are already cached
      if (imageCache?.current.has(seriesId.toString())) {
        const cached = imageCache.current.get(seriesId.toString());
        if (cached) {
          console.log(`Using cached images for series ${seriesId}`);
          setImages(cached.images);
          setCurrentIndex(0);
          setIsLoading(false);
          // Schedule initial render
          setTimeout(() => {
            displayCurrentImage();
          }, 10);
          // Start background prefetching for remaining images
          startBackgroundPrefetch(cached.images);
          return;
        }
      }
      
      setIsLoading(true);
      setError(null);

      // Check GPU acceleration availability for Cornerstone3D migration
      if (!gpuCheckComplete) {
        const gpuAvailable = isGPUAccelerationAvailable();
        console.log(`🖥️ GPU acceleration available: ${gpuAvailable ? 'YES ✅' : 'NO ❌'}`);
        setIsGPUMode(gpuAvailable);
        setGpuCheckComplete(true);
        
        if (gpuAvailable) {
          console.log('GPU acceleration detected - ready for Cornerstone3D migration phase');
          // Initialize Cornerstone3D in the next steps
        } else {
          console.log('No GPU acceleration - will continue using Cornerstone Core');
        }
      }

      // Cancel any existing series load
      if (seriesAbortRef.current) {
        seriesAbortRef.current.abort();
      }
      
      // Create new abort controller for this series
      seriesAbortRef.current = new AbortController();
      const signal = seriesAbortRef.current.signal;

      const response = await fetch(`/api/series/${seriesId}/images`, { signal });
      if (!response.ok) {
        throw new Error(`Failed to load images: ${response.statusText}`);
      }

      const seriesImages = await response.json();

      // First parse DICOM metadata for proper spatial ordering
      // Use web worker for metadata parsing to keep UI responsive
      const workerManager = getDicomWorkerManager();
      const imagesWithMetadata = await Promise.all(
        seriesImages.map(async (img: any) => {
          try {
            const response = await fetch(`/api/images/${img.sopInstanceUID}`, { signal });
            const arrayBuffer = await response.arrayBuffer();

            // Use web worker for metadata parsing
            const metadata = await workerManager.parseDicomMetadata(arrayBuffer);

            return {
              ...img,
              parsedSliceLocation: metadata.parsedSliceLocation,
              parsedZPosition: metadata.parsedZPosition,
              parsedInstanceNumber: metadata.parsedInstanceNumber ?? img.instanceNumber,
            };
          } catch (error) {
            console.warn(
              `Failed to parse DICOM metadata for ${img.fileName}:`,
              error,
            );
            return {
              ...img,
              parsedSliceLocation: null,
              parsedZPosition: null,
              parsedInstanceNumber: img.instanceNumber,
            };
          }
        }),
      );

      // Sort by spatial position - prefer slice location, then z-position, then instance number
      const sortedImages = imagesWithMetadata.sort((a: any, b: any) => {
        // Primary: slice location
        if (a.parsedSliceLocation !== null && b.parsedSliceLocation !== null) {
          return a.parsedSliceLocation - b.parsedSliceLocation;
        }

        // Secondary: z-position from image position
        if (a.parsedZPosition !== null && b.parsedZPosition !== null) {
          return a.parsedZPosition - b.parsedZPosition;
        }

        // Tertiary: instance number
        if (
          a.parsedInstanceNumber !== null &&
          b.parsedInstanceNumber !== null
        ) {
          return a.parsedInstanceNumber - b.parsedInstanceNumber;
        }

        // Final fallback: filename
        return a.fileName.localeCompare(b.fileName, undefined, {
          numeric: true,
        });
      });

      setImages(sortedImages);
      setCurrentIndex(0);
      
      // Cache the sorted images
      if (imageCache?.current) {
        imageCache.current.set(seriesId.toString(), {
          images: sortedImages,
          metadata: null // TODO: Add metadata if needed
        });
        console.log(`Cached ${sortedImages.length} images for series ${seriesId}`);
      }

      // Load the first image before removing loading screen
      if (sortedImages.length > 0) {
        try {
          const firstImage = sortedImages[0];
          const imageData = await fetchAndParseImage(firstImage.sopInstanceUID, signal);
          if (imageData) {
            // First image loaded, now we can remove loading screen
            setIsLoading(false);
            // Schedule initial render
            setTimeout(() => {
              displayCurrentImage();
            }, 10);
          }
        } catch (err) {
          console.error('Failed to load first image:', err);
        }
      }

      // OHIF 3.10-style background prefetching - runs after initial display
      // This doesn't block the UI and loads remaining images in background
      setTimeout(() => {
        console.log('📚 Starting OHIF-style background prefetching...');
        startBackgroundPrefetch(sortedImages);
      }, 100); // Small delay to ensure UI is responsive
    } catch (error: any) {
      // Don't show error for aborted requests (happens when switching series)
      if (error.name === 'AbortError') {
        console.log('Series load aborted (user switched series)');
        return;
      }
      setError(error.message);
      setIsLoading(false);
    }
  };

  const parseDicomImage = async (arrayBuffer: ArrayBuffer) => {
    try {
      // Use web worker for 65% performance improvement
      const workerManager = getDicomWorkerManager();
      const result = await workerManager.parseDicomImage(arrayBuffer);
      return result;
    } catch (error) {
      console.error("Error parsing DICOM image:", error);
      return null;
    }
  };

  // Single fetch/parse function to avoid double fetching
  const fetchAndParseImage = async (sopInstanceUID: string, signal?: AbortSignal) => {
    // Check if already in cache
    if (imageCacheRef.current.has(sopInstanceUID)) {
      return imageCacheRef.current.get(sopInstanceUID);
    }
    
    const response = await fetch(`/api/images/${sopInstanceUID}`, { signal });
    if (!response.ok) {
      throw new Error(`Failed to load image: ${response.status}`);
    }
    
    const arrayBuffer = await response.arrayBuffer();
    const imageData = await parseDicomImage(arrayBuffer);
    
    if (imageData) {
      imageCacheRef.current.set(sopInstanceUID, imageData);
    }
    
    return imageData;
  };
  
  // Batch fetch multiple images at once for better performance
  const fetchBatchImages = async (sopInstanceUIDs: string[], signal?: AbortSignal): Promise<Map<string, any>> => {
    const results = new Map<string, any>();
    
    // Filter out already cached images
    const uncachedUIDs = sopInstanceUIDs.filter(uid => !imageCacheRef.current.has(uid));
    
    if (uncachedUIDs.length === 0) {
      // All images are cached
      sopInstanceUIDs.forEach(uid => {
        const cached = imageCacheRef.current.get(uid);
        if (cached) results.set(uid, cached);
      });
      return results;
    }
    
    try {
      const response = await fetch('/api/images/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sopInstanceUIDs: uncachedUIDs }),
        signal
      });
      
      if (!response.ok) {
        throw new Error(`Batch fetch failed: ${response.status}`);
      }
      
      const batchData = await response.json();
      
      // Process batch results in parallel
      await Promise.all(Object.entries(batchData).map(async ([uid, result]: [string, any]) => {
        if (result.data) {
          // Convert base64 back to ArrayBuffer
          const binaryString = atob(result.data);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          
          const imageData = await parseDicomImage(bytes.buffer);
          if (imageData) {
            imageCacheRef.current.set(uid, imageData);
            results.set(uid, imageData);
          }
        }
      }));
      
      // Add cached images to results
      sopInstanceUIDs.forEach(uid => {
        const cached = imageCacheRef.current.get(uid);
        if (cached && !results.has(uid)) {
          results.set(uid, cached);
        }
      });
      
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.error('Batch fetch error:', error);
      }
      throw error;
    }
    
    return results;
  };

  // OHIF 3.10-style background prefetch - non-blocking and progressive
  const startBackgroundPrefetch = async (imageList: any[]) => {
    if (!imageList || imageList.length === 0 || prefetchCompleteRef.current) {
      return;
    }

    console.log(`🚀 OHIF-style background prefetch starting for ${imageList.length} images`);
    
    setPrefetchProgress({ loaded: imageCacheRef.current.size, total: imageList.length });
    
    const BATCH_SIZE = 50; // Match server batch size
    const PREFETCH_RADIUS = 10; // Images to prioritize around current position
    const COMPLETION_THRESHOLD = 0.95; // Hide progress at 95% complete
    const MAX_PREFETCH_TIME = 30000; // 30 second timeout
    let loadedCount = imageCacheRef.current.size;
    let failedCount = 0;
    const startTime = Date.now();
    
    // Auto-hide progress after timeout
    setTimeout(() => {
      if (!prefetchCompleteRef.current) {
        console.log('⏱️ Background prefetch timeout - hiding progress indicator');
        prefetchCompleteRef.current = true;
        setPrefetchProgress({ loaded: 0, total: 0 }); // Hide progress
      }
    }, MAX_PREFETCH_TIME);
    
    // Create priority queue based on viewing position
    const getPriority = (index: number) => {
      const distance = Math.abs(index - currentIndex);
      if (distance <= PREFETCH_RADIUS) return 0; // Highest priority
      return distance;
    };
    
    // Sort images by priority
    const prioritizedIndices = imageList
      .map((_, idx) => idx)
      .sort((a, b) => getPriority(a) - getPriority(b));
    
    // Process batches in background using requestIdleCallback for better performance
    const processBatch = async (startIdx: number) => {
      if (prefetchCompleteRef.current || !seriesAbortRef.current) return;
      
      // Check if we've loaded enough images
      const loadedPercentage = loadedCount / imageList.length;
      if (loadedPercentage >= COMPLETION_THRESHOLD) {
        prefetchCompleteRef.current = true;
        console.log(`✅ Background prefetch sufficient: ${loadedCount}/${imageList.length} images (${Math.round(loadedPercentage * 100)}%)`);
        setPrefetchProgress({ loaded: 0, total: 0 }); // Hide progress
        return;
      }
      
      const batchIndices = prioritizedIndices.slice(startIdx, startIdx + BATCH_SIZE);
      if (batchIndices.length === 0) {
        prefetchCompleteRef.current = true;
        console.log(`✅ Background prefetch complete: ${loadedCount}/${imageList.length} images, ${failedCount} failed`);
        setPrefetchProgress({ loaded: 0, total: 0 }); // Hide progress
        return;
      }
      
      // Get uncached images in this batch
      const uncachedImages = batchIndices
        .filter(idx => !imageCacheRef.current.has(imageList[idx].sopInstanceUID))
        .map(idx => imageList[idx]);
      
      if (uncachedImages.length > 0) {
        try {
          const batchUIDs = uncachedImages.map(img => img.sopInstanceUID);
          const batchResults = await fetchBatchImages(batchUIDs, seriesAbortRef.current?.signal);
          
          loadedCount += batchResults.size;
          failedCount += (batchUIDs.length - batchResults.size);
          
          const progress = Math.round((loadedCount / imageList.length) * 100);
          console.log(`📊 Prefetch progress: ${loadedCount}/${imageList.length} (${progress}%)`);
          setPrefetchProgress({ loaded: loadedCount, total: imageList.length });
          
        } catch (error: any) {
          if (error.name === 'AbortError') {
            console.log('Background prefetch aborted');
            setPrefetchProgress({ loaded: 0, total: 0 }); // Hide progress
            return;
          }
          console.warn('Batch prefetch error:', error.message);
          failedCount += uncachedImages.length;
        }
      }
      
      // Schedule next batch using requestIdleCallback for non-blocking behavior
      if ('requestIdleCallback' in window) {
        requestIdleCallback(() => processBatch(startIdx + BATCH_SIZE), { timeout: 2000 });
      } else {
        // Fallback for browsers without requestIdleCallback
        setTimeout(() => processBatch(startIdx + BATCH_SIZE), 100);
      }
    };
    
    // Start processing
    processBatch(0);
  };

  const preloadAllImages = async (imageList: any[]) => {
    console.log("Starting to preload all images with batch fetching...");
    if (!imageList || imageList.length === 0) {
      console.warn("No images to preload");
      setIsPreloading(false);
      return;
    }
    setIsPreloading(true);
    
    const BATCH_SIZE = 50; // Increased batch size for faster loading
    let loadedCount = 0;
    
    // Prioritize loading images near current index first
    const prioritizedList = [...imageList];
    const currentIdx = currentIndex;
    
    // Sort by distance from current index
    prioritizedList.sort((a, b) => {
      const aIdx = imageList.indexOf(a);
      const bIdx = imageList.indexOf(b);
      const aDist = Math.abs(aIdx - currentIdx);
      const bDist = Math.abs(bIdx - currentIdx);
      return aDist - bDist;
    });
    
    // Process images in batches
    for (let i = 0; i < prioritizedList.length; i += BATCH_SIZE) {
      const batch = prioritizedList.slice(i, i + BATCH_SIZE);
      const batchUIDs = batch.map(img => img.sopInstanceUID);
      
      try {
        // Fetch entire batch at once
        const batchResults = await fetchBatchImages(batchUIDs, seriesAbortRef.current?.signal);
        loadedCount += batchResults.size;
        
        console.log(`Batch loaded ${batchResults.size} images. Total: ${loadedCount}/${imageList.length} (${Math.round(loadedCount/imageList.length * 100)}%)`);
        
        // Check if current image was in this batch
        const currentImageUID = imageList[currentIndex]?.sopInstanceUID;
        if (currentImageUID && batchResults.has(currentImageUID)) {
          await displayCurrentImage();
        }
      } catch (error: any) {
        if (error.name === 'AbortError') {
          console.log('Batch loading aborted (user switched series)');
          break;
        }
        console.error(`Failed to load batch:`, error);
        
        // Fallback to individual loading for failed batch
        for (const image of batch) {
          try {
            await fetchAndParseImage(image.sopInstanceUID, seriesAbortRef.current?.signal);
            loadedCount++;
          } catch (individualError: any) {
            if (individualError.name !== 'AbortError') {
              console.error(`Failed to load individual image:`, individualError);
            }
          }
        }
      }
    }
    
    setIsPreloading(false);
    console.log(
      `Batch loading complete: ${imageCacheRef.current.size}/${imageList.length} images cached`,
    );
  };

  const loadImageMetadata = async (imageId: number) => {
    try {
      const response = await fetch(`/api/images/${imageId}/metadata`);
      if (response.ok) {
        const metadata = await response.json();
        console.log("Image metadata:", metadata);
        setImageMetadata(metadata);
        
        // Notify parent component of metadata change
        if (onImageMetadataChange) {
          onImageMetadataChange(metadata);
        }

        // Frame of Reference UIDs are verified during data import
      }
    } catch (error) {
      console.error("Failed to load image metadata:", error);
    }
  };

  // Helper function to create MPR volume from axial slices
  const createMPRVolume = (images: any[]) => {
    if (!images || images.length === 0) return null;
    
    // For a complete MPR implementation, we would:
    // 1. Sort images by Z position
    // 2. Create a 3D volume array
    // 3. Fill voxels with pixel data from each slice
    // 4. Handle spacing between slices
    
    // For now, return sorted images
    return images.sort((a, b) => {
      const zA = parseFloat(a.parsedZPosition || a.parsedSliceLocation || '0');
      const zB = parseFloat(b.parsedZPosition || b.parsedSliceLocation || '0');
      return zA - zB;
    });
  };

  // Helper function to reconstruct MPR slice from volume
  const reconstructMPRSlice = async (orientation: string, sliceIndex: number) => {
    if (!images || images.length === 0) return null;
    
    if (orientation === 'axial') {
      // Standard axial view
      return images[sliceIndex];
    }
    
    // Check cache first
    const cacheKey = `${orientation}-${sliceIndex}`;
    const cached = mprCacheRef.current.get(cacheKey);
    if (cached) {
      console.log(`Using cached MPR data for ${cacheKey}`);
      return cached;
    }
    
    // For MPR reconstruction, we need all images loaded with pixel data
    // Sort images by Z position
    const sortedImages = [...images].sort((a, b) => {
      const zA = parseFloat(a.parsedZPosition || a.parsedSliceLocation || '0');
      const zB = parseFloat(b.parsedZPosition || b.parsedSliceLocation || '0');
      return zA - zB;
    });
    
    // Get dimensions from first image - need to load pixel data from cache
    const firstImageData = imageCacheRef.current.get(sortedImages[0].sopInstanceUID);
    if (!firstImageData) {
      console.error("First image not in cache for MPR reconstruction");
      return null;
    }
    
    const width = firstImageData.width || 512;
    const height = firstImageData.height || 512;
    const numSlices = sortedImages.length;
    
    // Get pixel spacing and slice thickness for proper aspect ratio
    const firstImage = sortedImages[0];
    const pixelSpacing = firstImage.pixelSpacing?.split('\\').map(parseFloat) || [1, 1];
    const sliceThickness = parseFloat(firstImage.sliceThickness || '2.0');
    
    console.log(`MPR reconstruction: ${orientation}, slice ${sliceIndex}, volume ${width}x${height}x${numSlices}`);
    console.log(`Pixel spacing: ${pixelSpacing[0]}x${pixelSpacing[1]}, slice thickness: ${sliceThickness}`);
    
    // Create synthetic image for MPR view with proper dimensions
    let mprWidth, mprHeight;
    if (orientation === 'sagittal') {
      mprWidth = height; // Y dimension of axial
      mprHeight = numSlices; // Z dimension
    } else { // coronal
      mprWidth = width; // X dimension of axial
      mprHeight = numSlices; // Z dimension
    }
    
    const mprImage = {
      ...sortedImages[0],
      sopInstanceUID: `mpr-${orientation}-${sliceIndex}`,
      pixelData: new Uint16Array(mprWidth * mprHeight),
      columns: mprWidth,
      rows: mprHeight,
      orientation: orientation,
      // Update pixel spacing for MPR views
      pixelSpacing: orientation === 'sagittal' 
        ? `${pixelSpacing[1]}\\${sliceThickness}` // Y spacing x slice thickness
        : `${pixelSpacing[0]}\\${sliceThickness}` // X spacing x slice thickness
    };
    
    let pixelsSet = 0;
    
    // For sagittal: slice through X axis (left-right view)
    // For coronal: slice through Y axis (front-back view)
    if (orientation === 'sagittal') {
      // Sagittal view: fix X coordinate, vary Y and Z
      const x = Math.min(sliceIndex, width - 1);
      
      // Fill pixel data by sampling from axial slices
      // Reverse Z-axis to fix upside-down orientation (following OHIF convention)
      for (let z = 0; z < numSlices; z++) {
        const axialZ = numSlices - 1 - z; // Reverse Z for proper anatomical orientation
        const axialImage = sortedImages[axialZ];
        const axialImageData = imageCacheRef.current.get(axialImage.sopInstanceUID);
        
        if (axialImageData && axialImageData.data) {
          for (let y = 0; y < height; y++) {
            const srcIndex = y * width + x;
            const dstIndex = z * mprWidth + y;
            // Convert Float32 to Uint16, handling negative values properly
            const floatValue = axialImageData.data[srcIndex] || 0;
            const pixelValue = Math.max(0, Math.min(65535, Math.round(floatValue)));
            mprImage.pixelData[dstIndex] = pixelValue;
            if (pixelValue > 0) pixelsSet++;
          }
        }
      }
    } else if (orientation === 'coronal') {
      // Coronal view: fix Y coordinate, vary X and Z
      const y = Math.min(sliceIndex, height - 1);
      
      // Fill pixel data by sampling from axial slices
      // Reverse Z-axis to fix upside-down orientation (following OHIF convention)
      for (let z = 0; z < numSlices; z++) {
        const axialZ = numSlices - 1 - z; // Reverse Z for proper anatomical orientation
        const axialImage = sortedImages[axialZ];
        const axialImageData = imageCacheRef.current.get(axialImage.sopInstanceUID);
        
        if (axialImageData && axialImageData.data) {
          for (let x = 0; x < width; x++) {
            const srcIndex = y * width + x;
            const dstIndex = z * mprWidth + x;
            // Convert Float32 to Uint16, handling negative values properly
            const floatValue = axialImageData.data[srcIndex] || 0;
            const pixelValue = Math.max(0, Math.min(65535, Math.round(floatValue)));
            mprImage.pixelData[dstIndex] = pixelValue;
            if (pixelValue > 0) pixelsSet++;
          }
        }
      }
    }
    
    console.log(`MPR ${orientation}: ${pixelsSet} pixels set out of ${mprWidth * mprHeight}`);
    
    // Cache the result for performance
    mprCacheRef.current.set(cacheKey, mprImage);
    
    return mprImage;
  };

  // Helper function to get slice for specific orientation
  const getMPRSlice = (orientation: string, sliceIndex: number) => {
    if (!images || images.length === 0) return null;
    
    if (orientation === 'axial') {
      // Standard axial view
      return images[sliceIndex];
    }
    
    // For sagittal and coronal, return a promise for async reconstruction
    return reconstructMPRSlice(orientation, sliceIndex);
  };

  const renderMPRCanvas = async (
    canvas: HTMLCanvasElement, 
    targetOrientation: 'sagittal' | 'coronal',
    currentSliceIndex: number,
    windowWidth: number,
    windowCenter: number
  ) => {
    if (!canvas || images.length === 0 || !images[0]) {
      console.warn(`MPR render skipped - no canvas or images`);
      return;
    }
    
    console.log(`MPR renderMPRCanvas called for ${targetOrientation} at index ${currentSliceIndex}, canvas: ${canvas.width}x${canvas.height}`);
    
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      console.error(`MPR render failed - no 2D context for ${targetOrientation}`);
      return;
    }

    try {
      // Clear canvas first
      ctx.fillStyle = "black";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      // Enable smooth scaling for better quality
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      
      console.log(`Reconstructing ${targetOrientation} slice at index ${currentSliceIndex}`);
      const reconstructedImage = await reconstructMPRSlice(targetOrientation, currentSliceIndex);
      
      if (!reconstructedImage || !reconstructedImage.pixelData) {
        console.error(`No reconstructed image or pixel data for ${targetOrientation}`);
        return;
      }
      
      // Get pixel data from reconstructed image
      const pixelData = reconstructedImage.pixelData;
      
      // Fix typescript error and improve performance
      const pixelArray = pixelData as Uint16Array;
      let minVal = 65535, maxVal = 0;
      let hasData = false;
      for (let i = 0; i < pixelArray.length; i++) {
        const val = pixelArray[i];
        if (val > 0) {
          hasData = true;
          minVal = Math.min(minVal, val);
          maxVal = Math.max(maxVal, val);
        }
      }
      
      if (!hasData) {
        console.warn(`MPR ${targetOrientation} has no pixel data!`);
        minVal = 0;
      }
      
      console.log(`MPR pixel data stats: min=${minVal}, max=${maxVal}, hasData=${hasData}`);
      
      // Use larger canvas size for better resolution
      const canvasWidth = canvas.width;
      const canvasHeight = canvas.height;
      const imageData = ctx.createImageData(canvasWidth, canvasHeight);
      const data = imageData.data;
      
      // Get proper dimensions
      const sourceWidth = reconstructedImage.columns || 512;
      const sourceHeight = reconstructedImage.rows || 512;
      
      // For sagittal: width=imageHeight (Y), height=numSlices (Z)
      // For coronal: width=imageWidth (X), height=numSlices (Z)
      let displayWidth = sourceWidth;
      let displayHeight = sourceHeight;
      
      if (targetOrientation === 'sagittal') {
        // Sagittal view shows Y (horizontal) x Z (vertical)
        displayWidth = sourceHeight; // Y dimension (512)
        displayHeight = images.length; // Z dimension (number of slices)
      } else if (targetOrientation === 'coronal') {
        // Coronal view shows X (horizontal) x Z (vertical)
        displayWidth = sourceWidth; // X dimension (512)
        displayHeight = images.length; // Z dimension (number of slices)
      }
      
      // Calculate scale to fit canvas while preserving physical aspect ratio
      // Both sagittal and coronal should have the same display height
      
      // Use default pixel spacing for aspect ratio calculation
      const pixelSpacingX = 0.9765625;
      const pixelSpacingY = 0.9765625;
      const sliceThickness = 2.0; // Typical slice thickness for CT
      
      // Calculate physical dimensions in mm
      let physicalWidth, physicalHeight;
      
      if (targetOrientation === 'sagittal') {
        // Sagittal: Y (horizontal) x Z (vertical)
        physicalWidth = displayWidth * pixelSpacingY;
        physicalHeight = displayHeight * sliceThickness;
      } else if (targetOrientation === 'coronal') {
        // Coronal: X (horizontal) x Z (vertical)
        physicalWidth = displayWidth * pixelSpacingX;
        physicalHeight = displayHeight * sliceThickness;
      } else {
        physicalWidth = displayWidth;
        physicalHeight = displayHeight;
      }
      
      // Calculate scale to fill the canvas properly while maintaining aspect ratio
      const aspectRatio = physicalWidth / physicalHeight;
      let scaledWidth, scaledHeight, scale;
      
      // For sagittal/coronal views, prioritize filling the height (superior-inferior dimension)
      // This makes the body anatomy display properly in a tall, rectangular format
      if (aspectRatio < (canvasWidth / canvasHeight)) {
        // Height-constrained (typical for body scans)
        scaledHeight = canvasHeight;
        scaledWidth = scaledHeight * aspectRatio;
        scale = canvasHeight / displayHeight;
      } else {
        // Width-constrained
        scaledWidth = canvasWidth;
        scaledHeight = scaledWidth / aspectRatio;
        scale = canvasWidth / displayWidth;
      }
      
      // Center the image
      const offsetX = (canvasWidth - scaledWidth) / 2;
      const offsetY = (canvasHeight - scaledHeight) / 2;
      
      // Clear the data array first (ensure black background)
      data.fill(0);
      
      // Use the same window/level settings as the axial view
      const min = windowCenter - windowWidth / 2;
      const max = windowCenter + windowWidth / 2;
      
      console.log(`MPR ${targetOrientation} using window/level: W=${windowWidth}, C=${windowCenter}`);
      console.log(`MPR canvas size: ${canvasWidth}x${canvasHeight}, display size: ${displayWidth}x${displayHeight}, scale: ${scale}`);
      
      // Render pixels with proper scaling and aspect ratio
      for (let y = 0; y < canvasHeight; y++) {
        for (let x = 0; x < canvasWidth; x++) {
          // Check if we're within the scaled image bounds
          if (x >= offsetX && x < offsetX + scaledWidth && 
              y >= offsetY && y < offsetY + scaledHeight) {
            
            // Calculate source coordinates
            const sourceX = Math.floor(((x - offsetX) / scale));
            const sourceY = Math.floor(((y - offsetY) / scale));
            
            // Ensure source coords are within bounds
            if (sourceX >= 0 && sourceX < displayWidth && 
                sourceY >= 0 && sourceY < displayHeight) {
              
              const sourceIndex = sourceY * sourceWidth + sourceX;
              const pixelValue = pixelArray[sourceIndex] || 0;
              
              // Apply window/level
              let normalizedValue;
              if (pixelValue <= min) {
                normalizedValue = 0;
              } else if (pixelValue >= max) {
                normalizedValue = 255;
              } else {
                normalizedValue = Math.round(((pixelValue - min) / windowWidth) * 255);
              }
              
              const destIndex = (y * canvasWidth + x) * 4;
              data[destIndex] = normalizedValue;     // R
              data[destIndex + 1] = normalizedValue; // G
              data[destIndex + 2] = normalizedValue; // B
              data[destIndex + 3] = 255;            // A
            }
          }
        }
      }
      
      ctx.putImageData(imageData, 0, 0);
      
      // Draw crosshairs on MPR views
      if (crosshairPos) {
        ctx.save();
        ctx.strokeStyle = 'rgba(0, 255, 255, 0.8)';
        ctx.lineWidth = 2;
        
        if (targetOrientation === 'sagittal') {
          // Draw vertical line at coronal position and horizontal line at axial position
          // Vertical line corresponds to coronal slice position
          const coronalPos = Math.floor(crosshairPos.y);
          const lineX = offsetX + (coronalPos * scale);
          
          ctx.beginPath();
          ctx.moveTo(lineX, 0);
          ctx.lineTo(lineX, canvasHeight);
          ctx.stroke();
          
          // Horizontal line corresponds to axial slice position (inverted Z)
          const axialPos = displayHeight - 1 - currentIndex;
          const lineY = offsetY + (axialPos * scale);
          
          ctx.beginPath();
          ctx.moveTo(0, lineY);
          ctx.lineTo(canvasWidth, lineY);
          ctx.stroke();
          
        } else if (targetOrientation === 'coronal') {
          // Draw vertical line at sagittal position and horizontal line at axial position
          // Vertical line corresponds to sagittal slice position
          const sagittalPos = Math.floor(crosshairPos.x);
          const lineX = offsetX + (sagittalPos * scale);
          
          ctx.beginPath();
          ctx.moveTo(lineX, 0);
          ctx.lineTo(lineX, canvasHeight);
          ctx.stroke();
          
          // Horizontal line corresponds to axial slice position (inverted Z)
          const axialPos = displayHeight - 1 - currentIndex;
          const lineY = offsetY + (axialPos * scale);
          
          ctx.beginPath();
          ctx.moveTo(0, lineY);
          ctx.lineTo(canvasWidth, lineY);
          ctx.stroke();
        }
        
        ctx.restore();
      }
      
      console.log(`✓ ${targetOrientation} MPR rendered`);
    } catch (error) {
      console.error(`Error rendering ${targetOrientation} MPR:`, error);
    }
  };

  const displayCurrentImage = async () => {
    if (!canvasRef.current || images.length === 0) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    try {
      // Get the appropriate slice based on orientation
      let currentImage;
      if (orientation === 'axial') {
        // Ensure currentIndex is valid
        const safeIndex = Math.max(0, Math.min(currentIndex, images.length - 1));
        currentImage = images[safeIndex];
      } else {
        // For sagittal/coronal, use MPR reconstruction
        const mprSlice = await getMPRSlice(orientation, currentIndex);
        currentImage = mprSlice;
      }
      
      if (!currentImage) {
        console.error("No image available for orientation:", orientation);
        setError("Unable to display image. Please try refreshing.");
        return;
      }
      const cacheKey = currentImage.sopInstanceUID;

      // Clear canvas
      ctx.fillStyle = "black";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      let imageData;
      
      // Check if this is an MPR reconstructed image (synthetic)
      if (orientation !== 'axial' && currentImage.pixelData) {
        // For MPR slices, use the reconstructed pixel data directly
        imageData = {
          width: currentImage.columns || currentImage.width || 512,
          height: currentImage.rows || currentImage.height || 512,
          data: currentImage.pixelData
        };
      } else {
        // For axial slices, use the cache
        imageData = imageCacheRef.current.get(cacheKey);

        if (!imageData || !imageData.data) {
          // Try to reload the image if it's not in cache
          console.warn(
            "Image not in cache, attempting to reload:",
            cacheKey,
          );
          
          try {
            // Use single fetch/parse function to avoid double fetching
            const reloadedImageData = await fetchAndParseImage(currentImage.sopInstanceUID);
            
            if (reloadedImageData) {
              imageData = reloadedImageData;
              console.log("Successfully reloaded image:", cacheKey);
            } else {
              throw new Error("Failed to parse reloaded image");
            }
          } catch (reloadError) {
            console.error("Failed to reload image:", reloadError);
            throw new Error(`Image not available: ${reloadError instanceof Error ? reloadError.message : 'Unknown error'}`);
          }
        }
      }

      // Keep fixed canvas size for consistent display
      canvas.width = 1024;
      canvas.height = 1024;

      // Always use CPU rendering for now - GPU integration needs more work
      render16BitImage(ctx, imageData.data, imageData.width, imageData.height);
      
      // Render secondary image overlay for fusion if available
      console.log('Fusion check:', {
        secondarySeriesId,
        secondaryImagesLength: secondaryImages.length,
        condition: !!(secondarySeriesId && secondaryImages.length > 0)
      });
      
      if (secondarySeriesId && secondaryImages.length > 0) {
        console.log(`Rendering fusion for CT slice ${currentIndex}`);
        try {
          await renderFusionOverlayNew(ctx, currentImage);
        } catch (fusionError: any) {
          console.error("Error rendering fusion overlay:", fusionError);
          console.error("Fusion error details:", {
            message: fusionError.message,
            stack: fusionError.stack,
            secondarySeriesId,
            secondaryImagesCount: secondaryImages.length,
            fusionOpacity
          });
          // Continue without fusion rather than failing entire image display
        }
      }

      // Render RT structure overlays if available
      if (localRTStructures) {
        try {
          // Pass currentImage with its metadata attached
          const imageWithMetadata = {
            ...currentImage,
            imageMetadata: imageMetadata // Use the actual imageMetadata state variable
          };
          renderRTStructures(ctx, canvas, imageWithMetadata);
        } catch (rtError) {
          console.warn("Error drawing RT structures:", rtError);
          // Don't let RT structure errors prevent image display
        }
      }
      
      // Draw crosshairs if in axial view
      if (orientation === 'axial') {
        // Convert crosshair pixel coordinates to canvas coordinates
        const imageWidth = currentImage.columns || currentImage.width || 512;
        const imageHeight = currentImage.rows || currentImage.height || 512;
        
        // Calculate scale with zoom factor (same as render16BitImage)
        const baseScale = Math.min(canvas.width / imageWidth, canvas.height / imageHeight);
        const totalScale = baseScale * zoom;
        const scaledWidth = imageWidth * totalScale;
        const scaledHeight = imageHeight * totalScale;
        
        // Center position with pan offset
        const imageX = (canvas.width - scaledWidth) / 2 + panX;
        const imageY = (canvas.height - scaledHeight) / 2 + panY;
        
        // Convert crosshair pixel position to canvas position
        const crosshairCanvasX = imageX + (crosshairPos.x * totalScale);
        const crosshairCanvasY = imageY + (crosshairPos.y * totalScale);
        
        // Draw crosshairs
        ctx.save();
        ctx.strokeStyle = 'rgba(0, 255, 255, 0.8)'; // Cyan color
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 5]); // Dashed line
        
        // Vertical line
        ctx.beginPath();
        ctx.moveTo(crosshairCanvasX, 0);
        ctx.lineTo(crosshairCanvasX, canvas.height);
        ctx.stroke();
        
        // Horizontal line
        ctx.beginPath();
        ctx.moveTo(0, crosshairCanvasY);
        ctx.lineTo(canvas.width, crosshairCanvasY);
        ctx.stroke();
        
        // Draw center point
        ctx.fillStyle = 'rgba(0, 255, 255, 0.8)';
        ctx.beginPath();
        ctx.arc(crosshairCanvasX, crosshairCanvasY, 3, 0, 2 * Math.PI);
        ctx.fill();
        
        ctx.restore();
      }
      
      // Render MPR views if canvases are available
      if (orientation === 'axial' && sagittalCanvasRef.current && coronalCanvasRef.current) {
        try {
          // Use crosshair position for MPR slice indices
          // Ensure crosshair is within bounds
          const sagittalSliceIndex = Math.max(0, Math.min(crosshairPos.x, (images[0]?.columns || 512) - 1));
          const coronalSliceIndex = Math.max(0, Math.min(crosshairPos.y, (images[0]?.rows || 512) - 1));
          
          console.log(`Rendering MPR views - Sagittal: ${sagittalSliceIndex}, Coronal: ${coronalSliceIndex}, W=${currentWindowLevel.width}, C=${currentWindowLevel.center}`);
          
          // Render MPR views asynchronously with same window/level as axial
          await Promise.all([
            renderMPRCanvas(sagittalCanvasRef.current, 'sagittal', sagittalSliceIndex, currentWindowLevel.width, currentWindowLevel.center),
            renderMPRCanvas(coronalCanvasRef.current, 'coronal', coronalSliceIndex, currentWindowLevel.width, currentWindowLevel.center)
          ]);
        } catch (mprError) {
          console.warn("Error rendering MPR views:", mprError);
        }
      }
    } catch (error: any) {
      console.error("Error displaying image:", error);
      console.error("Error details:", error.message, error.stack);
      ctx.fillStyle = "black";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "red";
      ctx.font = "16px Arial";
      ctx.textAlign = "center";
      ctx.fillText(
        "Error loading DICOM",
        canvas.width / 2,
        canvas.height / 2 - 10,
      );
      ctx.fillText(error.message || "Unknown error", canvas.width / 2, canvas.height / 2 + 10);
    }
  };

  const render16BitImage = (
    ctx: CanvasRenderingContext2D,
    pixelArray: Float32Array,
    width: number,
    height: number,
  ) => {
    // Get rescale parameters for proper HU conversion
    const { slope, intercept } = getRescaleParams(imageMetadata);

    // Apply window/level settings
    const { width: windowWidth, center: windowCenter } = currentWindowLevel;
    const min = windowCenter - windowWidth / 2;
    const max = windowCenter + windowWidth / 2;
    
    // Create/update cached LUT if window/level changed
    const lutKey = `${windowWidth}-${windowCenter}-${slope}-${intercept}`;
    let lut: Uint8Array;
    
    if (cachedLUTRef.current?.key === lutKey) {
      lut = cachedLUTRef.current.lut;
    } else {
      // Build new LUT
      lut = new Uint8Array(65536);
      for (let i = 0; i < 65536; i++) {
        const hu = (i - 32768) * slope + intercept;
        let normalizedValue;
        if (hu <= min) {
          normalizedValue = 0;
        } else if (hu >= max) {
          normalizedValue = 255;
        } else {
          normalizedValue = ((hu - min) / windowWidth) * 255;
        }
        lut[i] = Math.max(0, Math.min(255, normalizedValue));
      }
      cachedLUTRef.current = { key: lutKey, lut };
    }
    
    // Create image data at original size
    const imageData = ctx.createImageData(width, height);
    const data = imageData.data;

    // Apply LUT to pixel data
    for (let i = 0; i < pixelArray.length; i++) {
      // Convert Float32 to Uint16 index for LUT
      const pixelValue = Math.max(0, Math.min(65535, Math.round(pixelArray[i] + 32768)));
      const gray = lut[pixelValue];

      const pixelIndex = i * 4;
      data[pixelIndex] = gray; // R
      data[pixelIndex + 1] = gray; // G
      data[pixelIndex + 2] = gray; // B
      data[pixelIndex + 3] = 255; // A
    }

    // Reuse offscreen canvas if possible
    if (!offscreenCanvasRef.current || 
        offscreenCanvasRef.current.width !== width || 
        offscreenCanvasRef.current.height !== height) {
      offscreenCanvasRef.current = document.createElement("canvas");
      offscreenCanvasRef.current.width = width;
      offscreenCanvasRef.current.height = height;
    }
    
    const tempCanvas = offscreenCanvasRef.current;
    const tempCtx = tempCanvas.getContext("2d", { willReadFrequently: true });
    if (!tempCtx) return;

    tempCtx.putImageData(imageData, 0, 0);

    // Scale and draw to the main canvas with zoom and pan
    const canvasWidth = ctx.canvas.width;
    const canvasHeight = ctx.canvas.height;

    // Calculate scale with zoom factor
    const baseScale = Math.min(canvasWidth / width, canvasHeight / height);
    const totalScale = baseScale * zoom;
    const scaledWidth = width * totalScale;
    const scaledHeight = height * totalScale;

    // Center the image on canvas with pan offset
    const x = (canvasWidth - scaledWidth) / 2 + panX;
    const y = (canvasHeight - scaledHeight) / 2 + panY;

    // Store CT transform for fusion overlay to use the same coordinate system
    ctTransform.current = {
      scale: totalScale,
      offsetX: x,
      offsetY: y,
      imageWidth: width,
      imageHeight: height
    };

    // Enable smooth scaling for better zoom quality while preserving medical image integrity
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(tempCanvas, x, y, scaledWidth, scaledHeight);
  };

  const render8BitImage = (
    ctx: CanvasRenderingContext2D,
    pixelArray: Uint8Array,
    width: number,
    height: number,
  ) => {
    const imageData = ctx.createImageData(width, height);
    const data = imageData.data;

    for (let i = 0; i < pixelArray.length; i++) {
      const gray = pixelArray[i];
      const pixelIndex = i * 4;
      data[pixelIndex] = gray; // R
      data[pixelIndex + 1] = gray; // G
      data[pixelIndex + 2] = gray; // B
      data[pixelIndex + 3] = 255; // A
    }

    ctx.putImageData(imageData, 0, 0);
  };
  
  const renderFusionOverlayNew = async (ctx: CanvasRenderingContext2D, primaryImage: any) => {
    // Skip expensive fusion during rapid scrolling for better performance
    if (isScrollingRef.current && fusionOpacity > 0) {
      // Skip fusion rendering during active scrolling to maintain smooth performance
      console.log("⚡ Skipping fusion during rapid scrolling");
      return;
    }
    
    console.log('🎯 FUSION RENDER DEBUG: renderFusionOverlayNew called');
    console.log('🎯 FUSION RENDER DEBUG: Full state:', {
      secondaryImagesLength: secondaryImages.length,
      secondarySeriesId,
      secondarySeriesType: typeof secondarySeriesId,
      fusionOpacity,
      hasRegistrationMatrix: !!registrationMatrix,
      registrationMatrixLength: registrationMatrix?.length,
      hasTransformedPositions: !!transformedMRIPositions.current?.length,
      transformedPositionsLength: transformedMRIPositions.current?.length || 0
    });
    
    if (!secondaryImages.length || !secondarySeriesId) {
      console.log("❌ Fusion not rendered - secondaryImages:", secondaryImages.length, "secondarySeriesId:", secondarySeriesId, "type:", typeof secondarySeriesId);
      return;
    }
    
    // If opacity is 0, skip rendering entirely
    if (fusionOpacity === 0) {
      console.log("❌ Fusion opacity is 0, skipping overlay render");
      return;
    }
    
    if (!registrationMatrix || registrationMatrix.length !== 16) {
      console.error("CRITICAL: No registration matrix available - fusion cannot be displayed");
      setFusionAvailable(false);
      return;
    }
    
    if (!transformedMRIPositions.current || transformedMRIPositions.current.length === 0) {
      console.log("No transformed MRI positions available");
      return;
    }
    
    // Compute CT slice Z by projecting onto CT normal for consistent MRI matching
    let ctSliceZ: number = (currentIndex + 1) * 3; // Default fallback
    try {
      const toNumArr = (v: any): number[] => Array.isArray(v) ? v.map(Number) : (typeof v === 'string' ? v.split('\\').map(Number) : []);
      const iopStr = images[0]?.imageOrientation || images[0]?.imageMetadata?.imageOrientation || primaryImage.imageOrientation || primaryImage.imageMetadata?.imageOrientation;
      const iop = toNumArr(iopStr);
      const seriesOriginStr = images[0]?.imagePosition || images[0]?.imageMetadata?.imagePosition;
      const seriesOrigin = toNumArr(seriesOriginStr);
      const thisPosStr = primaryImage.imagePosition || primaryImage.imageMetadata?.imagePosition;
      const thisPos = toNumArr(thisPosStr);

      if (iop.length >= 6 && seriesOrigin.length >= 3 && thisPos.length >= 3) {
        const rx = iop[0], ry = iop[1], rz = iop[2];
        const cx = iop[3], cy = iop[4], cz = iop[5];
        const nx = ry * cz - rz * cy;
        const ny = rz * cx - rx * cz;
        const nz = rx * cy - ry * cx;
        const nlen = Math.hypot(nx, ny, nz) || 1;
        const n = [nx / nlen, ny / nlen, nz / nlen];
        const dx = thisPos[0] - seriesOrigin[0];
        const dy = thisPos[1] - seriesOrigin[1];
        const dz = thisPos[2] - seriesOrigin[2];
        ctSliceZ = dx * n[0] + dy * n[1] + dz * n[2];
      } else {
        // Fallback to legacy heuristics
        if (primaryImage.parsedSliceLocation !== undefined && primaryImage.parsedSliceLocation !== null) {
          ctSliceZ = primaryImage.parsedSliceLocation;
        } else if (primaryImage.parsedZPosition !== undefined && primaryImage.parsedZPosition !== null) {
          ctSliceZ = primaryImage.parsedZPosition;
        } else if (primaryImage.sliceLocation) {
          const parsed = parseFloat(primaryImage.sliceLocation);
          if (!isNaN(parsed)) ctSliceZ = parsed;
        } else if (primaryImage.imagePosition) {
          const imagePos = typeof primaryImage.imagePosition === 'string'
            ? primaryImage.imagePosition.split("\\")
            : primaryImage.imagePosition;
          if (imagePos && imagePos.length >= 3) {
            const parsed = parseFloat(imagePos[2]);
            if (!isNaN(parsed)) ctSliceZ = parsed;
          }
        }
      }
    } catch (e) {
      // Keep fallback value on error
    }
    
    const actualCache = secondaryImageCacheRef.current;
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    // Project current CT slice Z into same CT-relative coordinate as transformed MRI
    let ctSliceZProjected = ctSliceZ;
    try {
      const toNum = (v: any): number[] => Array.isArray(v) ? v.map(Number) : (typeof v === 'string' ? v.split('\\').map(Number) : []);
      const baseIOP = toNum(images[0]?.imageOrientation || images[0]?.imageMetadata?.imageOrientation);
      const basePos = toNum(images[0]?.imagePosition || images[0]?.imageMetadata?.imagePosition);
      const curPos = toNum(primaryImage?.imagePosition || primaryImage?.imageMetadata?.imagePosition);
      if (baseIOP.length >= 6 && basePos.length >= 3 && curPos.length >= 3) {
        const r = [baseIOP[0], baseIOP[1], baseIOP[2]];
        const c = [baseIOP[3], baseIOP[4], baseIOP[5]];
        const n = [r[1]*c[2]-r[2]*c[1], r[2]*c[0]-r[0]*c[2], r[0]*c[1]-r[1]*c[0]];
        const nl = Math.hypot(n[0], n[1], n[2]) || 1; const nn = [n[0]/nl, n[1]/nl, n[2]/nl];
        const dx = curPos[0] - basePos[0];
        const dy = curPos[1] - basePos[1];
        const dz = curPos[2] - basePos[2];
        ctSliceZProjected = dx*nn[0] + dy*nn[1] + dz*nn[2];
      }
    } catch {}

    console.log('🚀 About to call renderFusionOverlay with:', {
      ctSliceZ: ctSliceZProjected,
      fusionOpacity,
      canvasSize: `${canvas.width}x${canvas.height}`,
      actualCacheSize: actualCache.size,
      transformedMRILength: transformedMRIPositions.current?.length
    });
    
    // Ensure nearest MRI slice is available in cache; if not, lazy-load it
    try {
      if (transformedMRIPositions.current && transformedMRIPositions.current.length > 0) {
        const toNum = (v: any): number[] => Array.isArray(v) ? v.map(Number) : (typeof v === 'string' ? v.split('\\').map(Number) : []);
        const baseIOP = toNum(images[0]?.imageOrientation || images[0]?.imageMetadata?.imageOrientation);
        const basePos = toNum(images[0]?.imagePosition || images[0]?.imageMetadata?.imagePosition);
        let ctNorm: number[] | null = null;
        if (baseIOP.length >= 6) {
          const r = [baseIOP[0], baseIOP[1], baseIOP[2]]; const c = [baseIOP[3], baseIOP[4], baseIOP[5]];
          const n = [r[1]*c[2]-r[2]*c[1], r[2]*c[0]-r[0]*c[2], r[0]*c[1]-r[1]*c[0]]; const nl = Math.hypot(n[0],n[1],n[2])||1; ctNorm = [n[0]/nl,n[1]/nl,n[2]/nl];
        }
        const nearestIdx = findNearestMRIIndexByPlane(ctSliceZProjected, ctNorm, (basePos.length>=3?basePos:null), transformedMRIPositions.current as any);
        if (nearestIdx !== null && nearestIdx >= 0) {
          const uid = transformedMRIPositions.current[nearestIdx]?.image?.sopInstanceUID;
          if (uid && !secondaryImageCacheRef.current.has(uid)) {
            console.log('🔄 Lazy-loading nearest MRI slice into cache:', uid);
            try {
              const resp = await fetch(`/api/images/${uid}`);
              if (resp.ok) {
                const buf = await resp.arrayBuffer();
                const imgData = await parseDicomImage(buf);
                if (imgData) {
                  secondaryImageCacheRef.current.set(uid, imgData);
                }
              }
            } catch (e) {
              console.warn('Failed to lazy-load nearest MRI slice:', e);
            }
          }
        }
      }
    } catch {}

    // Call the new fusion utility function with registration matrix and shared CT coordinate system
    // DO NOT apply transform here - fusion-utils handles its own transforms
    await renderFusionOverlay(
      ctx,
      primaryImage,
      transformedMRIPositions.current,
      actualCache,
      ctSliceZProjected,
      fusionOpacity,
      panX,
      panY,
      canvas.width,
      canvas.height,
      registrationMatrix,
      ctTransform.current,
      // Pass the CT series origin to maintain the same reference as ctSliceZProjected
      (images[0]?.imagePosition || images[0]?.imageMetadata?.imagePosition
        ? (Array.isArray(images[0]?.imagePosition || images[0]?.imageMetadata?.imagePosition)
            ? (images[0]?.imagePosition || images[0]?.imageMetadata?.imagePosition).map((n: any)=>Number(n))
            : String(images[0]?.imagePosition || images[0]?.imageMetadata?.imagePosition).split('\\').map(Number)
          )
        : null),
      // Pass CT series IOP as a stable fallback
      (images[0]?.imageOrientation || images[0]?.imageMetadata?.imageOrientation || null)
    );
    
    console.log(`✅ Fusion overlay rendered: CT=${ctSliceZ}mm, opacity=${fusionOpacity}, MRI slices=${transformedMRIPositions.current.length}`);
  };

  // Coordinate transformation functions for pen tool with CT transform applied
  // Using useCallback to ensure functions always use latest ctTransform value
  const worldToCanvas = useCallback((worldX: number, worldY: number): [number, number] => {
    if (!imageMetadata) return [0, 0];
    
    const [imagePositionX, imagePositionY] = imageMetadata.imagePosition.split("\\").map(parseFloat);
    const [rowSpacing, colSpacing] = imageMetadata.pixelSpacing.split("\\").map(parseFloat);
    
    // Convert world coordinates to raw pixel coordinates
    const pixelX = (worldX - imagePositionX) / colSpacing;
    const pixelY = (worldY - imagePositionY) / rowSpacing;
    
    // Apply CT transform to match the rendered canvas
    // Always get fresh ctTransform value to avoid stale closure
    const transform = ctTransform.current || { scale: 1, offsetX: 0, offsetY: 0 };
    const canvasX = (pixelX * transform.scale) + transform.offsetX;
    const canvasY = (pixelY * transform.scale) + transform.offsetY;
    
    return [canvasX, canvasY];
  }, [imageMetadata]); // Re-create when imageMetadata changes
  
  const canvasToWorld = useCallback((canvasX: number, canvasY: number): [number, number] => {
    if (!imageMetadata) return [0, 0];
    
    const [imagePositionX, imagePositionY] = imageMetadata.imagePosition.split("\\").map(parseFloat);
    const [rowSpacing, colSpacing] = imageMetadata.pixelSpacing.split("\\").map(parseFloat);
    
    // Apply inverse CT transform to get raw pixel coordinates
    // Always get fresh ctTransform value to avoid stale closure
    const transform = ctTransform.current || { scale: 1, offsetX: 0, offsetY: 0 };
    const pixelX = (canvasX - transform.offsetX) / transform.scale;
    const pixelY = (canvasY - transform.offsetY) / transform.scale;
    
    // Convert pixel coordinates to world coordinates
    const worldX = imagePositionX + (pixelX * colSpacing);
    const worldY = imagePositionY + (pixelY * rowSpacing);
    
    return [worldX, worldY];
  }, [imageMetadata]); // Re-create when imageMetadata changes

  const renderRTStructures = (
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    currentImage: any,
  ) => {
    if (!localRTStructures || !currentImage) return;

    // FIXED: Get current slice position from actual DICOM metadata with fallbacks
    let currentSlicePosition: number = currentIndex + 1; // Default fallback

    // Priority 1: Use parsed slice location from DICOM (check for null/undefined)
    if (
      currentImage.parsedSliceLocation !== undefined &&
      currentImage.parsedSliceLocation !== null
    ) {
      currentSlicePosition = currentImage.parsedSliceLocation;
    }
    // Priority 2: Use parsed Z position from DICOM (check for null/undefined)
    else if (
      currentImage.parsedZPosition !== undefined &&
      currentImage.parsedZPosition !== null
    ) {
      currentSlicePosition = currentImage.parsedZPosition;
    }
    // Priority 3: Extract from image metadata directly
    else if (currentImage.imageMetadata && currentImage.imageMetadata.sliceLocation !== undefined) {
      const parsed = parseFloat(currentImage.imageMetadata.sliceLocation);
      if (!isNaN(parsed)) {
        currentSlicePosition = parsed;
      }
    }
    // Priority 4: Extract Z from image position
    else if (currentImage.imageMetadata && currentImage.imageMetadata.imagePosition) {
      const imagePos = typeof currentImage.imageMetadata.imagePosition === 'string'
        ? currentImage.imageMetadata.imagePosition.split("\\")
        : currentImage.imageMetadata.imagePosition;
      if (imagePos && imagePos.length >= 3) {
        const parsed = parseFloat(imagePos[2]);
        if (!isNaN(parsed)) {
          currentSlicePosition = parsed;
        }
      }
    }

    // Note: currentSlicePosition already has a fallback initialization, no need for additional check

    // CRITICAL DEBUG: Log all slice position sources for comparison
    if (DEBUG) console.log(`🔍 SLICE POSITION DEBUG:
      parsedSliceLocation: ${currentImage.parsedSliceLocation}
      parsedZPosition: ${currentImage.parsedZPosition} 
      imageMetadata.sliceLocation: ${currentImage.imageMetadata?.sliceLocation || currentImage.sliceLocation}
      imageMetadata.imagePosition Z: ${currentImage.imageMetadata?.imagePosition 
        ? (typeof currentImage.imageMetadata.imagePosition === 'string' 
          ? currentImage.imageMetadata.imagePosition.split("\\")[2] 
          : currentImage.imageMetadata.imagePosition[2])
        : (currentImage.imagePosition 
          ? (typeof currentImage.imagePosition === 'string' 
            ? currentImage.imagePosition.split("\\")[2] 
            : currentImage.imagePosition[2])
          : "N/A")}
      currentIndex: ${currentIndex}
      FINAL currentSlicePosition: ${currentSlicePosition}mm`);
    if (DEBUG) console.log(
      `📋 Available structures:`,
      localRTStructures?.structures?.map((s: any) => s.structureName) || [],
    );

    // Get all RT structure Z positions to check coordinate space
    const allRTZPositions: number[] = [];
    if (localRTStructures?.structures) {
      localRTStructures.structures.forEach((structure: any) => {
        structure.contours.forEach((contour: any) => {
          allRTZPositions.push(contour.slicePosition);
        });
      });
    }

    if (allRTZPositions.length > 0) {
      const rtZMin = Math.min(...allRTZPositions);
      const rtZMax = Math.max(...allRTZPositions);
      if (DEBUG) console.log(
        `🎯 RT coordinate range: ${rtZMin.toFixed(1)} to ${rtZMax.toFixed(1)}mm`,
      );
      if (DEBUG) console.log(
        `🎯 Current CT slice ${currentSlicePosition}mm should show structures at RT positions near this value`,
      );
    }

    // Save context state
    ctx.save();

    // Apply global contour settings
    const lineWidth = contourSettings?.width || 3;
    const fillOpacity = (contourSettings?.opacity || 30) / 100;

    // Set line width
    ctx.lineWidth = lineWidth;
    // Keep stroke at full opacity - only fill should be affected by opacity setting
    ctx.globalAlpha = 1;

    if (localRTStructures?.structures) {
      localRTStructures.structures.forEach((structure: any) => {
      // Check if this structure is visible or if it's selected for editing/selection
      const isVisible = structureVisibility.get(structure.roiNumber);
      const isSelectedForEdit = selectedForEdit === structure.roiNumber;
      const isSelectedStructure = selectedStructures?.has(structure.roiNumber) || false;
      
      // Debug visibility map
      if (DEBUG) console.log(`🔍 Structure ${structure.structureName} (${structure.roiNumber}) visibility:`, {
        isVisible,
        visibilityMapHasKey: structureVisibility.has(structure.roiNumber),
        allStructuresVisible,
        willShow: isSelectedForEdit || isSelectedStructure || 
                 (allStructuresVisible ? isVisible !== false : isVisible === true)
      });

      if (DEBUG) {
        console.log(`Structure ${structure.structureName} (${structure.roiNumber}):`, {
          isVisible,
          isSelectedForEdit,
          isSelectedStructure,
          allStructuresVisible,
          selectedStructuresSet: selectedStructures ? Array.from(selectedStructures) : []
        });
      }

      // Priority 1: Always show if selected (checkbox) or being edited
      if (isSelectedForEdit || isSelectedStructure) {
        // Continue to render - these always show
      } else {
        // Priority 2: For non-selected structures, check visibility rules
        // If all structures are hidden, only show structures with explicit visibility true
        if (!allStructuresVisible && isVisible !== true) {
          return;
        }
        // If all structures visible, hide only those explicitly set to false
        if (allStructuresVisible && isVisible === false) {
          return;
        }
      }

      // Use the structure's actual color, not hardcoded yellow
      const color = structure.color || [255, 255, 0]; // fallback to yellow only if no color
      const [r, g, b] = color;
      ctx.strokeStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${fillOpacity})`;

      // Determine an effective slice tolerance based on metadata to prevent flicker
      const metaTol = (() => {
        const meta = currentImage?.imageMetadata;
        if (!meta) return SLICE_TOL_MM;
        const sbs = parseFloat(meta.spacingBetweenSlices ?? '');
        const sth = parseFloat(meta.sliceThickness ?? '');
        const zCand = Number.isFinite(sbs) ? sbs * 0.45 : (Number.isFinite(sth) ? sth * 0.45 : 0);
        return Math.max(SLICE_TOL_MM, zCand || 0);
      })();

      structure.contours.forEach((contour: any) => {
        // Debug: Log what contours are being considered for drawing
        const positionDiff = Math.abs(
          contour.slicePosition - currentSlicePosition,
        );
        if (positionDiff <= metaTol) {
          if (DEBUG) console.log(
            `✓ Drawing ${structure.structureName} contour at RT ${contour.slicePosition.toFixed(1)}mm (CT slice: ${currentSlicePosition.toFixed(1)}mm, diff: ${positionDiff.toFixed(1)}mm)`,
          );
          drawContour(ctx, contour, canvas.width, canvas.height, currentImage, animationTime);
        }
      });
    });
    }

    // Render preview contours with dashed yellow styling (FOR ALL SLICES - true 3D preview)
    if (previewContours && previewContours.length > 0) {
      let renderedPreviewCount = 0;
      
      // Set preview contour styling - bright yellow and dashed
      ctx.strokeStyle = '#FFFF00'; // Bright yellow
      ctx.fillStyle = 'rgba(255, 255, 0, 0.12)'; // Slightly lighter fill
      ctx.lineWidth = 1.25; // Thin dashed line per spec
      
      // Set dashed line pattern
      ctx.setLineDash([8, 4]); // 8px dash, 4px gap
      ctx.lineDashOffset = animationTime * 0.1; // Animated dashes
      
      previewContours.forEach((contour: any) => {
        // Check if this is the new format with slice position
        if (contour.slicePosition !== undefined) {
          const positionDiff = Math.abs(contour.slicePosition - currentSlicePosition);
          
          // Show preview only on the current slice to avoid layered jagged lines
          if (positionDiff <= SLICE_TOL_MM) {
            drawContour(ctx, { points: contour.points, isPreview: true }, canvas.width, canvas.height, currentImage, animationTime);
            renderedPreviewCount++;
            
            // Log when we're showing preview on current slice vs other slices
            if (positionDiff <= SLICE_TOL_MM) {
              console.log(`🔹 🎯 Showing preview on CURRENT slice ${currentSlicePosition.toFixed(1)} (diff: ${positionDiff.toFixed(1)}mm)`);
            }
          }
        } else {
          // Fallback for old format (array of points) - always show
          drawContour(ctx, { points: contour, isPreview: true }, canvas.width, canvas.height, currentImage, animationTime);
          renderedPreviewCount++;
        }
      });
      
      console.log(`🔹 🌐 Rendered ${renderedPreviewCount} preview contours for 3D visualization (current slice: ${currentSlicePosition.toFixed(1)})`);
      
      // Reset line dash for other elements
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
    }

    // Restore context state
    ctx.restore();
  };

  const drawContour = (
    ctx: CanvasRenderingContext2D,
    contour: any,
    canvasWidth: number,
    canvasHeight: number,
    currentImage: any,
    animationTime?: number,
  ) => {
    if (contour.points.length < 6) return; // Need at least 2 points (x,y,z each)

    ctx.beginPath();

    // Get image metadata from current image
    const imgMetadata = currentImage?.imageMetadata;
    if (!imgMetadata) {
      console.warn("No image metadata available for contour drawing");
      return;
    }
    
    // Debug logging disabled unless DEBUG is true
    if (DEBUG && contour.points.length >= 6) {
      console.log('Drawing contour with metadata:', {
        imagePosition: imgMetadata.imagePosition,
        pixelSpacing: imgMetadata.pixelSpacing,
        firstWorldPoint: [contour.points[0], contour.points[1], contour.points[2]],
        canvasSize: [canvasWidth, canvasHeight],
        zoom: zoom,
        pan: [panX, panY]
      });
    }

    // Parse DICOM metadata
    const imagePosition = imgMetadata.imagePosition
      ?.split("\\")
      .map(Number) || [-300, -300, 0];
    const pixelSpacing = imgMetadata.pixelSpacing
      ?.split("\\")
      .map(Number) || [1.171875, 1.171875];

    // Image dimensions
    const imageWidth = 512;
    const imageHeight = 512;

    // Calculate scale with zoom factor
    const baseScale = Math.min(canvasWidth / imageWidth, canvasHeight / imageHeight);
    // For a 512x512 image in 1024x1024 canvas, baseScale = 2
    
    // Apply zoom factor to base scale
    const totalScale = baseScale * zoom;
    const scaledWidth = imageWidth * totalScale;
    const scaledHeight = imageHeight * totalScale;
    
    // Center the image on canvas with pan offset (same as render16BitImage)
    const imageX = (canvasWidth - scaledWidth) / 2 + panX;
    const imageY = (canvasHeight - scaledHeight) / 2 + panY;

    // Set up animated dashed line for predicted contours
    if (contour.isPredicted && animationTime !== undefined) {
      const dashLength = 8;
      const gapLength = 6;
      const animationSpeed = 0.002; // Adjust for speed
      const offset = (animationTime * animationSpeed) % (dashLength + gapLength);
      ctx.setLineDash([dashLength, gapLength]);
      ctx.lineDashOffset = -offset;
    } else {
      // Solid line for confirmed contours
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
    }

    // Convert DICOM world coordinates to canvas coordinates
    for (let i = 0; i < contour.points.length; i += 3) {
      const worldX = contour.points[i]; // DICOM X coordinate
      const worldY = contour.points[i + 1]; // DICOM Y coordinate

      // Convert world coordinates to pixel coordinates
      // DICOM pixel spacing is [row spacing, column spacing] = [deltaY, deltaX]
      const pixelX = (worldX - imagePosition[0]) / pixelSpacing[1]; // column spacing
      const pixelY = (worldY - imagePosition[1]) / pixelSpacing[0]; // row spacing
      
      // Apply the same transformation as the image
      const canvasX = imageX + (pixelX * totalScale);
      const canvasY = imageY + (pixelY * totalScale);

      if (i === 0) {
        ctx.moveTo(canvasX, canvasY);
      } else {
        ctx.lineTo(canvasX, canvasY);
      }
    }

    // Close the contour
    ctx.closePath();

    // Fill only for confirmed contours; skip fill for previews
    // Also use reduced opacity for predictions
    if (contour.isPreview) {
      // No fill for preview to match thin dashed outline spec
    } else if (contour.isPredicted) {
      const originalAlpha = ctx.globalAlpha;
      ctx.globalAlpha = originalAlpha * 0.3; // Very subtle fill for predictions
      ctx.fill();
      ctx.globalAlpha = originalAlpha;
    } else {
      ctx.fill();
    }
    
    ctx.stroke();

    // Reset line dash for subsequent drawing operations
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
  };

  const loadDicomParser = (): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (window.dicomParser) {
        resolve();
        return;
      }

      const script = document.createElement("script");
      script.src =
        "https://unpkg.com/dicom-parser@1.8.21/dist/dicomParser.min.js";
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Failed to load dicom-parser"));
      document.head.appendChild(script);
    });
  };

  const goToPrevious = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    }
  };

  const goToNext = () => {
    // Get max slices based on orientation
    let maxSlices = images.length;
    if (orientation === 'sagittal' && images.length > 0) {
      // Sagittal slices = width of axial images
      maxSlices = images[0]?.columns || 512;
    } else if (orientation === 'coronal' && images.length > 0) {
      // Coronal slices = height of axial images
      maxSlices = images[0]?.rows || 512;
    }
    
    if (currentIndex < maxSlices - 1) {
      setCurrentIndex(currentIndex + 1);
    }
  };

  // MPR click handlers for navigation
  const handleSagittalClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (images.length === 0) return;
    
    const canvas = e.currentTarget as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Convert click position to slice index
    const canvasWidth = rect.width;
    const canvasHeight = rect.height;
    const volumeHeight = images[0]?.rows || 512;
    const volumeDepth = images.length;
    
    // Click Y position maps to axial Y coordinate
    const axialY = Math.floor((y / canvasHeight) * volumeHeight);
    // Click X position maps to axial Z index (slice)
    const axialZ = Math.floor((x / canvasWidth) * volumeDepth);
    
    // Update crosshair position
    setCrosshairPos(prev => ({ ...prev, y: axialY }));
    
    // Navigate to the clicked axial slice
    if (axialZ >= 0 && axialZ < images.length) {
      setCurrentIndex(axialZ);
    }
  };

  const handleCoronalClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (images.length === 0) return;
    
    const canvas = e.currentTarget as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Convert click position to slice index
    const canvasWidth = rect.width;
    const canvasHeight = rect.height;
    const volumeWidth = images[0]?.columns || 512;
    const volumeDepth = images.length;
    
    // Click X position maps to axial X coordinate
    const axialX = Math.floor((x / canvasWidth) * volumeWidth);
    // Click Y position maps to axial Z index (slice)
    const axialZ = Math.floor((y / canvasHeight) * volumeDepth);
    
    // Update crosshair position
    setCrosshairPos(prev => ({ ...prev, x: axialX }));
    
    // Navigate to the clicked axial slice
    if (axialZ >= 0 && axialZ < images.length) {
      setCurrentIndex(axialZ);
    }
  };

  // Notify parent when slice position changes
  useEffect(() => {
    if (images.length > 0 && images[currentIndex] && onSlicePositionChange) {
      const slicePosition =
        images[currentIndex].parsedSliceLocation ??
        images[currentIndex].parsedZPosition ??
        currentIndex;
      onSlicePositionChange(slicePosition);
    }
    
    // Clear preview contours when slice changes to prevent showing same preview on different slices
    setPreviewContours([]);
  }, [currentIndex, images, onSlicePositionChange]);
  
  // Set the displayCurrentImageRef to point to displayCurrentImage
  useEffect(() => {
    displayCurrentImageRef.current = displayCurrentImage;
  });

  // Watch for crosshair position changes and update MPR views
  useEffect(() => {
    if (orientation === 'axial' && images.length > 0 && sagittalCanvasRef.current && coronalCanvasRef.current) {
      // Update MPR views when crosshair position changes
      const updateMPRViews = async () => {
        try {
          setIsLoadingMPR(true);
          
          // Convert window/level props to width/center terminology used by renderMPRCanvas
          const windowWidth = props.windowLevel?.window || 350;
          const windowCenter = props.windowLevel?.level || 40;
          
          // Clamp crosshair position to valid range
          const sagittalSliceIndex = Math.max(0, Math.min(crosshairPos.x, (images[0]?.columns || 512) - 1));
          const coronalSliceIndex = Math.max(0, Math.min(crosshairPos.y, (images[0]?.rows || 512) - 1));
          
          // Render MPR views with current window/level settings
          await Promise.all([
            sagittalCanvasRef.current && renderMPRCanvas(sagittalCanvasRef.current, 'sagittal', sagittalSliceIndex, windowWidth, windowCenter),
            coronalCanvasRef.current && renderMPRCanvas(coronalCanvasRef.current, 'coronal', coronalSliceIndex, windowWidth, windowCenter)
          ].filter(Boolean));
        } catch (error) {
          console.error("Error updating MPR views:", error);
        } finally {
          setIsLoadingMPR(false);
        }
      };
      
      updateMPRViews();
    }
  }, [crosshairPos, orientation, images.length, props.windowLevel]);

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    // Check if any drawing tool or measurement tool is active - if so, skip pan functionality
    const isDrawingToolActive =
      (brushToolState?.isActive && 
       (brushToolState?.tool === "brush" || 
        brushToolState?.tool === "pen" || 
        brushToolState?.tool === "planar-contour")) ||
      isMeasurementToolActive;

    // Only prevent default and stop propagation if drawing/measurement tool is NOT active
    if (!isDrawingToolActive) {
      e.preventDefault();
      e.stopPropagation();
    }

    if (e.button === 0 && !isDrawingToolActive) {
      // Left click - crosshair mode or pan mode
      if (crosshairMode && canvasRef.current && images[currentIndex]) {
        // In crosshair mode, update crosshair position
        const rect = canvasRef.current.getBoundingClientRect();
        const canvasX = e.clientX - rect.left;
        const canvasY = e.clientY - rect.top;
        
        // Convert canvas coordinates to image pixel coordinates
        const canvasWidth = canvasRef.current.width;
        const canvasHeight = canvasRef.current.height;
        const imageWidth = images[currentIndex]?.columns || 512;
        const imageHeight = images[currentIndex]?.rows || 512;
        
        // Calculate scale with zoom factor (same as render16BitImage)
        const baseScale = Math.min(canvasWidth / imageWidth, canvasHeight / imageHeight);
        const totalScale = baseScale * zoom;
        const scaledWidth = imageWidth * totalScale;
        const scaledHeight = imageHeight * totalScale;
        
        // Center position with pan offset
        const imageX = (canvasWidth - scaledWidth) / 2 + panX;
        const imageY = (canvasHeight - scaledHeight) / 2 + panY;
        
        // Convert canvas coordinates to image pixel coordinates
        const pixelX = Math.floor((canvasX - imageX) / totalScale);
        const pixelY = Math.floor((canvasY - imageY) / totalScale);
        
        // Check if within image bounds
        if (pixelX >= 0 && pixelX < imageWidth && pixelY >= 0 && pixelY < imageHeight) {
          setCrosshairPos({ x: pixelX, y: pixelY });
          console.log(`Crosshair repositioned to: ${pixelX}, ${pixelY}`);
          scheduleRender(); // Re-render to show new crosshair position
        }
      } else {
        // Pan mode
        setIsDragging(true);
        setDragStart({ x: e.clientX, y: e.clientY });
        setLastPanX(panX);
        setLastPanY(panY);
      }
    } else if (e.button === 2 && !isDrawingToolActive) {
      // Right click for window/level (disabled during drawing mode)
      const startX = e.clientX;
      const startY = e.clientY;
      const startWindow = currentWindowLevel.width;
      const startCenter = currentWindowLevel.center;

      const handleWindowLevelDrag = (moveEvent: MouseEvent) => {
        moveEvent.preventDefault();
        const deltaX = moveEvent.clientX - startX;
        const deltaY = moveEvent.clientY - startY;

        const newWidth = Math.max(1, startWindow + deltaX * 2);
        const newCenter = startCenter - deltaY * 1.5;

        // Check if we're in fusion mode with MRI overlay
        if (secondarySeriesId && fusionOpacity > 0) {
          // Adjust MRI window/level when in fusion mode
          setMriWindowLevel({ width: newWidth, center: newCenter });
          console.log(`MRI Window/Level adjusted via drag: Center=${newCenter}, Width=${newWidth}`);
        } else {
          // Adjust CT window/level normally
          updateWindowLevel({ width: newWidth, center: newCenter });
        }
      };

      const handleWindowLevelEnd = (endEvent: MouseEvent) => {
        endEvent.preventDefault();
        document.removeEventListener("mousemove", handleWindowLevelDrag);
        document.removeEventListener("mouseup", handleWindowLevelEnd);
      };

      document.addEventListener("mousemove", handleWindowLevelDrag);
      document.addEventListener("mouseup", handleWindowLevelEnd);
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    // Skip pan functionality if any drawing tool or measurement tool is active
    const isDrawingToolActive =
      (brushToolState?.isActive && 
       (brushToolState?.tool === "brush" || 
        brushToolState?.tool === "pen" || 
        brushToolState?.tool === "planar-contour")) ||
      isMeasurementToolActive;

    // NOTE: Crosshair position is now only updated on click when in crosshair mode,
    // not on mouse move. This prevents the crosshair from following the mouse cursor.

    // Only handle pan if drawing/measurement tool is NOT active
    if (isDragging && !isDrawingToolActive) {
      const deltaX = e.clientX - dragStart.x;
      const deltaY = e.clientY - dragStart.y;
      setPanX(lastPanX + deltaX);
      setPanY(lastPanY + deltaY);
    }
  };

  const handleCanvasMouseUp = () => {
    // Skip pan functionality if any drawing tool or measurement tool is active
    const isDrawingToolActive =
      (brushToolState?.isActive && 
       (brushToolState?.tool === "brush" || 
        brushToolState?.tool === "pen" || 
        brushToolState?.tool === "planar-contour")) ||
      isMeasurementToolActive;

    if (!isDrawingToolActive) {
      setIsDragging(false);
    }
  };

  const handleCanvasWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    // Always handle wheel events
    e.preventDefault();
    e.stopPropagation();

    if (e.ctrlKey || e.metaKey) {
      // Ctrl+scroll for zoom
      const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
      setZoom((prev) => Math.max(0.1, Math.min(5, prev * zoomFactor)));
    } else {
      // Regular scroll for slice navigation
      if (e.deltaY > 0) {
        goToNext();
      } else {
        goToPrevious();
      }
    }
  };

  const handleZoomIn = () => {
    setZoom((prev) => Math.min(5, prev * 1.2));
  };

  const handleZoomOut = () => {
    setZoom((prev) => Math.max(0.1, prev / 1.2));
  };

  const handleResetZoom = () => {
    setZoom(1);
    setPanX(0);
    setPanY(0);
  };

  // Expose zoom functions to parent component via imperative handle
  useEffect(() => {
    // Always expose zoom functions for toolbar access
    (window as any).currentViewerZoom = {
      zoomIn: handleZoomIn,
      zoomOut: handleZoomOut,
      resetZoom: handleResetZoom,
    };

    return () => {
      delete (window as any).currentViewerZoom;
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") goToPrevious();
      if (e.key === "ArrowRight" || e.key === "ArrowDown") goToNext();
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [currentIndex, images]);

  // Animation loop for dashed borders on predicted contours
  useEffect(() => {
    let animationFrameId: number;
    
    const animate = (timestamp: number) => {
      setAnimationTime(timestamp);
      
      // Check if we need to keep animating (if there are predicted contours)
      const hasPredictedContours = rtStructures?.structures?.some((structure: any) =>
        structure.contours?.some((contour: any) => contour.isPredicted)
      );
      
      if (hasPredictedContours) {
        animationFrameId = requestAnimationFrame(animate);
      }
    };
    
    // Start animation if there are predicted contours
    const hasPredictedContours = rtStructures?.structures?.some((structure: any) =>
      structure.contours?.some((contour: any) => contour.isPredicted)
    );
    
    if (hasPredictedContours) {
      animationFrameId = requestAnimationFrame(animate);
    }
    
    return () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, [rtStructures]); // Re-run when RT structures change

  // Animation loop for animated dashed preview contours
  useEffect(() => {
    if (!previewContours || previewContours.length === 0) return;

    let rafId: number | null = null;
    const animate = (ts: number) => {
      setAnimationTime(ts);
      try { scheduleRender(); } catch {}
      rafId = requestAnimationFrame(animate);
    };

    rafId = requestAnimationFrame(animate);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [previewContours.length, scheduleRender]);

  // Test function to add a predicted contour for demonstration
  const addTestPredictedContour = () => {
    if (!rtStructures || !rtStructures.structures || testPredictionAdded) return;
    
    console.log("🎯 Adding test predicted contour to demonstrate animated dashed borders");
    
    // Find the TEST structure (roiNumber 943)
    const testStructure = rtStructures.structures.find((s: any) => s.roiNumber === 943);
    if (!testStructure) {
      console.log("TEST structure not found, skipping prediction demo");
      return;
    }
    
    // Create a simple circular predicted contour on a different slice
    const currentSlice = images.length > 0 && images[currentIndex] 
      ? (images[currentIndex].parsedSliceLocation || images[currentIndex].parsedZPosition || currentIndex)
      : -115;
    
    const predictedSlice = currentSlice + 3; // 3mm away
    
    // Create a circular contour in world coordinates
    const centerX = -50; // World coordinates
    const centerY = 50;
    const radius = 20;
    const points: number[] = [];
    
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * 2 * Math.PI;
      const x = centerX + radius * Math.cos(angle);
      const y = centerY + radius * Math.sin(angle);
      points.push(x, y, predictedSlice);
    }
    
    // Add the predicted contour
    const predictedContour = {
      slicePosition: predictedSlice,
      points: points,
      numberOfPoints: points.length / 3,
      isPredicted: true,
      predictionConfidence: 0.85
    };
    
    // Deep copy and add the predicted contour
    const updatedStructures = structuredClone ? structuredClone(rtStructures) : JSON.parse(JSON.stringify(rtStructures));
    const updatedTestStructure = updatedStructures.structures.find((s: any) => s.roiNumber === 943);
    if (updatedTestStructure) {
      updatedTestStructure.contours.push(predictedContour);
      setLocalRTStructures(updatedStructures);
      setTestPredictionAdded(true);
      
      console.log(`✅ Added predicted contour to slice ${predictedSlice} with animated dashed border`);
      console.log(`Navigate to slice ${predictedSlice} to see the animated prediction!`);
    }
  };

  // Add test predicted contour when RT structures are loaded
  useEffect(() => {
    if (rtStructures && !testPredictionAdded) {
      // Add a small delay to ensure everything is loaded
      setTimeout(() => {
        addTestPredictedContour();
      }, 1000);
    }
  }, [rtStructures, testPredictionAdded]);

  // Handle prediction confirmation - convert dashed predicted contours to solid confirmed contours
  const handlePredictionConfirm = (structureId: number, slicePosition: number) => {
    if (!rtStructures) return;
    
    if (DEBUG) console.log(`🔄 Confirming prediction for structure ${structureId} at slice ${slicePosition}`);
    
    // Deep copy the structures
    const updatedStructures = structuredClone ? structuredClone(rtStructures) : JSON.parse(JSON.stringify(rtStructures));
    
    // Find the structure and contour to confirm
    const structure = updatedStructures.structures.find((s: any) => s.roiNumber === structureId);
    if (!structure) {
      console.error(`Structure ${structureId} not found`);
      return;
    }
    
    const contour = structure.contours.find((c: any) => 
      c.isPredicted && Math.abs(c.slicePosition - slicePosition) <= 1.5
    );
    
    if (!contour) {
      console.error(`Predicted contour not found for structure ${structureId} at slice ${slicePosition}`);
      return;
    }
    
    // Convert predicted contour to confirmed contour
    contour.isPredicted = false;
    delete contour.predictionConfidence;
    
    console.log(`✅ Confirmed contour for structure ${structureId} - changed from dashed to solid border`);
    
    // Update local state
    setLocalRTStructures(updatedStructures);
    
    // Save to server
    saveContourUpdates(updatedStructures);
    
    // Notify parent component
    if (onContourUpdate) {
      onContourUpdate(updatedStructures);
    }
  };

  if (isLoading) {
    return (
      <Card className="h-full bg-black border-indigo-800 flex items-center justify-center">
        <div className="text-center">
          {/* Medical-themed loading animation */}
          <div className="relative w-24 h-24 mx-auto mb-4">
            {/* Outer ring with gradient */}
            <div className="absolute inset-0 rounded-full border-4 border-transparent bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500 bg-clip-border animate-spin"></div>
            
            {/* Inner ring rotating opposite direction */}
            <div className="absolute inset-2 rounded-full border-4 border-transparent bg-gradient-to-l from-cyan-500 via-blue-500 to-indigo-500 bg-clip-border animate-spin" style={{ animationDirection: 'reverse' }}></div>
            
            {/* Center pulse effect */}
            <div className="absolute inset-4 rounded-full bg-gradient-to-br from-blue-600 to-indigo-600 animate-pulse"></div>
            
            {/* Medical cross icon in center */}
            <div className="absolute inset-0 flex items-center justify-center">
              <svg className="w-8 h-8 text-white z-10" fill="currentColor" viewBox="0 0 24 24">
                <path d="M9 3V21H15V3H9ZM3 9V15H21V9H3Z" />
              </svg>
            </div>
          </div>
          
          <p className="text-white text-lg font-medium mb-2">Loading medical images...</p>
          <p className="text-indigo-300 text-sm">Preparing visualization</p>
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="h-full bg-black border-indigo-800 flex items-center justify-center">
        <div className="text-center text-red-400">
          <p className="mb-2">Error loading CT scan:</p>
          <p className="text-sm">{error}</p>
          <Button
            onClick={loadImages}
            className="mt-4 bg-indigo-600 hover:bg-indigo-700"
          >
            Retry
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="h-full bg-black border-indigo-800">
      {/* Header with modern toolbar styling to match contour editing toolbar */}
      <div className="p-3 border-b border-gray-700/50">
        <div 
          className="backdrop-blur-md border rounded-xl px-4 py-3 shadow-lg flex items-center justify-between"
          style={{ 
            backgroundColor: '#1a1a1a95',
            borderColor: '#4a5568'
          }}
        >
          <div className="flex items-center space-x-2">
            <Badge className="bg-blue-900/60 text-blue-200 border border-blue-600/30 backdrop-blur-sm">
              CT Scan {orientation !== 'axial' && `- ${orientation.charAt(0).toUpperCase() + orientation.slice(1)}`}
            </Badge>
            {images.length > 0 && (
              <>
                <Badge
                  variant="outline"
                  className="border-gray-500/50 text-gray-300 bg-gray-800/40 backdrop-blur-sm"
                >
                  {currentIndex + 1} / {(() => {
                    let maxSlices = images.length;
                    if (orientation === 'sagittal' && images.length > 0) {
                      maxSlices = images[0]?.columns || 512;
                    } else if (orientation === 'coronal' && images.length > 0) {
                      maxSlices = images[0]?.rows || 512;
                    }
                    return maxSlices;
                  })()}
                </Badge>
                
                {/* Window/Level/Z position pills */}
                <Badge className="bg-cyan-900/40 text-cyan-200 border border-cyan-600/30 backdrop-blur-sm">
                  W: {Math.round(currentWindowLevel.width)}
                </Badge>
                <Badge className="bg-orange-900/40 text-orange-200 border border-orange-600/30 backdrop-blur-sm">
                  L: {Math.round(currentWindowLevel.center)}
                </Badge>
                {images[currentIndex] && orientation === 'axial' && (
                  <Badge className="bg-purple-900/40 text-purple-200 border border-purple-600/30 backdrop-blur-sm">
                    Z: {images[currentIndex].parsedSliceLocation?.toFixed(1) ||
                        images[currentIndex].parsedZPosition?.toFixed(1) ||
                        (currentIndex + 1)}
                  </Badge>
                )}
              </>
            )}
            {secondarySeriesId && secondaryImages.length > 0 && (
              <Badge className={`flex items-center gap-1 border backdrop-blur-sm ${
                secondaryModality === 'PT' 
                  ? 'bg-yellow-900/40 text-yellow-200 border-yellow-600/30' 
                  : 'bg-purple-900/40 text-purple-200 border-purple-600/30'
              }`}>
                <div className={`w-2 h-2 rounded-full animate-pulse ${
                  secondaryModality === 'PT' 
                    ? 'bg-yellow-400' 
                    : 'bg-purple-400'
                }`} />
                {secondaryModality === 'PT' ? 'PT' : 'MR'} Fusion
                <span className={secondaryModality === 'PT' ? 'text-yellow-300' : 'text-purple-300'}>
                  ({Math.round(fusionOpacity * 100)}%)
                </span>
              </Badge>
            )}
          </div>

          <div className="flex items-center space-x-2">
            {rtStructures && (
              <div className="flex items-center gap-1 px-2 py-1 bg-gray-800/50 rounded-lg">
                <Badge 
                  variant={showStructures ? "default" : "secondary"}
                  className={`${
                    showStructures 
                      ? 'bg-green-600/80 text-white border-green-500/50' 
                      : 'bg-gray-700/50 text-gray-300'
                  }`}
                >
                  RT ({rtStructures?.structures?.length || 0})
                </Badge>
                <span className="text-xs text-gray-400">
                  {showStructures ? 'Visible' : 'Hidden'}
                </span>
              </div>
            )}
            
            {/* Background Loading Progress */}
            {prefetchProgress.total > 0 && prefetchProgress.loaded > 0 && prefetchProgress.loaded < prefetchProgress.total && !isLoading && (
              <div className="flex items-center space-x-2 px-3 py-1.5 bg-gray-800/50 rounded-lg">
                <div className="w-24 bg-gray-700 rounded-full h-1.5 overflow-hidden">
                  <div 
                    className="bg-gradient-to-r from-green-500 to-green-400 h-1.5 rounded-full transition-all duration-300 ease-out"
                    style={{ width: `${(prefetchProgress.loaded / prefetchProgress.total) * 100}%` }}
                  />
                </div>
                <span className="text-xs text-gray-300">
                  {Math.round((prefetchProgress.loaded / prefetchProgress.total) * 100)}% ({prefetchProgress.loaded}/{prefetchProgress.total})
                </span>
              </div>
            )}
            
            <Button
              size="sm"
              variant={isMeasurementToolActive ? "default" : "ghost"}
              onClick={() => {
                setIsMeasurementToolActive(!isMeasurementToolActive);
                if (brushToolState?.isActive) {
                  // Disable brush/pen tools when measurement is active
                  if (onBrushToolChange) {
                    onBrushToolChange({
                      ...brushToolState,
                      isActive: false
                    });
                  }
                }
              }}
              className={`h-8 px-3 transition-all duration-200 rounded-lg text-gray-300 ${
                isMeasurementToolActive 
                  ? 'bg-blue-600/80 hover:bg-blue-700/80 text-white border border-blue-500/50 shadow-sm backdrop-blur-sm' 
                  : 'hover:bg-gray-700/50 hover:text-white'
              }`}
              title="Measurement Tool"
            >
              <Ruler className="w-4 h-4" />
            </Button>
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
              disabled={currentIndex === (() => {
                let maxSlices = images.length;
                if (orientation === 'sagittal' && images.length > 0) {
                  maxSlices = images[0]?.columns || 512;
                } else if (orientation === 'coronal' && images.length > 0) {
                  maxSlices = images[0]?.rows || 512;
                }
                return maxSlices - 1;
              })()}
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
          <canvas
            ref={canvasRef}
            width={1280}
            height={1280}
            onMouseDown={handleCanvasMouseDown}
            onMouseMove={(e) => {
              handleCanvasMouseMove(e);
              // Crosshair position is only updated on click in crosshair mode
              // Not on mouse move
            }}
            onMouseUp={handleCanvasMouseUp}
            onWheel={(e) => {
              // Always handle wheel events for scrolling, even when pen tool is active
              handleCanvasWheel(e);
            }}
            onContextMenu={(e) => e.preventDefault()}
            className={`max-w-full max-h-full object-contain rounded ${
              brushToolState?.isActive && brushToolState?.tool === "brush"
                ? ""
                : brushToolState?.isActive && (brushToolState?.tool === "pen" || brushToolState?.tool === "pen-original")
                ? ""
                : "cursor-move"
            }`}
            style={{
              backgroundColor: "black",
              imageRendering: "auto",
              userSelect: "none",
            }}
          />

          {/* Simple Brush Tool overlay */}
          {brushToolState?.isActive &&
            brushToolState?.tool === "brush" && (
              <SimpleBrushTool
                canvasRef={canvasRef}
                isActive={brushToolState.isActive}
                brushSize={brushToolState.brushSize}
                selectedStructure={selectedForEdit}
                rtStructures={rtStructures}
                currentSlicePosition={
                  images.length > 0 && images[currentIndex]
                    ? (images[currentIndex].parsedSliceLocation ??
                      images[currentIndex].parsedZPosition ??
                      currentIndex)
                    : 0
                }
                onContourUpdate={(payload: any) => {
                  // Handle different types of contour updates
                  if (payload.action === "grow_contour") {
                    handleGrowContour(payload);
                  } else {
                    handleContourUpdate(payload);
                  }
                }}
                zoom={zoom}
                panX={panX}
                panY={panY}
                imageMetadata={imageMetadata}
                smoothingEnabled={true}
                enableSmartMode={true}
                predictionEnabled={brushToolState?.predictionEnabled || false}
                smartBrushEnabled={brushToolState?.smartBrushEnabled || false}
                ctTransform={ctTransform}
                dicomImage={images.length > 0 && images[currentIndex] ? images[currentIndex] : null}
                onBrushModeChange={(mode: BrushOperation) => {
                  console.log("Brush mode changed:", mode);
                }}
                onBrushSizeChange={(newSize: number) => {
                  if (onBrushToolChange) {
                    onBrushToolChange({
                      ...brushToolState,
                      brushSize: newSize
                    });
                  }
                }}
                onPreviewUpdate={(contours: any[] | null) => {
                  setPreviewContours(contours || []);
                }}
              />
            )}

          {/* Erase Tool overlay - works like brush but erases */}
          {brushToolState?.isActive &&
            brushToolState?.tool === "erase" && (
              <SimpleBrushTool
                canvasRef={canvasRef}
                isActive={brushToolState.isActive}
                brushSize={brushToolState.brushSize}
                selectedStructure={selectedForEdit}
                rtStructures={rtStructures}
                currentSlicePosition={
                  images.length > 0 && images[currentIndex]
                    ? (images[currentIndex].parsedSliceLocation ??
                      images[currentIndex].parsedZPosition ??
                      currentIndex)
                    : 0
                }
                onContourUpdate={(payload: any) => {
                  // Handle different types of contour updates
                  if (payload.action === "grow_contour") {
                    handleGrowContour(payload);
                  } else {
                    handleContourUpdate(payload);
                  }
                }}
                zoom={zoom}
                panX={panX}
                panY={panY}
                imageMetadata={imageMetadata}
                smoothingEnabled={true}
                enableSmartMode={true}
                predictionEnabled={false} // No prediction for erase tool
                smartBrushEnabled={false} // No smart mode for erase tool
                ctTransform={ctTransform}
                dicomImage={images.length > 0 && images[currentIndex] ? images[currentIndex] : null}
                isEraseMode={true} // Pass erase mode flag
                onBrushModeChange={(mode: BrushOperation) => {
                  console.log("Erase mode changed:", mode);
                }}
                onBrushSizeChange={(newSize: number) => {
                  if (onBrushToolChange) {
                    onBrushToolChange({
                      ...brushToolState,
                      brushSize: newSize
                    });
                  }
                }}
                onPreviewUpdate={(contours: any[] | null) => {
                  setPreviewContours(contours || []);
                }}
              />
            )}

          {/* Eclipse Pen Tool V2 - Clean implementation with proper boolean operations */}
          {brushToolState?.isActive &&
            brushToolState?.tool === "pen" &&
            selectedForEdit && (
              <PenToolV2
                isActive={brushToolState.isActive}
                selectedStructure={selectedForEdit}
                rtStructures={rtStructures}
                currentSlicePosition={
                  images.length > 0 && images[currentIndex]
                    ? (images[currentIndex].parsedSliceLocation ??
                      images[currentIndex].parsedZPosition ??
                      currentIndex)
                    : 0
                }
                imageMetadata={imageMetadata}
                onContourUpdate={(payload: any) => {
                  handleContourUpdate(payload);
                }}
                canvasRef={canvasRef}
                ctTransform={ctTransform}
              />
            )}

          {/* Eclipse Planar Contour Tool - Using PenToolUnifiedV2 */}
          {brushToolState?.isActive &&
            brushToolState?.tool === "planar-contour" &&
            selectedForEdit && (
              <PenToolUnifiedV2
                canvasRef={canvasRef}
                isActive={brushToolState.isActive}
                selectedStructure={selectedForEdit}
                rtStructures={rtStructures}
                onContourUpdate={(payload: any) => {
                  handleContourUpdate(payload);
                }}
                imageMetadata={imageMetadata}
                worldToCanvas={worldToCanvas}
                canvasToWorld={canvasToWorld}
              />
            )}

          {/* Original Pen Tool overlay */}
          {brushToolState?.isActive &&
            brushToolState?.tool === "pen-original" &&
            selectedForEdit && (
              <PenTool
                canvasRef={canvasRef}
                isActive={brushToolState.isActive}
                selectedStructure={selectedForEdit}
                rtStructures={rtStructures}
                currentSlicePosition={
                  images.length > 0 && images[currentIndex]
                    ? (images[currentIndex].parsedSliceLocation ??
                      images[currentIndex].parsedZPosition ??
                      currentIndex)
                    : 0
                }
                onContourUpdate={(payload: any) => {
                  handleContourUpdate(payload);
                }}
                zoom={zoom}
                panX={panX}
                panY={panY}
                imageMetadata={imageMetadata}
              />
            )}
            
          {/* Measurement Tool overlay */}
          {isMeasurementToolActive && (
            <MeasurementTool
              canvasRef={canvasRef}
              isActive={isMeasurementToolActive}
              imageMetadata={imageMetadata}
              ctTransform={ctTransform.current ? {
                current: {
                  scale: ctTransform.current.scale,
                  offsetX: ctTransform.current.offsetX,
                  offsetY: ctTransform.current.offsetY
                }
              } as React.MutableRefObject<{ scale: number; offsetX: number; offsetY: number }> : null}
              currentSlicePosition={
                images.length > 0 && images[currentIndex]
                  ? (images[currentIndex].parsedSliceLocation ??
                    images[currentIndex].parsedZPosition ??
                    currentIndex)
                  : 0
              }
              onMeasurementComplete={(distance, unit) => {
                console.log(`Measurement completed: ${distance.toFixed(1)} ${unit}`);
              }}
            />
          )}



          {/* RT Structure Overlay removed - structures are rendered in displayCurrentImage */}

          {/* Removed overlaid text - now in titlebar */}
          
          {/* Fusion Control Panel - Visible when study has secondary series available for fusion */}
          {studyId && props.hasSecondarySeriesForFusion && registrationMatrix && props.onSecondarySeriesSelect && props.onFusionOpacityChange && (
            <FusionControlPanel
              primarySeriesId={seriesId}
              studyId={studyId}
              onSecondarySeriesSelect={(id) => props.onSecondarySeriesSelect!(id ? id : null)}
              opacity={fusionOpacity}
              onOpacityChange={props.onFusionOpacityChange}
              isVisible={true}
              mriWindowLevel={mriWindowLevel}
              onMriWindowLevelChange={setMriWindowLevel}
              selectedSecondaryId={typeof secondarySeriesId === 'number' ? secondarySeriesId : null}
            />
          )}
          
          {/* Floating MPR windows for sagittal and coronal views */}
          {orientation === 'axial' && images.length > 0 && mprVisible && (
            <div className="absolute right-4 top-16 flex flex-col gap-3">
              {/* Sagittal view */}
              <div className="mpr-window">
                <div className="mpr-window-header flex justify-between items-center">
                  <span>Sagittal</span>
                </div>
                <div className="mpr-canvas-container">
                  <MPRFloating
                    images={images}
                    orientation="sagittal"
                    sliceIndex={Math.max(0, Math.min(crosshairPos.x, (images[0]?.columns || 512) - 1))}
                    windowWidth={currentWindowLevel.width}
                    windowCenter={currentWindowLevel.center}
                    crosshairPos={crosshairPos}
                    rtStructures={rtStructures}
                    currentZIndex={currentIndex}
                    onClick={handleSagittalClick}
                  />
                  {isLoadingMPR && (
                    <div className="mpr-loading">
                      <div className="mpr-loading-spinner" />
                    </div>
                  )}
                </div>
              </div>
              
              {/* Coronal view */}
              <div className="mpr-window">
                <div className="mpr-window-header flex justify-between items-center">
                  <span>Coronal</span>
                </div>
                <div className="mpr-canvas-container">
                  <MPRFloating
                    images={images}
                    orientation="coronal"
                    sliceIndex={Math.max(0, Math.min(crosshairPos.y, (images[0]?.rows || 512) - 1))}
                    windowWidth={currentWindowLevel.width}
                    windowCenter={currentWindowLevel.center}
                    crosshairPos={crosshairPos}
                    rtStructures={rtStructures}
                    currentZIndex={currentIndex}
                    onClick={handleCoronalClick}
                  />
                  {isLoadingMPR && (
                    <div className="mpr-loading">
                      <div className="mpr-loading-spinner" />
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
});

WorkingViewer.displayName = 'WorkingViewer';

export { WorkingViewer };

declare global {
  interface Window {
    dicomParser: any;
    workingViewerZoomIn?: () => void;
    workingViewerZoomOut?: () => void;
    workingViewerResetZoom?: () => void;
  }
}
