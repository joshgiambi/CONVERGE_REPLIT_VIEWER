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
  // Temporarily use a simple circle for debugging
  if (true) {
    return createCirclePoints(centerX, centerY, radius);
  }
  
  // Re-enable adaptive preview with smoother, more sensitive algorithm
  const cx = Math.round(centerX);
  const cy = Math.round(centerY);
  
  if (cx < 0 || cx >= width || cy < 0 || cy >= height) {
    // Return a simple circle if out of bounds
    return createCirclePoints(centerX, centerY, radius);
  }
  
  // Get intensity at center
  const centerIntensity = pixelData[cy * width + cx];
  
  // Sample more rays for smoother shape
  const numRays = 64; // Double the rays for smoother shape
  const shapePoints: Point[] = [];
  
  for (let i = 0; i < numRays; i++) {
    const angle = (i / numRays) * Math.PI * 2;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    
    // Find edge with more sensitive detection
    let distance = radius;
    const step = 0.5; // Smaller steps for smoother edge detection
    let prevIntensity = centerIntensity;
    
    for (let d = 1; d <= radius; d += step) {
      const x = Math.round(cx + dx * d);
      const y = Math.round(cy + dy * d);
      
      if (x < 0 || x >= width || y < 0 || y >= height) {
        distance = d - step;
        break;
      }
      
      const pixelIntensity = pixelData[y * width + x];
      const gradientMagnitude = Math.abs(pixelIntensity - prevIntensity);
      
      // More sensitive threshold - detect smaller changes
      const threshold = 20; // Much lower threshold for higher sensitivity
      if (gradientMagnitude > threshold) {
        distance = d - step;
        break;
      }
      
      prevIntensity = pixelIntensity;
    }
    
    // Add point at this distance
    shapePoints.push({
      x: centerX + dx * distance,
      y: centerY + dy * distance
    });
  }
  
  // Smooth the shape by averaging neighboring points
  const smoothedPoints: Point[] = [];
  for (let i = 0; i < shapePoints.length; i++) {
    const prev = shapePoints[(i - 1 + shapePoints.length) % shapePoints.length];
    const curr = shapePoints[i];
    const next = shapePoints[(i + 1) % shapePoints.length];
    
    smoothedPoints.push({
      x: (prev.x + curr.x * 2 + next.x) / 4,
      y: (prev.y + curr.y * 2 + next.y) / 4
    });
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