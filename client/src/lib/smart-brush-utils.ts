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
  
  // Get intensity at center
  const centerIntensity = pixelData[cy * width + cx];
  
  // Sample rays from center to find tissue boundaries
  const numRays = 32; // Number of rays to cast
  const shapePoints: Point[] = [];
  
  for (let i = 0; i < numRays; i++) {
    const angle = (i / numRays) * Math.PI * 2;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    
    // Find how far we can go along this ray while staying in similar tissue
    let distance = 0;
    const maxDistance = radius;
    const step = 1;
    
    while (distance < maxDistance) {
      distance += step;
      const x = Math.round(cx + dx * distance);
      const y = Math.round(cy + dy * distance);
      
      if (x < 0 || x >= width || y < 0 || y >= height) break;
      
      const pixelIntensity = pixelData[y * width + x];
      const intensityDiff = Math.abs(pixelIntensity - centerIntensity);
      
      // Stop if we hit different tissue (threshold based on tissue type)
      const threshold = getAdaptiveThreshold(centerIntensity);
      if (intensityDiff > threshold) {
        distance -= step; // Back up one step
        break;
      }
    }
    
    // Add point at this distance
    shapePoints.push({
      x: centerX + dx * distance,
      y: centerY + dy * distance
    });
  }
  
  return shapePoints;
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