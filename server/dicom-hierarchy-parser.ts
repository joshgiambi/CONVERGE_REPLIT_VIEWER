import * as fs from 'fs';
import * as path from 'path';
import * as dicomParser from 'dicom-parser';

export interface DICOMImage {
  filename: string;
  filePath: string;
  sopInstanceUID?: string;
  instanceNumber?: number;
  sliceLocation?: number;
  imagePosition?: number[];
  imageOrientation?: number[];
  pixelSpacing?: number[];
  windowCenter?: number;
  windowWidth?: number;
  error?: string;
}

export interface DICOMSeries {
  seriesInstanceUID: string;
  seriesDescription?: string;
  modality?: string;
  seriesNumber?: number;
  sliceThickness?: number;
  images: DICOMImage[];
}

export interface DICOMStudy {
  studyInstanceUID: string;
  studyDescription?: string;
  studyDate?: string;
  studyTime?: string;
  accessionNumber?: string;
  modalities: string[];
  series: Map<string, DICOMSeries>;
}

export interface DICOMPatient {
  patientID: string;
  patientName?: string;
  patientSex?: string;
  patientAge?: string;
  dateOfBirth?: string;
  studies: Map<string, DICOMStudy>;
}

export interface DICOMHierarchy {
  patients: Map<string, DICOMPatient>;
  totalFiles: number;
  validFiles: number;
  errors: string[];
}

export class DICOMHierarchyParser {
  
  /**
   * Parse DICOM files from a folder and organize by Patient → Study → Series → Images
   */
  static parseDICOMHierarchy(folderPath: string): DICOMHierarchy {
    const hierarchy: DICOMHierarchy = {
      patients: new Map(),
      totalFiles: 0,
      validFiles: 0,
      errors: []
    };

    if (!fs.existsSync(folderPath)) {
      hierarchy.errors.push(`Folder not found: ${folderPath}`);
      return hierarchy;
    }

    const files = this.getAllDICOMFiles(folderPath);
    hierarchy.totalFiles = files.length;

    for (const filePath of files) {
      try {
        const dicomData = this.parseSingleDICOM(filePath);
        if (dicomData.error) {
          hierarchy.errors.push(`${path.basename(filePath)}: ${dicomData.error}`);
          continue;
        }

        this.addToHierarchy(hierarchy, dicomData, filePath);
        hierarchy.validFiles++;

      } catch (error) {
        hierarchy.errors.push(`${path.basename(filePath)}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    // Sort images in each series by instance number or slice location
    this.sortImagesInSeries(hierarchy);

    return hierarchy;
  }

  /**
   * Get all DICOM files recursively from directory
   */
  private static getAllDICOMFiles(dirPath: string): string[] {
    const files: string[] = [];
    
    function walkDir(currentPath: string) {
      const items = fs.readdirSync(currentPath);
      for (const item of items) {
        const fullPath = path.join(currentPath, item);
        const stat = fs.statSync(fullPath);
        
        if (stat.isDirectory()) {
          walkDir(fullPath);
        } else if (item.endsWith('.dcm') || item.endsWith('.dicom') || DICOMHierarchyParser.isDICOMFile(fullPath)) {
          files.push(fullPath);
        }
      }
    }
    
    walkDir(dirPath);
    return files;
  }

  /**
   * Check if file is DICOM by reading header
   */
  private static isDICOMFile(filePath: string): boolean {
    try {
      const fd = fs.openSync(filePath, 'r');
      const buffer = Buffer.alloc(4);
      fs.readSync(fd, buffer, 0, 4, 128);
      fs.closeSync(fd);
      return buffer.toString() === 'DICM';
    } catch {
      return false;
    }
  }

  /**
   * Parse single DICOM file and extract metadata
   */
  private static parseSingleDICOM(filePath: string): any {
    try {
      const buffer = fs.readFileSync(filePath);
      const dataSet = dicomParser.parseDicom(buffer);
      
      return {
        filename: path.basename(filePath),
        patientID: this.getString(dataSet, 'x00100020') || 'UNKNOWN',
        patientName: this.getPatientName(dataSet, 'x00100010'),
        patientSex: this.getString(dataSet, 'x00100040'),
        patientAge: this.getString(dataSet, 'x00101010'),
        dateOfBirth: this.getString(dataSet, 'x00100030'),
        studyInstanceUID: this.getString(dataSet, 'x0020000d') || 'UNKNOWN_STUDY',
        studyDescription: this.getString(dataSet, 'x00081030'),
        studyDate: this.getString(dataSet, 'x00080020'),
        studyTime: this.getString(dataSet, 'x00080030'),
        accessionNumber: this.getString(dataSet, 'x00080050'),
        seriesInstanceUID: this.getString(dataSet, 'x0020000e') || 'UNKNOWN_SERIES',
        seriesDescription: this.getString(dataSet, 'x0008103e'),
        modality: this.getString(dataSet, 'x00080060'),
        seriesNumber: this.getNumber(dataSet, 'x00200011'),
        instanceNumber: this.getNumber(dataSet, 'x00200013'),
        sopInstanceUID: this.getString(dataSet, 'x00080018'),
        sliceLocation: this.getNumber(dataSet, 'x00201041'),
        sliceThickness: this.getNumber(dataSet, 'x00180050'),
        imagePosition: this.getNumberArray(dataSet, 'x00200032', 3),
        imageOrientation: this.getNumberArray(dataSet, 'x00200037', 6),
        pixelSpacing: this.getNumberArray(dataSet, 'x00280030', 2),
        windowCenter: this.getNumber(dataSet, 'x00281050'),
        windowWidth: this.getNumber(dataSet, 'x00281051')
      };
    } catch (error) {
      return {
        filename: path.basename(filePath),
        error: error instanceof Error ? error.message : 'Failed to parse DICOM'
      };
    }
  }

  /**
   * Add parsed DICOM data to hierarchy
   */
  private static addToHierarchy(hierarchy: DICOMHierarchy, dicomData: any, filePath: string) {
    const patientKey = dicomData.patientID;
    const studyKey = dicomData.studyInstanceUID;
    const seriesKey = dicomData.seriesInstanceUID;

    // Get or create patient
    if (!hierarchy.patients.has(patientKey)) {
      hierarchy.patients.set(patientKey, {
        patientID: dicomData.patientID,
        patientName: dicomData.patientName,
        patientSex: dicomData.patientSex,
        patientAge: dicomData.patientAge,
        dateOfBirth: dicomData.dateOfBirth,
        studies: new Map()
      });
    }

    const patient = hierarchy.patients.get(patientKey)!;

    // Get or create study
    if (!patient.studies.has(studyKey)) {
      patient.studies.set(studyKey, {
        studyInstanceUID: dicomData.studyInstanceUID,
        studyDescription: dicomData.studyDescription,
        studyDate: dicomData.studyDate,
        studyTime: dicomData.studyTime,
        accessionNumber: dicomData.accessionNumber,
        modalities: [],
        series: new Map()
      });
    }

    const study = patient.studies.get(studyKey)!;

    // Add modality to study if not present
    if (dicomData.modality && !study.modalities.includes(dicomData.modality)) {
      study.modalities.push(dicomData.modality);
    }

    // Get or create series
    if (!study.series.has(seriesKey)) {
      study.series.set(seriesKey, {
        seriesInstanceUID: dicomData.seriesInstanceUID,
        seriesDescription: dicomData.seriesDescription,
        modality: dicomData.modality,
        seriesNumber: dicomData.seriesNumber,
        sliceThickness: dicomData.sliceThickness,
        images: []
      });
    }

    const series = study.series.get(seriesKey)!;

    // Add image to series
    series.images.push({
      filename: dicomData.filename,
      filePath: filePath,
      sopInstanceUID: dicomData.sopInstanceUID,
      instanceNumber: dicomData.instanceNumber,
      sliceLocation: dicomData.sliceLocation,
      imagePosition: dicomData.imagePosition,
      imageOrientation: dicomData.imageOrientation,
      pixelSpacing: dicomData.pixelSpacing,
      windowCenter: dicomData.windowCenter,
      windowWidth: dicomData.windowWidth
    });
  }

  /**
   * Sort images in each series by instance number or slice location
   */
  private static sortImagesInSeries(hierarchy: DICOMHierarchy) {
    for (const patient of hierarchy.patients.values()) {
      for (const study of patient.studies.values()) {
        for (const series of study.series.values()) {
          series.images.sort((a, b) => {
            // Sort by instance number first, then slice location, then filename
            if (a.instanceNumber !== undefined && b.instanceNumber !== undefined) {
              return a.instanceNumber - b.instanceNumber;
            }
            if (a.sliceLocation !== undefined && b.sliceLocation !== undefined) {
              return a.sliceLocation - b.sliceLocation;
            }
            return a.filename.localeCompare(b.filename);
          });
        }
      }
    }
  }

  /**
   * Get string value from DICOM element
   */
  private static getString(dataSet: any, tag: string): string | undefined {
    const element = dataSet.elements[tag];
    if (!element) return undefined;
    try {
      return dataSet.string(tag)?.trim();
    } catch {
      return undefined;
    }
  }

  /**
   * Get patient name with proper formatting
   */
  private static getPatientName(dataSet: any, tag: string): string | undefined {
    const element = dataSet.elements[tag];
    if (!element) return undefined;
    try {
      const name = dataSet.string(tag)?.trim();
      return name ? name.replace(/\^/g, ' ').trim() : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Get numeric value from DICOM element
   */
  private static getNumber(dataSet: any, tag: string): number | undefined {
    const element = dataSet.elements[tag];
    if (!element) return undefined;
    try {
      const value = dataSet.string(tag);
      const num = parseFloat(value);
      return isNaN(num) ? undefined : num;
    } catch {
      return undefined;
    }
  }

  /**
   * Get array of numbers from DICOM element
   */
  private static getNumberArray(dataSet: any, tag: string, expectedLength?: number): number[] | undefined {
    const element = dataSet.elements[tag];
    if (!element) return undefined;
    try {
      const value = dataSet.string(tag);
      const numbers = value.split('\\').map(s => parseFloat(s.trim())).filter(n => !isNaN(n));
      if (expectedLength && numbers.length !== expectedLength) return undefined;
      return numbers.length > 0 ? numbers : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Convert hierarchy to summary for display
   */
  static getHierarchySummary(hierarchy: DICOMHierarchy): any {
    const summary = {
      totalPatients: hierarchy.patients.size,
      totalStudies: 0,
      totalSeries: 0,
      totalImages: hierarchy.validFiles,
      patients: [] as any[]
    };

    for (const [patientID, patient] of hierarchy.patients) {
      const patientSummary = {
        patientID,
        patientName: patient.patientName,
        patientSex: patient.patientSex,
        patientAge: patient.patientAge,
        studies: [] as any[]
      };

      for (const [studyUID, study] of patient.studies) {
        summary.totalStudies++;
        
        const studySummary = {
          studyInstanceUID: studyUID,
          studyDescription: study.studyDescription,
          studyDate: study.studyDate,
          modalities: study.modalities,
          series: [] as any[]
        };

        for (const [seriesUID, series] of study.series) {
          summary.totalSeries++;
          
          studySummary.series.push({
            seriesInstanceUID: seriesUID,
            seriesDescription: series.seriesDescription,
            modality: series.modality,
            imageCount: series.images.length,
            seriesNumber: series.seriesNumber
          });
        }

        patientSummary.studies.push(studySummary);
      }

      summary.patients.push(patientSummary);
    }

    return summary;
  }
}