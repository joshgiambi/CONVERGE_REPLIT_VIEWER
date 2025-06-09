import * as fs from 'fs';

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

    // Check for DICOM file signature
    const dicmSignature = buffer.toString('ascii', 128, 132);
    if (dicmSignature !== 'DICM') {
      throw new Error('Not a valid DICOM file');
    }

    // Parse DICOM tags starting after the preamble and signature
    let offset = 132;
    
    while (offset < buffer.length - 8) {
      try {
        const group = buffer.readUInt16LE(offset);
        const element = buffer.readUInt16LE(offset + 2);
        const tag = `${group.toString(16).padStart(4, '0')}${element.toString(16).padStart(4, '0')}`;
        
        offset += 4;
        
        // Handle implicit VR vs explicit VR
        let vr: string;
        let length: number;
        
        // Check if this looks like explicit VR (next 2 bytes are valid VR)
        const possibleVR = buffer.toString('ascii', offset, offset + 2);
        const validVRs = ['AE', 'AS', 'AT', 'CS', 'DA', 'DS', 'DT', 'FL', 'FD', 'IS', 'LO', 'LT', 'OB', 'OD', 'OF', 'OL', 'OW', 'PN', 'SH', 'SL', 'SQ', 'SS', 'ST', 'TM', 'UC', 'UI', 'UL', 'UN', 'UR', 'US', 'UT'];
        
        if (validVRs.includes(possibleVR)) {
          // Explicit VR
          vr = possibleVR;
          offset += 2;
          
          if (['OB', 'OD', 'OF', 'OL', 'OW', 'SQ', 'UC', 'UR', 'UT', 'UN'].includes(vr)) {
            offset += 2; // Skip reserved bytes
            length = buffer.readUInt32LE(offset);
            offset += 4;
          } else {
            length = buffer.readUInt16LE(offset);
            offset += 2;
          }
        } else {
          // Implicit VR - determine VR from tag
          vr = getImplicitVR(tag);
          length = buffer.readUInt32LE(offset);
          offset += 4;
        }
        
        if (length === 0xFFFFFFFF || length > buffer.length - offset) {
          // Undefined length or invalid length - skip
          break;
        }
        
        // Extract specific tags we care about
        const value = extractValue(buffer, offset, length, vr);
        
        switch (tag) {
          // Patient Level (0010,xxxx)
          case '00100010': metadata.patientName = value; break;
          case '00100020': metadata.patientID = value; break;
          case '00100030': metadata.patientBirthDate = value; break;
          case '00100040': metadata.patientSex = value; break;
          case '00101010': metadata.patientAge = value; break;
          
          // Study Level (0008,xxxx, 0020,xxxx)
          case '00080020': metadata.studyDate = value; break;
          case '00080030': metadata.studyTime = value; break;
          case '00081030': metadata.studyDescription = value; break;
          case '0020000d': metadata.studyInstanceUID = value; break;
          case '00080050': metadata.accessionNumber = value; break;
          
          // Series Level
          case '0008103e': metadata.seriesDescription = value; break;
          case '0020000e': metadata.seriesInstanceUID = value; break;
          case '00200011': metadata.seriesNumber = parseInt(value) || undefined; break;
          case '00080060': metadata.modality = value; break;
          case '00180015': metadata.bodyPartExamined = value; break;
          case '00181030': metadata.protocolName = value; break;
          
          // Instance Level
          case '00080018': metadata.sopInstanceUID = value; break;
          case '00080016': metadata.sopClassUID = value; break;
          case '00200013': metadata.instanceNumber = parseInt(value) || undefined; break;
          case '00201041': metadata.sliceLocation = parseFloat(value) || undefined; break;
          
          // Image Position and Orientation
          case '00200032': // Image Position Patient
            if (value && value.includes('\\')) {
              const pos = value.split('\\').map(s => parseFloat(s));
              if (pos.length >= 3) metadata.imagePosition = [pos[0], pos[1], pos[2]];
            }
            break;
          case '00200037': // Image Orientation Patient
            if (value && value.includes('\\')) {
              const orient = value.split('\\').map(s => parseFloat(s));
              if (orient.length >= 6) metadata.imageOrientation = orient as [number, number, number, number, number, number];
            }
            break;
          
          // Image Properties
          case '00180050': metadata.sliceThickness = parseFloat(value) || undefined; break;
          case '00280030': // Pixel Spacing
            if (value && value.includes('\\')) {
              const spacing = value.split('\\').map(s => parseFloat(s));
              if (spacing.length >= 2) metadata.pixelSpacing = [spacing[0], spacing[1]];
            }
            break;
          case '00280010': metadata.rows = parseInt(value) || undefined; break;
          case '00280011': metadata.columns = parseInt(value) || undefined; break;
          case '00280100': metadata.bitsAllocated = parseInt(value) || undefined; break;
          case '00280101': metadata.bitsStored = parseInt(value) || undefined; break;
          case '00280102': metadata.highBit = parseInt(value) || undefined; break;
          case '00280103': metadata.pixelRepresentation = parseInt(value) || undefined; break;
          
          // Acquisition Parameters
          case '00180060': metadata.kvp = parseFloat(value) || undefined; break;
          case '00181152': metadata.mas = parseFloat(value) || undefined; break;
          case '00181150': metadata.exposureTime = parseFloat(value) || undefined; break;
          case '00181210': metadata.reconstructionKernel = value; break;
          case '00281050': metadata.windowCenter = parseFloat(value) || undefined; break;
          case '00281051': metadata.windowWidth = parseFloat(value) || undefined; break;
          
          // RT Plan Specific
          case '300a0002': metadata.rtPlanLabel = value; break;
          case '300a0006': metadata.rtPlanDate = value; break;
          case '300a0007': metadata.rtPlanTime = value; break;
          
          // RT Dose Specific
          case '30040002': metadata.doseUnits = value; break;
          case '30040004': metadata.doseType = value; break;
          
          // RT Structure Set Specific
          case '30060002': metadata.structureSetLabel = value; break;
          case '30060004': metadata.structureSetName = value; break;
          case '30060006': metadata.structureSetDescription = value; break;
          case '30060008': metadata.structureSetDate = value; break;
          case '30060009': metadata.structureSetTime = value; break;
        }
        
        offset += length;
        
      } catch (e) {
        // Skip problematic tags and continue
        offset += 8; // Skip to next potential tag
      }
    }
    
    return metadata;
  } catch (error) {
    console.error(`Error parsing DICOM metadata from ${filePath}:`, error);
    return {};
  }
}

function getImplicitVR(tag: string): string {
  // Map of common tags to their VRs for implicit VR transfer syntax
  const tagVRMap: { [key: string]: string } = {
    '00100010': 'PN', // Patient Name
    '00100020': 'LO', // Patient ID
    '00100030': 'DA', // Patient Birth Date
    '00100040': 'CS', // Patient Sex
    '00101010': 'AS', // Patient Age
    '00080020': 'DA', // Study Date
    '00080030': 'TM', // Study Time
    '00081030': 'LO', // Study Description
    '0020000d': 'UI', // Study Instance UID
    '00080050': 'SH', // Accession Number
    '0008103e': 'LO', // Series Description
    '0020000e': 'UI', // Series Instance UID
    '00200011': 'IS', // Series Number
    '00080060': 'CS', // Modality
    '00180015': 'CS', // Body Part Examined
    '00181030': 'LO', // Protocol Name
    '00080018': 'UI', // SOP Instance UID
    '00080016': 'UI', // SOP Class UID
    '00200013': 'IS', // Instance Number
    '00201041': 'DS', // Slice Location
    '00200032': 'DS', // Image Position Patient
    '00200037': 'DS', // Image Orientation Patient
    '00180050': 'DS', // Slice Thickness
    '00280030': 'DS', // Pixel Spacing
    '00280010': 'US', // Rows
    '00280011': 'US', // Columns
    '00280100': 'US', // Bits Allocated
    '00280101': 'US', // Bits Stored
    '00280102': 'US', // High Bit
    '00280103': 'US', // Pixel Representation
    '00180060': 'DS', // KVP
    '00181152': 'DS', // Exposure
    '00181150': 'IS', // Exposure Time
    '00181210': 'SH', // Convolution Kernel
    '00281050': 'DS', // Window Center
    '00281051': 'DS', // Window Width
  };
  
  return tagVRMap[tag] || 'UN';
}

function extractValue(buffer: Buffer, offset: number, length: number, vr: string): string {
  try {
    if (length === 0) return '';
    
    switch (vr) {
      case 'AE': // Application Entity
      case 'AS': // Age String
      case 'CS': // Code String
      case 'DA': // Date
      case 'DS': // Decimal String
      case 'DT': // Date Time
      case 'IS': // Integer String
      case 'LO': // Long String
      case 'LT': // Long Text
      case 'PN': // Person Name
      case 'SH': // Short String
      case 'ST': // Short Text
      case 'TM': // Time
      case 'UC': // Unlimited Characters
      case 'UI': // Unique Identifier
      case 'UR': // Universal Resource Identifier
      case 'UT': // Unlimited Text
        return buffer.toString('utf8', offset, offset + length).replace(/\0/g, '').trim();
      
      case 'US': // Unsigned Short
        if (length >= 2) {
          return buffer.readUInt16LE(offset).toString();
        }
        break;
      
      case 'UL': // Unsigned Long
        if (length >= 4) {
          return buffer.readUInt32LE(offset).toString();
        }
        break;
      
      case 'SS': // Signed Short
        if (length >= 2) {
          return buffer.readInt16LE(offset).toString();
        }
        break;
      
      case 'SL': // Signed Long
        if (length >= 4) {
          return buffer.readInt32LE(offset).toString();
        }
        break;
      
      case 'FL': // Floating Point Single
        if (length >= 4) {
          return buffer.readFloatLE(offset).toString();
        }
        break;
      
      case 'FD': // Floating Point Double
        if (length >= 8) {
          return buffer.readDoubleLE(offset).toString();
        }
        break;
      
      case 'AT': // Attribute Tag
        if (length >= 4) {
          const group = buffer.readUInt16LE(offset);
          const element = buffer.readUInt16LE(offset + 2);
          return `${group.toString(16).padStart(4, '0')}${element.toString(16).padStart(4, '0')}`;
        }
        break;
      
      default:
        // For binary data or unknown VRs, try to extract as string
        return buffer.toString('utf8', offset, offset + length).replace(/\0/g, '').trim();
    }
    
    return '';
  } catch (error) {
    return '';
  }
}