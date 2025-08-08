/**
 * Next Slice Prediction Algorithm for Medical Imaging Contours
 * 
 * This algorithm predicts contours on adjacent slices based on the current slice's contour.
 * It uses anatomical coherence principles - structures typically change gradually between slices.
 */

interface PredictionParams {
  currentContour: number[]; // Current slice contour points [x,y,z,x,y,z,...]
  currentSlicePosition: number;
  targetSlicePosition: number;
  anatomicalRegion?: 'head' | 'neck' | 'thorax' | 'abdomen' | 'pelvis';
  predictionMode?: 'simple' | 'adaptive' | 'gradient';
  confidenceThreshold?: number; // 0-1, determines when to stop propagating
}

interface PredictionResult {
  predictedContour: number[];
  confidence: number; // 0-1, how confident we are in the prediction
  adjustments: {
    scale: number;
    centerShift: { x: number; y: number };
    deformation: number; // Amount of shape change
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

/**
 * Simple prediction: Direct copy with slight scaling based on anatomical region
 */
function simplePrediction(
  currentContour: number[],
  sliceDistance: number,
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
    const z = currentContour[i + 2];
    
    // Scale points relative to centroid
    const scaledX = centroid.x + (x - centroid.x) * scaleAdjustment;
    const scaledY = centroid.y + (y - centroid.y) * scaleAdjustment;
    
    predictedContour.push(scaledX, scaledY, z + sliceDistance);
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
  sliceDistance: number
): PredictionResult {
  const currentCentroid = calculateCentroid(currentContour);
  const currentArea = calculateContourArea(currentContour);
  
  let scaleAdjustment = 1.0;
  let centerShift = { x: 0, y: 0 };
  
  // If we have a previous contour, calculate the trend
  if (previousContour && previousContour.length > 0) {
    const prevCentroid = calculateCentroid(previousContour);
    const prevArea = calculateContourArea(previousContour);
    
    // Calculate area change rate
    const areaChangeRate = (currentArea - prevArea) / prevArea;
    scaleAdjustment = 1 + areaChangeRate; // Continue the trend
    
    // Calculate center shift trend
    centerShift = {
      x: currentCentroid.x - prevCentroid.x,
      y: currentCentroid.y - prevCentroid.y
    };
  }
  
  const predictedContour: number[] = [];
  
  // Apply prediction with trend continuation
  for (let i = 0; i < currentContour.length; i += 3) {
    const x = currentContour[i];
    const y = currentContour[i + 1];
    const z = currentContour[i + 2];
    
    // Scale and shift based on trend
    const scaledX = currentCentroid.x + (x - currentCentroid.x) * scaleAdjustment + centerShift.x;
    const scaledY = currentCentroid.y + (y - currentCentroid.y) * scaleAdjustment + centerShift.y;
    
    predictedContour.push(scaledX, scaledY, z + sliceDistance);
  }
  
  // Calculate confidence based on consistency
  const areaChangeRate = previousContour && previousContour.length > 0 ? 
    (currentArea - calculateContourArea(previousContour)) / calculateContourArea(previousContour) : 0;
  const deformation = previousContour ? 
    Math.abs(areaChangeRate) + Math.sqrt(centerShift.x ** 2 + centerShift.y ** 2) / 10 : 0;
  const confidence = Math.max(0, 1 - deformation - Math.abs(sliceDistance) * 0.05);
  
  return {
    predictedContour,
    confidence,
    adjustments: {
      scale: scaleAdjustment,
      centerShift,
      deformation
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
    confidenceThreshold = 0.3
  } = params;
  
  if (!currentContour || currentContour.length < 9) { // Need at least 3 points
    return {
      predictedContour: [],
      confidence: 0,
      adjustments: { scale: 1, centerShift: { x: 0, y: 0 }, deformation: 0 }
    };
  }
  
  const sliceDistance = targetSlicePosition - currentSlicePosition;
  
  let result: PredictionResult;
  
  switch (predictionMode) {
    case 'simple':
      result = simplePrediction(currentContour, sliceDistance, anatomicalRegion);
      break;
      
    case 'adaptive':
      // For adaptive mode, we'd need previous contour data - for now fall back to simple
      result = adaptivePrediction(currentContour, null, sliceDistance);
      break;
      
    case 'gradient':
      // Gradient-based prediction would analyze image gradients - not implemented yet
      result = simplePrediction(currentContour, sliceDistance, anatomicalRegion);
      break;
      
    default:
      result = simplePrediction(currentContour, sliceDistance, anatomicalRegion);
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
 * Predict contours for multiple adjacent slices
 */
export function predictMultipleSlices(
  currentContour: number[],
  currentSlicePosition: number,
  targetSlicePositions: number[],
  params: Partial<PredictionParams> = {}
): Map<number, PredictionResult> {
  const predictions = new Map<number, PredictionResult>();
  
  // Sort target positions by distance from current
  const sortedTargets = [...targetSlicePositions].sort(
    (a, b) => Math.abs(a - currentSlicePosition) - Math.abs(b - currentSlicePosition)
  );
  
  let lastGoodContour = currentContour;
  let lastGoodPosition = currentSlicePosition;
  
  for (const targetPosition of sortedTargets) {
    const prediction = predictNextSliceContour({
      currentContour: lastGoodContour,
      currentSlicePosition: lastGoodPosition,
      targetSlicePosition: targetPosition,
      ...params
    });
    
    predictions.set(targetPosition, prediction);
    
    // Use this prediction for the next one if confidence is high enough
    if (prediction.confidence > 0.5 && prediction.predictedContour.length > 0) {
      lastGoodContour = prediction.predictedContour;
      lastGoodPosition = targetPosition;
    }
  }
  
  return predictions;
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
    const z = contour1[i + 2] + (contour2[i + 2] - contour1[i + 2]) * easedT;
    
    interpolatedContour.push(x, y, z);
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
  // Calculate centroids
  const centroid1 = calculateCentroid3D(contour1);
  const centroid2 = calculateCentroid3D(contour2);
  
  const t = (targetSlicePosition - slicePosition1) / (slicePosition2 - slicePosition1);
  const easedT = easeInOutCubic(t);
  
  // Interpolate centroid
  const interpolatedCentroid = {
    x: centroid1.x + (centroid2.x - centroid1.x) * easedT,
    y: centroid1.y + (centroid2.y - centroid1.y) * easedT,
    z: centroid1.z + (centroid2.z - centroid1.z) * easedT
  };
  
  // Calculate average radius to maintain area
  const radius1 = calculateAverageRadius(contour1, centroid1);
  const radius2 = calculateAverageRadius(contour2, centroid2);
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
    const z = interpolatedCentroid.z;
    
    interpolatedContour.push(x, y, z);
  }
  
  return interpolatedContour;
}

function calculateCentroid3D(contour: number[]): { x: number; y: number; z: number } {
  let sumX = 0, sumY = 0, sumZ = 0;
  const pointCount = contour.length / 3;
  
  for (let i = 0; i < contour.length; i += 3) {
    sumX += contour[i];
    sumY += contour[i + 1];
    sumZ += contour[i + 2];
  }
  
  return {
    x: sumX / pointCount,
    y: sumY / pointCount,
    z: sumZ / pointCount
  };
}

function calculateAverageRadius(contour: number[], centroid: { x: number; y: number; z: number }): number {
  let sumRadius = 0;
  const pointCount = contour.length / 3;
  
  for (let i = 0; i < contour.length; i += 3) {
    const dx = contour[i] - centroid.x;
    const dy = contour[i + 1] - centroid.y;
    sumRadius += Math.sqrt(dx * dx + dy * dy);
  }
  
  return sumRadius / pointCount;
}