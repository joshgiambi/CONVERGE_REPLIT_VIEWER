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
export function computeTransformedMRIPositions(secondaryImages: any[], registrationMatrix: number[]) {
  // Build 4x4 matrix
  const M = [
    [registrationMatrix[0], registrationMatrix[1], registrationMatrix[2], registrationMatrix[3]],
    [registrationMatrix[4], registrationMatrix[5], registrationMatrix[6], registrationMatrix[7]],
    [registrationMatrix[8], registrationMatrix[9], registrationMatrix[10], registrationMatrix[11]],
    [registrationMatrix[12], registrationMatrix[13], registrationMatrix[14], registrationMatrix[15]]
  ];

  const transformed = secondaryImages.map(img => {
    // Parse imagePosition into [x,y,z]
    const pos = Array.isArray(img.imagePosition)
      ? img.imagePosition.map(Number)
      : img.imagePosition.split('\\').map(Number);
    const hom = [pos[0], pos[1], pos[2], 1];
    const [xInCT, yInCT, zInCT] = multiplyMatrixVector(M, hom).slice(0, 3);
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
  secondaryImageCache: Map<string, {data: Float32Array, width: number, height: number}>,
  ctSliceZ: number,
  fusionOpacity: number,
  panX: number,
  panY: number,
  canvasWidth: number,
  canvasHeight: number,
  registrationMatrix?: number[]
) {
  // STRICT Z-range check: Only render fusion within actual MRI coverage
  if (transformedMRI.length > 0) {
    const zValues = transformedMRI.map(t => t.zInCT);
    const minZ = Math.min(...zValues);
    const maxZ = Math.max(...zValues);
    
    // Only render fusion if CT slice is within MRI coverage range
    if (ctSliceZ < minZ - 2 || ctSliceZ > maxZ + 2) { // Tight 2mm tolerance
      console.log(`CT slice ${ctSliceZ}mm outside MRI range ${minZ.toFixed(1)}-${maxZ.toFixed(1)}mm, skipping fusion to prevent slice repetition`);
      return; // Exit early - no fusion rendering
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

  // PROPER MM-TO-PIXEL SCALING using CT metadata
  const w = mriData.width;
  const h = mriData.height;
  
  // Get CT pixel spacing for proper mm-to-pixel conversion
  let ctPixelSpacing = [0.9765625, 0.9765625]; // Default fallback
  
  if (primaryImage.pixelSpacing) {
    if (typeof primaryImage.pixelSpacing === 'string') {
      ctPixelSpacing = primaryImage.pixelSpacing.split('\\').map(Number);
    } else if (Array.isArray(primaryImage.pixelSpacing)) {
      ctPixelSpacing = primaryImage.pixelSpacing.map(Number);
    }
  }
  
  const ctPixelSpacingX = ctPixelSpacing[1] || ctPixelSpacing[0]; // Column spacing (X)
  const ctPixelSpacingY = ctPixelSpacing[0]; // Row spacing (Y)
  
  // Calculate proper scaling from CT dimensions
  const ctImageWidth = 512; // Standard CT matrix size
  const ctImageHeight = 512;
  const scaleX = canvasWidth / (ctImageWidth * ctPixelSpacingX);
  const scaleY = canvasHeight / (ctImageHeight * ctPixelSpacingY);
  const baseScale = Math.min(scaleX, scaleY);
  
  // Center the CT image on canvas
  const offsetX = (canvasWidth - ctImageWidth * baseScale) / 2;
  const offsetY = (canvasHeight - ctImageHeight * baseScale) / 2;
  
  console.log(`CT pixel spacing: ${ctPixelSpacingX.toFixed(3)}mm x ${ctPixelSpacingY.toFixed(3)}mm, base scale: ${baseScale.toFixed(3)}`);
  
  let drawX = offsetX + panX;
  let drawY = offsetY + panY;
  let drawW = w * baseScale;
  let drawH = h * baseScale;
  
  // Apply registration matrix transformation if available
  if (registrationMatrix && registrationMatrix.length === 16) {
    // Extract translation in mm
    const tx_mm = registrationMatrix[3];
    const ty_mm = registrationMatrix[7];
    const tz_mm = registrationMatrix[11];
    
    // Convert mm translation to pixels
    const tx_px = (tx_mm / ctPixelSpacingX) * baseScale;
    const ty_px = (ty_mm / ctPixelSpacingY) * baseScale;
    
    drawX += tx_px;
    drawY += ty_px;
    
    console.log(`🎯 Registration translation: (${tx_mm.toFixed(1)}, ${ty_mm.toFixed(1)}, ${tz_mm.toFixed(1)})mm → (${tx_px.toFixed(1)}, ${ty_px.toFixed(1)})px`);
    
    // Check if matrix has rotation/shear (non-identity 2x2 submatrix)
    const a = registrationMatrix[0], b = registrationMatrix[1];
    const c = registrationMatrix[4], d = registrationMatrix[5];
    const hasRotation = Math.abs(a - 1) > 0.001 || Math.abs(b) > 0.001 || Math.abs(c) > 0.001 || Math.abs(d - 1) > 0.001;
    
    if (hasRotation) {
      // Apply full transformation matrix for rotation/shear
      const e = drawX;
      const f = drawY;
      
      ctx.save();
      ctx.globalAlpha = fusionOpacity;
      ctx.setTransform(a * baseScale, c * baseScale, b * baseScale, d * baseScale, e, f);
      ctx.drawImage(temp, 0, 0);
      ctx.restore();
      
      console.log(`✓ MRI overlay with rotation: transform=(${a.toFixed(3)}, ${b.toFixed(3)}, ${c.toFixed(3)}, ${d.toFixed(3)}), pos=(${e.toFixed(1)}, ${f.toFixed(1)})`);
      return;
    }
  }

  // Standard draw without rotation
  ctx.save();
  ctx.globalAlpha = fusionOpacity;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(temp, drawX, drawY, drawW, drawH);
  ctx.restore();
  
  console.log(`✓ MRI overlay drawn: size=${drawW.toFixed(1)}x${drawH.toFixed(1)}, pos=(${drawX.toFixed(1)},${drawY.toFixed(1)}), opacity=${fusionOpacity}`);
}