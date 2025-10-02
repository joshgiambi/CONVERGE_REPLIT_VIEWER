/**
 * VolumeService
 * 
 * Service for 3D volume processing - building volumes from DICOM images
 * and extracting orthogonal slices for MPR (Multi-Planar Reconstruction).
 * 
 * Agent 4: Services & Hooks
 * Created: Hour 12-14
 */

import type {
  DICOMImage,
  Volume,
  VolumeSlice,
  ViewportOrientation,
  VolumeService as IVolumeService,
} from '@/types/viewer';
import { DICOMMetadataService } from './DICOMMetadataService';

/**
 * Build a 3D volume from a series of DICOM images
 * Assumes images are sorted by slice position
 */
async function buildVolume(images: DICOMImage[]): Promise<Volume> {
  if (!images || images.length === 0) {
    throw new Error('No images provided to build volume');
  }

  // Sort images by Z position
  const sortedImages = [...images].sort((a, b) => {
    const zA = DICOMMetadataService.getSliceZ(a) ?? 0;
    const zB = DICOMMetadataService.getSliceZ(b) ?? 0;
    return zA - zB;
  });

  const firstImage = sortedImages[0];
  const rows = firstImage.rows;
  const cols = firstImage.columns;
  const depth = sortedImages.length;

  // Get spacing
  const spacing = DICOMMetadataService.getSpacing(sortedImages);
  if (!spacing) {
    throw new Error('Could not determine volume spacing');
  }

  // Get origin from first image
  const position = DICOMMetadataService.parseImagePosition(firstImage);
  const origin: [number, number, number] = position || [0, 0, 0];

  // Get image orientation
  const metadata = DICOMMetadataService.extractMetadata(firstImage);
  const orientation = metadata.imageOrientation;

  // Allocate volume array
  const volumeSize = rows * cols * depth;
  const data = new Float32Array(volumeSize);

  // Fill volume with pixel data
  for (let z = 0; z < depth; z++) {
    const image = sortedImages[z];
    const pixelData = image.pixelData;

    if (!pixelData) {
      console.warn(`Image at index ${z} has no pixel data, skipping`);
      continue;
    }

    // Convert to Float32 with rescale
    const rescale = DICOMMetadataService.getRescaleParams(image);
    const sliceOffset = z * rows * cols;

    if (pixelData instanceof Int16Array || pixelData instanceof Uint16Array) {
      for (let i = 0; i < pixelData.length; i++) {
        data[sliceOffset + i] = pixelData[i] * rescale.slope + rescale.intercept;
      }
    } else if (pixelData instanceof Uint8Array) {
      // 8-bit data
      for (let i = 0; i < pixelData.length; i++) {
        data[sliceOffset + i] = pixelData[i] * rescale.slope + rescale.intercept;
      }
    } else if (pixelData instanceof ArrayBuffer) {
      // Convert ArrayBuffer to typed array
      const view = new Int16Array(pixelData);
      for (let i = 0; i < view.length; i++) {
        data[sliceOffset + i] = view[i] * rescale.slope + rescale.intercept;
      }
    }
  }

  return {
    data,
    dimensions: [cols, rows, depth],
    spacing,
    origin,
    orientation,
  };
}

/**
 * Extract a slice from a volume at a specific orientation and position
 */
function extractSlice(
  volume: Volume,
  orientation: ViewportOrientation,
  position: number
): VolumeSlice {
  const [width, height, depth] = volume.dimensions;
  const [spacingX, spacingY, spacingZ] = volume.spacing;

  switch (orientation) {
    case 'axial': {
      // Axial: extract XY plane at Z position
      const sliceIndex = Math.floor((position - volume.origin[2]) / spacingZ);
      if (sliceIndex < 0 || sliceIndex >= depth) {
        throw new Error(`Slice index ${sliceIndex} out of bounds [0, ${depth})`);
      }

      const sliceSize = width * height;
      const sliceOffset = sliceIndex * sliceSize;
      const data = new Float32Array(sliceSize);

      for (let i = 0; i < sliceSize; i++) {
        data[i] = volume.data[sliceOffset + i];
      }

      return {
        data,
        width,
        height,
        spacing: [spacingX, spacingY],
        position,
        orientation: 'axial',
      };
    }

    case 'sagittal': {
      // Sagittal: extract YZ plane at X position
      const xIndex = Math.floor((position - volume.origin[0]) / spacingX);
      if (xIndex < 0 || xIndex >= width) {
        throw new Error(`X index ${xIndex} out of bounds [0, ${width})`);
      }

      const sliceWidth = depth;
      const sliceHeight = height;
      const data = new Float32Array(sliceWidth * sliceHeight);

      for (let z = 0; z < depth; z++) {
        for (let y = 0; y < height; y++) {
          const volumeIndex = xIndex + y * width + z * width * height;
          const sliceIndex = z + y * sliceWidth;
          data[sliceIndex] = volume.data[volumeIndex];
        }
      }

      return {
        data,
        width: sliceWidth,
        height: sliceHeight,
        spacing: [spacingZ, spacingY],
        position,
        orientation: 'sagittal',
      };
    }

    case 'coronal': {
      // Coronal: extract XZ plane at Y position
      const yIndex = Math.floor((position - volume.origin[1]) / spacingY);
      if (yIndex < 0 || yIndex >= height) {
        throw new Error(`Y index ${yIndex} out of bounds [0, ${height})`);
      }

      const sliceWidth = width;
      const sliceHeight = depth;
      const data = new Float32Array(sliceWidth * sliceHeight);

      for (let z = 0; z < depth; z++) {
        for (let x = 0; x < width; x++) {
          const volumeIndex = x + yIndex * width + z * width * height;
          const sliceIndex = x + z * sliceWidth;
          data[sliceIndex] = volume.data[volumeIndex];
        }
      }

      return {
        data,
        width: sliceWidth,
        height: sliceHeight,
        spacing: [spacingX, spacingZ],
        position,
        orientation: 'coronal',
      };
    }

    default:
      throw new Error(`Unknown orientation: ${orientation}`);
  }
}

/**
 * Resample a slice to target dimensions using bilinear interpolation
 */
function resampleSlice(
  slice: VolumeSlice,
  targetDimensions: [number, number]
): VolumeSlice {
  const [targetWidth, targetHeight] = targetDimensions;
  const { width: srcWidth, height: srcHeight, data: srcData } = slice;

  const resampledData = new Float32Array(targetWidth * targetHeight);

  const xScale = srcWidth / targetWidth;
  const yScale = srcHeight / targetHeight;

  for (let y = 0; y < targetHeight; y++) {
    for (let x = 0; x < targetWidth; x++) {
      // Calculate source coordinates
      const srcX = x * xScale;
      const srcY = y * yScale;

      // Bilinear interpolation
      const x0 = Math.floor(srcX);
      const y0 = Math.floor(srcY);
      const x1 = Math.min(x0 + 1, srcWidth - 1);
      const y1 = Math.min(y0 + 1, srcHeight - 1);

      const fx = srcX - x0;
      const fy = srcY - y0;

      const v00 = srcData[y0 * srcWidth + x0];
      const v10 = srcData[y0 * srcWidth + x1];
      const v01 = srcData[y1 * srcWidth + x0];
      const v11 = srcData[y1 * srcWidth + x1];

      const v0 = v00 * (1 - fx) + v10 * fx;
      const v1 = v01 * (1 - fx) + v11 * fx;
      const value = v0 * (1 - fy) + v1 * fy;

      resampledData[y * targetWidth + x] = value;
    }
  }

  // Calculate new spacing
  const newSpacingX = (slice.spacing[0] * srcWidth) / targetWidth;
  const newSpacingY = (slice.spacing[1] * srcHeight) / targetHeight;

  return {
    data: resampledData,
    width: targetWidth,
    height: targetHeight,
    spacing: [newSpacingX, newSpacingY],
    position: slice.position,
    orientation: slice.orientation,
  };
}

/**
 * Singleton VolumeService instance
 */
export const VolumeService: IVolumeService = {
  buildVolume,
  extractSlice,
  resampleSlice,
};

// Export individual functions for testing
export { buildVolume, extractSlice, resampleSlice };

