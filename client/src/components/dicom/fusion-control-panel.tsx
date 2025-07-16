import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Minimize2, Maximize2, Layers } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

interface FusionControlPanelProps {
  primarySeriesId: number; // CT series
  studyId: number;
  onSecondarySeriesSelect: (seriesId: number | null) => void;
  opacity: number;
  onOpacityChange: (opacity: number) => void;
  isVisible: boolean;
}

export function FusionControlPanel({
  primarySeriesId,
  studyId,
  onSecondarySeriesSelect,
  opacity,
  onOpacityChange,
  isVisible
}: FusionControlPanelProps) {
  const [isMinimized, setIsMinimized] = useState(true); // Start minimized
  const [selectedSecondaryId, setSelectedSecondaryId] = useState<number | null>(null);
  
  // Fetch available MR series for fusion
  const { data: availableSeries } = useQuery({
    queryKey: [`/api/studies/${studyId}/series`],
    enabled: !!studyId
  });
  
  // Filter for MR series only
  const mrSeries = availableSeries?.filter((s: any) => s.modality === 'MR') || [];
  
  // Auto-select first MR series when available
  useEffect(() => {
    if (mrSeries.length > 0 && !selectedSecondaryId) {
      const firstMRSeries = mrSeries[0];
      setSelectedSecondaryId(firstMRSeries.id);
      onSecondarySeriesSelect(firstMRSeries.id);
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
  
  // Expanded view
  return (
    <div className="fixed bottom-4 right-4 z-50">
      <Card className="bg-black/90 backdrop-blur-sm border-purple-500/50 p-4 w-80">
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
        
        {/* MR Series Selector */}
        <div className="space-y-3">
          <div className="space-y-2">
            <Label className="text-xs text-gray-300">MR Series</Label>
            <Select value={selectedSecondaryId?.toString() || 'none'} onValueChange={handleSecondarySelect}>
              <SelectTrigger className="h-8 bg-black/50 border-purple-500/30 text-sm">
                <SelectValue placeholder="Select MR series" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {mrSeries.map((series: any) => (
                  <SelectItem key={series.id} value={series.id.toString()}>
                    <div className="flex items-center justify-between w-full">
                      <span className="truncate max-w-[200px]">
                        {series.seriesDescription || 'MR Series'}
                      </span>
                      <span className="text-xs text-gray-400 ml-2">
                        ({series.imageCount})
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          {/* Quick swap buttons for multiple MR series */}
          {mrSeries.length > 1 && selectedSecondaryId && (
            <div className="flex gap-2">
              {mrSeries.map((series: any, index: number) => (
                <Button
                  key={series.id}
                  variant={selectedSecondaryId === series.id ? "default" : "outline"}
                  size="sm"
                  onClick={() => handleSecondarySelect(series.id.toString())}
                  className={`flex-1 text-xs h-7 ${
                    selectedSecondaryId === series.id 
                      ? 'bg-purple-600 border-purple-500' 
                      : 'bg-purple-600/20 border-purple-500/50 hover:bg-purple-600/30'
                  }`}
                >
                  MR{index + 1}
                </Button>
              ))}
            </div>
          )}
          
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
        </div>
      </Card>
    </div>
  );
}