import { Express, Request, Response, NextFunction } from "express";
import multer from "multer";
import * as fs from "fs";
import * as path from "path";
import { storage } from "../storage";
import { extractDICOMMetadata, generateUID, findDicomFilesRecursive } from "../utils/dicom-utils";
import { patientStorage } from '../patient-storage';

// Configure multer for file uploads
const upload = multer({ 
  dest: 'uploads/',
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit
    files: 1000 // Max 1000 files
  }
});

export function registerUploadRoutes(app: Express) {
  // DICOM file upload endpoint
  app.post("/api/upload", upload.array('files'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const files = req.files as Express.Multer.File[];
      
      if (!files || files.length === 0) {
        return res.status(400).json({ error: "No files provided" });
      }

      console.log(`Processing ${files.length} uploaded files`);
      
      // Group files by patient -> study -> series
      const patients = new Map();
      
      for (const file of files) {
        try {
          const metadata = extractDICOMMetadata(file.path);
          
          const patientKey = metadata.patientID || 'Unknown';
          const studyKey = metadata.studyInstanceUID || generateUID();
          const seriesKey = metadata.seriesInstanceUID || generateUID();
          
          if (!patients.has(patientKey)) {
            patients.set(patientKey, {
              metadata: {
                patientID: metadata.patientID,
                patientName: metadata.patientName,
                patientSex: metadata.patientSex,
                patientAge: metadata.patientAge,
                dateOfBirth: metadata.patientBirthDate
              },
              studies: new Map()
            });
          }
          
          const patient = patients.get(patientKey);
          
          if (!patient.studies.has(studyKey)) {
            patient.studies.set(studyKey, {
              metadata: {
                studyInstanceUID: metadata.studyInstanceUID,
                studyDescription: metadata.studyDescription,
                studyDate: metadata.studyDate,
                studyTime: metadata.studyTime
              },
              series: new Map()
            });
          }
          
          const study = patient.studies.get(studyKey);
          
          if (!study.series.has(seriesKey)) {
            study.series.set(seriesKey, []);
          }
          
          study.series.get(seriesKey).push({ file, metadata });
          
        } catch (error) {
          console.error(`Error processing file ${file.originalname}:`, error);
          // Continue processing other files
        }
      }

      const results = [];
      
      for (const [patientKey, patient] of patients) {
        // Create or get patient
        let dbPatient = await storage.getPatientByPatientID(patient.metadata.patientID);
        
        if (!dbPatient) {
          dbPatient = await storage.createPatient({
            patientID: patient.metadata.patientID || 'Unknown',
            patientName: patient.metadata.patientName || 'Unknown Patient',
            patientSex: patient.metadata.patientSex,
            patientAge: patient.metadata.patientAge,
            dateOfBirth: patient.metadata.dateOfBirth,
          });
        }
        
        const studies = patient.studies;
        
        for (const [studyKey, study] of studies) {
          // Create or get study
          let dbStudy = await storage.getStudyByStudyInstanceUID(study.metadata.studyInstanceUID);
          
          if (!dbStudy) {
            dbStudy = await storage.createStudy({
              patientId: dbPatient.id,
              studyInstanceUID: study.metadata.studyInstanceUID || generateUID(),
              studyDescription: study.metadata.studyDescription || 'Uploaded Study',
              studyDate: study.metadata.studyDate,
              studyTime: study.metadata.studyTime,
              seriesCount: 0,
              imageCount: 0,
            });
          }
          
          const series = study.series;
          
          for (const [seriesKey, seriesFiles] of series) {
            const firstFile = seriesFiles[0];
            
            // Create or get series
            let dbSeries = await storage.getSeriesBySeriesInstanceUID(seriesKey);
            
            if (!dbSeries) {
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
      res.status(500).json({ error: 'Failed to process upload' });
    }
  });

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

      res.json({ files: unprocessedFiles });
    } catch (error) {
      console.error("Error checking unprocessed files:", error);
      res.status(500).json({ error: "Failed to check unprocessed files" });
    }
  });
}