import { Express, Request, Response, NextFunction } from "express";
import multer from "multer";
import * as fs from "fs";
import * as path from "path";
import { storage } from "./storage";
import { Server } from "http";
import dicomParser from 'dicom-parser';
import { RTStructureParser } from './rt-structure-parser';
import { db } from "./db";
import { images as imagesTable, patientTags } from "@shared/schema";
import { eq } from "drizzle-orm";
import { generateSeriesGIF } from './gif-generator';
import yauzl from 'yauzl';
import { patientStorage } from './patient-storage';
import { logger } from './logger';
const isDev = process.env.NODE_ENV !== 'production';

// Helper function to check if two polygons overlap
function polygonOverlaps(poly1: number[][], poly2: number[][]): boolean {
  // Check if any point of poly1 is inside poly2
  for (const point of poly1) {
    if (isPointInPolygon(point, poly2)) {
      return true;
    }
  }
  
  // Check if any point of poly2 is inside poly1
  for (const point of poly2) {
    if (isPointInPolygon(point, poly1)) {
      return true;
    }
  }
  
  // Check if any edges intersect
  for (let i = 0; i < poly1.length; i++) {
    const p1 = poly1[i];
    const p2 = poly1[(i + 1) % poly1.length];
    
    for (let j = 0; j < poly2.length; j++) {
      const p3 = poly2[j];
      const p4 = poly2[(j + 1) % poly2.length];
      
      if (lineSegmentsIntersect(p1, p2, p3, p4)) {
        return true;
      }
    }
  }
  
  return false;
}

// Helper function for point-in-polygon test
function isPointInPolygon(point: number[], polygon: number[][]): boolean {
  let inside = false;
  const x = point[0], y = point[1];
  
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1];
    const xj = polygon[j][0], yj = polygon[j][1];
    
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  
  return inside;
}

// Helper function to check if two line segments intersect
function lineSegmentsIntersect(p1: number[], p2: number[], p3: number[], p4: number[]): boolean {
  const d1 = (p4[0] - p3[0]) * (p1[1] - p3[1]) - (p4[1] - p3[1]) * (p1[0] - p3[0]);
  const d2 = (p4[0] - p3[0]) * (p2[1] - p3[1]) - (p4[1] - p3[1]) * (p2[0] - p3[0]);
  const d3 = (p2[0] - p1[0]) * (p3[1] - p1[1]) - (p2[1] - p1[1]) * (p3[0] - p1[0]);
  const d4 = (p2[0] - p1[0]) * (p4[1] - p1[1]) - (p2[1] - p1[1]) * (p4[0] - p1[0]);
  
  return d1 * d2 < 0 && d3 * d4 < 0;
}

// Configure multer to use session-specific upload directories
const upload = multer({ 
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      // Check if we already have a session ID for this request
      let uploadSessionId = (req as any).uploadSessionId;
      
      if (!uploadSessionId) {
        // Generate session-specific directory only once per request
        uploadSessionId = `upload-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        (req as any).uploadSessionId = uploadSessionId;
      }
      
      const uploadDir = path.join('uploads', uploadSessionId);
      
      // Create directory if it doesn't exist
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }
      
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
      // Keep original filename
      cb(null, file.originalname);
    }
  }),
  limits: {
    fileSize: 2 * 1024 * 1024 * 1024, // 2GB per file for large DICOM datasets
    files: 5000 // Support up to 5000 files per upload
  }
});

// In-memory storage for RT structure modifications
// In production, this would be stored in a database
const rtStructureModifications = new Map<number, {
  newStructures: any[],
  modifiedStructures: Map<number, any>,
  history: Array<{
    timestamp: number,
    action: string,
    structureId: number,
    previousState?: any,
    newState?: any
  }>,
  historyIndex: number
}>();

// Cache for parsed RT structure sets to improve performance
const rtStructureCache = new Map<string, any>();

// Store parsing sessions server-side
const parsingSessions = new Map<string, {
  sessionId: string;
  status: 'parsing' | 'complete' | 'error';
  progress: number;
  total: number;
  currentFile?: string;
  result?: any;
  error?: string;
  startedAt: Date;
  completedAt?: Date;
  files?: Express.Multer.File[];
}>();

// Store parsed but not imported sessions (triage)
const triageSessions = new Map<string, {
  sessionId: string;
  parseResult: any;
  uploadSessionId: string;
  timestamp: number;
  patientCount: number;
  imageCount: number;
}>();

// Function to extract ZIP files
async function extractZipFile(zipPath: string, destDir: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const extractedFiles: string[] = [];
    
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err) {
        reject(err);
        return;
      }
      
      zipfile.readEntry();
      
      zipfile.on('entry', (entry) => {
        if (/\/$/.test(entry.fileName)) {
          // Directory entry
          zipfile.readEntry();
        } else {
          // File entry
          const outputPath = path.join(destDir, entry.fileName);
          const outputDir = path.dirname(outputPath);
          
          // Create directory if it doesn't exist
          if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
          }
          
          zipfile.openReadStream(entry, (err, readStream) => {
            if (err) {
              reject(err);
              return;
            }
            
            const writeStream = fs.createWriteStream(outputPath);
            readStream.pipe(writeStream);
            
            writeStream.on('close', () => {
              extractedFiles.push(outputPath);
              zipfile.readEntry();
            });
            
            writeStream.on('error', reject);
          });
        }
      });
      
      zipfile.on('end', () => {
        resolve(extractedFiles);
      });
      
      zipfile.on('error', reject);
    });
  });
}

function isDICOMFile(filePath: string): boolean {
  try {
    // Skip DICOM validation for now - just check file extension
    const ext = path.extname(filePath).toLowerCase();
    return ext === '.dcm' || ext === '';
  } catch {
    return false;
  }
}

function extractRTStructMetadata(filePath: string) {
  try {
    const buffer = fs.readFileSync(filePath);
    const byteArray = new Uint8Array(buffer);
    const dataSet = dicomParser.parseDicom(byteArray, {
      untilTag: 'x30060050' // stop after ROI Contour Sequence
    });

    const getString = (tag: string) => {
      try {
        return dataSet.string(tag)?.trim() || null;
      } catch {
        return null;
      }
    };

    const structures: any[] = [];
    
    // Try to get structure set ROI sequence
    try {
      const roiSequence = dataSet.elements.x30060020;
      if (roiSequence) {
        // Simple extraction - just get structure names
        // Full RT struct parsing would be more complex
        console.log('Found RT Structure Set');
      }
    } catch (error) {
      console.log('Could not parse RT structures:', error);
    }

    return {
      structureSetDate: getString('x30060008'),
      structures: structures
    };
  } catch (error) {
    console.error('RT struct parse error:', error);
    return null;
  }
}

function extractDICOMMetadata(filePath: string) {
  try {
    const buffer = fs.readFileSync(filePath);
    const byteArray = new Uint8Array(buffer);
    const dataSet = dicomParser.parseDicom(byteArray, {
      untilTag: 'x7fe00010' // stop before pixel data
    });

    const getString = (tag: string) => {
      try {
        return dataSet.string(tag)?.trim() || null;
      } catch {
        return null;
      }
    };

    const getNumber = (tag: string) => {
      try {
        const value = getString(tag);
        return value ? parseFloat(value) : null;
      } catch {
        return null;
      }
    };

    const getArray = (tag: string) => {
      try {
        const value = getString(tag);
        return value ? value.split('\\').map(Number) : null;
      } catch {
        return null;
      }
    };

    // Extract essential metadata
    const metadata: any = {
      patientName: getString('x00100010'),
      patientID: getString('x00100020'),
      patientSex: getString('x00100040'),
      patientAge: getString('x00101010'),
      patientBirthDate: getString('x00100030'),
      studyInstanceUID: getString('x0020000d'),
      seriesInstanceUID: getString('x0020000e'),
      sopInstanceUID: getString('x00080018'),
      modality: getString('x00080060'),
      studyDate: getString('x00080020'),
      studyTime: getString('x00080030'),
      studyDescription: getString('x00081030'),
      seriesDescription: getString('x0008103e'),
      seriesNumber: getNumber('x00200011'),
      instanceNumber: getNumber('x00200013'),
      imageType: getString('x00080008'),
      pixelSpacing: getArray('x00280030'),
      imagePositionPatient: getArray('x00200032'),
      imageOrientationPatient: getArray('x00200037'),
      sliceThickness: getNumber('x00180050'),
      sliceLocation: getNumber('x00201041'),
      frameOfReferenceUID: getString('x00200052'),
      rows: getNumber('x00280010'),
      columns: getNumber('x00280011'),
      windowCenter: getNumber('x00281050'),
      windowWidth: getNumber('x00281051'),
      rescaleSlope: getNumber('x00281053'),
      rescaleIntercept: getNumber('x00281052'),
      accessionNumber: getString('x00080050')
    };

    // Return only non-null values
    const cleanMetadata: any = {};
    for (const [key, value] of Object.entries(metadata)) {
      if (value !== null && value !== undefined) {
        cleanMetadata[key] = value;
      }
    }

    return cleanMetadata;
  } catch (error) {
    console.error('DICOM parse error:', error);
    return null;
  }
}

function getTagString(dataSet: any, tag: string): string | null {
  try {
    return dataSet.string(tag)?.trim() || null;
  } catch {
    return null;
  }
}

function getTagArray(dataSet: any, tag: string): number[] | null {
  try {
    const value = dataSet.string(tag);
    return value ? value.split('\\').map(Number) : null;
  } catch {
    return null;
  }
}

function extractTag(buffer: Buffer, tag: string): string | null {
  try {
    const byteArray = new Uint8Array(buffer);
    const dataSet = (dicomParser as any).parseDicom(byteArray, {});
    return getTagString(dataSet, tag);
  } catch (error: any) {
    console.warn(`Failed to extract DICOM tag ${tag}:`, error.message);
    return null;
  }
}

function generateUID(): string {
  return `2.16.840.1.114362.1.11932039.${Date.now()}.${Math.floor(Math.random() * 10000)}`;
}

export async function registerRoutes(app: Express): Promise<Server> {
  
  // Create demo data
  app.post("/api/create-test-data", async (req, res) => {
    try {
      // Create basic demo patient if none exist
      const patients = await storage.getAllPatients();
      if (patients.length === 0) {
        const demoPatient = await storage.createPatient({
          patientID: 'DEMO001',
          patientName: 'Demo^Patient',
          patientSex: 'M',
          patientAge: '45',
          dateOfBirth: '19780315'
        });

        const demoStudy = await storage.createStudy({
          studyInstanceUID: generateUID(),
          patientId: demoPatient.id,
          patientName: 'Demo^Patient',
          patientID: 'DEMO001',
          studyDate: new Date().toISOString().slice(0, 10).replace(/-/g, ''),
          studyDescription: 'Demo CT Study',
          accessionNumber: 'DEMO001',
          modality: 'CT',
          numberOfSeries: 1,
          numberOfImages: 5,
          isDemo: true,
        });

        const demoSeries = await storage.createSeries({
          studyId: demoStudy.id,
          seriesInstanceUID: generateUID(),
          seriesDescription: 'Demo CT Series',
          modality: 'CT',
          seriesNumber: 1,
          imageCount: 5,
          sliceThickness: '5.0',
          metadata: { type: 'demo' },
        });

        // Create placeholder images
        for (let i = 1; i <= 5; i++) {
          await storage.createImage({
            seriesId: demoSeries.id,
            sopInstanceUID: `${generateUID()}.${i}`,
            instanceNumber: i,
            filePath: `/demo/image_${i}.dcm`,
            fileName: `demo_image_${i}.dcm`,
            fileSize: 1024000,
            metadata: { demo: true },
          });
        }

        console.log('Demo data created');
      }
      
      res.json({ success: true });
    } catch (error) {
      console.error('Error creating demo data:', error);
      res.status(500).json({ message: "Failed to create demo data" });
    }
  });

  // Populate HN-ATLAS demo data
  app.post("/api/populate-demo", async (req, res) => {
    try {
      await createHNAtlasDemo();
      res.json({ 
        success: true, 
        message: "Demo data already exists or has been created",
        patients: (await storage.getAllPatients()).length,
        studies: (await storage.getAllStudies()).length
      });
    } catch (error) {
      console.error('Error populating demo:', error);
      res.status(500).json({ message: "Failed to create demo data" });
    }
  });

  async function createHNAtlasDemo() {
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
      const mimPath = path.join(hnDatasetPath, 'MIM');

      if (!fs.existsSync(contrastPath)) {
        console.log('HN-ATLAS dataset not found');
        return;
      }

      // Parse the DICOM_CONTRAST folder for CT images - use ALL available slices
      const contrastFiles = fs.readdirSync(contrastPath)
        .filter(f => f.endsWith('.dcm'))
        .sort();

      if (contrastFiles.length === 0) {
        console.log('No DICOM files found in HN-ATLAS contrast folder');
        return;
      }

      // Create CT study
      const ctStudy = await storage.createStudy({
        studyInstanceUID: generateUID(),
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
        seriesInstanceUID: generateUID(),
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

      // Copy and process ALL CT images
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
            studyInstanceUID: generateUID(),
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
            seriesInstanceUID: generateUID(),
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
            
            await storage.createImage({
              seriesId: rtSeries.id,
              sopInstanceUID: generateUID(),
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

  // Add middleware to log all requests
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
  });

  // Parse DICOM files and extract metadata
  app.post("/api/parse-dicom", upload.array('files'), async (req: Request, res: Response, next: NextFunction) => {
    console.log('====== PARSE DICOM ENDPOINT HIT ======');
    console.log('Time:', new Date().toISOString());
    console.log('Files received:', req.files?.length || 0);
    console.log('Body:', req.body);
    console.log('======================================');
    
    try {
      const files = req.files as Express.Multer.File[];
      
      if (!files || files.length === 0) {
        return res.status(400).json({ error: "No files uploaded" });
      }

      console.log('Starting to parse', files.length, 'files...');
      
      // Limit files to prevent timeout
      const maxFiles = 50;
      if (files.length > maxFiles) {
        console.log(`Warning: ${files.length} files uploaded, processing only first ${maxFiles} files`);
        files.splice(maxFiles);
      }
      
      const parsedData: any[] = [];
      const rtstructDetails: any = {};
      let successCount = 0;
      let errorCount = 0;

      // Parse each file
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        console.log(`Processing file ${i + 1}/${files.length}: ${file.originalname}`);
        
        try {
          // Check if DICOM file
          const isDicom = isDICOMFile(file.path);
          console.log(`Is DICOM: ${isDicom}`);
          
          if (!isDicom) {
            errorCount++;
            parsedData.push({
              filename: file.originalname,
              error: "Not a valid DICOM file"
            });
            continue;
          }

          // Extract metadata
          console.log('Extracting metadata...');
          const metadata = extractDICOMMetadata(file.path);
          
          if (!metadata) {
            errorCount++;
            parsedData.push({
              filename: file.originalname,
              error: "Failed to extract metadata"
            });
            continue;
          }

          console.log('Metadata extracted:', {
            modality: metadata.modality,
            patientID: metadata.patientID,
            studyUID: metadata.studyInstanceUID
          });

          // Add filename to metadata
          const dicomData = {
            filename: file.originalname,
            ...metadata
          };

          // Check if it's an RT Structure Set
          if (metadata.modality === 'RTSTRUCT') {
            console.log('Processing RT Structure Set...');
            try {
              const rtData = extractRTStructMetadata(file.path);
              if (rtData) {
                rtstructDetails[file.originalname] = {
                  structureSetDate: rtData.structureSetDate,
                  structures: rtData.structures.map((s: any) => [s.name, s.color])
                };
              }
            } catch (rtError) {
              console.error('Error extracting RT struct:', rtError);
            }
          }

          parsedData.push(dicomData);
          successCount++;
          console.log(`File ${i + 1} processed successfully`);
        } catch (fileError) {
          console.error(`Error processing file ${file.originalname}:`, fileError);
          errorCount++;
          parsedData.push({
            filename: file.originalname,
            error: fileError instanceof Error ? fileError.message : "Unknown error"
          });
        }
      }

      console.log('Cleaning up uploaded files...');
      // Clean up uploaded files
      for (const file of files) {
        try {
          if (fs.existsSync(file.path)) {
            fs.unlinkSync(file.path);
          }
        } catch (cleanupError) {
          console.error('Error cleaning up file:', file.path, cleanupError);
        }
      }

      console.log(`Parse complete: ${successCount} success, ${errorCount} errors`);
      
      // Group data by patient for preview
      const patientGroups = new Map<string, {
        patientId: string;
        patientName: string;
        studies: Map<string, {
          studyId: string;
          studyDate: string;
          series: any[];
        }>;
      }>();

      // Group parsed data by patient/study
      for (const item of parsedData.filter(d => !d.error)) {
        const patientId = item.patientID || 'Unknown';
        const studyId = item.studyInstanceUID || 'Unknown';
        
        if (!patientGroups.has(patientId)) {
          patientGroups.set(patientId, {
            patientId,
            patientName: item.patientName || 'Unknown Patient',
            studies: new Map()
          });
        }
        
        const patient = patientGroups.get(patientId)!;
        if (!patient.studies.has(studyId)) {
          patient.studies.set(studyId, {
            studyId,
            studyDate: item.studyDate || '',
            series: []
          });
        }
        
        patient.studies.get(studyId)!.series.push(item);
      }

      // Convert to array format for frontend
      const patientPreviews = Array.from(patientGroups.values()).map(patient => ({
        patientId: patient.patientId,
        patientName: patient.patientName,
        studies: Array.from(patient.studies.values()).map(study => ({
          studyId: study.studyId,
          studyDate: study.studyDate,
          seriesCount: new Set(study.series.map(s => s.seriesInstanceUID)).size,
          imageCount: study.series.length,
          modalities: Array.from(new Set(study.series.map(s => s.modality).filter(Boolean)))
        }))
      }));
      
      res.json({
        success: true,
        data: parsedData,
        rtstructDetails: rtstructDetails,
        totalFiles: files.length,
        message: `Successfully parsed ${successCount} files, ${errorCount} errors`,
        patientPreviews
      });

    } catch (error) {
      console.error('Error parsing DICOM files:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to parse DICOM files" });
    }
  });

  // Import parsed DICOM metadata into database
  app.post("/api/import-dicom-metadata", async (req: Request, res: Response, next: NextFunction) => {
    console.log('Import DICOM metadata endpoint hit');
    
    try {
      const { data, rtstructDetails } = req.body;
      
      if (!data || !Array.isArray(data)) {
        return res.status(400).json({ error: "Invalid data format" });
      }

      // Group files by patient, study, and series
      const patientMap = new Map();
      
      for (const metadata of data) {
        if (metadata.error) continue; // Skip files with errors

        const patientKey = metadata.patientID || 'UNKNOWN';
        const studyKey = metadata.studyInstanceUID || 'UNKNOWN';
        const seriesKey = metadata.seriesInstanceUID || 'UNKNOWN';

        if (!patientMap.has(patientKey)) {
          patientMap.set(patientKey, {
            metadata: metadata,
            studies: new Map()
          });
        }

        const patient = patientMap.get(patientKey);
        if (!patient.studies.has(studyKey)) {
          patient.studies.set(studyKey, {
            metadata: metadata,
            series: new Map()
          });
        }

        const study = patient.studies.get(studyKey);
        if (!study.series.has(seriesKey)) {
          study.series.set(seriesKey, {
            metadata: metadata,
            images: []
          });
        }

        study.series.get(seriesKey).images.push(metadata);
      }

      // Process and store in database
      const uploadedPatients = [];
      
      for (const [patientKey, patientData] of patientMap) {
        // Create or update patient
        const existingPatient = await storage.getPatientByID(patientKey);
        let patient;
        
        if (existingPatient) {
          patient = existingPatient;
        } else {
          const firstMetadata = patientData.metadata;
          patient = await storage.createPatient({
            patientID: patientKey,
            patientName: firstMetadata.patientName || 'Unknown',
            patientSex: firstMetadata.patientSex,
            dateOfBirth: firstMetadata.patientBirthDate,
            patientAge: firstMetadata.patientAge
          });
        }

        // Process studies
        for (const [studyKey, studyData] of patientData.studies) {
          const existingStudy = await storage.getStudyByUID(studyKey);
          let study;
          
          if (existingStudy) {
            study = existingStudy;
          } else {
            const firstMetadata = studyData.metadata;
            study = await storage.createStudy({
              studyInstanceUID: studyKey,
              patientId: patient.id,
              patientName: firstMetadata.patientName || patient.patientName,
              patientID: patient.patientID,
              studyDate: firstMetadata.studyDate,
              studyTime: firstMetadata.studyTime,
              studyDescription: firstMetadata.studyDescription,
              accessionNumber: firstMetadata.accessionNumber,
              modality: firstMetadata.modality,
              numberOfSeries: studyData.series.size,
              numberOfImages: Array.from(studyData.series.values()).reduce((sum, s) => sum + s.images.length, 0)
            });
          }

          // Process series
          for (const [seriesKey, seriesData] of studyData.series) {
            const existingSeries = await storage.getSeriesByUID(seriesKey);
            let series;
            
            if (existingSeries) {
              series = existingSeries;
            } else {
              const firstMetadata = seriesData.metadata;
              series = await storage.createSeries({
                seriesInstanceUID: seriesKey,
                studyId: study.id,
                seriesNumber: firstMetadata.seriesNumber,
                seriesDescription: firstMetadata.seriesDescription,
                modality: firstMetadata.modality,
                imageCount: seriesData.images.length
              });
            }

            // Process images
            for (const imageMetadata of seriesData.images) {
              const existingImage = await storage.getImageByUID(imageMetadata.sopInstanceUID);
              
              if (!existingImage) {
                await storage.createImage({
                  sopInstanceUID: imageMetadata.sopInstanceUID,
                  seriesId: series.id,
                  instanceNumber: imageMetadata.instanceNumber,
                  imageType: imageMetadata.imageType,
                  pixelSpacing: imageMetadata.pixelSpacing,
                  imagePosition: imageMetadata.imagePositionPatient,
                  imageOrientation: imageMetadata.imageOrientationPatient,
                  rows: imageMetadata.rows,
                  columns: imageMetadata.columns,
                  windowCenter: imageMetadata.windowCenter,
                  windowWidth: imageMetadata.windowWidth,
                  rescaleIntercept: imageMetadata.rescaleIntercept,
                  rescaleSlope: imageMetadata.rescaleSlope,
                  fileName: imageMetadata.filename,
                  filePath: imageMetadata.filePath || imageMetadata.filename // Use filePath if available
                });
              }
            }
          }
        }

        uploadedPatients.push(patient);
      }

      res.json({
        success: true,
        message: `Successfully imported ${uploadedPatients.length} patients`,
        patients: uploadedPatients
      });

    } catch (error) {
      console.error('Error importing DICOM metadata:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to import metadata" });
    }
  });

  // Handle file uploads
  app.post("/api/upload", upload.array('dicomFiles'), async (req: Request, res: Response, next: NextFunction) => {
    if (isDev) {
      logger.debug(`Upload endpoint hit with files: ${req.files?.length}`, 'upload');
      logger.debug(`Request body keys: ${Object.keys(req.body || {}).join(',')}`, 'upload');
    }
    
    try {
      const files = req.files as Express.Multer.File[];
      const patientData = JSON.parse(req.body.patientData || '{}');
      
      if (!files || files.length === 0) {
        return res.status(400).json({ message: "No files uploaded" });
      }

      if (isDev) logger.debug(`Processing ${files.length} uploaded files`, 'upload');

      // Group files by patient, study, and series
      const patientMap = new Map();
      
      for (const file of files) {
        if (!isDICOMFile(file.path)) {
          console.log(`Skipping non-DICOM file: ${file.originalname}`);
          continue;
        }

        const metadata = extractDICOMMetadata(file.path);
        if (!metadata) {
          console.log(`Failed to extract metadata from: ${file.originalname}`);
          continue;
        }

        const patientKey = metadata.patientID || 'UNKNOWN';
        const studyKey = metadata.studyInstanceUID || 'UNKNOWN';
        const seriesKey = metadata.seriesInstanceUID || 'UNKNOWN';

        if (!patientMap.has(patientKey)) {
          patientMap.set(patientKey, new Map());
        }
        if (!patientMap.get(patientKey).has(studyKey)) {
          patientMap.get(patientKey).set(studyKey, new Map());
        }
        if (!patientMap.get(patientKey).get(studyKey).has(seriesKey)) {
          patientMap.get(patientKey).get(studyKey).set(seriesKey, []);
        }

        patientMap.get(patientKey).get(studyKey).get(seriesKey).push({
          file,
          metadata
        });
      }

      if (isDev) logger.debug(`Organized files into ${patientMap.size} patients`, 'upload');

      const results = [];

      // Process each patient
      for (const [patientKey, studies] of patientMap) {
        let dbPatient;
        try {
          dbPatient = await storage.getPatientByID(patientKey);
        } catch (error) {
          // Patient doesn't exist, create new one
          const firstStudy = studies.values().next().value;
          const firstSeries = firstStudy.values().next().value;
          const firstFile = firstSeries[0];
          
          dbPatient = await storage.createPatient({
            patientID: patientKey,
            patientName: firstFile.metadata.patientName || patientData.patientName || 'Unknown Patient',
            patientSex: patientData.patientSex || null,
            patientAge: patientData.patientAge || null,
            dateOfBirth: patientData.dateOfBirth || null,
          });
        }

        // Process each study
        for (const [studyKey, series] of studies) {
          let dbStudy;
          try {
            dbStudy = await storage.getStudyByUID(studyKey);
          } catch (error) {
            // Study doesn't exist, create new one
            const firstSeries = series.values().next().value;
            const firstFile = firstSeries[0];
            
            dbStudy = await storage.createStudy({
              studyInstanceUID: studyKey,
              patientId: dbPatient.id,
              patientName: dbPatient.patientName,
              patientID: dbPatient.patientID,
              studyDate: firstFile.metadata.studyDate || new Date().toISOString().slice(0, 10).replace(/-/g, ''),
              studyDescription: `${firstFile.metadata.modality} Study`,
              accessionNumber: generateUID(),
              modality: firstFile.metadata.modality || 'CT',
              numberOfSeries: series.size,
              numberOfImages: Array.from(series.values()).reduce((sum, s) => sum + s.length, 0),
              isDemo: false,
            });
          }

          // Process each series
          for (const [seriesKey, seriesFiles] of series) {
            let dbSeries;
            try {
              dbSeries = await storage.getSeriesByUID(seriesKey);
            } catch (error) {
              // Series doesn't exist, create new one
              const firstFile = seriesFiles[0];
              
              dbSeries = await storage.createSeries({
                studyId: dbStudy.id,
                seriesInstanceUID: seriesKey,
                seriesDescription: firstFile.metadata.seriesDescription || `${firstFile.metadata.modality} Series`,
                modality: firstFile.metadata.modality || 'CT',
                seriesNumber: 1,
                imageCount: seriesFiles.length,
                sliceThickness: '1.0',
                metadata: { uploaded: true },
              });
            }

            // Process each image in the series
            for (const { file, metadata } of seriesFiles) {
              // Move file to permanent location
              const permanentPath = path.join('uploads', dbPatient.patientID, dbStudy.studyInstanceUID, dbSeries.seriesInstanceUID, file.originalname);
              const permanentDir = path.dirname(permanentPath);
              
              if (!fs.existsSync(permanentDir)) {
                fs.mkdirSync(permanentDir, { recursive: true });
              }
              
              fs.renameSync(file.path, permanentPath);

              // Preserve essential spatial and display metadata for fusion/RT alignment
              const px = Array.isArray(metadata.pixelSpacing) ? metadata.pixelSpacing : null;
              const pixelSpacingStr = px && px.length >= 2 ? `${px[0]}\\${px[1]}` : null;
              const imagePositionArr = (metadata.imagePositionPatient || metadata.imagePosition);
              const imagePositionStr = Array.isArray(imagePositionArr) && imagePositionArr.length >= 3
                ? `${imagePositionArr[0]}\\${imagePositionArr[1]}\\${imagePositionArr[2]}`
                : (typeof imagePositionArr === 'string' ? imagePositionArr : null);
              const imageOrientationArr = (metadata.imageOrientationPatient || metadata.imageOrientation);
              const imageOrientationStr = Array.isArray(imageOrientationArr) && imageOrientationArr.length >= 6
                ? `${imageOrientationArr[0]}\\${imageOrientationArr[1]}\\${imageOrientationArr[2]}\\${imageOrientationArr[3]}\\${imageOrientationArr[4]}\\${imageOrientationArr[5]}`
                : (typeof imageOrientationArr === 'string' ? imageOrientationArr : null);

              await storage.createImage({
                seriesId: dbSeries.id,
                sopInstanceUID: metadata.sopInstanceUID || generateUID(),
                instanceNumber: parseInt(metadata.instanceNumber) || 1,
                filePath: permanentPath,
                fileName: file.originalname,
                fileSize: file.size,
                imagePosition: imagePositionStr || null,
                imageOrientation: imageOrientationStr || null,
                pixelSpacing: pixelSpacingStr,
                sliceLocation: metadata.sliceLocation ? String(metadata.sliceLocation) : null,
                windowCenter: metadata.windowCenter ? String(metadata.windowCenter) : null,
                windowWidth: metadata.windowWidth ? String(metadata.windowWidth) : null,
                rescaleIntercept: metadata.rescaleIntercept ? String(metadata.rescaleIntercept) : null as any,
                rescaleSlope: metadata.rescaleSlope ? String(metadata.rescaleSlope) : null as any,
                metadata: { uploaded: true },
              });
            }

            await storage.updateSeriesImageCount(dbSeries.id, seriesFiles.length);
          }

          await storage.updateStudyCounts(dbStudy.id, series.size, Array.from(series.values()).reduce((sum, s) => sum + s.length, 0));
        }

        results.push({
          patient: dbPatient,
          studiesCount: studies.size,
          totalImages: Array.from(studies.values()).reduce((sum, study) => 
            sum + Array.from(study.series.values()).reduce((seriesSum, series) => seriesSum + series.length, 0), 0)
        });
      }

      console.log('Upload processing completed:', results);
      res.json({ 
        success: true, 
        message: `Successfully uploaded ${files.length} DICOM files`,
        results 
      });

    } catch (error) {
      console.error('Error processing upload:', error);
      res.status(500).json({ message: "Failed to process uploaded files" });
    }
  });

  // Import from triage session
  app.post("/api/import-triage", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { sessionId } = req.body;
      
      if (!sessionId) {
        return res.status(400).json({ error: "Session ID is required" });
      }

      // Get triage session data
      const triageSession = triageSessions.get(sessionId);
      if (!triageSession || !triageSession.parseResult) {
        return res.status(404).json({ error: "Triage session not found" });
      }

      const { data, rtstructDetails } = triageSession.parseResult;
      
      if (!data || !Array.isArray(data)) {
        return res.status(400).json({ error: "Invalid triage data format" });
      }

      // Use the same import logic as the regular import endpoint
      const patientMap = new Map();
      
      for (const metadata of data) {
        if (metadata.error) continue; // Skip files with errors

        const patientKey = metadata.patientID || 'UNKNOWN';
        const studyKey = metadata.studyInstanceUID || 'UNKNOWN';
        const seriesKey = metadata.seriesInstanceUID || 'UNKNOWN';

        if (!patientMap.has(patientKey)) {
          patientMap.set(patientKey, {
            metadata: metadata,
            studies: new Map()
          });
        }

        const patient = patientMap.get(patientKey);
        if (!patient.studies.has(studyKey)) {
          patient.studies.set(studyKey, {
            metadata: metadata,
            series: new Map()
          });
        }

        const study = patient.studies.get(studyKey);
        if (!study.series.has(seriesKey)) {
          study.series.set(seriesKey, []);
        }

        study.series.get(seriesKey).push(metadata);
      }

      // CRITICAL: Move files to permanent storage BEFORE creating database records
      let filePathMap: Record<string, string> = {};
      
      if (triageSession.uploadSessionId && triageSession.parseResult?.data) {
        try {
          console.log(`Moving files from temporary upload to permanent patient storage FIRST...`);
          console.log(`Upload session ID: ${triageSession.uploadSessionId}`);
          console.log(`Number of files to move: ${triageSession.parseResult.data.length}`);
          
          // Log first few file paths to debug
          const sampleFiles = triageSession.parseResult.data.slice(0, 3);
          sampleFiles.forEach((file: any) => {
            console.log(`Sample file - fileName: ${file.fileName}, filePath: ${file.filePath}`);
          });
          
          // Move files to permanent storage and get new file path mappings
          filePathMap = await patientStorage.moveDatasetToPermanentStorage(
            triageSession.uploadSessionId,
            triageSession.parseResult.data
          );
          
          console.log(`Successfully moved ${Object.keys(filePathMap).length} files to permanent storage`);
        } catch (error) {
          console.error('Error during file migration to permanent storage:', error);
          return res.status(500).json({ error: error instanceof Error ? error.message : "Failed to move files to permanent storage" });
        }
      }

      const results = [];

      // CRITICAL: Use transaction to ensure data integrity
      const importWithTransaction = async () => {
        for (const [patientKey, patientData] of patientMap) {
          const metadata = patientData.metadata;
          
          console.log(`\n=== Creating database entries for patient: ${metadata.patientID} ===`);
          
          // IMPORTANT: Always re-fetch patient to ensure we have the correct ID
          let dbPatient = await storage.getPatientByID(metadata.patientID);
          if (!dbPatient) {
            console.log(`Creating new patient: ${metadata.patientID}`);
            try {
              dbPatient = await storage.createPatient({
                patientID: metadata.patientID || 'UNKNOWN',
                patientName: metadata.patientName || 'Unknown Patient',
                patientSex: metadata.patientSex || 'U',
                patientAge: metadata.patientAge || '',
                dateOfBirth: metadata.patientBirthDate || ''
              });
              console.log(`Successfully created patient with ID: ${dbPatient.id}`);
              
              // CRITICAL: Verify patient was created correctly
              const verifyPatient = await storage.getPatientByID(metadata.patientID);
              if (!verifyPatient || verifyPatient.id !== dbPatient.id) {
                throw new Error(`Patient creation verification failed! Expected ID ${dbPatient.id} but got ${verifyPatient?.id}`);
              }
            } catch (error) {
              console.error(`ERROR creating patient:`, error);
              throw error;
            }
          } else {
            console.log(`Patient already exists with ID: ${dbPatient.id}`);
            
            // CRITICAL: Verify patient ID matches what we expect
            if (dbPatient.patientID !== metadata.patientID) {
              console.error(`CRITICAL: Patient ID mismatch! Database has ${dbPatient.patientID} but import has ${metadata.patientID}`);
              throw new Error(`Patient ID mismatch detected`);
            }
          }

        const studies = patientData.studies;
        
        for (const [studyKey, studyData] of studies) {
          const studyMetadata = studyData.metadata;
          
          // Create or get study
          let dbStudy = await storage.getStudyByUID(studyMetadata.studyInstanceUID);
          if (!dbStudy) {
            console.log(`Creating new study: ${studyMetadata.studyInstanceUID}`);
            
            // CRITICAL: Re-verify patient exists and has correct ID before creating study
            const currentPatient = await storage.getPatientByID(metadata.patientID);
            if (!currentPatient || currentPatient.id !== dbPatient.id) {
              throw new Error(`Patient verification failed before study creation! Expected patient ID ${dbPatient.id} but found ${currentPatient?.id}`);
            }
            
            try {
              dbStudy = await storage.createStudy({
                patientId: currentPatient.id, // Use freshly verified patient ID
                studyInstanceUID: studyMetadata.studyInstanceUID || generateUID(),
                studyDate: studyMetadata.studyDate || '',
                studyDescription: studyMetadata.studyDescription || '',
                accessionNumber: studyMetadata.accessionNumber || '',
                numberOfSeries: studyData.series.size,
                numberOfImages: Array.from(studyData.series.values()).reduce((sum, s) => sum + s.length, 0),
                patientName: currentPatient.patientName,
                patientID: currentPatient.patientID,
                modality: studyData.series.values().next().value[0].modality || null
              });
              console.log(`Successfully created study with ID: ${dbStudy.id} for patient ID: ${currentPatient.id}`);
              
              // CRITICAL: Verify study was created with correct patient link
              const verifyStudy = await storage.getStudyByUID(studyMetadata.studyInstanceUID);
              if (!verifyStudy || verifyStudy.patientId !== currentPatient.id) {
                throw new Error(`Study creation verification failed! Study ${verifyStudy?.id} has patientId ${verifyStudy?.patientId} but expected ${currentPatient.id}`);
              }
            } catch (error) {
              console.error(`ERROR creating study:`, error);
              console.error(`Study data:`, {
                patientId: currentPatient.id,
                studyInstanceUID: studyMetadata.studyInstanceUID,
                patientName: currentPatient.patientName,
                patientID: currentPatient.patientID
              });
              throw error;
            }
          } else {
            console.log(`Study already exists with ID: ${dbStudy.id}`);
            
            // If an existing study is linked to a different patient but shares the same DICOM patientID,
            // automatically relink it to this patient to recover from prior inconsistent deletes.
            if (dbStudy.patientId !== dbPatient.id) {
              if (dbStudy.patientID && dbStudy.patientID === dbPatient.patientID) {
                console.warn(`Auto-relinking study ${dbStudy.id} from patient ${dbStudy.patientId} to ${dbPatient.id} (same DICOM PatientID=${dbPatient.patientID})`);
                await storage.relinkStudyToPatient(dbStudy.id, dbPatient.id);
              } else {
                console.error(`CRITICAL: Study ${dbStudy.id} is linked to patient ${dbStudy.patientId} but import expects patient ${dbPatient.id}`);
                throw new Error(`Study patient link mismatch detected`);
              }
            }
          }

          const series = studyData.series;
          
          for (const [seriesKey, seriesFiles] of series) {
            const seriesMetadata = seriesFiles[0];
            
            // Create or get series
            let dbSeries = await storage.getSeriesByUID(seriesMetadata.seriesInstanceUID);
            if (!dbSeries) {
              console.log(`Creating new series: ${seriesMetadata.seriesInstanceUID} (${seriesFiles.length} images)`);
              try {
                dbSeries = await storage.createSeries({
                  studyId: dbStudy.id,
                  seriesInstanceUID: seriesMetadata.seriesInstanceUID || generateUID(),
                  seriesNumber: parseInt(seriesMetadata.seriesNumber) || 0,
                  seriesDescription: seriesMetadata.seriesDescription || '',
                  modality: seriesMetadata.modality || 'OT',
                  imageCount: seriesFiles.length,
                  sliceThickness: seriesMetadata.sliceThickness || null,
                  metadata: { 
                    bodyPartExamined: seriesMetadata.bodyPartExamined || '',
                    protocolName: seriesMetadata.protocolName || '' 
                  }
                });
                console.log(`Successfully created series with ID: ${dbSeries.id}`);
              } catch (error) {
                console.error(`ERROR creating series:`, error);
                console.error(`Series data:`, {
                  studyId: dbStudy.id,
                  seriesInstanceUID: seriesMetadata.seriesInstanceUID,
                  modality: seriesMetadata.modality
                });
                throw error;
              }
            } else {
              console.log(`Series already exists with ID: ${dbSeries.id}`);
            }

            // Create images for each file (skip duplicates)
            for (const metadata of seriesFiles) {
              // Check if image already exists
              const existingImage = await storage.getImageByUID(metadata.sopInstanceUID);
              
              if (!existingImage) {
                // Use permanent path from filePathMap
                const permanentPath = filePathMap[metadata.sopInstanceUID];
                
                if (permanentPath && fs.existsSync(permanentPath)) {
                  try {
                    await storage.createImage({
                      seriesId: dbSeries.id,
                      sopInstanceUID: metadata.sopInstanceUID || generateUID(),
                      instanceNumber: parseInt(metadata.instanceNumber) || 1,
                      filePath: permanentPath,  // Use permanent path
                      fileName: metadata.fileName || path.basename(permanentPath),
                      fileSize: fs.statSync(permanentPath).size,
                      imagePosition: metadata.imagePosition || null,
                      imageOrientation: metadata.imageOrientation || null,
                      pixelSpacing: metadata.pixelSpacing || null,
                      sliceLocation: metadata.sliceLocation ? String(metadata.sliceLocation) : null,
                      windowCenter: metadata.windowCenter ? String(metadata.windowCenter) : null,
                      windowWidth: metadata.windowWidth ? String(metadata.windowWidth) : null,
                      metadata: { imported: true },
                    });
                    console.log(`Created image: ${metadata.sopInstanceUID} -> ${permanentPath}`);
                  } catch (imageError) {
                    console.error(`Failed to create image ${metadata.sopInstanceUID}:`, imageError);
                    console.error('Image metadata:', {
                      sopInstanceUID: metadata.sopInstanceUID,
                      seriesId: dbSeries.id,
                      permanentPath
                    });
                  }
                } else {
                  console.log(`Permanent file not found for SOP Instance UID: ${metadata.sopInstanceUID}`);
                  console.log(`Expected path: ${permanentPath}`);
                }
              } else {
                console.log(`Skipping duplicate image: ${metadata.sopInstanceUID}`);
              }
            }

            await storage.updateSeriesImageCount(dbSeries.id, seriesFiles.length);
          }

          await storage.updateStudyCounts(dbStudy.id, series.size, Array.from(series.values()).reduce((sum, s) => sum + s.length, 0));
        }

        results.push({
          patient: dbPatient,
          studiesCount: studies.size,
          totalImages: Array.from(studies.values()).reduce((sum, study) => 
            sum + Array.from(study.series.values()).reduce((seriesSum, series) => seriesSum + series.length, 0), 0)
        });
        }
      };

      // Execute the import with error handling
      try {
        await importWithTransaction();
      } catch (error) {
        console.error('CRITICAL: Import failed with error:', error);
        // Don't clean up on error to preserve data for debugging
        return res.status(500).json({ 
          error: error instanceof Error ? error.message : "Import failed with data integrity error",
          preservedSession: sessionId,
          message: "Upload data preserved for recovery. Please contact support with the session ID."
        });
      }

      // Only clean up if all files were successfully moved
      const movedFileCount = Object.keys(filePathMap).length;
      const totalFileCount = data.length;
      
      if (movedFileCount === totalFileCount) {
        // All files moved successfully, safe to clean up
        console.log(`All ${movedFileCount} files moved successfully. Cleaning up triage session: ${sessionId}`);
        console.log(`Upload session ID for cleanup: ${triageSession.uploadSessionId}`);
        
        triageSessions.delete(sessionId);
        console.log(`Triage session ${sessionId} deleted. Remaining sessions: ${triageSessions.size}`);
        
        // Clean up temporary upload directory
        if (triageSession.uploadSessionId) {
          try {
            patientStorage.cleanupUploadDirectory(triageSession.uploadSessionId);
            console.log(`Cleaned up temporary upload directory: ${triageSession.uploadSessionId}`);
          } catch (error) {
            console.error('Error cleaning up upload directory:', error);
          }
        }
      } else {
        // Some files failed to move, DO NOT clean up
        console.error(`WARNING: Only ${movedFileCount} of ${totalFileCount} files were moved successfully`);
        console.error(`Preserving triage session and upload directory to prevent data loss`);
        console.error(`Upload directory preserved at: uploads/${triageSession.uploadSessionId}`);
      }

      res.json({ 
        success: true, 
        message: `Successfully imported ${data.length} DICOM files from triage`,
        results 
      });

    } catch (error) {
      console.error('Error importing triage session:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to import triage session" });
    }
  });

  // Patient routes
  app.get("/api/patients", async (req, res) => {
    try {
      const patients = await storage.getAllPatients();
      
      // Enhance each patient with their studies and series
      const patientsWithStudies = await Promise.all(
        patients.map(async (patient) => {
          const studies = await storage.getStudiesByPatient(patient.id);
          
          // For each study, get its series
          const studiesWithSeries = await Promise.all(
            studies.map(async (study) => {
              const series = await storage.getSeriesByStudyId(study.id);
              return {
                ...study,
                series
              };
            })
          );
          
          return {
            ...patient,
            studies: studiesWithSeries
          };
        })
      );
      
      res.json(patientsWithStudies);
    } catch (error) {
      console.error('Error fetching patients:', error);
      res.status(500).json({ message: "Failed to fetch patients" });
    }
  });
  
  // Get all series for the patient manager
  app.get("/api/series", async (req, res) => {
    try {
      const series = await storage.getAllSeries();
      res.json(series);
    } catch (error) {
      console.error("Error fetching series:", error);
      res.status(500).json({ error: "Failed to fetch series" });
    }
  });
  
  // Get complete metadata dump for debugging
  app.get("/api/metadata/all", async (req, res) => {
    try {
      const patients = await storage.getAllPatients();
      const studies = await storage.getAllStudies();
      const series = await storage.getAllSeries();
      
      // Get images for each series with metadata
      const seriesWithImages = await Promise.all(
        series.map(async (s) => {
          const images = await storage.getImagesBySeriesId(s.id);
          return {
            ...s,
            images: images.map(img => ({
              id: img.id,
              sopInstanceUID: img.sopInstanceUID,
              instanceNumber: img.instanceNumber,
              sliceLocation: img.sliceLocation,
              windowCenter: img.windowCenter,
              windowWidth: img.windowWidth,
              imagePosition: img.imagePosition,
              imageOrientation: img.imageOrientation,
              pixelSpacing: img.pixelSpacing,
              metadata: img.metadata
            }))
          };
        })
      );
      
      res.json({
        patients,
        studies,
        series: seriesWithImages,
        summary: {
          totalPatients: patients.length,
          totalStudies: studies.length,
          totalSeries: series.length,
          totalImages: seriesWithImages.reduce((sum, s) => sum + s.images.length, 0)
        }
      });
    } catch (error) {
      console.error("Error fetching metadata:", error);
      res.status(500).json({ error: "Failed to fetch metadata" });
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

  app.post("/api/patients", async (req, res) => {
    try {
      const patient = await storage.createPatient(req.body);
      res.status(201).json(patient);
    } catch (error) {
      console.error('Error creating patient:', error);
      res.status(500).json({ message: "Failed to create patient" });
    }
  });

  app.delete("/api/patients/:id", async (req, res) => {
    try {
      const patientId = parseInt(req.params.id);
      await storage.deletePatient(patientId);
      res.json({ success: true, message: "Patient deleted successfully" });
    } catch (error) {
      console.error('Error deleting patient:', error);
      res.status(500).json({ message: "Failed to delete patient" });
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

  // Batch metadata endpoint for performance optimization
  app.post("/api/images/batch-metadata", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { imageIds } = req.body;
      if (!Array.isArray(imageIds) || imageIds.length === 0) {
        return res.status(400).json({ error: 'imageIds array is required' });
      }
      
      // Limit batch size to prevent memory issues
      const MAX_BATCH_SIZE = 100;
      if (imageIds.length > MAX_BATCH_SIZE) {
        return res.status(400).json({ error: `Batch size exceeds maximum of ${MAX_BATCH_SIZE}` });
      }
      
      const results: { [key: number]: any } = {};
      
      // Process images in parallel for better performance
      await Promise.all(imageIds.map(async (imageId) => {
        try {
          const image = await storage.getImage(imageId);
          if (!image || !fs.existsSync(image.filePath)) {
            results[imageId] = { error: 'Image not found' };
            return;
          }
          
          const buffer = fs.readFileSync(image.filePath);
          const byteArray = new Uint8Array(buffer);
          const dataSet = (dicomParser as any).parseDicom(byteArray, {});
          
          const getString = (tag: string) => {
            try { return dataSet.string(tag)?.trim() || null; } catch { return null; }
          };
          
          const getArray = (tag: string) => {
            try { return getString(tag)?.split('\\').map(Number) || null; } catch { return null; }
          };
          
          results[imageId] = {
            imagePosition: getArray('x00200032')?.join('\\') || null,
            imageOrientation: getArray('x00200037')?.join('\\') || null,
            pixelSpacing: getArray('x00280030')?.join('\\') || null,
            sliceLocation: getString('x00201041'),
            frameOfReferenceUID: getString('x00200052'),
            rows: getString('x00280010'),
            columns: getString('x00280011'),
            sopClassUID: getString('x00080016'),
            sopInstanceUID: getString('x00080018'),
            windowCenter: getString('x00281050'),
            windowWidth: getString('x00281051')
          };
        } catch (err) {
          results[imageId] = { error: 'Failed to parse metadata' };
        }
      }));
      
      res.json(results);
    } catch (error) {
      console.error('Error in batch metadata fetch:', error);
      next(error);
    }
  });

  // Get DICOM metadata for proper coordinate transformation
  app.get("/api/images/:imageId/metadata", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const imageId = parseInt(req.params.imageId);
      const image = await storage.getImage(imageId);
      
      if (!image) {
        return res.status(404).json({ error: 'Image not found' });
      }

      // Check if file exists before trying to read it
      if (!fs.existsSync(image.filePath)) {
        return res.status(404).json({ 
          error: 'Image file not found',
          message: 'The DICOM file is missing from the server. This may be test data that was not properly uploaded.',
          filePath: image.filePath 
        });
      }
      
      // Parse DICOM file to extract spatial metadata  
      const buffer = fs.readFileSync(image.filePath);

      // Parse metadata from file

      const byteArray = new Uint8Array(buffer);
      const dataSet = (dicomParser as any).parseDicom(byteArray, {});

      const getString = (tag: string) => {
        try {
          return dataSet.string(tag)?.trim() || null;
        } catch {
          return null;
        }
      };

      const getArray = (tag: string) => {
        try {
          return getString(tag)?.split('\\').map(Number) || null;
        } catch {
          return null;
        }
      };

      const metadata = {
        imagePosition: getArray('x00200032')?.join('\\') || null, // Image Position Patient
        imageOrientation: getArray('x00200037')?.join('\\') || null, // Image Orientation Patient  
        pixelSpacing: getArray('x00280030')?.join('\\') || null, // Pixel Spacing
        sliceLocation: getString('x00201041'), // Slice Location
        frameOfReferenceUID: getString('x00200052'), // Frame of Reference UID
        rows: getString('x00280010'), // Rows  
        columns: getString('x00280011'), // Columns
        sopClassUID: getString('x00080016'), // SOP Class UID
        sopInstanceUID: getString('x00080018'), // SOP Instance UID
        windowCenter: getString('x00281050'), // Window Center
        windowWidth: getString('x00281051') // Window Width
      };

      // Debug: Log extracted metadata
      // Metadata extracted successfully

      res.json(metadata);
    } catch (error) {
      console.error('Error getting image metadata:', error);
      next(error);
    }
  });

  // Serve DICOM image files
  app.get("/api/images/:sopInstanceUID", async (req: Request, res: Response, next: NextFunction) => {
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
      res.setHeader('Access-Control-Allow-Origin', '*');
      
      const fileStream = fs.createReadStream(image.filePath);
      fileStream.pipe(res);
      
    } catch (error) {
      console.error('Error serving DICOM file:', error);
      res.status(500).json({ message: "Failed to serve image" });
    }
  });
  
  // Batch API endpoint for fetching multiple DICOM images at once for performance
  app.post("/api/images/batch", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { sopInstanceUIDs } = req.body;
      
      if (!Array.isArray(sopInstanceUIDs) || sopInstanceUIDs.length === 0) {
        return res.status(400).json({ error: 'Invalid request: sopInstanceUIDs must be a non-empty array' });
      }
      
      // Limit batch size to prevent overwhelming the server
      const MAX_BATCH_SIZE = 50; // Increased to match client batch size for faster loading
      if (sopInstanceUIDs.length > MAX_BATCH_SIZE) {
        return res.status(400).json({ error: `Batch size exceeds maximum of ${MAX_BATCH_SIZE}` });
      }
      
      const results: { [key: string]: { data?: string; error?: string } } = {};
      
      // Process all images in parallel
      await Promise.all(sopInstanceUIDs.map(async (sopInstanceUID) => {
        try {
          const image = await storage.getImageByUID(sopInstanceUID);
          
          if (!image) {
            results[sopInstanceUID] = { error: 'Image not found' };
            return;
          }
          
          if (!fs.existsSync(image.filePath)) {
            results[sopInstanceUID] = { error: 'DICOM file not found' };
            return;
          }
          
          // Read file into buffer
          const buffer = await fs.promises.readFile(image.filePath);
          results[sopInstanceUID] = { data: buffer.toString('base64') };
        } catch (error) {
          console.error(`Error loading DICOM file ${sopInstanceUID}:`, error);
          results[sopInstanceUID] = { error: 'Failed to load DICOM file' };
        }
      }));
      
      res.json(results);
    } catch (error) {
      console.error('Error in batch DICOM fetch:', error);
      res.status(500).json({ error: 'Failed to fetch DICOM files' });
    }
  });



  // Get series thumbnail - either pre-generated or generate on demand
  app.get("/api/series/:seriesId/thumbnail", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const seriesId = parseInt(req.params.seriesId);
      const { mediaGenerator } = await import('./media-generator');
      
      // Try to get or generate thumbnail
      const preview = await mediaGenerator.getOrGeneratePreview(seriesId, 'thumbnail');
      
      if (!preview || !preview.filePath) {
        // Fallback to returning middle DICOM image
        const images = await storage.getImagesBySeriesId(seriesId);
        
        if (!images || images.length === 0) {
          return res.status(404).json({ error: 'No images found for series' });
        }
        
        // Get the middle image for better representation
        const middleIndex = Math.floor(images.length / 2);
        const targetImage = images[middleIndex];
        
        if (!targetImage.filePath || !fs.existsSync(targetImage.filePath)) {
          return res.status(404).json({ error: 'Image file not found' });
        }
        
        // Read and send the DICOM file with proper headers for browser caching
        const buffer = await fs.promises.readFile(targetImage.filePath);
        res.setHeader('Content-Type', 'application/dicom');
        res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
        res.send(buffer);
      } else {
        // Send the pre-generated thumbnail
        if (!fs.existsSync(preview.filePath)) {
          return res.status(404).json({ error: 'Thumbnail file not found' });
        }
        
        const buffer = await fs.promises.readFile(preview.filePath);
        res.setHeader('Content-Type', `image/${preview.format}`);
        res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours
        res.send(buffer);
      }
    } catch (error: any) {
      console.error('Error fetching series thumbnail:', error);
      res.status(500).json({ error: 'Failed to fetch thumbnail' });
    }
  });

  // Get series preview movie (GIF animation)
  app.get("/api/series/:seriesId/preview", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const seriesId = parseInt(req.params.seriesId);
      const { mediaGenerator } = await import('./media-generator');
      
      // Try to get or generate animated preview
      const preview = await mediaGenerator.getOrGeneratePreview(seriesId, 'movie');
      
      if (!preview || !preview.filePath) {
        return res.status(404).json({ error: 'Failed to generate preview' });
      }
      
      if (!fs.existsSync(preview.filePath)) {
        return res.status(404).json({ error: 'Preview file not found' });
      }
      
      const buffer = await fs.promises.readFile(preview.filePath);
      res.setHeader('Content-Type', `image/${preview.format}`);
      res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours
      res.send(buffer);
    } catch (error: any) {
      console.error('Error fetching series preview:', error);
      res.status(500).json({ error: 'Failed to fetch preview' });
    }
  });

  // Trigger background thumbnail generation for all series
  app.post("/api/generate-thumbnails", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { mediaGenerator } = await import('./media-generator');
      
      // Start processing in the background
      mediaGenerator.processAllPendingSeries().catch(console.error);
      
      res.json({ message: 'Thumbnail generation started in background' });
    } catch (error: any) {
      console.error('Error starting thumbnail generation:', error);
      res.status(500).json({ error: 'Failed to start thumbnail generation' });
    }
  });

  // Debug Frame of Reference UID matching
  app.get("/api/studies/:studyId/frame-references", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const studyId = parseInt(req.params.studyId);
      const series = await storage.getSeriesByStudyId(studyId);
      
      const frameReferences: any = {};
      
      for (const s of series) {
        const images = await storage.getImagesBySeriesId(s.id);
        if (images.length > 0) {
          const sampleImage = images[0];
          const buffer = fs.readFileSync(sampleImage.filePath);
          const byteArray = new Uint8Array(buffer);
          const dataSet = (dicomParser as any).parseDicom(byteArray, {});
          const frameOfReferenceUID = dataSet.string('x00200052')?.trim() || null;
          
          frameReferences[s.modality || 'Unknown'] = {
            seriesId: s.id,
            frameOfReferenceUID: frameOfReferenceUID,
            description: s.seriesDescription
          };
        }
      }
      
      res.json(frameReferences);
    } catch (error: any) {
      console.error('Error checking frame references:', error);
      next(error);
    }
  });

  // Get RT structure series for a study (patient-wide search and cross-study association)
  app.get("/api/studies/:studyId/rt-structures", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const studyId = parseInt(req.params.studyId);
      const study = await storage.getStudy(studyId);
      if (!study) {
        return res.status(404).json({ error: 'Study not found' });
      }

      // Gather all series across all studies for this patient
      let allSeriesForPatient: any[] = [];
      if (study.patientId != null) {
        const patientStudies = await storage.getStudiesByPatient(study.patientId);
        for (const ps of patientStudies) {
          const perStudySeries = await storage.getSeriesByStudyId(ps.id);
          allSeriesForPatient.push(...perStudySeries);
        }
      } else {
        // Fallback: only series for this study
        allSeriesForPatient = await storage.getSeriesByStudyId(studyId);
      }

      // RTSTRUCT series can live in any study for the same patient
      const rtSeriesAll = allSeriesForPatient.filter(s => s.modality === 'RTSTRUCT');

      // For each RT structure, determine which CT/MR series it references (search across all patient series)
      const rtSeriesWithAssociations = await Promise.all(rtSeriesAll.map(async (rtSeries) => {
        try {
          const imgs = await storage.getImagesBySeriesId(rtSeries.id);
          if (imgs.length > 0 && imgs[0].filePath) {
            const filePath = imgs[0].filePath;
            if (isDev) logger.debug(`Checking RT structure file path: ${filePath}`, 'rtstruct');

            if (fs.existsSync(filePath)) {
              const rtStructureSet = RTStructureParser.parseRTStructureSet(filePath);

              if (rtStructureSet.referencedSeriesUID) {
                // Look up referenced series across ALL patient series
                const referencedSeries = allSeriesForPatient.find(s => s.seriesInstanceUID === rtStructureSet.referencedSeriesUID);
                if (referencedSeries) {
                  return {
                    ...rtSeries,
                    referencedSeriesId: referencedSeries.id,
                    referencedSeriesDescription: referencedSeries.seriesDescription || `${referencedSeries.modality} Series`,
                    referencedSeriesUID: rtStructureSet.referencedSeriesUID
                  };
                }
              }
            }
          }
        } catch (error) {
          console.log('Error parsing RT structure associations:', error);
        }
        return rtSeries;
      }));

      if (isDev) logger.debug('RT structures with associations (patient-wide): ' + JSON.stringify(rtSeriesWithAssociations.map(rt => ({
        id: rt.id,
        description: rt.seriesDescription,
        referencedSeriesId: (rt as any).referencedSeriesId,
        referencedSeriesDescription: (rt as any).referencedSeriesDescription
      }))), 'rtstruct');
      res.json(rtSeriesWithAssociations);
    } catch (error: any) {
      console.error('Error fetching RT structure series:', error);
      res.status(500).json({ error: 'Failed to fetch RT structure series', details: error.message });
    }
  });

  // Get registration information for a study
  app.get("/api/studies/:studyId/registration", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const studyId = parseInt(req.params.studyId);
      const seriesList = await storage.getSeriesByStudyId(studyId);
      
      // Find registration series
      const regSeries = seriesList.find(s => s.modality === 'REG');
      
      if (!regSeries) {
        return res.json(null);
      }
      
      // Get registration images
      const regImages = await storage.getImagesBySeriesId(regSeries.id);
      
      if (regImages.length === 0) {
        return res.json(null);
      }
      
      // Try to parse registration file for details
      const regImage = regImages[0];
      let registrationInfo = {
        seriesId: regSeries.id,
        description: regSeries.seriesDescription || 'Image Registration',
        hasTransformationMatrix: true,
        sourceModality: 'MR',
        targetModality: 'CT',
        registered: true
      };
      
      try {
        if (regImage.filePath && fs.existsSync(regImage.filePath)) {
          const buffer = fs.readFileSync(regImage.filePath);
          const byteArray = new Uint8Array(buffer);
          const dataSet = dicomParser.parseDicom(byteArray);
          // Prefer Series Description if present
          const seriesDesc = dataSet.string?.('x0008103e'); // Series Description
          if (seriesDesc) {
            registrationInfo.description = seriesDesc;
          }
        }
      } catch (parseError) {
        console.log('Could not parse registration file details:', parseError);
      }
      
      res.json(registrationInfo);
    } catch (error: any) {
      console.error('Error fetching registration:', error);
      res.status(500).json({ error: 'Failed to fetch registration information', details: error.message });
    }
  });

  // Parse and return RT structure contours
  app.get("/api/rt-structures/:seriesId/contours", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const seriesId = parseInt(req.params.seriesId);
      const rtStructSeries = await storage.getSeriesById(seriesId);
      
      if (!rtStructSeries || rtStructSeries.modality !== 'RTSTRUCT') {
        return res.status(404).json({ error: "RT Structure Set not found" });
      }

      // Get the actual RT structure file path from the database
      let rtStructPath: string | null = null;
      
      try {
        const images = await db.select()
          .from(imagesTable)
          .where(eq(imagesTable.seriesId, seriesId))
          .limit(1);
        
        if (images.length > 0 && images[0].filePath) {
          rtStructPath = images[0].filePath;
          console.log('Using RT structure file:', rtStructPath);
        } else {
          return res.status(404).json({ error: "RT Structure file not found in database for series " + seriesId });
        }
      } catch (e) {
        console.error('Error fetching RT structure image:', e);
        return res.status(500).json({ error: "Failed to fetch RT structure file", details: e });
      }
      
      if (!fs.existsSync(rtStructPath)) {
        return res.status(404).json({ error: "RT Structure file not found at: " + rtStructPath });
      }

      // Use cached parsed structure set or parse and cache it
      let rtStructureSet;
      if (rtStructureCache.has(rtStructPath)) {
        rtStructureSet = JSON.parse(JSON.stringify(rtStructureCache.get(rtStructPath)));
      } else {
        rtStructureSet = RTStructureParser.parseRTStructureSet(rtStructPath);
        rtStructureCache.set(rtStructPath, JSON.parse(JSON.stringify(rtStructureSet)));
      }
      
      // Merge with in-memory modifications
      const modifications = rtStructureModifications.get(seriesId);
      if (modifications) {
        // Add new structures
        if (modifications.newStructures.length > 0) {
          rtStructureSet.structures.push(...modifications.newStructures);
        }
        
        // Apply modifications to existing structures
        modifications.modifiedStructures.forEach((modifiedData, roiNumber) => {
          const structureIndex = rtStructureSet.structures.findIndex(s => s.roiNumber === roiNumber);
          if (structureIndex >= 0) {
            rtStructureSet.structures[structureIndex] = {
              ...rtStructureSet.structures[structureIndex],
              ...modifiedData
            };
          }
        });
      }
      
      res.json(rtStructureSet);
    } catch (error: any) {
      console.error('Error parsing RT structures:', error);
      res.status(500).json({ error: 'Failed to parse RT structures', details: error.message });
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
      // Backfill missing MRI geometry (IPP/IOP/PixelSpacing) from on-disk DICOM if needed
      const backfilled: any[] = [];
      for (const img of images) {
        const needsIPP = !img.imagePosition || (Array.isArray(img.imagePosition) && img.imagePosition.length < 3);
        const needsIOP = !img.imageOrientation || (Array.isArray(img.imageOrientation) && img.imageOrientation.length < 6);
        const needsPS = !img.pixelSpacing || (Array.isArray(img.pixelSpacing) && img.pixelSpacing.length < 2);
        const canRead = typeof img.filePath === 'string' && fs.existsSync(img.filePath);
        if ((needsIPP || needsIOP || needsPS) && canRead) {
          try {
            const data = fs.readFileSync(img.filePath);
            const ds = dicomParser.parseDicom(new Uint8Array(data));
            const toArray = (val: string | undefined) => (val ? val.split('\\').map(s => parseFloat(s)) : undefined);
            const ipp = toArray(ds.string?.('x00200032'));
            const iop = toArray(ds.string?.('x00200037'));
            const ps = toArray(ds.string?.('x00280030'));
            const newMeta: any = (typeof img.metadata === 'string' ? (() => { try { return JSON.parse(img.metadata); } catch { return {}; } })() : (img.metadata || {}));
            if (ipp && ipp.length >= 3) newMeta.imagePositionPatient = ipp;
            if (iop && iop.length >= 6) newMeta.imageOrientationPatient = iop;
            if (ps && ps.length >= 2) newMeta.pixelSpacing = ps;
            await storage.updateImageGeometry(img.id, {
              imagePosition: (ipp && ipp.length >= 3) ? `${ipp[0]}\\${ipp[1]}\\${ipp[2]}` : img.imagePosition || null,
              imageOrientation: (iop && iop.length >= 6) ? `${iop[0]}\\${iop[1]}\\${iop[2]}\\${iop[3]}\\${iop[4]}\\${iop[5]}` : img.imageOrientation || null,
              pixelSpacing: (ps && ps.length >= 2) ? `${ps[0]}\\${ps[1]}` : img.pixelSpacing || null,
              metadata: newMeta,
            });
            backfilled.push(img.id);
          } catch (e) {
            // continue without failing the request
          }
        }
      }
      res.json(images);
    } catch (error) {
      console.error('Error fetching images:', error);
      res.status(500).json({ message: "Failed to fetch images" });
    }
  });

  // Get series thumbnail
  app.get("/api/series/:id/thumbnail", async (req, res) => {
    try {
      const seriesId = parseInt(req.params.id);
      const images = await storage.getImagesBySeriesId(seriesId);
      
      if (!images || images.length === 0) {
        return res.status(404).json({ error: 'No images found in series' });
      }

      // Get the middle image
      const middleIndex = Math.floor(images.length / 2);
      const targetImage = images[middleIndex];

      // Return the raw DICOM file for now - client will handle rendering
      const filePath = targetImage.filePath?.startsWith('storage/') 
        ? targetImage.filePath 
        : path.join('storage', targetImage.filePath || '');

      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Image file not found' });
      }

      // For now, just send the DICOM file and let client handle it
      // In production, you'd render this to a PNG/JPEG thumbnail
      res.setHeader('Content-Type', 'application/dicom');
      const fileStream = fs.createReadStream(filePath);
      fileStream.pipe(res);
    } catch (error) {
      console.error('Error fetching thumbnail:', error);
      res.status(500).json({ error: 'Failed to fetch thumbnail' });
    }
  });

  // Render image as PNG/JPEG
  app.get("/api/images/:sopInstanceUID/render", async (req, res) => {
    try {
      const { sopInstanceUID } = req.params;
      const { size } = req.query;
      
      // Get the image from storage
      const images = await db.select()
        .from(imagesTable)
        .where(eq(imagesTable.sopInstanceUID, sopInstanceUID))
        .limit(1);

      if (images.length === 0) {
        return res.status(404).json({ error: 'Image not found' });
      }

      const image = images[0];
      const filePath = image.filePath?.startsWith('storage/') 
        ? image.filePath 
        : path.join('storage', image.filePath || '');

      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Image file not found' });
      }

      // For now, return the raw DICOM file
      // In a production app, you'd use a DICOM rendering library to convert to PNG/JPEG
      res.setHeader('Content-Type', 'application/dicom');
      const fileStream = fs.createReadStream(filePath);
      fileStream.pipe(res);
    } catch (error) {
      console.error('Error rendering image:', error);
      res.status(500).json({ error: 'Failed to render image' });
    }
  });

  // Get pixel data for an image
  app.get('/api/images/:id/pixels', async (req, res) => {
    try {
      const imageId = parseInt(req.params.id);
      const image = await storage.getImage(imageId);
      if (!image || !image.filePath) {
        return res.status(404).json({ error: 'Image not found' });
      }

      const filePath = image.filePath.startsWith('uploads/') 
        ? image.filePath 
        : path.join('uploads', image.filePath);
      const buffer = await fs.promises.readFile(filePath);
      
      // Parse DICOM file
      const byteArray = new Uint8Array(buffer);
      const dataSet = dicomParser.parseDicom(byteArray, { untilTag: 'x7fe00010' });
      
      // Get pixel data
      const pixelDataElement = dataSet.elements.x7fe00010;
      if (!pixelDataElement) {
        return res.status(400).json({ error: 'No pixel data found' });
      }

      // Get image dimensions
      const rows = dataSet.uint16('x00280010') || 512;
      const columns = dataSet.uint16('x00280011') || 512;
      const windowCenter = parseFloat(dataSet.string('x00281050') || '40');
      const windowWidth = parseFloat(dataSet.string('x00281051') || '400');
      
      // Get pixel data bytes - the pixel data starts at the element's dataOffset in the original buffer
      const pixelDataOffset = pixelDataElement.dataOffset;
      const pixelDataLength = pixelDataElement.length;
      
      // Create a view of the pixel data from the original buffer
      const pixels16 = new Uint16Array(buffer.buffer, buffer.byteOffset + pixelDataOffset, pixelDataLength / 2);
      
      // Convert to 8-bit RGBA for canvas
      const pixels8 = new Uint8ClampedArray(rows * columns * 4);
      
      for (let i = 0; i < pixels16.length; i++) {
        // Apply window/level
        const pixelValue = pixels16[i];
        const minValue = windowCenter - windowWidth / 2;
        const maxValue = windowCenter + windowWidth / 2;
        
        let normalizedValue = (pixelValue - minValue) / (maxValue - minValue);
        normalizedValue = Math.max(0, Math.min(1, normalizedValue));
        const grayscale = Math.floor(normalizedValue * 255);
        
        const offset = i * 4;
        pixels8[offset] = grayscale;     // R
        pixels8[offset + 1] = grayscale; // G
        pixels8[offset + 2] = grayscale; // B
        pixels8[offset + 3] = 255;       // A
      }

      res.json({
        width: columns,
        height: rows,
        pixels: Array.from(pixels8)
      });
    } catch (error: any) {
      console.error('Error fetching pixel data:', error);
      res.status(500).json({ error: error.message || 'Failed to fetch pixel data' });
    }
  });

  // Generate GIF preview for a series
  app.get("/api/series/:id/gif", async (req, res) => {
    try {
      const seriesId = parseInt(req.params.id);
      
      // TEMPORARY: Return a minimal working GIF to test
      const minimalGif = Buffer.from([
        0x47, 0x49, 0x46, 0x38, 0x39, 0x61, // GIF89a
        0x0A, 0x00, 0x0A, 0x00, // 10x10 pixels
        0xF0, 0x00, 0x00, // Global color table
        0x00, 0x00, 0x00, 0xFF, 0xFF, 0xFF, // Black and white colors
        0x21, 0xF9, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, // Graphics control
        0x2C, 0x00, 0x00, 0x00, 0x00, 0x0A, 0x00, 0x0A, 0x00, 0x00, // Image descriptor
        0x02, 0x16, 0x8C, 0x2D, 0x99, 0x87, 0x2A, 0x1C, 0xDC, 0x33, 0xA0, 0x02, 0x75,
        0xEC, 0x95, 0xFA, 0xA8, 0xDE, 0x60, 0x8C, 0x04, 0x91, 0x4C, 0x01, 0x00, // Image data
        0x3B // Trailer
      ]);
      
      res.setHeader('Content-Type', 'image/gif');
      res.setHeader('Content-Length', minimalGif.length.toString());
      return res.send(minimalGif);
      
      const series = await storage.getSeries(seriesId);
      
      if (!series) {
        return res.status(404).json({ message: "Series not found" });
      }
      
      // Check if GIF already exists in cache
      const gifCachePath = path.join('uploads', 'gif-cache', `series-${seriesId}.gif`);
      const gifCacheDir = path.dirname(gifCachePath);
      
      // Create cache directory if it doesn't exist
      if (!fs.existsSync(gifCacheDir)) {
        fs.mkdirSync(gifCacheDir, { recursive: true });
      }
      
      // If cached GIF exists and is newer than 24 hours, serve it
      if (fs.existsSync(gifCachePath)) {
        const stats = fs.statSync(gifCachePath);
        const ageInHours = (Date.now() - stats.mtimeMs) / (1000 * 60 * 60);
        
        if (ageInHours < 24) {
          console.log(`Serving cached GIF for series ${seriesId}`);
          const gifBuffer = fs.readFileSync(gifCachePath);
          res.setHeader('Content-Type', 'image/gif');
          res.setHeader('Cache-Control', 'public, max-age=86400'); // 24 hours
          res.setHeader('Content-Length', gifBuffer.length.toString());
          return res.send(gifBuffer);
        }
      }
      
      // Generate new GIF
      console.log(`Generating GIF for series ${seriesId}...`);
      let gifBuffer;
      
      try {
        gifBuffer = await generateSeriesGIF(seriesId, storage);
      } catch (error) {
        console.error('GIF generation failed, using minimal GIF:', error);
        // Use a minimal 1x1 GIF as fallback
        gifBuffer = Buffer.from([
          0x47, 0x49, 0x46, 0x38, 0x39, 0x61, // GIF89a
          0x01, 0x00, 0x01, 0x00, // 1x1 pixel
          0x80, 0x00, 0x00, // Global color table
          0x00, 0x00, 0x00, 0xFF, 0xFF, 0xFF, // Black and white
          0x21, 0xF9, 0x04, 0x01, 0x00, 0x00, 0x00, 0x00, // Graphics control
          0x2C, 0x00, 0x00, 0x00, 0x00, // Image descriptor
          0x01, 0x00, 0x01, 0x00, 0x00,
          0x02, 0x02, 0x44, 0x01, 0x00, // Image data
          0x3B // Trailer
        ]);
      }
      
      // Save to cache
      fs.writeFileSync(gifCachePath, gifBuffer);
      
      // Send response
      res.setHeader('Content-Type', 'image/gif');
      res.setHeader('Cache-Control', 'public, max-age=86400'); // 24 hours
      res.setHeader('Content-Length', gifBuffer.length.toString());
      res.send(gifBuffer);
      
    } catch (error) {
      console.error('Error generating GIF:', error);
      res.status(500).json({ message: "Failed to generate GIF preview" });
    }
  });

  // Get registration data for a study
  app.get("/api/registrations/:studyId", async (req, res) => {
    try {
      const studyId = parseInt(req.params.studyId);
      
      // Quick safety: if CT and MR in this study share FrameOfReferenceUID, use identity transform
      try {
        const seriesList = await storage.getSeriesByStudyId(studyId);
        const ctSeries = seriesList.find((s: any) => s.modality === 'CT');
        const mrSeries = seriesList.find((s: any) => s.modality === 'MR');
        if (ctSeries && mrSeries) {
          const [ctImg] = await storage.getImagesBySeriesId(ctSeries.id);
          const [mrImg] = await storage.getImagesBySeriesId(mrSeries.id);
          if (ctImg && mrImg) {
            let ctFoR: string | null = null;
            let mrFoR: string | null = null;
            // Prefer reading from metadata JSON if present
            const readFoRFromMeta = (meta: any) => {
              try {
                if (meta && typeof meta === 'string') {
                  const parsed = JSON.parse(meta);
                  return parsed?.FrameOfReferenceUID || parsed?.frameOfReferenceUID || null;
                }
                if (meta && typeof meta === 'object') {
                  return meta.FrameOfReferenceUID || meta.frameOfReferenceUID || null;
                }
              } catch {}
              return null;
            };
            ctFoR = readFoRFromMeta(ctImg.metadata);
            mrFoR = readFoRFromMeta(mrImg.metadata);
            // If not available in DB metadata, read directly from DICOM files
            if ((!ctFoR || !mrFoR) && fs.existsSync(ctImg.filePath) && fs.existsSync(mrImg.filePath)) {
              try {
                const ctData = fs.readFileSync(ctImg.filePath);
                const mrData = fs.readFileSync(mrImg.filePath);
                const ctDS = dicomParser.parseDicom(new Uint8Array(ctData));
                const mrDS = dicomParser.parseDicom(new Uint8Array(mrData));
                ctFoR = ctFoR || ctDS.string?.('x00200052') || null;
                mrFoR = mrFoR || mrDS.string?.('x00200052') || null;
              } catch {}
            }
            // Identity fallback is ONLY allowed when the two series are the SAME modality
            // (e.g., CT with contrast vs non-contrast within the same frame), never for CT↔MR
            if (ctFoR && mrFoR && ctFoR === mrFoR && ctSeries.modality === mrSeries.modality) {
              return res.json({
                transformationMatrix: [
                  1, 0, 0, 0,
                  0, 1, 0, 0,
                  0, 0, 1, 0,
                  0, 0, 0, 1,
                ],
                matrixType: 'IDENTITY_FoR_MATCH_SAME_MODALITY'
              });
            }
          }
        }
      } catch (e) {
        // Non-fatal, continue to normal registration retrieval
        console.warn('FoR quick-check failed, falling back to stored/parsed registration');
      }
      
      // First, check if we have a registration in the database
      const registration = await storage.getRegistrationByStudyId(studyId);
      if (registration) {
        // Parse the transformation matrix to ensure it's a flat 16-element array
        let matrix = registration.transformationMatrix;
        if (typeof matrix === 'string') {
          try {
            // Handle PostgreSQL array format: {{"1","0",...},{"0","1",...},...}
            let cleanMatrix = matrix;
            
            // Remove outer braces and split by },{ to get rows
            if (matrix.startsWith('{{') && matrix.endsWith('}}')) {
              cleanMatrix = matrix.slice(2, -2); // Remove outer {{}}
              const rows = cleanMatrix.split('},{');
              
              // Parse each row and flatten
              const parsedRows = rows.map(row => {
                const elements = row.split(',').map(el => parseFloat(el.replace(/"/g, '')));
                return elements;
              });
              
              matrix = parsedRows.flat();
            } else {
              // Try standard JSON parsing
              const parsed = JSON.parse(matrix);
              if (Array.isArray(parsed) && Array.isArray(parsed[0])) {
                matrix = parsed.flat();
              } else if (Array.isArray(parsed)) {
                matrix = parsed;
              }
            }
          } catch (e) {
            console.error('Failed to parse registration matrix:', e);
            console.log('Raw matrix string:', matrix);
            matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; // Identity matrix fallback
          }
        } else if (Array.isArray(matrix)) {
          // Already an array, check if nested or flat
          if (Array.isArray(matrix[0])) {
            matrix = matrix.flat();
          }
        } else {
          // Not a string or array, use identity matrix
          matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
        }
        
        // Ensure matrix is MRI→CT. If we can infer MR/CT sample positions, verify direction.
        try {
          const seriesList = await storage.getSeriesByStudyId(studyId);
          const ctSeries = seriesList.find((s: any) => s.modality === 'CT');
          const mrSeries = seriesList.find((s: any) => s.modality === 'MR');
          if (ctSeries && mrSeries) {
            const [ctImg] = await storage.getImagesBySeriesId(ctSeries.id);
            const [mrImg] = await storage.getImagesBySeriesId(mrSeries.id);
            const parseArr = (v: any): number[] => Array.isArray(v) ? v.map(Number) : (typeof v === 'string' ? v.split('\\').map(Number) : []);
            const mrPos = parseArr((mrImg as any).imagePosition ?? (mrImg as any).metadata?.imagePositionPatient);
            const ctPos = parseArr((ctImg as any).imagePosition ?? (ctImg as any).metadata?.imagePositionPatient);
            const mat = matrix as number[];
            if (mrPos.length >= 3 && ctPos.length >= 3 && Array.isArray(mat) && mat.length === 16) {
              const map = (m: number[], p: number[]) => [
                m[0]*p[0] + m[1]*p[1] + m[2]*p[2] + m[3],
                m[4]*p[0] + m[5]*p[1] + m[6]*p[2] + m[7],
                m[8]*p[0] + m[9]*p[1] + m[10]*p[2] + m[11],
              ];
              const mrToCT = map(mat, mrPos);
              const distDirect = Math.hypot(mrToCT[0]-ctPos[0], mrToCT[1]-ctPos[1], mrToCT[2]-ctPos[2]);
              // Try inverse direction
              const inv = [
                mat[0],mat[4],mat[8],mat[12],
                mat[1],mat[5],mat[9],mat[13],
                mat[2],mat[6],mat[10],mat[14],
                mat[3],mat[7],mat[11],mat[15]
              ]; // transpose as quick heuristic if stored column-major
              const mrToCT_invGuess = map(inv, mrPos);
              const distInv = Math.hypot(mrToCT_invGuess[0]-ctPos[0], mrToCT_invGuess[1]-ctPos[1], mrToCT_invGuess[2]-ctPos[2]);
              if (distInv < distDirect) {
                matrix = inv; // use transposed if it matches better
              }
            }
          }
        } catch {}
        res.json({ transformationMatrix: matrix, matrixType: registration.matrixType || 'RIGID' });
        return;
      }
      
      // Auto-parse fallback: if nothing in DB, try to parse current study's REG now
      const autoParseAndReturn = async () => {
        // Find registration series for this study
        const seriesList = await storage.getSeriesByStudyId(studyId);
        const regSeries = seriesList.find((s: any) => s.modality === 'REG');
        if (!regSeries) {
          return null;
        }

        const regImages = await storage.getImagesBySeriesId(regSeries.id);
        if (!regImages || regImages.length === 0) {
          return null;
        }

        const regImage = regImages[0];
        const filePath = regImage.filePath;
        if (!fs.existsSync(filePath)) {
          return null;
        }

        // Parse REG and select a non-identity matrix (prefer last)
        const dicomData = fs.readFileSync(filePath);
        const dataSet = dicomParser.parseDicom(new Uint8Array(dicomData));

        let transformationMatrix: number[][] = [
          [1, 0, 0, 0],
          [0, 1, 0, 0],
          [0, 0, 1, 0],
          [0, 0, 0, 1],
        ];

        const candidates: number[][][] = [];

        // Robust parsing of Registration -> MatrixRegistrationSequence -> MatrixSequence
        try {
          const regSeq = (dataSet as any).elements?.['x00700308']; // Registration Sequence
          if (regSeq?.items?.length) {
            for (const regItem of regSeq.items) {
              const mrs = regItem.dataSet?.elements?.['x00700309']; // Matrix Registration Sequence
              if (mrs?.items?.length) {
                for (const mrItem of mrs.items) {
                  const mseq = mrItem.dataSet?.elements?.['x0070030a']; // Matrix Sequence
                  if (mseq?.items?.length) {
                    for (const mItem of mseq.items) {
                      // Per DICOM, the numeric 4x4 is FrameOfReferenceTransformationMatrix (3006,00C6)
                      const matStr = mItem.dataSet?.string?.('x300600c6');
                      if (matStr && typeof matStr === 'string') {
                        const nums = matStr.split('\\').map((s: string) => parseFloat(s)).filter((n: number) => !Number.isNaN(n));
                        if (nums.length === 16) {
                          const cand = [
                            nums.slice(0, 4),
                            nums.slice(4, 8),
                            nums.slice(8, 12),
                            nums.slice(12, 16),
                          ];
                          // Skip identity to prefer actual transforms
                          if (!(cand[0][0] === 1 && cand[1][1] === 1 && cand[2][2] === 1 && cand[0][1] === 0 && cand[0][2] === 0 && cand[1][0] === 0 && cand[1][2] === 0 && cand[2][0] === 0 && cand[2][1] === 0 && cand[0][3] === 0 && cand[1][3] === 0 && cand[2][3] === 0)) {
                            candidates.push(cand);
                          } else if (candidates.length === 0) {
                            // Keep identity as a possible fallback only if nothing else
                            candidates.push(cand);
                          }
                        }
                      } else {
                        // As a last resort, try to parse raw bytes if present (rare)
                        const matElem = mItem.dataSet?.elements?.['x300600c6'];
                        if (matElem) {
                          const byteArray: Uint8Array = (mItem.dataSet as any).byteArray;
                          const dataOffset: number = (matElem as any).dataOffset;
                          const length: number = (matElem as any).length;
                          const view = new DataView(byteArray.buffer, byteArray.byteOffset + dataOffset, length);
                          const nums: number[] = [];
                          // DS is text, but some writers might store as doubles; be defensive
                          for (let j = 0; j + 8 <= length && nums.length < 16; j += 8) {
                            nums.push(view.getFloat64(j, true));
                          }
                          if (nums.length === 16) {
                            const cand = [
                              nums.slice(0, 4),
                              nums.slice(4, 8),
                              nums.slice(8, 12),
                              nums.slice(12, 16),
                            ];
                            candidates.push(cand);
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        } catch (e) {
          console.warn('Registration auto-parse: error traversing matrix sequences', e);
        }

        if (candidates.length) {
          // Prefer the last candidate (often the final transform in a chain)
          transformationMatrix = candidates[candidates.length - 1];
        } else {
          // Fallback: try pre/post deformation matrices (rare)
          const pre = dataSet.string?.('x00185210');
          const post = dataSet.string?.('x00185212');
          const matrixString = pre || post;
          if (matrixString) {
            const values = matrixString.split('\\').map((v: string) => parseFloat(v)).filter((n) => !Number.isNaN(n));
            if (values.length === 16) {
              transformationMatrix = [
                values.slice(0, 4),
                values.slice(4, 8),
                values.slice(8, 12),
                values.slice(12, 16),
              ];
            }
          }
        }

        // Persist and return flat array
        await storage.deleteRegistrationByStudyId(studyId).catch(() => {});
        await storage.createRegistration({
          studyId,
          seriesInstanceUid: regSeries.seriesInstanceUID,
          sopInstanceUid: regImage.sopInstanceUID,
          sourceFrameOfReferenceUid: dataSet.string?.('x00200052') || 'unknown',
          targetFrameOfReferenceUid: dataSet.string?.('x00200052') || 'unknown',
          transformationMatrix,
          matrixType: 'RIGID',
          metadata: { seriesDescription: regSeries.seriesDescription, parsedFrom: filePath },
        });

        return transformationMatrix.flat();
      };

      const auto = await autoParseAndReturn();
      if (auto && Array.isArray(auto) && auto.length === 16) {
        res.json({ transformationMatrix: auto, matrixType: 'RIGID' });
        return;
      }

      // Nothing found
      res.json(null);
    } catch (error) {
      console.error("Error fetching registration:", error);
      res.status(500).json({ error: "Failed to fetch registration" });
    }
  });

  // Delete registration for a study
  app.delete("/api/registrations/:studyId", async (req, res) => {
    try {
      const studyId = parseInt(req.params.studyId);
      await storage.deleteRegistrationByStudyId(studyId);
      res.json({ success: true, message: 'Registration deleted' });
    } catch (error: any) {
      console.error('Error deleting registration:', error);
      res.status(500).json({ error: 'Failed to delete registration', details: error.message });
    }
  });

  // Parse and populate registration from DICOM REG file
  app.post("/api/registrations/:studyId/parse", async (req, res) => {
    try {
      const studyId = parseInt(req.params.studyId);
      console.log('🔍 Parsing registration for study:', studyId);
      
      // Get all series for this study
      const seriesList = await storage.getSeriesByStudyId(studyId);
      
      // Find registration series
      const regSeries = seriesList.find(s => s.modality === 'REG');
      if (!regSeries) {
        return res.status(404).json({ error: 'No registration series found for this study' });
      }
      
      console.log('✅ Found registration series:', {
        id: regSeries.id,
        description: regSeries.seriesDescription
      });
      
      // Get registration images
      const regImages = await storage.getImagesBySeriesId(regSeries.id);
      if (regImages.length === 0) {
        return res.status(404).json({ error: 'No registration images found' });
      }
      
      const regImage = regImages[0];
      const filePath = regImage.filePath;
      console.log('📄 Registration file path:', filePath);
      
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Registration file not found at: ' + filePath });
      }
      
      // Parse the DICOM registration file
      const dicomData = fs.readFileSync(filePath);
      const dataSet = dicomParser.parseDicom(new Uint8Array(dicomData));
      
      // Extract Frame of Reference UIDs
      const sourceFrameOfRef = dataSet.string('x00200052'); // Frame of Reference UID
      console.log('Source Frame of Reference:', sourceFrameOfRef);
      
      // Extract actual transformation matrix from DICOM registration data
      let transformationMatrix = [
        [1, 0, 0, 0],
        [0, 1, 0, 0],
        [0, 0, 1, 0],
        [0, 0, 0, 1]
      ];
      
      try {
        // Check for Registration Sequence (0070,0308)
        const registrationSequence = (dataSet as any).elements?.['x00700308'];
        if (registrationSequence?.items?.length) {
          console.log('📊 Found Registration Sequence with', registrationSequence.items.length, 'items');
          const candidateMatrices: Array<{ index: number; matrix: number[][] }> = [];

          for (let regIdx = 0; regIdx < registrationSequence.items.length; regIdx++) {
            const regItem = registrationSequence.items[regIdx];
            const matrixRegSeq = regItem.dataSet?.elements?.['x00700309'];
            if (!matrixRegSeq?.items?.length) continue;

            // Iterate matrices within the registration
            for (let mIdx = 0; mIdx < matrixRegSeq.items.length; mIdx++) {
              const matrixItem = matrixRegSeq.items[mIdx];

              // Preferred: Standard tag (0070,030C) FD 16
              const matrixElement = matrixItem.dataSet?.elements?.['x0070030c'];
              if (matrixElement) {
                const byteArray: Uint8Array = (matrixItem.dataSet as any).byteArray;
                const dataOffset: number = (matrixElement as any).dataOffset;
                const length: number = (matrixElement as any).length;
                const view = new DataView(byteArray.buffer, byteArray.byteOffset + dataOffset, length);
                const values: number[] = [];
                for (let j = 0; j + 8 <= length && values.length < 16; j += 8) {
                  values.push(view.getFloat64(j, true));
                }
                if (values.length === 16) {
                  const cand = [
                    values.slice(0, 4),
                    values.slice(4, 8),
                    values.slice(8, 12),
                    values.slice(12, 16),
                  ];
                  if (!(cand[0][0] === 1 && cand[1][1] === 1 && cand[2][2] === 1)) {
                    candidateMatrices.push({ index: regIdx, matrix: cand });
                    continue;
                  }
                }
              }

              // Eclipse-style nesting: MatrixSequence (0070,030A) with 0070,030C as string-like values
              const matrixSeq = matrixItem.dataSet?.elements?.['x0070030a'];
              if (matrixSeq?.items?.length) {
                const seqItem = matrixSeq.items[0];
                const txt = seqItem.dataSet?.string?.('x0070030c');
                if (txt) {
                  const values = txt.split('\\').map((v: string) => parseFloat(v));
                  if (values.length === 16) {
                    const cand = [
                      values.slice(0, 4),
                      values.slice(4, 8),
                      values.slice(8, 12),
                      values.slice(12, 16),
                    ];
                    if (!(cand[0][0] === 1 && cand[1][1] === 1 && cand[2][2] === 1)) {
                      candidateMatrices.push({ index: regIdx, matrix: cand });
                      continue;
                    }
                  }
                }
              }
            }
          }

          if (candidateMatrices.length) {
            const selected = candidateMatrices[candidateMatrices.length - 1];
            transformationMatrix = selected.matrix;
            console.log(`✅ Selected transformation matrix from item ${selected.index} (last valid)`);
          } else {
            console.log('⚠️ No valid non-identity matrices found in registration sequence');
          }
        }

        // Alternative: Check for Pre-/Post-concatenation matrix (rare)
        if (transformationMatrix[0][0] === 1 && transformationMatrix[1][1] === 1 && transformationMatrix[2][2] === 1) {
          const preMatrix = dataSet.string?.('x00185210');
          const postMatrix = dataSet.string?.('x00185212');
          const matrixString = preMatrix || postMatrix;
          if (matrixString) {
            const values = matrixString.split('\\').map((v: string) => parseFloat(v));
            if (values.length === 16) {
              transformationMatrix = [
                values.slice(0, 4),
                values.slice(4, 8),
                values.slice(8, 12),
                values.slice(12, 16),
              ];
              console.log('✅ Extracted matrix from Pre/Post concatenation');
            }
          }
        }

      } catch (parseError) {
        console.warn('⚠️ Could not parse transformation matrix from REG file:', parseError);
        console.log('Using identity matrix as fallback');
      }
      
      // Check if registration already exists and delete it to force reparse
      const existing = await storage.getRegistrationByStudyId(studyId);
      if (existing) {
        console.log('⚠️ Registration already exists for this study - deleting to reparse with new logic');
        await storage.deleteRegistrationByStudyId(studyId);
      }
      
      // Create registration entry
      const registration = await storage.createRegistration({
        studyId: studyId,
        seriesInstanceUid: regSeries.seriesInstanceUID,
        sopInstanceUid: regImage.sopInstanceUID,
        sourceFrameOfReferenceUid: sourceFrameOfRef || 'unknown',
        targetFrameOfReferenceUid: sourceFrameOfRef || 'unknown',
        transformationMatrix: transformationMatrix,
        matrixType: 'RIGID',
        metadata: {
          seriesDescription: regSeries.seriesDescription,
          parsedFrom: filePath
        }
      });
      
      console.log('✅ Registration created:', registration);
      
      res.json({ 
        success: true,
        message: 'Registration parsed and saved',
        registration: registration
      });
      
    } catch (error: any) {
      console.error('❌ Error parsing registration:', error);
      res.status(500).json({ 
        error: 'Failed to parse registration', 
        details: error.message 
      });
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

  app.post("/api/pacs", async (req, res) => {
    try {
      const connection = await storage.createPacsConnection(req.body);
      res.status(201).json(connection);
    } catch (error) {
      console.error('Error creating PACS connection:', error);
      res.status(500).json({ message: "Failed to create PACS connection" });
    }
  });

  // Create new RT structure
  app.post("/api/rt-structures", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { studyId, structureName, color } = req.body;
      
      if (!studyId || !structureName || !color) {
        return res.status(400).json({ message: "Study ID, structure name, and color are required" });
      }

      if (!Array.isArray(color) || color.length !== 3) {
        return res.status(400).json({ message: "Color must be an RGB array [r, g, b]" });
      }

      // Find the RT structure series for this study
      const series = await storage.getSeriesByStudyId(studyId);
      const rtSeries = series.find(s => s.modality === 'RTSTRUCT');
      
      if (!rtSeries) {
        return res.status(404).json({ message: "No RT Structure Set found for this study" });
      }

      const newStructure = {
        roiNumber: Math.floor(Math.random() * 1000) + 100, // Generate random ROI number
        structureName: structureName,
        color: color,
        contours: [] // Empty contours initially
      };

      // Initialize modifications storage if not exists
      if (!rtStructureModifications.has(rtSeries.id)) {
        rtStructureModifications.set(rtSeries.id, {
          newStructures: [],
          modifiedStructures: new Map(),
          history: [],
          historyIndex: -1
        });
      }

      // Add the new structure to in-memory storage
      const modifications = rtStructureModifications.get(rtSeries.id)!;
      modifications.newStructures.push(newStructure);

      console.log('Created new RT structure:', newStructure);
      console.log('Current modifications:', modifications);
      
      res.status(201).json(newStructure);
    } catch (error) {
      console.error('Error creating RT structure:', error);
      next(error);
    }
  });

  // Update RT structure name
  app.patch("/api/rt-structures/:structureId/name", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const structureId = parseInt(req.params.structureId);
      const { name } = req.body;
      
      if (!name || typeof name !== 'string') {
        return res.status(400).json({ message: "Name is required" });
      }

      await storage.updateRTStructureName(structureId, name);
      res.json({ success: true, message: "Structure name updated" });
    } catch (error) {
      console.error('Error updating structure name:', error);
      next(error);
    }
  });

  // Update RT structure color
  app.patch("/api/rt-structures/:structureId/color", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const structureId = parseInt(req.params.structureId);
      const { color } = req.body;
      
      if (!color || !Array.isArray(color) || color.length !== 3) {
        return res.status(400).json({ message: "Color must be an RGB array [r, g, b]" });
      }

      await storage.updateRTStructureColor(structureId, color);
      res.json({ success: true, message: "Structure color updated" });
    } catch (error) {
      console.error('Error updating structure color:', error);
      next(error);
    }
  });

  // Update RT structure contours (for brush/pen tool edits)
  app.put("/api/rt-structures/:seriesId/contours", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const seriesId = parseInt(req.params.seriesId);
      const { structures, action, operation, points, slicePosition, structureId } = req.body;
      
      if (!structures || !Array.isArray(structures)) {
        return res.status(400).json({ message: "Structures array is required" });
      }

      // Handle server-side boolean operations for pen tool
      if (action === 'pen_boolean_operation' && operation === 'subtract' && points && structureId && slicePosition !== undefined) {
        console.log('🔧 Server performing subtraction operation:', { structureId, slicePosition, operation });
        
        // Find the target structure
        const targetStructure = structures.find(s => s.roiNumber === structureId);
        if (targetStructure && targetStructure.contours) {
          // Find contours at the current slice position
          const existingContours = targetStructure.contours.filter(c => 
            Math.abs(c.slicePosition - slicePosition) < 0.1
          );
          
          if (existingContours.length > 0) {
            console.log(`Found ${existingContours.length} existing contours to subtract from`);
            
            // Convert new points to 2D polygon
            const newPolygon = [];
            for (let i = 0; i < points.length; i += 3) {
              newPolygon.push([points[i], points[i + 1]]);
            }
            
            // Simple subtraction: remove any existing contours that the new polygon overlaps with
            const remainingContours = targetStructure.contours.filter(contour => {
              // Skip contours not at current slice
              if (Math.abs(contour.slicePosition - slicePosition) >= 0.1) {
                return true; // Keep contours from other slices
              }
              
              // Convert contour to 2D polygon
              const contourPolygon = [];
              for (let i = 0; i < contour.points.length; i += 3) {
                contourPolygon.push([contour.points[i], contour.points[i + 1]]);
              }
              
              // Check if new polygon overlaps with this contour
              const overlaps = polygonOverlaps(newPolygon, contourPolygon);
              if (overlaps) {
                console.log('🗑️ Removing overlapping contour');
                return false; // Remove this contour
              }
              
              return true; // Keep this contour
            });
            
            // Update the structure with remaining contours
            targetStructure.contours = remainingContours;
            console.log(`✅ Subtraction complete: ${existingContours.length - remainingContours.filter(c => Math.abs(c.slicePosition - slicePosition) < 0.1).length} contours removed`);
          }
        }
      }

      // Initialize modifications storage if not exists
      if (!rtStructureModifications.has(seriesId)) {
        rtStructureModifications.set(seriesId, {
          newStructures: [],
          modifiedStructures: new Map(),
          history: [],
          historyIndex: -1
        });
      }

      const modifications = rtStructureModifications.get(seriesId)!;
      
      // Store previous state for undo functionality
      const previousState = new Map(modifications.modifiedStructures);
      
      // Parse the original RT structure to get baseline contour counts
      // Get the actual RT structure file path from the database
      let originalStructures: any = {};
      try {
        const images = await db.select()
          .from(imagesTable)
          .where(eq(imagesTable.seriesId, seriesId))
          .limit(1);
        
        if (images.length > 0 && images[0].filePath && fs.existsSync(images[0].filePath)) {
          const rtStructPath = images[0].filePath;
          if (rtStructureCache.has(rtStructPath)) {
            const cached = rtStructureCache.get(rtStructPath);
            cached.structures.forEach((s: any) => {
              originalStructures[s.roiNumber] = s.contours?.length || 0;
            });
          }
        }
      } catch (e) {
        console.error('Error fetching RT structure for contour counts:', e);
      }
      
      // Detect the action type if not provided
      let detectedAction = action || 'update_contours';
      let affectedStructureId = -1;
      
      // Update each structure's contours and detect deletions
      structures.forEach(structure => {
        if (structure.roiNumber && structure.contours !== undefined) {
          const previousMod = modifications.modifiedStructures.get(structure.roiNumber);
          const previousCount = previousMod?.contours?.length || originalStructures[structure.roiNumber] || 0;
          const newCount = structure.contours.length;
          
          // Detect if this is a delete operation
          if (newCount < previousCount) {
            if (newCount === 0) {
              detectedAction = 'clear_all';
            } else {
              detectedAction = 'delete_slice';
            }
            affectedStructureId = structure.roiNumber;
          }
          
          modifications.modifiedStructures.set(structure.roiNumber, {
            contours: structure.contours
          });
        }
      });

      // Add to history with detected action
      const historyEntry = {
        timestamp: Date.now(),
        action: detectedAction,
        structureId: affectedStructureId,
        previousState: Array.from(previousState.entries()),
        newState: Array.from(modifications.modifiedStructures.entries())
      };

      // Remove any redo entries after current index
      modifications.history = modifications.history.slice(0, modifications.historyIndex + 1);
      modifications.history.push(historyEntry);
      modifications.historyIndex++;

      console.log(`Updated contours for series ${seriesId} - Action: ${detectedAction}`);
      res.json({ success: true, message: "Contours updated successfully", action: detectedAction });
    } catch (error) {
      console.error('Error updating contours:', error);
      next(error);
    }
  });

  // Undo operation
  app.post("/api/rt-structures/:seriesId/undo", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const seriesId = parseInt(req.params.seriesId);
      
      if (!rtStructureModifications.has(seriesId)) {
        return res.status(404).json({ message: "No modifications found for this series" });
      }

      const modifications = rtStructureModifications.get(seriesId)!;
      
      if (modifications.historyIndex < 0) {
        return res.status(400).json({ message: "Nothing to undo" });
      }

      // Apply undo
      const historyEntry = modifications.history[modifications.historyIndex];
      if (historyEntry.previousState) {
        modifications.modifiedStructures = new Map(historyEntry.previousState);
      }
      
      modifications.historyIndex--;
      
      // If we're at the original state (historyIndex -1), clear all modifications
      if (modifications.historyIndex === -1) {
        console.log('Resetting to original state - clearing all modifications');
        modifications.modifiedStructures.clear();
        modifications.newStructures = [];
      }
      
      // Get the actual RT structure file path from the database
      let rtStructPath: string | null = null;
      try {
        const images = await db.select()
          .from(imagesTable)
          .where(eq(imagesTable.seriesId, seriesId))
          .limit(1);
        
        if (images.length > 0 && images[0].filePath) {
          rtStructPath = images[0].filePath;
        } else {
          return res.status(404).json({ error: "RT Structure file not found in database for series " + seriesId });
        }
      } catch (e) {
        console.error('Error fetching RT structure image:', e);
        return res.status(500).json({ error: "Failed to fetch RT structure file", details: e });
      }
      
      if (!fs.existsSync(rtStructPath)) {
        return res.status(404).json({ error: "RT Structure file not found at: " + rtStructPath });
      }

      // Use cached parsed structure set or parse and cache it
      let rtStructureSet;
      if (rtStructureCache.has(rtStructPath)) {
        rtStructureSet = JSON.parse(JSON.stringify(rtStructureCache.get(rtStructPath)));
      } else {
        rtStructureSet = RTStructureParser.parseRTStructureSet(rtStructPath);
        rtStructureCache.set(rtStructPath, JSON.parse(JSON.stringify(rtStructureSet)));
      }
      
      // Apply modifications from current state only if we're not at the original state
      if (modifications.historyIndex >= 0) {
        if (modifications.newStructures.length > 0) {
          rtStructureSet.structures.push(...modifications.newStructures);
        }
        
        modifications.modifiedStructures.forEach((modifiedData, roiNumber) => {
          const structureIndex = rtStructureSet.structures.findIndex(s => s.roiNumber === roiNumber);
          if (structureIndex >= 0) {
            rtStructureSet.structures[structureIndex] = {
              ...rtStructureSet.structures[structureIndex],
              ...modifiedData
            };
          }
        });
      }
      // If historyIndex is -1, we're at the original state, so return the unmodified RT structure set
      
      res.json(rtStructureSet);
    } catch (error) {
      console.error('Error during undo:', error);
      next(error);
    }
  });

  // Redo operation
  app.post("/api/rt-structures/:seriesId/redo", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const seriesId = parseInt(req.params.seriesId);
      
      if (!rtStructureModifications.has(seriesId)) {
        return res.status(404).json({ message: "No modifications found for this series" });
      }

      const modifications = rtStructureModifications.get(seriesId)!;
      
      if (modifications.historyIndex >= modifications.history.length - 1) {
        return res.status(400).json({ message: "Nothing to redo" });
      }

      // Apply redo
      modifications.historyIndex++;
      const historyEntry = modifications.history[modifications.historyIndex];
      if (historyEntry.newState) {
        modifications.modifiedStructures = new Map(historyEntry.newState);
      }
      
      // Get the actual RT structure file path from the database
      let rtStructPath: string | null = null;
      try {
        const images = await db.select()
          .from(imagesTable)
          .where(eq(imagesTable.seriesId, seriesId))
          .limit(1);
        
        if (images.length > 0 && images[0].filePath) {
          rtStructPath = images[0].filePath;
        } else {
          return res.status(404).json({ error: "RT Structure file not found in database for series " + seriesId });
        }
      } catch (e) {
        console.error('Error fetching RT structure image:', e);
        return res.status(500).json({ error: "Failed to fetch RT structure file", details: e });
      }
      
      if (!fs.existsSync(rtStructPath)) {
        return res.status(404).json({ error: "RT Structure file not found at: " + rtStructPath });
      }

      // Use cached parsed structure set or parse and cache it
      let rtStructureSet;
      if (rtStructureCache.has(rtStructPath)) {
        rtStructureSet = JSON.parse(JSON.stringify(rtStructureCache.get(rtStructPath)));
      } else {
        rtStructureSet = RTStructureParser.parseRTStructureSet(rtStructPath);
        rtStructureCache.set(rtStructPath, JSON.parse(JSON.stringify(rtStructureSet)));
      }
      
      // Apply modifications from current state
      if (modifications.newStructures.length > 0) {
        rtStructureSet.structures.push(...modifications.newStructures);
      }
      
      modifications.modifiedStructures.forEach((modifiedData, roiNumber) => {
        const structureIndex = rtStructureSet.structures.findIndex(s => s.roiNumber === roiNumber);
        if (structureIndex >= 0) {
          rtStructureSet.structures[structureIndex] = {
            ...rtStructureSet.structures[structureIndex],
            ...modifiedData
          };
        }
      });
      
      res.json(rtStructureSet);
    } catch (error) {
      console.error('Error during redo:', error);
      next(error);
    }
  });

  // Patient metadata editing endpoints
  app.patch("/api/patients/:patientId", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const patientId = parseInt(req.params.patientId);
      const metadata = req.body;
      
      const updated = await storage.updatePatientMetadata(patientId, metadata);
      if (!updated) {
        return res.status(404).json({ error: 'Patient not found' });
      }
      
      res.json(updated);
    } catch (error) {
      console.error('Error updating patient metadata:', error);
      next(error);
    }
  });

  // Helper: get the current merged RT structure set (original + in-memory modifications)
  async function getCurrentRTStructureSet(seriesId: number) {
    // Get RT series and file path
    const rtStructSeries = await storage.getSeriesById(seriesId);
    if (!rtStructSeries || rtStructSeries.modality !== 'RTSTRUCT') {
      throw new Error('RT Structure Set not found');
    }

    const images = await db.select()
      .from(imagesTable)
      .where(eq(imagesTable.seriesId, seriesId))
      .limit(1);

    if (images.length === 0 || !images[0].filePath) {
      throw new Error(`RT Structure file not found in database for series ${seriesId}`);
    }

    const rtStructPath = images[0].filePath;
    if (!fs.existsSync(rtStructPath)) {
      throw new Error(`RT Structure file not found at: ${rtStructPath}`);
    }

    // Parse or use cache
    let rtStructureSet: any;
    if (rtStructureCache.has(rtStructPath)) {
      rtStructureSet = JSON.parse(JSON.stringify(rtStructureCache.get(rtStructPath)));
    } else {
      rtStructureSet = RTStructureParser.parseRTStructureSet(rtStructPath);
      rtStructureCache.set(rtStructPath, JSON.parse(JSON.stringify(rtStructureSet)));
    }

    // Apply in-memory modifications if any
    const modifications = rtStructureModifications.get(seriesId);
    if (modifications) {
      if (modifications.newStructures.length > 0) {
        rtStructureSet.structures.push(...modifications.newStructures);
      }
      modifications.modifiedStructures.forEach((modifiedData, roiNumber) => {
        const structureIndex = rtStructureSet.structures.findIndex((s: any) => s.roiNumber === roiNumber);
        if (structureIndex >= 0) {
          rtStructureSet.structures[structureIndex] = {
            ...rtStructureSet.structures[structureIndex],
            ...modifiedData,
          };
        }
      });
    }

    return { rtStructSeries, rtStructureSet };
  }

  // Save (version) of current RT Structure Set state into DB
  app.post("/api/rt-structures/:seriesId/save", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const seriesId = parseInt(req.params.seriesId);
      const description = (req.body?.description as string) || `RT Structure Set - ${new Date().toISOString()}`;

      const { rtStructSeries, rtStructureSet } = await getCurrentRTStructureSet(seriesId);

      // Create structure set record
      const setRecord = await storage.createRTStructureSet({
        seriesId,
        studyId: rtStructSeries.studyId,
        referencedSeriesId: undefined as unknown as number, // try to resolve from parsed set
        frameOfReferenceUID: rtStructureSet.frameOfReferenceUID,
        structureSetLabel: description,
        structureSetDate: rtStructureSet.structureSetDate || new Date().toISOString().slice(0,10).replace(/-/g, ''),
      } as any);

      // If we can resolve referenced series by UID, update the set
      if (rtStructureSet.referencedSeriesUID) {
        try {
          const ref = await storage.getSeriesByUID(rtStructureSet.referencedSeriesUID);
          if (ref) {
            await storage.updateRTStructureSet(setRecord.id, { referencedSeriesId: ref.id });
          }
        } catch {}
      }

      // Persist structures and contours
      for (const s of rtStructureSet.structures || []) {
        const structure = await storage.createRTStructure({
          rtStructureSetId: setRecord.id,
          roiNumber: s.roiNumber,
          structureName: s.structureName,
          color: Array.isArray(s.color) ? s.color : undefined,
          isVisible: true,
        });

        const contours = (s.contours || []).map((c: any) => ({
          rtStructureId: structure.id,
          slicePosition: c.slicePosition,
          points: c.points,
          isPredicted: false,
        }));
        if (contours.length) {
          await storage.createRTStructureContours(contours as any);
        }
      }

      // Optional history snapshot
      try {
        await storage.createRTStructureHistory({
          rtStructureSetId: setRecord.id,
          actionType: 'save',
          actionDetails: JSON.stringify({ description }),
          affectedStructureIds: (rtStructureSet.structures || []).map((x: any) => x.roiNumber),
          snapshot: JSON.stringify(rtStructureSet),
          userId: undefined as any,
        });
      } catch {}

      return res.json({ success: true, rtStructureSetId: setRecord.id });
    } catch (error: any) {
      console.error('Error saving RT structure set:', error);
      return res.status(500).json({ error: 'Failed to save RT structure set', details: error?.message });
    }
  });

  // Export selected series from a study as a zip
  app.post("/api/studies/:studyId/export", async (req: Request, res: Response) => {
    try {
      const studyId = parseInt(req.params.studyId);
      const body = req.body || {};
      const seriesIds = (body.seriesIds || []) as number[];
      if (!Array.isArray(seriesIds) || seriesIds.length === 0) {
        return res.status(400).json({ error: 'seriesIds required' });
      }

      // Lazy import archiver to avoid startup cost
      const archiver = (await import('archiver')).default;
      res.setHeader('Content-Type', 'application/zip');
      const filename = `study_${studyId}_export_${Date.now()}.zip`;
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

      const archive = archiver('zip', { zlib: { level: 9 } });
      archive.on('error', (err: any) => {
        console.error('Archive error:', err);
        if (!res.headersSent) res.status(500);
        res.end();
      });
      archive.pipe(res);

      for (const sid of seriesIds) {
        const s = await storage.getSeriesById(sid);
        if (!s) continue;
        const imgs = await storage.getImagesBySeriesId(sid);
        for (const img of imgs) {
          if (img.filePath && fs.existsSync(img.filePath)) {
            // Put under series folder for clarity
            const baseName = path.basename(img.filePath);
            const subdir = `${s.modality || 'SERIES'}_${sid}`;
            archive.file(img.filePath, { name: path.posix.join(subdir, baseName) });
          }
        }
      }

      await archive.finalize();
    } catch (error) {
      console.error('Export error:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to export series' });
      }
    }
  });

  // Series description editing endpoint
  app.patch("/api/series/:seriesId/description", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const seriesId = parseInt(req.params.seriesId);
      const { description } = req.body;
      
      const updated = await storage.updateSeriesDescription(seriesId, description);
      if (!updated) {
        return res.status(404).json({ error: 'Series not found' });
      }
      
      res.json(updated);
    } catch (error) {
      console.error('Error updating series description:', error);
      next(error);
    }
  });

  // Get all patient tags for filtering
  app.get("/api/patient-tags", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tags = await db.select().from(patientTags);
      res.json(tags);
    } catch (error) {
      console.error('Error getting all patient tags:', error);
      next(error);
    }
  });

  // Patient tagging endpoints
  app.get("/api/patients/:patientId/tags", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const patientId = parseInt(req.params.patientId);
      const tags = await storage.getPatientTags(patientId);
      res.json(tags);
    } catch (error) {
      console.error('Error getting patient tags:', error);
      next(error);
    }
  });

  app.post("/api/patients/:patientId/tags", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const patientId = parseInt(req.params.patientId);
      const { tagType, tagValue, color } = req.body;
      
      const tag = await storage.createPatientTag({
        patientId,
        tagType,
        tagValue,
        color
      });
      
      if (!tag) {
        return res.status(400).json({ error: 'Failed to create tag' });
      }
      
      res.json(tag);
    } catch (error) {
      console.error('Error creating patient tag:', error);
      next(error);
    }
  });

  app.delete("/api/tags/:tagId", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tagId = parseInt(req.params.tagId);
      const success = await storage.deletePatientTag(tagId);
      
      if (!success) {
        return res.status(404).json({ error: 'Tag not found' });
      }
      
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting patient tag:', error);
      next(error);
    }
  });

  // Generate anatomical tags for a patient
  app.post("/api/patients/:patientId/tags/generate", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const patientId = parseInt(req.params.patientId);
      const tags = await storage.generateAnatomicalTags(patientId);
      res.json(tags);
    } catch (error) {
      console.error('Error generating anatomical tags:', error);
      next(error);
    }
  });

  // Helper function to find DICOM files recursively
  function findDicomFilesRecursive(dirPath: string): string[] {
    const files: string[] = [];
    
    try {
      const items = fs.readdirSync(dirPath);
      
      for (const item of items) {
        const itemPath = path.join(dirPath, item);
        const stat = fs.statSync(itemPath);
        
        if (stat.isDirectory()) {
          // Recursively search subdirectories
          files.push(...findDicomFilesRecursive(itemPath));
        } else if (item.toLowerCase().endsWith('.dcm') || !path.extname(item)) {
          files.push(itemPath);
        }
      }
    } catch (error) {
      console.error(`Error reading directory ${dirPath}:`, error);
    }
    
    return files;
  }

  // Check for unprocessed files in uploads directory
  app.get("/api/unprocessed-files", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const uploadsDir = path.join(process.cwd(), 'uploads');
      
      // Check if uploads directory exists
      if (!fs.existsSync(uploadsDir)) {
        return res.json({ files: [] });
      }

      // Get all directories in uploads folder
      const items = fs.readdirSync(uploadsDir);
      const unprocessedFiles: any[] = [];

      for (const item of items) {
        const itemPath = path.join(uploadsDir, item);
        const stat = fs.statSync(itemPath);
        
        if (stat.isDirectory() && item.startsWith('upload-')) {
          // Check for .dcm files in this upload directory (including subdirectories)
          const dcmFiles = findDicomFilesRecursive(itemPath);
          
          if (dcmFiles.length > 0) {
            unprocessedFiles.push({
              sessionId: item,
              uploadTime: stat.mtime,
              fileCount: dcmFiles.length,
              path: itemPath
            });
          }
        }
      }

      // Sort by upload time, newest first
      unprocessedFiles.sort((a, b) => b.uploadTime.getTime() - a.uploadTime.getTime());
      
      // Since parsing sessions are lost on server restart, show all unprocessed files
      // In a production system, this would check the database for imported data
      res.json({ files: unprocessedFiles });
    } catch (error) {
      console.error('Error checking unprocessed files:', error);
      res.status(500).json({ error: 'Failed to check unprocessed files' });
    }
  });

  // Get triage (parsed but not imported) sessions
  app.get("/api/triage-sessions", async (req: Request, res: Response, next: NextFunction) => {
    try {
      console.log('\n=== GET TRIAGE SESSIONS ===');
      console.log('Total sessions in memory:', triageSessions.size);
      
      // Log each session
      triageSessions.forEach((session, id) => {
        console.log(`Session ${id}:`, {
          sessionId: session.sessionId,
          hasParseResult: !!session.parseResult,
          dataLength: session.parseResult?.data?.length || 0,
          uploadSessionId: session.uploadSessionId,
          timestamp: new Date(session.timestamp).toISOString()
        });
      });
      
      const sessions = Array.from(triageSessions.values())
        .sort((a, b) => b.timestamp - a.timestamp); // Newest first
      
      console.log('Returning', sessions.length, 'sessions');
      console.log('===========================\n');
      
      res.json({ sessions });
    } catch (error) {
      console.error('Error getting triage sessions:', error);
      res.status(500).json({ error: 'Failed to get triage sessions' });
    }
  });

  // Get specific triage session data
  app.get("/api/triage-sessions/:sessionId", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { sessionId } = req.params;
      const session = triageSessions.get(sessionId);
      
      if (!session) {
        return res.status(404).json({ error: 'Triage session not found' });
      }
      
      res.json(session);
    } catch (error) {
      console.error('Error getting triage session:', error);
      res.status(500).json({ error: 'Failed to get triage session' });
    }
  });

  // Clear unprocessed files
  app.delete("/api/unprocessed-files/:sessionId", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { sessionId } = req.params;
      const uploadPath = path.join(process.cwd(), 'uploads', sessionId);
      
      if (!fs.existsSync(uploadPath) || !sessionId.startsWith('upload-')) {
        return res.status(404).json({ error: 'Upload session not found' });
      }

      // Remove the directory and all its contents
      fs.rmSync(uploadPath, { recursive: true, force: true });
      
      // Also clean up any related triage sessions
      for (const [triageId, triageSession] of triageSessions.entries()) {
        if (triageSession.uploadSessionId === sessionId) {
          triageSessions.delete(triageId);
        }
      }
      
      res.json({ success: true, message: 'Files cleared successfully' });
    } catch (error) {
      console.error('Error clearing files:', error);
      res.status(500).json({ error: 'Failed to clear files' });
    }
  });

  // Delete triage session
  app.delete("/api/triage-sessions/:sessionId", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { sessionId } = req.params;
      const session = triageSessions.get(sessionId);
      
      if (!session) {
        return res.status(404).json({ error: 'Triage session not found' });
      }

      // Remove triage session
      triageSessions.delete(sessionId);
      
      // Also clean up upload files if they exist
      const uploadPath = path.join(process.cwd(), 'uploads', session.uploadSessionId);
      if (fs.existsSync(uploadPath)) {
        fs.rmSync(uploadPath, { recursive: true, force: true });
      }
      
      res.json({ success: true, message: 'Triage session deleted successfully' });
    } catch (error) {
      console.error('Error deleting triage session:', error);
      res.status(500).json({ error: 'Failed to delete triage session' });
    }
  });

  // Process existing uploaded files
  app.post("/api/parse-dicom-session/from-existing", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { uploadSessionId } = req.body;
      console.log(`From-existing request received with uploadSessionId: ${uploadSessionId}`);
      console.log('Request body:', req.body);
      
      if (!uploadSessionId || !uploadSessionId.startsWith('upload-')) {
        console.log('Invalid or missing uploadSessionId:', uploadSessionId);
        return res.status(400).json({ error: "Invalid upload session ID" });
      }
      
      const uploadPath = path.join(process.cwd(), 'uploads', uploadSessionId);
      
      if (!fs.existsSync(uploadPath)) {
        return res.status(404).json({ error: "Upload directory not found" });
      }
      
      // Get all DICOM files from the directory (including subdirectories)
      const dicomFilePaths = findDicomFilesRecursive(uploadPath);
      
      const files = dicomFilePaths.map(filePath => {
        const filename = path.basename(filePath);
        return {
          fieldname: 'files',
          originalname: filename,
          encoding: '7bit',
          mimetype: 'application/dicom',
          destination: path.dirname(filePath),
          filename: filename,
          path: filePath,
          size: fs.statSync(filePath).size
        };
      }) as Express.Multer.File[];
      
      if (files.length === 0) {
        return res.status(400).json({ error: "No DICOM files found in upload directory" });
      }
      
      // Generate session ID
      const sessionId = `parse-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      // Create session - handle up to 1000 files
      const session = {
        sessionId,
        uploadSessionId, // Add the uploadSessionId to preserve it for cleanup
        status: 'parsing' as const,
        progress: 0,
        total: Math.min(files.length, 1000),
        startedAt: new Date(),
        files: files.slice(0, 1000)
      };
      
      parsingSessions.set(sessionId, session);
      
      // Start async parsing process
      processDicomFiles(sessionId);
      
      res.json({
        sessionId,
        total: session.total,
        message: files.length > 1000 
          ? `Started parsing first 1000 of ${files.length} files from existing upload.`
          : `Started parsing ${session.total} files from existing upload`
      });
      
    } catch (error) {
      console.error('Error starting parse from existing:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to start parsing" });
    }
  });

  // Start a new parsing session
  app.post("/api/parse-dicom-session", upload.array('files'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const files = req.files as Express.Multer.File[];
      
      if (!files || files.length === 0) {
        return res.status(400).json({ error: "No files uploaded" });
      }

      // Use the upload session ID from multer
      const uploadSessionId = (req as any).uploadSessionId;
      const uploadDir = path.join('uploads', uploadSessionId);
      
      // Extract any ZIP files first
      const allFiles: Express.Multer.File[] = [];
      
      for (const file of files) {
        if (file.originalname.toLowerCase().endsWith('.zip')) {
          console.log(`Extracting ZIP file: ${file.originalname}`);
          try {
            const extractedPaths = await extractZipFile(file.path, uploadDir);
            console.log(`Extracted ${extractedPaths.length} files from ${file.originalname}`);
            
            // Convert extracted files to multer file format
            for (const extractedPath of extractedPaths) {
              const filename = path.basename(extractedPath);
              if (filename.toLowerCase().endsWith('.dcm') || !path.extname(filename)) {
                allFiles.push({
                  fieldname: 'files',
                  originalname: filename,
                  encoding: '7bit',
                  mimetype: 'application/dicom',
                  destination: uploadDir,
                  filename: filename,
                  path: extractedPath,
                  size: fs.statSync(extractedPath).size
                } as Express.Multer.File);
              }
            }
            
            // Delete the ZIP file after extraction
            fs.unlinkSync(file.path);
          } catch (extractError) {
            console.error(`Failed to extract ZIP file ${file.originalname}:`, extractError);
          }
        } else {
          // Regular file, add to list
          allFiles.push(file);
        }
      }
      
      if (allFiles.length === 0) {
        return res.status(400).json({ error: "No DICOM files found after extraction" });
      }
      
      // Generate session ID
      const sessionId = `parse-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      // Create session - handle up to 1000 files
      const session = {
        sessionId,
        uploadSessionId,
        status: 'parsing' as const,
        progress: 0,
        total: Math.min(allFiles.length, 1000),
        startedAt: new Date(),
        files: allFiles.slice(0, 1000)
      };
      
      parsingSessions.set(sessionId, session);
      
      // Start async parsing process
      processDicomFiles(sessionId);
      
      res.json({
        sessionId,
        total: session.total,
        message: allFiles.length > 1000 
          ? `Started parsing first 1000 of ${allFiles.length} files. Please upload remaining files in a separate batch.`
          : `Started parsing ${session.total} files`
      });
      
    } catch (error) {
      console.error('Error starting parse session:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to start parsing session" });
    }
  });

  // Check parsing session status
  app.get("/api/parse-dicom-session/:sessionId", async (req: Request, res: Response) => {
    try {
      const session = parsingSessions.get(req.params.sessionId);
      
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }
      
      res.json({
        sessionId: session.sessionId,
        status: session.status,
        progress: session.progress,
        total: session.total,
        currentFile: session.currentFile,
        result: session.result,
        error: session.error,
        startedAt: session.startedAt,
        completedAt: session.completedAt
      });
      
    } catch (error) {
      console.error('Error checking session status:', error);
      res.status(500).json({ error: "Failed to check session status" });
    }
  });

  // Async function to process DICOM files
  async function processDicomFiles(sessionId: string) {
    const session = parsingSessions.get(sessionId);
    if (!session || !session.files) return;
    
    try {
      const parsedData: any[] = [];
      const rtstructDetails: any = {};
      let successCount = 0;
      let errorCount = 0;

      for (let i = 0; i < session.files.length; i++) {
        const file = session.files[i];
        
        // Update progress
        session.progress = i + 1;
        session.currentFile = file.originalname;
        
        try {
          // Check if DICOM file
          const isDicom = isDICOMFile(file.path);
          
          if (!isDicom) {
            errorCount++;
            parsedData.push({
              filename: file.originalname,
              error: "Not a valid DICOM file"
            });
            continue;
          }

          // Extract metadata
          const metadata = extractDICOMMetadata(file.path);
          
          if (!metadata) {
            errorCount++;
            parsedData.push({
              filename: file.originalname,
              error: "Failed to extract metadata"
            });
            continue;
          }

          const dicomData = {
            filename: file.originalname,
            fileName: file.originalname,  // Add both for compatibility
            filePath: file.path,
            ...metadata
          };

          // Special handling for RT structure sets
          if (metadata.modality === 'RTSTRUCT') {
            const rtMetadata = extractRTStructMetadata(file.path);
            dicomData.structureSetLabel = rtMetadata.structureSetLabel;
            dicomData.structureSetDate = rtMetadata.structureSetDate;
            dicomData.structures = rtMetadata.structures;
            
            rtstructDetails[file.originalname] = {
              structureSetLabel: rtMetadata.structureSetLabel,
              structureSetDate: rtMetadata.structureSetDate,
              structures: rtMetadata.structures
            };
          }

          parsedData.push(dicomData);
          successCount++;
          
        } catch (err) {
          console.error(`Error processing ${file.originalname}:`, err);
          errorCount++;
          parsedData.push({
            filename: file.originalname,
            error: err.message || 'Unknown error'
          });
        }
        
        // Don't delete files - we need them for serving images later
        // try {
        //   await fs.promises.unlink(file.path);
        // } catch (e) {
        //   console.error('Error deleting temp file:', e);
        // }
      }

      // Group by patient
      const patientGroups = new Map();
      parsedData.forEach(data => {
        if (!data.error && data.patientID) {
          const key = data.patientID;
          if (!patientGroups.has(key)) {
            patientGroups.set(key, {
              patientId: data.patientID,
              patientName: data.patientName || 'Unknown',
              studies: new Map()
            });
          }
          
          const patient = patientGroups.get(key);
          const studyKey = data.studyInstanceUID || 'unknown';
          
          if (!patient.studies.has(studyKey)) {
            patient.studies.set(studyKey, {
              studyId: data.studyInstanceUID,
              studyDate: data.studyDate,
              series: []
            });
          }
          
          patient.studies.get(studyKey).series.push(data);
        }
      });

      // Convert to array format
      const patientPreviews = Array.from(patientGroups.values()).map(patient => ({
        patientId: patient.patientId,
        patientName: patient.patientName,
        studies: Array.from(patient.studies.values()).map(study => ({
          studyId: study.studyId,
          studyDate: study.studyDate,
          seriesCount: new Set(study.series.map(s => s.seriesInstanceUID)).size,
          imageCount: study.series.length,
          modalities: Array.from(new Set(study.series.map(s => s.modality).filter(Boolean)))
        }))
      }));

      // Update session with results
      session.status = 'complete';
      session.completedAt = new Date();
      session.result = {
        success: true,
        data: parsedData,
        rtstructDetails: rtstructDetails,
        totalFiles: session.files.length,
        message: `Successfully parsed ${successCount} files, ${errorCount} errors`,
        patientPreviews
      };

      // Move to triage after parsing completion
      // Use the uploadSessionId from the session itself, not from file paths
      const uploadSessionId = session.uploadSessionId || '';
      console.log(`Moving session ${session.sessionId} to triage with ${patientPreviews.length} patients and ${successCount} images`);
      console.log(`Upload session ID for cleanup: ${uploadSessionId}`);
      console.log(`Session data:`, { sessionId: session.sessionId, uploadSessionId: session.uploadSessionId, filesCount: session.files?.length });
      triageSessions.set(session.sessionId, {
        sessionId: session.sessionId,
        parseResult: session.result,
        uploadSessionId: uploadSessionId,
        timestamp: Date.now(),
        patientCount: patientPreviews.length,
        imageCount: successCount
      });
      console.log(`Triage sessions now has ${triageSessions.size} entries`);
      
    } catch (error) {
      console.error('Error in async DICOM processing:', error);
      session.status = 'error';
      session.error = error.message || 'Processing failed';
      session.completedAt = new Date();
    }
  }

  // Patient storage management endpoints
  app.get("/api/storage/patients/:patientId", async (req: Request, res: Response) => {
    try {
      const { patientId } = req.params;
      const storageInfo = patientStorage.getPatientStorageInfo(patientId);
      
      res.json({
        patientId,
        storage: storageInfo,
        path: patientStorage.getPatientPath(patientId)
      });
    } catch (error) {
      console.error('Error getting patient storage info:', error);
      res.status(500).json({ error: "Failed to get storage information" });
    }
  });

  app.get("/api/storage/overview", async (req: Request, res: Response) => {
    try {
      const storageBasePath = 'storage/patients';
      const overview = {
        basePath: storageBasePath,
        patients: [] as any[]
      };
      
      if (fs.existsSync(storageBasePath)) {
        const patientDirs = fs.readdirSync(storageBasePath);
        for (const patientId of patientDirs) {
          const info = patientStorage.getPatientStorageInfo(patientId);
          overview.patients.push({
            patientId,
            ...info
          });
        }
      }
      
      res.json(overview);
    } catch (error) {
      console.error('Error getting storage overview:', error);
      res.status(500).json({ error: "Failed to get storage overview" });
    }
  });

  return { close: () => {} } as Server;
}
