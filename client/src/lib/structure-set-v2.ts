// V2 Professional Structure Set Entity
// Medical-grade structure management with complete DICOM integration

import {
  StructureData,
  ContourData,
  SlicingMode,
  Point,
  MultiPolygon
} from '@shared/schema';
import { ContourV2 } from './contour-v2';

export class StructureSetEntityV2 {
  private id: string;
  private structures: Map<string, StructureData>;
  private contourCache: Map<string, ContourV2>;
  private metadata: {
    sourceTime: number;
    modifiedTime: number;
    commitTime: number;
  };

  constructor(id: string) {
    this.id = id;
    this.structures = new Map();
    this.contourCache = new Map();
    this.metadata = {
      sourceTime: Date.now(),
      modifiedTime: Date.now(),
      commitTime: 0
    };
  }

  // Get structure by ID
  getStructure(structureId: string): StructureData | undefined {
    return this.structures.get(structureId);
  }

  // Get all structures
  getAllStructures(): StructureData[] {
    return Array.from(this.structures.values());
  }

  // Add new structure
  addStructure(structureData: StructureData): void {
    this.structures.set(structureData.id, structureData);
    this.updateModifiedTime();
  }

  // Remove structure
  removeStructure(structureId: string): boolean {
    const removed = this.structures.delete(structureId);
    
    if (removed) {
      // Clean up cache entries for this structure
      Array.from(this.contourCache.keys()).forEach(key => {
        if (key.startsWith(`${structureId}-`)) {
          this.contourCache.delete(key);
        }
      });
      this.updateModifiedTime();
    }
    
    return removed;
  }

  // Get contour for specific structure and slice position
  getContourAtSlice(
    structureId: string,
    slicePosition: number,
    slicingMode: SlicingMode = SlicingMode.K
  ): ContourV2 | undefined {
    const structure = this.structures.get(structureId);
    if (!structure) return undefined;

    // Check cache first
    const cacheKey = `${structureId}-${slicePosition}-${slicingMode}`;
    let contour = this.contourCache.get(cacheKey);
    
    if (contour) {
      return contour;
    }

    // Find closest slice position
    const slicePositions = Array.from(structure.contours.keys());
    const closestSlice = this.findClosestSlice(slicePositions, slicePosition);

    if (closestSlice === undefined) return undefined;

    const contourData = structure.contours.get(closestSlice);
    if (!contourData) return undefined;

    // Create ContourV2 from data
    contour = ContourV2.fromSerializable(contourData);
    
    // Cache the contour
    this.contourCache.set(cacheKey, contour);
    
    return contour;
  }

  // Find closest slice within tolerance
  private findClosestSlice(slicePositions: number[], targetPosition: number): number | undefined {
    if (slicePositions.length === 0) return undefined;

    let closest = slicePositions[0];
    let minDistance = Math.abs(closest - targetPosition);

    for (const position of slicePositions) {
      const distance = Math.abs(position - targetPosition);
      if (distance < minDistance) {
        minDistance = distance;
        closest = position;
      }
    }

    // Return closest if within tolerance (1mm for medical precision)
    return minDistance <= 1.0 ? closest : undefined;
  }

  // Get all contours for a structure across all slices
  getAllContoursForStructure(structureId: string): ContourV2[] {
    const structure = this.structures.get(structureId);
    if (!structure) return [];

    const contours: ContourV2[] = [];
    
    Array.from(structure.contours.entries()).forEach(([slicePosition, contourData]) => {
      const contour = ContourV2.fromSerializable(contourData);
      contours.push(contour);
      
      // Cache the contour
      const cacheKey = contour.getId();
      this.contourCache.set(cacheKey, contour);
    });

    return contours;
  }

  // Update contour for specific structure and slice
  updateContour(contour: ContourV2): void {
    const structureId = contour.getId().split('-')[0];
    const structure = this.structures.get(structureId);
    
    if (!structure) {
      console.error(`Structure ${structureId} not found for contour update`);
      return;
    }

    const slicePosition = contour.getSlicePosition();
    const contourData = contour.toSerializable();
    
    // Update structure's contour data
    structure.contours.set(slicePosition, contourData);
    
    // Update cache
    this.contourCache.set(contour.getId(), contour);
    
    // Mark as modified
    this.updateModifiedTime();
    structure.metadata.modifiedTime = Date.now();
  }

  // Delete contour at specific slice
  deleteContourAtSlice(
    structureId: string,
    slicePosition: number,
    slicingMode: SlicingMode = SlicingMode.K
  ): boolean {
    const structure = this.structures.get(structureId);
    if (!structure) return false;

    const removed = structure.contours.delete(slicePosition);
    
    if (removed) {
      // Remove from cache
      const cacheKey = `${structureId}-${slicePosition}-${slicingMode}`;
      this.contourCache.delete(cacheKey);
      
      // Mark as modified
      this.updateModifiedTime();
      structure.metadata.modifiedTime = Date.now();
    }
    
    return removed;
  }

  // Clear all contours for a structure
  clearStructureContours(structureId: string): void {
    const structure = this.structures.get(structureId);
    if (!structure) return;

    structure.contours.clear();
    
    // Clean up cache
    Array.from(this.contourCache.keys()).forEach(key => {
      if (key.startsWith(`${structureId}-`)) {
        this.contourCache.delete(key);
      }
    });
    
    this.updateModifiedTime();
    structure.metadata.modifiedTime = Date.now();
  }

  // Get structure statistics
  getStructureStatistics(structureId: string) {
    const structure = this.structures.get(structureId);
    if (!structure) return null;

    const contours = this.getAllContoursForStructure(structureId);
    let totalArea = 0;
    let totalVolume = 0;
    let sliceCount = 0;
    
    for (const contour of contours) {
      if (!contour.isEmpty()) {
        totalArea += contour.getTotalArea();
        sliceCount++;
      }
    }

    // Estimate volume (area * slice thickness)
    // This is a basic estimation - proper volume calculation requires slice thickness
    const avgSliceThickness = 1.0; // mm
    totalVolume = totalArea * avgSliceThickness;

    return {
      structureId,
      name: structure.name,
      color: structure.color,
      sliceCount,
      totalArea: totalArea.toFixed(2),
      estimatedVolume: totalVolume.toFixed(2),
      contourCount: contours.length,
      lastModified: new Date(structure.metadata.modifiedTime)
    };
  }

  // Get all slice positions for a structure
  getSlicePositions(structureId: string): number[] {
    const structure = this.structures.get(structureId);
    if (!structure) return [];

    return Array.from(structure.contours.keys()).sort((a, b) => a - b);
  }

  // Check if structure has contours
  hasContours(structureId: string): boolean {
    const structure = this.structures.get(structureId);
    return structure ? structure.contours.size > 0 : false;
  }

  // Commit all pending changes
  commitAll(): void {
    Array.from(this.contourCache.values()).forEach(contour => {
      if (contour.needsUpdate) {
        contour.commit();
        this.updateContour(contour);
      }
    });
    
    this.metadata.commitTime = Date.now();
  }

  // Get uncommitted changes count
  getUncommittedChangesCount(): number {
    let count = 0;
    Array.from(this.contourCache.values()).forEach(contour => {
      if (contour.needsUpdate) {
        count++;
      }
    });
    return count;
  }

  // Clear cache (useful for memory management)
  clearCache(): void {
    this.contourCache.clear();
  }

  // Get cache statistics
  getCacheStatistics() {
    return {
      cacheSize: this.contourCache.size,
      structureCount: this.structures.size,
      uncommittedChanges: this.getUncommittedChangesCount()
    };
  }

  // Update modified time
  private updateModifiedTime(): void {
    this.metadata.modifiedTime = Date.now();
  }

  // Get metadata
  getMetadata() {
    return { ...this.metadata };
  }

  // Set metadata
  setMetadata(metadata: Partial<typeof this.metadata>): void {
    this.metadata = { ...this.metadata, ...metadata };
  }

  // Validate structure set integrity
  validate(): boolean {
    try {
      // Check all cached contours
      for (const contour of Array.from(this.contourCache.values())) {
        if (!contour.validate()) {
          console.error(`Invalid contour found: ${contour.getId()}`);
          return false;
        }
      }

      // Check structure data consistency
      for (const [structureId, structure] of Array.from(this.structures.entries())) {
        if (!structure.id || !structure.name) {
          console.error(`Invalid structure data: ${structureId}`);
          return false;
        }
      }

      return true;
    } catch (error) {
      console.error('Structure set validation failed:', error);
      return false;
    }
  }

  // Export structure set to serializable format
  toSerializable() {
    const structures: Record<string, StructureData> = {};
    
    for (const [id, structure] of Array.from(this.structures.entries())) {
      structures[id] = {
        ...structure,
        contours: new Map(structure.contours) // Ensure proper serialization
      };
    }

    return {
      id: this.id,
      structures,
      metadata: this.metadata
    };
  }

  // Create structure set from serializable data
  static fromSerializable(data: any): StructureSetEntityV2 {
    const structureSet = new StructureSetEntityV2(data.id);
    
    structureSet.metadata = data.metadata;
    
    for (const [id, structureData] of Object.entries(data.structures as Record<string, StructureData>)) {
      structureSet.structures.set(id, structureData);
    }

    return structureSet;
  }
}