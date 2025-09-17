export type FuseboxTransformSource = 'helper-generated' | 'helper-cache';

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
