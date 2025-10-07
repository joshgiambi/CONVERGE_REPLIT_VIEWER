import path from 'path';
import { runFuseboxScript } from './python-runner.ts';

export type InterpolationMode = 'linear' | 'nearest';

type FloatArray = number[];

export interface PatientMetadata {
  PatientID: string;
  PatientName?: string;
  PatientBirthDate?: string;
  PatientSex?: string;
  PatientAge?: string;
  IssuerOfPatientID?: string;
  [key: string]: string | undefined;
}

export interface StudyMetadata {
  StudyInstanceUID: string;
  StudyDescription?: string;
  StudyDate?: string;
  StudyTime?: string;
  AccessionNumber?: string;
  ReferringPhysicianName?: string;
  [key: string]: string | undefined;
}

export interface SeriesMetadata {
  SeriesInstanceUID: string;
  SeriesDescription?: string;
  SeriesNumber?: number;
  Modality?: string;
  FrameOfReferenceUID?: string;
  ImageType?: string[];
  PixelSpacing?: FloatArray;
  ImageOrientationPatient?: FloatArray;
  SliceThickness?: string;
  SpacingBetweenSlices?: string;
  WindowCenter?: FloatArray;
  WindowWidth?: FloatArray;
  RescaleIntercept?: number;
  RescaleSlope?: number;
  SmallestImagePixelValue?: number;
  LargestImagePixelValue?: number;
  [key: string]: string | number | FloatArray | string[] | undefined;
}

export interface DerivedSeriesMetadata {
  SeriesInstanceUID?: string;
  SeriesDescription?: string;
  SeriesNumber?: number;
  ImageType?: string[];
  DerivationDescription?: string;
  ReferencedSeriesInstanceUID?: string;
  ReferencedSOPInstanceUIDs?: string[];
  RegistrationSequence?: Record<string, unknown>;
  WindowCenter?: FloatArray;
  WindowWidth?: FloatArray;
  [key: string]: unknown;
}

export interface VolumeResampleMetadata {
  patient: PatientMetadata;
  study: StudyMetadata;
  primarySeries: SeriesMetadata;
  secondarySeries: SeriesMetadata;
  derivedSeries: DerivedSeriesMetadata;
}

export interface VolumeResampleRequest {
  primarySeriesFiles: string[];
  secondarySeriesFiles: string[];
  transformMatrix?: FloatArray;
  transformFilePath?: string | null;
  invertTransformFile?: boolean;
  interpolation?: InterpolationMode;
  outputDirectory: string;
  metadata: VolumeResampleMetadata;
  scaleToUInt16?: boolean;
}

export interface VolumeResampleInstance {
  index: number;
  sopInstanceUID: string;
  fileName: string;
  filePath: string;
  instanceNumber: number;
  imagePositionPatient: number[] | null;
  sliceLocation: number | null;
  windowCenter: number[] | null;
  windowWidth: number[] | null;
}

export interface VolumeResampleResponse {
  ok: boolean;
  modality: string | null;
  seriesDescription: string | null;
  seriesInstanceUID: string;
  frameOfReferenceUID: string | null;
  sliceCount: number;
  rows: number;
  columns: number;
  pixelSpacing: number[] | null;
  imageOrientationPatient: number[] | null;
  imagePositionPatientFirst: number[] | null;
  imagePositionPatientLast: number[] | null;
  windowCenter: number[] | null;
  windowWidth: number[] | null;
  outputDirectory: string;
  manifestPath: string | null;
  instances: VolumeResampleInstance[];
}

export class FuseboxVolumeResampler {
  async execute(request: VolumeResampleRequest): Promise<VolumeResampleResponse> {
    if (!request.primarySeriesFiles.length) throw new Error('primarySeriesFiles empty');
    if (!request.secondarySeriesFiles.length) throw new Error('secondarySeriesFiles empty');

    const uniquePrimary = Array.from(new Set(request.primarySeriesFiles.map((p) => path.resolve(p))));
    const uniqueSecondary = Array.from(new Set(request.secondarySeriesFiles.map((p) => path.resolve(p))));

    const config = {
      primary: uniquePrimary,
      secondary: uniqueSecondary,
      transform: request.transformMatrix && request.transformMatrix.length ? request.transformMatrix : undefined,
      transformFile: request.transformFilePath || undefined,
      invertTransformFile: request.invertTransformFile ?? true,
      interpolation: request.interpolation ?? 'linear',
      outputDirectory: request.outputDirectory,
      metadata: request.metadata,
      // Keep viewer rendering unchanged by default; enable scaling only for explicit export workflows
      scaleToUInt16: Boolean(request.scaleToUInt16),
    };

    const response = await runFuseboxScript<VolumeResampleResponse>('fusebox_resample_volume.py', config);
    return response;
  }
}
