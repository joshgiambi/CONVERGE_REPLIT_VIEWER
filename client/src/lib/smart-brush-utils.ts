/**
 * Smart brush utilities for adaptive contouring
 * Creates a morphing preview shape based on underlying tissue
 */

interface Point {
  x: number;
  y: number;
}

/**
 * Create an adaptive preview shape that morphs based on tissue under the cursor
 * Returns points that form the shape outline
 */
export function createAdaptivePreview(
  pixelData: Float32Array | Uint16Array | Uint8Array,
  width: number,
  height: number,
  centerX: number,
  centerY: number,
  radius: number
): Point[] {
  const cx = Math.round(centerX);
  const cy = Math.round(centerY);
  
  if (cx < 0 || cx >= width || cy < 0 || cy >= height) {
    // Return a simple circle if out of bounds
    return createCirclePoints(centerX, centerY, radius);
  }
  
  // Get intensity at center and calculate local statistics
  const centerIntensity = pixelData[cy * width + cx];
  
  // Calculate local gradient to adapt threshold
  let gradientSum = 0;
  let gradientCount = 0;
  const sampleRadius = 5;
  
  for (let dy = -sampleRadius; dy <= sampleRadius; dy++) {
    for (let dx = -sampleRadius; dx <= sampleRadius; dx++) {
      const x1 = cx + dx;
      const y1 = cy + dy;
      const x2 = cx + dx + 1;
      const y2 = cy + dy + 1;
      
      if (x1 >= 0 && x2 < width && y1 >= 0 && y2 < height) {
        const i1 = pixelData[y1 * width + x1];
        const i2 = pixelData[y1 * width + x2];
        const i3 = pixelData[y2 * width + x1];
        
        const gx = Math.abs(i2 - i1);
        const gy = Math.abs(i3 - i1);
        gradientSum += Math.sqrt(gx * gx + gy * gy);
        gradientCount++;
      }
    }
  }
  
  const avgGradient = gradientCount > 0 ? gradientSum / gradientCount : 10;
  // Lower threshold for more sensitivity
  const adaptiveThreshold = Math.max(3, Math.min(10, avgGradient * 0.3));
  
  // Sample more rays for smoother shape
  const numRays = 128; // Even more rays for smoother shape
  const shapePoints: Point[] = [];
  
  for (let i = 0; i < numRays; i++) {
    const angle = (i / numRays) * Math.PI * 2;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    
    // Find edge with gradient-based detection
    let distance = radius;
    const step = 0.25; // Even smaller steps
    let intensityBuffer: number[] = [];
    
    for (let d = 0; d <= radius; d += step) {
      const x = Math.round(cx + dx * d);
      const y = Math.round(cy + dy * d);
      
      if (x < 0 || x >= width || y < 0 || y >= height) {
        distance = Math.max(1, d - step * 3);
        break;
      }
      
      const pixelIntensity = pixelData[y * width + x];
      intensityBuffer.push(pixelIntensity);
      
      // Use gradient over last few samples
      if (intensityBuffer.length >= 4) {
        const recent = intensityBuffer.slice(-4);
        const gradient = Math.abs(recent[recent.length - 1] - recent[0]) / 3;
        
        if (gradient > adaptiveThreshold) {
          // Contract more dramatically at boundaries
          distance = Math.max(radius * 0.3, d - step * 4);
          break;
        }
      }
    }
    
    // Adjust distance based on whether we hit a boundary or not
    let adjustedDistance = distance;
    if (distance >= radius * 0.9) {
      // In homogeneous area - expand slightly
      adjustedDistance = Math.min(radius * 1.1, distance * 1.05);
    } else {
      // Hit a boundary - keep contracted
      adjustedDistance = distance * 0.9;
    }
    
    shapePoints.push({
      x: centerX + dx * adjustedDistance,
      y: centerY + dy * adjustedDistance
    });
  }
  
  // Apply multiple passes of smoothing for a very smooth shape
  let smoothedPoints = [...shapePoints];
  
  // First pass - aggressive smoothing
  for (let pass = 0; pass < 3; pass++) {
    const newPoints: Point[] = [];
    for (let i = 0; i < smoothedPoints.length; i++) {
      const prev2 = smoothedPoints[(i - 2 + smoothedPoints.length) % smoothedPoints.length];
      const prev = smoothedPoints[(i - 1 + smoothedPoints.length) % smoothedPoints.length];
      const curr = smoothedPoints[i];
      const next = smoothedPoints[(i + 1) % smoothedPoints.length];
      const next2 = smoothedPoints[(i + 2) % smoothedPoints.length];
      
      // 5-point weighted average for smoother result
      newPoints.push({
        x: (prev2.x * 0.1 + prev.x * 0.2 + curr.x * 0.4 + next.x * 0.2 + next2.x * 0.1),
        y: (prev2.y * 0.1 + prev.y * 0.2 + curr.y * 0.4 + next.y * 0.2 + next2.y * 0.1)
      });
    }
    smoothedPoints = newPoints;
  }
  
  return smoothedPoints;
}

/**
 * Get adaptive threshold based on tissue type
 */
function getAdaptiveThreshold(intensity: number): number {
  // Air: < -500 HU
  if (intensity < -500) return 200;
  // Soft tissue: -100 to 100 HU  
  if (intensity >= -100 && intensity <= 100) return 50;
  // Bone: > 400 HU
  if (intensity > 400) return 100;
  // Default
  return 75;
}

/**
 * Create circle points for fallback
 */
function createCirclePoints(cx: number, cy: number, radius: number): Point[] {
  const points: Point[] = [];
  const numPoints = 32;
  
  for (let i = 0; i < numPoints; i++) {
    const angle = (i / numPoints) * Math.PI * 2;
    points.push({
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius
    });
  }
  
  return points;
}