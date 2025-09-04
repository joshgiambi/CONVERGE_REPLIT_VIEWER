import { Express } from "express";
import multer from "multer";
import * as fs from "fs";
import * as path from "path";
import { storage } from "./storage";
import { Server } from "http";

const upload = multer({ dest: 'uploads/' });

function generateUID(): string {
  return `2.16.840.1.114362.1.11932039.${Date.now()}.${Math.floor(Math.random() * 10000)}`;
}

export async function registerRoutes(app: Express): Promise<Server> {
  
  // Create demo data with ALL 153 HN-ATLAS CT slices
  app.post("/api/populate-demo", async (req, res) => {
    try {
      await createFullHNAtlasDemo();
      res.json({ 
        success: true, 
        message: "Demo data created with all 153 CT slices",
        patients: (await storage.getAllPatients()).length,
        studies: (await storage.getAllStudies()).length
      });
    } catch (error) {
      console.error('Error populating demo:', error);
      res.status(500).json({ message: "Failed to create demo data" });
    }
  });

  async function createFullHNAtlasDemo() {
    try {
      // Check if HN-ATLAS patient already exists
      try {
        const hnPatient = await storage.getPatientByID('HN-ATLAS-84');
        if (hnPatient) {
          console.log('HN-ATLAS patient already exists');
          return;
        }
      } catch (error) {
        // Patient doesn't exist, create new one
      }

      // Create HN-ATLAS patient
      const hnPatient = await storage.createPatient({
        patientID: 'HN-ATLAS-84',
        patientName: 'HN-ATLAS^84',
        patientSex: 'M',
        patientAge: '62',
        dateOfBirth: '19620315'
      });

      const hnDatasetPath = 'attached_assets/HN-ATLAS-84/HN-ATLAS-84';
      const contrastPath = path.join(hnDatasetPath, 'DICOM_CONTRAST');

      if (!fs.existsSync(contrastPath)) {
        console.log('HN-ATLAS dataset not found');
        return;
      }

      // Get ALL CT files - 153 slices
      const contrastFiles = fs.readdirSync(contrastPath)
        .filter(f => f.endsWith('.dcm'))
        .sort();

      console.log(`Found ${contrastFiles.length} CT files in HN-ATLAS dataset`);

      // Create CT study with all slices
      const ctStudy = await storage.createStudy({
        studyInstanceUID: generateUID(),
        patientId: hnPatient.id,
        patientName: 'HN-ATLAS^84',
        patientID: 'HN-ATLAS-84',
        studyDate: '20200615',
        studyDescription: 'Head & Neck CT with Contrast - Complete Series',
        accessionNumber: 'HN84_CT_001',
        modality: 'CT',
        numberOfSeries: 1,
        numberOfImages: contrastFiles.length,
        isDemo: true,
      });

      // Create CT series with all 153 slices
      const ctSeries = await storage.createSeries({
        studyId: ctStudy.id,
        seriesInstanceUID: generateUID(),
        seriesDescription: `CT Head Neck with Contrast - ${contrastFiles.length} slices`,
        modality: 'CT',
        seriesNumber: 1,
        imageCount: contrastFiles.length,
        sliceThickness: '3.0',
        metadata: { 
          source: 'HN-ATLAS-84',
          anatomy: 'Head & Neck',
          contrast: 'IV Contrast Enhanced',
          totalSlices: contrastFiles.length
        },
      });

      // Create demo directory
      const hnDemoDir = 'uploads/hn-atlas-demo';
      if (!fs.existsSync(hnDemoDir)) {
        fs.mkdirSync(hnDemoDir, { recursive: true });
      }

      // Process ALL 153 CT images
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
          sopInstanceUID: generateUID(),
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
            contrast: true,
            sliceIndex: i + 1,
            totalSlices: contrastFiles.length
          },
        });
        ctImages.push(image);
      }

      await storage.updateSeriesImageCount(ctSeries.id, ctImages.length);
      await storage.updateStudyCounts(ctStudy.id, 1, ctImages.length);
      
      console.log(`✅ Created HN-ATLAS-84 with ${ctImages.length} CT images`);
      
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
      
      if (!fs.existsSync(image.filePath)) {
        return res.status(404).json({ message: "Image file not found on disk" });
      }
      
      res.setHeader('Content-Type', 'application/dicom');
      res.setHeader('Content-Disposition', `inline; filename="${image.fileName}"`);
      
      const fileStream = fs.createReadStream(image.filePath);
      fileStream.pipe(res);
      
    } catch (error) {
      console.error('Error serving DICOM file:', error);
      res.status(500).json({ message: "Failed to serve image" });
    }
  });

  // Patient routes
  app.get("/api/patients", async (req, res) => {
    try {
      const patients = await storage.getAllPatients();
      res.json(patients);
    } catch (error) {
      console.error('Error fetching patients:', error);
      res.status(500).json({ message: "Failed to fetch patients" });
    }
  });

  app.get("/api/patients/:id", async (req, res) => {
    try {
      const patient = await storage.getPatient(parseInt(req.params.id));
      if (!patient) {
        return res.status(404).json({ message: "Patient not found" });
      }
      res.json(patient);
    } catch (error) {
      console.error('Error fetching patient:', error);
      res.status(500).json({ message: "Failed to fetch patient" });
    }
  });

  // Study routes
  app.get("/api/studies", async (req, res) => {
    try {
      const studies = await storage.getAllStudies();
      res.json(studies);
    } catch (error) {
      console.error('Error fetching studies:', error);
      res.status(500).json({ message: "Failed to fetch studies" });
    }
  });

  app.get("/api/studies/:id", async (req, res) => {
    try {
      const study = await storage.getStudy(parseInt(req.params.id));
      if (!study) {
        return res.status(404).json({ message: "Study not found" });
      }
      res.json(study);
    } catch (error) {
      console.error('Error fetching study:', error);
      res.status(500).json({ message: "Failed to fetch study" });
    }
  });

  app.get("/api/studies/:id/series", async (req, res) => {
    try {
      const series = await storage.getSeriesByStudyId(parseInt(req.params.id));
      res.json(series);
    } catch (error) {
      console.error('Error fetching series:', error);
      res.status(500).json({ message: "Failed to fetch series" });
    }
  });

  // Series routes
  app.get("/api/series/:id", async (req, res) => {
    try {
      const series = await storage.getSeries(parseInt(req.params.id));
      if (!series) {
        return res.status(404).json({ message: "Series not found" });
      }
      res.json(series);
    } catch (error) {
      console.error('Error fetching series:', error);
      res.status(500).json({ message: "Failed to fetch series" });
    }
  });

  app.get("/api/series/:id/images", async (req, res) => {
    try {
      const images = await storage.getImagesBySeriesId(parseInt(req.params.id));
      res.json(images);
    } catch (error) {
      console.error('Error fetching images:', error);
      res.status(500).json({ message: "Failed to fetch images" });
    }
  });

  // PACS routes  
  app.get("/api/pacs", async (req, res) => {
    try {
      const connections = await storage.getAllPacsConnections();
      res.json(connections);
    } catch (error) {
      console.error('Error fetching PACS connections:', error);
      res.status(500).json({ message: "Failed to fetch PACS connections" });
    }
  });

  return { close: () => {} } as Server;
}