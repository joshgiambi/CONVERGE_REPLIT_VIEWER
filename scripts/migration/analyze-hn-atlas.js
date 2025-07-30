import { DICOMParser } from './server/dicom-parser.js';
import fs from 'fs';
import path from 'path';

const datasetPath = './attached_assets/HN-ATLAS-84/HN-ATLAS-84';

console.log('=== HN-ATLAS-84 Dataset Analysis ===');

// Analyze DICOM_CONTRAST folder
const contrastPath = path.join(datasetPath, 'DICOM_CONTRAST');
const mimPath = path.join(datasetPath, 'MIM');

try {
  console.log('\n--- Analyzing DICOM_CONTRAST folder ---');
  const { data: contrastData, rtstructDetails } = DICOMParser.parseDICOMFromFolder(contrastPath);
  
  console.log(`Found ${contrastData.length} DICOM files in DICOM_CONTRAST`);
  
  if (contrastData.length > 0) {
    const sample = contrastData[0];
    console.log('\nSample metadata from DICOM_CONTRAST:');
    console.log(`Patient Name: ${sample.patientName || 'Unknown'}`);
    console.log(`Patient ID: ${sample.patientID || 'Unknown'}`);
    console.log(`Modality: ${sample.modality || 'Unknown'}`);
    console.log(`Study Date: ${sample.studyDate || 'Unknown'}`);
    console.log(`Study Description: ${sample.studyDescription || 'Unknown'}`);
    console.log(`Series Description: ${sample.seriesDescription || 'Unknown'}`);
    
    // Count unique series
    const uniqueSeries = [...new Set(contrastData.map(d => d.seriesInstanceUID))];
    console.log(`Unique series: ${uniqueSeries.length}`);
    
    // Group by modality
    const modalityGroups = {};
    contrastData.forEach(d => {
      if (!modalityGroups[d.modality || 'Unknown']) {
        modalityGroups[d.modality || 'Unknown'] = 0;
      }
      modalityGroups[d.modality || 'Unknown']++;
    });
    
    console.log('Files by modality:');
    Object.entries(modalityGroups).forEach(([modality, count]) => {
      console.log(`  ${modality}: ${count} files`);
    });
  }
  
  console.log('\n--- Analyzing MIM folder (RT Structures) ---');
  const { data: mimData, rtstructDetails: mimRTStruct } = DICOMParser.parseDICOMFromFolder(mimPath);
  
  console.log(`Found ${mimData.length} DICOM files in MIM`);
  
  if (mimData.length > 0) {
    const rtSample = mimData[0];
    console.log('\nRT Structure metadata:');
    console.log(`Patient Name: ${rtSample.patientName || 'Unknown'}`);
    console.log(`Patient ID: ${rtSample.patientID || 'Unknown'}`);
    console.log(`Modality: ${rtSample.modality || 'Unknown'}`);
    console.log(`Structure Set Date: ${rtSample.structureSetDate || 'Unknown'}`);
    
    if (rtSample.structures && rtSample.structures.length > 0) {
      console.log(`\nFound ${rtSample.structures.length} RT structures:`);
      rtSample.structures.forEach((struct, i) => {
        console.log(`  ${i + 1}. ${struct.name} ${struct.color ? `(RGB: ${struct.color.join(',')})` : '(no color)'}`);
      });
    }
  }
  
  console.log('\n=== Dataset Summary ===');
  console.log('This appears to be a Head & Neck Cancer (HN-ATLAS-84) dataset containing:');
  console.log('1. Contrast-enhanced CT images');
  console.log('2. RT Structure Set with organ/tumor contours');
  console.log('3. Suitable for radiation therapy planning and analysis');
  console.log('\nTotal DICOM files:', contrastData.length + mimData.length);
  
} catch (error) {
  console.error('Error analyzing dataset:', error.message);
}