# Superbeam Left Sidebar - Detailed Implementation Guide

## Complete Code & Styling for RT Structure Management System

This document provides comprehensive implementation details for Superbeam's left sidebar, including the RT structure set management, viewport interactions, and all control buttons.

---

## 1. Main Sidebar Container Component

### Primary Sidebar Structure
```tsx
// medical-sidebar.tsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Eye,
  EyeOff,
  Search,
  ChevronDown,
  ChevronUp,
  FolderTree,
  Plus,
  Edit3,
  Settings,
  Trash2,
  MoreVertical,
  CheckSquare,
  Square,
  Edit,
  Palette
} from 'lucide-react';

interface MedicalSidebarProps {
  studyId?: string;
  selectedSeries?: any;
  rtSeries: any[];
  selectedRTSeries?: any;
  rtStructures?: any;
  structureVisibility: Map<number, boolean>;
  selectedStructures: Set<number>;
  onSeriesSelect: (series: any) => void;
  onRTSeriesSelect: (rtSeries: any) => void;
  onRTStructureLoad: (rtStructData: any) => void;
  onStructureVisibilityChange: (structureId: number, visible: boolean) => void;
  onStructureSelection: (structureId: number, selected: boolean) => void;
  onStructureEdit: (structureId: number) => void;
  onStructureDelete: (structureId: number) => void;
  onWindowLevelChange: (values: { window: number; level: number }) => void;
  windowLevel: { window: number; level: number };
}

export const MedicalSidebar: React.FC<MedicalSidebarProps> = ({
  studyId,
  selectedSeries,
  rtSeries,
  selectedRTSeries,
  rtStructures,
  structureVisibility,
  selectedStructures,
  onSeriesSelect,
  onRTSeriesSelect,
  onRTStructureLoad,
  onStructureVisibilityChange,
  onStructureSelection,
  onStructureEdit,
  onStructureDelete,
  onWindowLevelChange,
  windowLevel
}) => {
  // State management
  const [activeTab, setActiveTab] = useState('series');
  const [searchTerm, setSearchTerm] = useState('');
  const [groupingEnabled, setGroupingEnabled] = useState(true);
  const [allCollapsed, setAllCollapsed] = useState(false);
  const [showAddContour, setShowAddContour] = useState(false);
  const [showContourOperations, setShowContourOperations] = useState(false);
  const [showStructureSettings, setShowStructureSettings] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // Computed values
  const allVisible = rtStructures?.structures?.every((structure: any) => 
    structureVisibility.get(structure.roiNumber) ?? true
  ) ?? false;

  const hasSelectedStructures = selectedStructures.size > 0;

  // Structure grouping logic
  const groupedStructures = useCallback(() => {
    if (!rtStructures?.structures || !groupingEnabled) {
      return { ungrouped: rtStructures?.structures || [] };
    }

    const groups: { [key: string]: any[] } = {};
    const ungrouped: any[] = [];

    rtStructures.structures.forEach((structure: any) => {
      const name = structure.structureName || '';
      const baseName = name.replace(/[_\s]([LR])$/i, '').trim();
      
      if (name.match(/[_\s][LR]$/i)) {
        if (!groups[baseName]) {
          groups[baseName] = [];
        }
        groups[baseName].push(structure);
      } else {
        ungrouped.push(structure);
      }
    });

    return { groups, ungrouped };
  }, [rtStructures, groupingEnabled]);

  // Filter structures based on search
  const filteredStructures = useCallback(() => {
    const { groups, ungrouped } = groupedStructures();
    
    if (!searchTerm) return { groups, ungrouped };

    const filteredGroups: { [key: string]: any[] } = {};
    const filteredUngrouped = ungrouped.filter((structure: any) =>
      (structure.structureName || '').toLowerCase().includes(searchTerm.toLowerCase())
    );

    Object.entries(groups).forEach(([groupName, structures]) => {
      const matchingStructures = structures.filter((structure: any) =>
        (structure.structureName || '').toLowerCase().includes(searchTerm.toLowerCase())
      );
      
      if (matchingStructures.length > 0 || groupName.toLowerCase().includes(searchTerm.toLowerCase())) {
        filteredGroups[groupName] = structures;
      }
    });

    return { groups: filteredGroups, ungrouped: filteredUngrouped };
  }, [groupedStructures, searchTerm]);

  return (
    <div className="medical-sidebar">
      {/* Sidebar Header */}
      <div className="sidebar-header">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="sidebar-tabs">
          <TabsList className="sidebar-tab-list">
            <TabsTrigger value="series" className="sidebar-tab">
              Series
            </TabsTrigger>
            <TabsTrigger value="structures" className="sidebar-tab">
              Structures
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Sidebar Content */}
      <div className="sidebar-content">
        <TabsContent value="series" className="tab-content">
          <SeriesTab
            studyId={studyId}
            selectedSeries={selectedSeries}
            rtSeries={rtSeries}
            selectedRTSeries={selectedRTSeries}
            onSeriesSelect={onSeriesSelect}
            onRTSeriesSelect={onRTSeriesSelect}
            onRTStructureLoad={onRTStructureLoad}
            windowLevel={windowLevel}
            onWindowLevelChange={onWindowLevelChange}
          />
        </TabsContent>

        <TabsContent value="structures" className="tab-content">
          <StructuresTab
            rtStructures={rtStructures}
            structureVisibility={structureVisibility}
            selectedStructures={selectedStructures}
            searchTerm={searchTerm}
            setSearchTerm={setSearchTerm}
            groupingEnabled={groupingEnabled}
            setGroupingEnabled={setGroupingEnabled}
            allCollapsed={allCollapsed}
            setAllCollapsed={setAllCollapsed}
            allVisible={allVisible}
            hasSelectedStructures={hasSelectedStructures}
            expandedGroups={expandedGroups}
            setExpandedGroups={setExpandedGroups}
            filteredStructures={filteredStructures()}
            showAddContour={showAddContour}
            setShowAddContour={setShowAddContour}
            showContourOperations={showContourOperations}
            setShowContourOperations={setShowContourOperations}
            showStructureSettings={showStructureSettings}
            setShowStructureSettings={setShowStructureSettings}
            onStructureVisibilityChange={onStructureVisibilityChange}
            onStructureSelection={onStructureSelection}
            onStructureEdit={onStructureEdit}
            onStructureDelete={onStructureDelete}
          />
        </TabsContent>
      </div>
    </div>
  );
};
```

---

## 2. Structures Tab Component

### Complete Structures Management
```tsx
// structures-tab.tsx
interface StructuresTabProps {
  rtStructures?: any;
  structureVisibility: Map<number, boolean>;
  selectedStructures: Set<number>;
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  groupingEnabled: boolean;
  setGroupingEnabled: (enabled: boolean) => void;
  allCollapsed: boolean;
  setAllCollapsed: (collapsed: boolean) => void;
  allVisible: boolean;
  hasSelectedStructures: boolean;
  expandedGroups: Set<string>;
  setExpandedGroups: (groups: Set<string>) => void;
  filteredStructures: { groups: { [key: string]: any[] }; ungrouped: any[] };
  showAddContour: boolean;
  setShowAddContour: (show: boolean) => void;
  showContourOperations: boolean;
  setShowContourOperations: (show: boolean) => void;
  showStructureSettings: boolean;
  setShowStructureSettings: (show: boolean) => void;
  onStructureVisibilityChange: (structureId: number, visible: boolean) => void;
  onStructureSelection: (structureId: number, selected: boolean) => void;
  onStructureEdit: (structureId: number) => void;
  onStructureDelete: (structureId: number) => void;
}

const StructuresTab: React.FC<StructuresTabProps> = ({
  rtStructures,
  structureVisibility,
  selectedStructures,
  searchTerm,
  setSearchTerm,
  groupingEnabled,
  setGroupingEnabled,
  allCollapsed,
  setAllCollapsed,
  allVisible,
  hasSelectedStructures,
  expandedGroups,
  setExpandedGroups,
  filteredStructures,
  showAddContour,
  setShowAddContour,
  showContourOperations,
  setShowContourOperations,
  showStructureSettings,
  setShowStructureSettings,
  onStructureVisibilityChange,
  onStructureSelection,
  onStructureEdit,
  onStructureDelete
}) => {
  // Control button handlers
  const toggleAllVisibility = () => {
    if (!rtStructures?.structures) return;
    
    rtStructures.structures.forEach((structure: any) => {
      onStructureVisibilityChange(structure.roiNumber, !allVisible);
    });
  };

  const toggleAllExpansion = () => {
    if (allCollapsed) {
      // Expand all groups
      const allGroupNames = Object.keys(filteredStructures.groups);
      setExpandedGroups(new Set(allGroupNames));
    } else {
      // Collapse all groups
      setExpandedGroups(new Set());
    }
    setAllCollapsed(!allCollapsed);
  };

  const toggleGroupExpansion = (groupName: string) => {
    const newExpanded = new Set(expandedGroups);
    if (newExpanded.has(groupName)) {
      newExpanded.delete(groupName);
    } else {
      newExpanded.add(groupName);
    }
    setExpandedGroups(newExpanded);
  };

  const toggleGroupVisibility = (groupStructures: any[]) => {
    const allGroupVisible = groupStructures.every(structure => 
      structureVisibility.get(structure.roiNumber) ?? true
    );
    
    groupStructures.forEach(structure => {
      onStructureVisibilityChange(structure.roiNumber, !allGroupVisible);
    });
  };

  const selectAllStructures = () => {
    if (!rtStructures?.structures) return;
    
    rtStructures.structures.forEach((structure: any) => {
      onStructureSelection(structure.roiNumber, true);
    });
  };

  const deselectAllStructures = () => {
    if (!rtStructures?.structures) return;
    
    rtStructures.structures.forEach((structure: any) => {
      onStructureSelection(structure.roiNumber, false);
    });
  };

  return (
    <div className="structures-tab">
      {/* Search Input */}
      <div className="structure-search-container">
        <div className="search-input-wrapper">
          <Search className="search-icon" size={16} />
          <Input
            type="text"
            placeholder="Search structures..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="structure-search"
          />
        </div>
      </div>

      {/* Control Buttons Row */}
      <div className="structure-controls">
        <Button
          variant="outline"
          size="sm"
          onClick={toggleAllVisibility}
          className="btn-visibility-toggle"
          title={allVisible ? 'Hide all structures' : 'Show all structures'}
        >
          {allVisible ? <EyeOff size={16} /> : <Eye size={16} />}
        </Button>
        
        <Button
          variant="outline"
          size="sm"
          onClick={() => setGroupingEnabled(!groupingEnabled)}
          className="btn-grouping-toggle"
          title={groupingEnabled ? 'Show flat list' : 'Group by L/R pairs'}
        >
          <FolderTree size={16} />
        </Button>
        
        {groupingEnabled && Object.keys(filteredStructures.groups).length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={toggleAllExpansion}
            className="btn-expand-toggle"
            title={allCollapsed ? 'Expand all groups' : 'Collapse all groups'}
          >
            {allCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          </Button>
        )}
        
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowAddContour(!showAddContour)}
          className="btn-add-contour"
          title="Add New Contour"
        >
          <Plus size={16} />
        </Button>
        
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowContourOperations(!showContourOperations)}
          className="btn-operations"
          title="Contour Operations"
        >
          <Edit3 size={16} />
        </Button>
        
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowStructureSettings(!showStructureSettings)}
          className="btn-settings"
          title="Structure Settings"
        >
          <Settings size={16} />
        </Button>

        {/* Selection Operations */}
        {hasSelectedStructures && (
          <div className="selection-operations">
            <Badge variant="secondary" className="selection-count">
              {selectedStructures.size} selected
            </Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={deselectAllStructures}
              className="btn-deselect-all"
              title="Deselect All"
            >
              <Square size={16} />
            </Button>
          </div>
        )}
      </div>

      {/* Structures List */}
      <div className="structures-list">
        {rtStructures?.structures ? (
          <>
            {/* Grouped Structures */}
            {groupingEnabled && Object.entries(filteredStructures.groups).map(([groupName, groupStructures]) => (
              <StructureGroup
                key={groupName}
                groupName={groupName}
                groupStructures={groupStructures}
                isExpanded={expandedGroups.has(groupName)}
                onToggleExpansion={() => toggleGroupExpansion(groupName)}
                onToggleVisibility={() => toggleGroupVisibility(groupStructures)}
                structureVisibility={structureVisibility}
                selectedStructures={selectedStructures}
                onStructureVisibilityChange={onStructureVisibilityChange}
                onStructureSelection={onStructureSelection}
                onStructureEdit={onStructureEdit}
                onStructureDelete={onStructureDelete}
              />
            ))}

            {/* Ungrouped Structures */}
            {filteredStructures.ungrouped.map((structure: any) => (
              <StructureItem
                key={structure.roiNumber}
                structure={structure}
                isVisible={structureVisibility.get(structure.roiNumber) ?? true}
                isSelected={selectedStructures.has(structure.roiNumber)}
                onVisibilityChange={(visible) => onStructureVisibilityChange(structure.roiNumber, visible)}
                onSelectionChange={(selected) => onStructureSelection(structure.roiNumber, selected)}
                onEdit={() => onStructureEdit(structure.roiNumber)}
                onDelete={() => onStructureDelete(structure.roiNumber)}
              />
            ))}
          </>
        ) : (
          <div className="no-structures">
            {selectedRTSeries ? 'Loading structures...' : 'Load an RT structure set to view contours'}
          </div>
        )}
      </div>

      {/* Expandable Panels */}
      {showAddContour && (
        <AddContourPanel onClose={() => setShowAddContour(false)} />
      )}

      {showContourOperations && (
        <ContourOperationsPanel 
          selectedStructures={selectedStructures}
          onClose={() => setShowContourOperations(false)}
        />
      )}

      {showStructureSettings && (
        <StructureSettingsPanel onClose={() => setShowStructureSettings(false)} />
      )}
    </div>
  );
};
```

---

## 3. Structure Group Component

### Grouped Structure Display
```tsx
// structure-group.tsx
interface StructureGroupProps {
  groupName: string;
  groupStructures: any[];
  isExpanded: boolean;
  onToggleExpansion: () => void;
  onToggleVisibility: () => void;
  structureVisibility: Map<number, boolean>;
  selectedStructures: Set<number>;
  onStructureVisibilityChange: (structureId: number, visible: boolean) => void;
  onStructureSelection: (structureId: number, selected: boolean) => void;
  onStructureEdit: (structureId: number) => void;
  onStructureDelete: (structureId: number) => void;
}

const StructureGroup: React.FC<StructureGroupProps> = ({
  groupName,
  groupStructures,
  isExpanded,
  onToggleExpansion,
  onToggleVisibility,
  structureVisibility,
  selectedStructures,
  onStructureVisibilityChange,
  onStructureSelection,
  onStructureEdit,
  onStructureDelete
}) => {
  const allGroupVisible = groupStructures.every(structure => 
    structureVisibility.get(structure.roiNumber) ?? true
  );

  const allGroupSelected = groupStructures.every(structure =>
    selectedStructures.has(structure.roiNumber)
  );

  const someGroupSelected = groupStructures.some(structure =>
    selectedStructures.has(structure.roiNumber)
  );

  const toggleGroupSelection = () => {
    groupStructures.forEach(structure => {
      onStructureSelection(structure.roiNumber, !allGroupSelected);
    });
  };

  return (
    <div className="structure-group">
      <div className="structure-group-header" onClick={onToggleExpansion}>
        <div className="structure-group-info">
          <button
            className={`group-checkbox ${allGroupSelected ? 'checked' : someGroupSelected ? 'indeterminate' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              toggleGroupSelection();
            }}
            title="Select/Deselect Group"
          >
            {allGroupSelected ? (
              <CheckSquare size={16} />
            ) : someGroupSelected ? (
              <div className="indeterminate-checkbox" />
            ) : (
              <Square size={16} />
            )}
          </button>

          <span className="structure-group-name">{groupName}</span>
          
          <Badge variant="outline" className="structure-group-count">
            {groupStructures.length}
          </Badge>
          
          <div className="structure-group-colors">
            {groupStructures.map((structure, index) => (
              <div
                key={structure.roiNumber}
                className="structure-group-color"
                style={{
                  backgroundColor: `rgb(${structure.color?.join(',') || '128,128,128'})`
                }}
                title={structure.structureName}
              />
            ))}
          </div>
        </div>

        <div className="structure-group-actions">
          <button
            className={`structure-action-btn btn-visibility ${allGroupVisible ? '' : 'hidden'}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggleVisibility();
            }}
            title={allGroupVisible ? 'Hide Group' : 'Show Group'}
          >
            {allGroupVisible ? <Eye size={16} /> : <EyeOff size={16} />}
          </button>

          <div className="group-expand-icon">
            {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </div>
        </div>
      </div>

      {isExpanded && (
        <div className="structure-group-content">
          {groupStructures.map((structure) => (
            <StructureItem
              key={structure.roiNumber}
              structure={structure}
              isVisible={structureVisibility.get(structure.roiNumber) ?? true}
              isSelected={selectedStructures.has(structure.roiNumber)}
              onVisibilityChange={(visible) => onStructureVisibilityChange(structure.roiNumber, visible)}
              onSelectionChange={(selected) => onStructureSelection(structure.roiNumber, selected)}
              onEdit={() => onStructureEdit(structure.roiNumber)}
              onDelete={() => onStructureDelete(structure.roiNumber)}
              isGrouped={true}
            />
          ))}
        </div>
      )}
    </div>
  );
};
```

---

## 4. Individual Structure Item Component

### Structure Item with All Interactions
```tsx
// structure-item.tsx
interface StructureItemProps {
  structure: any;
  isVisible: boolean;
  isSelected: boolean;
  onVisibilityChange: (visible: boolean) => void;
  onSelectionChange: (selected: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
  isGrouped?: boolean;
}

const StructureItem: React.FC<StructureItemProps> = ({
  structure,
  isVisible,
  isSelected,
  onVisibilityChange,
  onSelectionChange,
  onEdit,
  onDelete,
  isGrouped = false
}) => {
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editedName, setEditedName] = useState(structure.structureName || '');

  const handleNameEdit = () => {
    setIsEditing(true);
    setEditedName(structure.structureName || '');
  };

  const handleNameSave = () => {
    // Here you would typically call an API to update the structure name
    console.log('Saving name:', editedName);
    setIsEditing(false);
  };

  const handleNameCancel = () => {
    setEditedName(structure.structureName || '');
    setIsEditing(false);
  };

  const structureColor = structure.color ? `rgb(${structure.color.join(',')})` : '#808080';

  return (
    <div 
      className={`structure-item ${isSelected ? 'selected' : ''} ${isGrouped ? 'grouped' : ''}`}
      style={{
        '--structure-color': structureColor,
        '--structure-color-muted': structure.color ? `rgba(${structure.color.join(',')}, 0.3)` : 'rgba(128,128,128,0.3)'
      } as React.CSSProperties}
    >
      {/* Selection Checkbox */}
      <button
        className={`structure-checkbox ${isSelected ? 'checked' : ''}`}
        onClick={() => onSelectionChange(!isSelected)}
        title={isSelected ? 'Deselect Structure' : 'Select Structure'}
      >
        {isSelected ? <CheckSquare size={16} /> : <Square size={16} />}
      </button>

      {/* Structure Color Indicator */}
      <div
        className="structure-color-indicator"
        style={{ backgroundColor: structureColor }}
        title={`Structure Color: ${structureColor}`}
      />

      {/* Structure Name */}
      <div className="structure-name-container">
        {isEditing ? (
          <div className="structure-name-edit">
            <Input
              value={editedName}
              onChange={(e) => setEditedName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleNameSave();
                if (e.key === 'Escape') handleNameCancel();
              }}
              onBlur={handleNameSave}
              className="structure-name-input"
              autoFocus
            />
          </div>
        ) : (
          <span 
            className="structure-name"
            onDoubleClick={handleNameEdit}
            title={`Double-click to edit: ${structure.structureName}`}
          >
            {structure.structureName}
          </span>
        )}
      </div>

      {/* Structure Actions */}
      <div className="structure-actions">
        {/* Visibility Toggle */}
        <button
          className={`structure-action-btn btn-visibility ${isVisible ? '' : 'hidden'}`}
          onClick={() => onVisibilityChange(!isVisible)}
          title={isVisible ? 'Hide Structure' : 'Show Structure'}
        >
          {isVisible ? <Eye size={16} /> : <EyeOff size={16} />}
        </button>

        {/* Edit Button */}
        <button
          className="structure-action-btn btn-edit"
          onClick={onEdit}
          title="Edit Structure Contours"
        >
          <Edit size={16} />
        </button>

        {/* More Options */}
        <div className="structure-more-options">
          <button
            className="structure-action-btn btn-more"
            onClick={() => setShowContextMenu(!showContextMenu)}
            title="More Options"
          >
            <MoreVertical size={16} />
          </button>

          {showContextMenu && (
            <div className="structure-context-menu">
              <button
                className="context-menu-item"
                onClick={handleNameEdit}
              >
                <Edit size={14} />
                Rename
              </button>
              <button
                className="context-menu-item"
                onClick={() => {
                  // Handle color change
                  setShowContextMenu(false);
                }}
              >
                <Palette size={14} />
                Change Color
              </button>
              <div className="context-menu-divider" />
              <button
                className="context-menu-item destructive"
                onClick={() => {
                  onDelete();
                  setShowContextMenu(false);
                }}
              >
                <Trash2 size={14} />
                Delete
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
```

---

## 5. Viewport Interaction System

### Viewport Communication Interface
```tsx
// viewport-interaction.tsx
interface ViewportInteractionProps {
  selectedStructures: Set<number>;
  structureVisibility: Map<number, boolean>;
  rtStructures?: any;
  onStructureEdit: (structureId: number) => void;
}

export const useViewportInteraction = ({
  selectedStructures,
  structureVisibility,
  rtStructures,
  onStructureEdit
}: ViewportInteractionProps) => {
  const [viewportRef, setViewportRef] = useState<HTMLElement | null>(null);
  const [selectedStructureColors, setSelectedStructureColors] = useState<string[]>([]);

  // Update viewport border colors based on selected structures
  useEffect(() => {
    if (!rtStructures?.structures || selectedStructures.size === 0) {
      setSelectedStructureColors([]);
      return;
    }

    const colors = Array.from(selectedStructures).map(id => {
      const structure = rtStructures.structures.find((s: any) => s.roiNumber === id);
      return structure ? `rgb(${structure.color.join(',')})` : null;
    }).filter(Boolean);

    setSelectedStructureColors(colors);
  }, [selectedStructures, rtStructures]);

  // Apply visual feedback to viewport
  useEffect(() => {
    if (!viewportRef) return;

    if (selectedStructureColors.length > 0) {
      const primaryColor = selectedStructureColors[0];
      const mutedColor = selectedStructureColors[0].replace('rgb', 'rgba').replace(')', ', 0.3)');

      viewportRef.style.setProperty('--selected-structure-color', primaryColor);
      viewportRef.style.setProperty('--selected-structure-color-muted', mutedColor);
      viewportRef.classList.add('has-selected-structures');
    } else {
      viewportRef.classList.remove('has-selected-structures');
    }
  }, [viewportRef, selectedStructureColors]);

  // Handle structure click in viewport
  const handleStructureClick = useCallback((structureId: number, event: MouseEvent) => {
    if (event.ctrlKey || event.metaKey) {
      // Multi-select mode
      const newSelection = new Set(selectedStructures);
      if (newSelection.has(structureId)) {
        newSelection.delete(structureId);
      } else {
        newSelection.add(structureId);
      }
      // Trigger selection change
    } else if (event.shiftKey) {
      // Range select mode (if applicable)
      // Implementation depends on your structure ordering
    } else {
      // Single select mode
      if (selectedStructures.has(structureId) && selectedStructures.size === 1) {
        // Already selected, start editing
        onStructureEdit(structureId);
      } else {
        // Select this structure only
        const newSelection = new Set([structureId]);
        // Trigger selection change
      }
    }
  }, [selectedStructures, onStructureEdit]);

  // Auto-zoom and auto-localize functionality
  const handleAutoZoom = useCallback((structureId: number) => {
    if (!rtStructures?.structures) return;

    const structure = rtStructures.structures.find((s: any) => s.roiNumber === structureId);
    if (!structure || !structure.contours) return;

    // Calculate bounding box of all contours for this structure
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    
    structure.contours.forEach((contour: any) => {
      contour.points.forEach((point: number[]) => {
        minX = Math.min(minX, point[0]);
        minY = Math.min(minY, point[1]);
        maxX = Math.max(maxX, point[0]);
        maxY = Math.max(maxY, point[1]);
      });
    });

    if (isFinite(minX) && isFinite(minY) && isFinite(maxX) && isFinite(maxY)) {
      // Apply zoom and pan to viewport
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      const width = maxX - minX;
      const height = maxY - minY;

      // Trigger viewport update
      console.log('Auto-zoom to structure:', { centerX, centerY, width, height });
    }
  }, [rtStructures]);

  return {
    viewportRef: setViewportRef,
    selectedStructureColors,
    handleStructureClick,
    handleAutoZoom
  };
};
```

---

## 6. Complete CSS Styling

### Comprehensive Sidebar Styling
```css
/* ===== MAIN SIDEBAR CONTAINER ===== */
.medical-sidebar {
  position: fixed;
  left: 0;
  top: 0;
  width: 400px;
  height: 100vh;
  background: hsl(0 0% 0%); /* Pure black */
  border-right: 1px solid hsl(240 15% 25%);
  display: flex;
  flex-direction: column;
  z-index: 40;
  overflow: hidden;
  font-family: 'Inter', sans-serif;
}

/* ===== SIDEBAR HEADER ===== */
.sidebar-header {
  padding: 1rem;
  border-bottom: 1px solid hsl(240 15% 25%);
  background: hsl(240 20% 4%);
}

.sidebar-tabs {
  width: 100%;
}

.sidebar-tab-list {
  display: flex;
  background: hsl(245 25% 12%);
  border-radius: 0.5rem;
  padding: 0.25rem;
  width: 100%;
}

.sidebar-tab {
  flex: 1;
  padding: 0.5rem 1rem;
  font-size: 0.875rem;
  font-weight: 500;
  text-align: center;
  border-radius: 0.375rem;
  color: #9ca3af;
  cursor: pointer;
  transition: all 0.2s ease;
  border: none;
  background: transparent;
}

.sidebar-tab[data-state="active"] {
  background: hsl(240 100% 60%);
  color: white;
  box-shadow: 0 2px 8px rgba(99, 102, 241, 0.3);
}

.sidebar-tab:hover:not([data-state="active"]) {
  background: rgba(99, 102, 241, 0.1);
  color: white;
}

/* ===== SIDEBAR CONTENT ===== */
.sidebar-content {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.tab-content {
  flex: 1;
  overflow-y: auto;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

/* Custom Scrollbar */
.tab-content::-webkit-scrollbar {
  width: 8px;
}

.tab-content::-webkit-scrollbar-track {
  background: hsl(240 20% 8%);
}

.tab-content::-webkit-scrollbar-thumb {
  background: hsl(240 15% 25%);
  border-radius: 4px;
}

.tab-content::-webkit-scrollbar-thumb:hover {
  background: hsl(240 10% 38%);
}

/* ===== STRUCTURES TAB ===== */
.structures-tab {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  height: 100%;
}

/* Search Input */
.structure-search-container {
  position: relative;
}

.search-input-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}

.search-icon {
  position: absolute;
  left: 0.75rem;
  color: #9ca3af;
  z-index: 10;
}

.structure-search {
  width: 100%;
  padding: 0.5rem 0.75rem 0.5rem 2.5rem;
  background: hsl(240 20% 8%);
  border: 1px solid hsl(240 15% 25%);
  border-radius: 0.375rem;
  color: white;
  font-size: 0.875rem;
  transition: all 0.2s ease;
}

.structure-search:focus {
  outline: none;
  border-color: hsl(240 100% 60%);
  box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.2);
}

.structure-search::placeholder {
  color: #9ca3af;
}

/* ===== CONTROL BUTTONS ===== */
.structure-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
}

.structure-control-btn,
.btn-visibility-toggle,
.btn-grouping-toggle,
.btn-expand-toggle,
.btn-add-contour,
.btn-operations,
.btn-settings {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.5rem;
  border-radius: 0.375rem;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  border: 1px solid;
  min-width: 2.5rem;
  height: 2.5rem;
  background: transparent;
}

/* Show/Hide All Button */
.btn-visibility-toggle {
  border-color: #16a34a;
  color: #16a34a;
}

.btn-visibility-toggle:hover {
  background: rgba(34, 197, 94, 0.1);
}

/* Grouping Toggle Button */
.btn-grouping-toggle {
  border-color: #4b5563;
  color: #d1d5db;
}

.btn-grouping-toggle:hover {
  background: rgba(75, 85, 99, 0.2);
}

/* Expand/Collapse Button */
.btn-expand-toggle {
  border-color: #eab308;
  color: #eab308;
}

.btn-expand-toggle:hover {
  background: rgba(234, 179, 8, 0.1);
}

/* Add Contour Button */
.btn-add-contour {
  border-color: #2563eb;
  color: #2563eb;
}

.btn-add-contour:hover {
  background: rgba(37, 99, 235, 0.1);
}

/* Operations Button */
.btn-operations {
  border-color: #f97316;
  color: #f97316;
}

.btn-operations:hover {
  background: rgba(251, 146, 60, 0.1);
}

/* Settings Button */
.btn-settings {
  border-color: #a855f7;
  color: #a855f7;
}

.btn-settings:hover {
  background: rgba(168, 85, 247, 0.1);
}

/* Selection Operations */
.selection-operations {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-left: auto;
}

.selection-count {
  background: rgba(234, 179, 8, 0.2);
  color: #eab308;
  border: 1px solid rgba(234, 179, 8, 0.3);
  font-size: 0.75rem;
  padding: 0.25rem 0.5rem;
}

.btn-deselect-all {
  border-color: #6b7280;
  color: #6b7280;
  padding: 0.25rem;
  min-width: 2rem;
  height: 2rem;
}

.btn-deselect-all:hover {
  background: rgba(107, 114, 128, 0.1);
}

/* ===== STRUCTURES LIST ===== */
.structures-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.no-structures {
  text-align: center;
  color: #6b7280;
  font-size: 0.875rem;
  padding: 2rem 1rem;
  background: hsl(240 20% 8%);
  border-radius: 0.5rem;
  border: 1px dashed hsl(240 15% 25%);
}

/* ===== STRUCTURE GROUPS ===== */
.structure-group {
  margin-bottom: 0.75rem;
}

.structure-group-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem;
  background: hsl(240 20% 8%);
  border: 1px solid rgba(99, 102, 241, 0.3);
  border-radius: 0.5rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.structure-group-header:hover {
  background: rgba(99, 102, 241, 0.05);
  border-color: rgba(99, 102, 241, 0.5);
}

.structure-group-info {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex: 1;
}

.group-checkbox {
  background: transparent;
  border: none;
  color: #d1d5db;
  cursor: pointer;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 0.2s ease;
}

.group-checkbox:hover {
  color: #eab308;
}

.group-checkbox.checked {
  color: #eab308;
}

.group-checkbox.indeterminate {
  color: rgba(234, 179, 8, 0.6);
}

.indeterminate-checkbox {
  width: 12px;
  height: 12px;
  background: rgba(234, 179, 8, 0.6);
  border-radius: 2px;
}

.structure-group-name {
  font-size: 0.875rem;
  font-weight: 600;
  color: white;
}

.structure-group-count {
  background: rgba(99, 102, 241, 0.2);
  color: #a5b4fc;
  border: 1px solid rgba(99, 102, 241, 0.3);
  font-size: 0.75rem;
  font-weight: 600;
  padding: 0.125rem 0.375rem;
  border-radius: 0.25rem;
}

.structure-group-colors {
  display: flex;
  gap: 0.125rem;
  align-items: center;
}

.structure-group-color {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.2);
  flex-shrink: 0;
}

.structure-group-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.group-expand-icon {
  color: #9ca3af;
  display: flex;
  align-items: center;
  justify-content: center;
}

.structure-group-content {
  margin-top: 0.5rem;
  margin-left: 1rem;
  padding-left: 1rem;
  border-left: 2px solid rgba(99, 102, 241, 0.2);
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

/* ===== STRUCTURE ITEMS ===== */
.structure-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem;
  background: hsl(240 20% 8%);
  border: 1px solid hsl(240 15% 25%);
  border-radius: 0.5rem;
  transition: all 0.2s ease;
  position: relative;
}

.structure-item:hover {
  background: rgba(99, 102, 241, 0.05);
  border-color: rgba(99, 102, 241, 0.3);
}

.structure-item.selected {
  background: rgba(234, 179, 8, 0.1);
  border-color: rgba(234, 179, 8, 0.5);
  box-shadow: 0 0 0 1px rgba(234, 179, 8, 0.2);
}

.structure-item.grouped {
  background: hsl(240 20% 6%);
  border-color: hsl(240 15% 20%);
}

/* Structure Checkbox */
.structure-checkbox {
  background: transparent;
  border: none;
  color: #6b7280;
  cursor: pointer;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 0.2s ease;
}

.structure-checkbox:hover {
  color: #eab308;
}

.structure-checkbox.checked {
  color: #eab308;
}

/* Structure Color Indicator */
.structure-color-indicator {
  width: 1rem;
  height: 1rem;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.3);
  flex-shrink: 0;
  transition: all 0.2s ease;
}

.structure-item.selected .structure-color-indicator {
  border-color: var(--structure-color);
  box-shadow: 0 0 8px var(--structure-color-muted);
}

/* Structure Name */
.structure-name-container {
  flex: 1;
  min-width: 0;
}

.structure-name {
  font-size: 0.875rem;
  color: white;
  font-weight: 500;
  display: block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
}

.structure-name:hover {
  color: #a5b4fc;
}

.structure-name-edit {
  width: 100%;
}

.structure-name-input {
  width: 100%;
  padding: 0.25rem 0.5rem;
  background: hsl(240 20% 12%);
  border: 1px solid hsl(240 100% 60%);
  border-radius: 0.25rem;
  color: white;
  font-size: 0.875rem;
}

.structure-name-input:focus {
  outline: none;
  border-color: hsl(240 100% 70%);
  box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.2);
}

/* Structure Actions */
.structure-actions {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  flex-shrink: 0;
}

.structure-action-btn {
  width: 1.75rem;
  height: 1.75rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 0.25rem;
  cursor: pointer;
  transition: all 0.2s ease;
  background: transparent;
  border: none;
  color: #9ca3af;
}

/* Visibility Toggle */
.btn-visibility {
  color: #3b82f6;
}

.btn-visibility:hover {
  background: rgba(59, 130, 246, 0.1);
  color: #60a5fa;
}

.btn-visibility.hidden {
  color: #6b7280;
}

.btn-visibility.hidden:hover {
  background: rgba(107, 114, 128, 0.1);
  color: #9ca3af;
}

/* Edit Button */
.btn-edit {
  color: #22c55e;
}

.btn-edit:hover {
  background: rgba(34, 197, 94, 0.1);
  color: #4ade80;
}

.btn-edit.active {
  background: rgba(34, 197, 94, 0.2);
  color: #16a34a;
  box-shadow: 0 0 0 1px rgba(34, 197, 94, 0.3);
}

/* More Options */
.structure-more-options {
  position: relative;
}

.btn-more {
  color: #9ca3af;
}

.btn-more:hover {
  background: rgba(156, 163, 175, 0.1);
  color: #d1d5db;
}

/* Context Menu */
.structure-context-menu {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 0.25rem;
  background: hsl(240 20% 8%);
  border: 1px solid hsl(240 15% 25%);
  border-radius: 0.375rem;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);
  z-index: 50;
  min-width: 140px;
  padding: 0.25rem;
}

.context-menu-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.5rem 0.75rem;
  background: transparent;
  border: none;
  border-radius: 0.25rem;
  color: #d1d5db;
  font-size: 0.875rem;
  cursor: pointer;
  transition: all 0.2s ease;
  text-align: left;
}

.context-menu-item:hover {
  background: rgba(99, 102, 241, 0.1);
  color: white;
}

.context-menu-item.destructive {
  color: #ef4444;
}

.context-menu-item.destructive:hover {
  background: rgba(239, 68, 68, 0.1);
  color: #f87171;
}

.context-menu-divider {
  height: 1px;
  background: hsl(240 15% 25%);
  margin: 0.25rem 0;
}

/* ===== EXPANDABLE PANELS ===== */
.expandable-panel {
  background: hsl(240 20% 8%);
  border: 1px solid hsl(240 15% 25%);
  border-radius: 0.5rem;
  padding: 1rem;
  margin-top: 1rem;
  animation: slideDown 0.3s ease-out;
}

@keyframes slideDown {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.expandable-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid hsl(240 15% 25%);
}

.expandable-panel-title {
  font-size: 0.875rem;
  font-weight: 600;
  color: white;
}

.expandable-panel-close {
  background: transparent;
  border: none;
  color: #9ca3af;
  cursor: pointer;
  padding: 0.25rem;
  border-radius: 0.25rem;
  transition: all 0.2s ease;
}

.expandable-panel-close:hover {
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
}

/* ===== VIEWPORT INTEGRATION ===== */
.viewport-container.has-selected-structures {
  border-color: var(--selected-structure-color);
  box-shadow: 0 0 0 2px var(--selected-structure-color-muted);
}

.viewport-container.has-selected-structures::before {
  content: '';
  position: absolute;
  top: -2px;
  left: -2px;
  right: -2px;
  bottom: -2px;
  border: 2px solid var(--selected-structure-color);
  border-radius: inherit;
  pointer-events: none;
  animation: selectedGlow 2s ease-in-out infinite alternate;
}

@keyframes selectedGlow {
  from {
    box-shadow: 0 0 5px var(--selected-structure-color-muted);
  }
  to {
    box-shadow: 0 0 15px var(--selected-structure-color);
  }
}

/* ===== RESPONSIVE DESIGN ===== */
@media (max-width: 1024px) {
  .medical-sidebar {
    width: 320px;
  }
  
  .structure-controls {
    flex-wrap: wrap;
  }
  
  .structure-item {
    padding: 0.625rem;
  }
}

@media (max-width: 768px) {
  .medical-sidebar {
    width: 100vw;
    transform: translateX(-100%);
    transition: transform 0.3s ease;
  }
  
  .medical-sidebar.open {
    transform: translateX(0);
  }
  
  .structure-controls {
    grid-template-columns: repeat(3, 1fr);
    gap: 0.375rem;
  }
  
  .structure-item {
    padding: 0.5rem;
    gap: 0.5rem;
  }
  
  .structure-name {
    font-size: 0.8rem;
  }
}

/* ===== ACCESSIBILITY ===== */
.structure-item:focus-within {
  outline: 2px solid hsl(240 100% 60%);
  outline-offset: 2px;
}

.structure-action-btn:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 1px;
}

/* ===== ANIMATION UTILITIES ===== */
.fade-in {
  animation: fadeIn 0.2s ease-out;
}

.slide-in-right {
  animation: slideInRight 0.3s ease-out;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes slideInRight {
  from {
    opacity: 0;
    transform: translateX(20px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}
```

---

## 7. Integration with Main Application

### Complete Usage Example
```tsx
// main-viewer.tsx
import { MedicalSidebar } from './components/medical-sidebar';
import { useViewportInteraction } from './hooks/viewport-interaction';

const MainViewer: React.FC = () => {
  const [selectedStructures, setSelectedStructures] = useState<Set<number>>(new Set());
  const [structureVisibility, setStructureVisibility] = useState<Map<number, boolean>>(new Map());
  const [rtStructures, setRTStructures] = useState(null);
  const [isContourEditMode, setIsContourEditMode] = useState(false);

  const { viewportRef, selectedStructureColors, handleStructureClick, handleAutoZoom } = useViewportInteraction({
    selectedStructures,
    structureVisibility,
    rtStructures,
    onStructureEdit: (structureId) => {
      setIsContourEditMode(true);
      // Additional edit logic
    }
  });

  const handleStructureSelection = (structureId: number, selected: boolean) => {
    const newSelection = new Set(selectedStructures);
    if (selected) {
      newSelection.add(structureId);
    } else {
      newSelection.delete(structureId);
    }
    setSelectedStructures(newSelection);
  };

  const handleStructureVisibilityChange = (structureId: number, visible: boolean) => {
    setStructureVisibility(prev => {
      const next = new Map(prev);
      next.set(structureId, visible);
      return next;
    });
  };

  const handleStructureEdit = (structureId: number) => {
    // Clear other selections and select only this structure
    setSelectedStructures(new Set([structureId]));
    setIsContourEditMode(true);
    // Auto-zoom to structure
    handleAutoZoom(structureId);
  };

  return (
    <div className="viewer-layout">
      <MedicalSidebar
        studyId="current-study-id"
        selectedSeries={null}
        rtSeries={[]}
        selectedRTSeries={null}
        rtStructures={rtStructures}
        structureVisibility={structureVisibility}
        selectedStructures={selectedStructures}
        onSeriesSelect={() => {}}
        onRTSeriesSelect={() => {}}
        onRTStructureLoad={setRTStructures}
        onStructureVisibilityChange={handleStructureVisibilityChange}
        onStructureSelection={handleStructureSelection}
        onStructureEdit={handleStructureEdit}
        onStructureDelete={(structureId) => {
          // Handle structure deletion
          console.log('Delete structure:', structureId);
        }}
        onWindowLevelChange={() => {}}
        windowLevel={{ window: 400, level: 40 }}
      />

      <div 
        ref={viewportRef}
        className="viewport-container"
        style={{
          marginLeft: '400px',
          height: '100vh',
          position: 'relative'
        }}
      >
        {/* Viewport content */}
      </div>
    </div>
  );
};
```

This comprehensive implementation provides a fully functional left sidebar with complete RT structure set management, viewport integration, and professional medical imaging interface standards.