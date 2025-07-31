/**
 * Smart Brush Utilities - Gradient-Sensitive Region Growing
 * Implements Eclipse-style adaptive brush behavior with edge detection
 */

interface Point {
  x: number;
  y: number;
}

interface ImageData {
  pixels: Uint16Array | Uint8Array;
  width: number;
  height: number;
  windowCenter: number;
  windowWidth: number;
}

/**
 * Compute gradient magnitude at a pixel using Sobel operator
 */
function computeGradientMagnitude(
  pixels: Uint16Array | Uint8Array,
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
 * Adaptive region growing from seed points
 * Grows until hitting strong gradients (edges)
 */
export function adaptiveRegionGrow(
  imageData: ImageData,
  seedPoints: Point[],
  brushRadius: number,
  isEraseMode: boolean,
  existingMask?: Uint8Array
): Uint8Array {
  const { pixels, width, height } = imageData;
  const mask = new Uint8Array(width * height);
  
  // Copy existing mask if provided
  if (existingMask) {
    mask.set(existingMask);
  }
  
  // Compute gradient map
  const gradientMap = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      gradientMap[y * width + x] = computeGradientMagnitude(pixels, x, y, width, height);
    }
  }
  
  // Find gradient threshold (adaptive based on local statistics)
  const getLocalGradientThreshold = (cx: number, cy: number, radius: number): number => {
    let sum = 0;
    let count = 0;
    const r2 = radius * radius;
    
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy > r2) continue;
        
        const x = cx + dx;
        const y = cy + dy;
        
        if (x >= 0 && x < width && y >= 0 && y < height) {
          sum += gradientMap[y * width + x];
          count++;
        }
      }
    }
    
    const mean = sum / count;
    // Use 1.5x mean as threshold for edge detection
    return mean * 1.5;
  };
  
  // Process each seed point
  for (const seed of seedPoints) {
    const cx = Math.round(seed.x);
    const cy = Math.round(seed.y);
    
    if (cx < 0 || cx >= width || cy < 0 || cy >= height) continue;
    
    const gradientThreshold = getLocalGradientThreshold(cx, cy, brushRadius);
    const centerIntensity = pixels[cy * width + cx];
    
    // Flood fill with gradient stopping
    const queue: Point[] = [{ x: cx, y: cy }];
    const visited = new Set<number>();
    
    while (queue.length > 0) {
      const { x, y } = queue.shift()!;
      const idx = y * width + x;
      
      if (visited.has(idx)) continue;
      visited.add(idx);
      
      // Check if within brush radius
      const dx = x - cx;
      const dy = y - cy;
      const dist2 = dx * dx + dy * dy;
      if (dist2 > brushRadius * brushRadius) continue;
      
      // Check gradient (stop at edges)
      const gradient = gradientMap[idx];
      if (gradient > gradientThreshold) continue;
      
      // Check intensity similarity (for homogeneous regions)
      const intensity = pixels[idx];
      const intensityDiff = Math.abs(intensity - centerIntensity);
      const maxIntensityDiff = 50; // Adjust based on CT window
      
      if (intensityDiff > maxIntensityDiff) continue;
      
      // Apply operation
      if (isEraseMode) {
        mask[idx] = 0;
      } else {
        mask[idx] = 1;
      }
      
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
          queue.push(neighbor);
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