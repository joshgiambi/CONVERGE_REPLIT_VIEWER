import { initdb } from './dist/db.js';
import { registrations } from './dist/shared/schema.js';
import dicomParser from 'dicom-parser';
import fs from 'fs';

// Initialize database
const db = await initdb();

async function parseRegistrationFile() {
  try {
    console.log('🔍 Looking for registration series...');
    
    // Find the ESOPHAGUS_31 registration series
    const result = await db.query(`
      SELECT s.*, st.id as study_id, st.study_instance_uid
      FROM series s
      JOIN studies st ON s.study_id = st.id
      WHERE s.modality = 'REG'
      AND st.patient_id = (
        SELECT id FROM patients WHERE patient_id = 'ESOPHAGUS_31' OR patient_name = 'ESOPHAGUS_31'
      )
    `);
    
    if (result.rows.length === 0) {
      console.log('❌ No registration series found for ESOPHAGUS_31');
      return;
    }
    
    const regSeries = result.rows[0];
    console.log('✅ Found registration series:', {
      id: regSeries.id,
      description: regSeries.series_description,
      studyId: regSeries.study_id
    });
    
    // Get the registration image file
    const imageResult = await db.query(`
      SELECT * FROM images WHERE series_id = $1 LIMIT 1
    `, [regSeries.id]);
    
    if (imageResult.rows.length === 0) {
      console.log('❌ No registration image found');
      return;
    }
    
    const regImage = imageResult.rows[0];
    const filePath = regImage.file_path;
    console.log('📄 Registration file path:', filePath);
    
    if (!fs.existsSync(filePath)) {
      console.log('❌ Registration file not found at:', filePath);
      return;
    }
    
    // Parse the DICOM registration file
    const dicomData = fs.readFileSync(filePath);
    const dataSet = dicomParser.parseDicom(dicomData);
    
    // Extract registration information
    // Registration Sequence (0070,0308)
    const registrationSeq = dataSet.elements['x00700308'];
    if (!registrationSeq) {
      console.log('❌ No registration sequence found in DICOM file');
      return;
    }
    
    // Get Frame of Reference UIDs
    const sourceFrameOfRef = dataSet.string('x00200052'); // Frame of Reference UID
    console.log('Source Frame of Reference:', sourceFrameOfRef);
    
    // Parse the registration sequence to get transformation matrix
    // This is a simplified extraction - real DICOM REG files have complex structures
    // For now, we'll create a basic identity matrix for testing
    const transformationMatrix = [
      [1, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 1, 0],
      [0, 0, 0, 1]
    ];
    
    console.log('🔧 Creating registration entry...');
    
    // Check if registration already exists
    const existing = await db.query(`
      SELECT * FROM registrations WHERE study_id = $1
    `, [regSeries.study_id]);
    
    if (existing.rows.length > 0) {
      console.log('⚠️ Registration already exists for this study');
      return;
    }
    
    // Insert into registrations table
    const insertResult = await db.insert(registrations).values({
      studyId: regSeries.study_id,
      seriesInstanceUid: regSeries.series_instance_uid,
      sopInstanceUid: regImage.sop_instance_uid,
      sourceFrameOfReferenceUid: sourceFrameOfRef || 'unknown',
      targetFrameOfReferenceUid: sourceFrameOfRef || 'unknown', // Would be different in real registration
      transformationMatrix: transformationMatrix,
      matrixType: 'RIGID',
      metadata: {
        seriesDescription: regSeries.series_description,
        createdFrom: 'populate-registration.js'
      }
    }).returning();
    
    console.log('✅ Registration created:', insertResult[0]);
    
    // Verify it's in the database
    const verifyResult = await db.query(`
      SELECT * FROM registrations WHERE study_id = $1
    `, [regSeries.study_id]);
    
    console.log('✅ Verified registration in database:', verifyResult.rows.length, 'entries');
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    process.exit();
  }
}

parseRegistrationFile();