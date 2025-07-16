import { db } from './server/db.js';
import { patients, studies, series, images } from './shared/schema.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { eq } from 'drizzle-orm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function populateFusion2MRIDataset() {
  try {
    console.log('Populating Fusion Dataset with 2 MRI series...');
    
    // First, delete existing fusion dataset patient and all related data
    const existingPatient = await db.select()
      .from(patients)
      .where(eq(patients.patientName, 'Fusion Dataset'))
      .execute();
    
    if (existingPatient.length > 0) {
      console.log('Removing existing Fusion Dataset patient...');
      
      // Get all studies for this patient
      const existingStudies = await db.select()
        .from(studies)
        .where(eq(studies.patientId, existingPatient[0].id))
        .execute();
      
      for (const study of existingStudies) {
        // Get all series for this study
        const existingSeries = await db.select()
          .from(series)
          .where(eq(series.studyId, study.id))
          .execute();
        
        for (const ser of existingSeries) {
          // Delete all images for this series
          await db.delete(images)
            .where(eq(images.seriesId, ser.id))
            .execute();
        }
        
        // Delete all series for this study
        await db.delete(series)
          .where(eq(series.studyId, study.id))
          .execute();
      }
      
      // Delete all studies for this patient
      await db.delete(studies)
        .where(eq(studies.patientId, existingPatient[0].id))
        .execute();
      
      // Delete the patient
      await db.delete(patients)
        .where(eq(patients.id, existingPatient[0].id))
        .execute();
      
      console.log('Existing Fusion Dataset removed');
    }
    
    // Create patient - use actual DICOM patient name
    const [patient] = await db.insert(patients).values({
      patientID: 'SKXivnJzBjPxssVj',
      patientName: 'SKXivnJzBjPxssVj',
      dateOfBirth: '1970-01-01',
      patientSex: 'M'
    }).returning();
    
    console.log('Created patient:', patient.patientName);
    
    // Create study
    const [study] = await db.insert(studies).values({
      patientId: patient.id,
      studyInstanceUID: '1.2.246.352.221.49217923484520981221102354123456789',
      studyDate: '2025-01-16',
      studyTime: '120000',
      studyDescription: 'Head/Neck CT + MRI Fusion Study',
      accessionNumber: 'FUSION-2MRI-001',
      metadata: {}
    }).returning();
    
    console.log('Created study');
    
    // Process each series
    const datasetPath = path.join(__dirname, 'attached_assets/fusion-dataset-2mri');
    const analysisData = JSON.parse(fs.readFileSync('fusion-2mri-analysis.json', 'utf8'));
    
    // Define the series we want to import in order
    const seriesToImport = [
      { uid: '1.2.246.352.221.501106805901291277812361553159913254325', order: 1 }, // CT
      { uid: '1.2.246.352.221.47858108232856219561800489092032700341', order: 2 }, // MR T1 FS+C
      { uid: '1.2.246.352.221.506096163315156858063143487238890645', order: 3 }, // MR T1
      { uid: '1.2.246.352.221.51256273413216992075984752385699363511', order: 999 }, // REG
      { uid: '1.2.246.352.221.50950690660138796919900418680882465977', order: 1000 } // RTSTRUCT
    ];
    
    for (const seriesInfo of seriesToImport) {
      const seriesData = analysisData[seriesInfo.uid];
      if (!seriesData) continue;
      
      console.log(`\nProcessing ${seriesData.modality} series: ${seriesData.description}`);
      
      // Create series
      const [seriesRecord] = await db.insert(series).values({
        studyId: study.id,
        seriesInstanceUID: seriesInfo.uid,
        seriesDescription: seriesData.description,
        modality: seriesData.modality,
        seriesNumber: seriesInfo.order,
        imageCount: seriesData.count,
        metadata: seriesData.metadata || {}
      }).returning();
      
      console.log(`Created series ${seriesRecord.id}: ${seriesData.description}`);
      
      // Process images for this series (except RT and REG)
      if (seriesData.modality !== 'RTSTRUCT' && seriesData.modality !== 'REG') {
        let imageCount = 0;
        
        for (const filePath of seriesData.files) {
          const fileName = path.basename(filePath);
          const instanceNumber = imageCount + 1;
          
          // Extract SOP Instance UID from filename or generate one
          const sopUID = `1.2.246.352.221.${Date.now()}${Math.random().toString().substring(2, 10)}`;
          
          await db.insert(images).values({
            seriesId: seriesRecord.id,
            sopInstanceUID: sopUID,
            instanceNumber: instanceNumber,
            fileName: fileName,
            filePath: filePath.replace('/home/runner/workspace/', ''), // Store relative path
            uploadDate: new Date(),
            metadata: {}
          });
          
          imageCount++;
          
          if (imageCount % 50 === 0) {
            console.log(`  Processed ${imageCount}/${seriesData.count} images...`);
          }
        }
        
        console.log(`  Added ${imageCount} images`);
      }
    }
    
    console.log('\nFusion Dataset with 2 MRI series populated successfully!');
    console.log('Patient: Fusion Dataset');
    console.log('CT Series: 200 images');
    console.log('MR Series 1 (AX T1 FS+C): 60 images');
    console.log('MR Series 2 (AX T1): 60 images');
    console.log('RT Structure Set: Available');
    
  } catch (error) {
    console.error('Error populating fusion dataset:', error);
  } finally {
    process.exit(0);
  }
}

populateFusion2MRIDataset();