// Correct HU → 8-bit windowing without double-rescale
export type WindowLevel = { width: number; center: number };

export function renderHUToCanvas(
  ctx: CanvasRenderingContext2D,
  huPixels: Float32Array, // HU floats
  cols: number,
  rows: number,
  canvasScale: { scale: number; offsetX: number; offsetY: number }, // from your ctTransform
  wl: WindowLevel,
) {
  const { width: WW, center: WC } = wl;
  const min = WC - WW / 2;
  const max = WC + WW / 2;

  // 1) Create a single ImageData at native image size
  const imageData = ctx.createImageData(cols, rows);
  const dst = imageData.data;

  for (let i = 0, j = 0; i < huPixels.length; i++, j += 4) {
    const hu = huPixels[i];
    let g = 0;
    if (hu > min) g = hu >= max ? 255 : Math.round(((hu - min) / WW) * 255);
    dst[j] = dst[j + 1] = dst[j + 2] = g;
    dst[j + 3] = 255;
  }

  // 2) Draw via offscreen buffer once (keeps filtering nice)
  const off = document.createElement('canvas');
  off.width = cols;
  off.height = rows;
  const offCtx = off.getContext('2d', { willReadFrequently: true })!;
  offCtx.putImageData(imageData, 0, 0);

  // 3) Composite to main canvas with the same transform used elsewhere
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const { scale, offsetX, offsetY } = canvasScale;
  const scaledW = cols * scale;
  const scaledH = rows * scale;
  ctx.drawImage(off, offsetX, offsetY, scaledW, scaledH);
}