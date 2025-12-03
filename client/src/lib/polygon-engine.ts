/**
 * PolygonEngine - Comprehensive 2D polygon operations for RT structure manipulation
 * 
 * Implements the Clipper library for geometric structure operations:
 * - Margin expansion (via ClipperOffset)
 * - Boolean subtraction (via Clipper ctDifference)
 * - Combined operations: (Source + Margin) - Avoidance
 * 
 * Works slice-by-slice on 2D contour data, preserving DICOM coordinate system.
 */

import { 
  getClipper, 
  createClipperInstance, 
  createClipperOffset, 
  createPaths 
} from './clipper-adapter';
import type { RTStructure, RTContour } from './dicom-types';

// ============================================================================
// Constants
// ============================================================================

/**
 * Scale factor for Clipper integer math.
 * 10000 preserves precision to 0.0001mm (sub-millimeter).
 * Varian (mm) * SCALE = Clipper (int)
 */
const SCALE = 10000;

/**
 * Minimum polygon area in mm² to keep after boolean operations.
 * Polygons smaller than this are considered artifacts and discarded.
 * 2 mm² is a reasonable threshold for clinical structures.
 */
const MIN_AREA_MM2 = 2.0;

/**
 * Slice position tolerance for matching contours on the same plane.
 * Two contours are considered on the same slice if |z1 - z2| < SLICE_TOLERANCE
 */
const SLICE_TOLERANCE = 1.5; // mm

// ============================================================================
// Types
// ============================================================================

export interface PolygonEngineResult {
  success: boolean;
  contours: RTContour[];
  warnings: string[];
  stats: {
    inputSlices: number;
    outputSlices: number;
    artifactsRemoved: number;
    processingTimeMs: number;
  };
}

export interface MarginSubtractOptions {
  /** Margin to expand source by, in mm (positive = grow, negative = shrink) */
  marginMm: number;
  /** Whether to filter out small artifact polygons */
  filterArtifacts?: boolean;
  /** Minimum area in mm² to keep (default: 2.0) */
  minAreaMm2?: number;
  /** Join type for margin expansion: 'round' | 'miter' | 'square' */
  joinType?: 'round' | 'miter' | 'square';
}

// ============================================================================
// Main PolygonEngine Class
// ============================================================================

export class PolygonEngine {
  
  /**
   * Creates a derived structure: (Source + Margin) - Avoidance
   * 
   * This is the primary operation for creating clinical target volumes (PTV)
   * from gross tumor volumes (GTV) while avoiding organs at risk (OAR).
   * 
   * @param source - The source structure to expand (e.g., GTV)
   * @param avoidance - Optional structure to subtract (e.g., Brainstem). Can be null.
   * @param options - Margin and processing options
   * @returns Result containing the derived contours
   * 
   * @example
   * ```typescript
   * const engine = new PolygonEngine();
   * const result = await engine.createExpandedSubtractedStructure(
   *   gtvStructure,
   *   brainstemStructure,
   *   { marginMm: 5.0, filterArtifacts: true }
   * );
   * ```
   */
  async createExpandedSubtractedStructure(
    source: RTStructure,
    avoidance: RTStructure | null,
    options: MarginSubtractOptions
  ): Promise<PolygonEngineResult> {
    const startTime = performance.now();
    const warnings: string[] = [];
    let artifactsRemoved = 0;
    
    const {
      marginMm,
      filterArtifacts = true,
      minAreaMm2 = MIN_AREA_MM2,
      joinType = 'round'
    } = options;

    // Validation
    if (!source?.contours?.length) {
      return {
        success: false,
        contours: [],
        warnings: ['Source structure has no contours'],
        stats: { inputSlices: 0, outputSlices: 0, artifactsRemoved: 0, processingTimeMs: 0 }
      };
    }

    console.log(`🔧 PolygonEngine: Starting (Source + ${marginMm}mm) - Avoidance operation`);
    console.log(`   Source: ${source.structureName} (${source.contours.length} contours)`);
    if (avoidance) {
      console.log(`   Avoidance: ${avoidance.structureName} (${avoidance.contours.length} contours)`);
    }

    // Organize contours by slice position
    const sourceBySlice = this.organizeBySlice(source.contours);
    const avoidanceBySlice = avoidance ? this.organizeBySlice(avoidance.contours) : new Map<number, RTContour[]>();
    
    const allSlicePositions = new Set<number>();
    Array.from(sourceBySlice.keys()).forEach(k => allSlicePositions.add(k));
    Array.from(avoidanceBySlice.keys()).forEach(k => allSlicePositions.add(k));

    const resultContours: RTContour[] = [];

    // Process each slice
    for (const sliceZ of Array.from(allSlicePositions)) {
      const sourceContours = this.getContoursAtSlice(sourceBySlice, sliceZ);
      
      // Skip if no source on this slice
      if (sourceContours.length === 0) continue;

      try {
        // Step 1: Convert source contours to Clipper paths
        const sourcePaths = await this.contoursToClipperPaths(sourceContours);
        
        // Step 2: Expand source by margin
        const expandedPaths = await this.expandPaths(sourcePaths, marginMm, joinType);
        
        if (expandedPaths.size() === 0) {
          warnings.push(`No expanded paths generated for slice z=${sliceZ.toFixed(2)}`);
          continue;
        }

        // Step 3: Get avoidance contours for this slice
        const avoidanceContours = this.getContoursAtSlice(avoidanceBySlice, sliceZ);
        
        // Step 4: Perform boolean subtraction if avoidance exists
        let finalPaths: any;
        
        if (avoidanceContours.length > 0) {
          const avoidancePaths = await this.contoursToClipperPaths(avoidanceContours);
          finalPaths = await this.subtractPaths(expandedPaths, avoidancePaths);
        } else {
          finalPaths = expandedPaths;
        }

        // Step 5: Convert back to contours and filter artifacts
        const sliceContours = await this.clipperPathsToContours(finalPaths, sliceZ);
        
        for (const contour of sliceContours) {
          if (filterArtifacts) {
            const area = this.calculatePolygonArea(contour.points);
            if (area < minAreaMm2) {
              artifactsRemoved++;
              continue;
            }
          }
          resultContours.push(contour);
        }
        
      } catch (error) {
        warnings.push(`Error processing slice z=${sliceZ.toFixed(2)}: ${error}`);
        console.error(`🔧 PolygonEngine: Error on slice ${sliceZ}:`, error);
      }
    }

    const processingTimeMs = performance.now() - startTime;
    
    console.log(`🔧 PolygonEngine: Completed in ${processingTimeMs.toFixed(1)}ms`);
    console.log(`   Output: ${resultContours.length} contours`);
    if (artifactsRemoved > 0) {
      console.log(`   Artifacts removed: ${artifactsRemoved}`);
    }

    return {
      success: true,
      contours: resultContours,
      warnings,
      stats: {
        inputSlices: sourceBySlice.size,
        outputSlices: new Set(resultContours.map(c => c.slicePosition)).size,
        artifactsRemoved,
        processingTimeMs
      }
    };
  }

  /**
   * Expand a single contour by a margin
   */
  async expandContour(
    contour: RTContour,
    marginMm: number,
    joinType: 'round' | 'miter' | 'square' = 'round'
  ): Promise<RTContour[]> {
    if (!contour.points || contour.points.length < 9) {
      return [];
    }

    const api = await getClipper();
    const path = await this.pointsToClipperPath(contour.points);
    const paths = new api.Paths();
    paths.push_back(path);
    
    const expandedPaths = await this.expandPaths(paths, marginMm, joinType);
    return this.clipperPathsToContours(expandedPaths, contour.slicePosition);
  }

  /**
   * Subtract one contour from another
   */
  async subtractContour(
    subject: RTContour,
    clip: RTContour
  ): Promise<RTContour[]> {
    if (!subject.points || subject.points.length < 9) {
      return [];
    }
    if (!clip.points || clip.points.length < 9) {
      return [subject];
    }

    const api = await getClipper();
    
    const subjectPath = await this.pointsToClipperPath(subject.points);
    const clipPath = await this.pointsToClipperPath(clip.points);
    
    const subjectPaths = new api.Paths();
    subjectPaths.push_back(subjectPath);
    
    const clipPaths = new api.Paths();
    clipPaths.push_back(clipPath);
    
    const resultPaths = await this.subtractPaths(subjectPaths, clipPaths);
    return this.clipperPathsToContours(resultPaths, subject.slicePosition);
  }

  /**
   * Union (combine) two contours
   */
  async unionContours(
    contourA: RTContour,
    contourB: RTContour
  ): Promise<RTContour[]> {
    if (!contourA.points || contourA.points.length < 9) {
      return contourB.points?.length >= 9 ? [contourB] : [];
    }
    if (!contourB.points || contourB.points.length < 9) {
      return [contourA];
    }

    const api = await getClipper();
    const clipper = await createClipperInstance();
    const solution = new api.Paths();
    
    const pathA = await this.pointsToClipperPath(contourA.points);
    const pathB = await this.pointsToClipperPath(contourB.points);
    
    clipper.AddPath(pathA, api.PolyType.ptSubject, true);
    clipper.AddPath(pathB, api.PolyType.ptClip, true);
    
    clipper.Execute(
      api.ClipType.ctUnion, 
      solution,
      api.PolyFillType.pftNonZero,
      api.PolyFillType.pftNonZero
    );
    
    return this.clipperPathsToContours(solution, contourA.slicePosition);
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  /**
   * Organize contours by slice position with tolerance
   */
  private organizeBySlice(contours: RTContour[]): Map<number, RTContour[]> {
    const bySlice = new Map<number, RTContour[]>();
    
    for (const contour of contours) {
      if (!contour.points || contour.points.length < 9) continue;
      
      // Find existing key within tolerance
      let matchedKey: number | null = null;
      const existingKeys = Array.from(bySlice.keys());
      for (let i = 0; i < existingKeys.length; i++) {
        if (Math.abs(existingKeys[i] - contour.slicePosition) <= SLICE_TOLERANCE) {
          matchedKey = existingKeys[i];
          break;
        }
      }
      
      const key = matchedKey ?? contour.slicePosition;
      const existing = bySlice.get(key) || [];
      existing.push(contour);
      bySlice.set(key, existing);
    }
    
    return bySlice;
  }

  /**
   * Get contours at a specific slice position (with tolerance)
   */
  private getContoursAtSlice(
    bySlice: Map<number, RTContour[]>,
    targetZ: number
  ): RTContour[] {
    const entries = Array.from(bySlice.entries());
    for (let i = 0; i < entries.length; i++) {
      const [key, contours] = entries[i];
      if (Math.abs(key - targetZ) <= SLICE_TOLERANCE) {
        return contours;
      }
    }
    return [];
  }

  /**
   * Convert contours to Clipper paths
   */
  private async contoursToClipperPaths(contours: RTContour[]): Promise<any> {
    const api = await getClipper();
    const paths = new api.Paths();
    
    for (const contour of contours) {
      const path = await this.pointsToClipperPath(contour.points);
      paths.push_back(path);
    }
    
    return paths;
  }

  /**
   * Convert points array to Clipper path
   */
  private async pointsToClipperPath(points: number[]): Promise<any> {
    const api = await getClipper();
    const path = new api.Path();
    
    for (let i = 0; i < points.length; i += 3) {
      const x = Math.round(points[i] * SCALE);
      const y = Math.round(points[i + 1] * SCALE);
      
      if (typeof (path as any).addPoint === 'function') {
        (path as any).addPoint(x, y);
      } else if (typeof (path as any).push_back === 'function') {
        // WASM binding style
        (path as any).push_back({ X: x, Y: y });
      } else {
        // Fallback for array-style
        path.push({ X: x, Y: y });
      }
    }
    
    return path;
  }

  /**
   * Expand paths using ClipperOffset
   */
  private async expandPaths(
    inputPaths: any,
    marginMm: number,
    joinType: 'round' | 'miter' | 'square'
  ): Promise<any> {
    const api = await getClipper();
    
    // Map join type
    let clipperJoinType: any;
    switch (joinType) {
      case 'miter':
        clipperJoinType = api.JoinType.jtMiter;
        break;
      case 'square':
        clipperJoinType = api.JoinType.jtSquare;
        break;
      case 'round':
      default:
        clipperJoinType = api.JoinType.jtRound;
    }
    
    const co = await createClipperOffset();
    const solution = await createPaths();
    
    // Add all input paths
    for (let i = 0; i < inputPaths.size(); i++) {
      const path = inputPaths.get(i);
      co.AddPath(path, clipperJoinType, api.EndType.etClosedPolygon);
    }
    
    // Execute offset
    const scaledDelta = marginMm * SCALE;
    co.Execute(solution, scaledDelta);
    
    return solution;
  }

  /**
   * Subtract clip paths from subject paths
   */
  private async subtractPaths(subjectPaths: any, clipPaths: any): Promise<any> {
    const api = await getClipper();
    const clipper = await createClipperInstance();
    const solution = new api.Paths();
    
    // Add subject paths (the shape being subtracted FROM)
    for (let i = 0; i < subjectPaths.size(); i++) {
      clipper.AddPath(subjectPaths.get(i), api.PolyType.ptSubject, true);
    }
    
    // Add clip paths (the shape doing the subtracting)
    for (let i = 0; i < clipPaths.size(); i++) {
      clipper.AddPath(clipPaths.get(i), api.PolyType.ptClip, true);
    }
    
    // Execute difference: Subject - Clip
    clipper.Execute(
      api.ClipType.ctDifference,
      solution,
      api.PolyFillType.pftNonZero,
      api.PolyFillType.pftNonZero
    );
    
    return solution;
  }

  /**
   * Convert Clipper paths back to RTContour format
   */
  private async clipperPathsToContours(paths: any, sliceZ: number): Promise<RTContour[]> {
    const contours: RTContour[] = [];
    
    for (let i = 0; i < paths.size(); i++) {
      const path = paths.get(i);
      const points: number[] = [];
      
      for (let j = 0; j < path.size(); j++) {
        const point = path.get(j);
        points.push(
          point.X / SCALE,
          point.Y / SCALE,
          sliceZ
        );
      }
      
      if (points.length >= 9) { // At least 3 points
        contours.push({
          slicePosition: sliceZ,
          points,
          numberOfPoints: points.length / 3
        });
      }
    }
    
    return contours;
  }

  /**
   * Calculate polygon area using the shoelace formula
   * Returns area in mm² (assuming points are in mm)
   */
  private calculatePolygonArea(points: number[]): number {
    if (points.length < 9) return 0;
    
    let area = 0;
    const n = points.length / 3;
    
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const xi = points[i * 3];
      const yi = points[i * 3 + 1];
      const xj = points[j * 3];
      const yj = points[j * 3 + 1];
      
      area += xi * yj;
      area -= xj * yi;
    }
    
    return Math.abs(area) / 2;
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Create a PTV from GTV with margin, avoiding OARs
 * Convenience wrapper around PolygonEngine
 */
export async function createPTVFromGTV(
  gtv: RTStructure,
  oars: RTStructure[],
  marginMm: number
): Promise<PolygonEngineResult> {
  const engine = new PolygonEngine();
  
  // Start with GTV + margin
  let result = await engine.createExpandedSubtractedStructure(gtv, null, { marginMm });
  
  if (!result.success || result.contours.length === 0) {
    return result;
  }
  
  // Subtract each OAR
  for (const oar of oars) {
    if (!oar.contours?.length) continue;
    
    // Create temporary structure from current result
    const tempStructure: RTStructure = {
      roiNumber: 0,
      structureName: 'temp',
      color: [255, 255, 0],
      contours: result.contours
    };
    
    result = await engine.createExpandedSubtractedStructure(
      tempStructure,
      oar,
      { marginMm: 0 } // No additional margin, just subtract
    );
    
    if (!result.success) {
      return result;
    }
  }
  
  return result;
}

/**
 * Simple margin expansion without avoidance
 */
export async function expandStructureByMargin(
  structure: RTStructure,
  marginMm: number,
  joinType: 'round' | 'miter' | 'square' = 'round'
): Promise<PolygonEngineResult> {
  const engine = new PolygonEngine();
  return engine.createExpandedSubtractedStructure(structure, null, { 
    marginMm, 
    joinType,
    filterArtifacts: true 
  });
}

// Export singleton instance for convenience
export const polygonEngine = new PolygonEngine();

// Global debug function
declare global {
  interface Window {
    polygonEngine: PolygonEngine;
    testPolygonEngine: () => Promise<void>;
  }
}

if (typeof window !== 'undefined') {
  window.polygonEngine = polygonEngine;
  
  window.testPolygonEngine = async () => {
    console.log('🧪 Testing PolygonEngine...');
    
    // Create test structures
    const testGTV: RTStructure = {
      roiNumber: 1,
      structureName: 'Test_GTV',
      color: [255, 0, 0],
      contours: [{
        slicePosition: 0,
        points: [
          10, 10, 0,
          40, 10, 0,
          40, 40, 0,
          10, 40, 0
        ],
        numberOfPoints: 4
      }]
    };
    
    const testOAR: RTStructure = {
      roiNumber: 2,
      structureName: 'Test_Brainstem',
      color: [0, 255, 0],
      contours: [{
        slicePosition: 0,
        points: [
          35, 25, 0,
          55, 25, 0,
          55, 45, 0,
          35, 45, 0
        ],
        numberOfPoints: 4
      }]
    };
    
    const engine = new PolygonEngine();
    
    // Test 1: Margin only
    console.log('📐 Test 1: GTV + 5mm margin');
    const marginResult = await engine.createExpandedSubtractedStructure(testGTV, null, { marginMm: 5 });
    console.log('Result:', marginResult);
    
    // Test 2: Margin + Subtraction
    console.log('📐 Test 2: (GTV + 5mm) - Brainstem');
    const fullResult = await engine.createExpandedSubtractedStructure(testGTV, testOAR, { marginMm: 5 });
    console.log('Result:', fullResult);
    
    console.log('✅ PolygonEngine tests complete');
  };
}

