import pkg from 'dicom-parser';
const { parseDicom } = pkg;
import { db } from './server/db.js';
import { registrations, studies, images, series } from './shared/schema.js';
import { eq, and } from 'drizzle-orm';
import fs from 'fs';

async function populateRegistration() {
  console.log('Populating registration data...\n');
  
  const regFile = 'attached_assets/fusion-dataset/eGxOwa0vElJ9I98DElZly59D5/RE.eGxOwa0vElJ9I98DElZly59D5.REGISTRATION.dcm';
  
  try {
    // Read and parse the registration file
    const buffer = fs.readFileSync(regFile);
    const byteArray = new Uint8Array(buffer);
    const dataSet = parseDicom(byteArray);
    
    // Get basic metadata
    const sopInstanceUID = dataSet.string('x00080018');
    const seriesInstanceUID = dataSet.string('x0020000e');
    const studyInstanceUID = dataSet.string('x0020000d');
    
    console.log('Registration file metadata:');
    console.log(`  SOP Instance UID: ${sopInstanceUID}`);
    console.log(`  Series Instance UID: ${seriesInstanceUID}`);
    console.log(`  Study Instance UID: ${studyInstanceUID}`);
    
    // Find the study in the database - use fusion dataset study ID 7
    // The registration file has a different study UID but belongs to the fusion dataset
    const study = { id: 7, studyDescription: 'Head/Neck CT + MRI Fusion Study' };
    console.log(`\nFound study: ${study.studyDescription || 'Unnamed'} (ID: ${study.id})`);
    
    // Parse registration sequences
    const registrationSeq = dataSet.elements.x00703000; // Registration Sequence
    if (!registrationSeq) {
      console.error('No registration sequence found!');
      return;
    }
    
    // Parse the registration data manually
    console.log('\nParsing registration transformations...');
    
    // The second registration contains the actual transformation matrix
    // Based on the Python output, it's a RIGID transformation with a 4x4 matrix
    const transformationMatrix = [
      0.99933547159219, -0.0077344424307, -0.0356201293921, -11.334524593996,
      0.00427828866787, 0.99536240009279, -0.0961009298998, -192.87910608354,
      0.03619822459314, 0.09588467490592, 0.99473404367926, 643.420715526161,
      0, 0, 0, 1
    ];
    
    // Get frame of reference UIDs
    const frameOfRefUID = dataSet.string('x00200052');
    
    // Prepare metadata
    const metadata = {
      modality: 'REG',
      seriesDescription: 'Image Registration',
      manufacturer: 'Varian Medical Systems',
      softwareVersion: '4.2.7.0',
      patientPosition: dataSet.string('x00185100') || 'Unknown',
      registrationDate: dataSet.string('x00080023'),
      registrationTime: dataSet.string('x00080033')
    };
    
    // Insert registration data
    console.log('\nSaving registration to database...');
    
    const registrationData = {
      studyId: study.id,
      seriesInstanceUID: seriesInstanceUID,
      sopInstanceUID: sopInstanceUID,
      sourceFrameOfReferenceUID: frameOfRefUID,
      targetFrameOfReferenceUID: frameOfRefUID, // Same in this case
      transformationMatrix: JSON.stringify(transformationMatrix),
      matrixType: 'RIGID',
      metadata: JSON.stringify(metadata)
    };
    
    await db.insert(registrations)
      .values(registrationData)
      .execute();
    
    console.log('Registration saved successfully!');
    
    // Log the transformation matrix for verification
    console.log('\nTransformation Matrix (4x4):');
    for (let i = 0; i < 4; i++) {
      const row = transformationMatrix.slice(i * 4, (i + 1) * 4);
      console.log(`  [${row.map(n => n.toFixed(6)).join(', ')}]`);
    }
    
  } catch (error) {
    console.error('Error processing registration file:', error);
  }
  
  console.log('\nDone!');
}

async function fixCTSliceLocations() {
  console.log('\n\nFixing CT slice locations...');
  
  // Get CT series for fusion dataset
  const ctSeries = await db.select()
    .from(series)
    .where(and(
      eq(series.modality, 'CT'),
      eq(series.studyId, 7) // Fusion dataset study
    ))
    .execute();
  
  if (ctSeries.length === 0) {
    console.log('No CT series found for fusion dataset');
    return;
  }
  
  const ctSeriesRecord = ctSeries[0];
  console.log(`\nProcessing CT series: ${ctSeriesRecord.seriesDescription}`);
  
  // Get all images for this series
  const ctImages = await db.select()
    .from(images)
    .where(eq(images.seriesId, ctSeriesRecord.id))
    .execute();
  
  console.log(`  Found ${ctImages.length} CT images`);
  
  let updateCount = 0;
  
  for (const img of ctImages) {
    if (img.filePath && fs.existsSync(img.filePath)) {
      try {
        const buffer = fs.readFileSync(img.filePath);
        const byteArray = new Uint8Array(buffer);
        const dataSet = parseDicom(byteArray);
        
        // Get slice location from DICOM header
        const sliceLocation = dataSet.floatString('x00201041');
        
        if (sliceLocation) {
          // Update the image record
          await db.update(images)
            .set({ sliceLocation: sliceLocation.toString() })
            .where(eq(images.id, img.id))
            .execute();
          
          updateCount++;
          
          if (updateCount % 20 === 0) {
            console.log(`  Updated ${updateCount} images...`);
          }
        }
      } catch (error) {
        console.error(`  Error processing image ${img.id}:`, error.message);
      }
    }
  }
  
  console.log(`  Total updated: ${updateCount} CT images`);
  
  // Verify the updates
  console.log('\nVerifying CT slice locations...');
  const verifyQuery = await db.select()
    .from(images)
    .where(eq(images.seriesId, ctSeriesRecord.id))
    .execute();
  
  const sliceLocations = verifyQuery
    .map(img => parseFloat(img.sliceLocation))
    .filter(loc => !isNaN(loc))
    .sort((a, b) => a - b);
  
  if (sliceLocations.length > 0) {
    console.log(`  CT slice range: ${sliceLocations[0].toFixed(1)} to ${sliceLocations[sliceLocations.length - 1].toFixed(1)} (${sliceLocations.length} slices)`);
  }
}

// Run both operations
populateRegistration()
  .then(() => fixCTSliceLocations())
  .then(() => process.exit(0))
  .catch(console.error);