import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { List, Monitor, Palette, Search, Eye, EyeOff, ChevronDown, ChevronRight, Expand, Trash2, Merge, Layers } from 'lucide-react';
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
  const [selectedForMerge, setSelectedForMerge] = useState<Set<number>>(new Set());
  const [showColorPicker, setShowColorPicker] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<'series' | 'structures'>('series');
  const [showMergeDialog, setShowMergeDialog] = useState(false);
  const [mergeStructureName, setMergeStructureName] = useState('');

  // Load RT series when studyId changes
  useEffect(() => {
    if (!studyId) return;
    
    const loadRTSeries = async () => {
      try {
        const response = await fetch(`/api/studies/${studyId}/rt-structures`);
        if (response.ok) {
          const rtSeriesData = await response.json();
          // Filter to only include RT structure sets (not other series types)
          const filteredRTSeries = rtSeriesData.filter((series: any) => 
            series.modality === 'RTSTRUCT' || series.seriesDescription?.toLowerCase().includes('structure')
          );
          setRTSeries(filteredRTSeries);
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

  const toggleGroup = (groupName: string) => {
    setExpandedGroups(prev => {
      const newExpanded = new Set(prev);
      if (newExpanded.has(groupName)) {
        newExpanded.delete(groupName);
      } else {
        newExpanded.add(groupName);
      }
      return newExpanded;
    });
  };

  const expandAllGroups = () => {
    if (!rtStructures?.structures) return;
    const { groups } = groupStructures(rtStructures.structures);
    setExpandedGroups(new Set(Object.keys(groups)));
  };

  const collapseAllGroups = () => {
    setExpandedGroups(new Set());
  };

  const toggleMergeSelection = (structureId: number) => {
    setSelectedForMerge(prev => {
      const newSelected = new Set(prev);
      if (newSelected.has(structureId)) {
        newSelected.delete(structureId);
      } else {
        newSelected.add(structureId);
      }
      return newSelected;
    });
  };

  const handleMergeStructures = () => {
    if (selectedForMerge.size < 2) return;
    setShowMergeDialog(true);
  };

  const confirmMerge = () => {
    // Implement merge logic here
    console.log('Merging structures:', Array.from(selectedForMerge), 'with name:', mergeStructureName);
    setShowMergeDialog(false);
    setSelectedForMerge(new Set());
    setMergeStructureName('');
  };

  const handleDeleteStructure = (structureId: number) => {
    if (confirm('Are you sure you want to delete this structure? This action cannot be undone.')) {
      // Implement delete logic here
      console.log('Deleting structure:', structureId);
    }
  };

  const handleColorChange = (structureId: number, color: string) => {
    const rgb = hexToRgb(color);
    if (rgb && onStructureColorChange) {
      onStructureColorChange(structureId, [rgb.r, rgb.g, rgb.b]);
    }
    setShowColorPicker(null);
  };

  const hexToRgb = (hex: string) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : null;
  };

  const rgbToHex = (r: number, g: number, b: number) => {
    return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
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
      <div className="h-full flex flex-col">
        <CardHeader className="pb-3">
          {/* Pill Switcher */}
          <div className="flex p-1 bg-gray-800/50 rounded-lg border border-gray-600">
            <button
              onClick={() => setActiveTab('series')}
              className={`flex-1 flex items-center justify-center px-3 py-2 text-sm font-medium rounded-md transition-all ${
                activeTab === 'series'
                  ? 'bg-blue-600 text-white shadow-lg'
                  : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
              }`}
            >
              <List className="w-4 h-4 mr-2" />
              Series
            </button>
            <button
              onClick={() => setActiveTab('structures')}
              className={`flex-1 flex items-center justify-center px-3 py-2 text-sm font-medium rounded-md transition-all ${
                activeTab === 'structures'
                  ? 'bg-blue-600 text-white shadow-lg'
                  : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
              }`}
            >
              <Monitor className="w-4 h-4 mr-2" />
              Structures
            </button>
          </div>
        </CardHeader>
        
        <CardContent className="flex-1 overflow-hidden p-6">
          {activeTab === 'series' ? (
            <div className="h-full space-y-4 mt-0">
              <div className="space-y-2">
                <h3 className="text-xl font-bold text-dicom-purple flex items-center">
                  <Monitor className="w-6 h-6 mr-3 text-dicom-indigo" />
                  Image Series
                </h3>
              </div>
              
              {/* Image Series List */}
              <div className="flex-1 space-y-2 mb-6 overflow-y-auto">
                {series.map((seriesItem) => (
                  <div
                    key={seriesItem.id}
                    className={`p-3 rounded-lg border cursor-pointer transition-all ${
                      selectedSeries?.id === seriesItem.id
                        ? 'border-dicom-yellow bg-dicom-yellow/20'
                        : 'border-dicom-indigo/30 hover:border-dicom-indigo/50 hover:bg-dicom-indigo/10'
                    }`}
                    onClick={() => onSeriesSelect(seriesItem)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="font-medium text-dicom-blue text-sm">
                          {seriesItem.seriesDescription || `Series ${seriesItem.seriesNumber}`}
                        </div>
                        <div className="text-xs text-gray-400 mt-1">
                          {seriesItem.imageCount} images • {seriesItem.modality}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-gray-400">
                          #{seriesItem.seriesNumber}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              
              {/* RT Series nested under CT series */}
              {rtSeries.map((rtSeriesItem) => (
                <div key={rtSeriesItem.id} className="ml-4 mt-2">
                  <div
                    className={`p-2 rounded-lg border cursor-pointer transition-all ${
                      selectedRTSeries?.id === rtSeriesItem.id
                        ? 'border-green-400 bg-green-400/20'
                        : 'border-gray-600/50 hover:border-green-400/50 hover:bg-green-400/10'
                    }`}
                    onClick={() => handleRTSeriesSelect(rtSeriesItem)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="font-medium text-green-400 text-xs flex items-center">
                          <Layers className="h-3 w-3 mr-1" />
                          {rtSeriesItem.seriesDescription || `RT Structure Set ${rtSeriesItem.seriesNumber}`}
                        </div>
                        <div className="text-xs text-gray-500 mt-1">
                          {rtSeriesItem.structureCount || 0} anatomical structures
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-gray-500">
                          #{rtSeriesItem.seriesNumber}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              
              {/* Window/Level Controls */}
              {selectedSeries && (
                <div className="bg-dicom-darker rounded-lg p-4 border border-dicom-indigo/30">
                  <h4 className="text-lg font-semibold text-dicom-purple mb-3">Display Settings</h4>
                  
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
          ) : (
            <div className="h-full space-y-4 mt-0">
              <div className="space-y-2">
                <h3 className="text-xl font-bold text-dicom-purple flex items-center">
                  <Palette className="w-6 h-6 mr-3 text-dicom-indigo" />
                  Structure Contours
                </h3>
              </div>
              
              {rtStructures?.structures ? (
                <div className="space-y-3">
                  {/* Search Bar and Controls */}
                  <div className="space-y-2">
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
                    
                    {/* Control Buttons */}
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={expandedGroups.size > 0 ? collapseAllGroups : expandAllGroups}
                        className="flex-1 text-xs"
                      >
                        <Expand className="h-3 w-3 mr-1" />
                        {expandedGroups.size > 0 ? 'Collapse All' : 'Expand All'}
                      </Button>
                      
                      {selectedForMerge.size > 0 && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleMergeStructures}
                          className="flex-1 text-xs bg-blue-600/20 border-blue-500"
                        >
                          <Merge className="h-3 w-3 mr-1" />
                          Merge ({selectedForMerge.size})
                        </Button>
                      )}
                    </div>
                  </div>
                  
                  {/* Structure List */}
                  <div className="space-y-2 overflow-y-auto max-h-96">
                    {(() => {
                      // Filter structures based on search term
                      const filteredStructures = rtStructures.structures.filter((structure: any) =>
                        structure.structureName.toLowerCase().includes(searchTerm.toLowerCase())
                      );
                      
                      // Group structures by base name
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
                                <div className="flex items-center space-x-2 flex-1">
                                  {expandedGroups.has(groupName) ? (
                                    <ChevronDown className="h-3 w-3 text-gray-400" />
                                  ) : (
                                    <ChevronRight className="h-3 w-3 text-gray-400" />
                                  )}
                                  
                                  {/* Color indicators for grouped structures */}
                                  <div className="flex space-x-1">
                                    {groupStructures.map((structure: any) => (
                                      <div 
                                        key={structure.roiNumber}
                                        className="w-2 h-2 rounded-full border border-gray-400"
                                        style={{ backgroundColor: `rgb(${structure.color.join(',')})` }}
                                      />
                                    ))}
                                  </div>
                                  
                                  <div className="flex-1 min-w-0">
                                    <span className="text-xs text-white font-medium">{groupName}</span>
                                    <div className="text-xs text-gray-400 truncate">
                                      {groupStructures.map((s: any) => s.structureName).join(', ')}
                                    </div>
                                  </div>
                                  
                                  <Badge variant="outline" className="text-xs text-gray-400 h-4 px-1">
                                    {groupStructures.length}
                                  </Badge>
                                </div>
                              </div>
                              
                              {expandedGroups.has(groupName) && (
                                <div className="ml-4 space-y-0.5">
                                  {groupStructures.map((structure: any) => (
                                    <div 
                                      key={structure.roiNumber}
                                      className={`flex items-center space-x-2 p-1.5 rounded border cursor-pointer transition-all relative ${
                                        selectedStructure === structure.roiNumber 
                                          ? 'border-blue-400 bg-blue-500/20' 
                                          : selectedForMerge.has(structure.roiNumber)
                                          ? 'border-green-400 bg-green-500/20'
                                          : 'border-dicom-indigo/20 hover:bg-dicom-indigo/10'
                                      }`}
                                      onClick={() => onSelectedStructureChange?.(structure.roiNumber)}
                                    >
                                      <Checkbox
                                        checked={selectedForMerge.has(structure.roiNumber)}
                                        onCheckedChange={(checked) => {
                                          if (checked) toggleMergeSelection(structure.roiNumber);
                                        }}
                                        onClick={(e) => e.stopPropagation()}
                                        className="h-3 w-3"
                                      />
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleStructureVisibilityToggle(structure.roiNumber);
                                        }}
                                        className="h-4 w-4 p-0"
                                      >
                                        {structureVisibility.get(structure.roiNumber) ? (
                                          <Eye className="h-2.5 w-2.5 text-blue-400" />
                                        ) : (
                                          <EyeOff className="h-2.5 w-2.5 text-gray-500" />
                                        )}
                                      </Button>
                                      <div 
                                        className="w-2.5 h-2.5 rounded border border-gray-400 cursor-pointer"
                                        style={{ backgroundColor: `rgb(${structure.color.join(',')})` }}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setShowColorPicker(showColorPicker === structure.roiNumber ? null : structure.roiNumber);
                                        }}
                                      />
                                      <div className="flex-1 min-w-0">
                                        <span className="text-xs text-white font-medium truncate block leading-3">
                                          {structure.structureName}
                                        </span>
                                      </div>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleDeleteStructure(structure.roiNumber);
                                        }}
                                        className="h-4 w-4 p-0 hover:bg-red-500/20"
                                      >
                                        <Trash2 className="h-2.5 w-2.5 text-red-400" />
                                      </Button>
                                      
                                      {/* Color Picker */}
                                      {showColorPicker === structure.roiNumber && (
                                        <div className="absolute z-50 top-full left-0 mt-1 p-2 bg-black border border-gray-600 rounded-lg shadow-lg">
                                          <input
                                            type="color"
                                            value={rgbToHex(structure.color[0], structure.color[1], structure.color[2])}
                                            onChange={(e) => handleColorChange(structure.roiNumber, e.target.value)}
                                            className="w-6 h-6 border-none rounded cursor-pointer"
                                          />
                                        </div>
                                      )}
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
                              className={`flex items-center space-x-2 p-2 rounded-lg border cursor-pointer transition-all relative ${
                                selectedStructure === structure.roiNumber 
                                  ? 'border-blue-400 bg-blue-500/20' 
                                  : selectedForMerge.has(structure.roiNumber)
                                  ? 'border-green-400 bg-green-500/20'
                                  : 'border-dicom-indigo/20 hover:bg-dicom-indigo/10'
                              }`}
                              onClick={() => onSelectedStructureChange?.(structure.roiNumber)}
                            >
                              <Checkbox
                                checked={selectedForMerge.has(structure.roiNumber)}
                                onCheckedChange={(checked) => {
                                  if (checked) toggleMergeSelection(structure.roiNumber);
                                }}
                                onClick={(e) => e.stopPropagation()}
                                className="h-3 w-3"
                              />
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleStructureVisibilityToggle(structure.roiNumber);
                                }}
                                className="h-5 w-5 p-0"
                              >
                                {structureVisibility.get(structure.roiNumber) ? (
                                  <Eye className="h-3 w-3 text-blue-400" />
                                ) : (
                                  <EyeOff className="h-3 w-3 text-gray-500" />
                                )}
                              </Button>
                              <div 
                                className="w-3 h-3 rounded border border-gray-400 cursor-pointer"
                                style={{ backgroundColor: `rgb(${structure.color.join(',')})` }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setShowColorPicker(showColorPicker === structure.roiNumber ? null : structure.roiNumber);
                                }}
                              />
                              <div className="flex-1 min-w-0">
                                <span className="text-xs text-white font-medium truncate block">
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
                                  handleDeleteStructure(structure.roiNumber);
                                }}
                                className="h-5 w-5 p-0 hover:bg-red-500/20"
                              >
                                <Trash2 className="h-3 w-3 text-red-400" />
                              </Button>
                              
                              {/* Color Picker */}
                              {showColorPicker === structure.roiNumber && (
                                <div className="absolute z-50 top-full left-0 mt-1 p-2 bg-black border border-gray-600 rounded-lg shadow-lg">
                                  <input
                                    type="color"
                                    value={rgbToHex(structure.color[0], structure.color[1], structure.color[2])}
                                    onChange={(e) => handleColorChange(structure.roiNumber, e.target.value)}
                                    className="w-6 h-6 border-none rounded cursor-pointer"
                                  />
                                </div>
                              )}
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
            </div>
          )}
        </CardContent>
      </div>

      {/* Merge Structures Dialog */}
      <Dialog open={showMergeDialog} onOpenChange={setShowMergeDialog}>
        <DialogContent className="bg-black border-gray-600">
          <DialogHeader>
            <DialogTitle className="text-white">Merge Structures</DialogTitle>
            <DialogDescription className="text-gray-400">
              You are about to merge {selectedForMerge.size} structures into a new structure. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-white block mb-2">
                New Structure Name:
              </label>
              <Input
                value={mergeStructureName}
                onChange={(e) => setMergeStructureName(e.target.value)}
                placeholder="Enter name for merged structure"
                className="bg-black/50 border-gray-600 text-white"
              />
            </div>
            
            <div>
              <label className="text-sm font-medium text-white block mb-2">
                Structures to merge:
              </label>
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {Array.from(selectedForMerge).map(structureId => {
                  const structure = rtStructures?.structures?.find((s: any) => s.roiNumber === structureId);
                  return structure ? (
                    <div key={structureId} className="flex items-center space-x-2 p-2 rounded border border-gray-700">
                      <div 
                        className="w-3 h-3 rounded border border-gray-400"
                        style={{ backgroundColor: `rgb(${structure.color.join(',')})` }}
                      />
                      <span className="text-sm text-white">{structure.structureName}</span>
                    </div>
                  ) : null;
                })}
              </div>
            </div>
          </div>
          
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowMergeDialog(false)}
              className="border-gray-600 text-white hover:bg-gray-800"
            >
              Cancel
            </Button>
            <Button
              onClick={confirmMerge}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              Merge Structures
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}