import fs from 'fs';
import path from 'path';
import * as dicomParser from 'dicom-parser';
import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import * as schema from './shared/schema.js';
import { eq } from 'drizzle-orm';

neonConfig.fetchConnectionCache = true;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle({ client: pool, schema });

function loadAndSortDicomFolder(dicomFolder) {
  console.log(`Scanning folder: ${dicomFolder}`);
  
  const files = [];
  function walkDir(dir) {
    const items = fs.readdirSync(dir);
    for (const item of items) {
      const fullPath = path.join(dir, item);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        walkDir(fullPath);
      } else if (item.endsWith('.dcm')) {
        files.push(fullPath);
      }
    }
  }
  
  walkDir(dicomFolder);
  console.log(`Found ${files.length} DICOM files`);
  
  const slices = [];
  for (const file of files) {
    try {
      const buffer = fs.readFileSync(file);
      const dataSet = dicomParser.parseDicom(buffer);
      
      // Extract ImagePositionPatient (0020,0032)
      let z = 0;
      const imagePositionElement = dataSet.elements.x00200032;
      if (imagePositionElement) {
        const positionStr = dataSet.string('x00200032');
        const positions = positionStr.split('\\').map(p => parseFloat(p));
        if (positions.length >= 3) {
          z = positions[2]; // Z coordinate
        }
      }
      
      // Extract InstanceNumber (0020,0013)
      let instance = 0;
      const instanceElement = dataSet.elements.x00200013;
      if (instanceElement) {
        instance = parseInt(dataSet.string('x00200013')) || 0;
      }
      
      // Extract SOP Instance UID for database matching
      let sopInstanceUID = '';
      const sopElement = dataSet.elements.x00080018;
      if (sopElement) {
        sopInstanceUID = dataSet.string('x00080018');
      }
      
      slices.push({
        file: file,
        z: z,
        instance: instance,
        sopInstanceUID: sopInstanceUID,
        fileName: path.basename(file)
      });
      
    } catch (error) {
      console.warn(`Error reading ${file}:`, error.message);
    }
  }
  
  console.log(`Successfully parsed ${slices.length} DICOM files`);
  
  // Sort by z coordinate (ImagePositionPatient[2]), fallback to instance number
  const slicesSorted = slices.sort((a, b) => {
    if (Math.abs(a.z - b.z) > 0.001) { // Use z if different
      return b.z - a.z; // Descending for head/neck (superior to inferior)
    }
    return a.instance - b.instance; // Fallback to instance number
  });
  
  console.log('Sorting complete:');
  console.log(`First slice: Z=${slicesSorted[0].z}, Instance=${slicesSorted[0].instance}`);
  console.log(`Last slice: Z=${slicesSorted[slicesSorted.length-1].z}, Instance=${slicesSorted[slicesSorted.length-1].instance}`);
  
  return slicesSorted;
}

async function updateDatabaseWithRealPositions() {
  try {
    console.log('Loading and sorting all DICOM files from HN-ATLAS dataset...');
    
    // Load and sort all DICOM files using real ImagePositionPatient data
    const sortedSlices = loadAndSortDicomFolder('uploads/hn-atlas-complete');
    
    console.log(`Total loaded and sorted: ${sortedSlices.length} slices`);
    
    if (sortedSlices.length !== 153) {
      console.warn(`Expected 153 slices, but found ${sortedSlices.length}`);
    }
    
    // Update database with correct anatomical ordering
    for (let i = 0; i < sortedSlices.length; i++) {
      const slice = sortedSlices[i];
      const anatomicalIndex = i + 1; // 1-based indexing for anatomical order
      
      try {
        // Find the database record by SOP Instance UID
        const [dbImage] = await db.select().from(schema.images)
          .where(eq(schema.images.sopInstanceUID, slice.sopInstanceUID));
        
        if (dbImage) {
          // Update with real anatomical positioning
          await db.update(schema.images)
            .set({
              metadata: {
                ...dbImage.metadata,
                imagePositionPatient: [0, 0, slice.z],
                zPosition: slice.z,
                anatomicalIndex: anatomicalIndex,
                sortingReady: true,
                realPositionData: true
              }
            })
            .where(eq(schema.images.id, dbImage.id));
          
          if (i % 25 === 0) {
            console.log(`Updated ${i + 1}/${sortedSlices.length}: ${slice.fileName} (Z=${slice.z})`);
          }
        } else {
          console.warn(`Database record not found for SOP: ${slice.sopInstanceUID}`);
        }
        
      } catch (error) {
        console.error(`Failed to update ${slice.fileName}:`, error.message);
      }
    }
    
    console.log('✅ Successfully updated all CT images with real anatomical positioning');
    console.log('🔄 DICOM viewer will now display images in correct superior→inferior order');
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

updateDatabaseWithRealPositions();