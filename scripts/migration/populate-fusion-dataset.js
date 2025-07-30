import fs from 'fs';
import path from 'path';
import dicomParser from 'dicom-parser';
import { db, pool } from './server/db.ts';
import { patients, studies, series, images } from './shared/schema.ts';
import { eq } from 'drizzle-orm';

const DATASET_PATH = 'attached_assets/fusion-dataset/eGxOwa0vElJ9I98DElZly59D5';

async function populateFusionDataset() {
  console.log('Starting fusion dataset population...');
  
  try {
    // Read series info
    const seriesInfo = JSON.parse(
      fs.readFileSync('attached_assets/fusion-dataset/series_info.json', 'utf8')
    );
    
    // Create patient
    const patientData = {
      patientID: seriesInfo.patient_id || 'FUSION-TEST-001',
      patientName: seriesInfo.patient_name || 'Fusion Test Patient',
      dateOfBirth: '1970-01-01',
      patientSex: 'M'
    };
    
    console.log('Creating patient:', patientData.patientName);
    
    // Check if patient exists
    const existingPatient = await db.select()
      .from(patients)
      .where(eq(patients.patientID, patientData.patientID))
      .limit(1);
    
    let patient;
    if (existingPatient.length > 0) {
      patient = existingPatient[0];
      console.log('Patient already exists, using existing record');
    } else {
      const [newPatient] = await db.insert(patients)
        .values(patientData)
        .returning();
      patient = newPatient;
    }
    
    // Create study
    const studyData = {
      patientId: patient.id,
      studyInstanceUID: '1.2.246.352.221.123456789', // From dataset
      studyDate: new Date('2024-01-15'),
      studyTime: '120000',
      accessionNumber: 'FUSION001',
      studyDescription: 'Head/Neck with MR Fusion'
    };
    
    console.log('Creating study...');
    
    // Check if study exists
    const existingStudy = await db.select()
      .from(studies)
      .where(eq(studies.studyInstanceUID, studyData.studyInstanceUID))
      .limit(1);
    
    let study;
    if (existingStudy.length > 0) {
      study = existingStudy[0];
      console.log('Study already exists, using existing record');
    } else {
      const [newStudy] = await db.insert(studies)
        .values(studyData)
        .returning();
      study = newStudy;
    }
    
    // Process each series
    const seriesMap = new Map();
    
    for (const seriesData of seriesInfo.series) {
      console.log(`\nProcessing ${seriesData.modality} series: ${seriesData.description}`);
      
      const seriesEntry = {
        studyId: study.id,
        seriesInstanceUID: seriesData.series_uid,
        seriesNumber: seriesMap.size + 1,
        modality: seriesData.modality,
        seriesDescription: seriesData.description,
        bodyPart: 'HEAD',
        seriesDate: new Date('2024-01-15'),
        seriesTime: '120000'
      };
      
      // Check if series exists
      const existingSeries = await db.select()
        .from(series)
        .where(eq(series.seriesInstanceUID, seriesData.series_uid))
        .limit(1);
      
      let createdSeries;
      if (existingSeries.length > 0) {
        createdSeries = existingSeries[0];
        console.log(`  Series already exists: ${seriesData.description}`);
      } else {
        const [newSeries] = await db.insert(series)
          .values(seriesEntry)
          .returning();
        createdSeries = newSeries;
      }
      
      seriesMap.set(seriesData.series_uid, createdSeries);
      
      // Process images for this series (skip RTSTRUCT)
      if (seriesData.modality !== 'RTSTRUCT') {
        await processSeriesImages(createdSeries, seriesData.modality);
      }
    }
    
    // Process registration file separately
    await processRegistrationFile(study);
    
    console.log('\n✅ Fusion dataset population complete!');
    console.log(`Patient: ${patient.name}`);
    console.log(`Study: ${study.studyDescription}`);
    console.log(`Series: ${seriesMap.size}`);
    
  } catch (error) {
    console.error('Error populating fusion dataset:', error);
  } finally {
    await pool.end();
  }
}

async function processSeriesImages(seriesRecord, modality) {
  const files = fs.readdirSync(DATASET_PATH)
    .filter(f => f.startsWith(`${modality}.`) && f.endsWith('.dcm') && !f.includes('REGISTRATION'));
  
  console.log(`  Processing ${files.length} ${modality} images...`);
  
  const imagePromises = files.map(async (filename, index) => {
    const filepath = path.join(DATASET_PATH, filename);
    const buffer = fs.readFileSync(filepath);
    const byteArray = new Uint8Array(buffer);
    
    try {
      const dataSet = dicomParser.parseDicom(byteArray);
      
      const imageData = {
        seriesId: seriesRecord.id,
        sopInstanceUID: dataSet.string('x00080018') || `${seriesRecord.seriesInstanceUID}.${index + 1}`,
        instanceNumber: dataSet.intString('x00200013') || index + 1,
        imageType: modality,
        rows: dataSet.uint16('x00280010') || 512,
        columns: dataSet.uint16('x00280011') || 512,
        sliceThickness: dataSet.floatString('x00180050') || 2.0,
        sliceLocation: dataSet.floatString('x00201041'),
        windowCenter: dataSet.intString('x00281050') || (modality === 'CT' ? 40 : 800),
        windowWidth: dataSet.intString('x00281051') || (modality === 'CT' ? 400 : 1600),
        filePath: filepath,
        fileName: filename
      };
      
      // Check if image exists
      const existingImage = await db.select()
        .from(images)
        .where(eq(images.sopInstanceUID, imageData.sopInstanceUID))
        .limit(1);
      
      if (existingImage.length === 0) {
        await db.insert(images)
          .values(imageData);
      }
      
    } catch (error) {
      console.error(`    Error processing ${filename}:`, error.message);
    }
  });
  
  await Promise.all(imagePromises);
}

async function processRegistrationFile(study) {
  const regFile = fs.readdirSync(DATASET_PATH)
    .find(f => f.includes('REGISTRATION'));
  
  if (!regFile) {
    console.log('No registration file found');
    return;
  }
  
  console.log('\nProcessing registration object...');
  
  const filepath = path.join(DATASET_PATH, regFile);
  const buffer = fs.readFileSync(filepath);
  const byteArray = new Uint8Array(buffer);
  
  try {
    const dataSet = dicomParser.parseDicom(byteArray);
    
    // Create a series entry for the registration object
    const regSeries = {
      studyId: study.id,
      seriesInstanceUID: dataSet.string('x0020000e') || 'REG-' + Date.now(),
      seriesNumber: 999, // High number to appear at end
      modality: 'REG',
      seriesDescription: 'Image Registration',
      bodyPart: 'HEAD',
      seriesDate: new Date('2024-01-15'),
      seriesTime: '120000'
    };
    
    // Check if registration series exists
    const existingRegSeries = await db.select()
      .from(series)
      .where(eq(series.seriesInstanceUID, regSeries.seriesInstanceUID))
      .limit(1);
    
    let createdRegSeries;
    if (existingRegSeries.length > 0) {
      createdRegSeries = existingRegSeries[0];
      console.log('  Registration series already exists');
    } else {
      const [newRegSeries] = await db.insert(series)
        .values(regSeries)
        .returning();
      createdRegSeries = newRegSeries;
    }
    
    // Store registration as a special image entry
    const regImage = {
      seriesId: createdRegSeries.id,
      sopInstanceUID: dataSet.string('x00080018') || 'REG-SOP-' + Date.now(),
      instanceNumber: 1,
      imageType: 'REG',
      rows: 0,
      columns: 0,
      filePath: filepath,
      fileName: regFile
    };
    
    // Check if registration image exists
    const existingRegImage = await db.select()
      .from(images)
      .where(eq(images.sopInstanceUID, regImage.sopInstanceUID))
      .limit(1);
    
    if (existingRegImage.length === 0) {
      await db.insert(images)
        .values(regImage);
    }
    
    console.log('  Registration object processed');
    
  } catch (error) {
    console.error('Error processing registration:', error);
  }
}

// Run the population
populateFusionDataset();