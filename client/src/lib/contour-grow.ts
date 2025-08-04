/**
 * Contour Growing Algorithm for Medical Imaging
 * 
 * Implements radial expansion of medical contours using offset polygon techniques
 * commonly used in radiation therapy treatment planning and medical image analysis.
 * 
 * References:
 * - "Polygon Offsetting by Computing Winding Numbers" (Chen & McMains, 2005)
 * - "Offset Curves and Surfaces: A Brief Survey" (Elber & Cohen, 1995)
 * - Medical imaging standards from DICOM RT Structure Set specifications
 */

interface Point2D {
  x: number;
  y: number;
}

interface ContourPoints {
  points: number[]; // Flat array: [x1, y1, z1, x2, y2, z2, ...]
  slicePosition: number;
}

/**
 * Grows a contour radially outward by a specified distance in millimeters
 * Uses the offset polygon algorithm for medical-grade precision
 */
export function growContour(contour: ContourPoints, growDistance: number): ContourPoints {
  if (!contour.points || contour.points.length < 9) { // Need at least 3 points (9 values)
    console.warn('Contour has insufficient points for growing');
    return contour;
  }

  // Convert flat array to 2D points (ignoring Z for planar growth)
  const points2D: Point2D[] = [];
  for (let i = 0; i < contour.points.length; i += 3) {
    points2D.push({
      x: contour.points[i],
      y: contour.points[i + 1]
    });
  }

  // Apply offset polygon algorithm
  // FIX: Invert the sign for correct behavior
  // Our UI convention: positive = expand, negative = shrink
  // But offsetPolygon expects: positive = shrink, negative = expand
  const grownPoints = offsetPolygon(points2D, -growDistance);

  // Convert back to flat array format with original Z values
  const grownFlatPoints: number[] = [];
  const originalZ = contour.points[2]; // Use Z from first point
  
  for (const point of grownPoints) {
    grownFlatPoints.push(point.x, point.y, originalZ);
  }

  return {
    points: grownFlatPoints,
    slicePosition: contour.slicePosition
  };
}

/**
 * Offset polygon algorithm for growing contours
 * Based on parallel curve offset techniques used in CAD and medical imaging
 */
function offsetPolygon(points: Point2D[], offset: number): Point2D[] {
  if (points.length < 3) return points;

  const result: Point2D[] = [];
  const n = points.length;

  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n];
    const curr = points[i];
    const next = points[(i + 1) % n];

    // Calculate normal vectors for adjacent edges
    const normal1 = calculateOutwardNormal(prev, curr);
    const normal2 = calculateOutwardNormal(curr, next);

    // Calculate average normal (bisector)
    let avgNormal = {
      x: (normal1.x + normal2.x) / 2,
      y: (normal1.y + normal2.y) / 2
    };

    // Normalize the average normal
    const length = Math.sqrt(avgNormal.x * avgNormal.x + avgNormal.y * avgNormal.y);
    if (length > 0) {
      avgNormal.x /= length;
      avgNormal.y /= length;
    }

    // Calculate the offset distance accounting for the angle
    const dotProduct = normal1.x * normal2.x + normal1.y * normal2.y;
    const angle = Math.acos(Math.max(-1, Math.min(1, dotProduct)));
    const offsetDistance = offset / Math.sin(angle / 2 + Math.PI / 2);

    // Apply offset
    const newPoint = {
      x: curr.x + avgNormal.x * offsetDistance,
      y: curr.y + avgNormal.y * offsetDistance
    };

    result.push(newPoint);
  }

  return result;
}

/**
 * Calculate outward normal vector for a line segment
 * Essential for determining the correct direction of contour growth
 */
function calculateOutwardNormal(p1: Point2D, p2: Point2D): Point2D {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  
  if (length === 0) {
    return { x: 0, y: 1 }; // Default normal if points are identical
  }

  // Perpendicular vector (rotated 90 degrees counterclockwise)
  return {
    x: -dy / length,
    y: dx / length
  };
}

/**
 * Validates if a polygon is oriented clockwise or counterclockwise
 * Important for determining inward vs outward normal directions
 */
function isClockwise(points: Point2D[]): boolean {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const curr = points[i];
    const next = points[(i + 1) % points.length];
    sum += (next.x - curr.x) * (next.y + curr.y);
  }
  return sum > 0;
}

/**
 * Smooths the grown contour to remove sharp corners
 * Uses a simple moving average for medical-grade smoothness
 */
export function smoothContour(contour: ContourPoints, smoothingFactor: number = 0.1): ContourPoints {
  if (contour.points.length < 9) return contour;

  const smoothedPoints: number[] = [];
  const pointCount = contour.points.length / 3;

  for (let i = 0; i < pointCount; i++) {
    const prevIdx = ((i - 1 + pointCount) % pointCount) * 3;
    const currIdx = i * 3;
    const nextIdx = ((i + 1) % pointCount) * 3;

    // Apply smoothing to X and Y coordinates
    const smoothedX = contour.points[currIdx] * (1 - smoothingFactor) + 
                     (contour.points[prevIdx] + contour.points[nextIdx]) * smoothingFactor / 2;
    
    const smoothedY = contour.points[currIdx + 1] * (1 - smoothingFactor) + 
                     (contour.points[prevIdx + 1] + contour.points[nextIdx + 1]) * smoothingFactor / 2;

    smoothedPoints.push(smoothedX, smoothedY, contour.points[currIdx + 2]); // Keep original Z
  }

  return {
    points: smoothedPoints,
    slicePosition: contour.slicePosition
  };
}