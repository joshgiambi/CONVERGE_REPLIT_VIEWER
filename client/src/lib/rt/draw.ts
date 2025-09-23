export interface DicomImageMetadataLike {
  imagePosition: string | [number, number, number];
  pixelSpacing: string | [number, number];
}

export interface DrawContourOptions {
  ctx: CanvasRenderingContext2D;
  canvasWidth: number;
  canvasHeight: number;
  image: { imageMetadata: DicomImageMetadataLike | null };
  zoom: number;
  panX: number;
  panY: number;
  contour: { points: number[]; isPredicted?: boolean; isPreview?: boolean };
  animationTime?: number;
}

function parsePosition(value: string | [number, number, number] | undefined): [number, number, number] {
  if (!value) return [-300, -300, 0];
  if (Array.isArray(value)) return [Number(value[0]) || 0, Number(value[1]) || 0, Number(value[2]) || 0];
  const parts = String(value).split('\\').map(Number);
  return [Number(parts[0]) || 0, Number(parts[1]) || 0, Number(parts[2]) || 0];
}

function parseSpacing(value: string | [number, number] | undefined): [number, number] {
  if (!value) return [1, 1];
  if (Array.isArray(value)) return [Number(value[0]) || 1, Number(value[1]) || 1];
  const parts = String(value).split('\\').map(Number);
  return [Number(parts[0]) || 1, Number(parts[1]) || 1];
}

export function drawRTContour(options: DrawContourOptions): void {
  const { ctx, canvasWidth, canvasHeight, image, zoom, panX, panY, contour, animationTime } = options;
  if (!contour?.points || contour.points.length < 6) return;
  const imgMetadata = image?.imageMetadata;
  if (!imgMetadata) return;

  const imagePosition = parsePosition((imgMetadata as any).imagePosition);
  const pixelSpacing = parseSpacing((imgMetadata as any).pixelSpacing);

  const imageWidth = 512;
  const imageHeight = 512;
  const baseScale = Math.min(canvasWidth / imageWidth, canvasHeight / imageHeight);
  const totalScale = baseScale * zoom;
  const imageX = (canvasWidth - imageWidth * totalScale) / 2 + panX;
  const imageY = (canvasHeight - imageHeight * totalScale) / 2 + panY;

  if (contour.isPredicted && animationTime !== undefined) {
    const dashLength = 8;
    const gapLength = 6;
    const animationSpeed = 0.002;
    const offset = (animationTime * animationSpeed) % (dashLength + gapLength);
    ctx.setLineDash([dashLength, gapLength]);
    ctx.lineDashOffset = -offset;
  } else {
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
  }

  ctx.beginPath();
  for (let i = 0; i < contour.points.length; i += 3) {
    const worldX = contour.points[i];
    const worldY = contour.points[i + 1];
    const pixelX = (worldX - imagePosition[0]) / pixelSpacing[1];
    const pixelY = (worldY - imagePosition[1]) / pixelSpacing[0];
    const canvasX = imageX + pixelX * totalScale;
    const canvasY = imageY + pixelY * totalScale;
    if (i === 0) ctx.moveTo(canvasX, canvasY); else ctx.lineTo(canvasX, canvasY);
  }
  ctx.closePath();

  if (!contour.isPreview) {
    if (contour.isPredicted) {
      const originalAlpha = ctx.globalAlpha;
      ctx.globalAlpha = originalAlpha * 0.3;
      ctx.fill();
      ctx.globalAlpha = originalAlpha;
    } else {
      ctx.fill();
    }
  }
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;
}

