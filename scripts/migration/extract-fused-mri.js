import yauzl from 'yauzl';
import fs from 'fs';
import path from 'path';

const zipPath = 'attached_assets/Fused_MRI_1752694246784.zip';
const extractPath = 'attached_assets/fused-mri-dataset';

// Create extraction directory
if (!fs.existsSync(extractPath)) {
  fs.mkdirSync(extractPath, { recursive: true });
}

yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
  if (err) throw err;
  
  console.log('Extracting zip file...');
  const files = [];
  
  zipfile.readEntry();
  zipfile.on('entry', (entry) => {
    const fullPath = path.join(extractPath, entry.fileName);
    
    if (/\/$/.test(entry.fileName)) {
      // Directory
      if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
      }
      zipfile.readEntry();
    } else {
      // File
      files.push(entry.fileName);
      
      // Ensure parent directory exists
      const dir = path.dirname(fullPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      zipfile.openReadStream(entry, (err, readStream) => {
        if (err) throw err;
        const writeStream = fs.createWriteStream(fullPath);
        readStream.pipe(writeStream);
        writeStream.on('close', () => {
          zipfile.readEntry();
        });
      });
    }
  });
  
  zipfile.on('end', () => {
    console.log('Extraction complete!');
    console.log(`Total files extracted: ${files.length}`);
    
    // List all files
    console.log('\nExtracted files:');
    files.forEach(file => {
      console.log(`  ${file}`);
    });
    
    // Analyze the structure
    const dicomFiles = files.filter(f => f.endsWith('.dcm'));
    console.log(`\nDICOM files found: ${dicomFiles.length}`);
    
    // Group by directory
    const directories = {};
    dicomFiles.forEach(file => {
      const dir = path.dirname(file);
      if (!directories[dir]) directories[dir] = [];
      directories[dir].push(file);
    });
    
    console.log('\nFiles by directory:');
    Object.entries(directories).forEach(([dir, files]) => {
      console.log(`  ${dir}: ${files.length} files`);
    });
  });
});