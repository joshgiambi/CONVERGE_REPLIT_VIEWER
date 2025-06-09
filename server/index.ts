import express from "express";
import { storage } from "./storage";
import * as fs from "fs";
import * as path from "path";
import multer from "multer";
import { setupVite } from "./vite";
import { createServer } from "http";

const app = express();
const server = createServer(app);

app.use(express.json());

// Setup multer for file uploads
const upload = multer({ dest: 'uploads/' });

function isDICOMFile(filePath: string): boolean {
  try {
    const buffer = fs.readFileSync(filePath, { start: 128, end: 132 } as any);
    return buffer.toString() === 'DICM';
  } catch {
    return false;
  }
}

function generateUID(): string {
  return `2.16.840.1.114362.1.11932039.${Date.now()}.${Math.floor(Math.random() * 10000)}`;
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

// File upload endpoint for new DICOM data
app.post("/api/upload", upload.array('dicomFiles'), async (req, res) => {
  try {
    const files = req.files as Express.Multer.File[];
    const patientData = JSON.parse(req.body.patientData || '{}');
    
    if (!files || files.length === 0) {
      return res.status(400).json({ message: "No files uploaded" });
    }

    console.log(`Processing ${files.length} uploaded files`);

    // Create patient
    const patient = await storage.createPatient({
      patientID: patientData.patientID || generateUID().slice(-8),
      patientName: patientData.patientName || 'Unknown Patient',
      patientSex: patientData.patientSex || null,
      patientAge: patientData.patientAge || null,
      dateOfBirth: patientData.dateOfBirth || null,
    });

    // Create study
    const study = await storage.createStudy({
      studyInstanceUID: generateUID(),
      patientId: patient.id,
      patientName: patient.patientName,
      patientID: patient.patientID,
      studyDate: new Date().toISOString().slice(0, 10).replace(/-/g, ''),
      studyDescription: 'Uploaded DICOM Study',
      accessionNumber: generateUID().slice(-8),
      modality: 'CT',
      numberOfSeries: 1,
      numberOfImages: files.length,
      isDemo: false,
    });

    // Create series
    const series = await storage.createSeries({
      studyId: study.id,
      seriesInstanceUID: generateUID(),
      seriesDescription: 'Uploaded DICOM Series',
      modality: 'CT',
      seriesNumber: 1,
      imageCount: files.length,
      sliceThickness: '1.0',
      metadata: { uploaded: true },
    });

    // Process each uploaded file
    const uploadDir = path.join('uploads', patient.patientID);
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      
      // Move file to permanent location
      const permanentPath = path.join(uploadDir, file.originalname);
      fs.renameSync(file.path, permanentPath);

      await storage.createImage({
        seriesId: series.id,
        sopInstanceUID: generateUID(),
        instanceNumber: i + 1,
        filePath: permanentPath,
        fileName: file.originalname,
        fileSize: file.size,
        metadata: { uploaded: true },
      });
    }

    await storage.updateSeriesImageCount(series.id, files.length);
    await storage.updateStudyCounts(study.id, 1, files.length);

    res.json({ 
      success: true, 
      message: `Successfully uploaded ${files.length} DICOM files`,
      patient,
      study,
      series
    });

  } catch (error) {
    console.error('Error processing upload:', error);
    res.status(500).json({ message: "Failed to process uploaded files" });
  }
});

// Patient routes
app.get("/api/patients", async (req, res) => {
  try {
    const patients = await storage.getAllPatients();
    const studies = await storage.getAllStudies();
    
    // Build hierarchical structure: patients with nested studies
    const patientsWithStudies = patients.map(patient => ({
      ...patient,
      studies: studies.filter(study => study.patientId === patient.id)
    }));
    
    res.json(patientsWithStudies);
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

// Get all series
app.get("/api/series", async (req, res) => {
  try {
    const series = await storage.getAllSeries();
    res.json(series);
  } catch (error) {
    console.error('Error fetching all series:', error);
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
    console.log(`Returning ${images.length} images for series ${req.params.id}, database-sorted`);
    res.json(images);
  } catch (error) {
    console.error('Error fetching images:', error);
    res.status(500).json({ message: "Failed to fetch images" });
  }
});

// Series routes
app.get("/api/series/:id", async (req, res) => {
  try {
    const series = await storage.getSeries(parseInt(req.params.id));
    if (!series) {
      return res.status(404).json({ message: "Series not found" });
    }
    
    // Include images in the series response
    const images = await storage.getImagesBySeriesId(parseInt(req.params.id));
    const seriesWithImages = {
      ...series,
      images: images
    };
    
    res.json(seriesWithImages);
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

// Setup Vite for development
if (process.env.NODE_ENV === "development") {
  setupVite(app, server);
}

const PORT = Number(process.env.PORT) || 5000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 HN-ATLAS dataset loaded with 153 CT slices`);
  console.log(`📤 DICOM upload functionality enabled`);
});