import { db } from './server/db.js';
import { patients, studies, series, images } from './shared/schema.js';
import { eq } from 'drizzle-orm';

async function checkPatientData() {
  console.log('=== Checking Patient Data ===\n');
  
  // Find the patient with ID 20
  const patient20 = await db.select().from(patients).where(eq(patients.id, 20));
  console.log('Patient with ID 20:', patient20);
  
  // Find studies for patient ID 20
  const studiesForPatient20 = await db.select().from(studies).where(eq(studies.patientId, 20));
  console.log('\nStudies for patient ID 20:', studiesForPatient20);
  
  // Find patient by patientID field
  const orphanedPatient = await db.select().from(patients).where(eq(patients.patientID, 'dUHouewD6bk1ImBcfClL59qbT'));
  console.log('\nPatient by patientID "dUHouewD6bk1ImBcfClL59qbT":', orphanedPatient);
  
  // Check study 14
  const study14 = await db.select().from(studies).where(eq(studies.id, 14));
  console.log('\nStudy 14:', study14);
  
  // Get series for study 14
  if (study14.length > 0) {
    const seriesForStudy14 = await db.select().from(series).where(eq(series.studyId, 14));
    console.log('\nSeries for study 14:', seriesForStudy14);
    
    // Count images for each series
    for (const s of seriesForStudy14) {
      const imageCount = await db.select().from(images).where(eq(images.seriesId, s.id));
      console.log(`\nImages for series ${s.id} (${s.seriesInstanceUID}): ${imageCount.length} images`);
    }
  }
  
  process.exit(0);
}

checkPatientData().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});