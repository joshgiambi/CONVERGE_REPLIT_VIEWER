import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { List, Settings, Monitor, Palette, Search, Eye, EyeOff, ChevronDown, ChevronRight, Expand, Trash2, Merge, Plus } from 'lucide-react';
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

  const expandAllGroups = () => {
    if (!rtStructures?.structures) return;
    const { groups } = groupStructures(rtStructures.structures);
    setExpandedGroups(new Set(Object.keys(groups)));
  };

  const collapseAllGroups = () => {
    setExpandedGroups(new Set());
  };

  const handleDeleteStructure = async (structureId: number) => {
    if (confirm('Are you sure you want to delete this structure? This action cannot be undone.')) {
      // TODO: Implement API call to delete structure
      console.log('Deleting structure:', structureId);
    }
  };

  const toggleMergeSelection = (structureId: number) => {
    const newSelection = new Set(selectedForMerge);
    if (newSelection.has(structureId)) {
      newSelection.delete(structureId);
    } else {
      newSelection.add(structureId);
    }
    setSelectedForMerge(newSelection);
  };

  const handleMergeStructures = async () => {
    if (selectedForMerge.size < 2) {
      alert('Please select at least 2 structures to merge.');
      return;
    }
    setShowMergeDialog(true);
  };

  const confirmMerge = async () => {
    if (!mergeStructureName.trim()) {
      alert('Please enter a name for the merged structure.');
      return;
    }
    
    // TODO: Implement API call to merge structures
    console.log('Merging structures:', Array.from(selectedForMerge), 'into:', mergeStructureName);
    
    setShowMergeDialog(false);
    setSelectedForMerge(new Set());
    setMergeStructureName('');
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
          <>
            {activeTab === 'series' && (
              <div className="h-full space-y-4 mt-0">
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
            </div>
          )}

          {activeTab === 'structures' && (
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
                              <div className="flex items-center space-x-2 flex-1">
                                {expandedGroups.has(groupName) ? (
                                  <ChevronDown className="h-3 w-3 text-gray-400" />
                                ) : (
                                  <ChevronRight className="h-3 w-3 text-gray-400" />
                                )}
                                
                                {/* Color indicators for grouped structures */}
                                <div className="flex space-x-1">
                                  {groupStructures.map((structure: any, index: number) => (
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
