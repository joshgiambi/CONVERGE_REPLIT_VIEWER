import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import * as schema from './shared/schema.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configure neon to work with Node.js
neonConfig.fetchConnectionCache = true;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle({ client: pool, schema });

async function populateCleanHNAtlas() {
  try {
    console.log('Starting clean HN-ATLAS population...');
    
    // Get all DICOM files from attached assets
    const attachedAssetsDir = path.join(__dirname, 'attached_assets');
    const dicomFiles = fs.readdirSync(attachedAssetsDir)
      .filter(file => file.endsWith('.dcm'))
      .sort();
    
    console.log(`Found ${dicomFiles.length} DICOM files in attached assets`);
    
    // Filter for HN-ATLAS files only
    const hnAtlasFiles = dicomFiles.filter(file => 
      file.includes('CT.04xy2fKzjzjjQjBsWgs8lrXPI') || 
      file.includes('HN') ||
      file.includes('ATLAS')
    );
    
    console.log(`Filtered to ${hnAtlasFiles.length} HN-ATLAS files`);
    
    // Separate CT images from RT structure set
    const ctImages = hnAtlasFiles.filter(file => file.startsWith('CT.04xy2fKzjzjjQjBsWgs8lrXPI.Image'));
    const rtStructFiles = hnAtlasFiles.filter(file => !file.startsWith('CT.04xy2fKzjzjjQjBsWgs8lrXPI.Image'));
    
    console.log(`CT Images: ${ctImages.length}, RT Struct files: ${rtStructFiles.length}`);
    
    // Take only the first RT structure file if multiple exist
    const rtStructFile = rtStructFiles.length > 0 ? rtStructFiles[0] : null;
    
    // Create patient
    const [patient] = await db.insert(schema.patients).values({
      patientID: 'HN-ATLAS-84',
      patientName: 'HN-ATLAS^84',
      patientSex: 'M',
      patientAge: '62',
      dateOfBirth: '19620315'
    }).returning();
    
    console.log(`Created patient: ${patient.patientName}`);
    
    // Create study
    const [study] = await db.insert(schema.studies).values({
      studyInstanceUID: '2.16.840.1.114362.1.11932039.1749487200000',
      patientId: patient.id,
      patientName: patient.patientName,
      patientID: patient.patientID,
      studyDate: '20200615',
      studyDescription: `Head & Neck CT with Contrast - ${ctImages.length} CT slices${rtStructFile ? ' + RT Structure Set' : ''}`,
      accessionNumber: 'HN84_CT_001',
      modality: 'CT',
      numberOfSeries: rtStructFile ? 2 : 1,
      numberOfImages: ctImages.length + (rtStructFile ? 1 : 0),
      isDemo: true
    }).returning();
    
    console.log(`Created study: ${study.studyDescription}`);
    
    // Create CT series
    const [ctSeries] = await db.insert(schema.series).values({
      studyId: study.id,
      seriesInstanceUID: '2.16.840.1.114362.1.11932039.1749487200000.series.1',
      seriesDescription: `CT Head Neck with Contrast - ${ctImages.length} slices`,
      modality: 'CT',
      seriesNumber: 1,
      imageCount: ctImages.length,
      sliceThickness: '3.0',
      metadata: {
        source: 'HN-ATLAS-84',
        anatomy: 'Head & Neck',
        contrast: 'IV Contrast Enhanced',
        totalSlices: ctImages.length
      }
    }).returning();
    
    console.log(`Created CT series with ${ctImages.length} images`);
    
    // Create destination directory
    const destDir = path.join(__dirname, 'uploads', 'hn-atlas-clean');
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    
    // Process CT images
    for (let i = 0; i < ctImages.length; i++) {
      const filename = ctImages[i];
      const sourcePath = path.join(attachedAssetsDir, filename);
      const destPath = path.join(destDir, filename);
      
      // Copy file to uploads directory
      fs.copyFileSync(sourcePath, destPath);
      
      // Extract image number from filename
      const imageMatch = filename.match(/Image (\d+)/);
      const imageNumber = imageMatch ? parseInt(imageMatch[1]) : i + 1;
      
      // Generate SOP Instance UID
      const sopInstanceUID = `2.16.840.1.114362.1.11932039.23213054100.549080074.${imageNumber}.${4000 + imageNumber}`;
      
      await db.insert(schema.images).values({
        seriesId: ctSeries.id,
        sopInstanceUID: sopInstanceUID,
        instanceNumber: imageNumber,
        filePath: destPath,
        fileName: filename,
        fileSize: fs.statSync(destPath).size,
        metadata: {
          source: 'HN-ATLAS-84',
          anatomy: 'Head & Neck',
          contrast: true,
          sliceIndex: imageNumber,
          totalSlices: ctImages.length
        }
      });
    }
    
    // Create RT Structure series if RT file exists
    if (rtStructFile) {
      const [rtSeries] = await db.insert(schema.series).values({
        studyId: study.id,
        seriesInstanceUID: '2.16.840.1.114362.1.11932039.1749487200000.series.2',
        seriesDescription: 'RT Structure Set - Organ Segmentation',
        modality: 'RTSTRUCT',
        seriesNumber: 2,
        imageCount: 1,
        sliceThickness: '3.0',
        metadata: {
          source: 'HN-ATLAS-84',
          type: 'Structure Set',
          structures: ['Brain Stem', 'Spinal Cord', 'Parotid Glands', 'Mandible', 'Larynx']
        }
      }).returning();
      
      const sourcePath = path.join(attachedAssetsDir, rtStructFile);
      const destPath = path.join(destDir, rtStructFile);
      
      // Copy RT structure file
      fs.copyFileSync(sourcePath, destPath);
      
      await db.insert(schema.images).values({
        seriesId: rtSeries.id,
        sopInstanceUID: '2.16.840.1.114362.1.11932039.rtstruct.001',
        instanceNumber: 1,
        filePath: destPath,
        fileName: rtStructFile,
        fileSize: fs.statSync(destPath).size,
        metadata: {
          source: 'HN-ATLAS-84',
          type: 'RT Structure Set',
          modality: 'RTSTRUCT'
        }
      });
      
      console.log(`Added RT Structure Set: ${rtStructFile}`);
    }
    
    console.log(`✅ Successfully populated HN-ATLAS dataset:`);
    console.log(`   Patient: ${patient.patientName} (${patient.patientID})`);
    console.log(`   Study: ${study.studyDescription}`);
    console.log(`   CT Images: ${ctImages.length}`);
    console.log(`   RT Structure Sets: ${rtStructFile ? 1 : 0}`);
    console.log(`   Total Files: ${ctImages.length + (rtStructFile ? 1 : 0)}`);
    
  } catch (error) {
    console.error('Error populating HN-ATLAS:', error);
  } finally {
    await pool.end();
  }
}

populateCleanHNAtlas();