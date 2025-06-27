// ✅ Full, compile-ready RTStructureOverlay component with fixed
//   - missing braces/return paths
//   - exhaustive dependency arrays
//   - type guards
//   - "eslint-react-hooks/exhaustive-deps" compliance
//   - null-checks for canvas + ctx
//   - safe abort if the component unmounts during fetch
//   - FIXED: 90-degree rotation issue in coordinate transformation

import { useEffect, useState } from "react";

export interface RTContour {
  slicePosition: number;
  points: number[];
  numberOfPoints: number;
}

export interface RTStructure {
  roiNumber: number;
  structureName: string;
  color: [number, number, number];
  contours: RTContour[];
}

export interface RTStructureSet {
  studyInstanceUID: string;
  seriesInstanceUID: string;
  structures: RTStructure[];
  imagePositionPatient: [number, number, number];
  pixelSpacing: [number, number];
}

interface RTStructureOverlayProps {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  studyId: number;
  currentSlicePosition: number;
  imageWidth: number;
  imageHeight: number;
  zoom: number;
  panX: number;
  panY: number;
}

export function RTStructureOverlay({
  canvasRef,
  studyId,
  currentSlicePosition,
  imageWidth,
  imageHeight,
  zoom,
  panX,
  panY,
}: RTStructureOverlayProps) {
  const [rtStructures, setRTStructures] = useState<RTStructureSet | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // ────────────────────────────────────────────────────────────────────────────
  // Load RT structures
  // ────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!studyId) return;

    const abort = new AbortController();

    (async () => {
      try {
        setIsLoading(true);

        const seriesRes = await fetch(`/api/studies/${studyId}/rt-structures`, {
          signal: abort.signal,
        });
        if (!seriesRes.ok) return;

        const series = await seriesRes.json();
        if (!series?.length) return;

        const contourRes = await fetch(
          `/api/rt-structures/${series[0].id}/contours`,
          { signal: abort.signal },
        );
        if (!contourRes.ok) return;

        const data: RTStructureSet = await contourRes.json();
        setRTStructures(data);
        console.log(`Loaded ${data.structures.length} ROIs`);
      } catch (err) {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          console.error("RTSTRUCT fetch error:", err);
        }
      } finally {
        setIsLoading(false);
      }
    })();

    return () => abort.abort();
  }, [studyId]);

  // ────────────────────────────────────────────────────────────────────────────
  // Draw overlays
  // ────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!canvasRef.current || !rtStructures) return;

    const ctx = canvasRef.current.getContext("2d");
    if (!ctx) return;

    // clear then draw
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    renderRTStructures(
      ctx,
      canvasRef.current,
      rtStructures,
      currentSlicePosition,
      imageWidth,
      imageHeight,
      zoom,
      panX,
      panY,
    );
  }, [
    canvasRef,
    rtStructures,
    currentSlicePosition,
    imageWidth,
    imageHeight,
    zoom,
    panX,
    panY,
  ]);

  return isLoading ? <span>Loading RT-Structures…</span> : null;
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────
function renderRTStructures(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  rtStructures: RTStructureSet,
  currentSlicePosition: number,
  imageWidth: number,
  imageHeight: number,
  zoom: number,
  panX: number,
  panY: number,
) {
  const { imagePositionPatient, pixelSpacing } = rtStructures;
  const tolerance = 1.0;

  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.scale(zoom, zoom);
  ctx.translate(-canvas.width / 2 + panX, -canvas.height / 2 + panY);
  ctx.lineWidth = 2 / zoom;
  ctx.globalAlpha = 0.8;

  rtStructures.structures.forEach((s) => {
    const [r, g, b] = s.color;
    ctx.strokeStyle = `rgb(${r},${g},${b})`;
    ctx.fillStyle = `rgba(${r},${g},${b},0.2)`;

    s.contours.forEach((c) => {
      if (Math.abs(c.slicePosition - currentSlicePosition) <= tolerance) {
        drawContour(
          ctx,
          c,
          canvas.width,
          canvas.height,
          imageWidth,
          imageHeight,
          imagePositionPatient,
          pixelSpacing,
        );
      }
    });
  });

  ctx.restore();
}

// FIXED: Corrected coordinate transformation to fix 90-degree rotation
function worldToCanvas(
  worldX: number,
  worldY: number,
  origin: [number, number, number],
  pixelSpacing: [number, number],
  canvasWidth: number,
  canvasHeight: number,
  imageWidth: number,
  imageHeight: number,
): [number, number] {
  // DICOM coordinate system mapping:
  // - worldX corresponds to image columns (width direction)
  // - worldY corresponds to image rows (height direction)
  // - pixelSpacing[0] = row spacing (Y direction)
  // - pixelSpacing[1] = column spacing (X direction)

  const colSpacing = pixelSpacing[1]; // X direction spacing
  const rowSpacing = pixelSpacing[0]; // Y direction spacing

  // Convert world coordinates to pixel coordinates
  const pixelX = (worldX - origin[0]) / colSpacing;
  const pixelY = (worldY - origin[1]) / rowSpacing;

  // Map pixel coordinates to canvas coordinates
  // Fix the 90-degree rotation by ensuring proper X/Y mapping
  const canvasX = (pixelX / imageWidth) * canvasWidth;
  const canvasY = (pixelY / imageHeight) * canvasHeight;

  return [canvasX, canvasY];
}

function drawContour(
  ctx: CanvasRenderingContext2D,
  contour: RTContour,
  canvasW: number,
  canvasH: number,
  imgW: number,
  imgH: number,
  origin: [number, number, number],
  spacing: [number, number],
) {
  if (contour.points.length < 6) return;

  ctx.beginPath();
  for (let i = 0; i < contour.points.length; i += 3) {
    const [canvasX, canvasY] = worldToCanvas(
      contour.points[i], // worldX
      contour.points[i + 1], // worldY
      origin,
      spacing,
      canvasW,
      canvasH,
      imgW,
      imgH,
    );
    i === 0 ? ctx.moveTo(canvasX, canvasY) : ctx.lineTo(canvasX, canvasY);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}
