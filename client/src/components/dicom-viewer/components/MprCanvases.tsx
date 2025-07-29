/**
 * MPR (Multi-Planar Reconstruction) floating canvases
 */

interface MprCanvasesProps {
  volumeData: any[];
  currentSagittalIndex: number;
  currentCoronalIndex: number;
  windowLevel: { window: number; level: number };
  imageMetadata: any;
  crosshairPosition: { x: number; y: number } | null;
  isVisible: boolean;
}

export function MprCanvases({
  volumeData,
  currentSagittalIndex,
  currentCoronalIndex,
  windowLevel,
  imageMetadata,
  crosshairPosition,
  isVisible
}: MprCanvasesProps) {
  if (!isVisible) return null;
  
  return (
    <div className="absolute top-4 left-4 flex flex-col space-y-4">
      {/* Sagittal view */}
      <div className="bg-black border border-gray-600 rounded">
        <canvas 
          width={384} 
          height={384}
          className="block"
        />
        <div className="text-xs text-gray-400 p-1">Sagittal</div>
      </div>
      
      {/* Coronal view */}
      <div className="bg-black border border-gray-600 rounded">
        <canvas 
          width={384} 
          height={384}
          className="block"
        />
        <div className="text-xs text-gray-400 p-1">Coronal</div>
      </div>
    </div>
  );
}