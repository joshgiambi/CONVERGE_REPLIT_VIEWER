/**
 * Smart Brush Utilities - Eclipse Adaptive Brush Tool
 * Implements gradient-guided, topology-aware region growing with edge detection
 */

interface Point {
  x: number;
  y: number;
}

/**
 * Calculate adaptive radius based on local tissue characteristics
 * Returns the adapted radius for a given position
 */
export function calculateAdaptiveRadius(
  pixelData: Float32Array | Uint16Array | Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  baseRadius: number
): number {
  const cx = Math.round(x);
  const cy = Math.round(y);
  
  if (cx < 0 || cx >= width || cy < 0 || cy >= height) return baseRadius;
  
  // Get intensity at center point
  const centerIntensity = pixelData[cy * width + cx];
  
  // Check intensity variance in a small window
  let variance = 0;
  let count = 0;
  const checkRadius = 3; // Smaller window for faster response
  
  for (let dy = -checkRadius; dy <= checkRadius; dy++) {
    for (let dx = -checkRadius; dx <= checkRadius; dx++) {
      const px = cx + dx;
      const py = cy + dy;
      if (px >= 0 && px < width && py >= 0 && py < height) {
        const intensity = pixelData[py * width + px];
        variance += Math.abs(intensity - centerIntensity);
        count++;
      }
    }
  }
  
  variance /= count;
  
  // Adapt radius based on variance (inverted from Eclipse description)
  // High variance = near edge = smaller brush
  // Low variance = homogeneous = larger brush
  if (variance > 80) {
    return baseRadius * 0.3; // 30% size at edges
  } else if (variance > 40) {
    return baseRadius * 0.5; // 50% size near edges  
  } else if (variance > 20) {
    return baseRadius * 0.7; // 70% size in transition
  } else {
    return baseRadius; // Full size in homogeneous regions
  }
}

/**
 * Adaptive brush stroke - paints with dynamically sized brush
 * Creates a clean continuous stroke without overlaps
 */
export function adaptiveBrushStroke(
  pixelData: Float32Array | Uint16Array | Uint8Array,
  width: number,
  height: number,
  strokePoints: Point[],
  baseRadius: number
): Uint8Array {
  const mask = new Uint8Array(width * height);
  const painted = new Set<number>(); // Track painted pixels to avoid overlaps
  
  // For each point in the stroke
  for (let i = 0; i < strokePoints.length; i++) {
    const point = strokePoints[i];
    const cx = Math.round(point.x);
    const cy = Math.round(point.y);
    
    if (cx < 0 || cx >= width || cy < 0 || cy >= height) continue;
    
    // Get adaptive radius for this position
    const adaptiveRadius = calculateAdaptiveRadius(pixelData, width, height, cx, cy, baseRadius);
    
    // Paint circular brush at this point
    const radiusSquared = adaptiveRadius * adaptiveRadius;
    
    for (let dy = -Math.ceil(adaptiveRadius); dy <= Math.ceil(adaptiveRadius); dy++) {
      for (let dx = -Math.ceil(adaptiveRadius); dx <= Math.ceil(adaptiveRadius); dx++) {
        const x = cx + dx;
        const y = cy + dy;
        
        if (x >= 0 && x < width && y >= 0 && y < height) {
          const distSquared = dx * dx + dy * dy;
          if (distSquared <= radiusSquared) {
            const idx = y * width + x;
            if (!painted.has(idx)) { // Only paint if not already painted
              mask[idx] = 255;
              painted.add(idx);
            }
          }
        }
      }
    }
  }
  
  return mask;
}

/**
 * Compute gradient magnitude at a pixel using Sobel operator
 */
function computeGradientMagnitude(
  pixels: Float32Array | Uint16Array | Uint8Array,
  x: number,
  y: number,
  width: number,
  height: number
): number {
  if (x <= 0 || x >= width - 1 || y <= 0 || y >= height - 1) {
    return 0;
  }

  const idx = (py: number, px: number) => py * width + px;
  
  // Sobel X kernel
  const gx = 
    -1 * pixels[idx(y - 1, x - 1)] + 1 * pixels[idx(y - 1, x + 1)] +
    -2 * pixels[idx(y, x - 1)] + 2 * pixels[idx(y, x + 1)] +
    -1 * pixels[idx(y + 1, x - 1)] + 1 * pixels[idx(y + 1, x + 1)];
  
  // Sobel Y kernel
  const gy = 
    -1 * pixels[idx(y - 1, x - 1)] + -2 * pixels[idx(y - 1, x)] + -1 * pixels[idx(y - 1, x + 1)] +
    1 * pixels[idx(y + 1, x - 1)] + 2 * pixels[idx(y + 1, x)] + 1 * pixels[idx(y + 1, x + 1)];
  
  return Math.sqrt(gx * gx + gy * gy);
}

/**
 * Convert world-space polygon to binary mask
 */
export function polygonToMask(
  polygonPoints: number[],
  width: number,
  height: number,
  imagePosition: number[],
  pixelSpacing: number[]
): Uint8Array {
  const mask = new Uint8Array(width * height);
  
  // Convert world points to pixel points
  const pixelPoints: Point[] = [];
  for (let i = 0; i < polygonPoints.length; i += 3) {
    const worldX = polygonPoints[i];
    const worldY = polygonPoints[i + 1];
    
    const pixelX = Math.round((worldX - imagePosition[0]) / pixelSpacing[1]);
    const pixelY = Math.round((worldY - imagePosition[1]) / pixelSpacing[0]);
    
    pixelPoints.push({ x: pixelX, y: pixelY });
  }
  
  // Fill polygon using scanline algorithm
  if (pixelPoints.length < 3) return mask;
  
  // Find bounds
  let minY = height, maxY = 0;
  for (const p of pixelPoints) {
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  
  // Scanline fill
  for (let y = Math.max(0, minY); y <= Math.min(height - 1, maxY); y++) {
    const intersections: number[] = [];
    
    // Find intersections with horizontal scanline
    for (let i = 0; i < pixelPoints.length; i++) {
      const p1 = pixelPoints[i];
      const p2 = pixelPoints[(i + 1) % pixelPoints.length];
      
      if ((p1.y <= y && p2.y > y) || (p2.y <= y && p1.y > y)) {
        const t = (y - p1.y) / (p2.y - p1.y);
        const x = p1.x + t * (p2.x - p1.x);
        intersections.push(x);
      }
    }
    
    // Sort intersections and fill between pairs
    intersections.sort((a, b) => a - b);
    for (let i = 0; i < intersections.length; i += 2) {
      if (i + 1 < intersections.length) {
        const x1 = Math.max(0, Math.floor(intersections[i]));
        const x2 = Math.min(width - 1, Math.ceil(intersections[i + 1]));
        for (let x = x1; x <= x2; x++) {
          mask[y * width + x] = 255;
        }
      }
    }
  }
  
  return mask;
}

/**
 * Adaptive region growing from seed points - Eclipse-style
 * Grows until hitting strong gradients (edges) within brush ROI
 */
export function adaptiveRegionGrow(
  pixelData: Float32Array | Uint16Array | Uint8Array,
  width: number,
  height: number,
  seedPoints: Point[],
  brushRadius: number,
  gradientThreshold: number,
  maxIterations: number,
  hounsFieldWindow: number
): Uint8Array {
  console.log('🚀 adaptiveRegionGrow called with:', {
    pixelDataType: pixelData.constructor.name,
    width, height,
    seedPoints,
    brushRadius,
    gradientThreshold,
    maxIterations,
    hounsFieldWindow
  });
  
  const mask = new Uint8Array(width * height);
  
  // Compute gradient map
  const gradientMap = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      gradientMap[y * width + x] = computeGradientMagnitude(pixelData, x, y, width, height);
    }
  }
  
  // Normalize gradient map
  let maxGradient = 0;
  for (let i = 0; i < gradientMap.length; i++) {
    maxGradient = Math.max(maxGradient, gradientMap[i]);
  }
  
  if (maxGradient > 0) {
    for (let i = 0; i < gradientMap.length; i++) {
      gradientMap[i] = (gradientMap[i] / maxGradient) * 255;
    }
  }
  
  // Process each seed point
  for (const seed of seedPoints) {
    const cx = Math.round(seed.x);
    const cy = Math.round(seed.y);
    
    if (cx < 0 || cx >= width || cy < 0 || cy >= height) continue;
    
    // Get adaptive threshold based on local gradient statistics
    let localMean = 0;
    let localCount = 0;
    const searchRadius = Math.min(brushRadius, 20);
    
    for (let dy = -searchRadius; dy <= searchRadius; dy++) {
      for (let dx = -searchRadius; dx <= searchRadius; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && x < width && y >= 0 && y < height) {
          localMean += gradientMap[y * width + x];
          localCount++;
        }
      }
    }
    
    localMean /= localCount;
    const adaptiveThreshold = Math.max(gradientThreshold, localMean * 1.5);
    
    // Get center pixel intensity for similarity comparison
    const centerIntensity = pixelData[cy * width + cx];
    const intensityTolerance = hounsFieldWindow / 2;
    
    // Flood fill with gradient and intensity constraints
    const queue: Point[] = [{ x: cx, y: cy }];
    const visited = new Set<number>();
    let iterations = 0;
    
    while (queue.length > 0 && iterations < maxIterations) {
      iterations++;
      const { x, y } = queue.shift()!;
      const idx = y * width + x;
      
      if (visited.has(idx)) continue;
      visited.add(idx);
      
      // Check if within brush radius
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > brushRadius) continue;
      
      // Check gradient (stop at edges)
      const gradient = gradientMap[idx];
      if (gradient > adaptiveThreshold) continue;
      
      // Check intensity similarity (for homogeneous regions)
      const intensity = pixelData[idx];
      const intensityDiff = Math.abs(intensity - centerIntensity);
      
      if (intensityDiff > intensityTolerance) continue;
      
      // Mark pixel as part of the region
      mask[idx] = 255;
      
      // Add neighbors to queue
      const neighbors = [
        { x: x - 1, y },
        { x: x + 1, y },
        { x, y: y - 1 },
        { x, y: y + 1 }
      ];
      
      for (const neighbor of neighbors) {
        if (neighbor.x >= 0 && neighbor.x < width && 
            neighbor.y >= 0 && neighbor.y < height) {
          const nIdx = neighbor.y * width + neighbor.x;
          if (!visited.has(nIdx)) {
            queue.push(neighbor);
          }
        }
      }
    }
  }
  
  return mask;
}

/**
 * Apply Gaussian smoothing to contour mask
 */
export function smoothContourMask(
  mask: Uint8Array,
  width: number,
  height: number,
  sigma: number = 1.0
): Uint8Array {
  const smoothed = new Uint8Array(width * height);
  const kernel = createGaussianKernel(sigma);
  const kernelRadius = Math.floor(kernel.length / 2);
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let weightSum = 0;
      
      for (let ky = -kernelRadius; ky <= kernelRadius; ky++) {
        for (let kx = -kernelRadius; kx <= kernelRadius; kx++) {
          const px = x + kx;
          const py = y + ky;
          
          if (px >= 0 && px < width && py >= 0 && py < height) {
            const weight = kernel[ky + kernelRadius] * kernel[kx + kernelRadius];
            sum += mask[py * width + px] * weight;
            weightSum += weight;
          }
        }
      }
      
      smoothed[y * width + x] = Math.round(sum / weightSum);
    }
  }
  
  // Apply threshold to convert back to binary
  for (let i = 0; i < smoothed.length; i++) {
    smoothed[i] = smoothed[i] > 127 ? 1 : 0;
  }
  
  return smoothed;
}

/**
 * Create 1D Gaussian kernel
 */
function createGaussianKernel(sigma: number): Float32Array {
  const radius = Math.ceil(sigma * 3);
  const size = radius * 2 + 1;
  const kernel = new Float32Array(size);
  
  let sum = 0;
  for (let i = 0; i < size; i++) {
    const x = i - radius;
    kernel[i] = Math.exp(-(x * x) / (2 * sigma * sigma));
    sum += kernel[i];
  }
  
  // Normalize
  for (let i = 0; i < size; i++) {
    kernel[i] /= sum;
  }
  
  return kernel;
}

/**
 * Convert mask to polygon points for contour representation
 */
export function maskToContourPoints(
  mask: Uint8Array,
  width: number,
  height: number,
  simplificationTolerance: number = 1.0
): Point[] {
  // Find contour using marching squares algorithm
  const contours: Point[][] = [];
  const visited = new Uint8Array(width * height);
  
  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      const idx = y * width + x;
      if (visited[idx] || !mask[idx]) continue;
      
      // Start contour tracing
      const contour = traceContour(mask, width, height, x, y, visited);
      if (contour.length > 3) {
        contours.push(contour);
      }
    }
  }
  
  // Return the largest contour
  if (contours.length === 0) return [];
  
  const largestContour = contours.reduce((a, b) => a.length > b.length ? a : b);
  
  // Simplify using Douglas-Peucker algorithm
  return simplifyContour(largestContour, simplificationTolerance);
}

/**
 * Trace contour from a starting point
 */
function traceContour(
  mask: Uint8Array,
  width: number,
  height: number,
  startX: number,
  startY: number,
  visited: Uint8Array
): Point[] {
  const contour: Point[] = [];
  const directions = [
    { dx: 1, dy: 0 },   // Right
    { dx: 1, dy: 1 },   // Down-Right
    { dx: 0, dy: 1 },   // Down
    { dx: -1, dy: 1 },  // Down-Left
    { dx: -1, dy: 0 },  // Left
    { dx: -1, dy: -1 }, // Up-Left
    { dx: 0, dy: -1 },  // Up
    { dx: 1, dy: -1 }   // Up-Right
  ];
  
  let x = startX;
  let y = startY;
  let dir = 0;
  
  do {
    contour.push({ x, y });
    visited[y * width + x] = 1;
    
    // Find next point
    let found = false;
    for (let i = 0; i < 8; i++) {
      const nextDir = (dir + i) % 8;
      const nx = x + directions[nextDir].dx;
      const ny = y + directions[nextDir].dy;
      
      if (nx >= 0 && nx < width && ny >= 0 && ny < height && 
          mask[ny * width + nx] && !visited[ny * width + nx]) {
        x = nx;
        y = ny;
        dir = (nextDir + 6) % 8; // Turn left for next search
        found = true;
        break;
      }
    }
    
    if (!found) break;
    
  } while (x !== startX || y !== startY);
  
  return contour;
}

/**
 * Simplify contour using Douglas-Peucker algorithm
 */
function simplifyContour(points: Point[], tolerance: number): Point[] {
  if (points.length < 3) return points;
  
  // Find point with maximum distance from line between first and last
  let maxDist = 0;
  let maxIndex = 0;
  
  for (let i = 1; i < points.length - 1; i++) {
    const dist = perpendicularDistance(points[i], points[0], points[points.length - 1]);
    if (dist > maxDist) {
      maxDist = dist;
      maxIndex = i;
    }
  }
  
  // If max distance is greater than tolerance, recursively simplify
  if (maxDist > tolerance) {
    const left = simplifyContour(points.slice(0, maxIndex + 1), tolerance);
    const right = simplifyContour(points.slice(maxIndex), tolerance);
    
    return [...left.slice(0, -1), ...right];
  } else {
    return [points[0], points[points.length - 1]];
  }
}

/**
 * Calculate perpendicular distance from point to line
 */
function perpendicularDistance(point: Point, lineStart: Point, lineEnd: Point): number {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  
  const norm = Math.sqrt(dx * dx + dy * dy);
  if (norm === 0) return Math.sqrt((point.x - lineStart.x) ** 2 + (point.y - lineStart.y) ** 2);
  
  return Math.abs(dy * point.x - dx * point.y + lineEnd.x * lineStart.y - lineEnd.y * lineStart.x) / norm;
}

/**
 * Merge adaptive brush region with existing mask
 */
export function mergeWithExistingMask(
  adaptiveMask: Uint8Array,
  existingMask: Uint8Array,
  width: number,
  height: number,
  isSubtract: boolean = false
): Uint8Array {
  const result = new Uint8Array(width * height);
  
  for (let i = 0; i < result.length; i++) {
    if (isSubtract) {
      // Subtract operation
      result[i] = existingMask[i] && !adaptiveMask[i] ? 255 : 0;
    } else {
      // Union operation
      result[i] = existingMask[i] || adaptiveMask[i] ? 255 : 0;
    }
  }
  
  return result;
}

/**
 * Create real-time preview of adaptive brush region
 */
export function createAdaptivePreview(
  pixelData: Float32Array | Uint16Array | Uint8Array,
  width: number,
  height: number,
  brushX: number,
  brushY: number,
  brushRadius: number,
  gradientThreshold: number
): { mask: Uint8Array; bounds: { minX: number; minY: number; maxX: number; maxY: number } } {
  // Quick region grow for preview
  console.log('🎨 Creating adaptive preview at:', { brushX, brushY, brushRadius, gradientThreshold });
  
  const previewMask = adaptiveRegionGrow(
    pixelData,
    width,
    height,
    [{ x: brushX, y: brushY }],
    brushRadius,
    gradientThreshold,
    500, // Fewer iterations for preview
    200  // Smaller HU window for preview
  );
  
  console.log('📊 Preview mask generated:', {
    totalPixels: width * height,
    filledPixels: Array.from(previewMask).filter(v => v > 0).length
  });
  
  // Find bounds for efficient rendering
  let minX = width, minY = height, maxX = 0, maxY = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (previewMask[y * width + x]) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  
  return {
    mask: previewMask,
    bounds: { minX, minY, maxX, maxY }
  };
}