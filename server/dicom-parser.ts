import * as fs from 'fs';
import * as path from 'path';
import * as dicomParser from 'dicom-parser';

export interface DICOMMetadata {
  filename: string;
  modality?: string;
  patientID?: string;
  patientName?: string;
  studyDate?: string;
  seriesDescription?: string;
  sopClassUID?: string;
  studyInstanceUID?: string;
  seriesInstanceUID?: string;
  instanceNumber?: number;
  seriesNumber?: number;
  error?: string;
  // RT Structure Set specific
  structureSetDate?: string;
  structures?: RTStructure[];
}

export interface RTStructure {
  name: string;
  color?: [number, number, number];
}

export interface RTStructDetails {
  [filename: string]: {
    structureSetDate?: string;
    structures: Array<[string, [number, number, number] | null]>;
  };
}

export class DICOMParser {
  
  /**
   * Parse DICOM metadata from folder - following your guide exactly
   */
  static parseDICOMFromFolder(folderPath: string): { 
    data: DICOMMetadata[], 
    rtstructDetails: RTStructDetails 
  } {
    const data: DICOMMetadata[] = [];
    const rtstructDetails: RTStructDetails = {};

    if (!fs.existsSync(folderPath)) {
      return { data, rtstructDetails };
    }

    const files = this.getAllFiles(folderPath);

    for (const filePath of files) {
      const filename = path.basename(filePath);
      
      // Only process .dcm files
      if (!filename.toLowerCase().endsWith('.dcm')) {
        continue;
      }

      try {
        const buffer = fs.readFileSync(filePath);
        const dataSet = dicomParser.parseDicom(buffer);

        const row: DICOMMetadata = {
          filename: filename,
          modality: this.getString(dataSet, 'x00080060') || '',
          patientID: this.getString(dataSet, 'x00100020') || '',
          patientName: this.getPatientName(dataSet, 'x00100010') || '',
          studyDate: this.getString(dataSet, 'x00080020') || '',
          seriesDescription: this.getString(dataSet, 'x0008103e') || '',
          sopClassUID: this.getString(dataSet, 'x00080016') || '',
          studyInstanceUID: this.getString(dataSet, 'x0020000d'),
          seriesInstanceUID: this.getString(dataSet, 'x0020000e'),
          instanceNumber: this.getNumber(dataSet, 'x00200013'),
          seriesNumber: this.getNumber(dataSet, 'x00200011')
        };

        // Handle RT Structure Set following your guide
        if (row.modality === 'RTSTRUCT') {
          this.parseRTStruct(dataSet, filename, row, rtstructDetails);
        }

        data.push(row);

      } catch (error) {
        console.warn(`Failed to parse ${filename}: ${error}`);
        data.push({
          filename: filename,
          error: `Failed to parse: ${error instanceof Error ? error.message : 'Unknown error'}`
        });
      }
    }

    return { data, rtstructDetails };
  }

  /**
   * Parse RT Structure Set - following your guide structure
   */
  private static parseRTStruct(
    dataSet: any, 
    filename: string, 
    row: DICOMMetadata, 
    rtstructDetails: RTStructDetails
  ): void {
    try {
      const structures: Array<[string, [number, number, number] | null]> = [];
      
      // Get structure set date
      const structureSetDate = this.getString(dataSet, 'x30060008') || '';
      row.structureSetDate = structureSetDate;

      // Parse ROI structures following your guide approach
      const roiSequence = dataSet.elements['x30060020']; // StructureSetROISequence
      const contourSequence = dataSet.elements['x30060039']; // ROIContourSequence

      if (roiSequence && roiSequence.items) {
        for (let i = 0; i < roiSequence.items.length; i++) {
          const roiItem = roiSequence.items[i];
          const roiDataSet = roiItem.dataSet;
          
          // Get ROI name
          const roiName = this.getString(roiDataSet, 'x30060026') || `Structure ${i + 1}`;
          
          // Get corresponding color from contour sequence
          let color: [number, number, number] | null = null;
          if (contourSequence && contourSequence.items && contourSequence.items[i]) {
            const contourItem = contourSequence.items[i];
            const contourDataSet = contourItem.dataSet;
            const colorArray = this.getColorArray(contourDataSet, 'x3006002a');
            if (colorArray && colorArray.length === 3) {
              color = colorArray as [number, number, number];
            }
          }
          
          structures.push([roiName, color]);
        }
      }

      rtstructDetails[filename] = {
        structureSetDate: structureSetDate,
        structures: structures
      };

      // Also store in row for easy access
      row.structures = structures.map(([name, color]) => ({ name, color: color || undefined }));

    } catch (error) {
      console.warn(`Error parsing RT structures for ${filename}:`, error);
    }
  }

  /**
   * Get all files recursively from directory
   */
  private static getAllFiles(dirPath: string): string[] {
    const files: string[] = [];
    
    const items = fs.readdirSync(dirPath);
    for (const item of items) {
      const fullPath = path.join(dirPath, item);
      const stat = fs.statSync(fullPath);
      
      if (stat.isDirectory()) {
        files.push(...this.getAllFiles(fullPath));
      } else {
        files.push(fullPath);
      }
    }
    
    return files;
  }

  /**
   * Get string value from DICOM element
   */
  private static getString(dataSet: any, tag: string): string | undefined {
    try {
      const element = dataSet.elements[tag];
      if (!element) return undefined;
      
      return dataSet.string(tag)?.trim();
    } catch (error) {
      return undefined;
    }
  }

  /**
   * Get patient name with proper formatting
   */
  private static getPatientName(dataSet: any, tag: string): string | undefined {
    const name = this.getString(dataSet, tag);
    if (!name) return undefined;
    
    // Convert DICOM format (Last^First^Middle) to readable format
    const parts = name.split('^').filter(part => part.trim());
    if (parts.length > 1) {
      return `${parts[1]} ${parts[0]}`.trim();
    }
    return name;
  }

  /**
   * Get numeric value from DICOM element
   */
  private static getNumber(dataSet: any, tag: string): number | undefined {
    try {
      const element = dataSet.elements[tag];
      if (!element) return undefined;
      
      const value = dataSet.string(tag);
      const num = parseFloat(value);
      return isNaN(num) ? undefined : num;
    } catch (error) {
      return undefined;
    }
  }

  /**
   * Get color array from DICOM element
   */
  private static getColorArray(dataSet: any, tag: string): number[] | undefined {
    try {
      const element = dataSet.elements[tag];
      if (!element) return undefined;
      
      const value = dataSet.string(tag);
      if (!value) return undefined;
      
      const numbers = value.split('\\').map((s: string) => {
        const num = parseInt(s.trim());
        return isNaN(num) ? 0 : num;
      });
      
      return numbers.length === 3 ? numbers : undefined;
    } catch (error) {
      return undefined;
    }
  }

  /**
   * Check if file is DICOM by reading header
   */
  static isDICOMFile(filePath: string): boolean {
    try {
      const fd = fs.openSync(filePath, 'r');
      const buffer = Buffer.alloc(4);
      fs.readSync(fd, buffer, 0, 4, 128);
      fs.closeSync(fd);
      return buffer.toString('ascii') === 'DICM';
    } catch (error) {
      return false;
    }
  }
}