import { useState, useEffect, useRef, useMemo } from 'react';
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
  Check,
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
  SplitSquareHorizontal,
  Info,
  MousePointer2,
  Loader2
} from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { undoRedoManager } from '@/lib/undo-system';
import { growContourSimple } from '@/lib/simple-polygon-operations';
import { log } from '@/lib/log';
import { useToast } from '@/hooks/use-toast';
import { SmartNthSettingsDialog } from './smart-nth-settings-dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { segvolClient } from '@/lib/segvol-client';
import { monaiClient } from '@/lib/monai-client';
import { PredictionTuningPanel, DEFAULT_PARAMS, type PredictionParams as TuningParams } from './prediction-tuning-panel';

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
  onToolChange?: (toolState: {
    tool: string | null;
    brushSize: number;
    isActive: boolean;
    predictionEnabled?: boolean;
    smartBrushEnabled?: boolean;
    predictionMode?: 'fast' | 'balanced' | 'segvol' | 'monai' | 'mem3d';
    mem3dParams?: TuningParams;
    aiTumorSmoothOutput?: boolean;
  }) => void;
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
  activePredictions?: Map<number, any>;
  propagationMode?: 'conservative' | 'moderate' | 'aggressive';
  onPropagationModeChange?: (mode: 'conservative' | 'moderate' | 'aggressive') => void;
  canvasRef?: React.RefObject<HTMLCanvasElement>; // For dispatching events to AITumorTool
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
  activePredictions,
  propagationMode = 'moderate',
  onPropagationModeChange,
  canvasRef
}: ContourEditToolbarProps) {
  const [activeTool, setActiveTool] = useState<string | null>(null);
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
  const [predictionMode, setPredictionMode] = useState<'fast' | 'balanced' | 'segvol' | 'monai' | 'mem3d'>('mem3d'); // Prediction algorithm mode
  const [mem3dParams, setMem3dParams] = useState<TuningParams>(DEFAULT_PARAMS); // MEM3D tuning parameters
  const [segvolAvailable, setSegvolAvailable] = useState<boolean | null>(null); // SegVol service availability
  const [monaiAvailable, setMonaiAvailable] = useState<boolean | null>(null); // MONAI service availability
  const [aiTumorSmoothOutput, setAiTumorSmoothOutput] = useState(false); // AI tumor tool smoothing option
  const [showNthSliceMenu, setShowNthSliceMenu] = useState(false);
  const [showClearMenu, setShowClearMenu] = useState(false);
  const [showBlobMenu, setShowBlobMenu] = useState(false);

  // Keyboard shortcuts for Accept (A) and Reject (X) predictions
  useEffect(() => {
    if (!isVisible || !activePredictions || activePredictions.size === 0) return;

    const handleKeyPress = (e: KeyboardEvent) => {
      // Only trigger if not typing in an input field
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      
      const key = e.key.toLowerCase();
      
      if (key === 'a') {
        e.preventDefault();
        if (onContourUpdate) {
          onContourUpdate({ 
            action: 'accept_predictions', 
            structureId: selectedStructure?.roiNumber 
          });
        }
        toast({ title: 'Prediction accepted' });
      } else if (key === 'x') {
        e.preventDefault();
        if (onContourUpdate) {
          onContourUpdate({ 
            action: 'reject_predictions', 
            structureId: selectedStructure?.roiNumber 
          });
        }
        toast({ title: 'Prediction rejected' });
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [isVisible, activePredictions, onContourUpdate, selectedStructure]);

  // Check AI service availability on mount and when prediction is enabled
  useEffect(() => {
    let cancelled = false;

    const checkServices = async () => {
      try {
        const [segvolHealth, monaiHealth] = await Promise.all([
          segvolClient.checkHealth(),
          monaiClient.checkHealth(),
        ]);
        if (!cancelled) {
          setSegvolAvailable(segvolHealth.segvol_available);
          setMonaiAvailable(monaiHealth.monai_available ?? (monaiHealth.status === 'ok'));
        }
      } catch (error) {
        if (!cancelled) {
          setSegvolAvailable(false);
          setMonaiAvailable(false);
        }
      }
    };

    if (isPredictionEnabled) {
      checkServices();
    }

    return () => {
      cancelled = true;
    };
  }, [isPredictionEnabled]);

  // Notify parent when prediction mode or params change
  useEffect(() => {
    if (onToolChange && activeTool === 'brush' && isPredictionEnabled) {
      console.log('🎛️ Toolbar: Sending updated params to viewer:', mem3dParams);
      onToolChange({
        tool: 'brush',
        brushSize: brushThickness[0],
        isActive: true,
        smartBrushEnabled: smartBrush,
        predictionEnabled: isPredictionEnabled,
        predictionMode: predictionMode,
        mem3dParams: mem3dParams
      });
    }
  }, [predictionMode, mem3dParams, onToolChange, activeTool, isPredictionEnabled, brushThickness, smartBrush]);

  const [showInfoDialog, setShowInfoDialog] = useState(false);
  const [showSmartNthDialog, setShowSmartNthDialog] = useState(false);
  const [totalSlicesForSmartNth, setTotalSlicesForSmartNth] = useState(0);
  
  const normalizedCurrentSlice = useMemo(() => {
    if (currentSlicePosition == null || !Number.isFinite(currentSlicePosition)) return null;
    return Math.round(currentSlicePosition * 1000) / 1000;
  }, [currentSlicePosition]);

  const sliceSpacing = useMemo(() => {
    let spacing = 2.5;
    const parsedSpacing = parseFloat(imageMetadata?.spacingBetweenSlices ?? imageMetadata?.sliceThickness);
    if (!Number.isNaN(parsedSpacing) && parsedSpacing > 0) {
      spacing = parsedSpacing;
    }
    return spacing;
  }, [imageMetadata?.spacingBetweenSlices, imageMetadata?.sliceThickness]);

  const hasPredictionForCurrentSlice = useMemo(() => {
    if (!isPredictionEnabled || !activePredictions || activePredictions.size === 0) return false;
    if (normalizedCurrentSlice == null) return false;
    
    const tolerance = sliceSpacing * 0.4;
    
    return Array.from(activePredictions.keys()).some(slicePos => 
      Math.abs(slicePos - normalizedCurrentSlice) <= tolerance
    );
  }, [isPredictionEnabled, activePredictions, normalizedCurrentSlice, sliceSpacing]);

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
    
    // Pass tool state to parent - include AI tumor settings if activating that tool
    if (toolId === 'interactive-tumor' && newTool !== null) {
      if (onToolChange) {
        onToolChange({
          tool: 'interactive-tumor',
          brushSize: 0,
          isActive: true,
          aiTumorSmoothOutput: aiTumorSmoothOutput
        });
      }
      return;
    }
    
    // Pass tool state to parent
    if (onToolChange) {
      const toolState = {
        tool: newTool,
        brushSize: brushThickness[0],
        isActive: newTool !== null,
        predictionEnabled: isPredictionEnabled,
        predictionMode: predictionMode,
        mem3dParams: mem3dParams
      };
      log.debug('TOOLBAR: Sending tool state to parent', 'toolbar');
      onToolChange(toolState);
    }
    
    // Close info dialog when switching tools
    setShowInfoDialog(false);
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
    if (!selectedStructure || currentSlicePosition == null) return;
    
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
    
    toast({ title: "Interpolating...", description: `Processing ${selectedStructure.structureName}` });
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
  
  const handleOpenSmartNthDialog = () => {
    if (!selectedStructure) return;
    
    // Request total slice count from viewer
    if (onContourUpdate) {
      const updatePayload = {
        action: 'get_slice_count',
        structureId: selectedStructure.roiNumber,
        callback: (count: number) => {
          setTotalSlicesForSmartNth(count);
          setShowSmartNthDialog(true);
        }
      };
      onContourUpdate(updatePayload);
    }
    
    setShowNthSliceMenu(false);
  };
  
  const handleApplySmartNth = (threshold: number) => {
    if (!selectedStructure) return;
    
    log.debug(`Applying SmartNth with threshold ${threshold}% for structure ${selectedStructure.roiNumber}`, 'toolbar');
    
    if (onContourUpdate) {
      const updatePayload = {
        action: 'smart_nth_slice',
        structureId: selectedStructure.roiNumber,
        threshold: threshold
      };
      onContourUpdate(updatePayload);
    }
    
    toast({ 
      title: `SmartNth applied to ${selectedStructure.structureName}`,
      description: `Removed slices with <${threshold}% area change (max gap: 3)`
    });
  };
  
  const handleClearBelowSlice = () => {
    if (!selectedStructure || currentSlicePosition == null) return;
    
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
    if (!selectedStructure || currentSlicePosition == null) return;
    
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
    if (!selectedStructure || !growDistance || currentSlicePosition == null) return;
    
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
    if (!selectedStructure || !growDistance || currentSlicePosition == null) return;
    
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
    { id: 'margin', icon: Maximize2, label: 'Margin' },
    { id: 'interactive-tumor', icon: Sparkles, label: 'AI Tumor' }
  ];

  // Render inline settings on the bottom toolbar row
  const renderInlineSettings = () => {
    if (!activeTool) return null;

    if (activeTool === 'brush') {
      return (
        <div className="flex items-center gap-2 ml-3 pl-3 border-l border-white/20">
          {/* Brush Size Control - Compact */}
          <div className="flex items-center gap-2 px-2 py-1 bg-white/5 rounded-md border border-white/20">
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
                      predictionEnabled: isPredictionEnabled,
                      predictionMode: predictionMode,
                      mem3dParams: mem3dParams
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

          <div className="flex items-center gap-1.5">
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
                    predictionEnabled: isPredictionEnabled,
                    predictionMode: predictionMode,
                    mem3dParams: mem3dParams
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
                    predictionEnabled: enabled,
                    predictionMode: predictionMode,
                    mem3dParams: mem3dParams
                  });
                }
              }}
              title="Toggle next slice prediction"
              className={`h-7 px-2 rounded-md border ${isPredictionEnabled ? 'border-purple-400/60 bg-purple-900/30 text-purple-200' : 'border-white/20 text-gray-300 hover:bg-white/10'}`}
            >
              <Sparkles className="w-3.5 h-3.5" />
            </Button>

            {/* Prediction Mode Selector */}
            {isPredictionEnabled && (
              <Select value={predictionMode} onValueChange={(value: any) => setPredictionMode(value)}>
                <SelectTrigger className="h-7 w-[120px] text-[11px] bg-white/5 border-white/20 text-gray-200">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-gray-900 border-white/20">
                  <SelectItem value="fast" className="text-[11px]">
                    <div className="flex items-center gap-1.5">
                      <Zap className="w-3 h-3 text-blue-400" />
                      <span>Fast</span>
                      <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-blue-400/40 text-blue-300">~10ms</Badge>
                    </div>
                  </SelectItem>
                  <SelectItem value="balanced" className="text-[11px]">
                    <div className="flex items-center gap-1.5">
                      <Workflow className="w-3 h-3 text-green-400" />
                      <span>Balanced</span>
                      <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-green-400/40 text-green-300">~15ms</Badge>
                    </div>
                  </SelectItem>
                  <SelectItem
                    value="segvol"
                    disabled={segvolAvailable === false}
                    className="text-[11px]"
                  >
                    <div className="flex items-center gap-1.5">
                      <Sparkles className="w-3 h-3 text-purple-400" />
                      <span>SegVol</span>
                      <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-purple-400/40 text-purple-300">~1s</Badge>
                      {segvolAvailable === false && (
                        <Badge variant="destructive" className="text-[8px] px-1 py-0 h-3.5">Offline</Badge>
                      )}
                      {segvolAvailable === null && (
                        <Badge variant="outline" className="text-[8px] px-1 py-0 h-3.5 border-yellow-400/40 text-yellow-300">...</Badge>
                      )}
                    </div>
                  </SelectItem>
                  <SelectItem
                    value="monai"
                    disabled={monaiAvailable === false}
                    className="text-[11px]"
                  >
                    <div className="flex items-center gap-1.5">
                      <Workflow className="w-3 h-3 text-orange-400" />
                      <span>MONAI</span>
                      <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-orange-400/40 text-orange-300">~0.8s</Badge>
                      {monaiAvailable === false && (
                        <Badge variant="destructive" className="text-[8px] px-1 py-0 h-3.5">Offline</Badge>
                      )}
                      {monaiAvailable === null && (
                        <Badge variant="outline" className="text-[8px] px-1 py-0 h-3.5 border-yellow-400/40 text-yellow-300">...</Badge>
                      )}
                    </div>
                  </SelectItem>
                  <SelectItem value="mem3d" className="text-[11px]">
                    <div className="flex items-center gap-1.5">
                      <Sparkles className="w-3 h-3 text-cyan-400" />
                      <span>MEM3D</span>
                      <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-cyan-400/40 text-cyan-300">~50ms</Badge>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            )}

            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (onContourUpdate) {
                  onContourUpdate({
                    action: 'accept_predictions',
                    structureId: selectedStructure?.roiNumber,
                    slicePosition: currentSlicePosition
                  });
                }
                toast({ title: 'Prediction accepted (A)' });
              }}
              disabled={!hasPredictionForCurrentSlice}
              title={hasPredictionForCurrentSlice ? "Accept prediction (A)" : "No prediction on current slice"}
              className={`h-7 w-7 p-0 ${hasPredictionForCurrentSlice ? 'text-green-300 hover:bg-green-800/40' : 'text-gray-600 cursor-not-allowed'}`}
            >
              <Check className="w-3.5 h-3.5" />
            </Button>
            
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (onContourUpdate) {
                  onContourUpdate({ 
                    action: 'reject_predictions', 
                    structureId: selectedStructure?.roiNumber,
                    slicePosition: currentSlicePosition
                  });
                }
                toast({ title: 'Prediction rejected (X)' });
              }}
              disabled={!hasPredictionForCurrentSlice}
              title={hasPredictionForCurrentSlice ? "Reject prediction (X)" : "No prediction on current slice"}
              className={`h-7 w-7 p-0 ${hasPredictionForCurrentSlice ? 'text-red-300 hover:bg-red-800/40' : 'text-gray-600 cursor-not-allowed'}`}
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      );
    }

    if (activeTool === 'pen') {
      return (
        <div className="flex items-center gap-2 ml-3 pl-3 border-l border-white/20">
          <span className="text-[11px] text-gray-300">Eclipse Pen Tool V2</span>
          <div className="flex items-center gap-1.5 px-2 py-1 bg-white/5 rounded-md border border-white/20">
            <Label className="text-[10px] text-gray-300">Auto-close</Label>
            <span className="text-[10px] text-gray-400">8px</span>
          </div>
          <div className="flex items-center gap-1.5 px-2 py-1 bg-white/5 rounded-md border border-white/20">
            <Label className="text-[10px] text-gray-300">Vertex Snap</Label>
            <Switch
              checked={true}
              onCheckedChange={() => {}}
              className="data-[state=checked]:bg-blue-500 scale-75"
            />
          </div>
        </div>
      );
    }

    if (activeTool === 'erase') {
      return (
        <div className="flex items-center gap-2 ml-3 pl-3 border-l border-white/20">
          <span className="text-[11px] text-gray-300">Erase size uses brush settings</span>
        </div>
      );
    }

    if (activeTool === 'interactive-tumor') {
      return (
        <div className="flex items-center gap-3 ml-3 pl-3 border-l border-white/20">
          {/* Instruction */}
          <div className="flex items-center gap-1.5">
            <MousePointer2 className="w-3.5 h-3.5" style={{ color: structureColorRgb }} />
            <span className="text-[11px] text-gray-300">Click tumor center</span>
          </div>

          {/* Smooth toggle - no box */}
          <div className="flex items-center gap-1.5">
            <Switch
              id="ai-smooth-output"
              checked={aiTumorSmoothOutput}
              onCheckedChange={(checked) => {
                setAiTumorSmoothOutput(checked);
                if (onToolChange && activeTool === 'interactive-tumor') {
                  onToolChange({
                    tool: 'interactive-tumor',
                    brushSize: 0,
                    isActive: true,
                    aiTumorSmoothOutput: checked
                  });
                }
              }}
              className="data-[state=checked]:bg-emerald-500 scale-90"
            />
            <Label 
              htmlFor="ai-smooth-output" 
              className="text-[10px] text-gray-400 cursor-pointer select-none whitespace-nowrap"
            >
              Smooth
            </Label>
          </div>

          {/* Generate button - cleaner */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (canvasRef?.current) {
                const event = new Event('ai-tumor-segment');
                canvasRef.current.dispatchEvent(event);
              }
            }}
            className="h-7 px-3 bg-emerald-600/80 hover:bg-emerald-500/80 border border-emerald-500/50 text-white rounded-md transition-colors"
            title="Generate 3D segmentation"
          >
            <Sparkles className="w-3 h-3 mr-1.5" />
            <span className="text-xs font-medium">Generate</span>
          </Button>

          {/* Clear button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (canvasRef?.current) {
                const event = new Event('ai-tumor-clear');
                canvasRef.current.dispatchEvent(event);
              }
            }}
            className="h-7 w-7 p-0 text-gray-400 hover:text-white hover:bg-white/10 rounded-md"
            title="Clear click point"
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      );
    }

    return null;
  };

  // Info dialog content for the active tool
  const renderInfoDialog = () => {
    if (!showInfoDialog) return null;

    let infoContent = null;

    if (activeTool === 'brush') {
      infoContent = (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-white">Brush Tool</h3>
          <ul className="text-xs text-gray-300 space-y-1 list-disc list-inside">
            <li>Click and drag to paint contours</li>
            <li>Hold Shift to temporarily switch to erase mode</li>
            <li>Right-drag to adjust brush size on-the-fly</li>
            <li>Smart Brush: edge-aware painting</li>
            <li>AI Predict: auto-predict contour on next slice</li>
          </ul>
        </div>
      );
    } else if (activeTool === 'pen') {
      infoContent = (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-white">Eclipse Pen Tool V2</h3>
          <ul className="text-xs text-gray-300 space-y-1 list-disc list-inside">
            <li>Click to place vertices or hold+drag for continuous drawing</li>
            <li>Right-click to complete polygon</li>
            <li>Draw inside structure: union operation</li>
            <li>Draw crossing boundary: subtract (carve hole)</li>
            <li>Draw outside: create new blob</li>
            <li>Click & drag vertices to morph existing contours</li>
          </ul>
        </div>
      );
    } else if (activeTool === 'erase') {
      infoContent = (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-white">Erase Tool</h3>
          <ul className="text-xs text-gray-300 space-y-1 list-disc list-inside">
            <li>Click and drag to erase contour areas</li>
            <li>Uses the same size settings as the brush tool</li>
            <li>Hold Shift while using brush tool for quick erase mode</li>
          </ul>
        </div>
      );
    } else if (activeTool === 'interactive-tumor') {
      infoContent = (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-purple-400" />
            Interactive AI Tumor Segmentation
          </h3>
          <ul className="text-xs text-gray-300 space-y-1 list-disc list-inside">
            <li>Draw scribbles on tumor in 3-5 key slices</li>
            <li>AI generates full 3D segmentation automatically</li>
            <li>Use "Draw" mode for tumor, "Erase" for background</li>
            <li>System recommends which slice to annotate next</li>
            <li>Preview and refine before accepting</li>
            <li>Much faster than slice-by-slice contouring</li>
          </ul>
          <div className="text-xs text-yellow-300 bg-yellow-900/20 p-2 rounded border border-yellow-500/30 mt-2">
            ⚠️ Requires nnInteractive service to be running
          </div>
        </div>
      );
    } else if (activeTool === 'margin') {
      infoContent = (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-white">Margin Tool</h3>
          <p className="text-xs text-gray-300">
            Opens the Advanced Margin Tool for precise margin operations including grow, shrink, and directional expansions.
          </p>
        </div>
      );
    }

    return (
      <div className="absolute bottom-full right-0 mb-2 bg-black/95 backdrop-blur-md border border-white/30 rounded-lg p-3 shadow-2xl z-[60] w-80">
        <div className="flex items-start justify-between mb-2">
          <Info className="w-4 h-4 text-blue-400 mt-0.5" />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowInfoDialog(false)}
            className="text-gray-400 hover:text-white h-5 w-5 p-0 -mt-1"
          >
            <X size={12} />
          </Button>
        </div>
        {infoContent}
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
            
            {/* Interpolate button */}
            <Button
              variant="outline"
              size="sm"
              onClick={handleInterpolate}
              className="h-7 px-2 bg-blue-900/30 border-2 border-blue-400/60 text-blue-200 hover:text-blue-100 hover:bg-blue-800/40 rounded-lg backdrop-blur-sm shadow-sm"
              title="Interpolate missing slices (fast)"
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
                  <div className="h-px bg-gray-600 my-1" />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleOpenSmartNthDialog}
                    className="w-full justify-start h-7 px-2 text-xs text-orange-300 hover:bg-orange-900/20 font-medium"
                  >
                    SmartNth...
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

            {/* Blob tools dropdown - always enabled, checks on click like original */}
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

        {/* Tool Buttons with Inline Settings */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-1">
            {/* Main tool buttons */}
            {mainTools.map((tool) => {
              const IconComponent = tool.icon;
              const isActive = activeTool === tool.id;
              return (
                <div key={tool.id} className="relative group">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleToolActivation(tool.id)}
                    className={`h-8 px-3 transition-all duration-200 rounded-lg text-gray-300 ${
                      isActive 
                        ? 'text-white border shadow-sm' 
                        : 'hover:bg-gray-700/50 hover:text-white'
                    }`}
                    style={isActive ? { 
                      borderColor: `${structureColorRgb}`,
                      backgroundColor: `${structureColorRgb}20`,
                      color: 'white'
                    } : {}}
                  >
                    <IconComponent className="w-4 h-4 mr-2" />
                    <span className="text-sm">{tool.label}</span>
                  </Button>

                  {/* Tooltip */}
                  <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-black bg-opacity-90 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                    {tool.label}
                  </div>
                </div>
              );
            })}

            {/* Inline Settings Area */}
            {renderInlineSettings()}
          </div>

          {/* Info Button */}
          {activeTool && (
            <div className="relative">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowInfoDialog(!showInfoDialog)}
                className={`h-8 w-8 p-0 rounded-lg transition-all duration-200 ${
                  showInfoDialog 
                    ? 'bg-blue-500/20 text-blue-300 border border-blue-400/60' 
                    : 'text-gray-400 hover:text-white hover:bg-white/10'
                }`}
                title="Tool help"
              >
                <Info className="w-4 h-4" />
              </Button>
              
              {/* Info Dialog */}
              {renderInfoDialog()}
            </div>
          )}
        </div>
        </div>
      </div>
      
      {/* SmartNth Settings Dialog */}
      <SmartNthSettingsDialog
        isOpen={showSmartNthDialog}
        onClose={() => setShowSmartNthDialog(false)}
        onApply={handleApplySmartNth}
        structureName={selectedStructure?.structureName || ''}
        totalSlices={totalSlicesForSmartNth}
      />

      {/* Prediction Tuning Panel */}
      {predictionMode === 'mem3d' && isPredictionEnabled && (
        <PredictionTuningPanel
          params={mem3dParams}
          onParamsChange={setMem3dParams}
          onReset={() => setMem3dParams(DEFAULT_PARAMS)}
        />
      )}
    </div>
  );
}
