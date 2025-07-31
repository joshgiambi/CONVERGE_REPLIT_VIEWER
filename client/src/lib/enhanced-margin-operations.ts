// Enhanced Margin Operations - Unified Interface
// Combines morphological operations with existing simple operations
// Provides comprehensive margin calculation with preview support
// Updated to support true 3D radial expansion

import { 
  MarginParameters,
  applyMorphologicalMarginToContour,
  createSphericalKernel,
  createDirectionalKernel 
} from './morphological-margin-operations';
import { growContourSimple } from './simple-polygon-operations';
import { applyDirectionalGrow } from './contour-directional-grow';
import { applyTrue3DMarginToContour, ImageMetadata3D } from './true-3d-margin-operations';

export interface EnhancedMarginResult {
  contourPoints: number[];
  metadata: {
    algorithm: string;
    parameters: MarginParameters;
    processingTime: number;
    pointCount: number;
    quality: 'HIGH' | 'MEDIUM' | 'LOW';
  };
}

export interface ImageContext {
  pixelSpacing?: [number, number];
  sliceThickness?: number;
  imagePosition?: [number, number, number];
  imageSize?: { width: number; height: number; depth: number };
}

/**
 * Main function to apply enhanced margin operations with algorithm selection
 */
export async function applyEnhancedMargin(
  contourPoints: number[],
  parameters: MarginParameters,
  imageContext?: ImageContext
): Promise<EnhancedMarginResult> {
  const startTime = performance.now();
  
  console.log('🔹 📦 Enhanced Margin Operations: Starting operation');
  console.log('🔹 📊 Input data:', {
    algorithm: parameters.algorithmType,
    marginType: parameters.marginType,
    marginValue: parameters.marginValues.uniform,
    pointCount: contourPoints.length / 3,
    hasImageContext: !!imageContext
  });

  // For preview operations, large contours, or large margins, use simple operations to prevent freezing
  const pointCount = contourPoints.length / 3;
  const marginSize = Math.abs(parameters.marginValues.uniform);
  const isLargeContour = pointCount > 100;
  const isLargeMargin = marginSize > 50; // 50mm threshold
  const shouldUseSimple = isLargeContour || isLargeMargin || parameters.preview?.enabled;
  
  if (shouldUseSimple) {
    console.log('🔹 ⚡ Using simple operations for performance:', {
      reason: isLargeContour ? 'large contour' : isLargeMargin ? 'large margin' : 'preview mode',
      pointCount,
      marginSize
    });
    return applySimpleMarginOperation(contourPoints, parameters);
  }

  // Try true 3D operations if we have sufficient image context
  if (parameters.algorithmType === 'MORPHOLOGICAL' && imageContext && 
      imageContext.pixelSpacing && imageContext.sliceThickness && imageContext.imageSize) {
    
    try {
      console.log('🔹 🌐 Using true 3D radial expansion');
      const imageMetadata3D: ImageMetadata3D = {
        pixelSpacing: imageContext.pixelSpacing,
        sliceThickness: imageContext.sliceThickness,
        imagePosition: imageContext.imagePosition || [0, 0, 0],
        imageSize: imageContext.imageSize
      };
      
      const resultPoints = await applyTrue3DMarginToContour(
        contourPoints, 
        parameters.marginValues.uniform, 
        imageMetadata3D
      );
      
      const processingTime = performance.now() - startTime;
      
      return {
        contourPoints: resultPoints,
        metadata: {
          algorithm: 'True 3D Radial Expansion',
          parameters,
          processingTime,
          pointCount: resultPoints.length / 3,
          quality: 'HIGH'
        }
      };
      
    } catch (error) {
      console.warn('🔹 ⚠️ True 3D operation failed, falling back to morphological:', error);
      // Continue to morphological fallback below
    }
  }

  try {
    let resultPoints: number[];
    let algorithmUsed: string;
    let quality: 'HIGH' | 'MEDIUM' | 'LOW';

    // Select algorithm based on parameters and available context
    if (parameters.algorithmType === 'MORPHOLOGICAL' && imageContext?.pixelSpacing) {
      // Use sophisticated morphological operations
      resultPoints = await applyMorphologicalMarginWithFallback(contourPoints, parameters, imageContext);
      algorithmUsed = 'Morphological Dilation/Erosion';
      quality = 'HIGH';
      
    } else if (parameters.marginType === 'DIRECTIONAL') {
      // Use directional growth operations
      resultPoints = await applyDirectionalMarginOperation(contourPoints, parameters);
      algorithmUsed = 'Directional Growth';
      quality = 'MEDIUM';
      
    } else {
      // Use simple uniform operations
      const simpleResult = await applySimpleMarginOperation(contourPoints, parameters);
    resultPoints = simpleResult.contourPoints;
      algorithmUsed = 'Simple Buffering';
      quality = parameters.marginValues.uniform >= 0 ? 'MEDIUM' : 'LOW';
    }

    // Apply post-processing smoothing if requested
    if (parameters.smoothingType !== 'LINEAR') {
      resultPoints = await applySmoothing(resultPoints, parameters.smoothingType, parameters.resolution);
    }

    const processingTime = performance.now() - startTime;

    console.log(`🔹 ✅ Enhanced margin operation completed:`, {
      algorithm: algorithmUsed,
      processingTime: `${processingTime.toFixed(1)}ms`,
      inputPoints: contourPoints.length / 3,
      outputPoints: resultPoints.length / 3,
      quality
    });

    return {
      contourPoints: resultPoints,
      metadata: {
        algorithm: algorithmUsed,
        parameters,
        processingTime,
        pointCount: resultPoints.length / 3,
        quality
      }
    };

  } catch (error) {
    console.error('🔹 ❌ Error in enhanced margin operation:', error);
    
    // Fallback to original contour
    return {
      contourPoints,
      metadata: {
        algorithm: 'Fallback (Original)',
        parameters,
        processingTime: performance.now() - startTime,
        pointCount: contourPoints.length / 3,
        quality: 'LOW'
      }
    };
  }
}

/**
 * Apply morphological margin with fallback to simple operations
 */
async function applyMorphologicalMarginWithFallback(
  contourPoints: number[],
  parameters: MarginParameters,
  imageContext: ImageContext
): Promise<number[]> {
  
  if (!imageContext.pixelSpacing || !imageContext.sliceThickness) {
    console.warn('🔹 Insufficient image metadata for morphological operations, falling back to simple');
    const result = await applySimpleMarginOperation(contourPoints, parameters);
    return result.contourPoints;
  }

  try {
    // Prepare image metadata for morphological operations
    const imageMetadata = {
      pixelSpacing: imageContext.pixelSpacing,
      sliceThickness: imageContext.sliceThickness,
      imagePosition: imageContext.imagePosition || [0, 0, 0]
    };

    // Apply morphological operations
    const result = applyMorphologicalMarginToContour(contourPoints, parameters, imageMetadata);
    
    // Validate result quality
    if (result.length < 9) {
      console.warn('🔹 Morphological operation produced insufficient points, falling back');
      const fallbackResult = await applySimpleMarginOperation(contourPoints, parameters);
      return fallbackResult.contourPoints;
    }

    return result;

  } catch (error) {
    console.warn('🔹 Morphological operation failed, falling back to simple:', error);
    const fallbackResult = await applySimpleMarginOperation(contourPoints, parameters);
    return fallbackResult.contourPoints;
  }
}

/**
 * Apply directional margin operations
 */
async function applyDirectionalMarginOperation(
  contourPoints: number[],
  parameters: MarginParameters
): Promise<number[]> {
  
  console.log('🔹 Applying directional margin operations');
  
  // For directional margins, we need to handle each direction
  const { superior, inferior, anterior, posterior, left, right } = parameters.marginValues;
  
  // Calculate average margin for uniform application (simplified approach)
  // In a full implementation, this would consider anatomical directions
  const avgMargin = (superior + inferior + anterior + posterior + left + right) / 6;
  
  try {
    // Use directional grow if available
    const result = applyDirectionalGrow(contourPoints, avgMargin, 'all');
    
    if (result.length >= 9) {
      return result;
    }
  } catch (error) {
    console.warn('🔹 Directional grow failed, falling back to simple:', error);
  }
  
  // Fallback to simple operation with average margin
  return growContourSimple(contourPoints, avgMargin);
}

/**
 * Apply simple uniform margin operations
 */
async function applySimpleMarginOperation(
  contourPoints: number[],
  parameters: MarginParameters
): Promise<EnhancedMarginResult> {
  const startTime = performance.now();
  
  try {
    console.log('🔹 ⚡ Starting simple margin operation with distance:', parameters.marginValues.uniform);
    
    const distance = parameters.marginValues.uniform;
    const result = growContourSimple(contourPoints, distance);
    
    const processingTime = performance.now() - startTime;
    
    console.log('🔹 ✅ Simple margin operation completed:', {
      inputPoints: contourPoints.length / 3,
      outputPoints: result.length / 3,
      processingTime: `${processingTime.toFixed(2)}ms`
    });
    
    return {
      contourPoints: result,
      metadata: {
        algorithm: 'SIMPLE_BUFFERING',
        parameters,
        processingTime,
        pointCount: result.length / 3,
        quality: 'MEDIUM'
      }
    };
  } catch (error) {
    console.error('🔹 ❌ Simple margin operation failed:', error);
    throw error;
  }
}

/**
 * Apply smoothing to contour points based on smoothing type
 */
async function applySmoothing(
  contourPoints: number[],
  smoothingType: MarginParameters['smoothingType'],
  resolution: number
): Promise<number[]> {
  
  console.log(`🔹 Applying ${smoothingType} smoothing with resolution ${resolution}mm`);
  
  try {
    if (smoothingType === 'GAUSSIAN') {
      return applyGaussianSmoothing(contourPoints, resolution);
    } else if (smoothingType === 'SPLINE') {
      return applySplineSmoothing(contourPoints, resolution);
    }
    
    // Linear smoothing (default)
    return applyLinearSmoothing(contourPoints, resolution);
    
  } catch (error) {
    console.warn('🔹 Smoothing failed, returning original:', error);
    return contourPoints;
  }
}

/**
 * Apply Gaussian smoothing to contour points
 */
function applyGaussianSmoothing(contourPoints: number[], sigma: number): number[] {
  if (contourPoints.length < 9) return contourPoints;
  
  const numPoints = contourPoints.length / 3;
  const smoothedPoints: number[] = [];
  
  // Gaussian kernel size based on sigma
  const kernelSize = Math.max(3, Math.ceil(sigma * 3));
  const kernel = createGaussianKernel(kernelSize, sigma);
  
  for (let i = 0; i < numPoints; i++) {
    let smoothX = 0, smoothY = 0, smoothZ = 0;
    let weightSum = 0;
    
    for (let j = -Math.floor(kernelSize / 2); j <= Math.floor(kernelSize / 2); j++) {
      const idx = ((i + j) % numPoints + numPoints) % numPoints; // Wrap around
      const weight = kernel[j + Math.floor(kernelSize / 2)];
      
      smoothX += contourPoints[idx * 3] * weight;
      smoothY += contourPoints[idx * 3 + 1] * weight;
      smoothZ += contourPoints[idx * 3 + 2] * weight;
      weightSum += weight;
    }
    
    smoothedPoints.push(smoothX / weightSum, smoothY / weightSum, smoothZ / weightSum);
  }
  
  return smoothedPoints;
}

/**
 * Apply spline smoothing to contour points
 */
function applySplineSmoothing(contourPoints: number[], resolution: number): number[] {
  if (contourPoints.length < 12) return contourPoints; // Need at least 4 points for spline
  
  const numPoints = contourPoints.length / 3;
  const smoothedPoints: number[] = [];
  
  // Simple cubic spline interpolation
  for (let i = 0; i < numPoints; i++) {
    const p0 = getPoint(contourPoints, (i - 1 + numPoints) % numPoints);
    const p1 = getPoint(contourPoints, i);
    const p2 = getPoint(contourPoints, (i + 1) % numPoints);
    const p3 = getPoint(contourPoints, (i + 2) % numPoints);
    
    // Catmull-Rom spline interpolation
    const smoothed = catmullRomInterpolation(p0, p1, p2, p3, 0.5);
    smoothedPoints.push(smoothed.x, smoothed.y, smoothed.z);
  }
  
  return smoothedPoints;
}

/**
 * Apply linear smoothing (simple averaging)
 */
function applyLinearSmoothing(contourPoints: number[], windowSize: number): number[] {
  if (contourPoints.length < 9) return contourPoints;
  
  const numPoints = contourPoints.length / 3;
  const smoothedPoints: number[] = [];
  const window = Math.max(1, Math.floor(windowSize));
  
  for (let i = 0; i < numPoints; i++) {
    let avgX = 0, avgY = 0, avgZ = 0;
    let count = 0;
    
    for (let j = -window; j <= window; j++) {
      const idx = ((i + j) % numPoints + numPoints) % numPoints;
      avgX += contourPoints[idx * 3];
      avgY += contourPoints[idx * 3 + 1];
      avgZ += contourPoints[idx * 3 + 2];
      count++;
    }
    
    smoothedPoints.push(avgX / count, avgY / count, avgZ / count);
  }
  
  return smoothedPoints;
}

/**
 * Helper functions
 */
function createGaussianKernel(size: number, sigma: number): number[] {
  const kernel: number[] = [];
  const center = Math.floor(size / 2);
  let sum = 0;
  
  for (let i = 0; i < size; i++) {
    const x = i - center;
    const value = Math.exp(-(x * x) / (2 * sigma * sigma));
    kernel.push(value);
    sum += value;
  }
  
  // Normalize kernel
  return kernel.map(v => v / sum);
}

function getPoint(contourPoints: number[], index: number): { x: number; y: number; z: number } {
  const i = index * 3;
  return {
    x: contourPoints[i],
    y: contourPoints[i + 1],
    z: contourPoints[i + 2]
  };
}

function catmullRomInterpolation(
  p0: { x: number; y: number; z: number },
  p1: { x: number; y: number; z: number },
  p2: { x: number; y: number; z: number },
  p3: { x: number; y: number; z: number },
  t: number
): { x: number; y: number; z: number } {
  const t2 = t * t;
  const t3 = t2 * t;
  
  return {
    x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
    z: 0.5 * ((2 * p1.z) + (-p0.z + p2.z) * t + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3)
  };
}

/**
 * Validate margin operation parameters
 */
export function validateMarginParameters(parameters: MarginParameters): {
  isValid: boolean;
  warnings: string[];
  errors: string[];
} {
  const warnings: string[] = [];
  const errors: string[] = [];
  
  // Check margin values
  if (parameters.marginType === 'UNIFORM') {
    if (Math.abs(parameters.marginValues.uniform) > 50) {
      warnings.push('Large margin values (>50mm) may produce unrealistic results');
    }
    if (parameters.marginValues.uniform === 0) {
      warnings.push('Zero margin will return original contour');
    }
  }
  
  // Check algorithm compatibility
  if (parameters.algorithmType === 'MORPHOLOGICAL' && parameters.iterations > 5) {
    warnings.push('High iteration counts may significantly slow processing');
  }
  
  // Check resolution
  if (parameters.resolution > 5) {
    warnings.push('Low resolution (>5mm) may produce jagged contours');
  }
  
  return {
    isValid: errors.length === 0,
    warnings,
    errors
  };
}

/**
 * Get optimal parameters based on use case
 */
export function getOptimalMarginParameters(useCase: 'CLINICAL' | 'RESEARCH' | 'PREVIEW'): MarginParameters {
  const baseParams: MarginParameters = {
    marginType: 'UNIFORM',
    marginValues: {
      uniform: 5.0,
      superior: 5.0,
      inferior: 5.0,
      anterior: 5.0,
      posterior: 5.0,
      left: 5.0,
      right: 5.0
    },
    algorithmType: 'MORPHOLOGICAL',
    kernelType: 'SPHERICAL',
    smoothingType: 'GAUSSIAN',
    cornerHandling: 'ROUND',
    resolution: 1.0,
    iterations: 1,
    preview: {
      enabled: true,
      opacity: 0.6,
      color: '#FFFF00',
      updateRealtime: true
    }
  };
  
  switch (useCase) {
    case 'CLINICAL':
      return {
        ...baseParams,
        algorithmType: 'MORPHOLOGICAL',
        smoothingType: 'GAUSSIAN',
        resolution: 0.5,
        iterations: 2
      };
      
    case 'RESEARCH':
      return {
        ...baseParams,
        algorithmType: 'MORPHOLOGICAL',
        smoothingType: 'SPLINE',
        resolution: 0.25,
        iterations: 3
      };
      
    case 'PREVIEW':
      return {
        ...baseParams,
        algorithmType: 'SIMPLE',
        smoothingType: 'LINEAR',
        resolution: 2.0,
        iterations: 1
      };
      
    default:
      return baseParams;
  }
} 