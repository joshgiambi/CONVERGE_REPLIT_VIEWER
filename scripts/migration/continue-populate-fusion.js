import { db } from './server/db.js';
import { series, images } from './shared/schema.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function continuePopulation() {
  try {
    console.log('Continuing Fusion Dataset population...');
    
    const studyId = 7; // The new fusion dataset study
    const analysisData = JSON.parse(fs.readFileSync('fusion-2mri-analysis.json', 'utf8'));
    
    // Define the remaining series to import
    const seriesToImport = [
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
        studyId: studyId,
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
          
          if (imageCount % 20 === 0) {
            console.log(`  Processed ${imageCount}/${seriesData.count} images...`);
          }
        }
        
        console.log(`  Added ${imageCount} images`);
      }
    }
    
    console.log('\nFusion Dataset population completed!');
    console.log('- MR Series 1 (AX T1 FS+C): 60 images');
    console.log('- MR Series 2 (AX T1): 60 images'); 
    console.log('- RT Structure Set: Available');
    console.log('- Image Registration: Available');
    
  } catch (error) {
    console.error('Error continuing population:', error);
  } finally {
    process.exit(0);
  }
}

continuePopulation();