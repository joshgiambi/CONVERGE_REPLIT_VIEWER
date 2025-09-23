import { useState, useRef, useCallback } from 'react';
import { WindowLevel, WINDOW_LEVEL_PRESETS } from '@/lib/dicom-utils';

export interface UseViewerStateReturn {
  // Window/level settings
  windowLevel: WindowLevel;
  setWindowLevel: (level: WindowLevel) => void;

  // Tool mode
  activeToolMode: 'pan' | 'crosshairs' | 'measure';
  setActiveToolMode: (mode: 'pan' | 'crosshairs' | 'measure') => void;

  // Image cache
  imageCache: React.MutableRefObject<Map<string, { images: any[], metadata: any }>>;

  // Slice position
  currentSlicePosition: number;
  setCurrentSlicePosition: (position: number) => void;

  // Auto zoom and localization
  autoZoomLevel: number | undefined;
  setAutoZoomLevel: (level: number | undefined) => void;
  autoLocalizeTarget: { x: number; y: number; z: number } | undefined;
  setAutoLocalizeTarget: (target: { x: number; y: number; z: number } | undefined) => void;

  // Image metadata
  imageMetadata: any;
  setImageMetadata: (metadata: any) => void;

  // Error state
  error: any;
  setError: (error: any) => void;

  // Toolbar visibility states
  showBooleanOperations: boolean;
  setShowBooleanOperations: (show: boolean) => void;
  showMarginToolbar: boolean;
  setShowMarginToolbar: (show: boolean) => void;
  showLocalizationTool: boolean;
  setShowLocalizationTool: (show: boolean) => void;

  // Preview state
  previewStructureInfo: { targetName: string; isNewStructure: boolean } | null;
  setPreviewStructureInfo: (info: { targetName: string; isNewStructure: boolean } | null) => void;
  highlightedStructures: { inputs: string[]; output: string };
  setHighlightedStructures: (structures: { inputs: string[]; output: string }) => void;

  // MPR and history
  mprVisible: boolean;
  setMprVisible: (visible: boolean) => void;
  historyOpen: boolean;
  setHistoryOpen: (open: boolean) => void;

  // Refs
  workingViewerRef: React.MutableRefObject<any>;

  // Utility functions
  resetViewerState: () => void;
  updateError: (error: any) => void;
  clearError: () => void;
}

export function useViewerState(): UseViewerStateReturn {
  const [windowLevel, setWindowLevel] = useState<WindowLevel>(WINDOW_LEVEL_PRESETS.abdomen);
  const [activeToolMode, setActiveToolMode] = useState<'pan' | 'crosshairs' | 'measure'>('pan');
  const imageCache = useRef<Map<string, { images: any[], metadata: any }>>(new Map());
  const [currentSlicePosition, setCurrentSlicePosition] = useState<number>(0);
  const [autoZoomLevel, setAutoZoomLevel] = useState<number | undefined>(undefined);
  const [autoLocalizeTarget, setAutoLocalizeTarget] = useState<{ x: number; y: number; z: number } | undefined>(undefined);
  const [imageMetadata, setImageMetadata] = useState<any>(null);
  const [error, setError] = useState<any>(null);
  const [showBooleanOperations, setShowBooleanOperations] = useState(false);
  const [showMarginToolbar, setShowMarginToolbar] = useState(false);
  const [showLocalizationTool, setShowLocalizationTool] = useState(true);
  const [previewStructureInfo, setPreviewStructureInfo] = useState<{ targetName: string; isNewStructure: boolean } | null>(null);
  const [highlightedStructures, setHighlightedStructures] = useState<{ inputs: string[]; output: string }>({ inputs: [], output: '' });
  const [mprVisible, setMprVisible] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const workingViewerRef = useRef<any>(null);

  const resetViewerState = useCallback(() => {
    setWindowLevel(WINDOW_LEVEL_PRESETS.abdomen);
    setActiveToolMode('pan');
    imageCache.current.clear();
    setCurrentSlicePosition(0);
    setAutoZoomLevel(undefined);
    setAutoLocalizeTarget(undefined);
    setImageMetadata(null);
    setError(null);
    setShowBooleanOperations(false);
    setShowMarginToolbar(false);
    setShowLocalizationTool(true);
    setPreviewStructureInfo(null);
    setHighlightedStructures({ inputs: [], output: '' });
    setMprVisible(false);
    setHistoryOpen(false);
  }, []);

  const updateError = useCallback((newError: any) => {
    setError(newError);
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    windowLevel,
    setWindowLevel,
    activeToolMode,
    setActiveToolMode,
    imageCache,
    currentSlicePosition,
    setCurrentSlicePosition,
    autoZoomLevel,
    setAutoZoomLevel,
    autoLocalizeTarget,
    setAutoLocalizeTarget,
    imageMetadata,
    setImageMetadata,
    error,
    setError,
    showBooleanOperations,
    setShowBooleanOperations,
    showMarginToolbar,
    setShowMarginToolbar,
    showLocalizationTool,
    setShowLocalizationTool,
    previewStructureInfo,
    setPreviewStructureInfo,
    highlightedStructures,
    setHighlightedStructures,
    mprVisible,
    setMprVisible,
    historyOpen,
    setHistoryOpen,
    workingViewerRef,
    resetViewerState,
    updateError,
    clearError,
  };
}