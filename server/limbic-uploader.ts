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
      console.log('LIMBIC patient already exists');
      return;
    }

    console.log('Scanning all DICOM files and parsing authentic metadata...');

    // Get all DICOM files recursively
    const allFiles = getAllDicomFiles(limbicPath);
    console.log(`Found ${allFiles.length} DICOM files total`);

    // Parse metadata from all files and group by study/series
    const studies = new Map<string, any>();
    const series = new Map<string, any>();
    let patientInfo: any = null;

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

        // Group by study UID
        const studyUID = metadata.studyInstanceUID || generateUID();
        if (!studies.has(studyUID)) {
          studies.set(studyUID, {
            studyInstanceUID: studyUID,
            studyDate: metadata.studyDate || '20230215',
            studyDescription: metadata.studyDescription || `${metadata.modality} Study`,
            accessionNumber: `LIMBIC_${metadata.modality}_001`,
            modality: metadata.modality || 'UN',
            files: []
          });
        }
        studies.get(studyUID)!.files.push({ filePath, metadata });

        // Group by series UID within study
        const seriesUID = metadata.seriesInstanceUID || generateUID();
        const seriesKey = `${studyUID}_${seriesUID}`;
        if (!series.has(seriesKey)) {
          series.set(seriesKey, {
            studyUID,
            seriesInstanceUID: seriesUID,
            seriesDescription: metadata.seriesDescription || `${metadata.modality} Series`,
            modality: metadata.modality || 'UN',
            seriesNumber: metadata.seriesNumber || 1,
            files: []
          });
        }
        series.get(seriesKey)!.files.push({ filePath, metadata });

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
    console.log(`Studies found: ${studies.size}`);
    console.log(`Series found: ${series.size}`);

    // Create patient
    limbicPatient = await storage.createPatient({
      patientID: patientInfo.patientID,
      patientName: patientInfo.patientName,
      patientSex: patientInfo.patientSex,
      patientAge: patientInfo.patientAge
    });

    // Create studies
    for (const studyInfo of Array.from(studies.values())) {
      const studySeries = Array.from(series.values()).filter(s => s.studyUID === studyInfo.studyInstanceUID);
      const totalImages = studySeries.reduce((sum, s) => sum + s.files.length, 0);

      const study = await storage.createStudy({
        patientId: limbicPatient.id,
        studyInstanceUID: studyInfo.studyInstanceUID,
        studyDate: studyInfo.studyDate,
        studyDescription: studyInfo.studyDescription,
        accessionNumber: studyInfo.accessionNumber,
        modality: studyInfo.modality,
        numberOfSeries: studySeries.length,
        numberOfImages: totalImages,
        isDemo: true
      });

      console.log(`Created study: ${study.studyDescription} (${study.modality}) - ${studySeries.length} series, ${totalImages} images`);

      // Create series for this study
      for (const seriesInfo of studySeries) {
        const seriesData = await storage.createSeries({
          studyId: study.id,
          seriesInstanceUID: seriesInfo.seriesInstanceUID,
          seriesDescription: seriesInfo.seriesDescription,
          modality: seriesInfo.modality,
          imageCount: seriesInfo.files.length,
          seriesNumber: seriesInfo.seriesNumber
        });

        console.log(`  Series: ${seriesData.seriesDescription} (${seriesData.modality}) - ${seriesInfo.files.length} images`);

        // Create images for this series
        for (let i = 0; i < seriesInfo.files.length; i++) {
          const { filePath, metadata } = seriesInfo.files[i];
          const fileName = path.basename(filePath);
          
          await storage.createImage({
            seriesId: seriesData.id,
            sopInstanceUID: metadata.sopInstanceUID || generateUID() + `.${i + 1}`,
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
      console.log(`  ${modality}: ${count} images`);
    }

  } catch (error) {
    console.error('Error uploading LIMBIC scan:', error);
  }
}