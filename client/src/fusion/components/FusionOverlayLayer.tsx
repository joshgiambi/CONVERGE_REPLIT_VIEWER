import { useEffect, useRef } from 'react';
import { useFusion } from '../fusion-context';
import { useViewport } from '@/components/viewer/PrimaryViewport';

interface Props {
  opacity: number;
}

export function FusionOverlayLayer({ opacity }: Props) {
  const fusion = useFusion();
  const requestTokenRef = useRef(0);
  const viewport = useViewport();
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const baseCanvas = viewport.canvasRef.current;
    if (!baseCanvas) return;
    const baseCtx = baseCanvas.getContext('2d');
    if (!baseCtx) return;

    if (!fusion.selectedSecondaryId || opacity <= 0) return;

    const currentImage: any = viewport.currentImage;
    const sopInstanceUID = currentImage?.sopInstanceUID ?? null;
    const instanceNumber = Number(currentImage?.instanceNumber ?? currentImage?.metadata?.instanceNumber ?? NaN);
    const position = currentImage?.imagePositionPatient ?? currentImage?.metadata?.imagePositionPatient ?? null;
    const sliceIndex = Number.isFinite(viewport.currentIndex) ? viewport.currentIndex : 0;

    if (!sopInstanceUID) {
      return;
    }

    const token = ++requestTokenRef.current;

    fusion
      .getOverlayForImage({
        sopInstanceUID,
        sliceIndex: Number.isFinite(sliceIndex) ? sliceIndex : 0,
        instanceNumber: Number.isFinite(instanceNumber) ? instanceNumber : null,
        position: Array.isArray(position) && position.length >= 3 ? [position[0], position[1], position[2]] : null,
      })
      .then((overlay) => {
        if (requestTokenRef.current !== token) return;
        if (!overlay || !overlay.hasSignal) return;

        // Compute same transform as viewport render to align fusion overlay
        const imageWidth = viewport.imageMetadata?.columns ?? overlay.canvas.width;
        const imageHeight = viewport.imageMetadata?.rows ?? overlay.canvas.height;
        const baseScale = Math.min(baseCanvas.width / imageWidth, baseCanvas.height / imageHeight);
        const totalScale = baseScale * Math.max(0.1, viewport.zoom);
        const scaledWidth = imageWidth * totalScale;
        const scaledHeight = imageHeight * totalScale;
        const x = (baseCanvas.width - scaledWidth) / 2 + (viewport.panX || 0);
        const y = (baseCanvas.height - scaledHeight) / 2 + (viewport.panY || 0);

        // Composite overlay directly using viewport transform
        baseCtx.save();
        baseCtx.globalAlpha = Math.max(0, Math.min(1, opacity));
        baseCtx.imageSmoothingEnabled = true;
        baseCtx.imageSmoothingQuality = 'high';
        baseCtx.drawImage(overlay.canvas, x, y, scaledWidth, scaledHeight);
        baseCtx.restore();
      })
      .catch((err) => {
        if (requestTokenRef.current !== token) return;
        console.warn('FusionOverlayLayer error', err);
      });
  }, [
    fusion,
    opacity,
    viewport.canvasRef,
    viewport.currentImage,
    viewport.currentIndex,
    viewport.zoom,
    viewport.panX,
    viewport.panY,
    viewport.windowLevel,
    viewport.imageMetadata,
  ]);

  return null;
}

export default FusionOverlayLayer;


