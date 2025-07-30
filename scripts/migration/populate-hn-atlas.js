import fs from 'fs';
import path from 'path';
import { Pool } from '@neondatabase/serverless';

// Database connection
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function populateHNAtlas() {
  console.log('Starting HN-ATLAS population with all 153 CT slices...');
  
  try {
    // Create HN-ATLAS patient
    const patientResult = await pool.query(`
      INSERT INTO patients (patient_id, patient_name, patient_sex, patient_age, date_of_birth, created_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (patient_id) DO UPDATE SET patient_name = EXCLUDED.patient_name
      RETURNING id
    `, ['HN-ATLAS-84', 'HN-ATLAS^84', 'M', '62', '19620315']);
    
    const patientId = patientResult.rows[0].id;
    console.log(`Created/updated patient with ID: ${patientId}`);

    // Get all CT files from HN-ATLAS dataset
    const contrastPath = path.join('attached_assets/HN-ATLAS-84/HN-ATLAS-84/DICOM_CONTRAST');
    
    if (!fs.existsSync(contrastPath)) {
      console.error('HN-ATLAS dataset not found at:', contrastPath);
      return;
    }

    const contrastFiles = fs.readdirSync(contrastPath)
      .filter(f => f.endsWith('.dcm'))
      .sort();

    console.log(`Found ${contrastFiles.length} CT files`);

    // Create CT study
    const studyUID = `2.16.840.1.114362.1.11932039.${Date.now()}`;
    const studyResult = await pool.query(`
      INSERT INTO studies (
        study_instance_uid, patient_id, patient_name, patient_i_d, 
        study_date, study_description, accession_number, modality,
        number_of_series, number_of_images, is_demo, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
      ON CONFLICT (study_instance_uid) DO UPDATE SET number_of_images = EXCLUDED.number_of_images
      RETURNING id
    `, [
      studyUID, patientId, 'HN-ATLAS^84', 'HN-ATLAS-84',
      '20200615', `Head & Neck CT with Contrast - ${contrastFiles.length} slices`, 
      'HN84_CT_001', 'CT', 1, contrastFiles.length, true
    ]);

    const studyId = studyResult.rows[0].id;
    console.log(`Created/updated study with ID: ${studyId}`);

    // Create CT series
    const seriesUID = `${studyUID}.series.1`;
    const seriesResult = await pool.query(`
      INSERT INTO series (
        study_id, series_instance_uid, series_description, modality,
        series_number, image_count, slice_thickness, metadata, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      ON CONFLICT (series_instance_uid) DO UPDATE SET image_count = EXCLUDED.image_count
      RETURNING id
    `, [
      studyId, seriesUID, `CT Head Neck with Contrast - ${contrastFiles.length} slices`,
      'CT', 1, contrastFiles.length, '3.0',
      JSON.stringify({
        source: 'HN-ATLAS-84',
        anatomy: 'Head & Neck',
        contrast: 'IV Contrast Enhanced',
        totalSlices: contrastFiles.length
      })
    ]);

    const seriesId = seriesResult.rows[0].id;
    console.log(`Created/updated series with ID: ${seriesId}`);

    // Create demo directory
    const demoDir = 'uploads/hn-atlas-demo';
    if (!fs.existsSync(demoDir)) {
      fs.mkdirSync(demoDir, { recursive: true });
    }

    // Process all CT images
    console.log(`Processing ${contrastFiles.length} CT images...`);
    let processedCount = 0;
    
    for (let i = 0; i < contrastFiles.length; i++) {
      const fileName = contrastFiles[i];
      const sourcePath = path.join(contrastPath, fileName);
      const demoPath = path.join(demoDir, fileName);
      
      // Copy file to demo directory
      if (!fs.existsSync(demoPath)) {
        fs.copyFileSync(sourcePath, demoPath);
      }
      
      const fileStats = fs.statSync(demoPath);
      
      // Extract instance number from filename
      const instanceMatch = fileName.match(/\.(\d+)\.dcm$/);
      const instanceNumber = instanceMatch ? parseInt(instanceMatch[1]) : i + 1;
      const sopUID = `${seriesUID}.${instanceNumber}`;
      
      // Insert image record
      await pool.query(`
        INSERT INTO images (
          series_id, sop_instance_uid, instance_number, file_path, file_name,
          file_size, pixel_spacing, slice_location, window_center, window_width,
          metadata, created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
        ON CONFLICT (sop_instance_uid) DO UPDATE SET file_size = EXCLUDED.file_size
      `, [
        seriesId, sopUID, instanceNumber, demoPath, fileName,
        fileStats.size, '0.488\\0.488', `${instanceNumber * 3.0}`, '50', '350',
        JSON.stringify({
          source: 'HN-ATLAS-84',
          anatomy: 'Head & Neck',
          contrast: true,
          sliceIndex: i + 1,
          totalSlices: contrastFiles.length
        })
      ]);
      
      processedCount++;
      if (processedCount % 20 === 0) {
        console.log(`Processed ${processedCount}/${contrastFiles.length} images...`);
      }
    }

    console.log(`✅ Successfully created HN-ATLAS-84 dataset with ${processedCount} CT slices`);
    
    // Verify the data
    const imageCount = await pool.query('SELECT COUNT(*) FROM images WHERE series_id = $1', [seriesId]);
    console.log(`✅ Verified: ${imageCount.rows[0].count} images in database`);
    
  } catch (error) {
    console.error('Error populating HN-ATLAS:', error);
  } finally {
    await pool.end();
  }
}

populateHNAtlas();