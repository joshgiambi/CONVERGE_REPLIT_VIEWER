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

  useEffect(() => {
    const overlayCanvas = viewport.overlayCanvasRef.current;
    if (!overlayCanvas) return;
    const ctx = overlayCanvas.getContext('2d');
    if (!ctx) return;

    // Compute CSS-space canvas size
    const dpr = window.devicePixelRatio || 1;
    const cssWidth = overlayCanvas.width / dpr;
    const cssHeight = overlayCanvas.height / dpr;

    // Always clear immediately to avoid stale composites
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    // Invalidate any in-flight composite when inputs change
    const token = ++requestTokenRef.current;

    const currentImage: any = viewport.currentImage;
    const sopInstanceUID = currentImage?.sopInstanceUID ?? null;
    const instanceNumber = Number(currentImage?.instanceNumber ?? currentImage?.metadata?.instanceNumber ?? NaN);
    const position = currentImage?.imagePositionPatient ?? currentImage?.metadata?.imagePositionPatient ?? null;
    const sliceIndex = Number.isFinite(viewport.currentIndex) ? viewport.currentIndex : 0;

    // If fusion disabled or no SOP, leave canvas cleared and exit
    if (!fusion.selectedSecondaryId || opacity <= 0 || !sopInstanceUID) return;

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

        const imageWidth = viewport.imageMetadata?.columns ?? overlay.canvas.width;
        const imageHeight = viewport.imageMetadata?.rows ?? overlay.canvas.height;

        // Match PrimaryViewport transform in CSS space
        const baseScale = Math.min(cssWidth / imageWidth, cssHeight / imageHeight);
        const totalScale = baseScale * Math.max(0.1, viewport.zoom);
        const scaledWidth = imageWidth * totalScale;
        const scaledHeight = imageHeight * totalScale;
        const x = (cssWidth - scaledWidth) / 2 + (viewport.panX || 0);
        const y = (cssHeight - scaledHeight) / 2 + (viewport.panY || 0);

        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, opacity));
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        // Clear again in case of rapid successive frames
        ctx.clearRect(0, 0, cssWidth, cssHeight);
        ctx.drawImage(overlay.canvas, x, y, scaledWidth, scaledHeight);
        ctx.restore();
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


