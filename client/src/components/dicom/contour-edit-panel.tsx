import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { X, Brush, Pen, Scissors, Copy, Plus, Minus, RotateCw, Move3D } from 'lucide-react';

interface ContourEditPanelProps {
  isVisible: boolean;
  selectedStructure: any;
  onClose: () => void;
  onStructureNameChange: (name: string) => void;
  onStructureColorChange: (color: [number, number, number]) => void;
  contourSettings: { thickness: number; opacity: number };
  onContourSettingsChange: (settings: { thickness: number; opacity: number }) => void;
}

export function ContourEditPanel({
  isVisible,
  selectedStructure,
  onClose,
  onStructureNameChange,
  onStructureColorChange,
  contourSettings,
  onContourSettingsChange
}: ContourEditPanelProps) {
  const [localName, setLocalName] = useState('');
  const [localColor, setLocalColor] = useState<[number, number, number]>([255, 0, 0]);
  const [activeEditTool, setActiveEditTool] = useState<string>('brush');

  useEffect(() => {
    if (selectedStructure) {
      setLocalName(selectedStructure.structureName || '');
      setLocalColor(selectedStructure.color || [255, 0, 0]);
    }
  }, [selectedStructure]);

  const handleNameChange = (value: string) => {
    setLocalName(value);
    onStructureNameChange(value);
  };

  const handleColorChange = (color: [number, number, number]) => {
    setLocalColor(color);
    onStructureColorChange(color);
  };

  const colorToHex = (color: [number, number, number]) => {
    return `#${color.map(c => c.toString(16).padStart(2, '0')).join('')}`;
  };

  const hexToColor = (hex: string): [number, number, number] => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? [
      parseInt(result[1], 16),
      parseInt(result[2], 16),
      parseInt(result[3], 16)
    ] : [255, 0, 0];
  };

  const editingTools = [
    { id: 'brush', label: 'Brush', icon: Brush, description: 'Paint contours freehand' },
    { id: 'pen', label: 'Pen', icon: Pen, description: 'Draw precise contour lines' },
    { id: 'scissors', label: 'Scissors', icon: Scissors, description: 'Cut and remove contour sections' },
    { id: 'copy', label: 'Copy', icon: Copy, description: 'Copy contour to adjacent slices' },
    { id: 'expand', label: 'Expand', icon: Plus, description: 'Expand contour uniformly' },
    { id: 'shrink', label: 'Shrink', icon: Minus, description: 'Shrink contour uniformly' },
    { id: 'smooth', label: 'Smooth', icon: RotateCw, description: 'Smooth contour edges' },
    { id: 'interpolate', label: 'Interpolate', icon: Move3D, description: 'Interpolate between slices' }
  ];

  if (!isVisible) return null;

  return (
    <div className="fixed bottom-4 right-4 w-96 bg-gray-900 border border-green-500 rounded-lg shadow-2xl z-50 max-h-[80vh] overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-700 bg-green-900/20">
        <h3 className="text-lg font-semibold text-white">Contour Editor</h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="text-gray-400 hover:text-white hover:bg-gray-700"
        >
          <X size={16} />
        </Button>
      </div>

      {selectedStructure && (
        <div className="p-4 space-y-6">
          <Tabs defaultValue="properties" className="w-full">
            <TabsList className="grid w-full grid-cols-2 bg-gray-800">
              <TabsTrigger value="properties" className="text-white data-[state=active]:bg-green-600">
                Properties
              </TabsTrigger>
              <TabsTrigger value="tools" className="text-white data-[state=active]:bg-green-600">
                Edit Tools
              </TabsTrigger>
            </TabsList>

            <TabsContent value="properties" className="space-y-4 mt-4">
              {/* Structure Name */}
              <div className="space-y-2">
                <Label htmlFor="structure-name" className="text-white text-sm font-medium">
                  Structure Name
                </Label>
                <Input
                  id="structure-name"
                  value={localName}
                  onChange={(e) => handleNameChange(e.target.value)}
                  className="bg-gray-800 border-gray-600 text-white focus:border-green-500"
                  placeholder="Enter structure name"
                />
              </div>

              {/* Structure Color */}
              <div className="space-y-2">
                <Label htmlFor="structure-color" className="text-white text-sm font-medium">
                  Structure Color
                </Label>
                <div className="flex items-center space-x-3">
                  <input
                    id="structure-color"
                    type="color"
                    value={colorToHex(localColor)}
                    onChange={(e) => handleColorChange(hexToColor(e.target.value))}
                    className="w-12 h-8 rounded border border-gray-600 bg-gray-800 cursor-pointer"
                  />
                  <div className="flex-1">
                    <div className="text-xs text-gray-400">
                      RGB: {localColor.join(', ')}
                    </div>
                  </div>
                </div>
              </div>

              {/* Global Contour Settings */}
              <div className="space-y-4 pt-4 border-t border-gray-700">
                <h4 className="text-white font-medium">Global Settings</h4>
                
                {/* Thickness */}
                <div className="space-y-2">
                  <Label className="text-white text-sm">
                    Line Thickness: {contourSettings.thickness}px
                  </Label>
                  <Slider
                    value={[contourSettings.thickness]}
                    onValueChange={([value]) => onContourSettingsChange({ ...contourSettings, thickness: value })}
                    min={1}
                    max={10}
                    step={1}
                    className="w-full"
                  />
                </div>

                {/* Opacity */}
                <div className="space-y-2">
                  <Label className="text-white text-sm">
                    Opacity: {Math.round(contourSettings.opacity * 100)}%
                  </Label>
                  <Slider
                    value={[contourSettings.opacity]}
                    onValueChange={([value]) => onContourSettingsChange({ ...contourSettings, opacity: value })}
                    min={0.1}
                    max={1}
                    step={0.1}
                    className="w-full"
                  />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="tools" className="space-y-4 mt-4">
              {/* Editing Tools */}
              <div className="space-y-3">
                <h4 className="text-white font-medium">Editing Tools</h4>
                <div className="grid grid-cols-2 gap-2">
                  {editingTools.map((tool) => {
                    const IconComponent = tool.icon;
                    return (
                      <Button
                        key={tool.id}
                        variant={activeEditTool === tool.id ? "default" : "outline"}
                        size="sm"
                        onClick={() => setActiveEditTool(tool.id)}
                        className={`flex flex-col items-center p-3 h-auto space-y-1 ${
                          activeEditTool === tool.id 
                            ? 'bg-green-600 hover:bg-green-700 text-white border-green-500' 
                            : 'bg-gray-800 hover:bg-gray-700 text-gray-300 border-gray-600'
                        }`}
                        title={tool.description}
                      >
                        <IconComponent size={16} />
                        <span className="text-xs">{tool.label}</span>
                      </Button>
                    );
                  })}
                </div>
              </div>

              {/* Tool Options */}
              {activeEditTool === 'brush' && (
                <div className="space-y-2 p-3 bg-gray-800 rounded border">
                  <Label className="text-white text-sm">Brush Size</Label>
                  <Slider
                    defaultValue={[5]}
                    min={1}
                    max={20}
                    step={1}
                    className="w-full"
                  />
                </div>
              )}

              {activeEditTool === 'expand' && (
                <div className="space-y-2 p-3 bg-gray-800 rounded border">
                  <Label className="text-white text-sm">Expansion Amount (mm)</Label>
                  <Slider
                    defaultValue={[2]}
                    min={0.5}
                    max={10}
                    step={0.5}
                    className="w-full"
                  />
                </div>
              )}

              {activeEditTool === 'shrink' && (
                <div className="space-y-2 p-3 bg-gray-800 rounded border">
                  <Label className="text-white text-sm">Shrinkage Amount (mm)</Label>
                  <Slider
                    defaultValue={[2]}
                    min={0.5}
                    max={10}
                    step={0.5}
                    className="w-full"
                  />
                </div>
              )}
            </TabsContent>
          </Tabs>

          {/* Action Buttons */}
          <div className="flex justify-between pt-4 border-t border-gray-700">
            <Button
              variant="outline"
              size="sm"
              onClick={onClose}
              className="bg-gray-800 hover:bg-gray-700 text-gray-300 border-gray-600"
            >
              Cancel
            </Button>
            <div className="space-x-2">
              <Button
                variant="outline"
                size="sm"
                className="bg-gray-800 hover:bg-gray-700 text-gray-300 border-gray-600"
              >
                Reset
              </Button>
              <Button
                size="sm"
                className="bg-green-600 hover:bg-green-700 text-white"
              >
                Apply Changes
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}