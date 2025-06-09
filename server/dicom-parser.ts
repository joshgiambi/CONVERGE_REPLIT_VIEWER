import * as fs from 'fs';

interface DICOMMetadata {
  patientName?: string;
  patientID?: string;
  patientSex?: string;
  patientAge?: string;
  studyDate?: string;
  studyTime?: string;
  studyDescription?: string;
  studyInstanceUID?: string;
  accessionNumber?: string;
  seriesDescription?: string;
  seriesInstanceUID?: string;
  sopInstanceUID?: string;
  modality?: string;
  bodyPartExamined?: string;
  protocolName?: string;
  instanceNumber?: number;
  sliceLocation?: number;
  sliceThickness?: number;
  pixelSpacing?: [number, number];
  rows?: number;
  columns?: number;
  bitsAllocated?: number;
  kvp?: number;
  mas?: number;
  exposureTime?: number;
  reconstructionKernel?: string;
  windowCenter?: number;
  windowWidth?: number;
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
      const group = buffer.readUInt16LE(offset);
      const element = buffer.readUInt16LE(offset + 2);
      const tag = `${group.toString(16).padStart(4, '0')}${element.toString(16).padStart(4, '0')}`;
      
      offset += 4;
      
      // Read VR (Value Representation)
      const vr = buffer.toString('ascii', offset, offset + 2);
      offset += 2;
      
      let length: number;
      
      // Handle different VR formats
      if (['OB', 'OD', 'OF', 'OL', 'OW', 'SQ', 'UC', 'UR', 'UT', 'UN'].includes(vr)) {
        offset += 2; // Skip reserved bytes
        length = buffer.readUInt32LE(offset);
        offset += 4;
      } else {
        length = buffer.readUInt16LE(offset);
        offset += 2;
      }
      
      if (length === 0xFFFFFFFF) {
        // Undefined length - skip for now
        break;
      }
      
      if (offset + length > buffer.length) {
        break;
      }
      
      // Extract specific tags we care about
      try {
        const value = extractValue(buffer, offset, length, vr);
        
        switch (tag) {
          case '00100010': // Patient Name
            metadata.patientName = value;
            break;
          case '00100020': // Patient ID
            metadata.patientID = value;
            break;
          case '00100040': // Patient Sex
            metadata.patientSex = value;
            break;
          case '00101010': // Patient Age
            metadata.patientAge = value;
            break;
          case '00080020': // Study Date
            metadata.studyDate = value;
            break;
          case '00080030': // Study Time
            metadata.studyTime = value;
            break;
          case '00081030': // Study Description
            metadata.studyDescription = value;
            break;
          case '00080050': // Accession Number
            metadata.accessionNumber = value;
            break;
          case '0008103e': // Series Description
            metadata.seriesDescription = value;
            break;
          case '00080060': // Modality
            metadata.modality = value;
            break;
          case '00180015': // Body Part Examined
            metadata.bodyPartExamined = value;
            break;
          case '00181030': // Protocol Name
            metadata.protocolName = value;
            break;
          case '00200013': // Instance Number
            metadata.instanceNumber = parseInt(value) || undefined;
            break;
          case '00201041': // Slice Location
            metadata.sliceLocation = parseFloat(value) || undefined;
            break;
          case '00180050': // Slice Thickness
            metadata.sliceThickness = parseFloat(value) || undefined;
            break;
          case '00280030': // Pixel Spacing
            if (value && value.includes('\\')) {
              const spacing = value.split('\\').map(s => parseFloat(s));
              metadata.pixelSpacing = [spacing[0], spacing[1]];
            }
            break;
          case '00280010': // Rows
            metadata.rows = parseInt(value) || undefined;
            break;
          case '00280011': // Columns
            metadata.columns = parseInt(value) || undefined;
            break;
          case '00280100': // Bits Allocated
            metadata.bitsAllocated = parseInt(value) || undefined;
            break;
          case '00180060': // KVP
            metadata.kvp = parseFloat(value) || undefined;
            break;
          case '00181152': // Exposure
            metadata.mas = parseFloat(value) || undefined;
            break;
          case '00181150': // Exposure Time
            metadata.exposureTime = parseFloat(value) || undefined;
            break;
          case '00181210': // Convolution Kernel
            metadata.reconstructionKernel = value;
            break;
          case '00281050': // Window Center
            metadata.windowCenter = parseFloat(value) || undefined;
            break;
          case '00281051': // Window Width
            metadata.windowWidth = parseFloat(value) || undefined;
            break;
        }
      } catch (e) {
        // Skip problematic tags
      }
      
      offset += length;
    }
    
    return metadata;
  } catch (error) {
    console.error('Error parsing DICOM metadata:', error);
    return {};
  }
}

function extractValue(buffer: Buffer, offset: number, length: number, vr: string): string {
  try {
    switch (vr) {
      case 'CS': // Code String
      case 'LO': // Long String
      case 'LT': // Long Text
      case 'PN': // Person Name
      case 'SH': // Short String
      case 'ST': // Short Text
      case 'UT': // Unlimited Text
      case 'AS': // Age String
      case 'DA': // Date
      case 'DT': // Date Time
      case 'TM': // Time
      case 'UI': // Unique Identifier
        return buffer.toString('ascii', offset, offset + length).replace(/\0/g, '').trim();
      
      case 'IS': // Integer String
      case 'DS': // Decimal String
        return buffer.toString('ascii', offset, offset + length).replace(/\0/g, '').trim();
      
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
    }
    
    return '';
  } catch (e) {
    return '';
  }
}