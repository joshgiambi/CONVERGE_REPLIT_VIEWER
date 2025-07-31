// Simple, lightweight margin preview operations
// Designed to prevent app freezing with large contours

import { growContourSimple } from './simple-polygon-operations';

export interface SimpleMarginParameters {
  marginValue: number; // mm
  maxContours?: number; // Limit for preview performance
  pixelSpacing?: [number, number]; // [row spacing, column spacing] in mm per pixel
}

export interface SimpleMarginResult {
  contourPoints: number[];
  processingTime: number;
  pointCount: number;
}

/**
 * Apply simple margin operation optimized for preview
 * Uses performance limits to prevent app freezing
 */
export async function applySimpleMarginPreview(
  contourPoints: number[],
  parameters: SimpleMarginParameters
): Promise<SimpleMarginResult> {
  const startTime = performance.now();
  
  try {
    console.log('🔹 ⚡ Simple margin preview:', {
      marginValue: parameters.marginValue,
      inputPoints: contourPoints.length / 3,
      hasPixelSpacing: !!parameters.pixelSpacing,
      pixelSpacing: parameters.pixelSpacing
    });
    
    // Validate input
    if (!contourPoints || contourPoints.length < 9) {
      throw new Error('Invalid contour points for margin operation');
    }
    
    // Convert margin from mm to pixels if pixel spacing is available
    let distanceInPixels = parameters.marginValue;
    if (parameters.pixelSpacing) {
      // Use average pixel spacing for isotropic scaling
      const avgPixelSpacing = (parameters.pixelSpacing[0] + parameters.pixelSpacing[1]) / 2;
      
      // Fixed: Ensure we're working in consistent units
      // If pixel spacing is very small (e.g., 0.1-2.0), it's likely in mm/pixel
      // If margin value is in mm, we need distance = margin_mm / spacing_mm_per_pixel
      const spacingMmPerPixel = avgPixelSpacing > 0.01 ? avgPixelSpacing : 1.0; // Safety check
      distanceInPixels = parameters.marginValue / spacingMmPerPixel;
      
      console.log('🔹 📏 Converted margin:', {
        marginMm: parameters.marginValue,
        pixelSpacingMmPerPixel: spacingMmPerPixel,
        marginPixels: distanceInPixels.toFixed(3)
      });
    } else {
      // No pixel spacing - assume margin value is already in appropriate units
      console.log('🔹 📏 No pixel spacing provided, using margin value directly:', parameters.marginValue);
    }
    
    // Apply simple buffering with pixel-converted distance
    const result = growContourSimple(contourPoints, distanceInPixels);
    const processingTime = performance.now() - startTime;
    
    console.log('🔹 ✅ Simple margin preview completed:', {
      outputPoints: result.length / 3,
      processingTime: `${processingTime.toFixed(2)}ms`
    });
    
    return {
      contourPoints: result,
      processingTime,
      pointCount: result.length / 3
    };
    
  } catch (error) {
    console.error('🔹 ❌ Simple margin preview failed:', error);
    
    // Return original contour as fallback
    return {
      contourPoints,
      processingTime: performance.now() - startTime,
      pointCount: contourPoints.length / 3
    };
  }
}

/**
 * Process multiple contours with performance limits
 */
export async function applySimpleMarginPreviewBatch(
  contours: Array<{ points: number[], slicePosition: number }>,
  parameters: SimpleMarginParameters
): Promise<Array<{ points: number[], slicePosition: number }>> {
  const maxContours = parameters.maxContours || 20;
  const limitedContours = contours.slice(0, maxContours);
  const results: Array<{ points: number[], slicePosition: number }> = [];
  
  console.log(`🔹 🔄 Processing ${limitedContours.length} contours (limited from ${contours.length})`);
  
  for (let i = 0; i < limitedContours.length; i++) {
    const contour = limitedContours[i];
    
    try {
      const result = await applySimpleMarginPreview(contour.points, parameters);
      results.push({
        points: result.contourPoints,
        slicePosition: contour.slicePosition
      });
      
      // Allow UI updates every 5 contours
      if ((i + 1) % 5 === 0) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      
    } catch (error) {
      console.error(`🔹 ❌ Failed to process contour at slice ${contour.slicePosition}:`, error);
      // Keep original contour
      results.push(contour);
    }
  }
  
  console.log(`🔹 ✅ Batch processing completed: ${results.length} contours processed`);
  return results;
} 