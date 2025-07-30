import { neon } from '@neondatabase/serverless';
import dicomParser from 'dicom-parser';
import fs from 'fs';

// Database URL from environment
const DATABASE_URL = process.env.DATABASE_URL;

async function updateMetadata() {
  console.log('Updating metadata for fusion dataset images...');
  
  const sql = neon(DATABASE_URL);
  
  // Get all images from study 7
  const query = `
    SELECT i.id, i.file_path, i.image_position, i.pixel_spacing
    FROM images i
    JOIN series s ON i.series_id = s.id
    WHERE s.study_id = 7
    ORDER BY i.id
  `;
  
  const result = await sql(query);
  console.log(`Found ${result.length} images from study 7`);
  
  let updated = 0;
  let errors = 0;
  
  for (const image of result) {
    // Skip if already has metadata
    if (image.image_position && image.pixel_spacing) {
      continue;
    }
    
    try {
      // Read the DICOM file
      const fileBuffer = fs.readFileSync(image.file_path);
      const byteArray = new Uint8Array(fileBuffer);
      const dataSet = dicomParser.parseDicom(byteArray);
      
      // Extract metadata
      const imagePositionStr = dataSet.string('x00200032'); // Image Position Patient
      const pixelSpacingStr = dataSet.string('x00280030'); // Pixel Spacing
      
      if (imagePositionStr || pixelSpacingStr) {
        // Convert to arrays
        const imagePosition = imagePositionStr ? imagePositionStr.split('\\').map(Number) : null;
        const pixelSpacing = pixelSpacingStr ? pixelSpacingStr.split('\\').map(Number) : null;
        
        // Update the database
        const updateQuery = `
          UPDATE images 
          SET 
            image_position = $2::jsonb,
            pixel_spacing = $3::jsonb
          WHERE id = $1
        `;
        
        await sql(updateQuery, [
          image.id,
          imagePosition ? JSON.stringify(imagePosition) : null,
          pixelSpacing ? JSON.stringify(pixelSpacing) : null
        ]);
        
        updated++;
        console.log(`Updated image ${image.id}: position=${imagePositionStr}, spacing=${pixelSpacingStr}`);
      }
    } catch (error) {
      errors++;
      console.error(`Error processing image ${image.id}:`, error.message);
    }
  }
  
  console.log(`\nSummary:`);
  console.log(`- Total images: ${result.length}`);
  console.log(`- Updated: ${updated}`);
  console.log(`- Errors: ${errors}`);
  console.log(`- Skipped (already had metadata): ${result.length - updated - errors}`);
  
  process.exit(0);
}

updateMetadata().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});