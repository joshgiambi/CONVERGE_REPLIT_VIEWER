const fs = require('fs');
const dicomParser = require('dicom-parser');

// CORRECT Series UIDs from database
const targetUIDs = [
  '1.2.246.352.221.534437763102598122915916606648478293420', // 2493 CT (PETCT)
  '1.2.246.352.221.482497532653462080914109465315058346371', // 2494 PT
  '1.2.246.352.221.570537758543275012911456240642628457867', // 2496 CT (CBCT)
  '1.2.246.352.221.49537297405199815191289945572223233980'  // 2497 CT (Planning)
];

const regFilesText = fs.readFileSync('/tmp/reg_files.txt', 'utf8');
const regFiles = regFilesText.trim().split('\n').map(line => line.trim()).filter(line => line.length > 0);

console.log(`\n=== Checking ${regFiles.length} REG files for CT/PET references ===\n`);

let foundAny = false;

regFiles.forEach((regFile, idx) => {
  try {
    if (!fs.existsSync(regFile)) {
      console.log(`REG ${idx+1}: File not found`);
      return;
    }
    
    const dicomData = fs.readFileSync(regFile);
    const dataSet = dicomParser.parseDicom(dicomData);
    
    const referencedSeriesSeq = dataSet.elements['x00081115'];
    if (!referencedSeriesSeq) {
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
    
    const matches = foundUIDs.filter(uid => targetUIDs.includes(uid));
    if (matches.length > 0) {
      foundAny = true;
      console.log(`✅ REG #${idx+1} references our CT/PET series!`);
      console.log(`   File: ${regFile.split('/').pop()}`);
      matches.forEach(uid => {
        const seriesId = uid === targetUIDs[0] ? '2493 (PETCT)' :
                        uid === targetUIDs[1] ? '2494 (PT)' :
                        uid === targetUIDs[2] ? '2496 (CBCT)' : '2497 (Planning)';
        console.log(`     ⭐ ${seriesId}`);
      });
      console.log(`   Total refs: ${foundUIDs.length} series`);
      console.log('');
    }
    
  } catch (e) {
    // Silent - most will fail
  }
});

if (!foundAny) {
  console.log('❌ NO REG files found that reference the CT/PET series (2493, 2494, 2496, 2497)');
  console.log('\nThis means the REG files in this dataset link treatment images (RTIMAGEs),');
  console.log('not the actual CT scans to each other.');
}

console.log('');
