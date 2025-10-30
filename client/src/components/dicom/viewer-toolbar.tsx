import React from 'react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { 
  ZoomIn, 
  ZoomOut, 
  Maximize2, 
  Hand, 
  Ruler, 
  MessageSquare,
  Edit3,
  Settings,
  Info,
  HelpCircle,
  Keyboard,
  Layers,
  Grid3x3,
  Activity,
  Crosshair,
  Workflow,
  ArrowUpFromLine,
  Move3d,
  Target,
  Undo,
  Redo,
  History
} from 'lucide-react';

interface ViewerToolbarProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitToWindow: () => void;
  onPan: () => void;
  onMeasure: () => void;
  onCrosshairs?: () => void;
  onContourEdit?: () => void;
  onContourOperations?: () => void;
  onAdvancedMarginTool?: () => void;
  isContourEditActive?: boolean;
  isContourOperationsActive?: boolean;
  isAdvancedMarginToolActive?: boolean;
  isPanActive?: boolean;
  isMeasureActive?: boolean;
  isCrosshairsActive?: boolean;
  isToolActive?: boolean;
  currentSlice?: number;
  totalSlices?: number;
  windowLevel?: {
    window: number;
    level: number;
  };
  className?: string;
  onMPRToggle?: () => void;
  isMPRActive?: boolean;
  onFusionToggle?: () => void;
  isFusionActive?: boolean;
  onLocalization?: () => void;
  isLocalizationActive?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  historyItems?: Array<{ timestamp: number; action: string; structureId: number }>;
  currentHistoryIndex?: number;
  onSelectHistory?: (index: number) => void;
}

export function ViewerToolbar({
  onZoomIn,
  onZoomOut,
  onFitToWindow,
  onPan,
  onMeasure,
  onCrosshairs,
  onContourEdit,
  onContourOperations,
  onAdvancedMarginTool,
  isContourEditActive = false,
  isContourOperationsActive = false,
  isAdvancedMarginToolActive = false,
  isPanActive = false,
  isMeasureActive = false,
  isCrosshairsActive = false,
  isToolActive = false,
  currentSlice,
  totalSlices,
  windowLevel,
  className,
  onMPRToggle,
  isMPRActive = false,
  onFusionToggle,
  isFusionActive = false,
  onLocalization,
  isLocalizationActive = false,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  historyItems = [],
  currentHistoryIndex = -1,
  onSelectHistory
}: ViewerToolbarProps) {
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [showMetadata, setShowMetadata] = useState(false);
  const [showInteractionTips, setShowInteractionTips] = useState(false);
  const [tipsDialogOpen, setTipsDialogOpen] = useState(false);
  const [showContourOperations, setShowContourOperations] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const handleToolSelect = (tool: string, callback: () => void) => {
    // Ensure only one selectable tool is active at a time (except MPR which is a toggle)
    if (tool === 'pan' || tool === 'measure' || tool === 'crosshairs') {
      setActiveTool(tool);
    } else if (tool === 'mpr') {
      // MPR is a toggle button, not an exclusive tool
      callback();
      return;
    }
    callback();
  };

  const tools = [
    { id: 'zoom-in', icon: ZoomIn, label: 'Zoom In', action: onZoomIn },
    { id: 'zoom-out', icon: ZoomOut, label: 'Zoom Out', action: onZoomOut },
    { id: 'fit', icon: Maximize2, label: 'Fit to Window', action: onFitToWindow },
    { id: 'separator' },
    { id: 'pan', icon: Hand, label: 'Pan', action: onPan, selectable: true },
    { id: 'crosshairs', icon: Crosshair, label: 'Crosshairs', action: onCrosshairs || (() => console.log('Crosshairs not configured')), selectable: true },
    { id: 'measure', icon: Ruler, label: 'Measure', action: onMeasure, selectable: true },
    { id: 'separator' },
    { id: 'mpr', icon: Grid3x3, label: 'MPR View', action: onMPRToggle || (() => console.log('MPR Toggle not configured')), selectable: true },
    { id: 'fusion', icon: Layers, label: 'Fusion', action: onFusionToggle || (() => console.log('Fusion Toggle not configured')), selectable: true },
    { id: 'dose-plan', icon: Activity, label: 'Dose/Plan Review (Coming Soon)', action: () => console.log('Dose/Plan Review - Coming Soon') },
    { id: 'separator' },
    { id: 'localization', icon: Target, label: '🎯 Structure Localization', action: onLocalization || (() => console.log('🎯 Localization button clicked!')), selectable: true },
    { id: 'metadata', icon: Info, label: 'View DICOM Metadata', action: () => setShowMetadata(!showMetadata) },
    { id: 'help', icon: HelpCircle, label: 'Interaction Guide', action: () => setTipsDialogOpen(!tipsDialogOpen) },
  ];

  return (
    <div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 z-40 animate-in slide-in-from-bottom-2 duration-300">
      <div className="relative">
        {/* Main Toolbar */}
        <div className="bg-white/10 backdrop-blur-md border border-white/40 rounded-xl px-3 py-2 shadow-2xl">
          <div className="flex items-center space-x-1">
            {tools.map((tool, index) => {
              if (tool.id === 'separator') {
                return (
                  <div key={index} className="w-px h-5 bg-white/30 mx-1.5" />
                );
              }

              const IconComponent = tool.icon!;
              const isActive = tool.id === 'mpr' ? isMPRActive : (tool.selectable && activeTool === tool.id);

              return (
                <div key={tool.id} className="relative group">
                  <Button
                    variant="ghost"
                    size="sm"
                    className={`
                      h-8 w-8 p-0 transition-all duration-200 rounded-lg text-white/90
                      ${tool.id === 'mpr' && isMPRActive
                        ? 'bg-green-600/20 text-green-400 border border-green-500/50 shadow-sm' 
                        : tool.id === 'localization' && isLocalizationActive
                        ? 'bg-orange-600/20 text-orange-400 border border-orange-500/50 shadow-sm'
                        : isActive 
                        ? 'bg-blue-600/20 text-blue-400 border border-blue-500/50 shadow-sm' 
                        : 'hover:bg-white/20 hover:text-white'
                      }
                    `}
                    onClick={() => {
                      if (tool.selectable) {
                        handleToolSelect(tool.id, tool.action!);
                      } else {
                        tool.action!();
                      }
                    }}
                    onMouseEnter={() => {
                      if (tool.id === 'help' && !tipsDialogOpen) {
                        setShowInteractionTips(true);
                      }
                    }}
                    onMouseLeave={() => {
                      if (tool.id === 'help' && !tipsDialogOpen) {
                        setShowInteractionTips(false);
                      }
                    }}
                  >
                    <IconComponent className="w-4 h-4" />
                  </Button>

                  {/* Tooltip */}
                  <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-black bg-opacity-90 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                    {tool.label}
                  </div>
                </div>
              );
            })}

          </div>
        </div>

        {/* Contour Edit and Operations Popout Icons - Always visible */}
        <div className="absolute -right-40 top-1/2 transform -translate-y-1/2 animate-in slide-in-from-left-2 duration-300">
          <div className="flex space-x-2">
            {/* Contour Edit Button */}
            {onContourEdit && (
              <div className="relative group">
                <div className={`backdrop-blur-md border rounded-xl shadow-lg transition-all duration-300 ${
                  isContourEditActive 
                    ? 'border-green-400 bg-gradient-to-br from-green-500/30 to-green-600/20 shadow-green-500/40 scale-105' 
                    : 'border-green-500/40 bg-white/5 hover:border-green-400/70 hover:bg-green-500/10 hover:shadow-green-500/20'
                }`}>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={`h-9 w-9 p-0 transition-all duration-300 hover:bg-transparent ${
                      isContourEditActive
                        ? 'text-green-200 hover:text-green-100'
                        : 'text-green-300 hover:text-green-200'
                    }`}
                    onClick={onContourEdit}
                  >
                    <Edit3 className={`transition-all duration-300 ${isContourEditActive ? 'w-5 h-5' : 'w-4 h-4'}`} />
                  </Button>
                </div>
                {/* Tooltip */}
                <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-black bg-opacity-90 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                  Edit Contours
                </div>
              </div>
            )}
            
            {/* Contour Operations Button */}
            {onContourOperations && (
              <div className="relative group">
                <div className={`backdrop-blur-md border rounded-xl shadow-lg transition-all duration-300 ${
                  isContourOperationsActive 
                    ? 'border-blue-400 bg-gradient-to-br from-blue-500/30 to-blue-600/20 shadow-blue-500/40 scale-105' 
                    : 'border-blue-500/40 bg-white/5 hover:border-blue-400/70 hover:bg-blue-500/10 hover:shadow-blue-500/20'
                }`}>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={`h-9 w-9 p-0 transition-all duration-300 hover:bg-transparent ${
                      isContourOperationsActive
                        ? 'text-blue-200 hover:text-blue-100'
                        : 'text-blue-300 hover:text-blue-200'
                    }`}
                    onClick={onContourOperations}
                  >
                    <Workflow className={`transition-all duration-300 ${isContourOperationsActive ? 'w-5 h-5' : 'w-4 h-4'}`} />
                  </Button>
                </div>
                {/* Tooltip */}
                <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-black bg-opacity-90 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                  Boolean Operations
                </div>
              </div>
            )}
            


            {/* Advanced Margin Tool Button */}
            {onAdvancedMarginTool && (
              <div className="relative group">
                <div className={`backdrop-blur-md border rounded-xl shadow-lg transition-all duration-300 ${
                  isAdvancedMarginToolActive 
                    ? 'border-cyan-400 bg-gradient-to-br from-cyan-500/30 to-cyan-600/20 shadow-cyan-500/40 scale-105' 
                    : 'border-cyan-500/40 bg-white/5 hover:border-cyan-400/70 hover:bg-cyan-500/10 hover:shadow-cyan-500/20'
                }`}>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={`h-9 w-9 p-0 transition-all duration-300 hover:bg-transparent ${
                      isAdvancedMarginToolActive
                        ? 'text-cyan-200 hover:text-cyan-100'
                        : 'text-cyan-300 hover:text-cyan-200'
                    }`}
                    onClick={onAdvancedMarginTool}
                  >
                    <Move3d className={`transition-all duration-300 ${isAdvancedMarginToolActive ? 'w-5 h-5' : 'w-4 h-4'}`} />
                  </Button>
                </div>
                {/* Tooltip */}
                <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-black bg-opacity-90 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                  Margin Operations
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Undo/Redo/History cluster - left side of toolbar (always visible) */}
        <div className="absolute -left-40 top-1/2 transform -translate-y-1/2 animate-in slide-in-from-right-2 duration-300">
          <div className="bg-white/10 backdrop-blur-md border border-white/40 rounded-xl px-2 py-1 shadow-2xl">
            <div className="flex space-x-2">
              <div className="relative group">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 transition-all duration-200 rounded-lg text-white/90 hover:bg-white/20 hover:text-white disabled:opacity-50"
                  onClick={onUndo}
                  title="Undo (Ctrl+Z)"
                  disabled={!canUndo}
                >
                  <Undo className="w-4 h-4" />
                </Button>
                <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-black bg-opacity-90 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                  Undo
                </div>
              </div>

              <div className="relative group">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 transition-all duration-200 rounded-lg text-white/90 hover:bg-white/20 hover:text-white disabled:opacity-50"
                  onClick={onRedo}
                  title="Redo (Ctrl+Y)"
                  disabled={!canRedo}
                >
                  <Redo className="w-4 h-4" />
                </Button>
                <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-black bg-opacity-90 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                  Redo
                </div>
              </div>

              <div className="relative">
                <div className="relative group">
                  <Button
                    variant="ghost"
                    size="sm"
                    className={`h-8 w-8 p-0 transition-all duration-200 rounded-lg ${showHistory ? 'bg-orange-600/20 text-orange-400 border border-orange-500/50 shadow-sm' : 'text-white/90 hover:bg-white/20 hover:text-white'} disabled:opacity-50`}
                    onClick={() => setShowHistory(!showHistory)}
                    title="History"
                    disabled={(historyItems?.length || 0) === 0}
                  >
                    <History className="w-4 h-4" />
                  </Button>
                  <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-black bg-opacity-90 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                    History
                  </div>
                </div>

                {showHistory && (
                  <div className="absolute bottom-full left-0 mb-2 bg-black bg-opacity-95 text-white p-2 rounded-lg text-xs w-80 shadow-lg border border-gray-600 max-h-80 overflow-y-auto z-50">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-indigo-300 font-semibold">Edit History</div>
                      <button className="text-gray-400 hover:text-white" onClick={() => setShowHistory(false)}>×</button>
                    </div>
                    <div className="space-y-1">
                      {(historyItems || []).length === 0 && (
                        <div className="text-gray-400 px-2 py-1">No history yet</div>
                      )}
                      {(historyItems || []).map((h, idx) => {
                        const date = new Date(h.timestamp);
                        const isCurrent = idx === (currentHistoryIndex ?? -1);
                        return (
                          <button
                            key={`${h.timestamp}-${idx}`}
                            className={`w-full text-left px-2 py-1 rounded border transition-colors ${isCurrent ? 'bg-blue-600/20 border-blue-500/50 text-blue-200' : 'bg-white/5 border-white/10 text-gray-200 hover:bg-white/10'}`}
                            onClick={() => {
                              onSelectHistory && onSelectHistory(idx);
                              setShowHistory(false);
                            }}
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-medium">{h.action}</span>
                              <span className="text-[10px] text-gray-400">{date.toLocaleTimeString()}</span>
                            </div>
                            <div className="text-[11px] text-gray-400">Structure {h.structureId}</div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Metadata Popup */}
        {showMetadata && (
          <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-4 bg-black bg-opacity-95 text-white p-4 rounded-lg text-xs w-96 shadow-lg border border-gray-600 max-h-80 overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center">
                <Info className="w-4 h-4 mr-2 text-indigo-400" />
                <h3 className="font-semibold text-indigo-300">DICOM Metadata</h3>
              </div>
              <button
                onClick={() => setShowMetadata(false)}
                className="text-gray-400 hover:text-white"
              >
                ×
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="font-semibold text-indigo-300 mb-2">Patient Info</div>
                <div className="space-y-1 text-gray-300">
                  <div><span className="text-gray-400">Name:</span> DEMO^PATIENT</div>
                  <div><span className="text-gray-400">ID:</span> DM001</div>
                  <div><span className="text-gray-400">DOB:</span> 1970-01-01</div>
                  <div><span className="text-gray-400">Sex:</span> M</div>
                </div>
              </div>

              <div>
                <div className="font-semibold text-indigo-300 mb-2">Study Info</div>
                <div className="space-y-1 text-gray-300">
                  <div><span className="text-gray-400">Date:</span> 2024-01-15</div>
                  <div><span className="text-gray-400">Time:</span> 14:30:00</div>
                  <div><span className="text-gray-400">Description:</span> Chest CT</div>
                  <div><span className="text-gray-400">Modality:</span> CT</div>
                </div>
              </div>

              <div>
                <div className="font-semibold text-indigo-300 mb-2">Image Parameters</div>
                <div className="space-y-1 text-gray-300">
                  <div><span className="text-gray-400">Matrix:</span> 512 x 512</div>
                  <div><span className="text-gray-400">Slice:</span> {currentSlice || 1} / {totalSlices || 20}</div>
                  <div><span className="text-gray-400">Thickness:</span> 1.0mm</div>
                  <div><span className="text-gray-400">kVp:</span> 120</div>
                  <div><span className="text-gray-400">mAs:</span> 200</div>
                </div>
              </div>

              <div>
                <div className="font-semibold text-indigo-300 mb-2">Window/Level</div>
                <div className="space-y-1 text-gray-300">
                  <div><span className="text-gray-400">Current W/L:</span> {windowLevel ? `${Math.round(windowLevel.window)}/${Math.round(windowLevel.level)}` : '400/40'}</div>
                  <div><span className="text-gray-400">Range:</span> [-1024, 3071] HU</div>
                  <div><span className="text-gray-400">Reconstruction:</span> FBP</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Interaction Tips Popup */}
        {(showInteractionTips || tipsDialogOpen) && (
          <div className="absolute bottom-full right-0 mb-4 bg-black bg-opacity-90 text-white p-4 rounded-lg text-xs w-80 shadow-lg border border-gray-600">
            <div className="flex items-center mb-3">
              <Keyboard className="w-4 h-4 mr-2 text-indigo-400" />
              <h3 className="font-semibold text-indigo-300">Interaction Guide</h3>
            </div>

            <div className="space-y-3">
              <div>
                <h4 className="font-medium text-yellow-300 mb-1">Navigation</h4>
                <div className="space-y-1 text-gray-300">
                  <div>• Mouse Wheel: Navigate slices</div>
                  <div>• Arrow Keys: Previous/Next slice</div>
                  <div>• Left Click + Drag: Pan image</div>
                </div>
              </div>

              <div>
                <h4 className="font-medium text-yellow-300 mb-1">Zoom Controls</h4>
                <div className="space-y-1 text-gray-300">
                  <div>• Ctrl + Mouse Wheel: Zoom in/out</div>
                  <div>• Toolbar +/- buttons: Zoom in/out</div>
                  <div>• Fit to Window button: Reset zoom</div>
                </div>
              </div>

              <div>
                <h4 className="font-medium text-yellow-300 mb-1">Window/Level</h4>
                <div className="space-y-1 text-gray-300">
                  <div>• Right Click + Drag: Adjust contrast</div>
                  <div>• Horizontal: Window width</div>
                  <div>• Vertical: Window level</div>
                </div>
              </div>

              <div>
                <h4 className="font-medium text-yellow-300 mb-1">Shortcuts (Coming Soon)</h4>
                <div className="grid grid-cols-2 gap-2 text-gray-400">
                  <div>• R: Reset view</div>
                  <div>• F: Fit to window</div>
                  <div>• 1-8: Preset windows</div>
                  <div>• I: Invert colors</div>
                </div>
              </div>
            </div>

            {tipsDialogOpen && (
              <div className="mt-3 pt-2 border-t border-gray-600">
                <button
                  onClick={() => setTipsDialogOpen(false)}
                  className="text-xs text-indigo-400 hover:text-indigo-300"
                >
                  Click to close
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default ViewerToolbar;