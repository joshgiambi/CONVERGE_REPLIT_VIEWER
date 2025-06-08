import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';

interface WindowLevelPreset {
  name: string;
  window: number;
  level: number;
  description: string;
}

const WINDOW_LEVEL_PRESETS: WindowLevelPreset[] = [
  { name: 'Soft Tissue', window: 400, level: 40, description: 'General soft tissue visualization' },
  { name: 'Lung', window: 1500, level: -600, description: 'Pulmonary parenchyma' },
  { name: 'Bone', window: 1800, level: 400, description: 'Skeletal structures' },
  { name: 'Brain', window: 80, level: 40, description: 'Brain tissue contrast' },
  { name: 'Liver', window: 150, level: 30, description: 'Hepatic parenchyma' },
  { name: 'Abdomen', window: 350, level: 50, description: 'Abdominal organs' },
  { name: 'Mediastinum', window: 350, level: 50, description: 'Chest mediastinal structures' },
  { name: 'Spine', window: 250, level: 50, description: 'Spinal column' },
];

interface WindowLevelPresetsProps {
  currentWindowLevel: { window: number; level: number };
  onWindowLevelChange: (windowLevel: { window: number; level: number }) => void;
  isVisible: boolean;
  onClose: () => void;
}

export function WindowLevelPresets({ 
  currentWindowLevel, 
  onWindowLevelChange, 
  isVisible, 
  onClose 
}: WindowLevelPresetsProps) {
  if (!isVisible) return null;

  const handlePresetSelect = (preset: WindowLevelPreset) => {
    onWindowLevelChange({ window: preset.window, level: preset.level });
    onClose();
  };

  const isCurrentPreset = (preset: WindowLevelPreset) => {
    return currentWindowLevel.window === preset.window && currentWindowLevel.level === preset.level;
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center">
      <Card className="bg-gray-900 border-gray-700 p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-xl font-semibold text-white">Window/Level Presets</h3>
            <p className="text-gray-400 text-sm mt-1">Select optimal contrast settings for different anatomical regions</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="text-gray-400 hover:text-white"
          >
            ×
          </Button>
        </div>

        <div className="mb-4">
          <div className="text-sm text-gray-400 mb-2">Current Settings:</div>
          <div className="bg-gray-800 rounded p-3 text-white">
            <span className="font-mono">
              Window: {currentWindowLevel.window} | Level: {currentWindowLevel.level}
            </span>
          </div>
        </div>

        <Separator className="bg-gray-700 mb-4" />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {WINDOW_LEVEL_PRESETS.map((preset) => (
            <Button
              key={preset.name}
              variant={isCurrentPreset(preset) ? "default" : "outline"}
              className={`
                h-auto p-4 flex flex-col items-start text-left justify-start
                ${isCurrentPreset(preset) 
                  ? 'bg-indigo-600 hover:bg-indigo-700 border-indigo-500 text-white' 
                  : 'bg-gray-800 hover:bg-gray-700 border-gray-600 text-gray-200'
                }
              `}
              onClick={() => handlePresetSelect(preset)}
            >
              <div className="font-semibold text-base mb-1">{preset.name}</div>
              <div className="text-xs opacity-80 mb-2">{preset.description}</div>
              <div className="font-mono text-xs">
                W: {preset.window} | L: {preset.level}
              </div>
            </Button>
          ))}
        </div>

        <Separator className="bg-gray-700 my-4" />

        <div className="text-xs text-gray-500 space-y-1">
          <p><strong>Window:</strong> Controls contrast range (higher = more contrast)</p>
          <p><strong>Level:</strong> Controls brightness midpoint (adjust for tissue density)</p>
          <p><strong>Tip:</strong> Use mouse drag on image for fine adjustment</p>
        </div>
      </Card>
    </div>
  );
}