/**
 * Simple contour smoothing using moving average
 * More predictable than morphological operations for medical contours
 */

/**
 * Smooth a contour using weighted moving average
 * @param contour - Contour object with points array
 * @param smoothingFactor - Smoothing strength (0-1, default 0.15)
 * @returns Smoothed contour
 */
export function smoothContour(
  contour: { points: number[]; slicePosition: number },
  smoothingFactor: number = 0.15
): { points: number[]; slicePosition: number } {
  const points = contour.points;
  
  if (!points || points.length < 12) {
    return contour;
  }
  
  // Extract 2D points
  const points2D: Array<[number, number]> = [];
  for (let i = 0; i < points.length; i += 3) {
    points2D.push([points[i], points[i + 1]]);
  }
  
  // Apply weighted moving average
  const smoothed2D = smoothPoints2D(points2D, smoothingFactor);
  
  // Convert back to 3D points
  const smoothedPoints: number[] = [];
  const z = contour.slicePosition;
  
  for (const [x, y] of smoothed2D) {
    smoothedPoints.push(x, y, z);
  }
  
  return {
    points: smoothedPoints,
    slicePosition: contour.slicePosition
  };
}

/**
 * Smooth 2D points using weighted moving average
 * @param points - Array of 2D points
 * @param factor - Smoothing factor (0-1)
 * @returns Smoothed points
 */
function smoothPoints2D(
  points: Array<[number, number]>,
  factor: number
): Array<[number, number]> {
  if (points.length < 3) return points;
  
  const smoothed: Array<[number, number]> = [];
  const n = points.length;
  
  // Weight distribution for neighbors
  const weights = [0.25, 0.5, 0.25]; // Previous, current, next
  
  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n];
    const curr = points[i];
    const next = points[(i + 1) % n];
    
    // Weighted average
    const smoothX = curr[0] * (1 - factor) + 
                   (prev[0] * weights[0] + curr[0] * weights[1] + next[0] * weights[2]) * factor;
    const smoothY = curr[1] * (1 - factor) + 
                   (prev[1] * weights[0] + curr[1] * weights[1] + next[1] * weights[2]) * factor;
    
    smoothed.push([smoothX, smoothY]);
  }
  
  // Apply multiple passes for stronger smoothing
  if (factor > 0.3) {
    return smoothPoints2D(smoothed, factor * 0.5);
  }
  
  return smoothed;
}

/**
 * Apply Gaussian smoothing to contour points
 * Better for medical contours as it preserves shape better
 */
export function gaussianSmoothContour(
  contour: { points: number[]; slicePosition: number },
  sigma: number = 1.0
): { points: number[]; slicePosition: number } {
  const points = contour.points;
  
  if (!points || points.length < 12) {
    return contour;
  }
  
  // Extract 2D points
  const points2D: Array<[number, number]> = [];
  for (let i = 0; i < points.length; i += 3) {
    points2D.push([points[i], points[i + 1]]);
  }
  
  // Generate Gaussian kernel
  const kernelSize = Math.ceil(sigma * 3) * 2 + 1;
  const kernel = generateGaussianKernel(kernelSize, sigma);
  
  // Apply Gaussian smoothing
  const smoothed2D = applyGaussianSmoothing(points2D, kernel);
  
  // Convert back to 3D points
  const smoothedPoints: number[] = [];
  const z = contour.slicePosition;
  
  for (const [x, y] of smoothed2D) {
    smoothedPoints.push(x, y, z);
  }
  
  return {
    points: smoothedPoints,
    slicePosition: contour.slicePosition
  };
}

/**
 * Generate 1D Gaussian kernel
 */
function generateGaussianKernel(size: number, sigma: number): number[] {
  const kernel: number[] = [];
  const center = Math.floor(size / 2);
  let sum = 0;
  
  for (let i = 0; i < size; i++) {
    const x = i - center;
    const value = Math.exp(-(x * x) / (2 * sigma * sigma));
    kernel.push(value);
    sum += value;
  }
  
  // Normalize
  return kernel.map(k => k / sum);
}

/**
 * Apply Gaussian smoothing to 2D points
 */
function applyGaussianSmoothing(
  points: Array<[number, number]>,
  kernel: number[]
): Array<[number, number]> {
  const smoothed: Array<[number, number]> = [];
  const n = points.length;
  const halfKernel = Math.floor(kernel.length / 2);
  
  for (let i = 0; i < n; i++) {
    let smoothX = 0;
    let smoothY = 0;
    
    for (let j = -halfKernel; j <= halfKernel; j++) {
      const idx = (i + j + n) % n;
      const weight = kernel[j + halfKernel];
      smoothX += points[idx][0] * weight;
      smoothY += points[idx][1] * weight;
    }
    
    smoothed.push([smoothX, smoothY]);
  }
  
  return smoothed;
}

/**
 * Apply adaptive smoothing based on local curvature
 * Preserves sharp features while smoothing gentle curves
 */
export function adaptiveSmoothContour(
  contour: { points: number[]; slicePosition: number },
  baseFactor: number = 0.15,
  curvatureThreshold: number = 30 // degrees
): { points: number[]; slicePosition: number } {
  const points = contour.points;
  
  if (!points || points.length < 12) {
    return contour;
  }
  
  // Extract 2D points
  const points2D: Array<[number, number]> = [];
  for (let i = 0; i < points.length; i += 3) {
    points2D.push([points[i], points[i + 1]]);
  }
  
  // Calculate local curvature at each point
  const curvatures = calculateCurvatures(points2D);
  
  // Apply adaptive smoothing
  const smoothed2D: Array<[number, number]> = [];
  const n = points2D.length;
  
  for (let i = 0; i < n; i++) {
    const prev = points2D[(i - 1 + n) % n];
    const curr = points2D[i];
    const next = points2D[(i + 1) % n];
    
    // Reduce smoothing at high curvature points
    const localFactor = baseFactor * (1 - Math.min(curvatures[i] / 180, 0.8));
    
    // Weighted average
    const smoothX = curr[0] * (1 - localFactor) + 
                   (prev[0] * 0.25 + curr[0] * 0.5 + next[0] * 0.25) * localFactor;
    const smoothY = curr[1] * (1 - localFactor) + 
                   (prev[1] * 0.25 + curr[1] * 0.5 + next[1] * 0.25) * localFactor;
    
    smoothed2D.push([smoothX, smoothY]);
  }
  
  // Convert back to 3D points
  const smoothedPoints: number[] = [];
  const z = contour.slicePosition;
  
  for (const [x, y] of smoothed2D) {
    smoothedPoints.push(x, y, z);
  }
  
  return {
    points: smoothedPoints,
    slicePosition: contour.slicePosition
  };
}

/**
 * Calculate local curvature at each point
 */
function calculateCurvatures(points: Array<[number, number]>): number[] {
  const curvatures: number[] = [];
  const n = points.length;
  
  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n];
    const curr = points[i];
    const next = points[(i + 1) % n];
    
    // Calculate vectors
    const v1 = [curr[0] - prev[0], curr[1] - prev[1]];
    const v2 = [next[0] - curr[0], next[1] - curr[1]];
    
    // Calculate angle between vectors
    const dot = v1[0] * v2[0] + v1[1] * v2[1];
    const det = v1[0] * v2[1] - v1[1] * v2[0];
    const angle = Math.atan2(det, dot) * 180 / Math.PI;
    
    curvatures.push(Math.abs(angle));
  }
  
  return curvatures;
}