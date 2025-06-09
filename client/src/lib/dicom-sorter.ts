/**
 * DICOM Slice Sorting Utilities
 * Ensures proper anatomical ordering for CT/MR images
 */

export interface DICOMSliceData {
  id: number;
  instanceNumber: number;
  filePath: string;
  fileName: string;
  metadata?: any;
  imagePositionPatient?: number[];
  sliceLocation?: number;
}

export interface SortedDICOMSeries {
  slices: DICOMSliceData[];
  sortMethod: 'imagePosition' | 'instanceNumber' | 'sliceLocation';
  isReversed: boolean;
}

/**
 * Sort DICOM slices by anatomical position
 * Priority: ImagePositionPatient[2] > SliceLocation > InstanceNumber
 */
export function sortDICOMSlices(slices: DICOMSliceData[]): SortedDICOMSeries {
  if (!slices || slices.length === 0) {
    return { slices: [], sortMethod: 'instanceNumber', isReversed: false };
  }

  // Check which sorting method to use
  const hasImagePosition = slices.some(slice => 
    slice.imagePositionPatient && 
    Array.isArray(slice.imagePositionPatient) && 
    slice.imagePositionPatient.length >= 3 &&
    typeof slice.imagePositionPatient[2] === 'number'
  );

  const hasSliceLocation = slices.some(slice => 
    slice.sliceLocation !== undefined && 
    slice.sliceLocation !== null &&
    typeof slice.sliceLocation === 'number'
  );

  let sortedSlices: DICOMSliceData[];
  let sortMethod: 'imagePosition' | 'instanceNumber' | 'sliceLocation';

  if (hasImagePosition) {
    // Sort by ImagePositionPatient[2] (Z-coordinate) - most accurate
    sortedSlices = [...slices].sort((a, b) => {
      const posA = a.imagePositionPatient?.[2] ?? 0;
      const posB = b.imagePositionPatient?.[2] ?? 0;
      return posA - posB;
    });
    sortMethod = 'imagePosition';
  } else if (hasSliceLocation) {
    // Sort by SliceLocation - fallback for older DICOM
    sortedSlices = [...slices].sort((a, b) => {
      const locA = a.sliceLocation ?? 0;
      const locB = b.sliceLocation ?? 0;
      return locA - locB;
    });
    sortMethod = 'sliceLocation';
  } else {
    // Sort by InstanceNumber - last resort
    sortedSlices = [...slices].sort((a, b) => {
      return a.instanceNumber - b.instanceNumber;
    });
    sortMethod = 'instanceNumber';
  }

  // Detect if slices are in reverse anatomical order
  // For head/neck CT, superior slices typically have higher Z values
  const isReversed = detectReverseOrder(sortedSlices, sortMethod);
  
  if (isReversed) {
    sortedSlices.reverse();
  }

  return {
    slices: sortedSlices,
    sortMethod,
    isReversed
  };
}

/**
 * Detect if slices are in reverse anatomical order
 * For head/neck imaging, we expect superior→inferior progression
 */
function detectReverseOrder(slices: DICOMSliceData[], sortMethod: string): boolean {
  if (slices.length < 3) return false;

  // For head/neck CT, we expect the first slice to be superior (higher Z)
  // and last slice to be inferior (lower Z)
  const firstThird = slices.slice(0, Math.floor(slices.length / 3));
  const lastThird = slices.slice(-Math.floor(slices.length / 3));

  if (sortMethod === 'imagePosition') {
    const avgFirstZ = firstThird.reduce((sum, s) => sum + (s.imagePositionPatient?.[2] ?? 0), 0) / firstThird.length;
    const avgLastZ = lastThird.reduce((sum, s) => sum + (s.imagePositionPatient?.[2] ?? 0), 0) / lastThird.length;
    
    // If first third has lower Z than last third, it's reversed
    return avgFirstZ < avgLastZ;
  }

  if (sortMethod === 'sliceLocation') {
    const avgFirstLoc = firstThird.reduce((sum, s) => sum + (s.sliceLocation ?? 0), 0) / firstThird.length;
    const avgLastLoc = lastThird.reduce((sum, s) => sum + (s.sliceLocation ?? 0), 0) / lastThird.length;
    
    return avgFirstLoc < avgLastLoc;
  }

  // For instance numbers, we assume ascending order is correct
  return false;
}

/**
 * Validate DICOM slice continuity
 * Checks for missing slices or irregular spacing
 */
export function validateSliceContinuity(slices: DICOMSliceData[]): {
  isValid: boolean;
  missingSlices: number[];
  irregularSpacing: boolean;
  averageSpacing?: number;
} {
  if (slices.length < 2) {
    return { isValid: true, missingSlices: [], irregularSpacing: false };
  }

  const instanceNumbers = slices.map(s => s.instanceNumber).sort((a, b) => a - b);
  const missingSlices: number[] = [];
  
  // Check for missing instance numbers
  for (let i = instanceNumbers[0]; i <= instanceNumbers[instanceNumbers.length - 1]; i++) {
    if (!instanceNumbers.includes(i)) {
      missingSlices.push(i);
    }
  }

  // Check spacing consistency for image position
  let irregularSpacing = false;
  let averageSpacing: number | undefined;

  const positions = slices
    .filter(s => s.imagePositionPatient?.[2] !== undefined)
    .map(s => s.imagePositionPatient![2])
    .sort((a, b) => a - b);

  if (positions.length > 2) {
    const spacings = [];
    for (let i = 1; i < positions.length; i++) {
      spacings.push(Math.abs(positions[i] - positions[i - 1]));
    }
    
    averageSpacing = spacings.reduce((a, b) => a + b, 0) / spacings.length;
    
    // Check if any spacing deviates more than 20% from average
    irregularSpacing = spacings.some(spacing => 
      Math.abs(spacing - averageSpacing!) / averageSpacing! > 0.2
    );
  }

  return {
    isValid: missingSlices.length === 0 && !irregularSpacing,
    missingSlices,
    irregularSpacing,
    averageSpacing
  };
}

/**
 * Group slices by series and sort each series
 */
export function sortDICOMSeriesSlices(
  slices: DICOMSliceData[], 
  seriesId: number
): SortedDICOMSeries {
  const seriesSlices = slices.filter(slice => 
    slice.metadata?.seriesId === seriesId || 
    slice.id === seriesId
  );
  
  return sortDICOMSlices(seriesSlices);
}