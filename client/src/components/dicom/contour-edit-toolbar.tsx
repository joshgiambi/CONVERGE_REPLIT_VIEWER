import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  Brush, 
  Pen, 
  Scissors,
  Settings,
  X,
  Trash2,
  Layers,
  RotateCcw,
  ArrowUpFromLine,
  ArrowDownFromLine,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Maximize2,
  Minimize2,
  Plus,
  Minus,
  Undo,
  Redo
} from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MarginOperationPanel, type MarginParameters } from './margin-operation-panel';
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
  availableStructures = [],
  onTargetStructureSelect,
  seriesId
}: ContourEditToolbarProps) {
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState<string | null>(null);
  const [brushThickness, setBrushThickness] = useState([9]); // ~1cm at 1.171875mm pixel spacing
  const [is3D, setIs3D] = useState(false);
  const [smartBrush, setSmartBrush] = useState(false);
  const [targetSliceNumber, setTargetSliceNumber] = useState('');
  const [growDistance, setGrowDistance] = useState('');
  const [autoZoomEnabled, setAutoZoomEnabled] = useState(true);
  const [autoLocalizeEnabled, setAutoLocalizeEnabled] = useState(true);
  const [zoomFillFactor, setZoomFillFactor] = useState([40]); // 40% fill factor
  const [growMode, setGrowMode] = useState<'grow' | 'shrink'>('grow');
  const [growDirection, setGrowDirection] = useState<'all' | 'anterior' | 'posterior' | 'left' | 'right' | 'superior' | 'inferior'>('all');
  const [booleanOperation, setBooleanOperation] = useState<'combine' | 'subtract'>('combine');
  const [targetStructure, setTargetStructure] = useState<number | null>(null);
  const [isPredictionEnabled, setIsPredictionEnabled] = useState(false); // Next slice prediction toggle

  // Keyboard shortcut handling
  useEffect(() => {
    if (!isVisible) return;
    
    const handleKeyDown = (e: KeyboardEvent) => {
      // Delete key shortcut for deleting current slice
      if (e.key === 'Delete' || e.key === 'Del') {
        e.preventDefault();
        handleDeleteCurrentSlice();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isVisible, selectedStructure, currentSlicePosition]);

  // Notify parent when tool is activated
  const handleToolActivation = (toolId: string) => {
    console.log('TOOLBAR: Tool activated:', toolId);
    
    if (toolId === 'grow' || toolId === 'boolean') {
      // For grow and boolean buttons, just toggle the settings panel directly
      setShowSettings(showSettings === toolId ? null : toolId);
      return;
    }
    
    const isActive = activeTool === toolId;
    const newTool = isActive ? null : toolId;
    setActiveTool(newTool);
    
    console.log('TOOLBAR: Setting tool to:', newTool, 'isActive:', newTool !== null);
    
    // Pass tool state to parent
    if (onToolChange) {
      const toolState = {
        tool: newTool,
        brushSize: brushThickness[0],
        isActive: newTool !== null,
        predictionEnabled: isPredictionEnabled
      };
      console.log('TOOLBAR: Sending tool state to parent:', toolState);
      onToolChange(toolState);
    }
    
    // Auto-expand settings for the active tool  
    if (newTool && (newTool === 'brush' || newTool === 'pen' || newTool === 'pen-original' || newTool === 'planar-contour')) {
      setShowSettings(newTool);
    } else if (!newTool) {
      setShowSettings(null);
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

  // Undo mutation
  const undoMutation = useMutation({
    mutationFn: async () => {
      if (!seriesId) throw new Error('No series ID');
      const response = await fetch(`/api/rt-structures/${seriesId}/undo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      if (!response.ok) throw new Error('Failed to undo');
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/rt-structures'] });
      toast({ title: "Undo successful" });
      // Pass the actual RT structures data instead of just refresh action
      if (onContourUpdate && data) {
        onContourUpdate(data);
      }
    },
    onError: () => {
      toast({ title: "Nothing to undo", variant: "destructive" });
    }
  });

  // Redo mutation
  const redoMutation = useMutation({
    mutationFn: async () => {
      if (!seriesId) throw new Error('No series ID');
      const response = await fetch(`/api/rt-structures/${seriesId}/redo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      if (!response.ok) throw new Error('Failed to redo');
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/rt-structures'] });
      toast({ title: "Redo successful" });
      // Pass the actual RT structures data instead of just refresh action
      if (onContourUpdate && data) {
        onContourUpdate(data);
      }
    },
    onError: () => {
      toast({ title: "Nothing to redo", variant: "destructive" });
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

  // Grow/Shrink contour function
  const handleGrowContour = () => {
    if (!selectedStructure || !growDistance || !currentSlicePosition) return;
    
    const distanceCm = parseFloat(growDistance);
    if (isNaN(distanceCm) || distanceCm <= 0) {
      toast({ title: "Please enter a valid positive distance in cm", variant: "destructive" });
      return;
    }
    
    // Convert cm to mm for the grow function
    let distanceMm = distanceCm * 10;
    
    // If shrink mode, make distance negative
    if (growMode === 'shrink') {
      distanceMm = -distanceMm;
    }
    
    console.log(`${growMode === 'grow' ? 'Growing' : 'Shrinking'} contour for structure ${selectedStructure.roiNumber} by ${distanceCm}cm (${Math.abs(distanceMm)}mm) in direction: ${growDirection} at slice ${currentSlicePosition}`);
    
    if (onContourUpdate) {
      const updatePayload = {
        action: 'grow_contour',
        structureId: selectedStructure.roiNumber,
        slicePosition: currentSlicePosition,
        distance: distanceMm, // in millimeters (negative for shrink)
        direction: growDirection // 'all', 'anterior', 'posterior', 'left', 'right', 'superior', 'inferior'
      };
      onContourUpdate(updatePayload);
    }
    
    toast({ title: `${growMode === 'grow' ? 'Growing' : 'Shrinking'} contour by ${distanceCm}cm (${growDirection}) on current slice` });
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
    { id: 'pen', icon: Pen, label: 'ITK-SNAP Pen' },
    { id: 'planar-contour', icon: Pen, label: 'Eclipse Planar' },
    { id: 'pen-original', icon: Pen, label: 'Original Pen' },
    { id: 'erase', icon: Scissors, label: 'Erase' },
    { id: 'grow', icon: ArrowUpFromLine, label: 'Grow/Shrink' },
    { id: 'margin', icon: Maximize2, label: 'Margin' },
    { id: 'boolean', icon: Layers, label: 'Boolean' }
  ];

  const renderSettingsPanel = () => {
    if (!showSettings) return null;

    return (
      <div className="absolute left-full bottom-0 ml-2 bg-black/80 backdrop-blur-sm border border-gray-600/50 rounded-lg p-3 w-80 shadow-2xl">
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
        
        {showSettings === 'grow' ? (
          <div className="space-y-3 w-full">
            {/* Grow/Shrink Toggle */}
            <div className="flex gap-2">
              <Button
                variant={growMode === 'grow' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setGrowMode('grow')}
                className={`flex-1 h-8 ${growMode === 'grow' ? 'bg-green-600 hover:bg-green-700' : ''}`}
              >
                <ArrowUpFromLine className="w-4 h-4 mr-1" />
                Grow
              </Button>
              <Button
                variant={growMode === 'shrink' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setGrowMode('shrink')}
                className={`flex-1 h-8 ${growMode === 'shrink' ? 'bg-red-600 hover:bg-red-700' : ''}`}
              >
                <ArrowDownFromLine className="w-4 h-4 mr-1" />
                Shrink
              </Button>
            </div>

            {/* Distance Slider */}
            <div>
              <Label className="text-xs text-gray-300 mb-2 block">Distance (cm)</Label>
              <Slider
                value={[parseFloat(growDistance) || 0]}
                onValueChange={(value) => setGrowDistance(value[0].toString())}
                max={2.0}
                min={0}
                step={0.1}
                className="w-full"
              />
              <div className="text-xs text-gray-400 mt-1">
                {parseFloat(growDistance) || 0} cm ({((parseFloat(growDistance) || 0) * 10).toFixed(1)} mm)
              </div>
            </div>

            {/* Direction Selection */}
            <div>
              <Label className="text-xs text-gray-300 mb-2 block">Direction</Label>
              <div className="grid grid-cols-4 gap-1">
                <Button
                  variant={growDirection === 'all' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setGrowDirection('all')}
                  className="h-8 text-xs col-span-4"
                >
                  All Directions
                </Button>
                <Button
                  variant={growDirection === 'anterior' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setGrowDirection('anterior')}
                  className="h-8 text-xs"
                  title="Anterior (Front)"
                >
                  <ArrowUp className="w-3 h-3" />
                  Ant
                </Button>
                <Button
                  variant={growDirection === 'posterior' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setGrowDirection('posterior')}
                  className="h-8 text-xs"
                  title="Posterior (Back)"
                >
                  <ArrowDown className="w-3 h-3" />
                  Post
                </Button>
                <Button
                  variant={growDirection === 'left' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setGrowDirection('left')}
                  className="h-8 text-xs"
                  title="Left"
                >
                  <ArrowLeft className="w-3 h-3" />
                  Left
                </Button>
                <Button
                  variant={growDirection === 'right' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setGrowDirection('right')}
                  className="h-8 text-xs"
                  title="Right"
                >
                  <ArrowRight className="w-3 h-3" />
                  Right
                </Button>
                <Button
                  variant={growDirection === 'superior' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setGrowDirection('superior')}
                  className="h-8 text-xs col-span-2"
                  title="Superior (Up)"
                >
                  <Maximize2 className="w-3 h-3 mr-1" />
                  Superior
                </Button>
                <Button
                  variant={growDirection === 'inferior' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setGrowDirection('inferior')}
                  className="h-8 text-xs col-span-2"
                  title="Inferior (Down)"
                >
                  <Minimize2 className="w-3 h-3 mr-1" />
                  Inferior
                </Button>
              </div>
            </div>
            
            <Button
              variant="outline"
              size="sm"
              onClick={handleGrowContour}
              className={`w-full h-9 ${
                growMode === 'grow' 
                  ? 'bg-green-900/20 hover:bg-green-900/30 border-green-600/50 text-green-400 hover:text-green-300' 
                  : 'bg-red-900/20 hover:bg-red-900/30 border-red-600/50 text-red-400 hover:text-red-300'
              }`}
              disabled={!growDistance || parseFloat(growDistance) <= 0 || currentSlicePosition === undefined || currentSlicePosition === null}
            >
              {growMode === 'grow' ? (
                <ArrowUpFromLine className="w-4 h-4 mr-2" />
              ) : (
                <ArrowDownFromLine className="w-4 h-4 mr-2" />
              )}
              Run {growMode === 'grow' ? 'Grow' : 'Shrink'}
            </Button>

          </div>
        ) : showSettings === 'margin' ? (
          <div className="space-y-3 w-full">
            <MarginOperationPanel 
              onApplyMargin={(params) => {
                if (onContourUpdate && currentSlicePosition !== undefined) {
                  onContourUpdate({
                    action: 'apply_margin',
                    structureId: selectedStructure.roiNumber,
                    slicePosition: currentSlicePosition,
                    marginParams: params
                  });
                  toast({ title: `Applying margin operation...` });
                }
              }}
              structureColor={structureColorRgb}
            />
          </div>
        ) : showSettings === 'boolean' ? (
          <div className="space-y-3 w-full">
            {/* Boolean Operation Selection */}
            <div className="flex gap-2">
              <Button
                variant={booleanOperation === 'combine' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setBooleanOperation('combine')}
                className={`flex-1 h-8 ${booleanOperation === 'combine' ? 'bg-blue-600 hover:bg-blue-700' : ''}`}
              >
                <Plus className="w-4 h-4 mr-1" />
                Combine
              </Button>
              <Button
                variant={booleanOperation === 'subtract' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setBooleanOperation('subtract')}
                className={`flex-1 h-8 ${booleanOperation === 'subtract' ? 'bg-orange-600 hover:bg-orange-700' : ''}`}
              >
                <Minus className="w-4 h-4 mr-1" />
                Subtract
              </Button>
            </div>

            {/* Target Structure Selection */}
            <div>
              <Label className="text-xs text-gray-300 mb-2 block">Target Structure</Label>
              <p className="text-xs text-gray-500 mb-2">
                Select another structure to {booleanOperation} with {selectedStructure.structureName}
              </p>
              <Select
                value={targetStructure?.toString() || ''}
                onValueChange={(value) => {
                  const structureId = value ? parseInt(value) : null;
                  setTargetStructure(structureId);
                  if (onTargetStructureSelect) {
                    onTargetStructureSelect(structureId);
                  }
                }}
              >
                <SelectTrigger className="w-full h-8 bg-gray-800/50 border-gray-600">
                  <SelectValue placeholder="Choose a structure" />
                </SelectTrigger>
                <SelectContent>
                  {availableStructures
                    .filter(s => s.roiNumber !== selectedStructure.roiNumber)
                    .map(structure => (
                      <SelectItem key={structure.roiNumber} value={structure.roiNumber.toString()}>
                        <div className="flex items-center gap-2">
                          <div 
                            className="w-3 h-3 rounded-sm" 
                            style={{ backgroundColor: `rgb(${structure.color.join(',')})` }}
                          />
                          <span>{structure.structureName}</span>
                        </div>
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                // Handle boolean operation
                if (!selectedStructure || !targetStructure || !currentSlicePosition) return;
                
                console.log(`Performing ${booleanOperation} operation between structures ${selectedStructure.roiNumber} and ${targetStructure}`);
                
                if (onContourUpdate) {
                  const updatePayload = {
                    action: 'boolean_operation',
                    operation: booleanOperation, // 'combine' or 'subtract'
                    sourceStructureId: selectedStructure.roiNumber,
                    targetStructureId: targetStructure,
                    slicePosition: currentSlicePosition
                  };
                  onContourUpdate(updatePayload);
                }
                
                toast({ title: `${booleanOperation === 'combine' ? 'Combined' : 'Subtracted'} structures on current slice` });
              }}
              className={`w-full h-9 ${
                booleanOperation === 'combine'
                  ? 'bg-blue-900/20 hover:bg-blue-900/30 border-blue-600/50 text-blue-400 hover:text-blue-300'
                  : 'bg-orange-900/20 hover:bg-orange-900/30 border-orange-600/50 text-orange-400 hover:text-orange-300'
              }`}
              disabled={!targetStructure}
            >
              <Layers className="w-4 h-4 mr-2" />
              {booleanOperation === 'combine' ? 'Combine Structures' : 'Subtract Structure'}
            </Button>
          </div>
        ) : showSettings === 'brush' ? (
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-3">
              <div>
                <Label className="text-xs text-gray-300 mb-2 block">Brush Thickness (cm)</Label>
                <Slider
                  value={brushThickness}
                  onValueChange={(value) => {
                    setBrushThickness(value);
                    // Update tool state with new brush size
                    if (onToolChange && activeTool === 'brush') {
                      onToolChange({
                        tool: 'brush',
                        brushSize: value[0],
                        isActive: true,
                        predictionEnabled: isPredictionEnabled
                      });
                    }
                  }}
                  max={20}
                  min={1}
                  step={1}
                  className="w-full"
                />
                <div className="text-xs text-gray-400 mt-1">
                  {(brushThickness[0] * 0.1171875).toFixed(2)} cm ({brushThickness[0]}px)
                </div>
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
              
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-gray-300">Next Slice Prediction</Label>
                  {isPredictionEnabled && (
                    <div className="flex items-center gap-1">
                      <div className="w-2 h-2 bg-purple-500 rounded-full animate-pulse"></div>
                      <span className="text-xs text-purple-400 font-medium">ACTIVE</span>
                    </div>
                  )}
                </div>
                <Switch
                  checked={isPredictionEnabled}
                  onCheckedChange={(enabled) => {
                    setIsPredictionEnabled(enabled);
                    // Update tool state immediately when prediction toggle changes
                    if (onToolChange && activeTool === 'brush') {
                      onToolChange({
                        tool: 'brush',
                        brushSize: brushThickness[0],
                        isActive: true,
                        predictionEnabled: enabled
                      });
                    }
                  }}
                  className="data-[state=checked]:bg-purple-500"
                />
              </div>
              
              {isPredictionEnabled && (
                <div className="text-xs text-purple-400 bg-purple-900/20 border border-purple-600/30 rounded p-2">
                  When enabled, contour changes will generate predicted contours on adjacent slices with animated dashed borders.
                </div>
              )}
            </div>
            
            <div className="space-y-3">
              <div className="text-xs text-gray-500">
                Brush tool settings for medical-grade contouring
              </div>
            </div>
          </div>
        ) : showSettings === 'planar-contour' ? (
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-3">
              <div className="text-sm text-gray-300 font-medium">Eclipse TPS Draw Planar Contour</div>
              <div className="text-xs text-gray-400">
                Eclipse Treatment Planning System style planar contour tool with curved/straight line modes
              </div>
              
              <div className="flex items-center justify-between">
                <Label className="text-xs text-gray-300">Drawing Mode</Label>
                <Select value="point-by-point" onValueChange={() => {}}>
                  <SelectTrigger className="w-32 h-7 bg-gray-800/50 border-gray-600 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="point-by-point">Point-by-Point</SelectItem>
                    <SelectItem value="continuous">Continuous</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div className="flex items-center justify-between">
                <Label className="text-xs text-gray-300">Line Style</Label>
                <Select value="straight" onValueChange={() => {}}>
                  <SelectTrigger className="w-32 h-7 bg-gray-800/50 border-gray-600 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="straight">Straight</SelectItem>
                    <SelectItem value="curved">Curved</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            
            <div className="space-y-3">
              <div className="text-xs text-gray-400">
                • Click to place vertices
              </div>
              <div className="text-xs text-gray-400">
                • Click near first vertex to close
              </div>
              <div className="text-xs text-gray-400">
                • Shift+Drag to move entire contour
              </div>
              <div className="text-xs text-gray-400">
                • Click+Drag to reshape contour
              </div>
              <div className="text-xs text-gray-400">
                • Right-click for precision slider
              </div>
            </div>
          </div>
        ) : showSettings === 'pen' ? (
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-3">
              <div className="text-sm text-gray-300 font-medium">ITK-SNAP Pen Tool</div>
              <div className="text-xs text-gray-400">
                Simplified polygon tool following ITK-SNAP medical imaging standard
              </div>
              
              <div className="flex items-center justify-between">
                <Label className="text-xs text-gray-300">Auto-Close Threshold</Label>
                <div className="text-xs text-gray-400">8px</div>
              </div>
              
              <div className="flex items-center justify-between">
                <Label className="text-xs text-gray-300">Vertex Snapping</Label>
                <Switch
                  checked={true}
                  onCheckedChange={() => {}}
                  className="data-[state=checked]:bg-blue-500"
                />
              </div>
            </div>
            
            <div className="space-y-3">
              <div className="text-xs text-gray-400">
                • Click to place vertices
              </div>
              <div className="text-xs text-gray-400">
                • Click near first vertex to close
              </div>
              <div className="text-xs text-gray-400">
                • Right-click to close polygon
              </div>
              <div className="text-xs text-gray-400">
                • Escape to cancel
              </div>
              <div className="text-xs text-gray-400">
                • Ctrl+V to paste
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-3">
              <div className="text-xs text-gray-500">
                Select a tool to see its settings
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="fixed bottom-24 left-1/2 transform -translate-x-1/2 z-50">
      <div 
        className="relative bg-black/80 backdrop-blur-sm border-2 rounded-2xl p-4 shadow-2xl w-auto"
        style={{ borderColor: `${structureColorRgb}60` }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center space-x-3">
            {/* Structure info and controls */}
            <div 
              className="w-4 h-4 rounded border border-gray-400"
              style={{ backgroundColor: structureColorRgb }}
            />
            <span className="text-white text-sm font-medium">Editing:</span>
            <Input
              value={selectedStructure.structureName || ''}
              onChange={(e) => handleNameChange(e.target.value)}
              className="w-32 h-7 bg-gray-800/70 border-gray-600 text-white text-sm rounded-lg"
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
            
            {/* Separator */}
            <div className="w-px h-6 bg-gray-600 mx-2" />
            
            {/* Undo/Redo buttons */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => undoMutation.mutate()}
              disabled={undoMutation.isPending}
              className="h-7 w-7 p-0 bg-black border border-gray-500 text-gray-400 hover:text-white hover:bg-gray-800 disabled:opacity-50 rounded-lg"
              title="Undo (Ctrl+Z)"
            >
              <Undo className="w-3 h-3" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => redoMutation.mutate()}
              disabled={redoMutation.isPending}
              className="h-7 w-7 p-0 bg-black border border-gray-500 text-gray-400 hover:text-white hover:bg-gray-800 disabled:opacity-50 rounded-lg"
              title="Redo (Ctrl+Y)"
            >
              <Redo className="w-3 h-3" />
            </Button>
            
            {/* Separator */}
            <div className="w-px h-6 bg-gray-600 mx-2" />
            
            {/* Delete button */}
            <Button
              variant="outline"
              size="sm"
              onClick={handleDeleteCurrentSlice}
              className="h-7 px-2 bg-black border border-red-600/50 text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded-lg"
              title="Delete Current Slice (Del)"
            >
              <Trash2 className="w-3 h-3 mr-1" />
              <span className="text-xs">Del Slice</span>
            </Button>
          </div>
          
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="text-gray-400 hover:text-white hover:bg-gray-700 h-7 w-7 p-0 rounded-lg"
          >
            <X size={14} />
          </Button>
        </div>

        <Separator className="my-2 bg-gray-700" />

        {/* Tool Buttons */}
        <div className="flex items-center justify-center space-x-2">
          {/* Main tool buttons */}
          {mainTools.map((tool) => {
            const IconComponent = tool.icon;
            const isActive = activeTool === tool.id || (tool.id === 'grow' && showSettings === 'grow');
            const hasSettings = showSettings === tool.id;
            return (
              <div key={tool.id} className="relative flex items-center">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleToolActivation(tool.id)}
                  className={`h-9 px-3 transition-all duration-200 rounded-xl ${
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
                    className={`ml-1 h-6 w-6 p-0 text-gray-400 hover:text-white hover:bg-gray-700 transition-all duration-200 rounded-lg ${
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