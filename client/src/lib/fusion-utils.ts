/*
 * Utility functions to reliably map CT slices to MRI slices and perform interpolation,
 * ensuring correct ordering and sequential behavior.
 */

/**
 * Multiply a 4x4 matrix by a 4-vector.
 */
function multiplyMatrixVector(matrix: number[][], vector: number[]): number[] {
  const result = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      result[i] += matrix[i][j] * vector[j];
    }
  }
  return result;
}

/**
 * Precompute and sort MRI slice positions in CT coordinates.
 * @param secondaryImages Array of MRI image metadata objects (must include imagePosition)
 * @param registrationMatrix Flat length-16 array representing 4x4 DICOM registration matrix
 * @returns Array of { zInCT: number, image } sorted by zInCT ascending
 */
export function computeTransformedMRIPositions(
  secondaryImages: any[],
  registrationMatrix: number[],
  ctImageOrientation?: string | number[] | null,
  ctImagePosition?: string | number[] | null,
  secondaryCache?: Map<string, { data: Float32Array; width: number; height: number; metadata?: any }>
) {
  // Build 4x4 matrix
  const M = [
    [registrationMatrix[0], registrationMatrix[1], registrationMatrix[2], registrationMatrix[3]],
    [registrationMatrix[4], registrationMatrix[5], registrationMatrix[6], registrationMatrix[7]],
    [registrationMatrix[8], registrationMatrix[9], registrationMatrix[10], registrationMatrix[11]],
    [registrationMatrix[12], registrationMatrix[13], registrationMatrix[14], registrationMatrix[15]]
  ];

  // Prepare CT orientation normal if provided
  let ctNormal: [number, number, number] | null = null;
  let ctOrigin: [number, number, number] | null = null;
  try {
    if (ctImageOrientation) {
      const iop = Array.isArray(ctImageOrientation)
        ? (ctImageOrientation as number[]).map(Number)
        : String(ctImageOrientation).split("\\").map(Number);
      if (iop.length >= 6) {
        const rx = iop[0], ry = iop[1], rz = iop[2]; // row direction cosines
        const cx = iop[3], cy = iop[4], cz = iop[5]; // column direction cosines
        // normal = row x column
        const nx = ry * cz - rz * cy;
        const ny = rz * cx - rx * cz;
        const nz = rx * cy - ry * cx;
        const len = Math.hypot(nx, ny, nz) || 1;
        ctNormal = [nx / len, ny / len, nz / len];
      }
    }
    if (ctImagePosition) {
      const pos = Array.isArray(ctImagePosition)
        ? (ctImagePosition as number[]).map(Number)
        : String(ctImagePosition).split("\\").map(Number);
      if (pos.length >= 3) ctOrigin = [pos[0], pos[1], pos[2]];
    }
  } catch (_) {
    ctNormal = null;
    ctOrigin = null;
  }

  const transformed = secondaryImages.map(img => {
    // Parse imagePosition into [x,y,z] with null safety
    let pos: number[] | null = null;
    try {
      if (Array.isArray(img.imagePosition)) {
        pos = (img.imagePosition as number[]).map(Number);
      } else if (img.imagePosition && typeof img.imagePosition === 'string') {
        pos = String(img.imagePosition).split('\\').map(Number);
      } else if (img.imageMetadata?.imagePosition) {
        const v = img.imageMetadata.imagePosition;
        pos = Array.isArray(v) ? v.map(Number) : String(v).split('\\').map(Number);
      } else if (secondaryCache && img.sopInstanceUID) {
        const cached = secondaryCache.get(img.sopInstanceUID);
        const meta = cached?.metadata;
        if (meta?.imagePosition) {
          const v = meta.imagePosition;
          pos = Array.isArray(v) ? v.map(Number) : String(v).split('\\').map(Number);
        }
      }
    } catch {}

    if (!pos || pos.length < 3 || !isFinite(pos[0]) || !isFinite(pos[1]) || !isFinite(pos[2])) {
      // Fallback for null/undefined imagePosition - use slice index as Z position
      console.warn('Missing imagePosition for image, using fallback position');
      pos = [0, 0, secondaryImages.indexOf(img) * 1.0]; // 1mm spacing fallback
    }
    const hom = [pos[0], pos[1], pos[2], 1];
    const [xInCT, yInCT, zInCTRaw] = multiplyMatrixVector(M, hom).slice(0, 3);
    let zInCT = zInCTRaw;
    // If CT normal and origin are known, project onto CT slice normal to derive consistent z
    if (ctNormal && ctOrigin) {
      const dx = xInCT - ctOrigin[0];
      const dy = yInCT - ctOrigin[1];
      const dz = zInCTRaw - ctOrigin[2];
      zInCT = dx * ctNormal[0] + dy * ctNormal[1] + dz * ctNormal[2];
    }
    return { xInCT, yInCT, zInCT, image: img };
  });

  // Sort ascending by zInCT
  transformed.sort((a, b) => a.zInCT - b.zInCT);
  
  // Debug: Log sample transformed coordinates
  if (transformed.length > 0) {
    const first = transformed[0];
    const middle = transformed[Math.floor(transformed.length / 2)];
    const last = transformed[transformed.length - 1];
    console.log(`🔍 Sample MRI→CT coordinate transformations:`);
    console.log(`  First: (${first.xInCT.toFixed(1)}, ${first.yInCT.toFixed(1)}, ${first.zInCT.toFixed(1)})mm in CT space`);
    console.log(`  Middle: (${middle.xInCT.toFixed(1)}, ${middle.yInCT.toFixed(1)}, ${middle.zInCT.toFixed(1)})mm in CT space`);
    console.log(`  Last: (${last.xInCT.toFixed(1)}, ${last.yInCT.toFixed(1)}, ${last.zInCT.toFixed(1)})mm in CT space`);
  }
  
  return transformed;
}

/**
 * Invert a 4x4 matrix provided as a flat 16-element array (row-major).
 * Returns null if the matrix is non-invertible.
 */
export function invertMatrix4x4(m: number[]): number[] | null {
  if (!Array.isArray(m) || m.length !== 16) return null;
  const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3];
  const a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
  const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];
  const a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];

  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;

  // Calculate the determinant
  const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!isFinite(det) || Math.abs(det) < 1e-12) return null;
  const invDet = 1.0 / det;

  const inv = new Array<number>(16);
  inv[0]  = ( a11 * b11 - a12 * b10 + a13 * b09) * invDet;
  inv[1]  = (-a01 * b11 + a02 * b10 - a03 * b09) * invDet;
  inv[2]  = ( a31 * b05 - a32 * b04 + a33 * b03) * invDet;
  inv[3]  = (-a21 * b05 + a22 * b04 - a23 * b03) * invDet;
  inv[4]  = (-a10 * b11 + a12 * b08 - a13 * b07) * invDet;
  inv[5]  = ( a00 * b11 - a02 * b08 + a03 * b07) * invDet;
  inv[6]  = (-a30 * b05 + a32 * b02 - a33 * b01) * invDet;
  inv[7]  = ( a20 * b05 - a22 * b02 + a23 * b01) * invDet;
  inv[8]  = ( a10 * b10 - a11 * b08 + a13 * b06) * invDet;
  inv[9]  = (-a00 * b10 + a01 * b08 - a03 * b06) * invDet;
  inv[10] = ( a30 * b04 - a31 * b02 + a33 * b00) * invDet;
  inv[11] = (-a20 * b04 + a21 * b02 - a23 * b00) * invDet;
  inv[12] = (-a10 * b09 + a11 * b07 - a12 * b06) * invDet;
  inv[13] = ( a00 * b09 - a01 * b07 + a02 * b06) * invDet;
  inv[14] = (-a30 * b03 + a31 * b01 - a32 * b00) * invDet;
  inv[15] = ( a20 * b03 - a21 * b01 + a22 * b00) * invDet;

  return inv;
}

/**
 * Transpose a 4x4 matrix provided as a flat 16-element array (row-major).
 * Returns a new flat array representing the transposed matrix.
 */
export function transposeMatrix4x4(m: number[]): number[] {
  if (!Array.isArray(m) || m.length !== 16) return m;
  return [
    m[0], m[4], m[8],  m[12],
    m[1], m[5], m[9],  m[13],
    m[2], m[6], m[10], m[14],
    m[3], m[7], m[11], m[15],
  ];
}

/**
 * Find the index of the MRI slice closest to a given CT z-coordinate.
 * Uses binary search on the sorted transformed array.
 * @param ctZ CT slice z-coordinate in patient space
 * @param transformed Array from computeTransformedMRIPositions
 * @returns Index of best match, or null if none
 */
export function findNearestMRIIndex(ctZ: number, transformed: Array<{xInCT: number, yInCT: number, zInCT: number, image: any}>): number | null {
  if (!transformed.length) return null;
  let low = 0, high = transformed.length - 1, bestIdx = 0;
  let bestDist = Infinity;

  // Binary search to approximate
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const dist = Math.abs(transformed[mid].zInCT - ctZ);
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = mid;
    }
    if (transformed[mid].zInCT < ctZ) low = mid + 1;
    else high = mid - 1;
  }

  // Check neighbors in case of tie
  if (bestIdx > 0) {
    const d2 = Math.abs(transformed[bestIdx - 1].zInCT - ctZ);
    if (d2 < bestDist) {
      bestDist = d2;
      bestIdx = bestIdx - 1;
    }
  }
  if (bestIdx < transformed.length - 1) {
    const d2 = Math.abs(transformed[bestIdx + 1].zInCT - ctZ);
    if (d2 < bestDist) {
      bestIdx = bestIdx + 1;
    }
  }

  return bestIdx;
}

/**
 * Interpolate MRI image data for a given CT slice.
 * If CT z is closest to an MRI slice, returns that image data; otherwise linearly interpolates between neighbors.
 * @param ctZ CT slice position
 * @param transformed Output of computeTransformedMRIPositions
 * @param cache Map from sopInstanceUID to MRIData { data: Float32Array, width, height }
 * @returns MRIData for drawing
 */
export function interpolateMRI(
  ctZ: number, 
  transformed: Array<{xInCT: number, yInCT: number, zInCT: number, image: any}>, 
  cache: Map<string, {data: Float32Array, width: number, height: number}>
): {data: Float32Array, width: number, height: number} | null {
  const idx = findNearestMRIIndex(ctZ, transformed);
  if (idx === null) {
    console.log(`No MRI index found for CT Z=${ctZ}mm`);
    return null;
  }

  const best = transformed[idx];
  const distance = Math.abs(best.zInCT - ctZ);
  console.log(`Found MRI slice for CT ${ctZ}mm: MRI Z=${best.zInCT.toFixed(1)}mm (distance: ${distance.toFixed(1)}mm)`);
  
  const baseData = cache.get(best.image.sopInstanceUID);
  if (!baseData) {
    console.error(`CRITICAL: MRI image data not found in cache: ${best.image.sopInstanceUID}`);
    console.log(`Cache keys available:`, Array.from(cache.keys()).slice(0, 5));
    console.log(`Cache size:`, cache.size);
    return null;
  }
  
  console.log(`✓ Found MRI data in cache: ${baseData.width}x${baseData.height}, ${baseData.data.length} pixels`);

  // Determine neighbor spacing
  const prev = transformed[idx - 1];
  const next = transformed[idx + 1];

  // If no neighbors or CT is exactly on slice, return base
  if (!prev || !next) return baseData;

  const lowerZ = prev.zInCT;
  const upperZ = next.zInCT;
  if (upperZ === lowerZ) return baseData;

  // Linear weight between prev and next
  const w = (ctZ - lowerZ) / (upperZ - lowerZ);

  const prevData = cache.get(prev.image.sopInstanceUID);
  const nextData = cache.get(next.image.sopInstanceUID);
  if (!prevData || !nextData) return baseData;

  // Always blend with weight w (0→1) no matter how small - eliminates sudden jumps
  const length = baseData.data.length;
  const interp = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    interp[i] = prevData.data[i] * (1 - w) + nextData.data[i] * w;
  }
  return { data: interp, width: baseData.width, height: baseData.height };
}

/**
 * Simplified fusion render function using the above utilities.
 * Call inside your render loop and after computing transformed positions once.
 */
export async function renderFusionOverlay(
  ctx: CanvasRenderingContext2D,
  primaryImage: any,
  transformedMRI: Array<{xInCT: number, yInCT: number, zInCT: number, image: any}>,
  secondaryImageCache: Map<string, {data: Float32Array, width: number, height: number, metadata?: any}>,
  ctSliceZ: number,
  fusionOpacity: number,
  panX: number,
  panY: number,
  canvasWidth: number,
  canvasHeight: number,
  registrationMatrix?: number[],
  ctTransform?: {scale: number, offsetX: number, offsetY: number, imageWidth: number, imageHeight: number} | null
) {
  // NO TRANSFORMS HERE - we assume the CT transform is already applied by the caller
  console.log('🎯 Rendering fusion overlay in CT coordinate space');

  // STRICT Z-range check: Only render fusion within actual MRI coverage
  if (transformedMRI.length > 0) {
    const zValues = transformedMRI.map(t => t.zInCT);
    const minZ = Math.min(...zValues);
    const maxZ = Math.max(...zValues);
    if (ctSliceZ < minZ - 2 || ctSliceZ > maxZ + 2) {
      return;
    }
  }

  // Get the interpolated MRI data for this CT slice
  const mriData = interpolateMRI(ctSliceZ, transformedMRI, secondaryImageCache);
  if (!mriData) return; // nothing to draw

  // Create temp canvas
  const temp = document.createElement('canvas');
  temp.width = mriData.width;
  temp.height = mriData.height;
  const tctx = temp.getContext('2d');
  if (!tctx) return;

  // Draw MRI as grayscale with enhanced contrast
  const imgData = tctx.createImageData(mriData.width, mriData.height);
  const { data } = imgData;
  
  // Find min/max values for proper scaling
  if (!mriData.data || mriData.data.length === 0) {
    console.warn('MRI data is empty or invalid');
    return;
  }
  
  let min = mriData.data[0], max = mriData.data[0];
  for (let i = 0; i < mriData.data.length; i++) {
    min = Math.min(min, mriData.data[i]);
    max = Math.max(max, mriData.data[i]);
  }
  
  const range = max - min;
  console.log(`MRI pixel range: ${min.toFixed(1)} to ${max.toFixed(1)} (range: ${range.toFixed(1)})`);
  
  for (let i = 0; i < mriData.data.length; i++) {
    // Scale pixel values from min-max to 0-255 for better contrast
    const normalized = range > 0 ? (mriData.data[i] - min) / range : 0;
    const v = Math.max(0, Math.min(255, Math.round(normalized * 255)));
    const idx4 = i * 4;
    data[idx4] = data[idx4+1] = data[idx4+2] = v;
    
    // Make only very dark background pixels transparent (more conservative threshold)
    if (v < 5) { // Much lower threshold for true black background only
      data[idx4+3] = 0; // Fully transparent
    } else {
      data[idx4+3] = 255; // Fully opaque for all anatomy
    }
  }
  tctx.putImageData(imgData, 0, 0);

  // PROPER PHYSICAL SCALING using pixel spacings
  const w = mriData.width;
  const h = mriData.height;
  
  console.log(`MRI dimensions: ${w}x${h}, Canvas: ${canvasWidth}x${canvasHeight}`);
  
  // Helper function to normalize spacing arrays
  function normalizeSpacing(sp: string|string[]|number[]|undefined|null) {
    if (Array.isArray(sp)) return sp.map(Number);
    if (typeof sp === "string") return sp.split("\\").map(Number);
    return [1, 1];
  }
  
  // Get normalized pixel spacings for CT (with fallbacks)
  const ctSpacingArr = normalizeSpacing(
    (primaryImage as any).pixelSpacing ?? (primaryImage as any).imageMetadata?.pixelSpacing
  );
  
  // Use the same coordinate system as CT rendering - NO independent centering
  let drawX: number = 0;
  let drawY: number = 0;
  let drawW: number = w;
  let drawH: number = h;
  
  // Get the actual secondary image that was used for interpolation to access its metadata
  let actualSecondaryImage = null;
  if (transformedMRI.length > 0) {
    // Find the MRI image closest to this CT slice
    const distances = transformedMRI.map(t => ({
      image: t.image,
      distance: Math.abs(t.zInCT - ctSliceZ)
    }));
    distances.sort((a, b) => a.distance - b.distance);
    actualSecondaryImage = distances[0]?.image;
  }

  // Get MRI pixel spacing from the actual MRI metadata with robust fallbacks
  let mriSpacingArr: number[] | null = null;
  if (actualSecondaryImage) {
    const psTop = (actualSecondaryImage as any).pixelSpacing;
    const psMeta = (actualSecondaryImage as any).imageMetadata?.pixelSpacing;
    let psCache: any = undefined;
    try {
      if (secondaryImageCache?.has((actualSecondaryImage as any).sopInstanceUID)) {
        psCache = secondaryImageCache.get((actualSecondaryImage as any).sopInstanceUID)?.metadata?.pixelSpacing;
      }
    } catch {}
    const ps = psTop ?? psMeta ?? psCache;
    mriSpacingArr = normalizeSpacing(ps);
  }
  
  if (!mriSpacingArr || mriSpacingArr.length !== 2 || mriSpacingArr.some(v => !isFinite(v) || v <= 0)) {
    console.error('Invalid or missing MRI pixel spacing - cannot safely render fusion overlay');
    return; // Do not render fusion without valid pixel spacing
  }
  
  console.log(`CT spacing: [${ctSpacingArr[0]}, ${ctSpacingArr[1]}]mm, MRI spacing: [${mriSpacingArr[0]}, ${mriSpacingArr[1]}]mm`);
  
  // Calculate scale factors - MRI should appear at same physical size as CT
  // If CT spacing is 0.97mm and MRI spacing is 1.95mm, then 1 MRI pixel = 2 CT pixels
  const scaleX = mriSpacingArr[1] / ctSpacingArr[1]; // How many CT pixels per MRI pixel
  const scaleY = mriSpacingArr[0] / ctSpacingArr[0]; 
  
  // Calculate MRI size in canvas pixels - need to apply both physical scaling AND CT zoom
  const ctScale = ctTransform?.scale || 1;
  drawW = w * scaleX * ctScale;  // Apply physical scaling AND CT zoom
  drawH = h * scaleY * ctScale;
  
  console.log(`Physical scale: X=${scaleX.toFixed(3)}, Y=${scaleY.toFixed(3)}, CT zoom=${ctScale}, Final MRI size: ${drawW.toFixed(1)}x${drawH.toFixed(1)}`);

  // Helper function to normalize arrays
  const toNumberArray = (sp: string|string[]|number[]|undefined|null) => {
    if (Array.isArray(sp)) return sp.map(Number);
    if (typeof sp === "string") return sp.split("\\").map(Number);
    return [0, 0, 0]; // safer fallback for positions/origins
  };
  const toNumberArrayFlexible = (val: any): number[] => {
    if (Array.isArray(val)) return val.map(Number);
    if (typeof val === 'string') return val.split('\\').map(Number);
    return [];
  };
  
  // Matrix multiplication helper
  const multiplyMatrixVector = (matrix: number[], vector: number[]): number[] => {
    const [x, y, z, w] = vector;
    return [
      matrix[0] * x + matrix[1] * y + matrix[2] * z + matrix[3] * w,
      matrix[4] * x + matrix[5] * y + matrix[6] * z + matrix[7] * w,
      matrix[8] * x + matrix[9] * y + matrix[10] * z + matrix[11] * w,
      matrix[12] * x + matrix[13] * y + matrix[14] * z + matrix[15] * w
    ];
  };

  // Apply full 2D affine derived from 3D registration (includes rotation) when orientations are available
  if (registrationMatrix && registrationMatrix.length === 16 && actualSecondaryImage && ctTransform) {
    // CT orientation/origin
    const ctOrigin = toNumberArray((primaryImage as any).imagePosition || (primaryImage as any).imageMetadata?.imagePosition);
    const ctIOP = toNumberArrayFlexible((primaryImage.imageOrientation ?? primaryImage.imageMetadata?.imageOrientation) as any);
    const hasCTDirs = ctIOP.length >= 6;
    // MRI orientation/origin
    let mriOriginArr: number[] = toNumberArrayFlexible((actualSecondaryImage as any).imagePosition);
    if ((!mriOriginArr || mriOriginArr.length < 3) && secondaryImageCache?.has(actualSecondaryImage.sopInstanceUID)) {
      const meta = secondaryImageCache.get(actualSecondaryImage.sopInstanceUID)?.metadata;
      const v = meta?.imagePosition;
      if (v) mriOriginArr = toNumberArrayFlexible(v);
    }
    const mriOrigin = (mriOriginArr && mriOriginArr.length >= 3) ? mriOriginArr : [0, 0, ctSliceZ];
    const mriIOP = toNumberArrayFlexible((actualSecondaryImage.imageOrientation ?? actualSecondaryImage.imageMetadata?.imageOrientation) as any);
    const hasMRIDirs = mriIOP.length >= 6;

    if (hasCTDirs && hasMRIDirs) {
      // Direction cosines
      const ctRow = [ctIOP[0], ctIOP[1], ctIOP[2]];
      const ctCol = [ctIOP[3], ctIOP[4], ctIOP[5]];
      const [ctRowSp, ctColSp] = ctSpacingArr; // [row, col]
      const mriRow = [mriIOP[0], mriIOP[1], mriIOP[2]];
      const mriCol = [mriIOP[3], mriIOP[4], mriIOP[5]];
      const [mriRowSp, mriColSp] = mriSpacingArr; // [row, col]

      const dot = (a: number[], b: number[]) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];

      // Map MRI pixel (u,v) to CT canvas using full chain
      const mapPoint = (u: number, v: number): [number, number] => {
        const Xw = mriOrigin[0] + v * mriRow[0] * mriRowSp + u * mriCol[0] * mriColSp;
        const Yw = mriOrigin[1] + v * mriRow[1] * mriRowSp + u * mriCol[1] * mriColSp;
        const Zw = mriOrigin[2] + v * mriRow[2] * mriRowSp + u * mriCol[2] * mriColSp;
        const [cx, cy, cz] = multiplyMatrixVector(registrationMatrix, [Xw, Yw, Zw, 1]).slice(0, 3);
        const worldOffset = [cx - ctOrigin[0], cy - ctOrigin[1], cz - ctOrigin[2]];
        const px = dot(worldOffset, ctCol) / (ctColSp || 1);
        const py = dot(worldOffset, ctRow) / (ctRowSp || 1);
        return [ctTransform.offsetX + px * ctTransform.scale, ctTransform.offsetY + py * ctTransform.scale];
      };

      const [x0, y0] = mapPoint(0, 0);
      const [xU, yU] = mapPoint(1, 0); // +1 col pixel
      const [xV, yV] = mapPoint(0, 1); // +1 row pixel
      const Ux = xU - x0, Uy = yU - y0; // column basis in canvas
      const Vx = xV - x0, Vy = yV - y0; // row basis in canvas

      // Draw with affine transform
      ctx.save();
      ctx.globalAlpha = fusionOpacity;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.setTransform(Ux, Uy, Vx, Vy, x0, y0);
      ctx.drawImage(temp, 0, 0);
      ctx.restore();

      console.log(`✅ AFFINE REGISTRATION:`);
      console.log(`  Canvas basis U=(${Ux.toFixed(3)}, ${Uy.toFixed(3)}), V=(${Vx.toFixed(3)}, ${Vy.toFixed(3)}) at (${x0.toFixed(1)}, ${y0.toFixed(1)})`);
      return; // Avoid double-draw; we've rendered using affine mapping
    }
  }

  // SIMPLIFIED: Apply registration matrix directly
  if (registrationMatrix && registrationMatrix.length === 16 && actualSecondaryImage && ctTransform) {
    
    // Get CT and MRI origins in world coordinates
    const ctOrigin = toNumberArray((primaryImage as any).imagePosition || (primaryImage as any).imageMetadata?.imagePosition);  // [X0, Y0, Z0]
    // Try to get MRI origin from secondary image metadata or cache
    let mriOriginArr: number[] = toNumberArrayFlexible((actualSecondaryImage as any).imagePosition);
    if ((!mriOriginArr || mriOriginArr.length < 3) && secondaryImageCache?.has(actualSecondaryImage.sopInstanceUID)) {
      const meta = secondaryImageCache.get(actualSecondaryImage.sopInstanceUID)?.metadata;
      const v = meta?.imagePosition;
      if (v) mriOriginArr = toNumberArrayFlexible(v);
    }
    const mriOrigin = (mriOriginArr && mriOriginArr.length >= 3) ? mriOriginArr : [0,0,ctSliceZ];
    const [rowSpacing, colSpacing] = ctSpacingArr; // CT pixel spacing [row, col]

    // Transform MRI origin to CT space using registration matrix
    const [mriCT_x, mriCT_y, mriCT_z] = multiplyMatrixVector(registrationMatrix, [...mriOrigin, 1]);
    
    // Calculate world-space offset vector between transformed MRI origin and CURRENT CT slice origin
    const worldOffset = [
      mriCT_x - ctOrigin[0],
      mriCT_y - ctOrigin[1],
      mriCT_z - ctOrigin[2]
    ];

    // Parse CT image orientation to get row/column direction cosines
    const iop = toNumberArrayFlexible(
      (primaryImage.imageOrientation ?? primaryImage.imageMetadata?.imageOrientation) as any
    );
    let pixelOffsetX = 0;
    let pixelOffsetY = 0;
    if (iop.length >= 6) {
      const r = [iop[0], iop[1], iop[2]]; // row direction
      const c = [iop[3], iop[4], iop[5]]; // column direction
      // Project world offset onto CT row/column axes and convert to pixels
      const dot = (a: number[], b: number[]) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
      const offsetAlongColMM = dot(worldOffset, c);
      const offsetAlongRowMM = dot(worldOffset, r);
      pixelOffsetX = offsetAlongColMM / (colSpacing || 1);
      pixelOffsetY = offsetAlongRowMM / (rowSpacing || 1);
    } else {
      // Fallback: assume axes aligned with patient X/Y (less accurate)
      pixelOffsetX = worldOffset[0] / (colSpacing || 1);
      pixelOffsetY = worldOffset[1] / (rowSpacing || 1);
    }
    
    // Apply CT's canvas transform to the MRI position
    drawX = ctTransform.offsetX + (pixelOffsetX * ctTransform.scale);
    drawY = ctTransform.offsetY + (pixelOffsetY * ctTransform.scale);
    
    console.log(`✅ SIMPLIFIED REGISTRATION:`);
    console.log(`  CT origin (slice): [${ctOrigin[0].toFixed(1)}, ${ctOrigin[1].toFixed(1)}, ${ctOrigin[2].toFixed(1)}]`);
    console.log(`  MRI origin: [${mriOrigin[0].toFixed(1)}, ${mriOrigin[1].toFixed(1)}, ${mriOrigin[2].toFixed(1)}]`);
    console.log(`  MRI→CT origin: [${mriCT_x.toFixed(1)}, ${mriCT_y.toFixed(1)}, ${mriCT_z.toFixed(1)}]`);
    console.log(`  World offset (mm): [${worldOffset[0].toFixed(1)}, ${worldOffset[1].toFixed(1)}, ${worldOffset[2].toFixed(1)}]`);
    console.log(`  Pixel offset (proj): [${pixelOffsetX.toFixed(1)}, ${pixelOffsetY.toFixed(1)}]px`);
    console.log(`  Canvas position: [${drawX.toFixed(1)}, ${drawY.toFixed(1)}]`);
    console.log(`  MRI size: [${drawW.toFixed(1)}, ${drawH.toFixed(1)}]`);
  } else if (!ctTransform) {
    console.warn('⚠️ No CT transform available for fusion alignment');
    // Fallback: center the MRI
    drawX = (canvasWidth - drawW) / 2;
    drawY = (canvasHeight - drawH) / 2;
  }

  // Standard draw without rotation - using proper physical scaling
  ctx.save();
  ctx.globalAlpha = fusionOpacity;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  
  // Draw the MRI using the already calculated position and size
  if (drawX !== undefined && drawY !== undefined && drawW !== undefined && drawH !== undefined) {
    ctx.drawImage(temp, drawX, drawY, drawW, drawH);
    console.log(`✓ MRI overlay drawn: size=${drawW.toFixed(1)}x${drawH.toFixed(1)}, pos=(${drawX.toFixed(1)},${drawY.toFixed(1)}), opacity=${fusionOpacity}`);
  } else {
    // Fallback to centered positioning if calculations failed
    const centerX = (canvasWidth - w) / 2;
    const centerY = (canvasHeight - h) / 2;
    ctx.drawImage(temp, centerX, centerY, w, h);
    console.log(`✓ MRI overlay drawn (fallback): centered at (${centerX.toFixed(1)},${centerY.toFixed(1)})`);
  }
  
  console.log(`✓ Fusion complete: opacity=${fusionOpacity}, scale=${scaleX.toFixed(3)}x${scaleY.toFixed(3)}`);
  // NO RESTORE - caller manages the transform state
}
