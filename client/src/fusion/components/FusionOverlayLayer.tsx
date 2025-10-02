import { useEffect, useRef } from 'react';
import type { FusionOverlayLayerProps } from '@/types/fusion';
import { useFusion } from '../fusion-context';

export function FusionOverlayLayer({
  primaryImage,
  secondarySeriesId,
  opacity,
  windowLevel,
  registrationId,
  canvasRef,
  transform,
  onOverlayReady,
  onError,
}: FusionOverlayLayerProps) {
  const fusion = useFusion();
  const requestTokenRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (!secondarySeriesId || opacity <= 0) {
      if (onOverlayReady) onOverlayReady(null);
      return;
    }

    const sopInstanceUID = (primaryImage as any)?.sopInstanceUID ?? null;
    const instanceNumber = Number((primaryImage as any)?.instanceNumber ?? (primaryImage as any)?.metadata?.instanceNumber ?? NaN);
    const position = (primaryImage as any)?.imagePositionPatient ?? (primaryImage as any)?.metadata?.imagePositionPatient ?? null;
    const sliceIndex = Number((primaryImage as any)?.index ?? (primaryImage as any)?.sliceIndex ?? NaN);

    if (!sopInstanceUID) {
      if (onOverlayReady) onOverlayReady(null);
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
        if (!overlay || !overlay.hasSignal) {
          if (onOverlayReady) onOverlayReady(null);
          return;
        }

        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, opacity));
        ctx.drawImage(overlay.canvas, 0, 0, canvas.width, canvas.height);
        ctx.restore();

        if (onOverlayReady) onOverlayReady(overlay);
      })
      .catch((err) => {
        if (requestTokenRef.current !== token) return;
        if (onError) onError(err as Error);
      });
  }, [canvasRef, fusion, opacity, primaryImage, registrationId, secondarySeriesId, transform, windowLevel, onOverlayReady, onError]);

  return null;
}

export default FusionOverlayLayer;


