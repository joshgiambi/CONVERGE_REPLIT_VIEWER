import { uploadLimbicScan } from './limbic-uploader.js';
import { storage } from './storage.js';

console.log('Testing direct LIMBIC upload...');

try {
  await uploadLimbicScan();
  
  const patients = await storage.getAllPatients();
  const studies = await storage.getAllStudies();
  console.log(`Created ${patients.length} patients, ${studies.length} studies`);
  
  for (const study of studies) {
    if (study.patientID === 'LIMBIC_57') {
      const series = await storage.getSeriesByStudyId(study.id);
      console.log(`Study: ${study.studyDescription} - ${study.numberOfImages} images`);
      for (const s of series) {
        console.log(`  Series: ${s.seriesDescription} (${s.modality}) - ${s.imageCount} files`);
      }
    }
  }
} catch (error) {
  console.error('Upload failed:', error);
}