import fs from 'fs';
import dicomParser from 'dicom-parser';

const parseFloatArray = (value: string | null | undefined): number[] | null => {
  if (!value) return null;
  const parts = value.split('\\').map((v) => parseFloat(v)).filter((n) => Number.isFinite(n));
  return parts.length ? parts : null;
};

const parseNumber = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export interface BasicDicomMetadata {
  patientID: string | null;
  patientName: string | null;
  patientBirthDate: string | null;
  patientSex: string | null;
  patientAge: string | null;
  studyInstanceUID: string | null;
  studyDescription: string | null;
  studyDate: string | null;
  studyTime: string | null;
  accessionNumber: string | null;
  seriesInstanceUID: string | null;
  seriesDescription: string | null;
  seriesNumber: number | null;
  modality: string | null;
  frameOfReferenceUID: string | null;
  imageOrientationPatient: number[] | null;
  imagePositionPatient: number[] | null;
  pixelSpacing: number[] | null;
  sliceThickness: string | null;
  spacingBetweenSlices: string | null;
  windowCenter: number[] | null;
  windowWidth: number[] | null;
  rescaleIntercept: number | null;
  rescaleSlope: number | null;
  photometricInterpretation: string | null;
  samplesPerPixel: number | null;
  bitsAllocated: number | null;
  bitsStored: number | null;
  highBit: number | null;
  pixelRepresentation: number | null;
}

export function loadDicomMetadata(filePath: string): BasicDicomMetadata {
  const buffer = fs.readFileSync(filePath);
  const byteArray = new Uint8Array(buffer);
  const dataSet = dicomParser.parseDicom(byteArray);
  const stringTag = (tag: string): string | null => {
    try {
      const value = dataSet.string?.(tag);
      if (!value) return null;
      const trimmed = String(value).trim();
      return trimmed.length ? trimmed : null;
    } catch {
      return null;
    }
  };
  const numberTag = (tag: string): number | null => {
    const str = stringTag(tag);
    return parseNumber(str);
  };

  const metadata: BasicDicomMetadata = {
    patientID: stringTag('x00100020'),
    patientName: stringTag('x00100010'),
    patientBirthDate: stringTag('x00100030'),
    patientSex: stringTag('x00100040'),
    patientAge: stringTag('x00101010'),
    studyInstanceUID: stringTag('x0020000d'),
    studyDescription: stringTag('x00081030'),
    studyDate: stringTag('x00080020'),
    studyTime: stringTag('x00080030'),
    accessionNumber: stringTag('x00080050'),
    seriesInstanceUID: stringTag('x0020000e'),
    seriesDescription: stringTag('x0008103e'),
    seriesNumber: numberTag('x00200011'),
    modality: stringTag('x00080060'),
    frameOfReferenceUID: stringTag('x00200052'),
    imageOrientationPatient: parseFloatArray(stringTag('x00200037')),
    imagePositionPatient: parseFloatArray(stringTag('x00200032')),
    pixelSpacing: parseFloatArray(stringTag('x00280030')),
    sliceThickness: stringTag('x00180050'),
    spacingBetweenSlices: stringTag('x00180088'),
    windowCenter: parseFloatArray(stringTag('x00281050')),
    windowWidth: parseFloatArray(stringTag('x00281051')),
    rescaleIntercept: numberTag('x00281052'),
    rescaleSlope: numberTag('x00281053'),
    photometricInterpretation: stringTag('x00280004'),
    samplesPerPixel: numberTag('x00280002'),
    bitsAllocated: numberTag('x00280100'),
    bitsStored: numberTag('x00280101'),
    highBit: numberTag('x00280102'),
    pixelRepresentation: numberTag('x00280103'),
  };

  return metadata;
}

