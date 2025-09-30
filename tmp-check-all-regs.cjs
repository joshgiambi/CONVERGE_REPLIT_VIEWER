const fs = require('fs');
const dicomParser = require('dicom-parser');
const { execSync } = require('child_process');

// Get all REG file paths
const result = execSync(`psql "$DATABASE_URL" -t -c "SELECT file_path FROM images WHERE series_id IN (2498, 2499, 2500, 2501, 2502) LIMIT 10;"`, {
  env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL }
}).toString();

const regFiles = result.trim().split('\n').map(line => line.trim());

console.log(`\n=== Checking ${regFiles.length} REG files ===\n`);

const targetUIDs = [
  '1.2.246.352.221.49537297405199815191289945572223233980', // 2493 CT
  '1.2.246.352.221.51221724992877536554229446628611839124', // 2494 PT
  '1.2.246.352.221.562259815046681788014829458936926464757', // 2496 CT
  '1.2.246.352.221.559950929094914669616739272664074730773'  // 2497 CT
];

regFiles.forEach((regFile, idx) => {
  try {
    const dicomData = fs.readFileSync(regFile);
    const dataSet = dicomParser.parseDicom(dicomData);
    
    const referencedSeriesSeq = dataSet.elements['x00081115'];
    if (!referencedSeriesSeq) {
      console.log(`REG ${idx+1}: No Referenced Series Sequence`);
      return;
    }
    
    const buffer = dicomData.slice(referencedSeriesSeq.dataOffset, referencedSeriesSeq.dataOffset + referencedSeriesSeq.length);
    const seriesUIDTag = Buffer.from([0x20, 0x00, 0x0E, 0x00]);
    const foundUIDs = [];
    
    let offset = 0;
    while (offset < buffer.length - 4) {
      if (buffer[offset] === seriesUIDTag[0] &&
          buffer[offset + 1] === seriesUIDTag[1] &&
          buffer[offset + 2] === seriesUIDTag[2] &&
          buffer[offset + 3] === seriesUIDTag[3]) {
        
        const valueLength = buffer.readUInt32LE(offset + 4);
        const valueOffset = offset + 8;
        
        if (valueLength < 1000 && valueOffset + valueLength <= buffer.length) {
          const valueBytes = buffer.slice(valueOffset, valueOffset + valueLength);
          const value = valueBytes.toString('ascii').trim().replace(/\0/g, '');
          if (value.length > 10 && value.startsWith('1.')) {
            foundUIDs.push(value);
          }
        }
      }
      offset++;
    }
    
    // Check if any of the referenced UIDs match our target CT/PET series
    const matches = foundUIDs.filter(uid => targetUIDs.includes(uid));
    if (matches.length > 0) {
      console.log(`\n✅ REG ${idx+1} references CT/PET series!`);
      console.log(`   File: ${regFile.substring(regFile.lastIndexOf('/') + 1)}`);
      console.log(`   Matched: ${matches.length} series`);
      foundUIDs.forEach(uid => console.log(`     - ${uid}${targetUIDs.includes(uid) ? ' ⭐' : ''}`));
    }
    
  } catch (e) {
    console.log(`REG ${idx+1}: Error - ${e.message}`);
  }
});

console.log('\n');
