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
import { RTStructureOverlay } from "./rt-structure-overlay";
import { FusionControlPanel } from "./fusion-control-panel";
import { MeasurementTool } from "./measurement-tool";
import { BrushOperation } from "@shared/schema";
import { growContour, smoothContour } from "@/lib/contour-grow";
import {
  addBrushToContour,
  eraseBrushFromContour,
  mergeBrushWithContour,
  brushStrokeToPolishedPolygon,
} from "@/lib/brush-to-polygon";
import { applyDirectionalGrow } from "@/lib/contour-directional-grow";
import { naiveCombineContours as combineContours, naiveSubtractContours as subtractContours } from "@/lib/contour-boolean-operations";
import { predictNextSliceContour } from "@/lib/contour-prediction";
import { computeTransformedMRIPositions, renderFusionOverlay } from "@/lib/fusion-utils";
import { performPolygonUnion, polygonUnion } from "@/lib/polygon-union";
import { undoRedoManager } from "@/lib/undo-system";
import { 
  isGPUAccelerationAvailable,
  initializeCornerstone3D,
  render16BitImageGPU
} from "@/lib/cornerstone3d-adapter";
import { createOrUpdateGPUViewport, hideGPUViewport, cleanupGPUViewports } from "@/lib/gpu-viewport-manager";
import { getDicomWorkerManager, destroyDicomWorkerManager } from '@/lib/dicom-worker-manager';

// Helper function to check if two polygons intersect
function doPolygonsIntersect(polygon1: number[], polygon2: number[]): boolean {
  // Convert flat arrays to points
  const points1: [number, number][] = [];
  const points2: [number, number][] = [];
  
  for (let i = 0; i < polygon1.length; i += 3) {
    points1.push([polygon1[i], polygon1[i + 1]]);
  }
  
  for (let i = 0; i < polygon2.length; i += 3) {
    points2.push([polygon2[i], polygon2[i + 1]]);
  }
  
  // Check if any point from polygon1 is inside polygon2 or vice versa
  for (const point of points1) {
    if (isPointInPolygon(point, points2)) {
      return true;
    }
  }
  
  for (const point of points2) {
    if (isPointInPolygon(point, points1)) {
      return true;
    }
  }
  
  // Check if any edges intersect
  for (let i = 0; i < points1.length; i++) {
    const a1 = points1[i];
    const a2 = points1[(i + 1) % points1.length];
    
    for (let j = 0; j < points2.length; j++) {
      const b1 = points2[j];
      const b2 = points2[(j + 1) % points2.length];
      
      if (doSegmentsIntersect(a1, a2, b1, b2)) {
        return true;
      }
    }
  }
  
  return false;
}

// Helper function to check if a point is inside a polygon
function isPointInPolygon(point: [number, number], polygon: [number, number][]): boolean {
  let inside = false;
  const [x, y] = point;
  
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  
  return inside;
}

// Helper function to check if two line segments intersect
function doSegmentsIntersect(a1: [number, number], a2: [number, number], b1: [number, number], b2: [number, number]): boolean {
  const ccw = (A: [number, number], B: [number, number], C: [number, number]) => {
    return (C[1] - A[1]) * (B[0] - A[0]) > (B[1] - A[1]) * (C[0] - A[0]);
  };
  
  return ccw(a1, b1, b2) !== ccw(a2, b1, b2) && ccw(a1, a2, b1) !== ccw(a1, a2, b2);
}

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
  };
  selectedForEdit?: number | null;
  onBrushSizeChange?: (size: number) => void;
  onBrushToolChange?: (state: {
    tool: string | null;
    brushSize: number;
    isActive: boolean;
    predictionEnabled?: boolean;
  }) => void;
  onContourUpdate?: (updatedStructures: any) => void;
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
    onBrushSizeChange,
    onBrushToolChange,
    onContourUpdate,
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
  const [images, setImages] = useState<any[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Use external RT structures if provided, otherwise load our own
  const [localRTStructures, setLocalRTStructures] =
    useState(externalRTStructures);
  const rtStructures = localRTStructures || externalRTStructures;
  const structureVisibility = externalStructureVisibility || new Map();
  const [showStructures, setShowStructures] = useState(true);
  
  // Sync showStructures with allStructuresVisible prop
  useEffect(() => {
    setShowStructures(allStructuresVisible);
  }, [allStructuresVisible]);
  const [renderTrigger, setRenderTrigger] = useState(0);
  const [animationTime, setAnimationTime] = useState(0);
  const [predictedContours, setPredictedContours] = useState<Map<string, any>>(new Map());
  const [testPredictionAdded, setTestPredictionAdded] = useState(false);
  const [fusionAvailable, setFusionAvailable] = useState(true);
  const [imageMetadata, setImageMetadata] = useState<any>(null);
  
  // GPU acceleration state for hybrid rendering
  const [isGPUMode, setIsGPUMode] = useState(false);
  const [gpuCheckComplete, setGpuCheckComplete] = useState(false);
  const [cornerstone3DInitialized, setCornerstone3DInitialized] = useState(false);
  const [prefetchProgress, setPrefetchProgress] = useState({ loaded: 0, total: 0 });

  // Initialize Cornerstone3D when GPU is available
  useEffect(() => {
    if (gpuCheckComplete && isGPUMode && !cornerstone3DInitialized) {
      console.log('Initializing Cornerstone3D for GPU-accelerated rendering...');
      initializeCornerstone3D().then((success) => {
        if (success) {
          console.log('✅ Cornerstone3D initialized successfully');
          setCornerstone3DInitialized(true);
        } else {
          console.log('❌ Failed to initialize Cornerstone3D, falling back to Cornerstone Core');
          setIsGPUMode(false);
        }
      });
    }
  }, [gpuCheckComplete, isGPUMode, cornerstone3DInitialized]);

  // Update local structures when external ones change
  useEffect(() => {
    // Only update if actually changed to prevent unnecessary re-renders
    console.log("RT Structures update - external:", externalRTStructures);
    if (externalRTStructures && externalRTStructures !== localRTStructures) {
      console.log("Setting local RT structures:", externalRTStructures);
      setLocalRTStructures(externalRTStructures);
    }
  }, [externalRTStructures]);

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
  const [isPreloading, setIsPreloading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isMeasurementToolActive, setIsMeasurementToolActive] = useState(false);
  
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
  
  // Render scheduling to prevent redundant renders
  const needsRenderRef = useRef(false);
  const displayCurrentImageRef = useRef<() => Promise<void>>();
  const prefetchCompleteRef = useRef(false);
  
  const scheduleRender = useCallback(() => {
    if (needsRenderRef.current) return;
    needsRenderRef.current = true;
    requestAnimationFrame(async () => {
      needsRenderRef.current = false;
      if (displayCurrentImageRef.current) {
        await displayCurrentImageRef.current();
      }
    });
  }, []);
  
  // Abort controller for series changes
  const seriesAbortRef = useRef<AbortController | null>(null);



  // Save contour updates to server
  const saveContourUpdates = async (updatedStructures: any, action?: string) => {
    if (!seriesId || isSaving) return;
    
    setIsSaving(true);
    try {
      const response = await fetch(`/api/rt-structures/${seriesId}/contours`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          structures: updatedStructures.structures,
          action: action || 'update_contours'
        })
      });

      if (!response.ok) {
        console.error('Failed to save contour updates');
      } else {
        console.log('Contour updates saved successfully');
      }
    } catch (error) {
      console.error('Error saving contour updates:', error);
    } finally {
      setIsSaving(false);
    }
  };

  // Handle boolean operations (combine/subtract) between structures
  const handleBooleanOperation = async (payload: any) => {
    if (!rtStructures) {
      console.error("RT structures not available for boolean operation");
      return;
    }

    const { operation, sourceStructureId, targetStructureId, slicePosition } = payload;
    console.log(
      `Performing ${operation} operation between structures ${sourceStructureId} and ${targetStructureId} at slice ${slicePosition}`,
    );

    // Create a deep copy of RT structures to avoid mutation
    const updatedRTStructures = JSON.parse(JSON.stringify(rtStructures));

    // Find the source and target structures
    const sourceStructure = updatedRTStructures.structures?.find(
      (s: any) => s.roiNumber === sourceStructureId,
    );
    const targetStructure = updatedRTStructures.structures?.find(
      (s: any) => s.roiNumber === targetStructureId,
    );

    if (!sourceStructure || !targetStructure) {
      console.error("Source or target structure not found");
      return;
    }

    // Find contours on the specified slice for both structures
    const sourceContour = sourceStructure.contours?.find(
      (c: any) => Math.abs(c.slicePosition - slicePosition) < 0.5,
    );
    const targetContour = targetStructure.contours?.find(
      (c: any) => Math.abs(c.slicePosition - slicePosition) < 0.5,
    );

    if (!sourceContour || !sourceContour.points || sourceContour.points.length < 9) {
      console.warn(`No source contour found on slice ${slicePosition}`);
      return;
    }

    if (!targetContour || !targetContour.points || targetContour.points.length < 9) {
      console.warn(`No target contour found on slice ${slicePosition}`);
      return;
    }

    try {
      let resultPoints: number[];

      if (operation === 'combine') {
        // Combine the two contours
        resultPoints = await combineContours(sourceContour.points, targetContour.points);
      } else if (operation === 'subtract') {
        // Subtract target from source
        resultPoints = await subtractContours(sourceContour.points, targetContour.points);
      } else {
        console.error(`Unknown boolean operation: ${operation}`);
        return;
      }

      if (resultPoints.length >= 9) {
        // Update the source contour with the result
        sourceContour.points = resultPoints;
        sourceContour.numberOfPoints = resultPoints.length / 3;

        // Update local structures and save to server
        setLocalRTStructures(updatedRTStructures);
        saveContourUpdates(updatedRTStructures, 'boolean_operation');
        
        // Pass the updated structures up to parent component
        if (onContourUpdate) {
          onContourUpdate(updatedRTStructures);
        }

        console.log(`Successfully performed ${operation} operation`);
      } else {
        console.warn("Boolean operation resulted in invalid contour");
      }
    } catch (error) {
      console.error(`Error performing ${operation} operation:`, error);
    }
  };

  // Handle Eclipse TPS margin operation
  const handleMarginOperation = (payload: any) => {
    if (!rtStructures) {
      console.error("RT structures not available for margin operation");
      return;
    }

    const { structureId, slicePosition, marginParams } = payload;
    console.log(
      `Applying ${marginParams.marginType} margin operation to structure ${structureId} at slice ${slicePosition}`,
    );

    // Create a deep copy of RT structures to avoid mutation
    const updatedRTStructures = JSON.parse(JSON.stringify(rtStructures));

    // Find the target structure
    const structure = updatedRTStructures.structures?.find(
      (s: any) => s.roiNumber === structureId,
    );

    if (!structure) {
      console.error(`Structure ${structureId} not found`);
      return;
    }

    // Find contour on current slice
    const tolerance = 1.5;
    const contour = structure.contours.find(
      (c: any) => Math.abs(c.slicePosition - slicePosition) <= tolerance,
    );

    if (!contour || !contour.points || contour.points.length === 0) {
      console.warn(
        `No contour found for structure ${structureId} at slice ${slicePosition}`,
      );
      return;
    }

    try {
      // Convert margin values from mm to pixels using pixel spacing
      const pixelSpacing = imageMetadata?.pixelSpacing?.[0] || 1.171875; // Default from HN-ATLAS
      
      // Apply margin based on type
      let marginValueMm = marginParams.marginValues.uniform;
      
      if (marginParams.marginType === 'ASYMMETRIC') {
        // For asymmetric margins, we'll use a weighted average for now
        // In a full implementation, this would consider anatomical directions
        const values = marginParams.marginValues;
        marginValueMm = (values.anterior + values.posterior + values.left + values.right) / 4;
      }
      
      const marginValuePixels = marginValueMm / pixelSpacing;
      
      // Use the grow contour function with the margin value
      const grownContour = growContour(
        {
          points: contour.points,
          slicePosition: slicePosition,
        },
        marginValueMm, // growContour expects mm
      );
      
      // Apply smoothing based on interpolation type
      let smoothingFactor = 0.15;
      if (marginParams.interpolationType === 'SMOOTH') {
        smoothingFactor = 0.25;
      } else if (marginParams.interpolationType === 'DISCRETE') {
        smoothingFactor = 0.05;
      }
      
      const smoothedContour = smoothContour(grownContour, smoothingFactor);
      
      // Update the contour with margin-expanded points
      contour.points = smoothedContour.points;
      contour.numberOfPoints = smoothedContour.points.length / 3;

      // Update local structures and save to server
      setLocalRTStructures(updatedRTStructures);
      saveContourUpdates(updatedRTStructures, 'apply_margin');
      
      // Pass the updated structures up to parent component
      if (onContourUpdate) {
        onContourUpdate(updatedRTStructures);
      }

      console.log(
        `Successfully applied ${marginParams.marginType} margin of ${marginValueMm}mm to structure ${structureId}`,
      );
    } catch (error) {
      console.error("Error applying margin operation:", error);
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
    console.log(
      `${isGrowing ? 'Growing' : 'Shrinking'} contour for structure ${structureId} by ${Math.abs(distance)}mm ${direction !== 'all' ? `in ${direction} direction` : 'in all directions'} at slice ${slicePosition}`,
    );

    // Create a deep copy of RT structures to avoid mutation
    const updatedRTStructures = JSON.parse(JSON.stringify(localRTStructures));

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
      (c: any) => Math.abs(c.slicePosition - slicePosition) < 0.5,
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
        // Use existing radial grow/shrink algorithm
        const grownContour = growContour(
          {
            points: contour.points,
            slicePosition: slicePosition,
          },
          distance,
        );
        
        // Apply smoothing for medical-grade quality
        const smoothedContour = smoothContour(grownContour, 0.15);
        updatedPoints = smoothedContour.points;
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
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [lastPanX, setLastPanX] = useState(0);
  const [lastPanY, setLastPanY] = useState(0);

  // Handle contour updates from brush tool and other contour editing operations
  const handleContourUpdate = async (payload: any) => {
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
    console.log("Handling contour update:", payload);

    if (!rtStructures || !rtStructures.structures) {
      console.error("No RT structures available");
      return;
    }

    // Handle refresh action for undo/redo
    if (payload.action === "refresh") {
      console.log("Refreshing RT structures after undo/redo");
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
    const updatedStructures = JSON.parse(JSON.stringify(rtStructures));

    if (payload.action === "brush_stroke") {
      // Handle brush stroke - add points to contour
      const structure = updatedStructures.structures.find(
        (s: any) => s.roiNumber === payload.structureId,
      );
      if (!structure) {
        console.error(`Structure ${payload.structureId} not found`);
        return;
      }

      // Convert brush stroke to polished polygon for smooth edges
      let brushPolygon: number[];
      
      // CRITICAL FIX: The brush size should NOT be converted to world coordinates here
      // The brush size is already in screen pixels and should remain that way
      // The polygon creation function will handle coordinate transformation internally
      
      console.log(`Brush size: ${payload.brushSize}px (keeping in pixel units)`);
      console.log(`Sample brush point coordinates:`, payload.points.slice(0, 3));
      
      // TEMPORARILY DISABLED: Polishing causing structure morphing/shrinking
      // Use unpolished brush stroke until polishing is fixed
      brushPolygon = addBrushToContour(
        [], // Empty array to get just the brush polygon
        payload.points,
        payload.brushSize, // Use pixel size directly - let polygon function handle conversion
      );
      console.log("Using unpolished brush stroke (polishing temporarily disabled)");
      
      // TODO: Fix polishing ClipperLib compatibility issue
      // The polishing function is failing with "Error polishing contour" 
      // and causing structures to morph/shrink when multiple strokes are added

      // Collect all contours on this slice
      const tol = 0.5;
      const existingOnSlice = structure.contours.filter(
        (c: any) => Math.abs(c.slicePosition - payload.slicePosition) <= tol
      );

      // Check if brush stroke intersects with any existing contour
      let intersectsWithExisting = false;
      const intersectingContours: any[] = [];
      const nonIntersectingContours: any[] = [];
      
      for (const contour of existingOnSlice) {
        if (contour.points && contour.points.length >= 9) {
          // Check if brush polygon intersects with this contour
          const intersects = doPolygonsIntersect(brushPolygon, contour.points);
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
        (c: any) => Math.abs(c.slicePosition - payload.slicePosition) > tol
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

        // Perform union of intersecting polygons
        const unionResult = polygonUnion(polygonsToUnion);
        
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
              (c: any) => Math.abs(c.slicePosition - nextSlicePosition) < 0.5
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
              (c: any) => Math.abs(c.slicePosition - prevSlicePosition) < 0.5
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
    } else if (
      payload.action === "add_pen_stroke" ||
      payload.action === "cut_pen_stroke"
    ) {
      // Handle pen tool operations
      const structure = updatedStructures.structures.find(
        (s: any) => s.roiNumber === payload.structureId,
      );
      if (!structure) return;

      // Find contour on current slice
      const tolerance = 1.5;
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

      // Find contour on current slice
      const tolerance = 1.5;
      const contourIndex = structure.contours.findIndex(
        (c: any) =>
          Math.abs(c.slicePosition - payload.slicePosition) <= tolerance,
      );

      if (payload.operation === 'union' && contourIndex >= 0) {
        // For union, use polygon union to merge overlapping areas properly
        const existingContour = structure.contours[contourIndex];
        const existingPolygons = [];
        
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
      const tolerance = 1.5;
      const contourIndex = structure.contours.findIndex(
        (c: any) =>
          Math.abs(c.slicePosition - payload.slicePosition) <= tolerance,
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
      const tolerance = 1.5;
      
      // Remove all existing contours at this slice
      structure.contours = structure.contours.filter(
        (c: any) => Math.abs(c.slicePosition - payload.slicePosition) > tolerance
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
      const tolerance = 1.5;
      
      // Remove all existing contours at this slice
      structure.contours = structure.contours.filter(
        (c: any) => Math.abs(c.slicePosition - payload.slicePosition) > tolerance
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
      
      // Remove contour at specified slice position for this structure only
      const tolerance = 1.5;
      const originalLength = structure.contours.length;
      structure.contours = structure.contours.filter(
        (c: any) => Math.abs(c.slicePosition - payload.slicePosition) > tolerance
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
      // Handle interpolate missing slices
      const structure = updatedStructures.structures.find(
        (s: any) => s.roiNumber === payload.structureId,
      );
      if (!structure || !structure.contours || structure.contours.length < 2) {
        console.log("Not enough contours to interpolate");
        return;
      }

      // Sort contours by slice position
      const sortedContours = [...structure.contours].sort((a: any, b: any) => a.slicePosition - b.slicePosition);
      
      // Find gaps and interpolate
      const newContours = [];
      for (let i = 0; i < sortedContours.length - 1; i++) {
        const currentContour = sortedContours[i];
        const nextContour = sortedContours[i + 1];
        
        // Add current contour
        newContours.push(currentContour);
        
        // Check for gap
        const sliceGap = nextContour.slicePosition - currentContour.slicePosition;
        if (sliceGap > 1.5) { // If there's a gap of more than 1 slice
          // Linear interpolation between contours
          const numSlicesToInterpolate = Math.floor(sliceGap - 1);
          
          for (let j = 1; j <= numSlicesToInterpolate; j++) {
            const ratio = j / (numSlicesToInterpolate + 1);
            const interpolatedSlicePosition = currentContour.slicePosition + (sliceGap * ratio);
            
            // Interpolate points
            const interpolatedPoints = [];
            const minPointCount = Math.min(currentContour.points.length, nextContour.points.length);
            
            for (let k = 0; k < minPointCount; k += 3) {
              const x1 = currentContour.points[k];
              const y1 = currentContour.points[k + 1];
              const z1 = currentContour.points[k + 2];
              
              const x2 = nextContour.points[k];
              const y2 = nextContour.points[k + 1];
              const z2 = nextContour.points[k + 2];
              
              // Linear interpolation
              interpolatedPoints.push(x1 + (x2 - x1) * ratio);
              interpolatedPoints.push(y1 + (y2 - y1) * ratio);
              interpolatedPoints.push(z1 + (z2 - z1) * ratio);
            }
            
            newContours.push({
              slicePosition: interpolatedSlicePosition,
              points: interpolatedPoints,
              numberOfPoints: interpolatedPoints.length / 3,
            });
          }
        }
      }
      
      // Add last contour
      newContours.push(sortedContours[sortedContours.length - 1]);
      
      structure.contours = newContours;
      console.log(`Interpolated missing slices for structure ${payload.structureId}`);
      
      setLocalRTStructures(updatedStructures);
      saveContourUpdates(updatedStructures, 'interpolate');
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
    }
  };

  // Expose handleContourUpdate method to parent component
  useImperativeHandle(ref, () => ({
    handleContourUpdate
  }), [rtStructures]);

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

  // Load registration matrix when study changes
  useEffect(() => {
    if (studyId) {
      fetch(`/api/registrations/${studyId}`)
        .then(res => res.json())
        .then(data => {
          if (data && data.transformationMatrix) {
            console.log(`Loaded registration matrix for study ${studyId}:`, data);
            // Parse the transformation matrix if it's a string
            let matrix = data.transformationMatrix;
            if (typeof matrix === 'string') {
              try {
                matrix = JSON.parse(matrix);
                console.log('Parsed registration matrix:', matrix);
              } catch (e) {
                console.error('Failed to parse registration matrix:', e);
                matrix = null;
              }
            }
            setRegistrationMatrix(matrix);
            registrationMatrixRef.current = matrix;
          } else {
            console.log(`No registration found for study ${studyId}`);
            setRegistrationMatrix(null);
            registrationMatrixRef.current = null;
          }
        })
        .catch(error => {
          console.error('Error loading registration:', error);
          setRegistrationMatrix(null);
        });
    }
  }, [studyId]);
  
  // Re-render fusion overlay when registration matrix is loaded
  useEffect(() => {
    console.log('🔥 Registration matrix useEffect:', {
      hasMatrix: !!registrationMatrix,
      matrixLength: registrationMatrix?.length,
      secondarySeriesId,
      secondarySeriesType: typeof secondarySeriesId,
      imagesLength: images.length,
      secondaryImagesLength: secondaryImages.length
    });
    
    if (registrationMatrix && registrationMatrix.length === 16 && secondarySeriesId && Number(secondarySeriesId) && images.length > 0) {
      console.log('Registration matrix loaded, re-rendering fusion overlay');
      
      // Pre-compute MRI transformations if we have secondary images loaded
      if (secondaryImages.length > 0) {
        const transformed = computeTransformedMRIPositions(secondaryImages, registrationMatrix);
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
      const transformed = computeTransformedMRIPositions(secondaryImages, registrationMatrix);
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
  


  // Load secondary series images for fusion
  useEffect(() => {
    const loadSecondaryImages = async () => {
      // Check if secondarySeriesId is valid (not null, not 'none', and a valid number)
      if (!secondarySeriesId || isNaN(Number(secondarySeriesId))) {
        setSecondaryImages([]);
        secondaryImageCacheRef.current = new Map();
        mriSliceMappingCache.current.clear(); // Clear MRI mapping cache
        setSecondaryModality('MR'); // Reset to default
        return;
      }

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
        
        // Filter out images with null or invalid slice locations
        const validImages = imageList.filter((img: any) => {
          const sliceLoc = parseFloat(img.sliceLocation);
          return !isNaN(sliceLoc) && sliceLoc !== null;
        });
        
        if (validImages.length === 0) {
          console.error("No MRI images with valid slice locations found");
          setSecondaryImages([]);
          return;
        }
        
        const sortedImages = validImages.sort((a: any, b: any) => {
          // Sort by slice location
          const aSliceLoc = parseFloat(a.sliceLocation);
          const bSliceLoc = parseFloat(b.sliceLocation);
          return aSliceLoc - bSliceLoc;
        });

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
                newCache.set(image.sopInstanceUID, imageData);
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
        
        // Pre-compute MRI positions in CT space if registration matrix is available
        if (registrationMatrix && registrationMatrix.length === 16) {
          // Clear cache to force fresh computation with debug logs
          transformedMRIPositions.current = [];
          mriZRangeInCTSpace.current = null;
          mriSliceMappingCache.current.clear();
          console.log("=== FORCING FRESH MRI TRANSFORMATION COMPUTATION ===");
          
          // Compute transformed MRI positions and store in ref
          const transformed = computeTransformedMRIPositions(sortedImages, registrationMatrix);
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
      const imagesWithMetadata = await Promise.all(
        seriesImages.map(async (img: any) => {
          try {
            const response = await fetch(`/api/images/${img.sopInstanceUID}`, { signal });
            const arrayBuffer = await response.arrayBuffer();

            if (!window.dicomParser) {
              await loadDicomParser();
            }

            const byteArray = new Uint8Array(arrayBuffer);
            const dataSet = window.dicomParser.parseDicom(byteArray);

            // Extract spatial metadata
            const sliceLocation = dataSet.floatString("x00201041");
            const imagePosition = dataSet.string("x00200032");
            const instanceNumber = dataSet.intString("x00200013");

            // Parse image position (z-coordinate is third value)
            let zPosition = null;
            if (imagePosition) {
              const positions = imagePosition
                .split("\\")
                .map((p: string) => parseFloat(p));
              zPosition = positions[2];
            }

            return {
              ...img,
              parsedSliceLocation: sliceLocation
                ? parseFloat(sliceLocation)
                : null,
              parsedZPosition: zPosition,
              parsedInstanceNumber: instanceNumber
                ? parseInt(instanceNumber)
                : img.instanceNumber,
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
    
    // For MPR reconstruction, we need all images loaded
    // Sort images by Z position
    const sortedImages = [...images].sort((a, b) => {
      const zA = parseFloat(a.parsedZPosition || a.parsedSliceLocation || '0');
      const zB = parseFloat(b.parsedZPosition || b.parsedSliceLocation || '0');
      return zA - zB;
    });
    
    // Get dimensions from first image
    const firstImage = sortedImages[0];
    if (!firstImage || !firstImage.pixelData) {
      return firstImage; // Return as fallback
    }
    
    const width = firstImage.columns || 512;
    const height = firstImage.rows || 512;
    const numSlices = sortedImages.length;
    
    // Create synthetic image for MPR view
    const mprImage = {
      ...firstImage,
      sopInstanceUID: `mpr-${orientation}-${sliceIndex}`,
      pixelData: new Uint16Array(width * height),
      orientation: orientation
    };
    
    // For sagittal: slice through X axis (left-right view)
    // For coronal: slice through Y axis (front-back view)
    if (orientation === 'sagittal') {
      // Sagittal view: fix X coordinate, vary Y and Z
      const x = Math.min(sliceIndex, width - 1);
      
      // Fill pixel data by sampling from axial slices
      for (let z = 0; z < numSlices && z < height; z++) {
        const axialImage = sortedImages[z];
        if (axialImage && axialImage.pixelData) {
          for (let y = 0; y < height; y++) {
            const srcIndex = y * width + x;
            const dstIndex = z * width + y;
            mprImage.pixelData[dstIndex] = axialImage.pixelData[srcIndex] || 0;
          }
        }
      }
    } else if (orientation === 'coronal') {
      // Coronal view: fix Y coordinate, vary X and Z
      const y = Math.min(sliceIndex, height - 1);
      
      // Fill pixel data by sampling from axial slices
      for (let z = 0; z < numSlices && z < height; z++) {
        const axialImage = sortedImages[z];
        if (axialImage && axialImage.pixelData) {
          for (let x = 0; x < width; x++) {
            const srcIndex = y * width + x;
            const dstIndex = z * width + x;
            mprImage.pixelData[dstIndex] = axialImage.pixelData[srcIndex] || 0;
          }
        }
      }
    }
    
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

      let imageData = imageCacheRef.current.get(cacheKey);

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

      // Keep fixed canvas size for consistent display
      canvas.width = 1024;
      canvas.height = 1024;

      // Always use CPU rendering for now - GPU integration needs more work
      render16BitImage(ctx, imageData.data, imageData.width, imageData.height);
      
      // Render secondary image overlay for fusion if available
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
      if (localRTStructures && showStructures) {
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
    // Create image data at original size
    const imageData = ctx.createImageData(width, height);
    const data = imageData.data;

    // Apply window/level settings
    const { width: windowWidth, center: windowCenter } = currentWindowLevel;
    const min = windowCenter - windowWidth / 2;
    const max = windowCenter + windowWidth / 2;

    for (let i = 0; i < pixelArray.length; i++) {
      const pixelValue = pixelArray[i];

      // Apply windowing
      let normalizedValue;
      if (pixelValue <= min) {
        normalizedValue = 0;
      } else if (pixelValue >= max) {
        normalizedValue = 255;
      } else {
        normalizedValue = ((pixelValue - min) / windowWidth) * 255;
      }

      const gray = Math.max(0, Math.min(255, normalizedValue));

      const pixelIndex = i * 4;
      data[pixelIndex] = gray; // R
      data[pixelIndex + 1] = gray; // G
      data[pixelIndex + 2] = gray; // B
      data[pixelIndex + 3] = 255; // A
    }

    // Create a temporary canvas for the original image
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = width;
    tempCanvas.height = height;
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
    console.log('🎯 renderFusionOverlayNew called:', {
      secondaryImagesLength: secondaryImages.length,
      secondarySeriesId,
      secondarySeriesType: typeof secondarySeriesId,
      fusionOpacity,
      hasRegistrationMatrix: !!registrationMatrix,
      hasTransformedPositions: !!transformedMRIPositions.current?.length
    });
    
    if (!secondaryImages.length || !secondarySeriesId || typeof secondarySeriesId !== 'number') {
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
    
    // Get CT slice Z position
    let ctSliceZ: number = (currentIndex + 1) * 3; // Default fallback
    
    // Try to get Z position from various sources in priority order
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
    
    const actualCache = secondaryImageCacheRef.current;
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    console.log('🚀 About to call renderFusionOverlay with:', {
      ctSliceZ,
      fusionOpacity,
      canvasSize: `${canvas.width}x${canvas.height}`,
      actualCacheSize: actualCache.size,
      transformedMRILength: transformedMRIPositions.current?.length
    });
    
    // Call the new fusion utility function with registration matrix and shared CT coordinate system
    // DO NOT apply transform here - fusion-utils handles its own transforms
    await renderFusionOverlay(
      ctx,
      primaryImage,
      transformedMRIPositions.current,
      actualCache,
      ctSliceZ,
      fusionOpacity,
      panX,
      panY,
      canvas.width,
      canvas.height,
      registrationMatrix,
      ctTransform.current
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

    // FIXED: Get current slice position from actual DICOM metadata
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

    const tolerance = 0.5; // mm tolerance for slice matching - reduced to only show contours on current slice

    // CRITICAL DEBUG: Log all slice position sources for comparison
    console.log(`🔍 SLICE POSITION DEBUG:
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
    console.log(
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
      console.log(
        `🎯 RT coordinate range: ${rtZMin.toFixed(1)} to ${rtZMax.toFixed(1)}mm`,
      );
      console.log(
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
      // Check if this structure is visible or if it's selected for editing
      const isVisible = structureVisibility.get(structure.roiNumber);
      const isSelectedForEdit = selectedForEdit === structure.roiNumber;

      // Always show selected structure for editing, even if visibility is off
      if (!isVisible && !isSelectedForEdit) return;

      // Use the structure's actual color, not hardcoded yellow
      const color = structure.color || [255, 255, 0]; // fallback to yellow only if no color
      const [r, g, b] = color;
      ctx.strokeStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${fillOpacity})`;

      structure.contours.forEach((contour: any) => {
        // Debug: Log what contours are being considered for drawing
        const positionDiff = Math.abs(
          contour.slicePosition - currentSlicePosition,
        );
        if (positionDiff <= tolerance) {
          console.log(
            `✓ Drawing ${structure.structureName} contour at RT ${contour.slicePosition.toFixed(1)}mm (CT slice: ${currentSlicePosition.toFixed(1)}mm, diff: ${positionDiff.toFixed(1)}mm)`,
          );
          drawContour(ctx, contour, canvas.width, canvas.height, currentImage, animationTime);
        }
      });
    });
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
    
    // Debug: Log first few points of the contour
    if (contour.points.length >= 6) {
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

    // Fill with reduced opacity for predictions
    if (contour.isPredicted) {
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

  // Notify parent when slice position changes
  useEffect(() => {
    if (images.length > 0 && images[currentIndex] && onSlicePositionChange) {
      const slicePosition =
        images[currentIndex].parsedSliceLocation ??
        images[currentIndex].parsedZPosition ??
        currentIndex;
      onSlicePositionChange(slicePosition);
    }
  }, [currentIndex, images, onSlicePositionChange]);
  
  // Set the displayCurrentImageRef to point to displayCurrentImage
  useEffect(() => {
    displayCurrentImageRef.current = displayCurrentImage;
  });

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
      // Left click for pan (disabled during drawing/measurement mode)
      setIsDragging(true);
      setDragStart({ x: e.clientX, y: e.clientY });
      setLastPanX(panX);
      setLastPanY(panY);
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
    const updatedStructures = JSON.parse(JSON.stringify(rtStructures));
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
    
    console.log(`🔄 Confirming prediction for structure ${structureId} at slice ${slicePosition}`);
    
    // Deep copy the structures
    const updatedStructures = JSON.parse(JSON.stringify(rtStructures));
    
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
                {images[currentIndex] && (
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
      <div className="flex-1 p-4 flex items-center justify-center">
        <div className="relative" style={{ width: '1280px', height: '1280px' }}>
          <canvas
            ref={canvasRef}
            width={1280}
            height={1280}
            onMouseDown={handleCanvasMouseDown}
            onMouseMove={handleCanvasMouseMove}
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
            brushToolState?.tool === "brush" &&
            selectedForEdit && (
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
                ctTransform={ctTransform}
                onBrushModeChange={(mode: BrushOperation) => {
                  console.log("Brush mode changed:", mode);
                }}
                onBrushSizeChange={(newSize: number) => {
                  if (onBrushSizeChange) {
                    onBrushSizeChange(newSize);
                  }
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
          {studyId && props.secondarySeriesId !== undefined && props.hasSecondarySeriesForFusion && registrationMatrix && props.onSecondarySeriesSelect && props.onFusionOpacityChange && (
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
