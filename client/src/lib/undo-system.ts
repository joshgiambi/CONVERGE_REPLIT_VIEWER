// Completely revamped undo/redo system - reliable and simple
export interface UndoState {
  seriesId: number;
  timestamp: number;
  action: string;
  structureId: number;
  rtStructures: any; // Complete RT structures snapshot
}

export class UndoRedoManager {
  private history: UndoState[] = [];
  private currentIndex: number = -1;
  private maxHistorySize: number = 50;

  constructor() {
    console.log('UndoRedoManager: Initialized new undo/redo system');
  }

  // Save a complete state snapshot
  saveState(seriesId: number, action: string, structureId: number, rtStructures: any): void {
    console.log(`UndoRedoManager: Saving state - Action: ${action}, Structure: ${structureId}`);
    
    // Create deep copy to avoid reference issues
    const state: UndoState = {
      seriesId,
      timestamp: Date.now(),
      action,
      structureId,
      rtStructures: JSON.parse(JSON.stringify(rtStructures))
    };

    // Remove any redo entries after current index
    this.history = this.history.slice(0, this.currentIndex + 1);
    
    // Add new state
    this.history.push(state);
    this.currentIndex++;

    // Limit history size
    if (this.history.length > this.maxHistorySize) {
      this.history.shift();
      this.currentIndex--;
    }

    console.log(`UndoRedoManager: State saved. History length: ${this.history.length}, Current index: ${this.currentIndex}`);
  }

  // Undo to previous state
  undo(): UndoState | null {
    if (this.currentIndex <= 0) {
      console.log('UndoRedoManager: No states to undo');
      return null;
    }

    this.currentIndex--;
    const previousState = this.history[this.currentIndex];
    
    console.log(`UndoRedoManager: Undoing to state at index ${this.currentIndex}, action: ${previousState.action}`);
    return previousState;
  }

  // Redo to next state
  redo(): UndoState | null {
    if (this.currentIndex >= this.history.length - 1) {
      console.log('UndoRedoManager: No states to redo');
      return null;
    }

    this.currentIndex++;
    const nextState = this.history[this.currentIndex];
    
    console.log(`UndoRedoManager: Redoing to state at index ${this.currentIndex}, action: ${nextState.action}`);
    return nextState;
  }

  // Check if undo is available
  canUndo(): boolean {
    return this.currentIndex > 0;
  }

  // Check if redo is available
  canRedo(): boolean {
    return this.currentIndex < this.history.length - 1;
  }

  // Get current state info
  getCurrentStateInfo(): string {
    if (this.currentIndex < 0) return 'No history';
    const state = this.history[this.currentIndex];
    return `${state.action} (Structure ${state.structureId})`;
  }

  // Clear all history
  clear(): void {
    this.history = [];
    this.currentIndex = -1;
    console.log('UndoRedoManager: History cleared');
  }

  // Get history statistics
  getStats(): { total: number, current: number, canUndo: boolean, canRedo: boolean } {
    return {
      total: this.history.length,
      current: this.currentIndex,
      canUndo: this.canUndo(),
      canRedo: this.canRedo()
    };
  }
}

// Global instance for the application
export const undoRedoManager = new UndoRedoManager();