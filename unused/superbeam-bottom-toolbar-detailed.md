# Superbeam Bottom Toolbar - Detailed Implementation Guide

## Complete Code & Styling for Contour Editing Toolbar System

This document provides comprehensive implementation details for Superbeam's bottom contour editing toolbar, including React components, CSS styling, and JavaScript functionality.

---

## 1. Main Toolbar Component Structure

### React Component Implementation
```tsx
// contour-edit-toolbar.tsx
import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { 
  Brush, 
  Pen, 
  Eraser, 
  Settings, 
  X, 
  ChevronRight,
  Trash2,
  RotateCcw,
  Zap
} from 'lucide-react';

interface ContourEditToolbarProps {
  selectedStructure: {
    structureName: string;
    color: number[];
    roiNumber: number;
  } | null;
  isVisible: boolean;
  onClose: () => void;
  onStructureNameChange: (name: string) => void;
  onStructureColorChange: (color: string) => void;
  onToolChange?: (toolState: { tool: string | null; brushSize: number; isActive: boolean }) => void;
  currentSlicePosition?: number;
  onContourUpdate?: (updatedStructures: any) => void;
}

export const ContourEditToolbar: React.FC<ContourEditToolbarProps> = ({
  selectedStructure,
  isVisible,
  onClose,
  onStructureNameChange,
  onStructureColorChange,
  onToolChange,
  currentSlicePosition,
  onContourUpdate
}) => {
  // State management
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState<string | null>(null);
  const [brushThickness, setBrushThickness] = useState([3]);
  const [is3D, setIs3D] = useState(false);
  const [smartBrush, setSmartBrush] = useState(true);
  const [targetSliceNumber, setTargetSliceNumber] = useState('');
  const [autoZoomEnabled, setAutoZoomEnabled] = useState(true);
  const [autoLocalizeEnabled, setAutoLocalizeEnabled] = useState(true);
  const [zoomFillFactor, setZoomFillFactor] = useState([40]);

  // Refs for positioning
  const toolbarRef = useRef<HTMLDivElement>(null);
  const settingsPanelRef = useRef<HTMLDivElement>(null);

  // Tool definitions
  const tools = [
    { id: 'brush', icon: Brush, label: 'Brush Tool', hasSettings: true },
    { id: 'pen', icon: Pen, label: 'Pen Tool', hasSettings: true },
    { id: 'erase', icon: Eraser, label: 'Erase Tool', hasSettings: true },
    { id: 'operations', icon: Settings, label: 'Operations', hasSettings: true }
  ];

  // Dynamic CSS variables based on structure color
  useEffect(() => {
    if (selectedStructure && toolbarRef.current) {
      const [r, g, b] = selectedStructure.color;
      const structureColor = `rgb(${r}, ${g}, ${b})`;
      const structureColorMuted = `rgba(${r}, ${g}, ${b}, 0.6)`;
      
      toolbarRef.current.style.setProperty('--structure-color', structureColor);
      toolbarRef.current.style.setProperty('--structure-color-rgb', `${r}, ${g}, ${b}`);
      toolbarRef.current.style.setProperty('--structure-color-muted', structureColorMuted);
      toolbarRef.current.setAttribute('data-structure-color', structureColor);
    }
  }, [selectedStructure]);

  // Tool change handler
  const handleToolChange = (toolId: string) => {
    const newActiveTool = activeTool === toolId ? null : toolId;
    setActiveTool(newActiveTool);
    
    if (onToolChange) {
      onToolChange({
        tool: newActiveTool,
        brushSize: brushThickness[0],
        isActive: newActiveTool !== null
      });
    }
  };

  // Settings panel toggle
  const handleSettingsToggle = (toolId: string) => {
    setShowSettings(showSettings === toolId ? null : toolId);
  };

  if (!isVisible || !selectedStructure) return null;

  return (
    <>
      {/* Main Toolbar */}
      <div 
        ref={toolbarRef}
        className="contour-toolbar"
        data-structure-color={`rgb(${selectedStructure.color.join(',')})`}
      >
        {tools.map((tool) => (
          <div key={tool.id} className="tool-container">
            <button
              className={`contour-tool-btn ${activeTool === tool.id ? 'active' : ''}`}
              onClick={() => handleToolChange(tool.id)}
              onMouseEnter={() => tool.hasSettings && setShowSettings(tool.id)}
              title={tool.label}
            >
              <tool.icon size={20} />
              {tool.hasSettings && (
                <div className="expand-indicator">
                  <ChevronRight size={10} />
                </div>
              )}
            </button>

            {/* Settings Panel */}
            {showSettings === tool.id && (
              <SettingsPanel
                ref={settingsPanelRef}
                toolId={tool.id}
                selectedStructure={selectedStructure}
                brushThickness={brushThickness}
                setBrushThickness={setBrushThickness}
                is3D={is3D}
                setIs3D={setIs3D}
                smartBrush={smartBrush}
                setSmartBrush={setSmartBrush}
                targetSliceNumber={targetSliceNumber}
                setTargetSliceNumber={setTargetSliceNumber}
                autoZoomEnabled={autoZoomEnabled}
                setAutoZoomEnabled={setAutoZoomEnabled}
                autoLocalizeEnabled={autoLocalizeEnabled}
                setAutoLocalizeEnabled={setAutoLocalizeEnabled}
                zoomFillFactor={zoomFillFactor}
                setZoomFillFactor={setZoomFillFactor}
                currentSlicePosition={currentSlicePosition}
                onClose={() => setShowSettings(null)}
                onContourUpdate={onContourUpdate}
              />
            )}
          </div>
        ))}

        {/* Close Button */}
        <button
          className="contour-tool-btn close-btn"
          onClick={onClose}
          title="Close Contour Editor"
        >
          <X size={20} />
        </button>
      </div>
    </>
  );
};
```

---

## 2. Settings Panel Component

### Settings Panel Implementation
```tsx
// settings-panel.tsx
interface SettingsPanelProps {
  toolId: string;
  selectedStructure: any;
  brushThickness: number[];
  setBrushThickness: (value: number[]) => void;
  is3D: boolean;
  setIs3D: (value: boolean) => void;
  smartBrush: boolean;
  setSmartBrush: (value: boolean) => void;
  targetSliceNumber: string;
  setTargetSliceNumber: (value: string) => void;
  autoZoomEnabled: boolean;
  setAutoZoomEnabled: (value: boolean) => void;
  autoLocalizeEnabled: boolean;
  setAutoLocalizeEnabled: (value: boolean) => void;
  zoomFillFactor: number[];
  setZoomFillFactor: (value: number[]) => void;
  currentSlicePosition?: number;
  onClose: () => void;
  onContourUpdate?: (payload: any) => void;
}

const SettingsPanel = React.forwardRef<HTMLDivElement, SettingsPanelProps>(({
  toolId,
  selectedStructure,
  brushThickness,
  setBrushThickness,
  is3D,
  setIs3D,
  smartBrush,
  setSmartBrush,
  targetSliceNumber,
  setTargetSliceNumber,
  autoZoomEnabled,
  setAutoZoomEnabled,
  autoLocalizeEnabled,
  setAutoLocalizeEnabled,
  zoomFillFactor,
  setZoomFillFactor,
  currentSlicePosition,
  onClose,
  onContourUpdate
}, ref) => {
  // Delete operation handlers
  const handleDeleteCurrentSlice = () => {
    if (!selectedStructure || !currentSlicePosition || !onContourUpdate) return;
    
    const updatePayload = {
      action: 'delete_slice',
      structureId: selectedStructure.roiNumber,
      slicePosition: currentSlicePosition
    };
    onContourUpdate(updatePayload);
  };

  const handleDeleteNthSlice = () => {
    if (!selectedStructure || !targetSliceNumber || !onContourUpdate) return;
    
    const sliceNum = parseInt(targetSliceNumber);
    if (isNaN(sliceNum)) return;
    
    const updatePayload = {
      action: 'delete_slice',
      structureId: selectedStructure.roiNumber,
      slicePosition: sliceNum
    };
    onContourUpdate(updatePayload);
    setTargetSliceNumber('');
  };

  const handleClearAllSlices = () => {
    if (!selectedStructure || !onContourUpdate) return;
    
    const updatePayload = {
      action: 'clear_all',
      structureId: selectedStructure.roiNumber
    };
    onContourUpdate(updatePayload);
  };

  const renderBrushSettings = () => (
    <div className="settings-content">
      <div className="settings-group">
        <Label className="settings-label">
          Brush Size: {brushThickness[0]}px
        </Label>
        <Slider
          value={brushThickness}
          onValueChange={setBrushThickness}
          max={50}
          min={1}
          step={1}
          className="brush-thickness-slider"
        />
      </div>

      <div className="settings-group">
        <div className="settings-toggle">
          <Label className="settings-label">3D Mode</Label>
          <Switch
            checked={is3D}
            onCheckedChange={setIs3D}
            className="toggle-switch"
          />
        </div>
      </div>

      <div className="settings-group">
        <div className="settings-toggle">
          <Label className="settings-label">Smart Brush</Label>
          <Switch
            checked={smartBrush}
            onCheckedChange={setSmartBrush}
            className="toggle-switch"
          />
        </div>
        <p className="settings-description">
          Automatically detects add/delete mode based on contour intersection
        </p>
      </div>

      <div className="settings-group">
        <div className="settings-toggle">
          <Label className="settings-label">Auto-Zoom</Label>
          <Switch
            checked={autoZoomEnabled}
            onCheckedChange={setAutoZoomEnabled}
            className="toggle-switch"
          />
        </div>
      </div>

      <div className="settings-group">
        <div className="settings-toggle">
          <Label className="settings-label">Auto-Localize</Label>
          <Switch
            checked={autoLocalizeEnabled}
            onCheckedChange={setAutoLocalizeEnabled}
            className="toggle-switch"
          />
        </div>
      </div>

      {autoZoomEnabled && (
        <div className="settings-group">
          <Label className="settings-label">
            Zoom Fill Factor: {zoomFillFactor[0]}%
          </Label>
          <Slider
            value={zoomFillFactor}
            onValueChange={setZoomFillFactor}
            max={80}
            min={20}
            step={5}
            className="zoom-fill-slider"
          />
        </div>
      )}
    </div>
  );

  const renderPenSettings = () => (
    <div className="settings-content">
      <div className="settings-group">
        <Label className="settings-label">Pen Mode</Label>
        <div className="pen-mode-buttons">
          <Button variant="outline" size="sm" className="mode-btn">
            Draw
          </Button>
          <Button variant="outline" size="sm" className="mode-btn">
            Edit Points
          </Button>
        </div>
      </div>

      <div className="settings-group">
        <div className="settings-toggle">
          <Label className="settings-label">Snap to Grid</Label>
          <Switch className="toggle-switch" />
        </div>
      </div>

      <div className="settings-group">
        <div className="settings-toggle">
          <Label className="settings-label">Auto-Close Path</Label>
          <Switch defaultChecked className="toggle-switch" />
        </div>
      </div>
    </div>
  );

  const renderEraseSettings = () => (
    <div className="settings-content">
      <div className="settings-group">
        <Label className="settings-label">
          Eraser Size: {brushThickness[0]}px
        </Label>
        <Slider
          value={brushThickness}
          onValueChange={setBrushThickness}
          max={50}
          min={1}
          step={1}
          className="brush-thickness-slider"
        />
      </div>

      <div className="settings-group">
        <Label className="settings-label">Erase Mode</Label>
        <div className="erase-mode-buttons">
          <Button variant="outline" size="sm" className="mode-btn">
            Brush
          </Button>
          <Button variant="outline" size="sm" className="mode-btn">
            Contour
          </Button>
        </div>
      </div>

      <div className="settings-group">
        <div className="settings-toggle">
          <Label className="settings-label">Preserve Holes</Label>
          <Switch className="toggle-switch" />
        </div>
      </div>
    </div>
  );

  const renderOperationsSettings = () => (
    <div className="settings-content delete-operations">
      <div className="settings-group">
        <Label className="settings-label destructive">Destructive Operations</Label>
        <p className="settings-description">
          These operations cannot be undone. Use with caution.
        </p>
      </div>

      <div className="settings-group">
        <Button
          variant="destructive"
          size="sm"
          onClick={handleDeleteCurrentSlice}
          className="delete-btn"
          disabled={!currentSlicePosition}
        >
          <Trash2 size={16} />
          Delete Current Slice ({currentSlicePosition || 'N/A'})
        </Button>
      </div>

      <div className="settings-group">
        <div className="slice-input-group">
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
            onClick={handleDeleteNthSlice}
            className="delete-btn"
            disabled={!targetSliceNumber}
          >
            <Trash2 size={16} />
            Delete
          </Button>
        </div>
      </div>

      <div className="settings-group">
        <Button
          variant="destructive"
          size="sm"
          onClick={handleClearAllSlices}
          className="delete-btn clear-all-btn"
        >
          <RotateCcw size={16} />
          Clear All Slices
        </Button>
      </div>
    </div>
  );

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
    <div ref={ref} className={`contour-settings-panel ${toolId}-settings open`}>
      <div className="settings-panel-header">
        <h4 className="settings-panel-title">
          {toolId.charAt(0).toUpperCase() + toolId.slice(1)} Settings
        </h4>
        <button
          className="settings-panel-close"
          onClick={onClose}
          title="Close Settings"
        >
          <X size={16} />
        </button>
      </div>
      
      {renderSettingsContent()}
    </div>
  );
});

SettingsPanel.displayName = 'SettingsPanel';
```

---

## 3. Complete CSS Styling

### Main Toolbar Styles
```css
/* ===== MAIN TOOLBAR CONTAINER ===== */
.contour-toolbar {
  /* Positioning */
  position: fixed;
  bottom: 2rem;
  left: 50%;
  transform: translateX(-50%);
  z-index: 45;
  
  /* Layout */
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem;
  
  /* Appearance */
  background: hsl(0 0% 0%); /* Pure black background */
  border: 2px solid hsl(240 15% 25%); /* Default gray border */
  border-radius: 0.75rem;
  box-shadow: 
    0 25px 50px -12px rgba(0, 0, 0, 0.5),
    0 0 0 1px rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(8px);
  
  /* Transitions */
  transition: all 0.3s ease;
}

/* Dynamic border coloring based on selected structure */
.contour-toolbar[data-structure-color] {
  border-color: var(--structure-color);
  box-shadow: 
    0 0 0 1px var(--structure-color-muted),
    0 25px 50px -12px rgba(0, 0, 0, 0.5),
    0 0 20px rgba(var(--structure-color-rgb), 0.2);
}

/* ===== TOOL BUTTONS ===== */
.tool-container {
  position: relative;
  display: flex;
  align-items: center;
}

.contour-tool-btn {
  /* Dimensions */
  width: 3rem;
  height: 3rem;
  
  /* Layout */
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  
  /* Appearance */
  background: hsl(240 20% 8%); /* Dark background */
  border: 2px solid hsl(240 15% 25%); /* Gray border */
  border-radius: 0.5rem;
  color: #d1d5db; /* Light gray text */
  
  /* Interaction */
  cursor: pointer;
  transition: all 0.2s ease;
  
  /* Remove default button styles */
  outline: none;
  font-family: inherit;
}

/* Hover State */
.contour-tool-btn:hover {
  background: rgba(99, 102, 241, 0.1);
  border-color: rgba(99, 102, 241, 0.3);
  color: white;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(99, 102, 241, 0.2);
}

/* Active State (Tool Selected) */
.contour-tool-btn.active {
  background: rgba(var(--structure-color-rgb), 0.2);
  border-color: var(--structure-color);
  color: white;
  box-shadow: 
    0 0 12px rgba(var(--structure-color-rgb), 0.4),
    0 0 0 1px var(--structure-color);
}

/* Close Button Specific Styling */
.contour-tool-btn.close-btn {
  background: rgba(239, 68, 68, 0.1);
  border-color: rgba(239, 68, 68, 0.3);
  color: #ef4444;
  margin-left: 0.5rem;
}

.contour-tool-btn.close-btn:hover {
  background: rgba(239, 68, 68, 0.2);
  border-color: #ef4444;
  color: white;
}

/* ===== EXPAND INDICATORS ===== */
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
  
  font-size: 0.5rem;
  color: white;
  
  opacity: 0;
  transform: scale(0.8);
  transition: all 0.2s ease;
}

.contour-tool-btn:hover .expand-indicator {
  opacity: 1;
  transform: scale(1);
}

.contour-tool-btn.active .expand-indicator {
  opacity: 1;
  transform: scale(1);
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.1); }
}

/* ===== SETTINGS PANELS ===== */
.contour-settings-panel {
  /* Positioning */
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%) translateY(10px);
  margin-bottom: 0.5rem;
  
  /* Dimensions */
  min-width: 280px;
  max-width: 320px;
  
  /* Appearance */
  background: hsl(0 0% 0%); /* Pure black */
  border: 2px solid var(--structure-color-muted, rgba(99, 102, 241, 0.6));
  border-radius: 0.75rem;
  box-shadow: 
    0 25px 50px -12px rgba(0, 0, 0, 0.8),
    0 0 0 1px rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(12px);
  
  /* Layout */
  padding: 1rem;
  
  /* Animation */
  opacity: 0;
  pointer-events: none;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.contour-settings-panel.open {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
  pointer-events: all;
}

/* ===== SETTINGS PANEL HEADER ===== */
.settings-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid hsl(240 15% 25%);
}

.settings-panel-title {
  font-size: 0.875rem;
  font-weight: 600;
  color: white;
  margin: 0;
}

.settings-panel-close {
  width: 1.5rem;
  height: 1.5rem;
  
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

/* ===== SETTINGS CONTENT ===== */
.settings-content {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.settings-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.settings-group:last-child {
  margin-bottom: 0;
}

.settings-label {
  font-size: 0.75rem;
  font-weight: 500;
  color: #d1d5db;
  margin: 0;
}

.settings-label.destructive {
  color: #ef4444;
  font-weight: 600;
}

.settings-description {
  font-size: 0.65rem;
  color: #9ca3af;
  margin: 0;
  line-height: 1.3;
}

/* ===== SLIDER STYLING ===== */
.brush-thickness-slider,
.zoom-fill-slider {
  width: 100%;
  height: 0.5rem;
  background: hsl(240 15% 25%);
  border-radius: 0.25rem;
  appearance: none;
  cursor: pointer;
  outline: none;
}

.brush-thickness-slider::-webkit-slider-thumb,
.zoom-fill-slider::-webkit-slider-thumb {
  appearance: none;
  width: 1rem;
  height: 1rem;
  background: var(--structure-color, #6366f1);
  border-radius: 50%;
  cursor: pointer;
  box-shadow: 0 0 8px rgba(var(--structure-color-rgb, 99, 102, 241), 0.4);
  transition: all 0.2s ease;
}

.brush-thickness-slider::-webkit-slider-thumb:hover,
.zoom-fill-slider::-webkit-slider-thumb:hover {
  transform: scale(1.1);
  box-shadow: 0 0 12px rgba(var(--structure-color-rgb), 0.6);
}

.brush-thickness-slider::-moz-range-thumb,
.zoom-fill-slider::-moz-range-thumb {
  width: 1rem;
  height: 1rem;
  background: var(--structure-color, #6366f1);
  border-radius: 50%;
  cursor: pointer;
  border: none;
  box-shadow: 0 0 8px rgba(var(--structure-color-rgb), 0.4);
}

/* ===== TOGGLE SWITCHES ===== */
.settings-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.toggle-switch {
  position: relative;
  width: 2.5rem;
  height: 1.25rem;
  background: hsl(240 15% 25%);
  border-radius: 0.625rem;
  cursor: pointer;
  transition: background-color 0.2s ease;
  border: none;
  outline: none;
}

.toggle-switch.checked,
.toggle-switch[data-state="checked"] {
  background: var(--structure-color, #6366f1);
}

.toggle-switch::after {
  content: '';
  position: absolute;
  top: 0.125rem;
  left: 0.125rem;
  width: 1rem;
  height: 1rem;
  background: white;
  border-radius: 50%;
  transition: transform 0.2s ease;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

.toggle-switch.checked::after,
.toggle-switch[data-state="checked"]::after {
  transform: translateX(1.25rem);
}

/* ===== MODE BUTTONS ===== */
.pen-mode-buttons,
.erase-mode-buttons {
  display: flex;
  gap: 0.5rem;
}

.mode-btn {
  flex: 1;
  padding: 0.375rem 0.75rem;
  background: hsl(240 20% 8%);
  border: 1px solid hsl(240 15% 25%);
  border-radius: 0.25rem;
  color: #d1d5db;
  font-size: 0.75rem;
  cursor: pointer;
  transition: all 0.2s ease;
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
}

/* ===== DELETE OPERATIONS STYLING ===== */
.delete-operations {
  border-color: rgba(239, 68, 68, 0.5);
}

.delete-btn {
  width: 100%;
  padding: 0.5rem 1rem;
  background: rgba(239, 68, 68, 0.8);
  border: 1px solid #ef4444;
  border-radius: 0.375rem;
  color: white;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
}

.delete-btn:hover:not(:disabled) {
  background: #ef4444;
  box-shadow: 0 4px 12px rgba(239, 68, 68, 0.3);
  transform: translateY(-1px);
}

.delete-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.clear-all-btn {
  background: rgba(239, 68, 68, 0.9);
  border-color: #dc2626;
}

.clear-all-btn:hover:not(:disabled) {
  background: #dc2626;
  box-shadow: 0 4px 16px rgba(220, 38, 38, 0.4);
}

/* ===== SLICE INPUT STYLING ===== */
.slice-input-group {
  display: flex;
  gap: 0.5rem;
  align-items: stretch;
}

.slice-number-input {
  flex: 1;
  padding: 0.375rem 0.5rem;
  background: hsl(240 20% 8%);
  border: 1px solid hsl(240 15% 25%);
  border-radius: 0.25rem;
  color: white;
  font-size: 0.875rem;
  outline: none;
}

.slice-number-input:focus {
  border-color: #ef4444;
  box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.2);
}

.slice-number-input::placeholder {
  color: #9ca3af;
}

/* ===== RESPONSIVE DESIGN ===== */
@media (max-width: 1024px) {
  .contour-toolbar {
    bottom: 1.5rem;
    transform: translateX(-50%) scale(0.95);
  }
  
  .contour-settings-panel {
    min-width: 260px;
    max-width: 280px;
  }
}

@media (max-width: 768px) {
  .contour-toolbar {
    bottom: 1rem;
    transform: translateX(-50%) scale(0.9);
    gap: 0.375rem;
    padding: 0.625rem;
  }
  
  .contour-tool-btn {
    width: 2.75rem;
    height: 2.75rem;
  }
  
  .contour-settings-panel {
    min-width: 240px;
    max-width: 260px;
    left: 50%;
    transform: translateX(-50%);
  }
}

@media (max-width: 480px) {
  .contour-toolbar {
    bottom: 0.75rem;
    transform: translateX(-50%) scale(0.85);
    gap: 0.25rem;
    padding: 0.5rem;
  }
  
  .contour-tool-btn {
    width: 2.5rem;
    height: 2.5rem;
  }
  
  .contour-settings-panel {
    min-width: 220px;
    max-width: 240px;
    padding: 0.75rem;
  }
  
  .settings-panel-title {
    font-size: 0.8rem;
  }
  
  .delete-btn {
    padding: 0.375rem 0.75rem;
    font-size: 0.8rem;
  }
}

/* ===== ANIMATIONS ===== */
@keyframes slideUp {
  from {
    opacity: 0;
    transform: translateX(-50%) translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.contour-toolbar {
  animation: slideUp 0.3s ease-out;
}

.contour-settings-panel.open {
  animation: fadeIn 0.3s ease-out;
}

/* ===== ACCESSIBILITY ===== */
.contour-tool-btn:focus-visible {
  outline: 2px solid var(--structure-color, #6366f1);
  outline-offset: 2px;
}

.settings-panel-close:focus-visible {
  outline: 2px solid #ef4444;
  outline-offset: 2px;
}

.delete-btn:focus-visible {
  outline: 2px solid #ef4444;
  outline-offset: 2px;
}

/* ===== PRINT STYLES ===== */
@media print {
  .contour-toolbar,
  .contour-settings-panel {
    display: none;
  }
}
```

---

## 4. JavaScript Integration

### Usage Example
```typescript
// Usage in main viewer component
import { ContourEditToolbar } from './components/contour-edit-toolbar';

const ViewerComponent = () => {
  const [selectedStructure, setSelectedStructure] = useState(null);
  const [isContourEditMode, setIsContourEditMode] = useState(false);
  const [currentSlicePosition, setCurrentSlicePosition] = useState(0);
  const [brushToolState, setBrushToolState] = useState({
    tool: null,
    brushSize: 3,
    isActive: false
  });

  const handleContourUpdate = (updatePayload) => {
    console.log('Contour update:', updatePayload);
    // Handle the update based on action type
    switch (updatePayload.action) {
      case 'delete_slice':
        // Remove contour from specific slice
        break;
      case 'clear_all':
        // Clear all contours for structure
        break;
      default:
        break;
    }
  };

  return (
    <div className="viewer-container">
      {/* Other viewer components */}
      
      {/* Contour Edit Toolbar */}
      {selectedStructure && (
        <ContourEditToolbar
          selectedStructure={selectedStructure}
          isVisible={isContourEditMode}
          onClose={() => {
            setIsContourEditMode(false);
            setSelectedStructure(null);
          }}
          onStructureNameChange={(name) => {
            // Handle name change
          }}
          onStructureColorChange={(color) => {
            // Handle color change
          }}
          onToolChange={setBrushToolState}
          currentSlicePosition={currentSlicePosition}
          onContourUpdate={handleContourUpdate}
        />
      )}
    </div>
  );
};
```

---

## 5. Advanced Features

### Dynamic Structure Color Integration
```typescript
// Utility function for setting dynamic colors
const setStructureColors = (element: HTMLElement, color: number[]) => {
  const [r, g, b] = color;
  const rgbColor = `rgb(${r}, ${g}, ${b})`;
  const rgbaColor = `rgba(${r}, ${g}, ${b}, 0.6)`;
  
  element.style.setProperty('--structure-color', rgbColor);
  element.style.setProperty('--structure-color-rgb', `${r}, ${g}, ${b}`);
  element.style.setProperty('--structure-color-muted', rgbaColor);
  
  element.setAttribute('data-structure-color', rgbColor);
  element.setAttribute('data-structure-color-rgb', `${r}, ${g}, ${b}`);
  element.setAttribute('data-structure-color-muted', rgbaColor);
};
```

### Keyboard Shortcuts Integration
```typescript
// Keyboard shortcuts for toolbar
useEffect(() => {
  const handleKeyPress = (event: KeyboardEvent) => {
    if (!isContourEditMode) return;
    
    switch (event.key) {
      case 'b':
      case 'B':
        handleToolChange('brush');
        break;
      case 'p':
      case 'P':
        handleToolChange('pen');
        break;
      case 'e':
      case 'E':
        handleToolChange('erase');
        break;
      case 'Escape':
        onClose();
        break;
      case '[':
        setBrushThickness(prev => [Math.max(1, prev[0] - 1)]);
        break;
      case ']':
        setBrushThickness(prev => [Math.min(50, prev[0] + 1)]);
        break;
    }
  };

  document.addEventListener('keydown', handleKeyPress);
  return () => document.removeEventListener('keydown', handleKeyPress);
}, [isContourEditMode]);
```

This comprehensive implementation provides a fully functional, professional-grade bottom toolbar system with expandable settings panels, dynamic structure color theming, and complete accessibility support.