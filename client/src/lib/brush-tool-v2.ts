// V2 Professional Brush Tool Implementation
// Medical-grade contour editing with ClipperLib-based operations

import {
  Point,
  MultiPolygon,
  BrushOperation,
  SlicingMode
} from '@shared/schema';
import { PolygonOperationsV2 } from './polygon-operations-v2';
import { ContourV2 } from './contour-v2';

// Abstract base class for all brush tools
export abstract class BrushToolV2 {
  protected brushSize: number = 30;
  protected operation: BrushOperation = BrushOperation.ADDITIVE;
  protected lastPosition: Point | undefined;
  protected isDrawing: boolean = false;
  protected targetContour: ContourV2 | undefined;
  protected currentPosition: Point | undefined;
  protected pathPoints: Point[] = [];

  constructor() {
    this.initializeBrushTool();
  }

  private initializeBrushTool(): void {
    // Ensure polygon operations are initialized
    PolygonOperationsV2.initialize().catch(error => {
      console.error('Failed to initialize brush tool polygon operations:', error);
    });
  }

  // Set brush size with medical constraints
  setBrushSize(size: number): void {
    this.brushSize = Math.max(1, Math.min(100, size));
  }

  // Get brush size
  getBrushSize(): number {
    return this.brushSize;
  }

  // Set operation mode
  setOperation(operation: BrushOperation): void {
    this.operation = operation;
  }

  // Get operation mode
  getOperation(): BrushOperation {
    return this.operation;
  }

  // Set target contour for editing
  setTargetContour(contour: ContourV2): void {
    this.targetContour = contour;
  }

  // Get target contour
  getTargetContour(): ContourV2 | undefined {
    return this.targetContour;
  }

  // Abstract methods to be implemented by concrete brush tools
  abstract onMouseDown(event: MouseEvent): void;
  abstract onMouseMove(event: MouseEvent): void;
  abstract onMouseUp(event: MouseEvent): void;
  abstract render(context: CanvasRenderingContext2D): void;

  // Create brush circle for visual feedback
  protected createBrushCircle(center: Point, radius: number, steps = 32): MultiPolygon {
    return PolygonOperationsV2.createBrushCircle(center, radius, steps);
  }

  // Create brush stroke path using proper polygon operations
  protected createBrushStrokePath(startPoint: Point, endPoint: Point, radius: number): MultiPolygon {
    return PolygonOperationsV2.createBrushStrokePath(startPoint, endPoint, radius);
  }

  // Perform boolean operation on target contour
  protected performBooleanOperation(brushPolygons: MultiPolygon): void {
    if (!this.targetContour) return;

    const currentPolygons = this.targetContour.getCurrent();
    let resultPolygons: MultiPolygon;

    if (this.operation === BrushOperation.ADDITIVE) {
      resultPolygons = PolygonOperationsV2.union(currentPolygons, brushPolygons);
    } else {
      resultPolygons = PolygonOperationsV2.difference(currentPolygons, brushPolygons);
    }

    this.targetContour.updatePolygons(resultPolygons);
  }

  // Check if point is inside target contour polygons
  protected isPointInTargetContour(point: Point): boolean {
    if (!this.targetContour) return false;
    
    const currentPolygons = this.targetContour.getCurrent();
    return PolygonOperationsV2.isPointInPolygon(point, currentPolygons);
  }

  // Get canvas coordinates from mouse event
  protected getCanvasCoordinates(event: MouseEvent): Point {
    const rect = (event.target as HTMLElement).getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
  }

  // Check if brush tool is currently active
  isActive(): boolean {
    return this.isDrawing;
  }

  // Reset brush tool state
  reset(): void {
    this.isDrawing = false;
    this.lastPosition = undefined;
    this.currentPosition = undefined;
    this.pathPoints = [];
  }
}

// Smart Brush Tool - Intelligent operation detection
export class SmartBrushToolV2 extends BrushToolV2 {
  private operationLocked: boolean = false;

  onMouseDown(event: MouseEvent): void {
    this.isDrawing = true;
    this.currentPosition = this.getCanvasCoordinates(event);
    this.lastPosition = this.currentPosition;
    this.pathPoints = [this.currentPosition];
    this.operationLocked = false;

    // Determine operation based on current position
    this.determineOperation();
  }

  onMouseMove(event: MouseEvent): void {
    if (!this.isDrawing) return;

    this.currentPosition = this.getCanvasCoordinates(event);
    this.pathPoints.push(this.currentPosition);

    // Lock operation mode during stroke for consistency
    if (!this.operationLocked) {
      this.determineOperation();
      this.operationLocked = true;
    }

    // Apply brush stroke for current segment
    if (this.lastPosition && this.currentPosition) {
      this.applyBrushStroke(this.lastPosition, this.currentPosition);
    }

    this.lastPosition = this.currentPosition;
  }

  onMouseUp(event: MouseEvent): void {
    this.isDrawing = false;
    this.operationLocked = false;
    this.lastPosition = undefined;
    this.pathPoints = [];
  }

  private determineOperation(): void {
    if (!this.currentPosition || !this.targetContour) return;

    // Check if point is inside existing contour
    const isInside = this.isPointInTargetContour(this.currentPosition);

    // Intelligent operation selection based on V2 guide:
    // - If inside contour: Additive (fills holes, expands areas)  
    // - If outside contour: Still additive by default
    // - Hold Shift to invert operation
    const shiftPressed = false; // TODO: Add shift key detection

    if (shiftPressed) {
      this.operation = isInside ? BrushOperation.SUBTRACTIVE : BrushOperation.ADDITIVE;
    } else {
      this.operation = isInside ? BrushOperation.ADDITIVE : BrushOperation.ADDITIVE;
    }
  }

  private applyBrushStroke(startPoint: Point, endPoint: Point): void {
    if (!this.targetContour) return;

    // Create brush stroke path with proper radius
    const brushStroke = this.createBrushStrokePath(startPoint, endPoint, this.brushSize / 2);
    
    if (brushStroke.length === 0) return;

    // Perform boolean operation
    this.performBooleanOperation(brushStroke);
  }

  render(context: CanvasRenderingContext2D): void {
    if (!this.currentPosition) return;

    context.save();

    // Draw brush path
    context.strokeStyle = this.operation === BrushOperation.ADDITIVE ? '#00ff00' : '#ff0000';
    context.lineWidth = this.brushSize;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.globalAlpha = 0.3;

    if (this.pathPoints.length > 1) {
      context.beginPath();
      context.moveTo(this.pathPoints[0].x, this.pathPoints[0].y);

      for (let i = 1; i < this.pathPoints.length; i++) {
        context.lineTo(this.pathPoints[i].x, this.pathPoints[i].y);
      }

      context.stroke();
    }

    // Draw current brush circle
    context.globalAlpha = 1;
    context.setLineDash([5, 5]);
    context.lineWidth = 2;

    context.beginPath();
    context.arc(this.currentPosition.x, this.currentPosition.y, this.brushSize / 2, 0, 2 * Math.PI);
    context.stroke();

    // Draw operation indicator
    this.renderOperationIndicator(context);

    context.restore();
  }

  private renderOperationIndicator(context: CanvasRenderingContext2D): void {
    if (!this.currentPosition) return;

    const size = 8;
    context.setLineDash([]);
    context.lineWidth = 3;
    context.strokeStyle = this.operation === BrushOperation.ADDITIVE ? '#00ff00' : '#ff0000';

    context.beginPath();

    if (this.operation === BrushOperation.ADDITIVE) {
      // Draw cross for additive
      context.moveTo(this.currentPosition.x - size, this.currentPosition.y);
      context.lineTo(this.currentPosition.x + size, this.currentPosition.y);
      context.moveTo(this.currentPosition.x, this.currentPosition.y - size);
      context.lineTo(this.currentPosition.x, this.currentPosition.y + size);
    } else {
      // Draw horizontal line for subtractive
      context.moveTo(this.currentPosition.x - size, this.currentPosition.y);
      context.lineTo(this.currentPosition.x + size, this.currentPosition.y);
    }

    context.stroke();
  }
}

// Manual Brush Tool - Fixed operation mode
export class ManualBrushToolV2 extends BrushToolV2 {
  onMouseDown(event: MouseEvent): void {
    this.isDrawing = true;
    this.currentPosition = this.getCanvasCoordinates(event);
    this.lastPosition = this.currentPosition;
    this.pathPoints = [this.currentPosition];
  }

  onMouseMove(event: MouseEvent): void {
    if (!this.isDrawing) return;

    this.currentPosition = this.getCanvasCoordinates(event);
    this.pathPoints.push(this.currentPosition);

    // Apply brush stroke for current segment
    if (this.lastPosition && this.currentPosition) {
      this.applyBrushStroke(this.lastPosition, this.currentPosition);
    }

    this.lastPosition = this.currentPosition;
  }

  onMouseUp(event: MouseEvent): void {
    this.isDrawing = false;
    this.lastPosition = undefined;
    this.pathPoints = [];
  }

  private applyBrushStroke(startPoint: Point, endPoint: Point): void {
    if (!this.targetContour) return;

    // Create brush stroke path
    const brushStroke = this.createBrushStrokePath(startPoint, endPoint, this.brushSize / 2);
    
    if (brushStroke.length === 0) return;

    // Perform boolean operation with fixed operation mode
    this.performBooleanOperation(brushStroke);
  }

  render(context: CanvasRenderingContext2D): void {
    if (!this.currentPosition) return;

    context.save();

    // Draw brush path
    context.strokeStyle = this.operation === BrushOperation.ADDITIVE ? '#00ff00' : '#ff0000';
    context.lineWidth = this.brushSize;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.globalAlpha = 0.3;

    if (this.pathPoints.length > 1) {
      context.beginPath();
      context.moveTo(this.pathPoints[0].x, this.pathPoints[0].y);

      for (let i = 1; i < this.pathPoints.length; i++) {
        context.lineTo(this.pathPoints[i].x, this.pathPoints[i].y);
      }

      context.stroke();
    }

    // Draw current brush circle
    context.globalAlpha = 1;
    context.setLineDash([5, 5]);
    context.lineWidth = 2;

    context.beginPath();
    context.arc(this.currentPosition.x, this.currentPosition.y, this.brushSize / 2, 0, 2 * Math.PI);
    context.stroke();

    context.restore();
  }
}

// Brush Tool Factory
export class BrushToolFactoryV2 {
  static createSmartBrush(): SmartBrushToolV2 {
    return new SmartBrushToolV2();
  }

  static createManualBrush(): ManualBrushToolV2 {
    return new ManualBrushToolV2();
  }
}