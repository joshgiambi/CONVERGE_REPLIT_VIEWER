const fs = require('fs');
const dicomParser = require('dicom-parser');

// Frame of Reference UIDs
const targetFoRs = [
  '1.2.246.352.221.498240581752208121912291', // 2493 CT + 2494 PT (shared!)
  '1.2.246.352.221.488247120000276366653062', // 2496 CBCT
  '1.2.246.352.221.524380842283401709296266'  // 2497 Planning CT
];

const regFilesText = fs.readFileSync('/tmp/reg_files.txt', 'utf8');
const regFiles = regFilesText.trim().split('\n').map(line => line.trim()).filter(line => line.length > 0);

console.log(`\n=== Checking ${regFiles.length} REG files for Frame of Reference UIDs ===\n`);

let foundAny = false;

regFiles.forEach((regFile, idx) => {
  try {
    if (!fs.existsSync(regFile)) return;
    
    const dicomData = fs.readFileSync(regFile);
    const dataSet = dicomParser.parseDicom(dicomData);
    
    // Get the REG file's own Frame of Reference UID
    const regForUID = dataSet.string('x00200052');
    
    // Check Referenced Frame of Reference Sequence (0x3006,0010)
    const refForSeq = dataSet.elements['x30060010'];
    
    console.log(`REG #${idx+1}:`);
    console.log(`  REG's FoR UID: ${regForUID ? regForUID.substring(0, 40) + '...' : 'None'}`);
    
    // Check if REG's FoR matches any of our targets
    if (regForUID && targetFoRs.includes(regForUID)) {
      foundAny = true;
      const which = regForUID === targetFoRs[0] ? '2493/2494 (PET/CT)' :
                    regForUID === targetFoRs[1] ? '2496 (CBCT)' :
                    '2497 (Planning)';
      console.log(`  ⭐ MATCHES ${which}!`);
    }
    
    // Also check if there's a Referenced Frame of Reference Sequence
    if (refForSeq) {
      console.log(`  Has Referenced FoR Sequence`);
    }
    
    console.log('');
    
  } catch (e) {
    // Silent
  }
});

if (!foundAny) {
  console.log('❌ No REG files found with matching Frame of Reference UIDs');
}

console.log('');
