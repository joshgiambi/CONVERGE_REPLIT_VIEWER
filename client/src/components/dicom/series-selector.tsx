import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { List, Settings, Monitor, Palette } from 'lucide-react';
import { DICOMSeries, WindowLevel, WINDOW_LEVEL_PRESETS } from '@/lib/dicom-utils';

interface SeriesSelectorProps {
  series: DICOMSeries[];
  selectedSeries: DICOMSeries | null;
  onSeriesSelect: (series: DICOMSeries) => void;
  windowLevel: WindowLevel;
  onWindowLevelChange: (windowLevel: WindowLevel) => void;
  studyId?: number;
  rtStructures?: any;
  onRTStructureLoad?: (rtStructures: any) => void;
  onStructureVisibilityChange?: (structureId: number, visible: boolean) => void;
  onStructureColorChange?: (structureId: number, color: [number, number, number]) => void;
}

export function SeriesSelector({
  series,
  selectedSeries,
  onSeriesSelect,
  windowLevel,
  onWindowLevelChange,
  studyId,
  rtStructures,
  onRTStructureLoad,
  onStructureVisibilityChange,
  onStructureColorChange
}: SeriesSelectorProps) {
  const [rtSeries, setRTSeries] = useState<any[]>([]);
  const [selectedRTSeries, setSelectedRTSeries] = useState<any>(null);
  const [structureVisibility, setStructureVisibility] = useState<Map<number, boolean>>(new Map());
  // Load RT structure series for the study
  useEffect(() => {
    if (!studyId) return;
    
    const loadRTSeries = async () => {
      try {
        const response = await fetch(`/api/studies/${studyId}/rt-structures`);
        if (response.ok) {
          const rtSeriesData = await response.json();
          setRTSeries(rtSeriesData);
        }
      } catch (error) {
        console.error('Error loading RT series:', error);
      }
    };
    
    loadRTSeries();
  }, [studyId]);

  // Initialize structure visibility when RT structures are loaded
  useEffect(() => {
    if (rtStructures?.structures) {
      const visibilityMap = new Map();
      rtStructures.structures.forEach((structure: any) => {
        visibilityMap.set(structure.roiNumber, true);
      });
      setStructureVisibility(visibilityMap);
    }
  }, [rtStructures]);

  const handleRTSeriesSelect = async (rtSeries: any) => {
    try {
      setSelectedRTSeries(rtSeries);
      
      // Load RT structure contours
      const response = await fetch(`/api/rt-structures/${rtSeries.id}/contours`);
      if (response.ok) {
        const rtStructData = await response.json();
        if (onRTStructureLoad) {
          onRTStructureLoad(rtStructData);
        }
      }
    } catch (error) {
      console.error('Error loading RT structures:', error);
    }
  };

  const handleStructureVisibilityToggle = (structureId: number) => {
    const newVisibility = !structureVisibility.get(structureId);
    setStructureVisibility(prev => new Map(prev.set(structureId, newVisibility)));
    if (onStructureVisibilityChange) {
      onStructureVisibilityChange(structureId, newVisibility);
    }
  };

  const handleWindowChange = (values: number[]) => {
    onWindowLevelChange({ window: values[0], level: windowLevel.level });
  };

  const handleLevelChange = (values: number[]) => {
    onWindowLevelChange({ window: windowLevel.window, level: values[0] });
  };

  const applyPreset = (preset: WindowLevel) => {
    onWindowLevelChange(preset);
  };

  return (
    <Card className="h-full bg-dicom-dark/60 backdrop-blur-md border border-dicom-indigo/30 rounded-2xl overflow-hidden animate-slide-up">
      <div className="p-6 h-full flex flex-col">
        <h3 className="text-xl font-bold text-dicom-purple mb-6 flex items-center">
          <List className="w-6 h-6 mr-3 text-dicom-indigo" />
          Series
        </h3>
        
        {/* Series List */}
        <div className="flex-1 space-y-2 mb-6 overflow-y-auto">
          {series.map((seriesItem) => (
            <div
              key={seriesItem.id}
              className={`
                p-3 rounded-lg border cursor-pointer transition-all duration-200
                ${selectedSeries?.id === seriesItem.id
                  ? 'border-dicom-purple bg-dicom-purple/20 border-l-4'
                  : 'border-dicom-gray hover:border-dicom-purple/50 hover:bg-dicom-purple/10 hover:translate-x-1'
                }
              `}
              onClick={() => onSeriesSelect(seriesItem)}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium text-sm text-white">
                  {seriesItem.seriesDescription || 'Unnamed Series'}
                </span>
                <Badge 
                  variant="secondary" 
                  className="bg-dicom-purple text-white text-xs"
                >
                  {seriesItem.modality}
                </Badge>
              </div>
              <div className="text-xs text-gray-400 space-y-1">
                <div>{seriesItem.imageCount} images</div>
                {seriesItem.sliceThickness && (
                  <div>{seriesItem.sliceThickness}mm slice</div>
                )}
              </div>
            </div>
          ))}
          
          {series.length === 0 && (
            <div className="text-center text-gray-400 py-8">
              <p>No series available</p>
              <p className="text-sm">Upload DICOM files to get started</p>
            </div>
          )}
        </div>

        {/* Window/Level Controls */}
        {selectedSeries && (
          <div className="border-t border-dicom-gray pt-4">
            <h4 className="text-sm font-semibold text-dicom-yellow mb-3 flex items-center">
              <Settings className="w-4 h-4 mr-2" />
              Window/Level
            </h4>
            
            <div className="space-y-4">
              <div>
                <label className="text-xs text-gray-400 block mb-2">
                  Window Width: {windowLevel.window}
                </label>
                <Slider
                  value={[windowLevel.window]}
                  onValueChange={handleWindowChange}
                  min={1}
                  max={2000}
                  step={1}
                  className="w-full"
                />
              </div>
              
              <div>
                <label className="text-xs text-gray-400 block mb-2">
                  Window Level: {windowLevel.level}
                </label>
                <Slider
                  value={[windowLevel.level]}
                  onValueChange={handleLevelChange}
                  min={-1000}
                  max={1000}
                  step={1}
                  className="w-full"
                />
              </div>
            </div>
            
            {/* Preset Buttons */}
            <div className="mt-4">
              <h5 className="text-xs text-gray-400 mb-2">Presets</h5>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(WINDOW_LEVEL_PRESETS).map(([name, preset]) => (
                  <Button
                    key={name}
                    variant="outline"
                    size="sm"
                    className="text-xs bg-dicom-darker border-dicom-gray hover:bg-dicom-gray hover:border-dicom-yellow text-white transition-all duration-200 hover:scale-105"
                    onClick={() => applyPreset(preset)}
                  >
                    {name.charAt(0).toUpperCase() + name.slice(1)}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
