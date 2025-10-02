import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import type { ReactNode } from 'react';
import type { RTSelectionState, RTStructureSet } from '@/types/rt-structures';
import { createUndoRedoService, type UndoRedoService } from '@/rt-structures/services/UndoRedoService';

type RTStatus = 'idle' | 'loading' | 'ready' | 'error';

interface RTState {
  status: RTStatus;
  error: string | null;
  rtStructures: RTStructureSet | null;
  selection: RTSelectionState;
}

type Action =
  | { type: 'reset' }
  | { type: 'setStructures'; payload: RTStructureSet }
  | { type: 'setStatus'; status: RTStatus }
  | { type: 'setError'; error: string | null }
  | { type: 'toggleStructureSelection'; roiNumber: number; selected: boolean }
  | { type: 'setSelectedForEdit'; roiNumber: number | null }
  | { type: 'setVisibility'; roiNumber: number; visible: boolean }
  | { type: 'setAllVisible'; visible: boolean };

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
  }), [state, setStructures, setError, selectStructure, setSelectedForEditCb, setStructureVisibility, setAllStructuresVisible, saveHistory]);

  return <RTContext.Provider value={value}>{children}</RTContext.Provider>;
}

export function useRT() {
  const ctx = useContext(RTContext);
  if (!ctx) throw new Error('useRT must be used within RTProvider');
  return ctx;
}


