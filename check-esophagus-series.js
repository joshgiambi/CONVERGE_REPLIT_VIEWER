import { db } from './server/db.js';
import { patients, studies, series, images } from './shared/schema.js';
import { eq } from 'drizzle-orm';

async function checkEsophagusSeries() {
  console.log('=== Checking ESOPHAGUS_31 Series Data ===\n');
  
  // Get series for study 14
  const seriesData = await db.select().from(series).where(eq(series.studyId, 14));
  console.log('Series for study 14:');
  seriesData.forEach(s => {
    console.log(`\nSeries ${s.id}:`);
    console.log(`  - UID: ${s.seriesInstanceUID}`);
    console.log(`  - Modality: ${s.modality}`);
    console.log(`  - Description: ${s.seriesDescription}`);
    console.log(`  - Image Count: ${s.imageCount}`);
    console.log(`  - Series Number: ${s.seriesNumber}`);
  });
  
  // Check a few images from each series
  for (const s of seriesData) {
    const sampleImages = await db.select().from(images)
      .where(eq(images.seriesId, s.id))
      .limit(3);
    
    console.log(`\nSample images from series ${s.id} (${s.modality}):`);
    sampleImages.forEach(img => {
      console.log(`  - Instance ${img.instanceNumber}: ${img.fileName}`);
    });
  }
  
  process.exit(0);
}

checkEsophagusSeries().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});