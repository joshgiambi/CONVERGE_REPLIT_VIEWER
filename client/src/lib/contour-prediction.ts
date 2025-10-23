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

export interface NeighborContourSnapshot {
  contour: number[];
  slicePosition: number;
}

export interface NeighborContours {
  before?: NeighborContourSnapshot;
  after?: NeighborContourSnapshot;
}

export interface PredictionParams {
  currentContour: number[]; // Current slice contour points [x,y,z,x,y,z,...]
  currentSlicePosition: number;
  targetSlicePosition: number;
  anatomicalRegion?: 'head' | 'neck' | 'thorax' | 'abdomen' | 'pelvis';
  predictionMode?: 'simple' | 'adaptive' | 'trend-based';
  confidenceThreshold?: number; // 0-1, determines when to stop propagating
  historyManager?: PredictionHistoryManager;
  allContours?: Map<number, number[]>; // All contours in the structure by slice position
  neighborContours?: NeighborContours;
  
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

function rebuildContourFromProfile(
  centroid: { x: number; y: number },
  profile: Float64Array,
  slicePosition: number
): number[] {
  const contour: number[] = [];
  const sampleCount = profile.length;

  for (let i = 0; i < sampleCount; i++) {
    const angle = (i / sampleCount) * TWO_PI;
    const radius = Math.max(profile[i], 0.1);
    const x = centroid.x + Math.cos(angle) * radius;
    const y = centroid.y + Math.sin(angle) * radius;
    contour.push(x, y, slicePosition);
  }

  smoothContourInPlace(contour, 2, 0.18);
  return contour;
}

/**
 * Detect anatomical context from contour characteristics
 * This provides intelligent defaults for prediction behavior
 */
function detectAnatomicalContext(
  contour: number[],
  slicePosition: number,
  allContours?: Map<number, number[]>
): {
  likelyOrgan: string;
  growthPattern: 'expanding' | 'contracting' | 'stable' | 'irregular';
  scalingFactor: number;
  confidenceBoost: number;
} {
  const area = calculateContourArea(contour);
  const centroid = calculateCentroid(contour);

  // Calculate aspect ratio to help identify organ type
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < contour.length; i += 3) {
    minX = Math.min(minX, contour[i]);
    maxX = Math.max(maxX, contour[i]);
    minY = Math.min(minY, contour[i + 1]);
    maxY = Math.max(maxY, contour[i + 1]);
  }
  const width = maxX - minX;
  const height = maxY - minY;
  const aspectRatio = width / Math.max(height, 1);

  // Analyze growth pattern from history if available
  let growthPattern: 'expanding' | 'contracting' | 'stable' | 'irregular' = 'stable';
  if (allContours && allContours.size >= 2) {
    const sortedSlices = Array.from(allContours.keys()).sort((a, b) => a - b);
    const areas = sortedSlices.map(slice => calculateContourArea(allContours.get(slice)!));

    // Calculate area trend
    let expansionCount = 0;
    let contractionCount = 0;
    for (let i = 1; i < areas.length; i++) {
      const change = (areas[i] - areas[i-1]) / areas[i-1];
      if (change > 0.05) expansionCount++;
      else if (change < -0.05) contractionCount++;
    }

    if (expansionCount > contractionCount * 2) growthPattern = 'expanding';
    else if (contractionCount > expansionCount * 2) growthPattern = 'contracting';
    else if (Math.abs(expansionCount - contractionCount) <= 1) growthPattern = 'stable';
    else growthPattern = 'irregular';
  }

  // Heuristic organ detection based on size and position
  let likelyOrgan = 'unknown';
  let scalingFactor = 1.0;
  let confidenceBoost = 0;

  // Large areas (> 10000mm²) - likely body outline, lungs, or liver
  if (area > 10000) {
    if (slicePosition > 0) {
      likelyOrgan = 'lung'; // Superior position
      scalingFactor = 0.98; // Lungs taper superiorly
      confidenceBoost = 0.1;
    } else {
      likelyOrgan = 'liver';
      scalingFactor = 1.0; // Liver relatively stable
      confidenceBoost = 0.15;
    }
  }
  // Medium areas (1000-10000mm²) - organs
  else if (area > 1000) {
    if (aspectRatio > 1.5) {
      likelyOrgan = 'kidney'; // Kidney-shaped (elongated)
      scalingFactor = 0.99;
      confidenceBoost = 0.1;
    } else {
      likelyOrgan = 'organ'; // Generic organ
      scalingFactor = 1.0;
      confidenceBoost = 0.05;
    }
  }
  // Small areas (100-1000mm²) - prostate, bladder, small structures
  else if (area > 100) {
    if (slicePosition < -50) {
      likelyOrgan = 'prostate'; // Inferior position
      scalingFactor = 0.99; // Slight taper
      confidenceBoost = 0.12;
    } else {
      likelyOrgan = 'bladder';
      scalingFactor = 1.01; // Bladder expands inferiorly
      confidenceBoost = 0.08;
    }
  }
  // Very small areas (< 100mm²) - GTVs, nodes, small lesions
  else {
    likelyOrgan = 'gtv';
    // GTVs can be irregular - use observed pattern
    scalingFactor = growthPattern === 'stable' ? 1.0 : 0.98;
    confidenceBoost = 0; // Lower confidence for small irregular structures
  }

  return {
    likelyOrgan,
    growthPattern,
    scalingFactor,
    confidenceBoost
  };
}

function interpolateBetweenContours(
  before: NeighborContourSnapshot,
  after: NeighborContourSnapshot,
  targetSlice: number
): PredictionResult | null {
  const span = after.slicePosition - before.slicePosition;
  if (!Number.isFinite(span) || Math.abs(span) < 1e-3) {
    return null;
  }

  const weightAfter = clamp((targetSlice - before.slicePosition) / span, 0, 1);
  const weightBefore = 1 - weightAfter;

  const beforeCentroid = calculateCentroid(before.contour);
  const afterCentroid = calculateCentroid(after.contour);
  const blendedCentroid = {
    x: beforeCentroid.x * weightBefore + afterCentroid.x * weightAfter,
    y: beforeCentroid.y * weightBefore + afterCentroid.y * weightAfter
  };

  const sampleCount = 96;
  const beforeProfile = buildRadialProfile(before.contour, beforeCentroid, sampleCount);
  const afterProfile = buildRadialProfile(after.contour, afterCentroid, sampleCount);

  // CRITICAL FIX: Interpolate radius² to preserve cross-sectional area
  // Linear radius interpolation causes shrinkage because area scales with r²
  // Example: r1=10mm (area=314), r2=15mm (area=707)
  //   Linear:   r_mid=12.5mm → area=491mm² ❌ (30% shrinkage!)
  //   Quadratic: r_mid=√((10²+15²)/2) = 12.75mm → area=510mm² ✓ (preserves area)
  const blendedProfile = new Float64Array(sampleCount);
  let profileSpread = 0;
  let profileBaseline = 0;
  for (let i = 0; i < sampleCount; i++) {
    const beforeRadius = beforeProfile[i];
    const afterRadius = afterProfile[i];
    profileSpread += Math.abs(beforeRadius - afterRadius);
    profileBaseline += (beforeRadius + afterRadius) * 0.5;

    // Interpolate radius squared for volume preservation
    const r2Before = beforeRadius * beforeRadius;
    const r2After = afterRadius * afterRadius;
    const r2Blended = r2Before * weightBefore + r2After * weightAfter;

    // Take square root to get actual radius
    blendedProfile[i] = Math.max(0.1, Math.sqrt(r2Blended));
  }
  const radialSpread = profileBaseline > 1e-3 ? profileSpread / profileBaseline : 0;

  const interpolatedContour = rebuildContourFromProfile(
    blendedCentroid,
    blendedProfile,
    targetSlice
  );

  const beforeArea = Math.max(calculateContourArea(before.contour), 1e-3);
  const afterArea = Math.max(calculateContourArea(after.contour), 1e-3);
  
  // Linear area interpolation can cause issues - use sqrt for smoother transitions
  // This prevents extreme shrinkage in the middle of large gaps
  const sqrtBeforeArea = Math.sqrt(beforeArea);
  const sqrtAfterArea = Math.sqrt(afterArea);
  const targetSqrtArea = sqrtBeforeArea * weightBefore + sqrtAfterArea * weightAfter;
  const targetArea = targetSqrtArea * targetSqrtArea;
  
  let predictedArea = Math.max(calculateContourArea(interpolatedContour), 1e-6);

  if (predictedArea > 0) {
    // More permissive scaling limits for large gaps - allow bigger adjustments
    const areaScale = clamp(Math.sqrt(targetArea / predictedArea), 0.5, 2.0);
    if (Math.abs(areaScale - 1) > 1e-3) {
      for (let i = 0; i < interpolatedContour.length; i += 3) {
        const dx = interpolatedContour[i] - blendedCentroid.x;
        const dy = interpolatedContour[i + 1] - blendedCentroid.y;
        interpolatedContour[i] = blendedCentroid.x + dx * areaScale;
        interpolatedContour[i + 1] = blendedCentroid.y + dy * areaScale;
      }
      predictedArea = Math.max(calculateContourArea(interpolatedContour), 1e-6);
    }
  }
  
  console.log(`🔍 INTERPOLATION: before=${beforeArea.toFixed(1)}mm², after=${afterArea.toFixed(1)}mm², target=${targetArea.toFixed(1)}mm², predicted=${predictedArea.toFixed(1)}mm², span=${span.toFixed(1)}mm, weightAfter=${weightAfter.toFixed(2)}`);

  const areaDeviation = Math.abs(predictedArea - targetArea) / Math.max(targetArea, 1e-3);

  const centroidShiftMagnitude = Math.hypot(
    blendedCentroid.x - (beforeCentroid.x * weightBefore + afterCentroid.x * weightAfter),
    blendedCentroid.y - (beforeCentroid.y * weightBefore + afterCentroid.y * weightAfter)
  );

  const deformation = areaDeviation + radialSpread * 0.3 + centroidShiftMagnitude * 0.01;
  const distanceFactor = 1 - Math.abs(weightAfter - 0.5) * 0.4; // Reduced penalty from 0.6 to 0.4
  
  // BOOST confidence for dual-neighbor interpolation - it's more reliable than extrapolation!
  // Interpolation between two known contours should have HIGH confidence
  // Base confidence: 0.85, reduced slightly based on position and deformation
  const confidence = clamp(0.85 * distanceFactor - deformation * 0.3 + 0.15, 0.4, 1.0);

  const scaleRelativeBefore = Math.sqrt(predictedArea / beforeArea);
  const scaleRelativeAfter = Math.sqrt(predictedArea / afterArea);
  const blendedScale = clamp(
    scaleRelativeBefore * weightBefore + scaleRelativeAfter * weightAfter,
    0.6,
    1.6
  );

  return {
    predictedContour: interpolatedContour,
    confidence,
    adjustments: {
      scale: blendedScale,
      centerShift: {
        x: blendedCentroid.x - beforeCentroid.x,
        y: blendedCentroid.y - beforeCentroid.y
      },
      deformation
    },
    metadata: {
      method: 'dual-neighbor-interpolation',
      historySize: 2,
      notes: 'Blended between inferior and superior contours.'
    }
  };
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
  targetZ: number,
  allContours?: Map<number, number[]>
): PredictionResult {
  if (!previousContour || previousContour.length < 9) {
    const fallback = simplePrediction(currentContour, sliceDistance, targetZ, undefined);
    const adjusted = [...fallback.predictedContour];
    for (let i = 2; i < adjusted.length; i += 3) {
      adjusted[i] = targetZ;
    }
    smoothContourInPlace(adjusted, 1, 0.12);

    return {
      ...fallback,
      predictedContour: adjusted,
      metadata: {
        ...(fallback.metadata || {}),
        method: 'adaptive-fallback',
        notes: 'Fallback to simple propagation due to insufficient reference contours.'
      }
    };
  }

  const currentCentroid = calculateCentroid(currentContour);
  const prevCentroid = calculateCentroid(previousContour);

  const currentArea = calculateContourArea(currentContour);
  const prevArea = Math.max(calculateContourArea(previousContour), 1e-3);

  // ANATOMICAL INTELLIGENCE: Detect organ type and apply appropriate growth model
  const anatomyContext = detectAnatomicalContext(currentContour, targetZ, allContours);

  const areaChangeRate = (currentArea - prevArea) / prevArea;
  const sign = Math.sign(sliceDistance) || 1;
  const absDistance = Math.max(1, Math.abs(sliceDistance));

  // IMPROVED: More permissive clamping to allow natural anatomical changes
  // Previous: scaleLimit = min(0.35 * absDistance, 0.55) was too restrictive
  // New: Allow up to ±50% change per slice for rapidly changing anatomy (e.g., lung apex, bladder)
  // but still cap at ±80% total to prevent runaway predictions
  const scaleLimit = Math.min(0.50 * absDistance, 0.80);

  // Apply anatomical scaling factor to observed area change
  const anatomyBiasedAreaChange = areaChangeRate + (anatomyContext.scalingFactor - 1) * sign;
  const scaleAdjustment = clamp(1 + anatomyBiasedAreaChange, 1 - scaleLimit, 1 + scaleLimit);

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

    // IMPROVED: More permissive per-point radius clamping
    // Previous: Hard floor at 0.6x current radius was too restrictive for shrinking structures
    // New: Allow down to 0.3x (70% shrinkage) for natural anatomy like lung apex
    const minRadius = Math.max(currentRadius * (1 - scaleLimit), currentRadius * 0.3, 0.5);
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
  let confidence = clamp(1 - deformation - Math.abs(sliceDistance) * 0.05, 0, 1);

  // ANATOMICAL INTELLIGENCE: Boost confidence for stable, well-understood organs
  confidence = Math.min(1.0, confidence + anatomyContext.confidenceBoost);

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
      notes: `Shape-aware adaptive prediction with radial trend continuation. Detected: ${anatomyContext.likelyOrgan} (${anatomyContext.growthPattern})`
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
    predictionMode = 'simple',
    confidenceThreshold = 0.3,
    historyManager,
    allContours,
    neighborContours,
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
  let result: PredictionResult | null = null;
  let usedDualNeighbor = false;

  if (neighborContours?.before && neighborContours?.after) {
    const lower =
      neighborContours.before.slicePosition <= neighborContours.after.slicePosition
        ? neighborContours.before
        : neighborContours.after;
    const upper = lower === neighborContours.before ? neighborContours.after : neighborContours.before;

    const minSlice = Math.min(lower.slicePosition, upper.slicePosition);
    const maxSlice = Math.max(lower.slicePosition, upper.slicePosition);

    if (targetSlicePosition > minSlice && targetSlicePosition < maxSlice) {
      const interpolated = interpolateBetweenContours(lower, upper, targetSlicePosition);
      if (interpolated) {
        result = interpolated;
        usedDualNeighbor = true;
      }
    }
  }

  if (!result) {
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
        result = adaptivePrediction(currentContour, previousContour, sliceDistance, targetSlicePosition, allContours);
        break;
      }

      case 'trend-based': {
        // Use history manager for trend-based prediction
        if (historyManager && historyManager.size() >= 2) {
          result = trendBasedPrediction(historyManager, currentSlicePosition, targetSlicePosition);
        } else {
          // Fall back to adaptive if not enough history
          const fallbackContour = findNearestContour();
          result = adaptivePrediction(currentContour, fallbackContour, sliceDistance, targetSlicePosition, allContours);
        }
        break;
      }
        
      default:
        result = simplePrediction(currentContour, sliceDistance, targetSlicePosition, anatomicalRegion);
    }
  }

  // At this point result is guaranteed
  let finalResult = result!;
  
  // Apply image-aware refinement if enabled and image data available
  if (enableImageRefinement && 
      imageData?.targetSlice && 
      coordinateTransforms &&
      finalResult.predictedContour.length > 0) {
    
    try {
      // ALWAYS snap to edges for better anatomical accuracy
      const snapToEdges = true;
      // For dual-neighbor, trust geometry more but still use image data
      const geometryWeight = usedDualNeighbor ? 0.6 : 0.4;
      const imageWeight = 1 - geometryWeight;

      const { refinedContour, confidence: imageConfidence, metadata: refinementMetadata } = 
        refineContourWithImageData(
          finalResult.predictedContour,
          imageData.referenceSlices || [],
          imageData.targetSlice,
          coordinateTransforms.worldToPixel,
          coordinateTransforms.pixelToWorld,
          {
            snapToEdges,
            validateSimilarity: imageData.referenceSlices && imageData.referenceSlices.length > 0,
            searchRadius: 15,
            edgeThreshold: 40
          }
        );
      
      // Combine geometric and image-based confidence
      finalResult.predictedContour = refinedContour;
      finalResult.confidence = (finalResult.confidence * geometryWeight) + (imageConfidence * imageWeight);
      
      // Add refinement metadata
      if (!finalResult.metadata) {
        finalResult.metadata = { method: predictionMode as string, historySize: 0 };
      }
      finalResult.metadata.imageRefinement = {
        applied: true,
        edgeSnapped: refinementMetadata.edgeSnapped,
        validated: refinementMetadata.validated,
        similarity: refinementMetadata.similarity,
        regionCharacteristics: refinementMetadata.regionCharacteristics
      };
      
    } catch (error) {
      if (!finalResult.metadata) {
        finalResult.metadata = { method: predictionMode as string, historySize: 0 };
      }
      finalResult.metadata.imageRefinement = {
        applied: false,
        edgeSnapped: false,
        validated: false
      };
    }
  }
  
  // Don't return prediction if confidence is too low
  if (finalResult.confidence < confidenceThreshold) {
    return {
      ...finalResult,
      predictedContour: [],
      confidence: 0
    };
  }
  
  if (usedDualNeighbor && finalResult.metadata) {
    finalResult.metadata.notes = finalResult.metadata.notes
      ? `${finalResult.metadata.notes} | Dual neighbor blend`
      : 'Dual neighbor blend';
  }

  return finalResult;
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
