import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { X, Play, Expand, Shrink } from 'lucide-react';

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
    distances: {
      superior: number;
      inferior: number;
      left: number;
      right: number;
      anterior: number;
      posterior: number;
    };
    structure: number;
  }) => void;
}

export function GrowMarginToolbar({
  isVisible,
  onClose,
  selectedStructure,
  onExecuteOperation
}: GrowMarginToolbarProps) {
  const [distance, setDistance] = useState([5]); // Distance in mm (converted to/from cm in UI)
  const [operation, setOperation] = useState<'grow' | 'shrink'>('grow');

  const handleCloseWithConfirmation = () => {
    onClose();
  };

  const handleExecute = () => {
    if (!selectedStructure) return;
    
    // For uniform operations, use the same distance for all directions
    const uniformDistances = {
      superior: distance[0] / 10, // Convert mm to cm for consistency
      inferior: distance[0] / 10,
      left: distance[0] / 10,
      right: distance[0] / 10,
      anterior: distance[0] / 10,
      posterior: distance[0] / 10
    };
    
    onExecuteOperation({
      type: operation,
      distances: uniformDistances,
      structure: selectedStructure.id
    });
  };

  if (!isVisible) return null;

  return (
    <div className="fixed bottom-24 lg:left-[58.33%] left-1/2 transform -translate-x-1/2 z-50" style={{ animationName: 'fadeInScale', animationDuration: '300ms', animationTimingFunction: 'ease-out', animationFillMode: 'both' }}>
      <div className="flex items-start space-x-3">
        {/* Main toolbar panel */}
        <div className="backdrop-blur-sm border border-cyan-500/60 rounded-xl px-4 py-3 shadow-2xl bg-cyan-900/20 w-[500px]">

          {/* Header with Close Button */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-2">
              <div 
                className="w-4 h-4 rounded border-2 border-white/60 shadow-sm"
                style={{ backgroundColor: 'rgb(34, 211, 238)' }}
              />
              <span className="text-white text-sm font-medium drop-shadow-sm">Margin Tool</span>
            </div>
            
            {/* Close button */}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCloseWithConfirmation}
              className="h-6 w-6 p-0 text-white/60 hover:text-white hover:bg-white/10 rounded-lg"
              title="Close toolbar"
            >
              <X size={14} />
            </Button>
          </div>

          {/* Main Controls Row */}
          <div className="flex items-center space-x-4 mb-4">
            {/* Operation Buttons */}
            <div className="flex space-x-1">
              {[
                { value: 'grow', label: 'Grow', icon: Expand },
                { value: 'shrink', label: 'Shrink', icon: Shrink }
              ].map(({ value, label, icon: Icon }) => (
                <Button
                  key={value}
                  variant="ghost"
                  size="sm"
                  onClick={() => setOperation(value as any)}
                  className={`h-8 px-4 text-sm rounded-lg transition-all duration-200 ${
                    operation === value
                      ? 'bg-cyan-500/20 border border-cyan-500/60 text-cyan-300'
                      : 'bg-white/5 border border-white/20 text-white/70 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  <Icon className="w-4 h-4 mr-2" />
                  {label}
                </Button>
              ))}
            </div>

            <Separator orientation="vertical" className="h-8 bg-white/20" />

            {/* Distance Input */}
            <div className="flex items-center space-x-2">
              <span className="text-white/90 text-sm">Distance:</span>
              <Input
                type="number"
                step="0.1"
                value={distance[0] / 10} // Convert mm to cm
                onChange={(e) => setDistance([parseFloat(e.target.value) * 10 || 0])} // Convert cm to mm
                placeholder="0.5"
                className="w-20 h-8 bg-white/10 border-white/30 text-white text-sm rounded-lg transition-all duration-200 focus:outline-none focus:ring-0 focus:border-cyan-500/60 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 hover:border-white/50"
                style={{ WebkitTapHighlightColor: 'transparent' }}
              />
              <span className="text-white/70 text-sm">cm</span>
            </div>
          </div>

          {/* Target Structure Section */}
          <div className="space-y-3">
            <h3 className="text-white/90 text-sm font-medium">Target Structure</h3>
            
            {/* Input Structure */}
            <div className="flex items-center space-x-3">
              <span className="text-white/70 text-sm w-16">Input:</span>
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

            {/* Output Structure */}
            <div className="flex items-center space-x-3">
              <span className="text-white/70 text-sm w-16">Output:</span>
              {selectedStructure ? (
                <div className="flex items-center space-x-2 px-3 py-2 bg-cyan-500/10 border border-cyan-500/30 rounded-lg">
                  <div 
                    className="w-3 h-3 rounded border border-cyan-500/40"
                    style={{ backgroundColor: selectedStructure.color || '#3B82F6' }}
                  />
                  <span className="text-cyan-200 text-sm font-medium">
                    {selectedStructure.structureName} (modified)
                  </span>
                </div>
              ) : (
                <div className="text-white/50 text-sm">No structure selected</div>
              )}
            </div>

            {/* Execute Button */}
            <div className="flex justify-end pt-2">
              <Button
                onClick={handleExecute}
                disabled={!selectedStructure}
                className="h-9 px-6 bg-cyan-500/20 border border-cyan-500/60 text-cyan-300 hover:bg-cyan-500/30 hover:text-cyan-200 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-all duration-200 text-sm font-medium shadow-sm"
                title="Execute operation"
              >
                <Play className="w-4 h-4 mr-2" />
                Execute
              </Button>
            </div>
          </div>


        </div>
      </div>
    </div>
  );
} 