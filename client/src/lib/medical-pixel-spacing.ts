/**
 * Medical-safe pixel spacing extraction and validation
 * CRITICAL: Never use hardcoded fallbacks for medical imaging
 */

export interface PixelSpacingResult {
  spacing: [number, number] | null;
  error?: string;
}

/**
 * Extract pixel spacing from DICOM dataset with proper validation
 * Returns null if spacing cannot be safely determined
 */
export function extractPixelSpacing(
  dataSet: any,
  imageMetadata?: any
): PixelSpacingResult {
  let spacing: [number, number] | null = null;
  
  // Method 1: Try from DICOM dataset directly (most reliable)
  if (dataSet) {
    try {
      // Standard Pixel Spacing tag (0028,0030)
      const spacingString = dataSet.string('x00280030');
      if (spacingString) {
        const values = spacingString.split('\\').map(Number);
        if (values.length === 2 && values.every(v => !isNaN(v) && v > 0 && v < 100)) {
          spacing = [values[0], values[1]]; // [row spacing, column spacing]
        }
      }
    } catch (error) {
      console.warn('Failed to extract pixel spacing from DICOM dataset:', error);
    }
  }
  
  // Method 2: Try from metadata if dataset extraction failed
  if (!spacing && imageMetadata?.pixelSpacing) {
    try {
      let values: number[] = [];
      
      if (typeof imageMetadata.pixelSpacing === 'string') {
        values = imageMetadata.pixelSpacing.split('\\').map(Number);
      } else if (Array.isArray(imageMetadata.pixelSpacing)) {
        values = imageMetadata.pixelSpacing.map(Number);
      }
      
      if (values.length === 2 && values.every(v => !isNaN(v) && v > 0 && v < 100)) {
        spacing = [values[0], values[1]];
      }
    } catch (error) {
      console.warn('Failed to extract pixel spacing from metadata:', error);
    }
  }
  
  // Method 3: Try alternative DICOM tags
  if (!spacing && dataSet) {
    try {
      // Imager Pixel Spacing (0018,1164) - used by some modalities
      const imagerSpacing = dataSet.string('x00181164');
      if (imagerSpacing) {
        const values = imagerSpacing.split('\\').map(Number);
        if (values.length === 2 && values.every(v => !isNaN(v) && v > 0 && v < 100)) {
          spacing = [values[0], values[1]];
        }
      }
    } catch (error) {
      console.warn('Failed to extract imager pixel spacing:', error);
    }
  }
  
  // NO FALLBACK - Return null if spacing cannot be determined
  if (!spacing) {
    return {
      spacing: null,
      error: 'Could not extract pixel spacing from DICOM. This image cannot be safely processed for medical use.'
    };
  }
  
  return { spacing };
}

/**
 * Validate pixel spacing values for a given modality
 */
export function validatePixelSpacing(
  spacing: [number, number],
  modality: string
): { valid: boolean; reason?: string } {
  const [rowSpacing, colSpacing] = spacing;
  
  // Basic sanity checks
  if (rowSpacing <= 0 || colSpacing <= 0) {
    return { valid: false, reason: 'Pixel spacing must be positive' };
  }
  
  if (rowSpacing > 50 || colSpacing > 50) {
    return { valid: false, reason: 'Pixel spacing unusually large (>50mm)' };
  }
  
  if (rowSpacing < 0.01 || colSpacing < 0.01) {
    return { valid: false, reason: 'Pixel spacing unusually small (<0.01mm)' };
  }
  
  // Aspect ratio check - warn if pixels are very non-square
  const aspectRatio = rowSpacing / colSpacing;
  if (aspectRatio > 3 || aspectRatio < 0.33) {
    console.warn(`Unusual pixel aspect ratio: ${aspectRatio.toFixed(2)}`);
  }
  
  // Modality-specific validation
  switch (modality?.toUpperCase()) {
    case 'CT':
      // CT typically 0.3-3.0mm
      if (rowSpacing < 0.3 || rowSpacing > 3.0 || colSpacing < 0.3 || colSpacing > 3.0) {
        return { 
          valid: false, 
          reason: `CT pixel spacing [${rowSpacing.toFixed(2)}, ${colSpacing.toFixed(2)}]mm outside typical range (0.3-3.0mm)` 
        };
      }
      break;
      
    case 'MR':
    case 'MRI':
      // MR can vary widely 0.1-5.0mm
      if (rowSpacing < 0.1 || rowSpacing > 5.0 || colSpacing < 0.1 || colSpacing > 5.0) {
        return { 
          valid: false, 
          reason: `MR pixel spacing [${rowSpacing.toFixed(2)}, ${colSpacing.toFixed(2)}]mm outside typical range (0.1-5.0mm)` 
        };
      }
      break;
      
    case 'PT':
    case 'PET':
      // PET typically 2-8mm
      if (rowSpacing < 1.0 || rowSpacing > 8.0 || colSpacing < 1.0 || colSpacing > 8.0) {
        return { 
          valid: false, 
          reason: `PET pixel spacing [${rowSpacing.toFixed(2)}, ${colSpacing.toFixed(2)}]mm outside typical range (1.0-8.0mm)` 
        };
      }
      break;
      
    case 'US':
      // Ultrasound can have very small spacing
      if (rowSpacing < 0.01 || rowSpacing > 2.0 || colSpacing < 0.01 || colSpacing > 2.0) {
        return { 
          valid: false, 
          reason: `US pixel spacing [${rowSpacing.toFixed(2)}, ${colSpacing.toFixed(2)}]mm outside typical range (0.01-2.0mm)` 
        };
      }
      break;
      
    default:
      // For other modalities, just use basic sanity checks
      break;
  }
  
  return { valid: true };
}

/**
 * Get pixel spacing with medical safety checks
 * Throws error if spacing cannot be safely determined
 */
export function getMedicalSafePixelSpacing(
  dataSet: any,
  imageMetadata?: any,
  modality?: string
): [number, number] {
  // Extract pixel spacing
  const result = extractPixelSpacing(dataSet, imageMetadata);
  
  if (!result.spacing) {
    throw new Error(result.error || 'Unable to extract pixel spacing');
  }
  
  // Validate if modality is known
  if (modality) {
    const validation = validatePixelSpacing(result.spacing, modality);
    if (!validation.valid) {
      throw new Error(`Invalid pixel spacing for ${modality}: ${validation.reason}`);
    }
  }
  
  return result.spacing;
}

/**
 * Safe coordinate transformation with explicit pixel spacing validation
 */
export function medicalSafeWorldToCanvas(
  worldX: number,
  worldY: number,
  imagePosition: [number, number, number],
  pixelSpacing: [number, number] | null | undefined,
  canvasWidth: number,
  canvasHeight: number,
  imageWidth: number = 512,
  imageHeight: number = 512
): { x: number; y: number } | { error: string } {
  
  // Validate pixel spacing
  if (!pixelSpacing || pixelSpacing.length !== 2) {
    return { error: 'Invalid or missing pixel spacing - coordinate transformation not possible' };
  }
  
  const [rowSpacing, colSpacing] = pixelSpacing;
  
  if (rowSpacing <= 0 || colSpacing <= 0) {
    return { error: 'Invalid pixel spacing values - must be positive' };
  }
  
  try {
    // Convert world coordinates to pixel coordinates
    // DICOM pixel spacing is [row spacing, column spacing] = [deltaY, deltaX]
    const pixelX = (worldX - imagePosition[0]) / colSpacing;
    const pixelY = (worldY - imagePosition[1]) / rowSpacing;
    
    // Validate pixel coordinates are within image bounds
    if (pixelX < 0 || pixelX >= imageWidth || pixelY < 0 || pixelY >= imageHeight) {
      console.warn(`Pixel coordinates (${pixelX.toFixed(1)}, ${pixelY.toFixed(1)}) outside image bounds`);
    }
    
    // Convert to canvas coordinates with proper scaling
    const scale = Math.min(canvasWidth / imageWidth, canvasHeight / imageHeight);
    const scaledImageWidth = imageWidth * scale;
    const scaledImageHeight = imageHeight * scale;
    
    const offsetX = (canvasWidth - scaledImageWidth) / 2;
    const offsetY = (canvasHeight - scaledImageHeight) / 2;
    
    const canvasX = offsetX + (pixelX * scale);
    const canvasY = offsetY + (pixelY * scale);
    
    return { x: canvasX, y: canvasY };
    
  } catch (error) {
    return { error: `Coordinate transformation failed: ${error}` };
  }
}

/**
 * Log pixel spacing issues for medical safety audit
 */
export function logPixelSpacingIssue(
  sopInstanceUID: string,
  issue: string,
  severity: 'warning' | 'error'
): void {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    sopInstanceUID,
    issue,
    severity
  };
  
  console[severity]('MEDICAL SAFETY - Pixel Spacing Issue:', logEntry);
  
  // In production, this should also:
  // - Send to logging service
  // - Alert medical physics team if critical
  // - Record in audit trail
}