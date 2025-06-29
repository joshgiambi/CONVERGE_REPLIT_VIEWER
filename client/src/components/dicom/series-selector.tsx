import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Layers3, Palette, Settings } from 'lucide-react';
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
      console.error('Error loading RT structure contours:', error);
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
    <div className="h-full flex flex-col space-y-4">
      {/* Main Series and Structures Panel */}
      <Card className="flex-1 bg-dicom-dark/60 backdrop-blur-md border border-dicom-indigo/30 rounded-2xl overflow-hidden animate-slide-up">
        <CardContent className="p-0 h-full flex flex-col">
          <div className="flex-1 overflow-hidden">
            <Accordion type="multiple" defaultValue={["series"]} className="h-full flex flex-col">
            
            {/* Series Section */}
            <AccordionItem value="series" className="border-dicom-indigo/30">
              <AccordionTrigger className="px-6 py-3 hover:no-underline hover:bg-blue-500/10">
                <div className="flex items-center text-blue-400 font-medium text-sm">
                  <Layers3 className="w-4 h-4 mr-2 text-blue-400" />
                  Series
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-6 pb-4">
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {series.filter(s => s.modality !== 'RTSTRUCT').map((seriesItem) => (
                    <div key={seriesItem.id}>
                      <div
                        className={`
                          p-2 rounded-lg border cursor-pointer transition-all duration-200
                          ${selectedSeries?.id === seriesItem.id
                            ? 'bg-blue-500/20 border-blue-500 shadow-lg'
                            : 'bg-blue-500/5 border-blue-500/30 hover:border-blue-500/50 hover:bg-blue-500/10'
                          }
                        `}
                        onClick={() => onSeriesSelect(seriesItem)}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <Badge 
                            variant="outline" 
                            className={`
                              text-xs font-semibold
                              ${selectedSeries?.id === seriesItem.id
                                ? 'border-blue-400 text-blue-400'
                                : 'border-blue-500 text-blue-500'
                              }
                            `}
                          >
                            {seriesItem.modality}
                          </Badge>
                          <span className="text-xs text-gray-400">
                            {seriesItem.imageCount} images
                          </span>
                        </div>
                        
                        <h4 className={`
                          text-sm font-medium truncate
                          ${selectedSeries?.id === seriesItem.id ? 'text-blue-400' : 'text-white'}
                        `}>
                          {seriesItem.seriesDescription || `Series ${seriesItem.seriesNumber}`}
                        </h4>
                      </div>

                      {/* RT Structure Series nested under CT */}
                      {selectedSeries?.id === seriesItem.id && rtSeries.length > 0 && (
                        <div className="ml-2 mt-1 space-y-1 border-l-2 border-green-500/30 pl-2">
                          {rtSeries.map((rtS) => (
                            <Button
                              key={rtS.id}
                              variant={selectedRTSeries?.id === rtS.id ? "default" : "ghost"}
                              className={`w-full p-2 h-auto text-left justify-start text-xs ${
                                selectedRTSeries?.id === rtS.id 
                                  ? 'bg-green-600 text-white border-green-500' 
                                  : 'hover:bg-green-600/20 text-gray-300 border-green-500/30'
                              } border rounded-lg`}
                              onClick={() => handleRTSeriesSelect(rtS)}
                            >
                              <div className="flex items-center space-x-2">
                                <Badge variant="outline" className="border-green-500 text-green-400 text-xs font-semibold">
                                  RT
                                </Badge>
                                <span className="truncate text-xs">
                                  {rtS.seriesDescription || 'Structure Set'}
                                </span>
                              </div>
                            </Button>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Structures Section */}
            <AccordionItem value="structures" className="border-dicom-indigo/30">
              <AccordionTrigger className="px-6 py-3 hover:no-underline hover:bg-green-500/10">
                <div className="flex items-center text-green-400 font-medium text-sm">
                  <Palette className="w-4 h-4 mr-2 text-green-400" />
                  Structures
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-6 pb-4">
                {rtStructures?.structures ? (
                  <div className="space-y-1 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 500px)' }}>
                    {rtStructures.structures.map((structure: any) => (
                      <div 
                        key={structure.roiNumber}
                        className="flex items-center space-x-3 p-2 rounded-lg hover:bg-dicom-indigo/10 border border-dicom-indigo/20"
                      >
                        <Checkbox
                          checked={structureVisibility.get(structure.roiNumber) ?? true}
                          onCheckedChange={() => handleStructureVisibilityToggle(structure.roiNumber)}
                          className="border-gray-400"
                        />
                        <div 
                          className="w-4 h-4 rounded border border-gray-400"
                          style={{ backgroundColor: `rgb(${structure.color.join(',')})` }}
                        />
                        <span className="text-sm text-white font-medium flex-1">
                          {structure.structureName}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center text-gray-500 text-sm py-8">
                    {selectedRTSeries ? 'Loading structures...' : 'Load an RT structure set to view contours'}
                  </div>
                )}
              </AccordionContent>
            </AccordionItem>

          </Accordion>
        </div>
        </CardContent>
      </Card>

      {/* Window/Level Controls - Separate collapsible panel */}
      <Card className="bg-dicom-dark/60 backdrop-blur-md border border-orange-500/30 rounded-2xl overflow-hidden">
        <CardContent className="p-0">
          <Accordion type="single" collapsible defaultValue="window-level">
            <AccordionItem value="window-level" className="border-orange-500/30">
              <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-orange-500/10">
                <div className="flex items-center text-orange-400 font-medium text-sm">
                  <Settings className="w-4 h-4 mr-2 text-orange-400" />
                  Window/Level
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-4 pb-4">
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">
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
                    <label className="text-xs text-gray-400 block mb-1">
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
                <div className="mt-3">
                  <h5 className="text-xs text-gray-400 mb-2">Presets</h5>
                  <div className="grid grid-cols-2 gap-1">
                    {Object.entries(WINDOW_LEVEL_PRESETS).map(([name, preset]) => (
                      <Button
                        key={name}
                        variant="outline"
                        size="sm"
                        className="text-xs py-1 px-2 h-auto border-orange-500/50 text-orange-300 hover:bg-orange-500/20"
                        onClick={() => applyPreset(preset as WindowLevel)}
                      >
                        {name.charAt(0).toUpperCase() + name.slice(1)}
                      </Button>
                    ))}
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </CardContent>
      </Card>
    </div>
  );
}