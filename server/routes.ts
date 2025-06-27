import { Express, Request, Response, NextFunction } from "express";
import multer from "multer";
import * as fs from "fs";
import * as path from "path";
import { storage } from "./storage";
import { Server } from "http";
import * as dicomParser from 'dicom-parser';
import { RTStructureParser } from './rt-structure-parser';

const upload = multer({ dest: 'uploads/' });

function isDICOMFile(filePath: string): boolean {
  try {
    const buffer = fs.readFileSync(filePath, { start: 128, end: 132 } as any);
    return buffer.toString() === 'DICM';
  } catch {
    return false;
  }
}

function extractDICOMMetadata(filePath: string) {
  try {
    const buffer = fs.readFileSync(filePath);
    const byteArray = new Uint8Array(buffer);
    const dataSet = dicomParser.parseDicom(byteArray, {
      untilTag: 'x7fe00010', // stop before pixel data
      stopAtPixelData: true
    });

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

    return {
      patientName: getString('x00100010'),
      patientID: getString('x00100020'),
      studyInstanceUID: getString('x0020000d'),
      seriesInstanceUID: getString('x0020000e'),
      sopInstanceUID: getString('x00080018'),
      modality: getString('x00080060'),
      studyDate: getString('x00080020'),
      seriesDescription: getString('x0008103e'),
      instanceNumber: getString('x00200013'),
      pixelSpacing: getArray('x00280030'),             // [rowSpacing, colSpacing]
      imagePositionPatient: getArray('x00200032'),     // [x, y, z]
      imageOrientationPatient: getArray('x00200037')   // [rx, ry, rz, cx, cy, cz]
    };
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

  // Handle file uploads
  app.post("/api/upload", upload.array('dicomFiles'), async (req: Request, res: Response, next: NextFunction) => {
    console.log('Upload endpoint hit with files:', req.files?.length);
    console.log('Request body:', req.body);
    
    try {
      const files = req.files as Express.Multer.File[];
      const patientData = JSON.parse(req.body.patientData || '{}');
      
      if (!files || files.length === 0) {
        return res.status(400).json({ message: "No files uploaded" });
      }

      console.log(`Processing ${files.length} uploaded files`);

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

      console.log(`Organized files into ${patientMap.size} patients`);

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

              await storage.createImage({
                seriesId: dbSeries.id,
                sopInstanceUID: metadata.sopInstanceUID || generateUID(),
                instanceNumber: parseInt(metadata.instanceNumber) || 1,
                filePath: permanentPath,
                fileName: file.originalname,
                fileSize: file.size,
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
            sum + Array.from(study.values()).reduce((seriesSum, series) => seriesSum + series.length, 0), 0)
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

  app.post("/api/patients", async (req, res) => {
    try {
      const patient = await storage.createPatient(req.body);
      res.status(201).json(patient);
    } catch (error) {
      console.error('Error creating patient:', error);
      res.status(500).json({ message: "Failed to create patient" });
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

  // Get DICOM metadata for proper coordinate transformation
  app.get("/api/images/:imageId/metadata", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const imageId = parseInt(req.params.imageId);
      const image = await storage.getImage(imageId);
      
      if (!image) {
        return res.status(404).json({ error: 'Image not found' });
      }

      // Parse DICOM file to extract spatial metadata  
      const buffer = fs.readFileSync(image.filePath);

      // Debug: Log which file we're parsing
      console.log(`Attempting to parse metadata from: ${image.filePath}`);

      const byteArray = new Uint8Array(buffer);
      const dataSet = dicomParser.parseDicom(byteArray, {
        untilTag: 'x7fe00010',
        stopAtPixelData: true
      });

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
        windowCenter: getString('x00281050'), // Window Center
        windowWidth: getString('x00281051') // Window Width
      };

      // Debug: Log extracted metadata
      console.log('Extracted metadata:', metadata);

      res.json(metadata);
    } catch (error) {
      console.error('Error getting image metadata:', error);
      next(error);
    }
  });

  // Get RT Structure Set for a study
  app.get("/api/studies/:studyId/rt-structures", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const studyId = parseInt(req.params.studyId);
      const rtStructures = await storage.getRTStructuresForStudy(studyId);
      // Filter for RTSTRUCT modality
      const rtStructSeries = rtStructures.filter(s => s.modality === 'RTSTRUCT');
      res.json(rtStructSeries);
    } catch (error: any) {
      next(error);
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
          const dataSet = dicomParser.parseDicom(byteArray, {
            untilTag: 'x7fe00010',
            stopAtPixelData: true
          });
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

  // Get RT structure series for a study
  app.get("/api/studies/:studyId/rt-structures", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const studyId = parseInt(req.params.studyId);
      const series = await storage.getSeriesByStudyId(studyId);
      
      // Filter to only RT structure series
      const rtSeries = series.filter(s => s.modality === 'RTSTRUCT');
      res.json(rtSeries);
    } catch (error: any) {
      console.error('Error fetching RT structure series:', error);
      res.status(500).json({ error: 'Failed to fetch RT structure series', details: error.message });
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

      // Parse the RT structure file from the HN-ATLAS dataset
      const rtStructPath = 'attached_assets/HN-ATLAS-84/MIM/Fix June 2020.dcm';
      if (!fs.existsSync(rtStructPath)) {
        return res.status(404).json({ error: "RT Structure file not found" });
      }

      const rtStructureSet = RTStructureParser.parseRTStructureSet(rtStructPath);
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

  app.post("/api/pacs", async (req, res) => {
    try {
      const connection = await storage.createPacsConnection(req.body);
      res.status(201).json(connection);
    } catch (error) {
      console.error('Error creating PACS connection:', error);
      res.status(500).json({ message: "Failed to create PACS connection" });
    }
  });

  return { close: () => {} } as Server;
}