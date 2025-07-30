import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { ArrowUpFromLine, ArrowDownFromLine, Eye, X, Play } from 'lucide-react';

interface SimpleGrowOperationsProps {
  selectedStructure: number | null;
  currentSlicePosition?: number; // Optional since we work on entire structure
  onContourUpdate: (action: string, payload: any) => void;
  onClose: () => void;
  structureColor?: string;
}

export function SimpleGrowOperations({
  selectedStructure,
  currentSlicePosition,
  onContourUpdate,
  onClose,
  structureColor = '#00ff00'
}: SimpleGrowOperationsProps) {
  const [operation, setOperation] = useState<'grow' | 'shrink'>('grow');
  const [distance, setDistance] = useState(0.5); // in cm
  const [isPreviewActive, setIsPreviewActive] = useState(false);

  // Clear preview when closing or changing settings
  useEffect(() => {
    return () => {
      clearPreview();
    };
  }, []);

  const clearPreview = () => {
    onContourUpdate('clear_preview', {});
    setIsPreviewActive(false);
  };

  const handlePreview = () => {
    if (!selectedStructure || distance <= 0) {
      console.log(`🔹 ❌ Preview blocked: selectedStructure=${selectedStructure}, distance=${distance}`);
      return;
    }

    const distanceMm = operation === 'grow' ? distance * 10 : -(distance * 10); // Convert cm to mm, negative for shrink
    
    console.log(`🔹 Generating ${operation} preview for ENTIRE STRUCTURE: ${Math.abs(distanceMm)}mm`);
    console.log(`🔹 Preview payload:`, {
      structureId: selectedStructure,
      distance: distanceMm,
      direction: 'all',
      wholeStructure: true
    });
    
    onContourUpdate('preview_grow_structure', {
      structureId: selectedStructure,
      distance: distanceMm,
      direction: 'all',
      wholeStructure: true
    });
    
    setIsPreviewActive(true);
  };

  const handleApply = () => {
    if (!selectedStructure || distance <= 0) {
      console.log(`🔹 ❌ Apply blocked: selectedStructure=${selectedStructure}, distance=${distance}`);
      return;
    }

    const distanceMm = operation === 'grow' ? distance * 10 : -(distance * 10); // Convert cm to mm, negative for shrink
    
    console.log(`🔹 Applying ${operation} to ENTIRE STRUCTURE: ${Math.abs(distanceMm)}mm`);
    console.log(`🔹 Apply payload:`, {
      structureId: selectedStructure,
      distance: distanceMm,
      direction: 'all',
      wholeStructure: true
    });
    
    // Clear preview first
    clearPreview();
    
    // Apply the operation to the entire structure
    onContourUpdate('apply_grow_structure', {
      structureId: selectedStructure,
      distance: distanceMm,
      direction: 'all',
      wholeStructure: true
    });
  };

  const handleDistanceChange = (value: number[]) => {
    setDistance(value[0]);
    // Auto-clear preview when distance changes
    if (isPreviewActive) {
      clearPreview();
    }
  };

  const handleOperationChange = (newOperation: 'grow' | 'shrink') => {
    setOperation(newOperation);
    // Auto-clear preview when operation changes
    if (isPreviewActive) {
      clearPreview();
    }
  };

  return (
    <div className="absolute bottom-full left-0 mb-2 bg-black/90 backdrop-blur-sm border border-gray-600/50 rounded-lg p-4 w-80 shadow-2xl z-50">
      <div className="flex items-center justify-between mb-4">
        <h4 className="text-sm font-medium text-white">Grow/Shrink Contour</h4>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="text-gray-400 hover:text-white h-6 w-6 p-0"
        >
          <X size={12} />
        </Button>
      </div>

      <div className="space-y-4">
        {/* Operation Selection */}
        <div className="flex gap-2">
          <Button
            variant={operation === 'grow' ? 'default' : 'outline'}
            size="sm"
            onClick={() => handleOperationChange('grow')}
            className={`flex-1 h-9 ${
              operation === 'grow' 
                ? 'bg-green-600 hover:bg-green-700 text-white' 
                : 'text-green-400 border-green-600/50 hover:bg-green-900/20'
            }`}
          >
            <ArrowUpFromLine className="w-4 h-4 mr-2" />
            Grow
          </Button>
          <Button
            variant={operation === 'shrink' ? 'default' : 'outline'}
            size="sm"
            onClick={() => handleOperationChange('shrink')}
            className={`flex-1 h-9 ${
              operation === 'shrink' 
                ? 'bg-red-600 hover:bg-red-700 text-white' 
                : 'text-red-400 border-red-600/50 hover:bg-red-900/20'
            }`}
          >
            <ArrowDownFromLine className="w-4 h-4 mr-2" />
            Shrink
          </Button>
        </div>

        {/* Distance Slider */}
        <div>
          <Label className="text-xs text-gray-300 mb-2 block">
            Distance: {distance.toFixed(1)} cm ({(distance * 10).toFixed(1)} mm)
          </Label>
          <Slider
            value={[distance]}
            onValueChange={handleDistanceChange}
            max={2.0}
            min={0.1}
            step={0.1}
            className="w-full"
          />
          <div className="text-xs text-gray-500 mt-1">
            Range: 0.1cm - 2.0cm (1mm - 20mm)
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handlePreview}
            disabled={!selectedStructure || distance <= 0}
            className="flex-1 h-9 bg-yellow-900/20 hover:bg-yellow-900/30 border-yellow-600/50 text-yellow-400 hover:text-yellow-300"
          >
            <Eye className="w-4 h-4 mr-2" />
            Preview
          </Button>
          
          {isPreviewActive && (
            <Button
              variant="outline"
              size="sm"
              onClick={clearPreview}
              className="h-9 px-3 bg-gray-900/20 hover:bg-gray-900/30 border-gray-600/50 text-gray-400 hover:text-gray-300"
              title="Clear Preview"
            >
              <X className="w-4 h-4" />
            </Button>
          )}
          
          <Button
            variant="outline"
            size="sm"
            onClick={handleApply}
            disabled={!selectedStructure || distance <= 0}
            className={`flex-1 h-9 ${
              operation === 'grow'
                ? 'bg-green-900/20 hover:bg-green-900/30 border-green-600/50 text-green-400 hover:text-green-300'
                : 'bg-red-900/20 hover:bg-red-900/30 border-red-600/50 text-red-400 hover:text-red-300'
            }`}
          >
            <Play className="w-4 h-4 mr-2" />
            {isPreviewActive ? 'Apply' : 'Run'}
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
              Dashed yellow outline shows {operation} result ({distance.toFixed(1)}cm) on all slices
            </div>
          </div>
        )}

        {/* Help Text */}
        <div className="text-xs text-gray-500 border-t border-gray-700 pt-3">
          <div className="font-medium mb-1">🏥 Medical 3D Operations:</div>
          <ul className="space-y-1 text-gray-400">
            <li>• Preview shows dashed yellow outline</li>
            <li>• Grow: Expands contour outward on ALL slices</li>
            <li>• Shrink: Contracts contour inward on ALL slices</li>
            <li>• <strong className="text-yellow-400">Works on entire 3D structure</strong></li>
          </ul>
        </div>
      </div>
    </div>
  );
} 