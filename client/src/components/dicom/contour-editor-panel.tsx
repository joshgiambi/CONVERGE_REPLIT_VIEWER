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
  Palette
} from 'lucide-react';

interface ContourEditorPanelProps {
  seriesId: number;
  studyId: any;
  rtStructures: any;
  editMode: 'view' | 'brush' | 'eraser';
  onEditModeChange: (mode: 'view' | 'brush' | 'eraser') => void;
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
            <div className="grid grid-cols-3 gap-2">
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

          {/* Structure Selection */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-white">Target Structure</h3>
            <Select
              value={selectedStructure?.toString() || ""}
              onValueChange={(value) => onSelectedStructureChange(value ? parseInt(value) : null)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select structure to edit" />
              </SelectTrigger>
              <SelectContent>
                {structures.map((structure: any) => (
                  <SelectItem key={structure.roiNumber} value={structure.roiNumber.toString()}>
                    <div className="flex items-center gap-2">
                      <div 
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: `rgb(${structure.color.join(',')})` }}
                      />
                      {structure.structureName}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Separator />

          {/* Brush Settings */}
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

          {/* Structure Visibility */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-white">Structure Visibility</h3>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {structures.map((structure: any) => (
                <div key={structure.roiNumber} className="flex items-center justify-between p-2 rounded border border-gray-700">
                  <div className="flex items-center gap-2">
                    <div 
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: `rgb(${structure.color.join(',')})` }}
                    />
                    <span className="text-sm text-white truncate">{structure.structureName}</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onStructureVisibilityChange(structure.roiNumber, !structureVisibility.get(structure.roiNumber))}
                  >
                    {structureVisibility.get(structure.roiNumber) ? (
                      <Eye className="h-4 w-4 text-blue-400" />
                    ) : (
                      <EyeOff className="h-4 w-4 text-gray-500" />
                    )}
                  </Button>
                </div>
              ))}
            </div>
          </div>

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