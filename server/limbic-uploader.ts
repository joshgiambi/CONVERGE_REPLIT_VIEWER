import fs from 'fs';
import path from 'path';
import { storage } from './storage';
import { parseDICOMMetadata } from './dicom-parser';

interface LimbicScanData {
  patient: {
    patientID: string;
    patientName: string;
    patientSex?: string;
    patientAge?: string;
  };
  studies: {
    [key: string]: {
      studyInstanceUID: string;
      studyDate: string;
      studyTime: string;
      studyDescription: string;
      accessionNumber: string;
      modality: string;
      series: {
        [key: string]: {
          seriesInstanceUID: string;
          seriesDescription: string;
          modality: string;
          files: string[];
        };
      };
    };
  };
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

    const scanData: LimbicScanData = {
      patient: {
        patientID: "LIMBIC_57",
        patientName: "LIMBIC Neuroimaging Patient",
        patientSex: "U",
        patientAge: "42Y"
      },
      studies: {}
    };

    // Process each subdirectory
    const subDirs = ['DICOM_SRS', 'MRI_MPRAGE', 'REG'];
    
    for (const subDir of subDirs) {
      const dirPath = path.join(limbicPath, subDir);
      if (!fs.existsSync(dirPath)) continue;

      const files = fs.readdirSync(dirPath)
        .filter(file => file.endsWith('.dcm'))
        .map(file => path.join(dirPath, file));

      if (files.length === 0) continue;

      // Read first DICOM file to get study/series metadata
      const firstFile = files[0];
      try {
        const metadata = parseDICOMMetadata(firstFile);
        
        // Update patient info from DICOM if available
        if (metadata.patientName) {
          scanData.patient.patientName = metadata.patientName;
        }
        if (metadata.patientID) {
          scanData.patient.patientID = metadata.patientID;
        }
        if (metadata.patientSex) {
          scanData.patient.patientSex = metadata.patientSex;
        }
        if (metadata.patientAge) {
          scanData.patient.patientAge = metadata.patientAge;
        }

        // Create study entry
        const studyUID = metadata.studyInstanceUID || `1.2.3.${Date.now()}.${Math.random()}`;
        const seriesUID = metadata.seriesInstanceUID || `1.2.3.${Date.now()}.${Math.random()}`;
        
        if (!scanData.studies[studyUID]) {
          scanData.studies[studyUID] = {
            studyInstanceUID: studyUID,
            studyDate: metadata.studyDate || '20230215',
            studyTime: metadata.studyTime || '120000',
            studyDescription: metadata.studyDescription || getStudyDescriptionForDir(subDir),
            accessionNumber: `LIMBIC_${subDir}_001`,
            modality: metadata.modality || getModalityForDir(subDir),
            series: {}
          };
        }

        // Add series
        scanData.studies[studyUID].series[seriesUID] = {
          seriesInstanceUID: seriesUID,
          seriesDescription: metadata.seriesDescription || getSeriesDescriptionForDir(subDir),
          modality: metadata.modality || getModalityForDir(subDir),
          files: files
        };

      } catch (error) {
        console.log(`Error reading DICOM metadata from ${firstFile}:`, error);
        // Fallback to directory-based metadata
        const studyUID = `1.2.3.${Date.now()}.${Math.random()}`;
        const seriesUID = `1.2.3.${Date.now()}.${Math.random()}`;
        
        scanData.studies[studyUID] = {
          studyInstanceUID: studyUID,
          studyDate: '20230215',
          studyTime: '120000',
          studyDescription: getStudyDescriptionForDir(subDir),
          accessionNumber: `LIMBIC_${subDir}_001`,
          modality: getModalityForDir(subDir),
          series: {
            [seriesUID]: {
              seriesInstanceUID: seriesUID,
              seriesDescription: getSeriesDescriptionForDir(subDir),
              modality: getModalityForDir(subDir),
              files: files
            }
          }
        };
      }
    }

    // Create patient in database
    limbicPatient = await storage.createPatient({
      patientID: scanData.patient.patientID,
      patientName: scanData.patient.patientName,
      patientSex: scanData.patient.patientSex,
      patientAge: scanData.patient.patientAge
    });

    // Create studies and series
    for (const [studyUID, studyData] of Object.entries(scanData.studies)) {
      const study = await storage.createStudy({
        patientId: limbicPatient.id,
        studyInstanceUID: studyData.studyInstanceUID,
        patientID: limbicPatient.patientID,
        patientName: limbicPatient.patientName,
        studyDate: studyData.studyDate,
        studyDescription: studyData.studyDescription,
        accessionNumber: studyData.accessionNumber,
        modality: studyData.modality,
        numberOfSeries: Object.keys(studyData.series).length,
        numberOfImages: Object.values(studyData.series).reduce((sum, series) => sum + series.files.length, 0),
        isDemo: true
      });

      // Create series
      for (const [seriesUID, seriesData] of Object.entries(studyData.series)) {
        const series = await storage.createSeries({
          studyId: study.id,
          seriesInstanceUID: seriesData.seriesInstanceUID,
          seriesDescription: seriesData.seriesDescription,
          modality: seriesData.modality,
          imageCount: seriesData.files.length
        });

        // Create image entries for each file
        for (let i = 0; i < seriesData.files.length; i++) {
          const filePath = seriesData.files[i];
          const fileName = path.basename(filePath);
          
          await storage.createImage({
            seriesId: series.id,
            sopInstanceUID: `${seriesUID}.${i + 1}`,
            filePath: filePath,
            fileName: fileName,
            instanceNumber: i + 1,
            fileSize: fs.statSync(filePath).size
          });
        }
      }
    }

    console.log(`Successfully uploaded LIMBIC scan data with ${Object.keys(scanData.studies).length} studies`);

  } catch (error) {
    console.error('Error uploading LIMBIC scan:', error);
    throw error;
  }
}

function getStudyDescriptionForDir(dirName: string): string {
  switch (dirName) {
    case 'DICOM_SRS':
      return 'Brain CT with Structure Set';
    case 'MRI_MPRAGE':
      return 'Brain MRI MPRAGE';
    case 'REG':
      return 'Registration Data';
    default:
      return `LIMBIC ${dirName} Study`;
  }
}

function getModalityForDir(dirName: string): string {
  switch (dirName) {
    case 'DICOM_SRS':
      return 'CT';
    case 'MRI_MPRAGE':
      return 'MR';
    case 'REG':
      return 'REG';
    default:
      return 'OT';
  }
}

function getSeriesDescriptionForDir(dirName: string): string {
  switch (dirName) {
    case 'DICOM_SRS':
      return 'Brain CT Axial with Structure Set';
    case 'MRI_MPRAGE':
      return 'T1 MPRAGE 3D';
    case 'REG':
      return 'Registration Matrix';
    default:
      return `${dirName} Series`;
  }
}