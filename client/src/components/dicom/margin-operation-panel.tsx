import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  X,
  Play,
  Eye,
  EyeOff,
  Expand,
  Move,
  Box,
  Maximize2,
  Settings2,
  Info
} from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface MarginOperationPanelProps {
  selectedStructure: {
    id: number;
    structureName: string;
    color?: number[];
  } | null;
  isVisible: boolean;
  onClose: () => void;
  onExecuteOperation: (operation: {
    type: 'uniform_margin' | 'directional_margin' | 'morphological_margin' | 'anisotropic_margin';
    parameters: any;
    structureId: number;
    preview?: boolean;
  }) => void;
  onPreviewClear?: () => void;
}

export function MarginOperationPanel({ 
  selectedStructure, 
  isVisible, 
  onClose,
  onExecuteOperation,
  onPreviewClear
}: MarginOperationPanelProps) {
  const [isPreviewActive, setIsPreviewActive] = useState(false);
  
  // Margin values
  const [uniformMargin, setUniformMargin] = useState(5);
  const [anisotropicMargins, setAnisotropicMargins] = useState({ x: 5, y: 5, z: 5 });
  const [directionalMargins, setDirectionalMargins] = useState({
    superior: 5, inferior: 5,
    anterior: 5, posterior: 5,
    left: 5, right: 5
  });
  
  // Options
  const [interpolation, setInterpolation] = useState(true);
  const [smoothCorners, setSmoothCorners] = useState(true);

  if (!isVisible || !selectedStructure) return null;

  const structureColor = selectedStructure.color ? 
    `rgb(${selectedStructure.color.join(',')})` : '#ffffff';

  const handlePreview = (type: 'uniform' | 'anisotropic' | 'directional') => {
    let parameters: any = {};
    let operationType: any = 'uniform_margin';
    
    if (type === 'uniform') {
      parameters = { margin: uniformMargin };
      operationType = 'uniform_margin';
    } else if (type === 'anisotropic') {
      parameters = { 
        marginX: anisotropicMargins.x, 
        marginY: anisotropicMargins.y, 
        marginZ: anisotropicMargins.z 
      };
      operationType = 'anisotropic_margin';
    } else if (type === 'directional') {
      parameters = directionalMargins;
      operationType = 'directional_margin';
    }

    onExecuteOperation({
      type: operationType,
      parameters,
      structureId: selectedStructure.id,
      preview: true
    });
    
    setIsPreviewActive(true);
  };

  const handleApply = (type: 'uniform' | 'anisotropic' | 'directional') => {
    let parameters: any = {};
    let operationType: any = 'uniform_margin';
    
    if (type === 'uniform') {
      parameters = { margin: uniformMargin };
      operationType = 'uniform_margin';
    } else if (type === 'anisotropic') {
      parameters = { 
        marginX: anisotropicMargins.x, 
        marginY: anisotropicMargins.y, 
        marginZ: anisotropicMargins.z 
      };
      operationType = 'anisotropic_margin';
    } else if (type === 'directional') {
      parameters = directionalMargins;
      operationType = 'directional_margin';
    }

    onExecuteOperation({
      type: operationType,
      parameters,
      structureId: selectedStructure.id,
      preview: false
    });
    
    clearPreview();
  };

  const clearPreview = () => {
    if (onPreviewClear) {
      onPreviewClear();
    }
    setIsPreviewActive(false);
  };

  return (
    <div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-50 w-[600px]">
      <div 
        className="bg-gradient-to-br from-gray-900/95 via-gray-800/95 to-gray-900/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-white/20"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div 
              className="w-5 h-5 rounded-full shadow-lg"
              style={{ backgroundColor: structureColor }}
            />
            <h2 className="text-lg font-semibold text-white">
              Margin Operations - {selectedStructure.structureName}
            </h2>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="text-gray-400 hover:text-white hover:bg-white/10"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Content */}
        <div className="p-4">
          <Tabs defaultValue="uniform" className="w-full">
            <TabsList className="grid w-full grid-cols-3 bg-black/30">
              <TabsTrigger value="uniform" className="data-[state=active]:bg-blue-500/30">
                <Expand className="w-4 h-4 mr-2" />
                Uniform
              </TabsTrigger>
              <TabsTrigger value="anisotropic" className="data-[state=active]:bg-green-500/30">
                <Box className="w-4 h-4 mr-2" />
                Anisotropic
              </TabsTrigger>
              <TabsTrigger value="directional" className="data-[state=active]:bg-purple-500/30">
                <Move className="w-4 h-4 mr-2" />
                Directional
              </TabsTrigger>
            </TabsList>

            {/* Uniform Margin */}
            <TabsContent value="uniform" className="space-y-4 mt-4">
              <div className="bg-black/20 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <Label className="text-sm text-gray-300">Margin Distance</Label>
                  <TooltipProvider delayDuration={0}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="w-4 h-4 text-gray-400" />
                      </TooltipTrigger>
                      <TooltipContent className="bg-gradient-to-br from-blue-900/95 to-blue-800/95">
                        <p className="text-xs">Expand equally in all directions</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <div className="flex items-center gap-4">
                  <Slider
                    value={[uniformMargin]}
                    onValueChange={([value]) => setUniformMargin(value)}
                    min={-20}
                    max={20}
                    step={0.5}
                    className="flex-1"
                  />
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      value={uniformMargin}
                      onChange={(e) => setUniformMargin(parseFloat(e.target.value) || 0)}
                      className="w-20 h-8 bg-black/30 border-gray-600 text-white"
                    />
                    <span className="text-xs text-gray-400">mm</span>
                  </div>
                </div>
                <div className="text-xs text-gray-500 mt-2">
                  {uniformMargin > 0 ? 'Expansion' : uniformMargin < 0 ? 'Contraction' : 'No change'}
                </div>
              </div>

              <div className="flex gap-2">
                <Button
                  onClick={() => handlePreview('uniform')}
                  className="flex-1 bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/60 text-blue-300"
                >
                  <Eye className="w-4 h-4 mr-2" />
                  Preview
                </Button>
                <Button
                  onClick={() => handleApply('uniform')}
                  className="flex-1 bg-green-500/20 hover:bg-green-500/30 border border-green-500/60 text-green-300"
                >
                  <Play className="w-4 h-4 mr-2" />
                  Apply
                </Button>
                {isPreviewActive && (
                  <Button
                    onClick={clearPreview}
                    className="bg-red-500/20 hover:bg-red-500/30 border border-red-500/60 text-red-300"
                  >
                    <EyeOff className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </TabsContent>

            {/* Anisotropic Margin */}
            <TabsContent value="anisotropic" className="space-y-4 mt-4">
              <div className="bg-black/20 rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-sm text-gray-300">Axis-Specific Margins</Label>
                  <TooltipProvider delayDuration={0}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="w-4 h-4 text-gray-400" />
                      </TooltipTrigger>
                      <TooltipContent className="bg-gradient-to-br from-green-900/95 to-green-800/95">
                        <p className="text-xs">Different expansion per axis (X, Y, Z)</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>

                {/* X Axis */}
                <div>
                  <Label className="text-xs text-gray-400 mb-1">X (Left-Right)</Label>
                  <div className="flex items-center gap-3">
                    <Slider
                      value={[anisotropicMargins.x]}
                      onValueChange={([value]) => setAnisotropicMargins(prev => ({...prev, x: value}))}
                      min={-20}
                      max={20}
                      step={0.5}
                      className="flex-1"
                    />
                    <Input
                      type="number"
                      value={anisotropicMargins.x}
                      onChange={(e) => setAnisotropicMargins(prev => ({...prev, x: parseFloat(e.target.value) || 0}))}
                      className="w-16 h-7 bg-black/30 border-gray-600 text-white text-xs"
                    />
                    <span className="text-xs text-gray-400">mm</span>
                  </div>
                </div>

                {/* Y Axis */}
                <div>
                  <Label className="text-xs text-gray-400 mb-1">Y (Anterior-Posterior)</Label>
                  <div className="flex items-center gap-3">
                    <Slider
                      value={[anisotropicMargins.y]}
                      onValueChange={([value]) => setAnisotropicMargins(prev => ({...prev, y: value}))}
                      min={-20}
                      max={20}
                      step={0.5}
                      className="flex-1"
                    />
                    <Input
                      type="number"
                      value={anisotropicMargins.y}
                      onChange={(e) => setAnisotropicMargins(prev => ({...prev, y: parseFloat(e.target.value) || 0}))}
                      className="w-16 h-7 bg-black/30 border-gray-600 text-white text-xs"
                    />
                    <span className="text-xs text-gray-400">mm</span>
                  </div>
                </div>

                {/* Z Axis */}
                <div>
                  <Label className="text-xs text-gray-400 mb-1">Z (Superior-Inferior)</Label>
                  <div className="flex items-center gap-3">
                    <Slider
                      value={[anisotropicMargins.z]}
                      onValueChange={([value]) => setAnisotropicMargins(prev => ({...prev, z: value}))}
                      min={-20}
                      max={20}
                      step={0.5}
                      className="flex-1"
                    />
                    <Input
                      type="number"
                      value={anisotropicMargins.z}
                      onChange={(e) => setAnisotropicMargins(prev => ({...prev, z: parseFloat(e.target.value) || 0}))}
                      className="w-16 h-7 bg-black/30 border-gray-600 text-white text-xs"
                    />
                    <span className="text-xs text-gray-400">mm</span>
                  </div>
                </div>
              </div>

              <div className="flex gap-2">
                <Button
                  onClick={() => handlePreview('anisotropic')}
                  className="flex-1 bg-green-500/20 hover:bg-green-500/30 border border-green-500/60 text-green-300"
                >
                  <Eye className="w-4 h-4 mr-2" />
                  Preview
                </Button>
                <Button
                  onClick={() => handleApply('anisotropic')}
                  className="flex-1 bg-green-500/20 hover:bg-green-500/30 border border-green-500/60 text-green-300"
                >
                  <Play className="w-4 h-4 mr-2" />
                  Apply
                </Button>
                {isPreviewActive && (
                  <Button
                    onClick={clearPreview}
                    className="bg-red-500/20 hover:bg-red-500/30 border border-red-500/60 text-red-300"
                  >
                    <EyeOff className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </TabsContent>

            {/* Directional Margin */}
            <TabsContent value="directional" className="space-y-4 mt-4">
              <div className="bg-black/20 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <Label className="text-sm text-gray-300">Directional Margins</Label>
                  <TooltipProvider delayDuration={0}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="w-4 h-4 text-gray-400" />
                      </TooltipTrigger>
                      <TooltipContent className="bg-gradient-to-br from-purple-900/95 to-purple-800/95">
                        <p className="text-xs">Set margin for each anatomical direction</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {Object.entries(directionalMargins).map(([direction, value]) => (
                    <div key={direction} className="flex items-center gap-2">
                      <Label className="text-xs text-gray-400 capitalize w-20">
                        {direction}:
                      </Label>
                      <Input
                        type="number"
                        value={value}
                        onChange={(e) => setDirectionalMargins(prev => ({
                          ...prev,
                          [direction]: parseFloat(e.target.value) || 0
                        }))}
                        className="w-16 h-7 bg-black/30 border-gray-600 text-white text-xs"
                      />
                      <span className="text-xs text-gray-400">mm</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex gap-2">
                <Button
                  onClick={() => handlePreview('directional')}
                  className="flex-1 bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/60 text-purple-300"
                >
                  <Eye className="w-4 h-4 mr-2" />
                  Preview
                </Button>
                <Button
                  onClick={() => handleApply('directional')}
                  className="flex-1 bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/60 text-purple-300"
                >
                  <Play className="w-4 h-4 mr-2" />
                  Apply
                </Button>
                {isPreviewActive && (
                  <Button
                    onClick={clearPreview}
                    className="bg-red-500/20 hover:bg-red-500/30 border border-red-500/60 text-red-300"
                  >
                    <EyeOff className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </TabsContent>
          </Tabs>

          {/* Options */}
          <div className="mt-4 p-3 bg-black/20 rounded-lg space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-gray-400">Interpolation</Label>
              <Switch
                checked={interpolation}
                onCheckedChange={setInterpolation}
                className="data-[state=checked]:bg-blue-500"
              />
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-xs text-gray-400">Smooth Corners</Label>
              <Switch
                checked={smoothCorners}
                onCheckedChange={setSmoothCorners}
                className="data-[state=checked]:bg-blue-500"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}