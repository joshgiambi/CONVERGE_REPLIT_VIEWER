import fs from 'fs';

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
    const metadata: DICOMMetadata = {};

    if (buffer.length < 132) {
      throw new Error('File too small to be DICOM');
    }

    // Check for DICM header at offset 128
    const dicmHeader = buffer.subarray(128, 132).toString('ascii');
    let offset = 132;

    if (dicmHeader !== 'DICM') {
      offset = 0; // Start from beginning if no preamble
    }

    // Skip meta information (group 0x0002) and go to dataset
    while (offset < buffer.length - 8) {
      const group = buffer.readUInt16LE(offset);
      if (group !== 0x0002) break;
      
      const element = buffer.readUInt16LE(offset + 2);
      const vr = buffer.subarray(offset + 4, offset + 6).toString('ascii');
      
      let length: number;
      let valueOffset: number;
      
      if (['OB', 'OW', 'SQ', 'UN', 'OF', 'OD'].includes(vr)) {
        length = buffer.readUInt32LE(offset + 8);
        valueOffset = offset + 12;
      } else {
        length = buffer.readUInt16LE(offset + 6);
        valueOffset = offset + 8;
      }
      
      offset = valueOffset + length;
      if (offset % 2 !== 0) offset++;
    }

    // Parse main dataset with implicit VR Little Endian
    while (offset < buffer.length - 8) {
      const group = buffer.readUInt16LE(offset);
      const element = buffer.readUInt16LE(offset + 2);
      const tag = `${group.toString(16).padStart(4, '0')}${element.toString(16).padStart(4, '0')}`;
      
      // For implicit VR, length is 4 bytes at offset+4
      const length = buffer.readUInt32LE(offset + 4);
      const valueOffset = offset + 8;
      
      if (length > 0 && length < 10000 && valueOffset + length <= buffer.length) {
        const vr = getImplicitVR(tag);
        const value = extractValue(buffer, valueOffset, length, vr);
        
        // Map important tags
        switch (tag) {
          case '00100010': metadata.patientName = value; break;
          case '00100020': metadata.patientID = value; break;
          case '00100040': metadata.patientSex = value; break;
          case '00101010': metadata.patientAge = value; break;
          case '00100030': metadata.patientBirthDate = value; break;
          
          case '0020000d': metadata.studyInstanceUID = value; break;
          case '00080020': metadata.studyDate = value; break;
          case '00080030': metadata.studyTime = value; break;
          case '00081030': metadata.studyDescription = value; break;
          case '00080050': metadata.accessionNumber = value; break;
          
          case '0020000e': metadata.seriesInstanceUID = value; break;
          case '0008103e': metadata.seriesDescription = value; break;
          case '00200011': metadata.seriesNumber = parseInt(value) || undefined; break;
          case '00080060': metadata.modality = value; break;
          case '00180015': metadata.bodyPartExamined = value; break;
          case '00181030': metadata.protocolName = value; break;
          
          case '00080018': metadata.sopInstanceUID = value; break;
          case '00080016': metadata.sopClassUID = value; break;
          case '00200013': metadata.instanceNumber = parseInt(value) || undefined; break;
          case '00201041': metadata.sliceLocation = parseFloat(value) || undefined; break;
          
          case '00180050': metadata.sliceThickness = parseFloat(value) || undefined; break;
          case '00280010': metadata.rows = parseInt(value) || undefined; break;
          case '00280011': metadata.columns = parseInt(value) || undefined; break;
          case '00280100': metadata.bitsAllocated = parseInt(value) || undefined; break;
          case '00280101': metadata.bitsStored = parseInt(value) || undefined; break;
          case '00280102': metadata.highBit = parseInt(value) || undefined; break;
          case '00280103': metadata.pixelRepresentation = parseInt(value) || undefined; break;
          
          case '00180060': metadata.kvp = parseFloat(value) || undefined; break;
          case '00181152': metadata.exposureTime = parseFloat(value) || undefined; break;
          case '00181210': metadata.reconstructionKernel = value; break;
          case '00281050': metadata.windowCenter = parseFloat(value) || undefined; break;
          case '00281051': metadata.windowWidth = parseFloat(value) || undefined; break;
        }
      }
      
      offset = valueOffset + length;
      if (offset % 2 !== 0) offset++;
      
      // Prevent infinite loops
      if (offset >= buffer.length - 8) break;
    }

    return metadata;
  } catch (error) {
    console.error(`Error parsing DICOM file ${filePath}:`, error);
    return {};
  }
}

function getImplicitVR(tag: string): string {
  const vrMap: { [key: string]: string } = {
    '00100010': 'PN', // Patient Name
    '00100020': 'LO', // Patient ID
    '00100040': 'CS', // Patient Sex
    '00101010': 'AS', // Patient Age
    '00100030': 'DA', // Patient Birth Date
    
    '0020000d': 'UI', // Study Instance UID
    '00080020': 'DA', // Study Date
    '00080030': 'TM', // Study Time
    '00081030': 'LO', // Study Description
    '00080050': 'SH', // Accession Number
    
    '0020000e': 'UI', // Series Instance UID
    '0008103e': 'LO', // Series Description
    '00200011': 'IS', // Series Number
    '00080060': 'CS', // Modality
    '00180015': 'CS', // Body Part Examined
    '00181030': 'LO', // Protocol Name
    
    '00080018': 'UI', // SOP Instance UID
    '00080016': 'UI', // SOP Class UID
    '00200013': 'IS', // Instance Number
    '00201041': 'DS', // Slice Location
    
    '00180050': 'DS', // Slice Thickness
    '00280010': 'US', // Rows
    '00280011': 'US', // Columns
    '00280100': 'US', // Bits Allocated
    '00280101': 'US', // Bits Stored
    '00280102': 'US', // High Bit
    '00280103': 'US', // Pixel Representation
    
    '00180060': 'DS', // KVP
    '00181152': 'IS', // Exposure Time
    '00181210': 'SH', // Reconstruction Kernel
    '00281050': 'DS', // Window Center
    '00281051': 'DS', // Window Width
  };
  
  return vrMap[tag] || 'LO';
}

function extractValue(buffer: Buffer, offset: number, length: number, vr: string): string {
  if (offset + length > buffer.length) {
    return '';
  }
  
  try {
    let value = buffer.subarray(offset, offset + length);
    
    // Remove padding and null terminators
    while (value.length > 0 && (value[value.length - 1] === 0 || value[value.length - 1] === 32)) {
      value = value.subarray(0, value.length - 1);
    }
    
    return value.toString('ascii').trim();
  } catch (error) {
    return '';
  }
}