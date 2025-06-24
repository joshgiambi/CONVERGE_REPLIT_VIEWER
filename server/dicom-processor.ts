import * as dicomParser from 'dicom-parser';
import { db } from './db';
import { patients, studies, series, images } from '@shared/schema';
import { eq } from 'drizzle-orm';
import fs from 'fs';
import path from 'path';

export interface ProcessedDICOM {
  patientData: {
    patientID: string;
    patientName?: string;
    patientSex?: string;
    patientAge?: string;
    dateOfBirth?: string;
  };
  studyData: {
    studyInstanceUID: string;
    studyDate?: string;
    studyTime?: string;
    studyDescription?: string;
    accessionNumber?: string;
  };
  seriesData: {
    seriesInstanceUID: string;
    seriesDescription?: string;
    modality: string;
    seriesNumber?: number;
    bodyPartExamined?: string;
    protocolName?: string;
    sliceThickness?: number;
    pixelSpacing?: string;
    imageOrientation?: string;
  };
  imageData: {
    sopInstanceUID: string;
    sopClassUID?: string;
    instanceNumber?: number;
    sliceLocation?: number;
    imagePosition?: string;
    windowCenter?: number;
    windowWidth?: number;
    rescaleSlope?: number;
    rescaleIntercept?: number;
    rows?: number;
    columns?: number;
    bitsAllocated?: number;
    bitsStored?: number;
    acquisitionDate?: string;
    acquisitionTime?: string;
  };
}

export class DICOMProcessor {
  
  static processDICOMFile(filePath: string): ProcessedDICOM {
    if (!fs.existsSync(filePath)) {
      throw new Error(`DICOM file not found: ${filePath}`);
    }

    const buffer = fs.readFileSync(filePath);
    const byteArray = new Uint8Array(buffer);
    
    if (!this.isDICOMFile(buffer)) {
      throw new Error('Invalid DICOM file format');
    }

    const dataSet = dicomParser.parseDicom ? dicomParser.parseDicom(byteArray) : (dicomParser as any).default.parseDicom(byteArray);

    return {
      patientData: {
        patientID: this.getString(dataSet, 'x00100020') || 'UNKNOWN',
        patientName: this.getPatientName(dataSet, 'x00100010'),
        patientSex: this.getString(dataSet, 'x00100040'),
        patientAge: this.getString(dataSet, 'x00101010'),
        dateOfBirth: this.getString(dataSet, 'x00100030'),
      },
      studyData: {
        studyInstanceUID: this.getString(dataSet, 'x0020000d') || this.generateUID(),
        studyDate: this.getString(dataSet, 'x00080020'),
        studyTime: this.getString(dataSet, 'x00080030'),
        studyDescription: this.getString(dataSet, 'x00081030'),
        accessionNumber: this.getString(dataSet, 'x00080050'),
      },
      seriesData: {
        seriesInstanceUID: this.getString(dataSet, 'x0020000e') || this.generateUID(),
        seriesDescription: this.getString(dataSet, 'x0008103e'),
        modality: this.getString(dataSet, 'x00080060') || 'OT',
        seriesNumber: this.getNumber(dataSet, 'x00200011'),
        bodyPartExamined: this.getString(dataSet, 'x00180015'),
        protocolName: this.getString(dataSet, 'x00181030'),
        sliceThickness: this.getNumber(dataSet, 'x00180050'),
        pixelSpacing: this.getNumberArray(dataSet, 'x00280030', 2)?.join('\\'),
        imageOrientation: this.getNumberArray(dataSet, 'x00200037', 6)?.join('\\'),
      },
      imageData: {
        sopInstanceUID: this.getString(dataSet, 'x00080018') || this.generateUID(),
        sopClassUID: this.getString(dataSet, 'x00080016'),
        instanceNumber: this.getNumber(dataSet, 'x00200013'),
        sliceLocation: this.getNumber(dataSet, 'x00201041'),
        imagePosition: this.getNumberArray(dataSet, 'x00200032', 3)?.join('\\'),
        windowCenter: this.getNumber(dataSet, 'x00281050'),
        windowWidth: this.getNumber(dataSet, 'x00281051'),
        rescaleSlope: this.getNumber(dataSet, 'x00281053') || 1,
        rescaleIntercept: this.getNumber(dataSet, 'x00281052') || 0,
        rows: this.getNumber(dataSet, 'x00280010'),
        columns: this.getNumber(dataSet, 'x00280011'),
        bitsAllocated: this.getNumber(dataSet, 'x00280100'),
        bitsStored: this.getNumber(dataSet, 'x00280101'),
        acquisitionDate: this.getString(dataSet, 'x00080022'),
        acquisitionTime: this.getString(dataSet, 'x00080032'),
      }
    };
  }

  static async storeDICOMInDatabase(
    processedData: ProcessedDICOM, 
    filePath: string, 
    fileName: string, 
    fileSize: number
  ): Promise<number> {
    
    // Find or create patient
    let patient = await db.query.patients.findFirst({
      where: eq(patients.patientID, processedData.patientData.patientID)
    });

    if (!patient) {
      [patient] = await db.insert(patients)
        .values({
          patientID: processedData.patientData.patientID,
          patientName: processedData.patientData.patientName,
          patientSex: processedData.patientData.patientSex,
          patientAge: processedData.patientData.patientAge,
          dateOfBirth: processedData.patientData.dateOfBirth,
        })
        .returning();
    }

    // Find or create study
    let study = await db.query.studies.findFirst({
      where: eq(studies.studyInstanceUID, processedData.studyData.studyInstanceUID)
    });

    if (!study) {
      [study] = await db.insert(studies)
        .values({
          studyInstanceUID: processedData.studyData.studyInstanceUID,
          patientId: patient.id,
          patientName: processedData.patientData.patientName,
          patientIdDicom: processedData.patientData.patientID,
          studyDate: processedData.studyData.studyDate,
          studyDescription: processedData.studyData.studyDescription,
          accessionNumber: processedData.studyData.accessionNumber,
          modality: processedData.seriesData.modality,
          numberOfSeries: 0,
          numberOfImages: 0,
        })
        .returning();
    }

    // Find or create series
    let seriesRecord = await db.query.series.findFirst({
      where: eq(series.seriesInstanceUID, processedData.seriesData.seriesInstanceUID)
    });

    if (!seriesRecord) {
      [seriesRecord] = await db.insert(series)
        .values({
          studyId: study.id,
          seriesInstanceUID: processedData.seriesData.seriesInstanceUID,
          seriesDescription: processedData.seriesData.seriesDescription,
          modality: processedData.seriesData.modality,
          seriesNumber: processedData.seriesData.seriesNumber,
          imageCount: 0,
          sliceThickness: processedData.seriesData.sliceThickness?.toString(),
          metadata: {
            bodyPartExamined: processedData.seriesData.bodyPartExamined,
            protocolName: processedData.seriesData.protocolName,
            pixelSpacing: processedData.seriesData.pixelSpacing,
            imageOrientation: processedData.seriesData.imageOrientation,
          }
        })
        .returning();
    }

    // Insert image
    const [image] = await db.insert(images)
      .values({
        seriesId: seriesRecord.id,
        sopInstanceUID: processedData.imageData.sopInstanceUID,
        instanceNumber: processedData.imageData.instanceNumber,
        filePath,
        fileName,
        fileSize,
        imagePosition: processedData.imageData.imagePosition ? 
          processedData.imageData.imagePosition.split('\\').map(Number) : null,
        imageOrientation: processedData.seriesData.imageOrientation ? 
          processedData.seriesData.imageOrientation.split('\\').map(Number) : null,
        pixelSpacing: processedData.seriesData.pixelSpacing ? 
          processedData.seriesData.pixelSpacing.split('\\').map(Number) : null,
        sliceLocation: processedData.imageData.sliceLocation?.toString(),
        windowCenter: processedData.imageData.windowCenter?.toString(),
        windowWidth: processedData.imageData.windowWidth?.toString(),
        metadata: {
          sopClassUID: processedData.imageData.sopClassUID,
          rescaleSlope: processedData.imageData.rescaleSlope,
          rescaleIntercept: processedData.imageData.rescaleIntercept,
          rows: processedData.imageData.rows,
          columns: processedData.imageData.columns,
          bitsAllocated: processedData.imageData.bitsAllocated,
          bitsStored: processedData.imageData.bitsStored,
          acquisitionDate: processedData.imageData.acquisitionDate,
          acquisitionTime: processedData.imageData.acquisitionTime,
        }
      })
      .returning();

    // Update counts
    await this.updateCounts(study.id, seriesRecord.id);

    return image.id;
  }

  static async processDICOMDirectory(directoryPath: string): Promise<{
    processed: number;
    errors: string[];
  }> {
    const results = { processed: 0, errors: [] };
    
    const files = this.getAllDICOMFiles(directoryPath);
    
    for (const filePath of files) {
      try {
        const fileName = path.basename(filePath);
        const stats = fs.statSync(filePath);
        
        const processedData = this.processDICOMFile(filePath);
        await this.storeDICOMInDatabase(processedData, filePath, fileName, stats.size);
        
        results.processed++;
      } catch (error) {
        results.errors.push(`${filePath}: ${error.message}`);
      }
    }
    
    return results;
  }

  private static isDICOMFile(buffer: Buffer): boolean {
    if (buffer.length < 132) return false;
    return buffer.toString('ascii', 128, 132) === 'DICM';
  }

  private static getAllDICOMFiles(dirPath: string): string[] {
    const files: string[] = [];
    
    const walkDir = (currentPath: string) => {
      try {
        const items = fs.readdirSync(currentPath);
        
        for (const item of items) {
          if (item.startsWith('.') || item.startsWith('__MACOSX')) continue;
          
          const fullPath = path.join(currentPath, item);
          const stat = fs.statSync(fullPath);
          
          if (stat.isDirectory()) {
            walkDir(fullPath);
          } else if (item.toLowerCase().endsWith('.dcm') || 
                     item.toLowerCase().includes('dicom')) {
            try {
              const buffer = fs.readFileSync(fullPath, { start: 0, end: 200 });
              if (this.isDICOMFile(buffer)) {
                files.push(fullPath);
              }
            } catch (e) {
              // Skip files that can't be read
            }
          }
        }
      } catch (e) {
        console.warn(`Cannot read directory: ${currentPath}`);
      }
    };
    
    walkDir(dirPath);
    return files;
  }

  private static getString(dataSet: any, tag: string): string | undefined {
    const element = dataSet.elements[tag];
    if (!element) return undefined;
    return dataSet.string(tag)?.trim();
  }

  private static getPatientName(dataSet: any, tag: string): string | undefined {
    const name = this.getString(dataSet, tag);
    if (!name) return undefined;
    return name.replace(/\^/g, ' ').trim();
  }

  private static getNumber(dataSet: any, tag: string): number | undefined {
    const element = dataSet.elements[tag];
    if (!element) return undefined;
    const value = dataSet.floatString(tag);
    return value !== undefined ? parseFloat(value) : undefined;
  }

  private static getNumberArray(dataSet: any, tag: string, expectedLength?: number): number[] | undefined {
    const element = dataSet.elements[tag];
    if (!element) return undefined;
    
    const value = dataSet.string(tag);
    if (!value) return undefined;
    
    const numbers = value.split('\\').map(s => parseFloat(s.trim())).filter(n => !isNaN(n));
    
    if (expectedLength && numbers.length !== expectedLength) {
      return undefined;
    }
    
    return numbers.length > 0 ? numbers : undefined;
  }

  private static generateUID(): string {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 1000000);
    return `2.25.${timestamp}${random}`;
  }

  private static async updateCounts(studyId: number, seriesId: number): Promise<void> {
    // Update series image count
    const seriesCount = await db.query.images.findMany({
      where: eq(images.seriesId, seriesId)
    });
    
    await db.update(series)
      .set({ imageCount: seriesCount.length })
      .where(eq(series.id, seriesId));

    // Update study counts
    const studySeries = await db.query.series.findMany({
      where: eq(series.studyId, studyId)
    });
    
    const totalImages = studySeries.reduce((sum, s) => sum + (s.imageCount || 0), 0);
    
    await db.update(studies)
      .set({ 
        numberOfSeries: studySeries.length,
        numberOfImages: totalImages 
      })
      .where(eq(studies.id, studyId));
  }
}