import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Minimize2, Maximize2, Layers, Settings2, X } from 'lucide-react';
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
}

export function FusionControlPanel({
  primarySeriesId,
  studyId,
  onSecondarySeriesSelect,
  opacity,
  onOpacityChange,
  isVisible,
  mriWindowLevel = { width: 800, center: 400 },
  onMriWindowLevelChange
}: FusionControlPanelProps) {
  const [isMinimized, setIsMinimized] = useState(true); // Start minimized
  const [selectedSecondaryId, setSelectedSecondaryId] = useState<number | null>(null);
  
  // Fetch available MR series for fusion
  const { data: availableSeries } = useQuery({
    queryKey: [`/api/studies/${studyId}/series`],
    enabled: !!studyId
  });
  
  // Filter for MR series only
  const mrSeries = (availableSeries as any[])?.filter((s: any) => s.modality === 'MR') || [];
  
  // Auto-select first MR series with valid slice locations
  useEffect(() => {
    if (mrSeries.length > 0 && !selectedSecondaryId) {
      // Prefer series with description containing "AX T1 FS+C" as it has better slice locations
      const preferredSeries = mrSeries.find((s: any) => 
        s.seriesDescription && s.seriesDescription.includes('AX T1 FS+C')
      );
      
      const seriestoSelect = preferredSeries || mrSeries[0];
      console.log(`Auto-selecting MR series: ${seriestoSelect.id} - ${seriestoSelect.seriesDescription || 'No description'}`);
      
      setSelectedSecondaryId(seriestoSelect.id);
      onSecondarySeriesSelect(seriestoSelect.id);
    }
  }, [mrSeries, selectedSecondaryId]);
  
  const handleSecondarySelect = (value: string) => {
    const seriesId = value === 'none' ? null : parseInt(value);
    setSelectedSecondaryId(seriesId);
    onSecondarySeriesSelect(seriesId);
  };
  
  const handleOpacityChange = (values: number[]) => {
    onOpacityChange(values[0]);
  };
  
  if (!isVisible) return null;
  
  // Minimized view - just opacity slider
  if (isMinimized) {
    return (
      <div className="fixed bottom-4 right-4 z-50">
        <Card className="bg-black/80 backdrop-blur-sm border-purple-500/50 p-3">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsMinimized(false)}
              className="h-6 w-6 text-purple-400 hover:text-purple-300"
            >
              <Maximize2 className="h-4 w-4" />
            </Button>
            <div className="w-32">
              <Slider
                value={[opacity]}
                onValueChange={handleOpacityChange}
                min={0}
                max={1}
                step={0.05}
                className="w-full"
              />
            </div>
            <span className="text-xs text-purple-300 min-w-[3ch]">
              {Math.round(opacity * 100)}%
            </span>
          </div>
        </Card>
      </div>
    );
  }
  
  // Expanded view with thumbnails
  return (
    <div className="fixed bottom-4 right-4 z-50">
      <Card className="bg-black/90 backdrop-blur-sm border-purple-500/50 p-4 w-96">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-purple-400" />
            <span className="text-sm font-medium text-purple-300">Image Fusion</span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsMinimized(true)}
            className="h-6 w-6 text-purple-400 hover:text-purple-300"
          >
            <Minimize2 className="h-4 w-4" />
          </Button>
        </div>
        
        {/* Thumbnail MR Series Selector */}
        <div className="space-y-3">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-gray-300">Available Fusion Series</Label>
              <Badge variant="outline" className="text-xs border-purple-500/50 text-purple-300">
                {mrSeries.length} MR series
              </Badge>
            </div>
            
            {/* Thumbnail Grid */}
            <div className="grid grid-cols-3 gap-2">
              {mrSeries.map((series: any, index: number) => (
                <button
                  key={series.id}
                  onClick={() => handleSecondarySelect(series.id.toString())}
                  className={`
                    relative p-1 rounded-lg border-2 transition-all
                    ${selectedSecondaryId === series.id
                      ? 'border-purple-400 bg-purple-500/20 scale-105 shadow-lg shadow-purple-500/20'
                      : 'border-purple-600/30 bg-purple-900/10 hover:border-purple-500/50 hover:bg-purple-500/10'
                    }
                  `}
                >
                  {/* Placeholder thumbnail */}
                  <div className="w-full aspect-square bg-gradient-to-br from-purple-900/20 to-purple-800/20 rounded flex items-center justify-center">
                    <Layers className="w-8 h-8 text-purple-500/50" />
                  </div>
                  <div className="mt-1 px-1">
                    <p className="text-xs text-purple-200 truncate font-medium">
                      MR {index + 1}
                    </p>
                    <p className="text-xs text-purple-400">
                      {series.imageCount} imgs
                    </p>
                  </div>
                  {selectedSecondaryId === series.id && (
                    <div className="absolute top-1 right-1 w-2 h-2 bg-purple-400 rounded-full animate-pulse" />
                  )}
                </button>
              ))}
              
              {/* No fusion option */}
              <button
                onClick={() => handleSecondarySelect('none')}
                className={`
                  relative p-1 rounded-lg border-2 transition-all
                  ${selectedSecondaryId === null
                    ? 'border-gray-400 bg-gray-500/20'
                    : 'border-gray-600/30 bg-gray-900/10 hover:border-gray-500/50 hover:bg-gray-500/10'
                  }
                `}
              >
                <div className="w-full aspect-square bg-gray-900/20 rounded flex items-center justify-center">
                  <X className="w-8 h-8 text-gray-500/50" />
                </div>
                <div className="mt-1 px-1">
                  <p className="text-xs text-gray-400 font-medium">No Fusion</p>
                </div>
              </button>
            </div>
          </div>
          

          
          {/* Opacity Control */}
          {selectedSecondaryId && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-gray-300">Opacity</Label>
                <span className="text-xs text-purple-300">
                  {Math.round(opacity * 100)}%
                </span>
              </div>
              <Slider
                value={[opacity]}
                onValueChange={handleOpacityChange}
                min={0}
                max={1}
                step={0.05}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-gray-400">
                <span>CT</span>
                <span>50/50</span>
                <span>MR</span>
              </div>
            </div>
          )}
          
          {/* MRI Window/Level Controls */}
          {selectedSecondaryId && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-gray-300">MRI Window/Level</Label>
                <span className="text-xs text-purple-300">
                  W: {Math.round(mriWindowLevel.width)} C: {Math.round(mriWindowLevel.center)}
                </span>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onMriWindowLevelChange?.({ width: 0, center: 0 })}
                  className="flex-1 text-xs h-7 bg-purple-600/20 border-purple-500/50 hover:bg-purple-600/30"
                >
                  Auto
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onMriWindowLevelChange?.({ width: 1200, center: 600 })}
                  className="flex-1 text-xs h-7 bg-purple-600/20 border-purple-500/50 hover:bg-purple-600/30"
                >
                  Brain
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onMriWindowLevelChange?.({ width: 1500, center: 750 })}
                  className="flex-1 text-xs h-7 bg-purple-600/20 border-purple-500/50 hover:bg-purple-600/30"
                >
                  Enhanced
                </Button>
              </div>
            </div>
          )}
          
          {/* Window/Level Note */}
          {selectedSecondaryId && (
            <div className="mt-3 p-2 bg-purple-900/20 rounded-lg border border-purple-500/30">
              <div className="flex items-center gap-2 text-xs text-purple-300">
                <Settings2 className="h-3 w-3" />
                <span>Tip: Right-click + drag adjusts MR window/level in fusion mode</span>
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}