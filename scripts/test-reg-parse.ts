import 'dotenv/config';
import * as fs from 'fs';
import dicomParser from 'dicom-parser';

const testFile = process.argv[2];

if (!testFile) {
  console.log('Usage: tsx scripts/test-reg-parse.ts <path-to-reg-file>');
  process.exit(1);
}

try {
  const dicomData = fs.readFileSync(testFile);
  const dataSet = dicomParser.parseDicom(dicomData);

  console.log('\n=== DICOM REG File Analysis ===\n');

  // Basic info
  console.log('Frame of Reference UID:', dataSet.string('x00200052') || 'NULL');
  console.log('Series Instance UID:', dataSet.string('x0020000e') || 'NULL');
  console.log('Modality:', dataSet.string('x00080060') || 'NULL');
  console.log('');

  // Check for Referenced Series Sequence
  const refSeriesSeq = dataSet.elements['x00081115'];
  if (refSeriesSeq) {
    console.log('Referenced Series Sequence (x00081115) found');
    console.log('  Offset:', refSeriesSeq.dataOffset);
    console.log('  Length:', refSeriesSeq.length);
    console.log('  VR:', refSeriesSeq.vr);
  } else {
    console.log('No Referenced Series Sequence (x00081115)');
  }

  // Check for Registration Sequence
  const regSeq = dataSet.elements['x00700308'];
  if (regSeq) {
    console.log('\nRegistration Sequence (x00700308) found');
    console.log('  Offset:', regSeq.dataOffset);
    console.log('  Length:', regSeq.length);
    console.log('  VR:', regSeq.vr);
  } else {
    console.log('\nNo Registration Sequence (x00700308)');
  }

  // Check for Study Referenced Sequence
  const studySeq = dataSet.elements['x00081110'];
  if (studySeq) {
    console.log('\nReferenced Study Sequence (x00081110) found');
  }

  // List some important tags
  console.log('\n=== Key Tags ===');
  const importantTags = [
    'x00080016', // SOP Class UID
    'x00080018', // SOP Instance UID
    'x00080020', // Study Date
    'x00080030', // Study Time
    'x0008103e', // Series Description
    'x00100010', // Patient Name
    'x00100020', // Patient ID
    'x00200010', // Study ID
    'x00200011', // Series Number
    'x0020000d', // Study Instance UID
  ];

  importantTags.forEach(tag => {
    const value = dataSet.string(tag);
    if (value) {
      console.log(`${tag}: ${value.substring(0, 60)}`);
    }
  });

} catch (err: any) {
  console.error('Error:', err.message);
  process.exit(1);
}