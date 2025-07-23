import { DatabaseStorage } from './server/storage.js';
import fs from 'fs';
import path from 'path';

const storage = new DatabaseStorage();

async function fixEsophagusPatient() {
  const patientId = 'dUHouewD6bk1ImBcfClL59qbT';
  
  console.log('Fixing ESOPHAGUS patient database entries...');
  
  // Get the patient
  const patient = await storage.getPatientByID(patientId);
  if (!patient) {
    console.error('Patient not found!');
    return;
  }
  
  console.log('Found patient:', patient);
  
  // Path to the patient's storage directory
  const patientStoragePath = path.join('storage/patients', patientId);
  
  if (!fs.existsSync(patientStoragePath)) {
    console.error('Patient storage directory not found!');
    return;
  }
  
  // Get all study directories
  const studyDirs = fs.readdirSync(patientStoragePath);
  console.log(`Found ${studyDirs.length} studies`);
  
  for (const studyUID of studyDirs) {
    const studyPath = path.join(patientStoragePath, studyUID);
    if (!fs.statSync(studyPath).isDirectory()) continue;
    
    // Create study entry
    let study = await storage.getStudyByUID(studyUID);
    if (!study) {
      console.log(`Creating study: ${studyUID}`);
      study = await storage.createStudy({
        patientId: patient.id,
        studyInstanceUID: studyUID,
        studyDate: '20240416',  // From the metadata
        studyDescription: 'ESOPHAGUS Study',
        accessionNumber: '',
        patientName: patient.patientName,
        patientID: patient.patientID,
        modality: 'CT'
      });
    }
    
    // Get all series directories
    const seriesDirs = fs.readdirSync(studyPath);
    let totalImages = 0;
    
    for (const seriesUID of seriesDirs) {
      const seriesPath = path.join(studyPath, seriesUID);
      if (!fs.statSync(seriesPath).isDirectory()) continue;
      
      // Get all DICOM files in series
      const dcmFiles = fs.readdirSync(seriesPath).filter(f => f.endsWith('.dcm'));
      totalImages += dcmFiles.length;
      
      // Create series entry
      let series = await storage.getSeriesByUID(seriesUID);
      if (!series) {
        console.log(`Creating series: ${seriesUID} with ${dcmFiles.length} images`);
        series = await storage.createSeries({
          studyId: study.id,
          seriesInstanceUID: seriesUID,
          seriesNumber: 1,
          seriesDescription: 'CT Series',
          modality: 'CT',
          imageCount: dcmFiles.length
        });
      }
      
      // Create image entries
      for (const dcmFile of dcmFiles) {
        const sopUID = dcmFile.replace('.dcm', '');
        const filePath = path.join(seriesPath, dcmFile);
        
        const existingImage = await storage.getImageByUID(sopUID);
        if (!existingImage) {
          await storage.createImage({
            seriesId: series.id,
            sopInstanceUID: sopUID,
            instanceNumber: 1,
            filePath: filePath,
            fileName: dcmFile,
            fileSize: fs.statSync(filePath).size
          });
        }
      }
      
      // Update series image count
      await storage.updateSeriesImageCount(series.id, dcmFiles.length);
    }
    
    // Update study counts
    await storage.updateStudyCounts(study.id, seriesDirs.length, totalImages);
  }
  
  console.log('Fix completed!');
  process.exit(0);
}

fixEsophagusPatient().catch(console.error);