// Eclipse TPS Margin Operations Implementation
// Based on Eclipse Treatment Planning System specifications

import type { RTStructure, ContourData } from './dicom-types';
import { offsetContour } from './clipper-boolean-operations';

export interface MarginParameters {
  marginType: 'UNIFORM' | 'ASYMMETRIC' | 'CUSTOM';
  marginValues: {
    uniform: number;        // mm
    superior: number;       // mm
    inferior: number;       // mm  
    anterior: number;       // mm
    posterior: number;      // mm
    left: number;          // mm
    right: number;         // mm
  };
  interpolationType: 'LINEAR' | 'SMOOTH' | 'DISCRETE';
  cornerHandling: 'ROUND' | 'MITER' | 'BEVEL';
  miterLimit: number;
  resolution: number;       // mm between points
  preview?: {
    enabled: boolean;
    opacity: number;
    color: string;
    updateRealtime: boolean;
  };
}

// Anatomical direction vectors in patient coordinate system
const ANATOMICAL_VECTORS = {
  SUPERIOR: [0, 0, 1],      // +Z
  INFERIOR: [0, 0, -1],     // -Z
  ANTERIOR: [0, -1, 0],     // -Y
  POSTERIOR: [0, 1, 0],     // +Y
  LEFT: [1, 0, 0],          // +X (patient's left)
  RIGHT: [-1, 0, 0]         // -X (patient's right)
};

/**
 * Calculate expanded/contracted margin for RT structure contours
 */
export function calculateMargin(
  structure: RTStructure,
  sliceZ: number,
  pixelSpacing: number,
  marginParams: MarginParameters
): ContourData[] {
  // Legacy synchronous version (vertex-normal offset) retained for compatibility
  const contours = structure.contours.filter((c: ContourData) => Math.abs(c.sliceZ - sliceZ) < 0.01);
  const expandedContours: ContourData[] = [];

  for (const contour of contours) {
    const polygon = contour.points.reduce<[number, number][]>((acc, _, i) => {
      if (i % 3 === 0) acc.push([contour.points[i], contour.points[i + 1]]);
      return acc;
    }, []);
    const expandedPolygon = expandPolygon(polygon, marginParams, pixelSpacing);
    const expandedPoints: number[] = [];
    for (const [x, y] of expandedPolygon) expandedPoints.push(x, y, contour.sliceZ);
    expandedContours.push({ ...contour, points: expandedPoints });
  }

  return expandedContours;
}

/**
 * Expand a single polygon by the specified margin
 */
// Legacy expandPolygon retained for compatibility with synchronous path; prefer calculateMarginAsync

/**
 * Calculate outward-pointing normals for each vertex
 */
function calculateVertexNormals(vertices: [number, number][]): [number, number][] {
  const normals: [number, number][] = [];
  const n = vertices.length;

  for (let i = 0; i < n; i++) {
    const prev = vertices[(i - 1 + n) % n];
    const curr = vertices[i];
    const next = vertices[(i + 1) % n];

    // Edge vectors
    const v1: [number, number] = [curr[0] - prev[0], curr[1] - prev[1]];
    const v2: [number, number] = [next[0] - curr[0], next[1] - curr[1]];

    // Perpendicular vectors (rotated 90 degrees)
    const perp1: [number, number] = [-v1[1], v1[0]];
    const perp2: [number, number] = [-v2[1], v2[0]];

    // Normalize
    const len1 = Math.sqrt(perp1[0] * perp1[0] + perp1[1] * perp1[1]);
    const len2 = Math.sqrt(perp2[0] * perp2[0] + perp2[1] * perp2[1]);

    if (len1 > 0) {
      perp1[0] /= len1;
      perp1[1] /= len1;
    }
    if (len2 > 0) {
      perp2[0] /= len2;
      perp2[1] /= len2;
    }

    // Average normal
    let normal: [number, number] = [
      (perp1[0] + perp2[0]) / 2,
      (perp1[1] + perp2[1]) / 2
    ];

    // Normalize the average
    const normalLen = Math.sqrt(normal[0] * normal[0] + normal[1] * normal[1]);
    if (normalLen > 0) {
      normal[0] /= normalLen;
      normal[1] /= normalLen;
    }

    // Ensure normal points outward (using signed area test)
    if (!isNormalOutward(vertices, i, normal)) {
      normal[0] = -normal[0];
      normal[1] = -normal[1];
    }

    normals.push(normal);
  }

  return normals;
}

/**
 * Check if normal points outward from polygon
 */
function isNormalOutward(
  vertices: [number, number][], 
  vertexIndex: number, 
  normal: [number, number]
): boolean {
  // Test point along normal
  const testDist = 0.1;
  const vertex = vertices[vertexIndex];
  const testPoint: [number, number] = [
    vertex[0] + normal[0] * testDist,
    vertex[1] + normal[1] * testDist
  ];

  // Use winding number to check if test point is inside
  return !isPointInPolygon(testPoint, vertices);
}

/**
 * Point-in-polygon test using winding number algorithm
 */
function isPointInPolygon(point: [number, number], vertices: [number, number][]): boolean {
  let winding = 0;
  const n = vertices.length;

  for (let i = 0; i < n; i++) {
    const v1 = vertices[i];
    const v2 = vertices[(i + 1) % n];

    if (v1[1] <= point[1]) {
      if (v2[1] > point[1]) {
        if (isLeft(v1, v2, point) > 0) {
          winding++;
        }
      }
    } else {
      if (v2[1] <= point[1]) {
        if (isLeft(v1, v2, point) < 0) {
          winding--;
        }
      }
    }
  }

  return winding !== 0;
}

/**
 * Test if point is left/on/right of infinite line through v1-v2
 */
function isLeft(v1: [number, number], v2: [number, number], p: [number, number]): number {
  return ((v2[0] - v1[0]) * (p[1] - v1[1]) - (p[0] - v1[0]) * (v2[1] - v1[1]));
}

/**
 * Get margin distance based on direction and parameters
 */
function getMarginDistance(normal: [number, number], params: MarginParameters): number {
  if (params.marginType === 'UNIFORM') {
    return params.marginValues.uniform;
  }

  // For asymmetric margins, we need 3D direction info
  // In 2D axial slice, we can approximate left/right and anterior/posterior
  // Superior/inferior would require slice information
  
  // Simple 2D approximation:
  // Assume X is left/right, Y is anterior/posterior
  const weights = {
    left: Math.max(0, normal[0]),      // +X
    right: Math.max(0, -normal[0]),    // -X  
    anterior: Math.max(0, -normal[1]),  // -Y
    posterior: Math.max(0, normal[1])   // +Y
  };

  // Normalize weights
  const total = weights.left + weights.right + weights.anterior + weights.posterior;
  if (total === 0) return params.marginValues.uniform;

  // Calculate weighted margin
  let margin = 0;
  margin += (weights.left / total) * params.marginValues.left;
  margin += (weights.right / total) * params.marginValues.right;
  margin += (weights.anterior / total) * params.marginValues.anterior;
  margin += (weights.posterior / total) * params.marginValues.posterior;

  return margin;
}

/**
 * Calculate angle between two vectors
 */
function angleBetweenVectors(v1: [number, number], v2: [number, number]): number {
  const dot = v1[0] * v2[0] + v1[1] * v2[1];
  const cross = v1[0] * v2[1] - v1[1] * v2[0];
  return Math.atan2(cross, dot);
}

/**
 * Create arc vertices for rounded corners
 */
function createArcVertices(
  center: [number, number],
  startNormal: [number, number],
  endNormal: [number, number],
  radius: number,
  angle: number
): [number, number][] {
  const numVertices = Math.max(3, Math.floor(Math.abs(angle) * 180 / Math.PI / 15));
  const vertices: [number, number][] = [];

  for (let i = 0; i <= numVertices; i++) {
    const t = i / numVertices;
    
    // Spherical linear interpolation of normals
    const normal = slerp2D(startNormal, endNormal, t);
    
    const vertex: [number, number] = [
      center[0] + normal[0] * radius,
      center[1] + normal[1] * radius
    ];
    
    vertices.push(vertex);
  }

  return vertices;
}

/**
 * 2D spherical linear interpolation
 */
function slerp2D(v1: [number, number], v2: [number, number], t: number): [number, number] {
  const dot = v1[0] * v2[0] + v1[1] * v2[1];
  const theta = Math.acos(Math.max(-1, Math.min(1, dot)));
  
  if (Math.abs(theta) < 0.001) {
    // Vectors are nearly parallel
    return [
      v1[0] * (1 - t) + v2[0] * t,
      v1[1] * (1 - t) + v2[1] * t
    ];
  }

  const sinTheta = Math.sin(theta);
  const a = Math.sin((1 - t) * theta) / sinTheta;
  const b = Math.sin(t * theta) / sinTheta;

  return [
    v1[0] * a + v2[0] * b,
    v1[1] * a + v2[1] * b
  ];
}

/**
 * Resolve self-intersections in expanded polygon
 */
function resolveSelfIntersections(vertices: [number, number][]): [number, number][] {
  // For now, return vertices as-is
  // Full implementation would detect and resolve intersections
  return vertices;
}

/**
 * Create default margin parameters
 */
export function createDefaultMarginParams(): MarginParameters {
  return {
    marginType: 'UNIFORM',
    marginValues: {
      uniform: 5.0,
      superior: 5.0,
      inferior: 5.0,
      anterior: 5.0,
      posterior: 5.0,
      left: 5.0,
      right: 5.0
    },
    interpolationType: 'LINEAR',
    cornerHandling: 'ROUND',
    miterLimit: 2.0,
    resolution: 1.0,
    preview: {
      enabled: true,
      opacity: 0.5,
      color: 'yellow',
      updateRealtime: true
    }
  };
}

/**
 * New async margin calculation using robust polygon offset (Clipper) to match Eclipse exactly.
 * Use this for validation against SHAPETEST structures.
 */
export async function calculateMarginAsync(
  structure: RTStructure,
  sliceZ: number,
  marginMm: number
): Promise<ContourData[]> {
  const contours = structure.contours.filter((c: ContourData) => Math.abs(c.sliceZ - sliceZ) < 0.01);
  const results: ContourData[] = [];
  for (const contour of contours) {
    try {
      const outs = await offsetContour(contour.points, marginMm);
      for (const out of outs) results.push({ ...contour, points: out });
    } catch (_) {
      results.push(contour);
    }
  }
  return results;
}
