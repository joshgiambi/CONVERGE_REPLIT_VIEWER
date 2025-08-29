import React, { useState, useEffect, useRef } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Minimize2, Maximize2, Layers, Settings2, X, Brain } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';



interface FusionControlPanelProps {
  primarySeriesId: number; // CT series
  studyId: number;
  onSecondarySeriesSelect: (seriesId: number | null) => void;
  opacity: number;
  onOpacityChange: (opacity: number) => void;
  isVisible: boolean;
  mriWindowLevel?: { width: number; center: number };
  onMriWindowLevelChange?: (windowLevel: { width: number; center: number }) => void;
  selectedSecondaryId?: number | null;
  primaryModality?: string;
  availableModalities?: string[];
}

export function FusionControlPanel({
  primarySeriesId,
  studyId,
  onSecondarySeriesSelect,
  opacity,
  onOpacityChange,
  isVisible,
  mriWindowLevel = { width: 800, center: 400 },
  onMriWindowLevelChange,
  selectedSecondaryId,
  primaryModality = 'CT',
  availableModalities = []
}: FusionControlPanelProps) {
  const [isMinimized, setIsMinimized] = useState(true); // Start minimized
  
  // Fetch available MR series for fusion
  const { data: availableSeries } = useQuery({
    queryKey: [`/api/studies/${studyId}/series`],
    enabled: !!studyId
  });
  
  // Filter for MR series only
  const mrSeries = (availableSeries as any[])?.filter((s: any) => s.modality === 'MR') || [];
  
  // Get primary series info
  const primarySeries = (availableSeries as any[])?.find((s: any) => s.id === primarySeriesId);
  const actualPrimaryModality = primarySeries?.modality || primaryModality || 'CT';
  
  // Determine secondary modality label
  const secondaryModality = mrSeries.length > 0 ? 'MR' : 'Secondary';
  
  // Auto-select first MR series with valid slice locations (only on initial mount)
  // Use a ref to track if we've already auto-selected
  const hasAutoSelected = useRef(false);
  
  useEffect(() => {
    if (mrSeries.length > 0 && selectedSecondaryId === null && !hasAutoSelected.current) {
      // Prefer series with description containing "AX T1 FS+C" as it has better slice locations
      const preferredSeries = mrSeries.find((s: any) => 
        s.seriesDescription && s.seriesDescription.includes('AX T1 FS+C')
      );
      
      const seriestoSelect = preferredSeries || mrSeries[0];
      console.log(`Auto-selecting MR series: ${seriestoSelect.id} - ${seriestoSelect.seriesDescription || 'No description'}`);
      
      hasAutoSelected.current = true;
      onSecondarySeriesSelect(seriestoSelect.id);
    }
  }, [mrSeries]); // Remove selectedSecondaryId from dependencies to prevent re-selection
  
  const handleSecondarySelect = (value: string) => {
    const seriesId = value === 'none' ? null : parseInt(value);
    onSecondarySeriesSelect(seriesId);
  };
  
  const handleOpacityChange = (values: number[]) => {
    const newValue = values[0];
    if (typeof newValue === 'number' && !isNaN(newValue)) {
      // Clamp to ensure we stay within bounds
      const clampedValue = Math.max(0, Math.min(1, newValue));
      onOpacityChange(clampedValue);
    }
  };
  
  if (!isVisible) return null;
  
  // Minimized view - with floating MRI selection buttons
  if (isMinimized) {
    return (
      <div className="fixed bottom-4 right-8 z-50 flex flex-col items-end gap-3">
        {/* Floating MRI selection buttons */}
        <div className="flex gap-2">
          {mrSeries.map((series: any, index: number) => (
            <button
              key={series.id}
              onClick={() => handleSecondarySelect(series.id.toString())}
              className={`
                group relative p-3 rounded-2xl transition-all duration-300
                ${selectedSecondaryId === series.id
                  ? 'bg-gradient-to-br from-purple-500/30 to-purple-600/30 backdrop-blur-xl border-2 border-purple-400/60 shadow-lg shadow-purple-500/30'
                  : 'bg-black/40 backdrop-blur-md border border-purple-500/30 hover:bg-purple-900/30 hover:border-purple-400/50 hover:shadow-md hover:shadow-purple-500/20'
                }
              `}
            >
              <Brain className={`w-5 h-5 ${selectedSecondaryId === series.id ? 'text-purple-300' : 'text-purple-400'}`} />
              <div className="absolute -top-1 -right-1">
                <span className={`
                  text-[10px] font-bold px-1.5 py-0.5 rounded-full
                  ${selectedSecondaryId === series.id 
                    ? 'bg-purple-400 text-black' 
                    : 'bg-purple-600/50 text-purple-200'
                  }
                `}>
                  {index + 1}
                </span>
              </div>
              {selectedSecondaryId === series.id && (
                <div className="absolute -bottom-1 left-1/2 transform -translate-x-1/2">
                  <div className="w-2 h-2 bg-purple-400 rounded-full animate-pulse" />
                </div>
              )}
              {/* Tooltip */}
              <div className="absolute bottom-full mb-2 left-1/2 transform -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap">
                <div className="bg-gradient-to-br from-purple-600/90 to-purple-700/90 backdrop-blur-xl text-white text-xs px-2 py-1 rounded-lg border border-purple-400/30">
                  MR {index + 1} ({series.imageCount} images)
                </div>
              </div>
            </button>
          ))}
          
          {/* No fusion button */}
          {selectedSecondaryId !== null && (
            <button
              onClick={() => handleSecondarySelect('none')}
              className="group relative p-3 rounded-2xl bg-black/40 backdrop-blur-md border border-gray-500/30 hover:bg-gray-800/30 hover:border-gray-400/50 transition-all duration-300"
            >
              <X className="w-5 h-5 text-gray-400" />
              {/* Tooltip */}
              <div className="absolute bottom-full mb-2 left-1/2 transform -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap">
                <div className="bg-gradient-to-br from-gray-600/90 to-gray-700/90 backdrop-blur-xl text-white text-xs px-2 py-1 rounded-lg border border-gray-400/30">
                  Disable Fusion
                </div>
              </div>
            </button>
          )}
        </div>
        
        {/* Opacity control bar */}
        <div className="bg-gradient-to-br from-black/60 to-black/40 backdrop-blur-xl border border-purple-500/30 rounded-2xl p-3 shadow-lg shadow-purple-900/20">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsMinimized(false)}
              className="h-6 w-6 text-purple-400 hover:text-purple-300 hover:bg-purple-500/20"
            >
              <Maximize2 className="h-4 w-4" />
            </Button>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[10px] border-gray-500/30 bg-gray-900/50 backdrop-blur text-gray-300 px-1.5 py-0">
                {actualPrimaryModality}
              </Badge>
              <div className="w-32 relative py-2">
                <Slider
                  value={[opacity]}
                  onValueChange={handleOpacityChange}
                  min={0}
                  max={1}
                  step={0.01}
                  className="w-full cursor-pointer"
                  onPointerDown={(e) => e.stopPropagation()}
                  onPointerMove={(e) => e.stopPropagation()}
                />
              </div>
              <Badge variant="outline" className="text-[10px] border-purple-500/30 bg-purple-900/50 backdrop-blur text-purple-300 px-1.5 py-0">
                {secondaryModality}
              </Badge>
            </div>
            <span className="text-xs text-purple-300 min-w-[6ch] font-medium">
              {actualPrimaryModality} {Math.round((1 - opacity) * 100)}%
            </span>
          </div>
        </div>
      </div>
    );
  }
  
  // Expanded view with enhanced glassmorphic design
  return (
    <div className="fixed bottom-4 right-8 z-50">
      <Card className="bg-gradient-to-br from-black/70 to-purple-900/20 backdrop-blur-xl border border-purple-500/40 p-4 w-80 shadow-2xl shadow-purple-900/30">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-gradient-to-br from-purple-500/30 to-purple-600/30 rounded-lg backdrop-blur">
              <Layers className="h-4 w-4 text-purple-300" />
            </div>
            <span className="text-sm font-semibold text-white">Image Fusion Control</span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsMinimized(true)}
            className="h-7 w-7 text-purple-300 hover:text-purple-200 hover:bg-purple-500/20 rounded-lg"
          >
            <Minimize2 className="h-4 w-4" />
          </Button>
        </div>
        
        {/* Content */}
        <div className="space-y-4">
          {/* MR Series Selection Grid */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-gray-300 font-medium">Select Fusion Series</Label>
              <Badge className="bg-purple-600/20 backdrop-blur border-purple-400/30 text-purple-200 text-xs">
                {mrSeries.length} available
              </Badge>
            </div>
            
            {/* Simplified grid layout */}
            <div className="grid grid-cols-4 gap-2">
              {mrSeries.map((series: any, index: number) => (
                <button
                  key={series.id}
                  onClick={() => handleSecondarySelect(series.id.toString())}
                  className={`
                    relative p-3 rounded-xl transition-all duration-300 group
                    ${selectedSecondaryId === series.id
                      ? 'bg-gradient-to-br from-purple-500/40 to-purple-600/40 backdrop-blur-xl border-2 border-purple-400/60 shadow-lg shadow-purple-500/30 scale-105'
                      : 'bg-black/30 backdrop-blur border border-purple-600/30 hover:bg-purple-900/30 hover:border-purple-500/50 hover:shadow-md hover:shadow-purple-500/20'
                    }
                  `}
                >
                  <Brain className={`w-6 h-6 mx-auto mb-1 ${selectedSecondaryId === series.id ? 'text-purple-200' : 'text-purple-400'}`} />
                  <p className="text-[10px] text-purple-200 font-semibold">
                    MR {index + 1}
                  </p>
                  {selectedSecondaryId === series.id && (
                    <div className="absolute -bottom-1 left-1/2 transform -translate-x-1/2">
                      <div className="w-2 h-2 bg-purple-400 rounded-full animate-pulse" />
                    </div>
                  )}
                </button>
              ))}
              
              {/* No fusion option */}
              <button
                onClick={() => handleSecondarySelect('none')}
                className={`
                  relative p-3 rounded-xl transition-all duration-300
                  ${selectedSecondaryId === null
                    ? 'bg-gradient-to-br from-gray-500/40 to-gray-600/40 backdrop-blur-xl border-2 border-gray-400/60 shadow-lg shadow-gray-500/30 scale-105'
                    : 'bg-black/30 backdrop-blur border border-gray-600/30 hover:bg-gray-800/30 hover:border-gray-500/50'
                  }
                `}
              >
                <X className={`w-6 h-6 mx-auto mb-1 ${selectedSecondaryId === null ? 'text-gray-200' : 'text-gray-400'}`} />
                <p className="text-[10px] text-gray-300 font-semibold">None</p>
                {selectedSecondaryId === null && (
                  <div className="absolute -bottom-1 left-1/2 transform -translate-x-1/2">
                    <div className="w-2 h-2 bg-gray-400 rounded-full" />
                  </div>
                )}
              </button>
            </div>
          </div>
          
          {/* Opacity Control */}
          {selectedSecondaryId && (
            <div className="space-y-3 p-3 bg-black/20 backdrop-blur rounded-xl border border-purple-500/20">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-white font-medium">Fusion Balance</Label>
                <div className="flex gap-1">
                  <Badge className="bg-gray-600/30 backdrop-blur text-gray-200 text-[10px] px-2 py-0">
                    CT: {Math.round((1 - opacity) * 100)}%
                  </Badge>
                  <Badge className="bg-purple-600/30 backdrop-blur text-purple-200 text-[10px] px-2 py-0">
                    MRI: {Math.round(opacity * 100)}%
                  </Badge>
                </div>
              </div>
              <div className="relative py-2">
                <Slider
                  value={[opacity]}
                  onValueChange={handleOpacityChange}
                  min={0}
                  max={1}
                  step={0.01}
                  className="w-full cursor-pointer"
                  onPointerDown={(e) => e.stopPropagation()}
                  onPointerMove={(e) => e.stopPropagation()}
                />
              </div>
            </div>
          )}
          
          {/* MRI Window/Level Presets */}
          {selectedSecondaryId && (
            <div className="space-y-2 p-3 bg-purple-900/20 backdrop-blur rounded-xl border border-purple-500/20">
              <div className="flex items-center justify-between mb-2">
                <Label className="text-xs text-white font-medium">MRI Enhancement</Label>
                <Settings2 className="h-3 w-3 text-purple-400" />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onMriWindowLevelChange?.({ width: 0, center: 0 })}
                  className="text-xs h-8 bg-purple-600/20 backdrop-blur border-purple-400/30 hover:bg-purple-600/30 hover:border-purple-400/50 text-purple-200"
                >
                  Auto
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onMriWindowLevelChange?.({ width: 1200, center: 600 })}
                  className="text-xs h-8 bg-purple-600/20 backdrop-blur border-purple-400/30 hover:bg-purple-600/30 hover:border-purple-400/50 text-purple-200"
                >
                  Brain
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onMriWindowLevelChange?.({ width: 1500, center: 750 })}
                  className="text-xs h-8 bg-purple-600/20 backdrop-blur border-purple-400/30 hover:bg-purple-600/30 hover:border-purple-400/50 text-purple-200"
                >
                  Enhanced
                </Button>
              </div>
              <p className="text-[10px] text-purple-300 mt-2">
                Right-click + drag to manually adjust window/level
              </p>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}