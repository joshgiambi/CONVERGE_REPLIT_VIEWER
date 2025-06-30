import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { X } from 'lucide-react';

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
              <input
                type="range"
                min="1"
                max="10"
                step="1"
                value={contourSettings.thickness}
                onChange={(e) => onContourSettingsChange({ 
                  ...contourSettings, 
                  thickness: parseInt(e.target.value) 
                })}
                className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
              />
            </div>

            {/* Opacity */}
            <div className="space-y-2">
              <Label className="text-white text-sm">
                Opacity: {Math.round(contourSettings.opacity * 100)}%
              </Label>
              <input
                type="range"
                min="0.1"
                max="1"
                step="0.1"
                value={contourSettings.opacity}
                onChange={(e) => onContourSettingsChange({ 
                  ...contourSettings, 
                  opacity: parseFloat(e.target.value) 
                })}
                className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
              />
            </div>
          </div>

          {/* Editing Tools */}
          <div className="space-y-3">
            <h4 className="text-white font-medium">Editing Tools</h4>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                size="sm"
                className="bg-gray-800 hover:bg-green-700 text-gray-300 hover:text-white border-gray-600"
              >
                Brush
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="bg-gray-800 hover:bg-green-700 text-gray-300 hover:text-white border-gray-600"
              >
                Pen
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="bg-gray-800 hover:bg-green-700 text-gray-300 hover:text-white border-gray-600"
              >
                Scissors
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="bg-gray-800 hover:bg-green-700 text-gray-300 hover:text-white border-gray-600"
              >
                Copy
              </Button>
            </div>
          </div>

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
            <Button
              size="sm"
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              Apply Changes
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}