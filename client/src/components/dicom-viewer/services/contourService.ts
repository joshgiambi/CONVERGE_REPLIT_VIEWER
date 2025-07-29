/**
 * Contour service - handles all RT structure contour operations
 * Replaces the massive handleContourUpdate function from WorkingViewer
 */

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
import { performPolygonUnion } from "@/lib/polygon-union";
import { saveContourUpdates } from "./apiService";

export interface ContourUpdatePayload {
  action: string;
  seriesId: number;
  structureId?: number;
  slicePosition?: number;
  strokeData?: any;
  growthDistance?: number;
  points?: number[];
  operation?: string;
  [key: string]: any;
}

// Define action handlers as a map for cleaner code organization
const actionHandlers: Record<string, (payload: ContourUpdatePayload, currentStructures: any) => any> = {
  brush_stroke: handleBrushStroke,
  add_pen_stroke: handlePenStroke,
  add_contour: handleAddContour,
  replace_contour: handleReplaceContour,
  pen_boolean_operation: handlePenBooleanOperation,
  boolean_operation: handleBooleanOperation,
  grow_contour: handleGrowContour,
  directional_grow: handleDirectionalGrow,
  delete_slice: handleDeleteSlice,
  delete_nth_slice: handleDeleteNthSlice,
  clear_all: handleClearAll,
  clear_below: handleClearBelow,
  clear_above: handleClearAbove,
  interpolate: handleInterpolate,
  margin_operation: handleMarginOperation,
};

/**
 * Main contour update function - replaces the massive switch statement
 */
export async function updateContours(payload: ContourUpdatePayload, currentStructures: any): Promise<any> {
  console.log(`🔧 Processing contour action: ${payload.action}`, payload);
  
  const handler = actionHandlers[payload.action];
  if (!handler) {
    console.warn(`No handler for action: ${payload.action}`);
    return currentStructures;
  }
  
  try {
    const updatedStructures = handler(payload, currentStructures);
    
    // Save to server if we have a seriesId
    if (payload.seriesId) {
      await saveContourUpdates(payload.seriesId, payload);
    }
    
    return updatedStructures;
  } catch (error) {
    console.error(`Error processing ${payload.action}:`, error);
    throw error;
  }
}

/**
 * Handle brush stroke operations
 */
function handleBrushStroke(payload: ContourUpdatePayload, currentStructures: any): any {
  if (!currentStructures?.structures || !payload.strokeData) {
    return currentStructures;
  }

  const updatedStructures = JSON.parse(JSON.stringify(currentStructures));
  const structure = updatedStructures.structures.find((s: any) => s.roiNumber === payload.structureId);
  
  if (!structure) {
    console.warn(`Structure ${payload.structureId} not found for brush stroke`);
    return currentStructures;
  }

  // Convert brush stroke to polygon and add to structure
  const polygon = brushStrokeToPolishedPolygon(payload.strokeData.points, payload.strokeData.brushSize);
  
  // Find or create contour at current slice
  let contour = structure.contours.find((c: any) => 
    Math.abs(c.slicePosition - payload.slicePosition!) < 0.1
  );
  
  if (!contour) {
    contour = {
      slicePosition: payload.slicePosition,
      points: []
    };
    structure.contours.push(contour);
  }

  // Add brush stroke to existing contour using union
  if (contour.points.length > 0) {
    contour.points = performPolygonUnion([contour.points, polygon]);
  } else {
    contour.points = polygon;
  }

  return updatedStructures;
}

/**
 * Handle pen tool stroke operations
 */
function handlePenStroke(payload: ContourUpdatePayload, currentStructures: any): any {
  if (!currentStructures?.structures || !payload.points) {
    return currentStructures;
  }

  const updatedStructures = JSON.parse(JSON.stringify(currentStructures));
  const structure = updatedStructures.structures.find((s: any) => s.roiNumber === payload.structureId);
  
  if (!structure) {
    console.warn(`Structure ${payload.structureId} not found for pen stroke`);
    return currentStructures;
  }

  // Add new contour at current slice
  const newContour = {
    slicePosition: payload.slicePosition,
    points: payload.points
  };
  
  structure.contours.push(newContour);
  return updatedStructures;
}

/**
 * Handle adding new contours
 */
function handleAddContour(payload: ContourUpdatePayload, currentStructures: any): any {
  return handlePenStroke(payload, currentStructures);
}

/**
 * Handle replacing existing contours (morphing)
 */
function handleReplaceContour(payload: ContourUpdatePayload, currentStructures: any): any {
  if (!currentStructures?.structures || !payload.points) {
    return currentStructures;
  }

  const updatedStructures = JSON.parse(JSON.stringify(currentStructures));
  const structure = updatedStructures.structures.find((s: any) => s.roiNumber === payload.structureId);
  
  if (!structure) return currentStructures;

  // Find and replace the contour at the current slice
  const contourIndex = structure.contours.findIndex((c: any) => 
    Math.abs(c.slicePosition - payload.slicePosition!) < 0.1
  );
  
  if (contourIndex >= 0) {
    structure.contours[contourIndex].points = payload.points;
  }

  return updatedStructures;
}

/**
 * Handle pen tool boolean operations (union/subtract)
 */
function handlePenBooleanOperation(payload: ContourUpdatePayload, currentStructures: any): any {
  if (!currentStructures?.structures || !payload.points) {
    return currentStructures;
  }

  const updatedStructures = JSON.parse(JSON.stringify(currentStructures));
  const structure = updatedStructures.structures.find((s: any) => s.roiNumber === payload.structureId);
  
  if (!structure) return currentStructures;

  const existingContours = structure.contours
    .filter((c: any) => Math.abs(c.slicePosition - payload.slicePosition!) < 0.1)
    .map((c: any) => c.points);

  if (payload.operation === 'subtract' && existingContours.length > 0) {
    // Subtract new polygon from existing contours
    const resultContours = subtractContours(existingContours, [payload.points]);
    
    // Remove original contour and add results
    structure.contours = structure.contours.filter((c: any) => 
      Math.abs(c.slicePosition - payload.slicePosition!) >= 0.1
    );
    
    resultContours.forEach((contour: number[]) => {
      if (contour.length > 0) {
        structure.contours.push({
          slicePosition: payload.slicePosition,
          points: contour
        });
      }
    });
  } else {
    // Union operation (default)
    handlePenStroke(payload, updatedStructures);
  }

  return updatedStructures;
}

/**
 * Handle complex boolean operations
 */
function handleBooleanOperation(payload: ContourUpdatePayload, currentStructures: any): any {
  // Implementation for complex boolean operations between structures
  console.log('Processing boolean operation:', payload.operation);
  return currentStructures;
}

/**
 * Handle contour growing
 */
function handleGrowContour(payload: ContourUpdatePayload, currentStructures: any): any {
  if (!currentStructures?.structures || !payload.growthDistance) {
    return currentStructures;
  }

  const updatedStructures = JSON.parse(JSON.stringify(currentStructures));
  const structure = updatedStructures.structures.find((s: any) => s.roiNumber === payload.structureId);
  
  if (!structure) return currentStructures;

  // Grow all contours in the structure
  structure.contours.forEach((contour: any) => {
    if (contour.points && contour.points.length >= 6) {
      contour.points = growContour(contour.points, payload.growthDistance!);
    }
  });

  return updatedStructures;
}

/**
 * Handle directional growing
 */
function handleDirectionalGrow(payload: ContourUpdatePayload, currentStructures: any): any {
  if (!currentStructures?.structures) return currentStructures;

  const updatedStructures = JSON.parse(JSON.stringify(currentStructures));
  const structure = updatedStructures.structures.find((s: any) => s.roiNumber === payload.structureId);
  
  if (!structure) return currentStructures;

  // Apply directional grow to contours at current slice
  structure.contours
    .filter((c: any) => Math.abs(c.slicePosition - payload.slicePosition!) < 0.1)
    .forEach((contour: any) => {
      if (contour.points && contour.points.length >= 6) {
        contour.points = applyDirectionalGrow(
          contour.points, 
          payload.growthDistance || 5,
          payload.direction || 'up'
        );
      }
    });

  return updatedStructures;
}

/**
 * Handle slice deletion
 */
function handleDeleteSlice(payload: ContourUpdatePayload, currentStructures: any): any {
  if (!currentStructures?.structures) return currentStructures;

  const updatedStructures = JSON.parse(JSON.stringify(currentStructures));
  const structure = updatedStructures.structures.find((s: any) => s.roiNumber === payload.structureId);
  
  if (!structure) return currentStructures;

  // Remove contours at current slice
  structure.contours = structure.contours.filter((c: any) => 
    Math.abs(c.slicePosition - payload.slicePosition!) >= 0.1
  );

  return updatedStructures;
}

/**
 * Handle nth slice deletion
 */
function handleDeleteNthSlice(payload: ContourUpdatePayload, currentStructures: any): any {
  if (!currentStructures?.structures || !payload.nthSlice) return currentStructures;

  const updatedStructures = JSON.parse(JSON.stringify(currentStructures));
  const structure = updatedStructures.structures.find((s: any) => s.roiNumber === payload.structureId);
  
  if (!structure) return currentStructures;

  // Delete every nth slice
  const sortedContours = structure.contours.sort((a: any, b: any) => a.slicePosition - b.slicePosition);
  const toDelete = sortedContours.filter((_: any, index: number) => (index + 1) % payload.nthSlice === 0);
  
  structure.contours = structure.contours.filter((contour: any) => 
    !toDelete.some((deleteContour: any) => 
      Math.abs(contour.slicePosition - deleteContour.slicePosition) < 0.1
    )
  );

  return updatedStructures;
}

/**
 * Handle clearing all slices
 */
function handleClearAll(payload: ContourUpdatePayload, currentStructures: any): any {
  if (!currentStructures?.structures) return currentStructures;

  const updatedStructures = JSON.parse(JSON.stringify(currentStructures));
  const structure = updatedStructures.structures.find((s: any) => s.roiNumber === payload.structureId);
  
  if (structure) {
    structure.contours = [];
  }

  return updatedStructures;
}

/**
 * Handle clearing slices below current
 */
function handleClearBelow(payload: ContourUpdatePayload, currentStructures: any): any {
  if (!currentStructures?.structures) return currentStructures;

  const updatedStructures = JSON.parse(JSON.stringify(currentStructures));
  const structure = updatedStructures.structures.find((s: any) => s.roiNumber === payload.structureId);
  
  if (structure && payload.slicePosition !== undefined) {
    structure.contours = structure.contours.filter((c: any) => 
      c.slicePosition >= payload.slicePosition!
    );
  }

  return updatedStructures;
}

/**
 * Handle clearing slices above current
 */
function handleClearAbove(payload: ContourUpdatePayload, currentStructures: any): any {
  if (!currentStructures?.structures) return currentStructures;

  const updatedStructures = JSON.parse(JSON.stringify(currentStructures));
  const structure = updatedStructures.structures.find((s: any) => s.roiNumber === payload.structureId);
  
  if (structure && payload.slicePosition !== undefined) {
    structure.contours = structure.contours.filter((c: any) => 
      c.slicePosition <= payload.slicePosition!
    );
  }

  return updatedStructures;
}

/**
 * Handle contour interpolation
 */
function handleInterpolate(payload: ContourUpdatePayload, currentStructures: any): any {
  if (!currentStructures?.structures) return currentStructures;

  const updatedStructures = JSON.parse(JSON.stringify(currentStructures));
  const structure = updatedStructures.structures.find((s: any) => s.roiNumber === payload.structureId);
  
  if (!structure) return currentStructures;

  // Find gaps in contours and interpolate
  const sortedContours = structure.contours.sort((a: any, b: any) => a.slicePosition - b.slicePosition);
  const interpolatedContours: any[] = [];

  for (let i = 0; i < sortedContours.length - 1; i++) {
    const current = sortedContours[i];
    const next = sortedContours[i + 1];
    const gap = next.slicePosition - current.slicePosition;

    interpolatedContours.push(current);

    // If gap > slice thickness, interpolate
    if (gap > 2.5) { // Assuming 2mm slice thickness
      const steps = Math.floor(gap / 2.0);
      for (let step = 1; step < steps; step++) {
        const alpha = step / steps;
        const interpolatedContour = predictNextSliceContour(current.points, next.points, alpha);
        
        if (interpolatedContour && interpolatedContour.length > 0) {
          interpolatedContours.push({
            slicePosition: current.slicePosition + (step * 2.0),
            points: interpolatedContour
          });
        }
      }
    }
  }

  if (sortedContours.length > 0) {
    interpolatedContours.push(sortedContours[sortedContours.length - 1]);
  }

  structure.contours = interpolatedContours;
  return updatedStructures;
}

/**
 * Handle margin operations
 */
function handleMarginOperation(payload: ContourUpdatePayload, currentStructures: any): any {
  console.log('Processing margin operation:', payload);
  return handleGrowContour(payload, currentStructures);
}