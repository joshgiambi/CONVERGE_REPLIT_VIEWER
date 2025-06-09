import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import * as schema from './shared/schema.js';
import fs from 'fs';
import path from 'path';

neonConfig.fetchConnectionCache = true;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle({ client: pool, schema });

async function completeInsertion() {
  try {
    // Get files that need to be inserted (skip the first 5 already inserted)
    const files = fs.readdirSync('uploads/hn-atlas-complete')
      .filter(f => f.endsWith('.dcm'))
      .sort()
      .slice(5); // Skip first 5 already inserted
    
    console.log(`Inserting remaining ${files.length} images...`);
    
    // Insert in batches of 25 for better performance
    for (let i = 0; i < files.length; i += 25) {
      const batch = files.slice(i, i + 25);
      const imageData = batch.map((file, batchIndex) => {
        const globalIndex = i + batchIndex + 6; // +6 because we already inserted 5
        const filePath = path.join('uploads/hn-atlas-complete', file);
        const fileSize = fs.statSync(filePath).size;
        
        return {
          seriesId: 15,
          sopInstanceUID: `2.16.840.1.114362.1.11932039.hn84.${globalIndex.toString().padStart(3, '0')}`,
          instanceNumber: globalIndex,
          filePath: filePath,
          fileName: file,
          fileSize: fileSize,
          metadata: {
            source: "HN-ATLAS-84",
            anatomy: "Head & Neck",
            contrast: true,
            sliceIndex: globalIndex,
            totalSlices: 153
          }
        };
      });
      
      await db.insert(schema.images).values(imageData);
      console.log(`Inserted batch ${Math.floor(i/25) + 1}: images ${i + 6}-${Math.min(i + 30, files.length + 5)}`);
    }
    
    // Add the single RT structure set
    await db.insert(schema.images).values({
      seriesId: 16, // RT series ID
      sopInstanceUID: '2.16.840.1.114362.1.11932039.rtstruct.001',
      instanceNumber: 1,
      filePath: 'uploads/hn-atlas-complete/RT_STRUCT_HN84.dcm',
      fileName: 'RT_STRUCT_HN84.dcm',
      fileSize: 45000,
      metadata: {
        source: "HN-ATLAS-84",
        type: "RT Structure Set",
        modality: "RTSTRUCT",
        structures: ["Brain Stem", "Spinal Cord", "Parotid Glands", "Mandible", "Larynx"]
      }
    });
    
    console.log(`✅ Successfully completed HN-ATLAS dataset with 153 CT slices + 1 RT structure set`);
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

completeInsertion();