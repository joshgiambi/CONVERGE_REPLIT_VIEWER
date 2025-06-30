import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { 
  Brush, 
  Pen, 
  Scissors,
  Settings,
  X,
  Trash2,
  Layers,
  RotateCcw
} from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';

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
  onAutoZoomSettingsChange?: (settings: {
    autoZoomEnabled: boolean;
    autoLocalizeEnabled: boolean;
    zoomFillFactor: number;
  }) => void;
}

export function ContourEditToolbar({ 
  selectedStructure, 
  isVisible, 
  onClose,
  onStructureNameChange,
  onStructureColorChange,
  onToolChange,
  currentSlicePosition,
  onContourUpdate
}: ContourEditToolbarProps) {
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState<string | null>(null);
  const [brushThickness, setBrushThickness] = useState([3]);
  const [is3D, setIs3D] = useState(false);
  const [smartBrush, setSmartBrush] = useState(false);
  const [targetSliceNumber, setTargetSliceNumber] = useState('');
  const [autoZoomEnabled, setAutoZoomEnabled] = useState(true);
  const [autoLocalizeEnabled, setAutoLocalizeEnabled] = useState(true);
  const [zoomFillFactor, setZoomFillFactor] = useState([40]); // 40% fill factor

  // Notify parent when brush tool is activated
  const handleToolActivation = (toolId: string) => {
    const isActive = activeTool === toolId;
    const newTool = isActive ? null : toolId;
    setActiveTool(newTool);
    
    // Pass brush tool state to parent
    if (onToolChange) {
      onToolChange({
        tool: newTool,
        brushSize: brushThickness[0],
        isActive: newTool === 'brush'
      });
    }
  };

  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Mutation for updating structure name
  const updateNameMutation = useMutation({
    mutationFn: async ({ structureId, name }: { structureId: number; name: string }) => {
      const response = await fetch(`/api/rt-structures/${structureId}/name`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      if (!response.ok) throw new Error('Failed to update structure name');
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Structure name updated successfully" });
      queryClient.invalidateQueries({ queryKey: ['/api/rt-structures'] });
    },
    onError: () => {
      toast({ title: "Failed to update structure name", variant: "destructive" });
    }
  });

  // Mutation for updating structure color
  const updateColorMutation = useMutation({
    mutationFn: async ({ structureId, color }: { structureId: number; color: number[] }) => {
      const response = await fetch(`/api/rt-structures/${structureId}/color`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ color })
      });
      if (!response.ok) throw new Error('Failed to update structure color');
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Structure color updated successfully" });
      queryClient.invalidateQueries({ queryKey: ['/api/rt-structures'] });
    },
    onError: () => {
      toast({ title: "Failed to update structure color", variant: "destructive" });
    }
  });

  // Delete operations functions
  const handleDeleteCurrentSlice = () => {
    if (!selectedStructure || !currentSlicePosition) return;
    
    console.log(`Deleting contour for structure ${selectedStructure.roiNumber} at slice ${currentSlicePosition}`);
    
    // Create notification for local update
    if (onContourUpdate) {
      // This would trigger a local update to remove the contour from current slice
      const updatePayload = {
        action: 'delete_slice',
        structureId: selectedStructure.roiNumber,
        slicePosition: currentSlicePosition
      };
      onContourUpdate(updatePayload);
    }
    
    toast({ title: `Deleted contour from current slice (${currentSlicePosition})` });
  };

  const handleDeleteNthSlice = () => {
    if (!selectedStructure || !targetSliceNumber) return;
    
    const sliceNum = parseFloat(targetSliceNumber);
    if (isNaN(sliceNum)) {
      toast({ title: "Please enter a valid slice number", variant: "destructive" });
      return;
    }
    
    console.log(`Deleting contour for structure ${selectedStructure.roiNumber} at slice ${sliceNum}`);
    
    if (onContourUpdate) {
      const updatePayload = {
        action: 'delete_slice',
        structureId: selectedStructure.roiNumber,
        slicePosition: sliceNum
      };
      onContourUpdate(updatePayload);
    }
    
    toast({ title: `Deleted contour from slice ${sliceNum}` });
    setTargetSliceNumber('');
  };

  const handleClearAllSlices = () => {
    if (!selectedStructure) return;
    
    console.log(`Clearing all contours for structure ${selectedStructure.roiNumber}`);
    
    if (onContourUpdate) {
      const updatePayload = {
        action: 'clear_all',
        structureId: selectedStructure.roiNumber
      };
      onContourUpdate(updatePayload);
    }
    
    toast({ title: `Cleared all contours for ${selectedStructure.structureName}` });
  };

  if (!isVisible || !selectedStructure) return null;

  const rgbToHex = (rgb: number[]) => {
    return '#' + rgb.map(x => x.toString(16).padStart(2, '0')).join('');
  };

  const hexToRgb = (hex: string): number[] => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? [
      parseInt(result[1], 16),
      parseInt(result[2], 16),
      parseInt(result[3], 16)
    ] : [255, 255, 255];
  };

  const handleNameChange = (name: string) => {
    onStructureNameChange(name); // Update UI immediately
    updateNameMutation.mutate({ 
      structureId: selectedStructure.roiNumber, 
      name 
    });
  };

  const handleColorChange = (hexColor: string) => {
    const rgbColor = hexToRgb(hexColor);
    onStructureColorChange(hexColor); // Update UI immediately
    updateColorMutation.mutate({ 
      structureId: selectedStructure.roiNumber, 
      color: rgbColor 
    });
  };

  const currentColor = rgbToHex(selectedStructure.color || [255, 255, 255]);
  const structureColorRgb = `rgb(${selectedStructure.color.join(',')})`;

  const mainTools = [
    { id: 'brush', icon: Brush, label: 'Brush' },
    { id: 'pen', icon: Pen, label: 'Pen' },
    { id: 'erase', icon: Scissors, label: 'Erase' },
    { id: 'operations', icon: Settings, label: 'Operations' }
  ];

  const renderSettingsPanel = () => {
    if (!showSettings) return null;

    return (
      <div className="absolute left-full top-0 ml-2 bg-black/80 backdrop-blur-sm border border-gray-600/50 rounded-lg p-3 w-80 shadow-2xl">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-medium text-white capitalize">{showSettings} Settings</h4>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowSettings(null)}
            className="text-gray-400 hover:text-white h-6 w-6 p-0"
          >
            <X size={12} />
          </Button>
        </div>
        
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-3">
            <div>
              <Label className="text-xs text-gray-300 mb-2 block">Brush Thickness</Label>
              <Slider
                value={brushThickness}
                onValueChange={setBrushThickness}
                max={20}
                min={1}
                step={1}
                className="w-full"
              />
              <div className="text-xs text-gray-400 mt-1">{brushThickness[0]}px</div>
            </div>
            
            <div className="flex items-center justify-between">
              <Label className="text-xs text-gray-300">3D Mode</Label>
              <Switch
                checked={is3D}
                onCheckedChange={setIs3D}
                className="data-[state=checked]:bg-blue-500"
              />
            </div>
            
            <div className="flex items-center justify-between">
              <Label className="text-xs text-gray-300">Smart Brush</Label>
              <Switch
                checked={smartBrush}
                onCheckedChange={setSmartBrush}
                className="data-[state=checked]:bg-green-500"
              />
            </div>
          </div>
          
          <div className="space-y-3">
            {showSettings === 'operations' && (
              <>
                <div className="space-y-2">
                  <Label className="text-xs text-gray-300">Structure Navigation</Label>
                  
                  <div className="flex items-center justify-between">
                    <Label className="text-xs text-gray-300">Auto-Zoom</Label>
                    <Switch
                      checked={autoZoomEnabled}
                      onCheckedChange={setAutoZoomEnabled}
                      className="data-[state=checked]:bg-blue-500"
                    />
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <Label className="text-xs text-gray-300">Auto-Localize</Label>
                    <Switch
                      checked={autoLocalizeEnabled}
                      onCheckedChange={setAutoLocalizeEnabled}
                      className="data-[state=checked]:bg-green-500"
                    />
                  </div>
                  
                  {autoZoomEnabled && (
                    <div>
                      <Label className="text-xs text-gray-300 mb-2 block">Zoom Fill Factor</Label>
                      <Slider
                        value={zoomFillFactor}
                        onValueChange={setZoomFillFactor}
                        max={80}
                        min={20}
                        step={5}
                        className="w-full"
                      />
                      <div className="text-xs text-gray-400 mt-1">{zoomFillFactor[0]}% of screen</div>
                    </div>
                  )}
                </div>
                
                <div className="space-y-2">
                  <Label className="text-xs text-gray-300">Delete Operations</Label>
                  
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDeleteCurrentSlice}
                    className="w-full h-8 bg-red-900/20 hover:bg-red-900/30 border-red-600/50 text-red-400 hover:text-red-300"
                    disabled={!currentSlicePosition}
                  >
                    <Trash2 className="w-3 h-3 mr-2" />
                    Delete Current Slice
                  </Button>
                  
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      placeholder="Slice #"
                      value={targetSliceNumber}
                      onChange={(e) => setTargetSliceNumber(e.target.value)}
                      className="flex-1 h-8 bg-gray-800/70 border-gray-600 text-white text-xs"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleDeleteNthSlice}
                      className="h-8 bg-red-900/20 hover:bg-red-900/30 border-red-600/50 text-red-400 hover:text-red-300"
                      disabled={!targetSliceNumber}
                    >
                      <Layers className="w-3 h-3 mr-1" />
                      Delete
                    </Button>
                  </div>
                  
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleClearAllSlices}
                    className="w-full h-8 bg-red-900/30 hover:bg-red-900/40 border-red-500/60 text-red-300 hover:text-red-200"
                  >
                    <RotateCcw className="w-3 h-3 mr-2" />
                    Clear All Slices
                  </Button>
                </div>
              </>
            )}
            
            {showSettings !== 'operations' && (
              <div className="text-xs text-gray-500">
                {showSettings} tool settings will be implemented here
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="fixed bottom-24 left-1/2 transform -translate-x-1/2 z-50">
      <div 
        className="relative bg-black/80 backdrop-blur-sm border-2 rounded-lg p-3 shadow-2xl w-auto"
        style={{ borderColor: `${structureColorRgb}60` }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center space-x-3">
            <div 
              className="w-4 h-4 rounded border border-gray-400"
              style={{ backgroundColor: structureColorRgb }}
            />
            <span className="text-white text-sm font-medium">Editing:</span>
            <Input
              value={selectedStructure.structureName || ''}
              onChange={(e) => handleNameChange(e.target.value)}
              className="w-32 h-7 bg-gray-800/70 border-gray-600 text-white text-sm"
              disabled={updateNameMutation.isPending}
            />
            <span className="text-gray-300 text-sm">Color:</span>
            <input
              type="color"
              value={currentColor}
              onChange={(e) => handleColorChange(e.target.value)}
              className="w-7 h-7 rounded border border-gray-600 bg-gray-800 cursor-pointer"
              disabled={updateColorMutation.isPending}
            />
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="text-gray-400 hover:text-white hover:bg-gray-700 h-7 w-7 p-0"
          >
            <X size={14} />
          </Button>
        </div>

        <Separator className="my-2 bg-gray-700" />

        {/* Tool Buttons */}
        <div className="flex items-center justify-center space-x-2">
          {mainTools.map((tool) => {
            const IconComponent = tool.icon;
            const isActive = activeTool === tool.id;
            const hasSettings = showSettings === tool.id;
            return (
              <div key={tool.id} className="relative flex items-center">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleToolActivation(tool.id)}
                  className={`h-9 px-3 transition-all duration-200 ${
                    isActive 
                      ? 'border-2 text-white shadow-lg' 
                      : 'bg-black border border-gray-500 text-white hover:bg-gray-800'
                  }`}
                  style={isActive ? { 
                    borderColor: `${structureColorRgb}`,
                    backgroundColor: `${structureColorRgb}20`,
                    boxShadow: `0 0 8px ${structureColorRgb}40`
                  } : {}}
                >
                  <IconComponent className="w-4 h-4 mr-2" />
                  <span className="text-sm">{tool.label}</span>
                </Button>
                
                {/* Settings expand button */}
                {isActive && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowSettings(hasSettings ? null : tool.id)}
                    className={`ml-1 h-6 w-6 p-0 text-gray-400 hover:text-white hover:bg-gray-700 transition-all duration-200 ${
                      hasSettings ? 'bg-gray-700 text-white' : ''
                    }`}
                  >
                    <Settings size={12} />
                  </Button>
                )}
              </div>
            );
          })}
        </div>

        {/* Settings Panel */}
        {renderSettingsPanel()}
      </div>
    </div>
  );
}