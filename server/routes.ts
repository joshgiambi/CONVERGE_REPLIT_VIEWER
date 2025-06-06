import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import multer from "multer";
import fs from "fs";
import path from "path";
import { insertStudySchema, insertSeriesSchema, insertImageSchema } from "@shared/schema";
import { z } from "zod";

// Configure multer for file uploads
const upload = multer({
  dest: 'uploads/',
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB per file
    files: 1000 // Max 1000 files
  },
  fileFilter: (req, file, cb) => {
    // Allow all files, we'll validate DICOM format server-side
    cb(null, true);
  }
});

// Simple DICOM validation function
function isDICOMFile(filePath: string): boolean {
  try {
    const buffer = fs.readFileSync(filePath);
    // Check for DICOM preamble (128 bytes) + "DICM" magic number
    if (buffer.length < 132) return false;
    
    const dicmMagic = buffer.slice(128, 132).toString('ascii');
    return dicmMagic === 'DICM';
  } catch (error) {
    return false;
  }
}

// Extract DICOM metadata (simplified)
function extractDICOMMetadata(filePath: string) {
  try {
    const buffer = fs.readFileSync(filePath);
    
    // This is a simplified DICOM parser
    // In production, use a proper DICOM library like dcmjs or dicom-parser
    const metadata = {
      studyInstanceUID: extractTag(buffer, '0020000D') || generateUID(),
      seriesInstanceUID: extractTag(buffer, '0020000E') || generateUID(),
      sopInstanceUID: extractTag(buffer, '00080018') || generateUID(),
      patientName: extractTag(buffer, '00100010') || 'Unknown Patient',
      patientID: extractTag(buffer, '00100020') || 'Unknown ID',
      studyDate: extractTag(buffer, '00080020') || '',
      studyDescription: extractTag(buffer, '00081030') || '',
      seriesDescription: extractTag(buffer, '0008103E') || '',
      modality: extractTag(buffer, '00080060') || 'OT',
      seriesNumber: parseInt(extractTag(buffer, '00200011') || '1'),
      instanceNumber: parseInt(extractTag(buffer, '00200013') || '1'),
      sliceThickness: extractTag(buffer, '00180050') || '',
      windowCenter: extractTag(buffer, '00281050') || '',
      windowWidth: extractTag(buffer, '00281051') || '',
    };
    
    return metadata;
  } catch (error) {
    console.error('Error extracting DICOM metadata:', error);
    return null;
  }
}

// Simplified DICOM tag extraction (this would need a proper DICOM parser in production)
function extractTag(buffer: Buffer, tag: string): string | null {
  // This is a placeholder implementation
  // In a real application, use dcmjs or dicom-parser
  return null;
}

function generateUID(): string {
  return '1.2.3.' + Date.now() + '.' + Math.random().toString(36).substr(2, 9);
}

export async function registerRoutes(app: Express): Promise<Server> {
  
  // Get all studies
  app.get("/api/studies", async (req, res) => {
    try {
      const studies = await storage.getAllStudies();
      res.json(studies);
    } catch (error) {
      console.error('Error fetching studies:', error);
      res.status(500).json({ message: "Failed to fetch studies" });
    }
  });

  // Get study by ID with series
  app.get("/api/studies/:id", async (req, res) => {
    try {
      const studyId = parseInt(req.params.id);
      const study = await storage.getStudy(studyId);
      
      if (!study) {
        return res.status(404).json({ message: "Study not found" });
      }
      
      const seriesList = await storage.getSeriesByStudyId(studyId);
      
      res.json({
        ...study,
        series: seriesList
      });
    } catch (error) {
      console.error('Error fetching study:', error);
      res.status(500).json({ message: "Failed to fetch study" });
    }
  });

  // Get series by ID with images
  app.get("/api/series/:id", async (req, res) => {
    try {
      const seriesId = parseInt(req.params.id);
      const seriesData = await storage.getSeries(seriesId);
      
      if (!seriesData) {
        return res.status(404).json({ message: "Series not found" });
      }
      
      const images = await storage.getImagesBySeriesId(seriesId);
      
      res.json({
        ...seriesData,
        images
      });
    } catch (error) {
      console.error('Error fetching series:', error);
      res.status(500).json({ message: "Failed to fetch series" });
    }
  });

  // Upload DICOM files
  app.post("/api/upload", upload.array('files'), async (req, res) => {
    try {
      const files = req.files as Express.Multer.File[];
      
      if (!files || files.length === 0) {
        return res.status(400).json({ message: "No files uploaded" });
      }

      const processedFiles: any[] = [];
      const errors: string[] = [];
      const studiesMap = new Map();
      const seriesMap = new Map();

      // Process each file
      for (const file of files) {
        try {
          // Validate DICOM format
          if (!isDICOMFile(file.path)) {
            errors.push(`${file.originalname}: Not a valid DICOM file`);
            fs.unlinkSync(file.path); // Clean up invalid file
            continue;
          }

          // Extract metadata
          const metadata = extractDICOMMetadata(file.path);
          if (!metadata) {
            errors.push(`${file.originalname}: Failed to parse DICOM metadata`);
            fs.unlinkSync(file.path);
            continue;
          }

          // Create or get study
          let study = studiesMap.get(metadata.studyInstanceUID);
          if (!study) {
            const existingStudy = await storage.getStudyByUID(metadata.studyInstanceUID);
            if (existingStudy) {
              study = existingStudy;
            } else {
              study = await storage.createStudy({
                studyInstanceUID: metadata.studyInstanceUID,
                patientName: metadata.patientName,
                patientID: metadata.patientID,
                studyDate: metadata.studyDate,
                studyDescription: metadata.studyDescription,
                accessionNumber: null,
              });
            }
            studiesMap.set(metadata.studyInstanceUID, study);
          }

          // Create or get series
          let series = seriesMap.get(metadata.seriesInstanceUID);
          if (!series) {
            const existingSeries = await storage.getSeriesByUID(metadata.seriesInstanceUID);
            if (existingSeries) {
              series = existingSeries;
            } else {
              series = await storage.createSeries({
                studyId: study.id,
                seriesInstanceUID: metadata.seriesInstanceUID,
                seriesDescription: metadata.seriesDescription,
                modality: metadata.modality,
                seriesNumber: metadata.seriesNumber,
                imageCount: 0,
                sliceThickness: metadata.sliceThickness,
                metadata: {},
              });
            }
            seriesMap.set(metadata.seriesInstanceUID, series);
          }

          // Create permanent file path
          const uploadsDir = path.join(process.cwd(), 'uploads', 'dicom');
          if (!fs.existsSync(uploadsDir)) {
            fs.mkdirSync(uploadsDir, { recursive: true });
          }
          
          const permanentPath = path.join(uploadsDir, `${metadata.sopInstanceUID}.dcm`);
          fs.renameSync(file.path, permanentPath);

          // Create image record
          const image = await storage.createImage({
            seriesId: series.id,
            sopInstanceUID: metadata.sopInstanceUID,
            instanceNumber: metadata.instanceNumber,
            filePath: permanentPath,
            fileName: file.originalname,
            fileSize: file.size,
            imagePosition: null,
            imageOrientation: null,
            pixelSpacing: null,
            sliceLocation: null,
            windowCenter: metadata.windowCenter,
            windowWidth: metadata.windowWidth,
            metadata: {},
          });

          processedFiles.push({
            originalName: file.originalname,
            sopInstanceUID: metadata.sopInstanceUID,
            seriesUID: metadata.seriesInstanceUID,
            studyUID: metadata.studyInstanceUID,
          });

        } catch (error) {
          console.error(`Error processing file ${file.originalname}:`, error);
          errors.push(`${file.originalname}: Processing error`);
          // Clean up file on error
          if (fs.existsSync(file.path)) {
            fs.unlinkSync(file.path);
          }
        }
      }

      // Update series image counts
      for (const series of Array.from(seriesMap.values())) {
        const images = await storage.getImagesBySeriesId(series.id);
        await storage.updateSeriesImageCount(series.id, images.length);
      }

      res.json({
        success: true,
        processed: processedFiles.length,
        errors: errors.length,
        errorDetails: errors,
        studies: Array.from(studiesMap.values()),
        series: Array.from(seriesMap.values()),
      });

    } catch (error) {
      console.error('Upload error:', error);
      res.status(500).json({ message: "Upload failed" });
    }
  });

  // Serve DICOM files
  app.get("/api/dicom/:sopInstanceUID", async (req, res) => {
    try {
      const { sopInstanceUID } = req.params;
      const image = await storage.getImageByUID(sopInstanceUID);
      
      if (!image || !fs.existsSync(image.filePath)) {
        return res.status(404).json({ message: "DICOM file not found" });
      }
      
      res.setHeader('Content-Type', 'application/dicom');
      res.setHeader('Content-Disposition', `attachment; filename="${image.fileName}"`);
      
      const fileStream = fs.createReadStream(image.filePath);
      fileStream.pipe(res);
      
    } catch (error) {
      console.error('Error serving DICOM file:', error);
      res.status(500).json({ message: "Failed to serve DICOM file" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
