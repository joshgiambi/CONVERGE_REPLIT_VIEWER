const fs = require('fs');
const dicomParser = require('dicom-parser');

// Our target FoR UIDs
const petCtFor = '1.2.246.352.221.498240581752208121912291'; // 2493/2494
const cbctFor = '1.2.246.352.221.488247120000276366653062';   // 2496
const planningFor = '1.2.246.352.221.524380842283401709296266'; // 2497

const regFilesText = fs.readFileSync('/tmp/reg_files.txt', 'utf8');
const regFiles = regFilesText.trim().split('\n').map(line => line.trim()).filter(line => line.length > 0);

console.log(`\n=== Deep Analysis of REG Files ===\n`);

regFiles.forEach((regFile, idx) => {
  try {
    if (!fs.existsSync(regFile)) return;
    
    const dicomData = fs.readFileSync(regFile);
    const dataSet = dicomParser.parseDicom(dicomData);
    
    const regForUID = dataSet.string('x00200052');
    
    console.log(`\nREG #${idx+1}: ${regFile.split('/').pop()}`);
    console.log(`  REG's own FoR: ${regForUID ? regForUID.substring(0, 50) + '...' : 'None'}`);
    
    // Check for Frame of Reference UID in Referenced Frame of Reference Sequence
    // Tag (3006,0010) = Referenced Frame of Reference Sequence
    const refForSeq = dataSet.elements['x30060010'];
    
    if (refForSeq) {
      console.log(`  ✓ Has Referenced FoR Sequence (length: ${refForSeq.length})`);
      
      // Try to parse the sequence manually
      const buffer = dicomData.slice(refForSeq.dataOffset, refForSeq.dataOffset + refForSeq.length);
      
      // Search for Frame of Reference UID tag (0020,0052)
      const forTag = Buffer.from([0x20, 0x00, 0x52, 0x00]);
      const foundFoRs = [];
      
      let offset = 0;
      while (offset < buffer.length - 4) {
        if (buffer[offset] === forTag[0] &&
            buffer[offset + 1] === forTag[1] &&
            buffer[offset + 2] === forTag[2] &&
            buffer[offset + 3] === forTag[3]) {
          
          const valueLength = buffer.readUInt32LE(offset + 4);
          const valueOffset = offset + 8;
          
          if (valueLength < 1000 && valueOffset + valueLength <= buffer.length) {
            const valueBytes = buffer.slice(valueOffset, valueOffset + valueLength);
            const value = valueBytes.toString('ascii').trim().replace(/\0/g, '');
            if (value.length > 10 && value.startsWith('1.')) {
              foundFoRs.push(value);
            }
          }
        }
        offset++;
      }
      
      if (foundFoRs.length > 0) {
        console.log(`  Referenced FoR UIDs found in sequence:`);
        foundFoRs.forEach(forUid => {
          const isPetCt = forUid === petCtFor;
          const isCbct = forUid === cbctFor;
          const isPlanning = forUid === planningFor;
          
          if (isPetCt) console.log(`    ⭐⭐⭐ PET/CT (2493/2494): ${forUid}`);
          else if (isCbct) console.log(`    ⭐ CBCT (2496): ${forUid}`);
          else if (isPlanning) console.log(`    Planning CT (2497): ${forUid}`);
          else console.log(`    Other: ${forUid.substring(0, 50)}...`);
        });
      }
    } else {
      console.log(`  No Referenced FoR Sequence found`);
    }
    
  } catch (e) {
    console.log(`  Error: ${e.message}`);
  }
});

console.log('\n');
