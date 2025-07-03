// OHIF-Enhanced Brush Tool Implementation
// Following OHIF patterns for medical-grade segmentation with improved functionality

import { Point, BrushOperation, MultiPolygon } from '@shared/schema';
import { PolygonOperationsV2 } from './polygon-operations-v2';

export interface BrushStroke {
  points: Point[];
  operation: BrushOperation;
  brushSize: number;
  timestamp: number;
  sliceIndex: number;
}

export interface BrushMask {
  center: Point;
  radius: number;
  voxels: Point[];
}

export interface BrushToolConfiguration {
  brushSize: number;
  operation: BrushOperation;
  activeStrategy: 'FILL_INSIDE_CIRCLE' | 'FILL_INSIDE_SPHERE';
  previewEnabled: boolean;
  threshold?: {
    range: [number, number];
    isDynamic: boolean;
  };
  smoothing: {
    enabled: boolean;
    factor: number;
  };
  interpolation: {
    enabled: boolean;
    density: number;
  };
}

export interface RTStructure {
  roiNumber: number;
  structureName: string;
  color: [number, number, number];
  contours: Record<number, Point[][]>; // slice position -> array of contour polygons
}

export class OHIFEnhancedBrushTool {
  private canvas: HTMLCanvasElement | null = null;
  private context: CanvasRenderingContext2D | null = null;
  private config: BrushToolConfiguration;
  
  // Drawing state
  private isDrawing = false;
  private currentStroke: Point[] = [];
  private lastPosition: Point | null = null;
  private operationLocked = false;
  private currentSliceIndex = 0;
  
  // History management
  private strokeHistory: BrushStroke[] = [];
  private redoHistory: BrushStroke[] = [];
  
  // Preview and cursor
  private mousePosition: Point | null = null;
  private previewCanvas: HTMLCanvasElement | null = null;
  private previewContext: CanvasRenderingContext2D | null = null;
  
  // Target structure
  private targetStructure: RTStructure | null = null;
  
  // Callbacks
  private onStrokeComplete?: (stroke: BrushStroke) => void;
  private onPreviewUpdate?: (position: Point, size: number, operation: BrushOperation) => void;
  private onOperationChange?: (operation: BrushOperation) => void;
  
  // Performance optimization
  private lastRenderTime = 0;
  private renderThrottle = 16; // 60fps
  
  constructor(config: Partial<BrushToolConfiguration> = {}) {
    this.config = {
      brushSize: 25,
      operation: BrushOperation.ADDITIVE,
      activeStrategy: 'FILL_INSIDE_CIRCLE',
      previewEnabled: true,
      smoothing: {
        enabled: true,
        factor: 0.5
      },
      interpolation: {
        enabled: true,
        density: 0.25
      },
      ...config
    };
    
    this.initializePolygonOperations();
  }
  
  private async initializePolygonOperations(): Promise<void> {
    try {
      await PolygonOperationsV2.initialize();
    } catch (error) {
      console.error('Failed to initialize polygon operations:', error);
    }
  }
  
  // Initialize with canvas
  initialize(canvas: HTMLCanvasElement, previewCanvas?: HTMLCanvasElement): void {
    this.canvas = canvas;
    this.context = canvas.getContext('2d');
    
    if (previewCanvas) {
      this.previewCanvas = previewCanvas;
      this.previewContext = previewCanvas.getContext('2d');
    }
    
    this.setupEventListeners();
  }
  
  private setupEventListeners(): void {
    if (!this.canvas) return;
    
    // Mouse events
    this.canvas.addEventListener('mousedown', this.handleMouseDown.bind(this));
    this.canvas.addEventListener('mousemove', this.handleMouseMove.bind(this));
    this.canvas.addEventListener('mouseup', this.handleMouseUp.bind(this));
    this.canvas.addEventListener('mouseleave', this.handleMouseLeave.bind(this));
    
    // Keyboard events for operation switching
    document.addEventListener('keydown', this.handleKeyDown.bind(this));
    document.addEventListener('keyup', this.handleKeyUp.bind(this));
    
    // Prevent context menu
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  
  private handleMouseDown(event: MouseEvent): void {
    if (event.button !== 0) return; // Only left mouse button
    
    event.preventDefault();
    event.stopPropagation();
    
    const point = this.getCanvasCoordinates(event);
    this.startStroke(point);
  }
  
  private handleMouseMove(event: MouseEvent): void {
    const point = this.getCanvasCoordinates(event);
    this.mousePosition = point;
    
    if (this.isDrawing) {
      this.continueStroke(point);
    } else {
      // Update smart brush mode detection when not drawing
      if (this.config.operation === BrushOperation.ADDITIVE && !this.operationLocked) {
        this.updateSmartBrushMode(point);
      }
    }
    
    this.throttledRender();
  }
  
  private handleMouseUp(event: MouseEvent): void {
    if (event.button !== 0) return;
    
    this.endStroke();
  }
  
  private handleMouseLeave(): void {
    this.endStroke();
    this.mousePosition = null;
    this.clearPreview();
  }
  
  private handleKeyDown(event: KeyboardEvent): void {
    // Shift key for operation inversion
    if (event.key === 'Shift' && !this.operationLocked) {
      this.invertOperation();
    }
    
    // Ctrl+Z for undo
    if (event.ctrlKey && event.key === 'z' && !event.shiftKey) {
      event.preventDefault();
      this.undo();
    }
    
    // Ctrl+Shift+Z for redo
    if (event.ctrlKey && event.key === 'z' && event.shiftKey) {
      event.preventDefault();
      this.redo();
    }
  }
  
  private handleKeyUp(event: KeyboardEvent): void {
    // Reset operation when shift is released
    if (event.key === 'Shift' && !this.operationLocked) {
      this.resetOperation();
    }
  }
  
  private getCanvasCoordinates(event: MouseEvent): Point {
    if (!this.canvas) return { x: 0, y: 0 };
    
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
  }
  
  private startStroke(point: Point): void {
    this.isDrawing = true;
    this.currentStroke = [point];
    this.lastPosition = point;
    this.operationLocked = true;
    
    // Smart brush mode - determine operation based on contour intersection
    if (this.targetStructure) {
      this.updateSmartBrushMode(point);
    }
    
    // Apply initial brush stamp
    this.applyBrushStamp(point);
    
    // Clear redo history
    this.redoHistory = [];
    
    console.log('Brush stroke started:', {
      operation: this.config.operation,
      brushSize: this.config.brushSize,
      slice: this.currentSliceIndex
    });
  }
  
  private continueStroke(point: Point): void {
    if (!this.isDrawing || !this.lastPosition) return;
    
    // Calculate distance for interpolation
    const distance = this.calculateDistance(this.lastPosition, point);
    
    if (distance > 0) {
      // Interpolate points for smooth stroke
      const interpolatedPoints = this.interpolatePoints(this.lastPosition, point);
      
      for (const interpolatedPoint of interpolatedPoints) {
        this.currentStroke.push(interpolatedPoint);
        this.applyBrushStamp(interpolatedPoint);
      }
      
      this.lastPosition = point;
    }
  }
  
  private endStroke(): void {
    if (!this.isDrawing) return;
    
    this.isDrawing = false;
    this.operationLocked = false;
    
    if (this.currentStroke.length > 0) {
      const stroke: BrushStroke = {
        points: [...this.currentStroke],
        operation: this.config.operation,
        brushSize: this.config.brushSize,
        timestamp: Date.now(),
        sliceIndex: this.currentSliceIndex
      };
      
      this.strokeHistory.push(stroke);
      
      if (this.onStrokeComplete) {
        this.onStrokeComplete(stroke);
      }
      
      console.log('Brush stroke completed:', {
        pointCount: stroke.points.length,
        operation: stroke.operation,
        brushSize: stroke.brushSize
      });
    }
    
    this.currentStroke = [];
    this.lastPosition = null;
  }
  
  private applyBrushStamp(point: Point): void {
    if (!this.context) return;
    
    const brushMask = this.createBrushMask(point);
    this.renderBrushMask(brushMask);
  }
  
  private createBrushMask(center: Point): BrushMask {
    const radius = this.config.brushSize / 2;
    const voxels: Point[] = [];
    
    if (this.config.activeStrategy === 'FILL_INSIDE_CIRCLE') {
      // 2D circular mask
      const radiusSquared = radius * radius;
      const intRadius = Math.ceil(radius);
      
      for (let y = -intRadius; y <= intRadius; y++) {
        for (let x = -intRadius; x <= intRadius; x++) {
          const distanceSquared = x * x + y * y;
          if (distanceSquared <= radiusSquared) {
            voxels.push({
              x: Math.round(center.x + x),
              y: Math.round(center.y + y)
            });
          }
        }
      }
    } else {
      // 3D spherical mask (for future 3D implementation)
      // Currently falls back to 2D
      return this.createBrushMask({ ...center });
    }
    
    return {
      center,
      radius,
      voxels
    };
  }
  
  private renderBrushMask(mask: BrushMask): void {
    if (!this.context) return;
    
    const color = this.config.operation === BrushOperation.ADDITIVE ? 
      'rgba(0, 255, 0, 0.3)' : 'rgba(255, 0, 0, 0.3)';
    
    this.context.save();
    this.context.fillStyle = color;
    this.context.globalCompositeOperation = 
      this.config.operation === BrushOperation.ADDITIVE ? 'source-over' : 'destination-out';
    
    // Render individual voxels for precise control
    for (const voxel of mask.voxels) {
      this.context.fillRect(voxel.x, voxel.y, 1, 1);
    }
    
    this.context.restore();
  }
  
  private interpolatePoints(start: Point, end: Point): Point[] {
    const distance = this.calculateDistance(start, end);
    const density = this.config.interpolation.density;
    const steps = Math.max(1, Math.floor(distance / (this.config.brushSize * density)));
    
    const points: Point[] = [];
    
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const point = {
        x: start.x + (end.x - start.x) * t,
        y: start.y + (end.y - start.y) * t
      };
      
      // Apply smoothing if enabled
      if (this.config.smoothing.enabled && this.currentStroke.length > 1) {
        const prevPoint = this.currentStroke[this.currentStroke.length - 1];
        point.x = prevPoint.x + (point.x - prevPoint.x) * this.config.smoothing.factor;
        point.y = prevPoint.y + (point.y - prevPoint.y) * this.config.smoothing.factor;
      }
      
      points.push(point);
    }
    
    return points;
  }
  
  private calculateDistance(p1: Point, p2: Point): number {
    return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
  }
  
  private updateSmartBrushMode(point: Point): void {
    if (!this.targetStructure) return;
    
    const isInContour = this.isPointInContour(point);
    const previousOperation = this.config.operation;
    
    // Smart brush logic: green when touching contour (add), red when not touching (subtract)
    this.config.operation = isInContour ? BrushOperation.ADDITIVE : BrushOperation.SUBTRACTIVE;
    
    if (this.config.operation !== previousOperation && this.onOperationChange) {
      this.onOperationChange(this.config.operation);
    }
  }
  
  private isPointInContour(point: Point): boolean {
    if (!this.targetStructure) return false;
    
    const sliceContours = this.targetStructure.contours[this.currentSliceIndex];
    if (!sliceContours || sliceContours.length === 0) return false;
    
    // Check if point is inside any contour polygon
    for (const contour of sliceContours) {
      if (this.isPointInPolygon(point, contour)) {
        return true;
      }
    }
    
    return false;
  }
  
  private isPointInPolygon(point: Point, polygon: Point[]): boolean {
    let inside = false;
    const n = polygon.length;
    
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = polygon[i].x;
      const yi = polygon[i].y;
      const xj = polygon[j].x;
      const yj = polygon[j].y;
      
      if (((yi > point.y) !== (yj > point.y)) &&
          (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi)) {
        inside = !inside;
      }
    }
    
    return inside;
  }
  
  private invertOperation(): void {
    const previousOperation = this.config.operation;
    this.config.operation = this.config.operation === BrushOperation.ADDITIVE ? 
      BrushOperation.SUBTRACTIVE : BrushOperation.ADDITIVE;
    
    if (this.onOperationChange) {
      this.onOperationChange(this.config.operation);
    }
  }
  
  private resetOperation(): void {
    // Reset to smart mode or default operation
    if (this.mousePosition && this.targetStructure) {
      this.updateSmartBrushMode(this.mousePosition);
    }
  }
  
  private throttledRender(): void {
    const now = Date.now();
    if (now - this.lastRenderTime >= this.renderThrottle) {
      this.renderPreview();
      this.lastRenderTime = now;
    }
  }
  
  private renderPreview(): void {
    if (!this.previewContext || !this.mousePosition || this.isDrawing) return;
    
    // Clear previous preview
    this.clearPreview();
    
    const radius = this.config.brushSize / 2;
    const color = this.config.operation === BrushOperation.ADDITIVE ? '#00ff00' : '#ff0000';
    
    this.previewContext.save();
    this.previewContext.strokeStyle = color;
    this.previewContext.lineWidth = 2;
    this.previewContext.setLineDash([4, 4]);
    
    // Draw brush circle
    this.previewContext.beginPath();
    this.previewContext.arc(this.mousePosition.x, this.mousePosition.y, radius, 0, 2 * Math.PI);
    this.previewContext.stroke();
    
    // Draw operation indicator
    this.renderOperationIndicator(this.previewContext, this.mousePosition);
    
    this.previewContext.restore();
    
    if (this.onPreviewUpdate) {
      this.onPreviewUpdate(this.mousePosition, this.config.brushSize, this.config.operation);
    }
  }
  
  private renderOperationIndicator(context: CanvasRenderingContext2D, position: Point): void {
    const size = 8;
    const color = this.config.operation === BrushOperation.ADDITIVE ? '#00ff00' : '#ff0000';
    
    context.strokeStyle = color;
    context.lineWidth = 3;
    context.setLineDash([]);
    
    context.beginPath();
    
    if (this.config.operation === BrushOperation.ADDITIVE) {
      // Draw cross for additive
      context.moveTo(position.x - size, position.y);
      context.lineTo(position.x + size, position.y);
      context.moveTo(position.x, position.y - size);
      context.lineTo(position.x, position.y + size);
    } else {
      // Draw minus sign for subtractive
      context.moveTo(position.x - size, position.y);
      context.lineTo(position.x + size, position.y);
    }
    
    context.stroke();
  }
  
  private clearPreview(): void {
    if (this.previewContext && this.previewCanvas) {
      this.previewContext.clearRect(0, 0, this.previewCanvas.width, this.previewCanvas.height);
    }
  }
  
  // Configuration methods
  setBrushSize(size: number): void {
    this.config.brushSize = Math.max(1, Math.min(100, size));
  }
  
  getBrushSize(): number {
    return this.config.brushSize;
  }
  
  setOperation(operation: BrushOperation): void {
    this.config.operation = operation;
  }
  
  getOperation(): BrushOperation {
    return this.config.operation;
  }
  
  setActiveStrategy(strategy: 'FILL_INSIDE_CIRCLE' | 'FILL_INSIDE_SPHERE'): void {
    this.config.activeStrategy = strategy;
  }
  
  setTargetStructure(structure: RTStructure | null): void {
    this.targetStructure = structure;
  }
  
  getTargetStructure(): RTStructure | null {
    return this.targetStructure;
  }
  
  setCurrentSliceIndex(index: number): void {
    this.currentSliceIndex = index;
  }
  
  getCurrentSliceIndex(): number {
    return this.currentSliceIndex;
  }
  
  // Undo/Redo functionality
  undo(): BrushStroke | null {
    const lastStroke = this.strokeHistory.pop();
    if (lastStroke) {
      this.redoHistory.push(lastStroke);
      return lastStroke;
    }
    return null;
  }
  
  redo(): BrushStroke | null {
    const redoStroke = this.redoHistory.pop();
    if (redoStroke) {
      this.strokeHistory.push(redoStroke);
      return redoStroke;
    }
    return null;
  }
  
  canUndo(): boolean {
    return this.strokeHistory.length > 0;
  }
  
  canRedo(): boolean {
    return this.redoHistory.length > 0;
  }
  
  // Event callbacks
  setOnStrokeComplete(callback: (stroke: BrushStroke) => void): void {
    this.onStrokeComplete = callback;
  }
  
  setOnPreviewUpdate(callback: (position: Point, size: number, operation: BrushOperation) => void): void {
    this.onPreviewUpdate = callback;
  }
  
  setOnOperationChange(callback: (operation: BrushOperation) => void): void {
    this.onOperationChange = callback;
  }
  
  // Utility methods
  getCurrentConfiguration(): BrushToolConfiguration {
    return { ...this.config };
  }
  
  updateConfiguration(updates: Partial<BrushToolConfiguration>): void {
    this.config = { ...this.config, ...updates };
  }
  
  getStrokeHistory(): BrushStroke[] {
    return [...this.strokeHistory];
  }
  
  clearHistory(): void {
    this.strokeHistory = [];
    this.redoHistory = [];
  }
  
  // Cleanup
  destroy(): void {
    if (this.canvas) {
      this.canvas.removeEventListener('mousedown', this.handleMouseDown);
      this.canvas.removeEventListener('mousemove', this.handleMouseMove);
      this.canvas.removeEventListener('mouseup', this.handleMouseUp);
      this.canvas.removeEventListener('mouseleave', this.handleMouseLeave);
    }
    
    document.removeEventListener('keydown', this.handleKeyDown);
    document.removeEventListener('keyup', this.handleKeyUp);
    
    this.canvas = null;
    this.context = null;
    this.previewCanvas = null;
    this.previewContext = null;
  }
}