// Utility functions to convert brush strokes to polygons for radiotherapy contouring

interface Point3D {
  x: number;
  y: number;
  z: number;
}

/**
 * Convert brush stroke points to a polygon contour
 * Simple and clean approach for medical imaging contours
 */
export function brushStrokeToPolygon(
  brushPoints: number[][],
  brushSize: number
): number[] {
  if (brushPoints.length === 0) {
    return [];
  }
  
  // Adjust brush size to match visual preview (slightly smaller for accurate output)
  const adjustedBrushSize = brushSize * 0.9;
  
  // Handle single point - create a circle
  if (brushPoints.length === 1) {
    const center = brushPoints[0];
    const circlePoints = 12; // Simple circle
    const result: number[] = [];
    
    for (let i = 0; i < circlePoints; i++) {
      const angle = (i / circlePoints) * 2 * Math.PI;
      result.push(
        center[0] + adjustedBrushSize * Math.cos(angle),
        center[1] + adjustedBrushSize * Math.sin(angle),
        center[2]
      );
    }
    
    return result;
  }

  // Convert to Point3D format
  const points: Point3D[] = brushPoints.map(p => ({
    x: p[0],
    y: p[1],
    z: p[2]
  }));

  // Create a simple offset outline
  const leftPoints: Point3D[] = [];
  const rightPoints: Point3D[] = [];
  
  // Calculate normals for each segment
  for (let i = 0; i < points.length; i++) {
    const curr = points[i];
    let normal = { x: 0, y: 1 };
    
    if (i < points.length - 1) {
      // Use direction to next point
      const next = points[i + 1];
      const dx = next.x - curr.x;
      const dy = next.y - curr.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      
      if (len > 0) {
        // Perpendicular vector (rotated 90 degrees)
        normal = { x: -dy / len, y: dx / len };
      }
    } else if (i > 0) {
      // Last point - use direction from previous
      const prev = points[i - 1];
      const dx = curr.x - prev.x;
      const dy = curr.y - prev.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      
      if (len > 0) {
        normal = { x: -dy / len, y: dx / len };
      }
    }
    
    // Add offset points
    leftPoints.push({
      x: curr.x + normal.x * adjustedBrushSize,
      y: curr.y + normal.y * adjustedBrushSize,
      z: curr.z
    });
    
    rightPoints.push({
      x: curr.x - normal.x * adjustedBrushSize,
      y: curr.y - normal.y * adjustedBrushSize,
      z: curr.z
    });
  }
  
  // Create simple caps at the ends
  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];
  
  // Start cap (half circle)
  const startCap: Point3D[] = [];
  for (let i = 0; i <= 6; i++) {
    const angle = Math.PI + (i / 6) * Math.PI;
    startCap.push({
      x: firstPoint.x + adjustedBrushSize * Math.cos(angle),
      y: firstPoint.y + adjustedBrushSize * Math.sin(angle),
      z: firstPoint.z
    });
  }
  
  // End cap (half circle)
  const endCap: Point3D[] = [];
  for (let i = 0; i <= 6; i++) {
    const angle = (i / 6) * Math.PI;
    endCap.push({
      x: lastPoint.x + adjustedBrushSize * Math.cos(angle),
      y: lastPoint.y + adjustedBrushSize * Math.sin(angle),
      z: lastPoint.z
    });
  }
  
  // Combine in order to create closed polygon
  const outlinePoints: Point3D[] = [
    ...startCap,
    ...rightPoints,
    ...endCap,
    ...leftPoints.reverse()
  ];
  
  // Convert to flattened array
  const result: number[] = [];
  outlinePoints.forEach(point => {
    result.push(point.x, point.y, point.z);
  });
  
  return result;
}



/**
 * Merge brush stroke with existing contour using polygon union
 * This would need a proper polygon library for production use
 */
export function mergeBrushWithContour(
  existingContour: number[],
  brushPolygon: number[]
): number[] {
  if (!existingContour || existingContour.length === 0) {
    return brushPolygon;
  }
  
  if (!brushPolygon || brushPolygon.length === 0) {
    return existingContour;
  }
  
  // For now, just return the brush polygon as the new contour
  // This will replace the existing contour with the new brush stroke
  // TODO: Implement proper polygon union when ClipperLib is properly configured
  console.log('Replacing contour with new brush stroke');
  return brushPolygon;
}

/**
 * Add brush stroke to contour using polygon expansion
 * This simulates "painting" on an existing contour
 */
export function addBrushToContour(
  existingContour: number[],
  brushPoints: number[][],
  brushSize: number
): number[] {
  // Convert brush stroke to polygon
  const brushPolygon = brushStrokeToPolygon(brushPoints, brushSize);
  
  if (brushPolygon.length === 0) {
    return existingContour;
  }
  
  // Merge with existing contour
  return mergeBrushWithContour(existingContour, brushPolygon);
}

/**
 * Erase brush stroke from contour using polygon subtraction
 * This would need a proper polygon library for production use
 */
export function eraseBrushFromContour(
  existingContour: number[],
  brushPoints: number[][],
  brushSize: number
): number[] {
  // TODO: Implement proper polygon subtraction
  console.warn('Polygon subtraction not yet implemented');
  return existingContour;
}