import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Upload, Download, FileText, Activity, Target } from 'lucide-react';

export interface RTStructureSet {
  instanceUID: string;
  label: string;
  name: string;
  description?: string;
  date: string;
  time: string;
  structures: RTStructure[];
}

export interface RTStructure {
  roiNumber: number;
  roiName: string;
  roiType: string;
  color: [number, number, number];
  contours: any[];
  isVisible?: boolean;
  opacity?: number;
}

interface RTStructureManagerProps {
  studyId: number;
  onStructureSetSelect: (structureSet: RTStructureSet) => void;
  selectedStructureSet?: RTStructureSet;
}

export function RTStructureManager({ 
  studyId, 
  onStructureSetSelect, 
  selectedStructureSet 
}: RTStructureManagerProps) {
  const [structureSets, setStructureSets] = useState<RTStructureSet[]>([]);

  // Fetch RT structure sets for the study
  const { data: rtData, isLoading } = useQuery({
    queryKey: ['/api/rt-structures', studyId],
    queryFn: async () => {
      const response = await fetch(`/api/rt-structures/${studyId}`);
      if (!response.ok) {
        // If no RT structures exist, create demo structure set
        if (response.status === 404) {
          return createDemoStructureSet();
        }
        throw new Error(`Failed to fetch RT structures: ${response.statusText}`);
      }
      return response.json();
    },
  });

  useEffect(() => {
    if (rtData) {
      setStructureSets(Array.isArray(rtData) ? rtData : [rtData]);
      
      // Auto-select first structure set if none selected
      if (!selectedStructureSet && rtData.length > 0) {
        onStructureSetSelect(rtData[0]);
      }
    }
  }, [rtData, selectedStructureSet, onStructureSetSelect]);

  const createDemoStructureSet = (): RTStructureSet => {
    return {
      instanceUID: '1.2.3.demo.rt.structureset',
      label: 'Demo RT Structure Set',
      name: 'Thoracic Radiotherapy Planning',
      description: 'Sample radiotherapy structures for lung cancer treatment',
      date: new Date().toISOString().split('T')[0],
      time: new Date().toISOString().split('T')[1],
      structures: [
        {
          roiNumber: 1,
          roiName: 'PTV (Planning Target Volume)',
          roiType: 'PTV',
          color: [255, 0, 0] as [number, number, number],
          contours: [],
          isVisible: true,
          opacity: 0.7
        },
        {
          roiNumber: 2,
          roiName: 'CTV (Clinical Target Volume)',
          roiType: 'CTV',
          color: [255, 165, 0] as [number, number, number],
          contours: [],
          isVisible: true,
          opacity: 0.6
        },
        {
          roiNumber: 3,
          roiName: 'GTV (Gross Target Volume)',
          roiType: 'GTV',
          color: [255, 255, 0] as [number, number, number],
          contours: [],
          isVisible: true,
          opacity: 0.8
        },
        {
          roiNumber: 4,
          roiName: 'Heart',
          roiType: 'OAR',
          color: [255, 105, 180] as [number, number, number],
          contours: [],
          isVisible: true,
          opacity: 0.5
        },
        {
          roiNumber: 5,
          roiName: 'Left Lung',
          roiType: 'OAR',
          color: [0, 255, 255] as [number, number, number],
          contours: [],
          isVisible: true,
          opacity: 0.4
        },
        {
          roiNumber: 6,
          roiName: 'Right Lung',
          roiType: 'OAR',
          color: [0, 255, 0] as [number, number, number],
          contours: [],
          isVisible: true,
          opacity: 0.4
        },
        {
          roiNumber: 7,
          roiName: 'Spinal Cord',
          roiType: 'OAR',
          color: [255, 255, 0] as [number, number, number],
          contours: [],
          isVisible: true,
          opacity: 0.6
        },
        {
          roiNumber: 8,
          roiName: 'Esophagus',
          roiType: 'OAR',
          color: [128, 0, 128] as [number, number, number],
          contours: [],
          isVisible: true,
          opacity: 0.5
        }
      ]
    };
  };

  const getStructureTypeIcon = (type: string) => {
    switch (type) {
      case 'PTV':
      case 'CTV':
      case 'GTV':
        return <Target className="w-3 h-3" />;
      case 'OAR':
        return <Activity className="w-3 h-3" />;
      default:
        return <FileText className="w-3 h-3" />;
    }
  };

  const getStructureTypeColor = (type: string) => {
    switch (type) {
      case 'PTV':
        return 'bg-red-600';
      case 'CTV':
        return 'bg-orange-600';
      case 'GTV':
        return 'bg-yellow-600';
      case 'OAR':
        return 'bg-blue-600';
      default:
        return 'bg-gray-600';
    }
  };

  if (isLoading) {
    return (
      <Card className="bg-gray-900 border-purple-700 p-4">
        <div className="flex items-center justify-center h-32">
          <div className="text-center">
            <div className="w-6 h-6 border border-purple-400 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
            <p className="text-purple-400 text-sm">Loading RT structures...</p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="bg-gray-900 border-purple-700 p-4 h-full">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-purple-300 font-semibold flex items-center">
          <Target className="w-4 h-4 mr-2" />
          RT Structure Sets
        </h3>
        <div className="flex space-x-1">
          <Button variant="ghost" size="sm" className="text-purple-400 hover:text-purple-300 p-1">
            <Upload className="w-3 h-3" />
          </Button>
          <Button variant="ghost" size="sm" className="text-purple-400 hover:text-purple-300 p-1">
            <Download className="w-3 h-3" />
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        {structureSets.map((structureSet, index) => (
          <div
            key={structureSet.instanceUID}
            className={`p-3 rounded-lg border transition-all cursor-pointer ${
              selectedStructureSet?.instanceUID === structureSet.instanceUID
                ? 'border-purple-500 bg-purple-900/30'
                : 'border-gray-700 hover:border-purple-600 hover:bg-purple-900/10'
            }`}
            onClick={() => onStructureSetSelect(structureSet)}
          >
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-white font-medium text-sm truncate">
                {structureSet.label}
              </h4>
              <Badge variant="outline" className="text-xs border-purple-500 text-purple-300">
                {structureSet.structures.length} ROIs
              </Badge>
            </div>

            <p className="text-gray-400 text-xs mb-2 truncate">
              {structureSet.description || structureSet.name}
            </p>

            <div className="text-xs text-gray-500 mb-2">
              {structureSet.date} • {structureSet.time.split('.')[0]}
            </div>

            {/* Structure Preview */}
            <div className="space-y-1">
              {structureSet.structures.slice(0, 3).map((structure) => (
                <div key={structure.roiNumber} className="flex items-center space-x-2">
                  <div 
                    className="w-2 h-2 rounded-sm"
                    style={{ backgroundColor: `rgb(${structure.color[0]}, ${structure.color[1]}, ${structure.color[2]})` }}
                  />
                  <span className="text-xs text-gray-300 truncate flex-1">
                    {structure.roiName}
                  </span>
                  <div className="flex items-center space-x-1">
                    {getStructureTypeIcon(structure.roiType)}
                    <Badge 
                      variant="secondary" 
                      className={`text-xs px-1 py-0 ${getStructureTypeColor(structure.roiType)} text-white`}
                    >
                      {structure.roiType}
                    </Badge>
                  </div>
                </div>
              ))}
              
              {structureSet.structures.length > 3 && (
                <div className="text-xs text-gray-500 text-center pt-1">
                  +{structureSet.structures.length - 3} more structures
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {structureSets.length === 0 && (
        <div className="text-center py-8">
          <Target className="w-12 h-12 text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400 text-sm mb-2">No RT structure sets found</p>
          <p className="text-gray-500 text-xs">
            Upload DICOM RT structure files to view radiotherapy contours
          </p>
        </div>
      )}
    </Card>
  );
}