import { storage } from './storage.js';
import { uploadLimbicScan } from './limbic-uploader.js';

console.log('Completing LIMBIC upload with all 5 authentic series...');

async function completeLimbicUpload() {
  try {
    // Run the authentic uploader to complete all series
    await uploadLimbicScan();
    
    // Verify final results
    const limbicPatient = await storage.getPatientByID('LIMBIC_57');
    if (!limbicPatient) {
      console.log('ERROR: LIMBIC patient not found');
      return;
    }
    
    const studies = await storage.getStudiesByPatient(limbicPatient.id);
    const authenticStudy = studies.find(s => s.numberOfImages === 787);
    
    if (!authenticStudy) {
      console.log('ERROR: Authentic 787-file study not found');
      return;
    }
    
    console.log(`\n=== LIMBIC UPLOAD COMPLETE ===`);
    console.log(`Study: ${authenticStudy.studyDescription}`);
    console.log(`Total Images: ${authenticStudy.numberOfImages}`);
    console.log(`Series Count: ${authenticStudy.numberOfSeries}`);
    
    const series = await storage.getSeriesByStudyId(authenticStudy.id);
    console.log(`\nSeries Breakdown:`);
    
    let totalVerified = 0;
    const modalityCount = {};
    
    for (const s of series) {
      console.log(`  ${s.modality}: ${s.seriesDescription} - ${s.imageCount} files`);
      totalVerified += s.imageCount || 0;
      modalityCount[s.modality] = (modalityCount[s.modality] || 0) + (s.imageCount || 0);
    }
    
    console.log(`\nModality Summary:`);
    Object.entries(modalityCount).forEach(([mod, count]) => {
      console.log(`  ${mod}: ${count} files`);
    });
    
    console.log(`\nVerification:`);
    console.log(`  Database Total: ${totalVerified} files`);
    console.log(`  Expected Total: 787 files`);
    console.log(`  Series Found: ${series.length}`);
    console.log(`  Expected Series: 5`);
    
    if (totalVerified === 787 && series.length === 5) {
      console.log('✓ AUTHENTIC LIMBIC UPLOAD SUCCESSFUL');
    } else {
      console.log('✗ Upload incomplete - retrying...');
      
      // Clear and retry if needed
      if (totalVerified < 787) {
        console.log('Retrying upload to complete missing series...');
        await uploadLimbicScan();
      }
    }
    
  } catch (error) {
    console.error('LIMBIC upload completion failed:', error);
  }
}

completeLimbicUpload();