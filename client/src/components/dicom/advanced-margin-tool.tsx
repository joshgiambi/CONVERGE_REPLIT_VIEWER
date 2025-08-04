import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Slider } from '@/components/ui/slider';
import { X, Play, Eye, EyeOff, Expand, Shrink, Settings } from 'lucide-react';

interface AdvancedMarginToolProps {
  isVisible: boolean;
  onClose: () => void;
  selectedStructure?: {
    id: number;
    structureName: string;
    color?: string;
  };
  onExecuteOperation: (operation: {
    type: 'uniform_margin' | 'directional_margin' | 'morphological_margin' | 'anisotropic_margin';
    parameters: MarginParameters;
    structureId: number;
    preview?: boolean;
  }) => void;
  onPreviewOperation: (operation: {
    type: 'preview_margin';
    parameters: MarginParameters;
    structureId: number;
  }) => void;
  onClearPreview: () => void;
}

interface MarginParameters {
  marginType: 'UNIFORM' | 'DIRECTIONAL' | 'MORPHOLOGICAL' | 'ANISOTROPIC';
  marginValues: {
    uniform: number;        // mm
    superior: number;       // mm (+Z)
    inferior: number;       // mm (-Z)
    anterior: number;       // mm (-Y)
    posterior: number;      // mm (+Y)
    left: number;          // mm (+X)
    right: number;         // mm (-X)
    // Anisotropic margins for radiotherapy
    x: number;            // mm in X direction
    y: number;            // mm in Y direction
    z: number;            // mm in Z direction
  };
  algorithmType: 'SIMPLE' | 'MORPHOLOGICAL' | 'SURFACE_BASED' | 'ANISOTROPIC_MORPH';
  kernelType: 'SPHERICAL' | 'CUBIC' | 'ELLIPSOIDAL';
  smoothingType: 'LINEAR' | 'GAUSSIAN' | 'SPLINE';
  cornerHandling: 'ROUND' | 'MITER' | 'BEVEL';
  resolution: number;       // mm between points
  iterations: number;       // Number of dilation/erosion iterations
  interpolateSlices: boolean; // For Z-direction extension
  preview: {
    enabled: boolean;
    opacity: number;
    color: string;
    updateRealtime: boolean;
  };
}

const defaultMarginParameters = (): MarginParameters => ({
  marginType: 'UNIFORM',
  marginValues: {
    uniform: 5.0,
    superior: 5.0,
    inferior: 5.0,
    anterior: 5.0,
    posterior: 5.0,
    left: 5.0,
    right: 5.0,
    x: 5.0,
    y: 5.0,
    z: 5.0
  },
  algorithmType: 'MORPHOLOGICAL',
  kernelType: 'SPHERICAL',
  smoothingType: 'GAUSSIAN',
  cornerHandling: 'ROUND',
  resolution: 1.0,
  iterations: 1,
  interpolateSlices: false,
  preview: {
    enabled: true,
    opacity: 0.6,
    color: '#FFFF00',
    updateRealtime: true
  }
});

export function AdvancedMarginTool({
  isVisible,
  onClose,
  selectedStructure,
  onExecuteOperation,
  onPreviewOperation,
  onClearPreview
}: AdvancedMarginToolProps) {
  const [parameters, setParameters] = useState<MarginParameters>(defaultMarginParameters());
  const [isPreviewActive, setIsPreviewActive] = useState(false);
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);

  // Auto-preview when settings change if preview is enabled and realtime is on
  // Debounce to prevent excessive updates
  useEffect(() => {
    if (parameters.preview.enabled && parameters.preview.updateRealtime && selectedStructure && isPreviewActive) {
      const timeoutId = setTimeout(() => {
        handlePreview();
      }, 300); // 300ms debounce delay
      
      return () => clearTimeout(timeoutId);
    }
  }, [parameters.marginValues, parameters.marginType, parameters.algorithmType, selectedStructure?.id]);

  // Clear preview when closing
  useEffect(() => {
    return () => {
      if (isPreviewActive) {
        onClearPreview();
        setIsPreviewActive(false);
      }
    };
  }, []);

  const handleParameterChange = useCallback((path: string, value: any) => {
    setParameters(prev => {
      const keys = path.split('.');
      const newParams = { ...prev };
      let current: any = newParams;
      
      for (let i = 0; i < keys.length - 1; i++) {
        current[keys[i]] = { ...current[keys[i]] };
        current = current[keys[i]];
      }
      
      current[keys[keys.length - 1]] = value;
      return newParams;
    });
  }, []);

  const handlePreview = useCallback(() => {
    if (!selectedStructure) {
      console.warn('🔹 ❌ No structure selected for preview');
      return;
    }

    console.log('🔹 🎯 Advanced Margin Tool: Starting preview for structure:', selectedStructure.id);
    console.log('🔹 📊 Preview parameters:', parameters);
    
    onPreviewOperation({
      type: 'preview_margin',
      parameters,
      structureId: selectedStructure.id
    });
    
    setIsPreviewActive(true);
    console.log('🔹 ✅ Preview operation dispatched');
  }, [selectedStructure, parameters, onPreviewOperation]);

  const handleClearPreview = useCallback(() => {
    onClearPreview();
    setIsPreviewActive(false);
  }, [onClearPreview]);

  const handleExecute = useCallback(() => {
    if (!selectedStructure) {
      console.warn('🔹 ❌ No structure selected for execution');
      return;
    }

    // Clear preview first
    if (isPreviewActive) {
      handleClearPreview();
    }

    console.log('🔹 🎯 Advanced Margin Tool: Starting execution for structure:', selectedStructure.id);
    console.log('🔹 📊 Execution parameters:', parameters);
    
    onExecuteOperation({
      type: parameters.marginType === 'UNIFORM' ? 'uniform_margin' : 
            parameters.marginType === 'DIRECTIONAL' ? 'directional_margin' : 
            parameters.marginType === 'ANISOTROPIC' ? 'anisotropic_margin' :
            'morphological_margin',
      parameters,
      structureId: selectedStructure.id
    });
    
    console.log('🔹 ✅ Execute operation dispatched');
  }, [selectedStructure, parameters, isPreviewActive, onExecuteOperation, handleClearPreview]);

  const renderUniformMarginControls = () => (
    <div className="space-y-4">
      <div>
        <Label className="text-sm text-white/90">Margin Distance</Label>
        <div className="flex items-center space-x-4 mt-2">
          <Slider
            value={[parameters.marginValues.uniform]}
            onValueChange={(value) => handleParameterChange('marginValues.uniform', value[0])}
            min={-20}
            max={20}
            step={0.5}
            className="flex-1"
          />
          <div className="flex items-center space-x-2">
            <Input
              type="number"
              value={parameters.marginValues.uniform}
              onChange={(e) => handleParameterChange('marginValues.uniform', parseFloat(e.target.value) || 0)}
              className="w-20 h-8 bg-white/10 border-white/30 text-white text-sm"
              step="0.5"
            />
            <span className="text-white/70 text-sm">mm</span>
          </div>
        </div>
        <div className="text-xs text-white/50 mt-1">
          Positive values expand, negative values shrink
        </div>
      </div>
    </div>
  );

  const renderDirectionalMarginControls = () => (
    <div className="space-y-3">
      {Object.entries({
        superior: 'Superior (+Z)',
        inferior: 'Inferior (-Z)', 
        anterior: 'Anterior (-Y)',
        posterior: 'Posterior (+Y)',
        left: 'Left (+X)',
        right: 'Right (-X)'
      }).map(([key, label]) => (
        <div key={key}>
          <Label className="text-xs text-white/70">{label}</Label>
          <div className="flex items-center space-x-2 mt-1">
            <Slider
              value={[parameters.marginValues[key as keyof typeof parameters.marginValues]]}
              onValueChange={(value) => handleParameterChange(`marginValues.${key}`, value[0])}
              min={-20}
              max={20}
              step={0.5}
              className="flex-1"
            />
            <Input
              type="number"
              value={parameters.marginValues[key as keyof typeof parameters.marginValues]}
              onChange={(e) => handleParameterChange(`marginValues.${key}`, parseFloat(e.target.value) || 0)}
              className="w-16 h-7 bg-white/10 border-white/30 text-white text-xs"
              step="0.5"
            />
            <span className="text-white/50 text-xs w-8">mm</span>
          </div>
        </div>
      ))}
    </div>
  );
  
  const renderAnisotropicMarginControls = () => (
    <div className="space-y-4">
      <div className="text-xs text-white/70 mb-3">
        Anisotropic margins allow different values for X, Y, and Z directions.
        Use same values for uniform expansion or different values for directional expansion.
        Used in radiotherapy to account for directional tumor movement patterns.
      </div>
      
      {Object.entries({
        x: 'X Direction (Left/Right)',
        y: 'Y Direction (Anterior/Posterior)',
        z: 'Z Direction (Superior/Inferior)'
      }).map(([key, label]) => (
        <div key={key}>
          <Label className="text-xs text-white/70">{label}</Label>
          <div className="flex items-center space-x-2 mt-1">
            <Slider
              value={[parameters.marginValues[key as keyof typeof parameters.marginValues]]}
              onValueChange={(value) => handleParameterChange(`marginValues.${key}`, value[0])}
              min={0}
              max={20}
              step={0.5}
              className="flex-1"
            />
            <Input
              type="number"
              value={parameters.marginValues[key as keyof typeof parameters.marginValues]}
              onChange={(e) => handleParameterChange(`marginValues.${key}`, parseFloat(e.target.value) || 0)}
              className="w-16 h-7 bg-white/10 border-white/30 text-white text-xs"
              step="0.5"
            />
            <span className="text-white/50 text-xs w-8">mm</span>
          </div>
        </div>
      ))}
      
      <div className="mt-4 pt-3 border-t border-white/20">
        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            checked={parameters.interpolateSlices || false}
            onChange={(e) => handleParameterChange('interpolateSlices', e.target.checked)}
            className="rounded"
          />
          <span className="text-white/70 text-xs">Interpolate between slices (Z-direction extension)</span>
        </label>
      </div>
      
      <div className="text-xs text-white/50 mt-2">
        Algorithm uses morphological operations (dilation/erosion) with elliptical kernels
        to simulate vtkImageDilateErode3D behavior.
      </div>
    </div>
  );

  const renderAdvancedSettings = () => (
    <div className="space-y-4 mt-4 pt-4 border-t border-white/20">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-white/90">Advanced Settings</h4>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowAdvancedSettings(!showAdvancedSettings)}
          className="h-6 w-6 p-0 text-white/60 hover:text-white"
        >
          <Settings size={12} />
        </Button>
      </div>
      
      {showAdvancedSettings && (
        <div className="space-y-3">
          <div>
            <Label className="text-xs text-white/70">Algorithm Type</Label>
            <Select 
              value={parameters.algorithmType}
              onValueChange={(value) => handleParameterChange('algorithmType', value)}
            >
              <SelectTrigger className="h-8 bg-white/10 border-white/30 text-white text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="SIMPLE">Simple Buffering</SelectItem>
                <SelectItem value="MORPHOLOGICAL">Morphological Operations</SelectItem>
                <SelectItem value="SURFACE_BASED">Surface-Based</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs text-white/70">Kernel Type</Label>
            <Select 
              value={parameters.kernelType}
              onValueChange={(value) => handleParameterChange('kernelType', value)}
            >
              <SelectTrigger className="h-8 bg-white/10 border-white/30 text-white text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="SPHERICAL">Spherical</SelectItem>
                <SelectItem value="CUBIC">Cubic</SelectItem>
                <SelectItem value="ELLIPSOIDAL">Ellipsoidal</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs text-white/70">Smoothing</Label>
            <Select 
              value={parameters.smoothingType}
              onValueChange={(value) => handleParameterChange('smoothingType', value)}
            >
              <SelectTrigger className="h-8 bg-white/10 border-white/30 text-white text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="LINEAR">Linear</SelectItem>
                <SelectItem value="GAUSSIAN">Gaussian</SelectItem>
                <SelectItem value="SPLINE">Spline</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs text-white/70">Resolution: {parameters.resolution.toFixed(1)} mm</Label>
            <Slider
              value={[parameters.resolution]}
              onValueChange={(value) => handleParameterChange('resolution', value[0])}
              min={0.1}
              max={5.0}
              step={0.1}
              className="mt-1"
            />
          </div>

          <div>
            <Label className="text-xs text-white/70">Iterations: {parameters.iterations}</Label>
            <Slider
              value={[parameters.iterations]}
              onValueChange={(value) => handleParameterChange('iterations', value[0])}
              min={1}
              max={10}
              step={1}
              className="mt-1"
            />
          </div>
        </div>
      )}
    </div>
  );

  if (!isVisible) return null;

  return (
    <div className="fixed bottom-24 left-[400px] z-50">
      <div className="backdrop-blur-md border border-cyan-500/60 rounded-xl px-4 py-3 shadow-2xl bg-gray-900/90 w-[420px] max-h-[60vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}>
        
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center space-x-2">
            <div 
              className="w-3 h-3 rounded border-2 border-white/60 shadow-sm"
              style={{ backgroundColor: selectedStructure?.color || '#22D3EE' }}
            />
            <span className="text-white text-sm font-medium">Advanced Margin</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="h-6 w-6 p-0 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg"
          >
            <X size={14} />
          </Button>
        </div>

        {/* Target Structure */}
        <div className="mb-4">
          <h3 className="text-white/90 text-sm font-medium mb-2">Target Structure</h3>
          {selectedStructure ? (
            <div className="flex items-center space-x-2 px-3 py-2 bg-white/5 border border-white/20 rounded-lg">
              <div 
                className="w-3 h-3 rounded border border-white/40"
                style={{ backgroundColor: selectedStructure.color || '#3B82F6' }}
              />
              <span className="text-white text-sm font-medium">
                {selectedStructure.structureName}
              </span>
            </div>
          ) : (
            <div className="text-white/50 text-sm">No structure selected</div>
          )}
        </div>

        {/* Margin Type Tabs */}
        <Tabs 
          value={parameters.marginType} 
          onValueChange={(value) => handleParameterChange('marginType', value)}
          className="mb-4"
        >
          <TabsList className="grid w-full grid-cols-4 bg-white/10">
            <TabsTrigger value="UNIFORM" className="text-xs data-[state=active]:bg-cyan-500/20 data-[state=active]:text-cyan-300">
              Uniform
            </TabsTrigger>
            <TabsTrigger value="DIRECTIONAL" className="text-xs data-[state=active]:bg-cyan-500/20 data-[state=active]:text-cyan-300">
              Directional
            </TabsTrigger>
            <TabsTrigger value="MORPHOLOGICAL" className="text-xs data-[state=active]:bg-cyan-500/20 data-[state=active]:text-cyan-300">
              Morphological
            </TabsTrigger>
            <TabsTrigger value="ANISOTROPIC" className="text-xs data-[state=active]:bg-cyan-500/20 data-[state=active]:text-cyan-300">
              Anisotropic
            </TabsTrigger>
          </TabsList>

          <TabsContent value="UNIFORM" className="mt-4">
            {renderUniformMarginControls()}
          </TabsContent>

          <TabsContent value="DIRECTIONAL" className="mt-4">
            {renderDirectionalMarginControls()}
          </TabsContent>

          <TabsContent value="MORPHOLOGICAL" className="mt-4">
            {renderUniformMarginControls()}
            {renderAdvancedSettings()}
          </TabsContent>
          
          <TabsContent value="ANISOTROPIC" className="mt-4">
            {renderAnisotropicMarginControls()}
          </TabsContent>
        </Tabs>

        {/* Preview Settings */}
        <div className="mb-4 p-3 bg-yellow-900/20 border border-yellow-600/30 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center space-x-2">
              <Eye size={14} className="text-yellow-400" />
              <span className="text-yellow-300 text-sm font-medium">Preview Settings</span>
            </div>
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={parameters.preview.enabled}
                onChange={(e) => handleParameterChange('preview.enabled', e.target.checked)}
                className="rounded"
              />
              <span className="text-yellow-400 text-xs">Enabled</span>
            </label>
          </div>
          
          {parameters.preview.enabled && (
            <div className="space-y-2">
              <label className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={parameters.preview.updateRealtime}
                  onChange={(e) => handleParameterChange('preview.updateRealtime', e.target.checked)}
                  className="rounded"
                />
                <span className="text-yellow-400 text-xs">Real-time update</span>
              </label>
              
              <div>
                <Label className="text-xs text-yellow-400">Opacity: {Math.round(parameters.preview.opacity * 100)}%</Label>
                <Slider
                  value={[parameters.preview.opacity]}
                  onValueChange={(value) => handleParameterChange('preview.opacity', value[0])}
                  min={0.1}
                  max={1.0}
                  step={0.1}
                  className="mt-1"
                />
              </div>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex space-x-2">
          <Button
            onClick={handlePreview}
            disabled={!selectedStructure || !parameters.preview.enabled}
            className="flex-1 h-9 bg-yellow-900/20 hover:bg-yellow-900/30 border border-yellow-600/50 text-yellow-400 hover:text-yellow-300"
          >
            <Eye className="w-4 h-4 mr-2" />
            Preview
          </Button>
          
          {isPreviewActive && (
            <Button
              onClick={handleClearPreview}
              className="h-9 px-3 bg-gray-900/20 hover:bg-gray-900/30 border border-gray-600/50 text-gray-400 hover:text-gray-300"
            >
              <EyeOff className="w-4 h-4" />
            </Button>
          )}
          
          <Button
            onClick={handleExecute}
            disabled={!selectedStructure}
            className="flex-1 h-9 bg-cyan-500/20 border border-cyan-500/60 text-cyan-300 hover:bg-cyan-500/30 hover:text-cyan-200"
          >
            <Play className="w-4 h-4 mr-2" />
            Execute
          </Button>
        </div>

        {/* Preview Status */}
        {isPreviewActive && (
          <div className="mt-3 p-3 bg-yellow-900/20 border border-yellow-600/30 rounded-lg">
            <div className="flex items-center text-xs text-yellow-400">
              <Eye className="w-3 h-3 mr-2" />
              <span className="font-medium">Preview Active</span>
            </div>
            <div className="text-xs text-yellow-500 mt-1">
              Dashed yellow outline shows {parameters.marginType.toLowerCase()} margin result on all slices
            </div>
          </div>
        )}
      </div>
    </div>
  );
} 