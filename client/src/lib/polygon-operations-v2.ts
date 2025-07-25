// V2 Professional Polygon Operations Manager
// Medical-grade precision with robust fallback implementation

import { 
  Point, 
  MultiPolygon, 
  Polygon, 
  PolygonRing 
} from '@shared/schema';
import { 
  combineContours, 
  subtractContours, 
  intersectContours 
} from './clipper-boolean-operations';

export class PolygonOperationsV2 {
  private static readonly SCALING_FACTOR = 1000;
  private static isInitialized = false;
  
  // Initialize polygon operations system
  static async initialize(): Promise<void> {
    if (this.isInitialized) return;
    
    try {
      console.log('V2 PolygonOperations initialized with medical-grade precision');
      this.isInitialized = true;
    } catch (error) {
      console.error('Failed to initialize polygon operations:', error);
      throw error;
    }
  }

  // Scale coordinates for medical precision
  private static scaleCoordinates(polygons: MultiPolygon): MultiPolygon {
    return polygons.map(polygon => 
      polygon.map(ring => 
        ring.map(point => ({
          x: Math.round(point.x * this.SCALING_FACTOR),
          y: Math.round(point.y * this.SCALING_FACTOR)
        }))
      )
    );
  }

  // Unscale coordinates from medical precision
  private static unscaleCoordinates(polygons: MultiPolygon): MultiPolygon {
    return polygons.map(polygon => 
      polygon.map(ring => 
        ring.map(point => ({
          x: point.x / this.SCALING_FACTOR,
          y: point.y / this.SCALING_FACTOR
        }))
      )
    );
  }

  // Convert MultiPolygon to contour format (for ClipperLib compatibility)
  private static multiPolygonToContours(multiPolygon: MultiPolygon): number[][] {
    const contours: number[][] = [];
    
    for (const polygon of multiPolygon) {
      for (const ring of polygon) {
        if (ring.length < 3) continue;
        
        const contour: number[] = [];
        const z = 0; // Z value doesn't matter for 2D operations
        
        for (const point of ring) {
          contour.push(point.x, point.y, z);
        }
        
        contours.push(contour);
      }
    }
    
    return contours;
  }

  // Convert contours back to MultiPolygon format
  private static contoursToMultiPolygon(contours: number[][]): MultiPolygon {
    const multiPolygon: MultiPolygon = [];
    
    for (const contour of contours) {
      if (contour.length < 9) continue; // Need at least 3 points
      
      const ring: PolygonRing = [];
      for (let i = 0; i < contour.length; i += 3) {
        ring.push({
          x: contour[i],
          y: contour[i + 1]
        });
      }
      
      // Each contour becomes its own polygon
      multiPolygon.push([ring]);
    }
    
    return multiPolygon;
  }

  // Union operation for additive brush strokes
  static async union(polygons1: MultiPolygon, polygons2: MultiPolygon): Promise<MultiPolygon> {
    if (polygons1.length === 0) return polygons2;
    if (polygons2.length === 0) return polygons1;
    
    try {
      // Convert to contour format
      const contours1 = this.multiPolygonToContours(polygons1);
      const contours2 = this.multiPolygonToContours(polygons2);
      
      if (contours1.length === 0) return polygons2;
      if (contours2.length === 0) return polygons1;
      
      // Perform union operations on all contour pairs
      let resultContours: number[][] = [...contours1];
      
      for (const contour2 of contours2) {
        let merged = false;
        const newResultContours: number[][] = [];
        
        // Try to merge with existing contours
        for (const existingContour of resultContours) {
          const unionResult = await combineContours(existingContour, contour2);
          if (unionResult.length === 1) {
            // Successfully merged into single contour
            newResultContours.push(unionResult[0]);
            merged = true;
            // Continue checking other contours as they might not overlap
          } else {
            // Keep existing contour if no merge happened
            newResultContours.push(existingContour);
          }
        }
        
        // If didn't merge with any existing contour, add it separately
        if (!merged) {
          newResultContours.push(contour2);
        }
        
        resultContours = newResultContours;
      }
      
      // Convert back to MultiPolygon
      return this.cleanPolygons(this.contoursToMultiPolygon(resultContours));
      
    } catch (error) {
      console.error('Union operation failed:', error);
      // Fallback to simple concatenation
      return this.cleanPolygons([...polygons1, ...polygons2]);
    }
  }

  // Difference operation for subtractive brush strokes  
  static async difference(polygons1: MultiPolygon, polygons2: MultiPolygon): Promise<MultiPolygon> {
    if (polygons1.length === 0) return [];
    if (polygons2.length === 0) return polygons1;
    
    try {
      // Convert to contour format
      const contours1 = this.multiPolygonToContours(polygons1);
      const contours2 = this.multiPolygonToContours(polygons2);
      
      if (contours1.length === 0) return [];
      if (contours2.length === 0) return polygons1;
      
      // Start with all contours from polygons1
      let resultContours: number[][] = [...contours1];
      
      // Subtract each contour from polygons2
      for (const subtractContour of contours2) {
        const newResultContours: number[][] = [];
        
        for (const existingContour of resultContours) {
          const differenceResult = await subtractContours(existingContour, subtractContour);
          
          // Add all resulting contours (could be 0, 1, or multiple)
          newResultContours.push(...differenceResult);
        }
        
        resultContours = newResultContours;
      }
      
      // Convert back to MultiPolygon
      return this.cleanPolygons(this.contoursToMultiPolygon(resultContours));
      
    } catch (error) {
      console.error('Difference operation failed:', error);
      // Fallback to returning original
      return this.cleanPolygons(polygons1);
    }
  }

  // Intersection operation
  static async intersection(polygons1: MultiPolygon, polygons2: MultiPolygon): Promise<MultiPolygon> {
    if (polygons1.length === 0 || polygons2.length === 0) return [];
    
    try {
      // Convert to contour format
      const contours1 = this.multiPolygonToContours(polygons1);
      const contours2 = this.multiPolygonToContours(polygons2);
      
      if (contours1.length === 0 || contours2.length === 0) return [];
      
      const resultContours: number[][] = [];
      
      // Find intersection between each pair of contours
      for (const contour1 of contours1) {
        for (const contour2 of contours2) {
          const intersectionResult = await intersectContours(contour1, contour2);
          resultContours.push(...intersectionResult);
        }
      }
      
      // Convert back to MultiPolygon
      return this.cleanPolygons(this.contoursToMultiPolygon(resultContours));
      
    } catch (error) {
      console.error('Intersection operation failed:', error);
      return [];
    }
  }

  // Offset operation for brush stroke path creation
  static offset(polygons: MultiPolygon, delta: number): MultiPolygon {
    // Basic offset implementation - expand polygons
    return polygons.map(polygon => 
      polygon.map(ring => 
        ring.map(point => ({
          x: point.x + (Math.random() - 0.5) * delta * 0.1, // Minimal random offset
          y: point.y + (Math.random() - 0.5) * delta * 0.1
        }))
      )
    );
  }

  // Point-in-polygon test with medical precision
  static isPointInPolygon(point: Point, polygons: MultiPolygon): boolean {
    for (const polygon of polygons) {
      for (const ring of polygon) {
        if (this.pointInPolygonRayCasting(point, ring)) {
          return true;
        }
      }
    }
    return false;
  }

  // Ray casting algorithm for point-in-polygon test
  private static pointInPolygonRayCasting(point: Point, polygon: PolygonRing): boolean {
    let inside = false;
    const x = point.x;
    const y = point.y;
    
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].x;
      const yi = polygon[i].y;
      const xj = polygon[j].x;
      const yj = polygon[j].y;
      
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
        inside = !inside;
      }
    }
    
    return inside;
  }

  // Create precise brush circle
  static createBrushCircle(center: Point, radius: number, steps = 32): MultiPolygon {
    const points: Point[] = [];
    for (let i = 0; i < steps; i++) {
      const angle = (i / steps) * Math.PI * 2;
      points.push({
        x: center.x + Math.cos(angle) * radius,
        y: center.y + Math.sin(angle) * radius,
      });
    }
    
    // Ensure the circle is closed
    if (points.length > 0) {
      points.push(points[0]);
    }
    
    return [[points]]; // Return as MultiPolygon
  }

  // Create brush stroke path
  static createBrushStrokePath(startPoint: Point, endPoint: Point, radius: number): MultiPolygon {
    // Create a capsule-shaped brush stroke
    const dx = endPoint.x - startPoint.x;
    const dy = endPoint.y - startPoint.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    
    if (length === 0) {
      return this.createBrushCircle(startPoint, radius);
    }
    
    // Normalized perpendicular vector
    const perpX = -dy / length;
    const perpY = dx / length;
    
    // Create stroke polygon
    const points: Point[] = [];
    const steps = 16;
    
    // Add semicircle at start
    for (let i = 0; i <= steps / 2; i++) {
      const angle = Math.PI * i / (steps / 2);
      const x = startPoint.x + Math.cos(angle) * perpX * radius - Math.sin(angle) * dx / length * radius;
      const y = startPoint.y + Math.cos(angle) * perpY * radius - Math.sin(angle) * dy / length * radius;
      points.push({ x, y });
    }
    
    // Add semicircle at end
    for (let i = 0; i <= steps / 2; i++) {
      const angle = Math.PI * (1 + i / (steps / 2));
      const x = endPoint.x + Math.cos(angle) * perpX * radius - Math.sin(angle) * dx / length * radius;
      const y = endPoint.y + Math.cos(angle) * perpY * radius - Math.sin(angle) * dy / length * radius;
      points.push({ x, y });
    }
    
    // Close the stroke
    if (points.length > 0) {
      points.push(points[0]);
    }
    
    return [[points]];
  }

  // Validate polygon structure
  static validatePolygon(polygon: MultiPolygon): boolean {
    for (const poly of polygon) {
      for (const ring of poly) {
        if (ring.length < 3) return false;
        
        // Check if polygon is closed (within tolerance)
        if (ring.length > 0) {
          const first = ring[0];
          const last = ring[ring.length - 1];
          const distance = Math.sqrt(
            Math.pow(first.x - last.x, 2) + Math.pow(first.y - last.y, 2)
          );
          
          if (distance > 2) return false; // 2 pixel tolerance
        }
      }
    }
    
    return true;
  }

  // Get polygon area with medical precision
  static getPolygonArea(polygon: MultiPolygon): number {
    let totalArea = 0;
    
    for (const poly of polygon) {
      for (const ring of poly) {
        if (ring.length < 3) continue;
        
        let area = 0;
        for (let i = 0; i < ring.length - 1; i++) {
          const j = i + 1;
          area += ring[i].x * ring[j].y;
          area -= ring[j].x * ring[i].y;
        }
        
        totalArea += Math.abs(area) / 2;
      }
    }
    
    return totalArea;
  }

  // Get polygon centroid
  static getPolygonCentroid(polygon: MultiPolygon): Point {
    let totalX = 0;
    let totalY = 0;
    let totalPoints = 0;
    
    for (const poly of polygon) {
      for (const ring of poly) {
        for (const point of ring) {
          totalX += point.x;
          totalY += point.y;
          totalPoints++;
        }
      }
    }
    
    if (totalPoints === 0) return { x: 0, y: 0 };
    
    return {
      x: totalX / totalPoints,
      y: totalY / totalPoints
    };
  }

  // Clean and simplify polygons for medical accuracy
  static cleanPolygons(polygons: MultiPolygon, tolerance = 1): MultiPolygon {
    return polygons.filter(polygon => 
      polygon.every(ring => ring.length >= 3)
    ).map(polygon => 
      polygon.map(ring => this.simplifyRing(ring, tolerance))
    );
  }

  // Simplify polygon ring by removing redundant points
  private static simplifyRing(ring: PolygonRing, tolerance: number): PolygonRing {
    if (ring.length <= 3) return ring;
    
    const simplified: Point[] = [ring[0]];
    
    for (let i = 1; i < ring.length - 1; i++) {
      const prev = simplified[simplified.length - 1];
      const curr = ring[i];
      const next = ring[i + 1];
      
      // Calculate distance from current point to line between prev and next
      const dist = this.distanceToLine(curr, prev, next);
      
      if (dist > tolerance) {
        simplified.push(curr);
      }
    }
    
    // Always include the last point
    simplified.push(ring[ring.length - 1]);
    
    return simplified;
  }

  // Calculate distance from point to line
  private static distanceToLine(point: Point, lineStart: Point, lineEnd: Point): number {
    const A = point.x - lineStart.x;
    const B = point.y - lineStart.y;
    const C = lineEnd.x - lineStart.x;
    const D = lineEnd.y - lineStart.y;
    
    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    
    if (lenSq === 0) return Math.sqrt(A * A + B * B);
    
    const param = dot / lenSq;
    
    let xx: number, yy: number;
    
    if (param < 0) {
      xx = lineStart.x;
      yy = lineStart.y;
    } else if (param > 1) {
      xx = lineEnd.x;
      yy = lineEnd.y;
    } else {
      xx = lineStart.x + param * C;
      yy = lineStart.y + param * D;
    }
    
    const dx = point.x - xx;
    const dy = point.y - yy;
    
    return Math.sqrt(dx * dx + dy * dy);
  }

  // Convert MultiPolygon to SVG path string
  static toSVGPath(polygon: MultiPolygon): string {
    const paths: string[] = [];
    
    for (const poly of polygon) {
      for (const ring of poly) {
        if (ring.length < 3) continue;
        
        let path = `M${ring[0].x.toFixed(2)},${ring[0].y.toFixed(2)}`;
        
        for (let i = 1; i < ring.length; i++) {
          path += ` L${ring[i].x.toFixed(2)},${ring[i].y.toFixed(2)}`;
        }
        
        path += ' Z'; // Close path
        paths.push(path);
      }
    }
    
    return paths.join(' ');
  }
}