const fs = require('fs');
const dicomParser = require('dicom-parser');

const targetUIDs = [
  '1.2.246.352.221.49537297405199815191289945572223233980', // 2493 CT (PETCT)
  '1.2.246.352.221.51221724992877536554229446628611839124', // 2494 PT
  '1.2.246.352.221.562259815046681788014829458936926464757', // 2496 CT (CBCT)
  '1.2.246.352.221.559950929094914669616739272664074730773'  // 2497 CT (Planning)
];

const regFiles = [
  'storage/patients/OZa7UswspYAakrgYemxMdqy1E/1.2.246.352.221.562728508619352284615748755713089003937/1.2.246.352.221.51399723574694919545666599258325590455/1.2.246.352.221.47107871783223454141765951539006254246.dcm',
  'storage/patients/OZa7UswspYAakrgYemxMdqy1E/1.2.246.352.221.562728508619352284615748755713089003937/1.2.246.352.221.544500580057704177610453666387339426459/1.2.246.352.221.50536508438063881766295327042461947798.dcm',
  'storage/patients/OZa7UswspYAakrgYemxMdqy1E/1.2.246.352.221.562728508619352284615748755713089003937/1.2.246.352.221.47936617555942191882790461593057333660/1.2.246.352.221.52810088245862539895973696644000486024.dcm',
];

console.log('\n=== Checking REG files for CT/PET references ===\n');

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
    
    const matches = foundUIDs.filter(uid => targetUIDs.includes(uid));
    if (matches.length > 0) {
      console.log(`✅ REG ${idx+1} references our CT/PET series!`);
      console.log(`   Matched UIDs:`);
      matches.forEach(uid => {
        const seriesId = uid === targetUIDs[0] ? '2493 (PETCT)' :
                        uid === targetUIDs[1] ? '2494 (PT)' :
                        uid === targetUIDs[2] ? '2496 (CBCT)' : '2497 (Planning)';
        console.log(`     - ${uid.substring(0, 50)}... (${seriesId})`);
      });
      console.log(`   All referenced UIDs: ${foundUIDs.length} total`);
      console.log('');
    } else {
      console.log(`REG ${idx+1}: No CT/PET matches (references ${foundUIDs.length} other series)`);
    }
    
  } catch (e) {
    console.log(`REG ${idx+1}: Error - ${e.message}`);
  }
});
