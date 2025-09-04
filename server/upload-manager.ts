import * as fs from 'fs';
import * as path from 'path';
import { nanoid } from 'nanoid';

export class UploadManager {
  private uploadDir: string;
  private tempDir: string;
  private maxTempAge: number = 24 * 60 * 60 * 1000; // 24 hours

  constructor() {
    this.uploadDir = path.join(process.cwd(), 'uploads');
    this.tempDir = path.join(this.uploadDir, 'temp');
    this.ensureDirectories();
  }

  private ensureDirectories() {
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  // Create a session for batch upload
  createUploadSession(): string {
    const sessionId = nanoid();
    const sessionDir = path.join(this.tempDir, sessionId);
    fs.mkdirSync(sessionDir, { recursive: true });
    return sessionId;
  }

  // Get session directory
  getSessionDir(sessionId: string): string {
    return path.join(this.tempDir, sessionId);
  }

  // Move file to permanent storage
  async moveToStorage(tempPath: string, patientId: string, studyId: string, seriesId: string, filename: string): Promise<string> {
    const permanentDir = path.join(
      this.uploadDir,
      'dicom',
      patientId,
      studyId,
      seriesId
    );
    
    if (!fs.existsSync(permanentDir)) {
      fs.mkdirSync(permanentDir, { recursive: true });
    }

    const permanentPath = path.join(permanentDir, filename);
    await fs.promises.rename(tempPath, permanentPath);
    
    return permanentPath;
  }

  // Clean up old temp files
  async cleanupTempFiles() {
    try {
      const tempDirs = await fs.promises.readdir(this.tempDir);
      const now = Date.now();

      for (const dir of tempDirs) {
        const dirPath = path.join(this.tempDir, dir);
        const stats = await fs.promises.stat(dirPath);
        
        if (now - stats.mtimeMs > this.maxTempAge) {
          await fs.promises.rm(dirPath, { recursive: true, force: true });
          console.log(`Cleaned up old temp directory: ${dir}`);
        }
      }
    } catch (error) {
      console.error('Error cleaning up temp files:', error);
    }
  }

  // Clean up a specific session
  async cleanupSession(sessionId: string) {
    const sessionDir = path.join(this.tempDir, sessionId);
    if (fs.existsSync(sessionDir)) {
      await fs.promises.rm(sessionDir, { recursive: true, force: true });
    }
  }

  // Get upload statistics
  async getUploadStats() {
    const tempDirs = await fs.promises.readdir(this.tempDir);
    const activeSessions = tempDirs.length;
    
    let totalTempFiles = 0;
    for (const dir of tempDirs) {
      const files = await fs.promises.readdir(path.join(this.tempDir, dir));
      totalTempFiles += files.length;
    }

    return {
      activeSessions,
      totalTempFiles,
      tempDirectory: this.tempDir,
      uploadDirectory: this.uploadDir
    };
  }
}

export const uploadManager = new UploadManager();