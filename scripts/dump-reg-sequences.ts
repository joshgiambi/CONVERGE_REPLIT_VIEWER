import 'dotenv/config';
import * as fs from 'fs';
import dicomParser from 'dicom-parser';

const testFile = process.argv[2];

if (!testFile) {
  console.log('Usage: tsx scripts/dump-reg-sequences.ts <path-to-reg-file>');
  process.exit(1);
}

const dicomData = fs.readFileSync(testFile);
const dataSet = dicomParser.parseDicom(dicomData);

console.log('\n=== REG File: Referenced Series Sequence ===\n');

// Get Referenced Series Sequence
const refSeriesSeq = dataSet.elements['x00081115'];
if (!refSeriesSeq) {
  console.log('No Referenced Series Sequence found!');
  process.exit(1);
}

console.log('Sequence VR:', refSeriesSeq.vr);
console.log('Sequence Length:', refSeriesSeq.length);
console.log('Sequence Offset:', refSeriesSeq.dataOffset);
console.log('');

// Try to parse as explicit sequence with items delimiter
const buffer = dicomData.slice(refSeriesSeq.dataOffset, refSeriesSeq.dataOffset + refSeriesSeq.length);
console.log('First 200 bytes of sequence data:');
console.log(buffer.slice(0, 200));
console.log('');

// Look for Series Instance UID tag (0020,000E) in the raw data
const seriesUIDTag = Buffer.from([0x20, 0x00, 0x0E, 0x00]); // Little endian
console.log('Searching for Series Instance UID tags (0020,000E)...\n');

let offset = 0;
let foundCount = 0;
const seriesUIDs: string[] = [];

while (offset < buffer.length - 4) {
  if (buffer[offset] === seriesUIDTag[0] &&
      buffer[offset + 1] === seriesUIDTag[1] &&
      buffer[offset + 2] === seriesUIDTag[2] &&
      buffer[offset + 3] === seriesUIDTag[3]) {

    foundCount++;
    console.log(`Found Series UID tag at offset ${offset}:`);

    // Try to read the value
    // Format: Tag(4) + VR(2) + Length(2 or 6) + Value
    const vr = String.fromCharCode(buffer[offset + 4], buffer[offset + 5]);
    console.log('  VR:', vr);

    // Check if this is explicit VR
    const nextByte = buffer[offset + 6];
    const nextByte2 = buffer[offset + 7];

    // For explicit VR with 2-byte length
    if (vr === 'UI' || (buffer[offset + 4] === 0x55 && buffer[offset + 5] === 0x49)) {
      const valueLength = buffer.readUInt16LE(offset + 6);
      const valueOffset = offset + 8;
      const valueBytes = buffer.slice(valueOffset, valueOffset + valueLength);
      const value = valueBytes.toString('ascii').trim().replace(/\0/g, '');
      console.log('  Length:', valueLength);
      console.log('  Value:', value);
      if (value.length > 10) {
        seriesUIDs.push(value);
      }
      console.log('');
    } else {
      // Implicit VR - 4 byte length
      const valueLength = buffer.readUInt32LE(offset + 4);
      const valueOffset = offset + 8;
      if (valueLength < 1000) {
        const valueBytes = buffer.slice(valueOffset, valueOffset + valueLength);
        const value = valueBytes.toString('ascii').trim().replace(/\0/g, '');
        console.log('  Length (implicit):', valueLength);
        console.log('  Value:', value);
        if (value.length > 10) {
          seriesUIDs.push(value);
        }
        console.log('');
      }
    }
  }
  offset++;
}

console.log(`\nTotal Series UID tags found: ${foundCount}`);
console.log('Extracted Series UIDs:', seriesUIDs);