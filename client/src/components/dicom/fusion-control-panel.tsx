import React, { useState, useEffect, useRef } from 'react';
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
  
  // Fetch available series from all studies for fusion (cross-study registration support)
  const { data: allStudies } = useQuery({
    queryKey: ['/api/studies'],
    enabled: true
  });

  // Get current patient's studies only to limit cross-study search to same patient
  const { data: currentStudy } = useQuery({
    queryKey: [`/api/studies/${studyId}`],
    enabled: !!studyId
  });

  // Fetch all series from all studies belonging to the same patient
  const patientStudies = allStudies?.filter((study: any) => 
    study.patientId === currentStudy?.patientId
  ) || [];

  const { data: allPatientSeries } = useQuery({
    queryKey: ['patient-series', currentStudy?.patientId],
    queryFn: async () => {
      if (!patientStudies.length) return [];
      
      const seriesPromises = patientStudies.map((study: any) =>
        fetch(`/api/studies/${study.id}/series`).then(res => res.json())
      );
      
      const allSeriesArrays = await Promise.all(seriesPromises);
      return allSeriesArrays.flat();
    },
    enabled: patientStudies.length > 0
  });

  const availableSeries = allPatientSeries || [];
  
  // Filter for fusion-compatible series (MR and PET)
  const fusionSeries = (availableSeries as any[])?.filter((s: any) => 
    s.modality === 'MR' || s.modality === 'PT'
  ) || [];
  
  // Get primary series info
  const primarySeries = (availableSeries as any[])?.find((s: any) => s.id === primarySeriesId);
  const actualPrimaryModality = primarySeries?.modality || primaryModality || 'CT';
  
  // Determine secondary modality label based on available fusion series
  const secondaryModality = fusionSeries.length > 0 ? 
    (fusionSeries.find(s => s.modality === 'PT') ? 'PET' : 'MR') : 'Secondary';
  
  // Auto-select first fusion series with valid slice locations (only on initial mount)
  // Use a ref to track if we've already auto-selected
  const hasAutoSelected = useRef(false);
  
  useEffect(() => {
    if (fusionSeries.length > 0 && selectedSecondaryId === null && !hasAutoSelected.current) {
      // For MR: prefer series with description containing "AX T1 FS+C" as it has better slice locations
      // For PET: prefer the first available PET series
      let preferredSeries;
      const petSeries = fusionSeries.find((s: any) => s.modality === 'PT');
      const mrSeries = fusionSeries.filter((s: any) => s.modality === 'MR');
      
      if (petSeries) {
        // PET-CT fusion: auto-select PET series
        preferredSeries = petSeries;
        console.log(`Auto-selecting PET series for CT-PET fusion: ${preferredSeries.id} - ${preferredSeries.seriesDescription || 'No description'}`);
      } else if (mrSeries.length > 0) {
        // MR-CT fusion: prefer specific MR sequence
        preferredSeries = mrSeries.find((s: any) => 
          s.seriesDescription && s.seriesDescription.includes('AX T1 FS+C')
        ) || mrSeries[0];
        console.log(`Auto-selecting MR series for CT-MR fusion: ${preferredSeries.id} - ${preferredSeries.seriesDescription || 'No description'}`);
      } else {
        preferredSeries = fusionSeries[0];
      }
      
      hasAutoSelected.current = true;
      onSecondarySeriesSelect(preferredSeries.id);
    }
  }, [fusionSeries]); // Updated to use fusionSeries instead of mrSeries
  
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
  
  // Minimized view - just opacity slider
  if (isMinimized) {
    return (
      <div className="fixed bottom-6 right-8 z-50">
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
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[10px] border-gray-500/50 text-gray-300 px-1.5 py-0">
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
              <Badge variant="outline" className="text-[10px] border-purple-500/50 text-purple-300 px-1.5 py-0">
                {secondaryModality}
              </Badge>
            </div>
            <span className="text-xs text-purple-300 min-w-[6ch]">
              {actualPrimaryModality} {Math.round((1 - opacity) * 100)}%
            </span>
          </div>
        </Card>
      </div>
    );
  }
  
  // Expanded view with thumbnails
  return (
    <div className="fixed bottom-6 right-8 z-50">
      <Card className="bg-black/90 backdrop-blur-sm border-purple-500/50 p-3 w-80">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
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
                {fusionSeries.length} {secondaryModality} series
              </Badge>
            </div>
            
            {/* Fusion Series Buttons - Compact Grid */}
            <div className="grid grid-cols-3 gap-2">
              {fusionSeries.map((series: any, index: number) => (
                <button
                  key={series.id}
                  onClick={() => handleSecondarySelect(series.id.toString())}
                  className={`
                    p-2 rounded-lg border-2 transition-all flex flex-col items-center
                    ${selectedSecondaryId === series.id
                      ? 'border-purple-400 bg-purple-500/20 shadow-lg shadow-purple-500/20'
                      : 'border-purple-600/30 bg-purple-900/10 hover:border-purple-500/50 hover:bg-purple-500/10'
                    }
                  `}
                >
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-600/30 to-purple-500/30 flex items-center justify-center mb-1">
                    <Layers className="w-4 h-4 text-purple-300" />
                  </div>
                  <p className="text-xs text-purple-200 font-medium">
                    {secondaryModality} {index + 1}
                  </p>
                  <p className="text-[10px] text-purple-400">
                    {series.imageCount} imgs
                  </p>
                  {selectedSecondaryId === series.id && (
                    <div className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-pulse mt-1" />
                  )}
                </button>
              ))}
              
              {/* No fusion option */}
              <button
                onClick={() => handleSecondarySelect('none')}
                className={`
                  p-2 rounded-lg border-2 transition-all flex flex-col items-center
                  ${selectedSecondaryId === null
                    ? 'border-gray-400 bg-gray-500/20'
                    : 'border-gray-600/30 bg-gray-900/10 hover:border-gray-500/50 hover:bg-gray-500/10'
                  }
                `}
              >
                <div className="w-8 h-8 rounded-lg bg-gray-700/30 flex items-center justify-center mb-1">
                  <X className="w-4 h-4 text-gray-400" />
                </div>
                <p className="text-xs text-gray-300 font-medium">None</p>
                <p className="text-[10px] text-gray-500">CT only</p>
                {selectedSecondaryId === null && (
                  <div className="w-1.5 h-1.5 bg-gray-400 rounded-full mt-1" />
                )}
              </button>
            </div>
          </div>
          

          
          {/* Opacity Control */}
          {selectedSecondaryId && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-gray-300">Fusion Balance</Label>
                <span className="text-xs text-purple-300">
                  CT: {Math.round((1 - opacity) * 100)}% | MRI: {Math.round(opacity * 100)}%
                </span>
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
              <div className="flex justify-between text-xs">
                <Badge variant="outline" className="text-[10px] border-gray-500/50 text-gray-300 px-2 py-0">
                  100% CT
                </Badge>
                <span className="text-gray-400">50/50</span>
                <Badge variant="outline" className="text-[10px] border-purple-500/50 text-purple-300 px-2 py-0">
                  100% MRI
                </Badge>
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