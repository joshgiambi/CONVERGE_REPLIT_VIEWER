import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Layers3, Palette, Settings, Search, Eye, EyeOff, Trash2, ChevronDown, ChevronRight, ChevronUp, Minimize2, FolderTree, X, Plus, Edit3 } from 'lucide-react';
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
  onStructureSelection?: (structureId: number, selected: boolean) => void;
  selectedForEdit?: number | null;
  onSelectedForEditChange?: (roiNumber: number | null) => void;
  onContourSettingsChange?: (settings: { width: number; opacity: number }) => void;
  onAutoZoom?: (zoom: number) => void;
  onAutoLocalize?: (x: number, y: number, z: number) => void;
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
  onStructureSelection,
  selectedForEdit: externalSelectedForEdit,
  onSelectedForEditChange,
  onContourSettingsChange,
  onAutoZoom,
  onAutoLocalize
}: SeriesSelectorProps) {
  const [rtSeries, setRTSeries] = useState<any[]>([]);
  const [selectedRTSeries, setSelectedRTSeries] = useState<any>(null);
  const [structureVisibility, setStructureVisibility] = useState<Map<number, boolean>>(new Map());
  const [selectedStructures, setSelectedStructures] = useState<Set<number>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Map<string, boolean>>(new Map());
  const [allCollapsed, setAllCollapsed] = useState(false);
  const [groupingEnabled, setGroupingEnabled] = useState(true);
  // Calculate allVisible dynamically based on current visibility state
  const allVisible = useMemo(() => {
    if (!rtStructures?.structures || structureVisibility.size === 0) return true;
    return rtStructures.structures.every((structure: any) => 
      structureVisibility.get(structure.roiNumber) === true
    );
  }, [rtStructures?.structures, structureVisibility]);
  const [localSelectedForEdit, setLocalSelectedForEdit] = useState<number | null>(null);
  const [showStructureSettings, setShowStructureSettings] = useState(false);
  const [showAddContour, setShowAddContour] = useState(false);
  const [showContourOperations, setShowContourOperations] = useState(false);
  const [autoZoomEnabled, setAutoZoomEnabled] = useState(true);
  const [autoLocalizeEnabled, setAutoLocalizeEnabled] = useState(true);
  const [zoomFillFactor, setZoomFillFactor] = useState([40]); // 40% fill factor
  const [contourWidth, setContourWidth] = useState([2]);
  const [contourOpacity, setContourOpacity] = useState([80]);
  
  // Use external selectedForEdit if provided, otherwise use local state
  const selectedForEdit = externalSelectedForEdit !== undefined ? externalSelectedForEdit : localSelectedForEdit;

  // Notify parent when contour settings change
  useEffect(() => {
    if (onContourSettingsChange) {
      onContourSettingsChange({
        width: contourWidth[0],
        opacity: contourOpacity[0]
      });
    }
  }, [contourWidth, contourOpacity, onContourSettingsChange]);

  // Handler for structure editing selection
  const handleStructureEditSelection = (roiNumber: number) => {
    const newSelected = selectedForEdit === roiNumber ? null : roiNumber;
    
    if (onSelectedForEditChange) {
      onSelectedForEditChange(newSelected);
    } else {
      setLocalSelectedForEdit(newSelected);
    }
    
    // Apply auto-zoom and auto-localize if enabled
    if (newSelected && rtStructures?.structures) {
      const structure = rtStructures.structures.find((s: any) => s.roiNumber === newSelected);
      if (structure && (autoZoomEnabled || autoLocalizeEnabled)) {
        applyAutoZoomAndLocalize(structure);
      }
    }
  };

  // Calculate contour centroid and apply auto-zoom/localize
  const applyAutoZoomAndLocalize = (structure: any) => {
    if (!structure.contours || structure.contours.length === 0) return;
    
    let totalX = 0, totalY = 0, totalZ = 0, totalPoints = 0;
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    
    // Calculate centroid and bounding box across all contours
    structure.contours.forEach((contour: any) => {
      if (contour.points && contour.points.length >= 6) {
        for (let i = 0; i < contour.points.length; i += 3) {
          const x = contour.points[i];
          const y = contour.points[i + 1];
          const z = contour.points[i + 2];
          
          totalX += x;
          totalY += y;
          totalZ += z;
          totalPoints++;
          
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
          minZ = Math.min(minZ, z);
          maxZ = Math.max(maxZ, z);
        }
      }
    });
    
    if (totalPoints === 0) return;
    
    const centroidX = totalX / totalPoints;
    const centroidY = totalY / totalPoints;
    const centroidZ = totalZ / totalPoints;
    
    // Calculate zoom level based on bounding box size
    if (autoZoomEnabled) {
      const width = maxX - minX;
      const height = maxY - minY;
      const maxDimension = Math.max(width, height);
      
      if (maxDimension > 0) {
        // Calculate zoom to fit structure with fill factor
        const fillFactor = zoomFillFactor[0] / 100;
        const targetZoom = (300 * fillFactor) / maxDimension; // Assuming 300px viewport
        
        if (onAutoZoom) {
          const finalZoom = Math.max(0.5, Math.min(5, targetZoom));
          console.log('Calling onAutoZoom with zoom:', finalZoom);
          onAutoZoom(finalZoom);
        } else {
          console.log('onAutoZoom callback not available');
        }
      }
    }
    
    // Pan to centroid
    if (autoLocalizeEnabled && onAutoLocalize) {
      console.log('Calling onAutoLocalize with centroid:', centroidX, centroidY, centroidZ);
      onAutoLocalize(centroidX, centroidY, centroidZ);
    } else {
      console.log('onAutoLocalize not available or disabled. autoLocalizeEnabled:', autoLocalizeEnabled, 'onAutoLocalize:', !!onAutoLocalize);
    }
  };

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

  const handleStructureSelection = (structureId: number, selected: boolean) => {
    const newSelection = new Set(selectedStructures);
    if (selected) {
      newSelection.add(structureId);
    } else {
      newSelection.delete(structureId);
    }
    setSelectedStructures(newSelection);
    
    if (onStructureSelection) {
      onStructureSelection(structureId, selected);
    }
  };

  const handleDeleteStructure = (structureId: number) => {
    // Handle structure deletion
    console.log('Delete structure:', structureId);
  };

  const toggleGroupExpansion = (groupName: string) => {
    setExpandedGroups(prev => {
      const newMap = new Map(prev);
      newMap.set(groupName, !newMap.get(groupName));
      return newMap;
    });
  };

  const toggleAllExpansion = () => {
    if (!rtStructures?.structures) return;
    
    const filteredStructures = rtStructures.structures.filter((structure: any) =>
      structure.structureName.toLowerCase().includes(searchTerm.toLowerCase())
    );
    const { groups } = groupStructures(filteredStructures);
    
    setExpandedGroups(prev => {
      const newMap = new Map(prev);
      const shouldExpand = allCollapsed;
      
      Array.from(groups.keys()).forEach(groupName => {
        newMap.set(groupName, shouldExpand);
      });
      
      return newMap;
    });
    
    setAllCollapsed(!allCollapsed);
  };

  // Group structures by base name (remove _L/_R suffixes)
  const groupStructures = (structures: any[]) => {
    const groups: Map<string, any[]> = new Map();
    const ungrouped: any[] = [];

    structures.forEach(structure => {
      const name = structure.structureName;
      const baseName = name.replace(/_[LR]$/, '');
      
      if (name.endsWith('_L') || name.endsWith('_R')) {
        if (!groups.has(baseName)) {
          groups.set(baseName, []);
        }
        groups.get(baseName)!.push(structure);
      } else {
        ungrouped.push(structure);
      }
    });

    return { groups, ungrouped };
  };

  const filteredStructures = rtStructures?.structures?.filter((structure: any) =>
    structure.structureName.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

  const { groups, ungrouped } = groupStructures(filteredStructures);

  const toggleGrouping = () => {
    setGroupingEnabled(!groupingEnabled);
  };

  const toggleAllVisibility = () => {
    if (!rtStructures?.structures) return;
    
    setStructureVisibility(prev => {
      const newMap = new Map(prev);
      const shouldShow = !allVisible;
      
      rtStructures.structures.forEach((structure: any) => {
        newMap.set(structure.roiNumber, shouldShow);
      });
      
      return newMap;
    });
  };

  const toggleGroupVisibility = (groupStructures: any[]) => {
    const allGroupVisible = groupStructures.every(structure => 
      structureVisibility.get(structure.roiNumber) ?? true
    );
    
    setStructureVisibility(prev => {
      const newMap = new Map(prev);
      const shouldShow = !allGroupVisible;
      
      groupStructures.forEach(structure => {
        newMap.set(structure.roiNumber, shouldShow);
      });
      
      return newMap;
    });
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
              <AccordionContent className="px-4 pb-4">
                {rtStructures?.structures ? (
                  <div className="space-y-3">
                    {/* Search Bar */}
                    <div className="relative mb-4">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <Input
                        placeholder="Search structures..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="pl-10 bg-black/20 border-gray-600 text-white placeholder-gray-400 focus:border-green-500"
                      />
                    </div>

                    {/* Control Buttons Row */}
                    <div className="flex space-x-2 mb-4">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={toggleAllVisibility}
                        className="bg-green-600/80 border-green-500 text-white hover:bg-green-700"
                        title={allVisible ? 'Hide all structures' : 'Show all structures'}
                      >
                        {allVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </Button>
                      
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={toggleGrouping}
                        className="bg-black/20 border-gray-600 text-gray-300 hover:bg-gray-700"
                        title={groupingEnabled ? 'Show flat list' : 'Group by L/R pairs'}
                      >
                        <FolderTree className="w-4 h-4" />
                      </Button>
                      
                      {groupingEnabled && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={toggleAllExpansion}
                          className="bg-yellow-600/80 border-yellow-500 text-white hover:bg-yellow-700"
                          title={allCollapsed ? 'Expand all groups' : 'Collapse all groups'}
                        >
                          {allCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                        </Button>
                      )}
                      
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowAddContour(!showAddContour)}
                        className="bg-blue-600/80 border-blue-500 text-white hover:bg-blue-700"
                        title="Add New Contour"
                      >
                        <Plus className="w-4 h-4" />
                      </Button>
                      
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowContourOperations(!showContourOperations)}
                        className="bg-orange-600/80 border-orange-500 text-white hover:bg-orange-700"
                        title="Contour Operations"
                      >
                        <Edit3 className="w-4 h-4" />
                      </Button>
                      
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowStructureSettings(!showStructureSettings)}
                        className="bg-purple-600/80 border-purple-500 text-white hover:bg-purple-700"
                        title="Structure Settings"
                      >
                        <Settings className="w-4 h-4" />
                      </Button>
                    </div>

                    {/* Structure Settings Panel */}
                    {showStructureSettings && (
                      <div className="mb-4 p-3 bg-black/30 border border-purple-500/30 rounded-lg space-y-3">
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="text-sm font-medium text-purple-400">Global Structure Settings</h4>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setShowStructureSettings(false)}
                            className="h-6 w-6 p-0 text-gray-400 hover:text-white"
                          >
                            <X className="w-3 h-3" />
                          </Button>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <Label className="text-xs text-gray-300">Auto-Zoom</Label>
                              <Switch
                                checked={autoZoomEnabled}
                                onCheckedChange={setAutoZoomEnabled}
                                className="data-[state=checked]:bg-blue-500"
                              />
                            </div>
                            
                            <div className="flex items-center justify-between">
                              <Label className="text-xs text-gray-300">Auto-Localize</Label>
                              <Switch
                                checked={autoLocalizeEnabled}
                                onCheckedChange={setAutoLocalizeEnabled}
                                className="data-[state=checked]:bg-green-500"
                              />
                            </div>
                            
                            {autoZoomEnabled && (
                              <div>
                                <Label className="text-xs text-gray-300 mb-1 block">Zoom Fill Factor</Label>
                                <Slider
                                  value={zoomFillFactor}
                                  onValueChange={setZoomFillFactor}
                                  max={80}
                                  min={20}
                                  step={5}
                                  className="w-full"
                                />
                                <div className="text-xs text-gray-400 mt-1">{zoomFillFactor[0]}%</div>
                              </div>
                            )}
                          </div>
                          
                          <div className="space-y-2">
                            <div>
                              <Label className="text-xs text-gray-300 mb-1 block">Contour Width</Label>
                              <Slider
                                value={contourWidth}
                                onValueChange={setContourWidth}
                                max={8}
                                min={1}
                                step={1}
                                className="w-full"
                              />
                              <div className="text-xs text-gray-400 mt-1">{contourWidth[0]}px</div>
                            </div>
                            
                            <div>
                              <Label className="text-xs text-gray-300 mb-1 block">Contour Opacity</Label>
                              <Slider
                                value={contourOpacity}
                                onValueChange={setContourOpacity}
                                max={100}
                                min={10}
                                step={5}
                                className="w-full"
                              />
                              <div className="text-xs text-gray-400 mt-1">{contourOpacity[0]}%</div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Add Contour Dialog */}
                    {showAddContour && (
                      <div className="mb-4 p-3 bg-black/30 border border-blue-500/30 rounded-lg space-y-3">
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="text-sm font-medium text-blue-400">Add New Contour</h4>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setShowAddContour(false)}
                            className="h-6 w-6 p-0 text-gray-400 hover:text-white"
                          >
                            <X className="w-3 h-3" />
                          </Button>
                        </div>
                        
                        <div className="space-y-3">
                          <div>
                            <Label className="text-xs text-gray-300 mb-1 block">Contour Name</Label>
                            <Input
                              placeholder="Enter contour name..."
                              className="bg-black/20 border-gray-600 text-white placeholder-gray-400 focus:border-blue-500"
                            />
                          </div>
                          
                          <div>
                            <Label className="text-xs text-gray-300 mb-1 block">Color</Label>
                            <div className="flex space-x-2">
                              <Input
                                type="color"
                                defaultValue="#ff6b6b"
                                className="w-12 h-8 p-1 border-gray-600 bg-black/20"
                              />
                              <Input
                                placeholder="#ff6b6b"
                                className="flex-1 bg-black/20 border-gray-600 text-white placeholder-gray-400 focus:border-blue-500"
                              />
                            </div>
                          </div>
                          
                          <div>
                            <Label className="text-xs text-gray-300 mb-1 block">Type</Label>
                            <Input
                              placeholder="Placeholder for contour type..."
                              disabled
                              className="bg-gray-800/50 border-gray-700 text-gray-500 placeholder-gray-500"
                            />
                          </div>
                          
                          <div className="flex space-x-2 pt-2">
                            <Button
                              size="sm"
                              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
                              onClick={() => {
                                // Handle create contour logic here
                                setShowAddContour(false);
                              }}
                            >
                              Create
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="flex-1 border-gray-600 text-gray-300 hover:bg-gray-700"
                              onClick={() => setShowAddContour(false)}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Contour Operations Dialog */}
                    {showContourOperations && (
                      <div className="mb-4 p-3 bg-black/30 border border-orange-500/30 rounded-lg space-y-3">
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="text-sm font-medium text-orange-400">Contour Operations</h4>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setShowContourOperations(false)}
                            className="h-6 w-6 p-0 text-gray-400 hover:text-white"
                          >
                            <X className="w-3 h-3" />
                          </Button>
                        </div>
                        
                        <div className="grid grid-cols-1 gap-2">
                          <Button
                            size="sm"
                            variant="destructive"
                            className="w-full bg-red-600/80 hover:bg-red-700 border-red-500 text-white"
                            onClick={() => {
                              // Handle delete current slice contour
                              console.log('Delete current slice contour');
                            }}
                          >
                            Delete Current Slice
                          </Button>
                          
                          <Button
                            size="sm"
                            variant="destructive"
                            className="w-full bg-red-600/80 hover:bg-red-700 border-red-500 text-white"
                            onClick={() => {
                              // Handle delete nth slice contour
                              console.log('Delete nth slice contour');
                            }}
                          >
                            Delete Nth Slice
                          </Button>
                          
                          <Button
                            size="sm"
                            variant="destructive"
                            className="w-full bg-red-700/80 hover:bg-red-800 border-red-600 text-white"
                            onClick={() => {
                              // Handle clear all slices
                              console.log('Clear all slices');
                            }}
                          >
                            Clear All Slices
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* Structures List - Grouped and Individual */}
                    <div className="space-y-1 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 600px)' }}>
                      {rtStructures?.structures && (() => {
                        const filteredStructures = rtStructures.structures.filter((structure: any) =>
                          structure.structureName.toLowerCase().includes(searchTerm.toLowerCase())
                        );
                        const { groups, ungrouped } = groupStructures(filteredStructures);
                        
                        if (!groupingEnabled) {
                          // Show all structures as individual rows
                          return filteredStructures.map((structure: any) => (
                            <div 
                              key={structure.roiNumber}
                              className={`flex items-center space-x-3 p-3 rounded-lg hover:bg-gray-800/50 border transition-all duration-200 ${
                                selectedStructures.has(structure.roiNumber) 
                                  ? 'border-yellow-500 bg-yellow-500/10' 
                                  : 'border-gray-700'
                              } ${
                                selectedForEdit === structure.roiNumber
                                  ? 'bg-blue-500/20 border-l-2 border-blue-400'
                                  : ''
                              }`}
                            >
                              <Checkbox
                                checked={selectedStructures.has(structure.roiNumber)}
                                onCheckedChange={(checked) => handleStructureSelection(structure.roiNumber, !!checked)}
                                className="border-yellow-500 data-[state=checked]:bg-yellow-500"
                              />
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleStructureVisibilityToggle(structure.roiNumber)}
                                className="p-1 h-auto hover:bg-gray-700"
                              >
                                {structureVisibility.get(structure.roiNumber) ?? true ? (
                                  <Eye className="w-4 h-4 text-blue-400" />
                                ) : (
                                  <EyeOff className="w-4 h-4 text-gray-500" />
                                )}
                              </Button>
                              <div 
                                className="w-4 h-4 rounded border border-gray-400"
                                style={{ backgroundColor: `rgb(${structure.color.join(',')})` }}
                              />
                              <span 
                                className="text-sm text-white font-medium flex-1 truncate cursor-pointer hover:text-green-300 transition-colors"
                                onClick={() => handleStructureEditSelection(structure.roiNumber)}
                              >
                                {structure.structureName}
                              </span>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleDeleteStructure(structure.roiNumber)}
                                className="p-1 h-auto hover:bg-red-600/20"
                              >
                                <Trash2 className="w-4 h-4 text-red-400" />
                              </Button>
                            </div>
                          ));
                        }
                        
                        return (
                          <>
                            {/* Grouped Structures with Nested Items */}
                            {Array.from(groups.entries()).map(([groupName, groupStructures]) => (
                              <div key={groupName} className="space-y-1">
                                {/* Group Header */}
                                <div className="border border-gray-700 rounded-lg">
                                  <div 
                                    className="flex items-center justify-between p-3 cursor-pointer hover:bg-gray-800/50"
                                    onClick={() => toggleGroupExpansion(groupName)}
                                  >
                                    <div className="flex items-center space-x-2">
                                      {expandedGroups.get(groupName) ? (
                                        <ChevronDown className="w-4 h-4 text-gray-400" />
                                      ) : (
                                        <ChevronRight className="w-4 h-4 text-gray-400" />
                                      )}
                                      <div className="flex items-center space-x-2">
                                        {groupStructures.map((structure, index) => (
                                          <div 
                                            key={index}
                                            className="w-3 h-3 rounded-full border border-gray-400"
                                            style={{ backgroundColor: `rgb(${structure.color.join(',')})` }}
                                          />
                                        ))}
                                      </div>
                                      <span className="text-sm text-white font-medium">{groupName}</span>
                                    </div>
                                    <div className="flex items-center space-x-2">
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          toggleGroupVisibility(groupStructures);
                                        }}
                                        className="p-1 h-auto hover:bg-gray-700"
                                      >
                                        {groupStructures.every(structure => 
                                          structureVisibility.get(structure.roiNumber) ?? true
                                        ) ? (
                                          <Eye className="w-4 h-4 text-blue-400" />
                                        ) : (
                                          <EyeOff className="w-4 h-4 text-gray-500" />
                                        )}
                                      </Button>
                                      <Badge variant="outline" className="text-xs border-gray-500 text-gray-400">
                                        {groupStructures.length}
                                      </Badge>
                                    </div>
                                  </div>
                                </div>

                                {/* Nested structures directly under this group */}
                                {expandedGroups.get(groupName) && groupStructures.map((structure: any, index: number) => (
                                  <div 
                                    key={`nested-${structure.roiNumber}`}
                                    className={`flex items-center space-x-2 px-3 py-2 ml-4 rounded-lg border border-gray-700 hover:bg-gray-800/30 transition-all duration-200 relative ${
                                      selectedStructures.has(structure.roiNumber) 
                                        ? 'bg-yellow-500/10 border-yellow-500' 
                                        : 'border-gray-700'
                                    } ${
                                      selectedForEdit === structure.roiNumber
                                        ? 'bg-green-500/20 border-green-400'
                                        : ''
                                    }`}
                                  >

                                    <Checkbox
                                      checked={selectedStructures.has(structure.roiNumber)}
                                      onCheckedChange={(checked) => handleStructureSelection(structure.roiNumber, !!checked)}
                                      className="border-yellow-500 data-[state=checked]:bg-yellow-500"
                                    />
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => handleStructureVisibilityToggle(structure.roiNumber)}
                                      className="p-1 h-auto hover:bg-gray-700"
                                    >
                                      {structureVisibility.get(structure.roiNumber) ?? true ? (
                                        <Eye className="w-4 h-4 text-blue-400" />
                                      ) : (
                                        <EyeOff className="w-4 h-4 text-gray-500" />
                                      )}
                                    </Button>
                                    <div 
                                      className="w-4 h-4 rounded border border-gray-400"
                                      style={{ backgroundColor: `rgb(${structure.color.join(',')})` }}
                                    />
                                    <span 
                                      className="text-sm text-white font-medium flex-1 truncate cursor-pointer hover:text-green-300 transition-colors"
                                      onClick={() => handleStructureEditSelection(structure.roiNumber)}
                                    >
                                      {structure.structureName}
                                    </span>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => handleDeleteStructure(structure.roiNumber)}
                                      className="p-1 h-auto hover:bg-red-600/20"
                                    >
                                      <Trash2 className="w-4 h-4 text-red-400" />
                                    </Button>
                                  </div>
                                ))}
                              </div>
                            ))}

                            {/* Ungrouped Structures */}
                            {ungrouped.map((structure: any) => (
                              <div 
                                key={structure.roiNumber}
                                className={`flex items-center space-x-3 p-3 rounded-lg hover:bg-gray-800/50 border transition-all duration-200 ${
                                  selectedStructures.has(structure.roiNumber) 
                                    ? 'border-yellow-500 bg-yellow-500/10' 
                                    : 'border-gray-700'
                                } ${
                                  selectedForEdit === structure.roiNumber
                                    ? 'bg-green-500/20 border-l-2 border-green-400'
                                    : ''
                                }`}
                              >
                                <Checkbox
                                  checked={selectedStructures.has(structure.roiNumber)}
                                  onCheckedChange={(checked) => handleStructureSelection(structure.roiNumber, !!checked)}
                                  className="border-yellow-500 data-[state=checked]:bg-yellow-500"
                                />
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleStructureVisibilityToggle(structure.roiNumber)}
                                  className="p-1 h-auto hover:bg-gray-700"
                                >
                                  {structureVisibility.get(structure.roiNumber) ?? true ? (
                                    <Eye className="w-4 h-4 text-blue-400" />
                                  ) : (
                                    <EyeOff className="w-4 h-4 text-gray-500" />
                                  )}
                                </Button>
                                <div 
                                  className="w-4 h-4 rounded border border-gray-400"
                                  style={{ backgroundColor: `rgb(${structure.color.join(',')})` }}
                                />
                                <span 
                                  className="text-sm text-white font-medium flex-1 truncate cursor-pointer hover:text-green-300 transition-colors"
                                  onClick={() => handleStructureEditSelection(structure.roiNumber)}
                                >
                                  {structure.structureName}
                                </span>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleDeleteStructure(structure.roiNumber)}
                                  className="p-1 h-auto hover:bg-red-600/20"
                                >
                                  <Trash2 className="w-4 h-4 text-red-400" />
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