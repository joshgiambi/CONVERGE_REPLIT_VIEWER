const fs = require('fs');
const dicomParser = require('dicom-parser');

const regFile = 'storage/patients/OZa7UswspYAakrgYemxMdqy1E/1.2.246.352.221.562728508619352284615748755713089003937/1.2.246.352.221.51399723574694919545666599258325590455/1.2.246.352.221.47107871783223454141765951539006254246.dcm';

console.log('\n=== Testing REG Parser Logic ===\n');

const dicomData = fs.readFileSync(regFile);
const dataSet = dicomParser.parseDicom(dicomData);

const mainFrameOfRef = dataSet.string('x00200052');
console.log('REG Frame of Reference UID:', mainFrameOfRef);

// Parse Referenced Series Sequence
const referencedSeriesSeq = dataSet.elements['x00081115'];
if (referencedSeriesSeq) {
  console.log('\nReferenced Series Sequence found, length:', referencedSeriesSeq.length);
  
  const buffer = dicomData.slice(referencedSeriesSeq.dataOffset, referencedSeriesSeq.dataOffset + referencedSeriesSeq.length);
  const seriesUIDTag = Buffer.from([0x20, 0x00, 0x0E, 0x00]); // (0020,000E)
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
  
  console.log('\nFound Series UIDs:');
  foundUIDs.forEach((uid, idx) => {
    console.log(`  ${idx}: ${uid}`);
  });
  
} else {
  console.log('No Referenced Series Sequence found!');
}
