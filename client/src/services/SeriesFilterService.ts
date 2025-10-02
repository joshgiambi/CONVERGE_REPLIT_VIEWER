/**
 * SeriesFilterService
 * 
 * Service for filtering DICOM series based on various criteria.
 * Extracted from viewer-interface.tsx shouldHideSeries logic.
 * 
 * Agent 4: Services & Hooks
 * Created: Hour 8-10
 */

import type { 
  DICOMSeries, 
  SeriesFilterCriteria, 
  VisibleSeries,
  SeriesFilterService as ISeriesFilterService 
} from '@/types/viewer';

// Keywords that indicate a derived/fusion series
const DERIVED_DESCRIPTION_KEYWORDS = [
  'fused',
  'fusion',
  'resample',
  '_resamp',
  '-fused',
  '-fusion',
  'derived',
  'secondary',
];

// UID markers that indicate derived/resampled series
const DERIVED_UID_MARKERS = [
  '_resamp',
  '-fused',
  '-fusion',
];

/**
 * Check if series has derived/resampled indicators in description
 */
function isDerived(series: DICOMSeries): boolean {
  if (!series) return false;

  const description = (series.seriesDescription || '').toLowerCase();
  const uid = (series.seriesInstanceUID || '').toLowerCase();
  const metadata = (series as any).metadata ?? {};

  // Check description for derived keywords
  const derivedByKeywords = DERIVED_DESCRIPTION_KEYWORDS.some(
    keyword => description.includes(keyword)
  );

  // Check UID for derived markers
  const derivedByUid = DERIVED_UID_MARKERS.some(
    marker => uid.includes(marker)
  );

  // Check metadata flags
  const flaggedFusion = Boolean(metadata.fusion);
  const isDerivedFlag = Boolean((series as any).isDerived);

  return derivedByKeywords || derivedByUid || flaggedFusion || isDerivedFlag;
}

/**
 * Check if series is resampled (subset of derived)
 */
function isResampled(series: DICOMSeries): boolean {
  if (!series) return false;

  const description = (series.seriesDescription || '').toLowerCase();
  const uid = (series.seriesInstanceUID || '').toLowerCase();

  return description.includes('resamp') || 
         description.includes('_resamp') || 
         uid.includes('_resamp');
}

/**
 * Determine if a series should be hidden based on criteria
 */
function shouldHideSeries(
  series: DICOMSeries, 
  criteria: SeriesFilterCriteria
): boolean {
  if (!series) return true;

  const modality = (series.modality || '').toUpperCase();

  // Always show RTSTRUCT - these get nested under their referenced series
  if (['RTSTRUCT', 'RT'].includes(modality)) {
    return false;
  }

  // Hide REG files - these are internal registration metadata
  if (modality === 'REG') {
    return true;
  }

  // Apply modality filter if specified
  if (criteria.modalities && criteria.modalities.length > 0) {
    if (!criteria.modalities.includes(modality)) {
      return true;
    }
  }

  // Check if series is derived/resampled
  const derived = isDerived(series);
  const resampled = isResampled(series);

  // Hide derived series if criteria says so
  if (criteria.hideDerived && derived) {
    return true;
  }

  // Hide resampled series if criteria says so
  if (criteria.hideResampled && resampled) {
    return true;
  }

  // Hide SECONDARY/OT modalities if criteria says so
  if (criteria.hideSecondary) {
    if (['DERIVED', 'SECONDARY', 'OT'].includes(modality)) {
      return true;
    }
  }

  return false;
}

/**
 * Filter series into visible, hidden, and other categories
 */
function filterVisibleSeries(
  series: DICOMSeries[], 
  criteria: SeriesFilterCriteria
): VisibleSeries {
  const visible: DICOMSeries[] = [];
  const hidden: DICOMSeries[] = [];
  const other: DICOMSeries[] = [];

  for (const s of series) {
    if (shouldHideSeries(s, criteria)) {
      hidden.push(s);
    } else {
      // Additional logic could categorize into "other"
      // For now, anything not hidden is visible
      visible.push(s);
    }
  }

  return { visible, hidden, other };
}

/**
 * Singleton SeriesFilterService instance
 */
export const SeriesFilterService: ISeriesFilterService = {
  shouldHideSeries,
  filterVisibleSeries,
  isDerived,
  isResampled,
};

// Export individual functions for testing
export {
  shouldHideSeries,
  filterVisibleSeries,
  isDerived,
  isResampled,
  DERIVED_DESCRIPTION_KEYWORDS,
  DERIVED_UID_MARKERS,
};

