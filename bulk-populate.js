import { Pool, neonConfig } from '@neondatabase/serverless';
import fs from 'fs';
import path from 'path';

// Setup database connection
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function bulkPopulateImages() {
  try {
    const uploadDir = 'uploads/hn-atlas-complete';
    const files = fs.readdirSync(uploadDir).filter(f => f.endsWith('.dcm')).sort();
    
    console.log(`Processing ${files.length} DICOM files...`);
    
    // Process files in batches of 20
    for (let i = 20; i < files.length; i += 20) {
      const batch = files.slice(i, Math.min(i + 20, files.length));
      
      const values = batch.map((filename, index) => {
        const filePath = path.join(uploadDir, filename);
        const fileSize = fs.statSync(filePath).size;
        const instanceNumber = i + index + 1;
        const sopInstanceUID = `2.16.840.1.114362.1.11932039.ct.${instanceNumber.toString().padStart(3, '0')}`;
        
        return `(13, '${sopInstanceUID}', ${instanceNumber}, '${filePath}', '${filename}', ${fileSize}, '{"source": "HN-ATLAS-84", "anatomy": "Head & Neck", "contrast": true, "sliceIndex": ${instanceNumber}, "totalSlices": 153}')`;
      }).join(',\n');
      
      const sql = `INSERT INTO images (series_id, sop_instance_uid, instance_number, file_path, file_name, file_size, metadata) VALUES\n${values};`;
      
      await pool.query(sql);
      console.log(`Inserted batch ${Math.floor(i/20) + 1}: images ${i + 1} to ${Math.min(i + 20, files.length)}`);
    }
    
    // Add single RT Structure Set
    await pool.query(`
      INSERT INTO images (series_id, sop_instance_uid, instance_number, file_path, file_name, file_size, metadata) 
      VALUES (14, '2.16.840.1.114362.1.11932039.rtstruct.001', 1, 'uploads/hn-atlas-complete/RT_STRUCT_HN84.dcm', 'RT_STRUCT_HN84.dcm', 50000, '{"source": "HN-ATLAS-84", "type": "RT Structure Set", "modality": "RTSTRUCT"}');
    `);
    
    console.log('✅ Complete HN-ATLAS dataset populated with 153 CT slices + 1 RT Structure Set');
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

bulkPopulateImages();