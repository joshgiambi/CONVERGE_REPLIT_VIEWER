import fs from 'fs';
import path from 'path';
import { neon } from '@neondatabase/serverless';
import dicomParser from 'dicom-parser';

const sql = neon(process.env.DATABASE_URL);

const DATASET_PATH = './attached_assets/fusion-dataset-2mri/CVYcHcklTsv2rCX042yyFyZJX';

async function fixMissingSlices() {
  console.log('Fixing missing CT slices from fusion-dataset-2mri...');
  
  // Get all CT files from filesystem
  const ctFiles = fs.readdirSync(DATASET_PATH)
    .filter(f => f.startsWith('CT.') && f.endsWith('.dcm'))
    .sort();
  
  console.log(`Found ${ctFiles.length} CT files in filesystem`);
  
  // Get existing images from database
  const existingImages = await sql`
    SELECT i.sop_instance_uid, i.slice_location, i.instance_number, i.file_path
    FROM images i
    JOIN series s ON i.series_id = s.id
    WHERE s.id = 13
  `;
  
  console.log(`Found ${existingImages.length} CT images in database`);
  
  // Create a set of existing file paths
  const existingPaths = new Set(existingImages.map(img => img.file_path));
  
  // Parse each file to check if it's missing
  let missingCount = 0;
  const missingImages = [];
  
  for (const filename of ctFiles) {
    const filepath = path.join(DATASET_PATH, filename);
    const relativePath = filepath.replace('/home/runner/workspace/', '');
    
    if (!existingPaths.has(relativePath)) {
      const buffer = fs.readFileSync(filepath);
      const byteArray = new Uint8Array(buffer);
      
      try {
        const dataSet = dicomParser.parseDicom(byteArray);
        const sopInstanceUID = dataSet.string('x00080018');
        const sliceLocation = dataSet.floatString('x00201041');
        const instanceNumber = dataSet.intString('x00200013');
        
        missingCount++;
        missingImages.push({
          filename,
          filepath,
          relativePath,
          sopInstanceUID,
          sliceLocation: parseFloat(sliceLocation),
          instanceNumber: parseInt(instanceNumber)
        });
        
        if (missingCount <= 10) {
          console.log(`Missing: Instance ${instanceNumber}, Slice ${sliceLocation}mm`);
        }
      } catch (error) {
        console.error(`Error parsing ${filename}:`, error.message);
      }
    }
  }
  
  console.log(`\nTotal missing images: ${missingCount}`);
  
  if (missingCount > 0) {
    // Sort missing images by slice location
    missingImages.sort((a, b) => a.sliceLocation - b.sliceLocation);
    
    console.log('\nSlice location ranges of missing images:');
    console.log(`First missing: ${missingImages[0].sliceLocation}mm`);
    console.log(`Last missing: ${missingImages[missingImages.length - 1].sliceLocation}mm`);
    
    // Now insert the missing images with proper metadata
    console.log('\nInserting missing images with DICOM metadata...');
    
    for (const img of missingImages) {
      const buffer = fs.readFileSync(img.filepath);
      const byteArray = new Uint8Array(buffer);
      const dataSet = dicomParser.parseDicom(byteArray);
      
      const imagePosition = dataSet.string('x00200032');
      const imageOrientation = dataSet.string('x00200037'); 
      const pixelSpacing = dataSet.string('x00280030');
      const windowCenter = dataSet.string('x00281050');
      const windowWidth = dataSet.string('x00281051');
      
      // Convert DICOM delimited strings to arrays for JSONB storage
      const imagePositionArray = imagePosition ? imagePosition.split('\\').map(v => parseFloat(v)) : null;
      const imageOrientationArray = imageOrientation ? imageOrientation.split('\\').map(v => parseFloat(v)) : null;
      const pixelSpacingArray = pixelSpacing ? pixelSpacing.split('\\').map(v => parseFloat(v)) : null;
      
      await sql`
        INSERT INTO images (
          series_id,
          sop_instance_uid,
          instance_number,
          slice_location,
          image_position,
          image_orientation,
          pixel_spacing,
          window_center,
          window_width,
          file_path,
          file_name,
          file_size,
          created_at
        ) VALUES (
          13,
          ${img.sopInstanceUID},
          ${img.instanceNumber},
          ${img.sliceLocation.toString()},
          ${JSON.stringify(imagePositionArray)},
          ${JSON.stringify(imageOrientationArray)},
          ${JSON.stringify(pixelSpacingArray)},
          ${windowCenter || '40'},
          ${windowWidth || '400'},
          ${img.relativePath},
          ${img.filename},
          ${fs.statSync(img.filepath).size},
          NOW()
        )
      `;
      
      if (missingImages.indexOf(img) % 10 === 0) {
        console.log(`Inserted ${missingImages.indexOf(img) + 1}/${missingImages.length}`);
      }
    }
    
    console.log('\n✅ All missing images inserted!');
    
    // Update series image count
    await sql`
      UPDATE series 
      SET image_count = 200
      WHERE id = 13
    `;
    
    console.log('✅ Updated series image count to 200');
    
    // Verify no duplicates
    const finalCount = await sql`
      SELECT COUNT(*) as total, COUNT(DISTINCT slice_location) as unique_slices
      FROM images
      WHERE series_id = 13
    `;
    
    console.log(`\nFinal verification: ${finalCount[0].total} total images, ${finalCount[0].unique_slices} unique slices`);
  }
}

fixMissingSlices().catch(console.error);