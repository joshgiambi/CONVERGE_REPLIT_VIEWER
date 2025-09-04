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
  // Additional fields from your guide
  studyInstanceUID?: string;
  seriesInstanceUID?: string;
  instanceNumber?: number;
  seriesNumber?: number;
  patientSex?: string;
  patientAge?: string;
  studyTime?: string;
  studyDescription?: string;
  accessionNumber?: string;
  bodyPartExamined?: string;
  protocolName?: string;
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
  // RT Structure Set specific
  structureSetDate?: string;
  structureSetTime?: string;
  structures?: any[];
  // RT Dose
  doseUnits?: string;
  doseType?: string;
  doseSummationType?: string;
  // RT Plan
  planName?: string;
  planDate?: string;
  planTime?: string;
  // Error handling
  error?: string;
}

export interface RTStructure {
  name: string;
  color?: [number, number, number];
}

export class DICOMMetadataParser {
  
  /**
   * Parse DICOM file and extract metadata - based on your guide
   */
  static parseDICOMFile(filePath: string): DICOMMetadata {
    if (!fs.existsSync(filePath)) {
      return {
        filename: path.basename(filePath),
        error: 'File not found'
      };
    }

    try {
      // Read DICOM file, stop before pixels for metadata extraction
      const buffer = fs.readFileSync(filePath);
      const dataSet = dicomParser.parseDicom(buffer);
      
      const metadata: DICOMMetadata = {
        filename: path.basename(filePath),
        modality: this.getString(dataSet, 'x00080060'),
        patientID: this.getString(dataSet, 'x00100020'),
        patientName: this.getPatientName(dataSet, 'x00100010'),
        studyDate: this.getString(dataSet, 'x00080020'),
        seriesDescription: this.getString(dataSet, 'x0008103e'),
        sopClassUID: this.getString(dataSet, 'x00080016')
      };

      // Add all additional fields from your guide structure
      metadata.studyInstanceUID = this.getString(dataSet, 'x0020000d');
      metadata.seriesInstanceUID = this.getString(dataSet, 'x0020000e');
      metadata.instanceNumber = this.getNumber(dataSet, 'x00200013');
      metadata.seriesNumber = this.getNumber(dataSet, 'x00200011');
      metadata.patientSex = this.getString(dataSet, 'x00100040');
      metadata.patientAge = this.getString(dataSet, 'x00101010');
      metadata.studyTime = this.getString(dataSet, 'x00080030');
      metadata.studyDescription = this.getString(dataSet, 'x00081030');
      metadata.accessionNumber = this.getString(dataSet, 'x00080050');
      metadata.bodyPartExamined = this.getString(dataSet, 'x00180015');
      metadata.protocolName = this.getString(dataSet, 'x00181030');
      metadata.sliceLocation = this.getNumber(dataSet, 'x00201041');
      metadata.sliceThickness = this.getNumber(dataSet, 'x00180050');
      metadata.pixelSpacing = this.getPixelSpacing(dataSet, 'x00280030');
      metadata.rows = this.getNumber(dataSet, 'x00280010');
      metadata.columns = this.getNumber(dataSet, 'x00280011');
      metadata.bitsAllocated = this.getNumber(dataSet, 'x00280100');
      metadata.kvp = this.getNumber(dataSet, 'x00180060');
      metadata.mas = this.getNumber(dataSet, 'x00181152');
      metadata.exposureTime = this.getNumber(dataSet, 'x00180080');
      metadata.reconstructionKernel = this.getString(dataSet, 'x00181210');
      metadata.windowCenter = this.getNumber(dataSet, 'x00281050');
      metadata.windowWidth = this.getNumber(dataSet, 'x00281051');

      // Handle RT Structure Set following your guide
      if (metadata.modality === 'RTSTRUCT') {
        this.parseRTStructMetadata(dataSet, metadata);
      }

      return metadata;
    } catch (error) {
      console.warn(`Failed to parse ${path.basename(filePath)}: ${error}`);
      return {
        filename: path.basename(filePath),
        error: `Failed to parse: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Parse RT Structure Set specific metadata
   */
  private static parseRTStructMetadata(dataSet: any, metadata: DICOMMetadata): void {
    metadata.structureSetDate = this.getString(dataSet, 'x30060008');
    metadata.structureSetTime = this.getString(dataSet, 'x30060009');
    // Parse ROI sequences would populate `structures` in a simplified way
    const roiSequence = dataSet.elements['x30060020'];
    const contourSequence = dataSet.elements['x30060039'];
    if (roiSequence && contourSequence) {
      metadata.structures = this.parseROIStructures(dataSet, roiSequence, contourSequence) as any[];
    }
  }

  /**
   * Parse RT Dose specific metadata
   */
  private static parseRTDoseMetadata(dataSet: any, metadata: DICOMMetadata): void {
    metadata.doseUnits = this.getString(dataSet, 'x30040002');
    metadata.doseType = this.getString(dataSet, 'x30040004');
    metadata.doseSummationType = this.getString(dataSet, 'x30040006');
  }

  /**
   * Parse RT Plan specific metadata
   */
  private static parseRTPlanMetadata(dataSet: any, metadata: DICOMMetadata): void {
    metadata.planName = this.getString(dataSet, 'x300a0002');
    metadata.planDate = this.getString(dataSet, 'x300a0006');
    metadata.planTime = this.getString(dataSet, 'x300a0007');
  }

  /**
   * Parse ROI structures from sequences
   */
  private static parseROIStructures(dataSet: any, roiSequence: any, contourSequence: any): RTStructure[] {
    const structures: RTStructure[] = [];
    
    try {
      // This is a simplified parser - in a production system you'd need more robust sequence parsing
      // For now, we'll extract basic structure information where available
      
      // Parse structure names from ROI sequence
      const roiItems = this.parseSequenceItems(dataSet, roiSequence);
      const contourItems = this.parseSequenceItems(dataSet, contourSequence);
      
      roiItems.forEach((roiItem: any, index: number) => {
        const structure: RTStructure = {
          roiNumber: this.getNumber(roiItem, 'x30060022') || index + 1,
          roiName: this.getString(roiItem, 'x30060026') || `Structure ${index + 1}`,
          roiGenerationAlgorithm: this.getString(roiItem, 'x30060036')
        };
        
        // Try to get display color from corresponding contour item
        if (contourItems[index]) {
          const colorArray = this.getNumberArray(contourItems[index], 'x3006002a', 3);
          if (colorArray && colorArray.length === 3) {
            structure.roiDisplayColor = colorArray as [number, number, number];
          }
        }
        
        structures.push(structure);
      });
    } catch (error) {
      console.warn('Error parsing ROI structures:', error);
    }
    
    return structures;
  }

  /**
   * Parse sequence items (simplified)
   */
  private static parseSequenceItems(dataSet: any, sequence: any): any[] {
    const items: any[] = [];
    
    try {
      if (sequence.items) {
        sequence.items.forEach((item: any) => {
          items.push(item.dataSet || item);
        });
      }
    } catch (error) {
      console.warn('Error parsing sequence items:', error);
    }
    
    return items;
  }

  /**
   * Get string value from DICOM element
   */
  private static getString(dataSet: any, tag: string): string | undefined {
    const element = dataSet.elements[tag];
    if (!element) return undefined;
    
    try {
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
    const element = dataSet.elements[tag];
    if (!element) return undefined;
    
    try {
      const value = dataSet.string(tag);
      const num = parseFloat(value);
      return isNaN(num) ? undefined : num;
    } catch (error) {
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
      const numbers = value.split('\\').map((s: string) => parseFloat(s.trim())).filter((n: number) => !isNaN(n));
      
      if (expectedLength && numbers.length !== expectedLength) {
        return undefined;
      }
      
      return numbers.length > 0 ? numbers : undefined;
    } catch (error) {
      return undefined;
    }
  }

  /**
   * Get pixel spacing as [row, column] spacing
   */
  private static getPixelSpacing(dataSet: any, tag: string): [number, number] | undefined {
    const spacing = this.getNumberArray(dataSet, tag, 2);
    return spacing ? [spacing[0], spacing[1]] : undefined;
  }

  /**
   * Get window center/width values (can be single value or array)
   */
  private static getWindowValue(dataSet: any, tag: string): number | number[] | undefined {
    const values = this.getNumberArray(dataSet, tag);
    if (!values) return undefined;
    
    return values.length === 1 ? values[0] : values;
  }

  /**
   * Validate if file is a valid DICOM file
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

  /**
   * Parse multiple DICOM files from a directory
   */
  static parseDICOMDirectory(directoryPath: string): DICOMMetadata[] {
    const results: DICOMMetadata[] = [];
    
    try {
      const files = fs.readdirSync(directoryPath, { recursive: true });
      
      for (const file of files) {
        const filePath = path.join(directoryPath, file.toString());
        
        if (fs.statSync(filePath).isFile()) {
          // Check if it's a DICOM file by extension or DICM header
          if (file.toString().toLowerCase().endsWith('.dcm') || this.isDICOMFile(filePath)) {
            const metadata = this.parseDICOMFile(filePath);
            results.push(metadata);
          }
        }
      }
    } catch (error) {
      console.error('Error parsing DICOM directory:', error);
    }
    
    return results;
  }
}