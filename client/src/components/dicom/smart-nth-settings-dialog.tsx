import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface SmartNthSettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onApply: (threshold: number) => void;
  structureName: string;
  totalSlices: number;
  previewSlicesToRemove?: number;
}

export function SmartNthSettingsDialog({
  isOpen,
  onClose,
  onApply,
  structureName,
  totalSlices,
  previewSlicesToRemove
}: SmartNthSettingsDialogProps) {
  const [threshold, setThreshold] = useState(30);

  const handleApply = () => {
    onApply(threshold);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px] bg-gray-900 border-gray-700 text-white">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold text-white">
            SmartNth Slice Settings
          </DialogTitle>
          <DialogDescription className="text-gray-400">
            Configure the area change threshold for intelligent slice deletion in <span className="font-medium text-white">{structureName}</span>
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-6 py-4">
          {/* Threshold Slider */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm text-gray-200">Area Change Threshold</Label>
              <span className="text-sm font-semibold text-blue-400">{threshold}%</span>
            </div>
            <Slider
              value={[threshold]}
              onValueChange={(value) => setThreshold(value[0])}
              min={10}
              max={80}
              step={5}
              className="w-full"
            />
            <p className="text-xs text-gray-400">
              Slices with area changes greater than {threshold}% will be preserved (along with adjacent slices)
            </p>
          </div>

          {/* Info Panel */}
          <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-300">Total slices:</span>
              <span className="font-semibold text-white">{totalSlices}</span>
            </div>
            {previewSlicesToRemove !== undefined && (
              <>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-300">Slices to remove:</span>
                  <span className="font-semibold text-orange-400">{previewSlicesToRemove}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-300">Slices to keep:</span>
                  <span className="font-semibold text-green-400">{totalSlices - previewSlicesToRemove}</span>
                </div>
              </>
            )}
          </div>

          {/* Algorithm Description */}
          <div className="bg-blue-900/20 border border-blue-700/30 rounded-lg p-3 space-y-1">
            <p className="text-xs text-blue-200 font-medium">How SmartNth works:</p>
            <ul className="text-xs text-blue-300/80 space-y-0.5 ml-4 list-disc">
              <li>Calculates area for each contour slice</li>
              <li>Keeps slices with significant area changes ({">"}{threshold}%)</li>
              <li>Preserves slices before AND after change points</li>
              <li>Never removes more than 3 consecutive slices</li>
            </ul>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            className="bg-gray-800 border-gray-600 text-gray-200 hover:bg-gray-700"
          >
            Cancel
          </Button>
          <Button
            onClick={handleApply}
            className="bg-orange-600 hover:bg-orange-700 text-white"
          >
            Apply SmartNth
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


