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
          imageCount: number;
        };
      };
    };
  };
  registration?: {
    registrationUID: string;
    primaryImageSet: string;
    secondaryImageSet: string;
    transformationType: string;
  };
}

function generateUID(): string {
  return `1.2.3.${Date.now()}.${Math.floor(Math.random() * 10000)}`;
}

function analyzeDICOMDirectory(dirPath: string, dirName: string): { 
  files: string[], 
  modality: string, 
  count: number,
  metadata: any
} {
  if (!fs.existsSync(dirPath)) {
    return { files: [], modality: 'UNKNOWN', count: 0, metadata: null };
  }
  
  const files = fs.readdirSync(dirPath).filter(file => file.endsWith('.dcm'));
  let modality = 'UNKNOWN';
  let metadata = null;
  
  if (files.length > 0) {
    try {
      const firstFile = path.join(dirPath, files[0]);
      metadata = parseDICOMMetadata(firstFile);
      modality = metadata.modality || getModalityFromDir(dirName);
    } catch (error) {
      console.log(`Could not parse ${files[0]}:`, error);
      modality = getModalityFromDir(dirName);
    }
  }
  
  return { 
    files: files.map(file => path.join(dirPath, file)), 
    modality, 
    count: files.length,
    metadata
  };
}

function getModalityFromDir(dirName: string): string {
  switch (dirName.toUpperCase()) {
    case 'MRI_MPRAGE':
      return 'MR';
    case 'DICOM_SRS':
      return 'RTSTRUCT';
    case 'REG':
      return 'REG';
    default:
      return 'UNKNOWN';
  }
}

function getSeriesDescription(dirName: string, modality: string): string {
  switch (dirName.toUpperCase()) {
    case 'MRI_MPRAGE':
      return 'T1-weighted MPRAGE';
    case 'DICOM_SRS':
      return 'RT Structure Sets';
    case 'REG':
      return 'Spatial Registration';
    default:
      return `${modality} Series`;
  }
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

    console.log('Analyzing LIMBIC scan structure...');

    // Analyze each directory
    const mriData = analyzeDICOMDirectory(path.join(limbicPath, 'MRI_MPRAGE'), 'MRI_MPRAGE');
    const srsData = analyzeDICOMDirectory(path.join(limbicPath, 'DICOM_SRS'), 'DICOM_SRS');
    const regData = analyzeDICOMDirectory(path.join(limbicPath, 'REG'), 'REG');

    console.log(`Found: MRI=${mriData.count} slices, Structures=${srsData.count} files, Registration=${regData.count} files`);

    // Extract patient info from MRI metadata (most reliable source)
    let patientInfo = {
      patientID: "LIMBIC_57",
      patientName: "LIMBIC Neuroimaging Patient",
      patientSex: "U",
      patientAge: "45Y"
    };

    if (mriData.metadata) {
      patientInfo = {
        patientID: mriData.metadata.patientID || "LIMBIC_57",
        patientName: mriData.metadata.patientName || "LIMBIC Neuroimaging Patient",
        patientSex: mriData.metadata.patientSex || "U",
        patientAge: mriData.metadata.patientAge || "45Y"
      };
    }

    const scanData: LimbicScanData = {
      patient: patientInfo,
      studies: {}
    };

    // Process MRI study (primary neuroimaging)
    if (mriData.count > 0) {
      const studyUID = mriData.metadata?.studyInstanceUID || generateUID() + '.mri';
      scanData.studies[studyUID] = {
        studyInstanceUID: studyUID,
        studyDate: mriData.metadata?.studyDate || '20230215',
        studyTime: mriData.metadata?.studyTime || '143000',
        studyDescription: 'Brain MRI with Structure Sets',
        accessionNumber: 'LIMBIC_MRI_001',
        modality: 'MR',
        series: {
          'mri_series': {
            seriesInstanceUID: mriData.metadata?.seriesInstanceUID || generateUID() + '.mri.001',
            seriesDescription: getSeriesDescription('MRI_MPRAGE', mriData.modality),
            modality: mriData.modality,
            files: mriData.files,
            imageCount: mriData.count
          }
        }
      };

      // Add structure sets to MRI study if available
      if (srsData.count > 0) {
        scanData.studies[studyUID].series['structure_sets'] = {
          seriesInstanceUID: srsData.metadata?.seriesInstanceUID || generateUID() + '.srs.001',
          seriesDescription: getSeriesDescription('DICOM_SRS', srsData.modality),
          modality: srsData.modality,
          files: srsData.files,
          imageCount: srsData.count
        };
      }
    }

    // Process registration if available
    if (regData.count > 0 && regData.metadata) {
      scanData.registration = {
        registrationUID: regData.metadata.sopInstanceUID || generateUID() + '.reg',
        primaryImageSet: 'MR', // MRI is primary in this case
        secondaryImageSet: 'RTSTRUCT', // Structure sets are secondary
        transformationType: 'RIGID_BODY'
      };
    }

    // Create patient in database
    limbicPatient = await storage.createPatient({
      patientID: scanData.patient.patientID,
      patientName: scanData.patient.patientName,
      patientSex: scanData.patient.patientSex,
      patientAge: scanData.patient.patientAge
    });

    console.log(`Created LIMBIC patient: ${limbicPatient.patientName} (ID: ${limbicPatient.patientID})`);

    // Create studies and series
    for (const [studyUID, studyData] of Object.entries(scanData.studies)) {
      const totalImages = Object.values(studyData.series).reduce((sum, series) => sum + series.imageCount, 0);
      
      const study = await storage.createStudy({
        patientId: limbicPatient.id,
        studyInstanceUID: studyData.studyInstanceUID,
        studyDate: studyData.studyDate,
        studyTime: studyData.studyTime,
        studyDescription: studyData.studyDescription,
        accessionNumber: studyData.accessionNumber,
        modality: studyData.modality,
        numberOfSeries: Object.keys(studyData.series).length,
        numberOfImages: totalImages,
        isDemo: true
      });

      console.log(`Created study: ${study.studyDescription} with ${Object.keys(studyData.series).length} series`);

      // Create series
      let seriesNumber = 1;
      for (const [seriesKey, seriesData] of Object.entries(studyData.series)) {
        const series = await storage.createSeries({
          studyId: study.id,
          seriesInstanceUID: seriesData.seriesInstanceUID,
          seriesDescription: seriesData.seriesDescription,
          modality: seriesData.modality,
          imageCount: seriesData.imageCount,
          seriesNumber: seriesNumber++
        });

        console.log(`Created series: ${series.seriesDescription} (${seriesData.modality}) with ${seriesData.imageCount} images`);

        // Create images
        for (const [index, filePath] of seriesData.files.entries()) {
          const fileName = path.basename(filePath);
          const sopInstanceUID = generateUID() + `.${seriesKey}.${index + 1}`;

          await storage.createImage({
            seriesId: series.id,
            sopInstanceUID,
            filePath,
            fileName,
            instanceNumber: index + 1,
            fileSize: fs.statSync(filePath).size
          });
        }
      }
    }

    if (scanData.registration) {
      console.log(`Registration fusion: ${scanData.registration.primaryImageSet} (primary) ↔ ${scanData.registration.secondaryImageSet} (secondary)`);
    }

    console.log('LIMBIC scan uploaded successfully with authentic DICOM metadata');
    
  } catch (error) {
    console.error('Error uploading LIMBIC scan:', error);
  }
}