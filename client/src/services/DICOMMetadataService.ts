/**
 * DICOMMetadataService
 * 
 * Core service for parsing and extracting DICOM metadata.
 * Extracted from working-viewer.tsx and unified with helper functions.
 * 
 * Agent 4: Services & Hooks
 * Created: Hour 2-5
 */

import type { DICOMImage, ImageMetadata, DICOMMetadataService as IDICOMMetadataService } from '@/types/viewer';

const SLICE_TOLERANCE_MM = 0.5;

/**
 * Parse DICOM image position patient tag
 * Tries multiple fallback paths for robustness
 */
function parseImagePosition(image: DICOMImage): [number, number, number] | null {
  if (!image) return null;

  // Try 1: Direct imagePositionPatient array
  const direct = image.imagePositionPatient;
  if (direct && Array.isArray(direct) && direct.length >= 3) {
    const coords = direct.map(Number) as [number, number, number];
    if (coords.every(v => Number.isFinite(v))) {
      return coords;
    }
  }

  // Try 2: Metadata object
  const metaArray = (image.metadata as any)?.imagePositionPatient;
  if (metaArray && Array.isArray(metaArray) && metaArray.length >= 3) {
    const coords = metaArray.map(Number) as [number, number, number];
    if (coords.every(v => Number.isFinite(v))) {
      return coords;
    }
  }

  // Try 3: Raw string format (DICOM backslash separator)
  const rawString = typeof (image as any).imagePosition === 'string'
    ? (image as any).imagePosition
    : typeof image.metadata?.imagePosition === 'string'
      ? image.metadata.imagePosition
      : null;

  if (rawString) {
    const parts = rawString.split('\\').map((part: string) => Number(part.trim()));
    if (parts.length >= 3 && parts.every(v => Number.isFinite(v))) {
      return [parts[0], parts[1], parts[2]];
    }
  }

  return null;
}

/**
 * Extract Z position (slice location) from DICOM image
 * Uses consistent priority logic
 */
function getSliceZ(image: DICOMImage): number | null {
  if (!image) return null;

  // Priority 1: Pre-parsed slice location
  if ((image as any).parsedSliceLocation != null) {
    return (image as any).parsedSliceLocation;
  }

  // Priority 2: Pre-parsed Z position
  if ((image as any).parsedZPosition != null) {
    return (image as any).parsedZPosition;
  }

  // Priority 3: Direct slice location
  if (image.sliceLocation != null) {
    return image.sliceLocation;
  }

  // Priority 4: Extract from image position (Z coordinate)
  const position = parseImagePosition(image);
  if (position && Number.isFinite(position[2])) {
    return position[2];
  }

  // Priority 5: Try metadata
  const metadata = image.metadata;
  if (metadata) {
    // Try slice location from metadata
    if (metadata.sliceLocation != null) {
      const v = parseFloat(String(metadata.sliceLocation));
      if (!Number.isNaN(v)) return v;
    }

    // Try image position Z from metadata
    const pos = typeof metadata.imagePosition === 'string'
      ? metadata.imagePosition.split('\\')
      : metadata.imagePosition;

    if (Array.isArray(pos) && pos.length >= 3) {
      const z = parseFloat(String(pos[2]));
      if (!Number.isNaN(z)) return z;
    }
  }

  return null;
}

/**
 * Calculate spacing between slices
 * Returns [row spacing, column spacing, slice spacing]
 */
function getSpacing(images: DICOMImage[]): [number, number, number] | null {
  if (!images || images.length === 0) return null;

  const firstImage = images[0];
  
  // Get pixel spacing (in-plane spacing)
  let rowSpacing = 1.0;
  let colSpacing = 1.0;

  // Try multiple metadata paths
  const metadata = firstImage.metadata;
  if (metadata?.pixelSpacing) {
    const spacing = typeof metadata.pixelSpacing === 'string'
      ? metadata.pixelSpacing.split('\\').map(parseFloat)
      : metadata.pixelSpacing;

    if (Array.isArray(spacing) && spacing.length >= 2) {
      rowSpacing = spacing[0];
      colSpacing = spacing[1];
    }
  }

  // Calculate slice spacing (between slices)
  let sliceSpacing = 1.0;

  if (images.length >= 2) {
    // Get Z positions of first two slices
    const z1 = getSliceZ(images[0]);
    const z2 = getSliceZ(images[1]);

    if (z1 !== null && z2 !== null && Number.isFinite(z1) && Number.isFinite(z2)) {
      sliceSpacing = Math.abs(z2 - z1);
    } else if (metadata?.sliceThickness) {
      // Fallback to slice thickness
      const thickness = parseFloat(String(metadata.sliceThickness));
      if (!Number.isNaN(thickness)) {
        sliceSpacing = thickness;
      }
    }
  } else if (metadata?.sliceThickness) {
    // Single slice - use thickness
    const thickness = parseFloat(String(metadata.sliceThickness));
    if (!Number.isNaN(thickness)) {
      sliceSpacing = thickness;
    }
  }

  return [rowSpacing, colSpacing, sliceSpacing];
}

/**
 * Get rescale slope and intercept for HU conversion
 */
function getRescaleParams(image: DICOMImage): { slope: number; intercept: number } {
  const slope = image.rescaleSlope ?? image.metadata?.rescaleSlope ?? 1;
  const intercept = image.rescaleIntercept ?? image.metadata?.rescaleIntercept ?? 0;

  return {
    slope: typeof slope === 'number' ? slope : parseFloat(String(slope)) || 1,
    intercept: typeof intercept === 'number' ? intercept : parseFloat(String(intercept)) || 0,
  };
}

/**
 * Check if two positions represent the same slice
 */
function sameSlice(
  pos1: [number, number, number],
  pos2: [number, number, number],
  tolerance: number = SLICE_TOLERANCE_MM
): boolean {
  if (!pos1 || !pos2) return false;
  
  const z1 = pos1[2];
  const z2 = pos2[2];
  
  return Number.isFinite(z1) && Number.isFinite(z2) && Math.abs(z1 - z2) <= tolerance;
}

/**
 * Extract full image metadata for rendering
 */
function extractMetadata(image: DICOMImage): ImageMetadata {
  const position = parseImagePosition(image);
  const rescale = getRescaleParams(image);

  // Extract pixel spacing
  let pixelSpacing: [number, number] = [1, 1];
  if (image.metadata?.pixelSpacing) {
    const spacing = typeof image.metadata.pixelSpacing === 'string'
      ? image.metadata.pixelSpacing.split('\\').map(parseFloat)
      : image.metadata.pixelSpacing;
    
    if (Array.isArray(spacing) && spacing.length >= 2) {
      pixelSpacing = [spacing[0], spacing[1]];
    }
  }

  // Extract image orientation
  let imageOrientation: number[] = [1, 0, 0, 0, 1, 0];
  if (image.metadata?.imageOrientation) {
    const orientation = typeof image.metadata.imageOrientation === 'string'
      ? image.metadata.imageOrientation.split('\\').map(parseFloat)
      : image.metadata.imageOrientation;
    
    if (Array.isArray(orientation) && orientation.length >= 6) {
      imageOrientation = orientation;
    }
  }

  // Extract slice thickness
  let sliceThickness = 1.0;
  if (image.metadata?.sliceThickness) {
    const thickness = parseFloat(String(image.metadata.sliceThickness));
    if (!Number.isNaN(thickness)) {
      sliceThickness = thickness;
    }
  }

  return {
    columns: image.columns,
    rows: image.rows,
    pixelSpacing,
    sliceThickness,
    imageOrientation,
    imagePositionPatient: position || [0, 0, 0],
    rescaleSlope: rescale.slope,
    rescaleIntercept: rescale.intercept,
    windowCenter: image.windowCenter ?? image.metadata?.windowCenter ?? 40,
    windowWidth: image.windowWidth ?? image.metadata?.windowWidth ?? 400,
    bitsAllocated: image.bitsAllocated ?? 16,
    bitsStored: image.bitsStored ?? 16,
    pixelRepresentation: image.pixelRepresentation ?? 1,
    photometricInterpretation: image.photometricInterpretation ?? 'MONOCHROME2',
    frameOfReferenceUID: image.metadata?.frameOfReferenceUID ?? null,
    sopInstanceUID: image.sopInstanceUID,
    instanceNumber: image.instanceNumber,
  };
}

/**
 * Singleton DICOMMetadataService instance
 */
export const DICOMMetadataService: IDICOMMetadataService = {
  parseImagePosition,
  extractMetadata,
  getSliceZ,
  getSpacing,
  getRescaleParams,
  sameSlice,
};

// Export individual functions for testing
export {
  parseImagePosition,
  extractMetadata,
  getSliceZ,
  getSpacing,
  getRescaleParams,
  sameSlice,
  SLICE_TOLERANCE_MM,
};

