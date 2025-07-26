/**
 * Medical-grade contour polishing utilities for smooth brush edges
 * Implements morphological operations and cleaning to remove jagged edges
 */

import { getClipper, createClipperInstance } from './clipper-adapter';

// Use moderate scale for better precision without amplifying noise
const POLISH_SCALE = 1e4; // 10,000 for mm to int conversion

/**
 * Polish a contour by applying morphological close operation
 * This removes small jaggies and beading from brush strokes
 * @param contourPoints - Flat array of contour points [x, y, z, ...]
 * @param epsilon - Polish radius in mm (default 0.4mm)
 * @returns Polished contour points
 */
export async function polishContour(
  contourPoints: number[],
  epsilon: number = 0.4
): Promise<number[]> {
  if (!contourPoints || contourPoints.length < 9) {
    return contourPoints;
  }

  try {
    const api = await getClipper();
    const z = contourPoints[2]; // Preserve Z coordinate

    // Convert contour to Clipper path
    const path = new api.Path();
    const clipperPoints = [];
    for (let i = 0; i < contourPoints.length; i += 3) {
      clipperPoints.push({
        X: Math.round(contourPoints[i] * POLISH_SCALE),
        Y: Math.round(contourPoints[i + 1] * POLISH_SCALE)
      });
    }
    
    // Try different methods to add points
    if (path.AddPoints && typeof path.AddPoints === 'function') {
      path.AddPoints(clipperPoints);
    } else if (path.add && typeof path.add === 'function') {
      for (const pt of clipperPoints) {
        path.add(pt);
      }
    } else if (typeof path.push === 'function') {
      for (const pt of clipperPoints) {
        path.push(pt);
      }
    } else if (typeof path.Add === 'function') {
      for (const pt of clipperPoints) {
        path.Add(pt);
      }
    }

    // Create paths container
    const paths = new api.Paths();
    paths.push(path);

    // Clean the input polygon first
    const cleanedPaths = api.CleanPolygons(paths, 0.05 * POLISH_SCALE);
    if (!cleanedPaths || cleanedPaths.size() === 0) {
      return contourPoints;
    }

    // Apply morphological close: offset out then in
    // Step 1: Offset outward by epsilon with round joins
    const offsetter1 = new api.ClipperOffset(2.0, 0.25 * POLISH_SCALE);
    offsetter1.AddPaths(cleanedPaths, api.JoinType.jtRound, api.EndType.etClosedPolygon);
    
    const expandedPaths = new api.Paths();
    offsetter1.Execute(expandedPaths, epsilon * POLISH_SCALE);

    if (!expandedPaths || expandedPaths.size() === 0) {
      return contourPoints;
    }

    // Step 2: Offset inward by the same epsilon
    const offsetter2 = new api.ClipperOffset(2.0, 0.25 * POLISH_SCALE);
    offsetter2.AddPaths(expandedPaths, api.JoinType.jtRound, api.EndType.etClosedPolygon);
    
    const contractedPaths = new api.Paths();
    offsetter2.Execute(contractedPaths, -epsilon * POLISH_SCALE);

    if (!contractedPaths || contractedPaths.size() === 0) {
      return contourPoints;
    }

    // Final cleaning pass
    const finalPaths = api.CleanPolygons(contractedPaths, 0.05 * POLISH_SCALE);
    
    // Convert back to world coordinates
    const result: number[] = [];
    if (finalPaths && finalPaths.size() > 0) {
      const finalPath = finalPaths.get(0); // Take the first (main) polygon
      for (let i = 0; i < finalPath.size(); i++) {
        const point = finalPath.get(i);
        result.push(point.X / POLISH_SCALE);
        result.push(point.Y / POLISH_SCALE);
        result.push(z);
      }
    }

    return result.length >= 9 ? result : contourPoints;
  } catch (error) {
    console.error('Error polishing contour:', error);
    return contourPoints;
  }
}

/**
 * Clean and simplify multiple contours after boolean operations
 * @param contours - Array of contour point arrays
 * @param cleanTolerance - Cleaning tolerance in mm (default 0.05mm)
 * @returns Cleaned contours
 */
export async function cleanContours(
  contours: number[][],
  cleanTolerance: number = 0.05
): Promise<number[][]> {
  const api = await getClipper();
  const cleanedContours: number[][] = [];

  for (const contour of contours) {
    if (!contour || contour.length < 9) continue;

    const z = contour[2];
    const path = new api.Path();
    
    // Convert to Clipper path
    for (let i = 0; i < contour.length; i += 3) {
      path.push({
        X: Math.round(contour[i] * POLISH_SCALE),
        Y: Math.round(contour[i + 1] * POLISH_SCALE)
      });
    }

    // Create paths container
    const paths = new api.Paths();
    paths.push(path);

    // Clean the polygon
    const cleanedPaths = api.CleanPolygons(paths, cleanTolerance * POLISH_SCALE);
    
    if (cleanedPaths && cleanedPaths.size() > 0) {
      const cleanedPath = cleanedPaths.get(0);
      const result: number[] = [];
      
      for (let i = 0; i < cleanedPath.size(); i++) {
        const point = cleanedPath.get(i);
        result.push(point.X / POLISH_SCALE);
        result.push(point.Y / POLISH_SCALE);
        result.push(z);
      }
      
      if (result.length >= 9) {
        cleanedContours.push(result);
      }
    }
  }

  return cleanedContours;
}

/**
 * Configure optimal Clipper settings for medical imaging
 */
export const MEDICAL_CLIPPER_SETTINGS = {
  scale: POLISH_SCALE,
  cleanTolerance: 0.05,
  polishEpsilon: 0.4,
  arcTolerance: 0.25,
  miterLimit: 2.0,
  minStampSpacing: 0.4, // As fraction of brush radius
  minPointDistance: 0.5 // Minimum world distance between stroke points
};