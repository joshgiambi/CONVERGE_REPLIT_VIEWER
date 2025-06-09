import fs from 'fs';
import path from 'path';
import * as dcmjs from 'dcmjs';

function getAllDicomFiles(dirPath) {
  const files = [];
  
  function scanDirectory(currentPath) {
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

function parseDICOMMetadata(filePath) {
  try {
    const buffer = fs.readFileSync(filePath);
    const dataset = dcmjs.data.DicomMessage.readFile(buffer.buffer);
    const dict = dataset.dict;
    
    return {
      studyInstanceUID: dict['0020000D']?.Value?.[0],
      seriesInstanceUID: dict['0020000E']?.Value?.[0],
      modality: dict['00080060']?.Value?.[0],
      seriesDescription: dict['0008103E']?.Value?.[0],
      patientID: dict['00100020']?.Value?.[0],
      instanceNumber: dict['00200013']?.Value?.[0]
    };
  } catch (error) {
    console.error(`Error parsing ${filePath}:`, error.message);
    return null;
  }
}

async function analyzeLimbicDataset() {
  const limbicPath = path.join(process.cwd(), 'attached_assets', 'LIMBIC_57');
  
  console.log('Analyzing LIMBIC dataset structure...');
  
  const allFiles = getAllDicomFiles(limbicPath);
  console.log(`Total DICOM files found: ${allFiles.length}`);
  
  const studies = new Map();
  const series = new Map();
  let successfulParses = 0;
  
  for (const filePath of allFiles) {
    const metadata = parseDICOMMetadata(filePath);
    if (!metadata) continue;
    
    successfulParses++;
    
    // Group by study UID
    const studyUID = metadata.studyInstanceUID;
    if (studyUID) {
      if (!studies.has(studyUID)) {
        studies.set(studyUID, {
          studyUID,
          modalities: new Set(),
          fileCount: 0
        });
      }
      studies.get(studyUID).modalities.add(metadata.modality);
      studies.get(studyUID).fileCount++;
    }
    
    // Group by series UID
    const seriesUID = metadata.seriesInstanceUID;
    if (seriesUID) {
      if (!series.has(seriesUID)) {
        series.set(seriesUID, {
          seriesUID,
          studyUID,
          modality: metadata.modality,
          seriesDescription: metadata.seriesDescription,
          files: []
        });
      }
      series.get(seriesUID).files.push(filePath);
    }
  }
  
  console.log(`Successfully parsed: ${successfulParses}/${allFiles.length} files`);
  console.log(`\nStudies found: ${studies.size}`);
  
  for (const [studyUID, study] of studies) {
    console.log(`  Study: ${studyUID}`);
    console.log(`    Modalities: ${Array.from(study.modalities).join(', ')}`);
    console.log(`    Total files: ${study.fileCount}`);
  }
  
  console.log(`\nSeries found: ${series.size}`);
  
  for (const [seriesUID, seriesInfo] of series) {
    console.log(`  Series: ${seriesUID}`);
    console.log(`    Modality: ${seriesInfo.modality}`);
    console.log(`    Description: ${seriesInfo.seriesDescription}`);
    console.log(`    Files: ${seriesInfo.files.length}`);
  }
  
  // Count by modality
  const modalityCount = new Map();
  for (const seriesInfo of series.values()) {
    const current = modalityCount.get(seriesInfo.modality) || 0;
    modalityCount.set(seriesInfo.modality, current + seriesInfo.files.length);
  }
  
  console.log('\nFiles by modality:');
  for (const [modality, count] of modalityCount) {
    console.log(`  ${modality}: ${count} files`);
  }
}

analyzeLimbicDataset().catch(console.error);