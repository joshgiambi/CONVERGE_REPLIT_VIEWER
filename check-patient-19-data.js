import { db } from './server/db.js';
import { patients, studies, series } from './shared/schema.js';
import { eq } from 'drizzle-orm';

async function checkPatient19() {
  console.log('=== Checking Patient 19 (ESOPHAGUS_31) ===\n');
  
  // Get studies for patient 19
  const patient19Studies = await db.select().from(studies).where(eq(studies.patientId, 19));
  console.log(`Found ${patient19Studies.length} studies for patient 19:\n`);
  
  for (const study of patient19Studies) {
    console.log(`Study ${study.id}:`);
    console.log(`  - Study Date: ${study.studyDate}`);
    console.log(`  - Description: ${study.studyDescription || 'No description'}`);
    
    // Get series for this study
    const studySeries = await db.select().from(series).where(eq(series.studyId, study.id));
    console.log(`  - Series in this study:`);
    
    for (const s of studySeries) {
      console.log(`    * Series ${s.id}: ${s.modality} - ${s.seriesDescription} (${s.imageCount} images)`);
    }
    console.log('');
  }
  
  process.exit(0);
}

checkPatient19().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});