/**
 * Geometrically correct fusion overlay renderer
 * Handles rotation, shear, and proper coordinate transformations
 */

import {
  PrimaryGeometry,
  TransformedSecondary,
  buildPrimaryGeometry,
  bracketByD,
  buildSliceAffine2D,
  toImageData,
  interpolateSecondary
} from './fusion-utils-v2';
import { Mat4x4, Vec3, dot, parseNums, invertRigid4x4 } from './dicom-geometry-utils';

export interface RenderOptions {
  ctx: CanvasRenderingContext2D;
  primaryImage: any; // CT image with metadata
  ctPlaneD: number; // CT plane position along normal
  transformedSecondary: TransformedSecondary[];
  secondaryCache: Map<string, { data: Float32Array; width: number; height: number }>;
  fusionOpacity: number;
  registrationMatrix: Mat4x4 | null;
  ctTransform: { scale: number; offsetX: number; offsetY: number };
  invertRegistration?: boolean;
  maxInterSliceBlendGapMM?: number;
  windowCenter?: number;
  windowWidth?: number;
}

/**
 * Render the secondary overlay onto the CT canvas at the CT plane position
 * This version properly handles rotation and shear using 2D affine transforms
 */
export function renderFusionOverlayNew(opts: RenderOptions): void {
  const {
    ctx,
    primaryImage,
    ctPlaneD,
    transformedSecondary,
    secondaryCache,
    fusionOpacity,
    registrationMatrix,
    ctTransform,
    invertRegistration = false,
    maxInterSliceBlendGapMM = 15,
    windowCenter,
    windowWidth
  } = opts;

  // Build primary geometry
  const primaryGeom = buildPrimaryGeometry(primaryImage);
  if (!primaryGeom) {
    console.error('CT geometry missing; aborting fusion');
    return;
  }

  if (!transformedSecondary.length) {
    return;
  }

  // Check if CT plane is within coverage (±2mm tolerance)
  const minD = transformedSecondary[0].dCT;
  const maxD = transformedSecondary[transformedSecondary.length - 1].dCT;
  
  console.log(`📍 MRI fusion check: CT slice at ${ctPlaneD.toFixed(1)}mm, MRI covers ${minD.toFixed(1)}mm to ${maxD.toFixed(1)}mm`);
  
  if (ctPlaneD < (minD - 2) || ctPlaneD > (maxD + 2)) {
    console.log(`❌ CT slice ${ctPlaneD.toFixed(1)}mm is outside MRI coverage`);
    return;
  }
  console.log(`✅ CT slice ${ctPlaneD.toFixed(1)}mm is within MRI coverage, rendering fusion...`);

  // Ensure registration direction
  let M = registrationMatrix && registrationMatrix.length === 16
    ? registrationMatrix.slice(0, 16)
    : [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
  
  if (invertRegistration) {
    M = invertRigid4x4(M);
  }

  // Find bracketing secondary slices
  const pair = bracketByD(ctPlaneD, transformedSecondary);
  if (!pair) return;

  const [i0, i1] = pair;
  
  // Get interpolated or nearest frame
  let frame: { data: Float32Array; width: number; height: number } | null = null;
  let secondaryImage: any = null;
  
  if (i0 === i1) {
    // Single slice case
    const item = transformedSecondary[i0];
    frame = secondaryCache.get(item.image.sopInstanceUID) ?? null;
    secondaryImage = item.image;
  } else {
    // Interpolation case
    frame = interpolateSecondary(
      ctPlaneD,
      transformedSecondary,
      secondaryCache,
      maxInterSliceBlendGapMM
    );
    // Use first image metadata for geometry
    secondaryImage = transformedSecondary[i0].image;
  }

  if (!frame || !secondaryImage) return;

  // Build affine transform
  const affine = buildSliceAffine2D(
    secondaryImage,
    M,
    primaryGeom,
    frame.width,
    frame.height
  );

  if (!affine) {
    console.warn('Failed to build affine transform');
    return;
  }

  // Convert to ImageData
  const imageData = toImageData(frame, { windowCenter, windowWidth });
  
  // Create temporary canvas
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = frame.width;
  tempCanvas.height = frame.height;
  const tempCtx = tempCanvas.getContext('2d');
  if (!tempCtx) return;

  tempCtx.putImageData(imageData, 0, 0);

  // Apply transform and draw
  ctx.save();
  ctx.globalAlpha = fusionOpacity;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // Apply CT's canvas transform combined with the affine
  const s = ctTransform.scale;
  const ox = ctTransform.offsetX;
  const oy = ctTransform.offsetY;
  
  // Set the combined transform: CT canvas transform × secondary-to-CT affine
  ctx.setTransform(
    affine.a * s, 
    affine.b * s, 
    affine.c * s, 
    affine.d * s, 
    ox + affine.e * s, 
    oy + affine.f * s
  );
  
  // Draw secondary image at (0,0) in its own pixel space
  ctx.drawImage(tempCanvas, 0, 0);
  
  ctx.restore(); // Important: restore canvas state
}

/**
 * Compute the CT plane position (distance along CT normal)
 * for the current CT slice
 */
export function computeCTPlaneD(
  currentCTImage: any,
  primaryGeometry: PrimaryGeometry
): number | null {
  const position = parseNums(currentCTImage.imagePosition, 3);
  if (!position) return null;
  
  const v: Vec3 = [
    position[0] - primaryGeometry.origin[0],
    position[1] - primaryGeometry.origin[1],
    position[2] - primaryGeometry.origin[2]
  ];
  
  return dot(v, primaryGeometry.normal);
}

/**
 * Legacy compatibility wrapper for old renderFusionOverlay signature
 * Maps old parameters to new RenderOptions format
 */
export function renderFusionOverlay(
  ctx: CanvasRenderingContext2D,
  primaryImage: any,
  actualSecondaryImage: any,
  registrationMatrix: number[] | null,
  mriData: { data: Float32Array; width: number; height: number } | null,
  fusionOpacity: number,
  canvasWidth: number,
  canvasHeight: number,
  ctTransform: { scale: number; offsetX: number; offsetY: number },
  panX?: number,
  panY?: number
): void {
  // This function needs the transformed secondary positions and cache
  // For now, just log a deprecation warning
  console.warn('renderFusionOverlay: Legacy function called, use renderFusionOverlayNew instead');
  
  if (!mriData || !actualSecondaryImage) return;
  
  // Build minimal options for new renderer
  const primaryGeom = buildPrimaryGeometry(primaryImage);
  if (!primaryGeom) return;
  
  const ctPlaneD = computeCTPlaneD(primaryImage, primaryGeom);
  if (ctPlaneD === null) return;
  
  // Create minimal transformed array
  const transformed: TransformedSecondary[] = [{
    dCT: ctPlaneD,
    originCT: [0, 0, 0], // Would need proper calculation
    image: actualSecondaryImage
  }];
  
  // Create cache with single entry
  const cache = new Map();
  if (actualSecondaryImage.sopInstanceUID && mriData) {
    cache.set(actualSecondaryImage.sopInstanceUID, mriData);
  }
  
  renderFusionOverlayNew({
    ctx,
    primaryImage,
    ctPlaneD,
    transformedSecondary: transformed,
    secondaryCache: cache,
    fusionOpacity,
    registrationMatrix,
    ctTransform,
    invertRegistration: false
  });
}