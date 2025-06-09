import fs from 'fs';
import path from 'path';
import { storage } from './storage';
import { parseDICOMMetadata } from './dicom-parser';

interface ThoraxScanData {
  patient: {
    patientID: string;
    patientName: string;
    patientSex: string;
    patientAge: string;
  };
  study: {
    studyInstanceUID: string;
    studyDate: string;
    studyTime: string;
    studyDescription: string;
    accessionNumber: string;
  };
  series: {
    ct: {
      seriesInstanceUID: string;
      seriesDescription: string;
      modality: string;
      files: string[];
    };
    dose: {
      seriesInstanceUID: string;
      seriesDescription: string;
      modality: string;
      files: string[];
    };
    plan: {
      seriesInstanceUID: string;
      seriesDescription: string;
      modality: string;
      files: string[];
    };
    structure: {
      seriesInstanceUID: string;
      seriesDescription: string;
      modality: string;
      files: string[];
    };
  };
}

export async function uploadThoraxScan(): Promise<void> {
  const thoraxPath = path.join(process.cwd(), 'uploads', 'THORAX_05');
  
  if (!fs.existsSync(thoraxPath)) {
    throw new Error('THORAX_05 directory not found');
  }

  // Create patient
  const patient = await storage.createPatient({
    patientID: 'THORAX_05_PATIENT',
    patientName: 'Thorax Demo Patient',
    patientSex: 'M',
    patientAge: '65Y'
  });

  // Create study
  const study = await storage.createStudy({
    patientId: patient.id,
    studyInstanceUID: '2.16.840.1.114362.1.11745409.22349166682.494938850',
    studyDate: '20220615',
    studyDescription: 'THORAX RT Planning Study',
    accessionNumber: 'THORAX_05_ACC',
    seriesCount: 0,
    imageCount: 0
  });

  // Process CT DICOM files
  const ctFiles = fs.readdirSync(path.join(thoraxPath, 'DICOM'))
    .filter(file => file.endsWith('.dcm'))
    .sort();

  if (ctFiles.length > 0) {
    const ctSeries = await storage.createSeries({
      studyId: study.id,
      seriesInstanceUID: '2.16.840.1.114362.1.11745409.22349166682.494938851',
      seriesDescription: 'CT Thorax Axial',
      modality: 'CT',
      imageCount: ctFiles.length
    });

    // Process each CT image
    for (let i = 0; i < ctFiles.length; i++) {
      const file = ctFiles[i];
      const filePath = path.join(thoraxPath, 'DICOM', file);
      
      try {
        const metadata = parseDICOMMetadata(filePath);
        
        await storage.createImage({
          seriesId: ctSeries.id,
          sopInstanceUID: metadata.sopInstanceUID || `2.16.840.1.114362.1.11745409.22349166682.494938851.${i + 1}`,
          instanceNumber: i + 1,
          sliceLocation: metadata.sliceLocation || (i * 5.0), // 5mm slice spacing
          sliceThickness: metadata.sliceThickness || 5.0,
          rows: metadata.rows || 512,
          columns: metadata.columns || 512,
          pixelSpacing: metadata.pixelSpacing ? `${metadata.pixelSpacing[0]}\\${metadata.pixelSpacing[1]}` : '0.976562\\0.976562',
          windowCenter: metadata.windowCenter || 40,
          windowWidth: metadata.windowWidth || 400,
          filePath: filePath
        });
      } catch (error) {
        console.error(`Error processing CT file ${file}:`, error);
      }
    }
  }

  // Process RT Dose file
  const doseFiles = fs.readdirSync(path.join(thoraxPath, 'DOSE'))
    .filter(file => file.endsWith('.dcm'));

  if (doseFiles.length > 0) {
    const doseSeries = await storage.createSeries({
      studyId: study.id,
      seriesInstanceUID: '2.16.840.1.114362.1.11745409.22349166682.494938856',
      seriesDescription: 'RT Dose Distribution',
      modality: 'RTDOSE',
      imageCount: doseFiles.length,
      bodyPartExamined: 'CHEST',
      protocolName: 'RT Dose Calculation'
    });

    for (let i = 0; i < doseFiles.length; i++) {
      const file = doseFiles[i];
      const filePath = path.join(thoraxPath, 'DOSE', file);
      
      await storage.createImage({
        seriesId: doseSeries.id,
        sopInstanceUID: `2.16.840.1.114362.1.11745409.22349166682.494938856.${i + 1}`,
        instanceNumber: i + 1,
        sliceLocation: 0,
        sliceThickness: 5.0,
        rows: 512,
        columns: 512,
        pixelSpacing: '0.976562\\0.976562',
        windowCenter: 2000,
        windowWidth: 4000,
        filePath: filePath
      });
    }
  }

  // Process RT Plan file
  const planFiles = fs.readdirSync(path.join(thoraxPath, 'PLAN'))
    .filter(file => file.endsWith('.dcm'));

  if (planFiles.length > 0) {
    const planSeries = await storage.createSeries({
      studyId: study.id,
      seriesInstanceUID: '2.16.840.1.114362.1.11745409.22349166682.494938855',
      seriesDescription: 'RT Treatment Plan',
      modality: 'RTPLAN',
      imageCount: planFiles.length,
      bodyPartExamined: 'CHEST',
      protocolName: 'RT Planning Protocol'
    });

    for (let i = 0; i < planFiles.length; i++) {
      const file = planFiles[i];
      const filePath = path.join(thoraxPath, 'PLAN', file);
      
      await storage.createImage({
        seriesId: planSeries.id,
        sopInstanceUID: `2.16.840.1.114362.1.11745409.22349166682.494938855.${i + 1}`,
        instanceNumber: i + 1,
        sliceLocation: 0,
        sliceThickness: 5.0,
        rows: 512,
        columns: 512,
        pixelSpacing: '0.976562\\0.976562',
        windowCenter: 100,
        windowWidth: 200,
        filePath: filePath
      });
    }
  }

  // Process RT Structure Set (MIM file)
  const structureFiles = fs.readdirSync(path.join(thoraxPath, 'MIM'))
    .filter(file => file.endsWith('.dcm'));

  if (structureFiles.length > 0) {
    const structureSeries = await storage.createSeries({
      studyId: study.id,
      seriesInstanceUID: '2.16.840.1.114362.1.11745409.22349166682.494938857',
      seriesDescription: 'RT Structure Set',
      modality: 'RTSTRUCT',
      imageCount: structureFiles.length,
      bodyPartExamined: 'CHEST',
      protocolName: 'RT Structure Protocol'
    });

    for (let i = 0; i < structureFiles.length; i++) {
      const file = structureFiles[i];
      const filePath = path.join(thoraxPath, 'MIM', file);
      
      await storage.createImage({
        seriesId: structureSeries.id,
        sopInstanceUID: `2.16.840.1.114362.1.11745409.22349166682.494938857.${i + 1}`,
        instanceNumber: i + 1,
        sliceLocation: 0,
        sliceThickness: 5.0,
        rows: 512,
        columns: 512,
        pixelSpacing: '0.976562\\0.976562',
        windowCenter: 100,
        windowWidth: 200,
        filePath: filePath
      });
    }
  }

  // Update study counts
  const allSeries = await storage.getSeriesByStudyId(study.id);
  const totalImages = allSeries.reduce((sum, series) => sum + series.imageCount, 0);
  
  await storage.updateStudyCounts(study.id, allSeries.length, totalImages);

  console.log(`Successfully uploaded THORAX_05 scan:
    - Patient: ${patient.patientName} (${patient.patientID})
    - Study: ${study.studyDescription}
    - Series: ${allSeries.length}
    - Images: ${totalImages}
    - CT Images: ${ctFiles.length}
    - RT Dose: ${doseFiles.length}
    - RT Plan: ${planFiles.length}
    - RT Structures: ${structureFiles.length}`);
}