export interface DICOMSeries {
  id: number;
  seriesInstanceUID: string;
  seriesDescription: string;
  modality: string;
  // Optional linkage populated by callers when combining study+series
  studyId?: number;
  seriesNumber?: number;
  imageCount: number;
  sliceThickness?: string;
  frameOfReferenceUID?: string | null;
  images: DICOMImage[];
}

export interface DICOMImage {
  id: number;
  sopInstanceUID: string;
  instanceNumber?: number;
  filePath: string;
  fileName: string;
  windowCenter?: string;
  windowWidth?: string;
}

export interface DICOMStudy {
  id: number;
  studyInstanceUID: string;
  patientName?: string;
  patientID?: string;
  studyDate?: string;
  studyDescription?: string;
  series: DICOMSeries[];
}

export interface WindowLevel {
  window: number;
  level: number;
}

export const WINDOW_LEVEL_PRESETS: Record<string, WindowLevel> = {
  'soft tissue': { window: 400, level: 40 },
  'lung': { window: 1500, level: -600 },
  'bone': { window: 1800, level: 400 },
  'brain': { window: 80, level: 40 },
  'liver': { window: 150, level: 30 },
  'mediastinum': { window: 350, level: 50 },
  'abdomen': { window: 350, level: 40 },
  'full range': { window: 4096, level: 1024 },
  // MRI presets
  'mri brain t1': { window: 600, level: 300 },
  'mri brain t2': { window: 2000, level: 1000 },
  'mri brain flair': { window: 1800, level: 900 },
  'mri spine': { window: 1200, level: 600 },
  'mri auto': { window: 2000, level: 1000 }, // Good default for most MRI
};

export function isDICOMFile(file: File): boolean {
  // Check file extension
  const validExtensions = ['.dcm', '.dicom', '.ima', '.img'];
  const fileName = file.name.toLowerCase();
  const hasValidExtension = validExtensions.some(ext => fileName.endsWith(ext));
  
  // Files without extension might still be DICOM (common in medical imaging)
  const hasNoExtension = fileName.indexOf('.') === -1;
  
  // Also check for numeric filenames (common DICOM pattern)
  const isNumericFilename = /^\d+$/.test(file.name);
  
  // Accept if has valid extension, no extension, or is numeric filename
  return hasValidExtension || hasNoExtension || isNumericFilename;
}

export function createImageId(sopInstanceUID: string): string {
  return `wadouri:/api/dicom/${sopInstanceUID}`;
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function formatDate(dateString: string): string {
  if (!dateString) return 'Unknown';
  
  try {
    // DICOM dates are in YYYYMMDD format
    if (dateString.length === 8) {
      const year = dateString.substring(0, 4);
      const month = dateString.substring(4, 6);
      const day = dateString.substring(6, 8);
      const date = new Date(`${year}-${month}-${day}`);
      return date.toLocaleDateString();
    }
    
    return new Date(dateString).toLocaleDateString();
  } catch (error) {
    return dateString;
  }
}

export function getModalityDisplayName(modality: string): string {
  const modalityNames: Record<string, string> = {
    'CT': 'Computed Tomography',
    'MR': 'Magnetic Resonance',
    'PT': 'Positron Emission Tomography',
    'NM': 'Nuclear Medicine',
    'US': 'Ultrasound',
    'XA': 'X-Ray Angiography',
    'RF': 'Radiofluoroscopy',
    'DX': 'Digital Radiography',
    'CR': 'Computed Radiography',
    'MG': 'Mammography',
    'OT': 'Other',
  };
  
  return modalityNames[modality] || modality;
}

export function sortImagesByInstance(images: DICOMImage[]): DICOMImage[] {
  return [...images].sort((a, b) => {
    const aInstance = a.instanceNumber || 0;
    const bInstance = b.instanceNumber || 0;
    return aInstance - bInstance;
  });
}

export function calculateWindowLevel(windowCenter: string, windowWidth: string): WindowLevel {
  const center = parseFloat(windowCenter) || 40;
  const width = parseFloat(windowWidth) || 400;

  return {
    level: center,
    window: width
  };
}

/**
 * Helper functions for safe metadata parsing
 * These ensure MRI and CT metadata are handled consistently
 */

/**
 * Parse a value (string or array) into a numeric array
 * @param value - String with backslash delimiters or array of values
 * @param expectedLength - Expected number of elements
 * @returns Array of finite numbers or null if parsing fails
 */
export function parseNumericArray(value: unknown, expectedLength?: number): number[] | null {
  if (Array.isArray(value)) {
    const parsed = value.map((component) => Number(component)).filter((component) => Number.isFinite(component));
    if (!parsed.length) return null;
    if (expectedLength && parsed.length < expectedLength) return null;
    return parsed;
  }
  if (typeof value === 'string') {
    const parsed = value
      .split('\\')
      .map((component) => Number(component.trim()))
      .filter((component) => Number.isFinite(component));
    if (!parsed.length) return null;
    if (expectedLength && parsed.length < expectedLength) return null;
    return parsed;
  }
  return null;
}

/**
 * Parse a value into a single finite number
 * @param value - Value to parse
 * @returns Finite number or null
 */
export function parseNumber(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

/**
 * Normalize metadata for contour rendering
 * Walks through metadata candidates and defensively parses values
 * @param metadataCandidates - Array of potential metadata sources
 * @returns Normalized metadata with safe defaults
 */
export interface NormalizedMetadata {
  imagePosition: number[];
  pixelSpacing: number[];
  imageOrientation: number[];
  columns: number;
  rows: number;
}

const EPSILON = 1e-6; // Minimum value for spacing to avoid division by zero

export function normalizeMetadata(metadataCandidates: any[]): NormalizedMetadata {
  let imagePosition: number[] | null = null;
  let pixelSpacing: number[] | null = null;
  let imageOrientation: number[] | null = null;
  let columns: number | null = null;
  let rows: number | null = null;

  // Walk through candidates to find valid values
  for (const meta of metadataCandidates) {
    if (!meta) continue;

    if (!imagePosition) {
      imagePosition =
        parseNumericArray(meta.imagePosition, 3) ||
        parseNumericArray(meta.imagePositionPatient, 3);
    }
    if (!pixelSpacing) {
      pixelSpacing =
        parseNumericArray(meta.pixelSpacing, 2) ||
        parseNumericArray(meta.pixelSpacingXY, 2);
    }
    if (!imageOrientation) {
      imageOrientation =
        parseNumericArray(meta.imageOrientation, 6) ||
        parseNumericArray(meta.imageOrientationPatient, 6);
    }
    if (columns == null) {
      columns = parseNumber(meta.columns) ?? parseNumber(meta.width) ?? null;
    }
    if (rows == null) {
      rows = parseNumber(meta.rows) ?? parseNumber(meta.height) ?? null;
    }

    if (imagePosition && pixelSpacing && imageOrientation && columns != null && rows != null) {
      break;
    }
  }

  // Apply safe defaults
  if (!imagePosition) {
    imagePosition = [0, 0, 0];
  }
  if (!pixelSpacing || pixelSpacing.length < 2) {
    pixelSpacing = [1, 1];
  }
  if (!imageOrientation || imageOrientation.length < 6) {
    imageOrientation = [1, 0, 0, 0, 1, 0]; // Identity orientation
  }

  // Clamp spacing to avoid zeros (use epsilon as minimum)
  const rowSpacing = Math.abs(pixelSpacing[0]) > EPSILON ? pixelSpacing[0] : 1;
  const columnSpacing = Math.abs(pixelSpacing[1]) > EPSILON ? pixelSpacing[1] : 1;

  // Normalize orientation vectors to unit length
  const normalizeVector = (vec: number[]): number[] => {
    const mag = Math.sqrt(vec[0] * vec[0] + vec[1] * vec[1] + vec[2] * vec[2]);
    if (mag < EPSILON) return vec; // Return as-is if too small
    return [vec[0] / mag, vec[1] / mag, vec[2] / mag];
  };

  const rowCosines = normalizeVector([
    imageOrientation[0],
    imageOrientation[1],
    imageOrientation[2],
  ]);
  const colCosines = normalizeVector([
    imageOrientation[3],
    imageOrientation[4],
    imageOrientation[5],
  ]);

  return {
    imagePosition,
    pixelSpacing: [rowSpacing, columnSpacing],
    imageOrientation: [...rowCosines, ...colCosines],
    columns: columns ?? 512,
    rows: rows ?? 512,
  };
}
