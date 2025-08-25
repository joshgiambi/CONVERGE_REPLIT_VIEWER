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

/**
 * Robustly compute MRI slice positions in CT space.
 * - Never uses 'index as Z' or hard-coded XY.
 * - If an image lacks ImagePositionPatient (IPP), synthesize it along the true slice normal
 *   using ImageOrientationPatient (IOP) and a measured dz (SpacingBetweenSlices | SliceThickness | neighbor IPP delta).
 * - Returns CT-space coords AND the MRI-space IPP actually used (ippLPS) for each slice.
 */
export function computeTransformedMRIPositions(
  secondaryImages: Array<any>,
  registrationMatrix: number[]
): Array<{ xInCT: number; yInCT: number; zInCT: number; ippLPS: [number, number, number]; image: any }> {
  // 4x4 assumed row-major, MRI->CT in LPS
  const M = [
    [registrationMatrix[0],  registrationMatrix[1],  registrationMatrix[2],  registrationMatrix[3]],
    [registrationMatrix[4],  registrationMatrix[5],  registrationMatrix[6],  registrationMatrix[7]],
    [registrationMatrix[8],  registrationMatrix[9],  registrationMatrix[10], registrationMatrix[11]],
    [registrationMatrix[12], registrationMatrix[13], registrationMatrix[14], registrationMatrix[15]],
  ];
  const mul4 = (A: number[][], v: [number, number, number, number]) => {
    const r = [0,0,0,0];
    for (let i=0;i<4;i++) for (let j=0;j<4;j++) r[i]+=A[i][j]*v[j];
    return r as [number, number, number, number];
  };
  const toArr = (v: any): number[] | null => {
    if (Array.isArray(v)) return v.map(Number);
    if (typeof v === 'string') return v.split('\\').map(Number);
    return null;
  };
  const cross = (a:number[], b:number[]) => [ a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0] ];
  const norm = (a:number[]) => { const m = Math.hypot(a[0],a[1],a[2]); return m? [a[0]/m,a[1]/m,a[2]/m]:[0,0,1]; };

  console.log(`🔍 FUSION: Processing ${secondaryImages.length} MRI images for transformation`);
  if (!secondaryImages.length) return [];

  // Stable order: sliceLocation → parsedZPosition → instanceNumber → fileName
  const sorted = secondaryImages.slice().sort((a:any,b:any)=>{
    const getNum = (x:any) => (x===null||x===undefined||Number.isNaN(Number(x))) ? null : Number(x);
    const aSL = getNum(a.parsedSliceLocation ?? a.sliceLocation);
    const bSL = getNum(b.parsedSliceLocation ?? b.sliceLocation);
    if (aSL!==null && bSL!==null && aSL!==bSL) return aSL - bSL;
    const aZ  = getNum(a.parsedZPosition);
    const bZ  = getNum(b.parsedZPosition);
    if (aZ!==null && bZ!==null && aZ!==bZ) return aZ - bZ;
    const aIN = getNum(a.parsedInstanceNumber ?? a.instanceNumber);
    const bIN = getNum(b.parsedInstanceNumber ?? b.instanceNumber);
    if (aIN!==null && bIN!==null && aIN!==bIN) return aIN - bIN;
    const af = (a.fileName||'') as string; const bf=(b.fileName||'') as string;
    return af.localeCompare(bf, undefined, {numeric:true});
  });

  // Orientation from any image (prefer one that already has IPP)
  const refWithIPP = sorted.find((img:any) => toArr(img.imagePosition));
  const iopArr = toArr((refWithIPP?.imageOrientation) || sorted.find((img:any)=>img.imageOrientation)?.imageOrientation) || [1,0,0,0,1,0];
  const rowDir = [iopArr[0], iopArr[1], iopArr[2]];
  const colDir = [iopArr[3], iopArr[4], iopArr[5]];
  const sliceDir = norm(cross(rowDir, colDir));

  // dz (through‑plane step)
  let dz: number | null = null;
  const sbs = Number(refWithIPP?.spacingBetweenSlices ?? sorted[0]?.spacingBetweenSlices);
  if (Number.isFinite(sbs) && sbs>0) dz = sbs;
  const thk = Number(refWithIPP?.sliceThickness ?? sorted[0]?.sliceThickness);
  if (dz===null && Number.isFinite(thk) && thk>0) dz = thk;

  // If ≥2 IPPs exist, compute average neighbor spacing projected on sliceDir
  const ipps: Array<{idx:number, ipp:number[]}> = [];
  sorted.forEach((img:any, idx:number) => {
    const ipp = toArr(img.imagePosition);
    if (ipp && ipp.length===3 && ipp.every(Number.isFinite)) ipps.push({idx, ipp});
  });
  if (ipps.length>=2) {
    let sum=0, cnt=0;
    for (let i=1;i<ipps.length;i++) {
      const prev=ipps[i-1]; const curr=ipps[i];
      const d = [curr.ipp[0]-prev.ipp[0], curr.ipp[1]-prev.ipp[1], curr.ipp[2]-prev.ipp[2]];
      sum += Math.abs(d[0]*sliceDir[0] + d[1]*sliceDir[1] + d[2]*sliceDir[2]);
      cnt++;
    }
    const est = cnt? sum/cnt : null;
    if (est && est>0) dz = est;
  }
  if (!dz) dz = 1.0; // last resort (safe default)

  // Reference
  const refIdx = (refWithIPP ? sorted.indexOf(refWithIPP) : 0);
  const refIPP = toArr(refWithIPP?.imagePosition) || [0,0, (Number(sorted[0]?.parsedZPosition ?? sorted[0]?.sliceLocation) || 0)];
  const getSL = (img:any) => { const v = Number(img.parsedSliceLocation ?? img.sliceLocation); return Number.isFinite(v) ? v : null; };
  const refSliceLoc = getSL(sorted[refIdx]);

  // Build IPP for each slice
  const ippPerSlice: Array<[number,number,number]> = new Array(sorted.length) as any;
  for (let i=0;i<sorted.length;i++) {
    const img = sorted[i];
    const ipp = toArr(img.imagePosition);
    if (ipp && ipp.length===3 && ipp.every(Number.isFinite)) {
      ippPerSlice[i] = [ipp[0], ipp[1], ipp[2]];
    } else {
      const k = i - refIdx;
      if (refSliceLoc!==null && getSL(img)!==null) {
        const delta = (getSL(img)! - refSliceLoc);
        ippPerSlice[i] = [
          refIPP[0] + sliceDir[0]*delta,
          refIPP[1] + sliceDir[1]*delta,
          refIPP[2] + sliceDir[2]*delta,
        ];
      } else {
        ippPerSlice[i] = [
          refIPP[0] + sliceDir[0]*dz*k,
          refIPP[1] + sliceDir[1]*dz*k,
          refIPP[2] + sliceDir[2]*dz*k,
        ];
      }
    }
  }

  const transformed = sorted.map((img:any, i:number) => {
    const p = ippPerSlice[i];
    const [x,y,z,_w] = mul4(M, [p[0], p[1], p[2], 1]);
    return { xInCT:x, yInCT:y, zInCT:z, ippLPS: [p[0],p[1],p[2]] as [number,number,number], image: img };
  });

  transformed.sort((a,b)=>a.zInCT - b.zInCT);

  if (transformed.length) {
    const first = transformed[0], mid = transformed[Math.floor(transformed.length/2)], last = transformed[transformed.length-1];
    console.log('🔍 Sample MRI→CT coordinate transformations:',
      `First: (${first.xInCT.toFixed(1)}, ${first.yInCT.toFixed(1)}, ${first.zInCT.toFixed(1)})`,
      `Middle: (${mid.xInCT.toFixed(1)}, ${mid.yInCT.toFixed(1)}, ${mid.zInCT.toFixed(1)})`,
      `Last: (${last.xInCT.toFixed(1)}, ${last.yInCT.toFixed(1)}, ${last.zInCT.toFixed(1)})`
    );
    console.log(`MRI Z-range after transformation: ${first.zInCT.toFixed(1)}mm to ${last.zInCT.toFixed(1)}mm`);
  }

  return transformed;
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

  // Handle cached MRI image structure vs original DICOM structure  
  const width = mriImage.width || mriImage.columns;
  const height = mriImage.height || mriImage.rows;
  const pixelData = mriImage.data || (mriImage.getPixelData && mriImage.getPixelData());
  
  if (!pixelData) {
    console.error('❌ No pixel data found in MRI image:', Object.keys(mriImage));
    return null;
  }

  return {
    width,
    height, 
    data: pixelData,
    pixelSpacing: closest.image?.pixelSpacing,
    imagePosition: [closest.xInCT, closest.yInCT, closest.zInCT]
  };
}

// Helper function to convert values to number arrays
function toNumberArray(value: any): number[] | null {
  if (Array.isArray(value)) return value.map(Number);
  if (typeof value === 'string') return value.split('\\').map(Number);
  return null;
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

  // Get the actual secondary image for this slice
  const mriSlice = interpolateMRI(ctSliceZ, transformedMRI, secondaryImageCache);
  const actualSecondaryImage = mriSlice ? transformedMRI.find(t => t.image?.sopInstanceUID === Object.keys(secondaryImageCache.entries().next().value || {})[0]) : null;
  
  // Use computed ippLPS if tag is missing from the actual image
  const mriOriginArr = toNumberArray(actualSecondaryImage?.image?.imagePosition);
  const bestTransformed = transformedMRI && transformedMRI.length
    ? transformedMRI.reduce((acc, cur) => {
        const d = Math.abs(cur.zInCT - ctSliceZ);
        return (!acc || d < Math.abs(acc.zInCT - ctSliceZ)) ? cur : acc;
      }, null as any)
    : null;

  const mriOriginFromTransformed = bestTransformed && (bestTransformed as any).ippLPS
    ? (bestTransformed as any).ippLPS as number[]
    : null;

  const mriOrigin = (mriOriginArr && mriOriginArr.length===3 && mriOriginArr.every(Number.isFinite))
    ? mriOriginArr
    : (mriOriginFromTransformed || null);

  if (!mriOrigin) {
    console.error('❌ Missing MRI ImagePositionPatient; cannot align overlay safely.');
    return;
  }

  // Use registration matrix to transform MRI origin to CT space
  const [mriCT_x, mriCT_y, mriCT_z] = multiplyMatrixVector(registrationMatrix, [...mriOrigin, 1]);
  
  console.log('Using MRI origin for fusion positioning:', mriOrigin, '-> CT space:', [mriCT_x, mriCT_y, mriCT_z]);
  
  // Calculate offset between MRI and CT positions in physical space
  const offsetX = (mriCT_x - ctTransform[0]) / ctSpacing[0];
  const offsetY = (mriCT_y - ctTransform[1]) / ctSpacing[1];
  
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
  
  console.log(`✓ Fusion complete: opacity=${fusionOpacity}, scale=${scaleX.toFixed(3)}x${scaleY.toFixed(3)}`);
  
  // NO RESTORE - caller manages the transform state
}