/**
 * Directional contour grow/shrink operations for medical imaging
 * Based on anatomical directions: anterior/posterior, left/right, superior/inferior
 */

interface Point2D {
  x: number;
  y: number;
}

/**
 * Apply directional grow or shrink to a contour
 * @param contourPoints - Flat array of [x, y, z, x, y, z, ...] coordinates in mm
 * @param distance - Distance in mm (positive for grow, negative for shrink)
 * @param direction - Direction to grow/shrink: 'all', 'anterior', 'posterior', 'left', 'right', 'superior', 'inferior'
 * @param imageOrientation - DICOM image orientation for determining anatomical directions
 * @returns New contour points as flat array
 */
export function applyDirectionalGrow(
  contourPoints: number[],
  distance: number,
  direction: 'all' | 'anterior' | 'posterior' | 'left' | 'right' | 'superior' | 'inferior',
  imageOrientation?: number[]
): number[] {
  if (!contourPoints || contourPoints.length < 9) return contourPoints;
  
  // Convert flat array to points
  const points: Point2D[] = [];
  const zValue = contourPoints[2]; // Preserve z coordinate
  
  for (let i = 0; i < contourPoints.length; i += 3) {
    points.push({
      x: contourPoints[i],
      y: contourPoints[i + 1]
    });
  }
  
  // Calculate contour center
  const center = calculateCenter(points);
  
  let newPoints: Point2D[];
  
  if (direction === 'all') {
    // Use existing radial grow algorithm
    newPoints = radialOffset(points, distance);
  } else {
    // Apply directional offset
    newPoints = directionalOffset(points, center, distance, direction);
  }
  
  // Convert back to flat array
  const result: number[] = [];
  for (const point of newPoints) {
    result.push(point.x, point.y, zValue);
  }
  
  return result;
}

/**
 * Calculate the center of a contour
 */
function calculateCenter(points: Point2D[]): Point2D {
  let sumX = 0;
  let sumY = 0;
  
  for (const point of points) {
    sumX += point.x;
    sumY += point.y;
  }
  
  return {
    x: sumX / points.length,
    y: sumY / points.length
  };
}

/**
 * Apply radial offset to all points (existing grow algorithm)
 */
function radialOffset(points: Point2D[], distance: number): Point2D[] {
  const center = calculateCenter(points);
  const newPoints: Point2D[] = [];
  
  for (const point of points) {
    // Calculate direction from center to point
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    
    if (length > 0) {
      // Normalize and apply offset
      const offsetX = (dx / length) * distance;
      const offsetY = (dy / length) * distance;
      
      newPoints.push({
        x: point.x + offsetX,
        y: point.y + offsetY
      });
    } else {
      newPoints.push(point);
    }
  }
  
  return newPoints;
}

/**
 * Apply directional offset based on anatomical direction
 */
function directionalOffset(
  points: Point2D[], 
  center: Point2D,
  distance: number, 
  direction: 'anterior' | 'posterior' | 'left' | 'right' | 'superior' | 'inferior'
): Point2D[] {
  const newPoints: Point2D[] = [];
  
  // Define direction vectors for standard axial orientation
  // In medical imaging axial view:
  // - X axis: left (-) to right (+) 
  // - Y axis: posterior (-) to anterior (+)
  // - Z axis: inferior (-) to superior (+)
  
  let directionVector: Point2D;
  
  switch (direction) {
    case 'anterior': // Front (positive Y in axial view)
      directionVector = { x: 0, y: 1 };
      break;
    case 'posterior': // Back (negative Y in axial view)
      directionVector = { x: 0, y: -1 };
      break;
    case 'left': // Patient's left (negative X in radiological convention)
      directionVector = { x: -1, y: 0 };
      break;
    case 'right': // Patient's right (positive X in radiological convention)
      directionVector = { x: 1, y: 0 };
      break;
    case 'superior': // Up (would affect different slices in axial view)
    case 'inferior': // Down (would affect different slices in axial view)
      // For axial views, superior/inferior don't apply to in-plane movement
      // Just return original points
      return points;
    default:
      return points;
  }
  
  // Apply directional offset to each point
  for (const point of points) {
    // Calculate if this point should be moved based on its position relative to center
    const relativeX = point.x - center.x;
    const relativeY = point.y - center.y;
    
    // Calculate dot product to determine if point is in the direction of growth
    const dotProduct = relativeX * directionVector.x + relativeY * directionVector.y;
    
    // Only move points that are in the specified direction from center
    if (dotProduct >= 0) {
      newPoints.push({
        x: point.x + directionVector.x * distance,
        y: point.y + directionVector.y * distance
      });
    } else {
      // Keep points on the opposite side stationary
      newPoints.push(point);
    }
  }
  
  return newPoints;
}

/**
 * Calculate the polygon area using the shoelace formula
 * Used to ensure contours maintain proper orientation
 */
function calculatePolygonArea(points: Point2D[]): number {
  let area = 0;
  const n = points.length;
  
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += points[i].x * points[j].y;
    area -= points[j].x * points[i].y;
  }
  
  return area / 2;
}

/**
 * Ensure polygon points are in counter-clockwise order
 * (Standard for medical imaging contours)
 */
function ensureCounterClockwise(points: Point2D[]): Point2D[] {
  const area = calculatePolygonArea(points);
  
  // If area is negative, points are clockwise, so reverse them
  if (area < 0) {
    return points.slice().reverse();
  }
  
  return points;
}