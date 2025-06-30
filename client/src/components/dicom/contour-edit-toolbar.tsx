import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { 
  Brush, 
  Pen, 
  Wand2, 
  Shuffle, 
  Expand, 
  Shrink,
  Square,
  X,
  Scissors,
  Copy 
} from 'lucide-react';

interface ContourEditToolbarProps {
  selectedStructure: any;
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
  if (!isVisible || !selectedStructure) return null;

  const rgbToHex = (rgb: number[]) => {
    return '#' + rgb.map(x => x.toString(16).padStart(2, '0')).join('');
  };

  const currentColor = rgbToHex(selectedStructure.color || [255, 255, 255]);

  const tools = [
    { id: 'brush', icon: Brush, label: 'Brush', color: 'text-blue-400 border-blue-500 hover:bg-blue-500/20' },
    { id: 'pen', icon: Pen, label: 'Pen', color: 'text-purple-400 border-purple-500 hover:bg-purple-500/20' },
    { id: 'erase', icon: Scissors, label: 'Erase', color: 'text-red-400 border-red-500 hover:bg-red-500/20' },
    { id: 'smooth', icon: Wand2, label: 'Smooth', color: 'text-yellow-400 border-yellow-500 hover:bg-yellow-500/20' },
    { id: 'interpolate', icon: Shuffle, label: 'Interpolate', color: 'text-green-400 border-green-500 hover:bg-green-500/20' },
    { id: 'expand', icon: Expand, label: 'Expand', color: 'text-orange-400 border-orange-500 hover:bg-orange-500/20' },
    { id: 'shrink', icon: Shrink, label: 'Shrink', color: 'text-cyan-400 border-cyan-500 hover:bg-cyan-500/20' },
    { id: 'boolean', icon: Square, label: 'Boolean', color: 'text-pink-400 border-pink-500 hover:bg-pink-500/20' },
    { id: 'copy', icon: Copy, label: 'Copy', color: 'text-indigo-400 border-indigo-500 hover:bg-indigo-500/20' }
  ];

  return (
    <div className="fixed bottom-24 left-1/2 transform -translate-x-1/2 w-2/5 bg-black/80 backdrop-blur-sm border border-gray-600/50 rounded-lg p-3 z-50 shadow-2xl">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
            <div 
              className="w-4 h-4 rounded border border-gray-400"
              style={{ backgroundColor: `rgb(${selectedStructure.color.join(',')})` }}
            />
            <Label className="text-gray-300 text-sm font-medium">
              Editing:
            </Label>
            <Input
              value={selectedStructure.structureName || ''}
              onChange={(e) => onStructureNameChange(e.target.value)}
              className="w-32 h-7 bg-gray-800/70 border-gray-600 text-white text-sm"
            />
          </div>
          <div className="flex items-center space-x-2">
            <Label className="text-gray-300 text-sm">Color:</Label>
            <input
              type="color"
              value={currentColor}
              onChange={(e) => onStructureColorChange(e.target.value)}
              className="w-7 h-7 rounded border border-gray-600 bg-gray-800 cursor-pointer"
            />
          </div>
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

      <div className="flex items-center justify-center space-x-1">
        {tools.map((tool, index) => {
          const IconComponent = tool.icon;
          return (
            <Button
              key={tool.id}
              variant="outline"
              size="sm"
              className={`h-8 px-2 bg-gray-800/70 ${tool.color} border transition-all duration-200`}
            >
              <IconComponent className="w-3 h-3 mr-1" />
              <span className="text-xs">{tool.label}</span>
            </Button>
          );
        })}
      </div>
    </div>
  );
}