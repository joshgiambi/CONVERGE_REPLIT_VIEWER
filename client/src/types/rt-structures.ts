/**
 * RT Structure Type Definitions
 * 
 * Types for RT structure loading, rendering, and editing.
 * All agents working on RT structures must use these types.
 * 
 * Created: Hour 0 - Interface Definition Phase
 */

import type { DICOMSeries } from './viewer';

// ============================================================================
// RT Structure Data Types
// ============================================================================

export interface RTStructureSet {
  seriesId: number;
  structureSetLabel: string | null;
  structureSetDate: string | null;
  structures: RTStructure[];
  referencedSeriesId: number | null;
  referencedFrameOfReferenceUID: string | null;
}

export interface RTStructure {
  roiNumber: number;
  structureName: string;
  color: [number, number, number]; // RGB
  contours: RTContour[];
  volumeCc?: number;
  interpretedType?: string;
}

export interface RTContour {
  slicePosition: number;
  points: number[]; // Flat array: [x1, y1, z1, x2, y2, z2, ...]
  numberOfPoints: number;
  geometricType?: string;
}

// ============================================================================
// RT State Types
// ============================================================================

export interface RTState {
  rtStructures: RTStructureSet | null;
  loadedSeriesId: number | null;
  structureVisibility: Map<number, boolean>;
  selectedStructures: Set<number>;
  selectedForEdit: number | null;
  allStructuresVisible: boolean;
}

// ============================================================================
// Contour Editing Types
// ============================================================================

export type ContourEditTool = 
  | 'brush-add'
  | 'brush-erase'
  | 'brush-smart'
  | 'pen'
  | 'eclipse-planar'
  | 'grow'
  | 'shrink'
  | 'smooth'
  | 'simplify';

export interface BrushToolState {
  tool: ContourEditTool | null;
  brushSize: number;
  isActive: boolean;
  predictionEnabled?: boolean;
  smartBrushEnabled?: boolean;
}

export interface ContourEditOperation {
  action: 
    | 'add_brush_stroke'
    | 'erase_brush_stroke'
    | 'add_pen_point'
    | 'complete_pen'
    | 'cancel_pen'
    | 'grow_contour'
    | 'shrink_contour'
    | 'smooth_contour'
    | 'boolean_operation'
    | 'margin_operation'
    | 'delete_contour'
    | 'clear_preview'
    | 'preview_margin'
    | 'execute_margin'
    | 'apply_margin';
  structureId: number;
  slicePosition?: number;
  data?: any;
  parameters?: any;
}

// ============================================================================
// Boolean Operation Types
// ============================================================================

export type BooleanOperationType = 'union' | 'intersect' | 'subtract' | 'xor';

export interface BooleanOperation {
  operation: BooleanOperationType;
  sourceStructureId: number;
  targetStructureId: number;
  slicePosition?: number; // If undefined, operates on all slices
  createNewStructure?: boolean;
  newStructureName?: string;
  newStructureColor?: [number, number, number];
}

// ============================================================================
// Margin Operation Types
// ============================================================================

export type InterpolationType = 'LINEAR' | 'SMOOTH' | 'DISCRETE';

export interface MarginParameters {
  marginValues: {
    uniform?: number;
    superior?: number;
    inferior?: number;
    anterior?: number;
    posterior?: number;
    left?: number;
    right?: number;
  };
  interpolationType: InterpolationType;
  anisotropic?: boolean;
}

export interface MarginOperation {
  structureId: number;
  targetStructureId?: number;
  parameters: MarginParameters;
  isPreview?: boolean;
  slicePosition?: number;
}

// ============================================================================
// Preview Contour Types
// ============================================================================

export interface PreviewContour {
  points: number[];
  slicePosition: number;
  meta?: {
    margin?: number;
    type?: string;
    sourceStructureId?: number;
  };
}

// ============================================================================
// Contour Settings Types
// ============================================================================

export interface ContourSettings {
  width: number;
  opacity: number;
  renderMode?: 'outline' | 'fill' | 'both';
  antiAlias?: boolean;
}

// ============================================================================
// Structure Selection Types
// ============================================================================

export interface StructureSelectionInfo {
  structureId: number;
  structureName: string;
  color: string; // RGB string "rgb(r,g,b)"
  isVisible: boolean;
  isSelected: boolean;
  isEditMode: boolean;
}

// ============================================================================
// Component Props Types
// ============================================================================

export interface RTOverlayLayerProps {
  rtStructures: RTStructureSet | null;
  structureVisibility: Map<number, boolean>;
  selectedStructures: Set<number>;
  selectedForEdit: number | null;
  allStructuresVisible: boolean;
  contourSettings: ContourSettings;
  previewContours: PreviewContour[];
  canvasRef: React.RefObject<HTMLCanvasElement>;
  currentImage: any; // DICOMImage
  transform: {
    scale: number;
    offsetX: number;
    offsetY: number;
  };
  onContourClick?: (structureId: number, slicePosition: number) => void;
}

export interface RTControlPanelProps {
  rtStructures: RTStructureSet | null;
  structureVisibility: Map<number, boolean>;
  selectedStructures: Set<number>;
  selectedForEdit: number | null;
  onStructureSelect: (structureId: number, selected: boolean) => void;
  onStructureVisibilityChange: (structureId: number, visible: boolean) => void;
  onAllStructuresVisibilityChange: (visible: boolean) => void;
  onStructureEditModeChange: (structureId: number | null) => void;
  onStructureColorChange: (structureId: number, color: [number, number, number]) => void;
  onStructureDelete?: (structureId: number) => void;
  onStructureLocalize?: (structureId: number) => void;
}

export interface ContourEditToolbarProps {
  selectedStructure: RTStructure | null;
  isVisible: boolean;
  onClose: () => void;
  onToolChange: (tool: BrushToolState) => void;
  onBrushSizeChange: (size: number) => void;
  onStructureNameChange: (name: string) => void;
  onStructureColorChange: (color: string) => void;
  brushToolState: BrushToolState;
  currentSlicePosition: number;
  onContourUpdate: (operation: ContourEditOperation) => void;
}

// ============================================================================
// Hook Return Types
// ============================================================================

export interface UseRTStructuresResult {
  rtStructures: RTStructureSet | null;
  isLoading: boolean;
  error: Error | null;
  loadRTStructures: (seriesId: number) => Promise<void>;
  updateStructure: (structureId: number, updates: Partial<RTStructure>) => void;
  deleteStructure: (structureId: number) => void;
  addStructure: (structure: Omit<RTStructure, 'roiNumber'>) => void;
  saveStructures: () => Promise<void>;
  structureVisibility: Map<number, boolean>;
  setStructureVisibility: (structureId: number, visible: boolean) => void;
  selectedStructures: Set<number>;
  setSelectedStructures: (structureIds: Set<number>) => void;
  selectedForEdit: number | null;
  setSelectedForEdit: (structureId: number | null) => void;
}

export interface UseContourEditingResult {
  brushToolState: BrushToolState;
  setBrushToolState: (state: BrushToolState) => void;
  previewContours: PreviewContour[];
  setPreviewContours: (contours: PreviewContour[]) => void;
  applyEdit: (operation: ContourEditOperation) => Promise<void>;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

// ============================================================================
// Service Types
// ============================================================================

export interface ContourOperationsService {
  // Boolean operations
  combineContours: (contour1: number[], contour2: number[]) => Promise<number[][]>;
  subtractContours: (contour1: number[], contour2: number[]) => Promise<number[][]>;
  intersectContours: (contour1: number[], contour2: number[]) => Promise<number[][]>;
  xorContours: (contour1: number[], contour2: number[]) => Promise<number[][]>;
  
  // Growth/shrinking
  growContour: (contour: number[], distance: number) => number[];
  shrinkContour: (contour: number[], distance: number) => number[];
  growContourDirectional: (contour: number[], distance: number, direction: 'superior' | 'inferior' | 'anterior' | 'posterior' | 'left' | 'right') => number[];
  
  // Margin operations
  applyMargin: (structure: RTStructure, parameters: MarginParameters) => RTStructure;
  applyMarginToSlice: (contour: RTContour, parameters: MarginParameters) => RTContour;
  
  // Smoothing/simplification
  smoothContour: (contour: number[], factor: number) => number[];
  simplifyContour: (contour: number[], tolerance: number) => number[];
  
  // Analysis
  calculateVolume: (structure: RTStructure, sliceThickness: number) => number;
  calculateArea: (contour: number[]) => number;
  getBounds: (contour: number[]) => { xMin: number; xMax: number; yMin: number; yMax: number; zMin: number; zMax: number };
  getCentroid: (contour: number[]) => { x: number; y: number; z: number };
  
  // Validation
  isValidContour: (contour: number[]) => boolean;
  areContoursIntersecting: (contour1: number[], contour2: number[]) => boolean;
}

export interface RTRenderService {
  renderContour: (
    ctx: CanvasRenderingContext2D,
    contour: RTContour,
    color: [number, number, number],
    settings: ContourSettings,
    transform: { scale: number; offsetX: number; offsetY: number }
  ) => void;
  
  renderStructure: (
    ctx: CanvasRenderingContext2D,
    structure: RTStructure,
    slicePosition: number,
    settings: ContourSettings,
    transform: { scale: number; offsetX: number; offsetY: number },
    isSelected?: boolean,
    isEditMode?: boolean
  ) => void;
  
  renderPreviewContour: (
    ctx: CanvasRenderingContext2D,
    contour: PreviewContour,
    settings: ContourSettings,
    transform: { scale: number; offsetX: number; offsetY: number }
  ) => void;
}

// ============================================================================
// Undo/Redo Types
// ============================================================================

export interface UndoRedoState {
  rtStructures: RTStructureSet;
  timestamp: number;
  action: string;
  structureId: number;
}

export interface UndoRedoManager {
  saveState: (seriesId: number, action: string, structureId: number, rtStructures: RTStructureSet) => void;
  undo: () => UndoRedoState | null;
  redo: () => UndoRedoState | null;
  canUndo: () => boolean;
  canRedo: () => boolean;
  clear: () => void;
  getHistory: () => Array<{ timestamp: number; action: string; structureId: number }>;
  getCurrentIndex: () => number;
  jumpTo: (index: number) => UndoRedoState | null;
  subscribe: (callback: () => void) => () => void;
}

// ============================================================================
// Structure Localization Types
// ============================================================================

export interface StructureBounds {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  zMin: number;
  zMax: number;
  centroid: { x: number; y: number; z: number };
  widthMM: number;
  heightMM: number;
  depthMM: number;
}

// ============================================================================
// Blob Detection Types (for contour analysis)
// ============================================================================

export interface ContourBlob {
  id: number;
  volumeCc: number;
  contours: RTContour[];
  centroid: { x: number; y: number; z: number };
  bounds: StructureBounds;
}

// ============================================================================
// Error Types
// ============================================================================

export class RTLoadError extends Error {
  code = 'RT_LOAD_ERROR';
  recoverable = true;
  
  constructor(message: string, public details?: any) {
    super(message);
    this.name = 'RTLoadError';
  }
}

export class ContourOperationError extends Error {
  code = 'CONTOUR_OPERATION_ERROR';
  recoverable = true;
  
  constructor(message: string, public details?: any) {
    super(message);
    this.name = 'ContourOperationError';
  }
}

