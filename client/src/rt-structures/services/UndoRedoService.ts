import type { RTStructureSet } from '@/types/rt-structures';

export type UndoAction =
  | 'boolean_operation'
  | 'apply_margin'
  | 'preview_margin'
  | 'grow_contour'
  | 'edit_contour'
  | 'color_change'
  | 'visibility_change'
  | 'add_brush_stroke'
  | 'erase_brush_stroke'
  | 'smart_brush_stroke'
  | 'pen_tool'
  | 'smooth'
  | 'separate_blobs'
  | 'remove_blobs';

export interface HistoryEntry {
  timestamp: number;
  action: UndoAction;
  structureId?: number | null;
  rtStructures: RTStructureSet;
}

export class UndoRedoService {
  private history: HistoryEntry[] = [];
  private index = -1;

  saveState(action: UndoAction, rtStructures: RTStructureSet, structureId?: number | null) {
    const snapshot = (globalThis as any).structuredClone ? structuredClone(rtStructures) : JSON.parse(JSON.stringify(rtStructures));
    // Truncate any redo states
    this.history = this.history.slice(0, this.index + 1);
    this.history.push({ timestamp: Date.now(), action, structureId: structureId ?? null, rtStructures: snapshot });
    this.index = this.history.length - 1;
  }

  canUndo(): boolean { return this.index > 0; }
  canRedo(): boolean { return this.index >= 0 && this.index < this.history.length - 1; }

  undo(): HistoryEntry | null {
    if (!this.canUndo()) return null;
    this.index -= 1;
    return this.history[this.index] ?? null;
  }

  redo(): HistoryEntry | null {
    if (!this.canRedo()) return null;
    this.index += 1;
    return this.history[this.index] ?? null;
  }

  jumpTo(idx: number): HistoryEntry | null {
    if (idx < 0 || idx >= this.history.length) return null;
    this.index = idx;
    return this.history[this.index] ?? null;
  }

  getHistory(): HistoryEntry[] { return this.history; }
  getCurrentIndex(): number { return this.index; }
}

export function createUndoRedoService() {
  return new UndoRedoService();
}


