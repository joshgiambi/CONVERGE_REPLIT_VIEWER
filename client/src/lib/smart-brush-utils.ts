/**
 * Smart brush utilities for adaptive contouring
 * A sophisticated, stable implementation for a polished user experience.
 */

interface Point {
  x: number;
  y: number;
}

/**
 * Creates a refined adaptive preview that is both "tighter to borders" and "less jagged."
 * This implementation uses more advanced techniques for edge detection and smoothing.
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
  
  if (cx < 0 || cx >= width || cy < 0 || cy >= height || !pixelData || pixelData.length === 0) {
    return createCirclePoints(centerX, centerY, radius);
  }
  
  try {
    const centerIntensity = pixelData[cy * width + cx] || 0;
    
    // A more sensitive threshold that adapts to the local tissue density.
    // Increased multiplier to reduce bleeding into surrounding structures
    const adaptiveThreshold = Math.max(12, Math.abs(centerIntensity) * 0.15);
    
    const numRays = 48; // Increased for a smoother initial shape.
    const shapePoints: Point[] = [];
    
    for (let i = 0; i < numRays; i++) {
      const angle = (i / numRays) * Math.PI * 2;
      const dx = Math.cos(angle);
      const dy = Math.sin(angle);
      
      let distance = radius;
      
      // We'll sample along the ray and look for a significant gradient change.
      const step = 1.5; // A slightly larger step for performance.
      for (let d = 1; d <= radius; d += step) {
        const x = Math.round(cx + dx * d);
        const y = Math.round(cy + dy * d);
        
        if (x < 0 || x >= width || y < 0 || y >= height) {
          distance = Math.max(radius * 0.5, d - step);
          break;
        }
        
        const pixelIntensity = pixelData[y * width + x] || 0;
        const intensityDiff = Math.abs(pixelIntensity - centerIntensity);
        
        if (intensityDiff > adaptiveThreshold) {
          // We've found a border. We'll set the distance and stop searching.
          distance = Math.max(radius * 0.4, d - step * 2);
          break;
        }
      }
      
      // We'll add a slight expansion in uniform areas to make the tool feel more responsive.
      if (distance === radius) {
        distance = radius * 1.05;
      }
      
      shapePoints.push({
        x: centerX + dx * distance,
        y: centerY + dy * distance
      });
    }
    
    // This is the key to a "less jagged" appearance: a multi-pass smoothing filter.
    // We apply a simple averaging filter multiple times to smooth out sharp edges.
    let smoothedPoints = [...shapePoints];
    const smoothingPasses = 3;
    for (let pass = 0; pass < smoothingPasses; pass++) {
      const passPoints: Point[] = [];
      for (let i = 0; i < smoothedPoints.length; i++) {
        const prev = smoothedPoints[(i - 1 + smoothedPoints.length) % smoothedPoints.length];
        const curr = smoothedPoints[i];
        const next = smoothedPoints[(i + 1) % smoothedPoints.length];
        
        // A simple weighted average provides effective smoothing.
        passPoints.push({
          x: (prev.x * 0.25 + curr.x * 0.5 + next.x * 0.25),
          y: (prev.y * 0.25 + curr.y * 0.5 + next.y * 0.25)
        });
      }
      smoothedPoints = passPoints;
    }
    
    return smoothedPoints;
    
  } catch (error) {
    console.warn("Error in adaptive preview, falling back to circle:", error);
    return createCirclePoints(centerX, centerY, radius);
  }
}

/**
 * A fallback function to create a simple circle.
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