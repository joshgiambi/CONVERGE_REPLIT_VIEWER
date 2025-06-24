import type { Express, Request, Response, NextFunction } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { DICOMProcessor } from "./dicom-processor";
import { storage } from "./dicom-storage";
import { createDemoData } from "./demo-data";

// Configure multer for file uploads
const storage_multer = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `${uniqueSuffix}-${file.originalname}`);
  }
});

const upload = multer({ 
  storage: storage_multer,
  fileFilter: (req, file, cb) => {
    // Accept DICOM files and common medical imaging formats
    const allowedMimes = [
      'application/dicom',
      'application/octet-stream',
      'image/dicom'
    ];
    
    const allowedExts = ['.dcm', '.dicom', '.dic'];
    const fileExt = path.extname(file.originalname).toLowerCase();
    
    if (allowedMimes.includes(file.mimetype) || allowedExts.includes(fileExt)) {
      cb(null, true);
    } else {
      cb(new Error('Only DICOM files are allowed'));
    }
  },
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit per file
  }
});

export async function registerRoutes(app: Express) {
  
  // Patient Management
  app.get("/api/patients", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const patients = await storage.getPatients();
      res.json(patients);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/patients/:id", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const patientId = parseInt(req.params.id);
      const patient = await storage.getPatientById(patientId);
      
      if (!patient) {
        return res.status(404).json({ error: "Patient not found" });
      }
      
      res.json(patient);
    } catch (error) {
      next(error);
    }
  });

  // Study Management
  app.get("/api/studies", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const studies = await storage.getStudies();
      res.json(studies);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/studies/:id", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const studyId = parseInt(req.params.id);
      const study = await storage.getStudyById(studyId);
      
      if (!study) {
        return res.status(404).json({ error: "Study not found" });
      }
      
      res.json(study);
    } catch (error) {
      next(error);
    }
  });

  // Get series by study ID
  app.get("/api/studies/:id/series", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const studyId = parseInt(req.params.id);
      const series = await storage.getSeriesByStudy(studyId);
      
      res.json(series);
    } catch (error) {
      next(error);
    }
  });

  // Series Management
  app.get("/api/series/:id", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const seriesId = parseInt(req.params.id);
      const series = await storage.getSeriesById(seriesId);

      if (!series) {
        return res.status(404).json({ error: "Series not found" });
      }

      res.json(series);
    } catch (error) {
      next(error);
    }
  });

  // Image Management
  app.get("/api/images/:sopInstanceUID", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const sopInstanceUID = req.params.sopInstanceUID;
      const image = await storage.getImageById(sopInstanceUID);

      if (!image) {
        return res.status(404).json({ error: "Image not found" });
      }

      if (!fs.existsSync(image.filePath)) {
        return res.status(404).json({ error: "Image file not found on disk" });
      }

      res.setHeader('Content-Type', 'application/dicom');
      res.setHeader('Content-Disposition', `attachment; filename="${image.fileName}"`);
      
      const fileStream = fs.createReadStream(image.filePath);
      fileStream.pipe(res);
      
    } catch (error) {
      next(error);
    }
  });

  // DICOM Upload
  app.post("/api/upload", upload.array('dicomFiles'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const files = req.files as Express.Multer.File[];
      
      if (!files || files.length === 0) {
        return res.status(400).json({ error: "No files uploaded" });
      }

      let processed = 0;
      const errors: string[] = [];

      for (const file of files) {
        try {
          const processedData = DICOMProcessor.processDICOMFile(file.path);
          await DICOMProcessor.storeDICOMInDatabase(
            processedData, 
            file.path, 
            file.originalname, 
            file.size
          );
          processed++;
          
        } catch (error: any) {
          errors.push(`${file.originalname}: ${error.message}`);
          // Clean up failed file
          if (fs.existsSync(file.path)) {
            fs.unlinkSync(file.path);
          }
        }
      }

      res.json({
        message: "Upload completed",
        processed,
        total: files.length,
        errors: errors.length > 0 ? errors : undefined
      });

    } catch (error) {
      next(error);
    }
  });

  // Demo Data
  app.post("/api/demo/load", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const results = await createDemoData();
      
      res.json({
        message: "Demo data loaded successfully",
        processed: results.processed,
        errors: results.errors.length > 0 ? results.errors : undefined
      });
    } catch (error) {
      next(error);
    }
  });

  // PACS Configuration (placeholder for future implementation)
  app.get("/api/pacs", async (req: Request, res: Response) => {
    res.json([]);
  });

  app.post("/api/pacs", async (req: Request, res: Response) => {
    res.status(501).json({ error: "PACS configuration not yet implemented" });
  });

  // Health check
  app.get("/api/health", (req: Request, res: Response) => {
    res.json({ 
      status: "healthy", 
      timestamp: new Date().toISOString(),
      service: "CONVERGE DICOM Viewer"
    });
  });

  // Create HTTP server
  const httpServer = createServer(app);

  // Load demo data on startup
  setTimeout(async () => {
    try {
      await createDemoData();
    } catch (error) {
      console.log('Demo data loading skipped');
    }
  }, 1000);

  return httpServer;
}