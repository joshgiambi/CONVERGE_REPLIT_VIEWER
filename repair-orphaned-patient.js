import { db } from './server/db.js';
import { patients, studies, series, images } from './shared/schema.js';
import { eq } from 'drizzle-orm';
import fs from 'fs';
import path from 'path';
import dicomParser from 'dicom-parser';

// Helper function to extract DICOM metadata
function extractDICOMMetadata(filePath) {
  try {
    const dicomFile = fs.readFileSync(filePath);
    const dataSet = dicomParser.parseDicom(dicomFile);
    
    // Extract basic metadata
    const metadata = {
      patientID: dataSet.string('x00100020') || '',
      patientName: dataSet.string('x00100010') || '',
      studyInstanceUID: dataSet.string('x0020000d') || '',
      seriesInstanceUID: dataSet.string('x0020000e') || '',
      sopInstanceUID: dataSet.string('x00080018') || '',
      instanceNumber: dataSet.intString('x00200013') || '1',
      studyDate: dataSet.string('x00080020') || '',
      studyDescription: dataSet.string('x00081030') || '',
      seriesDescription: dataSet.string('x0008103e') || '',
      seriesNumber: dataSet.intString('x00200011') || '0',
      modality: dataSet.string('x00080060') || 'OT',
      accessionNumber: dataSet.string('x00080050') || '',
      sliceThickness: dataSet.floatString('x00180050') || null,
      imagePositionPatient: dataSet.string('x00200032') || null,
      imageOrientationPatient: dataSet.string('x00200037') || null,
      pixelSpacing: dataSet.string('x00280030') || null,
      sliceLocation: dataSet.floatString('x00201041') || null,
      windowCenter: dataSet.string('x00281050') || null,
      windowWidth: dataSet.string('x00281051') || null,
    };
    
    return metadata;
  } catch (error) {
    console.error(`Error parsing DICOM file ${filePath}:`, error);
    return null;
  }
}

async function repairOrphanedPatient() {
  const patientId = 'dUHouewD6bk1ImBcfClL59qbT';
  const patientDbId = 20; // From the console logs
  
  console.log(`\n=== Repairing orphaned patient: ${patientId} ===`);
  
  // Find all DICOM files in the patient's storage directory
  const patientPath = path.join('storage', 'patients', patientId);
  const dicomFiles = [];
  
  function findDicomFiles(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      
      if (stat.isDirectory()) {
        findDicomFiles(fullPath);
      } else if (file.endsWith('.dcm')) {
        dicomFiles.push(fullPath);
      }
    }
  }
  
  findDicomFiles(patientPath);
  console.log(`Found ${dicomFiles.length} DICOM files to process`);
  
  // Group files by study and series
  const studyDataMap = new Map();
  
  for (const filePath of dicomFiles) {
    try {
      const metadata = extractDICOMMetadata(filePath);
      if (!metadata) {
        console.error(`Failed to extract metadata from ${filePath}`);
        continue;
      }
      
      const studyUID = metadata.studyInstanceUID;
      const seriesUID = metadata.seriesInstanceUID;
      
      if (!studyDataMap.has(studyUID)) {
        studyDataMap.set(studyUID, {
          metadata: metadata,
          series: new Map()
        });
      }
      
      const study = studyDataMap.get(studyUID);
      if (!study.series.has(seriesUID)) {
        study.series.set(seriesUID, {
          metadata: metadata,
          images: []
        });
      }
      
      study.series.get(seriesUID).images.push({
        filePath: filePath,
        metadata: metadata
      });
      
    } catch (error) {
      console.error(`Error processing ${filePath}:`, error);
    }
  }
  
  console.log(`\nFound ${studyDataMap.size} studies`);
  
  // Create database entries using drizzle
  for (const [studyUID, studyData] of studyDataMap) {
    console.log(`\nProcessing study: ${studyUID}`);
    
    // Check if study already exists
    const existingStudy = await db.select().from(studies).where(eq(studies.studyInstanceUID, studyUID));
    
    let studyId;
    if (existingStudy.length > 0) {
      studyId = existingStudy[0].id;
      console.log(`Study already exists with ID: ${studyId}`);
    } else {
      // Create new study
      const studyMetadata = studyData.metadata;
      console.log(`Creating new study...`);
      
      const [newStudy] = await db.insert(studies).values({
        patientId: patientDbId,
        studyInstanceUID: studyUID,
        studyDate: studyMetadata.studyDate || '',
        studyDescription: studyMetadata.studyDescription || '',
        accessionNumber: studyMetadata.accessionNumber || '',
        numberOfSeries: studyData.series.size,
        numberOfImages: Array.from(studyData.series.values()).reduce((sum, s) => sum + s.images.length, 0),
        patientName: 'csrSSFJBiIDgeSeJ',
        patientID: patientId,
        modality: studyMetadata.modality || null
      }).returning();
      
      studyId = newStudy.id;
      console.log(`Created study with ID: ${studyId}`);
    }
    
    // Process series
    for (const [seriesUID, seriesData] of studyData.series) {
      console.log(`  Processing series: ${seriesUID} (${seriesData.images.length} images)`);
      
      // Check if series already exists
      const existingSeries = await db.select().from(series).where(eq(series.seriesInstanceUID, seriesUID));
      
      let seriesId;
      if (existingSeries.length > 0) {
        seriesId = existingSeries[0].id;
        console.log(`  Series already exists with ID: ${seriesId}`);
      } else {
        // Create new series
        const seriesMetadata = seriesData.metadata;
        console.log(`  Creating new series...`);
        
        const [newSeries] = await db.insert(series).values({
          studyId: studyId,
          seriesInstanceUID: seriesUID,
          seriesNumber: parseInt(seriesMetadata.seriesNumber) || 0,
          seriesDescription: seriesMetadata.seriesDescription || '',
          modality: seriesMetadata.modality || 'OT',
          imageCount: seriesData.images.length,
          sliceThickness: seriesMetadata.sliceThickness || null,
          metadata: { 
            bodyPartExamined: seriesMetadata.bodyPartExamined || '',
            protocolName: seriesMetadata.protocolName || '' 
          }
        }).returning();
        
        seriesId = newSeries.id;
        console.log(`  Created series with ID: ${seriesId}`);
      }
      
      // Process images
      let createdCount = 0;
      for (const imageData of seriesData.images) {
        const metadata = imageData.metadata;
        
        // Check if image already exists
        const existingImage = await db.select().from(images).where(eq(images.sopInstanceUID, metadata.sopInstanceUID));
        
        if (existingImage.length > 0) {
          continue;
        }
        
        // Create new image
        await db.insert(images).values({
          seriesId: seriesId,
          sopInstanceUID: metadata.sopInstanceUID,
          instanceNumber: parseInt(metadata.instanceNumber) || 1,
          filePath: imageData.filePath,
          fileName: path.basename(imageData.filePath),
          fileSize: fs.statSync(imageData.filePath).size,
          imagePosition: metadata.imagePositionPatient || null,
          imageOrientation: metadata.imageOrientationPatient || null,
          pixelSpacing: metadata.pixelSpacing || null,
          sliceLocation: metadata.sliceLocation ? String(metadata.sliceLocation) : null,
          windowCenter: metadata.windowCenter ? String(metadata.windowCenter) : null,
          windowWidth: metadata.windowWidth ? String(metadata.windowWidth) : null,
          metadata: { repaired: true }
        });
        
        createdCount++;
      }
      
      console.log(`  Created ${createdCount} new images`);
    }
  }
  
  console.log('\n=== Repair completed successfully! ===');
  process.exit(0);
}

// Run the repair
repairOrphanedPatient().catch(error => {
  console.error('Repair failed:', error);
  process.exit(1);
});