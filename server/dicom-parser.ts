import fs from 'fs';
import * as dcmjs from 'dcmjs';

interface DICOMMetadata {
  // Patient Level
  patientName?: string;
  patientID?: string;
  patientSex?: string;
  patientAge?: string;
  patientBirthDate?: string;
  
  // Study Level
  studyDate?: string;
  studyTime?: string;
  studyDescription?: string;
  studyInstanceUID?: string;
  accessionNumber?: string;
  
  // Series Level
  seriesDescription?: string;
  seriesInstanceUID?: string;
  seriesNumber?: number;
  modality?: string;
  bodyPartExamined?: string;
  protocolName?: string;
  
  // Instance Level
  sopInstanceUID?: string;
  sopClassUID?: string;
  instanceNumber?: number;
  sliceLocation?: number;
  imagePosition?: [number, number, number];
  imageOrientation?: [number, number, number, number, number, number];
  
  // Image Properties
  sliceThickness?: number;
  pixelSpacing?: [number, number];
  rows?: number;
  columns?: number;
  bitsAllocated?: number;
  bitsStored?: number;
  highBit?: number;
  pixelRepresentation?: number;
  
  // Acquisition Parameters
  kvp?: number;
  mas?: number;
  exposureTime?: number;
  reconstructionKernel?: string;
  windowCenter?: number;
  windowWidth?: number;
  
  // RT Specific Fields
  rtPlanLabel?: string;
  rtPlanDate?: string;
  rtPlanTime?: string;
  doseUnits?: string;
  doseType?: string;
  fractionGroupSequence?: any[];
  
  // Registration Specific
  registrationTypeCodeSequence?: any[];
  matrixRegistrationSequence?: any[];
  matrixSequence?: any[];
  
  // Structure Set Specific
  structureSetLabel?: string;
  structureSetName?: string;
  structureSetDescription?: string;
  structureSetDate?: string;
  structureSetTime?: string;
  roiContourSequence?: any[];
  rtRoiObservationsSequence?: any[];
}

export function parseDICOMMetadata(filePath: string): DICOMMetadata {
  try {
    const buffer = fs.readFileSync(filePath);
    
    // Use dcmjs to parse the DICOM file
    const dataset = dcmjs.data.DicomMessage.readFile(buffer.buffer);
    const dict = dataset.dict;
    
    const metadata: DICOMMetadata = {};
    
    // Patient Level - Group 0010
    if (dict['00100010']) metadata.patientName = dict['00100010'].Value?.[0];
    if (dict['00100020']) metadata.patientID = dict['00100020'].Value?.[0];
    if (dict['00100040']) metadata.patientSex = dict['00100040'].Value?.[0];
    if (dict['00101010']) metadata.patientAge = dict['00101010'].Value?.[0];
    if (dict['00100030']) metadata.patientBirthDate = dict['00100030'].Value?.[0];
    
    // Study Level - Group 0008/0020
    if (dict['0020000D']) metadata.studyInstanceUID = dict['0020000D'].Value?.[0];
    if (dict['00080020']) metadata.studyDate = dict['00080020'].Value?.[0];
    if (dict['00080030']) metadata.studyTime = dict['00080030'].Value?.[0];
    if (dict['00081030']) metadata.studyDescription = dict['00081030'].Value?.[0];
    if (dict['00080050']) metadata.accessionNumber = dict['00080050'].Value?.[0];
    
    // Series Level - Group 0008/0020
    if (dict['0020000E']) metadata.seriesInstanceUID = dict['0020000E'].Value?.[0];
    if (dict['0008103E']) metadata.seriesDescription = dict['0008103E'].Value?.[0];
    if (dict['00200011']) metadata.seriesNumber = dict['00200011'].Value?.[0];
    if (dict['00080060']) metadata.modality = dict['00080060'].Value?.[0];
    if (dict['00180015']) metadata.bodyPartExamined = dict['00180015'].Value?.[0];
    if (dict['00181030']) metadata.protocolName = dict['00181030'].Value?.[0];
    
    // Instance Level - Group 0008/0020
    if (dict['00080018']) metadata.sopInstanceUID = dict['00080018'].Value?.[0];
    if (dict['00080016']) metadata.sopClassUID = dict['00080016'].Value?.[0];
    if (dict['00200013']) metadata.instanceNumber = dict['00200013'].Value?.[0];
    if (dict['00201041']) metadata.sliceLocation = dict['00201041'].Value?.[0];
    
    // Image Position/Orientation
    if (dict['00200032']) {
      const pos = dict['00200032'].Value;
      if (pos && pos.length >= 3) {
        metadata.imagePosition = [parseFloat(pos[0]), parseFloat(pos[1]), parseFloat(pos[2])];
      }
    }
    if (dict['00200037']) {
      const orient = dict['00200037'].Value;
      if (orient && orient.length >= 6) {
        metadata.imageOrientation = orient.map((v: string) => parseFloat(v)) as [number, number, number, number, number, number];
      }
    }
    
    // Image Properties - Group 0028
    if (dict['00180050']) metadata.sliceThickness = parseFloat(dict['00180050'].Value?.[0]);
    if (dict['00280030']) {
      const spacing = dict['00280030'].Value;
      if (spacing && spacing.length >= 2) {
        metadata.pixelSpacing = [parseFloat(spacing[0]), parseFloat(spacing[1])];
      }
    }
    if (dict['00280010']) metadata.rows = dict['00280010'].Value?.[0];
    if (dict['00280011']) metadata.columns = dict['00280011'].Value?.[0];
    if (dict['00280100']) metadata.bitsAllocated = dict['00280100'].Value?.[0];
    if (dict['00280101']) metadata.bitsStored = dict['00280101'].Value?.[0];
    if (dict['00280102']) metadata.highBit = dict['00280102'].Value?.[0];
    if (dict['00280103']) metadata.pixelRepresentation = dict['00280103'].Value?.[0];
    
    // Acquisition Parameters - Group 0018
    if (dict['00180060']) metadata.kvp = parseFloat(dict['00180060'].Value?.[0]);
    if (dict['00181152']) metadata.exposureTime = parseFloat(dict['00181152'].Value?.[0]);
    if (dict['00181210']) metadata.reconstructionKernel = dict['00181210'].Value?.[0];
    
    // Window Settings - Group 0028
    if (dict['00281050']) metadata.windowCenter = parseFloat(dict['00281050'].Value?.[0]);
    if (dict['00281051']) metadata.windowWidth = parseFloat(dict['00281051'].Value?.[0]);
    
    return metadata;
  } catch (error) {
    console.error(`Error parsing DICOM file ${filePath}:`, error);
    return {};
  }
}