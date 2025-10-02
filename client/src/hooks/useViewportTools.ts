/**
 * useViewportTools Hook
 * 
 * Manages viewport tool state (pan, crosshairs, measure, etc.)
 * 
 * Agent 1: Viewer Core
 * Created: Hour 10-14
 */

import { useState, useCallback } from 'react';
import type { ToolMode, UseViewportToolsResult } from '@/types/viewer';

export function useViewportTools(initialTool: ToolMode = 'pan'): UseViewportToolsResult {
  const [activeTool, setActiveTool] = useState<ToolMode>(initialTool);

  const setMode = useCallback((mode: 'pan' | 'crosshairs' | 'measure') => {
    setActiveTool(mode);
  }, []);

  return {
    activeTool,
    setActiveTool,
    isPanMode: activeTool === 'pan',
    isCrosshairMode: activeTool === 'crosshairs',
    isMeasureMode: activeTool === 'measure',
    setMode,
  };
}

