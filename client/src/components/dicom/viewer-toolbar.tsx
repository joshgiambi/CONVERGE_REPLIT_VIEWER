import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { 
  ZoomIn, 
  ZoomOut, 
  Maximize2, 
  Hand, 
  Ruler, 
  MessageSquare,
  RotateCw,
  FlipHorizontal,
  Settings
} from 'lucide-react';

interface ViewerToolbarProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  onPanTool: () => void;
  onMeasureTool: () => void;
  onAnnotateTool: () => void;
  onRotate: () => void;
  onFlip: () => void;
}

export function ViewerToolbar({
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onPanTool,
  onMeasureTool,
  onAnnotateTool,
  onRotate,
  onFlip
}: ViewerToolbarProps) {
  const [activeTool, setActiveTool] = useState<string>('pan');

  const handleToolSelect = (tool: string, callback: () => void) => {
    setActiveTool(tool);
    callback();
  };

  const tools = [
    { id: 'zoom-in', icon: ZoomIn, label: 'Zoom In', action: onZoomIn },
    { id: 'zoom-out', icon: ZoomOut, label: 'Zoom Out', action: onZoomOut },
    { id: 'reset-zoom', icon: Maximize2, label: 'Fit to Window', action: onResetZoom },
    { id: 'separator' },
    { id: 'pan', icon: Hand, label: 'Pan', action: onPanTool, selectable: true },
    { id: 'measure', icon: Ruler, label: 'Measure', action: onMeasureTool, selectable: true },
    { id: 'annotate', icon: MessageSquare, label: 'Annotate', action: onAnnotateTool, selectable: true },
    { id: 'separator' },
    { id: 'rotate', icon: RotateCw, label: 'Rotate', action: onRotate },
    { id: 'flip', icon: FlipHorizontal, label: 'Flip', action: onFlip },
  ];

  return (
    <div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 z-50 animate-in slide-in-from-bottom-2 duration-300">
      <Card className="bg-black/70 backdrop-blur-sm border-dicom-yellow/30 px-6 py-3">
        <div className="flex items-center space-x-1">
          {tools.map((tool, index) => {
            if (tool.id === 'separator') {
              return (
                <div key={index} className="w-px h-6 bg-dicom-gray mx-2" />
              );
            }

            const IconComponent = tool.icon!;
            const isActive = tool.selectable && activeTool === tool.id;

            return (
              <Button
                key={tool.id}
                variant="ghost"
                size="sm"
                className={`
                  p-2 rounded-full transition-all duration-200 hover:scale-110
                  ${isActive 
                    ? 'bg-dicom-yellow/20 text-dicom-yellow border border-dicom-yellow' 
                    : 'hover:bg-dicom-yellow/20 text-dicom-yellow hover:text-dicom-yellow'
                  }
                `}
                onClick={() => {
                  if (tool.selectable) {
                    handleToolSelect(tool.id, tool.action!);
                  } else {
                    tool.action!();
                  }
                }}
                title={tool.label}
              >
                <IconComponent className="w-4 h-4" />
              </Button>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
