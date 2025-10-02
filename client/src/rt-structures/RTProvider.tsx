import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import type { ReactNode } from 'react';
import type { RTSelectionState, RTStructureSet } from '@/types/rt-structures';
import { createUndoRedoService, type UndoRedoService } from '@/rt-structures/services/UndoRedoService';
import { createContourOperationsService } from '@/rt-structures/services/ContourOperationsService';

export type RTStatus = 'idle' | 'loading' | 'ready' | 'error';
export type BrushMode = 'add' | 'erase';
export type PenMode = 'add' | 'cut';
export type ActiveTool = 'none' | 'brush' | 'pen' | 'erase';

interface BrushState {
  size: number; // diameter in mm
  mode: BrushMode;
  enabled: boolean;
}

interface PenState {
  mode: PenMode;
  enabled: boolean;
  points: Array<{ x: number; y: number; z: number }>; // Points for pen tool in progress
}

interface RTState {
  status: RTStatus;
  error: string | null;
  rtStructures: RTStructureSet | null;
  selection: RTSelectionState;
  previewContours: Array<{ slicePosition: number; points: number[] }>;
  previewContour: { roiNumber: number; points: number[] } | null; // Single preview for boolean/margin ops
  activeTool: ActiveTool;
  brush: BrushState;
  pen: PenState;
  busy: boolean;
}

type Action =
  | { type: 'reset' }
  | { type: 'setStructures'; payload: RTStructureSet }
  | { type: 'setStatus'; status: RTStatus }
  | { type: 'setError'; error: string | null }
  | { type: 'toggleStructureSelection'; roiNumber: number; selected: boolean }
  | { type: 'setSelectedForEdit'; roiNumber: number | null }
  | { type: 'setVisibility'; roiNumber: number; visible: boolean }
  | { type: 'setAllVisible'; visible: boolean }
  | { type: 'setPreviewContours'; contours: Array<{ slicePosition: number; points: number[] }> }
  | { type: 'setPreviewContour'; preview: { roiNumber: number; points: number[] } | null }
  | { type: 'clearPreview' }
  | { type: 'setActiveTool'; tool: ActiveTool }
  | { type: 'setBrushSize'; size: number }
  | { type: 'setBrushMode'; mode: BrushMode }
  | { type: 'setBrushEnabled'; enabled: boolean }
  | { type: 'setPenMode'; mode: PenMode }
  | { type: 'setPenEnabled'; enabled: boolean }
  | { type: 'addPenPoint'; point: { x: number; y: number; z: number } }
  | { type: 'clearPenPoints' }
  | { type: 'setBusy'; busy: boolean };

const initialState: RTState = {
  status: 'idle',
  error: null,
  rtStructures: null,
  selection: {
    selectedStructureIds: new Set<number>(),
    selectedForEdit: null,
    visibility: new Map<number, boolean>(),
    allStructuresVisible: true,
  },
  previewContours: [],
  previewContour: null,
  activeTool: 'none',
  brush: {
    size: 10, // 10mm default
    mode: 'add',
    enabled: false,
  },
  pen: {
    mode: 'add',
    enabled: false,
    points: [],
  },
  busy: false,
};

function cloneVisibility(map: Map<number, boolean>): Map<number, boolean> {
  return new Map(map.entries());
}

function reducer(state: RTState, action: Action): RTState {
  switch (action.type) {
    case 'reset':
      return initialState;
    case 'setStructures':
      return { ...state, rtStructures: action.payload, status: 'ready', error: null };
    case 'setStatus':
      return { ...state, status: action.status };
    case 'setError':
      return { ...state, error: action.error, status: action.error ? 'error' : state.status };
    case 'toggleStructureSelection': {
      const next = new Set(state.selection.selectedStructureIds);
      if (action.selected) next.add(action.roiNumber);
      else next.delete(action.roiNumber);
      return { ...state, selection: { ...state.selection, selectedStructureIds: next } };
    }
    case 'setSelectedForEdit':
      return { ...state, selection: { ...state.selection, selectedForEdit: action.roiNumber } };
    case 'setVisibility': {
      const next = cloneVisibility(state.selection.visibility);
      next.set(action.roiNumber, action.visible);
      return { ...state, selection: { ...state.selection, visibility: next } };
    }
    case 'setAllVisible':
      return { ...state, selection: { ...state.selection, allStructuresVisible: action.visible } };
    case 'setPreviewContours':
      return { ...state, previewContours: action.contours };
    case 'setPreviewContour':
      return { ...state, previewContour: action.preview };
    case 'clearPreview':
      return { ...state, previewContours: [], previewContour: null };
    case 'setActiveTool':
      return { ...state, activeTool: action.tool };
    case 'setBrushSize':
      return { ...state, brush: { ...state.brush, size: action.size } };
    case 'setBrushMode':
      return { ...state, brush: { ...state.brush, mode: action.mode } };
    case 'setBrushEnabled':
      return { ...state, brush: { ...state.brush, enabled: action.enabled } };
    case 'setPenMode':
      return { ...state, pen: { ...state.pen, mode: action.mode } };
    case 'setPenEnabled':
      return { ...state, pen: { ...state.pen, enabled: action.enabled } };
    case 'addPenPoint':
      return { ...state, pen: { ...state.pen, points: [...state.pen.points, action.point] } };
    case 'clearPenPoints':
      return { ...state, pen: { ...state.pen, points: [] } };
    case 'setBusy':
      return { ...state, busy: action.busy };
    default:
      return state;
  }
}

interface RTProviderProps {
  children: ReactNode;
  initialStructures?: RTStructureSet | null;
}

interface RTContextValue extends RTState {
  setStructures: (set: RTStructureSet) => void;
  setError: (message: string | null) => void;
  selectStructure: (roiNumber: number, selected: boolean) => void;
  setSelectedForEdit: (roiNumber: number | null) => void;
  setStructureVisibility: (roiNumber: number, visible: boolean) => void;
  setAllStructuresVisible: (visible: boolean) => void;
  undoRedo: UndoRedoService;
  saveHistory: (action: string, structureId?: number | null) => void;
  setPreviewContours: (contours: Array<{ slicePosition: number; points: number[] }>) => void;
  setPreviewContour: (preview: { roiNumber: number; points: number[] } | null) => void;
  clearPreview: () => void;
  setActiveTool: (tool: ActiveTool) => void;
  setBrushSize: (size: number) => void;
  setBrushMode: (mode: BrushMode) => void;
  setBrushEnabled: (enabled: boolean) => void;
  setPenMode: (mode: PenMode) => void;
  setPenEnabled: (enabled: boolean) => void;
  addPenPoint: (point: { x: number; y: number; z: number }) => void;
  clearPenPoints: () => void;
  completePenContour: () => Promise<void>;
  cancelPenContour: () => void;
  setBusy: (busy: boolean) => void;
  
  // Provider-level operations (call ContourOperationsService internally)
  performBooleanOp: (sourceId: number, targetId: number, op: 'union' | 'subtract' | 'intersect') => Promise<void>;
  performMarginOp: (roiId: number, marginMm: number) => Promise<void>;
  performAnisotropicMarginOp: (roiId: number, marginX: number, marginY: number, marginZ: number) => Promise<void>;
  performGrowOp: (roiId: number, distanceMm: number) => Promise<void>;
  performBrushAdd: (roiId: number, sliceZ: number, points: number[]) => Promise<void>;
  performBrushErase: (roiId: number, sliceZ: number, points: number[]) => Promise<void>;
}

const RTContext = createContext<RTContextValue | undefined>(undefined);

export function RTProvider({ children, initialStructures = null }: RTProviderProps) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const undoRedoRef = useRef<UndoRedoService>(createUndoRedoService());

  // Seed initial structures if provided
  useEffect(() => {
    if (initialStructures) {
      dispatch({ type: 'setStructures', payload: initialStructures });
    }
  }, [initialStructures]);

  const setStructures = useCallback((set: RTStructureSet) => {
    dispatch({ type: 'setStructures', payload: set });
  }, []);

  const setError = useCallback((message: string | null) => {
    dispatch({ type: 'setError', error: message });
  }, []);

  const selectStructure = useCallback((roiNumber: number, selected: boolean) => {
    dispatch({ type: 'toggleStructureSelection', roiNumber, selected });
  }, []);

  const setSelectedForEditCb = useCallback((roiNumber: number | null) => {
    dispatch({ type: 'setSelectedForEdit', roiNumber });
  }, []);

  const setStructureVisibility = useCallback((roiNumber: number, visible: boolean) => {
    dispatch({ type: 'setVisibility', roiNumber, visible });
  }, []);

  const setAllStructuresVisible = useCallback((visible: boolean) => {
    dispatch({ type: 'setAllVisible', visible });
  }, []);

  const saveHistory = useCallback((action: string, structureId?: number | null) => {
    if (state.rtStructures) {
      undoRedoRef.current.saveState(action as any, state.rtStructures, structureId);
    }
  }, [state.rtStructures]);

  // Pen tool methods
  const addPenPoint = useCallback((point: { x: number; y: number; z: number }) => {
    dispatch({ type: 'addPenPoint', point });
  }, []);

  const clearPenPoints = useCallback(() => {
    dispatch({ type: 'clearPenPoints' });
  }, []);

  const completePenContour = useCallback(async () => {
    if (!state.rtStructures || !state.selection.selectedForEdit || state.pen.points.length < 3) return;
    
    try {
      dispatch({ type: 'setBusy', busy: true });
      const service = createContourOperationsService();
      
      // Convert pen points to flat array format: [x1, y1, z1, x2, y2, z2, ...]
      const flatPoints: number[] = [];
      state.pen.points.forEach(p => {
        flatPoints.push(p.x, p.y, p.z);
      });
      
      // Determine slice position from first point
      const slicePosition = state.pen.points[0].z;
      
      // Use pen mode to determine operation
      let updatedStructures = state.rtStructures;
      if (state.pen.mode === 'add') {
        updatedStructures = await service.addPenStroke(
          state.rtStructures,
          state.selection.selectedForEdit,
          slicePosition,
          flatPoints
        );
      } else if (state.pen.mode === 'cut') {
        updatedStructures = await service.cutPenStroke(
          state.rtStructures,
          state.selection.selectedForEdit,
          slicePosition,
          flatPoints
        );
      }
      
      dispatch({ type: 'setStructures', payload: updatedStructures });
      saveHistory(`pen_${state.pen.mode}`, state.selection.selectedForEdit);
      dispatch({ type: 'clearPenPoints' });
    } catch (err) {
      console.error('[RTProvider] completePenContour error:', err);
      dispatch({ type: 'setError', error: err instanceof Error ? err.message : 'Pen operation failed' });
    } finally {
      dispatch({ type: 'setBusy', busy: false });
    }
  }, [state.rtStructures, state.selection.selectedForEdit, state.pen.points, state.pen.mode, saveHistory]);

  const cancelPenContour = useCallback(() => {
    dispatch({ type: 'clearPenPoints' });
  }, []);

  // Provider-level operations
  const performBooleanOp = useCallback(async (sourceId: number, targetId: number, op: 'union' | 'subtract' | 'intersect') => {
    if (!state.rtStructures) return;
    
    try {
      dispatch({ type: 'setBusy', busy: true });
      const service = createContourOperationsService();
      const result = await service.booleanOperation(state.rtStructures, sourceId, targetId, op);
      dispatch({ type: 'setStructures', payload: result });
      saveHistory(`boolean_${op}`, sourceId);
    } catch (err) {
      console.error('[RTProvider] performBooleanOp error:', err);
      dispatch({ type: 'setError', error: err instanceof Error ? err.message : 'Boolean operation failed' });
    } finally {
      dispatch({ type: 'setBusy', busy: false });
    }
  }, [state.rtStructures, saveHistory]);

  const performMarginOp = useCallback(async (roiId: number, marginMm: number) => {
    if (!state.rtStructures) return;
    
    try {
      dispatch({ type: 'setBusy', busy: true });
      const service = createContourOperationsService();
      const result = await service.uniformMargin(state.rtStructures, roiId, marginMm);
      dispatch({ type: 'setStructures', payload: result });
      saveHistory('margin', roiId);
    } catch (err) {
      console.error('[RTProvider] performMarginOp error:', err);
      dispatch({ type: 'setError', error: err instanceof Error ? err.message : 'Margin operation failed' });
    } finally {
      dispatch({ type: 'setBusy', busy: false });
    }
  }, [state.rtStructures, saveHistory]);

  const performAnisotropicMarginOp = useCallback(async (roiId: number, marginX: number, marginY: number, marginZ: number) => {
    if (!state.rtStructures) return;
    
    try {
      dispatch({ type: 'setBusy', busy: true });
      const service = createContourOperationsService();
      const result = await service.anisotropicMargin(state.rtStructures, roiId, marginX, marginY, marginZ);
      dispatch({ type: 'setStructures', payload: result });
      saveHistory('anisotropic_margin', roiId);
    } catch (err) {
      console.error('[RTProvider] performAnisotropicMarginOp error:', err);
      dispatch({ type: 'setError', error: err instanceof Error ? err.message : 'Anisotropic margin operation failed' });
    } finally {
      dispatch({ type: 'setBusy', busy: false });
    }
  }, [state.rtStructures, saveHistory]);

  const performGrowOp = useCallback(async (roiId: number, distanceMm: number) => {
    if (!state.rtStructures) return;
    
    try {
      dispatch({ type: 'setBusy', busy: true });
      const service = createContourOperationsService();
      const result = await service.growContour(state.rtStructures, roiId, distanceMm);
      dispatch({ type: 'setStructures', payload: result });
      saveHistory('grow', roiId);
    } catch (err) {
      console.error('[RTProvider] performGrowOp error:', err);
      dispatch({ type: 'setError', error: err instanceof Error ? err.message : 'Grow operation failed' });
    } finally {
      dispatch({ type: 'setBusy', busy: false });
    }
  }, [state.rtStructures, saveHistory]);

  const performBrushAdd = useCallback(async (roiId: number, sliceZ: number, points: number[]) => {
    if (!state.rtStructures) return;
    
    try {
      dispatch({ type: 'setBusy', busy: true });
      const service = createContourOperationsService();
      const result = await service.addBrushStroke(state.rtStructures, roiId, sliceZ, points);
      dispatch({ type: 'setStructures', payload: result });
      saveHistory('brush_add', roiId);
    } catch (err) {
      console.error('[RTProvider] performBrushAdd error:', err);
      dispatch({ type: 'setError', error: err instanceof Error ? err.message : 'Brush add failed' });
    } finally {
      dispatch({ type: 'setBusy', busy: false });
    }
  }, [state.rtStructures, saveHistory]);

  const performBrushErase = useCallback(async (roiId: number, sliceZ: number, points: number[]) => {
    if (!state.rtStructures) return;
    
    try {
      dispatch({ type: 'setBusy', busy: true });
      const service = createContourOperationsService();
      const result = await service.eraseBrushStroke(state.rtStructures, roiId, sliceZ, points);
      dispatch({ type: 'setStructures', payload: result });
      saveHistory('brush_erase', roiId);
    } catch (err) {
      console.error('[RTProvider] performBrushErase error:', err);
      dispatch({ type: 'setError', error: err instanceof Error ? err.message : 'Brush erase failed' });
    } finally {
      dispatch({ type: 'setBusy', busy: false });
    }
  }, [state.rtStructures, saveHistory]);

  const value = useMemo<RTContextValue>(() => ({
    ...state,
    setStructures,
    setError,
    selectStructure,
    setSelectedForEdit: setSelectedForEditCb,
    setStructureVisibility,
    setAllStructuresVisible,
    undoRedo: undoRedoRef.current,
    saveHistory,
    setPreviewContours: (contours) => dispatch({ type: 'setPreviewContours', contours }),
    setPreviewContour: (preview) => dispatch({ type: 'setPreviewContour', preview }),
    clearPreview: () => dispatch({ type: 'clearPreview' }),
    setActiveTool: (tool) => dispatch({ type: 'setActiveTool', tool }),
    setBrushSize: (size) => dispatch({ type: 'setBrushSize', size }),
    setBrushMode: (mode) => dispatch({ type: 'setBrushMode', mode }),
    setBrushEnabled: (enabled) => dispatch({ type: 'setBrushEnabled', enabled }),
    setPenMode: (mode) => dispatch({ type: 'setPenMode', mode }),
    setPenEnabled: (enabled) => dispatch({ type: 'setPenEnabled', enabled }),
    addPenPoint,
    clearPenPoints,
    completePenContour,
    cancelPenContour,
    setBusy: (busy) => dispatch({ type: 'setBusy', busy }),
    performBooleanOp,
    performMarginOp,
    performAnisotropicMarginOp,
    performGrowOp,
    performBrushAdd,
    performBrushErase,
  }), [
    state,
    setStructures,
    setError,
    selectStructure,
    setSelectedForEditCb,
    setStructureVisibility,
    setAllStructuresVisible,
    saveHistory,
    addPenPoint,
    clearPenPoints,
    completePenContour,
    cancelPenContour,
    performBooleanOp,
    performMarginOp,
    performAnisotropicMarginOp,
    performGrowOp,
    performBrushAdd,
    performBrushErase
  ]);

  return <RTContext.Provider value={value}>{children}</RTContext.Provider>;
}

export function useRT() {
  const ctx = useContext(RTContext);
  if (!ctx) throw new Error('useRT must be used within RTProvider');
  return ctx;
}


