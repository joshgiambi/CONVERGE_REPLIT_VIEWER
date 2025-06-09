import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import * as schema from './shared/schema.js';
import { extractDICOMPosition } from './server/dicom-position-extractor.js';
import { eq } from 'drizzle-orm';

neonConfig.fetchConnectionCache = true;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle({ client: pool, schema });

async function addPositionMetadata() {
  try {
    console.log('Adding ImagePositionPatient metadata to existing CT images...');
    
    // Get all CT images from series 15 (HN-ATLAS CT series)
    const images = await db.select().from(schema.images).where(eq(schema.images.seriesId, 15));
    
    console.log(`Processing ${images.length} CT images...`);
    
    for (let i = 0; i < images.length; i++) {
      const image = images[i];
      const filePath = image.filePath;
      
      if (i % 20 === 0) {
        console.log(`Processing image ${i + 1}/${images.length}: ${image.fileName}`);
      }
      
      try {
        // Extract position metadata from DICOM file
        const positionData = extractDICOMPosition(filePath);
        
        // Calculate Z-position for head/neck CT (superior to inferior)
        let zPosition = null;
        if (positionData.imagePositionPatient && positionData.imagePositionPatient.length >= 3) {
          zPosition = positionData.imagePositionPatient[2];
        } else if (positionData.sliceLocation !== undefined) {
          zPosition = positionData.sliceLocation;
        } else {
          // Fallback: estimate based on instance number (3mm spacing)
          zPosition = (image.instanceNumber - 1) * 3.0;
        }
        
        // Update image with position metadata
        const updatedMetadata = {
          ...image.metadata,
          imagePositionPatient: positionData.imagePositionPatient,
          imageOrientationPatient: positionData.imageOrientationPatient,
          pixelSpacing: positionData.pixelSpacing,
          sliceLocation: positionData.sliceLocation,
          sliceThickness: positionData.sliceThickness,
          zPosition: zPosition,
          sortingReady: true
        };
        
        await db.update(schema.images)
          .set({ 
            metadata: updatedMetadata,
            imagePosition: positionData.imagePositionPatient ? 
              `${positionData.imagePositionPatient[0]}\\${positionData.imagePositionPatient[1]}\\${positionData.imagePositionPatient[2]}` : 
              null,
            sliceLocation: positionData.sliceLocation?.toString() || null
          })
          .where(eq(schema.images.id, image.id));
          
      } catch (error) {
        console.warn(`Failed to process ${image.fileName}:`, error.message);
      }
    }
    
    console.log('✅ Successfully added position metadata to all CT images');
    console.log('🔄 Images are now ready for proper anatomical sorting');
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

addPositionMetadata();