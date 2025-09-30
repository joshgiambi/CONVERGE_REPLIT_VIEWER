const dicomParser = require('dicom-parser');
const fs = require('fs');

const regFile = 'storage/patients/OZa7UswspYAakrgYemxMdqy1E/1.2.246.352.221.562728508619352284615748755713089003937/1.2.246.352.221.51399723574694919545666599258325590455/1.2.246.352.221.47107871783223454141765951539006254246.dcm';

console.log('\n=== Parsing REG file 2498 ===\n');

const buffer = fs.readFileSync(regFile);
const dataSet = dicomParser.parseDicom(new Uint8Array(buffer));

console.log('Modality:', dataSet.string('x00080060'));
console.log('Series Description:', dataSet.string('x0008103e'));

// Registration Sequence
const regSeqElement = dataSet.elements.x00700308;
if (regSeqElement) {
  console.log('\nRegistration Sequence found!');
  
  // Parse the sequence
  const regDataSet = dicomParser.parseDicom(new Uint8Array(buffer), {
    untilTag: 'xffffffff'
  });
  
  // Try to get Frame of Reference UID Sequence (0008,1140)
  const forSeq = dataSet.elements.x00081140;
  if (forSeq) {
    console.log('Referenced Frame of Reference Sequence found');
  }
  
  // Try Registration Sequence (0070,0308)
  console.log('\nLooking for registration details...');
  
  // Frame of Reference UID (0020,0052)
  console.log('This REG Frame of Reference UID:', dataSet.string('x00200052'));
  
} else {
  console.log('\nNo Registration Sequence (0070,0308) found');
  
  // Check for Deformable Registration Sequence (0064,0002)
  const deformSeq = dataSet.elements.x00640002;
  if (deformSeq) {
    console.log('Deformable Registration Sequence found');
  }
  
  // Check for spatial registration (old style)
  const spatialSeq = dataSet.elements.x00700308;
  console.log('Spatial Registration Sequence:', spatialSeq ? 'Found' : 'Not found');
}

// List all sequence elements
console.log('\n=== All Sequence Elements ===');
for (const tag in dataSet.elements) {
  const element = dataSet.elements[tag];
  if (element.vr === 'SQ') {
    console.log(`Tag ${tag}: VR=SQ, Length=${element.length}`);
  }
}
