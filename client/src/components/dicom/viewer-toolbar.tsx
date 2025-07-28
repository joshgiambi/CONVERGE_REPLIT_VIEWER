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
  Layers
} from 'lucide-react';

interface ViewerToolbarProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  onPanTool: () => void;
  onMeasureTool: () => void;
  onAnnotateTool: () => void;
  onContourEdit: () => void;
  onContourSettings: () => void;
  onFusion?: () => void;
  currentSlice?: number;
  totalSlices?: number;
  windowLevel?: { window: number; level: number };
  isContourEditActive?: boolean;
  showFusionButton?: boolean;
  isMeasurementToolActive?: boolean;
}

export function ViewerToolbar({
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onPanTool,
  onMeasureTool,
  onAnnotateTool,
  onContourEdit,
  onContourSettings,
  onFusion,
  currentSlice,
  totalSlices,
  windowLevel,
  isContourEditActive,
  showFusionButton,
  isMeasurementToolActive = false
}: ViewerToolbarProps) {
  const [activeTool, setActiveTool] = useState<string>('pan');
  const [showMetadata, setShowMetadata] = useState(false);
  const [showInteractionTips, setShowInteractionTips] = useState(false);
  const [tipsDialogOpen, setTipsDialogOpen] = useState(false);

  const handleToolSelect = (tool: string, callback: () => void) => {
    // For measurement tool, use the prop instead of local state
    if (tool !== 'measure') {
      setActiveTool(tool);
    }
    callback();
  };

  // Update active tool based on measurement prop
  const currentActiveTool = isMeasurementToolActive ? 'measure' : activeTool;

  const tools = [
    { id: 'zoom-in', icon: ZoomIn, label: 'Zoom In', action: onZoomIn },
    { id: 'zoom-out', icon: ZoomOut, label: 'Zoom Out', action: onZoomOut },
    { id: 'reset-zoom', icon: Maximize2, label: 'Fit to Window', action: onResetZoom },
    { id: 'separator' },
    { id: 'pan', icon: Hand, label: 'Pan', action: onPanTool, selectable: true },
    { id: 'measure', icon: Ruler, label: 'Measure', action: onMeasureTool, selectable: true },
    { id: 'separator' },
    { id: 'contour-edit', icon: Edit3, label: 'Contour Edit', action: onContourEdit },
    ...(showFusionButton && onFusion ? [
      { id: 'separator' },
      { id: 'fusion', icon: Layers, label: 'Image Fusion', action: onFusion }
    ] : []),
    { id: 'separator' },
    { id: 'metadata', icon: Info, label: 'View DICOM Metadata', action: () => setShowMetadata(!showMetadata) },
    { id: 'help', icon: HelpCircle, label: 'Interaction Guide', action: () => setTipsDialogOpen(!tipsDialogOpen) },
  ];

  return (
    <div className="fixed bottom-12 left-1/2 transform -translate-x-1/2 z-50 animate-in slide-in-from-bottom-2 duration-300">
      <div className="flex items-center bg-gradient-to-r from-gray-900 via-black to-gray-900 border-2 border-indigo-500/30 rounded-2xl p-4 shadow-[0_20px_50px_rgba(99,102,241,0.3)] backdrop-blur-md relative overflow-hidden">
        {/* Animated gradient border effect */}
        <div className="absolute inset-0 rounded-2xl bg-gradient-to-r from-indigo-500 via-purple-500 to-indigo-500 opacity-20 blur-xl animate-pulse" />
        
        <div className="relative flex items-center gap-2">
          {tools.map((tool, index) => {
            if (tool.id === 'separator') {
              return (
                <div key={index} className="w-px h-8 bg-gradient-to-b from-transparent via-indigo-500/30 to-transparent mx-1" />
              );
            }

            const IconComponent = tool.icon!;
            const isActive = tool.selectable && currentActiveTool === tool.id;

            return (
              <div key={tool.id} className="relative group">
                <Button
                  variant="outline"
                  size="sm"
                  className={`
                    h-10 w-10 p-0 rounded-lg transition-all duration-200 border-2 relative overflow-hidden
                    ${isActive 
                      ? 'bg-gradient-to-br from-indigo-600/30 to-indigo-600/10 text-white border-indigo-500 shadow-lg shadow-indigo-500/30' 
                      : tool.id === 'contour-edit' && isContourEditActive
                      ? 'bg-gradient-to-br from-green-600/30 to-green-600/10 text-green-400 border-green-500 shadow-lg shadow-green-500/30'
                      : 'bg-gradient-to-br from-gray-800 to-gray-900 border-gray-700 text-gray-400 hover:text-white hover:from-gray-700 hover:to-gray-800 hover:border-indigo-500/50 hover:shadow-md hover:shadow-indigo-500/20'
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
                  <IconComponent className="w-5 h-5" />
                </Button>
                
                {/* Tooltip */}
                <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-black/95 text-white text-xs rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                  {tool.label}
                </div>
              </div>
            );
          })}
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
