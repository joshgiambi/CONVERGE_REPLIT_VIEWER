/**
 * Next Slice Prediction Algorithm for Medical Imaging Contours
 * 
 * This algorithm predicts contours on adjacent slices based on the current slice's contour.
 * It uses anatomical coherence principles - structures typically change gradually between slices.
 */

import { PredictionHistoryManager, type ContourSnapshot, type TrendAnalysis } from './prediction-history-manager';
import { 
  refineContourWithImageData, 
  type ImageData, 
  type RegionCharacteristics 
} from './image-aware-prediction';

export type PropagationMode = 'conservative' | 'moderate' | 'aggressive';

export interface PredictionParams {
  currentContour: number[]; // Current slice contour points [x,y,z,x,y,z,...]
  currentSlicePosition: number;
  targetSlicePosition: number;
  anatomicalRegion?: 'head' | 'neck' | 'thorax' | 'abdomen' | 'pelvis';
  predictionMode?: 'simple' | 'adaptive' | 'trend-based';
  confidenceThreshold?: number; // 0-1, determines when to stop propagating
  historyManager?: PredictionHistoryManager;
  allContours?: Map<number, number[]>; // All contours in the structure by slice position
  
  // Image-aware refinement (optional)
  imageData?: {
    currentSlice?: ImageData;
    targetSlice?: ImageData;
    referenceSlices?: { contour: number[]; imageData: ImageData }[];
  };
  coordinateTransforms?: {
    worldToPixel: (x: number, y: number) => [number, number];
    pixelToWorld: (x: number, y: number) => [number, number];
  };
  enableImageRefinement?: boolean;
}

export interface PredictionResult {
  predictedContour: number[];
  confidence: number; // 0-1, how confident we are in the prediction
  adjustments: {
    scale: number;
    centerShift: { x: number; y: number };
    deformation: number; // Amount of shape change
  };
  metadata?: {
    method: string;
    historySize: number;
    trendAnalysis?: TrendAnalysis;
    imageRefinement?: {
      applied: boolean;
      edgeSnapped: boolean;
      validated: boolean;
      similarity?: number;
      regionCharacteristics?: RegionCharacteristics;
    };
    fallbackApplied?: boolean;
    notes?: string;
  };
}

/**
 * Calculate the centroid of a contour
 */
function calculateCentroid(points: number[]): { x: number; y: number } {
  let sumX = 0, sumY = 0;
  const numPoints = points.length / 3;
  
  for (let i = 0; i < points.length; i += 3) {
    sumX += points[i];
    sumY += points[i + 1];
  }
  
  return {
    x: sumX / numPoints,
    y: sumY / numPoints
  };
}

/**
 * Calculate the area of a contour using the shoelace formula
 */
function calculateContourArea(points: number[]): number {
  let area = 0;
  const n = points.length / 3;
  
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const xi = points[i * 3];
    const yi = points[i * 3 + 1];
    const xj = points[j * 3];
    const yj = points[j * 3 + 1];
    
    area += xi * yj - xj * yi;
  }
  
  return Math.abs(area) / 2;
}

const TWO_PI = Math.PI * 2;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clampVector(
  shift: { x: number; y: number },
  limit: number
): { x: number; y: number } {
  const magnitude = Math.sqrt(shift.x * shift.x + shift.y * shift.y);
  if (magnitude <= limit || magnitude === 0) {
    return shift;
  }
  const scale = limit / magnitude;
  return { x: shift.x * scale, y: shift.y * scale };
}

function buildRadialProfile(
  contour: number[],
  centroid: { x: number; y: number },
  sampleCount = 72
): Float64Array {
  const radii = new Float64Array(sampleCount);
  const weights = new Float64Array(sampleCount);

  for (let i = 0; i < contour.length; i += 3) {
    const dx = contour[i] - centroid.x;
    const dy = contour[i + 1] - centroid.y;
    const radius = Math.sqrt(dx * dx + dy * dy);
    if (!Number.isFinite(radius) || radius === 0) continue;

    const angle = Math.atan2(dy, dx);
    const normalized = ((angle % TWO_PI) + TWO_PI) % TWO_PI;
    const position = (normalized / TWO_PI) * sampleCount;
    const idx = Math.floor(position) % sampleCount;
    const nextIdx = (idx + 1) % sampleCount;
    const frac = position - Math.floor(position);

    radii[idx] += radius * (1 - frac);
    weights[idx] += (1 - frac);
    radii[nextIdx] += radius * frac;
    weights[nextIdx] += frac;
  }

  // Fill gaps by linear interpolation using nearest available values
  for (let i = 0; i < sampleCount; i++) {
    if (weights[i] === 0) {
      // Search outward for nearest populated bins
      let left = i;
      let right = i;
      while (weights[left] === 0 && weights[right] === 0) {
        left = (left - 1 + sampleCount) % sampleCount;
        right = (right + 1) % sampleCount;
        if (left === right) break;
      }
      const leftRadius = weights[left] > 0 ? radii[left] / weights[left] : 0;
      const rightRadius = weights[right] > 0 ? radii[right] / weights[right] : leftRadius;
      radii[i] = (leftRadius + rightRadius) / 2;
      weights[i] = 1;
    } else {
      radii[i] /= weights[i];
    }
  }

  // Smooth profile slightly to avoid jitter
  const smoothed = new Float64Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    const prev = (i - 1 + sampleCount) % sampleCount;
    const next = (i + 1) % sampleCount;
    smoothed[i] = (radii[prev] + radii[i] * 2 + radii[next]) / 4;
  }

  return smoothed;
}

function getProfileValue(
  profile: Float64Array,
  angle: number
): number {
  const sampleCount = profile.length;
  if (sampleCount === 0) return 0;
  const normalized = ((angle % TWO_PI) + TWO_PI) % TWO_PI;
  const position = (normalized / TWO_PI) * sampleCount;
  const baseIndex = Math.floor(position) % sampleCount;
  const nextIndex = (baseIndex + 1) % sampleCount;
  const frac = position - Math.floor(position);
  return profile[baseIndex] * (1 - frac) + profile[nextIndex] * frac;
}

function smoothContourInPlace(points: number[], iterations = 1, smoothing = 0.2): void {
  if (points.length < 9) return;
  const totalPoints = points.length / 3;
  const buffer = new Array<number>(points.length);

  for (let iter = 0; iter < iterations; iter++) {
    for (let i = 0; i < totalPoints; i++) {
      const prev = (i - 1 + totalPoints) % totalPoints;
      const next = (i + 1) % totalPoints;

      const idx = i * 3;
      const prevIdx = prev * 3;
      const nextIdx = next * 3;

      const avgX = (points[prevIdx] + points[idx] + points[nextIdx]) / 3;
      const avgY = (points[prevIdx + 1] + points[idx + 1] + points[nextIdx + 1]) / 3;

      buffer[idx] = points[idx] * (1 - smoothing) + avgX * smoothing;
      buffer[idx + 1] = points[idx + 1] * (1 - smoothing) + avgY * smoothing;
      buffer[idx + 2] = points[idx + 2]; // Preserve slice position
    }

    for (let i = 0; i < points.length; i++) {
      points[i] = buffer[i];
    }
  }
}

/**
 * Simple prediction: Direct copy with slight scaling based on anatomical region
 */
function simplePrediction(
  currentContour: number[],
  sliceDistance: number,
  targetZ?: number,
  anatomicalRegion?: string
): PredictionResult {
  // Default scaling factors based on typical anatomical changes
  const scalingFactors: Record<string, number> = {
    head: 0.98,    // Head structures shrink slightly superior to inferior
    neck: 1.02,    // Neck structures expand slightly
    thorax: 1.0,   // Thorax relatively stable
    abdomen: 1.01, // Abdomen slight expansion
    pelvis: 0.99   // Pelvis slight contraction
  };
  
  const scaleFactor = anatomicalRegion ? scalingFactors[anatomicalRegion] || 1.0 : 1.0;
  const scaleAdjustment = 1 + (scaleFactor - 1) * Math.abs(sliceDistance) / 5; // Gradual change
  
  const centroid = calculateCentroid(currentContour);
  const predictedContour: number[] = [];
  
  // Apply scaling around centroid
  for (let i = 0; i < currentContour.length; i += 3) {
    const x = currentContour[i];
    const y = currentContour[i + 1];
    
    // Scale points relative to centroid
    const scaledX = centroid.x + (x - centroid.x) * scaleAdjustment;
    const scaledY = centroid.y + (y - centroid.y) * scaleAdjustment;
    
    const sourceZ = currentContour[i + 2];
    const finalZ = targetZ ?? (sourceZ + sliceDistance);
    predictedContour.push(scaledX, scaledY, finalZ);
  }
  
  return {
    predictedContour,
    confidence: Math.max(0, 1 - Math.abs(sliceDistance) * 0.1), // Confidence decreases with distance
    adjustments: {
      scale: scaleAdjustment,
      centerShift: { x: 0, y: 0 },
      deformation: 0
    }
  };
}

/**
 * Adaptive prediction: Considers contour shape changes and applies smooth deformation
 */
function adaptivePrediction(
  currentContour: number[],
  previousContour: number[] | null,
  sliceDistance: number,
  targetZ: number
): PredictionResult {
  if (!previousContour || previousContour.length < 9) {
    return {
      predictedContour: [],
      confidence: 0,
      adjustments: {
        scale: 1,
        centerShift: { x: 0, y: 0 },
        deformation: 0
      },
      metadata: {
        method: 'adaptive',
        historySize: previousContour ? 1 : 0,
        notes: 'Insufficient reference contours for adaptive prediction.'
      }
    };
  }

  const currentCentroid = calculateCentroid(currentContour);
  const prevCentroid = calculateCentroid(previousContour);

  const currentArea = calculateContourArea(currentContour);
  const prevArea = Math.max(calculateContourArea(previousContour), 1e-3);

  const areaChangeRate = (currentArea - prevArea) / prevArea;
  const sign = Math.sign(sliceDistance) || 1;
  const absDistance = Math.max(1, Math.abs(sliceDistance));

  const scaleLimit = Math.min(0.35 * absDistance, 0.55);
  const scaleAdjustment = clamp(1 + areaChangeRate, 1 - scaleLimit, 1 + scaleLimit);

  const centerShiftTrend = {
    x: currentCentroid.x - prevCentroid.x,
    y: currentCentroid.y - prevCentroid.y
  };
  const projectedShift = {
    x: centerShiftTrend.x * sign,
    y: centerShiftTrend.y * sign
  };
  const shiftLimit = Math.max(1.0, 0.6 * absDistance);
  const limitedShift = clampVector(projectedShift, shiftLimit);

  const predictedCentroid = {
    x: currentCentroid.x + limitedShift.x,
    y: currentCentroid.y + limitedShift.y
  };

  const sampleCount = 96;
  const currentProfile = buildRadialProfile(currentContour, currentCentroid, sampleCount);
  const previousProfile = buildRadialProfile(previousContour, prevCentroid, sampleCount);
  const radialTrendProfile = new Float64Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    radialTrendProfile[i] = currentProfile[i] - previousProfile[i];
  }

  const predictedContour: number[] = [];
  let totalRadialDiff = 0;
  let radiusSum = 0;

  for (let i = 0; i < currentContour.length; i += 3) {
    const x = currentContour[i];
    const y = currentContour[i + 1];

    const dx = x - currentCentroid.x;
    const dy = y - currentCentroid.y;
    const currentRadius = Math.sqrt(dx * dx + dy * dy) || 0.5;
    const angle = Math.atan2(dy, dx);

    const trendDelta = getProfileValue(radialTrendProfile, angle) * sign;
    const targetBaseRadius = currentRadius * scaleAdjustment + trendDelta;

    const minRadius = Math.max(currentRadius * (1 - scaleLimit), currentRadius * 0.6, 0.5);
    const maxRadius = Math.max(currentRadius * (1 + scaleLimit), minRadius + 0.2);
    const predictedRadius = clamp(targetBaseRadius, minRadius, maxRadius);

    const cosAngle = Math.cos(angle);
    const sinAngle = Math.sin(angle);

    const predictedX = predictedCentroid.x + cosAngle * predictedRadius;
    const predictedY = predictedCentroid.y + sinAngle * predictedRadius;

    predictedContour.push(predictedX, predictedY, targetZ);

    totalRadialDiff += Math.abs(predictedRadius - currentRadius);
    radiusSum += currentRadius;
  }

  smoothContourInPlace(predictedContour, 2, 0.18);

  const predictedArea = calculateContourArea(predictedContour);
  const areaChange = Math.abs(predictedArea - currentArea) / Math.max(currentArea, 1e-3);
  const averageRadius = radiusSum / Math.max(currentContour.length / 3, 1);
  const radialChange = totalRadialDiff / Math.max(radiusSum, 1);
  const shiftMagnitude = Math.sqrt(limitedShift.x * limitedShift.x + limitedShift.y * limitedShift.y);

  const deformation = areaChange + radialChange * 0.5 + shiftMagnitude * 0.02;
  const confidence = clamp(1 - deformation - Math.abs(sliceDistance) * 0.05, 0, 1);

  return {
    predictedContour,
    confidence,
    adjustments: {
      scale: scaleAdjustment,
      centerShift: limitedShift,
      deformation
    },
    metadata: {
      method: 'adaptive-shape',
      historySize: 2,
      notes: 'Shape-aware adaptive prediction with radial trend continuation.'
    }
  };
}

/**
 * Trend-based prediction using history manager
 * Most accurate when we have multiple slices to analyze trends
 */
function trendBasedPrediction(
  historyManager: PredictionHistoryManager,
  currentSlicePosition: number,
  targetSlicePosition: number
): PredictionResult {
  const trend = historyManager.analyzeTrend();
  const currentSnapshot = historyManager.getContour(currentSlicePosition);
  
  if (!currentSnapshot) {
    // Fallback: try to find nearest contour
    const { before, after } = historyManager.getNearestContours(currentSlicePosition);
    const nearestSnapshot = before || after;
    
    if (!nearestSnapshot) {
      return {
        predictedContour: [],
        confidence: 0,
        adjustments: { scale: 1, centerShift: { x: 0, y: 0 }, deformation: 0 },
        metadata: { method: 'trend-based', historySize: 0 }
      };
    }
    
    // Use nearest as current
    return trendBasedPredictionFromSnapshot(nearestSnapshot, targetSlicePosition, trend, historyManager);
  }
  
  return trendBasedPredictionFromSnapshot(currentSnapshot, targetSlicePosition, trend, historyManager);
}

function trendBasedPredictionFromSnapshot(
  snapshot: ContourSnapshot,
  targetSlicePosition: number,
  trend: TrendAnalysis,
  historyManager: PredictionHistoryManager
): PredictionResult {
  const sliceDistance = targetSlicePosition - snapshot.slicePosition;
  const currentContour = snapshot.contour;
  const currentDescriptor = snapshot.descriptor;
  
  // Predict area change
  const predictedAreaChange = trend.areaChangeRate * sliceDistance;
  const scaleFactor = Math.sqrt(1 + predictedAreaChange);
  
  // Predict centroid shift
  const predictedCentroidShift = {
    x: trend.centroidDrift.x * sliceDistance,
    y: trend.centroidDrift.y * sliceDistance
  };
  
  const newCentroid = {
    x: currentDescriptor.centroid.x + predictedCentroidShift.x,
    y: currentDescriptor.centroid.y + predictedCentroidShift.y
  };
  
  // Generate predicted contour
  const predictedContour: number[] = [];
  for (let i = 0; i < currentContour.length; i += 3) {
    const x = currentContour[i];
    const y = currentContour[i + 1];
    
    // Scale around current centroid, then shift to new centroid
    const dx = x - currentDescriptor.centroid.x;
    const dy = y - currentDescriptor.centroid.y;
    
    const scaledX = newCentroid.x + dx * scaleFactor;
    const scaledY = newCentroid.y + dy * scaleFactor;
    
    // Use targetSlicePosition directly instead of z + sliceDistance to avoid floating point accumulation
    predictedContour.push(scaledX, scaledY, targetSlicePosition);
  }
  
  // Calculate confidence using history manager
  const confidence = historyManager.calculateConfidence(snapshot.slicePosition, targetSlicePosition);
  
  return {
    predictedContour,
    confidence,
    adjustments: {
      scale: scaleFactor,
      centerShift: predictedCentroidShift,
      deformation: Math.abs(predictedAreaChange)
    },
    metadata: {
      method: 'trend-based',
      historySize: historyManager.size(),
      trendAnalysis: trend
    }
  };
}

/**
 * Main prediction function that orchestrates different prediction modes
 */
export function predictNextSliceContour(params: PredictionParams): PredictionResult {
  const {
    currentContour,
    currentSlicePosition,
    targetSlicePosition,
    anatomicalRegion,
    predictionMode = 'adaptive',
    confidenceThreshold = 0.3,
    historyManager,
    allContours,
    imageData,
    coordinateTransforms,
    enableImageRefinement = true
  } = params;
  
  if (!currentContour || currentContour.length < 9) { // Need at least 3 points
    return {
      predictedContour: [],
      confidence: 0,
      adjustments: { scale: 1, centerShift: { x: 0, y: 0 }, deformation: 0 },
      metadata: { method: 'none', historySize: 0 }
    };
  }
  
  const sliceDistance = targetSlicePosition - currentSlicePosition;
  
  let result: PredictionResult;
  const findNearestContour = (): number[] | null => {
    if (!allContours || allContours.size === 0) return null;
    let bestContour: number[] | null = null;
    let bestDist = Infinity;
    allContours.forEach((contourPoints, slicePos) => {
      const dist = Math.abs(slicePos - currentSlicePosition);
      if (dist > 1e-3 && dist < bestDist) {
        bestDist = dist;
        bestContour = contourPoints;
      }
    });
    return bestContour;
  };
  
  switch (predictionMode) {
    case 'simple':
      result = simplePrediction(currentContour, sliceDistance, targetSlicePosition, anatomicalRegion);
      break;
      
    case 'adaptive': {
      // Try to find previous contour for adaptive prediction
      let previousContour: number[] | null = null;
      if (allContours && allContours.size > 0) {
        previousContour = findNearestContour();
      }
      result = adaptivePrediction(currentContour, previousContour, sliceDistance, targetSlicePosition);
      break;
    }
      
    case 'trend-based': {
      // Use history manager for trend-based prediction
      if (historyManager && historyManager.size() >= 2) {
        result = trendBasedPrediction(historyManager, currentSlicePosition, targetSlicePosition);
      } else {
        // Fall back to adaptive if not enough history
        const fallbackContour = findNearestContour();
        result = adaptivePrediction(currentContour, fallbackContour, sliceDistance, targetSlicePosition);
      }
      break;
    }
      
    default:
      result = simplePrediction(currentContour, sliceDistance, targetSlicePosition, anatomicalRegion);
  }
  
  // Apply image-aware refinement if enabled and image data available
  if (enableImageRefinement && 
      imageData?.targetSlice && 
      coordinateTransforms &&
      result.predictedContour.length > 0) {
    
    try {
      const { refinedContour, confidence: imageConfidence, metadata: refinementMetadata } = 
        refineContourWithImageData(
          result.predictedContour,
          imageData.referenceSlices || [],
          imageData.targetSlice,
          coordinateTransforms.worldToPixel,
          coordinateTransforms.pixelToWorld,
          {
            snapToEdges: true,
            validateSimilarity: imageData.referenceSlices && imageData.referenceSlices.length > 0,
            searchRadius: 10,
            edgeThreshold: 50
          }
        );
      
      // Combine geometric and image-based confidence
      result.predictedContour = refinedContour;
      result.confidence = (result.confidence * 0.5) + (imageConfidence * 0.5);
      
      // Add refinement metadata
      if (!result.metadata) {
        result.metadata = { method: predictionMode as string, historySize: 0 };
      }
      result.metadata.imageRefinement = {
        applied: true,
        edgeSnapped: refinementMetadata.edgeSnapped,
        validated: refinementMetadata.validated,
        similarity: refinementMetadata.similarity,
        regionCharacteristics: refinementMetadata.regionCharacteristics
      };
      
    } catch (error) {
      console.warn('Image refinement failed, using geometric prediction only:', error);
      if (!result.metadata) {
        result.metadata = { method: predictionMode as string, historySize: 0 };
      }
      result.metadata.imageRefinement = {
        applied: false,
        edgeSnapped: false,
        validated: false
      };
    }
  }
  
  // Don't return prediction if confidence is too low
  if (result.confidence < confidenceThreshold) {
    return {
      ...result,
      predictedContour: [],
      confidence: 0
    };
  }
  
  return result;
}

/**
 * Predict contours for multiple adjacent slices based on propagation mode
 */
export function predictMultipleSlices(
  currentContour: number[],
  currentSlicePosition: number,
  mode: PropagationMode = 'moderate',
  params: Partial<PredictionParams> = {}
): Map<number, PredictionResult> {
  const predictions = new Map<number, PredictionResult>();
  
  // Determine target slices based on mode
  let targetOffsets: number[] = [];
  let minConfidence = 0.3;
  
  switch (mode) {
    case 'conservative':
      targetOffsets = [-1, 1]; // Only immediate neighbors
      minConfidence = 0.5;
      break;
    case 'moderate':
      targetOffsets = [-2, -1, 1, 2]; // ±1, ±2
      minConfidence = 0.4;
      break;
    case 'aggressive':
      targetOffsets = [-3, -2, -1, 1, 2, 3]; // Limit to ±3 slices
      minConfidence = 0.3;
      break;
  }
  
  // Sort by absolute distance (closest first)
  targetOffsets.sort((a, b) => Math.abs(a) - Math.abs(b));
  
  for (const offset of targetOffsets) {
    const targetPosition = currentSlicePosition + offset;
    
    const prediction = predictNextSliceContour({
      currentContour,
      currentSlicePosition,
      targetSlicePosition: targetPosition,
      confidenceThreshold: minConfidence,
      ...params
    });
    
    // Only include if confidence meets threshold
    if (prediction.confidence >= minConfidence && prediction.predictedContour.length > 0) {
      predictions.set(targetPosition, prediction);
    } else {
      // Stop propagating in this direction if confidence too low
      if (mode === 'aggressive') {
        // For aggressive mode, stop propagating further in this direction
        const direction = Math.sign(offset);
        if (direction !== 0) {
          // Remove any predictions further in this direction
          const toRemove: number[] = [];
          for (const pos of predictions.keys()) {
            if (Math.sign(pos - currentSlicePosition) === direction && 
                Math.abs(pos - currentSlicePosition) > Math.abs(offset)) {
              toRemove.push(pos);
            }
          }
          toRemove.forEach(pos => predictions.delete(pos));
        }
        break;
      }
    }
  }
  
  return predictions;
}

/**
 * Get suggested propagation mode based on structure characteristics
 */
export function suggestPropagationMode(historyManager?: PredictionHistoryManager): PropagationMode {
  if (!historyManager || historyManager.size() < 2) {
    return 'conservative';
  }
  
  const trend = historyManager.analyzeTrend();
  
  // Use aggressive if structure is stable and consistent
  if (trend.shapeStability > 0.8 && trend.consistency > 0.7) {
    return 'aggressive';
  }
  
  // Use conservative if structure is changing rapidly
  if (trend.shapeStability < 0.5 || Math.abs(trend.areaChangeRate) > 0.15) {
    return 'conservative';
  }
  
  // Default to moderate
  return 'moderate';
}

/**
 * Apply smooth interpolation between two contours
 */
export function interpolateContours(
  contour1: number[],
  contour2: number[],
  slicePosition1: number,
  slicePosition2: number,
  targetSlicePosition: number
): number[] {
  if (contour1.length !== contour2.length) {
    console.warn('Contours have different point counts, using shape-preserving interpolation');
    // Use shape-preserving interpolation when point counts differ
    return interpolateContoursWithResampling(contour1, contour2, slicePosition1, slicePosition2, targetSlicePosition);
  }
  
  const t = (targetSlicePosition - slicePosition1) / (slicePosition2 - slicePosition1);
  
  // Apply easing function to maintain volume better
  // This reduces shrinkage by using a smoother interpolation curve
  const easedT = easeInOutCubic(t);
  
  const interpolatedContour: number[] = [];
  
  for (let i = 0; i < contour1.length; i += 3) {
    const x = contour1[i] + (contour2[i] - contour1[i]) * easedT;
    const y = contour1[i + 1] + (contour2[i + 1] - contour1[i + 1]) * easedT;
    
    // Use targetSlicePosition directly for consistency and to avoid floating point accumulation
    interpolatedContour.push(x, y, targetSlicePosition);
  }
  
  return interpolatedContour;
}

// Easing function to reduce shrinkage during interpolation
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// Shape-preserving interpolation with resampling
function interpolateContoursWithResampling(
  contour1: number[],
  contour2: number[],
  slicePosition1: number,
  slicePosition2: number,
  targetSlicePosition: number
): number[] {
  // Calculate centroids (only X,Y - ignore Z)
  const centroid1 = calculateCentroid(contour1);
  const centroid2 = calculateCentroid(contour2);
  
  const t = (targetSlicePosition - slicePosition1) / (slicePosition2 - slicePosition1);
  const easedT = easeInOutCubic(t);
  
  // Interpolate centroid (X,Y only)
  const interpolatedCentroid = {
    x: centroid1.x + (centroid2.x - centroid1.x) * easedT,
    y: centroid1.y + (centroid2.y - centroid1.y) * easedT
  };
  
  // Calculate average radius to maintain area
  const radius1 = calculateAverageRadius2D(contour1, centroid1);
  const radius2 = calculateAverageRadius2D(contour2, centroid2);
  const interpolatedRadius = radius1 + (radius2 - radius1) * easedT;
  
  // Generate interpolated contour based on the larger contour's shape
  const largerContour = contour1.length >= contour2.length ? contour1 : contour2;
  const largerCentroid = contour1.length >= contour2.length ? centroid1 : centroid2;
  
  const interpolatedContour: number[] = [];
  
  for (let i = 0; i < largerContour.length; i += 3) {
    // Get direction from centroid
    const dx = largerContour[i] - largerCentroid.x;
    const dy = largerContour[i + 1] - largerCentroid.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    
    // Normalize and scale by interpolated radius
    const x = interpolatedCentroid.x + (dx / dist) * interpolatedRadius;
    const y = interpolatedCentroid.y + (dy / dist) * interpolatedRadius;
    
    // Use targetSlicePosition directly for consistency
    interpolatedContour.push(x, y, targetSlicePosition);
  }
  
  return interpolatedContour;
}

function calculateAverageRadius2D(contour: number[], centroid: { x: number; y: number }): number {
  let sumRadius = 0;
  const pointCount = contour.length / 3;
  
  for (let i = 0; i < contour.length; i += 3) {
    const dx = contour[i] - centroid.x;
    const dy = contour[i + 1] - centroid.y;
    sumRadius += Math.sqrt(dx * dx + dy * dy);
  }
  
  return sumRadius / pointCount;
}
