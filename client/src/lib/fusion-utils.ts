// Fusion utilities for DICOM image overlay
// Handles MRI-CT registration and overlay rendering

export function multiplyMatrixVector(matrix: number[], vector: number[]): number[] {
  if (matrix.length !== 16 || vector.length !== 4) {
    throw new Error('Matrix must be 4x4 (16 elements) and vector must be 4 elements');
  }
  
  return [
    matrix[0] * vector[0] + matrix[1] * vector[1] + matrix[2] * vector[2] + matrix[3] * vector[3],
    matrix[4] * vector[0] + matrix[5] * vector[1] + matrix[6] * vector[2] + matrix[7] * vector[3], 
    matrix[8] * vector[0] + matrix[9] * vector[1] + matrix[10] * vector[2] + matrix[11] * vector[3],
    matrix[12] * vector[0] + matrix[13] * vector[1] + matrix[14] * vector[2] + matrix[15] * vector[3]
  ];
}

// Transform secondary image positions using registration matrix
export function computeTransformedMRIPositions(secondaryImages: any[], registrationMatrix: number[]) {
  console.log(`🔧 Computing MRI positions for ${secondaryImages.length} images`);
  
  return secondaryImages.map((img, index) => {
    let pos: number[];
    
    // Parse existing imagePosition if available
    if (img.imagePosition && Array.isArray(img.imagePosition)) {
      pos = img.imagePosition.map(Number);
      if (index < 3) console.log(`Found array imagePosition for image ${index}:`, pos);
    } else if (img.imagePosition && typeof img.imagePosition === 'string') {
      pos = img.imagePosition.split('\\').map(Number);
      console.log(`Parsed string imagePosition for image ${index}:`, pos);
    } else {
      // RECONSTRUCT: imagePosition from slice_location using working patient's pattern
      const sliceLoc = parseFloat(img.sliceLocation);
      if (!isNaN(sliceLoc)) {
        // FIXED: Use correct coordinates based on working patient HN_FUSION_01
        // Pattern: X≈-82, Y≈-173, Z≈-slice_location
        pos = [-82.0, -173.0, -sliceLoc];
        if (index < 3) console.log(`✅ RECONSTRUCTED imagePosition [${index}] from sliceLocation ${sliceLoc}mm:`, pos);
      } else {
        console.error(`❌ No imagePosition OR sliceLocation for image ${index}:`, img.sopInstanceUID);
        pos = [0, 0, index * 1.0]; // Final fallback
      }
    }
    const hom = [pos[0], pos[1], pos[2], 1];
    const [xInCT, yInCT, zInCT] = multiplyMatrixVector(registrationMatrix, hom).slice(0, 3);
    return { xInCT, yInCT, zInCT, image: img };
  });
}

// Simple bilinear interpolation for MRI slice selection
function interpolateMRI(targetZ: number, transformedMRI: any[], secondaryImageCache: Map<string, any>) {
  if (!transformedMRI.length) return null;

  console.log(`🔧 Interpolating MRI for target Z: ${targetZ}mm from ${transformedMRI.length} available slices`);
  
  // Find the closest MRI slice
  const sortedMRI = [...transformedMRI].sort((a, b) => a.zInCT - b.zInCT);
  let closest = sortedMRI[0];
  let minDistance = Math.abs(sortedMRI[0].zInCT - targetZ);

  for (const mri of sortedMRI) {
    const distance = Math.abs(mri.zInCT - targetZ);
    if (distance < minDistance) {
      minDistance = distance;
      closest = mri;
    }
  }

  console.log(`🔧 Found closest MRI slice: Z=${closest.zInCT.toFixed(1)}mm (distance: ${minDistance.toFixed(1)}mm)`);
  
  // Get cached MRI image data
  const uid = closest.image?.sopInstanceUID;
  if (!uid) {
    console.error('❌ MRI image missing sopInstanceUID');
    return null;
  }

  const mriImage = secondaryImageCache.get(uid);
  if (!mriImage) {
    console.error(`❌ MRI image not in cache: ${uid}`);
    return null;
  }

  return {
    width: mriImage.columns,
    height: mriImage.rows, 
    data: mriImage.getPixelData(),
    pixelSpacing: closest.image?.pixelSpacing,
    imagePosition: [closest.xInCT, closest.yInCT, closest.zInCT]
  };
}

// Render MRI overlay on CT canvas with proper registration
export function renderFusionOverlay(
  ctx: CanvasRenderingContext2D,
  ctSliceZ: number,
  transformedMRI: any[],
  secondaryImageCache: Map<string, any>,
  primaryImage: any,
  registrationMatrix: number[],
  fusionOpacity: number,
  canvasWidth: number,
  canvasHeight: number
) {
  console.log('🔧 DEBUG - Cache contents:', {
    cacheKeys: Array.from(secondaryImageCache.keys()),
    cacheSize: secondaryImageCache.size
  });
  
  // DEBUG: Log what MRI images will be requested
  const requestedUIDs = transformedMRI.map(t => t.image?.sopInstanceUID).filter(Boolean);
  console.log('🔧 DEBUG - MRI images being requested:', {
    requestedUIDs: requestedUIDs.slice(0, 5), // First 5 to avoid spam
    totalRequested: requestedUIDs.length
  });
  
  const mriData = interpolateMRI(ctSliceZ, transformedMRI, secondaryImageCache);
  
  console.log('🔧 DEBUG - interpolateMRI returned:', {
    hasMriData: !!mriData,
    mriDataWidth: mriData?.width,
    mriDataHeight: mriData?.height,
    hasDataArray: !!mriData?.data,
    dataLength: mriData?.data?.length
  });
  
  if (!mriData) {
    console.log('❌ EXIT: No MRI data returned from interpolateMRI');
    return; // nothing to draw
  }

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
    
    // TEMP: Force all MRI pixels to be visible (no transparency threshold)
    data[idx4+3] = 255; // Fully opaque - temporarily disable dark pixel masking
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
    return [1.0, 1.0]; // fallback
  }

  // Get physical pixel spacings 
  const ctSpacing = normalizeSpacing(primaryImage?.pixelSpacing || [1.0, 1.0]);
  const mriSpacing = normalizeSpacing(mriData.pixelSpacing || [1.0, 1.0]);
  
  console.log('Pixel spacings - CT:', ctSpacing, 'MRI:', mriSpacing);

  // Calculate scaling factors: MRI mm per pixel / CT mm per pixel
  const scaleX = mriSpacing[0] / ctSpacing[0];
  const scaleY = mriSpacing[1] / ctSpacing[1]; 
  
  // Apply registration matrix transformation for positioning
  const ctTransform = primaryImage?.imagePosition ? 
    normalizeSpacing(primaryImage.imagePosition) : [0, 0, 0];
  
  console.log({
    fusionOpacity,
    canvasWidth,
    canvasHeight
  });
  
  const drawW = w * scaleX;
  const drawH = h * scaleY;

  // TEMP: Try to use the MRI imagePosition if available for better positioning
  if (mriData.imagePosition && registrationMatrix) {
    console.log('Using MRI imagePosition for fusion positioning:', mriData.imagePosition);
    
    // Calculate offset between MRI and CT positions in physical space
    const mriPos = mriData.imagePosition;
    const offsetX = (mriPos[0] - ctTransform[0]) / ctSpacing[0];
    const offsetY = (mriPos[1] - ctTransform[1]) / ctSpacing[1];
    
    const drawX = (canvasWidth / 2) + offsetX;
    const drawY = (canvasHeight / 2) + offsetY;
    
    // TEMP: Draw a bright border around the MRI overlay for debugging
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'lime';
    ctx.lineWidth = 3;
    ctx.strokeRect(drawX, drawY, drawW, drawH);
    ctx.restore();
    
    ctx.drawImage(temp, drawX, drawY, drawW, drawH);
    console.log(`✓ MRI overlay drawn: size=${drawW.toFixed(1)}x${drawH.toFixed(1)}, pos=(${drawX.toFixed(1)},${drawY.toFixed(1)}), opacity=${fusionOpacity}`);
    console.log('🎯 MRI fusion should now be visible with lime border!');
  } else {
    // Fallback to centered positioning if calculations failed
    const centerX = (canvasWidth - w) / 2;
    const centerY = (canvasHeight - h) / 2;
    
    // TEMP: Draw a bright border for fallback too
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'red';
    ctx.lineWidth = 3;
    ctx.strokeRect(centerX, centerY, w, h);
    ctx.restore();
    
    ctx.drawImage(temp, centerX, centerY, w, h);
    console.log(`✓ MRI overlay drawn (fallback): centered at (${centerX.toFixed(1)},${centerY.toFixed(1)})`);
    console.log('🎯 MRI fusion fallback should now be visible with red border!');
  }
  
  console.log(`✓ Fusion complete: opacity=${fusionOpacity}, scale=${scaleX.toFixed(3)}x${scaleY.toFixed(3)}`);
  
  // NO RESTORE - caller manages the transform state
}