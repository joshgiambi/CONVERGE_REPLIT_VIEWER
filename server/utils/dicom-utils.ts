import dicomParser from 'dicom-parser';
import * as fs from 'fs';
import * as path from 'path';

export function extractDICOMMetadata(filePath: string) {
  try {
    const buffer = fs.readFileSync(filePath);
    const byteArray = new Uint8Array(buffer);
    const dataSet = dicomParser.parseDicom(byteArray);

    const getValue = (tag: string, defaultValue: any = null) => {
      try {
        return dataSet.string(tag) || defaultValue;
      } catch (e) {
        return defaultValue;
      }
    };

    const getNumber = (tag: string, defaultValue: number = 0) => {
      try {
        const value = dataSet.string(tag);
        return value ? parseFloat(value) : defaultValue;
      } catch (e) {
        return defaultValue;
      }
    };

    const getArray = (tag: string, defaultValue: any[] = []) => {
      try {
        const value = dataSet.string(tag);
        return value ? value.split('\\').map(Number) : defaultValue;
      } catch (e) {
        return defaultValue;
      }
    };

    const metadata: any = {
      patientID: getValue('x00100020', 'Unknown'),
      patientName: getValue('x00100010', 'Unknown Patient'),
      patientBirthDate: getValue('x00100030'),
      patientSex: getValue('x00100040'),
      patientAge: getValue('x00101010'),
      studyInstanceUID: getValue('x0020000d'),
      studyDescription: getValue('x00081030'),
      studyDate: getValue('x00080020'),
      studyTime: getValue('x00080030'),
      seriesInstanceUID: getValue('x0020000e'),
      seriesDescription: getValue('x0008103e'),
      seriesNumber: getValue('x00200011'),
      modality: getValue('x00080060'),
      sopInstanceUID: getValue('x00080018'),
      instanceNumber: getValue('x00200013'),
      imagePositionPatient: getArray('x00200032'),
      imageOrientationPatient: getArray('x00200037'),
      sliceThickness: getNumber('x00180050'),
      sliceLocation: getNumber('x00201041'),
      pixelSpacing: getArray('x00280030'),
      windowCenter: getNumber('x00281050'),
      windowWidth: getNumber('x00281051'),
      rows: getNumber('x00280010'),
      columns: getNumber('x00280011'),
      bitsAllocated: getNumber('x00280100'),
      bitsStored: getNumber('x00280101'),
      highBit: getNumber('x00280102'),
      pixelRepresentation: getNumber('x00280103')
    };

    return metadata;
  } catch (error) {
    console.error('Error parsing DICOM file:', error);
    throw error;
  }
}

export function generateUID(): string {
  // Generate a simple UID for testing purposes
  return '1.2.3.4.5.6.7.8.9.' + Date.now() + '.' + Math.floor(Math.random() * 1000);
}

export function findDicomFilesRecursive(dirPath: string): string[] {
  const files: string[] = [];
  
  try {
    const items = fs.readdirSync(dirPath);
    
    for (const item of items) {
      const itemPath = path.join(dirPath, item);
      const stat = fs.statSync(itemPath);
      
      if (stat.isDirectory()) {
        // Recursively search subdirectories
        files.push(...findDicomFilesRecursive(itemPath));
      } else if (item.toLowerCase().endsWith('.dcm') || !path.extname(item)) {
        files.push(itemPath);
      }
    }
  } catch (error) {
    console.error(`Error reading directory ${dirPath}:`, error);
  }
  
  return files;
}