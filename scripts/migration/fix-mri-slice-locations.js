import pkg from 'dicom-parser';
const { parseDicom } = pkg;
import { db } from './server/db.js';
import { images, series } from './shared/schema.js';
import { eq, and } from 'drizzle-orm';
import fs from 'fs';

async function fixMRISliceLocations() {
  console.log('Fixing MRI slice locations...');
  
  // Get MRI series for fusion dataset patient
  const mriSeries = await db.select()
    .from(series)
    .where(and(
      eq(series.modality, 'MR'),
      eq(series.studyId, 7) // Fusion dataset study
    ))
    .execute();
  
  console.log(`Found ${mriSeries.length} MRI series`);
  
  for (const s of mriSeries) {
    console.log(`\nProcessing series: ${s.seriesDescription}`);
    
    // Get all images for this series
    const seriesImages = await db.select()
      .from(images)
      .where(eq(images.seriesId, s.id))
      .execute();
    
    console.log(`  Found ${seriesImages.length} images`);
    
    let updateCount = 0;
    
    for (const img of seriesImages) {
      if (img.filePath && fs.existsSync(img.filePath)) {
        try {
          const buffer = fs.readFileSync(img.filePath);
          const byteArray = new Uint8Array(buffer);
          const dataSet = parseDicom(byteArray);
          
          // Get slice location from DICOM header
          const sliceLocation = dataSet.floatString('x00201041');
          
          // Get image position patient
          let imagePosition = null;
          const imagePositionPatient = dataSet.elements.x00200032;
          if (imagePositionPatient) {
            const pos = [];
            for (let i = 0; i < 3; i++) {
              pos.push(dataSet.floatString('x00200032', i));
            }
            imagePosition = pos.join('\\');
          }
          
          // Get image orientation patient
          let imageOrientation = null;
          const imageOrientationPatient = dataSet.elements.x00200037;
          if (imageOrientationPatient) {
            const orient = [];
            for (let i = 0; i < 6; i++) {
              orient.push(dataSet.floatString('x00200037', i));
            }
            imageOrientation = orient.join('\\');
          }
          
          // Get pixel spacing
          let pixelSpacing = null;
          const pixelSpacingElement = dataSet.elements.x00280030;
          if (pixelSpacingElement) {
            const spacing = [];
            for (let i = 0; i < 2; i++) {
              spacing.push(dataSet.floatString('x00280030', i));
            }
            pixelSpacing = spacing.join('\\');
          }
          
          // Update the image record with all metadata
          const updateData = {};
          if (sliceLocation) updateData.sliceLocation = sliceLocation.toString();
          if (imagePosition) updateData.imagePosition = imagePosition;
          if (imageOrientation) updateData.imageOrientation = imageOrientation;
          if (pixelSpacing) updateData.pixelSpacing = pixelSpacing;
          
          if (Object.keys(updateData).length > 0) {
            await db.update(images)
              .set(updateData)
              .where(eq(images.id, img.id))
              .execute();
            
            updateCount++;
            
            if (updateCount % 10 === 0) {
              console.log(`  Updated ${updateCount} images...`);
            }
          }
        } catch (error) {
          console.error(`  Error processing image ${img.id}:`, error.message);
        }
      }
    }
    
    console.log(`  Total updated: ${updateCount} images`);
  }
  
  // Verify the updates
  console.log('\nVerifying updates...');
  const verifyQuery = await db.select()
    .from(series)
    .innerJoin(images, eq(images.seriesId, series.id))
    .where(and(
      eq(series.modality, 'MR'),
      eq(series.studyId, 7)
    ))
    .execute();
  
  // Group by series and check slice locations
  const seriesMap = new Map();
  
  for (const row of verifyQuery) {
    const seriesDesc = row.series.seriesDescription;
    if (!seriesMap.has(seriesDesc)) {
      seriesMap.set(seriesDesc, []);
    }
    seriesMap.get(seriesDesc).push(parseFloat(row.images.sliceLocation));
  }
  
  console.log('\nSlice location ranges:');
  for (const [desc, locations] of seriesMap) {
    const validLocs = locations.filter(l => !isNaN(l));
    if (validLocs.length > 0) {
      const min = Math.min(...validLocs);
      const max = Math.max(...validLocs);
      console.log(`  ${desc}: ${min.toFixed(1)} to ${max.toFixed(1)} (${validLocs.length} slices)`);
    }
  }
  
  console.log('\nDone!');
  process.exit(0);
}

fixMRISliceLocations().catch(console.error);