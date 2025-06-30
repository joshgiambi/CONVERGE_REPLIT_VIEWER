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
  X
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
}

export function ContourEditToolbar({ 
  selectedStructure, 
  isVisible, 
  onClose,
  onStructureNameChange,
  onStructureColorChange 
}: ContourEditToolbarProps) {
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState<string | null>(null);
  const [brushThickness, setBrushThickness] = useState([3]);
  const [is3D, setIs3D] = useState(false);
  const [smartBrush, setSmartBrush] = useState(false);

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
          
          <div className="space-y-2">
            <div className="text-xs text-gray-500">
              Placeholder panel - {showSettings} tools will be implemented here
            </div>
            <div className="text-xs text-gray-600">
              Additional controls and options for the selected tool will appear in this area.
            </div>
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
                  onClick={() => setActiveTool(isActive ? null : tool.id)}
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