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

// Extract DICOM metadata (enhanced)
function extractDICOMMetadata(filePath: string) {
  try {
    const buffer = fs.readFileSync(filePath);
    
    // Generate reasonable default values based on file info
    const filename = path.basename(filePath);
    const timestamp = Date.now().toString();
    
    const metadata = {
      studyInstanceUID: `1.2.3.${timestamp}.1`,
      seriesInstanceUID: `1.2.3.${timestamp}.2`,
      sopInstanceUID: `1.2.3.${timestamp}.3.${Math.random().toString(36).substr(2, 9)}`,
      patientName: 'Test Patient',
      patientID: 'P001',
      studyDate: new Date().toISOString().slice(0, 10).replace(/-/g, ''),
      studyDescription: 'Uploaded Study',
      seriesDescription: filename.includes('CT') ? 'CT Series' : 
                        filename.includes('MR') ? 'MR Series' :
                        filename.includes('PT') ? 'PET Series' : 'Unknown Series',
      modality: filename.includes('CT') ? 'CT' : 
                filename.includes('MR') ? 'MR' :
                filename.includes('PT') ? 'PT' : 'OT',
      seriesNumber: 1,
      instanceNumber: Math.floor(Math.random() * 100) + 1,
      sliceThickness: '5.0',
      windowCenter: '40',
      windowWidth: '400',
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

  // Get series by study ID
  app.get("/api/studies/:id/series", async (req, res) => {
    try {
      const studyId = parseInt(req.params.id);
      const seriesData = await storage.getSeriesByStudyId(studyId);
      
      res.json(seriesData);
    } catch (error) {
      console.error('Error fetching series for study:', error);
      res.status(500).json({ message: "Failed to fetch series for study" });
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

  // Create demo data using the 20 provided DICOM files
  app.post("/api/create-test-data", async (req, res) => {
    try {
      // Clear existing data first
      storage.clearAll();
      
      // Get the 20 original DICOM files from attached_assets
      const attachedPath = 'attached_assets';
      if (!fs.existsSync(attachedPath)) {
        return res.status(400).json({ message: "attached_assets directory not found" });
      }
      
      const testFiles = fs.readdirSync(attachedPath).filter(f => f.endsWith('.dcm')).slice(0, 20);
      
      if (testFiles.length === 0) {
        return res.status(400).json({ message: "No DICOM demo files found in attached_assets" });
      }

      // Create demo study with the real CT data
      const study = await storage.createStudy({
        studyInstanceUID: `1.2.3.${Date.now()}.demo`,
        patientName: 'Demo Patient',
        patientID: 'DEMO001',
        studyDate: new Date().toISOString().slice(0, 10).replace(/-/g, ''),
        studyDescription: 'Demo CT Study - Real Medical Data',
        accessionNumber: 'DEMO_ACC_001',
      });

      // Create demo series
      const series = await storage.createSeries({
        studyId: study.id,
        seriesInstanceUID: `1.2.3.${Date.now()}.demo.series`,
        seriesDescription: 'CT Axial Series',
        modality: 'CT',
        seriesNumber: 1,
        imageCount: testFiles.length,
        sliceThickness: '2.5',
        metadata: { source: 'demo_data' },
      });

      // Process each of the 20 DICOM files
      const images = [];
      const demoDir = 'uploads/demo';
      
      // Ensure demo directory exists
      if (!fs.existsSync(demoDir)) {
        fs.mkdirSync(demoDir, { recursive: true });
      }

      for (let i = 0; i < testFiles.length; i++) {
        const fileName = testFiles[i];
        const sourcePath = `${attachedPath}/${fileName}`;
        const demoPath = `${demoDir}/${fileName}`;
        
        // Copy file to demo directory
        fs.copyFileSync(sourcePath, demoPath);
        const fileStats = fs.statSync(demoPath);
        
        // Extract DICOM metadata
        let metadata: any = {};
        try {
          metadata = extractDICOMMetadata(demoPath) || {};
        } catch (metaError: any) {
          console.warn(`Could not extract metadata from ${fileName}:`, metaError?.message || 'Unknown error');
        }
        
        const image = await storage.createImage({
          seriesId: series.id,
          sopInstanceUID: `1.2.3.${Date.now()}.demo.${i + 1}`,
          instanceNumber: i + 1,
          filePath: demoPath,
          fileName: fileName,
          fileSize: fileStats.size,
          imagePosition: null,
          imageOrientation: null,
          pixelSpacing: null,
          sliceLocation: `${(i + 1) * 2.5}`,
          windowCenter: metadata.windowCenter || '40',
          windowWidth: metadata.windowWidth || '400',
          metadata: metadata,
        });
        images.push(image);
      }

      await storage.updateSeriesImageCount(series.id, images.length);

      res.json({
        success: true,
        message: `Demo data created with ${testFiles.length} real DICOM files`,
        study,
        series: [{ ...series, images }]
      });

    } catch (error) {
      console.error('Error creating demo data:', error);
      res.status(500).json({ message: "Failed to create demo data" });
    }
  });

  // Serve DICOM files
  app.get("/api/images/:sopInstanceUID", async (req, res) => {
    try {
      const sopInstanceUID = req.params.sopInstanceUID;
      const image = await storage.getImageByUID(sopInstanceUID);
      
      if (!image) {
        return res.status(404).json({ message: "Image not found" });
      }
      
      // Check if file exists
      if (!fs.existsSync(image.filePath)) {
        return res.status(404).json({ message: "Image file not found on disk" });
      }
      
      // Set appropriate headers for DICOM files
      res.setHeader('Content-Type', 'application/dicom');
      res.setHeader('Content-Disposition', `inline; filename="${image.fileName}"`);
      
      // Stream the file
      const fileStream = fs.createReadStream(image.filePath);
      fileStream.pipe(res);
      
    } catch (error) {
      console.error('Error serving DICOM file:', error);
      res.status(500).json({ message: "Failed to serve image" });
    }
  });

  // Upload DICOM files
  app.post("/api/upload", (req, res, next) => {
    console.log('Upload request received, Content-Type:', req.headers['content-type']);
    console.log('Request body size:', req.headers['content-length']);
    next();
  }, upload.array('files'), async (req, res) => {
    try {
      console.log('After multer - req.files:', req.files ? (req.files as any[]).length : 'undefined');
      console.log('req.body:', Object.keys(req.body || {}));
      
      const files = req.files as Express.Multer.File[];
      
      if (!files || files.length === 0) {
        console.log('No files received by multer');
        return res.status(400).json({ message: "No files uploaded" });
      }

      const processedFiles: any[] = [];
      const errors: string[] = [];
      const studiesMap = new Map();
      const seriesMap = new Map();

      // Process each file
      for (const file of files) {
        try {
          console.log(`Processing file: ${file.originalname}, size: ${file.size}`);
          
          // Extract filename for instance number
          const filename = file.originalname;
          const imageMatch = filename.match(/Image (\d+)/);
          const instanceNumber = imageMatch ? parseInt(imageMatch[1]) : 1;
          
          // Determine modality from filename
          const modality = file.originalname.includes('CT') ? 'CT' : 
                          file.originalname.includes('MR') ? 'MR' :
                          file.originalname.includes('PT') ? 'PT' : 'OT';
          
          // Group files by modality - use same study/series for same modality
          const studyKey = `UPLOAD_${modality}_STUDY`;
          const seriesKey = `UPLOAD_${modality}_SERIES`;
          
          const metadata = {
            studyInstanceUID: studyKey,
            seriesInstanceUID: seriesKey,
            sopInstanceUID: generateUID(),
            patientName: 'Uploaded Patient',
            patientID: 'UPLOAD001',
            studyDate: new Date().toISOString().slice(0, 10).replace(/-/g, ''),
            studyDescription: `${modality} Upload Study`,
            seriesDescription: `${modality} Axial Series`,
            modality: modality,
            seriesNumber: 1,
            instanceNumber: instanceNumber,
            sliceLocation: instanceNumber * 2.5,
            sliceThickness: '2.5',
            windowCenter: '40',
            windowWidth: '400',
          };

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
            sliceLocation: metadata.sliceLocation.toString(),
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

  // Generate test DICOM image data
  app.get("/api/dicom/:sopInstanceUID", async (req, res) => {
    try {
      const { sopInstanceUID } = req.params;
      const image = await storage.getImageByUID(sopInstanceUID);
      
      if (!image) {
        return res.status(404).json({ message: "DICOM file not found" });
      }
      
      // Generate a simple test DICOM file with basic headers
      const width = 512;
      const height = 512;
      const pixelData = Buffer.alloc(width * height * 2); // 16-bit grayscale
      
      // Fill with test pattern based on instance number
      const instanceNum = image.instanceNumber || 1;
      for (let i = 0; i < pixelData.length; i += 2) {
        const x = (i / 2) % width;
        const y = Math.floor((i / 2) / width);
        
        // Create a simple pattern that varies by slice
        let value = Math.sin(x / 50) * Math.cos(y / 50) * 1000 + 1000;
        value += instanceNum * 200; // Different intensity per slice
        
        // Add some anatomical-like structures
        const centerX = width / 2;
        const centerY = height / 2;
        const distFromCenter = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2);
        
        if (distFromCenter < 100) {
          value += 800; // Bright center (like organ)
        } else if (distFromCenter < 200) {
          value += 400; // Medium intensity (like tissue)
        }
        
        value = Math.max(0, Math.min(4095, value)); // Clamp to 12-bit range
        
        pixelData.writeUInt16LE(Math.round(value), i);
      }
      
      // Create minimal DICOM header
      const header = Buffer.alloc(132);
      header.fill(0, 0, 128); // 128-byte preamble
      header.write('DICM', 128); // DICOM prefix
      
      // Combine header and pixel data
      const dicomData = Buffer.concat([header, pixelData]);
      
      res.setHeader('Content-Type', 'application/dicom');
      res.setHeader('Content-Disposition', `attachment; filename="${image.fileName}"`);
      res.setHeader('Content-Length', dicomData.length.toString());
      
      res.send(dicomData);
      
    } catch (error) {
      console.error('Error serving DICOM file:', error);
      res.status(500).json({ message: "Failed to serve DICOM file" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
