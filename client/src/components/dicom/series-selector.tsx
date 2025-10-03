import { useState, useEffect, useMemo, useRef } from 'react';
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
import { Layers3, Palette, Settings, Search, Eye, EyeOff, Trash2, ChevronDown, ChevronRight, ChevronUp, Minimize2, FolderTree, X, Plus, Edit3, Link, Folder, ArrowUpDown, ArrowUp, ArrowDown, Anchor, ExternalLink, Bug, Loader2, AlertTriangle } from 'lucide-react';
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
  regAssociations?: Record<number, number[]>;
  regCtacSeriesIds?: number[];
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
  onRebuildFusionManifest?: () => void;
  onAllStructuresVisibilityChange?: (allVisible: boolean) => void;
  preventRTLoading?: boolean;
  localizationMode?: boolean;
  loadedRTSeriesId?: number | null;
  previewStructureInfo?: { targetName: string; isNewStructure: boolean } | null;
  highlightedStructures?: { inputs: string[]; output: string };
  secondaryLoadingStates?: Map<number, {progress: number, isLoading: boolean}>;
  currentlyLoadingSecondary?: number | null;
  fusionStatuses?: Map<number, { status: 'idle' | 'loading' | 'ready' | 'error'; error?: string | null }>;
  fusionCandidatesByPrimary?: Map<number, number[]>;
  fusionSiblingMap?: Map<number, Map<'PET' | 'MR', Map<number, number[]>>>;
}

export function SeriesSelector({
  series,
  selectedSeries,
  onSeriesSelect,
  windowLevel,
  onWindowLevelChange,
  studyId,
  studyIds,
  regAssociations,
  regCtacSeriesIds = [],
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
  onRebuildFusionManifest,
  onAllStructuresVisibilityChange,
  preventRTLoading = false,
  localizationMode = false,
  loadedRTSeriesId,
  previewStructureInfo,
  highlightedStructures = { inputs: [], output: '' },
  secondaryLoadingStates,
  currentlyLoadingSecondary,
  fusionStatuses,
  fusionCandidatesByPrimary,
  fusionSiblingMap,
}: SeriesSelectorProps) {
  
  // Debug logging removed for performance
  const [rtSeries, setRTSeries] = useState<any[]>([]);
  const [selectedRTSeries, setSelectedRTSeries] = useState<any>(null);
  const [structureVisibility, setStructureVisibility] = useState<Map<number, boolean>>(new Map());
  const [selectedStructures, setSelectedStructures] = useState<Set<number>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Map<string, boolean>>(new Map());
  const [allCollapsed, setAllCollapsed] = useState(false);
  const [groupingEnabled, setGroupingEnabled] = useState(true);
  const [hoveredRegSeries, setHoveredRegSeries] = useState<number | null>(null);
  const [otherSeriesExpanded, setOtherSeriesExpanded] = useState(false);
  const [accordionValues, setAccordionValues] = useState<string[]>(["series"]); // Control which accordion sections are open
  const [windowLevelExpanded, setWindowLevelExpanded] = useState(true); // Track window/level accordion state
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

  const seriesById = useMemo(() => {
    const map = new Map<number, DICOMSeries>();
    series.forEach((entry) => {
      if (!entry) return;
      const numericId = Number(entry.id);
      if (Number.isFinite(numericId)) {
        map.set(numericId, entry);
      }
    });
    return map;
  }, [series]);

  const getCandidatesForPrimary = (primaryId: number): number[] => {
    if (fusionCandidatesByPrimary && fusionCandidatesByPrimary.has(primaryId)) {
      return fusionCandidatesByPrimary.get(primaryId) ?? [];
    }
    const fallback = regAssociations?.[primaryId];
    if (Array.isArray(fallback)) {
      return fallback;
    }
    return [];
  };

  const formatSeriesLabel = (item: { seriesDescription?: string | null; seriesNumber?: number | null; id?: number }) => {
    const rawDescription = (item.seriesDescription || '').trim();
    const seriesNumber = typeof item.seriesNumber === 'number' ? `#${item.seriesNumber}` : null;
    const fallback = item.id != null ? `Series ${item.id}` : 'Series';
    const baseLabel = rawDescription.length
      ? (rawDescription.length > 60 ? `${rawDescription.slice(0, 57)}…` : rawDescription)
      : fallback;
    return seriesNumber ? `${seriesNumber} · ${baseLabel}` : baseLabel;
  };
  
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
  const rtSeriesLoadedRef = useRef<Set<number>>(new Set());
  
  useEffect(() => {
    if (preventRTLoading) {
      console.log('Skipping RT structure loading - handled by parent component');
      return;
    }
    
    const studyIdsToLoad = studyIds || (studyId ? [studyId] : []);
    if (studyIdsToLoad.length === 0) return;
    
    // Check if all studies are already loaded
    const needsLoading = studyIdsToLoad.some(id => !rtSeriesLoadedRef.current.has(id));
    if (!needsLoading) {
      console.log('RT series already loaded for all studies:', studyIdsToLoad);
      return;
    }
    
    let isCancelled = false;
    
    const loadRTSeries = async () => {
      try {
        const allRTSeries: any[] = [];
        
        // Load RT structures for each study (only once per study)
        for (const id of studyIdsToLoad) {
          if (isCancelled) break;
          
          // Skip if already loaded
          if (rtSeriesLoadedRef.current.has(id)) continue;
          
          const response = await fetch(`/api/studies/${id}/rt-structures`);
          if (response.ok) {
            const rtSeriesData = await response.json();
            allRTSeries.push(...rtSeriesData);
            rtSeriesLoadedRef.current.add(id); // Mark as loaded
          }
        }
        
        if (!isCancelled) {
          // De-duplicate by composite key id|seriesInstanceUID to avoid duplicates from patient-wide lookup
          const unique = new Map<string, any>();
          for (const rt of allRTSeries) {
            const key = `${Number(rt?.id) || 0}|${rt?.seriesInstanceUID || ''}`;
            if (!unique.has(key)) unique.set(key, rt);
          }
          const deduped = Array.from(unique.values());
          setRTSeries(deduped);
          console.log(`✅ Loaded RT series for studies: ${studyIdsToLoad.join(',')}`);
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
  }, [studyId, studyIds?.join(','), preventRTLoading]); // Stable dependency for studyIds array

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

  // Auto-select most recent RT structure set and sync with loadedRTSeriesId
  useEffect(() => {
    if (rtSeries.length > 0) {
      // If loadedRTSeriesId is provided, prioritize that
      if (loadedRTSeriesId) {
        const loadedSeries = rtSeries.find(s => s.id === loadedRTSeriesId);
        if (loadedSeries && (!selectedRTSeries || selectedRTSeries.id !== loadedRTSeriesId)) {
          console.log('Setting selectedRTSeries based on loadedRTSeriesId:', loadedRTSeriesId);
          setSelectedRTSeries(loadedSeries);
        }
      } 
      // Otherwise, auto-select the most recent RT structure set
      else if (!selectedRTSeries) {
        const mostRecentRT = rtSeries.reduce((latest, current) => {
          // Prefer by series date/time first, then by series number
          const latestDate = latest.seriesDate || latest.createdAt || '';
          const currentDate = current.seriesDate || current.createdAt || '';
          
          if (currentDate > latestDate) return current;
          if (currentDate === latestDate && (current.seriesNumber || 0) > (latest.seriesNumber || 0)) return current;
          return latest;
        });
        
        console.log(`🎯 Auto-selecting most recent RT structure set: ${mostRecentRT.seriesDescription} (ID: ${mostRecentRT.id})`);
        handleRTSeriesSelect(mostRecentRT);
      }
    }
  }, [loadedRTSeriesId, rtSeries, selectedRTSeries]);

  async function handleRTSeriesSelect(rtSeries: any) {
    try {
      setSelectedRTSeries(rtSeries);
      
      // Auto-expand structures accordion section when an RT structure set is selected
      setAccordionValues(prev => {
        if (!prev.includes('structures')) {
          return [...prev, 'structures'];
        }
        return prev;
      });
      
      // Load RT structure contours
      const response = await fetch(`/api/rt-structures/${rtSeries.id}/contours`);
      if (response.ok) {
        const rtStructData = await response.json();
        if (onRTStructureLoad) {
          onRTStructureLoad(rtStructData);
        }
      } else {
        console.error('Failed to fetch RT contours:', response.status);
      }
    } catch (error) {
      console.error('Error loading RT structure contours:', error);
    }
  }

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
              <Accordion 
                type="multiple" 
                value={accordionValues}
                onValueChange={setAccordionValues}
                className="h-full flex flex-col"
              >
            
            {/* Series Section */}
            <AccordionItem value="series" className="border-gray-800/50">
              <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-gray-800/30 backdrop-blur-sm">
                <div className="flex items-center text-gray-100 font-medium text-sm">
                  <Layers3 className="w-4 h-4 mr-2 text-blue-400" />
                  Series
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-3 pb-3">
                <div className="space-y-1 max-h-[40vh] overflow-y-auto">
                  {/* Organize series hierarchically */}
                  {(() => {
                    // Build top-level modality buckets
                    const modalityOf = (entry: DICOMSeries) => (entry.modality || '').toUpperCase();
                    const mrSeries = series.filter(s => modalityOf(s) === 'MR');
                    const ptSeries = series.filter(s => ['PT', 'PET', 'NM'].includes(modalityOf(s)));
                    const regSeries = series.filter(s => modalityOf(s) === 'REG');
                    const otherSeries = series.filter(s => !['CT', 'MR', 'PT', 'PET', 'NM', 'REG', 'RTSTRUCT'].includes(modalityOf(s)));

                    // Helper: choose a single Planning CT as the parent (if any CT exists)
                    const choosePlanningCT = () => {
                      const allCTSeries = series.filter(s => modalityOf(s) === 'CT');
                      if (allCTSeries.length === 0) return null;

                      // Gather signals
                      const assocArrays = regAssociations ? Object.values(regAssociations) : [];
                      const assocIdsFlat: number[] = assocArrays.flat();
                      const regPrimaryIds = new Set<number>(
                        regAssociations ? Object.keys(regAssociations).map(k => Number(k)).filter(n => Number.isFinite(n)) : []
                      );
                      const planningCTIds = new Set<number>((rtSeries || [])
                        .map((r: any) => Number(r?.referencedSeriesId))
                        .filter((id: number) => Number.isFinite(id))
                      );
                      const ptStudyIdsAll = new Set<number>(ptSeries.map(s => s.studyId));

                      // Score CTs with weighted criteria
                      const scoreCT = (ct: any) => {
                        let score = 0;
                        // Strong signal: referenced by RTSTRUCT
                        if (planningCTIds.has(ct.id)) score += 1000;
                        // Strong signal: is a REG primary
                        if (regPrimaryIds.has(ct.id)) score += 500 + (regAssociations?.[ct.id]?.length || 0) * 5;
                        // Prefer non-PET study CTs
                        if (!ptStudyIdsAll.has(ct.studyId)) score += 100;
                        // Avoid CTACs if provided by server
                        if (regCtacSeriesIds?.includes?.(ct.id)) score -= 200;
                        // Prefer larger image counts
                        score += Math.min(200, (ct.imageCount || 0));
                        return score;
                      };

                      // Pick best by score
                      const sorted = [...allCTSeries].sort((a, b) => scoreCT(b) - scoreCT(a));
                      return sorted[0] || null;
                    };

                    const mainCT = choosePlanningCT();
                    const ctSeriesTop = mainCT ? [mainCT] : [];

                    // Determine primary list: if any CT exists, the single Planning CT is the parent; otherwise fallback
                    const primarySeries = ctSeriesTop.length > 0
                      ? ctSeriesTop
                      : (mrSeries.length > 0 ? mrSeries : (ptSeries.length > 0 ? ptSeries : otherSeries));

                    return (
                      <>
                        {/* Primary Series (CT, MR, PT, or others) */}
                        {primarySeries.map((seriesItem) => {
                          const candidateIds = getCandidatesForPrimary(seriesItem.id);
                          const candidateSet = new Set<number>(candidateIds);
                          const candidateSetWithPrimary = new Set<number>(candidateSet);
                          candidateSetWithPrimary.add(seriesItem.id);

                          const perPrimarySiblingMap = fusionSiblingMap?.get(seriesItem.id);
                          const petMapForPrimary = perPrimarySiblingMap?.get('PET');
                          const mrMapForPrimary = perPrimarySiblingMap?.get('MR');

                          const ctIdsLinkedToPet = new Set<number>();
                          petMapForPrimary?.forEach((ctList) => {
                            ctList.forEach((ctId) => {
                              if (Number.isFinite(ctId)) ctIdsLinkedToPet.add(ctId);
                            });
                          });

                          const explicitMrAssoc = mrSeries.filter((s) => candidateSet.has(s.id));
                          const mrAssoc = explicitMrAssoc.length > 0 ? explicitMrAssoc : mrSeries;

                          let ptAssoc: DICOMSeries[] = [];
                          if (petMapForPrimary && petMapForPrimary.size) {
                            ptAssoc = Array.from(petMapForPrimary.keys())
                              .map((petId) => seriesById.get(petId))
                              .filter((entry): entry is DICOMSeries => Boolean(entry));
                          }
                          if (!ptAssoc.length) {
                            const explicitPtAssoc = ptSeries.filter((s) => candidateSet.has(s.id));
                            ptAssoc = explicitPtAssoc.length > 0 ? explicitPtAssoc : ptSeries;
                          }

                          const additionalMrAssoc: DICOMSeries[] = [];
                          if (mrMapForPrimary && mrMapForPrimary.size) {
                            mrMapForPrimary.forEach((linkedIds, mrId) => {
                              const mrEntry = seriesById.get(mrId);
                              if (mrEntry && !additionalMrAssoc.includes(mrEntry)) {
                                additionalMrAssoc.push(mrEntry);
                              }
                              linkedIds.forEach((linkedId) => {
                                const linkedEntry = seriesById.get(linkedId);
                                if (
                                  linkedEntry &&
                                  linkedEntry.modality &&
                                  (linkedEntry.modality.toUpperCase() === 'MR' || linkedEntry.modality.toUpperCase() === 'PT' || linkedEntry.modality.toUpperCase() === 'PET') &&
                                  !additionalMrAssoc.includes(linkedEntry)
                                ) {
                                  additionalMrAssoc.push(linkedEntry);
                                }
                              });
                            });
                          }

                          const fusionReadyMr = Array.from(new Map([...mrAssoc, ...additionalMrAssoc].map((entry) => [entry.id, entry])).values());

                          const ctCandidatesForPet = series.filter(
                            (s) => modalityOf(s) === 'CT' && candidateSetWithPrimary.has(s.id),
                          );

                          const hasExplicitPetCandidates = Boolean(petMapForPrimary && petMapForPrimary.size);

                          const registeredCtAssoc = series.filter((s) => {
                            if (modalityOf(s) !== 'CT') return false;
                            if (!candidateSet.has(s.id)) return false;
                            if (ctIdsLinkedToPet.has(s.id)) return false;
                            if (ptAssoc.length && ptAssoc.some((pet) => Number(pet.studyId) === Number(s.studyId))) return false;
                            return true;
                          });
                          return (
                            <div key={seriesItem.id}>
                            <div
                              className={`
                                p-2 rounded-lg border cursor-pointer transition-all duration-200 backdrop-blur-sm
                                ${selectedSeries?.id === seriesItem.id
                                  ? 'bg-blue-500/20 border-blue-400/50 shadow-lg shadow-blue-500/20'
                                  : hoveredRegSeries && (ctSeriesTop.length > 0 || mrSeries.length > 0 || ptSeries.length > 0)
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
                                  {modalityOf(seriesItem) === 'CT' && ctSeriesTop.length > 0 && seriesItem.id === ctSeriesTop[0].id ? ' • Planning' : ''}
                                </Badge>
                                <span className="text-xs text-gray-400">
                                  {seriesItem.imageCount} images
                                </span>
                              </div>
                              
                              <h4 className={`
                                text-sm font-medium truncate
                                ${selectedSeries?.id === seriesItem.id ? 'text-blue-400' : 'text-white'}
                              `}>
                                {formatSeriesLabel(seriesItem)}
                              </h4>
                            </div>

                            {/* Always show nested items under CT series */}
                            <div className="ml-4 mt-2 space-y-1">
                              {/* Registered CT secondaries (REG-derived only; PET/CT CTs are shown under PET) */}
                              {(() => {
                                if (registeredCtAssoc.length === 0) return null;
                                return (
                                  <div className="space-y-1 border-l-2 border-blue-500/30 pl-3">
                                    <div className="text-xs text-blue-300 mb-1">Registered CT</div>
                                    {registeredCtAssoc.map((ctS) => {
                                      const loadingState = secondaryLoadingStates?.get(ctS.id);
                                      const fusionStatus = fusionStatuses?.get(ctS.id);
                                      const isLoading = Boolean(loadingState?.isLoading || fusionStatus?.status === 'loading');
                                      const isReady = fusionStatus?.status === 'ready';
                                      const hasError = fusionStatus?.status === 'error';
                                      const progress = Math.max(0, Math.min(100, loadingState?.progress ?? 0));
                                      const statusLabel = hasError
                                        ? `Fusion failed${fusionStatus?.error ? `: ${fusionStatus.error}` : ''}`
                                        : isLoading
                                          ? `Preparing overlay${progress ? ` (${Math.round(progress)}%)` : ''}`
                                          : isReady
                                            ? 'Activate fusion overlay'
                                            : 'Fusion overlay unavailable';
                                      const buttonDisabled = !isReady;

                                      return (
                                        <div
                                          key={ctS.id}
                                          className={`relative overflow-hidden w-full p-2 text-left text-xs rounded-lg transition-all border ${
                                            secondarySeriesId === ctS.id
                                              ? 'bg-blue-500/40 border-blue-400 shadow-lg shadow-blue-500/30'
                                              : hasError
                                                ? 'bg-amber-900/20 border-amber-500/40'
                                                : 'bg-blue-600/10 border-blue-500/30 hover:bg-blue-600/20'
                                          }`}
                                        >
                                          {isLoading && (
                                            <div
                                              className="absolute inset-0 bg-gradient-to-r from-cyan-500/30 to-cyan-400/10 transition-all duration-300"
                                              style={{ width: `${progress}%` }}
                                            />
                                          )}
                                          <div className="relative z-10 flex items-center justify-between">
                                            <div className="flex items-center space-x-2 flex-1">
                                              <Badge variant="outline" className="border-blue-500 text-blue-400 text-xs font-semibold">CT</Badge>
                                              <span className="truncate text-xs">
                                                {formatSeriesLabel(ctS)} ({ctS.imageCount} images)
                                              </span>
                                            </div>
                                            {onSecondarySeriesSelect && (
                                              <Button
                                                size="icon"
                                                variant="ghost"
                                                className={`h-6 w-6 ${isLoading ? 'cursor-wait' : hasError ? 'hover:bg-amber-700/30' : 'hover:bg-green-700/30'}`}
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  // Only rebuild manifest if not ready yet
                                                  if (!isReady && onRebuildFusionManifest) {
                                                    onRebuildFusionManifest();
                                                  }
                                                  onSecondarySeriesSelect(ctS.id);
                                                }}
                                                title={isReady ? statusLabel : 'Click to initialize fusion'}
                                                disabled={false}
                                              >
                                                {isLoading ? (
                                                  <Loader2 className="h-3.5 w-3.5 animate-spin text-green-200" />
                                                ) : hasError ? (
                                                  <AlertTriangle className="h-3.5 w-3.5 text-amber-300" />
                                                ) : (
                                                  <Anchor className="h-3.5 w-3.5 text-green-300" />
                                                )}
                                              </Button>
                                            )}
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                );
                              })()}
                              {/* RT Structure Series nested under CT - only show those that reference this CT */}
                              {rtSeries && rtSeries.length > 0 && rtSeries.filter((rtS: any) => {
                                const isMatch = rtS.referencedSeriesId === seriesItem.id || (!rtS.referencedSeriesId && rtSeries.length === 1);
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
                              
                              {/* Registration and MR Series that can be fused (REG-preferred; fallback: all MR) */}
                              {(() => {
                                if (fusionReadyMr.length === 0) return null;
                                return (
                                 <div className="space-y-1 border-l-2 border-purple-500/30 pl-3">
                                   <div className="text-xs text-purple-300 mb-1 flex items-center gap-1">
                                     <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                       <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                     </svg>
                                     Fusion-ready MRI (Registered)
                                   </div>
                                   
                                   {/* MR Series that can be fused */}
                                   {fusionReadyMr.map((mrS) => {
                                     const loadingState = secondaryLoadingStates?.get(mrS.id);
                                     const isCurrentlyLoading = currentlyLoadingSecondary === mrS.id;
                                     const progress = Math.max(0, Math.min(100, loadingState?.progress ?? 0));
                                     const fusionStatus = fusionStatuses?.get(mrS.id);
                                     const isReady = fusionStatus?.status === 'ready';
                                     const hasError = fusionStatus?.status === 'error';
                                     const isLoading = Boolean(loadingState?.isLoading || isCurrentlyLoading || fusionStatus?.status === 'loading');
                                     const statusLabel = hasError
                                       ? `Fusion failed${fusionStatus?.error ? `: ${fusionStatus.error}` : ''}`
                                       : isLoading
                                         ? `Preparing overlay${progress ? ` (${Math.round(progress)}%)` : ''}`
                                         : isReady
                                           ? 'Enable fusion overlay'
                                           : 'Fusion overlay unavailable';

                                     return (
                                     <div
                                       key={mrS.id}
                                       className={`
                                         relative overflow-hidden w-full p-2 text-left text-xs rounded-lg transition-all
                                         ${secondarySeriesId === mrS.id
                                           ? 'bg-purple-500/40 border-purple-400 shadow-lg ring-2 ring-purple-400/50'
                                           : selectedSeries?.id === mrS.id
                                           ? 'bg-purple-500/20 border-purple-500 shadow-lg'
                                           : hoveredRegSeries
                                           ? 'bg-green-500/10 border-green-500/50 shadow-md'
                                           : hasError
                                           ? 'bg-amber-900/20 border-amber-500/40'
                                           : 'bg-purple-600/10 border-purple-500/30 hover:bg-purple-600/20'
                                         } border
                                       `}
                                      onClick={() => {
                                        if (!isReady) return;
                                        if (onSecondarySeriesSelect) onSecondarySeriesSelect(mrS.id);
                                      }}
                                     >
                                       {/* Loading progress background */}
                                       {isLoading && (
                                         <div 
                                           className="absolute inset-0 bg-gradient-to-r from-green-500/40 to-green-500/10 transition-all duration-300"
                                           style={{ width: `${progress}%` }}
                                         />
                                       )}
                                       
                                         <div className="relative z-10 flex items-center justify-between">
                                           <div className="flex items-center space-x-2 flex-1">
                                             <Badge variant="outline" className="border-purple-500 text-purple-400 text-xs font-semibold">
                                               MR
                                             </Badge>
                                             <span className="truncate text-xs">
                                               {formatSeriesLabel(mrS)} ({mrS.imageCount} images)
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
                                                    className={`h-6 w-6 ${isLoading ? 'cursor-wait' : hasError ? 'hover:bg-amber-700/30' : 'hover:bg-green-700/30'}`}
                                                    disabled={false}
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      // Only rebuild manifest if not ready yet
                                                      if (!isReady && onRebuildFusionManifest) {
                                                        onRebuildFusionManifest();
                                                      }
                                                      if (onSecondarySeriesSelect) {
                                                        onSecondarySeriesSelect(mrS.id);
                                                      }
                                                    }}
                                                    title={isReady ? statusLabel : 'Click to initialize fusion'}
                                                  >
                                                    {isLoading ? (
                                                      <Loader2 className="h-3.5 w-3.5 animate-spin text-green-200" />
                                                    ) : hasError ? (
                                                      <AlertTriangle className="h-3.5 w-3.5 text-amber-300" />
                                                    ) : (
                                                      <Anchor className="h-3.5 w-3.5 text-green-300" />
                                                    )}
                                                  </Button>
                                                </TooltipTrigger>
                                                <TooltipContent className="bg-gradient-to-r from-green-500/90 to-emerald-500/90 backdrop-blur-xl border-green-400/50 text-white">
                                                  <p className="font-medium">{statusLabel}</p>
                                                  {isLoading && (
                                                    <p className="text-[10px] opacity-80">Preparing fused MRI…</p>
                                                  )}
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
                                   );
                                   })}
                                 </div>
                                );
                              })()}
                              
                              {/* PET Series that can be fused with CT (REG preferred; fallback: all PET for patient) */}
                              {(() => {
                                if (ptAssoc.length === 0) return null;
                                return (
                                  <div className="space-y-1 border-l-2 border-yellow-500/30 pl-3">
                                    <div className="text-xs text-yellow-300 mb-1 flex items-center gap-1">
                                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                      </svg>
                                      PET/CT Fusion
                                    </div>
                                    
                                    {/* PT + Related CT cards as siblings */}
                                   {ptAssoc.flatMap((ptS) => {
                                     const ptStudyIdNumber = Number(ptS?.studyId);
                                     let ctSiblings: DICOMSeries[] = [];

                                     const linkedCtIds = petMapForPrimary?.get(ptS.id) ?? null;
                                     if (linkedCtIds && linkedCtIds.length) {
                                       ctSiblings = linkedCtIds
                                         .map((ctId) => (Number.isFinite(ctId) ? seriesById.get(Number(ctId)) : undefined))
                                         .filter((entry): entry is DICOMSeries => Boolean(entry))
                                         .filter((ctEntry) => ctEntry.id !== seriesItem.id);
                                     }

                                     if (!ctSiblings.length) {
                                       ctSiblings = series.filter((ctCandidate) => {
                                         if (modalityOf(ctCandidate) !== 'CT') return false;
                                         if (ctCandidate.id === seriesItem.id) return false;
                                         const ctStudyIdNumber = Number(ctCandidate?.studyId);
                                         if (!Number.isFinite(ptStudyIdNumber) || !Number.isFinite(ctStudyIdNumber)) {
                                           return false;
                                         }
                                         if (ctStudyIdNumber !== ptStudyIdNumber) return false;
                                         if (petMapForPrimary && petMapForPrimary.size && !candidateSetWithPrimary.has(ctCandidate.id)) {
                                           return false;
                                         }
                                         return true;
                                       });
                                     }
                                     const loadingState = secondaryLoadingStates?.get(ptS.id);
                                     const isCurrentlyLoading = currentlyLoadingSecondary === ptS.id;
                                     const fusionStatus = fusionStatuses?.get(ptS.id);
                                     const progress = Math.max(0, Math.min(100, loadingState?.progress ?? 0));
                                     const isLoading = Boolean(loadingState?.isLoading || isCurrentlyLoading || fusionStatus?.status === 'loading');
                                     const isReady = fusionStatus?.status === 'ready';
                                     const hasError = fusionStatus?.status === 'error';
                                     const statusLabel = hasError
                                       ? `Fusion failed${fusionStatus?.error ? `: ${fusionStatus.error}` : ''}`
                                       : isLoading
                                         ? (progress ? `Preparing overlay (${Math.round(progress)}%)` : 'Preparing overlay')
                                         : isReady
                                           ? 'Enable PET fusion'
                                           : 'Fusion overlay unavailable';

                                       const petCard = (
                                       <div
                                         key={`pt-${ptS.id}`}
                                         className={`
                                           relative overflow-hidden w-full p-2 text-left text-xs rounded-lg transition-all
                                           ${secondarySeriesId === ptS.id
                                             ? 'bg-yellow-500/40 border-yellow-400 shadow-lg ring-2 ring-yellow-400/50'
                                             : selectedSeries?.id === ptS.id
                                             ? 'bg-yellow-500/20 border-yellow-500 shadow-lg'
                                             : hasError
                                             ? 'bg-amber-900/20 border-amber-500/40'
                                             : hoveredRegSeries
                                             ? 'bg-green-500/10 border-green-500/50 shadow-md'
                                             : 'bg-yellow-600/10 border-yellow-500/30 hover:bg-yellow-600/20'
                                           } border
                                         `}
                                         onClick={() => {
                                           if (!isReady) return;
                                           if (onSecondarySeriesSelect) onSecondarySeriesSelect(ptS.id);
                                         }}
                                       >
                                         {/* Loading progress background */}
                                         {isLoading && (
                                           <div 
                                             className="absolute inset-0 bg-gradient-to-r from-yellow-500/40 to-yellow-500/10 transition-all duration-300"
                                             style={{ width: `${progress}%` }}
                                           />
                                         )}
                                         
                                         <div className="relative z-10 flex items-center justify-between">
                                           <div className="flex items-center space-x-2 flex-1">
                                             <Badge variant="outline" className="border-yellow-500 text-yellow-400 text-xs font-semibold">PT</Badge>
                                           <span className="truncate text-xs">{formatSeriesLabel(ptS)} ({ptS.imageCount} images)</span>
                                           </div>
                                           <div className="flex items-center gap-1">
                                             <Button size="icon" variant="ghost" className="h-6 w-6 hover:bg-yellow-700/30"
                                               onClick={(e) => { e.stopPropagation(); onSeriesSelect(ptS); if (onSecondarySeriesSelect) onSecondarySeriesSelect(null); }}
                                               title="View PET standalone">
                                               <ExternalLink className="h-3.5 w-3.5 text-yellow-300" />
                                             </Button>
                                             {secondarySeriesId === ptS.id ? (
                                               <Button
                                                 size="icon"
                                                 variant="ghost"
                                                 className="h-6 w-6 bg-green-600 hover:bg-green-700 animate-pulse"
                                                 onClick={(e) => { e.stopPropagation(); if (onSecondarySeriesSelect) onSecondarySeriesSelect(null); }}
                                                 title="Disable fusion"
                                               >
                                                 <Anchor className="h-3.5 w-3.5 text-white" />
                                               </Button>
                                             ) : (
                                               <TooltipProvider delayDuration={0}>
                                                 <Tooltip>
                                                   <TooltipTrigger asChild>
                                                     <Button
                                                       size="icon"
                                                       variant="ghost"
                                                       className={`h-6 w-6 ${isLoading ? 'cursor-wait' : hasError ? 'hover:bg-amber-700/30' : 'hover:bg-green-700/30'}`}
                                                       disabled={false}
                                                       onClick={(e) => {
                                                         e.stopPropagation();
                                                         // Only rebuild manifest if not ready yet
                                                         if (!isReady && onRebuildFusionManifest) {
                                                           onRebuildFusionManifest();
                                                         }
                                                         if (onSecondarySeriesSelect) onSecondarySeriesSelect(ptS.id);
                                                       }}
                                                       title={isReady ? statusLabel : 'Click to initialize fusion'}
                                                     >
                                                       {isLoading ? (
                                                         <Loader2 className="h-3.5 w-3.5 animate-spin text-green-200" />
                                                       ) : hasError ? (
                                                         <AlertTriangle className="h-3.5 w-3.5 text-amber-300" />
                                                       ) : (
                                                         <Anchor className="h-3.5 w-3.5 text-green-300" />
                                                       )}
                                                     </Button>
                                                   </TooltipTrigger>
                                                   <TooltipContent className="bg-gradient-to-r from-green-500/80 to-emerald-600/80 backdrop-blur-lg border-green-400/40 text-white">
                                                     <p className="text-xs font-semibold">{statusLabel}</p>
                                                     {isLoading ? (
                                                       <p className="text-[10px] opacity-80">Preparing fused PET…</p>
                                                     ) : isReady ? (
                                                       <p className="text-[10px] opacity-80">Projects PET signals onto the planning CT</p>
                                                     ) : null}
                                                   </TooltipContent>
                                                 </Tooltip>
                                               </TooltipProvider>
                                             )}
                                           </div>
                                         </div>
                                       </div>
                                     );

                                     const ctCards = ctSiblings.map((ctS) => {
                                       const rtForCt = (rtSeries || []).filter((rtS: any) => rtS.referencedSeriesId === ctS.id);
                                       const loadingState = secondaryLoadingStates?.get(ctS.id);
                                       const isCurrentlyLoading = currentlyLoadingSecondary === ctS.id;
                                       const progress = Math.max(0, Math.min(100, loadingState?.progress ?? 0));
                                       const fusionStatusCt = fusionStatuses?.get(ctS.id);
                                       const isReadyCt = fusionStatusCt?.status === 'ready';
                                       const hasErrorCt = fusionStatusCt?.status === 'error';
                                       const isLoadingCt = Boolean(loadingState?.isLoading || isCurrentlyLoading || fusionStatusCt?.status === 'loading');
                                       const statusLabelCt = hasErrorCt
                                         ? `Fusion failed${fusionStatusCt?.error ? `: ${fusionStatusCt.error}` : ''}`
                                         : isLoadingCt
                                           ? (progress ? `Preparing overlay (${Math.round(progress)}%)` : 'Preparing overlay')
                                           : isReadyCt
                                             ? 'Activate fusion overlay'
                                             : 'Fusion overlay unavailable';

                                       return (
                                         <div key={`ptct-${ptS.id}-${ctS.id}`} className="space-y-1">
                                           <div
                                             className={`relative overflow-hidden w-full p-2 text-left text-xs rounded-lg transition-all border ${
                                               secondarySeriesId === ctS.id
                                                 ? 'bg-blue-500/40 border-blue-300 shadow-lg ring-2 ring-blue-300/50'
                                                 : selectedSeries?.id === ctS.id
                                                   ? 'bg-blue-500/25 border-blue-300 shadow-lg'
                                                   : hasErrorCt
                                                     ? 'bg-amber-900/20 border-amber-500/40'
                                                     : 'bg-blue-500/15 border-blue-400/50 hover:bg-blue-500/20'
                                             }`}
                                             onClick={(e) => {
                                               e.stopPropagation();
                                               if (!isReadyCt) return;
                                               if (onSecondarySeriesSelect) onSecondarySeriesSelect(ctS.id);
                                             }}
                                           >
                                             {isLoadingCt && (
                                               <div
                                                 className="absolute inset-0 bg-gradient-to-r from-blue-500/40 to-blue-500/10 transition-all duration-300"
                                                 style={{ width: `${progress}%` }}
                                               />
                                             )}

                                             <div className="relative z-10 flex items-center justify-between">
                                               <div className="flex items-center space-x-2 flex-1">
                                                 <Badge variant="outline" className="border-blue-400 text-blue-300 text-xs font-semibold">CT</Badge>
                                                 <span className="truncate text-xs">{formatSeriesLabel(ctS)} ({ctS.imageCount} images)</span>
                                               </div>
                                               <div className="flex items-center gap-1">
                                                 <Button
                                                   size="icon"
                                                   variant="ghost"
                                                   className="h-6 w-6 hover:bg-blue-700/30"
                                                   onClick={(e) => {
                                                     e.stopPropagation();
                                                     onSeriesSelect(ctS);
                                                     if (onSecondarySeriesSelect) onSecondarySeriesSelect(null);
                                                   }}
                                                   title="View CT standalone"
                                                 >
                                                   <ExternalLink className="h-3.5 w-3.5 text-blue-300" />
                                                 </Button>
                                                 {secondarySeriesId === ctS.id ? (
                                                   <Button
                                                     size="icon"
                                                     variant="ghost"
                                                     className="h-6 w-6 bg-green-600 hover:bg-green-700 animate-pulse"
                                                     onClick={(e) => {
                                                       e.stopPropagation();
                                                       if (onSecondarySeriesSelect) onSecondarySeriesSelect(null);
                                                     }}
                                                     title="Disable fusion"
                                                   >
                                                     <Anchor className="h-3.5 w-3.5 text-white" />
                                                   </Button>
                                                 ) : (
                                                   <Button
                                                     size="icon"
                                                     variant="ghost"
                                                     className={`h-6 w-6 ${isReadyCt ? 'hover:bg-green-700/30' : 'cursor-not-allowed opacity-60'}`}
                                                     disabled={!isReadyCt}
                                                     onClick={(e) => {
                                                       e.stopPropagation();
                                                       if (onRebuildFusionManifest) {
                                                         onRebuildFusionManifest();
                                                       }
                                                       if (onSecondarySeriesSelect) onSecondarySeriesSelect(ctS.id);
                                                     }}
                                                     title={statusLabelCt}
                                                   >
                                                     {isLoadingCt ? (
                                                       <Loader2 className="h-3.5 w-3.5 animate-spin text-green-200" />
                                                     ) : hasErrorCt ? (
                                                       <AlertTriangle className="h-3.5 w-3.5 text-amber-300" />
                                                     ) : (
                                                       <Anchor className="h-3.5 w-3.5 text-green-300" />
                                                     )}
                                                   </Button>
                                                 )}
                                               </div>
                                             </div>
                                             {rtForCt.length > 0 && (
                                               <div className="mt-2 pt-1 space-y-1 border-t border-green-500/20">
                                                 {rtForCt.map((rtS: any) => (
                                                   <Button
                                                     key={rtS.id}
                                                     variant={selectedRTSeries?.id === rtS.id ? 'default' : 'ghost'}
                                                     className={`w-full p-2 h-auto text-left justify-start text-xs ${
                                                       selectedRTSeries?.id === rtS.id
                                                         ? 'bg-green-600 text-white border-green-500'
                                                         : 'hover:bg-green-600/20 text-gray-300 border-green-500/30'
                                                     } border rounded-md`}
                                                     onClick={() => handleRTSeriesSelect(rtS)}
                                                   >
                                                     <div className="flex items-center space-x-2">
                                                       <Badge variant="outline" className="border-green-500 text-green-400 text-xs font-semibold">RT</Badge>
                                                       <span className="truncate text-xs">{rtS.seriesDescription || 'Structure Set'}</span>
                                                     </div>
                                                   </Button>
                                                 ))}
                                               </div>
                                             )}
                                           </div>
                                         </div>
                                       );
                                     });
                                     return [petCard, ...ctCards];
                                   })}
                                  </div>
                                );
                              })()}
                            </div>
                            </div>
                          );
                        })}
                        
                        {/* MR Series as standalone when no CT present */}
                        {ctSeriesTop.length === 0 && mrSeries.length > 0 && mrSeries.map((seriesItem) => (
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
                                {formatSeriesLabel(seriesItem)}
                              </h4>
                            </div>
                          </div>
                        ))}
                        
                        {/* Other modalities grouped under collapsible dropdown */}
                        {primarySeries !== otherSeries && otherSeries.length > 0 && (
                          <div className="mt-4">
                            {/* Other Series Header */}
                            <div
                              className="flex items-center space-x-2 px-3 py-2 rounded-lg bg-gray-800/30 border border-gray-700/30 cursor-pointer hover:bg-gray-700/40 transition-colors"
                              onClick={() => setOtherSeriesExpanded(!otherSeriesExpanded)}
                            >
                              {otherSeriesExpanded ? (
                                <ChevronDown className="w-4 h-4 text-gray-400" />
                              ) : (
                                <ChevronRight className="w-4 h-4 text-gray-400" />
                              )}
                              <span className="text-sm text-gray-300 font-medium">
                                Other ({otherSeries.length})
                              </span>
                            </div>
                            
                            {/* Collapsible Content */}
                            {otherSeriesExpanded && (
                              <div className="mt-2 ml-4 space-y-1">
                                {otherSeries.map((seriesItem) => (
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
                                {formatSeriesLabel(seriesItem)}
                              </h4>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                        
                        {/* Registration Series - Simple pill-shaped display */}
                        {/* Registration series are hidden from the selection list now that associations drive fusion */}
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
                  <div className={`space-y-3 flex flex-col overflow-y-auto pb-4 ${
                    windowLevelExpanded ? 'max-h-[55vh]' : 'max-h-[85vh]'
                  }`}>
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
                    <div className={`space-y-1 overflow-y-auto pb-4 ${
                      windowLevelExpanded ? 'max-h-[40vh]' : 'max-h-[65vh]'
                    }`}>
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
                            
                            // Check if this is an input or output structure
                            const isInput = highlightedStructures.inputs.some(
                              input => input.toLowerCase() === structure.structureName.toLowerCase()
                            );
                            const isOutput = highlightedStructures.output.toLowerCase() === structure.structureName.toLowerCase();
                            
                            return (
                              <div 
                                key={structure.roiNumber}
                                className={`flex items-center space-x-2 px-2 py-1.5 rounded-lg border transition-all duration-200 backdrop-blur-sm ${
                                  isInput
                                    ? 'border-pink-500/60 bg-pink-500/20 shadow-lg shadow-pink-500/20'
                                    : isOutput
                                    ? 'border-yellow-400/60 bg-yellow-400/20 shadow-lg shadow-yellow-400/20'
                                    : selectedStructures.has(structure.roiNumber) 
                                    ? 'border-yellow-500/60 bg-yellow-500/10' 
                                    : 'border-gray-700/50 bg-gray-800/30'
                                } ${
                                  selectedForEdit === structure.roiNumber
                                    ? 'border-blue-500/60 bg-blue-500/10'
                                    : !isInput && !isOutput ? 'hover:bg-gray-700/50' : ''
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
                                        
                                        // Check if this is an input or output structure
                                        const isInput = highlightedStructures.inputs.some(
                                          input => input.toLowerCase() === structure.structureName.toLowerCase()
                                        );
                                        const isOutput = highlightedStructures.output.toLowerCase() === structure.structureName.toLowerCase();
                                        
                                        return (
                                          <div className="relative" key={`wrapper-${structure.roiNumber}`}>
                                            <div 
                                              className={`flex items-center space-x-2 px-2 py-1.5 rounded-lg border-2 transition-all duration-200 backdrop-blur-sm ${
                                              isInput
                                                ? 'border-pink-500 bg-pink-500/20 shadow-lg shadow-pink-500/20'
                                                : isOutput
                                                ? 'border-yellow-400 bg-yellow-400/20 shadow-lg shadow-yellow-400/20'
                                                : selectedForEdit === structure.roiNumber
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
                                        
                                        // Check if this is an input or output structure
                                        const isInput = highlightedStructures.inputs.some(
                                          input => input.toLowerCase() === structure.structureName.toLowerCase()
                                        );
                                        const isOutput = highlightedStructures.output.toLowerCase() === structure.structureName.toLowerCase();
                                        
                                        return (
                                          <div className="relative" key={`wrapper-nested-${structure.roiNumber}`}>
                                            <div 
                                              className={`flex items-center space-x-2 px-2 py-1.5 rounded-lg border-2 transition-all duration-200 backdrop-blur-sm ${
                                              isInput
                                                ? 'border-pink-500 bg-pink-500/20 shadow-lg shadow-pink-500/20'
                                                : isOutput
                                                ? 'border-yellow-400 bg-yellow-400/20 shadow-lg shadow-yellow-400/20'
                                                : selectedForEdit === structure.roiNumber
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
                              
                              // Check if this is an input or output structure
                              const isInput = highlightedStructures.inputs.some(
                                input => input.toLowerCase() === structure.structureName.toLowerCase()
                              );
                              const isOutput = highlightedStructures.output.toLowerCase() === structure.structureName.toLowerCase();
                              
                              return (
                                <div 
                                  key={structure.roiNumber}
                                  className={`flex items-center space-x-2 px-2 py-1.5 rounded-lg border-2 transition-all duration-200 backdrop-blur-sm ${
                                    isInput
                                      ? 'border-pink-500 bg-pink-500/20 shadow-lg shadow-pink-500/20'
                                      : isOutput
                                      ? 'border-yellow-400 bg-yellow-400/20 shadow-lg shadow-yellow-400/20'
                                      : selectedForEdit === structure.roiNumber
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
          <Accordion 
            type="single" 
            collapsible 
            defaultValue="window-level"
            onValueChange={(value) => {
              setWindowLevelExpanded(value === "window-level");
            }}
          >
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
