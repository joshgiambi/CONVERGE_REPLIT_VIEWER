import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { SimpleBrushTool } from "./simple-brush-tool";
import { EclipsePenToolFixed } from "./eclipse-pen-tool-fixed";
import { EclipsePlanarContourTool } from "./eclipse-planar-contour-tool";
import { PenTool } from "./pen-tool";
import { RTStructureOverlay } from "./rt-structure-overlay";
import { FusionControlPanel } from "./fusion-control-panel";
import { BrushOperation } from "@shared/schema";
import { growContour, smoothContour } from "@/lib/contour-grow";
import {
  addBrushToContour,
  eraseBrushFromContour,
  mergeBrushWithContour,
} from "@/lib/brush-to-polygon";
import { applyDirectionalGrow } from "@/lib/contour-directional-grow";
import { combineContours, subtractContours } from "@/lib/contour-boolean-operations";
import { predictNextSliceContour } from "@/lib/contour-prediction";

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
  const [renderTrigger, setRenderTrigger] = useState(0);
  const [animationTime, setAnimationTime] = useState(0);
  const [predictedContours, setPredictedContours] = useState<Map<string, any>>(new Map());
  const [testPredictionAdded, setTestPredictionAdded] = useState(false);
  const [fusionAvailable, setFusionAvailable] = useState(true);

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
  const [imageCache, setImageCache] = useState<
    Map<string, { data: Float32Array; width: number; height: number }>
  >(new Map());
  const [isPreloading, setIsPreloading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  
  // Secondary series state for fusion
  const [secondaryImages, setSecondaryImages] = useState<any[]>([]);
  const [secondaryImageCache, setSecondaryImageCache] = useState<
    Map<string, { data: Float32Array; width: number; height: number }>
  >(new Map());
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
  const transformedMRIPositions = useRef<Array<{ original: any; transformed: number[]; zInCT: number }>>([]); 

  // Zoom and pan state - DISABLED FOR DEBUGGING
  const zoom = 1; // Fixed zoom for debugging
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);



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
  const handleBooleanOperation = (payload: any) => {
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
        resultPoints = combineContours(sourceContour.points, targetContour.points);
      } else if (operation === 'subtract') {
        // Subtract target from source
        resultPoints = subtractContours(sourceContour.points, targetContour.points);
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
  const [imageMetadata, setImageMetadata] = useState<any>(null);
  const [lastPanX, setLastPanX] = useState(0);
  const [lastPanY, setLastPanY] = useState(0);

  // Handle contour updates from brush tool and other contour editing operations
  const handleContourUpdate = (payload: any) => {
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
      // Just update from parent without clearing
      setLocalRTStructures(rtStructures);
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

      // Convert brush stroke to polygon
      const brushPolygon = addBrushToContour(
        [], // Empty array to get just the brush polygon
        payload.points,
        payload.brushSize,
      );

      // Find all contours on this slice
      const sliceContours = structure.contours.filter(
        (c: any) => Math.abs(c.slicePosition - payload.slicePosition) < 0.5,
      );

      // Check if brush stroke intersects with any existing contour
      let foundIntersection = false;
      let mergedWithContour = null;

      for (const contour of sliceContours) {
        if (contour.points && contour.points.length > 0) {
          // Check if brush polygon intersects with this contour
          // For now, use a simple approach: check if any brush point is close to any contour point
          const intersects = checkPolygonIntersection(brushPolygon, contour.points);
          
          if (intersects) {
            // Merge with this contour
            console.log(
              `Merging brush stroke with existing contour of ${contour.points.length / 3} points`,
            );
            
            // Use proper polygon union to merge contours seamlessly
            const mergedPoints = mergeBrushWithContour(contour.points, brushPolygon);
            contour.points = mergedPoints;
            contour.numberOfPoints = mergedPoints.length / 3;
            
            foundIntersection = true;
            mergedWithContour = contour;
            break;
          }
        }
      }

      if (!foundIntersection) {
        // No intersection found - create new separate contour
        console.log(
          `Creating new separate contour for brush stroke at slice ${payload.slicePosition}`,
        );
        
        const newContour = {
          slicePosition: payload.slicePosition,
          points: brushPolygon,
          numberOfPoints: brushPolygon.length / 3,
        };
        structure.contours.push(newContour);
      }

      console.log(`Structure now has ${structure.contours.length} contours`);
      setLocalRTStructures(updatedStructures);
      
      // Handle next slice prediction if enabled
      if (payload.predictionEnabled) {
        console.log("Next slice prediction is enabled, predicting contours for adjacent slices");
        
        // Get the final contour on this slice (either merged or new)
        let finalContour = mergedWithContour;
        if (!finalContour) {
          // Find the contour we just created
          finalContour = structure.contours[structure.contours.length - 1];
        }
        
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
          // Merge pen stroke with existing contour
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
      // Save contour updates to server
      saveContourUpdates(updatedStructures, payload.action);
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
    } else if (payload.action === "grow_contour") {
      // Handle contour growing
      handleGrowContour(payload);
    } else if (payload.action === "apply_margin") {
      // Handle margin operation (Eclipse TPS style)
      handleMarginOperation(payload);
    } else if (payload.action === "boolean_operation") {
      // Handle boolean operations (combine/subtract)
      handleBooleanOperation(payload);
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
        displayCurrentImage();
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
        displayCurrentImage();
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
    console.log('Registration matrix useEffect:', {
      hasMatrix: !!registrationMatrix,
      matrixLength: registrationMatrix?.length,
      secondarySeriesId,
      imagesLength: images.length
    });
    
    if (registrationMatrix && registrationMatrix.length === 16 && secondarySeriesId && secondarySeriesId !== 'none' && images.length > 0) {
      console.log('Registration matrix loaded, re-rendering fusion overlay');
      
      // Pre-compute MRI transformations if we have secondary images loaded
      if (secondaryImages.length > 0) {
        precomputeMRITransformations(secondaryImages, registrationMatrix);
      }
      
      displayCurrentImage();
    }
  }, [registrationMatrix, secondarySeriesId, images.length]);
  
  // Trigger pre-computation when both registration matrix and secondary images are available
  useEffect(() => {
    if (registrationMatrix && registrationMatrix.length === 16 && secondaryImages.length > 0 && transformedMRIPositions.current.length === 0) {
      console.log('Both registration matrix and secondary images available, pre-computing transformations...');
      precomputeMRITransformations(secondaryImages, registrationMatrix);
    }
  }, [registrationMatrix, secondaryImages]);
  
  // Pre-compute MRI transformations for performance
  const precomputeMRITransformations = (mriImages: any[], registrationMatrix: number[]) => {
    console.log("Pre-computing MRI transformations for performance optimization...");
    console.log(`Processing ${mriImages.length} MRI images`);
    
    // Convert flat array to 4x4 matrix
    const regMatrix4x4 = [
      [registrationMatrix[0], registrationMatrix[1], registrationMatrix[2], registrationMatrix[3]],
      [registrationMatrix[4], registrationMatrix[5], registrationMatrix[6], registrationMatrix[7]],
      [registrationMatrix[8], registrationMatrix[9], registrationMatrix[10], registrationMatrix[11]],
      [registrationMatrix[12], registrationMatrix[13], registrationMatrix[14], registrationMatrix[15]]
    ];
    
    const multiplyMatrixVector = (matrix: number[][], vector: number[]): number[] => {
      const result: number[] = [];
      for (let i = 0; i < 4; i++) {
        result[i] = 0;
        for (let j = 0; j < 4; j++) {
          result[i] += matrix[i][j] * vector[j];
        }
      }
      return result;
    };
    
    // Log the first few MRI positions before and after transformation
    console.log("\n=== MRI Transformation Debug ===");
    console.log("Registration matrix (as flat array):", registrationMatrix);
    console.log("Registration matrix 4x4:");
    console.log(`  [${regMatrix4x4[0].map(v => v.toFixed(3)).join(', ')}]`);
    console.log(`  [${regMatrix4x4[1].map(v => v.toFixed(3)).join(', ')}]`);
    console.log(`  [${regMatrix4x4[2].map(v => v.toFixed(3)).join(', ')}]`);
    console.log(`  [${regMatrix4x4[3].map(v => v.toFixed(3)).join(', ')}]`);
    
    // Check if we have valid MRI images with positions
    const validMRICount = mriImages.filter(img => img.imagePosition).length;
    console.log(`Valid MRI images with positions: ${validMRICount}/${mriImages.length}`);
    
    // Transform all MRI positions to CT space
    const transformed = mriImages.map((mriImage, index) => {
      const mriPos = mriImage.imagePosition;
      if (!mriPos) {
        console.warn(`MRI image ${index} has no imagePosition metadata`);
        return null;
      }
      
      const mriPatientPosition = typeof mriPos === 'string' 
        ? mriPos.split('\\').map((p: string) => parseFloat(p))
        : mriPos;
        
      if (mriPatientPosition.length < 3) {
        console.warn(`MRI image ${index} has invalid position data:`, mriPos);
        return null;
      }
      
      const mriHomogeneous = [mriPatientPosition[0], mriPatientPosition[1], mriPatientPosition[2], 1];
      const mriTransformed = multiplyMatrixVector(regMatrix4x4, mriHomogeneous);
      
      // Log first 3 and last 3 transformations with more detail
      if (index < 3 || index >= mriImages.length - 3) {
        console.log(`\nMRI[${index}] Instance ${mriImage.instanceNumber}, slice ${mriImage.sliceLocation}mm:`);
        console.log(`  Original position: [${mriPatientPosition.map(v => v.toFixed(1)).join(', ')}]`);
        console.log(`  Homogeneous coords: [${mriHomogeneous.map(v => v.toFixed(1)).join(', ')}]`);
        console.log(`  Transformed result: [${mriTransformed.map(v => v.toFixed(1)).join(', ')}]`);
        console.log(`  Z in CT space: ${mriTransformed[2].toFixed(1)}mm`);
      }
      
      return {
        original: mriImage,
        transformed: mriTransformed,
        zInCT: mriTransformed[2]
      };
    }).filter(item => item !== null);
    
    // Store transformed positions
    transformedMRIPositions.current = transformed;
    
    // Calculate and store Z-range
    if (transformed.length > 0) {
      const zValues = transformed.map(item => item.zInCT);
      mriZRangeInCTSpace.current = {
        min: Math.min(...zValues),
        max: Math.max(...zValues)
      };
      console.log(`\nMRI Z-range after transformation:`);
      console.log(`  Original MRI range: -74.4mm to 161.6mm`);
      console.log(`  After registration: ${mriZRangeInCTSpace.current.min.toFixed(1)}mm to ${mriZRangeInCTSpace.current.max.toFixed(1)}mm`);
      console.log(`  CT slice range: 325.5mm to 723.5mm`);
      console.log(`  Overlap region: ${Math.max(mriZRangeInCTSpace.current.min, 325.5).toFixed(1)}mm to ${Math.min(mriZRangeInCTSpace.current.max, 723.5).toFixed(1)}mm`);
    }
    
    // Clear cache to force recomputation with new data
    mriSliceMappingCache.current.clear();
  };

  // Load secondary series images for fusion
  useEffect(() => {
    const loadSecondaryImages = async () => {
      // Check if secondarySeriesId is valid (not null, not 'none', and a valid number)
      if (!secondarySeriesId || secondarySeriesId === 'none' || isNaN(Number(secondarySeriesId))) {
        setSecondaryImages([]);
        setSecondaryImageCache(new Map());
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
        
        // Preload secondary images
        const newCache = new Map();
        await Promise.all(sortedImages.map(async (image: any, index: number) => {
          try {
            const imageResponse = await fetch(`/api/images/${image.sopInstanceUID}`);
            if (!imageResponse.ok) {
              console.error(`Failed to fetch secondary image ${index}:`, imageResponse.status);
              return;
            }
            
            const arrayBuffer = await imageResponse.arrayBuffer();
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
        
        setSecondaryImageCache(newCache);
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
          precomputeMRITransformations(sortedImages, registrationMatrix);
        }
        
        // Trigger re-render to show fusion overlay with delay to ensure state is updated
        if (newCache.size > 0) {
          setTimeout(() => {
            displayCurrentImage();
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
        displayCurrentImage();
        // Load metadata for current image
        const currentImage = images[currentIndex];
        if (currentImage?.id) {
          loadImageMetadata(currentImage.id);
        }
      }, 10);
      
      return () => clearTimeout(timeoutId);
    }
  }, [images, currentIndex, currentWindowLevel, isPreloading]);

  const loadImages = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch(`/api/series/${seriesId}/images`);
      if (!response.ok) {
        throw new Error(`Failed to load images: ${response.statusText}`);
      }

      const seriesImages = await response.json();

      // First parse DICOM metadata for proper spatial ordering
      const imagesWithMetadata = await Promise.all(
        seriesImages.map(async (img: any) => {
          try {
            const response = await fetch(`/api/images/${img.sopInstanceUID}`);
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

      // Preload all images immediately
      preloadAllImages(sortedImages);
    } catch (error: any) {
      setError(error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const parseDicomImage = async (arrayBuffer: ArrayBuffer) => {
    try {
      // Load dicom-parser if not already loaded
      if (!window.dicomParser) {
        await loadDicomParser();
      }

      const byteArray = new Uint8Array(arrayBuffer);
      const dataSet = window.dicomParser.parseDicom(byteArray);

      // Extract image data
      const pixelDataElement = dataSet.elements.x7fe00010;
      if (!pixelDataElement) {
        throw new Error("No pixel data found in DICOM file");
      }

      // Get image dimensions and parameters
      const rows = dataSet.uint16("x00280010") || 512;
      const cols = dataSet.uint16("x00280011") || 512;
      const bitsAllocated = dataSet.uint16("x00280100") || 16;

      // Get rescale parameters - default to 0 intercept for MRI
      const modality = dataSet.string("x00080060") || "CT";
      const rescaleSlope = dataSet.floatString("x00281053") || 1;
      const rescaleIntercept = dataSet.floatString("x00281052") || (modality === "MR" ? 0 : -1024);

      if (bitsAllocated === 16) {
        const rawPixelArray = new Uint16Array(
          arrayBuffer,
          pixelDataElement.dataOffset,
          pixelDataElement.length / 2,
        );
        // Convert to Hounsfield Units
        const huPixelArray = new Float32Array(rawPixelArray.length);
        for (let i = 0; i < rawPixelArray.length; i++) {
          huPixelArray[i] = rawPixelArray[i] * rescaleSlope + rescaleIntercept;
        }

        return {
          data: huPixelArray,
          width: cols,
          height: rows,
        };
      } else {
        throw new Error("Only 16-bit images supported");
      }
    } catch (error) {
      console.error("Error parsing DICOM image:", error);
      return null;
    }
  };

  const preloadAllImages = async (imageList: any[]) => {
    console.log("Starting to preload all images...");
    if (!imageList || imageList.length === 0) {
      console.warn("No images to preload");
      setIsPreloading(false);
      return;
    }
    setIsPreloading(true);
    const newCache = new Map();

    // Load all images in parallel
    const loadPromises = imageList.map(async (image, index) => {
      try {
        const imageResponse = await fetch(
          `/api/images/${image.sopInstanceUID}`,
        );
        if (!imageResponse.ok) {
          throw new Error(`Failed to load image ${index + 1}`);
        }

        const arrayBuffer = await imageResponse.arrayBuffer();
        const imageData = await parseDicomImage(arrayBuffer);

        if (imageData) {
          newCache.set(image.sopInstanceUID, imageData);
          console.log(`Preloaded image ${index + 1}/${imageList.length}`);
        }
      } catch (error) {
        console.warn(`Failed to preload image ${index + 1}:`, error);
      }
    });

    // Wait for all images to load
    await Promise.allSettled(loadPromises);
    setImageCache(newCache);
    setIsPreloading(false);
    console.log(
      `Preloading complete: ${newCache.size}/${imageList.length} images cached`,
    );
  };

  const loadImageMetadata = async (imageId: number) => {
    try {
      const response = await fetch(`/api/images/${imageId}/metadata`);
      if (response.ok) {
        const metadata = await response.json();
        console.log("Image metadata:", metadata);
        setImageMetadata(metadata);

        // Frame of Reference UIDs are verified during data import
      }
    } catch (error) {
      console.error("Failed to load image metadata:", error);
    }
  };

  const displayCurrentImage = async () => {
    if (!canvasRef.current || images.length === 0) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    try {
      // Ensure currentIndex is valid
      const safeIndex = Math.max(0, Math.min(currentIndex, images.length - 1));
      const currentImage = images[safeIndex];
      if (!currentImage) {
        console.error("No image at current index:", safeIndex, "images length:", images.length);
        setError("Unable to display image. Please try refreshing.");
        return;
      }
      const cacheKey = currentImage.sopInstanceUID;

      // Clear canvas
      ctx.fillStyle = "black";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      let imageData = imageCache.get(cacheKey);

      if (!imageData || !imageData.data) {
        // Try to reload the image if it's not in cache
        console.warn(
          "Image not in cache, attempting to reload:",
          cacheKey,
        );
        
        try {
          const imageResponse = await fetch(
            `/api/images/${currentImage.sopInstanceUID}`,
          );
          if (!imageResponse.ok) {
            throw new Error(`Failed to reload image: ${imageResponse.status}`);
          }

          const arrayBuffer = await imageResponse.arrayBuffer();
          const reloadedImageData = await parseDicomImage(arrayBuffer);

          if (reloadedImageData) {
            // Update cache with reloaded image
            imageCache.set(cacheKey, reloadedImageData);
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

      // Render with current window/level settings
      render16BitImage(ctx, imageData.data, imageData.width, imageData.height);
      
      // Render secondary image overlay for fusion if available
      if (secondarySeriesId && secondaryImages.length > 0) {
        console.log(`Rendering fusion for CT slice ${currentIndex}`);
        try {
          await renderFusionOverlay(ctx, currentImage);
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
    const tempCtx = tempCanvas.getContext("2d");
    if (!tempCtx) return;

    tempCtx.putImageData(imageData, 0, 0);

    // Scale and draw to the main canvas with zoom and pan
    const canvasWidth = ctx.canvas.width;
    const canvasHeight = ctx.canvas.height;

    // SIMPLIFIED - NO ZOOM FOR DEBUGGING  
    const baseScale = Math.min(canvasWidth / width, canvasHeight / height);
    const totalScale = baseScale; // Just base scale, no zoom
    const scaledWidth = width * totalScale;
    const scaledHeight = height * totalScale;

    // Center the image on canvas with pan offset
    const x = (canvasWidth - scaledWidth) / 2 + panX;
    const y = (canvasHeight - scaledHeight) / 2 + panY;

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
  
  const renderFusionOverlay = async (ctx: CanvasRenderingContext2D, primaryImage: any) => {
    if (!secondaryImages.length || !secondarySeriesId || secondarySeriesId === 'none') {
      console.log("Fusion not rendered - secondaryImages:", secondaryImages.length, "secondarySeriesId:", secondarySeriesId);
      return;
    }
    
    console.log("Starting fusion overlay render...");
    const actualCache = (window as any).secondaryImageCacheRef || secondaryImageCache;
    console.log("Secondary cache size:", actualCache.size);
    console.log("Fusion opacity:", fusionOpacity);
    console.log("Secondary images length:", secondaryImages.length);
    console.log("Registration matrix available:", !!registrationMatrix);
    
    // If opacity is 0, skip rendering entirely
    if (fusionOpacity === 0) {
      console.log("Fusion opacity is 0, skipping overlay render");
      return;
    }
    

    
    // Helper function for matrix-vector multiplication (defined at top for use throughout)
    const multiplyMatrixVector = (matrix: number[][], vector: number[]): number[] => {
      const result: number[] = [];
      for (let i = 0; i < 4; i++) {
        result[i] = 0;
        for (let j = 0; j < 4; j++) {
          result[i] += matrix[i][j] * vector[j];
        }
      }
      return result;
    };
    
    // Get the current CT slice position and image metadata
    let ctSlicePosition = parseFloat(primaryImage.sliceLocation) || primaryImage.parsedSliceLocation || currentIndex;
    const ctImageMetadata = imageMetadata || {};
    
    // Define CT coordinates at function scope for use throughout
    let ctX = -249.51171875, ctY = -465.51171875, ctZ = ctSlicePosition;
    
    // Find the matching MRI slice using registration transformation
    let closestSecondaryImage;
    let minDistance = Infinity;
    
    // Use ref to get current registration matrix value
    const currentRegistrationMatrix = registrationMatrixRef.current;
    
    if (currentRegistrationMatrix && currentRegistrationMatrix.length === 16) {
      // Based on Python implementation: The registration matrix might be from MRI to CT
      // We need to try both directions and see which one produces valid results
      
      // Extract transformation components from 4x4 matrix
      const R = [
        [currentRegistrationMatrix[0], currentRegistrationMatrix[1], currentRegistrationMatrix[2]],
        [currentRegistrationMatrix[4], currentRegistrationMatrix[5], currentRegistrationMatrix[6]],
        [currentRegistrationMatrix[8], currentRegistrationMatrix[9], currentRegistrationMatrix[10]]
      ];
      const T = [currentRegistrationMatrix[3], currentRegistrationMatrix[7], currentRegistrationMatrix[11]];
      
      // Get MRI bounds from actual loaded images, filtering out null/invalid values
      const mriSlicePositions = secondaryImages
        .map(img => parseFloat(img.sliceLocation))
        .filter(pos => !isNaN(pos) && pos !== null);
      
      if (mriSlicePositions.length === 0) {
        console.error("No valid MRI slice positions found");
        return;
      }
      
      const mriMinPos = Math.min(...mriSlicePositions);
      const mriMaxPos = Math.max(...mriSlicePositions);
      
      // Get CT bounds from current study
      const ctMinPos = Math.min(...images.map((img: any) => parseFloat(img.sliceLocation) || 0));
      const ctMaxPos = Math.max(...images.map((img: any) => parseFloat(img.sliceLocation) || 0));
      
      console.log(`CT bounds: [${ctMinPos.toFixed(1)}, ${ctMaxPos.toFixed(1)}]`);
      console.log(`MRI bounds: [${mriMinPos.toFixed(1)}, ${mriMaxPos.toFixed(1)}]`);
      
      // Get CT image position
      const ctImagePosition = ctImageMetadata.imagePosition || primaryImage.imagePosition;
      
      if (ctImagePosition) {
        const positions = typeof ctImagePosition === 'string'
          ? ctImagePosition.split('\\').map((p: string) => parseFloat(p))
          : ctImagePosition;
        if (positions.length >= 3) {
          ctX = positions[0];
          ctY = positions[1];
          ctZ = positions[2];
        }
      }
      
      // CRITICAL: Implement proper DICOM coordinate transformation chain
      // As per the guide: image coords → patient coords → registered coords → target image coords
      
      console.log(`Starting DICOM coordinate transformation...`);
      
      // Helper functions for matrix operations
      const multiplyMatrices = (a: number[][], b: number[][]): number[][] => {
        const result: number[][] = [];
        for (let i = 0; i < 4; i++) {
          result[i] = [];
          for (let j = 0; j < 4; j++) {
            result[i][j] = 0;
            for (let k = 0; k < 4; k++) {
              result[i][j] += a[i][k] * b[k][j];
            }
          }
        }
        return result;
      };
      
      const multiplyMatrixVector = (matrix: number[][], vector: number[]): number[] => {
        const result: number[] = [];
        for (let i = 0; i < 4; i++) {
          result[i] = 0;
          for (let j = 0; j < 4; j++) {
            result[i] += matrix[i][j] * vector[j];
          }
        }
        return result;
      };
      
      const invertMatrix4x4 = (m: number[][]): number[][] => {
        // Simplified inverse for transformation matrix
        // Extract rotation and translation parts
        const R_inv: number[][] = [
          [m[0][0], m[1][0], m[2][0], 0],
          [m[0][1], m[1][1], m[2][1], 0],
          [m[0][2], m[1][2], m[2][2], 0],
          [0, 0, 0, 1]
        ];
        
        // Compute -R^T * t
        const t = [m[0][3], m[1][3], m[2][3]];
        const t_inv = [
          -(R_inv[0][0] * t[0] + R_inv[0][1] * t[1] + R_inv[0][2] * t[2]),
          -(R_inv[1][0] * t[0] + R_inv[1][1] * t[1] + R_inv[1][2] * t[2]),
          -(R_inv[2][0] * t[0] + R_inv[2][1] * t[1] + R_inv[2][2] * t[2])
        ];
        
        R_inv[0][3] = t_inv[0];
        R_inv[1][3] = t_inv[1];
        R_inv[2][3] = t_inv[2];
        
        return R_inv;
      };
      
      // Build image-to-patient transformation matrix for CT
      const ctImageToPatient = (() => {
        const currentCT = images[currentIndex];
        if (!currentCT) return null;
        
        // Handle both string and array formats for imagePosition
        const imagePosition = currentCT.imagePosition ? 
          (typeof currentCT.imagePosition === 'string' 
            ? currentCT.imagePosition.split('\\').map((p: string) => parseFloat(p))
            : currentCT.imagePosition) : [0, 0, 0];
        const imageOrientation = currentCT.imageOrientation ? 
          (typeof currentCT.imageOrientation === 'string'
            ? currentCT.imageOrientation.split('\\').map((p: string) => parseFloat(p))
            : currentCT.imageOrientation) : [1, 0, 0, 0, 1, 0];
        const pixelSpacing = currentCT.pixelSpacing ? 
          (typeof currentCT.pixelSpacing === 'string'
            ? currentCT.pixelSpacing.split('\\').map((p: string) => parseFloat(p))
            : currentCT.pixelSpacing) : [1, 1];
        
        const rowVector = imageOrientation.slice(0, 3);
        const colVector = imageOrientation.slice(3, 6);
        
        // Calculate slice direction (cross product)
        const sliceVector = [
          rowVector[1] * colVector[2] - rowVector[2] * colVector[1],
          rowVector[2] * colVector[0] - rowVector[0] * colVector[2],
          rowVector[0] * colVector[1] - rowVector[1] * colVector[0]
        ];
        
        const sliceSpacing = 1.0; // Default slice spacing
        
        return [
          [rowVector[0] * pixelSpacing[1], colVector[0] * pixelSpacing[0], sliceVector[0] * sliceSpacing, imagePosition[0]],
          [rowVector[1] * pixelSpacing[1], colVector[1] * pixelSpacing[0], sliceVector[1] * sliceSpacing, imagePosition[1]],
          [rowVector[2] * pixelSpacing[1], colVector[2] * pixelSpacing[0], sliceVector[2] * sliceSpacing, imagePosition[2]],
          [0, 0, 0, 1]
        ];
      })();
      
      // For the current CT slice, we already have patient coordinates
      const ctPatientCoords = [ctX, ctY, ctZ, 1];
      
      console.log(`\n=== Starting DICOM Registration Fusion ===`);
      console.log(`CT slice location: ${primaryImage.sliceLocation}mm`);
      console.log(`CT patient coordinates: [${ctPatientCoords.slice(0,3).map(v => v.toFixed(1)).join(', ')}]`);
      console.log(`Number of MRI images available: ${secondaryImages.length}`);
      
      // Convert flat array to 4x4 matrix
      const regMatrix4x4 = [
        [currentRegistrationMatrix[0], currentRegistrationMatrix[1], currentRegistrationMatrix[2], currentRegistrationMatrix[3]],
        [currentRegistrationMatrix[4], currentRegistrationMatrix[5], currentRegistrationMatrix[6], currentRegistrationMatrix[7]],
        [currentRegistrationMatrix[8], currentRegistrationMatrix[9], currentRegistrationMatrix[10], currentRegistrationMatrix[11]],
        [currentRegistrationMatrix[12], currentRegistrationMatrix[13], currentRegistrationMatrix[14], currentRegistrationMatrix[15]]
      ];
      
      // The registration matrix transforms MRI to CT coordinates
      // We use it directly to find which MRI slice corresponds to this CT slice
      
      // Check cache first
      const cacheKey = currentIndex;
      const cached = mriSliceMappingCache.current.get(cacheKey);
      if (cached) {
        if (cached === null) {
          console.log("CT slice is outside MRI coverage (cached)");
          return;
        }
        closestSecondaryImage = secondaryImages[cached.mriIndex];
        minDistance = cached.distance;
        console.log(`Using cached MRI mapping: CT[${currentIndex}] -> MRI[${cached.mriIndex}] (distance: ${cached.distance.toFixed(1)}mm)`);
      } else {
        // Use pre-computed transformations for fast lookup
        const startTime = performance.now();
        if (transformedMRIPositions.current.length > 0) {
          // Quick check if CT is outside MRI range
          if (mriZRangeInCTSpace.current) {
            if (ctZ < mriZRangeInCTSpace.current.min - 5 || ctZ > mriZRangeInCTSpace.current.max + 5) {
              console.log(`CT slice at ${ctZ.toFixed(1)}mm is outside MRI coverage (${mriZRangeInCTSpace.current.min.toFixed(1)}-${mriZRangeInCTSpace.current.max.toFixed(1)}mm)`);
              mriSliceMappingCache.current.set(cacheKey, null);
              
              // Update fusion availability indicator
              setFusionAvailable(false);
              return;
            } else {
              setFusionAvailable(true);
            }
          }
          
          // Binary search for closest MRI slice (since they're sorted by slice location)
          let bestMatch = null;
          let bestDistance = Infinity;
          let bestIndex = -1;
          
          // Use binary search to find the closest match
          let left = 0;
          let right = transformedMRIPositions.current.length - 1;
          
          while (left <= right) {
            const mid = Math.floor((left + right) / 2);
            const midZ = transformedMRIPositions.current[mid].zInCT;
            const distance = Math.abs(midZ - ctZ);
            
            if (distance < bestDistance) {
              bestDistance = distance;
              bestMatch = transformedMRIPositions.current[mid].original;
              bestIndex = mid;
            }
            
            if (midZ < ctZ) {
              left = mid + 1;
            } else {
              right = mid - 1;
            }
          }
          
          // Also check neighbors for the absolute closest
          if (bestIndex > 0) {
            const prevDistance = Math.abs(transformedMRIPositions.current[bestIndex - 1].zInCT - ctZ);
            if (prevDistance < bestDistance) {
              bestDistance = prevDistance;
              bestMatch = transformedMRIPositions.current[bestIndex - 1].original;
              bestIndex = bestIndex - 1;
            }
          }
          if (bestIndex < transformedMRIPositions.current.length - 1) {
            const nextDistance = Math.abs(transformedMRIPositions.current[bestIndex + 1].zInCT - ctZ);
            if (nextDistance < bestDistance) {
              bestDistance = nextDistance;
              bestMatch = transformedMRIPositions.current[bestIndex + 1].original;
              bestIndex = bestIndex + 1;
            }
          }
          
          console.log(`⚡ Fast MRI lookup: Best match found in ${(performance.now() - startTime).toFixed(1)}ms (distance: ${bestDistance.toFixed(1)}mm)`);
          
          if (bestMatch && bestDistance < 10) {
            closestSecondaryImage = bestMatch;
            minDistance = bestDistance;
            const actualIndex = secondaryImages.indexOf(bestMatch);
            console.log(`✓ Found MRI slice: ${bestMatch.sliceLocation}mm (Z-distance: ${bestDistance.toFixed(1)}mm)`);
            mriSliceMappingCache.current.set(cacheKey, { mriIndex: actualIndex, distance: bestDistance });
            setFusionAvailable(true);
          } else {
            console.warn(`No MRI slice close enough. Best distance: ${bestDistance.toFixed(1)}mm`);
            mriSliceMappingCache.current.set(cacheKey, null);
            setFusionAvailable(false);
            return; // No fusion if MRI slice too far away
          }
        } else {
          // Fallback to computing on-the-fly if pre-computed data not available
          console.warn("Pre-computed MRI transformations not available, computing on-the-fly");
          
          // ... original computation code would go here as fallback ...
          mriSliceMappingCache.current.set(cacheKey, null);
          return;
        }
      } // Close the else block for cache check
    } else {
      // NO FALLBACK - fusion requires registration matrix
      console.error("CRITICAL: No registration matrix available - fusion cannot be displayed");
      setFusionAvailable(false);
      return;
    }
    
    if (!closestSecondaryImage) {
      console.error("No matching MRI slice found for fusion");
      return;
    }
    
    const secondaryIndex = secondaryImages.indexOf(closestSecondaryImage);
    console.log(`Rendering fusion: CT slice ${currentIndex} (${ctSlicePosition.toFixed(1)}mm) -> MRI slice ${secondaryIndex} (${closestSecondaryImage.sliceLocation}mm)`);
    console.log(`Secondary image SOP UID: ${closestSecondaryImage.sopInstanceUID}`);
    
    // Verify we're using registration matrix
    if (!registrationMatrix) {
      console.error(`CRITICAL: No registration matrix - fusion should not be rendering!`);
      return;
    }
    console.log(`✓ Using DICOM registration matrix for fusion alignment`);
    
    // Get the secondary image data from cache (use window reference to avoid closure issues)
    const currentCache = (window as any).secondaryImageCacheRef || secondaryImageCache;
    let secondaryImageData = currentCache.get(closestSecondaryImage.sopInstanceUID);
    if (!secondaryImageData) {
      console.warn(`Secondary image not found in cache, attempting to load: ${closestSecondaryImage.sopInstanceUID}`);
      
      // Try to load the image directly
      try {
        const imageResponse = await fetch(`/api/images/${closestSecondaryImage.sopInstanceUID}`);
        if (imageResponse.ok) {
          const arrayBuffer = await imageResponse.arrayBuffer();
          secondaryImageData = await parseDicomImage(arrayBuffer);
          
          if (secondaryImageData) {
            // Add to cache for future use
            secondaryImageCache.set(closestSecondaryImage.sopInstanceUID, secondaryImageData);
          }
        }
      } catch (error) {
        console.error("Failed to load secondary image:", error);
      }
      
      if (!secondaryImageData) {
        console.error("Could not load secondary image");
        return;
      }
    }
    
    // Optional: Enable interpolation for smoother transitions
    const enableInterpolation = true; // User can toggle this for performance vs quality
    let interpolatedImageData = secondaryImageData;
    
    if (enableInterpolation && minDistance > 1.0) { // Only interpolate if not exactly on a slice
      console.log(`Interpolating MRI slices for smoother fusion (distance: ${minDistance.toFixed(1)}mm)`);
      
      // Find adjacent slices for interpolation
      const currentMRIIndex = secondaryImages.indexOf(closestSecondaryImage);
      let prevImage = null, nextImage = null;
      let prevData = null, nextData = null;
      
      // Determine which adjacent slice to use based on CT position
      const ctIsAbove = ctZ > transformedMRIPositions.current.find(p => p.original === closestSecondaryImage)?.zInCT;
      
      if (ctIsAbove && currentMRIIndex < secondaryImages.length - 1) {
        nextImage = secondaryImages[currentMRIIndex + 1];
        nextData = secondaryImageCache.get(nextImage.sopInstanceUID);
      } else if (!ctIsAbove && currentMRIIndex > 0) {
        prevImage = secondaryImages[currentMRIIndex - 1];
        prevData = secondaryImageCache.get(prevImage.sopInstanceUID);
      }
      
      // Perform linear interpolation if we have adjacent data
      if ((prevData || nextData) && (secondaryImageData.width === (prevData?.width || nextData?.width))) {
        const adjacentData = prevData || nextData;
        const weight = Math.min(minDistance / 4.0, 0.5); // Cap interpolation weight at 0.5
        
        // Create interpolated image data
        const interpolatedArray = new Float32Array(secondaryImageData.data.length);
        for (let i = 0; i < secondaryImageData.data.length; i++) {
          interpolatedArray[i] = secondaryImageData.data[i] * (1 - weight) + adjacentData.data[i] * weight;
        }
        
        interpolatedImageData = {
          data: interpolatedArray,
          width: secondaryImageData.width,
          height: secondaryImageData.height
        };
        
        console.log(`Applied interpolation with weight: ${weight.toFixed(2)}`);
      }
    }
    
    secondaryImageData = interpolatedImageData;
    
    // Get primary image metadata for registration alignment
    const primaryImageData = imageCache.get(primaryImage.sopInstanceUID);
    if (!primaryImageData) {
      console.error("Primary image not found in cache for fusion");
      return;
    }
    
    // Create a temporary canvas for the secondary image
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = secondaryImageData.width;
    tempCanvas.height = secondaryImageData.height;
    const tempCtx = tempCanvas.getContext("2d");
    if (!tempCtx) return;
    
    // Render secondary image to temp canvas
    const imageData = tempCtx.createImageData(secondaryImageData.width, secondaryImageData.height);
    const data = imageData.data;
    
    // Apply window/level to secondary image (MRI typically needs different settings)
    // For MRI, first find the actual data range as MRI doesn't use Hounsfield Units
    let minPixelValue = Infinity;
    let maxPixelValue = -Infinity;
    
    // Find actual min/max values in the MRI data
    for (let i = 0; i < secondaryImageData.data.length; i++) {
      const value = secondaryImageData.data[i];
      if (value < minPixelValue) minPixelValue = value;
      if (value > maxPixelValue) maxPixelValue = value;
    }
    
    console.log(`MRI data range: min=${minPixelValue}, max=${maxPixelValue}`);
    
    // Check if DICOM metadata has window/level values
    let dicomCenter = null;
    let dicomWidth = null;
    
    if ('metadata' in secondaryImageData && secondaryImageData.metadata) {
      if (secondaryImageData.metadata.windowCenter) {
        dicomCenter = parseFloat(secondaryImageData.metadata.windowCenter);
      }
      if (secondaryImageData.metadata.windowWidth) {
        dicomWidth = parseFloat(secondaryImageData.metadata.windowWidth);
      }
    }
    
    // Auto-calculate window/level for MRI
    // Use a wider range to avoid oversaturation
    const dataRange = maxPixelValue - minPixelValue;
    
    // For T1-weighted images (like "AX T1 FS+C"), use different auto settings
    const isT1 = closestSecondaryImage.seriesDescription?.toLowerCase().includes('t1');
    const isContrast = closestSecondaryImage.seriesDescription?.toLowerCase().includes('+c');
    
    let autoCenter, autoWidth;
    
    if (dicomCenter && dicomWidth) {
      // Use DICOM metadata if available
      autoCenter = dicomCenter;
      autoWidth = dicomWidth;
      console.log(`Using DICOM window/level: C=${dicomCenter}, W=${dicomWidth}`);
    } else {
      // Calculate based on image type and statistics
      // Use percentile-based approach for better contrast
      const sortedValues = Array.from(secondaryImageData.data).sort((a, b) => a - b);
      const p5 = sortedValues[Math.floor(sortedValues.length * 0.05)];
      const p95 = sortedValues[Math.floor(sortedValues.length * 0.95)];
      
      if (isT1) {
        // T1 images: Use 5th-95th percentile range for better soft tissue contrast
        autoCenter = (p5 + p95) / 2;
        autoWidth = (p95 - p5) * (isContrast ? 1.2 : 1.0); // Slightly wider for contrast-enhanced
      } else {
        // Default MRI: Use percentile range
        autoCenter = (p5 + p95) / 2;
        autoWidth = (p95 - p5);
      }
      console.log(`Auto-calculated window/level for ${isT1 ? 'T1' : 'MRI'}: C=${autoCenter.toFixed(0)}, W=${autoWidth.toFixed(0)} (P5=${p5.toFixed(0)}, P95=${p95.toFixed(0)})`);
    }
    
    // Use manual window/level if set (width > 0), otherwise use auto values
    const center = mriWindowLevel.width > 0 ? mriWindowLevel.center : autoCenter;
    const width = mriWindowLevel.width > 0 ? mriWindowLevel.width : autoWidth;
    
    console.log(`MRI Window/Level - Center: ${center.toFixed(0)}, Width: ${width.toFixed(0)}, Series: ${closestSecondaryImage.seriesDescription || 'Unknown'}`);
    
    const min = center - width / 2;
    const max = center + width / 2;
    
    for (let i = 0; i < secondaryImageData.data.length; i++) {
      const pixelValue = secondaryImageData.data[i];
      let normalizedValue;
      
      if (pixelValue <= min) {
        normalizedValue = 0;
      } else if (pixelValue >= max) {
        normalizedValue = 255;
      } else {
        normalizedValue = ((pixelValue - min) / width) * 255;
      }
      
      const gray = Math.max(0, Math.min(255, normalizedValue));
      const pixelIndex = i * 4;
      
      // Use grayscale for MRI to avoid black overlay issue
      data[pixelIndex] = gray;        // R
      data[pixelIndex + 1] = gray;    // G
      data[pixelIndex + 2] = gray;    // B
      data[pixelIndex + 3] = 255;     // A
    }
    
    tempCtx.putImageData(imageData, 0, 0);
    
    // Calculate proper scaling and alignment
    const canvasWidth = ctx.canvas.width;
    const canvasHeight = ctx.canvas.height;
    
    // Get pixel spacing for both images
    const primarySpacing = primaryImage.pixelSpacing 
      ? (typeof primaryImage.pixelSpacing === 'string' 
        ? parseFloat(primaryImage.pixelSpacing.split('\\')[0])
        : parseFloat(primaryImage.pixelSpacing[0]))
      : 1;
    const secondarySpacing = closestSecondaryImage.pixelSpacing 
      ? (typeof closestSecondaryImage.pixelSpacing === 'string'
        ? parseFloat(closestSecondaryImage.pixelSpacing.split('\\')[0])
        : parseFloat(closestSecondaryImage.pixelSpacing[0]))
      : 0.5;
    
    // Calculate the scale ratio between images based on pixel spacing
    const spacingRatio = secondarySpacing / primarySpacing;
    
    // Calculate display scale for primary image
    const primaryBaseScale = Math.min(canvasWidth / primaryImageData.width, canvasHeight / primaryImageData.height);
    
    // Apply spacing ratio to match physical dimensions
    const secondaryBaseScale = primaryBaseScale * spacingRatio;
    
    // Calculate scaled dimensions for secondary image
    const scaledWidth = secondaryImageData.width * secondaryBaseScale;
    const scaledHeight = secondaryImageData.height * secondaryBaseScale;
    
    // Center the secondary image on canvas with pan offset
    const x = (canvasWidth - scaledWidth) / 2 + panX;
    const y = (canvasHeight - scaledHeight) / 2 + panY;
    
    console.log(`Base MRI position (before registration): x=${x.toFixed(1)}, y=${y.toFixed(1)}`);
    
    // Apply registration transformation if available
    ctx.save();
    // When fusionOpacity = 0: MRI invisible (alpha = 0), CT fully visible
    // When fusionOpacity = 1: MRI fully visible (alpha = 1), CT hidden
    ctx.globalAlpha = fusionOpacity;
    ctx.globalCompositeOperation = 'source-over';
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    
    if (registrationMatrix && registrationMatrix.length === 16) {
      console.log(`Applying DICOM registration transformation for proper X-Y alignment`);
      
      // Get image metadata for coordinate transformations
      const mriPosition = closestSecondaryImage.imagePosition 
        ? (typeof closestSecondaryImage.imagePosition === 'string'
          ? closestSecondaryImage.imagePosition.split('\\').map(Number)
          : closestSecondaryImage.imagePosition)
        : [-93.6495, -169.649, -160.851]; // Default MRI position
      
      const ctPosition = primaryImage.imagePosition
        ? (typeof primaryImage.imagePosition === 'string'
          ? primaryImage.imagePosition.split('\\').map(Number)
          : primaryImage.imagePosition)
        : [-249.512, -465.512, ctSlicePosition]; // Default CT position
      
      // Get pixel spacing
      const mriSpacing = closestSecondaryImage.pixelSpacing
        ? (typeof closestSecondaryImage.pixelSpacing === 'string'
          ? closestSecondaryImage.pixelSpacing.split('\\').map(Number)
          : closestSecondaryImage.pixelSpacing)
        : [0.507813, 0.507813];
      
      const ctSpacing = primaryImage.pixelSpacing
        ? (typeof primaryImage.pixelSpacing === 'string'
          ? primaryImage.pixelSpacing.split('\\').map(Number)
          : primaryImage.pixelSpacing)
        : [0.976563, 0.976563];
      
      // Convert registration matrix to 4x4
      const regMatrix4x4 = [
        [registrationMatrix[0], registrationMatrix[1], registrationMatrix[2], registrationMatrix[3]],
        [registrationMatrix[4], registrationMatrix[5], registrationMatrix[6], registrationMatrix[7]],
        [registrationMatrix[8], registrationMatrix[9], registrationMatrix[10], registrationMatrix[11]],
        [registrationMatrix[12], registrationMatrix[13], registrationMatrix[14], registrationMatrix[15]]
      ];
      
      // Helper function for matrix-vector multiplication
      const multiplyMatrixVectorLocal = (matrix: number[][], vector: number[]): number[] => {
        const result: number[] = [];
        for (let i = 0; i < 4; i++) {
          result[i] = 0;
          for (let j = 0; j < 4; j++) {
            result[i] += matrix[i][j] * vector[j];
          }
        }
        return result;
      };
      
      // Get MRI image dimensions
      const mriWidth = secondaryImageData.width;
      const mriHeight = secondaryImageData.height;
      
      // Calculate MRI center in physical space
      // MRI center = MRI origin + (width/2 * column_spacing, height/2 * row_spacing)
      const mriCenterPhysical = [
        mriPosition[0] + (mriWidth / 2) * mriSpacing[1],  // X: column spacing
        mriPosition[1] + (mriHeight / 2) * mriSpacing[0],  // Y: row spacing  
        mriPosition[2],  // Z
        1  // Homogeneous coordinate
      ];
      
      // Transform MRI center to CT space
      const mriCenterTransformed = multiplyMatrixVectorLocal(regMatrix4x4, mriCenterPhysical);
      
      // Calculate CT center in physical space
      const ctWidth = primaryImageData.width;
      const ctHeight = primaryImageData.height;
      const ctCenterPhysical = [
        ctPosition[0] + (ctWidth / 2) * ctSpacing[1],  // X: column spacing
        ctPosition[1] + (ctHeight / 2) * ctSpacing[0],  // Y: row spacing
        ctPosition[2]  // Z
      ];
      
      console.log(`MRI center physical: [${mriCenterPhysical[0].toFixed(1)}, ${mriCenterPhysical[1].toFixed(1)}, ${mriCenterPhysical[2].toFixed(1)}]`);
      console.log(`CT center physical: [${ctCenterPhysical[0].toFixed(1)}, ${ctCenterPhysical[1].toFixed(1)}, ${ctCenterPhysical[2].toFixed(1)}]`);
      console.log(`Transformed MRI center: [${mriCenterTransformed[0].toFixed(1)}, ${mriCenterTransformed[1].toFixed(1)}, ${mriCenterTransformed[2].toFixed(1)}]`);
      
      // Calculate offset between transformed MRI center and CT center
      const centerOffsetX = mriCenterTransformed[0] - ctCenterPhysical[0];
      const centerOffsetY = mriCenterTransformed[1] - ctCenterPhysical[1];
      
      console.log(`Center offset in mm: X=${centerOffsetX.toFixed(1)}, Y=${centerOffsetY.toFixed(1)}`);
      
      // Convert center offset to pixel offset 
      const pixelOffsetX = centerOffsetX / ctSpacing[1] * primaryBaseScale;
      const pixelOffsetY = centerOffsetY / ctSpacing[0] * primaryBaseScale;
      
      console.log(`Pixel offset: X=${pixelOffsetX.toFixed(1)}, Y=${pixelOffsetY.toFixed(1)}`);
      
      // Apply offset to center-aligned position
      const registeredX = x + pixelOffsetX;
      const registeredY = y + pixelOffsetY;
      
      ctx.drawImage(tempCanvas, registeredX, registeredY, scaledWidth, scaledHeight);
      console.log(`Registered draw position: x=${registeredX.toFixed(1)}, y=${registeredY.toFixed(1)}`);
    } else {
      // No registration - draw at center position
      ctx.drawImage(tempCanvas, x, y, scaledWidth, scaledHeight);
      console.warn(`No registration matrix - drawing MRI at center position`);
    }
    
    ctx.restore();
    
    console.log(`Rendered fusion overlay: opacity=${fusionOpacity}, registered=${!!registrationMatrix}`);
  };

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

    // SIMPLIFIED - NO ZOOM FOR DEBUGGING
    const baseScale = Math.min(canvasWidth / imageWidth, canvasHeight / imageHeight);
    // For a 512x512 image in 1024x1024 canvas, baseScale = 2
    
    // Just use base scale, ignore zoom completely
    const totalScale = baseScale; // NO ZOOM
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
    if (currentIndex < images.length - 1) {
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

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    // Check if brush tool is active - if so, skip pan functionality
    const isBrushActive =
      brushToolState?.isActive && brushToolState?.tool === "brush";

    // Only prevent default and stop propagation if brush tool is NOT active
    if (!isBrushActive) {
      e.preventDefault();
      e.stopPropagation();
    }

    if (e.button === 0 && !isBrushActive) {
      // Left click for pan (disabled during brush mode)
      setIsDragging(true);
      setDragStart({ x: e.clientX, y: e.clientY });
      setLastPanX(panX);
      setLastPanY(panY);
    } else if (e.button === 2 && !isBrushActive) {
      // Right click for window/level (disabled during brush mode)
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
    // Skip pan functionality if brush tool is active
    const isBrushActive =
      brushToolState?.isActive && brushToolState?.tool === "brush";

    // Only handle pan if brush tool is NOT active
    if (isDragging && !isBrushActive) {
      const deltaX = e.clientX - dragStart.x;
      const deltaY = e.clientY - dragStart.y;
      setPanX(lastPanX + deltaX);
      setPanY(lastPanY + deltaY);
    }
  };

  const handleCanvasMouseUp = () => {
    // Skip pan functionality if brush tool is active
    const isBrushActive =
      brushToolState?.isActive && brushToolState?.tool === "brush";

    if (!isBrushActive) {
      setIsDragging(false);
    }
  };

  const handleCanvasWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    // Always handle wheel events
    e.preventDefault();
    e.stopPropagation();

    // ZOOM DISABLED FOR DEBUGGING
    /*
    if (e.ctrlKey || e.metaKey) {
      // Ctrl+scroll for zoom
      const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
      setZoom((prev) => Math.max(0.1, Math.min(5, prev * zoomFactor)));
    } else {
    */
      // Regular scroll for slice navigation
      if (e.deltaY > 0) {
        goToNext();
      } else {
        goToPrevious();
      }
    //}
  };

  // ZOOM FUNCTIONS DISABLED FOR DEBUGGING
  /*
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
  */

  // ZOOM EXPOSURE DISABLED FOR DEBUGGING
  /*
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
  */

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
        <div className="text-center text-white">
          <div className="animate-spin w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full mx-auto mb-2"></div>
          <p>Loading CT scan...</p>
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
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-indigo-700">
        <div className="flex items-center space-x-2">
          <Badge className="bg-indigo-900 text-indigo-200">CT Scan</Badge>
          {images.length > 0 && (
            <Badge
              variant="outline"
              className="border-indigo-600 text-indigo-300"
            >
              {currentIndex + 1} / {images.length}
            </Badge>
          )}
          {secondarySeriesId && secondaryImages.length > 0 && (
            <Badge className={`flex items-center gap-1 ${
              secondaryModality === 'PT' 
                ? 'bg-yellow-900 text-yellow-200' 
                : 'bg-purple-900 text-purple-200'
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
              variant={showStructures ? "default" : "outline"}
              onClick={() => setShowStructures(!showStructures)}
              className="text-xs bg-green-600 hover:bg-green-700"
            >
              RT ({rtStructures?.structures?.length || 0})
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={goToPrevious}
            disabled={currentIndex === 0}
            className="border-indigo-600 hover:bg-indigo-800"
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={goToNext}
            disabled={currentIndex === images.length - 1}
            className="border-indigo-600 hover:bg-indigo-800"
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1 p-4 flex items-center justify-center">
        <div className="relative">
          <canvas
            ref={canvasRef}
            width={1024}
            height={1024}
            onMouseDown={brushToolState?.isActive && (brushToolState?.tool === "pen" || brushToolState?.tool === "pen-original") ? undefined : handleCanvasMouseDown}
            onMouseMove={brushToolState?.isActive && (brushToolState?.tool === "pen" || brushToolState?.tool === "pen-original") ? undefined : handleCanvasMouseMove}
            onMouseUp={brushToolState?.isActive && (brushToolState?.tool === "pen" || brushToolState?.tool === "pen-original") ? undefined : handleCanvasMouseUp}
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
              pointerEvents: brushToolState?.isActive && (brushToolState?.tool === "pen" || brushToolState?.tool === "pen-original" || brushToolState?.tool === "planar-contour") ? "none" : "auto",
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

          {/* Eclipse Pen Tool overlay */}
          {brushToolState?.isActive &&
            brushToolState?.tool === "pen" &&
            selectedForEdit && (
              <EclipsePenToolFixed
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

          {/* Eclipse Planar Contour Tool overlay */}
          {brushToolState?.isActive &&
            brushToolState?.tool === "planar-contour" &&
            selectedForEdit && (
              <EclipsePlanarContourTool
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

          {/* RT Structure Overlay removed - structures are rendered in displayCurrentImage */}

          {/* Current Window/Level and Z position display */}
          <div className="absolute top-2 right-2 bg-black bg-opacity-75 text-white px-2 py-1 rounded text-xs">
            <div>
              W:{Math.round(currentWindowLevel.width)} L:
              {Math.round(currentWindowLevel.center)}
            </div>
            {images.length > 0 && images[currentIndex] && (
              <div className="mt-1">
                Z:{" "}
                {images[currentIndex].parsedSliceLocation?.toFixed(1) ||
                  images[currentIndex].parsedZPosition?.toFixed(1) ||
                  currentIndex + 1}
              </div>
            )}
            {rtStructures && showStructures && (
              <div className="mt-1 text-green-400">
                RT Structures: {rtStructures?.structures?.length || 0} ROIs
              </div>
            )}
          </div>
          
          {/* Fusion Control Panel - Visible when study has secondary series available for fusion */}
          {studyId && props.secondarySeriesId !== undefined && props.hasSecondarySeriesForFusion && registrationMatrix && props.onSecondarySeriesSelect && props.onFusionOpacityChange && (
            <FusionControlPanel
              primarySeriesId={seriesId}
              studyId={studyId}
              onSecondarySeriesSelect={(id) => props.onSecondarySeriesSelect!(id ? id : 'none')}
              opacity={fusionOpacity}
              onOpacityChange={props.onFusionOpacityChange}
              isVisible={true}
              mriWindowLevel={mriWindowLevel}
              onMriWindowLevelChange={setMriWindowLevel}
              selectedSecondaryId={secondarySeriesId && secondarySeriesId !== 'none' ? secondarySeriesId : null}
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
