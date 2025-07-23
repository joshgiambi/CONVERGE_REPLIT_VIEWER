import fs from 'fs';
import path from 'path';

/**
 * Patient Storage Management System
 * Organizes DICOM files in a structured hierarchy:
 * storage/patients/{patientId}/{studyInstanceUID}/{seriesInstanceUID}/{sopInstanceUID}.dcm
 */

export class PatientStorage {
  private readonly baseStoragePath: string;

  constructor(baseStoragePath: string = 'storage/patients') {
    this.baseStoragePath = baseStoragePath;
    this.ensureBaseDirectory();
  }

  private ensureBaseDirectory(): void {
    if (!fs.existsSync(this.baseStoragePath)) {
      fs.mkdirSync(this.baseStoragePath, { recursive: true });
    }
  }

  /**
   * Get the storage path for a patient
   */
  getPatientPath(patientId: string): string {
    return path.join(this.baseStoragePath, this.sanitizeId(patientId));
  }

  /**
   * Get the storage path for a study
   */
  getStudyPath(patientId: string, studyInstanceUID: string): string {
    return path.join(this.getPatientPath(patientId), this.sanitizeId(studyInstanceUID));
  }

  /**
   * Get the storage path for a series
   */
  getSeriesPath(patientId: string, studyInstanceUID: string, seriesInstanceUID: string): string {
    return path.join(this.getStudyPath(patientId, studyInstanceUID), this.sanitizeId(seriesInstanceUID));
  }

  /**
   * Get the full file path for a DICOM image
   */
  getImagePath(
    patientId: string, 
    studyInstanceUID: string, 
    seriesInstanceUID: string, 
    sopInstanceUID: string
  ): string {
    const seriesPath = this.getSeriesPath(patientId, studyInstanceUID, seriesInstanceUID);
    return path.join(seriesPath, `${this.sanitizeId(sopInstanceUID)}.dcm`);
  }

  /**
   * Store a DICOM file in the patient storage hierarchy
   */
  async storeImageFile(
    sourceFilePath: string,
    patientId: string,
    studyInstanceUID: string,
    seriesInstanceUID: string,
    sopInstanceUID: string
  ): Promise<string> {
    const targetPath = this.getImagePath(patientId, studyInstanceUID, seriesInstanceUID, sopInstanceUID);
    const targetDir = path.dirname(targetPath);

    // Ensure target directory exists
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    // Copy file to permanent location
    fs.copyFileSync(sourceFilePath, targetPath);
    
    console.log(`Stored DICOM file: ${sopInstanceUID} -> ${targetPath}`);
    return targetPath;
  }

  /**
   * Move entire parsed dataset from temporary upload to permanent storage
   */
  async moveDatasetToPermanentStorage(
    uploadSessionId: string,
    parsedData: any[]
  ): Promise<{ [sopInstanceUID: string]: string }> {
    const filePathMap: { [sopInstanceUID: string]: string } = {};
    const uploadPath = path.join('uploads', uploadSessionId);

    console.log(`Moving dataset from ${uploadPath} to permanent patient storage...`);

    for (const data of parsedData) {
      try {
        const {
          patientID,
          studyInstanceUID,
          seriesInstanceUID,
          sopInstanceUID,
          fileName
        } = data;

        if (!patientID || !studyInstanceUID || !seriesInstanceUID || !sopInstanceUID) {
          console.warn(`Skipping file with missing metadata: ${fileName}`);
          continue;
        }

        const sourceFile = path.join(uploadPath, fileName);
        
        if (!fs.existsSync(sourceFile)) {
          console.warn(`Source file not found: ${sourceFile}`);
          continue;
        }

        const permanentPath = await this.storeImageFile(
          sourceFile,
          patientID,
          studyInstanceUID,
          seriesInstanceUID,
          sopInstanceUID
        );

        filePathMap[sopInstanceUID] = permanentPath;

      } catch (error) {
        console.error(`Error moving file ${data.fileName}:`, error);
      }
    }

    console.log(`Moved ${Object.keys(filePathMap).length} files to permanent storage`);
    return filePathMap;
  }

  /**
   * Check if a patient's data exists in storage
   */
  patientExists(patientId: string): boolean {
    return fs.existsSync(this.getPatientPath(patientId));
  }

  /**
   * Get storage statistics for a patient
   */
  getPatientStorageInfo(patientId: string): {
    exists: boolean;
    studyCount: number;
    totalFiles: number;
    totalSize: number;
  } {
    const patientPath = this.getPatientPath(patientId);
    
    if (!fs.existsSync(patientPath)) {
      return { exists: false, studyCount: 0, totalFiles: 0, totalSize: 0 };
    }

    let totalFiles = 0;
    let totalSize = 0;
    const studies = fs.readdirSync(patientPath);

    for (const study of studies) {
      const studyPath = path.join(patientPath, study);
      if (fs.statSync(studyPath).isDirectory()) {
        totalFiles += this.countFilesRecursive(studyPath);
        totalSize += this.getSizeRecursive(studyPath);
      }
    }

    return {
      exists: true,
      studyCount: studies.length,
      totalFiles,
      totalSize
    };
  }

  /**
   * Clean up temporary upload directory after successful storage
   */
  cleanupUploadDirectory(uploadSessionId: string): void {
    const uploadPath = path.join('uploads', uploadSessionId);
    
    if (fs.existsSync(uploadPath)) {
      try {
        fs.rmSync(uploadPath, { recursive: true, force: true });
        console.log(`Cleaned up temporary upload directory: ${uploadPath}`);
      } catch (error) {
        console.error(`Error cleaning up upload directory ${uploadPath}:`, error);
      }
    }
  }

  private sanitizeId(id: string): string {
    // Replace invalid filename characters
    return id.replace(/[<>:"/\\|?*]/g, '_');
  }

  private countFilesRecursive(dirPath: string): number {
    let count = 0;
    const items = fs.readdirSync(dirPath);
    
    for (const item of items) {
      const itemPath = path.join(dirPath, item);
      const stat = fs.statSync(itemPath);
      
      if (stat.isDirectory()) {
        count += this.countFilesRecursive(itemPath);
      } else {
        count++;
      }
    }
    
    return count;
  }

  private getSizeRecursive(dirPath: string): number {
    let size = 0;
    const items = fs.readdirSync(dirPath);
    
    for (const item of items) {
      const itemPath = path.join(dirPath, item);
      const stat = fs.statSync(itemPath);
      
      if (stat.isDirectory()) {
        size += this.getSizeRecursive(itemPath);
      } else {
        size += stat.size;
      }
    }
    
    return size;
  }
}

export const patientStorage = new PatientStorage();