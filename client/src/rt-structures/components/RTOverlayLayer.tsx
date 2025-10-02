import { useEffect } from 'react';
import type { RTStructureSet } from '@/types/rt-structures';
import { useRT } from '@/rt-structures/RTProvider';
import { useViewport } from '@/components/viewer/PrimaryViewport';

interface Props {
  contourWidth?: number;
  contourOpacity?: number; // 0-100
}

function drawStructures(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  rtStructures: RTStructureSet,
  currentSlicePosition: number,
  cssWidth: number,
  cssHeight: number,
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

  // CSS pixel space transform matching PrimaryViewport
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const baseScale = Math.min(cssWidth / cssWidth, cssHeight / cssHeight) || 1; // 1 by construction; keeping pattern
  const totalScale = baseScale * zoom;
  const scaledWidth = cssWidth * totalScale;
  const scaledHeight = cssHeight * totalScale;
  const imageX = (canvas.width / dpr - scaledWidth) / 2 + panX;
  const imageY = (canvas.height / dpr - scaledHeight) / 2 + panY;

  // Convert to device pixels
  ctx.scale(dpr, dpr);
  ctx.translate(imageX, imageY);
  ctx.scale(totalScale, totalScale);

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

export function RTOverlayLayer({ contourWidth = 2, contourOpacity = 60 }: Props) {
  const { rtStructures, selection } = useRT();
  const viewport = useViewport();

  useEffect(() => {
    const canvas = viewport.overlayCanvasRef.current;
    if (!canvas || !rtStructures) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const cssWidth = canvas.width / dpr;
    const cssHeight = canvas.height / dpr;

    // PrimaryViewport should expose currentImage/currentIndex/zoom/pan from context; fallback to defaults if missing
    const zoom = (viewport as any).zoom ?? 1;
    const panX = (viewport as any).panX ?? 0;
    const panY = (viewport as any).panY ?? 0;
    const currentSlicePosition = (viewport as any).currentImage?.parsedSliceLocation
      ?? (viewport as any).currentImage?.parsedZPosition
      ?? (viewport as any).currentIndex
      ?? 0;
    const imageWidth = (viewport as any).metadata?.columns ?? (viewport as any).currentImage?.columns ?? 512;
    const imageHeight = (viewport as any).metadata?.rows ?? (viewport as any).currentImage?.rows ?? 512;

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
  }, [viewport, rtStructures, selection, contourWidth, contourOpacity]);

  return null;
}

export default RTOverlayLayer;


