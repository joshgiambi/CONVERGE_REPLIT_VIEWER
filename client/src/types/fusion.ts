/**
 * Fusion Type Definitions
 * 
 * Types for PET/CT fusion, registration, and overlay rendering.
 * All agents working on fusion must use these types.
 * 
 * Created: Hour 0 - Interface Definition Phase
 */

import type { DICOMImage, DICOMSeries, WindowLevel } from './viewer';

// ============================================================================
// Registration Types (imported from existing types/fusion)
// ============================================================================

export interface RegistrationSeriesDetail {
  id: number | null;
  uid: string | null;
  description: string | null;
  modality: string | null;
  studyId: number | null;
  imageCount: number | null;
}

export interface RegistrationTransformCandidate {
  id: string | null;
  matrix: number[];
  regFile: string | null;
  sourceFoR?: string | null;
  targetFoR?: string | null;
  sourceSeriesUID?: string | null;
  targetSeriesUID?: string | null;
}

export type RegistrationRelationship = 'registered' | 'shared-frame' | 'frame-of-reference';

export interface RegistrationAssociation {
  targetSeriesId: number;
  targetSeriesDetail: RegistrationSeriesDetail | null;
  sourcesSeriesIds: number[];
  sourceSeriesDetails: RegistrationSeriesDetail[];
  siblingSeriesIds?: number[];
  relationship: RegistrationRelationship;
  regFile: string | null;
  transformCandidates?: RegistrationTransformCandidate[];
}

// ============================================================================
// Registration Option Types
// ============================================================================

export interface RegistrationOption {
  id: string | null;
  label: string;
  relationship: RegistrationRelationship;
  regFile: string | null;
  matrix: number[] | null;
  association: RegistrationAssociation;
  candidate: RegistrationTransformCandidate | null;
  sourceDetail: RegistrationSeriesDetail | null;
  targetDetail: RegistrationSeriesDetail | null;
}

// ============================================================================
// Fusion Manifest Types
// ============================================================================

export interface FusionManifest {
  primarySeriesId: number;
  secondaries: FusionSecondaryDescriptor[];
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  timestamp: number;
}

export interface FusionSecondaryDescriptor {
  secondarySeriesId: number;
  secondaryModality: string;
  status: 'idle' | 'pending' | 'generating' | 'ready' | 'error';
  error: string | null;
  volumePath?: string | null;
  manifestPath?: string | null;
  registrationId?: string | null;
  // Optional fields (present when available from manifest)
  windowCenter?: number[];
  windowWidth?: number[];
  secondarySeriesDescription?: string | null;
  sliceCount?: number;
}

export interface FusionSecondaryState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  progress: number;
  error: string | null;
}

// ============================================================================
// Fusion Candidate Types
// ============================================================================

export interface FusionCandidate {
  seriesId: number;
  series: DICOMSeries;
  modality: string;
  relationship: RegistrationRelationship;
  hasRegistration: boolean;
  isSharedFoR: boolean;
}

export interface FusionCandidateMap {
  primarySeriesId: number;
  candidates: FusionCandidate[];
  byModality: Map<string, FusionCandidate[]>;
}

export interface FusionSiblingInfo {
  petSeriesIds: number[];
  mrSeriesIds: number[];
  ctSeriesIds: number[];
}

// ============================================================================
// Overlay Rendering Types
// ============================================================================

export interface OverlayCanvas {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  hasSignal: boolean;
  registrationId?: string | null;
  transformSource?: string | null;
  metadata?: {
    secondaryModality: string;
    sliceIndex: number;
    transformSource: string | null;
  };
}

export interface FusionSlice {
  width: number;
  height: number;
  pixelData: Float32Array | Uint16Array;
  sliceIndex: number;
  secondaryModality: string;
  transformSource: string | null;
  hasSignal: boolean;
  sopInstanceUID?: string;
  position?: [number, number, number];
}

export interface FusionOverlayRequest {
  sopInstanceUID: string;
  sliceIndex: number;
  instanceNumber: number | null;
  position: [number, number, number] | null;
}

// ============================================================================
// Fusion State Types
// ============================================================================

export interface FusionState {
  primarySeriesId: number | null;
  selectedSecondaryId: number | null;
  opacity: number;
  windowLevel: WindowLevel | null;
  manifest: FusionManifest | null;
  manifestStatus: 'idle' | 'loading' | 'refreshing' | 'ready' | 'error';
  manifestError: string | null;
  secondaries: FusionSecondaryDescriptor[];
  secondaryStateMap: Map<number, FusionSecondaryState>;
  currentlyLoadingSecondary: number | null;
  showFusionPanel: boolean;
}

// ============================================================================
// Fusion Cache Types
// ============================================================================

export interface CachedOverlay {
  canvas: HTMLCanvasElement;
  slice: FusionSlice;
  timestamp: number;
  hasSignal: boolean;
}

export interface FusionCacheKey {
  sopInstanceUID: string;
  secondarySeriesId: number;
  registrationId: string | null;
}

// ============================================================================
// Component Props
// ============================================================================

// DEPRECATED: FusionOverlayLayer now reads from viewport context (no props contract)

export interface FusionPanelProps {
  opacity: number;
  onOpacityChange: (opacity: number) => void;
  secondaryOptions: FusionSecondaryDescriptor[];
  selectedSecondaryId: number | null;
  onSecondarySeriesSelect: (id: number | null) => void;
  secondaryStatuses: Map<number, FusionSecondaryState>;
  manifestLoading: boolean;
  manifestError: string | null;
  minimized?: boolean;
  onToggleMinimized?: (minimized: boolean) => void;
  windowLevel: WindowLevel | null;
  onWindowLevelPreset?: (wl: WindowLevel) => void;
}

// ============================================================================
// Hook Return Types
// ============================================================================

export interface UseFusionResult {
  // State
  manifest: FusionManifest | null;
  manifestStatus: 'idle' | 'loading' | 'refreshing' | 'ready' | 'error';
  manifestError: string | null;
  secondaries: FusionSecondaryDescriptor[];
  selectedSecondaryId: number | null;
  opacity: number;
  fusionWindowLevel: WindowLevel | null;
  showFusionPanel: boolean;
  secondaryStateMap: Map<number, FusionSecondaryState>;
  currentlyLoadingSecondary: number | null;
  
  // Actions
  setSelectedSecondaryId: (id: number | null) => void;
  setOpacity: (opacity: number) => void;
  setFusionWindowLevel: (wl: WindowLevel) => void;
  refreshManifest: () => Promise<void>;
  
  // Overlay fetching
  getOverlayForImage: (request: FusionOverlayRequest) => Promise<OverlayCanvas | null>;
}

export interface UseFusionCandidatesResult {
  candidates: FusionCandidate[];
  candidatesByModality: Map<string, FusionCandidate[]>;
  isLoading: boolean;
  error: Error | null;
  getCandidatesForPrimary: (primaryId: number) => FusionCandidate[];
  getSiblingInfo: (secondaryId: number) => FusionSiblingInfo | null;
}

export interface UseRegistrationOptionsResult {
  options: RegistrationOption[];
  selectedOption: RegistrationOption | null;
  selectOption: (optionId: string | null) => void;
  isLoading: boolean;
  error: Error | null;
}

export interface UseFusionPanelStateResult {
  opacity: number;
  setOpacity: (opacity: number) => void;
  secondaries: FusionSecondaryDescriptor[];
  selectedSecondaryId: number | null;
  setSelectedSecondaryId: (id: number | null) => void;
  fusionWindowLevel: WindowLevel | null;
  setFusionWindowLevel: (wl: WindowLevel) => void;
  manifestLoading: boolean;
  manifestError: string | null;
  secondaryStatuses: Map<number, { status: 'idle' | 'loading' | 'ready' | 'error'; error: string | null }>;
  secondaryLoadingStates: Map<number, { progress: number; isLoading: boolean }>;
  showPanel: boolean;
  currentlyLoadingSecondary: number | null;
}

export interface UseFusionDebugResult {
  manifest: FusionManifest | null;
  cache: Array<{
    key: string;
    sliceIndex: number;
    modality: string;
    dimensions: string;
    ageMs: number;
    hasSignal: boolean;
    transformSource: string | null;
  }>;
  primaryFoR: string;
  registrationMatrix: number[] | null;
  registrationId: string | null;
  transformSource: string | null;
  logs: string[];
  exportToWindow: () => void;
  clearCache: () => void;
}

// ============================================================================
// Service Types
// ============================================================================

export interface FusionOverlayManager {
  primarySeriesId: number;
  secondarySeriesId: number | null;
  secondaryModality: string;
  
  setSecondary: (secondaryId: number | null, modality: string) => void;
  getOverlay: (
    sopInstanceUID: string,
    sliceIndex: number,
    instanceNumber: number | null,
    position: [number, number, number] | null
  ) => Promise<OverlayCanvas | null>;
  clearCache: () => void;
}

// ============================================================================
// Utility Types
// ============================================================================

export interface FusionTransform {
  matrix: number[];
  source: 'registration' | 'identity' | 'frame-of-reference';
  regFile: string | null;
  sourceFoR: string | null;
  targetFoR: string | null;
}

export interface ColorMapConfig {
  name: string;
  colors: Array<[number, number, number, number]>; // RGBA
  range: [number, number];
}

export const FUSION_COLOR_MAPS: Record<string, ColorMapConfig> = {
  hot: {
    name: 'Hot',
    colors: [
      [0, 0, 0, 0],
      [255, 0, 0, 255],
      [255, 255, 0, 255],
      [255, 255, 255, 255],
    ],
    range: [0, 1],
  },
  pet: {
    name: 'PET',
    colors: [
      [0, 0, 0, 0],
      [0, 0, 255, 255],
      [0, 255, 255, 255],
      [0, 255, 0, 255],
      [255, 255, 0, 255],
      [255, 0, 0, 255],
    ],
    range: [0, 1],
  },
} as const;
