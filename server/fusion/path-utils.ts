import path from 'path';
import fs from 'fs';

const STORAGE_ROOT = path.join('storage', 'patients');

const sanitize = (value: string | null | undefined): string => {
  if (!value) return 'unknown';
  return value.replace(/[<>:"/\\|?*]/g, '_');
};

export interface FusionPathInput {
  patientId: string;
  studyInstanceUID: string;
  primarySeriesInstanceUID: string;
  secondarySeriesInstanceUID: string;
}

export const fusionStudyRoot = ({ patientId, studyInstanceUID }: FusionPathInput): string =>
  path.join(STORAGE_ROOT, sanitize(patientId), sanitize(studyInstanceUID), 'fused');

export const fusionPairRoot = (input: FusionPathInput): string =>
  path.join(fusionStudyRoot(input), sanitize(input.primarySeriesInstanceUID), sanitize(input.secondarySeriesInstanceUID));

export const fusionDicomPath = (input: FusionPathInput): string =>
  path.join(fusionPairRoot(input), 'dicom');

export const fusionManifestPath = (input: FusionPathInput): string =>
  path.join(fusionPairRoot(input), 'manifest.json');

export const fusionMetadataPath = (input: FusionPathInput): string =>
  path.join(fusionPairRoot(input), 'metadata.json');

export function ensureFusionDirectories(input: FusionPathInput): void {
  const root = fusionPairRoot(input);
  const dicomDir = fusionDicomPath(input);
  if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
  if (!fs.existsSync(dicomDir)) fs.mkdirSync(dicomDir, { recursive: true });
}

