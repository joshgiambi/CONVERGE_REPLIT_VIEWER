import { drizzle } from 'drizzle-orm/neon-serverless';
import { Pool } from '@neondatabase/serverless';
import { images, series } from './shared/schema.ts';
import { eq, and } from 'drizzle-orm';

async function checkCTPositions() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);
  
  try {
    // Get CT images with slice positions
    const ctImages = await db.select({
      id: images.id,
      sliceLocation: images.sliceLocation,
      imagePosition: images.imagePosition,
      instanceNumber: images.instanceNumber,
      seriesId: images.seriesId
    })
    .from(images)
    .innerJoin(series, eq(images.seriesId, series.id))
    .where(and(eq(series.studyId, 7), eq(series.modality, 'CT')))
    .orderBy(images.instanceNumber)
    .limit(200);
    
    console.log(`Found ${ctImages.length} CT images\n`);
    
    // Show first 10, middle 10, and last 10
    const showRanges = [
      { start: 0, end: 10, label: "First 10 images:" },
      { start: 90, end: 100, label: "Images 90-100 (around where BBs might be):" },
      { start: ctImages.length - 10, end: ctImages.length, label: "Last 10 images:" }
    ];
    
    for (const range of showRanges) {
      console.log(`\n${range.label}`);
      for (let i = range.start; i < Math.min(range.end, ctImages.length); i++) {
        const img = ctImages[i];
        const zPos = img.imagePosition ? img.imagePosition.split('\\')[2] : 'N/A';
        console.log(`  Instance ${img.instanceNumber}: Z=${zPos}mm, SliceLocation=${img.sliceLocation || 'null'}`);
      }
    }
    
    // Calculate if Z=0 would be around image 95
    if (ctImages.length > 95) {
      const img95 = ctImages[94]; // 0-indexed
      const zPos95 = img95.imagePosition ? parseFloat(img95.imagePosition.split('\\')[2]) : null;
      console.log(`\nImage 95 is at Z=${zPos95}mm`);
      console.log(`If BBs are at image 95 and should be Z=0, then we need offset = ${-zPos95}mm`);
      
      // Show what the transformed range would be
      const firstZ = ctImages[0].imagePosition ? parseFloat(ctImages[0].imagePosition.split('\\')[2]) : null;
      const lastZ = ctImages[ctImages.length - 1].imagePosition ? parseFloat(ctImages[ctImages.length - 1].imagePosition.split('\\')[2]) : null;
      
      console.log(`\nCurrent CT Z range: ${firstZ}mm to ${lastZ}mm`);
      console.log(`After offset: ${(firstZ - zPos95).toFixed(1)}mm to ${(lastZ - zPos95).toFixed(1)}mm`);
    }
    
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await pool.end();
  }
}

checkCTPositions();