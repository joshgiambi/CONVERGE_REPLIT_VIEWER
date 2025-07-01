// OHIF-style Brush Tool Implementation
// Using Cornerstone 3D tools for medical-grade segmentation

import { 
  Point, 
  BrushOperation
} from '@shared/schema';

// RT Structure interface based on server implementation
export interface RTStructure {
  roiNumber: number;
  structureName: string;
  color: [number, number, number];
  contours?: Record<number, Point[][]>; // slice position -> array of contour polygons
}

export interface BrushStroke {
  points: Point[];
  operation: BrushOperation;
  brushSize: number;
  timestamp: number;
}

export interface BrushToolOptions {
  brushSize: number;
  operation: BrushOperation;
  previewEnabled: boolean;
}

export class OHIFStyleBrushTool {
  private canvas: HTMLCanvasElement | null = null;
  private context: CanvasRenderingContext2D | null = null;
  private isDrawing = false;
  private currentStroke: Point[] = [];
  private brushSize = 20;
  private operation = BrushOperation.ADDITIVE;
  private previewEnabled = true;
  private lastPosition: Point | null = null;
  private strokeHistory: BrushStroke[] = [];
  private redoHistory: BrushStroke[] = [];
  
  // Mouse position for preview cursor
  private mousePosition: Point | null = null;
  
  // Target structure for editing
  private targetStructure: RTStructure | null = null;
  
  // Callbacks
  private onStrokeComplete?: (stroke: BrushStroke) => void;
  private onPreviewUpdate?: (position: Point, size: number) => void;

  constructor(options: Partial<BrushToolOptions> = {}) {
    this.brushSize = options.brushSize ?? 20;
    this.operation = options.operation ?? BrushOperation.ADDITIVE;
    this.previewEnabled = options.previewEnabled ?? true;
  }

  // Initialize with canvas
  initialize(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d');
    this.setupEventListeners();
  }

  // Setup mouse event listeners
  private setupEventListeners() {
    if (!this.canvas) return;

    this.canvas.addEventListener('mousedown', this.handleMouseDown.bind(this));
    this.canvas.addEventListener('mousemove', this.handleMouseMove.bind(this));
    this.canvas.addEventListener('mouseup', this.handleMouseUp.bind(this));
    this.canvas.addEventListener('mouseleave', this.handleMouseLeave.bind(this));
    
    // Prevent context menu
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // Mouse event handlers
  private handleMouseDown(event: MouseEvent) {
    if (event.button !== 0) return; // Only left click
    
    const point = this.getCanvasCoordinates(event);
    this.startStroke(point);
  }

  private handleMouseMove(event: MouseEvent) {
    const point = this.getCanvasCoordinates(event);
    this.mousePosition = point;
    
    if (this.isDrawing) {
      this.continueStroke(point);
    }
    
    if (this.previewEnabled) {
      this.updatePreview(point);
    }
  }

  private handleMouseUp(event: MouseEvent) {
    if (event.button !== 0) return;
    
    this.endStroke();
  }

  private handleMouseLeave() {
    this.endStroke();
    this.mousePosition = null;
    this.clearPreview();
  }

  // Get canvas coordinates from mouse event
  private getCanvasCoordinates(event: MouseEvent): Point {
    if (!this.canvas) return { x: 0, y: 0 };
    
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
  }

  // Start a new brush stroke
  private startStroke(point: Point) {
    this.isDrawing = true;
    this.currentStroke = [point];
    this.lastPosition = point;
    
    // Add brush stamp at starting point
    this.addBrushStamp(point);
    
    // Clear redo history on new stroke
    this.redoHistory = [];
  }

  // Continue current stroke
  private continueStroke(point: Point) {
    if (!this.isDrawing || !this.lastPosition) return;
    
    // Add intermediate points for smooth stroke
    const intermediatePoints = this.interpolatePoints(this.lastPosition, point);
    
    for (const intermediatePoint of intermediatePoints) {
      this.currentStroke.push(intermediatePoint);
      this.addBrushStamp(intermediatePoint);
    }
    
    this.lastPosition = point;
  }

  // End current stroke
  private endStroke() {
    if (!this.isDrawing) return;
    
    this.isDrawing = false;
    
    if (this.currentStroke.length > 0) {
      const stroke: BrushStroke = {
        points: [...this.currentStroke],
        operation: this.operation,
        brushSize: this.brushSize,
        timestamp: Date.now()
      };
      
      this.strokeHistory.push(stroke);
      
      if (this.onStrokeComplete) {
        this.onStrokeComplete(stroke);
      }
    }
    
    this.currentStroke = [];
    this.lastPosition = null;
  }

  // Add brush stamp at specific point
  private addBrushStamp(point: Point) {
    if (!this.context) return;
    
    const radius = this.brushSize / 2;
    
    // Use different colors for add/subtract operations
    const color = this.operation === BrushOperation.ADDITIVE ? 
      'rgba(0, 255, 0, 0.3)' : 'rgba(255, 0, 0, 0.3)';
    
    this.context.save();
    this.context.globalCompositeOperation = 
      this.operation === BrushOperation.ADDITIVE ? 'source-over' : 'destination-out';
    
    this.context.fillStyle = color;
    this.context.beginPath();
    this.context.arc(point.x, point.y, radius, 0, 2 * Math.PI);
    this.context.fill();
    this.context.restore();
  }

  // Interpolate points between two positions for smooth strokes
  private interpolatePoints(start: Point, end: Point): Point[] {
    const distance = Math.sqrt(
      Math.pow(end.x - start.x, 2) + Math.pow(end.y - start.y, 2)
    );
    
    // Number of steps based on brush size for smooth coverage
    const steps = Math.max(1, Math.floor(distance / (this.brushSize * 0.25)));
    const points: Point[] = [];
    
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      points.push({
        x: start.x + (end.x - start.x) * t,
        y: start.y + (end.y - start.y) * t
      });
    }
    
    return points;
  }

  // Update preview cursor
  private updatePreview(point: Point) {
    if (this.onPreviewUpdate) {
      this.onPreviewUpdate(point, this.brushSize);
    }
  }

  // Clear preview cursor
  private clearPreview() {
    // Implementation depends on how preview is rendered
  }

  // Render preview cursor
  renderPreview() {
    if (!this.context || !this.mousePosition || this.isDrawing) return;
    
    const radius = this.brushSize / 2;
    const color = this.operation === BrushOperation.ADDITIVE ? 
      '#00ff00' : '#ff0000';
    
    this.context.save();
    this.context.strokeStyle = color;
    this.context.lineWidth = 2;
    this.context.setLineDash([4, 4]);
    
    this.context.beginPath();
    this.context.arc(this.mousePosition.x, this.mousePosition.y, radius, 0, 2 * Math.PI);
    this.context.stroke();
    
    this.context.restore();
  }

  // Configuration methods
  setBrushSize(size: number) {
    this.brushSize = Math.max(1, Math.min(100, size));
  }

  getBrushSize(): number {
    return this.brushSize;
  }

  setOperation(operation: BrushOperation) {
    this.operation = operation;
  }

  getOperation(): BrushOperation {
    return this.operation;
  }

  setTargetStructure(structure: RTStructure | null) {
    this.targetStructure = structure;
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
    const lastRedo = this.redoHistory.pop();
    if (lastRedo) {
      this.strokeHistory.push(lastRedo);
      return lastRedo;
    }
    return null;
  }

  canUndo(): boolean {
    return this.strokeHistory.length > 0;
  }

  canRedo(): boolean {
    return this.redoHistory.length > 0;
  }

  // Event handlers
  setOnStrokeComplete(callback: (stroke: BrushStroke) => void) {
    this.onStrokeComplete = callback;
  }

  setOnPreviewUpdate(callback: (position: Point, size: number) => void) {
    this.onPreviewUpdate = callback;
  }

  // Smart brush mode - automatically detect add/subtract based on existing contours
  enableSmartMode(existingContours: Point[][]) {
    // Implementation for smart mode detection
    // This would analyze if the current brush position intersects with existing contours
  }

  // Cleanup
  destroy() {
    if (this.canvas) {
      this.canvas.removeEventListener('mousedown', this.handleMouseDown);
      this.canvas.removeEventListener('mousemove', this.handleMouseMove);
      this.canvas.removeEventListener('mouseup', this.handleMouseUp);
      this.canvas.removeEventListener('mouseleave', this.handleMouseLeave);
    }
    
    this.canvas = null;
    this.context = null;
  }
}