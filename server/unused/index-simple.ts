import express from "express";
import { storage } from "./storage";
import * as fs from "fs";
import * as path from "path";

const app = express();
app.use(express.json());

// Serve static files from client/dist
app.use(express.static(path.join(process.cwd(), 'client/dist')));

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

// Serve React app for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'client/dist/index.html'));
});

const port = process.env.PORT || 5000;
app.listen(port, '0.0.0.0', () => {
  console.log(`Server running on port ${port}`);
  console.log(`HN-ATLAS dataset available with 153 CT slices`);
});