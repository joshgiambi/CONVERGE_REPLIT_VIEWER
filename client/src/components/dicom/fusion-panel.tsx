import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { X, Layers, Eye, EyeOff } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

interface FusionPanelProps {
  isOpen: boolean;
  onClose: () => void;
  primarySeriesId: number; // CT series
  studyId: number;
  currentSlicePosition?: number;
  onSecondarySeriesSelect: (seriesId: number | null) => void;
  opacity: number;
  onOpacityChange: (opacity: number) => void;
}

export function FusionPanel({
  isOpen,
  onClose,
  primarySeriesId,
  studyId,
  currentSlicePosition,
  onSecondarySeriesSelect,
  opacity,
  onOpacityChange
}: FusionPanelProps) {
  const [selectedSecondaryId, setSelectedSecondaryId] = useState<number | null>(null);
  const [showOverlay, setShowOverlay] = useState(true);
  
  // Fetch available MR series for fusion
  const { data: availableSeries } = useQuery({
    queryKey: [`/api/studies/${studyId}/series`],
    enabled: isOpen && !!studyId
  });
  
  // Filter for MR series only
  const mrSeries = availableSeries?.filter((s: any) => s.modality === 'MR') || [];
  
  // Fetch registration information
  const { data: registrationInfo } = useQuery({
    queryKey: [`/api/studies/${studyId}/registration`],
    enabled: isOpen && !!studyId
  });
  
  const handleSecondarySelect = (value: string) => {
    const seriesId = value === 'none' ? null : parseInt(value);
    setSelectedSecondaryId(seriesId);
    onSecondarySeriesSelect(seriesId);
  };
  
  const toggleOverlay = () => {
    setShowOverlay(!showOverlay);
    if (!showOverlay) {
      onSecondarySeriesSelect(selectedSecondaryId);
    } else {
      onSecondarySeriesSelect(null);
    }
  };
  
  if (!isOpen) return null;
  
  return (
    <div className="fixed right-0 top-16 bottom-0 w-96 bg-background border-l border-border shadow-xl z-40 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-2">
          <Layers className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold">Image Fusion</h2>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="h-8 w-8"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
      
      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Primary Series Info */}
        <Card className="p-4">
          <h3 className="text-sm font-medium mb-2">Primary Series (CT)</h3>
          <p className="text-xs text-muted-foreground">
            Base layer for image fusion
          </p>
        </Card>
        
        {/* Secondary Series Selection */}
        <div className="space-y-3">
          <Label>Secondary Series (MR)</Label>
          <Select value={selectedSecondaryId?.toString() || 'none'} onValueChange={handleSecondarySelect}>
            <SelectTrigger>
              <SelectValue placeholder="Select MR series to overlay" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              {mrSeries.map((series: any) => (
                <SelectItem key={series.id} value={series.id.toString()}>
                  {series.seriesDescription} ({series.imageCount} images)
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        
        {/* Registration Status */}
        {registrationInfo && (
          <Card className="p-4 bg-muted/50">
            <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
              <div className="w-2 h-2 bg-green-500 rounded-full" />
              Registration Available
            </h3>
            <p className="text-xs text-muted-foreground">
              Spatial alignment matrix found for CT-MR fusion
            </p>
          </Card>
        )}
        
        {/* Fusion Controls */}
        {selectedSecondaryId && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label>Overlay Visibility</Label>
              <Button
                variant="outline"
                size="sm"
                onClick={toggleOverlay}
                className="gap-2"
              >
                {showOverlay ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                {showOverlay ? 'Visible' : 'Hidden'}
              </Button>
            </div>
            
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Opacity</Label>
                <span className="text-sm text-muted-foreground">{Math.round(opacity * 100)}%</span>
              </div>
              <Slider
                value={[opacity]}
                onValueChange={([value]) => onOpacityChange(value)}
                min={0}
                max={1}
                step={0.05}
                disabled={!showOverlay}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>CT Only</span>
                <span>50/50</span>
                <span>MR Only</span>
              </div>
            </div>
          </div>
        )}
        
        {/* Fusion Preview */}
        {selectedSecondaryId && (
          <Card className="p-4">
            <h3 className="text-sm font-medium mb-3">Fusion Preview</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <div className="aspect-square bg-muted rounded-md flex items-center justify-center text-xs">
                  CT
                </div>
                <p className="text-xs text-center text-muted-foreground">Primary</p>
              </div>
              <div className="space-y-1">
                <div className="aspect-square bg-muted rounded-md flex items-center justify-center text-xs">
                  MR
                </div>
                <p className="text-xs text-center text-muted-foreground">Secondary</p>
              </div>
            </div>
            <div className="mt-3">
              <div className="aspect-square bg-muted rounded-md flex items-center justify-center text-xs relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-blue-500/20 to-purple-500/20" />
                <span className="relative">Fused</span>
              </div>
              <p className="text-xs text-center text-muted-foreground mt-1">
                Combined View
              </p>
            </div>
          </Card>
        )}
        
        {/* Instructions */}
        <Card className="p-4 bg-muted/30">
          <h3 className="text-sm font-medium mb-2">How to use</h3>
          <ul className="text-xs text-muted-foreground space-y-1">
            <li>• Select an MR series to overlay on the CT</li>
            <li>• Adjust opacity to blend the images</li>
            <li>• Use the visibility toggle to show/hide overlay</li>
            <li>• Registration ensures proper spatial alignment</li>
          </ul>
        </Card>
      </div>
    </div>
  );
}