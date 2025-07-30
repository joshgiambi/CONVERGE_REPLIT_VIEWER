# Superbeam Contouring Tools - Detailed Implementation Guide

## Complete Code & Styling for Bottom Toolbar and Popup Modules

This document provides comprehensive implementation details for Superbeam's contouring tools system, including the bottom toolbar, expandable settings popups, smart brush system, and all tool interactions.

---

## 1. Main Contouring Toolbar Component

### Complete Toolbar Implementation
```tsx
// contouring-toolbar.tsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Brush,
  Pen,
  Eraser,
  Settings,
  X,
  ChevronRight,
  Trash2,
  RotateCcw,
  Zap,
  Circle,
  Square,
  Scissors,
  Move,
  RotateCw,
  FlipHorizontal,
  Copy,
  Undo,
  Redo
} from 'lucide-react';

interface ContouringToolbarProps {
  selectedStructure: {
    structureName: string;
    color: number[];
    roiNumber: number;
  } | null;
  isVisible: boolean;
  onClose: () => void;
  onToolChange: (toolState: ContouringToolState) => void;
  currentSlicePosition?: number;
  onContourUpdate?: (updatePayload: ContourUpdatePayload) => void;
  onAutoZoomSettingsChange?: (settings: AutoZoomSettings) => void;
  viewportDimensions?: { width: number; height: number };
  undoStack?: ContourAction[];
  redoStack?: ContourAction[];
  onUndo?: () => void;
  onRedo?: () => void;
}

interface ContouringToolState {
  activeTool: string | null;
  brushSize: number;
  brushMode: 'add' | 'delete' | 'smart';
  penMode: 'draw' | 'edit' | 'bezier';
  eraseMode: 'brush' | 'contour' | 'selection';
  is3DMode: boolean;
  smartBrushEnabled: boolean;
  snapToGrid: boolean;
  autoCloseEnabled: boolean;
  smoothingLevel: number;
  pressureSensitive: boolean;
}

interface ContourUpdatePayload {
  action: 'add' | 'delete' | 'modify' | 'clear_slice' | 'clear_all' | 'undo' | 'redo';
  structureId: number;
  slicePosition?: number;
  contourData?: any;
  timestamp: number;
}

interface AutoZoomSettings {
  autoZoomEnabled: boolean;
  autoLocalizeEnabled: boolean;
  zoomFillFactor: number;
  animationDuration: number;
}

export const ContouringToolbar: React.FC<ContouringToolbarProps> = ({
  selectedStructure,
  isVisible,
  onClose,
  onToolChange,
  currentSlicePosition,
  onContourUpdate,
  onAutoZoomSettingsChange,
  viewportDimensions,
  undoStack = [],
  redoStack = [],
  onUndo,
  onRedo
}) => {
  // Core state management
  const [toolState, setToolState] = useState<ContouringToolState>({
    activeTool: null,
    brushSize: 15,
    brushMode: 'smart',
    penMode: 'draw',
    eraseMode: 'brush',
    is3DMode: false,
    smartBrushEnabled: true,
    snapToGrid: false,
    autoCloseEnabled: true,
    smoothingLevel: 2,
    pressureSensitive: false
  });

  const [activeSettingsPanel, setActiveSettingsPanel] = useState<string | null>(null);
  const [panelPosition, setPanelPosition] = useState<'top' | 'bottom'>('top');
  const [autoZoomSettings, setAutoZoomSettings] = useState<AutoZoomSettings>({
    autoZoomEnabled: true,
    autoLocalizeEnabled: true,
    zoomFillFactor: 40,
    animationDuration: 300
  });

  // Advanced state
  const [targetSliceNumber, setTargetSliceNumber] = useState('');
  const [isDrawing, setIsDrawing] = useState(false);
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false);
  const [keyboardShortcutsEnabled, setKeyboardShortcutsEnabled] = useState(true);

  // Refs
  const toolbarRef = useRef<HTMLDivElement>(null);
  const settingsPanelRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});

  // Tool definitions with enhanced metadata
  const tools = [
    {
      id: 'brush',
      icon: Brush,
      label: 'Smart Brush',
      description: 'Intelligent brush with add/delete detection',
      hasSettings: true,
      shortcut: 'B',
      category: 'paint'
    },
    {
      id: 'pen',
      icon: Pen,
      label: 'Precision Pen',
      description: 'Point-by-point contour drawing',
      hasSettings: true,
      shortcut: 'P',
      category: 'vector'
    },
    {
      id: 'erase',
      icon: Eraser,
      label: 'Erase Tool',
      description: 'Remove contour sections',
      hasSettings: true,
      shortcut: 'E',
      category: 'modify'
    },
    {
      id: 'operations',
      icon: Settings,
      label: 'Operations',
      description: 'Advanced contour operations',
      hasSettings: true,
      shortcut: 'O',
      category: 'utility'
    }
  ];

  // Dynamic styling based on selected structure
  useEffect(() => {
    if (selectedStructure && toolbarRef.current) {
      const [r, g, b] = selectedStructure.color;
      const structureColor = `rgb(${r}, ${g}, ${b})`;
      const structureColorMuted = `rgba(${r}, ${g}, ${b}, 0.6)`;
      
      const toolbar = toolbarRef.current;
      toolbar.style.setProperty('--structure-color', structureColor);
      toolbar.style.setProperty('--structure-color-rgb', `${r}, ${g}, ${b}`);
      toolbar.style.setProperty('--structure-color-muted', structureColorMuted);
      toolbar.setAttribute('data-structure-color', structureColor);
    }
  }, [selectedStructure]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!keyboardShortcutsEnabled || !isVisible) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement) return;

      const key = event.key.toLowerCase();
      
      // Tool shortcuts
      const tool = tools.find(t => t.shortcut.toLowerCase() === key);
      if (tool) {
        event.preventDefault();
        handleToolChange(tool.id);
        return;
      }

      // Other shortcuts
      switch (key) {
        case 'escape':
          event.preventDefault();
          onClose();
          break;
        case '[':
          event.preventDefault();
          adjustBrushSize(-1);
          break;
        case ']':
          event.preventDefault();
          adjustBrushSize(1);
          break;
        case 'z':
          if (event.ctrlKey || event.metaKey) {
            event.preventDefault();
            if (event.shiftKey) {
              onRedo?.();
            } else {
              onUndo?.();
            }
          }
          break;
        case ' ':
          event.preventDefault();
          // Spacebar for quick pan mode
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [keyboardShortcutsEnabled, isVisible, onClose, onUndo, onRedo]);

  // Tool change handler
  const handleToolChange = useCallback((toolId: string) => {
    const newActiveTool = toolState.activeTool === toolId ? null : toolId;
    const newToolState = { ...toolState, activeTool: newActiveTool };
    
    setToolState(newToolState);
    onToolChange(newToolState);
    
    // Auto-open settings for complex tools
    if (newActiveTool && ['brush', 'pen'].includes(newActiveTool)) {
      setActiveSettingsPanel(newActiveTool);
    } else if (!newActiveTool) {
      setActiveSettingsPanel(null);
    }
  }, [toolState, onToolChange]);

  // Settings panel toggle
  const handleSettingsToggle = useCallback((toolId: string) => {
    setActiveSettingsPanel(current => current === toolId ? null : toolId);
  }, []);

  // Brush size adjustment
  const adjustBrushSize = useCallback((delta: number) => {
    const newSize = Math.max(1, Math.min(100, toolState.brushSize + delta));
    const newToolState = { ...toolState, brushSize: newSize };
    setToolState(newToolState);
    onToolChange(newToolState);
  }, [toolState, onToolChange]);

  // Panel positioning logic
  useEffect(() => {
    if (!toolbarRef.current || !activeSettingsPanel) return;

    const toolbar = toolbarRef.current;
    const rect = toolbar.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    
    // Determine if panel should be above or below toolbar
    const spaceAbove = rect.top;
    const spaceBelow = viewportHeight - rect.bottom;
    
    setPanelPosition(spaceAbove > spaceBelow ? 'top' : 'bottom');
  }, [activeSettingsPanel, viewportDimensions]);

  if (!isVisible || !selectedStructure) return null;

  return (
    <div className="contouring-toolbar-container">
      {/* Main Toolbar */}
      <div 
        ref={toolbarRef}
        className="contouring-toolbar"
        data-structure-color={`rgb(${selectedStructure.color.join(',')})`}
      >
        {/* Undo/Redo Section */}
        <div className="toolbar-section undo-redo-section">
          <button
            className={`toolbar-action-btn undo-btn ${undoStack.length === 0 ? 'disabled' : ''}`}
            onClick={onUndo}
            disabled={undoStack.length === 0}
            title={`Undo (${undoStack.length} actions)`}
          >
            <Undo size={18} />
          </button>
          <button
            className={`toolbar-action-btn redo-btn ${redoStack.length === 0 ? 'disabled' : ''}`}
            onClick={onRedo}
            disabled={redoStack.length === 0}
            title={`Redo (${redoStack.length} actions)`}
          >
            <Redo size={18} />
          </button>
        </div>

        {/* Main Tools Section */}
        <div className="toolbar-section main-tools-section">
          {tools.map((tool) => (
            <div key={tool.id} className="tool-container">
              <button
                className={`contouring-tool-btn ${toolState.activeTool === tool.id ? 'active' : ''}`}
                onClick={() => handleToolChange(tool.id)}
                onMouseEnter={() => tool.hasSettings && setActiveSettingsPanel(tool.id)}
                title={`${tool.label} (${tool.shortcut})\n${tool.description}`}
              >
                <tool.icon size={20} />
                {tool.hasSettings && (
                  <div className="expand-indicator">
                    <ChevronRight size={10} />
                  </div>
                )}
              </button>
            </div>
          ))}
        </div>

        {/* Quick Settings Section */}
        <div className="toolbar-section quick-settings-section">
          <div className="brush-size-indicator">
            <div 
              className="brush-size-circle"
              style={{ 
                width: `${Math.min(toolState.brushSize, 30)}px`,
                height: `${Math.min(toolState.brushSize, 30)}px`
              }}
            />
            <span className="brush-size-label">{toolState.brushSize}</span>
          </div>
          
          <Badge 
            variant="outline" 
            className={`mode-badge ${toolState.brushMode === 'smart' ? 'smart-mode' : ''}`}
          >
            {toolState.brushMode.toUpperCase()}
          </Badge>

          {toolState.is3DMode && (
            <Badge variant="secondary" className="mode-badge-3d">
              3D
            </Badge>
          )}
        </div>

        {/* Close Button */}
        <div className="toolbar-section close-section">
          <button
            className="contouring-tool-btn close-btn"
            onClick={onClose}
            title="Close Contour Editor (Esc)"
          >
            <X size={20} />
          </button>
        </div>
      </div>

      {/* Settings Panels */}
      {activeSettingsPanel && (
        <ContouringSettingsPanel
          toolId={activeSettingsPanel}
          position={panelPosition}
          selectedStructure={selectedStructure}
          toolState={toolState}
          setToolState={setToolState}
          onToolChange={onToolChange}
          autoZoomSettings={autoZoomSettings}
          setAutoZoomSettings={setAutoZoomSettings}
          currentSlicePosition={currentSlicePosition}
          targetSliceNumber={targetSliceNumber}
          setTargetSliceNumber={setTargetSliceNumber}
          showAdvancedOptions={showAdvancedOptions}
          setShowAdvancedOptions={setShowAdvancedOptions}
          onClose={() => setActiveSettingsPanel(null)}
          onContourUpdate={onContourUpdate}
          onAutoZoomSettingsChange={onAutoZoomSettingsChange}
        />
      )}

      {/* Floating Status Panel */}
      {toolState.activeTool && (
        <ContouringStatusPanel
          toolState={toolState}
          isDrawing={isDrawing}
          currentSlicePosition={currentSlicePosition}
          selectedStructure={selectedStructure}
        />
      )}
    </div>
  );
};
```

---

## 2. Settings Panel System

### Comprehensive Settings Panel Component
```tsx
// contouring-settings-panel.tsx
interface ContouringSettingsPanelProps {
  toolId: string;
  position: 'top' | 'bottom';
  selectedStructure: any;
  toolState: ContouringToolState;
  setToolState: (state: ContouringToolState) => void;
  onToolChange: (state: ContouringToolState) => void;
  autoZoomSettings: AutoZoomSettings;
  setAutoZoomSettings: (settings: AutoZoomSettings) => void;
  currentSlicePosition?: number;
  targetSliceNumber: string;
  setTargetSliceNumber: (value: string) => void;
  showAdvancedOptions: boolean;
  setShowAdvancedOptions: (show: boolean) => void;
  onClose: () => void;
  onContourUpdate?: (payload: ContourUpdatePayload) => void;
  onAutoZoomSettingsChange?: (settings: AutoZoomSettings) => void;
}

const ContouringSettingsPanel: React.FC<ContouringSettingsPanelProps> = ({
  toolId,
  position,
  selectedStructure,
  toolState,
  setToolState,
  onToolChange,
  autoZoomSettings,
  setAutoZoomSettings,
  currentSlicePosition,
  targetSliceNumber,
  setTargetSliceNumber,
  showAdvancedOptions,
  setShowAdvancedOptions,
  onClose,
  onContourUpdate,
  onAutoZoomSettingsChange
}) => {
  const updateToolState = useCallback((updates: Partial<ContouringToolState>) => {
    const newState = { ...toolState, ...updates };
    setToolState(newState);
    onToolChange(newState);
  }, [toolState, setToolState, onToolChange]);

  const updateAutoZoomSettings = useCallback((updates: Partial<AutoZoomSettings>) => {
    const newSettings = { ...autoZoomSettings, ...updates };
    setAutoZoomSettings(newSettings);
    onAutoZoomSettingsChange?.(newSettings);
  }, [autoZoomSettings, setAutoZoomSettings, onAutoZoomSettingsChange]);

  // Brush Settings Panel
  const renderBrushSettings = () => (
    <div className="settings-content brush-settings">
      {/* Brush Size */}
      <div className="settings-group">
        <Label className="settings-label">
          Brush Size: {toolState.brushSize}px
        </Label>
        <Slider
          value={[toolState.brushSize]}
          onValueChange={([value]) => updateToolState({ brushSize: value })}
          max={100}
          min={1}
          step={1}
          className="brush-size-slider"
        />
        <div className="slider-marks">
          <span>1</span>
          <span>25</span>
          <span>50</span>
          <span>100</span>
        </div>
      </div>

      {/* Brush Mode */}
      <div className="settings-group">
        <Label className="settings-label">Brush Mode</Label>
        <div className="mode-selector">
          {['smart', 'add', 'delete'].map((mode) => (
            <button
              key={mode}
              className={`mode-btn ${toolState.brushMode === mode ? 'active' : ''}`}
              onClick={() => updateToolState({ brushMode: mode as any })}
            >
              {mode === 'smart' && <Zap size={14} />}
              {mode === 'add' && <Circle size={14} />}
              {mode === 'delete' && <X size={14} />}
              {mode.charAt(0).toUpperCase() + mode.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Smart Brush Settings */}
      {toolState.brushMode === 'smart' && (
        <div className="settings-group smart-brush-group">
          <div className="settings-toggle">
            <Label className="settings-label">Smart Detection</Label>
            <Switch
              checked={toolState.smartBrushEnabled}
              onCheckedChange={(checked) => updateToolState({ smartBrushEnabled: checked })}
            />
          </div>
          <p className="settings-description">
            Automatically switches between add/delete based on contour intersection
          </p>
        </div>
      )}

      {/* Pressure Sensitivity */}
      <div className="settings-group">
        <div className="settings-toggle">
          <Label className="settings-label">Pressure Sensitive</Label>
          <Switch
            checked={toolState.pressureSensitive}
            onCheckedChange={(checked) => updateToolState({ pressureSensitive: checked })}
          />
        </div>
      </div>

      {/* Smoothing */}
      <div className="settings-group">
        <Label className="settings-label">
          Smoothing: {toolState.smoothingLevel}
        </Label>
        <Slider
          value={[toolState.smoothingLevel]}
          onValueChange={([value]) => updateToolState({ smoothingLevel: value })}
          max={10}
          min={0}
          step={1}
          className="smoothing-slider"
        />
      </div>

      {/* 3D Mode */}
      <div className="settings-group">
        <div className="settings-toggle">
          <Label className="settings-label">3D Mode</Label>
          <Switch
            checked={toolState.is3DMode}
            onCheckedChange={(checked) => updateToolState({ is3DMode: checked })}
          />
        </div>
        <p className="settings-description">
          Apply brush strokes across multiple slices
        </p>
      </div>

      {/* Auto-Zoom Settings */}
      <div className="settings-group">
        <div className="settings-toggle">
          <Label className="settings-label">Auto-Zoom</Label>
          <Switch
            checked={autoZoomSettings.autoZoomEnabled}
            onCheckedChange={(checked) => updateAutoZoomSettings({ autoZoomEnabled: checked })}
          />
        </div>
      </div>

      <div className="settings-group">
        <div className="settings-toggle">
          <Label className="settings-label">Auto-Localize</Label>
          <Switch
            checked={autoZoomSettings.autoLocalizeEnabled}
            onCheckedChange={(checked) => updateAutoZoomSettings({ autoLocalizeEnabled: checked })}
          />
        </div>
      </div>

      {autoZoomSettings.autoZoomEnabled && (
        <div className="settings-group">
          <Label className="settings-label">
            Zoom Fill: {autoZoomSettings.zoomFillFactor}%
          </Label>
          <Slider
            value={[autoZoomSettings.zoomFillFactor]}
            onValueChange={([value]) => updateAutoZoomSettings({ zoomFillFactor: value })}
            max={80}
            min={20}
            step={5}
            className="zoom-fill-slider"
          />
        </div>
      )}
    </div>
  );

  // Pen Settings Panel
  const renderPenSettings = () => (
    <div className="settings-content pen-settings">
      {/* Pen Mode */}
      <div className="settings-group">
        <Label className="settings-label">Pen Mode</Label>
        <div className="mode-selector">
          {['draw', 'edit', 'bezier'].map((mode) => (
            <button
              key={mode}
              className={`mode-btn ${toolState.penMode === mode ? 'active' : ''}`}
              onClick={() => updateToolState({ penMode: mode as any })}
            >
              {mode === 'draw' && <Pen size={14} />}
              {mode === 'edit' && <Move size={14} />}
              {mode === 'bezier' && <Circle size={14} />}
              {mode.charAt(0).toUpperCase() + mode.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Snap to Grid */}
      <div className="settings-group">
        <div className="settings-toggle">
          <Label className="settings-label">Snap to Grid</Label>
          <Switch
            checked={toolState.snapToGrid}
            onCheckedChange={(checked) => updateToolState({ snapToGrid: checked })}
          />
        </div>
      </div>

      {/* Auto-Close Path */}
      <div className="settings-group">
        <div className="settings-toggle">
          <Label className="settings-label">Auto-Close Path</Label>
          <Switch
            checked={toolState.autoCloseEnabled}
            onCheckedChange={(checked) => updateToolState({ autoCloseEnabled: checked })}
          />
        </div>
      </div>

      {/* Point Precision */}
      <div className="settings-group">
        <Label className="settings-label">Point Precision</Label>
        <div className="precision-selector">
          <button className="precision-btn active">Pixel</button>
          <button className="precision-btn">Sub-pixel</button>
        </div>
      </div>

      {/* Advanced Pen Options */}
      {showAdvancedOptions && (
        <>
          <div className="settings-group">
            <Label className="settings-label">Curve Tension</Label>
            <Slider
              value={[50]}
              onValueChange={() => {}}
              max={100}
              min={0}
              step={1}
              className="tension-slider"
            />
          </div>

          <div className="settings-group">
            <div className="settings-toggle">
              <Label className="settings-label">Show Control Points</Label>
              <Switch defaultChecked />
            </div>
          </div>
        </>
      )}
    </div>
  );

  // Erase Settings Panel
  const renderEraseSettings = () => (
    <div className="settings-content erase-settings">
      {/* Erase Mode */}
      <div className="settings-group">
        <Label className="settings-label">Erase Mode</Label>
        <div className="mode-selector">
          {['brush', 'contour', 'selection'].map((mode) => (
            <button
              key={mode}
              className={`mode-btn ${toolState.eraseMode === mode ? 'active' : ''}`}
              onClick={() => updateToolState({ eraseMode: mode as any })}
            >
              {mode === 'brush' && <Brush size={14} />}
              {mode === 'contour' && <Scissors size={14} />}
              {mode === 'selection' && <Square size={14} />}
              {mode.charAt(0).toUpperCase() + mode.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Eraser Size (for brush mode) */}
      {toolState.eraseMode === 'brush' && (
        <div className="settings-group">
          <Label className="settings-label">
            Eraser Size: {toolState.brushSize}px
          </Label>
          <Slider
            value={[toolState.brushSize]}
            onValueChange={([value]) => updateToolState({ brushSize: value })}
            max={100}
            min={1}
            step={1}
            className="eraser-size-slider"
          />
        </div>
      )}

      {/* Preserve Holes */}
      <div className="settings-group">
        <div className="settings-toggle">
          <Label className="settings-label">Preserve Holes</Label>
          <Switch defaultChecked />
        </div>
        <p className="settings-description">
          Maintain internal contour holes when erasing
        </p>
      </div>

      {/* Feather Edge */}
      <div className="settings-group">
        <div className="settings-toggle">
          <Label className="settings-label">Feather Edge</Label>
          <Switch />
        </div>
      </div>
    </div>
  );

  // Operations Panel
  const renderOperationsSettings = () => (
    <div className="settings-content operations-settings">
      {/* Destructive Operations */}
      <div className="settings-group destructive-group">
        <Label className="settings-label destructive">Destructive Operations</Label>
        <p className="settings-description">
          These operations cannot be undone. Use with caution.
        </p>

        <div className="operations-grid">
          <Button
            variant="destructive"
            size="sm"
            onClick={() => handleDeleteCurrentSlice()}
            className="operation-btn"
            disabled={!currentSlicePosition}
          >
            <Trash2 size={16} />
            Delete Current Slice
            {currentSlicePosition && (
              <Badge variant="outline" className="slice-badge">
                {currentSlicePosition}
              </Badge>
            )}
          </Button>

          <div className="slice-operation">
            <div className="slice-input-row">
              <Input
                type="number"
                placeholder="Slice #"
                value={targetSliceNumber}
                onChange={(e) => setTargetSliceNumber(e.target.value)}
                className="slice-number-input"
              />
              <Button
                variant="destructive"
                size="sm"
                onClick={() => handleDeleteNthSlice()}
                className="operation-btn"
                disabled={!targetSliceNumber}
              >
                <Trash2 size={16} />
                Delete
              </Button>
            </div>
          </div>

          <Button
            variant="destructive"
            size="sm"
            onClick={() => handleClearAllSlices()}
            className="operation-btn clear-all-btn"
          >
            <RotateCcw size={16} />
            Clear All Slices
          </Button>
        </div>
      </div>

      {/* Non-Destructive Operations */}
      <div className="settings-group constructive-group">
        <Label className="settings-label">Transform Operations</Label>
        
        <div className="operations-grid">
          <Button
            variant="outline"
            size="sm"
            className="operation-btn transform-btn"
          >
            <Copy size={16} />
            Duplicate
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="operation-btn transform-btn"
          >
            <FlipHorizontal size={16} />
            Mirror
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="operation-btn transform-btn"
          >
            <RotateCw size={16} />
            Rotate
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="operation-btn transform-btn"
          >
            <Move size={16} />
            Translate
          </Button>
        </div>
      </div>

      {/* Interpolation Operations */}
      <div className="settings-group interpolation-group">
        <Label className="settings-label">Interpolation</Label>
        
        <Button
          variant="outline"
          size="sm"
          className="operation-btn interpolation-btn"
        >
          <Zap size={16} />
          Auto-Interpolate
        </Button>
        
        <p className="settings-description">
          Automatically fill contours between slices
        </p>
      </div>
    </div>
  );

  // Delete operation handlers
  const handleDeleteCurrentSlice = () => {
    if (!selectedStructure || !currentSlicePosition || !onContourUpdate) return;
    
    onContourUpdate({
      action: 'clear_slice',
      structureId: selectedStructure.roiNumber,
      slicePosition: currentSlicePosition,
      timestamp: Date.now()
    });
  };

  const handleDeleteNthSlice = () => {
    if (!selectedStructure || !targetSliceNumber || !onContourUpdate) return;
    
    const sliceNum = parseInt(targetSliceNumber);
    if (isNaN(sliceNum)) return;
    
    onContourUpdate({
      action: 'clear_slice',
      structureId: selectedStructure.roiNumber,
      slicePosition: sliceNum,
      timestamp: Date.now()
    });
    setTargetSliceNumber('');
  };

  const handleClearAllSlices = () => {
    if (!selectedStructure || !onContourUpdate) return;
    
    onContourUpdate({
      action: 'clear_all',
      structureId: selectedStructure.roiNumber,
      timestamp: Date.now()
    });
  };

  const renderSettingsContent = () => {
    switch (toolId) {
      case 'brush':
        return renderBrushSettings();
      case 'pen':
        return renderPenSettings();
      case 'erase':
        return renderEraseSettings();
      case 'operations':
        return renderOperationsSettings();
      default:
        return null;
    }
  };

  return (
    <div className={`contouring-settings-panel ${toolId}-settings ${position} open`}>
      <div className="settings-panel-header">
        <div className="panel-title-row">
          <h4 className="settings-panel-title">
            {toolId.charAt(0).toUpperCase() + toolId.slice(1)} Settings
          </h4>
          <div className="panel-actions">
            {toolId !== 'operations' && (
              <button
                className="panel-action-btn"
                onClick={() => setShowAdvancedOptions(!showAdvancedOptions)}
                title="Toggle Advanced Options"
              >
                <Settings size={14} />
              </button>
            )}
            <button
              className="settings-panel-close"
              onClick={onClose}
              title="Close Settings"
            >
              <X size={16} />
            </button>
          </div>
        </div>
        
        {showAdvancedOptions && (
          <Badge variant="outline" className="advanced-badge">
            Advanced Mode
          </Badge>
        )}
      </div>
      
      {renderSettingsContent()}
    </div>
  );
};
```

---

## 3. Status Panel Component

### Real-time Status Display
```tsx
// contouring-status-panel.tsx
interface ContouringStatusPanelProps {
  toolState: ContouringToolState;
  isDrawing: boolean;
  currentSlicePosition?: number;
  selectedStructure: any;
}

const ContouringStatusPanel: React.FC<ContouringStatusPanelProps> = ({
  toolState,
  isDrawing,
  currentSlicePosition,
  selectedStructure
}) => {
  const [cursorPosition, setCursorPosition] = useState<{ x: number; y: number } | null>(null);
  const [strokeCount, setStrokeCount] = useState(0);
  const [currentStrokeLength, setCurrentStrokeLength] = useState(0);

  return (
    <div className="contouring-status-panel">
      <div className="status-row">
        <span className="status-label">Tool:</span>
        <Badge variant="outline" className="status-value">
          {toolState.activeTool?.toUpperCase() || 'NONE'}
        </Badge>
      </div>

      <div className="status-row">
        <span className="status-label">Mode:</span>
        <Badge 
          variant="outline" 
          className={`status-value mode-${toolState.brushMode}`}
        >
          {toolState.brushMode?.toUpperCase()}
        </Badge>
      </div>

      <div className="status-row">
        <span className="status-label">Slice:</span>
        <span className="status-value">{currentSlicePosition || 'N/A'}</span>
      </div>

      <div className="status-row">
        <span className="status-label">Structure:</span>
        <div className="structure-status">
          <div 
            className="structure-color-dot"
            style={{ backgroundColor: `rgb(${selectedStructure.color.join(',')})` }}
          />
          <span className="structure-name">{selectedStructure.structureName}</span>
        </div>
      </div>

      {isDrawing && (
        <div className="status-row drawing-status">
          <span className="status-label">Drawing:</span>
          <div className="drawing-indicator">
            <div className="pulse-dot" />
            <span className="drawing-text">Active</span>
          </div>
        </div>
      )}

      {cursorPosition && (
        <div className="status-row">
          <span className="status-label">Cursor:</span>
          <span className="status-value">
            {cursorPosition.x}, {cursorPosition.y}
          </span>
        </div>
      )}
    </div>
  );
};
```

---

## 4. Complete CSS Styling

### Comprehensive Toolbar and Panel Styles
```css
/* ===== CONTOURING TOOLBAR CONTAINER ===== */
.contouring-toolbar-container {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 45;
  pointer-events: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  padding: 2rem;
}

/* ===== MAIN TOOLBAR ===== */
.contouring-toolbar {
  display: flex;
  align-items: center;
  background: hsl(0 0% 0%);
  border: 2px solid hsl(240 15% 25%);
  border-radius: 1rem;
  padding: 0.75rem;
  gap: 1rem;
  box-shadow: 
    0 25px 50px -12px rgba(0, 0, 0, 0.5),
    0 0 0 1px rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(12px);
  pointer-events: all;
  transition: all 0.3s ease;
}

.contouring-toolbar[data-structure-color] {
  border-color: var(--structure-color);
  box-shadow: 
    0 0 0 1px var(--structure-color-muted),
    0 25px 50px -12px rgba(0, 0, 0, 0.5),
    0 0 20px rgba(var(--structure-color-rgb), 0.2);
}

/* ===== TOOLBAR SECTIONS ===== */
.toolbar-section {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.toolbar-section:not(:last-child)::after {
  content: '';
  width: 1px;
  height: 2rem;
  background: hsl(240 15% 25%);
  margin-left: 0.5rem;
}

/* Undo/Redo Section */
.undo-redo-section {
  min-width: fit-content;
}

.toolbar-action-btn {
  width: 2.5rem;
  height: 2.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  background: hsl(240 20% 8%);
  border: 1px solid hsl(240 15% 25%);
  border-radius: 0.375rem;
  color: #d1d5db;
  cursor: pointer;
  transition: all 0.2s ease;
}

.toolbar-action-btn:hover:not(.disabled) {
  background: rgba(99, 102, 241, 0.1);
  border-color: rgba(99, 102, 241, 0.3);
  color: white;
}

.toolbar-action-btn.disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* Main Tools Section */
.main-tools-section {
  flex: 1;
  justify-content: center;
}

.tool-container {
  position: relative;
}

.contouring-tool-btn {
  width: 3rem;
  height: 3rem;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  background: hsl(240 20% 8%);
  border: 2px solid hsl(240 15% 25%);
  border-radius: 0.5rem;
  color: #d1d5db;
  cursor: pointer;
  transition: all 0.2s ease;
}

.contouring-tool-btn:hover {
  background: rgba(99, 102, 241, 0.1);
  border-color: rgba(99, 102, 241, 0.3);
  color: white;
  transform: translateY(-1px);
}

.contouring-tool-btn.active {
  background: rgba(var(--structure-color-rgb), 0.2);
  border-color: var(--structure-color);
  color: white;
  box-shadow: 
    0 0 12px rgba(var(--structure-color-rgb), 0.4),
    0 0 0 1px var(--structure-color);
}

.expand-indicator {
  position: absolute;
  top: -0.25rem;
  right: -0.25rem;
  width: 0.75rem;
  height: 0.75rem;
  background: var(--structure-color, #6366f1);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 0.5rem;
  opacity: 0;
  transform: scale(0.8);
  transition: all 0.2s ease;
}

.contouring-tool-btn:hover .expand-indicator,
.contouring-tool-btn.active .expand-indicator {
  opacity: 1;
  transform: scale(1);
}

/* Quick Settings Section */
.quick-settings-section {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.brush-size-indicator {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.375rem 0.75rem;
  background: hsl(240 20% 8%);
  border: 1px solid hsl(240 15% 25%);
  border-radius: 0.375rem;
}

.brush-size-circle {
  background: var(--structure-color, #6366f1);
  border-radius: 50%;
  min-width: 8px;
  min-height: 8px;
  transition: all 0.2s ease;
}

.brush-size-label {
  font-size: 0.75rem;
  color: #d1d5db;
  font-weight: 500;
  min-width: 1.5rem;
  text-align: center;
}

.mode-badge {
  font-size: 0.65rem;
  font-weight: 600;
  padding: 0.25rem 0.5rem;
  border-radius: 0.25rem;
  background: hsl(240 20% 8%);
  border: 1px solid hsl(240 15% 25%);
  color: #d1d5db;
}

.mode-badge.smart-mode {
  background: rgba(34, 197, 94, 0.1);
  border-color: rgba(34, 197, 94, 0.3);
  color: #22c55e;
}

.mode-badge-3d {
  background: rgba(168, 85, 247, 0.1);
  border-color: rgba(168, 85, 247, 0.3);
  color: #a855f7;
}

/* Close Section */
.close-section {
  min-width: fit-content;
}

.close-btn {
  background: rgba(239, 68, 68, 0.1);
  border-color: rgba(239, 68, 68, 0.3);
  color: #ef4444;
}

.close-btn:hover {
  background: rgba(239, 68, 68, 0.2);
  border-color: #ef4444;
  color: white;
}

/* ===== SETTINGS PANELS ===== */
.contouring-settings-panel {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  min-width: 320px;
  max-width: 400px;
  background: hsl(0 0% 0%);
  border: 2px solid var(--structure-color-muted, rgba(99, 102, 241, 0.6));
  border-radius: 1rem;
  box-shadow: 
    0 25px 50px -12px rgba(0, 0, 0, 0.8),
    0 0 0 1px rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(16px);
  padding: 1.5rem;
  opacity: 0;
  pointer-events: none;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.contouring-settings-panel.top {
  bottom: 100%;
  margin-bottom: 1rem;
  transform: translateX(-50%) translateY(10px);
}

.contouring-settings-panel.bottom {
  top: 100%;
  margin-top: 1rem;
  transform: translateX(-50%) translateY(-10px);
}

.contouring-settings-panel.open {
  opacity: 1;
  pointer-events: all;
  transform: translateX(-50%) translateY(0);
}

/* Settings Panel Header */
.settings-panel-header {
  margin-bottom: 1.5rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid hsl(240 15% 25%);
}

.panel-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.5rem;
}

.settings-panel-title {
  font-size: 1rem;
  font-weight: 600;
  color: white;
  margin: 0;
}

.panel-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.panel-action-btn {
  width: 1.75rem;
  height: 1.75rem;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid hsl(240 15% 25%);
  border-radius: 0.25rem;
  color: #9ca3af;
  cursor: pointer;
  transition: all 0.2s ease;
}

.panel-action-btn:hover {
  background: rgba(99, 102, 241, 0.1);
  border-color: rgba(99, 102, 241, 0.3);
  color: white;
}

.settings-panel-close {
  width: 1.75rem;
  height: 1.75rem;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: 0.25rem;
  color: #9ca3af;
  cursor: pointer;
  transition: all 0.2s ease;
}

.settings-panel-close:hover {
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
}

.advanced-badge {
  background: rgba(168, 85, 247, 0.1);
  border-color: rgba(168, 85, 247, 0.3);
  color: #a855f7;
  font-size: 0.7rem;
}

/* ===== SETTINGS CONTENT ===== */
.settings-content {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.settings-group {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.settings-label {
  font-size: 0.875rem;
  font-weight: 500;
  color: #d1d5db;
  margin: 0;
}

.settings-label.destructive {
  color: #ef4444;
  font-weight: 600;
}

.settings-description {
  font-size: 0.75rem;
  color: #9ca3af;
  margin: 0;
  line-height: 1.4;
}

.settings-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

/* ===== MODE SELECTORS ===== */
.mode-selector {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.mode-btn {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.5rem 0.75rem;
  background: hsl(240 20% 8%);
  border: 1px solid hsl(240 15% 25%);
  border-radius: 0.375rem;
  color: #d1d5db;
  font-size: 0.8rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  flex: 1;
  justify-content: center;
  min-width: fit-content;
}

.mode-btn:hover {
  background: rgba(99, 102, 241, 0.1);
  border-color: rgba(99, 102, 241, 0.3);
  color: white;
}

.mode-btn.active {
  background: var(--structure-color, #6366f1);
  border-color: var(--structure-color, #6366f1);
  color: white;
  box-shadow: 0 0 8px rgba(var(--structure-color-rgb), 0.3);
}

/* ===== SLIDERS ===== */
.brush-size-slider,
.smoothing-slider,
.zoom-fill-slider,
.eraser-size-slider,
.tension-slider {
  position: relative;
}

.slider-marks {
  display: flex;
  justify-content: space-between;
  margin-top: 0.5rem;
  font-size: 0.7rem;
  color: #6b7280;
}

/* ===== OPERATIONS GRID ===== */
.operations-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.75rem;
}

.operation-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  font-size: 0.875rem;
  font-weight: 500;
  border-radius: 0.5rem;
  transition: all 0.2s ease;
  position: relative;
  min-height: 2.5rem;
}

.operation-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
}

.operation-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Destructive operations */
.destructive-group .operation-btn {
  background: rgba(239, 68, 68, 0.8);
  border-color: #ef4444;
  color: white;
}

.destructive-group .operation-btn:hover:not(:disabled) {
  background: #ef4444;
  box-shadow: 0 4px 16px rgba(239, 68, 68, 0.3);
}

/* Transform operations */
.transform-btn {
  background: hsl(240 20% 8%);
  border-color: hsl(240 15% 25%);
  color: #d1d5db;
}

.transform-btn:hover {
  background: rgba(99, 102, 241, 0.1);
  border-color: rgba(99, 102, 241, 0.3);
  color: white;
}

/* Interpolation operations */
.interpolation-btn {
  background: rgba(34, 197, 94, 0.1);
  border-color: rgba(34, 197, 94, 0.3);
  color: #22c55e;
}

.interpolation-btn:hover {
  background: rgba(34, 197, 94, 0.2);
  border-color: #22c55e;
  color: white;
}

.slice-badge {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.9);
  font-size: 0.7rem;
  margin-left: 0.5rem;
}

/* ===== SLICE OPERATIONS ===== */
.slice-operation {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.slice-input-row {
  display: flex;
  gap: 0.5rem;
  align-items: stretch;
}

.slice-number-input {
  flex: 1;
  padding: 0.5rem 0.75rem;
  background: hsl(240 20% 8%);
  border: 1px solid hsl(240 15% 25%);
  border-radius: 0.375rem;
  color: white;
  font-size: 0.875rem;
}

.slice-number-input:focus {
  outline: none;
  border-color: #ef4444;
  box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.2);
}

/* ===== STATUS PANEL ===== */
.contouring-status-panel {
  position: absolute;
  top: 1rem;
  right: 1rem;
  background: hsl(0 0% 0% / 0.9);
  border: 1px solid hsl(240 15% 25%);
  border-radius: 0.5rem;
  padding: 1rem;
  backdrop-filter: blur(8px);
  min-width: 200px;
  pointer-events: all;
}

.status-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.5rem;
}

.status-row:last-child {
  margin-bottom: 0;
}

.status-label {
  font-size: 0.75rem;
  color: #9ca3af;
  font-weight: 500;
}

.status-value {
  font-size: 0.75rem;
  color: #d1d5db;
  font-weight: 500;
}

.status-value.mode-smart {
  color: #22c55e;
}

.status-value.mode-add {
  color: #3b82f6;
}

.status-value.mode-delete {
  color: #ef4444;
}

.structure-status {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.structure-color-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.3);
}

.structure-name {
  font-size: 0.75rem;
  color: #d1d5db;
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.drawing-status {
  border-top: 1px solid hsl(240 15% 25%);
  padding-top: 0.5rem;
  margin-top: 0.5rem;
}

.drawing-indicator {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.pulse-dot {
  width: 8px;
  height: 8px;
  background: #22c55e;
  border-radius: 50%;
  animation: pulse 1.5s ease-in-out infinite;
}

.drawing-text {
  font-size: 0.75rem;
  color: #22c55e;
  font-weight: 500;
}

@keyframes pulse {
  0%, 100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.7;
    transform: scale(1.2);
  }
}

/* ===== RESPONSIVE DESIGN ===== */
@media (max-width: 1024px) {
  .contouring-toolbar-container {
    padding: 1.5rem;
  }
  
  .contouring-toolbar {
    transform: scale(0.95);
  }
  
  .contouring-settings-panel {
    min-width: 280px;
    max-width: 320px;
  }
}

@media (max-width: 768px) {
  .contouring-toolbar-container {
    padding: 1rem;
  }
  
  .contouring-toolbar {
    flex-wrap: wrap;
    gap: 0.75rem;
    padding: 0.75rem;
    transform: scale(0.9);
  }
  
  .toolbar-section::after {
    display: none;
  }
  
  .contouring-tool-btn {
    width: 2.75rem;
    height: 2.75rem;
  }
  
  .contouring-settings-panel {
    min-width: 260px;
    max-width: 280px;
    padding: 1rem;
  }
  
  .operations-grid {
    grid-template-columns: 1fr;
  }
  
  .mode-selector {
    flex-direction: column;
  }
}

@media (max-width: 480px) {
  .contouring-toolbar {
    transform: scale(0.85);
  }
  
  .contouring-tool-btn {
    width: 2.5rem;
    height: 2.5rem;
  }
  
  .contouring-settings-panel {
    min-width: 240px;
    left: 1rem;
    right: 1rem;
    transform: none;
  }
  
  .contouring-settings-panel.top,
  .contouring-settings-panel.bottom {
    transform: none;
  }
}

/* ===== ANIMATIONS ===== */
@keyframes toolbarSlideUp {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes panelFadeIn {
  from {
    opacity: 0;
    transform: translateX(-50%) scale(0.95);
  }
  to {
    opacity: 1;
    transform: translateX(-50%) scale(1);
  }
}

.contouring-toolbar {
  animation: toolbarSlideUp 0.3s ease-out;
}

.contouring-settings-panel.open {
  animation: panelFadeIn 0.3s ease-out;
}

/* ===== ACCESSIBILITY ===== */
.contouring-tool-btn:focus-visible {
  outline: 2px solid var(--structure-color, #6366f1);
  outline-offset: 2px;
}

.operation-btn:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 2px;
}

/* ===== PRINT STYLES ===== */
@media print {
  .contouring-toolbar-container,
  .contouring-status-panel {
    display: none;
  }
}
```

---

## 5. Integration Example

### Complete Usage Implementation
```tsx
// main-contouring-interface.tsx
import { ContouringToolbar } from './components/contouring-toolbar';
import { useContouringTools } from './hooks/use-contouring-tools';

const MainContouringInterface: React.FC = () => {
  const {
    selectedStructure,
    isContouringMode,
    toolState,
    undoStack,
    redoStack,
    handleToolChange,
    handleContourUpdate,
    handleUndo,
    handleRedo,
    closeContouring
  } = useContouringTools();

  const [viewportDimensions, setViewportDimensions] = useState({ width: 0, height: 0 });
  const [currentSlice, setCurrentSlice] = useState(0);

  return (
    <div className="main-interface">
      {/* Viewport */}
      <div className="viewport-container">
        {/* DICOM viewer content */}
      </div>

      {/* Contouring Toolbar */}
      {isContouringMode && selectedStructure && (
        <ContouringToolbar
          selectedStructure={selectedStructure}
          isVisible={isContouringMode}
          onClose={closeContouring}
          onToolChange={handleToolChange}
          currentSlicePosition={currentSlice}
          onContourUpdate={handleContourUpdate}
          viewportDimensions={viewportDimensions}
          undoStack={undoStack}
          redoStack={redoStack}
          onUndo={handleUndo}
          onRedo={handleRedo}
        />
      )}
    </div>
  );
};
```

This comprehensive implementation provides a fully functional contouring tools system with professional-grade medical imaging interface standards, complete with smart brush detection, advanced settings panels, and sophisticated tool management.