import React, { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { 
  Brush, 
  Pen, 
  Eraser, 
  Settings,
  Undo2,
  Redo2,
  Plus,
  Minus,
  Trash2,
  Info,
  FileCode,
  Keyboard,
  ChevronRight,
  Layers
} from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

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
  onToolChange?: (toolState: { tool: string | null; brushSize: number; isActive: boolean; predictionEnabled?: boolean }) => void;
  currentSlicePosition?: number;
  onContourUpdate?: (updatedStructures: any) => void;
  onAutoZoomSettingsChange?: (settings: {
    autoZoomEnabled: boolean;
    autoLocalizeEnabled: boolean;
    zoomFillFactor: number;
  }) => void;
  availableStructures?: Array<{
    roiNumber: number;
    structureName: string;
    color: number[];
  }>;
  onTargetStructureSelect?: (structureId: number | null) => void;
  seriesId?: number;
}

export function ContourEditToolbar({ 
  selectedStructure,
  isVisible,
  onClose,
  onStructureNameChange,
  onStructureColorChange,
  onToolChange,
  currentSlicePosition,
  onContourUpdate,
  onAutoZoomSettingsChange,
  availableStructures,
  onTargetStructureSelect,
  seriesId
}: ContourEditToolbarProps) {
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [brushSize, setBrushSize] = useState(15);
  const [showSettings, setShowSettings] = useState<string | null>(null);
  const [structureName, setStructureName] = useState(selectedStructure?.structureName || '');
  const [structureColor, setStructureColor] = useState('');
  const [growDistance, setGrowDistance] = useState(5.0);
  const [shrinkDistance, setShrinkDistance] = useState(5.0);
  const [targetStructureId, setTargetStructureId] = useState<number | null>(null);

  const structureColorRgb = selectedStructure 
    ? `rgb(${Math.round(selectedStructure.color[0] * 255)}, ${Math.round(selectedStructure.color[1] * 255)}, ${Math.round(selectedStructure.color[2] * 255)})`
    : 'rgb(255, 255, 255)';

  useEffect(() => {
    if (selectedStructure) {
      setStructureName(selectedStructure.structureName);
      const hex = '#' + selectedStructure.color.map(c => {
        const val = Math.round(c * 255);
        return val.toString(16).padStart(2, '0');
      }).join('');
      setStructureColor(hex);
    }
  }, [selectedStructure]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Delete') {
        handleDeleteCurrentSlice();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedStructure, currentSlicePosition]);

  const handleToolActivation = (tool: string) => {
    const newActiveTool = activeTool === tool ? null : tool;
    setActiveTool(newActiveTool);
    
    if (tool === 'operations' || tool === 'grow' || tool === 'shrink') {
      setShowSettings(showSettings === tool ? null : tool);
      return;
    }
    
    setShowSettings(null);
    
    if (onToolChange) {
      onToolChange({
        tool: newActiveTool,
        brushSize,
        isActive: newActiveTool !== null,
        predictionEnabled: false
      });
    }
  };

  const handleBrushSizeChange = (value: number[]) => {
    setBrushSize(value[0]);
    if (activeTool && onToolChange) {
      onToolChange({
        tool: activeTool,
        brushSize: value[0],
        isActive: true,
        predictionEnabled: false
      });
    }
  };

  const handleStructureNameSubmit = () => {
    if (structureName.trim() && structureName !== selectedStructure?.structureName) {
      onStructureNameChange(structureName.trim());
    }
  };

  const handleColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const color = e.target.value;
    setStructureColor(color);
    onStructureColorChange(color);
  };

  const handleUndo = async () => {
    if (!seriesId) return;
    try {
      const response = await fetch(`/api/rt-structures/${seriesId}/undo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      if (response.ok && onContourUpdate) {
        const data = await response.json();
        onContourUpdate(data.structures);
      }
    } catch (error) {
      console.error('Error undoing:', error);
    }
  };

  const handleRedo = async () => {
    if (!seriesId) return;
    try {
      const response = await fetch(`/api/rt-structures/${seriesId}/redo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      if (response.ok && onContourUpdate) {
        const data = await response.json();
        onContourUpdate(data.structures);
      }
    } catch (error) {
      console.error('Error redoing:', error);
    }
  };

  const handleDeleteCurrentSlice = () => {
    if (!selectedStructure) return;
    onContourUpdate?.({
      action: 'delete_current_slice',
      structureId: selectedStructure.roiNumber,
      slicePosition: currentSlicePosition
    });
  };

  const handleDeleteNthSlice = (n: number) => {
    if (!selectedStructure) return;
    onContourUpdate?.({
      action: 'delete_nth_slice',
      structureId: selectedStructure.roiNumber,
      n: n
    });
  };

  const handleClearSlices = (type: 'current' | 'all' | 'above' | 'below') => {
    if (!selectedStructure) return;
    onContourUpdate?.({
      action: 'clear_slices',
      structureId: selectedStructure.roiNumber,
      type: type,
      currentSlice: currentSlicePosition
    });
  };

  const handleSmooth = () => {
    if (!selectedStructure) return;
    onContourUpdate?.({
      action: 'smooth_contours',
      structureId: selectedStructure.roiNumber
    });
  };

  const handleInterpolate = () => {
    if (!selectedStructure) return;
    onContourUpdate?.({
      action: 'interpolate_contours',
      structureId: selectedStructure.roiNumber
    });
  };

  const handleGrowContour = () => {
    if (!selectedStructure || growDistance <= 0) return;
    const distanceInMm = growDistance;
    onContourUpdate?.({
      action: 'grow_contour',
      structureId: selectedStructure.roiNumber,
      distance: distanceInMm,
      slicePosition: currentSlicePosition
    });
  };

  const handleShrinkContour = () => {
    if (!selectedStructure || shrinkDistance <= 0) return;
    const distanceInMm = shrinkDistance;
    onContourUpdate?.({
      action: 'shrink_contour',
      structureId: selectedStructure.roiNumber,
      distance: distanceInMm,
      slicePosition: currentSlicePosition
    });
  };

  const handleBooleanOperation = (operation: 'union' | 'intersection' | 'subtract') => {
    if (!selectedStructure || !targetStructureId) return;
    onContourUpdate?.({
      action: 'boolean_operation',
      operation,
      sourceStructureId: selectedStructure.roiNumber,
      targetStructureId,
      slicePosition: currentSlicePosition
    });
  };

  const renderSettingsPanel = () => {
    if (!showSettings) return null;

    switch (showSettings) {
      case 'brush':
        return (
          <div className="space-y-3">
            <div>
              <Label className="text-xs text-gray-300">Brush Size: {(brushSize * 0.1171875).toFixed(1)} cm ({brushSize} px)</Label>
              <Slider
                value={[brushSize]}
                onValueChange={handleBrushSizeChange}
                min={1}
                max={50}
                step={1}
                className="mt-2"
              />
            </div>
          </div>
        );

      case 'grow':
        return (
          <div className="space-y-3">
            <div>
              <Label className="text-xs text-gray-300">Grow Distance: {growDistance.toFixed(1)} cm ({(growDistance * 10).toFixed(1)} mm)</Label>
              <Slider
                value={[growDistance]}
                onValueChange={(value) => setGrowDistance(value[0])}
                min={0}
                max={2.0}
                step={0.1}
                className="mt-2"
              />
            </div>
            <Button
              onClick={handleGrowContour}
              className="w-full bg-green-600 hover:bg-green-700 text-white"
              size="sm"
            >
              <Plus className="w-4 h-4 mr-2" />
              Grow Contour
            </Button>
          </div>
        );

      case 'shrink':
        return (
          <div className="space-y-3">
            <div>
              <Label className="text-xs text-gray-300">Shrink Distance: {shrinkDistance.toFixed(1)} cm ({(shrinkDistance * 10).toFixed(1)} mm)</Label>
              <Slider
                value={[shrinkDistance]}
                onValueChange={(value) => setShrinkDistance(value[0])}
                min={0}
                max={2.0}
                step={0.1}
                className="mt-2"
              />
            </div>
            <Button
              onClick={handleShrinkContour}
              className="w-full bg-orange-600 hover:bg-orange-700 text-white"
              size="sm"
            >
              <Minus className="w-4 h-4 mr-2" />
              Shrink Contour
            </Button>
          </div>
        );

      case 'operations':
        return (
          <div className="space-y-3">
            <div>
              <Label className="text-xs text-gray-300">Target Structure</Label>
              <select
                value={targetStructureId || ''}
                onChange={(e) => {
                  const id = e.target.value ? parseInt(e.target.value) : null;
                  setTargetStructureId(id);
                  onTargetStructureSelect?.(id);
                }}
                className="w-full mt-1 px-2 py-1 text-sm bg-gray-800 border border-gray-600 rounded text-white"
              >
                <option value="">Select structure...</option>
                {availableStructures?.filter(s => s.roiNumber !== selectedStructure?.roiNumber).map(structure => (
                  <option key={structure.roiNumber} value={structure.roiNumber}>
                    {structure.structureName}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Button
                onClick={() => handleBooleanOperation('union')}
                disabled={!targetStructureId}
                className="bg-blue-600 hover:bg-blue-700 text-white text-xs"
                size="sm"
              >
                Union
              </Button>
              <Button
                onClick={() => handleBooleanOperation('intersection')}
                disabled={!targetStructureId}
                className="bg-purple-600 hover:bg-purple-700 text-white text-xs"
                size="sm"
              >
                Intersect
              </Button>
              <Button
                onClick={() => handleBooleanOperation('subtract')}
                disabled={!targetStructureId}
                className="bg-red-600 hover:bg-red-700 text-white text-xs"
                size="sm"
              >
                Subtract
              </Button>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  if (!isVisible || !selectedStructure) return null;

  const mainTools = [
    { id: 'brush', label: 'Brush', icon: Brush },
    { id: 'pen', label: 'Pen', icon: Pen },
    { id: 'delete', label: 'Delete', icon: Eraser }
  ];

  return (
    <div 
      className="fixed top-20 left-1/2 transform -translate-x-1/2 z-50 bg-black/70 backdrop-blur-sm rounded-lg shadow-2xl border border-gray-700/50"
      style={{ maxWidth: '90vw' }}
    >
      <div className="p-4">
        {/* 3-Section Layout */}
        <div className="flex items-start gap-6">
          {/* Left Section: Contour Name/Color + Controls */}
          <div className="space-y-3">
            {/* Structure Name and Color */}
            <div className="flex items-center gap-2">
              <Input
                value={structureName}
                onChange={(e) => setStructureName(e.target.value)}
                onBlur={handleStructureNameSubmit}
                onKeyDown={(e) => e.key === 'Enter' && handleStructureNameSubmit()}
                className="w-48 h-8 text-sm bg-gray-800 border-gray-600 text-white"
                style={{ borderColor: structureColorRgb }}
              />
              <input
                type="color"
                value={structureColor}
                onChange={handleColorChange}
                className="w-8 h-8 border-0 rounded cursor-pointer"
                style={{ backgroundColor: structureColor }}
              />
            </div>

            {/* Control Buttons */}
            <div className="grid grid-cols-6 gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleUndo}
                className="h-8 w-8 p-0 bg-gray-900/80 border-gray-700/50 text-white/90 hover:bg-gray-800/80 hover:text-white rounded-lg"
                title="Undo (Ctrl+Z)"
              >
                <Undo2 className="w-4 h-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRedo}
                className="h-8 w-8 p-0 bg-gray-900/80 border-gray-700/50 text-white/90 hover:bg-gray-800/80 hover:text-white rounded-lg"
                title="Redo (Ctrl+Y)"
              >
                <Redo2 className="w-4 h-4" />
              </Button>

              {/* Clear with popover */}
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 w-8 p-0 bg-gray-900/80 border-gray-700/50 text-white/90 hover:bg-gray-800/80 hover:text-white rounded-lg"
                    title="Clear Contours"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-40 p-2 bg-gray-900 border-gray-700">
                  <div className="space-y-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleClearSlices('current')}
                      className="w-full justify-start text-xs text-white hover:bg-gray-800"
                    >
                      Current Slice
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleClearSlices('all')}
                      className="w-full justify-start text-xs text-red-400 hover:bg-gray-800"
                    >
                      All Slices
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleClearSlices('above')}
                      className="w-full justify-start text-xs text-white hover:bg-gray-800"
                    >
                      Above Current
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleClearSlices('below')}
                      className="w-full justify-start text-xs text-white hover:bg-gray-800"
                    >
                      Below Current
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>

              {/* Nth Slice with popover */}
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 w-8 p-0 bg-gray-900/80 border-gray-700/50 text-white/90 hover:bg-gray-800/80 hover:text-white rounded-lg"
                    title="Delete Every Nth Slice"
                  >
                    <Layers className="w-4 h-4" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-40 p-2 bg-gray-900 border-gray-700">
                  <div className="space-y-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeleteNthSlice(2)}
                      className="w-full justify-start text-xs text-white hover:bg-gray-800"
                    >
                      Every 2nd Slice
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeleteNthSlice(3)}
                      className="w-full justify-start text-xs text-white hover:bg-gray-800"
                    >
                      Every 3rd Slice
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeleteNthSlice(5)}
                      className="w-full justify-start text-xs text-white hover:bg-gray-800"
                    >
                      Every 5th Slice
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>

              {/* Smooth and Interpolate */}
              <Button
                variant="outline"
                size="sm"
                onClick={handleSmooth}
                className="h-8 w-8 p-0 bg-gray-900/80 border-gray-700/50 text-white/90 hover:bg-gray-800/80 hover:text-white rounded-lg"
                title="Smooth Contours"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 12C3 7 7 3 12 3s9 4 9 9-4 9-9 9" />
                  <path d="M3 12h18" />
                  <path d="M12 3a9 9 0 0 1 0 18" />
                </svg>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleInterpolate}
                className="h-8 w-8 p-0 bg-gray-900/80 border-gray-700/50 text-white/90 hover:bg-gray-800/80 hover:text-white rounded-lg"
                title="Interpolate Between Slices"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="5" r="2" />
                  <circle cx="12" cy="12" r="2" />
                  <circle cx="12" cy="19" r="2" />
                  <path d="M12 7v3M12 14v3" strokeDasharray="2 2" />
                </svg>
              </Button>
            </div>
          </div>

          {/* Middle Section: Drawing Tools + Operations */}
          <div className="flex items-center gap-2 border-l border-gray-600 pl-6">
            {/* Main Tools */}
            {mainTools.map((tool) => {
              const IconComponent = tool.icon;
              const isActive = activeTool === tool.id;
              return (
                <div key={tool.id} className="relative flex items-center">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleToolActivation(tool.id)}
                    className={`h-9 w-9 p-0 transition-all duration-200 ${
                      isActive 
                        ? 'border-2 text-white shadow-lg' 
                        : 'bg-gray-900/80 border border-gray-700/50 text-white/90 hover:bg-gray-800/80 hover:text-white'
                    }`}
                    style={isActive ? { 
                      borderColor: structureColorRgb,
                      backgroundColor: `${structureColorRgb}20`,
                      boxShadow: `0 0 8px ${structureColorRgb}40`
                    } : {}}
                    title={tool.label}
                  >
                    <IconComponent className="w-4 h-4" />
                  </Button>
                  
                  {isActive && tool.id === 'brush' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowSettings(showSettings === 'brush' ? null : 'brush')}
                      className={`ml-1 h-6 w-6 p-0 text-gray-400 hover:text-white hover:bg-gray-700 ${
                        showSettings === 'brush' ? 'bg-gray-700 text-white' : ''
                      }`}
                    >
                      <Settings size={12} />
                    </Button>
                  )}
                </div>
              );
            })}

            {/* Operations Section */}
            <div className="flex items-center gap-2 ml-2 pl-2 border-l border-gray-600">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleToolActivation('grow')}
                className={`h-9 w-9 p-0 rounded-lg ${
                  showSettings === 'grow'
                    ? 'bg-green-900/30 border-green-600 text-green-400'
                    : 'bg-gray-900/80 border-gray-700/50 text-white/90 hover:bg-gray-800/80 hover:text-white'
                }`}
                title="Grow Contour"
              >
                <Plus className="w-4 h-4" />
              </Button>
              
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleToolActivation('shrink')}
                className={`h-9 w-9 p-0 rounded-lg ${
                  showSettings === 'shrink'
                    ? 'bg-orange-900/30 border-orange-600 text-orange-400'
                    : 'bg-gray-900/80 border-gray-700/50 text-white/90 hover:bg-gray-800/80 hover:text-white'
                }`}
                title="Shrink Contour"
              >
                <Minus className="w-4 h-4" />
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={() => handleToolActivation('operations')}
                className={`h-9 w-9 p-0 rounded-lg ${
                  showSettings === 'operations'
                    ? 'bg-purple-900/30 border-purple-600 text-purple-400'
                    : 'bg-gray-900/80 border-gray-700/50 text-white/90 hover:bg-gray-800/80 hover:text-white'
                }`}
                title="Boolean Operations"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="10" cy="10" r="6" />
                  <circle cx="14" cy="14" r="6" />
                  <path d="M14 10a6 6 0 0 0-4 4" />
                </svg>
              </Button>
            </div>
          </div>

          {/* Right Section: Info Panel */}
          <div className="border-l border-gray-600 pl-6">
            <div className="text-xs text-gray-400 space-y-1">
              <div>Slice: {currentSlicePosition || 'N/A'}</div>
              <div>Tool: {activeTool || 'None'}</div>
              {activeTool === 'brush' && (
                <div>Size: {(brushSize * 0.1171875).toFixed(1)} cm</div>
              )}
            </div>
          </div>
        </div>

        {/* Settings Panel */}
        {showSettings && (
          <div className="mt-3 pt-3 border-t border-gray-700">
            {renderSettingsPanel()}
          </div>
        )}
      </div>


    </div>
  );
}