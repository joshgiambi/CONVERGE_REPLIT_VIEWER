import { db } from './server/db.js';
import { patients, studies, series, images } from './shared/schema.js';
import { eq } from 'drizzle-orm';
import fs from 'fs';
import path from 'path';
import dicomParser from 'dicom-parser';

async function repairEsophagusStorage() {
  console.log('Repairing ESOPHAGUS_31 storage entries...');
  
  // Find the ESOPHAGUS_31 patient
  const [patient] = await db.select().from(patients).where(eq(patients.patientID, 'ESOPHAGUS_31'));
  if (!patient) {
    console.error('ESOPHAGUS_31 patient not found!');
    return;
  }
  
  console.log(`Found patient: ${patient.patientName} (ID: ${patient.id})`);
  
  // Scan the storage directory for this patient
  const patientStoragePath = path.join('storage/patients', patient.patientID);
  
  if (!fs.existsSync(patientStoragePath)) {
    console.error(`Storage path not found: ${patientStoragePath}`);
    return;
  }
  
  // Map to track studies and series
  const studiesMap = new Map();
  const seriesMap = new Map();
  let totalImages = 0;
  
  // Recursively find all DICOM files
  function findDicomFiles(dir) {
    const files = [];
    const items = fs.readdirSync(dir);
    
    for (const item of items) {
      const fullPath = path.join(dir, item);
      const stat = fs.statSync(fullPath);
      
      if (stat.isDirectory()) {
        files.push(...findDicomFiles(fullPath));
      } else if (item.endsWith('.dcm')) {
        files.push(fullPath);
      }
    }
    
    return files;
  }
  
  const dicomFiles = findDicomFiles(patientStoragePath);
  console.log(`Found ${dicomFiles.length} DICOM files in storage`);
  
  // Process each DICOM file
  for (const filePath of dicomFiles) {
    try {
      // Read and parse DICOM file
      const buffer = fs.readFileSync(filePath);
      const dataSet = dicomParser.parseDicom(new Uint8Array(buffer));
      
      // Extract metadata
      const studyInstanceUID = dataSet.string('x0020000d') || 'unknown-study';
      const seriesInstanceUID = dataSet.string('x0020000e') || 'unknown-series';
      const sopInstanceUID = dataSet.string('x00080018') || path.basename(filePath, '.dcm');
      const instanceNumber = parseInt(dataSet.string('x00200013') || '1');
      const modality = dataSet.string('x00080060') || 'OT';
      const studyDescription = dataSet.string('x00081030') || '';
      const seriesDescription = dataSet.string('x0008103e') || '';
      const seriesNumber = parseInt(dataSet.string('x00200011') || '0');
      
      // Get or create study
      if (!studiesMap.has(studyInstanceUID)) {
        // Check if study exists
        let [study] = await db.select().from(studies)
          .where(eq(studies.studyInstanceUID, studyInstanceUID));
          
        if (!study) {
          // Create new study
          [study] = await db.insert(studies).values({
            patientId: patient.id,
            studyInstanceUID,
            studyDescription,
            studyDate: dataSet.string('x00080020') || null,
            accessionNumber: dataSet.string('x00080050') || null,
            numberOfSeries: 0,
            numberOfImages: 0,
            metadata: {}
          }).returning();
          console.log(`Created study: ${studyInstanceUID}`);
        }
        
        studiesMap.set(studyInstanceUID, study);
      }
      
      const study = studiesMap.get(studyInstanceUID);
      
      // Get or create series
      const seriesKey = `${studyInstanceUID}-${seriesInstanceUID}`;
      if (!seriesMap.has(seriesKey)) {
        // Check if series exists
        let [seriesData] = await db.select().from(series)
          .where(eq(series.seriesInstanceUID, seriesInstanceUID));
          
        if (!seriesData) {
          // Create new series
          [seriesData] = await db.insert(series).values({
            studyId: study.id,
            seriesInstanceUID,
            seriesNumber,
            seriesDescription,
            modality,
            imageCount: 0,
            sliceThickness: parseFloat(dataSet.string('x00180050')) || null,
            metadata: {}
          }).returning();
          console.log(`Created series: ${seriesInstanceUID} (${modality})`);
        }
        
        seriesMap.set(seriesKey, seriesData);
      }
      
      const seriesData = seriesMap.get(seriesKey);
      
      // Check if image already exists
      const [existingImage] = await db.select().from(images)
        .where(eq(images.sopInstanceUID, sopInstanceUID));
        
      if (!existingImage) {
        // Create image entry
        await db.insert(images).values({
          seriesId: seriesData.id,
          sopInstanceUID,
          instanceNumber,
          filePath: filePath,
          fileName: path.basename(filePath),
          fileSize: fs.statSync(filePath).size,
          imagePosition: dataSet.string('x00200032') ? 
            dataSet.string('x00200032').split('\\').map(parseFloat) : null,
          imageOrientation: dataSet.string('x00200037') ? 
            dataSet.string('x00200037').split('\\').map(parseFloat) : null,
          pixelSpacing: dataSet.string('x00280030') ? 
            dataSet.string('x00280030').split('\\').map(parseFloat) : null,
          sliceLocation: parseFloat(dataSet.string('x00201041')) || null,
          windowCenter: parseInt(dataSet.string('x00281050')) || null,
          windowWidth: parseInt(dataSet.string('x00281051')) || null,
          metadata: {}
        });
        totalImages++;
        
        if (totalImages % 50 === 0) {
          console.log(`Progress: ${totalImages} images created...`);
        }
      }
      
    } catch (error) {
      console.error(`Error processing ${filePath}:`, error.message);
    }
  }
  
  // Update counts
  console.log('\nUpdating counts...');
  
  for (const [studyUID, study] of studiesMap) {
    const studySeries = await db.select().from(series).where(eq(series.studyId, study.id));
    let totalStudyImages = 0;
    
    for (const s of studySeries) {
      const seriesImages = await db.select().from(images).where(eq(images.seriesId, s.id));
      await db.update(series)
        .set({ imageCount: seriesImages.length })
        .where(eq(series.id, s.id));
      totalStudyImages += seriesImages.length;
    }
    
    await db.update(studies)
      .set({ 
        numberOfSeries: studySeries.length,
        numberOfImages: totalStudyImages 
      })
      .where(eq(studies.id, study.id));
  }
  
  console.log(`\nRepair complete! Created ${totalImages} new image entries.`);
  console.log(`Studies: ${studiesMap.size}, Series: ${seriesMap.size}`);
}

repairEsophagusStorage().catch(console.error);