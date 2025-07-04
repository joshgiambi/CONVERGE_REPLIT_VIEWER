// Utility functions to convert brush strokes to polygons for radiotherapy contouring

interface Point3D {
  x: number;
  y: number;
  z: number;
}

/**
 * Convert brush stroke points to a polygon contour with accurate outline
 * This creates a medical-grade contour that follows the brush stroke precisely
 */
export function brushStrokeToPolygon(
  brushPoints: number[][],
  brushSize: number
): number[] {
  if (brushPoints.length === 0) {
    return [];
  }
  
  // Handle single point - create a circle
  if (brushPoints.length === 1) {
    const center = brushPoints[0];
    const circlePoints = 32; // Points for a smooth circle
    const result: number[] = [];
    
    for (let i = 0; i < circlePoints; i++) {
      const angle = (i / circlePoints) * 2 * Math.PI;
      result.push(
        center[0] + brushSize * Math.cos(angle),
        center[1] + brushSize * Math.sin(angle),
        center[2]
      );
    }
    
    return result;
  }
  
  // Handle two points - create a capsule shape
  if (brushPoints.length === 2) {
    const p1 = brushPoints[0];
    const p2 = brushPoints[1];
    const dx = p2[0] - p1[0];
    const dy = p2[1] - p1[1];
    const len = Math.sqrt(dx * dx + dy * dy);
    
    // Normal vector
    const nx = len > 0 ? -dy / len : 0;
    const ny = len > 0 ? dx / len : 1;
    
    const result: number[] = [];
    const capPoints = 16;
    
    // First cap
    for (let i = 0; i <= capPoints / 2; i++) {
      const angle = Math.PI / 2 + (i / (capPoints / 2)) * Math.PI;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      result.push(
        p1[0] + brushSize * (nx * cos - dx / len * sin),
        p1[1] + brushSize * (ny * cos - dy / len * sin),
        p1[2]
      );
    }
    
    // Second cap
    for (let i = 0; i <= capPoints / 2; i++) {
      const angle = -Math.PI / 2 + (i / (capPoints / 2)) * Math.PI;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      result.push(
        p2[0] + brushSize * (nx * cos + dx / len * sin),
        p2[1] + brushSize * (ny * cos + dy / len * sin),
        p2[2]
      );
    }
    
    return result;
  }

  // Convert to Point3D format for easier manipulation
  const points: Point3D[] = brushPoints.map(p => ({
    x: p[0],
    y: p[1],
    z: p[2]
  }));

  // Generate outline points by creating an accurate buffer around the stroke
  const leftSide: Point3D[] = [];
  const rightSide: Point3D[] = [];
  
  // Process each segment of the brush stroke
  for (let i = 0; i < points.length; i++) {
    const curr = points[i];
    let tangent = { x: 0, y: 0 };
    
    if (i === 0) {
      // First point - use direction to next point
      const next = points[i + 1];
      tangent.x = next.x - curr.x;
      tangent.y = next.y - curr.y;
    } else if (i === points.length - 1) {
      // Last point - use direction from previous point
      const prev = points[i - 1];
      tangent.x = curr.x - prev.x;
      tangent.y = curr.y - prev.y;
    } else {
      // Middle points - average of directions
      const prev = points[i - 1];
      const next = points[i + 1];
      tangent.x = next.x - prev.x;
      tangent.y = next.y - prev.y;
    }
    
    // Normalize tangent
    const len = Math.sqrt(tangent.x * tangent.x + tangent.y * tangent.y);
    if (len > 0) {
      tangent.x /= len;
      tangent.y /= len;
    } else {
      tangent = { x: 1, y: 0 };
    }
    
    // Calculate perpendicular (normal) vector
    const normal = { x: -tangent.y, y: tangent.x };
    
    // Add points on both sides
    leftSide.push({
      x: curr.x + normal.x * brushSize,
      y: curr.y + normal.y * brushSize,
      z: curr.z
    });
    
    rightSide.push({
      x: curr.x - normal.x * brushSize,
      y: curr.y - normal.y * brushSize,
      z: curr.z
    });
  }
  
  // Add rounded caps at the ends
  const capPoints = 16; // More points for smoother caps
  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];
  
  // Start cap
  const startCap: Point3D[] = [];
  for (let i = 0; i <= capPoints / 2; i++) {
    const angle = Math.PI + (i / (capPoints / 2)) * Math.PI;
    startCap.push({
      x: firstPoint.x + brushSize * Math.cos(angle),
      y: firstPoint.y + brushSize * Math.sin(angle),
      z: firstPoint.z
    });
  }
  
  // End cap
  const endCap: Point3D[] = [];
  for (let i = 0; i <= capPoints / 2; i++) {
    const angle = (i / (capPoints / 2)) * Math.PI;
    endCap.push({
      x: lastPoint.x + brushSize * Math.cos(angle),
      y: lastPoint.y + brushSize * Math.sin(angle),
      z: lastPoint.z
    });
  }
  
  // Combine all points in order: start cap + right side + end cap + left side (reversed)
  const outlinePoints: Point3D[] = [
    ...startCap,
    ...rightSide,
    ...endCap,
    ...leftSide.reverse()
  ];
  
  // Convert back to flattened array format (x,y,z,x,y,z,...)
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