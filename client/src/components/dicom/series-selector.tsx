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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Layers3, Palette, Settings, Search, Eye, EyeOff, Trash2, ChevronDown, ChevronRight, ChevronUp, Minimize2, FolderTree, X, Plus, Edit3, Link, Folder, ArrowUpDown, ArrowUp, ArrowDown, Anchor, ExternalLink } from 'lucide-react';
import { DICOMSeries, WindowLevel, WINDOW_LEVEL_PRESETS } from '@/lib/dicom-utils';
import { useToast } from '@/hooks/use-toast';

interface SeriesSelectorProps {
  series: DICOMSeries[];
  selectedSeries: DICOMSeries | null;
  onSeriesSelect: (series: DICOMSeries) => void;
  windowLevel: WindowLevel;
  onWindowLevelChange: (windowLevel: WindowLevel) => void;
  studyId?: number;
  studyIds?: number[];
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
  secondarySeriesId?: number | null;
  onSecondarySeriesSelect?: (seriesId: number | null) => void;
  onAllStructuresVisibilityChange?: (allVisible: boolean) => void;
  preventRTLoading?: boolean;
  localizationMode?: boolean;
  loadedRTSeriesId?: number | null;
  previewStructureInfo?: { targetName: string; isNewStructure: boolean } | null;
}

export function SeriesSelector({
  series,
  selectedSeries,
  onSeriesSelect,
  windowLevel,
  onWindowLevelChange,
  studyId,
  studyIds,
  rtStructures,
  onRTStructureLoad,
  onStructureVisibilityChange,
  onStructureColorChange,
  onStructureSelection,
  selectedForEdit: externalSelectedForEdit,
  onSelectedForEditChange,
  onContourSettingsChange,
  onAutoZoom,
  onAutoLocalize,
  secondarySeriesId,
  onSecondarySeriesSelect,
  onAllStructuresVisibilityChange,
  preventRTLoading = false,
  localizationMode = false,
  loadedRTSeriesId,
  previewStructureInfo
}: SeriesSelectorProps) {
  const [rtSeries, setRTSeries] = useState<any[]>([]);
  const [selectedRTSeries, setSelectedRTSeries] = useState<any>(null);
  const [structureVisibility, setStructureVisibility] = useState<Map<number, boolean>>(new Map());
  const [selectedStructures, setSelectedStructures] = useState<Set<number>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Map<string, boolean>>(new Map());
  const [allCollapsed, setAllCollapsed] = useState(false);
  const [groupingEnabled, setGroupingEnabled] = useState(true);
  const [hoveredRegSeries, setHoveredRegSeries] = useState<number | null>(null);
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
  const [contourOpacity, setContourOpacity] = useState([10]);
  const [showNewStructureDialog, setShowNewStructureDialog] = useState(false);
  const [newStructureName, setNewStructureName] = useState('');
  const [newStructureColor, setNewStructureColor] = useState('#FF0000');
  const [sortMode, setSortMode] = useState<'az' | 'za' | 'position'>('az'); // Sorting mode: A-Z, Z-A, or by superior Z-slice
  const { toast } = useToast();
  
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
    
    // Enable auto-localize when selecting a structure for editing
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

  // Load RT structure series for all studies (memoized to prevent excessive API calls)
  useEffect(() => {
    if (preventRTLoading) {
      console.log('Skipping RT structure loading - handled by parent component');
      return;
    }
    
    const studyIdsToLoad = studyIds || (studyId ? [studyId] : []);
    if (studyIdsToLoad.length === 0) return;
    
    // Skip loading if we already have RT series for these studies
    const studyIdsKey = studyIdsToLoad.sort().join(',');
    const currentRTSeriesKey = rtSeries.map(s => s.studyId).sort().join(',');
    if (studyIdsKey === currentRTSeriesKey && rtSeries.length > 0) {
      console.log('RT series already loaded for studies:', studyIdsToLoad);
      return;
    }
    
    let isCancelled = false;
    
    const loadRTSeries = async () => {
      try {
        const allRTSeries: any[] = [];
        
        // Load RT structures for each study (only once per study)
        for (const id of studyIdsToLoad) {
          if (isCancelled) break;
          
          const response = await fetch(`/api/studies/${id}/rt-structures`);
          if (response.ok) {
            const rtSeriesData = await response.json();
            allRTSeries.push(...rtSeriesData);
          }
        }
        
        if (!isCancelled) {
          console.log('Loaded RT series for studies:', studyIdsToLoad, 'Found:', allRTSeries);
          console.log('RT series details:', allRTSeries);
          console.log('RT series with associations:', allRTSeries.map(rt => ({
            id: rt.id,
            description: rt.seriesDescription,
            referencedSeriesId: rt.referencedSeriesId,
            studyId: rt.studyId
          })));
          setRTSeries(allRTSeries);
        }
      } catch (error) {
        if (!isCancelled) {
          console.error('Error loading RT series:', error);
        }
      }
    };
    
    loadRTSeries();
    
    return () => {
      isCancelled = true;
    };
  }, [studyId, studyIds, preventRTLoading]);

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

  // Sync selectedRTSeries with loadedRTSeriesId when RT series are loaded
  useEffect(() => {
    if (loadedRTSeriesId && rtSeries.length > 0) {
      const loadedSeries = rtSeries.find(s => s.id === loadedRTSeriesId);
      if (loadedSeries && (!selectedRTSeries || selectedRTSeries.id !== loadedRTSeriesId)) {
        console.log('Setting selectedRTSeries based on loadedRTSeriesId:', loadedRTSeriesId);
        setSelectedRTSeries(loadedSeries);
      }
    }
  }, [loadedRTSeriesId, rtSeries]);

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
    const currentVisibility = structureVisibility.get(structureId);
    const newVisibility = currentVisibility === undefined ? true : !currentVisibility;
    
    console.log('Eye icon clicked:', { 
      structureId, 
      currentVisibility, 
      newVisibility,
      allVisible 
    });
    
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

  const handleCreateNewStructure = async () => {
    if (!newStructureName.trim()) {
      toast({ 
        title: "Structure name is required", 
        variant: "destructive" 
      });
      return;
    }

    if (!studyId) {
      toast({ 
        title: "No study selected", 
        variant: "destructive" 
      });
      return;
    }

    // Convert hex color to RGB array
    const hexToRgb = (hex: string): [number, number, number] => {
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      return result ? [
        parseInt(result[1], 16),
        parseInt(result[2], 16),
        parseInt(result[3], 16)
      ] : [255, 0, 0];
    };

    const rgbColor = hexToRgb(newStructureColor);

    try {
      console.log('Creating structure with:', {
        studyId,
        structureName: newStructureName.trim(),
        color: rgbColor
      });

      // Call API to create new structure
      const response = await fetch('/api/rt-structures', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studyId: studyId,
          structureName: newStructureName.trim(),
          color: rgbColor
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Create structure error:', errorText);
        throw new Error(errorText || 'Failed to create structure');
      }

      const newStructure = await response.json();
      console.log('New structure created:', newStructure);
      
      // Reload RT structures to include the new one
      if (selectedRTSeries && onRTStructureLoad) {
        console.log('Reloading RT structures for series:', selectedRTSeries.id);
        const structuresResponse = await fetch(`/api/rt-structures/${selectedRTSeries.id}/contours`);
        if (structuresResponse.ok) {
          const data = await structuresResponse.json();
          console.log('Reloaded structures:', data);
          onRTStructureLoad(data);
        } else {
          console.error('Failed to reload structures:', structuresResponse.status);
        }
      } else {
        console.log('Cannot reload structures - selectedRTSeries:', selectedRTSeries, 'onRTStructureLoad:', !!onRTStructureLoad);
      }

      toast({ 
        title: `Structure "${newStructureName}" created successfully`,
        variant: "default" 
      });

      // Reset form and close dialog
      setNewStructureName('');
      setNewStructureColor('#FF0000');
      setShowNewStructureDialog(false);
    } catch (error) {
      console.error('Error creating structure:', error);
      toast({ 
        title: "Failed to create structure", 
        variant: "destructive" 
      });
    }
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
    const { groups, specialGroups } = groupStructures(filteredStructures);
    
    setExpandedGroups(prev => {
      const newMap = new Map(prev);
      const shouldExpand = allCollapsed;
      
      // Add regular groups
      Array.from(groups.keys()).forEach(groupName => {
        newMap.set(groupName, shouldExpand);
      });
      
      // Add special groups
      Array.from(specialGroups.keys()).forEach(groupName => {
        newMap.set(groupName, shouldExpand);
      });
      
      return newMap;
    });
    
    setAllCollapsed(!allCollapsed);
  };

  // Group structures by base name and special categories
  const groupStructures = (structures: any[]) => {
    const groups: Map<string, any[]> = new Map();
    const specialGroups: Map<string, any[]> = new Map([
      ['GTV', []],
      ['CTV', []],
      ['PTV', []],
      ['Planning Structures', []]
    ]);
    const ungrouped: any[] = [];

    structures.forEach(structure => {
      const name = structure.structureName;
      
      // Check for special prefixes first
      if (name.startsWith('GTV')) {
        specialGroups.get('GTV')!.push(structure);
      } else if (name.startsWith('CTV')) {
        specialGroups.get('CTV')!.push(structure);
      } else if (name.startsWith('PTV') && !name.startsWith('zzPTV')) {
        specialGroups.get('PTV')!.push(structure);
      } else if (name.startsWith('zz')) {
        specialGroups.get('Planning Structures')!.push(structure);
      } else {
        // Regular L/R grouping
        const baseName = name.replace(/_[LR]$/, '');
        
        if (name.endsWith('_L') || name.endsWith('_R')) {
          if (!groups.has(baseName)) {
            groups.set(baseName, []);
          }
          groups.get(baseName)!.push(structure);
        } else {
          ungrouped.push(structure);
        }
      }
    });

    // Sort special groups
    specialGroups.forEach((structures, key) => {
      structures.sort((a, b) => a.structureName.localeCompare(b.structureName));
    });

    // Remove empty special groups
    const nonEmptySpecialGroups = new Map();
    specialGroups.forEach((structures, key) => {
      if (structures.length > 0) {
        nonEmptySpecialGroups.set(key, structures);
      }
    });

    return { groups, ungrouped, specialGroups: nonEmptySpecialGroups };
  };

  // Function to sort structures based on current mode
  const sortStructures = (structures: any[]) => {
    const sorted = [...structures];
    
    switch (sortMode) {
      case 'az':
        // Sort A-Z alphabetically
        return sorted.sort((a, b) => a.structureName.localeCompare(b.structureName));
      
      case 'za':
        // Sort Z-A reverse alphabetically
        return sorted.sort((a, b) => b.structureName.localeCompare(a.structureName));
      
      case 'position':
        // Sort by most superior Z-slice (highest Z value first)
        return sorted.sort((a, b) => {
          // Get the maximum Z position for each structure
          const getMaxZ = (structure: any) => {
            if (!structure.contourData || structure.contourData.length === 0) return -Infinity;
            
            let maxZ = -Infinity;
            structure.contourData.forEach((contour: any) => {
              if (contour.slicePosition && contour.slicePosition > maxZ) {
                maxZ = contour.slicePosition;
              }
            });
            return maxZ;
          };
          
          const maxZA = getMaxZ(a);
          const maxZB = getMaxZ(b);
          
          // Sort by highest Z first (most superior)
          return maxZB - maxZA;
        });
      
      default:
        return sorted;
    }
  };

  const filteredStructures = rtStructures?.structures?.filter((structure: any) =>
    structure.structureName.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

  // Apply sorting to filtered structures
  const sortedStructures = sortStructures(filteredStructures);
  const { groups, ungrouped } = groupStructures(sortedStructures);

  const toggleGrouping = () => {
    setGroupingEnabled(!groupingEnabled);
  };

  const toggleAllVisibility = () => {
    if (!rtStructures?.structures) return;
    
    const shouldShow = !allVisible;
    
    // Update all visibility states at once
    setStructureVisibility(prev => {
      const newMap = new Map(prev);
      rtStructures.structures.forEach((structure: any) => {
        newMap.set(structure.roiNumber, shouldShow);
      });
      return newMap;
    });
    
    // Call parent callback for each structure
    rtStructures.structures.forEach((structure: any) => {
      if (onStructureVisibilityChange) {
        onStructureVisibilityChange(structure.roiNumber, shouldShow);
      }
    });
    
    // Notify parent about all structures visibility change
    if (onAllStructuresVisibilityChange) {
      onAllStructuresVisibilityChange(shouldShow);
    }
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
    <TooltipProvider delayDuration={0}>
      <div className="h-full flex flex-col space-y-4">
        {/* Main Series and Structures Panel */}
        <Card className="flex-1 bg-gray-950/90 backdrop-blur-xl border border-gray-600/60 rounded-xl overflow-hidden shadow-2xl shadow-black/50">
          <CardContent className="p-0 h-full flex flex-col">
            <div className="flex-1 overflow-hidden flex flex-col">
              <Accordion type="multiple" defaultValue={["series"]} className="h-full flex flex-col">
            
            {/* Series Section */}
            <AccordionItem value="series" className="border-gray-800/50">
              <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-gray-800/30 backdrop-blur-sm">
                <div className="flex items-center text-gray-100 font-medium text-sm">
                  <Layers3 className="w-4 h-4 mr-2 text-blue-400" />
                  Series
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-3 pb-3">
                <div className="space-y-1">
                  {/* Organize series hierarchically */}
                  {(() => {
                    const ctSeries = series.filter(s => s.modality === 'CT');
                    const mrSeries = series.filter(s => s.modality === 'MR');
                    const ptSeries = series.filter(s => s.modality === 'PT');
                    const regSeries = series.filter(s => s.modality === 'REG');
                    const otherSeries = series.filter(s => !['CT', 'MR', 'PT', 'REG', 'RTSTRUCT'].includes(s.modality));
                    
                    // Check if we have registration data
                    const hasRegistration = regSeries.length > 0;
                    
                    // Determine primary series (CT if available, otherwise MR, PT, or others)
                    const primarySeries = ctSeries.length > 0 ? ctSeries : 
                                        mrSeries.length > 0 ? mrSeries : 
                                        ptSeries.length > 0 ? ptSeries : 
                                        otherSeries;
                    
                    return (
                      <>
                        {/* Primary Series (CT, MR, PT, or others) */}
                        {primarySeries.map((seriesItem) => (
                          <div key={seriesItem.id}>
                            <div
                              className={`
                                p-2 rounded-lg border cursor-pointer transition-all duration-200 backdrop-blur-sm
                                ${selectedSeries?.id === seriesItem.id
                                  ? 'bg-blue-500/20 border-blue-400/50 shadow-lg shadow-blue-500/20'
                                  : hoveredRegSeries && (ctSeries.length > 0 || mrSeries.length > 0 || ptSeries.length > 0)
                                  ? 'bg-green-500/10 border-green-400/50 shadow-md shadow-green-500/20'
                                  : 'bg-gray-800/30 border-gray-700/30 hover:border-gray-600/50 hover:bg-gray-700/40'
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

                            {/* Always show nested items under CT series */}
                            <div className="ml-4 mt-2 space-y-1">
                              {/* RT Structure Series nested under CT - only show those that reference this CT */}
                              {rtSeries && rtSeries.length > 0 && rtSeries.filter((rtS: any) => {
                                // Debug log for RT series filtering
                                const isMatch = rtS.referencedSeriesId === seriesItem.id || (!rtS.referencedSeriesId && rtSeries.length === 1);
                                console.log('RT Series filter:', {
                                  rtSeriesId: rtS.id, 
                                  referencedSeriesId: rtS.referencedSeriesId, 
                                  ctSeriesId: seriesItem.id,
                                  isMatch,
                                  rtSeriesLength: rtSeries.length
                                });
                                return isMatch;
                              }).length > 0 && (
                                <div className="space-y-1 border-l-2 border-green-500/30 pl-3">
                                  {rtSeries.filter((rtS: any) => 
                                    rtS.referencedSeriesId === seriesItem.id || (!rtS.referencedSeriesId && rtSeries.length === 1)
                                  ).map((rtS: any) => (
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
                              
                              {/* Registration and MR Series that can be fused */}
                              {hasRegistration && mrSeries.length > 0 && (
                                <div className="space-y-1 border-l-2 border-purple-500/30 pl-3">
                                  <div className="text-xs text-purple-300 mb-1 flex items-center gap-1">
                                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                    </svg>
                                    Fusion-ready MRI (Registered)
                                  </div>
                                  
                                  {/* MR Series that can be fused */}
                                  {mrSeries.map((mrS) => (
                                    <div
                                      key={mrS.id}
                                      className={`
                                        w-full p-2 text-left text-xs rounded-lg transition-all
                                        ${secondarySeriesId === mrS.id
                                          ? 'bg-purple-500/40 border-purple-400 shadow-lg ring-2 ring-purple-400/50'
                                          : selectedSeries?.id === mrS.id
                                          ? 'bg-purple-500/20 border-purple-500 shadow-lg'
                                          : hoveredRegSeries
                                          ? 'bg-green-500/10 border-green-500/50 shadow-md'
                                          : 'bg-purple-600/10 border-purple-500/30 hover:bg-purple-600/20'
                                        } border
                                      `}
                                    >
                                      <div className="flex items-center justify-between">
                                        <div className="flex items-center space-x-2 flex-1">
                                          <Badge variant="outline" className="border-purple-500 text-purple-400 text-xs font-semibold">
                                            MR
                                          </Badge>
                                          <span className="truncate text-xs">
                                            {mrS.seriesDescription || 'MR Series'} ({mrS.imageCount} images)
                                          </span>
                                        </div>
                                        <div className="flex items-center gap-1">
                                          <Button
                                            size="icon"
                                            variant="ghost"
                                            className="h-6 w-6 hover:bg-purple-700/30"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              // Open MRI as primary series (view standalone)
                                              onSeriesSelect(mrS);
                                              // Clear secondary series
                                              if (onSecondarySeriesSelect) {
                                                onSecondarySeriesSelect(null);
                                              }
                                            }}
                                            title="View MRI standalone"
                                          >
                                            <ExternalLink className="h-3.5 w-3.5 text-purple-300" />
                                          </Button>
                                          {secondarySeriesId === mrS.id ? (
                                            <TooltipProvider delayDuration={0}>
                                              <Tooltip>
                                                <TooltipTrigger asChild>
                                                  <Button
                                                    size="icon"
                                                    variant="ghost"
                                                    className="h-6 w-6 bg-green-600 hover:bg-green-700 animate-pulse"
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      // Toggle fusion off
                                                      if (onSecondarySeriesSelect) {
                                                        onSecondarySeriesSelect(null);
                                                      }
                                                    }}
                                                  >
                                                    <Anchor className="h-3.5 w-3.5 text-white" />
                                                  </Button>
                                                </TooltipTrigger>
                                                <TooltipContent className="bg-gradient-to-r from-green-500/90 to-emerald-500/90 backdrop-blur-xl border-green-400/50 text-white">
                                                  <p className="font-medium">Fusion Active - Click to disable</p>
                                                </TooltipContent>
                                              </Tooltip>
                                            </TooltipProvider>
                                          ) : (
                                            <TooltipProvider delayDuration={0}>
                                              <Tooltip>
                                                <TooltipTrigger asChild>
                                                  <Button
                                                    size="icon"
                                                    variant="ghost"
                                                    className="h-6 w-6 hover:bg-green-700/30"
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      console.log('🚀 Anchor button clicked! Enabling fusion with MRI series:', mrS.id);
                                                      // Toggle fusion on
                                                      if (onSecondarySeriesSelect) {
                                                        console.log('🚀 Calling onSecondarySeriesSelect with:', mrS.id);
                                                        onSecondarySeriesSelect(mrS.id);
                                                      } else {
                                                        console.error('❌ onSecondarySeriesSelect is not defined!');
                                                      }
                                                    }}
                                                  >
                                                    <Anchor className="h-3.5 w-3.5 text-green-300" />
                                                  </Button>
                                                </TooltipTrigger>
                                                <TooltipContent className="bg-gradient-to-r from-green-500/90 to-emerald-500/90 backdrop-blur-xl border-green-400/50 text-white">
                                                  <p className="font-medium">Enable fusion overlay</p>
                                                </TooltipContent>
                                              </Tooltip>
                                            </TooltipProvider>
                                          )}
                                        </div>
                                      </div>
                                      {/* RT Structure Series that reference this MRI */}
                                      {rtSeries && rtSeries.length > 0 && (
                                        <div className="mt-2 space-y-1 border-l-2 border-green-500/30 pl-3">
                                          {rtSeries
                                            .filter((rtS: any) => rtS.referencedSeriesId === mrS.id)
                                            .map((rtS: any) => (
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
                              )}
                              
                              {/* PT Series that can be fused with CT */}
                              {ptSeries.length > 0 && (
                                <div className="space-y-1 border-l-2 border-yellow-500/30 pl-3">
                                  <div className="text-xs text-yellow-300 mb-1 flex items-center gap-1">
                                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                    </svg>
                                    PET/CT Fusion
                                  </div>
                                  
                                  {/* PT Series */}
                                  {ptSeries.map((ptS) => (
                                    <div
                                      key={ptS.id}
                                      className={`
                                        w-full p-2 text-left text-xs rounded-lg transition-all
                                        ${secondarySeriesId === ptS.id
                                          ? 'bg-yellow-500/40 border-yellow-400 shadow-lg ring-2 ring-yellow-400/50'
                                          : selectedSeries?.id === ptS.id
                                          ? 'bg-yellow-500/20 border-yellow-500 shadow-lg'
                                          : hoveredRegSeries
                                          ? 'bg-green-500/10 border-green-500/50 shadow-md'
                                          : 'bg-yellow-600/10 border-yellow-500/30 hover:bg-yellow-600/20'
                                        } border
                                      `}
                                    >
                                      <div className="flex items-center justify-between">
                                        <div className="flex items-center space-x-2 flex-1">
                                          <Badge variant="outline" className="border-yellow-500 text-yellow-400 text-xs font-semibold">
                                            PT
                                          </Badge>
                                          <span className="truncate text-xs">
                                            {ptS.seriesDescription || 'PET Series'} ({ptS.imageCount} images)
                                          </span>
                                        </div>
                                        <div className="flex items-center gap-1">
                                          <Button
                                            size="icon"
                                            variant="ghost"
                                            className="h-6 w-6 hover:bg-yellow-700/30"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              // Open PT as primary series (view standalone)
                                              onSeriesSelect(ptS);
                                              // Clear secondary series
                                              if (onSecondarySeriesSelect) {
                                                onSecondarySeriesSelect(null);
                                              }
                                            }}
                                            title="View PET standalone"
                                          >
                                            <ExternalLink className="h-3.5 w-3.5 text-yellow-300" />
                                          </Button>
                                          {secondarySeriesId === ptS.id ? (
                                            <TooltipProvider delayDuration={0}>
                                              <Tooltip>
                                                <TooltipTrigger asChild>
                                                  <Button
                                                    size="icon"
                                                    variant="ghost"
                                                    className="h-6 w-6 bg-green-600 hover:bg-green-700 animate-pulse"
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      // Toggle fusion off
                                                      if (onSecondarySeriesSelect) {
                                                        onSecondarySeriesSelect(null);
                                                      }
                                                    }}
                                                  >
                                                    <Anchor className="h-3.5 w-3.5 text-white" />
                                                  </Button>
                                                </TooltipTrigger>
                                                <TooltipContent className="bg-gradient-to-r from-yellow-500/90 to-amber-500/90 backdrop-blur-xl border-yellow-400/50 text-white">
                                                  <p className="font-medium">Fusion Active - Click to disable</p>
                                                </TooltipContent>
                                              </Tooltip>
                                            </TooltipProvider>
                                          ) : (
                                            <TooltipProvider delayDuration={0}>
                                              <Tooltip>
                                                <TooltipTrigger asChild>
                                                  <Button
                                                    size="icon"
                                                    variant="ghost"
                                                    className="h-6 w-6 hover:bg-green-700/30"
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      // Toggle fusion on
                                                      if (onSecondarySeriesSelect) {
                                                        onSecondarySeriesSelect(ptS.id);
                                                      }
                                                    }}
                                                  >
                                                    <Anchor className="h-3.5 w-3.5 text-green-300" />
                                                  </Button>
                                                </TooltipTrigger>
                                                <TooltipContent className="bg-gradient-to-r from-yellow-500/90 to-amber-500/90 backdrop-blur-xl border-yellow-400/50 text-white">
                                                  <p className="font-medium">Enable PET fusion overlay</p>
                                                </TooltipContent>
                                              </Tooltip>
                                            </TooltipProvider>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                        
                        {/* MR Series as standalone when no CT present */}
                        {ctSeries.length === 0 && mrSeries.length > 0 && mrSeries.map((seriesItem) => (
                          <div key={seriesItem.id}>
                            <div
                              className={`
                                p-2 rounded-lg border cursor-pointer transition-all duration-200 backdrop-blur-sm
                                ${selectedSeries?.id === seriesItem.id
                                  ? 'bg-purple-500/20 border-purple-400/50 shadow-lg shadow-purple-500/20'
                                  : 'bg-gray-800/30 border-gray-700/30 hover:border-gray-600/50 hover:bg-gray-700/40'
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
                                      ? 'border-purple-400 text-purple-400'
                                      : 'border-purple-500 text-purple-500'
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
                                ${selectedSeries?.id === seriesItem.id ? 'text-purple-400' : 'text-white'}
                              `}>
                                {seriesItem.seriesDescription || `Series ${seriesItem.seriesNumber}`}
                              </h4>
                            </div>
                          </div>
                        ))}
                        
                        {/* Other modalities (if any) - only show if not already displayed as primary */}
                        {primarySeries !== otherSeries && otherSeries.map((seriesItem) => (
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
                          </div>
                        ))}
                        
                        {/* Registration Series - Simple pill-shaped display */}
                        {regSeries.length > 0 && (
                          <div className="mt-4 space-y-2">
                            {regSeries.map((seriesItem) => {
                              // For now, we'll use a simple heuristic to find the two series to fuse
                              // In a real implementation, we'd parse the REG file to get the referenced series UIDs
                              // Priority: CT as primary, then MR/PT as secondary
                              const ctSeries = series.find(s => s.modality === 'CT');
                              const mrSeries = series.find(s => s.modality === 'MR');
                              const ptSeries = series.find(s => s.modality === 'PT');
                              
                              // Determine primary and secondary series based on available modalities
                              let primarySeries = ctSeries;
                              let secondarySeries = mrSeries || ptSeries;
                              
                              // If no CT, could be MR-to-MR or other combinations
                              if (!primarySeries && mrSeries) {
                                primarySeries = mrSeries;
                                secondarySeries = series.find(s => s.modality === 'MR' && s.id !== mrSeries.id);
                              }
                              
                              return (
                                <div
                                  key={seriesItem.id}
                                  className="inline-flex items-center space-x-2 px-3 py-1.5 rounded-full bg-gray-800/50 border border-gray-700/50 text-xs hover:bg-gray-700/50 transition-colors cursor-pointer"
                                  onMouseEnter={() => setHoveredRegSeries(seriesItem.id)}
                                  onMouseLeave={() => setHoveredRegSeries(null)}
                                  onClick={async () => {
                                    // Parse the registration file first
                                    try {
                                      const response = await fetch(`/api/registrations/${studyId}/parse`, {
                                        method: 'POST'
                                      });
                                      if (!response.ok) {
                                        console.error('Failed to parse registration:', await response.text());
                                      } else {
                                        console.log('Registration parsed successfully');
                                      }
                                    } catch (error) {
                                      console.error('Error parsing registration:', error);
                                    }
                                    
                                    // Open primary with secondary fusion when clicking REG
                                    if (primarySeries && secondarySeries) {
                                      onSeriesSelect(primarySeries);
                                      if (onSecondarySeriesSelect) {
                                        // Small delay to ensure primary is selected first
                                        setTimeout(() => {
                                          onSecondarySeriesSelect(secondarySeries.id);
                                        }, 100);
                                      }
                                    }
                                  }}
                                >
                                  <Link className="w-3 h-3 text-gray-500" />
                                  <span className="text-gray-400">
                                    {seriesItem.modality} • {seriesItem.seriesDescription || 'Registration'}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Structures Section */}
            <AccordionItem value="structures" className="border-gray-800/50">
              <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-gray-800/30 backdrop-blur-sm">
                <div className="flex items-center text-gray-100 font-medium text-sm">
                  <Palette className="w-4 h-4 mr-2 text-green-400" />
                  Structures
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-4 pb-4">
                {rtStructures?.structures ? (
                  <div className="space-y-3 flex flex-col" style={{ maxHeight: 'calc(100vh - 400px)', overflowY: 'auto' }}>
                    {/* Search Bar */}
                    <div className="relative mb-4">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none z-10" />
                      <Input
                        placeholder="Search structures..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="pl-10 pr-4 py-2 bg-gray-900/80 backdrop-blur-sm border border-gray-600/40 text-white placeholder-gray-400 rounded-lg transition-all duration-200 focus:outline-none focus:ring-0 focus:border-blue-500/60 focus:bg-gray-800/90 hover:border-gray-500/60 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
                        style={{ WebkitTapHighlightColor: 'transparent' }}
                      />
                    </div>

                    {/* Control Buttons Row */}
                    <div className="flex space-x-2 mb-4">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={toggleAllVisibility}
                            className="bg-blue-500/10 border border-blue-500/30 text-blue-400 hover:bg-blue-500/20 rounded-lg backdrop-blur-sm transition-all duration-200"
                          >
                            {allVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent className="bg-gradient-to-br from-blue-600/95 via-blue-500/95 to-blue-600/95 border-blue-400/30">
                          <p>{allVisible ? 'Hide all structures' : 'Show all structures'}</p>
                        </TooltipContent>
                      </Tooltip>
                      
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={toggleGrouping}
                            className="bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/20 rounded-lg backdrop-blur-sm transition-all duration-200"
                          >
                            <FolderTree className="w-4 h-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent className="bg-gradient-to-br from-yellow-600/95 via-yellow-500/95 to-yellow-600/95 border-yellow-400/30">
                          <p>{groupingEnabled ? 'Show flat list' : 'Group by L/R pairs'}</p>
                        </TooltipContent>
                      </Tooltip>
                      
                      {groupingEnabled && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={toggleAllExpansion}
                              className="bg-gray-500/10 border border-gray-500/30 text-gray-400 hover:bg-gray-500/20 rounded-lg backdrop-blur-sm transition-all duration-200"
                            >
                              {allCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent className="bg-gradient-to-br from-gray-600/95 via-gray-500/95 to-gray-600/95 border-gray-400/30">
                            <p>{allCollapsed ? 'Expand all groups' : 'Collapse all groups'}</p>
                          </TooltipContent>
                        </Tooltip>
                      )}
                      
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              // Cycle through sort modes: az -> za -> position -> az
                              const nextMode = sortMode === 'az' ? 'za' : sortMode === 'za' ? 'position' : 'az';
                              setSortMode(nextMode);
                            }}
                            className="bg-orange-500/10 border border-orange-500/30 text-orange-400 hover:bg-orange-500/20 rounded-lg backdrop-blur-sm transition-all duration-200 ml-auto"
                          >
                            {sortMode === 'az' ? <ArrowDown className="w-4 h-4" /> : 
                             sortMode === 'za' ? <ArrowUp className="w-4 h-4" /> : 
                             <ArrowUpDown className="w-4 h-4" />}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent className="bg-gradient-to-br from-orange-600/95 via-orange-500/95 to-orange-600/95 border-orange-400/30">
                          <p>Sort: {sortMode === 'az' ? 'A-Z' : sortMode === 'za' ? 'Z-A' : 'By Position'}</p>
                        </TooltipContent>
                      </Tooltip>
                      
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setShowNewStructureDialog(true)}
                            className="bg-green-500/10 border border-green-500/30 text-green-400 hover:bg-green-500/20 rounded-lg backdrop-blur-sm transition-all duration-200"
                          >
                            <Plus className="w-4 h-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent className="bg-gradient-to-br from-green-600/95 via-green-500/95 to-green-600/95 border-green-400/30">
                          <p>Create new structure</p>
                        </TooltipContent>
                      </Tooltip>
                      
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setShowStructureSettings(!showStructureSettings)}
                            className="bg-purple-500/10 border border-purple-500/30 text-purple-400 hover:bg-purple-500/20 rounded-lg backdrop-blur-sm transition-all duration-200"
                          >
                            <Settings className="w-4 h-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent className="bg-gradient-to-br from-purple-600/95 via-purple-500/95 to-purple-600/95 border-purple-400/30">
                          <p>Structure Settings</p>
                        </TooltipContent>
                      </Tooltip>
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
                        
                        <div className="space-y-3">
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
                              min={0}
                              step={5}
                              className="w-full"
                            />
                            <div className="text-xs text-gray-400 mt-1">{contourOpacity[0]}%</div>
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
                    <div className="space-y-1 overflow-y-auto" style={{ height: 'calc(100vh - 600px)', minHeight: '200px' }}>
                      {rtStructures?.structures && (() => {
                        // Filter and sort structures
                        const filtered = rtStructures.structures.filter((structure: any) =>
                          structure.structureName.toLowerCase().includes(searchTerm.toLowerCase())
                        );
                        const sorted = sortStructures(filtered);
                        const { groups, ungrouped, specialGroups } = groupStructures(sorted);
                        
                        if (!groupingEnabled) {
                          // Show all structures as individual rows with reduced height
                          return sorted.map((structure: any) => {
                            // Check if this structure is in preview mode
                            const isInPreview = previewStructureInfo?.targetName && 
                              structure.structureName.toLowerCase() === previewStructureInfo.targetName.toLowerCase();
                            
                            return (
                              <div 
                                key={structure.roiNumber}
                                className={`flex items-center space-x-2 px-2 py-1.5 rounded-lg border transition-all duration-200 backdrop-blur-sm ${
                                  selectedStructures.has(structure.roiNumber) 
                                    ? 'border-yellow-500/60 bg-yellow-500/10' 
                                    : 'border-gray-700/50 bg-gray-800/30'
                                } ${
                                  selectedForEdit === structure.roiNumber
                                    ? 'border-blue-500/60 bg-blue-500/10'
                                    : 'hover:bg-gray-700/50'
                                } ${
                                  isInPreview ? 'preview-structure-highlight' : ''
                                }`}
                              >
                              <Checkbox
                                checked={selectedStructures.has(structure.roiNumber)}
                                onCheckedChange={(checked) => handleStructureSelection(structure.roiNumber, !!checked)}
                                className="h-3 w-3 border-yellow-500/60 data-[state=checked]:bg-yellow-500"
                              />
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleStructureVisibilityToggle(structure.roiNumber)}
                                className="p-0.5 h-5 w-5 hover:bg-gray-600/50 rounded-lg"
                              >
                                {structureVisibility.get(structure.roiNumber) ?? true ? (
                                  <Eye className="w-3 h-3 text-blue-400" />
                                ) : (
                                  <EyeOff className="w-3 h-3 text-gray-500" />
                                )}
                              </Button>
                              <div 
                                className="w-3 h-3 rounded border-2 border-gray-600/50"
                                style={{ backgroundColor: `rgb(${structure.color.join(',')})` }}
                              />
                              <span 
                                className="text-xs text-gray-100 font-medium flex-1 truncate cursor-pointer hover:text-green-400 transition-colors"
                                onClick={() => handleStructureEditSelection(structure.roiNumber)}
                              >
                                {structure.structureName}
                              </span>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleDeleteStructure(structure.roiNumber)}
                                className="p-0.5 h-5 w-5 hover:bg-red-500/30 rounded-lg opacity-70 hover:opacity-100"
                              >
                                <Trash2 className="w-3 h-3 text-red-400" />
                              </Button>
                            </div>
                          );
                          });
                        }
                        
                        return (
                          <>
                            {/* Special Groups (GTV, CTV, PTV, Planning) */}
                            {Array.from(specialGroups.entries()).map(([groupName, groupStructures]) => (
                              <div key={groupName}>
                                {/* Special Group Header */}
                                <div>
                                  <div 
                                    className="backdrop-blur-sm bg-gray-900/50 border border-gray-700/50 rounded-lg shadow-lg flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-gray-800/50"
                                    onClick={() => toggleGroupExpansion(groupName)}
                                  >
                                    <div className="flex items-center space-x-2">
                                      {expandedGroups.get(groupName) ? (
                                        <ChevronDown className="w-3 h-3 text-gray-400" />
                                      ) : (
                                        <ChevronRight className="w-3 h-3 text-gray-400" />
                                      )}
                                      <span className="text-xs font-medium text-white">
                                        {groupName}
                                      </span>
                                    </div>
                                    <div className="flex items-center space-x-2">
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          toggleGroupVisibility(groupStructures);
                                        }}
                                        className="p-0.5 h-5 w-5 hover:bg-gray-700 rounded-lg"
                                      >
                                        {groupStructures.every((structure: any) => 
                                          structureVisibility.get(structure.roiNumber) ?? true
                                        ) ? (
                                          <Eye className="w-3 h-3 text-blue-400" />
                                        ) : (
                                          <EyeOff className="w-3 h-3 text-gray-500" />
                                        )}
                                      </Button>
                                      <Badge variant="outline" className={`text-xs border ${
                                        groupName === 'GTV' ? 'border-red-500/60 text-red-400' :
                                        groupName === 'CTV' ? 'border-orange-500/60 text-orange-400' :
                                        groupName === 'PTV' ? 'border-yellow-500/60 text-yellow-400' :
                                        'border-purple-500/60 text-purple-400'
                                      }`}>
                                        {groupStructures.length}
                                      </Badge>
                                    </div>
                                  </div>
                                  
                                  {/* Special Group Nested Items */}
                                  {expandedGroups.get(groupName) && (
                                    <div className="mt-1 ml-4 space-y-1 relative">
                                      {/* Vertical connection line */}
                                      <div className="absolute left-0 top-0 bottom-0 w-px bg-blue-400/30 -ml-2"></div>
                                      {groupStructures.map((structure: any, index: number) => {
                                        // Check if this structure is in preview mode
                                        const isInPreview = previewStructureInfo?.targetName && 
                                          structure.structureName.toLowerCase() === previewStructureInfo.targetName.toLowerCase();
                                        
                                        return (
                                          <div className="relative" key={`wrapper-${structure.roiNumber}`}>
                                            <div 
                                              className={`flex items-center space-x-2 px-2 py-1.5 rounded-lg border-2 transition-all duration-200 backdrop-blur-sm ${
                                              selectedForEdit === structure.roiNumber
                                                ? 'border-green-500 bg-green-500/10 shadow-lg shadow-green-500/20' 
                                                : selectedStructures.has(structure.roiNumber) 
                                                ? 'border-yellow-500/60 bg-yellow-500/10' 
                                                : 'border-gray-700/30 bg-gray-800/20 hover:bg-gray-700/30'
                                            } ${
                                              isInPreview ? 'preview-structure-highlight' : ''
                                            }`}
                                          >
                                          <Checkbox
                                            checked={selectedStructures.has(structure.roiNumber)}
                                            onCheckedChange={(checked) => handleStructureSelection(structure.roiNumber, !!checked)}
                                            className="h-3 w-3 border-yellow-500/60 data-[state=checked]:bg-yellow-500"
                                          />
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => handleStructureVisibilityToggle(structure.roiNumber)}
                                            className="p-0.5 h-5 w-5 hover:bg-gray-600/50 rounded-lg"
                                          >
                                            {structureVisibility.get(structure.roiNumber) ?? true ? (
                                              <Eye className="w-3 h-3 text-blue-400" />
                                            ) : (
                                              <EyeOff className="w-3 h-3 text-gray-500" />
                                            )}
                                          </Button>
                                          <div 
                                            className="w-3 h-3 rounded border-2 border-gray-600/50"
                                            style={{ backgroundColor: `rgb(${structure.color.join(',')})` }}
                                          />
                                          <span 
                                            className="text-xs text-gray-100 font-medium flex-1 truncate cursor-pointer hover:text-green-400 transition-colors"
                                            onClick={() => handleStructureEditSelection(structure.roiNumber)}
                                          >
                                            {structure.structureName}
                                          </span>
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => handleDeleteStructure(structure.roiNumber)}
                                            className="p-0.5 h-5 w-5 hover:bg-red-500/30 rounded-lg opacity-70 hover:opacity-100"
                                          >
                                            <Trash2 className="w-3 h-3 text-red-400" />
                                          </Button>
                                        </div>
                                        </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              </div>
                            ))}

                            {/* Regular Grouped Structures with Nested Items */}
                            {Array.from(groups.entries()).map(([groupName, groupStructures]) => (
                              <div key={groupName}>
                                {/* Group Header */}
                                <div>
                                  <div 
                                    className="backdrop-blur-sm bg-gray-800/30 border border-gray-700/50 rounded-lg flex items-center justify-between px-3 py-1.5 cursor-pointer hover:bg-gray-800/50"
                                    onClick={() => toggleGroupExpansion(groupName)}
                                  >
                                    <div className="flex items-center space-x-2">
                                      {expandedGroups.get(groupName) ? (
                                        <ChevronDown className="w-3 h-3 text-gray-400" />
                                      ) : (
                                        <ChevronRight className="w-3 h-3 text-gray-400" />
                                      )}
                                      <div className="flex items-center space-x-1">
                                        {groupStructures.map((structure, index) => (
                                          <div 
                                            key={index}
                                            className="w-2.5 h-2.5 rounded border border-gray-600/50"
                                            style={{ backgroundColor: `rgb(${structure.color.join(',')})` }}
                                          />
                                        ))}
                                      </div>
                                      <span className="text-xs text-gray-100 font-medium">{groupName}</span>
                                    </div>
                                    <div className="flex items-center space-x-2">
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          toggleGroupVisibility(groupStructures);
                                        }}
                                        className="p-0.5 h-5 w-5 hover:bg-gray-700 rounded"
                                      >
                                        {groupStructures.every((structure: any) => 
                                          structureVisibility.get(structure.roiNumber) ?? true
                                        ) ? (
                                          <Eye className="w-3 h-3 text-blue-400" />
                                        ) : (
                                          <EyeOff className="w-3 h-3 text-gray-500" />
                                        )}
                                      </Button>
                                      <Badge variant="outline" className="text-xs border-gray-600/50 text-gray-400">
                                        {groupStructures.length}
                                      </Badge>
                                    </div>
                                  </div>
                                  
                                  {/* Nested structures directly under this group */}
                                  {expandedGroups.get(groupName) && (
                                    <div className="mt-1 ml-4 space-y-1 relative">
                                      {/* Vertical connection line */}
                                      <div className="absolute left-0 top-0 bottom-0 w-px bg-blue-400/30 -ml-2"></div>
                                      {groupStructures.map((structure: any, index: number) => {
                                        // Check if this structure is in preview mode
                                        const isInPreview = previewStructureInfo?.targetName && 
                                          structure.structureName.toLowerCase() === previewStructureInfo.targetName.toLowerCase();
                                        
                                        return (
                                          <div className="relative" key={`wrapper-nested-${structure.roiNumber}`}>
                                            <div 
                                              className={`flex items-center space-x-2 px-2 py-1.5 rounded-lg border-2 transition-all duration-200 backdrop-blur-sm ${
                                              selectedForEdit === structure.roiNumber
                                                ? 'border-green-500 bg-green-500/10 shadow-lg shadow-green-500/20' 
                                                : selectedStructures.has(structure.roiNumber) 
                                                ? 'border-yellow-500/60 bg-yellow-500/10' 
                                                : 'border-gray-700/30 bg-gray-800/20 hover:bg-gray-700/30'
                                            } ${
                                              isInPreview ? 'preview-structure-highlight' : ''
                                            }`}
                                          >
                                          <Checkbox
                                            checked={selectedStructures.has(structure.roiNumber)}
                                            onCheckedChange={(checked) => handleStructureSelection(structure.roiNumber, !!checked)}
                                            className="h-3 w-3 border-yellow-500/60 data-[state=checked]:bg-yellow-500"
                                          />
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => handleStructureVisibilityToggle(structure.roiNumber)}
                                            className="p-0.5 h-5 w-5 hover:bg-gray-600/50 rounded-lg"
                                          >
                                            {structureVisibility.get(structure.roiNumber) ?? true ? (
                                              <Eye className="w-3 h-3 text-blue-400" />
                                            ) : (
                                              <EyeOff className="w-3 h-3 text-gray-500" />
                                            )}
                                          </Button>
                                          <div 
                                            className="w-3 h-3 rounded border-2 border-gray-600/50"
                                            style={{ backgroundColor: `rgb(${structure.color.join(',')})` }}
                                          />
                                          <span 
                                            className="text-xs text-gray-100 font-medium flex-1 truncate cursor-pointer hover:text-green-400 transition-colors"
                                            onClick={() => handleStructureEditSelection(structure.roiNumber)}
                                          >
                                            {structure.structureName}
                                          </span>
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => handleDeleteStructure(structure.roiNumber)}
                                            className="p-0.5 h-5 w-5 hover:bg-red-500/30 rounded-lg opacity-70 hover:opacity-100"
                                          >
                                            <Trash2 className="w-3 h-3 text-red-400" />
                                          </Button>
                                        </div>
                                        </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              </div>
                            ))}

                            {/* Ungrouped Structures */}
                            {ungrouped.map((structure: any) => {
                              // Check if this structure is in preview mode
                              const isInPreview = previewStructureInfo?.targetName && 
                                structure.structureName.toLowerCase() === previewStructureInfo.targetName.toLowerCase();
                              
                              return (
                                <div 
                                  key={structure.roiNumber}
                                  className={`flex items-center space-x-2 px-2 py-1.5 rounded-lg border-2 transition-all duration-200 backdrop-blur-sm ${
                                    selectedForEdit === structure.roiNumber
                                      ? 'border-green-500 bg-green-500/10 shadow-lg shadow-green-500/20' 
                                      : selectedStructures.has(structure.roiNumber) 
                                      ? 'border-yellow-500/60 bg-yellow-500/10' 
                                      : 'border-gray-700/50 bg-gray-800/30 hover:bg-gray-700/50'
                                  } ${
                                    isInPreview ? 'preview-structure-highlight' : ''
                                  }`}
                                >
                                <Checkbox
                                  checked={selectedStructures.has(structure.roiNumber)}
                                  onCheckedChange={(checked) => handleStructureSelection(structure.roiNumber, !!checked)}
                                  className="h-3 w-3 border-yellow-500/60 data-[state=checked]:bg-yellow-500"
                                />
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleStructureVisibilityToggle(structure.roiNumber)}
                                  className="p-0.5 h-5 w-5 hover:bg-gray-600/50 rounded-lg"
                                >
                                  {structureVisibility.get(structure.roiNumber) ?? true ? (
                                    <Eye className="w-3 h-3 text-blue-400" />
                                  ) : (
                                    <EyeOff className="w-3 h-3 text-gray-500" />
                                  )}
                                </Button>
                                <div 
                                  className="w-3 h-3 rounded border-2 border-gray-600/50"
                                  style={{ backgroundColor: `rgb(${structure.color.join(',')})` }}
                                />
                                <span 
                                  className="text-xs text-gray-100 font-medium flex-1 truncate cursor-pointer hover:text-green-400 transition-colors"
                                  onClick={() => handleStructureEditSelection(structure.roiNumber)}
                                >
                                  {structure.structureName}
                                </span>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleDeleteStructure(structure.roiNumber)}
                                  className="p-0.5 h-5 w-5 hover:bg-red-500/30 rounded-lg opacity-70 hover:opacity-100"
                                >
                                  <Trash2 className="w-3 h-3 text-red-400" />
                                </Button>
                              </div>
                              );
                            })}
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
      <Card className="bg-gray-950/90 backdrop-blur-xl border border-orange-500/30 rounded-xl overflow-hidden shadow-2xl shadow-black/50">
        <CardContent className="p-0">
          <Accordion type="single" collapsible defaultValue="window-level">
            <AccordionItem value="window-level" className="border-gray-800/50">
              <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-orange-500/10 backdrop-blur-sm">
                <div className="flex items-center text-gray-100 font-medium text-sm">
                  <Settings className="w-4 h-4 mr-2 text-orange-400" />
                  Window/Level
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-3 pb-3">
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
                        className="text-xs py-1 px-2 h-auto bg-orange-500/10 border border-orange-500/30 text-orange-400 hover:bg-orange-500/20 hover:text-orange-300 backdrop-blur-sm transition-all duration-200"
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

      {/* New Structure Dialog - Glassmorphic Styling */}
      <Dialog open={showNewStructureDialog} onOpenChange={setShowNewStructureDialog}>
        <DialogContent className="sm:max-w-[425px] bg-gray-900/80 backdrop-blur-xl border border-gray-700/50 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-white text-lg font-semibold">Create New Structure</DialogTitle>
            <DialogDescription className="text-gray-400">
              Add a new anatomical structure to the current RT Structure Set.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="structure-name" className="text-right text-gray-300">
                Name
              </Label>
              <Input
                id="structure-name"
                value={newStructureName}
                onChange={(e) => setNewStructureName(e.target.value)}
                className="col-span-3 bg-gray-800/50 border-gray-600/50 text-white placeholder-gray-500 focus:bg-gray-800/70 focus:border-green-500/50 backdrop-blur-sm"
                placeholder="e.g., LIVER, HEART, PTV"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="structure-color" className="text-right text-gray-300">
                Color
              </Label>
              <div className="col-span-3 flex items-center gap-2">
                <div className="relative">
                  <Input
                    id="structure-color"
                    type="color"
                    value={newStructureColor}
                    onChange={(e) => setNewStructureColor(e.target.value)}
                    className="w-20 h-10 p-1 cursor-pointer bg-gray-800/50 border-gray-600/50 rounded-lg"
                  />
                </div>
                <span className="text-sm text-gray-400 bg-gray-800/30 px-3 py-1 rounded-lg backdrop-blur-sm border border-gray-700/30">
                  {newStructureColor.toUpperCase()}
                </span>
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setShowNewStructureDialog(false);
                setNewStructureName('');
                setNewStructureColor('#FF0000');
              }}
              className="bg-gray-800/50 border-gray-600/50 text-gray-300 hover:bg-gray-700/50 hover:text-white backdrop-blur-sm"
            >
              Cancel
            </Button>
            <Button 
              onClick={handleCreateNewStructure}
              className="bg-green-600/20 border border-green-500/30 text-green-400 hover:bg-green-600/30 hover:text-green-300 backdrop-blur-sm transition-all duration-200"
            >
              Create Structure
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </TooltipProvider>
  );
}