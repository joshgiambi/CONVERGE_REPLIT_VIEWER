import fs from 'fs';
import path from 'path';
import { storage } from './storage';
import { parseDICOMMetadata } from './dicom-parser';

function generateUID(): string {
  return `1.2.3.${Date.now()}.${Math.floor(Math.random() * 10000)}`;
}

function getAllDicomFiles(dirPath: string): string[] {
  const files: string[] = [];
  
  function scanDirectory(currentPath: string) {
    const items = fs.readdirSync(currentPath);
    
    for (const item of items) {
      const fullPath = path.join(currentPath, item);
      const stats = fs.statSync(fullPath);
      
      if (stats.isDirectory()) {
        scanDirectory(fullPath);
      } else if (item.endsWith('.dcm')) {
        files.push(fullPath);
      }
    }
  }
  
  scanDirectory(dirPath);
  return files;
}

export async function uploadLimbicScan(): Promise<void> {
  const limbicPath = path.join(process.cwd(), 'attached_assets', 'LIMBIC_57');
  
  if (!fs.existsSync(limbicPath)) {
    console.log('LIMBIC_57 folder not found');
    return;
  }

  try {
    // Check if LIMBIC patient already exists
    let limbicPatient = await storage.getPatientByID("LIMBIC_57");
    if (limbicPatient) {
      console.log('LIMBIC patient already exists - continuing with series upload');
    }

    console.log('Scanning all DICOM files and parsing authentic metadata...');

    // Get all DICOM files recursively
    const allFiles = getAllDicomFiles(limbicPath);
    console.log(`Found ${allFiles.length} DICOM files total`);

    // Parse metadata from all files and group by authentic study/series UIDs
    const series = new Map<string, any>();
    let patientInfo: any = null;
    let studyInfo: any = null;

    for (const filePath of allFiles) {
      try {
        const metadata = parseDICOMMetadata(filePath);
        
        // Extract patient info from first valid file
        if (!patientInfo && metadata.patientID) {
          patientInfo = {
            patientID: metadata.patientID,
            patientName: metadata.patientName || metadata.patientID,
            patientSex: metadata.patientSex || 'U',
            patientAge: metadata.patientAge || '45Y'
          };
        }

        // Extract study info from first valid file
        if (!studyInfo && metadata.studyInstanceUID) {
          studyInfo = {
            studyInstanceUID: metadata.studyInstanceUID,
            studyDate: metadata.studyDate || '20230215',
            studyDescription: 'LIMBIC Neuroimaging Study - Multi-modal Brain Analysis',
            accessionNumber: 'LIMBIC_57_001'
          };
        }

        // Group by authentic series UID
        const seriesUID = metadata.seriesInstanceUID;
        if (seriesUID && !series.has(seriesUID)) {
          series.set(seriesUID, {
            seriesInstanceUID: seriesUID,
            seriesDescription: metadata.seriesDescription || `${metadata.modality} Series`,
            modality: metadata.modality || 'UN',
            seriesNumber: metadata.seriesNumber || 1,
            files: []
          });
        }
        if (seriesUID) {
          series.get(seriesUID)!.files.push({ filePath, metadata });
        }

      } catch (error) {
        console.log(`Could not parse ${path.basename(filePath)}: ${error}`);
      }
    }

    // Use fallback patient info if not found
    if (!patientInfo) {
      patientInfo = {
        patientID: "LIMBIC_57",
        patientName: "LIMBIC Neuroimaging Patient",
        patientSex: "U", 
        patientAge: "45Y"
      };
    }

    console.log(`Patient: ${patientInfo.patientName} (${patientInfo.patientID})`);
    console.log(`Series found: ${series.size}`);

    // Create patient only if it doesn't exist
    if (!limbicPatient) {
      limbicPatient = await storage.createPatient({
        patientID: patientInfo.patientID,
        patientName: patientInfo.patientName,
        patientSex: patientInfo.patientSex,
        patientAge: patientInfo.patientAge
      });
    }

    // Check if study already exists with this UID
    const totalImages = Array.from(series.values()).reduce((sum, s) => sum + s.files.length, 0);
    const studyUID = studyInfo?.studyInstanceUID || generateUID();
    
    let study = await storage.getStudyByUID(studyUID);
    if (!study) {
      study = await storage.createStudy({
        patientId: limbicPatient.id,
        studyInstanceUID: studyUID,
        studyDate: studyInfo?.studyDate || '20230215',
        studyDescription: studyInfo?.studyDescription || 'LIMBIC Neuroimaging Study - Multi-modal Brain Analysis',
        accessionNumber: studyInfo?.accessionNumber || 'LIMBIC_57_001',
        modality: 'MR', // Primary modality
        numberOfSeries: series.size,
        numberOfImages: totalImages,
        isDemo: true
      });
    } else {
      // Update existing study with correct counts
      await storage.updateStudyCounts(study.id, series.size, totalImages);
    }

    console.log(`Study found/created: ${study.studyDescription} - ${series.size} series, ${totalImages} images`);

    // Log all series being processed
    console.log(`Processing ${series.size} series:`);
    Array.from(series.values()).forEach((s, i) => {
      console.log(`  ${i+1}. ${s.modality}: ${s.seriesDescription} (${s.files.length} files)`);
    });

    // Create all series (check for existing first)
    for (const seriesInfo of Array.from(series.values())) {
      let seriesData = await storage.getSeriesByUID(seriesInfo.seriesInstanceUID);
      if (!seriesData) {
        seriesData = await storage.createSeries({
          studyId: study.id,
          seriesInstanceUID: seriesInfo.seriesInstanceUID,
          seriesDescription: seriesInfo.seriesDescription,
          modality: seriesInfo.modality,
          imageCount: seriesInfo.files.length,
          seriesNumber: seriesInfo.seriesNumber
        });
      } else {
        // Update existing series with correct count
        await storage.updateSeriesImageCount(seriesData.id, seriesInfo.files.length);
      }

      console.log(`  Series: ${seriesData.seriesDescription} (${seriesData.modality}) - ${seriesInfo.files.length} files`);

      // Create images for this series (check for existing first)
      for (let i = 0; i < seriesInfo.files.length; i++) {
        const { filePath, metadata } = seriesInfo.files[i];
        const fileName = path.basename(filePath);
        const sopUID = metadata.sopInstanceUID || generateUID() + `.${i + 1}`;
        
        // Check if image already exists
        const existingImage = await storage.getImageByUID(sopUID);
        if (!existingImage) {
          await storage.createImage({
            seriesId: seriesData.id,
            sopInstanceUID: sopUID,
            filePath,
            fileName,
            instanceNumber: metadata.instanceNumber || (i + 1),
            fileSize: fs.statSync(filePath).size
          });
        }
      }
    }

    // Log summary by modality
    const modalitySummary = new Map<string, number>();
    for (const seriesInfo of Array.from(series.values())) {
      const current = modalitySummary.get(seriesInfo.modality) || 0;
      modalitySummary.set(seriesInfo.modality, current + seriesInfo.files.length);
    }

    console.log('LIMBIC scan uploaded successfully with authentic DICOM metadata:');
    for (const [modality, count] of Array.from(modalitySummary.entries())) {
      console.log(`  ${modality}: ${count} files`);
    }

  } catch (error) {
    console.error('Error uploading LIMBIC scan:', error);
  }
}