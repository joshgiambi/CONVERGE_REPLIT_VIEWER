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
  X 
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

  const hexToRgb = (hex: string) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? [
      parseInt(result[1], 16),
      parseInt(result[2], 16),
      parseInt(result[3], 16)
    ] : [255, 255, 255];
  };

  const currentColor = rgbToHex(selectedStructure.color || [255, 255, 255]);

  return (
    <div className="absolute bottom-16 left-4 right-4 bg-black/60 backdrop-blur-sm border border-green-500 rounded-lg p-3 z-40" style={{ maxWidth: 'calc(100% - 2rem)' }}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-4">
          <h3 className="text-green-400 font-medium">Contour Editor</h3>
          <div className="flex items-center space-x-2">
            <Label htmlFor="structure-name" className="text-sm text-gray-300">Name:</Label>
            <Input
              id="structure-name"
              value={selectedStructure.structureName || ''}
              onChange={(e) => onStructureNameChange(e.target.value)}
              className="w-32 h-8 bg-gray-800 border-gray-600 text-white"
            />
          </div>
          <div className="flex items-center space-x-2">
            <Label htmlFor="structure-color" className="text-sm text-gray-300">Color:</Label>
            <Input
              id="structure-color"
              type="color"
              value={currentColor}
              onChange={(e) => onStructureColorChange(e.target.value)}
              className="w-12 h-8 bg-gray-800 border-gray-600 cursor-pointer"
            />
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="text-gray-400 hover:text-white hover:bg-gray-700"
        >
          <X className="w-4 h-4" />
        </Button>
      </div>

      <Separator className="my-3 bg-gray-700" />

      <div className="flex items-center space-x-2">
        <div className="flex items-center space-x-1">
          <Button
            variant="outline"
            size="sm"
            className="border-green-500 text-green-400 hover:bg-green-500/20"
          >
            <Brush className="w-4 h-4 mr-1" />
            Brush
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="border-green-500 text-green-400 hover:bg-green-500/20"
          >
            <Pen className="w-4 h-4 mr-1" />
            Pen
          </Button>
        </div>

        <Separator orientation="vertical" className="h-6 bg-gray-600" />

        <div className="flex items-center space-x-1">
          <Button
            variant="outline"
            size="sm"
            className="border-green-500 text-green-400 hover:bg-green-500/20"
          >
            <Wand2 className="w-4 h-4 mr-1" />
            Smooth
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="border-green-500 text-green-400 hover:bg-green-500/20"
          >
            <Shuffle className="w-4 h-4 mr-1" />
            Interpolate
          </Button>
        </div>

        <Separator orientation="vertical" className="h-6 bg-gray-600" />

        <div className="flex items-center space-x-1">
          <Button
            variant="outline"
            size="sm"
            className="border-green-500 text-green-400 hover:bg-green-500/20"
          >
            <Expand className="w-4 h-4 mr-1" />
            Expand
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="border-green-500 text-green-400 hover:bg-green-500/20"
          >
            <Shrink className="w-4 h-4 mr-1" />
            Shrink
          </Button>
        </div>

        <Separator orientation="vertical" className="h-6 bg-gray-600" />

        <div className="flex items-center space-x-1">
          <Button
            variant="outline"
            size="sm"
            className="border-green-500 text-green-400 hover:bg-green-500/20"
          >
            <Square className="w-4 h-4 mr-1" />
            Boolean
          </Button>
        </div>
      </div>
    </div>
  );
}