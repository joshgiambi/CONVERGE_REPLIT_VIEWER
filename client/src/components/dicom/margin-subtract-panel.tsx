/**
 * MarginSubtractPanel - Clinical PTV Generation Tool
 * 
 * Implements the clinical workflow: (Source + Margin) - Avoidance
 * Uses the PolygonEngine for robust 2D slice-by-slice polygon operations.
 * 
 * Typical use case: Create PTV from GTV with 5mm margin, avoiding brainstem
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '@/components/ui/select';
import { 
  X, 
  Play, 
  Eye, 
  EyeOff, 
  Plus, 
  AlertCircle,
  CheckCircle2,
  Loader2,
  Minus,
  Target,
  Shield
} from 'lucide-react';
import { PolygonEngine, type PolygonEngineResult, type MarginSubtractOptions } from '@/lib/polygon-engine';
import type { RTStructure, RTContour } from '@/lib/dicom-types';

// ============================================================================
// Types
// ============================================================================

interface MarginSubtractPanelProps {
  isVisible: boolean;
  onClose: () => void;
  /** All available structures in the structure set */
  structures: RTStructure[];
  /** Callback when operation completes - receives new contours to apply */
  onApply: (
    targetInfo: { 
      name: string; 
      color: [number, number, number]; 
      isNew: boolean;
      sourceStructureId?: number;
    },
    contours: RTContour[]
  ) => void;
  /** Optional preview callback */
  onPreview?: (contours: RTContour[]) => void;
  /** Clear preview */
  onClearPreview?: () => void;
}

interface AvoidanceStructure {
  id: number;
  name: string;
}

// ============================================================================
// Component
// ============================================================================

export function MarginSubtractPanel({
  isVisible,
  onClose,
  structures,
  onApply,
  onPreview,
  onClearPreview
}: MarginSubtractPanelProps) {
  // Source structure selection
  const [sourceStructureId, setSourceStructureId] = useState<number | null>(null);
  
  // Margin settings
  const [marginMm, setMarginMm] = useState(5.0);
  const [joinType, setJoinType] = useState<'round' | 'miter' | 'square'>('round');
  
  // Avoidance structures (multiple)
  const [avoidanceStructures, setAvoidanceStructures] = useState<AvoidanceStructure[]>([]);
  const [selectedAvoidanceId, setSelectedAvoidanceId] = useState<string>('');
  
  // Output settings
  const [outputMode, setOutputMode] = useState<'new' | 'existing'>('new');
  const [outputName, setOutputName] = useState('');
  const [outputStructureId, setOutputStructureId] = useState<number | null>(null);
  const [outputColor, setOutputColor] = useState<[number, number, number]>([255, 255, 0]); // Yellow default
  
  // Processing state
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPreviewActive, setIsPreviewActive] = useState(false);
  const [lastResult, setLastResult] = useState<PolygonEngineResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  // Artifact filtering
  const [filterArtifacts, setFilterArtifacts] = useState(true);
  const [minAreaMm2, setMinAreaMm2] = useState(2.0);

  // Engine instance
  const engineRef = React.useRef(new PolygonEngine());

  // Auto-generate output name when source changes
  useEffect(() => {
    if (sourceStructureId && outputMode === 'new') {
      const source = structures.find(s => s.roiNumber === sourceStructureId);
      if (source) {
        const suffix = marginMm >= 0 ? `+${marginMm}mm` : `${marginMm}mm`;
        const avoidSuffix = avoidanceStructures.length > 0 
          ? `_minus_${avoidanceStructures.length}OARs` 
          : '';
        setOutputName(`${source.structureName}${suffix}${avoidSuffix}`);
      }
    }
  }, [sourceStructureId, marginMm, avoidanceStructures.length, outputMode, structures]);

  // Get available structures for selectors
  const structureOptions = structures.map(s => ({
    id: s.roiNumber,
    name: s.structureName,
    color: s.color
  }));

  // Available avoidance structures (exclude source and already selected)
  const availableAvoidanceStructures = structureOptions.filter(s => 
    s.id !== sourceStructureId && 
    !avoidanceStructures.some(a => a.id === s.id)
  );

  // Add avoidance structure
  const handleAddAvoidance = useCallback(() => {
    if (!selectedAvoidanceId) return;
    
    const id = parseInt(selectedAvoidanceId);
    const structure = structureOptions.find(s => s.id === id);
    
    if (structure) {
      setAvoidanceStructures(prev => [...prev, { id: structure.id, name: structure.name }]);
      setSelectedAvoidanceId('');
    }
  }, [selectedAvoidanceId, structureOptions]);

  // Remove avoidance structure
  const handleRemoveAvoidance = useCallback((id: number) => {
    setAvoidanceStructures(prev => prev.filter(a => a.id !== id));
  }, []);

  // Execute the operation
  const handleExecute = useCallback(async (isPreview: boolean = false) => {
    if (!sourceStructureId) {
      setError('Please select a source structure');
      return;
    }

    const source = structures.find(s => s.roiNumber === sourceStructureId);
    if (!source) {
      setError('Source structure not found');
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      const engine = engineRef.current;
      const options: MarginSubtractOptions = {
        marginMm,
        filterArtifacts,
        minAreaMm2,
        joinType
      };

      let result: PolygonEngineResult;

      if (avoidanceStructures.length === 0) {
        // Just margin, no subtraction
        result = await engine.createExpandedSubtractedStructure(source, null, options);
      } else if (avoidanceStructures.length === 1) {
        // Single avoidance
        const avoidance = structures.find(s => s.roiNumber === avoidanceStructures[0].id);
        result = await engine.createExpandedSubtractedStructure(source, avoidance || null, options);
      } else {
        // Multiple avoidances - process sequentially
        // First: source + margin
        result = await engine.createExpandedSubtractedStructure(source, null, options);
        
        // Then subtract each avoidance
        for (const avoid of avoidanceStructures) {
          if (!result.success || result.contours.length === 0) break;
          
          const avoidance = structures.find(s => s.roiNumber === avoid.id);
          if (!avoidance) continue;
          
          // Create temp structure from current result
          const tempStructure: RTStructure = {
            roiNumber: 0,
            structureName: 'temp',
            color: [255, 255, 0],
            contours: result.contours
          };
          
          result = await engine.createExpandedSubtractedStructure(
            tempStructure,
            avoidance,
            { ...options, marginMm: 0 } // No additional margin for subtraction
          );
          
          // Accumulate warnings
          if (result.warnings.length > 0) {
            console.warn('Warnings during subtraction:', result.warnings);
          }
        }
      }

      setLastResult(result);

      if (!result.success) {
        setError(result.warnings.join('; ') || 'Operation failed');
        return;
      }

      if (result.contours.length === 0) {
        setError('Operation produced no contours (structure may be completely subtracted)');
        return;
      }

      if (isPreview) {
        // Show preview
        if (onPreview) {
          onPreview(result.contours);
        }
        setIsPreviewActive(true);
      } else {
        // Apply the result
        const targetName = outputMode === 'new' 
          ? outputName 
          : structures.find(s => s.roiNumber === outputStructureId)?.structureName || outputName;
        
        onApply(
          {
            name: targetName,
            color: outputColor,
            isNew: outputMode === 'new',
            sourceStructureId: outputMode === 'existing' ? outputStructureId ?? undefined : undefined
          },
          result.contours
        );
        
        // Clear preview if active
        if (isPreviewActive && onClearPreview) {
          onClearPreview();
        }
        setIsPreviewActive(false);
      }

    } catch (err) {
      console.error('MarginSubtractPanel error:', err);
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
    } finally {
      setIsProcessing(false);
    }
  }, [
    sourceStructureId,
    marginMm,
    avoidanceStructures,
    structures,
    filterArtifacts,
    minAreaMm2,
    joinType,
    outputMode,
    outputName,
    outputStructureId,
    outputColor,
    onApply,
    onPreview,
    onClearPreview,
    isPreviewActive
  ]);

  const handleClearPreview = useCallback(() => {
    if (onClearPreview) {
      onClearPreview();
    }
    setIsPreviewActive(false);
  }, [onClearPreview]);

  if (!isVisible) return null;

  return (
    <div className="fixed bottom-24 left-[400px] z-50">
      <div 
        className="backdrop-blur-md border border-cyan-500/60 rounded-xl px-4 py-3 shadow-2xl bg-gray-900/95 w-[480px] max-h-[70vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-2">
            <Target className="w-4 h-4 text-cyan-400" />
            <span className="text-white text-sm font-medium">Create PTV: (Source + Margin) − OARs</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="h-6 w-6 p-0 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg"
          >
            <X size={14} />
          </Button>
        </div>

        {/* Formula display */}
        <div className="mb-4 p-3 bg-cyan-900/20 border border-cyan-600/30 rounded-lg">
          <div className="text-xs text-cyan-300 font-mono">
            Target = (
            <span className="text-green-400">{structures.find(s => s.roiNumber === sourceStructureId)?.structureName || 'Source'}</span>
            {' + '}
            <span className="text-yellow-400">{marginMm}mm</span>
            {') '}
            {avoidanceStructures.length > 0 && (
              <>
                {'− ('}
                <span className="text-red-400">{avoidanceStructures.map(a => a.name).join(' ∪ ')}</span>
                {')'}
              </>
            )}
          </div>
        </div>

        {/* Source Structure Selection */}
        <div className="mb-4">
          <Label className="text-xs text-white/70 mb-2 block">Source Structure (e.g., GTV)</Label>
          <Select 
            value={sourceStructureId?.toString() || ''} 
            onValueChange={(val) => setSourceStructureId(parseInt(val))}
          >
            <SelectTrigger className="h-9 bg-white/10 border-white/30 text-white text-sm">
              <SelectValue placeholder="Select source structure..." />
            </SelectTrigger>
            <SelectContent className="bg-gray-900 border-gray-700">
              {structureOptions.map(s => (
                <SelectItem key={s.id} value={s.id.toString()} className="text-white text-sm hover:bg-gray-800">
                  <div className="flex items-center space-x-2">
                    <div 
                      className="w-3 h-3 rounded border border-white/40"
                      style={{ backgroundColor: `rgb(${s.color[0]}, ${s.color[1]}, ${s.color[2]})` }}
                    />
                    <span>{s.name}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Margin Settings */}
        <div className="mb-4 p-3 bg-yellow-900/20 border border-yellow-600/30 rounded-lg">
          <Label className="text-xs text-yellow-400 mb-2 block">Margin Expansion</Label>
          <div className="flex items-center space-x-3">
            <Slider
              value={[marginMm]}
              onValueChange={(val) => setMarginMm(val[0])}
              min={-10}
              max={20}
              step={0.5}
              className="flex-1"
            />
            <Input
              type="number"
              value={marginMm}
              onChange={(e) => setMarginMm(parseFloat(e.target.value) || 0)}
              className="w-20 h-8 bg-white/10 border-white/30 text-white text-sm"
              step="0.5"
            />
            <span className="text-white/70 text-sm">mm</span>
          </div>
          
          {/* Join Type */}
          <div className="mt-3 flex items-center space-x-3">
            <Label className="text-xs text-yellow-400/70">Corner Style:</Label>
            <Select value={joinType} onValueChange={(val: 'round' | 'miter' | 'square') => setJoinType(val)}>
              <SelectTrigger className="w-28 h-7 bg-white/10 border-white/30 text-white text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-gray-900 border-gray-700">
                <SelectItem value="round" className="text-white text-xs">Round</SelectItem>
                <SelectItem value="miter" className="text-white text-xs">Miter</SelectItem>
                <SelectItem value="square" className="text-white text-xs">Square</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Avoidance Structures */}
        <div className="mb-4 p-3 bg-red-900/20 border border-red-600/30 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center space-x-2">
              <Shield className="w-4 h-4 text-red-400" />
              <Label className="text-xs text-red-400">Avoidance Structures (OARs)</Label>
            </div>
          </div>

          {/* Selected avoidance structures */}
          {avoidanceStructures.length > 0 && (
            <div className="mb-2 space-y-1">
              {avoidanceStructures.map(avoid => (
                <div key={avoid.id} className="flex items-center justify-between px-2 py-1 bg-red-900/30 rounded">
                  <span className="text-red-300 text-xs">{avoid.name}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemoveAvoidance(avoid.id)}
                    className="h-5 w-5 p-0 text-red-400 hover:text-red-200 hover:bg-red-900/50"
                  >
                    <X size={12} />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {/* Add avoidance selector */}
          <div className="flex items-center space-x-2">
            <Select value={selectedAvoidanceId} onValueChange={setSelectedAvoidanceId}>
              <SelectTrigger className="flex-1 h-8 bg-white/10 border-white/30 text-white text-sm">
                <SelectValue placeholder="Add avoidance structure..." />
              </SelectTrigger>
              <SelectContent className="bg-gray-900 border-gray-700">
                {availableAvoidanceStructures.map(s => (
                  <SelectItem key={s.id} value={s.id.toString()} className="text-white text-sm hover:bg-gray-800">
                    <div className="flex items-center space-x-2">
                      <div 
                        className="w-3 h-3 rounded border border-white/40"
                        style={{ backgroundColor: `rgb(${s.color[0]}, ${s.color[1]}, ${s.color[2]})` }}
                      />
                      <span>{s.name}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              onClick={handleAddAvoidance}
              disabled={!selectedAvoidanceId}
              className="h-8 px-3 bg-red-900/30 hover:bg-red-900/50 border border-red-600/50 text-red-300"
            >
              <Plus size={14} />
            </Button>
          </div>
          
          {availableAvoidanceStructures.length === 0 && avoidanceStructures.length > 0 && (
            <div className="mt-2 text-xs text-red-400/70">All structures have been added</div>
          )}
        </div>

        {/* Output Settings */}
        <div className="mb-4 p-3 bg-green-900/20 border border-green-600/30 rounded-lg">
          <Label className="text-xs text-green-400 mb-2 block">Output</Label>
          
          <div className="flex items-center space-x-3 mb-3">
            <Select value={outputMode} onValueChange={(val: 'new' | 'existing') => setOutputMode(val)}>
              <SelectTrigger className="w-32 h-8 bg-white/10 border-white/30 text-white text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-gray-900 border-gray-700">
                <SelectItem value="new" className="text-white text-sm">New Structure</SelectItem>
                <SelectItem value="existing" className="text-white text-sm">Overwrite</SelectItem>
              </SelectContent>
            </Select>
            
            {outputMode === 'new' ? (
              <Input
                value={outputName}
                onChange={(e) => setOutputName(e.target.value)}
                placeholder="Structure name..."
                className="flex-1 h-8 bg-white/10 border-white/30 text-white text-sm"
              />
            ) : (
              <Select 
                value={outputStructureId?.toString() || ''} 
                onValueChange={(val) => setOutputStructureId(parseInt(val))}
              >
                <SelectTrigger className="flex-1 h-8 bg-white/10 border-white/30 text-white text-sm">
                  <SelectValue placeholder="Select structure to overwrite..." />
                </SelectTrigger>
                <SelectContent className="bg-gray-900 border-gray-700">
                  {structureOptions.map(s => (
                    <SelectItem key={s.id} value={s.id.toString()} className="text-white text-sm hover:bg-gray-800">
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          
          {/* Color picker for new structure */}
          {outputMode === 'new' && (
            <div className="flex items-center space-x-3">
              <Label className="text-xs text-green-400/70">Color:</Label>
              <input
                type="color"
                value={`#${outputColor.map(c => c.toString(16).padStart(2, '0')).join('')}`}
                onChange={(e) => {
                  const hex = e.target.value.slice(1);
                  const r = parseInt(hex.slice(0, 2), 16);
                  const g = parseInt(hex.slice(2, 4), 16);
                  const b = parseInt(hex.slice(4, 6), 16);
                  setOutputColor([r, g, b]);
                }}
                className="w-8 h-6 rounded cursor-pointer"
              />
            </div>
          )}
        </div>

        {/* Artifact Filtering */}
        <div className="mb-4 p-3 bg-gray-800/50 border border-gray-600/30 rounded-lg">
          <div className="flex items-center justify-between">
            <Label className="text-xs text-white/70">Filter small artifacts</Label>
            <Switch
              checked={filterArtifacts}
              onCheckedChange={setFilterArtifacts}
            />
          </div>
          {filterArtifacts && (
            <div className="mt-2 flex items-center space-x-2">
              <Label className="text-xs text-white/50">Min area:</Label>
              <Input
                type="number"
                value={minAreaMm2}
                onChange={(e) => setMinAreaMm2(parseFloat(e.target.value) || 0)}
                className="w-16 h-6 bg-white/10 border-white/30 text-white text-xs"
                step="0.5"
                min="0"
              />
              <span className="text-white/50 text-xs">mm²</span>
            </div>
          )}
        </div>

        {/* Error Display */}
        {error && (
          <div className="mb-4 p-3 bg-red-900/30 border border-red-500/50 rounded-lg flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
            <span className="text-red-300 text-xs">{error}</span>
          </div>
        )}

        {/* Result Stats */}
        {lastResult && lastResult.success && (
          <div className="mb-4 p-3 bg-green-900/20 border border-green-600/30 rounded-lg">
            <div className="flex items-center space-x-2 mb-1">
              <CheckCircle2 className="w-4 h-4 text-green-400" />
              <span className="text-green-300 text-xs font-medium">Operation Complete</span>
            </div>
            <div className="text-xs text-green-400/70 space-y-1">
              <div>Output: {lastResult.contours.length} contours across {lastResult.stats.outputSlices} slices</div>
              <div>Processing time: {lastResult.stats.processingTimeMs.toFixed(0)}ms</div>
              {lastResult.stats.artifactsRemoved > 0 && (
                <div>Artifacts removed: {lastResult.stats.artifactsRemoved}</div>
              )}
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex space-x-2">
          <Button
            onClick={() => handleExecute(true)}
            disabled={!sourceStructureId || isProcessing}
            className="flex-1 h-9 bg-yellow-900/20 hover:bg-yellow-900/30 border border-yellow-600/50 text-yellow-400 hover:text-yellow-300"
          >
            {isProcessing ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Eye className="w-4 h-4 mr-2" />
            )}
            Preview
          </Button>
          
          {isPreviewActive && (
            <Button
              onClick={handleClearPreview}
              className="h-9 px-3 bg-gray-900/20 hover:bg-gray-900/30 border border-gray-600/50 text-gray-400 hover:text-gray-300"
            >
              <EyeOff className="w-4 h-4" />
            </Button>
          )}
          
          <Button
            onClick={() => handleExecute(false)}
            disabled={!sourceStructureId || isProcessing || (outputMode === 'new' && !outputName)}
            className="flex-1 h-9 bg-cyan-500/20 border border-cyan-500/60 text-cyan-300 hover:bg-cyan-500/30 hover:text-cyan-200"
          >
            {isProcessing ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Play className="w-4 h-4 mr-2" />
            )}
            Execute
          </Button>
        </div>
      </div>
    </div>
  );
}

export default MarginSubtractPanel;

