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
   * Create or update a friendly alias folder for a patient name that points to the canonical
   * DICOM Patient ID folder. This avoids breaking existing file paths while enabling lookups
   * by patient name (e.g., HN_PETFUSE → sZFwgkMvBgdKDWqF8A92wuD3q).
   */
  ensureNameAlias(patientId: string, patientName?: string): void {
    try {
      if (!patientName) return;
      const canonical = this.getPatientPath(patientId);
      if (!fs.existsSync(canonical)) return; // nothing to alias yet

      const aliasName = this.sanitizeId(patientName);
      if (!aliasName || aliasName === this.sanitizeId(patientId)) return; // same as id

      const aliasPath = path.join(this.baseStoragePath, aliasName);

      // If alias exists and points to a wrong location, remove it
      if (fs.existsSync(aliasPath)) {
        try {
          const stat = fs.lstatSync(aliasPath);
          if (stat.isSymbolicLink()) {
            const target = fs.readlinkSync(aliasPath);
            if (path.resolve(path.dirname(aliasPath), target) !== path.resolve(canonical)) {
              fs.unlinkSync(aliasPath);
            } else {
              return; // correct alias already exists
            }
          } else {
            // If it's a real directory/file with same name, skip to avoid data loss
            return;
          }
        } catch {}
      }

      // Create alias symlink pointing to canonical folder
      try {
        const relativeTarget = path.relative(path.dirname(aliasPath), canonical) || canonical;
        fs.symlinkSync(relativeTarget, aliasPath, 'dir');
        console.log(`Created patient alias: ${aliasName} -> ${canonical}`);
      } catch (err) {
        console.warn(`Failed to create alias for patient ${patientId} (${aliasName}):`, err);
      }
    } catch {}
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

    // Build a map of all DICOM files in the upload directory
    const availableFiles = this.findAllDicomFiles(uploadPath);
    console.log(`Found ${availableFiles.size} DICOM files in upload directory`);

    let successCount = 0;
    let failedCount = 0;

    for (const data of parsedData) {
      try {
        const {
          patientID,
          studyInstanceUID,
          seriesInstanceUID,
          sopInstanceUID,
          fileName,
          filePath
        } = data;

        if (!patientID || !studyInstanceUID || !seriesInstanceUID || !sopInstanceUID) {
          console.warn(`Skipping file with missing metadata: ${fileName}`);
          failedCount++;
          continue;
        }

        // Try to find the file using multiple strategies
        let sourceFile: string | undefined;
        
        // Strategy 1: Use filePath if available (from parsing)
        if (filePath && fs.existsSync(filePath)) {
          sourceFile = filePath;
        }
        // Strategy 2: Try direct path
        else if (fs.existsSync(path.join(uploadPath, fileName))) {
          sourceFile = path.join(uploadPath, fileName);
        }
        // Strategy 3: Search in available files map by filename
        else {
          for (const [fullPath, name] of availableFiles.entries()) {
            if (name === fileName || name.endsWith(fileName) || fullPath.endsWith(fileName)) {
              sourceFile = fullPath;
              break;
            }
          }
        }

        if (!sourceFile || !fs.existsSync(sourceFile)) {
          console.error(`ERROR: Source file not found for ${fileName} (SOP: ${sopInstanceUID})`);
          console.error(`  Tried paths: ${filePath}, ${path.join(uploadPath, fileName)}`);
          failedCount++;
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
        successCount++;

      } catch (error) {
        console.error(`Error moving file ${data.fileName}:`, error);
        failedCount++;
      }
    }

    console.log(`Successfully moved ${successCount} files to permanent storage`);
    if (failedCount > 0) {
      console.error(`CRITICAL: Failed to move ${failedCount} files - DO NOT DELETE UPLOAD DIRECTORY`);
      // Throw error to prevent cleanup if files failed to move
      throw new Error(`Failed to move ${failedCount} files to permanent storage. Upload directory preserved.`);
    }
    
    return filePathMap;
  }

  /**
   * Find all DICOM files recursively in a directory
   */
  private findAllDicomFiles(dirPath: string): Map<string, string> {
    const fileMap = new Map<string, string>();
    
    const findFiles = (dir: string) => {
      try {
        const items = fs.readdirSync(dir);
        
        for (const item of items) {
          const itemPath = path.join(dir, item);
          const stat = fs.statSync(itemPath);
          
          if (stat.isDirectory()) {
            findFiles(itemPath);
          } else if (item.toLowerCase().endsWith('.dcm') || !path.extname(item)) {
            fileMap.set(itemPath, item);
          }
        }
      } catch (error) {
        console.error(`Error reading directory ${dir}:`, error);
      }
    };
    
    findFiles(dirPath);
    return fileMap;
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