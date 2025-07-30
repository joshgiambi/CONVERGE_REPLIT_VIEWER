import { db } from './server/db.js';
import { studies, series } from './shared/schema.js';

async function checkPETData() {
  console.log('=== Checking for PET Data ===\n');
  
  // Get all studies
  const allStudies = await db.select().from(studies);
  console.log('All studies in database:');
  allStudies.forEach(study => {
    console.log(`  Study ${study.id}: ${study.studyDescription || 'No description'} (Patient ID: ${study.patientId})`);
  });
  
  // Get all series with modalities
  const allSeries = await db.select().from(series);
  console.log('\nAll series modalities:');
  const modalityCount = {};
  allSeries.forEach(s => {
    modalityCount[s.modality] = (modalityCount[s.modality] || 0) + 1;
  });
  
  Object.entries(modalityCount).forEach(([modality, count]) => {
    console.log(`  ${modality}: ${count} series`);
  });
  
  // Look for PET series specifically
  const petSeries = allSeries.filter(s => 
    s.modality === 'PT' || 
    s.modality === 'PET' || 
    s.seriesDescription?.toLowerCase().includes('pet')
  );
  
  if (petSeries.length > 0) {
    console.log('\nFound PET series:');
    petSeries.forEach(s => {
      console.log(`  Series ${s.id}: ${s.modality} - ${s.seriesDescription} (Study ${s.studyId})`);
    });
  } else {
    console.log('\nNo PET series found in database');
  }
  
  process.exit(0);
}

checkPETData().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});