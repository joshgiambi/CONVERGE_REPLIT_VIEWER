import { storage } from './storage.js';
import { uploadLimbicScan } from './limbic-uploader.js';

console.log('Testing clean LIMBIC upload with authentic 787-file parser...');

async function testCleanLimbic() {
  try {
    // Clear any existing LIMBIC data
    try {
      const existingPatient = await storage.getPatientByID('LIMBIC_57');
      if (existingPatient) {
        console.log('Removing existing LIMBIC data...');
        // Clear through database to ensure complete removal
        await storage.clearAll();
      }
    } catch (error) {
      console.log('No existing LIMBIC data found');
    }

    // Run only the authentic 787-file uploader
    console.log('Running authentic LIMBIC uploader...');
    await uploadLimbicScan();
    
    // Verify results
    const patients = await storage.getAllPatients();
    const limbicPatients = patients.filter(p => p.patientID === 'LIMBIC_57');
    
    if (limbicPatients.length === 0) {
      console.log('ERROR: No LIMBIC patient created');
      return;
    }
    
    const limbicPatient = limbicPatients[0];
    const studies = await storage.getStudiesByPatient(limbicPatient.id);
    
    console.log(`\n=== AUTHENTIC LIMBIC RESULTS ===`);
    console.log(`Patient: ${limbicPatient.patientName} (${limbicPatient.patientID})`);
    console.log(`Studies: ${studies.length}`);
    
    for (const study of studies) {
      console.log(`\nStudy: ${study.studyDescription}`);
      console.log(`  Total Images: ${study.numberOfImages}`);
      console.log(`  Series Count: ${study.numberOfSeries}`);
      
      const series = await storage.getSeriesByStudyId(study.id);
      let totalFiles = 0;
      
      for (const s of series) {
        console.log(`  ${s.modality}: ${s.seriesDescription} - ${s.imageCount} files`);
        totalFiles += s.imageCount || 0;
      }
      
      console.log(`  Verified Total: ${totalFiles} files`);
      
      if (totalFiles === 787) {
        console.log('✓ AUTHENTIC FILE COUNT VERIFIED: 787 files');
      } else {
        console.log(`✗ FILE COUNT MISMATCH: Expected 787, got ${totalFiles}`);
      }
    }
    
  } catch (error) {
    console.error('Clean LIMBIC test failed:', error);
  }
}

testCleanLimbic();