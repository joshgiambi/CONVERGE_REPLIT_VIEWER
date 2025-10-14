import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
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
  Redo,
  GitBranch,
  Grid3x3,
  Eraser,
  ChevronDown,
  Sparkles,
  Workflow,
  Eye,
  Zap,
  Keyboard,
  SplitSquareHorizontal
} from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { undoRedoManager } from '@/lib/undo-system';
import { growContourSimple } from '@/lib/simple-polygon-operations';
import { log } from '@/lib/log';
import { useToast } from '@/hooks/use-toast';
import { countStructureBlobs } from '@/lib/blob-operations';

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
  onToolChange?: (toolState: { tool: string | null; brushSize: number; isActive: boolean; predictionEnabled?: boolean; smartBrushEnabled?: boolean }) => void;
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
  imageMetadata?: any;
  onOpenBooleanOperations?: () => void;
  onOpenAdvancedMarginTool?: () => void;
  rtStructures?: any; // Full RT structures for blob detection
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
  seriesId,
  imageMetadata,
  onOpenBooleanOperations,
  onOpenAdvancedMarginTool,
  rtStructures
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
  const [showNthSliceMenu, setShowNthSliceMenu] = useState(false);
  const [showClearMenu, setShowClearMenu] = useState(false);
  const [showBlobMenu, setShowBlobMenu] = useState(false);
  
  // Refs for dropdown close timers
  const nthMenuTimerRef = useRef<NodeJS.Timeout | null>(null);
  const clearMenuTimerRef = useRef<NodeJS.Timeout | null>(null);
  const blobMenuTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [isPreviewEnabled, setIsPreviewEnabled] = useState(true); // Preview mode for grow/shrink operations
  const [previewContours, setPreviewContours] = useState<number[][] | null>(null); // Store preview contours for rendering
  const [isShowingPreview, setIsShowingPreview] = useState(false); // Track if preview is currently shown

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

  // Sync brush size from parent tool state when it changes externally (e.g., right-drag)
  useEffect(() => {
    // If the parent (viewer) updates brushToolState.brushSize, we receive it via onToolChange invocations to us.
    // To keep the slider in sync, we mirror selected structure's brush size through imageMetadata unit context if available via props.
    // Since ContourEditToolbar owns the activation and initial size, we listen for window events dispatched by viewer when brush size changes.
    const handler = (e: any) => {
      const newSize = Number(e?.detail?.brushSize);
      if (Number.isFinite(newSize)) {
        setBrushThickness([newSize]);
      }
    };
    window.addEventListener('brush:size:update', handler as EventListener);
    return () => window.removeEventListener('brush:size:update', handler as EventListener);
  }, []);

  // Notify parent when tool is activated
  const handleToolActivation = (toolId: string) => {
    log.debug(`TOOLBAR: Tool activated: ${toolId}`, 'toolbar');
    
    // Special handling for margin button - directly open the panel
    if (toolId === 'margin') {
      if (onOpenAdvancedMarginTool) {
        onOpenAdvancedMarginTool();
      }
      return;
    }
    
    const isActive = activeTool === toolId;
    const newTool = isActive ? null : toolId;
    setActiveTool(newTool);
    
    log.debug(`TOOLBAR: Setting tool to: ${newTool} active=${newTool !== null}`, 'toolbar');
    
    // Pass tool state to parent
    if (onToolChange) {
      const toolState = {
        tool: newTool,
        brushSize: brushThickness[0],
        isActive: newTool !== null,
        predictionEnabled: isPredictionEnabled
      };
      log.debug('TOOLBAR: Sending tool state to parent', 'toolbar');
      onToolChange(toolState);
    }
    
    // Auto-expand settings for the active tool  
    if (newTool && (newTool === 'brush' || newTool === 'pen' || newTool === 'pen-original' || newTool === 'erase')) {
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

  // New undo/redo handlers using the revamped system
  const handleUndo = () => {
    if (!seriesId) return;
    
    const previousState = undoRedoManager.undo();
    if (previousState) {
      log.debug(`Undoing to: ${previousState.action} on structure ${previousState.structureId}`, 'toolbar');
      if (onContourUpdate) {
        onContourUpdate(previousState.rtStructures);
      }
      toast({ title: `Undone: ${previousState.action}` });
    } else {
      toast({ title: "Nothing to undo", variant: "destructive" });
    }
  };

  const handleRedo = () => {
    if (!seriesId) return;
    
    const nextState = undoRedoManager.redo();
    if (nextState) {
      log.debug(`Redoing to: ${nextState.action} on structure ${nextState.structureId}`, 'toolbar');
      if (onContourUpdate) {
        onContourUpdate(nextState.rtStructures);
      }
      toast({ title: `Redone: ${nextState.action}` });
    } else {
      toast({ title: "Nothing to redo", variant: "destructive" });
    }
  };

  // Check undo/redo availability
  const canUndo = undoRedoManager.canUndo();
  const canRedo = undoRedoManager.canRedo();



  // Delete operations functions
  const handleDeleteCurrentSlice = () => {
    if (!selectedStructure || !currentSlicePosition) return;
    
    log.debug(`Deleting contour for structure ${selectedStructure.roiNumber} at slice ${currentSlicePosition}`, 'toolbar');
    
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
    
    log.debug(`Deleting contour for structure ${selectedStructure.roiNumber} at slice ${sliceNum}`, 'toolbar');
    
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
    
    log.debug(`Clearing all contours for structure ${selectedStructure.roiNumber}`, 'toolbar');
    
    if (onContourUpdate) {
      const updatePayload = {
        action: 'clear_all',
        structureId: selectedStructure.roiNumber
      };
      onContourUpdate(updatePayload);
    }
    
    toast({ title: `Cleared all contours for ${selectedStructure.structureName}` });
  };
  
  const handleInterpolate = () => {
    if (!selectedStructure) return;
    
    log.debug(`Interpolating missing slices for structure ${selectedStructure.roiNumber}`, 'toolbar');
    
    if (onContourUpdate) {
      const updatePayload = {
        action: 'interpolate',
        structureId: selectedStructure.roiNumber
      };
      onContourUpdate(updatePayload);
    }
    
    toast({ title: `Interpolating missing slices for ${selectedStructure.structureName}` });
  };
  
  const handleDeleteEveryNthSlice = (n: number) => {
    if (!selectedStructure) return;
    
    log.debug(`Deleting every ${n} slice for structure ${selectedStructure.roiNumber}`, 'toolbar');
    
    if (onContourUpdate) {
      const updatePayload = {
        action: 'delete_nth_slice',
        structureId: selectedStructure.roiNumber,
        nth: n
      };
      onContourUpdate(updatePayload);
    }
    
    toast({ title: `Deleted every ${n === 2 ? '2nd' : n === 3 ? '3rd' : '4th'} slice for ${selectedStructure.structureName}` });
    setShowNthSliceMenu(false);
  };
  
  const handleClearBelowSlice = () => {
    if (!selectedStructure || !currentSlicePosition) return;
    
    log.debug(`Clearing all contours below slice ${currentSlicePosition} for structure ${selectedStructure.roiNumber}`, 'toolbar');
    
    if (onContourUpdate) {
      const updatePayload = {
        action: 'clear_below',
        structureId: selectedStructure.roiNumber,
        slicePosition: currentSlicePosition
      };
      onContourUpdate(updatePayload);
    }
    
    toast({ title: `Cleared contours below slice ${currentSlicePosition} for ${selectedStructure.structureName}` });
    setShowClearMenu(false);
  };
  
  const handleClearAboveSlice = () => {
    if (!selectedStructure || !currentSlicePosition) return;
    
    log.debug(`Clearing all contours above slice ${currentSlicePosition} for structure ${selectedStructure.roiNumber}`, 'toolbar');
    
    if (onContourUpdate) {
      const updatePayload = {
        action: 'clear_above',
        structureId: selectedStructure.roiNumber,
        slicePosition: currentSlicePosition
      };
      onContourUpdate(updatePayload);
    }
    
    toast({ title: `Cleared contours above slice ${currentSlicePosition} for ${selectedStructure.structureName}` });
    setShowClearMenu(false);
  };

  // Preview grow/shrink operation
  const handlePreviewGrowContour = async () => {
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
    
    log.debug(`🔹 Previewing ${growMode === 'grow' ? 'grow' : 'shrink'} operation: ${distanceMm}mm`, 'toolbar');
    
    // Trigger preview request through the callback mechanism
    if (onContourUpdate) {
      const previewPayload = {
        action: 'preview_grow_contour',
        structureId: selectedStructure.roiNumber,
        slicePosition: currentSlicePosition,
        distance: distanceMm,
        direction: growDirection
      };
      onContourUpdate(previewPayload);
    }
    
    toast({ title: `Preview: ${growMode === 'grow' ? 'Growing' : 'Shrinking'} by ${distanceCm}cm` });
  };

  // Clear preview contours
  const clearPreview = () => {
    setPreviewContours(null);
    setIsShowingPreview(false);
    if (onContourUpdate) {
      onContourUpdate({ action: 'clear_preview' });
    }
  };

  // Grow/Shrink contour function - apply the previewed operation
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
    
    log.debug(`${growMode === 'grow' ? 'Growing' : 'Shrinking'} contour for structure ${selectedStructure.roiNumber} by ${distanceCm}cm (${Math.abs(distanceMm)}mm) dir: ${growDirection} @ slice ${currentSlicePosition}`, 'toolbar');
    
    if (onContourUpdate) {
      const updatePayload = {
        action: 'apply_grow_contour',
        structureId: selectedStructure.roiNumber,
        slicePosition: currentSlicePosition,
        distance: distanceMm, // in millimeters (negative for shrink)
        direction: growDirection, // 'all', 'anterior', 'posterior', 'left', 'right', 'superior', 'inferior'
        usePreview: isShowingPreview // Use preview data if available
      };
      onContourUpdate(updatePayload);
    }

    // Clear preview after applying
    clearPreview();
    
    toast({ title: `${growMode === 'grow' ? 'Growing' : 'Shrinking'} contour by ${distanceCm}cm (${growDirection}) on current slice` });
  };

  if (!isVisible || !selectedStructure) return null;

  // Check if selected structure has multiple blobs
  const structure = rtStructures?.structures?.find((s: any) => s.roiNumber === selectedStructure.roiNumber);
  const blobCount = structure ? countStructureBlobs(structure) : 0;
  const hasMultipleBlobs = blobCount > 1;

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
  
  // Convert RGB to HSL for background hue blending
  const rgbToHsl = (r: number, g: number, b: number) => {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0, l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h /= 6;
    }
    return [h * 360, s * 100, l * 100];
  };
  
  const structureHsl = rgbToHsl(selectedStructure.color[0], selectedStructure.color[1], selectedStructure.color[2]);
  const backgroundHue = structureHsl[0];

  const mainTools = [
    { id: 'brush', icon: Brush, label: 'Brush' },
    { id: 'pen', icon: Pen, label: 'Pen' },
    { id: 'erase', icon: Scissors, label: 'Erase' },
    { id: 'margin', icon: Maximize2, label: 'Margin' }
  ];

  const renderSettingsPanel = () => {
    if (!showSettings) return null;

    return (
      <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-1 bg-white/10 backdrop-blur-md border border-white/30 rounded-lg py-1.5 px-2.5 shadow-2xl z-50 w-max max-w-[90vw]">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-medium text-gray-400 capitalize">{showSettings} Settings</h4>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowSettings(null)}
            className="text-gray-400 hover:text-white h-5 w-5 p-0"
          >
            <X size={10} />
          </Button>
        </div>
        
        {showSettings === 'grow' ? (
          <div className="space-y-3 w-full">
            <div className="text-xs text-gray-400 text-center">
              Use the Advanced Margin Tool in the toolbar for precise margin operations
            </div>
            <Button
              onClick={() => {
                onOpenAdvancedMarginTool?.();
                setShowSettings(null);
              }}
              className="w-full h-8 bg-cyan-500/20 border border-cyan-500/60 text-cyan-300 hover:bg-cyan-500/30"
            >
              Open Advanced Margin Tool
            </Button>
          </div>
        ) : showSettings === 'erase' ? (
          <div className="space-y-3 w-full">
            {/* Erase Tool Settings */}
            <div>
              <Label className="text-xs text-gray-300 mb-2 block">Erase Tool</Label>
              <div className="text-xs text-gray-400 mb-3">
                Click and drag to erase contour areas. Hold Shift while using brush tool for quick erase mode.
              </div>
            </div>

            {/* Brush Size for Erase */}
            <div>
              <Label className="text-xs text-gray-300 mb-2 block">
                Erase Brush Size: {brushThickness[0]}px
              </Label>
              <Slider
                value={brushThickness}
                onValueChange={setBrushThickness}
                max={50}
                min={5}
                step={1}
                className="w-full"
              />
            </div>

            {/* Erase Mode Options */}
            <div>
              <Label className="text-xs text-gray-300 mb-2 block">Erase Mode</Label>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs bg-red-900/20 hover:bg-red-900/30 border-red-600/50 text-red-400 hover:text-red-300"
                >
                  <Scissors className="w-3 h-3 mr-1" />
                  Precise Erase
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs bg-orange-900/20 hover:bg-orange-900/30 border-orange-600/50 text-orange-400 hover:text-orange-300"
                >
                                     <Trash2 className="w-3 h-3 mr-1" />
                  Area Erase
                </Button>
              </div>
            </div>

            {/* Quick Help */}
            <div className="mt-3 p-2 bg-blue-900/20 border border-blue-600/30 rounded-lg">
              <div className="text-xs text-blue-400">
                <strong>Tip:</strong> While using brush tool, hold Shift to temporarily switch to erase mode
              </div>
            </div>
          </div>
        ) : showSettings === 'margin' ? (
          <div className="space-y-3 w-full">
            <div className="text-xs text-gray-400 text-center">
              Use the Advanced Margin Tool in the toolbar for precise margin operations
            </div>
            <Button
              onClick={() => {
                onOpenAdvancedMarginTool?.();
                setShowSettings(null);
              }}
              className="w-full h-8 bg-cyan-500/20 border border-cyan-500/60 text-cyan-300 hover:bg-cyan-500/30"
            >
              Open Advanced Margin Tool
            </Button>
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
                
                log.debug(`Performing ${booleanOperation} operation between structures ${selectedStructure.roiNumber} and ${targetStructure}`, 'toolbar');
                
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
          <div className="flex items-center gap-2">
            {/* Brush Size Control - Ultra Compact */}
            <div className="flex items-center gap-2 px-2 py-1 bg-white/5 rounded-md border border-white/20">
              <Brush className="w-3.5 h-3.5 text-blue-300" />
              <Label className="text-[11px] text-gray-200 whitespace-nowrap">Size</Label>
              <span className="text-[11px] font-semibold text-blue-300 min-w-[3.2rem] text-right">
                {(() => {
                  const pixelSpacing = imageMetadata?.pixelSpacing?.split('\\').map(Number) || [0.9765625, 0.9765625];
                  const avgPixelSpacing = (pixelSpacing[0] + pixelSpacing[1]) / 2;
                  const brushSizeMM = brushThickness[0] * avgPixelSpacing;
                  const brushSizeCM = brushSizeMM / 10;
                  return `${brushSizeCM.toFixed(2)} cm`;
                })()}
              </span>
              <div className="w-28">
                <Slider
                  value={brushThickness}
                  onValueChange={(value) => {
                    setBrushThickness(value);
                    if (onToolChange && activeTool === 'brush') {
                      onToolChange({
                        tool: 'brush',
                        brushSize: value[0],
                        isActive: true,
                        predictionEnabled: isPredictionEnabled
                      });
                    }
                  }}
                  max={102}
                  min={1}
                  step={1}
                  className="h-1 [&_[role=slider]]:h-3 [&_[role=slider]]:w-3 [&_[role=slider]]:bg-blue-500 [&_[role=slider]]:border-blue-400"
                />
              </div>
              <span className="text-[11px] text-gray-400">({brushThickness[0]}px)</span>
            </div>

            {/* Mode Toggles - Icon Buttons */}
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  const enabled = !smartBrush;
                  setSmartBrush(enabled);
                  if (onToolChange && activeTool === 'brush') {
                    onToolChange({
                      tool: 'brush',
                      brushSize: brushThickness[0],
                      isActive: true,
                      smartBrushEnabled: enabled,
                      predictionEnabled: isPredictionEnabled
                    });
                  }
                }}
                title="Smart Brush (edge-aware)"
                className={`h-7 px-2 rounded-md border ${smartBrush ? 'border-green-400/60 bg-green-900/30 text-green-200' : 'border-white/20 text-gray-300 hover:bg-white/10'}`}
              >
                <Zap className="w-3.5 h-3.5" />
              </Button>

              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  const enabled = !isPredictionEnabled;
                  setIsPredictionEnabled(enabled);
                  if (onToolChange && activeTool === 'brush') {
                    onToolChange({
                      tool: 'brush',
                      brushSize: brushThickness[0],
                      isActive: true,
                      smartBrushEnabled: smartBrush,
                      predictionEnabled: enabled
                    });
                  }
                }}
                title="AI Predict next slice"
                className={`h-7 px-2 rounded-md border ${isPredictionEnabled ? 'border-purple-400/60 bg-purple-900/30 text-purple-200' : 'border-white/20 text-gray-300 hover:bg-white/10'}`}
              >
                <Sparkles className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        ) : showSettings === 'planar-contour' ? (
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-3">
              <div className="text-sm text-gray-300 font-medium">Pen Tool</div>
              <div className="text-xs text-gray-400">
                Unified pen tool with automatic add/subtract based on starting position
              </div>
            </div>
            
            <div className="space-y-3">
              <div className="text-xs text-gray-400">
                • Left-click to place points
              </div>
              <div className="text-xs text-gray-400">
                • Hold left mouse to draw continuously
              </div>
              <div className="text-xs text-gray-400">
                • Right-click to close contour
              </div>
              <div className="text-xs text-gray-400">
                • Hover near contours to highlight
              </div>
              <div className="text-xs text-gray-400">
                • Click & drag vertices to morph
              </div>
              <div className="text-xs text-gray-400">
                • Draw inside to add, outside to subtract
              </div>
            </div>
          </div>
        ) : showSettings === 'pen' ? (
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-3">
              <div className="text-sm text-gray-300 font-medium">Eclipse Pen Tool V2</div>
              <div className="text-xs text-gray-400">
                Advanced pen tool with Eclipse-style boolean operations and vertex editing
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
                • Click to place vertices or hold+drag for continuous drawing
              </div>
              <div className="text-xs text-gray-400">
                • Right-click to complete polygon
              </div>
              <div className="text-xs text-gray-400">
                • Draw inside structure: union operation
              </div>
              <div className="text-xs text-gray-400">
                • Draw crossing boundary: subtract (carve hole)
              </div>
              <div className="text-xs text-gray-400">
                • Draw outside: create new blob
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
    <div className="fixed bottom-24 lg:left-[58.33%] left-1/2 transform -translate-x-1/2 z-50" style={{ animationName: 'fadeInScale', animationDuration: '300ms', animationTimingFunction: 'ease-out', animationFillMode: 'both' }}>
      <div className="relative">
        <div 
          className="backdrop-blur-md border rounded-xl px-4 py-3 shadow-2xl"
          style={{ 
            backgroundColor: `hsla(${backgroundHue}, 20%, 10%, 0.75)`,
            borderColor: `${structureColorRgb}60` 
          }}
        >
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center space-x-3">
            {/* Structure info and controls */}
            <div 
              className="w-4 h-4 rounded border-2 border-white/60 shadow-sm"
              style={{ backgroundColor: structureColorRgb }}
            />
            <span className="text-white text-sm font-medium drop-shadow-sm">Editing:</span>
            <Input
              value={selectedStructure.structureName || ''}
              onChange={(e) => handleNameChange(e.target.value)}
              className="w-32 h-7 bg-white/10 border-white/30 text-white text-sm rounded-lg backdrop-blur-sm transition-all duration-200 focus:outline-none focus:ring-0 focus:border-blue-500/60 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 hover:border-white/50"
              style={{ WebkitTapHighlightColor: 'transparent' }}
              disabled={updateNameMutation.isPending}
            />
            <span className="text-white/90 text-sm drop-shadow-sm">Color:</span>
            <input
              type="color"
              value={currentColor}
              onChange={(e) => handleColorChange(e.target.value)}
              className="w-7 h-7 rounded border-2 border-white/30 bg-white/10 cursor-pointer backdrop-blur-sm"
              disabled={updateColorMutation.isPending}
            />
            
            {/* Separator */}
            <div className="w-px h-6 bg-white/30 mx-2" />
            
            {/* Undo/Redo buttons */}
            <Button
              variant="outline"
              size="sm"
              onClick={handleUndo}
              disabled={!canUndo}
              className="h-7 w-7 p-0 bg-white/10 border-2 border-white/30 text-white hover:text-white hover:bg-white/20 disabled:opacity-50 rounded-lg backdrop-blur-sm shadow-sm"
              title="Undo (Ctrl+Z)"
            >
              <Undo className="w-3 h-3" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRedo}
              disabled={!canRedo}
              className="h-7 w-7 p-0 bg-white/10 border-2 border-white/30 text-white hover:text-white hover:bg-white/20 disabled:opacity-50 rounded-lg backdrop-blur-sm shadow-sm"
              title="Redo (Ctrl+Y)"
            >
              <Redo className="w-3 h-3" />
            </Button>
            
            {/* Separator */}
            <div className="w-px h-6 bg-white/30 mx-2" />
            
            {/* Delete button */}
            <Button
              variant="outline"
              size="sm"
              onClick={handleDeleteCurrentSlice}
              className="h-7 px-2 bg-red-900/30 border-2 border-red-400/60 text-red-200 hover:text-red-100 hover:bg-red-800/40 rounded-lg backdrop-blur-sm shadow-sm"
              title="Delete Current Slice (Del)"
            >
              <Trash2 className="w-3 h-3 mr-1" />
              <span className="text-xs font-medium">Del Slice</span>
            </Button>
            
            {/* Interpolate button (renamed to Interp) */}
            <Button
              variant="outline"
              size="sm"
              onClick={handleInterpolate}
              className="h-7 px-2 bg-blue-900/30 border-2 border-blue-400/60 text-blue-200 hover:text-blue-100 hover:bg-blue-800/40 rounded-lg backdrop-blur-sm shadow-sm"
              title="Interpolate missing slices"
            >
              <GitBranch className="w-3 h-3 mr-1" />
              <span className="text-xs font-medium">Interp</span>
            </Button>
            
            {/* Nth Slice Delete button with hover menu */}
            <div 
              className="relative" 
              onMouseEnter={() => {
                if (nthMenuTimerRef.current) {
                  clearTimeout(nthMenuTimerRef.current);
                  nthMenuTimerRef.current = null;
                }
                setShowNthSliceMenu(true);
              }}
              onMouseLeave={() => {
                nthMenuTimerRef.current = setTimeout(() => {
                  setShowNthSliceMenu(false);
                }, 150);
              }}
            >
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 bg-orange-900/30 border-2 border-orange-400/60 text-orange-200 hover:text-orange-100 hover:bg-orange-800/40 rounded-lg backdrop-blur-sm shadow-sm"
                title="Delete every nth slice"
              >
                <Grid3x3 className="w-3 h-3 mr-1" />
                <span className="text-xs font-medium">Nth</span>
                <ChevronDown className="w-3 h-3 ml-1" />
              </Button>
              
              {showNthSliceMenu && (
                <div className="absolute top-full left-0 mt-0.5 bg-black/90 border border-gray-600 rounded-lg shadow-xl p-1 z-50 min-w-[140px]">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDeleteEveryNthSlice(2)}
                    className="w-full justify-start h-7 px-2 text-xs text-orange-400 hover:bg-orange-900/20"
                  >
                    Every 2nd slice
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDeleteEveryNthSlice(3)}
                    className="w-full justify-start h-7 px-2 text-xs text-orange-400 hover:bg-orange-900/20"
                  >
                    Every 3rd slice
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDeleteEveryNthSlice(4)}
                    className="w-full justify-start h-7 px-2 text-xs text-orange-400 hover:bg-orange-900/20"
                  >
                    Every 4th slice
                  </Button>
                </div>
              )}
            </div>
            
            {/* Smoothing button */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (!selectedStructure) return;
                log.debug(`Smoothing contours for structure ${selectedStructure.roiNumber}`, 'toolbar');
                
                if (onContourUpdate) {
                  const updatePayload = {
                    action: 'smooth',
                    structureId: selectedStructure.roiNumber,
                    smoothingFactor: 0.35, // Increased from 0.15 for more noticeable effect
                    triggerAnimation: true // Trigger the ripple animation
                  };
                  onContourUpdate(updatePayload);
                }
                
                toast({ 
                  title: `Smoothed ${selectedStructure.structureName}`,
                  description: 'Contours refined and polished'
                });
              }}
              className="h-7 px-2 bg-green-900/30 border-2 border-green-400/60 text-green-200 hover:text-green-100 hover:bg-green-800/40 rounded-lg backdrop-blur-sm shadow-sm"
              title="Smooth contours (increased strength)"
            >
              <Sparkles className="w-3 h-3 mr-1" />
              <span className="text-xs font-medium">Smooth</span>
            </Button>

            {/* Blob tools dropdown */}
            <div 
              className="relative" 
              onMouseEnter={() => {
                if (blobMenuTimerRef.current) {
                  clearTimeout(blobMenuTimerRef.current);
                  blobMenuTimerRef.current = null;
                }
                setShowBlobMenu(true);
              }}
              onMouseLeave={() => {
                blobMenuTimerRef.current = setTimeout(() => {
                  setShowBlobMenu(false);
                }, 150);
              }}
            >
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 bg-purple-900/30 border-2 border-purple-400/60 text-purple-200 hover:text-purple-100 hover:bg-purple-800/40 rounded-lg backdrop-blur-sm shadow-sm"
                title="Blob tools"
              >
                <SplitSquareHorizontal className="w-3 h-3 mr-1" />
                <span className="text-xs font-medium">Blob</span>
                <ChevronDown className="w-3 h-3 ml-1" />
              </Button>

              {showBlobMenu && (
                <div className="absolute top-full left-0 mt-0.5 bg-black/90 border border-gray-600 rounded-lg shadow-xl p-1 z-50 min-w-[180px]">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      if (!selectedStructure) return;
                      setShowBlobMenu(false);
                      onContourUpdate?.({ action: 'open_remove_blobs_dialog', structureId: selectedStructure.roiNumber });
                    }}
                    className="w-full justify-start h-7 px-2 text-xs text-purple-300 hover:bg-purple-900/20"
                  >
                    Remove blobs…
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      if (!selectedStructure) return;
                      setShowBlobMenu(false);
                      onContourUpdate?.({ action: 'separate_blobs', structureId: selectedStructure.roiNumber });
                    }}
                    className="w-full justify-start h-7 px-2 text-xs text-purple-300 hover:bg-purple-900/20"
                  >
                    Blob separator
                  </Button>
                </div>
              )}
            </div>

            {/* Clear button with hover menu */}
            <div 
              className="relative" 
              onMouseEnter={() => {
                if (clearMenuTimerRef.current) {
                  clearTimeout(clearMenuTimerRef.current);
                  clearMenuTimerRef.current = null;
                }
                setShowClearMenu(true);
              }}
              onMouseLeave={() => {
                clearMenuTimerRef.current = setTimeout(() => {
                  setShowClearMenu(false);
                }, 150);
              }}
            >
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 bg-red-900/30 border-2 border-red-400/60 text-red-200 hover:text-red-100 hover:bg-red-800/40 rounded-lg backdrop-blur-sm shadow-sm"
                title="Clear contours"
              >
                <Eraser className="w-3 h-3 mr-1" />
                <span className="text-xs font-medium">Clear</span>
                <ChevronDown className="w-3 h-3 ml-1" />
              </Button>
              
              {showClearMenu && (
                <div className="absolute top-full left-0 mt-0.5 bg-black/90 border border-gray-600 rounded-lg shadow-xl p-1 z-50 min-w-[160px]">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleClearAllSlices}
                    className="w-full justify-start h-7 px-2 text-xs text-red-500 hover:bg-red-950/20"
                  >
                    Delete all slices
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleClearBelowSlice}
                    className="w-full justify-start h-7 px-2 text-xs text-red-500 hover:bg-red-950/20"
                  >
                    Delete below current
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleClearAboveSlice}
                    className="w-full justify-start h-7 px-2 text-xs text-red-500 hover:bg-red-950/20"
                  >
                    Delete above current
                  </Button>
                </div>
              )}
            </div>
          </div>
          
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="text-white/70 hover:text-white hover:bg-white/20 h-7 w-7 p-0 rounded-lg backdrop-blur-sm shadow-sm"
          >
            <X size={14} />
          </Button>
        </div>

        <Separator className="my-2 bg-gray-700" />

        {/* Tool Buttons */}
        <div className="flex items-center space-x-1">
          {/* Main tool buttons */}
          {mainTools.map((tool) => {
            const IconComponent = tool.icon;
            const isActive = activeTool === tool.id || (tool.id === 'grow' && showSettings === 'grow');
            const hasSettings = showSettings === tool.id;
            return (
              <div key={tool.id} className="relative group flex items-center">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleToolActivation(tool.id)}
                  className={`h-8 px-3 transition-all duration-200 rounded-lg text-gray-300 ${
                    isActive 
                      ? 'text-white border shadow-sm' 
                      : 'hover:bg-gray-700/50 hover:text-white'
                  }`}
                  style={isActive ? (
                    tool.id === 'grow' 
                      ? { 
                          borderColor: 'rgb(234, 179, 8)',
                          backgroundColor: 'rgb(234, 179, 8, 0.2)',
                          color: 'white'
                        }
                      : { 
                          borderColor: `${structureColorRgb}`,
                          backgroundColor: `${structureColorRgb}20`,
                          color: 'white'
                        }
                  ) : {}}
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
                    className={`ml-1 h-6 w-6 p-0 text-gray-400 hover:text-white hover:bg-gray-700/50 transition-all duration-200 rounded-lg ${
                      hasSettings ? 'bg-gray-700 text-white' : ''
                    }`}
                  >
                    <Settings size={12} />
                  </Button>
                )}

                {/* Tooltip */}
                <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-black bg-opacity-90 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                  {tool.label}
                </div>
              </div>
            );
          })}
        </div>

        {/* Settings Panel */}
        {renderSettingsPanel()}
        </div>
      </div>
    </div>
  );
}
