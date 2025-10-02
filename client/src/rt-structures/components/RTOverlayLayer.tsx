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
  // Do not clear the full canvas. Fusion clears first; RT paints on top.

  // CSS pixel space transform matching PrimaryViewport
  const baseScale = Math.min(cssWidth / imageWidth, cssHeight / imageHeight);
  const totalScale = baseScale * Math.max(0.1, zoom);
  const scaledWidth = imageWidth * totalScale;
  const scaledHeight = imageHeight * totalScale;
  const imageX = (cssWidth - scaledWidth) / 2 + (panX || 0);
  const imageY = (cssHeight - scaledHeight) / 2 + (panY || 0);

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
  const { rtStructures, selection, previewContours } = useRT();
  const viewport = useViewport();

  useEffect(() => {
    const canvas = viewport.overlayCanvasRef.current;
    if (!canvas || !rtStructures) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const cssWidth = canvas.width / dpr;
    const cssHeight = canvas.height / dpr;

    const zoom = viewport.zoom;
    const panX = viewport.panX;
    const panY = viewport.panY;
    const imageWidth = viewport.imageMetadata?.columns ?? viewport.currentImage?.columns ?? 512;
    const imageHeight = viewport.imageMetadata?.rows ?? viewport.currentImage?.rows ?? 512;
    const currentSlicePosition = viewport.currentImage?.parsedSliceLocation
      ?? viewport.currentImage?.parsedZPosition
      ?? viewport.currentIndex
      ?? 0;

    drawStructures(
      ctx,
      canvas,
      rtStructures,
      currentSlicePosition,
      cssWidth,
      cssHeight,
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

    // Draw preview contours on top (non-destructive)
    if (previewContours && previewContours.length) {
      // Use same transform already applied to context
      ctx.save();
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = Math.max(0.5, (contourWidth + 1) / Math.max(zoom, 0.01));
      ctx.strokeStyle = 'rgba(255, 230, 50, 0.95)';
      ctx.fillStyle = 'rgba(255, 230, 50, 0.25)';
      const tolMicrons = 100;
      const zMicrons = Math.round(currentSlicePosition * 1000);
      for (const c of previewContours) {
        const cz = Math.round(c.slicePosition * 1000);
        if (Math.abs(cz - zMicrons) > tolMicrons) continue;
        const pts = c.points;
        if (!pts || pts.length < 6) continue;
        ctx.beginPath();
        for (let i = 0; i < pts.length; i += 3) {
          const x = pts[i];
          const y = pts[i + 1];
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.restore();
    }
  }, [viewport.currentImage, viewport.currentIndex, viewport.zoom, viewport.panX, viewport.panY, viewport.imageMetadata, rtStructures, selection, contourWidth, contourOpacity, previewContours]);

  return null;
}

export default RTOverlayLayer;


