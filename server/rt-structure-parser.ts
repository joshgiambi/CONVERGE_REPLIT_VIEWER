import dicomParser from 'dicom-parser';
import * as fs from 'fs';

export interface RTStructureContour {
  roiNumber: number;
  structureName: string;
  color: [number, number, number]; // RGB color
  contours: RTContour[];
}

export interface RTContour {
  slicePosition: number; // Z position
  points: number[]; // Array of x,y,z coordinates (flattened)
  numberOfPoints: number;
}

export interface RTStructureSet {
  studyInstanceUID: string;
  seriesInstanceUID: string;
  sopInstanceUID: string;
  frameOfReferenceUID?: string;
  structureSetLabel?: string;
  structureSetDate?: string;
  structures: RTStructureContour[];
  referencedSeriesUID?: string; // The CT/MR series this RT structure references
  referencedStudyUID?: string;
}

export class RTStructureParser {
  /**
   * Parse RT Structure Set DICOM file
   */
  static parseRTStructureSet(filePath: string): RTStructureSet {
    try {
      const buffer = fs.readFileSync(filePath);
      const byteArray = new Uint8Array(buffer);
      const dataSet = (dicomParser as any).parseDicom(byteArray, {});

      const rtStructureSet: RTStructureSet = {
        studyInstanceUID: this.getString(dataSet, 'x0020000d') || '',
        seriesInstanceUID: this.getString(dataSet, 'x0020000e') || '',
        sopInstanceUID: this.getString(dataSet, 'x00080018') || '',
        frameOfReferenceUID: this.getString(dataSet, 'x00200052'),
        structureSetLabel: this.getString(dataSet, 'x30060002'),
        structureSetDate: this.getString(dataSet, 'x30060008'),
        structures: []
      };

      // Parse Structure Set ROI Sequence (3006,0020)
      const roiSequence = dataSet.elements.x30060020;
      if (!roiSequence) {
        console.warn('No Structure Set ROI Sequence found');
        return rtStructureSet;
      }

      // Parse ROI Contour Sequence (3006,0039)
      const contourSequence = dataSet.elements.x30060039;
      if (!contourSequence) {
        console.warn('No ROI Contour Sequence found');
        return rtStructureSet;
      }

      // Parse RT ROI Observations Sequence (3006,0080)
      const observationsSequence = dataSet.elements.x30060080;

      // Extract ROI information
      const roiData = this.parseROISequence(dataSet, roiSequence);
      const contourData = this.parseContourSequence(dataSet, contourSequence);
      const observationsData = observationsSequence ? this.parseObservationsSequence(dataSet, observationsSequence) : new Map<number, any>();

      // Combine the data
      rtStructureSet.structures = this.combineROIData(roiData, contourData, observationsData);

      // Parse Referenced Frame of Reference Sequence (3006,0010) to find referenced series
      const referencedFrameOfRefSeq = dataSet.elements.x30060010;
      if (referencedFrameOfRefSeq && referencedFrameOfRefSeq.items && referencedFrameOfRefSeq.items.length > 0) {
        const firstRefFrame = referencedFrameOfRefSeq.items[0];
        
        // Get RT Referenced Study Sequence (3006,0012)
        const rtRefStudySeq = firstRefFrame.dataSet.elements.x30060012;
        if (rtRefStudySeq && rtRefStudySeq.items && rtRefStudySeq.items.length > 0) {
          const refStudy = rtRefStudySeq.items[0];
          rtStructureSet.referencedStudyUID = this.getString(refStudy.dataSet, 'x0008112c');
          
          // Get RT Referenced Series Sequence (3006,0014)
          const rtRefSeriesSeq = refStudy.dataSet.elements.x30060014;
          if (rtRefSeriesSeq && rtRefSeriesSeq.items && rtRefSeriesSeq.items.length > 0) {
            const refSeries = rtRefSeriesSeq.items[0];
            rtStructureSet.referencedSeriesUID = this.getString(refSeries.dataSet, 'x0020000e');
          }
        }
      }

      try {
        if (process.env.RTSTRUCT_DEBUG === '1') {
          console.log(`Parsed RT Structure Set with ${rtStructureSet.structures.length} structures`);
          if (rtStructureSet.referencedSeriesUID) {
            console.log(`RT Structure references series: ${rtStructureSet.referencedSeriesUID}`);
          }
        }
      } catch {}
      return rtStructureSet;

    } catch (error: any) {
      console.error('Error parsing RT Structure Set:', error);
      throw new Error(`Failed to parse RT Structure Set: ${error?.message || 'Unknown error'}`);
    }
  }

  /**
   * Parse Structure Set ROI Sequence
   */
  private static parseROISequence(dataSet: any, roiSequence: any): Map<number, any> {
    const roiData = new Map();
    
    if (roiSequence.items) {
      roiSequence.items.forEach((item: any) => {
        const roiNumber = this.getNumber(item.dataSet, 'x30060022');
        const roiName = this.getString(item.dataSet, 'x30060026');
        
        if (roiNumber !== undefined) {
          roiData.set(roiNumber, {
            roiNumber,
            roiName: roiName || `ROI_${roiNumber}`,
          });
        }
      });
    }
    
    return roiData;
  }

  /**
   * Parse ROI Contour Sequence
   */
  private static parseContourSequence(dataSet: any, contourSequence: any): Map<number, any> {
    const contourData = new Map();
    
    if (contourSequence.items) {
      contourSequence.items.forEach((item: any) => {
        const referencedROINumber = this.getNumber(item.dataSet, 'x30060084');
        const displayColor = this.getNumberArray(item.dataSet, 'x3006002a', 3);
        
        if (referencedROINumber !== undefined) {
          const contours: RTContour[] = [];
          
          // Parse Contour Sequence (3006,0040)
          const contourSeq = item.dataSet.elements.x30060040;
          if (contourSeq && contourSeq.items) {
            contourSeq.items.forEach((contourItem: any) => {
              const contourData = this.parseContourData(contourItem.dataSet);
              if (contourData) {
                contours.push(contourData);
              }
            });
          }
          
          // Generate distinct colors for each structure if not found in DICOM
          const defaultColors = [
            [255, 0, 0],    // Red
            [0, 255, 0],    // Green  
            [0, 0, 255],    // Blue
            [255, 255, 0],  // Yellow
            [255, 0, 255],  // Magenta
            [0, 255, 255],  // Cyan
            [255, 128, 0],  // Orange
            [128, 255, 0],  // Lime
            [255, 0, 128],  // Pink
            [128, 0, 255],  // Purple
            [0, 128, 255],  // Sky Blue
            [255, 255, 128], // Light Yellow
            [128, 255, 255], // Light Cyan
            [255, 128, 255], // Light Magenta
            [128, 128, 255], // Light Blue
            [255, 128, 128], // Light Red
            [128, 255, 128], // Light Green
            [192, 192, 192], // Silver
            [128, 128, 128]  // Gray
          ];
          
          const colorIndex = (referencedROINumber - 1) % defaultColors.length;
          const structureColor = displayColor || defaultColors[colorIndex];
          
          contourData.set(referencedROINumber, {
            referencedROINumber,
            displayColor: structureColor,
            contours
          });
        }
      });
    }
    
    return contourData;
  }

  /**
   * Parse individual contour data
   */
  private static parseContourData(contourDataSet: any): RTContour | null {
    const contourGeometricType = this.getString(contourDataSet, 'x30060042');
    const numberOfContourPoints = this.getNumber(contourDataSet, 'x30060046');
    const contourData = this.getString(contourDataSet, 'x30060050');
    
    if (contourGeometricType !== 'CLOSED_PLANAR' && contourGeometricType !== 'OPEN_PLANAR') {
      console.warn(`Unsupported contour geometric type: ${contourGeometricType}`);
      return null;
    }
    
    if (!contourData || !numberOfContourPoints) {
      return null;
    }
    
    // Parse contour points (x\y\z\x\y\z...)
    const points = contourData.split('\\').map(p => parseFloat(p));
    
    if (points.length !== numberOfContourPoints * 3) {
      console.warn('Contour points count mismatch');
      return null;
    }
    
    // Extract Z position (assuming all points in contour are on same slice)
    const slicePosition = points[2];
    
    return {
      slicePosition,
      points,
      numberOfPoints: numberOfContourPoints
    };
  }

  /**
   * Parse RT ROI Observations Sequence
   */
  private static parseObservationsSequence(dataSet: any, observationsSequence: any): Map<number, any> {
    const observationsData = new Map();
    
    if (observationsSequence.items) {
      observationsSequence.items.forEach((item: any) => {
        const referencedROINumber = this.getNumber(item.dataSet, 'x30060084');
        const roiObservationLabel = this.getString(item.dataSet, 'x30060085');
        
        if (referencedROINumber !== undefined) {
          observationsData.set(referencedROINumber, {
            referencedROINumber,
            roiObservationLabel
          });
        }
      });
    }
    
    return observationsData;
  }

  /**
   * Combine ROI data from different sequences
   */
  private static combineROIData(
    roiData: Map<number, any>,
    contourData: Map<number, any>,
    observationsData: Map<number, any>
  ): RTStructureContour[] {
    const structures: RTStructureContour[] = [];
    
    roiData.forEach((roi, roiNumber) => {
      const contour = contourData.get(roiNumber);
      const observation = observationsData.get(roiNumber);
      
      if (contour) {
        structures.push({
          roiNumber,
          structureName: observation?.roiObservationLabel || roi.roiName,
          color: contour.displayColor,
          contours: contour.contours
        });
      }
    });
    
    return structures;
  }

  /**
   * Get string value from DICOM element
   */
  private static getString(dataSet: any, tag: string): string | undefined {
    const element = dataSet.elements[tag];
    if (!element) return undefined;
    return dataSet.string(tag);
  }

  /**
   * Get numeric value from DICOM element
   */
  private static getNumber(dataSet: any, tag: string): number | undefined {
    const element = dataSet.elements[tag];
    if (!element) return undefined;
    const value = dataSet.string(tag);
    return value ? parseFloat(value) : undefined;
  }

  /**
   * Get array of numbers from DICOM element
   */
  private static getNumberArray(dataSet: any, tag: string, expectedLength?: number): number[] | undefined {
    const element = dataSet.elements[tag];
    if (!element) return undefined;
    
    const value = dataSet.string(tag);
    if (!value) return undefined;
    
    const numbers = value.split('\\').map((v: string) => parseFloat(v));
    
    if (expectedLength && numbers.length !== expectedLength) {
      return undefined;
    }
    
    return numbers;
  }
}
