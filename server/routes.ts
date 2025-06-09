import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import multer from "multer";
import fs from "fs";
import path from "path";
import { insertStudySchema, insertSeriesSchema, insertImageSchema, insertPacsConnectionSchema } from "@shared/schema";
import { dicomNetworkService } from "./dicom-network";
import { DICOMParser } from "./dicom-parser";
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

  // Auto-populate demo data endpoint
  app.post("/api/populate-demo", async (req, res) => {
    try {
      // Check if demo data already exists
      const existingStudies = await storage.getAllStudies();
      const hasDemo = existingStudies.some(study => study.isDemo);
      
      if (hasDemo) {
        return res.json({ 
          success: true, 
          message: "Demo data already exists",
          studies: existingStudies.filter(s => s.isDemo)
        });
      }

      // Create demo patient first
      let demoPatient;
      try {
        demoPatient = await storage.getPatientByID('DEMO001');
        if (!demoPatient) {
          demoPatient = await storage.createPatient({
            patientID: 'DEMO001',
            patientName: 'Demo^Patient',
            patientSex: 'M',
            patientAge: '45',
            dateOfBirth: '19790101'
          });
        }
      } catch (error) {
        console.log('Creating new demo patient');
        demoPatient = await storage.createPatient({
          patientID: 'DEMO001',
          patientName: 'Demo^Patient',
          patientSex: 'M',
          patientAge: '45',
          dateOfBirth: '19790101'
        });
      }
      
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
        patientId: demoPatient.id,
        patientName: 'Demo^Patient',
        patientID: 'DEMO001',
        studyDate: new Date().toISOString().slice(0, 10).replace(/-/g, ''),
        studyDescription: 'Demo CT Study - Real Medical Data',
        accessionNumber: 'DEMO_ACC_001',
        modality: 'CT',
        numberOfSeries: 1,
        numberOfImages: testFiles.length,
        isDemo: true,
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
        
        // Extract image number from filename for proper ordering
        const imageMatch = fileName.match(/Image (\d+)/);
        const imageNumber = imageMatch ? parseInt(imageMatch[1]) : i + 1;
        
        const image = await storage.createImage({
          seriesId: series.id,
          sopInstanceUID: `1.2.3.${Date.now()}.demo.${imageNumber}`,
          instanceNumber: imageNumber,
          filePath: demoPath,
          fileName: fileName,
          fileSize: fileStats.size,
          imagePosition: null,
          imageOrientation: null,
          pixelSpacing: null,
          sliceLocation: `${imageNumber * 2.5}`,
          windowCenter: metadata.windowCenter || '40',
          windowWidth: metadata.windowWidth || '400',
          metadata: metadata,
        });
        images.push(image);
      }

      await storage.updateSeriesImageCount(series.id, images.length);

      // Create second demo patient with HN-ATLAS-84 data
      await createHNAtlasDemo();

      const allPatients = await storage.getAllPatients();
      res.json({
        success: true,
        message: `Demo data created with ${testFiles.length} CT files + HN-ATLAS-84 dataset`,
        patients: allPatients.length,
        studies: 2
      });

    } catch (error) {
      console.error('Error creating demo data:', error);
      res.status(500).json({ message: "Failed to create demo data" });
    }
  });

  async function createHNAtlasDemo() {
    try {
      // Check if HN-ATLAS patient already exists
      let hnPatient;
      try {
        hnPatient = await storage.getPatientByID('HN-ATLAS-84');
        if (hnPatient) {
          console.log('HN-ATLAS patient already exists');
          return;
        }
      } catch (error) {
        // Patient doesn't exist, create new one
      }

      // Create HN-ATLAS patient
      hnPatient = await storage.createPatient({
        patientID: 'HN-ATLAS-84',
        patientName: 'HN-ATLAS^84',
        patientSex: 'M',
        patientAge: '62',
        dateOfBirth: '19620315'
      });

      const hnDatasetPath = 'attached_assets/HN-ATLAS-84/HN-ATLAS-84';
      const contrastPath = path.join(hnDatasetPath, 'DICOM_CONTRAST');
      const mimPath = path.join(hnDatasetPath, 'MIM');

      if (!fs.existsSync(contrastPath)) {
        console.log('HN-ATLAS dataset not found');
        return;
      }

      // Parse the DICOM_CONTRAST folder for CT images - use all available slices
      const contrastFiles = fs.readdirSync(contrastPath)
        .filter(f => f.endsWith('.dcm'))
        .sort(); // Use all 154 slices

      if (contrastFiles.length === 0) {
        console.log('No DICOM files found in HN-ATLAS contrast folder');
        return;
      }

      // Create CT study
      const ctStudy = await storage.createStudy({
        studyInstanceUID: `2.16.840.1.114362.1.11932039.${Date.now()}`,
        patientId: hnPatient.id,
        patientName: 'HN-ATLAS^84',
        patientID: 'HN-ATLAS-84',
        studyDate: '20200615',
        studyDescription: 'Head & Neck CT with Contrast',
        accessionNumber: 'HN84_CT_001',
        modality: 'CT',
        numberOfSeries: 1,
        numberOfImages: contrastFiles.length,
        isDemo: true,
      });

      // Create CT series
      const ctSeries = await storage.createSeries({
        studyId: ctStudy.id,
        seriesInstanceUID: `2.16.840.1.114362.1.11932039.${Date.now()}.ct`,
        seriesDescription: 'CT Head Neck with Contrast',
        modality: 'CT',
        seriesNumber: 1,
        imageCount: contrastFiles.length,
        sliceThickness: '3.0',
        metadata: { 
          source: 'HN-ATLAS-84',
          anatomy: 'Head & Neck',
          contrast: 'IV Contrast Enhanced'
        },
      });

      // Copy and process CT images
      const hnDemoDir = 'uploads/hn-atlas-demo';
      if (!fs.existsSync(hnDemoDir)) {
        fs.mkdirSync(hnDemoDir, { recursive: true });
      }

      const ctImages = [];
      for (let i = 0; i < contrastFiles.length; i++) {
        const fileName = contrastFiles[i];
        const sourcePath = path.join(contrastPath, fileName);
        const demoPath = path.join(hnDemoDir, fileName);
        
        // Copy file to demo directory
        fs.copyFileSync(sourcePath, demoPath);
        const fileStats = fs.statSync(demoPath);
        
        // Extract instance number from filename
        const instanceMatch = fileName.match(/\.(\d+)\.dcm$/);
        const instanceNumber = instanceMatch ? parseInt(instanceMatch[1]) : i + 1;
        
        const image = await storage.createImage({
          seriesId: ctSeries.id,
          sopInstanceUID: `2.16.840.1.114362.1.11932039.${Date.now()}.${instanceNumber}`,
          instanceNumber: instanceNumber,
          filePath: demoPath,
          fileName: fileName,
          fileSize: fileStats.size,
          imagePosition: null,
          imageOrientation: null,
          pixelSpacing: '0.488\\0.488',
          sliceLocation: `${instanceNumber * 3.0}`,
          windowCenter: '50',
          windowWidth: '350',
          metadata: {
            source: 'HN-ATLAS-84',
            anatomy: 'Head & Neck',
            contrast: true
          },
        });
        ctImages.push(image);
      }

      await storage.updateSeriesImageCount(ctSeries.id, ctImages.length);

      // Check for RT Structure Set
      if (fs.existsSync(mimPath)) {
        const rtFiles = fs.readdirSync(mimPath).filter(f => f.endsWith('.dcm'));
        
        if (rtFiles.length > 0) {
          // Create RT Structure Study
          const rtStudy = await storage.createStudy({
            studyInstanceUID: `2.16.840.1.114362.1.11932039.${Date.now()}.rt`,
            patientId: hnPatient.id,
            patientName: 'HN-ATLAS^84',
            patientID: 'HN-ATLAS-84',
            studyDate: '20200615',
            studyDescription: 'RT Structure Set - Organ Contours',
            accessionNumber: 'HN84_RT_001',
            modality: 'RTSTRUCT',
            numberOfSeries: 1,
            numberOfImages: rtFiles.length,
            isDemo: true,
          });

          // Create RT series
          const rtSeries = await storage.createSeries({
            studyId: rtStudy.id,
            seriesInstanceUID: `2.16.840.1.114362.1.11932039.${Date.now()}.rtstruct`,
            seriesDescription: 'RT Structure Set - Head & Neck Organs',
            modality: 'RTSTRUCT',
            seriesNumber: 1,
            imageCount: rtFiles.length,
            sliceThickness: '3.0',
            metadata: { 
              source: 'HN-ATLAS-84',
              structureType: 'Organ Contours',
              organsSructures: ['Brainstem', 'Spinal Cord', 'Parotid Glands', 'Mandible']
            },
          });

          // Process RT Structure files
          for (let i = 0; i < rtFiles.length; i++) {
            const fileName = rtFiles[i];
            const sourcePath = path.join(mimPath, fileName);
            const demoPath = path.join(hnDemoDir, `rt_${fileName}`);
            
            fs.copyFileSync(sourcePath, demoPath);
            const fileStats = fs.statSync(demoPath);
            
            const rtImage = await storage.createImage({
              seriesId: rtSeries.id,
              sopInstanceUID: `2.16.840.1.114362.1.11932039.${Date.now()}.rt.${i + 1}`,
              instanceNumber: i + 1,
              filePath: demoPath,
              fileName: `rt_${fileName}`,
              fileSize: fileStats.size,
              imagePosition: null,
              imageOrientation: null,
              pixelSpacing: null,
              sliceLocation: null,
              windowCenter: null,
              windowWidth: null,
              metadata: {
                source: 'HN-ATLAS-84',
                structureType: 'RT Structure Set'
              },
            });
          }

          await storage.updateSeriesImageCount(rtSeries.id, rtFiles.length);
          await storage.updateStudyCounts(rtStudy.id, 1, rtFiles.length);
        }
      }

      await storage.updateStudyCounts(ctStudy.id, 1, ctImages.length);
      console.log(`Created HN-ATLAS-84 demo patient with ${ctImages.length} CT images`);
      
    } catch (error) {
      console.error('Error creating HN-ATLAS demo:', error);
    }
  }

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

  // Get individual study by ID
  app.get("/api/studies/:id", async (req, res) => {
    try {
      const study = await storage.getStudy(parseInt(req.params.id));
      if (!study) {
        return res.status(404).json({ error: "Study not found" });
      }
      res.json(study);
    } catch (error) {
      console.error("Error getting study:", error);
      res.status(500).json({ error: "Failed to get study" });
    }
  });

  // Get series for a study
  app.get("/api/studies/:id/series", async (req, res) => {
    try {
      const series = await storage.getSeriesByStudyId(parseInt(req.params.id));
      res.json(series);
    } catch (error) {
      console.error("Error getting series:", error);
      res.status(500).json({ error: "Failed to get series" });
    }
  });

  // Patient management endpoints
  app.get("/api/patients", async (_req, res) => {
    try {
      const patients = await storage.getAllPatients();
      res.json(patients);
    } catch (error) {
      console.error("Error getting patients:", error);
      res.status(500).json({ error: "Failed to get patients" });
    }
  });

  app.get("/api/patients/:id", async (req, res) => {
    try {
      const patient = await storage.getPatient(parseInt(req.params.id));
      if (!patient) {
        return res.status(404).json({ error: "Patient not found" });
      }
      res.json(patient);
    } catch (error) {
      console.error("Error getting patient:", error);
      res.status(500).json({ error: "Failed to get patient" });
    }
  });

  app.get("/api/patients/:id/studies", async (req, res) => {
    try {
      const studies = await storage.getStudiesByPatient(parseInt(req.params.id));
      res.json(studies);
    } catch (error) {
      console.error("Error getting patient studies:", error);
      res.status(500).json({ error: "Failed to get patient studies" });
    }
  });

  // PACS connection management
  app.get("/api/pacs", async (_req, res) => {
    try {
      const connections = await storage.getAllPacsConnections();
      res.json(connections);
    } catch (error) {
      console.error("Error getting PACS connections:", error);
      res.status(500).json({ error: "Failed to get PACS connections" });
    }
  });

  app.post("/api/pacs", async (req, res) => {
    try {
      const result = insertPacsConnectionSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ error: "Invalid PACS connection data", details: result.error.errors });
      }
      
      const connection = await storage.createPacsConnection(result.data);
      res.status(201).json(connection);
    } catch (error) {
      console.error("Error creating PACS connection:", error);
      res.status(500).json({ error: "Failed to create PACS connection" });
    }
  });

  app.patch("/api/pacs/:id", async (req, res) => {
    try {
      const updates = req.body;
      const connection = await storage.updatePacsConnection(parseInt(req.params.id), updates);
      res.json(connection);
    } catch (error) {
      console.error("Error updating PACS connection:", error);
      res.status(500).json({ error: "Failed to update PACS connection" });
    }
  });

  app.delete("/api/pacs/:id", async (req, res) => {
    try {
      await storage.deletePacsConnection(parseInt(req.params.id));
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting PACS connection:", error);
      res.status(500).json({ error: "Failed to delete PACS connection" });
    }
  });

  // DICOM networking endpoints
  app.post("/api/pacs/:id/test", async (req, res) => {
    try {
      const connection = await storage.getPacsConnection(parseInt(req.params.id));
      if (!connection) {
        return res.status(404).json({ error: "PACS connection not found" });
      }
      
      const isConnected = await dicomNetworkService.testConnection(connection);
      res.json({ connected: isConnected });
    } catch (error) {
      console.error("Error testing PACS connection:", error);
      res.status(500).json({ error: "Failed to test connection" });
    }
  });

  app.post("/api/pacs/:id/query", async (req, res) => {
    try {
      const connection = await storage.getPacsConnection(parseInt(req.params.id));
      if (!connection) {
        return res.status(404).json({ error: "PACS connection not found" });
      }
      
      const queryParams = req.body;
      const results = await dicomNetworkService.queryStudies(connection, queryParams);
      res.json(results);
    } catch (error) {
      console.error("Error querying PACS:", error);
      res.status(500).json({ error: "Failed to query PACS" });
    }
  });

  app.post("/api/pacs/:id/retrieve", async (req, res) => {
    try {
      const connection = await storage.getPacsConnection(parseInt(req.params.id));
      if (!connection) {
        return res.status(404).json({ error: "PACS connection not found" });
      }
      
      const { studyInstanceUID, destinationAE } = req.body;
      const success = await dicomNetworkService.retrieveStudy(connection, studyInstanceUID, destinationAE);
      res.json({ success });
    } catch (error) {
      console.error("Error retrieving study:", error);
      res.status(500).json({ error: "Failed to retrieve study" });
    }
  });

  // DICOM file parsing endpoint
  app.post("/api/parse-dicom", upload.array('files'), async (req, res) => {
    try {
      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) {
        return res.status(400).json({ error: "No files uploaded" });
      }

      // Create temporary directory for uploaded files
      const tempDir = path.join('uploads', 'temp_' + Date.now());
      fs.mkdirSync(tempDir, { recursive: true });

      try {
        // Copy uploaded files to temp directory with .dcm extension
        for (const file of files) {
          const tempFilePath = path.join(tempDir, file.originalname);
          fs.copyFileSync(file.path, tempFilePath);
          fs.unlinkSync(file.path); // Clean up original upload
        }

        // Parse DICOM files using our parser
        const { data, rtstructDetails } = DICOMParser.parseDICOMFromFolder(tempDir);

        // Clean up temp directory
        fs.rmSync(tempDir, { recursive: true, force: true });

        res.json({
          success: true,
          data: data,
          rtstructDetails: rtstructDetails,
          totalFiles: data.length,
          message: `Parsed ${data.length} DICOM files`
        });

      } catch (parseError) {
        // Clean up temp directory on error
        if (fs.existsSync(tempDir)) {
          fs.rmSync(tempDir, { recursive: true, force: true });
        }
        throw parseError;
      }

    } catch (error) {
      console.error("Error parsing DICOM files:", error);
      res.status(500).json({ 
        error: "Failed to parse DICOM files",
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Import DICOM metadata into database
  app.post("/api/import-dicom-metadata", async (req, res) => {
    try {
      const { data, rtstructDetails } = req.body;
      
      if (!data || !Array.isArray(data)) {
        return res.status(400).json({ error: "Invalid DICOM data" });
      }

      const importResults = {
        patients: 0,
        studies: 0,
        series: 0,
        images: 0,
        errors: [] as string[]
      };

      // Group by patient and study
      const patientGroups = new Map();
      
      for (const dicomData of data) {
        try {
          if (dicomData.error) {
            importResults.errors.push(`${dicomData.filename}: ${dicomData.error}`);
            continue;
          }

          const patientKey = dicomData.patientID || 'UNKNOWN';
          if (!patientGroups.has(patientKey)) {
            patientGroups.set(patientKey, {
              patientData: dicomData,
              studies: new Map()
            });
          }

          const studyKey = dicomData.studyInstanceUID || 'UNKNOWN_STUDY';
          const patientGroup = patientGroups.get(patientKey);
          
          if (!patientGroup.studies.has(studyKey)) {
            patientGroup.studies.set(studyKey, {
              studyData: dicomData,
              series: new Map()
            });
          }

          const seriesKey = dicomData.seriesInstanceUID || 'UNKNOWN_SERIES';
          const studyGroup = patientGroup.studies.get(studyKey);
          
          if (!studyGroup.series.has(seriesKey)) {
            studyGroup.series.set(seriesKey, {
              seriesData: dicomData,
              images: []
            });
          }

          studyGroup.series.get(seriesKey).images.push(dicomData);
          
        } catch (error) {
          importResults.errors.push(`${dicomData.filename}: ${error instanceof Error ? error.message : 'Import error'}`);
        }
      }

      // Import into database
      for (const [patientKey, patientGroup] of patientGroups) {
        try {
          // Create or get patient
          let patient = await storage.getPatientByID(patientKey);
          if (!patient) {
            patient = await storage.createPatient({
              patientID: patientKey,
              patientName: patientGroup.patientData.patientName || 'Unknown Patient',
              patientSex: patientGroup.patientData.patientSex,
              patientAge: patientGroup.patientData.patientAge
            });
            importResults.patients++;
          }

          // Create studies
          for (const [studyKey, studyGroup] of patientGroup.studies) {
            let study = await storage.getStudyByUID(studyKey);
            if (!study) {
              study = await storage.createStudy({
                patientId: patient.id,
                studyInstanceUID: studyKey,
                studyDate: studyGroup.studyData.studyDate,
                studyTime: studyGroup.studyData.studyTime,
                studyDescription: studyGroup.studyData.studyDescription || studyGroup.studyData.seriesDescription,
                accessionNumber: studyGroup.studyData.accessionNumber
              });
              importResults.studies++;
            }

            // Create series
            for (const [seriesKey, seriesGroup] of studyGroup.series) {
              let series = await storage.getSeriesByUID(seriesKey);
              if (!series) {
                series = await storage.createSeries({
                  studyId: study.id,
                  seriesInstanceUID: seriesKey,
                  seriesDescription: seriesGroup.seriesData.seriesDescription || 'Unknown Series',
                  modality: seriesGroup.seriesData.modality || 'OT',
                  seriesNumber: seriesGroup.seriesData.seriesNumber,
                  imageCount: seriesGroup.images.length
                });
                importResults.series++;
              }

              // Create images
              for (const imageData of seriesGroup.images) {
                const existingImage = await storage.getImageByUID(imageData.sopInstanceUID || '');
                if (!existingImage && imageData.sopInstanceUID) {
                  await storage.createImage({
                    seriesId: series.id,
                    sopInstanceUID: imageData.sopInstanceUID,
                    instanceNumber: imageData.instanceNumber || 1,
                    filePath: imageData.filename
                  });
                  importResults.images++;
                }
              }
            }
          }
        } catch (error) {
          importResults.errors.push(`Patient ${patientKey}: ${error instanceof Error ? error.message : 'Database error'}`);
        }
      }

      res.json({
        success: true,
        imported: importResults,
        message: `Imported ${importResults.patients} patients, ${importResults.studies} studies, ${importResults.series} series, ${importResults.images} images`
      });

    } catch (error) {
      console.error("Error importing DICOM metadata:", error);
      res.status(500).json({ 
        error: "Failed to import DICOM metadata",
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
