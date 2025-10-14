/**
 * Core Viewer Type Definitions
 * 
 * Shared interfaces for viewer components, hooks, and services.
 * All agents must use these types as contracts.
 * 
 * Created: Hour 0 - Interface Definition Phase
 */

// ============================================================================
// DICOM Image Types
// ============================================================================

export interface DICOMImage {
  id: number;
  sopInstanceUID: string;
  instanceNumber: number | null;
  imagePositionPatient: [number, number, number] | null;
  sliceLocation: number | null;
  columns: number;
  rows: number;
  pixelData?: ArrayBuffer | Uint8Array | Int16Array;
  windowCenter?: number;
  windowWidth?: number;
  rescaleSlope?: number;
  rescaleIntercept?: number;
  bitsAllocated?: number;
  bitsStored?: number;
  pixelRepresentation?: number;
  photometricInterpretation?: string;
  metadata?: Record<string, any>;
}

export interface DICOMSeries {
  id: number;
  seriesInstanceUID: string;
  seriesDescription: string | null;
  modality: string;
  seriesNumber: number | null;
  imageCount: number;
  studyId: number;
  frameOfReferenceUID: string | null;
  images?: DICOMImage[];
}

export interface DICOMStudy {
  id: number;
  studyInstanceUID: string;
  studyDescription: string | null;
  studyDate: string | null;
  patientId: number;
}

// ============================================================================
// Window/Level Types
// ============================================================================

export interface WindowLevel {
  window: number;
  level: number;
}

export const WINDOW_LEVEL_PRESETS = {
  abdomen: { window: 350, level: 40 },
  lung: { window: 1500, level: -600 },
  brain: { window: 80, level: 40 },
  bone: { window: 2000, level: 400 },
  mediastinum: { window: 350, level: 50 },
} as const;

// ============================================================================
// Viewport Types
// ============================================================================

export type ViewportOrientation = 'axial' | 'sagittal' | 'coronal';

export type ToolMode = 'pan' | 'crosshairs' | 'measure' | 'zoom' | 'windowing';

export interface ViewportTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
  rotation: number;
  flipH: boolean;
  flipV: boolean;
}

export interface ViewportState {
  zoom: number;
  panX: number;
  panY: number;
  rotation: number;
  flipH: boolean;
  flipV: boolean;
  windowLevel: WindowLevel;
  currentIndex: number;
  crosshairPos: { x: number; y: number };
  crosshairMode: boolean;
  isPanMode: boolean;
  activeTool: ToolMode;
}

// ============================================================================
// Canvas Rendering Types
// ============================================================================

export interface CanvasRenderContext {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  imageWidth: number;
  imageHeight: number;
  transform: ViewportTransform;
}

export interface RenderOptions {
  showCrosshairs?: boolean;
  showAnnotations?: boolean;
  showMeasurements?: boolean;
  showRTStructures?: boolean;
  showFusionOverlay?: boolean;
}

// ============================================================================
// Image Cache Types
// ============================================================================

export interface CachedImage {
  image: DICOMImage;
  pixelData: ArrayBuffer | Uint8Array | Int16Array;
  metadata: ImageMetadata;
  timestamp: number;
}

export interface ImageMetadata {
  columns: number;
  rows: number;
  pixelSpacing: [number, number];
  sliceThickness: number;
  imageOrientation: number[];
  imagePositionPatient: [number, number, number];
  rescaleSlope: number;
  rescaleIntercept: number;
  windowCenter: number;
  windowWidth: number;
  bitsAllocated: number;
  bitsStored: number;
  pixelRepresentation: number;
  photometricInterpretation: string;
  frameOfReferenceUID: string | null;
  sopInstanceUID: string;
  instanceNumber: number | null;
}

// ============================================================================
// Mouse/Keyboard Interaction Types
// ============================================================================

export interface MouseInteractionState {
  isMouseDown: boolean;
  lastMouseX: number;
  lastMouseY: number;
  dragStartX: number;
  dragStartY: number;
  activeTool: ToolMode;
}

export interface ViewportInteractionHandlers {
  onMouseDown: (event: React.MouseEvent<HTMLCanvasElement>) => void;
  onMouseMove: (event: React.MouseEvent<HTMLCanvasElement>) => void;
  onMouseUp: (event: React.MouseEvent<HTMLCanvasElement>) => void;
  onWheel: (event: React.WheelEvent<HTMLCanvasElement>) => void;
  onKeyDown?: (event: React.KeyboardEvent) => void;
}

// ============================================================================
// Viewport Control Types
// ============================================================================

export interface ViewportControls {
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  pan: (dx: number, dy: number) => void;
  rotate: (degrees: number) => void;
  flip: (horizontal: boolean) => void;
  setWindowLevel: (wl: WindowLevel) => void;
  setTool: (tool: ToolMode) => void;
  nextSlice: () => void;
  previousSlice: () => void;
  goToSlice: (index: number) => void;
}

// ============================================================================
// Series Selection Types
// ============================================================================

export interface SeriesFilterCriteria {
  hideResampled?: boolean;
  hideDerived?: boolean;
  hideSecondary?: boolean;
  modalities?: string[];
}

export interface VisibleSeries {
  visible: DICOMSeries[];
  hidden: DICOMSeries[];
  other: DICOMSeries[];
}

// ============================================================================
// Volume Processing Types
// ============================================================================

export interface Volume {
  data: Float32Array | Uint16Array | Int16Array;
  dimensions: [number, number, number];
  spacing: [number, number, number];
  origin: [number, number, number];
  orientation: number[];
}

export interface VolumeSlice {
  data: Float32Array | Uint16Array;
  width: number;
  height: number;
  spacing: [number, number];
  position: number;
  orientation: ViewportOrientation;
}

// ============================================================================
// Component Props Types
// ============================================================================

export interface PrimaryViewportProps {
  seriesId: number;
  studyId?: number;
  orientation?: ViewportOrientation;
  windowLevel?: WindowLevel;
  onWindowLevelChange?: (wl: WindowLevel) => void;
  onSliceChange?: (index: number) => void;
  onImageMetadataChange?: (metadata: ImageMetadata) => void;
  autoZoomLevel?: number;
  autoLocalizeTarget?: { x: number; y: number; z: number };
  imageCache?: React.MutableRefObject<Map<string, CachedImage>>;
  children?: React.ReactNode;
}

export interface ViewportControlsProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  onPan: () => void;
  onMeasure: () => void;
  onCrosshairs: () => void;
  onRotate?: () => void;
  onFlip?: () => void;
  isPanActive?: boolean;
  isCrosshairsActive?: boolean;
  isMeasureActive?: boolean;
  className?: string;
}

export interface ViewerShellProps {
  sidebar?: React.ReactNode;
  viewport: React.ReactNode;
  toolbar?: React.ReactNode;
  panels?: React.ReactNode;
  children?: React.ReactNode;
}

// ============================================================================
// Hook Return Types
// ============================================================================

export interface UseDICOMImagesResult {
  images: DICOMImage[];
  isLoading: boolean;
  error: Error | null;
  currentImage: DICOMImage | null;
  currentIndex: number;
  setCurrentIndex: (index: number) => void;
  metadata: ImageMetadata | null;
}

export interface UseSeriesDataResult {
  series: DICOMSeries[];
  visibleSeries: DICOMSeries[];
  isLoading: boolean;
  error: Error | null;
  selectedSeries: DICOMSeries | null;
  selectSeries: (series: DICOMSeries) => void;
}

export interface UseViewportInteractionsResult {
  handlers: ViewportInteractionHandlers;
  state: MouseInteractionState;
  viewportState: ViewportState;
  controls: ViewportControls;
}

export interface UseViewportToolsResult {
  activeTool: ToolMode;
  setActiveTool: (tool: ToolMode) => void;
  isPanMode: boolean;
  isCrosshairMode: boolean;
  isMeasureMode: boolean;
  setMode: (mode: 'pan' | 'crosshairs' | 'measure') => void;
}

// ============================================================================
// Service Types
// ============================================================================

export interface DICOMMetadataService {
  parseImagePosition: (image: DICOMImage) => [number, number, number] | null;
  extractMetadata: (image: DICOMImage) => ImageMetadata;
  getSliceZ: (image: DICOMImage) => number | null;
  getSpacing: (images: DICOMImage[]) => [number, number, number] | null;
  getRescaleParams: (image: DICOMImage) => { slope: number; intercept: number };
  sameSlice: (pos1: [number, number, number], pos2: [number, number, number], tolerance?: number) => boolean;
}

export interface SeriesFilterService {
  shouldHideSeries: (series: DICOMSeries, criteria: SeriesFilterCriteria) => boolean;
  filterVisibleSeries: (series: DICOMSeries[], criteria: SeriesFilterCriteria) => VisibleSeries;
  isDerived: (series: DICOMSeries) => boolean;
  isResampled: (series: DICOMSeries) => boolean;
}

export interface VolumeService {
  buildVolume: (images: DICOMImage[]) => Promise<Volume>;
  extractSlice: (volume: Volume, orientation: ViewportOrientation, position: number) => VolumeSlice;
  resampleSlice: (slice: VolumeSlice, targetDimensions: [number, number]) => VolumeSlice;
}

// ============================================================================
// Error Types
// ============================================================================

export interface ViewerError {
  code: string;
  message: string;
  details?: any;
  recoverable: boolean;
}

export class DICOMLoadError extends Error {
  code = 'DICOM_LOAD_ERROR';
  recoverable = true;
  
  constructor(message: string, public details?: any) {
    super(message);
    this.name = 'DICOMLoadError';
  }
}

export class RenderError extends Error {
  code = 'RENDER_ERROR';
  recoverable = true;
  
  constructor(message: string, public details?: any) {
    super(message);
    this.name = 'RenderError';
  }
}

