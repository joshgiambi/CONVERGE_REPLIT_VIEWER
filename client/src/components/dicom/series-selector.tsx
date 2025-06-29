import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { List, Settings, Monitor, Palette, Search, Eye, EyeOff, ChevronDown, ChevronRight } from 'lucide-react';
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
  selectedStructure?: number | null;
  onSelectedStructureChange?: (structureId: number | null) => void;
  editMode?: 'view' | 'brush' | 'eraser' | 'polygon';
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
  onStructureColorChange,
  selectedStructure,
  onSelectedStructureChange,
  editMode
}: SeriesSelectorProps) {
  const [rtSeries, setRTSeries] = useState<any[]>([]);
  const [selectedRTSeries, setSelectedRTSeries] = useState<any>(null);
  const [structureVisibility, setStructureVisibility] = useState<Map<number, boolean>>(new Map());
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
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

  // Group structures by base name (for _L, _R grouping)
  const groupStructures = (structures: any[]) => {
    const groups: { [key: string]: any[] } = {};
    const singles: any[] = [];

    structures.forEach(structure => {
      const name = structure.structureName;
      const baseName = name.replace(/_[LR]$/, '');
      
      if (name.endsWith('_L') || name.endsWith('_R')) {
        if (!groups[baseName]) {
          groups[baseName] = [];
        }
        groups[baseName].push(structure);
      } else {
        singles.push(structure);
      }
    });

    return { groups, singles };
  };

  // Filter structures based on search term
  const filterStructures = (structures: any[]) => {
    if (!searchTerm) return structures;
    return structures.filter(structure => 
      structure.structureName.toLowerCase().includes(searchTerm.toLowerCase())
    );
  };

  const toggleGroup = (groupName: string) => {
    const newExpanded = new Set(expandedGroups);
    if (newExpanded.has(groupName)) {
      newExpanded.delete(groupName);
    } else {
      newExpanded.add(groupName);
    }
    setExpandedGroups(newExpanded);
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
      <Tabs defaultValue="series" className="h-full flex flex-col">
        <CardHeader className="pb-3">
          <TabsList className="grid w-full grid-cols-2 bg-dicom-indigo/20">
            <TabsTrigger value="series" className="text-xs">Series</TabsTrigger>
            <TabsTrigger value="structures" className="text-xs">Structures</TabsTrigger>
          </TabsList>
        </CardHeader>
        
        <CardContent className="flex-1 overflow-hidden p-6">
          <TabsContent value="series" className="h-full space-y-4 mt-0">
            <div className="space-y-2">
              <h3 className="text-xl font-bold text-dicom-purple flex items-center">
                <Monitor className="w-6 h-6 mr-3 text-dicom-indigo" />
                Image Series
              </h3>
            </div>
            
            {/* Image Series List */}
            <div className="flex-1 space-y-2 mb-6 overflow-y-auto">
              {series.filter(s => s.modality !== 'RTSTRUCT').map((seriesItem) => (
                <div key={seriesItem.id}>
                  <div
                    className={`
                      p-3 rounded-lg border cursor-pointer transition-all duration-200
                      ${selectedSeries?.id === seriesItem.id
                        ? 'bg-dicom-yellow/20 border-dicom-yellow shadow-lg'
                        : 'bg-dicom-indigo/10 border-dicom-indigo/30 hover:border-dicom-yellow/50 hover:bg-dicom-yellow/5'
                      }
                    `}
                    onClick={() => onSeriesSelect(seriesItem)}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <Badge 
                        variant="outline" 
                        className={`
                          text-xs font-medium
                          ${selectedSeries?.id === seriesItem.id
                            ? 'border-dicom-yellow text-dicom-yellow'
                            : 'border-dicom-indigo text-dicom-indigo'
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
                      text-sm font-medium mb-1
                      ${selectedSeries?.id === seriesItem.id ? 'text-dicom-yellow' : 'text-white'}
                    `}>
                      {seriesItem.seriesDescription || `Series ${seriesItem.seriesNumber}`}
                    </h4>
                    
                    <p className="text-xs text-gray-400">
                      #{seriesItem.seriesNumber}
                    </p>
                  </div>

                  {/* RT Structure Series nested under CT */}
                  {selectedSeries?.id === seriesItem.id && rtSeries.length > 0 && (
                    <div className="ml-4 mt-2 space-y-1">
                      {rtSeries.map((rtS) => (
                        <Button
                          key={rtS.id}
                          variant={selectedRTSeries?.id === rtS.id ? "default" : "ghost"}
                          className={`w-full p-2 h-auto text-left justify-start text-xs ${
                            selectedRTSeries?.id === rtS.id 
                              ? 'bg-green-600 text-white' 
                              : 'hover:bg-green-600/20 text-gray-300'
                          }`}
                          onClick={() => handleRTSeriesSelect(rtS)}
                        >
                          <div className="flex items-center space-x-2">
                            <Badge variant="outline" className="border-green-500 text-green-400 text-xs">
                              RTSTRUCT
                            </Badge>
                            <span className="truncate">
                              {rtS.seriesDescription || 'RT Structure Set'}
                            </span>
                          </div>
                        </Button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
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
          </TabsContent>

          <TabsContent value="structures" className="h-full space-y-4 mt-0">
            <div className="space-y-2">
              <h3 className="text-xl font-bold text-dicom-purple flex items-center">
                <Palette className="w-6 h-6 mr-3 text-dicom-indigo" />
                Structure Contours
              </h3>
            </div>
            
            {rtStructures?.structures ? (
              <div className="space-y-3">
                {/* Search Bar */}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <Input
                    type="text"
                    placeholder="Search structures..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10 bg-black/50 border-gray-600 text-white placeholder-gray-400"
                  />
                </div>

                {/* Structure List */}
                <div className="space-y-1 max-h-80 overflow-y-auto">
                  {(() => {
                    const filteredStructures = filterStructures(rtStructures.structures);
                    const { groups, singles } = groupStructures(filteredStructures);

                    return (
                      <>
                        {/* Grouped structures */}
                        {Object.entries(groups).map(([groupName, groupStructures]) => (
                          <div key={groupName} className="space-y-1">
                            <div
                              className="flex items-center justify-between p-2 rounded-lg cursor-pointer hover:bg-dicom-indigo/10 border border-dicom-indigo/20"
                              onClick={() => toggleGroup(groupName)}
                            >
                              <div className="flex items-center space-x-2">
                                {expandedGroups.has(groupName) ? (
                                  <ChevronDown className="h-4 w-4 text-gray-400" />
                                ) : (
                                  <ChevronRight className="h-4 w-4 text-gray-400" />
                                )}
                                <span className="text-sm text-white font-medium">{groupName}</span>
                                <Badge variant="outline" className="text-xs text-gray-400">
                                  {groupStructures.length}
                                </Badge>
                              </div>
                            </div>
                            
                            {expandedGroups.has(groupName) && (
                              <div className="ml-6 space-y-1">
                                {groupStructures.map((structure: any) => (
                                  <div 
                                    key={structure.roiNumber}
                                    className={`flex items-center space-x-3 p-2 rounded-lg border cursor-pointer transition-all ${
                                      selectedStructure === structure.roiNumber 
                                        ? 'border-blue-400 bg-blue-500/20' 
                                        : 'border-dicom-indigo/20 hover:bg-dicom-indigo/10'
                                    }`}
                                    onClick={() => onSelectedStructureChange?.(structure.roiNumber)}
                                  >
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleStructureVisibilityToggle(structure.roiNumber);
                                      }}
                                      className="h-6 w-6 p-0"
                                    >
                                      {structureVisibility.get(structure.roiNumber) ? (
                                        <Eye className="h-3 w-3 text-blue-400" />
                                      ) : (
                                        <EyeOff className="h-3 w-3 text-gray-500" />
                                      )}
                                    </Button>
                                    <div 
                                      className="w-3 h-3 rounded border border-gray-400"
                                      style={{ backgroundColor: `rgb(${structure.color.join(',')})` }}
                                    />
                                    <div className="flex-1">
                                      <span className="text-xs text-white font-medium">
                                        {structure.structureName}
                                      </span>
                                      <div className="text-xs text-gray-400">
                                        ROI {structure.roiNumber}
                                      </div>
                                    </div>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        // Color picker functionality
                                      }}
                                      className="h-6 w-6 p-0"
                                    >
                                      <Palette className="h-3 w-3 text-gray-400" />
                                    </Button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}

                        {/* Single structures */}
                        {singles.map((structure: any) => (
                          <div 
                            key={structure.roiNumber}
                            className={`flex items-center space-x-3 p-2 rounded-lg border cursor-pointer transition-all ${
                              selectedStructure === structure.roiNumber 
                                ? 'border-blue-400 bg-blue-500/20' 
                                : 'border-dicom-indigo/20 hover:bg-dicom-indigo/10'
                            }`}
                            onClick={() => onSelectedStructureChange?.(structure.roiNumber)}
                          >
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleStructureVisibilityToggle(structure.roiNumber);
                              }}
                              className="h-6 w-6 p-0"
                            >
                              {structureVisibility.get(structure.roiNumber) ? (
                                <Eye className="h-3 w-3 text-blue-400" />
                              ) : (
                                <EyeOff className="h-3 w-3 text-gray-500" />
                              )}
                            </Button>
                            <div 
                              className="w-3 h-3 rounded border border-gray-400"
                              style={{ backgroundColor: `rgb(${structure.color.join(',')})` }}
                            />
                            <div className="flex-1">
                              <span className="text-xs text-white font-medium">
                                {structure.structureName}
                              </span>
                              <div className="text-xs text-gray-400">
                                ROI {structure.roiNumber}
                              </div>
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                // Color picker functionality
                              }}
                              className="h-6 w-6 p-0"
                            >
                              <Palette className="h-3 w-3 text-gray-400" />
                            </Button>
                          </div>
                        ))}
                      </>
                    );
                  })()}
                </div>
              </div>
            ) : (
              <div className="text-center text-gray-500 text-sm py-8">
                {selectedRTSeries ? 'Loading structures...' : 'Load an RT structure set to view contours'}
              </div>
            )}
          </TabsContent>
        </CardContent>
      </Tabs>
    </Card>
  );
}
