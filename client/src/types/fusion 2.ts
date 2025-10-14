export type FuseboxTransformSource = 'helper-generated' | 'helper-cache' | 'helper-regenerated' | 'matrix-fallback' | 'matrix-validated';

export interface RegistrationTransformCandidate {
  id: string;
  regFile: string | null;
  sourceFoR: string | null;
  targetFoR: string | null;
  matrix: number[];
  referencedSeriesInstanceUids?: string[];
}

export interface RegistrationSeriesDetail {
  id: number | null;
  uid: string | null;
  description: string | null;
  modality: string | null;
  studyId: number | null;
  imageCount: number | null;
}

export interface RegistrationAssociation {
  regFile: string | null;
  studyId: number;
  target: string | null;
  targetSeriesId: number | null;
  sources: string[];
  sourcesSeriesIds: number[];
  sourceFoR: string | null;
  targetFoR: string | null;
  relationship: 'registered' | 'shared-frame';
  siblingSeriesIds: number[];
  transformCandidates: RegistrationTransformCandidate[];
  targetSeriesDetail?: RegistrationSeriesDetail | null;
  sourceSeriesDetails?: RegistrationSeriesDetail[];
}

export interface AssociationResponse {
  associations: RegistrationAssociation[];
  ctacSeriesIds: number[];
}

export type FusionManifestStatus = 'pending' | 'generating' | 'ready' | 'error';

export interface FusionInstanceDescriptor {
  sopInstanceUID: string;
  instanceNumber: number;
  fileName: string;
  filePath: string;
  imagePositionPatient: number[] | null;
  imageOrientationPatient: number[] | null;
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
  imageOrientationPatient: number[] | null;
  imagePositionPatientFirst: number[] | null;
  imagePositionPatientLast: number[] | null;
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
