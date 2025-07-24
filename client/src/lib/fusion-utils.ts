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
  registrationMatrix?: number[],
  ctTransform?: {scale: number, offsetX: number, offsetY: number, imageWidth: number, imageHeight: number} | null
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

  // PROPER PHYSICAL SCALING using pixel spacings
  const w = mriData.width;
  const h = mriData.height;
  
  console.log(`MRI dimensions: ${w}x${h}, Canvas: ${canvasWidth}x${canvasHeight}`);
  
  // Helper function to normalize spacing arrays
  function normalizeSpacing(sp: string|string[]|number[]) {
    if (Array.isArray(sp)) return sp.map(Number);
    if (typeof sp === "string") return sp.split("\\").map(Number);
    return [1, 1];
  }
  
  // Get normalized pixel spacings for both CT and MRI
  const ctSpacingArr = normalizeSpacing(primaryImage.pixelSpacing);
  
  // For MRI, we need to get the pixel spacing from the MRI metadata
  // For now, assume MRI has standard spacing - this should be extracted from MRI DICOM metadata
  const mriSpacingArr = [0.9765625, 0.9765625]; // TODO: Get from actual MRI metadata
  
  console.log(`CT spacing: [${ctSpacingArr[0]}, ${ctSpacingArr[1]}]mm, MRI spacing: [${mriSpacingArr[0]}, ${mriSpacingArr[1]}]mm`);
  
  // Calculate scale factors for proper physical mm-to-mm mapping
  const scaleX = mriSpacingArr[1] / ctSpacingArr[1]; // column spacing (X)
  const scaleY = mriSpacingArr[0] / ctSpacingArr[0]; // row spacing (Y)
  const destW = w * scaleX;
  const destH = h * scaleY;
  
  console.log(`Scale factors: X=${scaleX.toFixed(3)}, Y=${scaleY.toFixed(3)}, Dest size: ${destW.toFixed(1)}x${destH.toFixed(1)}`);
  
  // Use the same coordinate system as CT rendering - NO independent centering
  let drawX: number;
  let drawY: number;
  let drawW = destW;
  let drawH = destH;
  
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

  // Apply registration matrix transformation if available
  if (registrationMatrix && registrationMatrix.length === 16 && actualSecondaryImage) {
    // Helper function to normalize arrays
    function toNumberArray(sp: string|string[]|number[]) {
      if (Array.isArray(sp)) return sp.map(Number);
      if (typeof sp === "string") return sp.split("\\").map(Number);
      return [1, 1, 1]; // fallback
    }
    
    // Matrix multiplication helper
    function multiplyMatrixVector(matrix: number[], vector: number[]): number[] {
      const [x, y, z, w] = vector;
      return [
        matrix[0] * x + matrix[1] * y + matrix[2] * z + matrix[3] * w,
        matrix[4] * x + matrix[5] * y + matrix[6] * z + matrix[7] * w,
        matrix[8] * x + matrix[9] * y + matrix[10] * z + matrix[11] * w,
        matrix[12] * x + matrix[13] * y + matrix[14] * z + matrix[15] * w
      ];
    }
    
    // PROPER DICOM COORDINATE TRANSFORMATION using ImageOrientationPatient
    
    // 1) Fetch CT's orientation and spacing from DICOM metadata
    const ipp = toNumberArray(primaryImage.imagePosition);  // [X0, Y0, Z0]
    const iop = toNumberArray(primaryImage.imageOrientation); // [rX, rY, rZ, cX, cY, cZ]
    const rowCosine = iop.slice(0, 3);  // First 3 values: row direction cosines
    const colCosine = iop.slice(3, 6);  // Last 3 values: column direction cosines
    const [rowSpacing, colSpacing] = ctSpacingArr; // [mm per row, mm per col]
    
    // 2) Get MRI origin and transform to CT space using registration matrix
    const mriOrigin = toNumberArray(actualSecondaryImage.imagePosition);  // [x1, y1, z1]
    const [mriCT_x, mriCT_y, mriCT_z] = multiplyMatrixVector(registrationMatrix, [...mriOrigin, 1]);
    
    // 3) Compute world-space offset between transformed MRI origin and CT origin
    const delta = [
      mriCT_x - ipp[0],
      mriCT_y - ipp[1], 
      mriCT_z - ipp[2]
    ];
    
    // 4) Project world offset onto CT image axes to get exact pixel offsets
    const dot = (a: number[], b: number[]) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
    
    // CORRECTED: Swap dot products as per DICOM specification
    const dx_px = dot(delta, rowCosine) / colSpacing;  // Row direction / column spacing (X movement)
    const dy_px = dot(delta, colCosine) / rowSpacing;  // Column direction / row spacing (Y movement)
    
    // 5) Apply pixel offsets using the SAME coordinate system as CT rendering
    let baseX: number;
    let baseY: number;
    
    if (ctTransform) {
      // Use the exact same coordinate system as the CT image
      console.log(`✅ Using shared CT coordinate system: scale=${ctTransform.scale}, offset=(${ctTransform.offsetX}, ${ctTransform.offsetY})`);
      baseX = ctTransform.offsetX;
      baseY = ctTransform.offsetY;
    } else {
      // Fallback to independent centering if ctTransform not available
      console.log(`⚠️ Fallback to independent centering - ctTransform not available`);
      baseX = (canvasWidth - destW) / 2 + panX;
      baseY = (canvasHeight - destH) / 2 + panY;
    }
    
    drawX = baseX + dx_px;   // Add X offset (positive = right)
    drawY = baseY - dy_px;   // Subtract Y offset (canvas Y grows down)
    
    console.log(`🎯 PROPER DICOM COORDINATE TRANSFORMATION (CORRECTED):`);
    console.log({
      rowCosine,
      colCosine,
      rowSpacing,
      colSpacing,
      delta,
      pxOffsetX: dx_px,
      pxOffsetY: dy_px
    });
    console.log(`  CT IPP: [${ipp[0]}, ${ipp[1]}, ${ipp[2]}]mm`);
    console.log(`  CT IOP row: [${rowCosine[0].toFixed(3)}, ${rowCosine[1].toFixed(3)}, ${rowCosine[2].toFixed(3)}]`);
    console.log(`  CT IOP col: [${colCosine[0].toFixed(3)}, ${colCosine[1].toFixed(3)}, ${colCosine[2].toFixed(3)}]`);
    console.log(`  CT spacing: [${rowSpacing}, ${colSpacing}]mm/px`);
    console.log(`  MRI origin: [${mriOrigin[0]}, ${mriOrigin[1]}, ${mriOrigin[2]}]mm`);
    console.log(`  MRI→CT: [${mriCT_x.toFixed(1)}, ${mriCT_y.toFixed(1)}, ${mriCT_z.toFixed(1)}]mm`);
    console.log(`  World delta: [${delta[0].toFixed(1)}, ${delta[1].toFixed(1)}, ${delta[2].toFixed(1)}]mm`);
    console.log(`  Projected pixels: dx=${dx_px.toFixed(1)}px, dy=${dy_px.toFixed(1)}px`);
    console.log(`  Final position: (${drawX.toFixed(1)}, ${drawY.toFixed(1)}) vs center: (${baseX.toFixed(1)}, ${baseY.toFixed(1)})`);
    
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
      // Apply scaled transformation matrix for rotation/shear
      ctx.setTransform(a * scaleX, c * scaleY, b * scaleX, d * scaleY, e, f);
      ctx.drawImage(temp, 0, 0);
      ctx.restore();
      
      console.log(`✓ MRI overlay with rotation: transform=(${a.toFixed(3)}, ${b.toFixed(3)}, ${c.toFixed(3)}, ${d.toFixed(3)}), pos=(${e.toFixed(1)}, ${f.toFixed(1)})`);
      return;
    }
  }

  // Standard draw without rotation - using proper physical scaling
  ctx.save();
  ctx.globalAlpha = fusionOpacity;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  
  // Apply the CT transform if available to ensure exact same coordinate system
  if (ctTransform && registrationMatrix && actualSecondaryImage) {
    console.log('🔥 Applying ctx.setTransform: Putting MRI in exact CT coordinate system');
    // Apply the same transform that was used for CT
    ctx.setTransform(
      ctTransform.scale, 0,
      0, ctTransform.scale,
      ctTransform.offsetX,
      ctTransform.offsetY
    );
    
    // We're now in the CT's transformed coordinate system
    // The CT image is drawn at (0, 0) in this coordinate system
    // We need to figure out where to draw the MRI relative to this
    
    // Get image positions in world coordinates
    const ctIPP = toNumberArray(primaryImage.imagePosition);
    const mriIPP = toNumberArray(actualSecondaryImage.imagePosition);
    
    // Get MRI and CT centers in physical space
    const mriCenterX = mriIPP[0] + (w / 2) * mriSpacingArr[1];
    const mriCenterY = mriIPP[1] + (h / 2) * mriSpacingArr[0];
    const mriCenterZ = mriIPP[2];
    
    const ctCenterX = ctIPP[0] + (ctTransform.imageWidth / 2) * ctSpacingArr[1];
    const ctCenterY = ctIPP[1] + (ctTransform.imageHeight / 2) * ctSpacingArr[0];
    
    // Transform MRI center to CT coordinate space
    const mriCenterVector = [mriCenterX, mriCenterY, mriCenterZ, 1];
    const mriCenterCT_x = registrationMatrix[0] * mriCenterVector[0] + registrationMatrix[1] * mriCenterVector[1] + 
                          registrationMatrix[2] * mriCenterVector[2] + registrationMatrix[3] * mriCenterVector[3];
    const mriCenterCT_y = registrationMatrix[4] * mriCenterVector[0] + registrationMatrix[5] * mriCenterVector[1] + 
                          registrationMatrix[6] * mriCenterVector[2] + registrationMatrix[7] * mriCenterVector[3];
    
    // Calculate the offset from CT center to transformed MRI center in mm
    const offsetX_mm = mriCenterCT_x - ctCenterX;
    const offsetY_mm = mriCenterCT_y - ctCenterY;
    
    // Convert mm offset to pixels
    const offsetX_px = offsetX_mm / ctSpacingArr[1];  // X uses column spacing
    const offsetY_px = offsetY_mm / ctSpacingArr[0];  // Y uses row spacing
    
    // Calculate final position
    // The CT is drawn centered at (256, 256) in its 512x512 space
    // We need to position the MRI relative to this center
    const ctImageCenterX = ctTransform.imageWidth / 2;
    const ctImageCenterY = ctTransform.imageHeight / 2;
    
    // Calculate where to draw the MRI
    const drawX = ctImageCenterX - (w / 2) + offsetX_px;
    const drawY = ctImageCenterY - (h / 2) - offsetY_px;  // Negative because Y is inverted
    
    // Draw MRI at the calculated position
    ctx.drawImage(temp, drawX, drawY, w, h);
    
    console.log(`✓ MRI drawn using ctx.setTransform approach:`);
    console.log(`  CT IPP: [${ctIPP[0].toFixed(1)}, ${ctIPP[1].toFixed(1)}, ${ctIPP[2].toFixed(1)}]mm`);
    console.log(`  MRI IPP: [${mriIPP[0].toFixed(1)}, ${mriIPP[1].toFixed(1)}, ${mriIPP[2].toFixed(1)}]mm`);
    console.log(`  MRI center: [${mriCenterX.toFixed(1)}, ${mriCenterY.toFixed(1)}, ${mriCenterZ.toFixed(1)}]mm`);
    console.log(`  CT center: [${ctCenterX.toFixed(1)}, ${ctCenterY.toFixed(1)}]mm`);
    console.log(`  MRI center→CT: [${mriCenterCT_x.toFixed(1)}, ${mriCenterCT_y.toFixed(1)}]mm`);
    console.log(`  Offset (mm): [${offsetX_mm.toFixed(1)}, ${offsetY_mm.toFixed(1)}]`);
    console.log(`  Offset (px): [${offsetX_px.toFixed(1)}, ${offsetY_px.toFixed(1)}]`);
    console.log(`  Draw at: (${drawX.toFixed(1)}, ${drawY.toFixed(1)})`);
  } else {
    // Fallback to calculated positions if no ctTransform
    if (!drawX || !drawY || !drawW || !drawH) {
      // Basic centered positioning if draw variables not calculated
      drawX = (canvasWidth - w) / 2;
      drawY = (canvasHeight - h) / 2;
      drawW = w;
      drawH = h;
    }
    ctx.drawImage(temp, drawX, drawY, drawW, drawH);
    console.log(`✓ MRI overlay drawn (fallback): size=${drawW.toFixed(1)}x${drawH.toFixed(1)}, pos=(${drawX.toFixed(1)},${drawY.toFixed(1)})`);
  }
  
  ctx.restore();
  
  console.log(`✓ Fusion complete: opacity=${fusionOpacity}, scale=${scaleX.toFixed(3)}x${scaleY.toFixed(3)}`);
}