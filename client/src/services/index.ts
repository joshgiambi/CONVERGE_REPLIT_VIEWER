/**
 * Services Index
 * 
 * Central export point for all viewer services.
 * 
 * Agent 4: Services & Hooks
 */

export { DICOMMetadataService } from './DICOMMetadataService';
export { SeriesFilterService } from './SeriesFilterService';
export { VolumeService } from './VolumeService';

export type {
  DICOMMetadataService as IDICOMMetadataService,
  SeriesFilterService as ISeriesFilterService,
  VolumeService as IVolumeService,
} from '@/types/viewer';

