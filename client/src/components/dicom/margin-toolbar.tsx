import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { 
  Expand,
  Move,
  Box,
  Play,
  Eye,
  EyeOff,
  X,
  Plus
} from 'lucide-react';

interface MarginToolbarProps {
  selectedStructure: {
    id: number;
    structureName: string;
    color?: string;
  } | null;
  isVisible: boolean;
  onClose: () => void;
  onExecuteOperation: (operation: {
    type: 'uniform_margin' | 'directional_margin' | 'morphological_margin' | 'anisotropic_margin';
    parameters: any;
    structureId: number;
    targetStructureId?: number | 'new';
    preview?: boolean;
  }) => void;
  onPreviewClear?: () => void;
  availableStructures?: Array<{ id: number; name: string }>;
  onCreateNewStructure?: (basedOn: number) => void;
}

export function MarginToolbar({ 
  selectedStructure, 
  isVisible, 
  onClose,
  onExecuteOperation,
  onPreviewClear,
  availableStructures = [],
  onCreateNewStructure
}: MarginToolbarProps) {
  const [activeMode, setActiveMode] = useState<'uniform' | 'directional' | 'anisotropic'>('uniform');
  const [showSettings, setShowSettings] = useState(true); // Show settings by default
  const [isPreviewActive, setIsPreviewActive] = useState(false);
  const [targetStructure, setTargetStructure] = useState<'same' | 'different' | 'new'>('same');
  const [selectedTargetId, setSelectedTargetId] = useState<number | null>(null);
  const previewDebounceRef = useRef<number | null>(null);
  
  // Margin values
  // Default expansion set to 10mm
  const [uniformMargin, setUniformMargin] = useState(10);
  const [anisotropicMargins, setAnisotropicMargins] = useState({ x: 5, y: 5, z: 5 });
  const [directionalMargins, setDirectionalMargins] = useState({
    superior: 5, inferior: 5,
    anterior: 5, posterior: 5,
    left: 5, right: 5
  });

  if (!isVisible || !selectedStructure) return null;

  const structureColor = selectedStructure.color || '#ffffff';
  const backgroundHue = 200; // Blue-ish hue for medical theme

  const handleModeChange = (mode: 'uniform' | 'directional' | 'anisotropic') => {
    setActiveMode(mode);
    // Settings always visible, no toggle needed
  };

  const handlePreview = () => {
    if (!selectedStructure) return;

    // For preview, generate contours across slices so user can scroll
    const parameters: any = {
      margin: activeMode === 'uniform' ? uniformMargin : 
              activeMode === 'anisotropic' ? anisotropicMargins.x : // Use X for preview
              directionalMargins.superior, // Use one value for preview
      marginType: activeMode.toUpperCase(),
      marginValues: {},
      preview: { enabled: true, opacity: 0.5, color: '#FFFF00' },
      // allSlices preview (handled in viewer) for scroll-friendly visualization
    };

    if (activeMode === 'uniform') {
      parameters.marginValues = { uniform: uniformMargin };
    } else if (activeMode === 'anisotropic') {
      parameters.marginValues = anisotropicMargins;
    } else if (activeMode === 'directional') {
      parameters.marginValues = directionalMargins;
    }

    onExecuteOperation({
      type: activeMode === 'uniform' ? 'uniform_margin' : 
            activeMode === 'anisotropic' ? 'anisotropic_margin' : 
            'directional_margin',
      parameters,
      structureId: selectedStructure.id,
      targetStructureId: targetStructure === 'different' ? (selectedTargetId ?? undefined) : (targetStructure === 'new' ? 'new' : undefined),
      preview: true
    });

    setIsPreviewActive(true);
  };

  // Auto-preview whenever parameters change
  useEffect(() => {
    if (!selectedStructure) return;
    // Debounce to avoid flooding
    if (previewDebounceRef.current) {
      window.clearTimeout(previewDebounceRef.current);
    }
    previewDebounceRef.current = window.setTimeout(() => {
      handlePreview();
    }, 200);
    return () => {
      if (previewDebounceRef.current) {
        window.clearTimeout(previewDebounceRef.current);
        previewDebounceRef.current = null;
      }
    };
  }, [activeMode, uniformMargin, anisotropicMargins.x, anisotropicMargins.y, anisotropicMargins.z, directionalMargins.superior, directionalMargins.inferior, directionalMargins.anterior, directionalMargins.posterior, directionalMargins.left, directionalMargins.right, selectedStructure?.id]);

  const handleExecute = () => {
    if (!selectedStructure) return;

    // Handle new structure creation
    if (targetStructure === 'new' && onCreateNewStructure) {
      onCreateNewStructure(selectedStructure.id);
      // The creation will trigger the margin operation separately
      return;
    }

    const parameters: any = {
      margin: activeMode === 'uniform' ? uniformMargin : 
              activeMode === 'anisotropic' ? Math.max(anisotropicMargins.x, anisotropicMargins.y, anisotropicMargins.z) :
              Math.max(...Object.values(directionalMargins)),
      marginType: activeMode.toUpperCase(),
      marginValues: {},
      preview: { enabled: false }
    };

    if (activeMode === 'uniform') {
      parameters.marginValues = { uniform: uniformMargin };
    } else if (activeMode === 'anisotropic') {
      parameters.marginValues = anisotropicMargins;
    } else if (activeMode === 'directional') {
      parameters.marginValues = directionalMargins;
    }

    const targetId = targetStructure === 'same' ? selectedStructure.id :
                     targetStructure === 'different' ? selectedTargetId :
                     'new';

    onExecuteOperation({
      type: activeMode === 'uniform' ? 'uniform_margin' : 
            activeMode === 'anisotropic' ? 'anisotropic_margin' : 
            'directional_margin',
      parameters,
      structureId: selectedStructure.id,
      targetStructureId: targetId || undefined,
      preview: false
    });

    setIsPreviewActive(false);
  };

  const handleClearPreview = () => {
    if (onPreviewClear) {
      onPreviewClear();
    }
    setIsPreviewActive(false);
  };

  const renderUniformSettings = () => (
    <div className="space-y-3 p-3">
      <div className="flex items-center justify-between">
        <Label className="text-xs text-white/70">Margin Distance</Label>
        <div className="flex items-center space-x-2">
          <Slider
            value={[uniformMargin]}
            onValueChange={(value) => setUniformMargin(value[0])}
            min={-10}
            max={20}
            step={0.5}
            className="w-32"
          />
          <Input
            type="number"
            value={uniformMargin}
            onChange={(e) => setUniformMargin(parseFloat(e.target.value) || 0)}
            className="w-16 h-6 bg-white/10 border-white/30 text-white text-xs"
            step="0.5"
          />
          <span className="text-white/50 text-xs">mm</span>
        </div>
      </div>
    </div>
  );

  const renderAnisotropicSettings = () => (
    <div className="space-y-3 p-3">
      <div className="text-xs text-white/60 mb-2">
        Set same values for uniform expansion or different for directional
      </div>
      {Object.entries({ x: 'X (L/R)', y: 'Y (A/P)', z: 'Z (S/I)' }).map(([axis, label]) => (
        <div key={axis} className="flex items-center justify-between">
          <Label className="text-xs text-white/70 w-16">{label}</Label>
          <div className="flex items-center space-x-2">
            <Slider
              value={[anisotropicMargins[axis as keyof typeof anisotropicMargins]]}
              onValueChange={(value) => 
                setAnisotropicMargins(prev => ({ ...prev, [axis]: value[0] }))
              }
              min={-10}
              max={20}
              step={0.5}
              className="w-32"
            />
            <Input
              type="number"
              value={anisotropicMargins[axis as keyof typeof anisotropicMargins]}
              onChange={(e) => 
                setAnisotropicMargins(prev => ({ ...prev, [axis]: parseFloat(e.target.value) || 0 }))
              }
              className="w-16 h-6 bg-white/10 border-white/30 text-white text-xs"
              step="0.5"
            />
            <span className="text-white/50 text-xs">mm</span>
          </div>
        </div>
      ))}
    </div>
  );

  const renderDirectionalSettings = () => (
    <div className="space-y-2 p-3">
      <div className="grid grid-cols-2 gap-3">
        {Object.entries({
          superior: 'Superior (+Z)',
          inferior: 'Inferior (-Z)',
          anterior: 'Anterior (-Y)',
          posterior: 'Posterior (+Y)',
          left: 'Left (+X)',
          right: 'Right (-X)'
        }).map(([dir, label]) => (
          <div key={dir} className="flex items-center space-x-2">
            <Label className="text-xs text-white/70 w-20">{label}</Label>
            <Input
              type="number"
              value={directionalMargins[dir as keyof typeof directionalMargins]}
              onChange={(e) => 
                setDirectionalMargins(prev => ({ ...prev, [dir]: parseFloat(e.target.value) || 0 }))
              }
              className="w-14 h-6 bg-white/10 border-white/30 text-white text-xs"
              step="0.5"
            />
            <span className="text-white/50 text-xs">mm</span>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="fixed bottom-24 lg:left-[58.33%] left-1/2 transform -translate-x-1/2 z-50" 
         style={{ animationName: 'fadeInScale', animationDuration: '300ms', animationTimingFunction: 'ease-out', animationFillMode: 'both' }}>
      <div className="relative">
        <div 
          className="backdrop-blur-md border rounded-xl px-4 py-3 shadow-2xl"
          style={{ 
            backgroundColor: `hsla(${backgroundHue}, 20%, 10%, 0.75)`,
            borderColor: `${structureColor}60` 
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center space-x-3">
              <div 
                className="w-4 h-4 rounded border-2 border-white/60 shadow-sm"
                style={{ backgroundColor: structureColor }}
              />
              <span className="text-white text-sm font-medium">Margin:</span>
              <span className="text-white/70 text-sm">{selectedStructure.structureName}</span>
              
              {/* Separator */}
              <div className="w-px h-6 bg-white/30 mx-2" />
              
              {/* Simplified: Only show Uniform mode button for radial expansion */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleModeChange('uniform')}
                className={`h-7 px-3 border-2 text-white rounded-lg backdrop-blur-sm shadow-sm ${
                  activeMode === 'uniform' 
                    ? 'bg-cyan-500/30 border-cyan-400/60 hover:bg-cyan-500/40' 
                    : 'bg-white/10 border-white/30 hover:bg-white/20'
                }`}
                title="Uniform margin"
              >
                <Expand className="w-3 h-3 mr-1" />
                <span className="text-xs font-medium">Uniform</span>
              </Button>
              
              {/* Separator */}
              <div className="w-px h-6 bg-white/30 mx-2" />
              
              {/* Action buttons */}
              <Button
                variant="outline"
                size="sm"
                onClick={handlePreview}
                disabled={!selectedStructure}
                className="h-7 px-3 bg-yellow-900/30 border-2 border-yellow-600/50 text-yellow-400 hover:bg-yellow-900/40 rounded-lg backdrop-blur-sm shadow-sm"
              >
                <Eye className="w-3 h-3 mr-1" />
                <span className="text-xs font-medium">Preview</span>
              </Button>
              
              {isPreviewActive && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleClearPreview}
                  className="h-7 w-7 p-0 bg-gray-900/30 border-2 border-gray-600/50 text-gray-400 hover:bg-gray-900/40 rounded-lg backdrop-blur-sm shadow-sm"
                >
                  <EyeOff className="w-3 h-3" />
                </Button>
              )}
              
              <Button
                variant="outline"
                size="sm"
                onClick={handleExecute}
                disabled={!selectedStructure}
                className="h-7 px-3 bg-cyan-500/30 border-2 border-cyan-500/60 text-cyan-300 hover:bg-cyan-500/40 rounded-lg backdrop-blur-sm shadow-sm"
              >
                <Play className="w-3 h-3 mr-1" />
                <span className="text-xs font-medium">Execute</span>
              </Button>
            </div>
            
            {/* Close button */}
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="h-6 w-6 p-0 text-white/60 hover:text-white hover:bg-white/20 rounded-lg ml-3"
            >
              <X className="w-3 h-3" />
            </Button>
          </div>
          
          {/* Settings panel - simplified: target selector and distance control on one line */}
          <div className="mt-3 border-t border-white/20 pt-2">
            <div className="flex items-center justify-between p-3 space-x-4">
              {/* Target Structure Selector */}
              <div className="flex items-center space-x-3">
                <Label className="text-xs text-white/70">Target:</Label>
                <Select value={targetStructure} onValueChange={(value: 'same' | 'different' | 'new') => setTargetStructure(value)}>
                  <SelectTrigger className="w-44 h-7 bg-white/10 border-white/30 text-white text-xs">
                    <SelectValue placeholder="Select target" />
                  </SelectTrigger>
                  <SelectContent className="bg-gray-900 border-gray-700">
                    <SelectItem value="same" className="text-white text-xs hover:bg-gray-800">
                      Same (Modify)
                    </SelectItem>
                    <SelectItem value="different" className="text-white text-xs hover:bg-gray-800">
                      Different Structure
                    </SelectItem>
                    <SelectItem value="new" className="text-white text-xs hover:bg-gray-800">
                      <div className="flex items-center">
                        <Plus className="w-3 h-3 mr-1" />
                        New Structure
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
                {targetStructure === 'different' && (
                  <Select value={selectedTargetId?.toString()} onValueChange={(value) => setSelectedTargetId(parseInt(value))}>
                    <SelectTrigger className="w-40 h-7 bg-white/10 border-white/30 text-white text-xs">
                      <SelectValue placeholder="Select structure" />
                    </SelectTrigger>
                    <SelectContent className="bg-gray-900 border-gray-700">
                      {availableStructures
                        .filter(s => s.id !== selectedStructure.id)
                        .map(structure => (
                          <SelectItem key={structure.id} value={structure.id.toString()} className="text-white text-xs hover:bg-gray-800">
                            {structure.name}
                          </SelectItem>
                        ))
                      }
                    </SelectContent>
                  </Select>
                )}
              </div>

              {/* Inline distance control */}
              <div className="flex items-center space-x-2">
                <Label className="text-xs text-white/70">Distance</Label>
                <Slider
                  value={[uniformMargin]}
                  onValueChange={(value) => setUniformMargin(value[0])}
                  min={-10}
                  max={20}
                  step={0.5}
                  className="w-40"
                />
                <Input
                  type="number"
                  value={uniformMargin}
                  onChange={(e) => setUniformMargin(parseFloat(e.target.value) || 0)}
                  className="w-16 h-6 bg-white/10 border-white/30 text-white text-xs"
                  step="0.5"
                />
                <span className="text-white/50 text-xs">mm</span>
              </div>
            </div>
          </div>
          
          {/* Preview status */}
          {isPreviewActive && (
            <div className="mt-2 p-2 bg-yellow-900/20 border border-yellow-600/30 rounded-lg">
              <div className="flex items-center text-xs text-yellow-400">
                <Eye className="w-3 h-3 mr-2" />
                <span>Preview active - Animated yellow dashed outline shows margin</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
