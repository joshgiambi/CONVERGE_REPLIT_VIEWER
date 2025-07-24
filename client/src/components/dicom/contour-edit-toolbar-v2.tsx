import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { 
  Brush, 
  Pen, 
  Eraser,
  X,
  Plus,
  Minus,
  Undo,
  Redo,
  Layers,
  Maximize2,
  Settings,
  Sparkles,
  ChevronRight,
  ArrowUpFromLine,
  ArrowDownFromLine,
  Info,
  Palette
} from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface ContourEditToolbarV2Props {
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
  seriesId?: number;
}

export function ContourEditToolbarV2({ 
  selectedStructure, 
  isVisible, 
  onClose,
  onStructureNameChange,
  onStructureColorChange,
  onToolChange,
  currentSlicePosition,
  onContourUpdate,
  seriesId
}: ContourEditToolbarV2Props) {
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [brushSize, setBrushSize] = useState([10]); // ~1cm default
  const [isPredictionEnabled, setIsPredictionEnabled] = useState(false);
  const [showAdvancedPanel, setShowAdvancedPanel] = useState(false);
  
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Calculate brush size in cm based on pixel spacing (1.171875mm per pixel for HN-ATLAS)
  const pixelSpacing = 1.171875; // mm per pixel
  const brushSizeMm = brushSize[0] * pixelSpacing;
  const brushSizeCm = brushSizeMm / 10;

  // Structure color handling
  const structureColor = selectedStructure ? `rgb(${selectedStructure.color.join(',')})` : '#ffffff';
  const structureColorHex = selectedStructure ? '#' + selectedStructure.color.map(x => x.toString(16).padStart(2, '0')).join('') : '#ffffff';

  // Tool activation
  const handleToolActivation = (toolId: string) => {
    const isActive = activeTool === toolId;
    const newTool = isActive ? null : toolId;
    setActiveTool(newTool);
    
    if (onToolChange) {
      onToolChange({
        tool: newTool,
        brushSize: brushSize[0],
        isActive: !isActive,
        predictionEnabled: isPredictionEnabled
      });
    }
  };

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
      if (onContourUpdate && data) {
        onContourUpdate(data);
      }
    },
    onError: () => {
      toast({ title: "Nothing to redo", variant: "destructive" });
    }
  });

  // Delete operations
  const handleDeleteCurrentSlice = () => {
    if (!selectedStructure || !currentSlicePosition) return;
    
    if (onContourUpdate) {
      onContourUpdate({
        action: 'delete_slice',
        structureId: selectedStructure.roiNumber,
        slicePosition: currentSlicePosition
      });
    }
    
    toast({ title: `Deleted contour from current slice` });
  };

  const handleClearAllSlices = () => {
    if (!selectedStructure) return;
    
    if (onContourUpdate) {
      onContourUpdate({
        action: 'clear_all',
        structureId: selectedStructure.roiNumber
      });
    }
    
    toast({ title: `Cleared all contours` });
  };

  const handleInterpolate = () => {
    if (!selectedStructure) return;
    
    if (onContourUpdate) {
      onContourUpdate({
        action: 'interpolate',
        structureId: selectedStructure.roiNumber
      });
    }
    
    toast({ title: `Interpolating missing slices` });
  };

  if (!isVisible || !selectedStructure) return null;

  const drawingTools = [
    { id: 'brush', icon: Brush, label: 'Brush Tool', hotkey: 'B' },
    { id: 'planar-contour', icon: Pen, label: 'Pen Tool', hotkey: 'P' },
    { id: 'erase', icon: Eraser, label: 'Erase Tool', hotkey: 'E' },
  ];

  const operationTools = [
    { id: 'grow', icon: Plus, label: 'Grow/Shrink' },
    { id: 'margin', icon: Maximize2, label: 'Margin' },
    { id: 'boolean', icon: Layers, label: 'Boolean' },
  ];

  return (
    <TooltipProvider>
      <div className="fixed left-4 top-1/2 -translate-y-1/2 z-50 animate-in slide-in-from-left-2 duration-300">
        <Card className="bg-black/90 backdrop-blur-md border-zinc-700/50 p-0 overflow-hidden">
          {/* Header */}
          <div 
            className="px-4 py-3 border-b border-zinc-700/50 flex items-center justify-between cursor-move"
            style={{ backgroundColor: structureColor + '20' }}
          >
            <div className="flex items-center gap-2">
              <div 
                className="w-3 h-3 rounded-full" 
                style={{ backgroundColor: structureColor }}
              />
              <span className="text-sm font-medium text-white">
                {selectedStructure.structureName}
              </span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="h-6 w-6 p-0 hover:bg-red-500/20"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>

          {/* Main Toolbar */}
          <div className="p-3 space-y-3">
            {/* Drawing Tools Section */}
            <div>
              <div className="text-xs text-zinc-400 mb-2 flex items-center gap-1">
                <Brush className="h-3 w-3" />
                Drawing Tools
              </div>
              <div className="grid grid-cols-3 gap-1">
                {drawingTools.map((tool) => {
                  const Icon = tool.icon;
                  const isActive = activeTool === tool.id;
                  
                  return (
                    <Tooltip key={tool.id}>
                      <TooltipTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className={`
                            h-10 w-full relative transition-all duration-200
                            ${isActive 
                              ? 'bg-zinc-800 border-2 shadow-lg transform scale-105' 
                              : 'border-zinc-700 hover:bg-zinc-800/50 hover:border-zinc-600'
                            }
                          `}
                          style={{
                            borderColor: isActive ? structureColor : undefined,
                            boxShadow: isActive ? `0 0 12px ${structureColor}40` : undefined
                          }}
                          onClick={() => handleToolActivation(tool.id)}
                        >
                          <Icon className="h-4 w-4" />
                          {isActive && (
                            <div 
                              className="absolute inset-0 rounded-md opacity-20"
                              style={{ backgroundColor: structureColor }}
                            />
                          )}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="right">
                        <p>{tool.label}</p>
                        <p className="text-xs text-zinc-400">Hotkey: {tool.hotkey}</p>
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>
            </div>

            {/* Brush Size Control (visible when brush/erase active) */}
            {(activeTool === 'brush' || activeTool === 'erase') && (
              <div className="space-y-2 animate-in slide-in-from-top-1">
                <Label className="text-xs text-zinc-400">
                  Brush Size: {brushSizeCm.toFixed(1)} cm
                </Label>
                <Slider
                  value={brushSize}
                  onValueChange={setBrushSize}
                  max={25}
                  min={1}
                  step={1}
                  className="w-full"
                  style={{
                    '--slider-thumb-color': structureColor,
                    '--slider-track-color': structureColor + '40',
                  } as React.CSSProperties}
                />
                <div className="text-xs text-zinc-500">
                  {brushSize[0]} px ({brushSizeMm.toFixed(1)} mm)
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => undoMutation.mutate()}
                    disabled={undoMutation.isPending}
                    className="flex-1 h-8 border-zinc-700 hover:bg-zinc-800/50"
                  >
                    <Undo className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Undo</p>
                  <p className="text-xs text-zinc-400">Ctrl+Z</p>
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => redoMutation.mutate()}
                    disabled={redoMutation.isPending}
                    className="flex-1 h-8 border-zinc-700 hover:bg-zinc-800/50"
                  >
                    <Redo className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Redo</p>
                  <p className="text-xs text-zinc-400">Ctrl+Y</p>
                </TooltipContent>
              </Tooltip>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 h-8 border-zinc-700 hover:bg-zinc-800/50"
                  >
                    <Settings className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem onClick={handleInterpolate}>
                    <Sparkles className="h-4 w-4 mr-2" />
                    Interpolate Slices
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleDeleteCurrentSlice} className="text-red-400">
                    <Minus className="h-4 w-4 mr-2" />
                    Delete Current Slice
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleClearAllSlices} className="text-red-400">
                    <X className="h-4 w-4 mr-2" />
                    Clear All Slices
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* Advanced Operations Toggle */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowAdvancedPanel(!showAdvancedPanel)}
              className="w-full h-8 border-zinc-700 hover:bg-zinc-800/50 justify-between"
            >
              <span className="text-xs">Advanced Operations</span>
              <ChevronRight className={`h-3.5 w-3.5 transition-transform ${showAdvancedPanel ? 'rotate-90' : ''}`} />
            </Button>

            {/* Advanced Operations Panel */}
            {showAdvancedPanel && (
              <div className="space-y-2 animate-in slide-in-from-top-1 border-t border-zinc-700/50 pt-3">
                {operationTools.map((tool) => {
                  const Icon = tool.icon;
                  return (
                    <Button
                      key={tool.id}
                      variant="outline"
                      size="sm"
                      className="w-full h-9 justify-start border-zinc-700 hover:bg-zinc-800/50"
                      onClick={() => {
                        // These would open modal dialogs in the full implementation
                        toast({ title: `${tool.label} operation selected` });
                      }}
                    >
                      <Icon className="h-4 w-4 mr-2" />
                      {tool.label}
                    </Button>
                  );
                })}
              </div>
            )}

            {/* AI Prediction Toggle */}
            <div className="flex items-center justify-between p-2 bg-zinc-900/50 rounded-md">
              <div className="flex items-center gap-2">
                <Sparkles className="h-3.5 w-3.5 text-purple-400" />
                <span className="text-xs text-zinc-300">AI Prediction</span>
              </div>
              <Switch
                checked={isPredictionEnabled}
                onCheckedChange={(checked) => {
                  setIsPredictionEnabled(checked);
                  if (onToolChange && activeTool) {
                    onToolChange({
                      tool: activeTool,
                      brushSize: brushSize[0],
                      isActive: true,
                      predictionEnabled: checked
                    });
                  }
                }}
                className="scale-75"
              />
            </div>

            {/* Structure Info */}
            <div className="text-xs text-zinc-500 text-center">
              Slice {currentSlicePosition?.toFixed(0) || '—'} mm
            </div>
          </div>
        </Card>
      </div>
    </TooltipProvider>
  );
}