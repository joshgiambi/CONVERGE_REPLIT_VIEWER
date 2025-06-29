/**
 * Shared utility functions for the DICOM medical imaging system
 */

/**
 * Generate a unique DICOM UID
 */
export function generateUID(): string {
  return `2.16.840.1.114362.1.11932039.${Date.now()}.${Math.floor(Math.random() * 10000)}`;
}

/**
 * Check if a file is a valid DICOM file by checking the DICM magic number
 */
export function isDICOMFile(filePath: string): boolean {
  try {
    const fs = require('fs');
    const buffer = fs.readFileSync(filePath, { start: 128, end: 132 });
    return buffer.toString() === 'DICM';
  } catch {
    return false;
  }
}

/**
 * Extract string value from DICOM dataset
 */
export function getTagString(dataSet: any, tag: string): string | null {
  try {
    return dataSet.string(tag)?.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Extract array value from DICOM dataset
 */
export function getTagArray(dataSet: any, tag: string): number[] | null {
  try {
    const str = getTagString(dataSet, tag);
    return str?.split('\\').map(Number) || null;
  } catch {
    return null;
  }
}

/**
 * Extract tag value from buffer (legacy support)
 */
export function extractTag(buffer: Buffer, tag: string): string | null {
  // Legacy function - consider deprecating in favor of dicomParser
  return null;
}