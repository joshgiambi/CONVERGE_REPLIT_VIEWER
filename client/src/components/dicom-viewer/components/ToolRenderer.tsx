import React from 'react';
import { SimpleBrushTool } from '../../dicom/simple-brush-tool';
import { PenToolUnifiedV2 } from '../../dicom/pen-tool-unified-v2';
import PenToolV2 from '../../dicom/pen-tool-v2';

interface ToolRendererProps {
  selectedTool: string | null;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  currentImage: any;
  selectedForEdit: number | null;
  rtStructures: any;
  imageMetadata: any;
  ctTransform: React.RefObject<any>;
  onContourUpdate: (action: string, data: any) => Promise<void>;
  worldToCanvas: (x: number, y: number) => [number, number];
  canvasToWorld: (x: number, y: number) => [number, number];
}

export const ToolRenderer: React.FC<ToolRendererProps> = ({
  selectedTool,
  canvasRef,
  currentImage,
  selectedForEdit,
  rtStructures,
  imageMetadata,
  ctTransform,
  onContourUpdate,
  worldToCanvas,
  canvasToWorld
}) => {
  if (!selectedTool || !selectedForEdit) return null;

  const currentSlicePos = currentImage?.parsedSliceLocation ?? 
                         currentImage?.parsedZPosition ?? 
                         0;

  switch (selectedTool) {
    case 'brush':
      return (
        <SimpleBrushTool
          canvasRef={canvasRef}
          isActive={true}
          selectedStructure={selectedForEdit}
          rtStructures={rtStructures}
          currentSlicePosition={currentSlicePos}
          onContourUpdate={async (payload: any) => {
            await onContourUpdate('brush_stroke', payload);
          }}
          imageMetadata={imageMetadata}
          zoom={ctTransform.current?.scale || 1}
          panX={ctTransform.current?.offsetX || 0}
          panY={ctTransform.current?.offsetY || 0}
        />
      );

    case 'pen':
      return (
        <PenToolV2
          isActive={true}
          selectedStructure={selectedForEdit}
          rtStructures={rtStructures}
          currentSlicePosition={currentSlicePos}
          imageMetadata={imageMetadata}
          onContourUpdate={async (payload: any) => {
            await onContourUpdate('pen_stroke', payload);
          }}
          canvasRef={canvasRef}
          ctTransform={ctTransform}
        />
      );

    case 'planar-contour':
      return (
        <PenToolUnifiedV2
          canvasRef={canvasRef}
          isActive={true}
          selectedStructure={selectedForEdit}
          rtStructures={rtStructures}
          onContourUpdate={async (action: string, data: any) => {
            await onContourUpdate(action, data);
          }}
          imageMetadata={imageMetadata}
          worldToCanvas={worldToCanvas}
          canvasToWorld={canvasToWorld}
          color="#00ff00"
        />
      );

    default:
      return null;
  }
};