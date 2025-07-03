// Medical Brush Engine - OHIF-Style Implementation
// Advanced brush tool engine for medical segmentation following OHIF standards

import { Point, BrushOperation, MultiPolygon } from '@shared/schema';
import { PolygonOperationsV2 } from './polygon-operations-v2';

export interface BrushConfiguration {
  brushSize: number; // in millimeters
  activeStrategy: 'FILL_INSIDE_CIRCLE' | 'FILL_INSIDE_SPHERE';
  operation: BrushOperation;
  preview: {
    enabled: boolean;
  };
  threshold?: {
    range: [number, number];
    isDynamic: boolean;
  };
  interpolation: {
    enabled: boolean;
    density: number; // Points per mm
  };
  smoothing: {
    enabled: boolean;
    factor: number; // 0-1
  };
}

export interface LabelMapVolume {
  volumeId: string;
  dimensions: [number, number, number];
  spacing: [number, number, number]; // mm per voxel
  origin: [number, number, number];
  direction: number[][];
  imageData: Uint8Array;
}

export interface BrushMask {
  center: Point;
  radius: number;
  strategy: 'FILL_INSIDE_CIRCLE' | 'FILL_INSIDE_SPHERE';
  voxels: Array<{
    x: number;
    y: number;
    z?: number;
    value: number;
  }>;
}

export interface BrushStroke {
  id: string;
  points: Point[];
  operation: BrushOperation;
  brushSize: number;
  timestamp: number;
  sliceIndex: number;
  segmentIndex: number;
  masks: BrushMask[];
}

export interface SegmentationVolume {
  segmentationId: string;
  representationData: {
    Labelmap: LabelMapVolume;
  };
  segments: Record<number, {
    label: string;
    color: [number, number, number];
    active: boolean;
  }>;
}

export class MedicalBrushEngine {
  private config: BrushConfiguration;
  private activeSegmentation: SegmentationVolume | null = null;
  private activeSegmentIndex = 1;
  private currentSliceIndex = 0;
  private spacing: [number, number, number] = [1, 1, 1];
  
  // Stroke management
  private currentStroke: Point[] = [];
  private strokeHistory: BrushStroke[] = [];
  private redoHistory: BrushStroke[] = [];
  private isDrawing = false;
  
  // Performance optimization
  private lastProcessTime = 0;
  private processingThrottle = 16; // 60fps
  
  constructor(config: Partial<BrushConfiguration> = {}) {
    this.config = {
      brushSize: 25, // mm
      activeStrategy: 'FILL_INSIDE_CIRCLE',
      operation: BrushOperation.ADDITIVE,
      preview: {
        enabled: true
      },
      interpolation: {
        enabled: true,
        density: 0.25 // points per mm
      },
      smoothing: {
        enabled: true,
        factor: 0.5
      },
      ...config
    };
    
    this.initializeEngine();
  }
  
  private async initializeEngine(): Promise<void> {
    try {
      await PolygonOperationsV2.initialize();
    } catch (error) {
      console.error('Failed to initialize medical brush engine:', error);
    }
  }
  
  // Set active segmentation
  setActiveSegmentation(segmentation: SegmentationVolume): void {
    this.activeSegmentation = segmentation;
    
    if (segmentation.representationData.Labelmap) {
      this.spacing = segmentation.representationData.Labelmap.spacing;
    }
  }
  
  // Set active segment for brush operations
  setActiveSegmentIndex(index: number): void {
    this.activeSegmentIndex = index;
  }
  
  // Set current slice index
  setCurrentSliceIndex(index: number): void {
    this.currentSliceIndex = index;
  }
  
  // Update brush configuration
  updateConfiguration(updates: Partial<BrushConfiguration>): void {
    this.config = { ...this.config, ...updates };
  }
  
  // Start brush stroke
  startStroke(point: Point): void {
    this.isDrawing = true;
    this.currentStroke = [point];
    
    // Apply initial brush stamp
    this.applyBrushStamp(point);
    
    // Clear redo history
    this.redoHistory = [];
    
    console.log('Medical brush stroke started:', {
      point,
      operation: this.config.operation,
      brushSize: this.config.brushSize,
      slice: this.currentSliceIndex,
      segment: this.activeSegmentIndex
    });
  }
  
  // Continue brush stroke
  continueStroke(point: Point): void {
    if (!this.isDrawing) return;
    
    const lastPoint = this.currentStroke[this.currentStroke.length - 1];
    if (!lastPoint) return;
    
    // Calculate distance in world coordinates
    const distance = this.calculateWorldDistance(lastPoint, point);
    
    if (distance > 0) {
      // Interpolate points based on brush size and density
      const interpolatedPoints = this.interpolateStroke(lastPoint, point);
      
      for (const interpolatedPoint of interpolatedPoints) {
        this.currentStroke.push(interpolatedPoint);
        this.applyBrushStamp(interpolatedPoint);
      }
    }
  }
  
  // End brush stroke
  endStroke(): BrushStroke | null {
    if (!this.isDrawing) return null;
    
    this.isDrawing = false;
    
    if (this.currentStroke.length === 0) return null;
    
    // Create stroke record
    const stroke: BrushStroke = {
      id: this.generateStrokeId(),
      points: [...this.currentStroke],
      operation: this.config.operation,
      brushSize: this.config.brushSize,
      timestamp: Date.now(),
      sliceIndex: this.currentSliceIndex,
      segmentIndex: this.activeSegmentIndex,
      masks: this.generateStrokeMasks(this.currentStroke)
    };
    
    this.strokeHistory.push(stroke);
    this.currentStroke = [];
    
    console.log('Medical brush stroke completed:', {
      id: stroke.id,
      pointCount: stroke.points.length,
      maskCount: stroke.masks.length,
      operation: stroke.operation
    });
    
    return stroke;
  }
  
  // Apply brush stamp at specific point
  private applyBrushStamp(point: Point): void {
    if (!this.activeSegmentation) return;
    
    const now = Date.now();
    if (now - this.lastProcessTime < this.processingThrottle) return;
    
    const mask = this.createBrushMask(point);
    this.applyMaskToLabelmap(mask);
    
    this.lastProcessTime = now;
  }
  
  // Create brush mask at point
  createBrushMask(center: Point): BrushMask {
    const radiusInMM = this.config.brushSize / 2;
    const voxels: Array<{ x: number; y: number; z?: number; value: number }> = [];
    
    if (this.config.activeStrategy === 'FILL_INSIDE_CIRCLE') {
      // 2D circular mask
      const radiusInVoxels = this.mmToVoxels(radiusInMM);
      const radiusSquared = radiusInVoxels * radiusInVoxels;
      
      for (let dy = -radiusInVoxels; dy <= radiusInVoxels; dy++) {
        for (let dx = -radiusInVoxels; dx <= radiusInVoxels; dx++) {
          const distanceSquared = dx * dx + dy * dy;
          
          if (distanceSquared <= radiusSquared) {
            const voxelX = Math.round(center.x + dx);
            const voxelY = Math.round(center.y + dy);
            
            voxels.push({
              x: voxelX,
              y: voxelY,
              z: this.currentSliceIndex,
              value: this.config.operation === BrushOperation.ADDITIVE ? 
                this.activeSegmentIndex : 0
            });
          }
        }
      }
    } else {
      // 3D spherical mask (for future implementation)
      // For now, fall back to 2D
      return this.createBrushMask(center);
    }
    
    return {
      center,
      radius: radiusInMM,
      strategy: this.config.activeStrategy,
      voxels
    };
  }
  
  // Apply mask to labelmap volume
  private applyMaskToLabelmap(mask: BrushMask): void {
    if (!this.activeSegmentation) return;
    
    const labelmap = this.activeSegmentation.representationData.Labelmap;
    const [width, height, depth] = labelmap.dimensions;
    
    for (const voxel of mask.voxels) {
      // Check bounds
      if (voxel.x < 0 || voxel.x >= width ||
          voxel.y < 0 || voxel.y >= height ||
          (voxel.z !== undefined && (voxel.z < 0 || voxel.z >= depth))) {
        continue;
      }
      
      // Calculate volume index
      const volumeIndex = this.calculateVolumeIndex(voxel.x, voxel.y, voxel.z || this.currentSliceIndex);
      
      // Apply voxel value
      if (volumeIndex >= 0 && volumeIndex < labelmap.imageData.length) {
        labelmap.imageData[volumeIndex] = voxel.value;
      }
    }
  }
  
  // Calculate volume index from coordinates
  private calculateVolumeIndex(x: number, y: number, z: number): number {
    if (!this.activeSegmentation) return -1;
    
    const [width, height] = this.activeSegmentation.representationData.Labelmap.dimensions;
    return z * width * height + y * width + x;
  }
  
  // Convert millimeters to voxels
  private mmToVoxels(mm: number): number {
    // Use the smallest spacing for isotropic conversion
    const minSpacing = Math.min(...this.spacing);
    return mm / minSpacing;
  }
  
  // Calculate world distance between points
  private calculateWorldDistance(p1: Point, p2: Point): number {
    const dx = (p2.x - p1.x) * this.spacing[0];
    const dy = (p2.y - p1.y) * this.spacing[1];
    return Math.sqrt(dx * dx + dy * dy);
  }
  
  // Interpolate stroke points
  private interpolateStroke(start: Point, end: Point): Point[] {
    if (!this.config.interpolation.enabled) return [end];
    
    const distance = this.calculateWorldDistance(start, end);
    const density = this.config.interpolation.density;
    const steps = Math.max(1, Math.floor(distance * density));
    
    const points: Point[] = [];
    
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      let interpolatedPoint = {
        x: start.x + (end.x - start.x) * t,
        y: start.y + (end.y - start.y) * t
      };
      
      // Apply smoothing
      if (this.config.smoothing.enabled && this.currentStroke.length > 0) {
        const prevPoint = this.currentStroke[this.currentStroke.length - 1];
        const factor = this.config.smoothing.factor;
        
        interpolatedPoint = {
          x: prevPoint.x + (interpolatedPoint.x - prevPoint.x) * factor,
          y: prevPoint.y + (interpolatedPoint.y - prevPoint.y) * factor
        };
      }
      
      points.push(interpolatedPoint);
    }
    
    return points;
  }
  
  // Generate stroke masks for history
  private generateStrokeMasks(points: Point[]): BrushMask[] {
    const masks: BrushMask[] = [];
    
    for (const point of points) {
      masks.push(this.createBrushMask(point));
    }
    
    return masks;
  }
  
  // Generate unique stroke ID
  private generateStrokeId(): string {
    return `stroke_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  // Undo last stroke
  undo(): BrushStroke | null {
    const lastStroke = this.strokeHistory.pop();
    if (!lastStroke) return null;
    
    // Reverse the stroke by applying opposite operation
    this.reverseStroke(lastStroke);
    this.redoHistory.push(lastStroke);
    
    console.log('Undid stroke:', lastStroke.id);
    return lastStroke;
  }
  
  // Redo last undone stroke
  redo(): BrushStroke | null {
    const redoStroke = this.redoHistory.pop();
    if (!redoStroke) return null;
    
    // Reapply the stroke
    this.reapplyStroke(redoStroke);
    this.strokeHistory.push(redoStroke);
    
    console.log('Redid stroke:', redoStroke.id);
    return redoStroke;
  }
  
  // Reverse stroke by applying opposite operation
  private reverseStroke(stroke: BrushStroke): void {
    const oppositeOperation = stroke.operation === BrushOperation.ADDITIVE ? 
      BrushOperation.SUBTRACTIVE : BrushOperation.ADDITIVE;
    
    for (const mask of stroke.masks) {
      const reverseMask: BrushMask = {
        ...mask,
        voxels: mask.voxels.map(voxel => ({
          ...voxel,
          value: oppositeOperation === BrushOperation.ADDITIVE ? 
            stroke.segmentIndex : 0
        }))
      };
      
      this.applyMaskToLabelmap(reverseMask);
    }
  }
  
  // Reapply stroke
  private reapplyStroke(stroke: BrushStroke): void {
    for (const mask of stroke.masks) {
      this.applyMaskToLabelmap(mask);
    }
  }
  
  // Check if can undo
  canUndo(): boolean {
    return this.strokeHistory.length > 0;
  }
  
  // Check if can redo
  canRedo(): boolean {
    return this.redoHistory.length > 0;
  }
  
  // Get brush preview at point
  getBrushPreview(point: Point): BrushMask {
    return this.createBrushMask(point);
  }
  
  // Get current configuration
  getConfiguration(): BrushConfiguration {
    return { ...this.config };
  }
  
  // Get stroke history
  getStrokeHistory(): BrushStroke[] {
    return [...this.strokeHistory];
  }
  
  // Clear all history
  clearHistory(): void {
    this.strokeHistory = [];
    this.redoHistory = [];
  }
  
  // Check if currently drawing
  isActivelyDrawing(): boolean {
    return this.isDrawing;
  }
  
  // Get current stroke points
  getCurrentStroke(): Point[] {
    return [...this.currentStroke];
  }
}