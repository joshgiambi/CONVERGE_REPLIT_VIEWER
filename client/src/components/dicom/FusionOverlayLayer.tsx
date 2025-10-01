import React, { useEffect } from 'react';
import { useFusionStore } from '@/lib/use-fusion-store';

type Props = {
  ctx: CanvasRenderingContext2D | null;
  canvas: HTMLCanvasElement | null;
  currentImage: any | null;
  currentIndex: number;
  opacity: number;
  onMeta?: (meta: { transformSource: string | null; registrationId: string | null }) => void;
};

export function FusionOverlayLayer({ ctx, canvas, currentImage, currentIndex, opacity, onMeta }: Props) {
  const getOverlayForSop = useFusionStore(s => s.getOverlayForSop);

  useEffect(() => {
    if (!ctx || !canvas || !currentImage || opacity <= 0) return;
    const sop = currentImage?.sopInstanceUID;
    if (!sop) return;
    const instNumber = Number(currentImage.instanceNumber ?? currentImage.metadata?.instanceNumber ?? NaN);
    const instanceNumber = Number.isFinite(instNumber) ? instNumber : null;
    const imagePosition = Array.isArray(currentImage.imagePositionPatient)
      ? currentImage.imagePositionPatient
      : Array.isArray(currentImage.metadata?.imagePositionPatient)
        ? currentImage.metadata.imagePositionPatient
        : null;

    let cancelled = false;
    getOverlayForSop({ sopInstanceUID: sop, index: currentIndex, instanceNumber, imagePosition }).then((overlay) => {
      if (cancelled || !overlay || !overlay.hasSignal) return;
      ctx.save();
      ctx.globalAlpha = opacity;
      ctx.drawImage(overlay.canvas, 0, 0, canvas.width, canvas.height);
      ctx.restore();
      onMeta?.({ transformSource: overlay.transformSource, registrationId: overlay.registrationId });
    }).catch(() => {/* non-blocking */});
    return () => { cancelled = true; };
  }, [ctx, canvas, currentImage, currentIndex, opacity, getOverlayForSop, onMeta]);

  return null;
}

