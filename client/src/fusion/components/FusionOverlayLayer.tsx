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

        // Prepare overlay canvas once, matching base canvas size
        if (!overlayCanvasRef.current) {
          overlayCanvasRef.current = document.createElement('canvas');
        }
        const overlayCanvas = overlayCanvasRef.current;
        overlayCanvas.width = baseCanvas.width;
        overlayCanvas.height = baseCanvas.height;
        const octx = overlayCanvas.getContext('2d');
        if (!octx) return;

        // Draw overlay into its own canvas (scale to base size)
        octx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
        octx.drawImage(overlay.canvas, 0, 0, overlayCanvas.width, overlayCanvas.height);

        // Composite onto base canvas
        baseCtx.save();
        baseCtx.globalAlpha = Math.max(0, Math.min(1, opacity));
        baseCtx.drawImage(overlayCanvas, 0, 0);
        baseCtx.restore();
      })
      .catch((err) => {
        if (requestTokenRef.current !== token) return;
        console.warn('FusionOverlayLayer error', err);
      });
  }, [fusion, opacity, viewport.canvasRef, viewport.currentImage, viewport.currentIndex]);

  return null;
}

export default FusionOverlayLayer;


