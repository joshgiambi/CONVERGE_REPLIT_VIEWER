// V2 Professional Contour Class
// Medical-grade contour management with multi-polygon support

import {
  Point,
  Point3D,
  DisplayPoint,
  MultiPolygon,
  ContourData,
  SlicingMode,
  CommitStatus
} from '@shared/schema';
import { PolygonOperationsV2 } from './polygon-operations-v2';
import { CoordinateTransformerV2 } from './coordinate-transformer-v2';

export class ContourV2 {
  private id: string;
  private slicePosition: number;
  private slicingMode: SlicingMode;
  private polygons: MultiPolygon;
  private commitStatus: CommitStatus;
  private _needsUpdate: boolean;
  private metadata: {
    sourceTime: number;
    modifiedTime: number;
    commitTime: number;
  };

  constructor(
    structureId: string,
    slicePosition: number,
    slicingMode: SlicingMode = SlicingMode.K,
    initialCoordinates: Point[] = []
  ) {
    this.id = `${structureId}-${slicePosition}-${slicingMode}`;
    this.slicePosition = slicePosition;
    this.slicingMode = slicingMode;
    this.commitStatus = CommitStatus.SOURCE;
    this._needsUpdate = false;
    
    this.metadata = {
      sourceTime: Date.now(),
      modifiedTime: Date.now(),
      commitTime: 0
    };

    // Initialize polygons from coordinates
    if (initialCoordinates.length > 0) {
      this.polygons = this.convertCoordinatesToPolygons(initialCoordinates);
    } else {
      this.polygons = [];
    }
  }

  // Convert coordinate array to MultiPolygon structure
  private convertCoordinatesToPolygons(coordinates: Point[]): MultiPolygon {
    if (coordinates.length < 3) return [];
    
    // Ensure the polygon is closed
    const closedCoordinates = [...coordinates];
    if (coordinates.length > 0) {
      const first = coordinates[0];
      const last = coordinates[coordinates.length - 1];
      const distance = Math.sqrt(
        Math.pow(first.x - last.x, 2) + Math.pow(first.y - last.y, 2)
      );
      
      if (distance > 1) {
        closedCoordinates.push(first);
      }
    }
    
    return [[closedCoordinates]];
  }

  // Get current polygons
  getCurrent(): MultiPolygon {
    return this.polygons;
  }

  // Update polygons with new multi-polygon data
  updatePolygons(newPolygons: MultiPolygon): void {
    this.polygons = PolygonOperationsV2.cleanPolygons(newPolygons);
    this.markAsModified();
  }

  // Get contour ID
  getId(): string {
    return this.id;
  }

  // Get slice position
  getSlicePosition(): number {
    return this.slicePosition;
  }

  // Get slicing mode
  getSlicingMode(): SlicingMode {
    return this.slicingMode;
  }

  // Add polygon to the contour
  addPolygon(points: Point[]): void {
    if (this.isValidPolygon(points)) {
      this.polygons.push([points]);
      this.markAsModified();
    }
  }

  // Remove polygon by index
  removePolygon(index: number): void {
    if (index >= 0 && index < this.polygons.length) {
      this.polygons.splice(index, 1);
      this.markAsModified();
    }
  }

  // Validate polygon structure
  private isValidPolygon(points: Point[]): boolean {
    return points.length >= 3;
  }

  // Mark contour as modified
  private markAsModified(): void {
    this._needsUpdate = true;
    this.commitStatus = CommitStatus.STAGED;
    this.metadata.modifiedTime = Date.now();
  }

  // Get centroid of all polygons
  getCentroid(): Point {
    return PolygonOperationsV2.getPolygonCentroid(this.polygons);
  }

  // Get bounding box
  getBounds(): { minX: number; minY: number; maxX: number; maxY: number } {
    if (this.polygons.length === 0) {
      return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const polygon of this.polygons) {
      for (const ring of polygon) {
        for (const point of ring) {
          minX = Math.min(minX, point.x);
          minY = Math.min(minY, point.y);
          maxX = Math.max(maxX, point.x);
          maxY = Math.max(maxY, point.y);
        }
      }
    }

    return { minX, minY, maxX, maxY };
  }

  // Convert to SVG paths for rendering
  toSVGPaths(): string[] {
    const paths: string[] = [];

    for (const polygon of this.polygons) {
      for (const ring of polygon) {
        if (ring.length < 3) continue;

        let path = `M${ring[0].x.toFixed(2)},${ring[0].y.toFixed(2)}`;

        for (let i = 1; i < ring.length; i++) {
          path += ` L${ring[i].x.toFixed(2)},${ring[i].y.toFixed(2)}`;
        }

        path += ' Z'; // Close path
        paths.push(path);
      }
    }

    return paths;
  }

  // Convert to display points for rendering with viewport transformation
  toDisplayPoints(viewport: any): DisplayPoint[][] {
    const displayPoints: DisplayPoint[][] = [];

    for (const polygon of this.polygons) {
      for (const ring of polygon) {
        const ringDisplayPoints: DisplayPoint[] = ring.map(point => {
          // Apply coordinate transformation
          const worldPoint = CoordinateTransformerV2.scaledToWorld(point);
          return CoordinateTransformerV2.worldToDisplay(worldPoint, viewport) as any;
        });

        displayPoints.push(ringDisplayPoints);
      }
    }

    return displayPoints;
  }

  // Clone contour
  clone(): ContourV2 {
    const structureId = this.id.split('-')[0]; // Extract structure ID
    const cloned = new ContourV2(
      structureId,
      this.slicePosition,
      this.slicingMode,
      [] // Empty coordinates since we'll copy polygons directly
    );

    // Deep copy polygons
    cloned.polygons = JSON.parse(JSON.stringify(this.polygons));
    cloned.metadata = { ...this.metadata };
    cloned.commitStatus = this.commitStatus;
    cloned._needsUpdate = this._needsUpdate;

    return cloned;
  }

  // Commit changes
  commit(): void {
    this.commitStatus = CommitStatus.COMMITTED;
    this._needsUpdate = false;
    this.metadata.commitTime = Date.now();
  }

  // Get commit status
  getCommitStatus(): CommitStatus {
    return this.commitStatus;
  }

  // Check if needs update
  get needsUpdate(): boolean {
    return this._needsUpdate;
  }

  set needsUpdate(value: boolean) {
    this._needsUpdate = value;
  }

  // Get metadata
  getMetadata() {
    return { ...this.metadata };
  }

  // Apply brush operation (union or difference)
  applyBrushOperation(brushPolygons: MultiPolygon, isAdditive: boolean): void {
    if (isAdditive) {
      this.polygons = PolygonOperationsV2.union(this.polygons, brushPolygons);
    } else {
      this.polygons = PolygonOperationsV2.difference(this.polygons, brushPolygons);
    }
    this.markAsModified();
  }

  // Check if point is inside any polygon
  containsPoint(point: Point): boolean {
    return PolygonOperationsV2.isPointInPolygon(point, this.polygons);
  }

  // Get total area of all polygons
  getTotalArea(): number {
    return PolygonOperationsV2.getPolygonArea(this.polygons);
  }

  // Simplify contour by removing redundant points
  simplify(tolerance = 1): void {
    this.polygons = PolygonOperationsV2.cleanPolygons(this.polygons, tolerance);
    this.markAsModified();
  }

  // Clear all polygons
  clear(): void {
    this.polygons = [];
    this.markAsModified();
  }

  // Check if contour is empty
  isEmpty(): boolean {
    return this.polygons.length === 0 || 
           this.polygons.every(polygon => 
             polygon.every(ring => ring.length < 3)
           );
  }

  // Get polygon count
  getPolygonCount(): number {
    return this.polygons.length;
  }

  // Convert to serializable format
  toSerializable(): ContourData {
    return {
      id: this.id,
      slicePosition: this.slicePosition,
      slicingMode: this.slicingMode,
      polygons: this.polygons,
      metadata: this.metadata
    };
  }

  // Create from serializable data
  static fromSerializable(data: ContourData): ContourV2 {
    const structureId = data.id.split('-')[0];
    const contour = new ContourV2(
      structureId,
      data.slicePosition,
      data.slicingMode,
      []
    );

    contour.polygons = data.polygons;
    contour.metadata = data.metadata;
    contour.id = data.id;

    return contour;
  }

  // Validate contour data integrity
  validate(): boolean {
    // Check basic properties
    if (!this.id || this.slicePosition === undefined) {
      return false;
    }

    // Validate all polygons
    for (const polygon of this.polygons) {
      if (!PolygonOperationsV2.validatePolygon([polygon])) {
        return false;
      }
    }

    return true;
  }

  // Get contour statistics
  getStatistics() {
    return {
      polygonCount: this.getPolygonCount(),
      totalArea: this.getTotalArea(),
      centroid: this.getCentroid(),
      bounds: this.getBounds(),
      pointCount: this.polygons.reduce((total, polygon) => 
        total + polygon.reduce((ringTotal, ring) => ringTotal + ring.length, 0), 0),
      isEmpty: this.isEmpty(),
      needsUpdate: this.needsUpdate,
      commitStatus: this.commitStatus,
      lastModified: new Date(this.metadata.modifiedTime)
    };
  }
}