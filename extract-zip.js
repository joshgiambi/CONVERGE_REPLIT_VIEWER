import fs from 'fs';
import path from 'path';
import yauzl from 'yauzl';

const zipPath = './attached_assets/HN-ATLAS-84_1749485824563.zip';
const extractDir = './attached_assets/HN-ATLAS-84';

// Create extraction directory
if (!fs.existsSync(extractDir)) {
  fs.mkdirSync(extractDir, { recursive: true });
}

yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
  if (err) throw err;
  
  console.log(`ZIP file contains ${zipfile.entryCount} entries`);
  zipfile.readEntry();
  
  zipfile.on('entry', (entry) => {
    if (/\/$/.test(entry.fileName)) {
      // Directory entry
      const dirPath = path.join(extractDir, entry.fileName);
      fs.mkdirSync(dirPath, { recursive: true });
      zipfile.readEntry();
    } else {
      // File entry
      console.log(`Extracting: ${entry.fileName} (${entry.uncompressedSize} bytes)`);
      
      zipfile.openReadStream(entry, (err, readStream) => {
        if (err) throw err;
        
        const filePath = path.join(extractDir, entry.fileName);
        const dirPath = path.dirname(filePath);
        fs.mkdirSync(dirPath, { recursive: true });
        
        const writeStream = fs.createWriteStream(filePath);
        readStream.pipe(writeStream);
        
        writeStream.on('close', () => {
          zipfile.readEntry();
        });
      });
    }
  });
  
  zipfile.on('end', () => {
    console.log('ZIP extraction complete');
    
    // Now analyze the extracted files
    analyzeExtractedFiles();
  });
});

function analyzeExtractedFiles() {
  console.log('\n=== DICOM Dataset Analysis ===');
  
  const files = [];
  function walkDir(dir) {
    const items = fs.readdirSync(dir);
    for (const item of items) {
      const fullPath = path.join(dir, item);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        walkDir(fullPath);
      } else {
        files.push(fullPath);
      }
    }
  }
  
  walkDir(extractDir);
  
  console.log(`Total files extracted: ${files.length}`);
  
  // Try to identify DICOM files
  const dicomFiles = files.filter(file => {
    try {
      const buffer = fs.readFileSync(file, { start: 128, end: 132 });
      return buffer.toString() === 'DICM';
    } catch {
      return false;
    }
  });
  
  console.log(`DICOM files found: ${dicomFiles.length}`);
  
  if (dicomFiles.length > 0) {
    console.log('\nDICOM Files:');
    dicomFiles.forEach(file => {
      const size = fs.statSync(file).size;
      console.log(`  ${path.relative(extractDir, file)} (${size} bytes)`);
    });
  }
  
  // Try to parse first DICOM file for metadata
  if (dicomFiles.length > 0) {
    try {
      const { DICOMMetadataParser } = await import('./server/dicom-metadata-parser.js');
      const metadata = DICOMMetadataParser.parseDICOMFile(dicomFiles[0]);
      
      console.log('\n=== Sample DICOM Metadata ===');
      console.log(`Patient Name: ${metadata.patientName || 'Unknown'}`);
      console.log(`Patient ID: ${metadata.patientID || 'Unknown'}`);
      console.log(`Modality: ${metadata.modality || 'Unknown'}`);
      console.log(`Study Date: ${metadata.studyDate || 'Unknown'}`);
      console.log(`Study Description: ${metadata.studyDescription || 'Unknown'}`);
      console.log(`Series Description: ${metadata.seriesDescription || 'Unknown'}`);
      
      if (metadata.structures && metadata.structures.length > 0) {
        console.log(`RT Structures: ${metadata.structures.length} found`);
        metadata.structures.forEach((struct, i) => {
          console.log(`  ${i + 1}. ${struct.name} (color: ${struct.color || 'none'})`);
        });
      }
      
    } catch (error) {
      console.log('Error parsing DICOM metadata:', error.message);
    }
  }
}