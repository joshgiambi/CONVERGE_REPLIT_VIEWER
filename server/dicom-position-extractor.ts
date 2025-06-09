/**
 * DICOM Position Metadata Extractor
 * Extracts ImagePositionPatient and related spatial metadata from DICOM files
 */

import fs from 'fs';
import * as dicomParser from 'dicom-parser';

export interface DICOMPositionData {
  imagePositionPatient?: number[];
  imageOrientationPatient?: number[];
  pixelSpacing?: number[];
  sliceLocation?: number;
  sliceThickness?: number;
  instanceNumber?: number;
  acquisitionNumber?: number;
  temporalPositionIdentifier?: number;
}

/**
 * Extract spatial positioning metadata from DICOM file
 */
export function extractDICOMPosition(filePath: string): DICOMPositionData {
  try {
    const buffer = fs.readFileSync(filePath);
    const dataSet = dicomParser.parseDicom(buffer);

    const position: DICOMPositionData = {};

    // ImagePositionPatient (0020,0032) - Critical for sorting
    const imagePosition = getNumberArray(dataSet, 'x00200032', 3);
    if (imagePosition) {
      position.imagePositionPatient = imagePosition;
    }

    // ImageOrientationPatient (0020,0037) - For MPR reconstruction
    const imageOrientation = getNumberArray(dataSet, 'x00200037', 6);
    if (imageOrientation) {
      position.imageOrientationPatient = imageOrientation;
    }

    // PixelSpacing (0028,0030) - For accurate measurements
    const pixelSpacing = getNumberArray(dataSet, 'x00280030', 2);
    if (pixelSpacing) {
      position.pixelSpacing = pixelSpacing;
    }

    // SliceLocation (0020,1041) - Alternative sorting method
    const sliceLocation = getNumber(dataSet, 'x00201041');
    if (sliceLocation !== undefined) {
      position.sliceLocation = sliceLocation;
    }

    // SliceThickness (0018,0050) - For volume reconstruction
    const sliceThickness = getNumber(dataSet, 'x00180050');
    if (sliceThickness !== undefined) {
      position.sliceThickness = sliceThickness;
    }

    // InstanceNumber (0020,0013) - Fallback sorting
    const instanceNumber = getNumber(dataSet, 'x00200013');
    if (instanceNumber !== undefined) {
      position.instanceNumber = instanceNumber;
    }

    // AcquisitionNumber (0020,0012) - Additional ordering info
    const acquisitionNumber = getNumber(dataSet, 'x00200012');
    if (acquisitionNumber !== undefined) {
      position.acquisitionNumber = acquisitionNumber;
    }

    // TemporalPositionIdentifier (0020,0100) - For 4D datasets
    const temporalPosition = getNumber(dataSet, 'x00200100');
    if (temporalPosition !== undefined) {
      position.temporalPositionIdentifier = temporalPosition;
    }

    return position;

  } catch (error) {
    console.warn(`Failed to extract position data from ${filePath}:`, error);
    return {};
  }
}

/**
 * Calculate Z-coordinate progression for sorting validation
 */
export function calculateZProgression(positions: DICOMPositionData[]): {
  isAscending: boolean;
  averageSpacing: number;
  irregularSpacing: boolean;
} {
  const zCoords = positions
    .filter(p => p.imagePositionPatient?.[2] !== undefined)
    .map(p => p.imagePositionPatient![2])
    .sort((a, b) => a - b);

  if (zCoords.length < 2) {
    return { isAscending: true, averageSpacing: 0, irregularSpacing: false };
  }

  const spacings = [];
  for (let i = 1; i < zCoords.length; i++) {
    spacings.push(zCoords[i] - zCoords[i - 1]);
  }

  const averageSpacing = spacings.reduce((a, b) => a + b, 0) / spacings.length;
  const irregularSpacing = spacings.some(spacing => 
    Math.abs(spacing - averageSpacing) / averageSpacing > 0.2
  );

  // Check if original order matches ascending Z order
  const originalZ = positions
    .filter(p => p.imagePositionPatient?.[2] !== undefined)
    .map(p => p.imagePositionPatient![2]);
  
  const isAscending = originalZ.every((z, i) => 
    i === 0 || z >= originalZ[i - 1]
  );

  return { isAscending, averageSpacing, irregularSpacing };
}

/**
 * Sort DICOM positions by anatomical order (superior to inferior for head/neck)
 */
export function sortByAnatomicalOrder(positions: DICOMPositionData[]): DICOMPositionData[] {
  // For head/neck CT, sort by Z-coordinate (superior = higher Z, inferior = lower Z)
  return [...positions].sort((a, b) => {
    // Primary sort by ImagePositionPatient Z-coordinate
    if (a.imagePositionPatient?.[2] !== undefined && b.imagePositionPatient?.[2] !== undefined) {
      return b.imagePositionPatient[2] - a.imagePositionPatient[2]; // Descending for superior→inferior
    }
    
    // Fallback to SliceLocation
    if (a.sliceLocation !== undefined && b.sliceLocation !== undefined) {
      return b.sliceLocation - a.sliceLocation;
    }
    
    // Final fallback to InstanceNumber
    const aInstance = a.instanceNumber ?? 0;
    const bInstance = b.instanceNumber ?? 0;
    return aInstance - bInstance;
  });
}

// Helper functions
function getString(dataSet: any, tag: string): string | undefined {
  const element = dataSet.elements[tag];
  if (element) {
    return dataSet.string(tag);
  }
  return undefined;
}

function getNumber(dataSet: any, tag: string): number | undefined {
  const element = dataSet.elements[tag];
  if (element) {
    const str = dataSet.string(tag);
    const num = parseFloat(str);
    return isNaN(num) ? undefined : num;
  }
  return undefined;
}

function getNumberArray(dataSet: any, tag: string, expectedLength?: number): number[] | undefined {
  const element = dataSet.elements[tag];
  if (element) {
    const str = dataSet.string(tag);
    const values = str.split('\\').map(v => parseFloat(v.trim())).filter(v => !isNaN(v));
    
    if (expectedLength && values.length !== expectedLength) {
      return undefined;
    }
    
    return values.length > 0 ? values : undefined;
  }
  return undefined;
}