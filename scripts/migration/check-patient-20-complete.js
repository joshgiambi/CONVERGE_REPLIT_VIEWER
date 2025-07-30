import { db } from './server/db.js';
import { patients, studies, series } from './shared/schema.js';
import { eq } from 'drizzle-orm';

async function checkPatient20Complete() {
  console.log('=== Complete check for Patient 20 (ESOPHAGUS_31) ===\n');
  
  // Get ALL studies for patient 20
  const patient20Studies = await db.select().from(studies).where(eq(studies.patientId, 20));
  console.log(`Found ${patient20Studies.length} studies for patient 20:\n`);
  
  for (const study of patient20Studies) {
    console.log(`Study ${study.id}:`);
    console.log(`  - Study UID: ${study.studyInstanceUID}`);
    console.log(`  - Study Date: ${study.studyDate}`);
    console.log(`  - Description: ${study.studyDescription || 'No description'}`);
    console.log(`  - Patient ID in study: ${study.patientID}`);
    console.log(`  - Patient Name in study: ${study.patientName}`);
    
    // Get series for this study
    const studySeries = await db.select().from(series).where(eq(series.studyId, study.id));
    console.log(`  - Series in this study:`);
    
    for (const s of studySeries) {
      console.log(`    * Series ${s.id}: ${s.modality} - ${s.seriesDescription} (${s.imageCount} images)`);
    }
    console.log('');
  }
  
  // Also check if there are any other patients with similar names
  const similarPatients = await db.select().from(patients);
  console.log('\nAll patients in database:');
  similarPatients.forEach(p => {
    console.log(`  - Patient ${p.id}: ${p.patientID} / ${p.patientName}`);
  });
  
  process.exit(0);
}

checkPatient20Complete().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});