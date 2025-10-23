/**
 * Image-Aware Prediction Refinement
 * 
 * Uses DICOM pixel data (HU values, intensities) to refine geometric predictions
 * by analyzing tissue characteristics, edge gradients, and texture patterns
 */

/**
 * Smooth contour in-place using Laplacian smoothing
 */
function smoothContourInPlace(points: number[], iterations = 1, smoothing = 0.2): void {
  if (points.length < 9) return; // Need at least 3 points
  
  for (let iter = 0; iter < iterations; iter++) {
    const numPoints = points.length / 3;
    const smoothedX: number[] = [];
    const smoothedY: number[] = [];
    
    for (let i = 0; i < numPoints; i++) {
      const prevIdx = (i === 0 ? numPoints - 1 : i - 1) * 3;
      const currIdx = i * 3;
      const nextIdx = ((i + 1) % numPoints) * 3;
      
      const avgX = (points[prevIdx] + points[currIdx] + points[nextIdx]) / 3;
      const avgY = (points[prevIdx + 1] + points[currIdx + 1] + points[nextIdx + 1]) / 3;
      
      smoothedX.push(points[currIdx] + (avgX - points[currIdx]) * smoothing);
      smoothedY.push(points[currIdx + 1] + (avgY - points[currIdx + 1]) * smoothing);
    }
    
    for (let i = 0; i < numPoints; i++) {
      points[i * 3] = smoothedX[i];
      points[i * 3 + 1] = smoothedY[i];
    }
  }
}

export interface ImageData {
  pixels: Float32Array | Uint16Array | Int16Array;
  width: number;
  height: number;
  rescaleSlope: number;
  rescaleIntercept: number;
  windowCenter?: number;
  windowWidth?: number;
}

export interface RegionCharacteristics {
  meanHU: number;
  stdDevHU: number;
  minHU: number;
  maxHU: number;
  medianHU: number;
  histogram: number[]; // 256 bins
  edgeStrength: number; // Average gradient magnitude at boundary
  textureEntropy: number; // Shannon entropy for texture analysis
}

export interface EdgePoint {
  x: number;
  y: number;
  gradientMagnitude: number;
  gradientDirection: number; // Angle in radians
}

/**
 * Get HU value at pixel coordinates
 */
function getHUValue(
  imageData: ImageData,
  x: number,
  y: number
): number | null {
  const { pixels, width, height, rescaleSlope, rescaleIntercept } = imageData;
  
  const pixelX = Math.floor(x);
  const pixelY = Math.floor(y);
  
  if (pixelX < 0 || pixelX >= width || pixelY < 0 || pixelY >= height) {
    return null;
  }
  
  const index = pixelY * width + pixelX;
  const rawValue = pixels[index];
  
  // Convert to Hounsfield Units
  return rawValue * rescaleSlope + rescaleIntercept;
}

/**
 * Bilinear interpolation for sub-pixel HU values
 */
function getInterpolatedHU(
  imageData: ImageData,
  x: number,
  y: number
): number | null {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  
  const dx = x - x0;
  const dy = y - y0;
  
  const hu00 = getHUValue(imageData, x0, y0);
  const hu10 = getHUValue(imageData, x1, y0);
  const hu01 = getHUValue(imageData, x0, y1);
  const hu11 = getHUValue(imageData, x1, y1);
  
  if (hu00 === null || hu10 === null || hu01 === null || hu11 === null) {
    return null;
  }
  
  // Bilinear interpolation
  const hu0 = hu00 * (1 - dx) + hu10 * dx;
  const hu1 = hu01 * (1 - dx) + hu11 * dx;
  
  return hu0 * (1 - dy) + hu1 * dy;
}

/**
 * Calculate gradient magnitude and direction at a point using Sobel operator
 */
function calculateGradient(
  imageData: ImageData,
  x: number,
  y: number
): { magnitude: number; direction: number } {
  const { pixels, width, height } = imageData;
  
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  
  // Sobel kernels
  const sobelX = [
    [-1, 0, 1],
    [-2, 0, 2],
    [-1, 0, 1]
  ];
  
  const sobelY = [
    [-1, -2, -1],
    [0, 0, 0],
    [1, 2, 1]
  ];
  
  let gx = 0;
  let gy = 0;
  
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const px = x0 + dx;
      const py = y0 + dy;
      
      if (px >= 0 && px < width && py >= 0 && py < height) {
        const hu = getHUValue(imageData, px, py) || 0;
        gx += hu * sobelX[dy + 1][dx + 1];
        gy += hu * sobelY[dy + 1][dx + 1];
      }
    }
  }
  
  const magnitude = Math.sqrt(gx * gx + gy * gy);
  const direction = Math.atan2(gy, gx);
  
  return { magnitude, direction };
}

/**
 * Analyze region characteristics inside a contour
 */
export function analyzeRegionCharacteristics(
  contour: number[],
  imageData: ImageData,
  worldToPixel: (x: number, y: number) => [number, number]
): RegionCharacteristics {
  // Convert contour to pixel coordinates
  const pixelContour: [number, number][] = [];
  for (let i = 0; i < contour.length; i += 3) {
    const [px, py] = worldToPixel(contour[i], contour[i + 1]);
    pixelContour.push([px, py]);
  }
  
  // Find bounding box
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  for (const [x, y] of pixelContour) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  
  minX = Math.floor(minX);
  maxX = Math.ceil(maxX);
  minY = Math.floor(minY);
  maxY = Math.ceil(maxY);
  
  const huValues: number[] = [];
  const histogram = new Array(256).fill(0);
  
  // Sample points inside contour
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (isPointInPolygon(x, y, pixelContour)) {
        const hu = getHUValue(imageData, x, y);
        if (hu !== null) {
          huValues.push(hu);
          
          // Build histogram (-1000 to 3000 HU mapped to 0-255)
          const binIndex = Math.floor(((hu + 1000) / 4000) * 255);
          const clampedBin = Math.max(0, Math.min(255, binIndex));
          histogram[clampedBin]++;
        }
      }
    }
  }
  
  if (huValues.length === 0) {
    return {
      meanHU: 0,
      stdDevHU: 0,
      minHU: 0,
      maxHU: 0,
      medianHU: 0,
      histogram,
      edgeStrength: 0,
      textureEntropy: 0
    };
  }
  
  // Calculate statistics
  const meanHU = huValues.reduce((sum, v) => sum + v, 0) / huValues.length;
  const variance = huValues.reduce((sum, v) => sum + Math.pow(v - meanHU, 2), 0) / huValues.length;
  const stdDevHU = Math.sqrt(variance);
  
  const sortedHU = [...huValues].sort((a, b) => a - b);
  const medianHU = sortedHU[Math.floor(sortedHU.length / 2)];
  const minHU = sortedHU[0];
  const maxHU = sortedHU[sortedHU.length - 1];
  
  // Calculate edge strength (average gradient at boundary)
  let edgeStrengthSum = 0;
  let edgeCount = 0;
  for (const [x, y] of pixelContour) {
    const { magnitude } = calculateGradient(imageData, x, y);
    edgeStrengthSum += magnitude;
    edgeCount++;
  }
  const edgeStrength = edgeCount > 0 ? edgeStrengthSum / edgeCount : 0;
  
  // Calculate texture entropy from histogram
  const totalPixels = huValues.length;
  let entropy = 0;
  for (const count of histogram) {
    if (count > 0) {
      const p = count / totalPixels;
      entropy -= p * Math.log2(p);
    }
  }
  
  return {
    meanHU,
    stdDevHU,
    minHU,
    maxHU,
    medianHU,
    histogram,
    edgeStrength,
    textureEntropy: entropy
  };
}

/**
 * Point-in-polygon test using ray casting
 */
function isPointInPolygon(x: number, y: number, polygon: [number, number][]): boolean {
  let inside = false;
  
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0];
    const yi = polygon[i][1];
    const xj = polygon[j][0];
    const yj = polygon[j][1];
    
    const intersect = ((yi > y) !== (yj > y)) &&
      (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    
    if (intersect) inside = !inside;
  }
  
  return inside;
}

/**
 * Detect edges along a path (used for contour refinement)
 */
export function detectEdgesAlongPath(
  path: [number, number][],
  imageData: ImageData,
  searchRadius: number = 5
): EdgePoint[] {
  const edgePoints: EdgePoint[] = [];
  
  for (const [x, y] of path) {
    let maxGradient = 0;
    let maxGradientPos = { x, y };
    let maxGradientDir = 0;
    
    // Search in normal direction to path
    for (let r = -searchRadius; r <= searchRadius; r++) {
      const testX = x + r;
      const testY = y;
      
      const { magnitude, direction } = calculateGradient(imageData, testX, testY);
      
      if (magnitude > maxGradient) {
        maxGradient = magnitude;
        maxGradientPos = { x: testX, y: testY };
        maxGradientDir = direction;
      }
    }
    
    edgePoints.push({
      x: maxGradientPos.x,
      y: maxGradientPos.y,
      gradientMagnitude: maxGradient,
      gradientDirection: maxGradientDir
    });
  }
  
  return edgePoints;
}

/**
 * Refine predicted contour by snapping to image edges
 */
export function snapContourToEdges(
  predictedContour: number[],
  imageData: ImageData,
  worldToPixel: (x: number, y: number) => [number, number],
  pixelToWorld: (x: number, y: number) => [number, number],
  searchRadius: number = 10,
  edgeThreshold: number = 50
): number[] {
  const refinedContour: number[] = [];
  
  for (let i = 0; i < predictedContour.length; i += 3) {
    const worldX = predictedContour[i];
    const worldY = predictedContour[i + 1];
    const worldZ = predictedContour[i + 2];
    
    const [pixelX, pixelY] = worldToPixel(worldX, worldY);
    
    // Calculate normal direction (perpendicular to contour at this point)
    const prevIdx = i - 3 < 0 ? predictedContour.length - 3 : i - 3;
    const nextIdx = i + 3 >= predictedContour.length ? 0 : i + 3;
    
    const [prevPx, prevPy] = worldToPixel(predictedContour[prevIdx], predictedContour[prevIdx + 1]);
    const [nextPx, nextPy] = worldToPixel(predictedContour[nextIdx], predictedContour[nextIdx + 1]);
    
    // Tangent direction
    const tx = nextPx - prevPx;
    const ty = nextPy - prevPy;
    const tLen = Math.sqrt(tx * tx + ty * ty) || 1;
    
    // Normal direction (perpendicular)
    const nx = -ty / tLen;
    const ny = tx / tLen;
    
    // Search along normal for strongest edge
    let bestX = pixelX;
    let bestY = pixelY;
    let bestGradient = 0;
    
    for (let r = -searchRadius; r <= searchRadius; r++) {
      const testX = pixelX + nx * r;
      const testY = pixelY + ny * r;
      
      const { magnitude } = calculateGradient(imageData, testX, testY);
      
      if (magnitude > bestGradient && magnitude >= edgeThreshold) {
        bestGradient = magnitude;
        bestX = testX;
        bestY = testY;
      }
    }
    
    // Convert back to world coordinates
    const [refinedWorldX, refinedWorldY] = pixelToWorld(bestX, bestY);
    
    refinedContour.push(refinedWorldX, refinedWorldY, worldZ);
  }
  
  return refinedContour;
}

/**
 * Calculate similarity between two region characteristics
 */
export function calculateRegionSimilarity(
  ref: RegionCharacteristics,
  target: RegionCharacteristics
): number {
  // Compare mean HU (normalized by expected range)
  const meanDiff = Math.abs(ref.meanHU - target.meanHU);
  const meanSimilarity = Math.exp(-meanDiff / 100); // 100 HU tolerance
  
  // Compare standard deviation
  const stdDevDiff = Math.abs(ref.stdDevHU - target.stdDevHU);
  const stdDevSimilarity = Math.exp(-stdDevDiff / 50);
  
  // Compare histogram using Bhattacharyya coefficient
  let histogramSimilarity = 0;
  const refSum = ref.histogram.reduce((a, b) => a + b, 0) || 1;
  const targetSum = target.histogram.reduce((a, b) => a + b, 0) || 1;
  
  for (let i = 0; i < 256; i++) {
    const refProb = ref.histogram[i] / refSum;
    const targetProb = target.histogram[i] / targetSum;
    histogramSimilarity += Math.sqrt(refProb * targetProb);
  }
  
  // Compare texture entropy
  const entropyDiff = Math.abs(ref.textureEntropy - target.textureEntropy);
  const entropySimilarity = Math.exp(-entropyDiff);
  
  // Weighted combination
  const similarity = 
    meanSimilarity * 0.4 +
    stdDevSimilarity * 0.2 +
    histogramSimilarity * 0.3 +
    entropySimilarity * 0.1;
  
  return Math.max(0, Math.min(1, similarity));
}

/**
 * Validate prediction by comparing region characteristics
 */
export function validatePrediction(
  referenceContour: number[],
  predictedContour: number[],
  referenceImageData: ImageData,
  targetImageData: ImageData,
  worldToPixel: (x: number, y: number) => [number, number]
): { isValid: boolean; similarity: number; confidence: number } {
  const refCharacteristics = analyzeRegionCharacteristics(
    referenceContour,
    referenceImageData,
    worldToPixel
  );
  
  const predCharacteristics = analyzeRegionCharacteristics(
    predictedContour,
    targetImageData,
    worldToPixel
  );
  
  const similarity = calculateRegionSimilarity(refCharacteristics, predCharacteristics);
  
  // Validation thresholds
  const isValid = similarity >= 0.6; // At least 60% similar
  const confidence = similarity;
  
  return { isValid, similarity, confidence };
}

/**
 * Full image-aware refinement pipeline
 */
export function refineContourWithImageData(
  predictedContour: number[],
  referenceContours: { contour: number[]; imageData: ImageData }[],
  targetImageData: ImageData,
  worldToPixel: (x: number, y: number) => [number, number],
  pixelToWorld: (x: number, y: number) => [number, number],
  options: {
    snapToEdges?: boolean;
    validateSimilarity?: boolean;
    searchRadius?: number;
    edgeThreshold?: number;
  } = {}
): {
  refinedContour: number[];
  confidence: number;
  metadata: {
    edgeSnapped: boolean;
    validated: boolean;
    similarity?: number;
    regionCharacteristics: RegionCharacteristics;
  };
} {
  const {
    snapToEdges = true,
    validateSimilarity = true,
    searchRadius = 10,
    edgeThreshold = 50
  } = options;
  
  let refinedContour = [...predictedContour];
  let confidence = 0.5; // Start with base confidence
  
  // Step 1: Snap to edges if enabled
  let edgeSnapped = false;
  if (snapToEdges) {
    refinedContour = snapContourToEdges(
      refinedContour,
      targetImageData,
      worldToPixel,
      pixelToWorld,
      searchRadius,
      edgeThreshold
    );
    
    // Apply light smoothing to reduce jaggedness from edge snapping
    // Each point independently snapped can create jagged contours
    smoothContourInPlace(refinedContour, 2, 0.15);
    
    edgeSnapped = true;
    confidence += 0.2; // Boost confidence
  }
  
  // Step 2: Validate similarity if we have reference contours
  let validated = false;
  let similarity = 0;
  
  if (validateSimilarity && referenceContours.length > 0) {
    // Use the most recent reference contour
    const mostRecent = referenceContours[referenceContours.length - 1];
    
    const validation = validatePrediction(
      mostRecent.contour,
      refinedContour,
      mostRecent.imageData,
      targetImageData,
      worldToPixel
    );
    
    validated = true;
    similarity = validation.similarity;
    
    // Adjust confidence based on similarity
    confidence = Math.min(1.0, confidence * validation.similarity);
  }
  
  // Step 3: Analyze final region characteristics
  const regionCharacteristics = analyzeRegionCharacteristics(
    refinedContour,
    targetImageData,
    worldToPixel
  );
  
  return {
    refinedContour,
    confidence,
    metadata: {
      edgeSnapped,
      validated,
      similarity: validated ? similarity : undefined,
      regionCharacteristics
    }
  };
}

