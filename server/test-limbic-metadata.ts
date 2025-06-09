import fs from 'fs';
import path from 'path';
import { parseDICOMMetadata } from './dicom-parser';

// Test script to examine actual LIMBIC DICOM metadata
async function testLimbicMetadata() {
  const limbicPath = path.join(process.cwd(), 'attached_assets', 'LIMBIC_57');
  
  console.log('=== LIMBIC DICOM Metadata Analysis ===\n');
  
  // Test MRI files
  const mriPath = path.join(limbicPath, 'MRI_MPRAGE');
  if (fs.existsSync(mriPath)) {
    const mriFiles = fs.readdirSync(mriPath).filter(f => f.endsWith('.dcm')).slice(0, 3);
    console.log(`MRI Files (${mriFiles.length} of ${fs.readdirSync(mriPath).filter(f => f.endsWith('.dcm')).length}):`);
    
    for (const file of mriFiles) {
      try {
        const metadata = parseDICOMMetadata(path.join(mriPath, file));
        console.log(`File: ${file}`);
        console.log(`  Patient ID: ${metadata.patientID || 'N/A'}`);
        console.log(`  Patient Name: ${metadata.patientName || 'N/A'}`);
        console.log(`  Study UID: ${metadata.studyInstanceUID || 'N/A'}`);
        console.log(`  Series UID: ${metadata.seriesInstanceUID || 'N/A'}`);
        console.log(`  Instance #: ${metadata.instanceNumber || 'N/A'}`);
        console.log(`  Modality: ${metadata.modality || 'N/A'}`);
        console.log(`  Series Desc: ${metadata.seriesDescription || 'N/A'}`);
        console.log(`  Slice Location: ${metadata.sliceLocation || 'N/A'}`);
        console.log('');
      } catch (error) {
        console.log(`Error parsing ${file}: ${error}`);
      }
    }
  }
  
  // Test Structure Set files
  const srsPath = path.join(limbicPath, 'DICOM_SRS');
  if (fs.existsSync(srsPath)) {
    const srsFiles = fs.readdirSync(srsPath).filter(f => f.endsWith('.dcm')).slice(0, 2);
    console.log(`Structure Set Files (${srsFiles.length} of ${fs.readdirSync(srsPath).filter(f => f.endsWith('.dcm')).length}):`);
    
    for (const file of srsFiles) {
      try {
        const metadata = parseDICOMMetadata(path.join(srsPath, file));
        console.log(`File: ${file}`);
        console.log(`  Patient ID: ${metadata.patientID || 'N/A'}`);
        console.log(`  Study UID: ${metadata.studyInstanceUID || 'N/A'}`);
        console.log(`  Series UID: ${metadata.seriesInstanceUID || 'N/A'}`);
        console.log(`  Modality: ${metadata.modality || 'N/A'}`);
        console.log(`  Series Desc: ${metadata.seriesDescription || 'N/A'}`);
        console.log('');
      } catch (error) {
        console.log(`Error parsing ${file}: ${error}`);
      }
    }
  }
  
  // Test Registration file
  const regPath = path.join(limbicPath, 'REG');
  if (fs.existsSync(regPath)) {
    const regFiles = fs.readdirSync(regPath).filter(f => f.endsWith('.dcm'));
    console.log(`Registration Files (${regFiles.length}):`);
    
    for (const file of regFiles) {
      try {
        const metadata = parseDICOMMetadata(path.join(regPath, file));
        console.log(`File: ${file}`);
        console.log(`  Patient ID: ${metadata.patientID || 'N/A'}`);
        console.log(`  Study UID: ${metadata.studyInstanceUID || 'N/A'}`);
        console.log(`  Series UID: ${metadata.seriesInstanceUID || 'N/A'}`);
        console.log(`  SOP Instance UID: ${metadata.sopInstanceUID || 'N/A'}`);
        console.log(`  Modality: ${metadata.modality || 'N/A'}`);
        console.log(`  Series Desc: ${metadata.seriesDescription || 'N/A'}`);
        console.log('');
      } catch (error) {
        console.log(`Error parsing ${file}: ${error}`);
      }
    }
  }
}

// Run the test
testLimbicMetadata().catch(console.error);