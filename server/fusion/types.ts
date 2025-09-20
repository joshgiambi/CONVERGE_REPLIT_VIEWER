export type FusionManifestStatus = 'pending' | 'generating' | 'ready' | 'error';

type Vector3 = [number, number, number];
type Vector6 = [number, number, number, number, number, number];

export interface RegistrationDescriptor {
  id: string;
  primarySeriesInstanceUID: string;
  secondarySeriesInstanceUID: string;
  primaryFrameOfReferenceUID: string | null;
  secondaryFrameOfReferenceUID: string | null;
  transformMatrix: number[] | null;
  transformFilePath?: string | null;
  modality?: string | null;
  notes?: string[];
  sourceSeriesInstanceUIDs?: string[];
  createdAt?: string;
}

export interface FusionInstanceDescriptor {
  sopInstanceUID: string;
  instanceNumber: number;
  fileName: string;
  filePath: string;
  imagePositionPatient: Vector3 | null;
  imageOrientationPatient: Vector6 | null;
  pixelSpacing: [number, number] | null;
  sliceLocation: number | null;
  windowCenter: number[] | null;
  windowWidth: number[] | null;
  primarySopInstanceUID?: string | null;
}

export interface FusionSecondaryDescriptor {
  secondarySeriesId: number;
  secondarySeriesInstanceUID: string;
  secondarySeriesDescription: string | null;
  secondaryModality: string | null;
  registrationId: string | null;
  status: FusionManifestStatus;
  generatedAt: string | null;
  frameOfReferenceUID: string | null;
  sliceCount: number;
  rows: number | null;
  columns: number | null;
  pixelSpacing: [number, number] | null;
  imageOrientationPatient: Vector6 | null;
  imagePositionPatientFirst: Vector3 | null;
  imagePositionPatientLast: Vector3 | null;
  windowCenter: number[] | null;
  windowWidth: number[] | null;
  outputDirectory: string;
  manifestPath: string;
  instances: FusionInstanceDescriptor[];
  error?: string;
}

export interface FusionManifest {
  manifestVersion: number;
  studyId: number;
  patientId: number | null;
  primarySeriesId: number;
  primarySeriesInstanceUID: string;
  primarySeriesDescription: string | null;
  primaryModality: string | null;
  createdAt: string;
  updatedAt: string;
  settings: {
    interpolation: 'linear' | 'nearest';
    preload: boolean;
  };
  secondaries: FusionSecondaryDescriptor[];
}

export interface FusionManifestSummary {
  studyId: number;
  primarySeriesId: number;
  primarySeriesInstanceUID: string;
  readySecondaryCount: number;
  totalSecondaryCount: number;
  hasErrors: boolean;
}
