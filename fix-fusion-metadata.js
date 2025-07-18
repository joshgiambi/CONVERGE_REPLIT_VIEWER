import { db } from './server/db.js';
import { images, series } from './shared/schema.js';
import { eq } from 'drizzle-orm';
import * as dicomParser from 'dicom-parser';
import fs from 'fs';

async function fixMetadata() {
  console.log('Fixing missing metadata for fusion dataset...');
  
  // Get all images from study 7
  const imagesWithNullMetadata = await db.select()
    .from(images)
    .innerJoin(series, eq(images.series_id, series.id))
    .where(eq(series.study_id, 7));
  
  console.log(`Found ${imagesWithNullMetadata.length} images with null metadata`);
  
  let fixed = 0;
  
  for (const row of imagesWithNullMetadata) {
    const image = row.images;
    try {
      // Read the DICOM file
      const filePath = image.file_path;
      const fileBuffer = fs.readFileSync(filePath);
      const byteArray = new Uint8Array(fileBuffer);
      const dataSet = dicomParser.parseDicom(byteArray);
      
      // Extract metadata
      const imagePosition = dataSet.string('x00200032'); // Image Position Patient
      const pixelSpacing = dataSet.string('x00280030'); // Pixel Spacing
      
      if (imagePosition || pixelSpacing) {
        // Update the database
        await db.update(images)
          .set({
            image_position: imagePosition || null,
            pixel_spacing: pixelSpacing || null
          })
          .where(eq(images.id, image.id));
        
        fixed++;
        console.log(`Fixed metadata for image ${image.id}: position=${imagePosition}, spacing=${pixelSpacing}`);
      }
    } catch (error) {
      console.error(`Error processing image ${image.id}:`, error.message);
    }
  }
  
  console.log(`Fixed metadata for ${fixed} images`);
  process.exit(0);
}

fixMetadata().catch(console.error);