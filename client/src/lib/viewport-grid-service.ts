// ViewportGridService - Foundation for multi-viewport and MPR support
// Based on OHIF 3.10 architecture for managing multiple viewports

import { BehaviorSubject } from 'rxjs';

export interface Viewport {
  id: string;
  type: 'CT' | 'MPR_AXIAL' | 'MPR_SAGITTAL' | 'MPR_CORONAL' | 'FUSION';
  position: ViewportPosition;
  seriesInstanceUID?: string;
  isActive: boolean;
  orientation?: 'axial' | 'sagittal' | 'coronal';
  syncGroup?: string; // For synchronized scrolling/windowing
  fusionConfig?: {
    primarySeriesUID: string;
    secondarySeriesUID: string;
    opacity: number;
  };
}

export interface ViewportPosition {
  row: number;
  col: number;
  width: number;
  height: number;
}

export interface ViewportGrid {
  rows: number;
  cols: number;
  viewports: Viewport[];
  activeViewportId: string | null;
}

export type GridLayout = '1x1' | '1x2' | '2x2' | '1x3' | '3x3' | 'MPR';

const DEFAULT_LAYOUTS: Record<GridLayout, { rows: number; cols: number }> = {
  '1x1': { rows: 1, cols: 1 },
  '1x2': { rows: 1, cols: 2 },
  '2x2': { rows: 2, cols: 2 },
  '1x3': { rows: 1, cols: 3 },
  '3x3': { rows: 3, cols: 3 },
  'MPR': { rows: 2, cols: 2 } // Special layout: Axial, Sagittal, Coronal + 3D
};

class ViewportGridService {
  private gridSubject = new BehaviorSubject<ViewportGrid>({
    rows: 1,
    cols: 1,
    viewports: [],
    activeViewportId: null
  });

  public grid$ = this.gridSubject.asObservable();

  constructor() {
    // Initialize with single viewport
    this.setLayout('1x1');
  }

  getGrid(): ViewportGrid {
    return this.gridSubject.value;
  }

  setLayout(layout: GridLayout, seriesInstanceUID?: string) {
    const config = DEFAULT_LAYOUTS[layout];
    const viewports: Viewport[] = [];

    if (layout === 'MPR' && seriesInstanceUID) {
      // Special MPR layout
      viewports.push(
        {
          id: 'mpr-axial',
          type: 'MPR_AXIAL',
          position: { row: 0, col: 0, width: 1, height: 1 },
          seriesInstanceUID,
          isActive: true,
          orientation: 'axial',
          syncGroup: 'mpr'
        },
        {
          id: 'mpr-sagittal',
          type: 'MPR_SAGITTAL',
          position: { row: 0, col: 1, width: 1, height: 1 },
          seriesInstanceUID,
          isActive: false,
          orientation: 'sagittal',
          syncGroup: 'mpr'
        },
        {
          id: 'mpr-coronal',
          type: 'MPR_CORONAL',
          position: { row: 1, col: 0, width: 1, height: 1 },
          seriesInstanceUID,
          isActive: false,
          orientation: 'coronal',
          syncGroup: 'mpr'
        },
        {
          id: 'mpr-3d',
          type: 'CT', // Placeholder for 3D view
          position: { row: 1, col: 1, width: 1, height: 1 },
          seriesInstanceUID,
          isActive: false
        }
      );
    } else {
      // Regular grid layouts
      let viewportIndex = 0;
      for (let row = 0; row < config.rows; row++) {
        for (let col = 0; col < config.cols; col++) {
          viewports.push({
            id: `viewport-${viewportIndex}`,
            type: 'CT',
            position: { row, col, width: 1, height: 1 },
            seriesInstanceUID: viewportIndex === 0 ? seriesInstanceUID : undefined,
            isActive: viewportIndex === 0
          });
          viewportIndex++;
        }
      }
    }

    this.gridSubject.next({
      rows: config.rows,
      cols: config.cols,
      viewports,
      activeViewportId: viewports[0]?.id || null
    });

    console.log(`📐 ViewportGrid: Set layout to ${layout} with ${viewports.length} viewports`);
  }

  setActiveViewport(viewportId: string) {
    const grid = this.getGrid();
    const updatedViewports = grid.viewports.map(vp => ({
      ...vp,
      isActive: vp.id === viewportId
    }));

    this.gridSubject.next({
      ...grid,
      viewports: updatedViewports,
      activeViewportId: viewportId
    });

    console.log(`🎯 ViewportGrid: Activated viewport ${viewportId}`);
  }

  updateViewport(viewportId: string, updates: Partial<Viewport>) {
    const grid = this.getGrid();
    const updatedViewports = grid.viewports.map(vp => 
      vp.id === viewportId ? { ...vp, ...updates } : vp
    );

    this.gridSubject.next({
      ...grid,
      viewports: updatedViewports
    });
  }

  assignSeriesToViewport(viewportId: string, seriesInstanceUID: string) {
    this.updateViewport(viewportId, { seriesInstanceUID });
    console.log(`📌 ViewportGrid: Assigned series ${seriesInstanceUID} to viewport ${viewportId}`);
  }

  setupFusionViewport(viewportId: string, primarySeriesUID: string, secondarySeriesUID: string, opacity = 0.5) {
    this.updateViewport(viewportId, {
      type: 'FUSION',
      fusionConfig: {
        primarySeriesUID,
        secondarySeriesUID,
        opacity
      }
    });
    console.log(`🔀 ViewportGrid: Setup fusion viewport ${viewportId}`);
  }

  // Get viewports in the same sync group for synchronized operations
  getSyncedViewports(viewportId: string): Viewport[] {
    const grid = this.getGrid();
    const viewport = grid.viewports.find(vp => vp.id === viewportId);
    
    if (!viewport?.syncGroup) return [];
    
    return grid.viewports.filter(vp => 
      vp.syncGroup === viewport.syncGroup && vp.id !== viewportId
    );
  }

  // Calculate viewport dimensions based on container size
  calculateViewportDimensions(containerWidth: number, containerHeight: number): Map<string, DOMRect> {
    const grid = this.getGrid();
    const dimensions = new Map<string, DOMRect>();
    
    const cellWidth = containerWidth / grid.cols;
    const cellHeight = containerHeight / grid.rows;
    
    grid.viewports.forEach(viewport => {
      const x = viewport.position.col * cellWidth;
      const y = viewport.position.row * cellHeight;
      const width = viewport.position.width * cellWidth;
      const height = viewport.position.height * cellHeight;
      
      dimensions.set(viewport.id, new DOMRect(x, y, width, height));
    });
    
    return dimensions;
  }

  reset() {
    this.setLayout('1x1');
  }
}

// Singleton instance
export const viewportGridService = new ViewportGridService();

// Helper hooks for React components
export function useViewportGrid() {
  const [grid, setGrid] = useState<ViewportGrid>(viewportGridService.getGrid());

  useEffect(() => {
    const subscription = viewportGridService.grid$.subscribe(setGrid);
    return () => subscription.unsubscribe();
  }, []);

  return {
    grid,
    setLayout: (layout: GridLayout, seriesUID?: string) => 
      viewportGridService.setLayout(layout, seriesUID),
    setActiveViewport: (id: string) => 
      viewportGridService.setActiveViewport(id),
    assignSeries: (viewportId: string, seriesUID: string) => 
      viewportGridService.assignSeriesToViewport(viewportId, seriesUID)
  };
}

// Import React hooks at the top of the file
import { useState, useEffect } from 'react';