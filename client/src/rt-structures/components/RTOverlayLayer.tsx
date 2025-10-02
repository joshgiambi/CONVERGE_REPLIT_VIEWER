import { useEffect } from 'react';
import type { RefObject } from 'react';
import type { RTStructureSet } from '@/types/rt-structures';
import { useRT } from '@/rt-structures/RTProvider';

interface Props {
  canvasRef: RefObject<HTMLCanvasElement>;
  imageWidth: number;
  imageHeight: number;
  zoom: number;
  panX: number;
  panY: number;
  currentSlicePosition: number;
  contourWidth?: number;
  contourOpacity?: number; // 0-100
}

function drawStructures(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  rtStructures: RTStructureSet,
  currentSlicePosition: number,
  imageWidth: number,
  imageHeight: number,
  zoom: number,
  panX: number,
  panY: number,
  contourWidth: number,
  contourOpacity: number,
  visibility: Map<number, boolean>,
  allStructuresVisible: boolean,
  selectedStructureIds: Set<number>,
  selectedForEdit: number | null,
) {
  ctx.save();
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.scale(zoom, zoom);
  ctx.translate(-canvas.width / 2 + panX, -canvas.height / 2 + panY);

  const lw = Math.max(0.5, contourWidth / Math.max(zoom, 0.01));
  ctx.lineWidth = lw;
  ctx.globalAlpha = 1;

  const toleranceMicrons = 100; // 0.1mm
  const currentSliceMicrons = Math.round(currentSlicePosition * 1000);

  for (const structure of rtStructures.structures || []) {
    const explicitVisible = visibility.get(structure.roiNumber);
    const isSelected = selectedStructureIds.has(structure.roiNumber) || selectedForEdit === structure.roiNumber;
    if (!isSelected) {
      if (!allStructuresVisible && explicitVisible !== true) continue;
      if (allStructuresVisible && explicitVisible === false) continue;
    }

    const [r, g, b] = structure.color || [255, 255, 0];
    ctx.strokeStyle = `rgb(${r}, ${g}, ${b})`;
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(100, contourOpacity)) / 100})`;

    for (const contour of structure.contours || []) {
      const zMicrons = Math.round(contour.slicePosition * 1000);
      if (Math.abs(zMicrons - currentSliceMicrons) > toleranceMicrons) continue;

      const pts = contour.points;
      if (!pts || pts.length < 6) continue;
      ctx.beginPath();
      for (let i = 0; i < pts.length; i += 3) {
        const x = pts[i + 0];
        const y = pts[i + 1];
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
      ctx.fill();
    }
  }

  ctx.restore();
}

export function RTOverlayLayer({
  canvasRef,
  imageWidth,
  imageHeight,
  zoom,
  panX,
  panY,
  currentSlicePosition,
  contourWidth = 2,
  contourOpacity = 60,
}: Props) {
  const { rtStructures, selection } = useRT();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !rtStructures) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    drawStructures(
      ctx,
      canvas,
      rtStructures,
      currentSlicePosition,
      imageWidth,
      imageHeight,
      zoom,
      panX,
      panY,
      contourWidth,
      contourOpacity,
      selection.visibility,
      selection.allStructuresVisible,
      selection.selectedStructureIds,
      selection.selectedForEdit,
    );
  }, [canvasRef, rtStructures, currentSlicePosition, imageWidth, imageHeight, zoom, panX, panY, contourWidth, contourOpacity, selection]);

  return null;
}

export default RTOverlayLayer;


