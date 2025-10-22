import React, { useEffect, useMemo, useRef } from 'react';
import { getDicomWorkerManager } from '@/lib/dicom-worker-manager';

type Orientation = 'sagittal' | 'coronal';

interface MPRFloatingProps {
  images: any[];
  orientation: Orientation;
  sliceIndex: number;
  windowWidth: number;
  windowCenter: number;
  crosshairPos: { x: number; y: number };
  rtStructures?: any;
  onClick?: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  currentZIndex?: number; // axial slice index for contour sampling
}

export const MPRFloating: React.FC<MPRFloatingProps> = ({
  images,
  orientation,
  sliceIndex,
  windowWidth,
  windowCenter,
  crosshairPos,
  rtStructures,
  onClick,
  currentZIndex
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const spacing = useMemo(() => {
    const first = images?.[0];
    const ps = (first?.pixelSpacing || first?.imageMetadata?.pixelSpacing || '1\\1').toString().split('\\').map(Number);
    const row = Number.isFinite(ps[0]) ? ps[0] : 1;
    const col = Number.isFinite(ps[1]) ? ps[1] : 1;
    let z = parseFloat(first?.imageMetadata?.spacingBetweenSlices || first?.spacingBetweenSlices || 'NaN');
    if (!Number.isFinite(z) && images.length >= 2) {
      try {
        const toNum = (v: any) => Array.isArray(v) ? v.map(Number) : (typeof v === 'string' ? v.split('\\').map(Number) : []);
        const iop = toNum(first?.imageOrientation || first?.imageMetadata?.imageOrientation);
        const p0 = toNum(images[0]?.imagePosition || images[0]?.imageMetadata?.imagePosition);
        const p1 = toNum(images[1]?.imagePosition || images[1]?.imageMetadata?.imagePosition);
        if (iop.length >= 6 && p0.length >= 3 && p1.length >= 3) {
          const r = [iop[0], iop[1], iop[2]];
          const c = [iop[3], iop[4], iop[5]];
          const n = [r[1]*c[2]-r[2]*c[1], r[2]*c[0]-r[0]*c[2], r[0]*c[1]-r[1]*c[0]];
          const nlen = Math.hypot(n[0], n[1], n[2]) || 1; const nn = [n[0]/nlen, n[1]/nlen, n[2]/nlen];
          const dz = Math.abs((p1[0]-p0[0])*nn[0] + (p1[1]-p0[1])*nn[1] + (p1[2]-p0[2])*nn[2]);
          if (Number.isFinite(dz) && dz > 0) z = dz;
        }
      } catch {}
    }
    if (!Number.isFinite(z)) z = parseFloat(first?.sliceThickness || first?.imageMetadata?.sliceThickness || '1') || 1;
    return { row, col, z };
  }, [images]);

  // Minimal reslicer: assembles Float32 HU for target plane from cached axial Float32
  const reconstruct = async () => {
    const canvas = canvasRef.current; if (!canvas || !images?.length) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const axial = images; // sorted axial stack
    const width = axial[0]?.columns || axial[0]?.width || 512;
    const height = axial[0]?.rows || axial[0]?.height || 512;
    const depth = axial.length;
    
    // Debug: check cache availability
    const cache = (window as any).__WV_CACHE__ as Map<string, { data: Float32Array; width: number; height: number }>;
    if (!cache) {
      console.warn(`⚠️ MPR ${orientation}: __WV_CACHE__ not initialized`);
      return;
    }
    const cachedCount = Array.from({ length: depth }, (_, i) => axial[i]?.sopInstanceUID).filter(uid => uid && cache.has(uid)).length;
    console.log(`🎨 MPR ${orientation}: ${cachedCount}/${depth} slices cached, rendering slice ${sliceIndex}`);

    // Build a lazy getter for Float32 HU per slice from existing caches (WorkingViewer fills these)
    const getSlice = (idx: number): Float32Array | null => {
      const img = axial[idx];
      const cache = (window as any).__WV_CACHE__ as Map<string, { data: Float32Array; width: number; height: number }>;
      const entry = cache?.get(img?.sopInstanceUID);
      return entry?.data || null;
    };
    const ensureSlice = async (idx: number) => {
      const img = axial[idx]; if (!img) return;
      const cache = (window as any).__WV_CACHE__ as Map<string, { data: Float32Array; width: number; height: number }>;
      if (cache?.has(img.sopInstanceUID)) return;
      try {
        const resp = await fetch(`/api/images/${img.sopInstanceUID}`);
        if (!resp.ok) return;
        const buf = await resp.arrayBuffer();
        const worker = getDicomWorkerManager();
        const parsed = await worker.parseDicomImage(buf);
        if (parsed?.data && cache) cache.set(img.sopInstanceUID, parsed);
      } catch {}
    };

    // Target plane dims in voxels
    const dimX = orientation === 'sagittal' ? height : width; // horizontal
    const dimY = depth;                                       // vertical (Z)

    // Create image data
    const imgData = ctx.createImageData(canvas.width, canvas.height);
    const data = imgData.data;

    // Physical sizing
    const physW = (orientation === 'sagittal' ? spacing.row * dimX : spacing.col * dimX);
    const physH = spacing.z * dimY;
    const aspect = physW / physH;
    let drawW, drawH;
    if (aspect < canvas.width / canvas.height) {
      drawH = canvas.height;
      drawW = Math.round(drawH * aspect);
    } else {
      drawW = canvas.width;
      drawH = Math.round(drawW / aspect);
    }
    const offX = Math.round((canvas.width - drawW) / 2);
    const offY = Math.round((canvas.height - drawH) / 2);

    const sx = dimX / drawW; // source pixels per canvas pixel
    const sy = dimY / drawH;

    const wlMin = windowCenter - windowWidth / 2;
    const wlMax = windowCenter + windowWidth / 2;

    // Render (queue missing slices for lazy load)
    const missing = new Set<number>();
    for (let y = 0; y < drawH; y++) {
      // Flip Z so superior is up
      const z = Math.min(depth - 1, Math.max(0, (depth - 1) - Math.floor(y * sy)));
      let slice = getSlice(z);
      if (!slice) { missing.add(z); continue; }
      for (let x = 0; x < drawW; x++) {
        const u = Math.min(dimX - 1, Math.max(0, Math.floor(x * sx)));
        let f: number;
        if (orientation === 'sagittal') {
          // Y (u) across rows, X fixed = sliceIndex
          const idx = (u * width) + Math.min(width - 1, Math.max(0, sliceIndex));
          f = slice[idx];
        } else {
          // X (u) across columns, Y fixed = sliceIndex
          const idx = (Math.min(height - 1, Math.max(0, sliceIndex)) * width) + u;
          f = slice[idx];
        }
        let g = 0;
        if (f <= wlMin) g = 0; else if (f >= wlMax) g = 255; else g = Math.round(((f - wlMin) / (wlMax - wlMin)) * 255);
        const di = ((offY + y) * canvas.width + (offX + x)) * 4;
        data[di] = data[di + 1] = data[di + 2] = g;
        data[di + 3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);

    // Crosshair
    ctx.save();
    ctx.strokeStyle = 'rgba(0,255,255,0.85)';
    ctx.lineWidth = 1.25;
    if (orientation === 'sagittal') {
      const cx = offX + Math.round((crosshairPos.y / dimX) * drawW);
      const cy = offY + Math.round(((depth - 1 - sliceIndex) / dimY) * drawH);
      ctx.beginPath(); ctx.moveTo(cx, offY); ctx.lineTo(cx, offY + drawH); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(offX, cy); ctx.lineTo(offX + drawW, cy); ctx.stroke();
    } else {
      const cx = offX + Math.round((crosshairPos.x / dimX) * drawW);
      const cy = offY + Math.round(((depth - 1 - sliceIndex) / dimY) * drawH);
      ctx.beginPath(); ctx.moveTo(cx, offY); ctx.lineTo(cx, offY + drawH); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(offX, cy); ctx.lineTo(offX + drawW, cy); ctx.stroke();
    }
    ctx.restore();

    // Contours projection by intersecting axial polygons with current plane
    if (rtStructures?.structures?.length && images?.[0]?.imageMetadata?.imagePosition) {
      ctx.save();
      ctx.globalAlpha = 1.0;
      ctx.lineWidth = 2.0;
      const prevComp = ctx.globalCompositeOperation;
      ctx.globalCompositeOperation = 'lighter';
      const pos0Str = images[0].imageMetadata.imagePosition || images[0].imagePosition;
      const pos0 = (typeof pos0Str === 'string' ? pos0Str.split('\\').map(Number) : pos0Str) as number[];
      // Parse IOP to handle rotated datasets correctly
      const iopVal = images[0].imageMetadata.imageOrientation || images[0].imageOrientation;
      const iop = ((): number[] => {
        if (Array.isArray(iopVal)) return iopVal.map(Number);
        if (typeof iopVal === 'string') return iopVal.split('\\').map(Number);
        return [1,0,0,0,1,0];
      })();
      const rowDir = [iop[0], iop[1], iop[2]]; // along rows (yPix)
      const colDir = [iop[3], iop[4], iop[5]]; // along cols (xPix)
      const dot = (a: number[], b: number[]) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
      const worldToPixel = (wx: number, wy: number, wz: number): { x: number; y: number } => {
        const d = [wx - pos0[0], wy - pos0[1], wz - pos0[2]];
        // Map world→pixel indices on axial grid and shift by half-voxel so vertices align to pixel centers
        const x = (dot(d, colDir) / spacing.col) - 0.5; // column index (centered)
        const y = (dot(d, rowDir) / spacing.row) - 0.5; // row index (centered)
        return { x, y };
      };
      const zIndexForContours = Number.isFinite(currentZIndex as number) ? (currentZIndex as number) : Math.round(depth / 2);
      // Derive actual Z for tolerant matching
      const curZFromMeta = (() => {
        const i = Math.min(depth - 1, Math.max(0, zIndexForContours));
        const im = images[i];
        const p = (im?.imageMetadata?.imagePosition || im?.imagePosition) as any;
        if (p) {
          const arr = Array.isArray(p) ? p.map(Number) : (typeof p === 'string' ? p.split('\\').map(Number) : []);
          if (arr.length >= 3 && isFinite(arr[2])) return arr[2];
        }
        return pos0[2] + i * spacing.z;
      })();
      const zTol = Math.max(Math.abs(spacing.z) * 1.1, 1.2);
      for (const s of rtStructures.structures) {
        if (!s?.contours?.length) continue;
        const color = s.color || [0, 255, 0];
        ctx.strokeStyle = `rgb(${color[0]},${color[1]},${color[2]})`;
        for (const c of s.contours) {
          if (typeof c.slicePosition !== 'number' || !c.points || c.points.length < 6) continue;
          // Tolerant Z matching
          if (Math.abs(c.slicePosition - curZFromMeta) > zTol) continue;
          if (orientation === 'sagittal') {
            const x0 = sliceIndex; // fixed column index in axial space
            const ys: number[] = [];
            for (let i = 0; i < c.points.length; i += 3) {
              const j = (i + 3) % c.points.length;
              const p1 = worldToPixel(c.points[i], c.points[i + 1], c.slicePosition);
              const p2 = worldToPixel(c.points[j], c.points[j + 1], c.slicePosition);
              if ((p1.x - x0) * (p2.x - x0) <= 0) {
                const t = (x0 - p1.x) / ((p2.x - p1.x) || 1e-6);
                ys.push(p1.y + t * (p2.y - p1.y));
              }
            }
            ys.sort((a, b) => a - b);
            for (let k = 0; k + 1 < ys.length; k += 2) {
              const yA = offY + Math.round((((depth - 1 - zIndexForContours) + 0.5) / dimY) * drawH);
              const xA = offX + Math.round(((ys[k] + 0.5) / height) * drawW);
              const xB = offX + Math.round(((ys[k + 1] + 0.5) / height) * drawW);
              ctx.beginPath(); ctx.moveTo(xA, yA); ctx.lineTo(xB, yA); ctx.stroke();
              ctx.fillStyle = '#ff0';
              ctx.beginPath(); ctx.arc(xA, yA, 1.8, 0, Math.PI * 2); ctx.fill();
              ctx.beginPath(); ctx.arc(xB, yA, 1.8, 0, Math.PI * 2); ctx.fill();
            }
          } else {
            const y0 = sliceIndex; // fixed row index in axial space
            const xs: number[] = [];
            for (let i = 0; i < c.points.length; i += 3) {
              const j = (i + 3) % c.points.length;
              const p1 = worldToPixel(c.points[i], c.points[i + 1], c.slicePosition);
              const p2 = worldToPixel(c.points[j], c.points[j + 1], c.slicePosition);
              if ((p1.y - y0) * (p2.y - y0) <= 0) {
                const t = (y0 - p1.y) / ((p2.y - p1.y) || 1e-6);
                xs.push(p1.x + t * (p2.x - p1.x));
              }
            }
            xs.sort((a, b) => a - b);
            for (let k = 0; k + 1 < xs.length; k += 2) {
              const yA = offY + Math.round((((depth - 1 - zIndexForContours) + 0.5) / dimY) * drawH);
              const xA = offX + Math.round(((xs[k] + 0.5) / width) * drawW);
              const xB = offX + Math.round(((xs[k + 1] + 0.5) / width) * drawW);
              ctx.beginPath(); ctx.moveTo(xA, yA); ctx.lineTo(xB, yA); ctx.stroke();
              ctx.fillStyle = '#ff0';
              ctx.beginPath(); ctx.arc(xA, yA, 1.8, 0, Math.PI * 2); ctx.fill();
              ctx.beginPath(); ctx.arc(xB, yA, 1.8, 0, Math.PI * 2); ctx.fill();
            }
          }
        }
      }
      ctx.globalCompositeOperation = prevComp;
      ctx.restore();
    }

    // Lazy-load any missing slices then re-render
    if (missing.size) {
      const tasks = Array.from(missing).slice(0, 24).map(ensureSlice); // cap parallelism
      await Promise.all(tasks);
      requestAnimationFrame(reconstruct);
    }
  };

  useEffect(() => { reconstruct(); }, [images, orientation, sliceIndex, windowWidth, windowCenter, crosshairPos.x, crosshairPos.y]);

  return (
    <canvas ref={canvasRef} className="mpr-canvas" width={384} height={384} onClick={onClick} />
  );
};


