import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Slider } from '@/components/ui/slider';
// Define MarginParameters type locally for now
export interface MarginParameters {
  marginType: 'UNIFORM' | 'ASYMMETRIC' | 'CUSTOM';
  marginValues: {
    uniform: number;
    superior: number;
    inferior: number;
    anterior: number;
    posterior: number;
    left: number;
    right: number;
  };
  interpolationType: 'LINEAR' | 'SMOOTH' | 'DISCRETE';
  cornerHandling: 'ROUND' | 'MITER' | 'BEVEL';
  miterLimit: number;
  resolution: number;
  preview?: {
    enabled: boolean;
    opacity: number;
    color: string;
    updateRealtime: boolean;
  };
}

function createDefaultMarginParams(): MarginParameters {
  return {
    marginType: 'UNIFORM',
    marginValues: {
      uniform: 5.0,
      superior: 5.0,
      inferior: 5.0,
      anterior: 5.0,
      posterior: 5.0,
      left: 5.0,
      right: 5.0
    },
    interpolationType: 'LINEAR',
    cornerHandling: 'ROUND',
    miterLimit: 2.0,
    resolution: 1.0,
    preview: {
      enabled: true,
      opacity: 0.5,
      color: 'yellow',
      updateRealtime: true
    }
  };
}

interface MarginOperationPanelProps {
  onApplyMargin: (params: MarginParameters) => void;
  structureColor?: string;
}

export function MarginOperationPanel({ 
  onApplyMargin, 
  structureColor = '#00ff00'
}: MarginOperationPanelProps) {
  const [marginParams, setMarginParams] = useState<MarginParameters>(createDefaultMarginParams());
  const [isPreviewEnabled, setIsPreviewEnabled] = useState(true);

  const handleUniformMarginChange = (value: number[]) => {
    setMarginParams(prev => ({
      ...prev,
      marginValues: {
        ...prev.marginValues,
        uniform: value[0]
      }
    }));
  };

  const handleAsymmetricMarginChange = (direction: keyof MarginParameters['marginValues'], value: number[]) => {
    setMarginParams(prev => ({
      ...prev,
      marginValues: {
        ...prev.marginValues,
        [direction]: value[0]
      }
    }));
  };

  const handleApply = () => {
    onApplyMargin({
      ...marginParams,
      preview: {
        ...marginParams.preview!,
        enabled: isPreviewEnabled
      }
    });
  };

  return (
    <Card className="p-4 bg-gray-900 border-gray-700 text-white">
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Margin Operation</h3>
        
        <Tabs value={marginParams.marginType} onValueChange={(value) => 
          setMarginParams(prev => ({ ...prev, marginType: value as MarginParameters['marginType'] }))
        }>
          <TabsList className="grid w-full grid-cols-3 bg-gray-800">
            <TabsTrigger value="UNIFORM" className="data-[state=active]:bg-gray-700">Uniform</TabsTrigger>
            <TabsTrigger value="ASYMMETRIC" className="data-[state=active]:bg-gray-700">Asymmetric</TabsTrigger>
            <TabsTrigger value="CUSTOM" className="data-[state=active]:bg-gray-700">Custom</TabsTrigger>
          </TabsList>

          <TabsContent value="UNIFORM" className="space-y-4">
            <div>
              <Label className="text-sm text-gray-300">Margin Distance</Label>
              <div className="flex items-center space-x-4">
                <Slider
                  value={[marginParams.marginValues.uniform]}
                  onValueChange={handleUniformMarginChange}
                  min={-20}
                  max={20}
                  step={0.5}
                  className="flex-1"
                />
                <span className="text-sm w-20 text-right">
                  {marginParams.marginValues.uniform.toFixed(1)} mm
                </span>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="ASYMMETRIC" className="space-y-3">
            {Object.entries({
              superior: 'Superior (+Z)',
              inferior: 'Inferior (-Z)',
              anterior: 'Anterior (-Y)',
              posterior: 'Posterior (+Y)',
              left: 'Left (+X)',
              right: 'Right (-X)'
            }).map(([key, label]) => (
              <div key={key}>
                <Label className="text-xs text-gray-400">{label}</Label>
                <div className="flex items-center space-x-2">
                  <Slider
                    value={[marginParams.marginValues[key as keyof typeof marginParams.marginValues]]}
                    onValueChange={(value) => handleAsymmetricMarginChange(key as keyof typeof marginParams.marginValues, value)}
                    min={-20}
                    max={20}
                    step={0.5}
                    className="flex-1"
                  />
                  <span className="text-xs w-16 text-right">
                    {marginParams.marginValues[key as keyof typeof marginParams.marginValues].toFixed(1)} mm
                  </span>
                </div>
              </div>
            ))}
          </TabsContent>

          <TabsContent value="CUSTOM" className="space-y-4">
            <div className="text-sm text-gray-400">
              Custom margin configuration allows per-slice adjustments.
              This feature will be available in a future update.
            </div>
          </TabsContent>
        </Tabs>

        <div className="space-y-3">
          <div>
            <Label className="text-sm text-gray-300">Corner Handling</Label>
            <Select 
              value={marginParams.cornerHandling}
              onValueChange={(value) => setMarginParams(prev => ({ 
                ...prev, 
                cornerHandling: value as MarginParameters['cornerHandling'] 
              }))}
            >
              <SelectTrigger className="bg-gray-800 border-gray-600">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ROUND">Round</SelectItem>
                <SelectItem value="MITER">Miter</SelectItem>
                <SelectItem value="BEVEL">Bevel</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-sm text-gray-300">Interpolation</Label>
            <Select 
              value={marginParams.interpolationType}
              onValueChange={(value) => setMarginParams(prev => ({ 
                ...prev, 
                interpolationType: value as MarginParameters['interpolationType'] 
              }))}
            >
              <SelectTrigger className="bg-gray-800 border-gray-600">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="LINEAR">Linear</SelectItem>
                <SelectItem value="SMOOTH">Smooth</SelectItem>
                <SelectItem value="DISCRETE">Discrete</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <input
            type="checkbox"
            id="preview"
            checked={isPreviewEnabled}
            onChange={(e) => setIsPreviewEnabled(e.target.checked)}
            className="rounded border-gray-600"
          />
          <Label htmlFor="preview" className="text-sm">Enable real-time preview</Label>
        </div>

        <div className="flex space-x-2">
          <Button 
            onClick={handleApply}
            className="flex-1"
            style={{
              backgroundColor: structureColor,
              borderColor: structureColor,
              color: '#000'
            }}
          >
            Apply Margin
          </Button>
          <Button 
            variant="outline" 
            className="border-gray-600 hover:bg-gray-800"
            onClick={() => setMarginParams(createDefaultMarginParams())}
          >
            Reset
          </Button>
        </div>
      </div>
    </Card>
  );
}