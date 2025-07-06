import React from 'react';
import { Button } from "@/components/ui/button";
import { 
  Keyboard,
  FileCode,
  Info
} from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface FloatingUIControlsProps {
  currentSlicePosition?: number;
  activeTool?: string | null;
  brushSize?: number;
}

export function FloatingUIControls({ 
  currentSlicePosition,
  activeTool,
  brushSize = 15
}: FloatingUIControlsProps) {
  return (
    <div className="fixed bottom-6 right-6 flex flex-col gap-2 z-50">
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-9 w-9 p-0 bg-gray-900/60 border-gray-700/50 text-white/70 hover:bg-purple-600/80 hover:border-purple-500 hover:text-white transition-all duration-200"
            title="Keyboard Shortcuts"
          >
            <Keyboard className="w-4 h-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-4 bg-gray-900/95 border-gray-700" side="left">
          <h3 className="text-sm font-semibold text-white mb-3">Keyboard Shortcuts</h3>
          <div className="space-y-2 text-xs">
            <div className="grid grid-cols-2 gap-2">
              <div className="text-gray-400">Delete</div>
              <div className="text-white">Delete current slice</div>
              
              <div className="text-gray-400">Ctrl+Z</div>
              <div className="text-white">Undo</div>
              
              <div className="text-gray-400">Ctrl+Y</div>
              <div className="text-white">Redo</div>
              
              <div className="text-gray-400">B</div>
              <div className="text-white">Brush tool</div>
              
              <div className="text-gray-400">P</div>
              <div className="text-white">Pen tool</div>
              
              <div className="text-gray-400">E</div>
              <div className="text-white">Eraser tool</div>
              
              <div className="text-gray-400">Scroll</div>
              <div className="text-white">Navigate slices</div>
              
              <div className="text-gray-400">1/2/3</div>
              <div className="text-white">Switch views (Axial/Sagittal/Coronal)</div>
            </div>
          </div>
        </PopoverContent>
      </Popover>
      
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-9 w-9 p-0 bg-gray-900/60 border-gray-700/50 text-white/70 hover:bg-blue-600/80 hover:border-blue-500 hover:text-white transition-all duration-200"
            title="DICOM Metadata"
          >
            <FileCode className="w-4 h-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-96 p-4 bg-gray-900/95 border-gray-700 max-h-96 overflow-y-auto" side="left">
          <h3 className="text-sm font-semibold text-white mb-3">DICOM Metadata</h3>
          <div className="space-y-2 text-xs">
            <div className="grid grid-cols-2 gap-2">
              <div className="text-gray-400">Patient Position</div>
              <div className="text-white font-mono">HFS</div>
              
              <div className="text-gray-400">Pixel Spacing</div>
              <div className="text-white font-mono">1.171875 mm</div>
              
              <div className="text-gray-400">Slice Thickness</div>
              <div className="text-white font-mono">2.5 mm</div>
              
              <div className="text-gray-400">Current Slice</div>
              <div className="text-white font-mono">{currentSlicePosition || 'N/A'} mm</div>
              
              <div className="text-gray-400">Matrix Size</div>
              <div className="text-white font-mono">512 x 512</div>
              
              <div className="text-gray-400">FOV</div>
              <div className="text-white font-mono">600 x 600 mm</div>
              
              <div className="text-gray-400">Frame of Reference</div>
              <div className="text-white font-mono text-xs break-all">1.2.840.113619.2.55.3.34214794</div>
            </div>
          </div>
        </PopoverContent>
      </Popover>
      
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-9 w-9 p-0 bg-gray-900/60 border-gray-700/50 text-white/70 hover:bg-green-600/80 hover:border-green-500 hover:text-white transition-all duration-200"
            title={`Info: ${activeTool || 'No tool'}`}
          >
            <Info className="w-4 h-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-4 bg-gray-900/95 border-gray-700" side="left">
          <h3 className="text-sm font-semibold text-white mb-3">Tool Info</h3>
          <div className="space-y-2 text-xs text-gray-300">
            {activeTool === 'brush' && (
              <>
                <p>Draw freehand contours</p>
                <p>Size: {(brushSize * 0.1171875).toFixed(1)} cm</p>
                <p>Hold and drag to draw</p>
              </>
            )}
            {activeTool === 'pen' && (
              <>
                <p>Click to place points</p>
                <p>Right-click to complete</p>
                <p>Drag points to morph</p>
              </>
            )}
            {activeTool === 'delete' && (
              <>
                <p>Erase contours</p>
                <p>Click and drag to remove</p>
              </>
            )}
            {activeTool === 'pan' && (
              <>
                <p>Pan the image</p>
                <p>Click and drag to move</p>
              </>
            )}
            {activeTool === 'measure' && (
              <>
                <p>Measure distances</p>
                <p>Click and drag to measure</p>
              </>
            )}
            {!activeTool && (
              <p>Select a tool to see info</p>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}