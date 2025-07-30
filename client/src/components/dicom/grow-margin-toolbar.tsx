import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { X, Play, Info, Expand, Shrink, Eye, Undo, Redo, RotateCcw, Settings } from 'lucide-react';

interface GrowMarginToolbarProps {
  isVisible: boolean;
  onClose: () => void;
  selectedStructure?: {
    id: number;
    structureName: string;
    color?: string;
  };
  onExecuteOperation: (operation: {
    type: 'grow' | 'shrink' | 'margin';
    distance: number;
    direction: 'all' | 'anterior' | 'posterior' | 'left' | 'right' | 'superior' | 'inferior';
    structure: number;
  }) => void;
}

export function GrowMarginToolbar({
  isVisible,
  onClose,
  selectedStructure,
  onExecuteOperation
}: GrowMarginToolbarProps) {
  const [distance, setDistance] = useState([5]); // Distance in mm
  const [operation, setOperation] = useState<'grow' | 'shrink' | 'margin'>('grow');
  const [direction, setDirection] = useState<'all' | 'anterior' | 'posterior' | 'left' | 'right' | 'superior' | 'inferior'>('all');
  const [showInstructions, setShowInstructions] = useState(false);
  const [livePreview, setLivePreview] = useState(true);
  const [previewEnabled, setPreviewEnabled] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const handleCloseWithConfirmation = () => {
    // For now, just close immediately - could add confirmation logic later
    onClose();
  };

  const handleExecute = () => {
    if (!selectedStructure) return;
    
    onExecuteOperation({
      type: operation,
      distance: distance[0],
      direction,
      structure: selectedStructure.id
    });
  };

  const handleUndo = () => {
    // TODO: Implement undo functionality
    console.log('Undo clicked');
  };

  const handleRedo = () => {
    // TODO: Implement redo functionality
    console.log('Redo clicked');
  };

  const handleReset = () => {
    setDistance([5]);
    setOperation('grow');
    setDirection('all');
  };

  if (!isVisible) return null;

  return (
    <div className="fixed bottom-24 lg:left-[58.33%] left-1/2 transform -translate-x-1/2 z-50" style={{ animationName: 'fadeInScale', animationDuration: '300ms', animationTimingFunction: 'ease-out', animationFillMode: 'both' }}>
      <div className="flex items-start space-x-3">
        {/* Main toolbar panel */}
        <div className="backdrop-blur-sm border border-yellow-500/60 rounded-xl px-4 py-3 shadow-2xl bg-gray-900/90 w-[800px]">

          {/* First Row: Title, Info, Controls */}
          <div className="flex items-center space-x-3 mb-3">
            <div className="flex items-center space-x-2">
              <div 
                className="w-4 h-4 rounded border-2 border-white/60 shadow-sm"
                style={{ backgroundColor: 'rgb(234, 179, 8)' }}
              />
              <span className="text-white text-sm font-medium drop-shadow-sm">Grow & Margin Operations</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowInstructions(!showInstructions)}
                className="h-6 w-6 p-0 text-yellow-400 hover:text-yellow-300 hover:bg-yellow-900/20 rounded-lg"
                title="Show instructions"
              >
                <Info size={12} />
              </Button>
            </div>

            {/* Distance Input */}
            <div className="flex items-center space-x-2">
              <span className="text-white/90 text-sm">Distance:</span>
              <Input
                value={distance[0]}
                onChange={(e) => setDistance([parseFloat(e.target.value) || 0])}
                placeholder="5.0"
                className="w-16 h-7 bg-white/10 border-white/30 text-white text-sm rounded-lg transition-all duration-200 focus:outline-none focus:ring-0 focus:border-yellow-500/60 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 hover:border-white/50"
                style={{ WebkitTapHighlightColor: 'transparent' }}
              />
              <span className="text-white/70 text-xs">mm</span>
            </div>

            {/* Live Preview Toggle */}
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setPreviewEnabled(!previewEnabled)}
                className="flex items-center justify-center"
                title="Toggle live preview"
              >
                <Eye 
                  className={`w-4 h-4 cursor-pointer transition-colors ${
                    previewEnabled 
                      ? 'text-yellow-400 hover:text-yellow-300' 
                      : 'text-white/40 hover:text-white/60'
                  }`}
                />
              </button>
              <span className="text-white/70 text-xs">Preview</span>
            </div>

            {/* Close button */}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCloseWithConfirmation}
              className="ml-auto h-6 w-6 p-0 text-white/60 hover:text-white hover:bg-white/10 rounded-lg"
              title="Close toolbar"
            >
              <X size={14} />
            </Button>
          </div>

          {/* Distance Slider */}
          <div className="mb-3">
            <div className="flex items-center space-x-3">
              <span className="text-white/90 text-sm w-16">Range:</span>
              <div className="flex-1">
                <Slider
                  value={distance}
                  onValueChange={setDistance}
                  max={50}
                  min={0.1}
                  step={0.1}
                  className="w-full"
                />
              </div>
              <span className="text-white/70 text-xs w-12">{distance[0].toFixed(1)}mm</span>
            </div>
          </div>

          {/* Second Row: Operation Type and Direction */}
          <div className="flex items-center space-x-4 mb-3">
            {/* Operation Type */}
            <div className="flex items-center space-x-2">
              <span className="text-white/90 text-sm">Operation:</span>
              <div className="flex space-x-1">
                {[
                  { value: 'grow', label: 'Grow', icon: Expand },
                  { value: 'shrink', label: 'Shrink', icon: Shrink },
                  { value: 'margin', label: 'Margin', icon: Settings }
                ].map(({ value, label, icon: Icon }) => (
                  <Button
                    key={value}
                    variant="ghost"
                    size="sm"
                    onClick={() => setOperation(value as any)}
                    className={`h-7 px-3 text-xs rounded-lg transition-all duration-200 ${
                      operation === value
                        ? 'bg-yellow-500/20 border border-yellow-500/60 text-yellow-300'
                        : 'bg-white/5 border border-white/20 text-white/70 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    <Icon className="w-3 h-3 mr-1" />
                    {label}
                  </Button>
                ))}
              </div>
            </div>

            <Separator orientation="vertical" className="h-6 bg-white/20" />

            {/* Direction */}
            <div className="flex items-center space-x-2">
              <span className="text-white/90 text-sm">Direction:</span>
              <select
                value={direction}
                onChange={(e) => setDirection(e.target.value as any)}
                className="h-7 px-2 bg-white/10 border border-white/30 text-white text-xs rounded-lg focus:outline-none focus:border-yellow-500/60 hover:border-white/50"
                style={{ WebkitTapHighlightColor: 'transparent' }}
              >
                <option value="all">All Directions</option>
                <option value="anterior">Anterior</option>
                <option value="posterior">Posterior</option>
                <option value="left">Left</option>
                <option value="right">Right</option>
                <option value="superior">Superior</option>
                <option value="inferior">Inferior</option>
              </select>
            </div>
          </div>

          {/* Third Row: Action Buttons */}
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              {/* Undo/Redo */}
              <Button
                variant="outline"
                size="sm"
                onClick={handleUndo}
                className="h-7 w-7 p-0 bg-white/10 border-2 border-white/30 text-white hover:text-white hover:bg-white/20 rounded-lg backdrop-blur-sm shadow-sm"
                title="Undo (Ctrl+Z)"
              >
                <Undo className="w-3 h-3" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRedo}
                className="h-7 w-7 p-0 bg-white/10 border-2 border-white/30 text-white hover:text-white hover:bg-white/20 rounded-lg backdrop-blur-sm shadow-sm"
                title="Redo (Ctrl+Y)"
              >
                <Redo className="w-3 h-3" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleReset}
                className="h-7 w-7 p-0 bg-white/10 border-2 border-white/30 text-white hover:text-white hover:bg-white/20 rounded-lg backdrop-blur-sm shadow-sm"
                title="Reset to defaults"
              >
                <RotateCcw className="w-3 h-3" />
              </Button>
            </div>

            {/* Selected Structure Info */}
            {selectedStructure && (
              <div className="flex items-center space-x-2">
                <span className="text-white/70 text-xs">Target:</span>
                <div className="flex items-center space-x-1">
                  <div 
                    className="w-3 h-3 rounded border border-white/40"
                    style={{ backgroundColor: selectedStructure.color || '#3B82F6' }}
                  />
                  <span className="text-white text-xs font-medium">
                    {selectedStructure.structureName}
                  </span>
                </div>
              </div>
            )}

            {/* Execute Button */}
            <Button
              onClick={handleExecute}
              disabled={!selectedStructure}
              className="h-8 px-4 bg-yellow-500/20 border border-yellow-500/60 text-yellow-300 hover:bg-yellow-500/30 hover:text-yellow-200 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-all duration-200 text-sm font-medium shadow-sm"
              title="Execute operation"
            >
              <Play className="w-3 h-3 mr-1" />
              Execute
            </Button>
          </div>

          {/* Instructions Panel */}
          {showInstructions && (
            <div className="mt-3 pt-3 border-t border-white/20">
              <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3">
                <h4 className="text-yellow-300 text-sm font-medium mb-2">Grow & Margin Operations</h4>
                <div className="text-white/80 text-xs space-y-1">
                  <p><strong>Grow:</strong> Expand the structure outward by the specified distance</p>
                  <p><strong>Shrink:</strong> Contract the structure inward by the specified distance</p>
                  <p><strong>Margin:</strong> Create a uniform margin around the structure</p>
                  <p><strong>Direction:</strong> Choose specific anatomical directions or apply to all directions</p>
                  <p><strong>Preview:</strong> See live preview of changes before applying</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
} 