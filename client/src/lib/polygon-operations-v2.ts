// V2 Professional Polygon Operations Manager
// Medical-grade ClipperLib integration with 1000x scaling factor

import { 
  Point, 
  MultiPolygon, 
  Polygon, 
  PolygonRing 
} from '@shared/schema';

// Import ClipperLib with proper types
import { 
  ClipperLib, 
  ClipType, 
  JoinType, 
  EndType, 
  PolyFillType, 
  PointInPolygonResult 
} from 'js-angusj-clipper/web';

export class PolygonOperationsV2 {
  private static readonly SCALING_FACTOR = 1000;
  
  // Initialize ClipperLib
  static async initialize(): Promise<void> {
    try {
      // Ensure ClipperLib is properly loaded
      if (!ClipperLib) {
        throw new Error('ClipperLib not available - medical precision operations cannot function');
      }
      console.log('V2 PolygonOperations initialized with medical-grade precision');
    } catch (error) {
      console.error('Critical: Failed to initialize ClipperLib for medical operations:', error);
      throw error;
    }
  }

  // Scale coordinates for ClipperLib medical precision
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

  // Unscale coordinates from ClipperLib
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

  // Union operation for additive brush strokes
  static union(polygons1: MultiPolygon, polygons2: MultiPolygon): MultiPolygon {
    if (!ClipperLib) {
      console.error('ClipperLib not available for union operation');
      return polygons1;
    }

    const scaled1 = this.scaleCoordinates(polygons1);
    const scaled2 = this.scaleCoordinates(polygons2);
    
    try {
      const result = ClipperLib.clipToPolyTree({
        clipType: ClipType.Union,
        subjectInputs: scaled1.flat().map(ring => ({ data: ring, closed: true })),
        clipInputs: scaled2.flat().map(ring => ({ data: ring, closed: true })),
        subjectFillType: PolyFillType.NonZero,
      });
      
      let resultPaths = ClipperLib.polyTreeToPaths(result);
      resultPaths = ClipperLib.cleanPolygons(resultPaths, 2);
      resultPaths = ClipperLib.simplifyPolygons(resultPaths, PolyFillType.NonZero);
      
      // Convert paths back to MultiPolygon structure
      const multiPolygon = resultPaths.map(path => [path]);
      return this.unscaleCoordinates(multiPolygon);
    } catch (error) {
      console.error('ClipperLib union operation failed:', error);
      return polygons1;
    }
  }

  // Difference operation for subtractive brush strokes
  static difference(polygons1: MultiPolygon, polygons2: MultiPolygon): MultiPolygon {
    if (!ClipperLib) {
      console.error('ClipperLib not available for difference operation');
      return polygons1;
    }

    const scaled1 = this.scaleCoordinates(polygons1);
    const scaled2 = this.scaleCoordinates(polygons2);
    
    try {
      const result = ClipperLib.clipToPolyTree({
        clipType: ClipType.Difference,
        subjectInputs: scaled1.flat().map(ring => ({ data: ring, closed: true })),
        clipInputs: scaled2.flat().map(ring => ({ data: ring, closed: true })),
        subjectFillType: PolyFillType.NonZero,
      });
      
      let resultPaths = ClipperLib.polyTreeToPaths(result);
      resultPaths = ClipperLib.cleanPolygons(resultPaths, 2);
      resultPaths = ClipperLib.simplifyPolygons(resultPaths, PolyFillType.NonZero);
      
      // Convert paths back to MultiPolygon structure
      const multiPolygon = resultPaths.map(path => [path]);
      return this.unscaleCoordinates(multiPolygon);
    } catch (error) {
      console.error('ClipperLib difference operation failed:', error);
      return polygons1;
    }
  }

  // Intersection operation
  static intersection(polygons1: MultiPolygon, polygons2: MultiPolygon): MultiPolygon {
    if (!ClipperLib) {
      console.error('ClipperLib not available for intersection operation');
      return [];
    }

    const scaled1 = this.scaleCoordinates(polygons1);
    const scaled2 = this.scaleCoordinates(polygons2);
    
    try {
      const result = ClipperLib.clipToPolyTree({
        clipType: ClipType.Intersection,
        subjectInputs: scaled1.flat().map(ring => ({ data: ring, closed: true })),
        clipInputs: scaled2.flat().map(ring => ({ data: ring, closed: true })),
        subjectFillType: PolyFillType.NonZero,
      });
      
      let resultPaths = ClipperLib.polyTreeToPaths(result);
      resultPaths = ClipperLib.cleanPolygons(resultPaths, 2);
      resultPaths = ClipperLib.simplifyPolygons(resultPaths, PolyFillType.NonZero);
      
      // Convert paths back to MultiPolygon structure
      const multiPolygon = resultPaths.map(path => [path]);
      return this.unscaleCoordinates(multiPolygon);
    } catch (error) {
      console.error('ClipperLib intersection operation failed:', error);
      return [];
    }
  }

  // Offset operation for brush stroke path creation
  static offset(polygons: MultiPolygon, delta: number): MultiPolygon {
    if (!ClipperLib) {
      console.error('ClipperLib not available for offset operation');
      return polygons;
    }

    const scaled = this.scaleCoordinates(polygons);
    const scaledDelta = Math.round(delta * this.SCALING_FACTOR);
    
    try {
      const result = ClipperLib.offsetToPolyTree({
        delta: scaledDelta,
        offsetInputs: scaled.flat().map(ring => ({
          data: ring,
          joinType: JoinType.Round,
          endType: EndType.ClosedPolygon
        }))
      });
      
      let resultPaths = ClipperLib.polyTreeToPaths(result);
      resultPaths = ClipperLib.cleanPolygons(resultPaths, 2);
      
      // Convert paths back to MultiPolygon structure
      const multiPolygon = resultPaths.map(path => [path]);
      return this.unscaleCoordinates(multiPolygon);
    } catch (error) {
      console.error('ClipperLib offset operation failed:', error);
      return polygons;
    }
  }

  // Point-in-polygon test with medical precision
  static isPointInPolygon(point: Point, polygons: MultiPolygon): boolean {
    if (!ClipperLib) {
      console.error('ClipperLib not available for point-in-polygon test');
      return false;
    }

    const scaledPoint = {
      x: Math.round(point.x * this.SCALING_FACTOR),
      y: Math.round(point.y * this.SCALING_FACTOR)
    };
    
    const scaledPolygons = this.scaleCoordinates(polygons);
    
    try {
      let insideCount = 0;
      for (const polygon of scaledPolygons) {
        for (const ring of polygon) {
          const result = ClipperLib.pointInPolygon(scaledPoint, ring);
          if (result === PointInPolygonResult.Inside) {
            insideCount++;
          }
        }
      }
      
      // Use NonZero fill rule - odd number of insides = point is inside
      return insideCount % 2 === 1;
    } catch (error) {
      console.error('ClipperLib point-in-polygon test failed:', error);
      return false;
    }
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
    points.push(points[0]); // Close the ring
    
    return [[points]]; // Return as MultiPolygon
  }

  // Create brush stroke path using ClipperLib offset
  static createBrushStrokePath(startPoint: Point, endPoint: Point, radius: number): MultiPolygon {
    if (!ClipperLib) {
      console.error('ClipperLib not available for brush stroke creation');
      return this.createBrushCircle(endPoint, radius);
    }

    const line: Point[] = [startPoint, endPoint];
    const scaledLine = this.scaleCoordinates([[line]]);
    const scaledRadius = Math.round(radius * this.SCALING_FACTOR);
    
    try {
      const result = ClipperLib.offsetToPolyTree({
        delta: scaledRadius,
        offsetInputs: [{
          data: scaledLine[0][0],
          joinType: JoinType.Round,
          endType: EndType.OpenRound
        }]
      });
      
      let resultPaths = ClipperLib.polyTreeToPaths(result);
      resultPaths = ClipperLib.cleanPolygons(resultPaths, 2);
      
      if (resultPaths.length === 0) {
        // Fallback to brush circle if offset fails
        return this.createBrushCircle(endPoint, radius);
      }
      
      // Convert paths back to MultiPolygon structure
      const multiPolygon = resultPaths.map(path => [path]);
      return this.unscaleCoordinates(multiPolygon);
    } catch (error) {
      console.error('ClipperLib brush stroke creation failed:', error);
      return this.createBrushCircle(endPoint, radius);
    }
  }

  // Validate polygon structure
  static validatePolygon(polygon: MultiPolygon): boolean {
    for (const poly of polygon) {
      for (const ring of poly) {
        if (ring.length < 3) return false;
        
        // Check if polygon is closed
        const first = ring[0];
        const last = ring[ring.length - 1];
        const distance = Math.sqrt(
          Math.pow(first.x - last.x, 2) + Math.pow(first.y - last.y, 2)
        );
        
        if (distance > 1) return false; // 1 pixel tolerance
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
        for (let i = 0; i < ring.length; i++) {
          const j = (i + 1) % ring.length;
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
    let totalArea = 0;
    
    for (const poly of polygon) {
      for (const ring of poly) {
        if (ring.length < 3) continue;
        
        let area = 0;
        let centroidX = 0;
        let centroidY = 0;
        
        for (let i = 0; i < ring.length; i++) {
          const j = (i + 1) % ring.length;
          const cross = ring[i].x * ring[j].y - ring[j].x * ring[i].y;
          area += cross;
          centroidX += (ring[i].x + ring[j].x) * cross;
          centroidY += (ring[i].y + ring[j].y) * cross;
        }
        
        area /= 2;
        if (area !== 0) {
          centroidX /= (6 * area);
          centroidY /= (6 * area);
          
          totalX += centroidX * Math.abs(area);
          totalY += centroidY * Math.abs(area);
          totalArea += Math.abs(area);
        }
      }
    }
    
    if (totalArea === 0) return { x: 0, y: 0 };
    
    return {
      x: totalX / totalArea,
      y: totalY / totalArea
    };
  }

  // Clean and simplify polygons for medical accuracy
  static cleanPolygons(polygons: MultiPolygon, tolerance = 1): MultiPolygon {
    if (!ClipperLib) {
      console.error('ClipperLib not available for polygon cleaning');
      return polygons;
    }

    try {
      const scaled = this.scaleCoordinates(polygons);
      let cleanedPaths = ClipperLib.cleanPolygons(scaled.flat(), tolerance * this.SCALING_FACTOR);
      cleanedPaths = ClipperLib.simplifyPolygons(cleanedPaths, PolyFillType.NonZero);
      
      // Convert paths back to MultiPolygon structure
      const multiPolygon = cleanedPaths.map(path => [path]);
      return this.unscaleCoordinates(multiPolygon);
    } catch (error) {
      console.error('ClipperLib polygon cleaning failed:', error);
      return polygons;
    }
  }
}