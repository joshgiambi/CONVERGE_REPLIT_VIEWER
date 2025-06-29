import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  Brush, 
  Eraser, 
  MousePointer, 
  Undo2, 
  Redo2, 
  Save,
  Eye,
  EyeOff,
  Palette,
  Edit3,
  Circle
} from 'lucide-react';

interface ContourEditorPanelProps {
  seriesId: number;
  studyId: any;
  rtStructures: any;
  editMode: 'view' | 'brush' | 'eraser' | 'polygon';
  onEditModeChange: (mode: 'view' | 'brush' | 'eraser' | 'polygon') => void;
  selectedStructure: number | null;
  onSelectedStructureChange: (structureId: number | null) => void;
  brushSettings: {
    size: number;
    opacity: number;
    mode: 'paint' | 'erase';
  };
  onBrushSettingsChange: (settings: any) => void;
  structureVisibility: Map<number, boolean>;
  onStructureVisibilityChange: (structureId: number, visible: boolean) => void;
}

export function ContourEditorPanel({
  rtStructures,
  editMode,
  onEditModeChange,
  selectedStructure,
  onSelectedStructureChange,
  brushSettings,
  onBrushSettingsChange,
  structureVisibility,
  onStructureVisibilityChange
}: ContourEditorPanelProps) {
  const [undoCount, setUndoCount] = useState(0);
  const [redoCount, setRedoCount] = useState(0);

  // Get current structures
  const structures = rtStructures?.structures || [];

  const handleBrushSizeChange = (value: number[]) => {
    onBrushSettingsChange({ ...brushSettings, size: value[0] });
  };

  const handleOpacityChange = (value: number[]) => {
    onBrushSettingsChange({ ...brushSettings, opacity: value[0] / 100 });
  };

  const handleSaveContours = async () => {
    // Implement save functionality
    console.log('Saving contours...');
  };

  const handleUndo = () => {
    if (undoCount > 0) {
      setUndoCount(undoCount - 1);
      setRedoCount(redoCount + 1);
    }
  };

  const handleRedo = () => {
    if (redoCount > 0) {
      setRedoCount(redoCount - 1);
      setUndoCount(undoCount + 1);
    }
  };

  return (
    <div className="fixed right-4 top-20 bottom-4 w-80 z-40 animate-in slide-in-from-right-2 duration-300">
      <Card className="bg-black/90 backdrop-blur-sm border-blue-500/30 h-full overflow-hidden">
        <CardHeader className="pb-4">
          <CardTitle className="text-blue-400 text-lg flex items-center gap-2">
            <Brush className="h-5 w-5" />
            Contour Editor
          </CardTitle>
        </CardHeader>
        
        <CardContent className="space-y-6 h-full overflow-y-auto pb-20">
          {/* Tool Selection */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-white">Editing Mode</h3>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant={editMode === 'view' ? 'default' : 'outline'}
                size="sm"
                onClick={() => onEditModeChange('view')}
                className="flex flex-col items-center gap-1 h-auto py-2"
              >
                <MousePointer className="h-4 w-4" />
                <span className="text-xs">View</span>
              </Button>
              <Button
                variant={editMode === 'polygon' ? 'default' : 'outline'}
                size="sm"
                onClick={() => onEditModeChange('polygon')}
                className="flex flex-col items-center gap-1 h-auto py-2 bg-purple-600 hover:bg-purple-700"
              >
                <Edit3 className="h-4 w-4" />
                <span className="text-xs">Polygon</span>
              </Button>
              <Button
                variant={editMode === 'brush' ? 'default' : 'outline'}
                size="sm"
                onClick={() => onEditModeChange('brush')}
                className="flex flex-col items-center gap-1 h-auto py-2 bg-blue-600 hover:bg-blue-700"
              >
                <Brush className="h-4 w-4" />
                <span className="text-xs">Brush</span>
              </Button>
              <Button
                variant={editMode === 'eraser' ? 'default' : 'outline'}
                size="sm"
                onClick={() => onEditModeChange('eraser')}
                className="flex flex-col items-center gap-1 h-auto py-2 bg-red-600 hover:bg-red-700"
              >
                <Eraser className="h-4 w-4" />
                <span className="text-xs">Eraser</span>
              </Button>
            </div>
          </div>

          <Separator />

          {/* Structure Management */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-white">Structure Management</h3>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {structures.map((structure: any) => (
                <div 
                  key={structure.roiNumber} 
                  className={`flex items-center justify-between p-3 rounded border cursor-pointer transition-all ${
                    selectedStructure === structure.roiNumber 
                      ? 'border-blue-400 bg-blue-500/20' 
                      : 'border-gray-700 hover:border-gray-600'
                  }`}
                  onClick={() => onSelectedStructureChange(structure.roiNumber)}
                >
                  <div className="flex items-center gap-3 flex-1">
                    <div 
                      className="w-4 h-4 rounded-full border-2 border-white/20"
                      style={{ backgroundColor: `rgb(${structure.color.join(',')})` }}
                    />
                    <div className="flex-1">
                      <div className="text-sm text-white font-medium truncate">
                        {structure.structureName}
                      </div>
                      <div className="text-xs text-gray-400">
                        ROI #{structure.roiNumber}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        onStructureVisibilityChange(structure.roiNumber, !structureVisibility.get(structure.roiNumber));
                      }}
                      className="h-8 w-8 p-0"
                    >
                      {structureVisibility.get(structure.roiNumber) ? (
                        <Eye className="h-4 w-4 text-blue-400" />
                      ) : (
                        <EyeOff className="h-4 w-4 text-gray-500" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        // Color picker functionality can be added here
                      }}
                      className="h-8 w-8 p-0"
                    >
                      <Palette className="h-4 w-4 text-gray-400" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <Separator />

          {/* Tool Settings */}
          {editMode === 'polygon' && (
            <div className="space-y-4">
              <h3 className="text-sm font-medium text-white">Polygon Tool</h3>
              <div className="bg-blue-900/20 border border-blue-500/30 rounded p-3">
                <div className="text-xs text-blue-300 space-y-1">
                  <div>• Click to place polygon vertices</div>
                  <div>• Double-click or press Enter to close</div>
                  <div>• Press Escape to cancel current polygon</div>
                  <div>• Right-click to remove last vertex</div>
                </div>
              </div>
            </div>
          )}

          {(editMode === 'brush' || editMode === 'eraser') && (
            <div className="space-y-4">
              <h3 className="text-sm font-medium text-white">Brush Settings</h3>
              
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Size</span>
                  <span className="text-white">{brushSettings.size}px</span>
                </div>
                <Slider
                  value={[brushSettings.size]}
                  onValueChange={handleBrushSizeChange}
                  min={1}
                  max={50}
                  step={1}
                  className="w-full"
                />
              </div>

              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Opacity</span>
                  <span className="text-white">{Math.round(brushSettings.opacity * 100)}%</span>
                </div>
                <Slider
                  value={[brushSettings.opacity * 100]}
                  onValueChange={handleOpacityChange}
                  min={10}
                  max={100}
                  step={5}
                  className="w-full"
                />
              </div>
            </div>
          )}

          <Separator />

          {/* Action Buttons */}
          <div className="space-y-3">
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleUndo}
                disabled={undoCount === 0}
                className="flex-1"
              >
                <Undo2 className="h-4 w-4 mr-1" />
                Undo
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRedo}
                disabled={redoCount === 0}
                className="flex-1"
              >
                <Redo2 className="h-4 w-4 mr-1" />
                Redo
              </Button>
            </div>
            
            <Button
              onClick={handleSaveContours}
              className="w-full bg-green-600 hover:bg-green-700"
            >
              <Save className="h-4 w-4 mr-2" />
              Save Contours
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}