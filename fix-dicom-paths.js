import { Pool, neonConfig } from '@neondatabase/serverless';
import dicomParser from 'dicom-parser';
import fs from 'fs';
import path from 'path';
import ws from 'ws';

neonConfig.webSocketConstructor = ws;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function fixDicomPaths() {
  console.log('🔧 Fixing DICOM file paths and SOP Instance UIDs...');
  
  const dicomDir = 'uploads/hn-atlas-complete';
  const files = fs.readdirSync(dicomDir).filter(f => f.endsWith('.dcm'));
  
  console.log(`Found ${files.length} DICOM files`);
  
  let updatedCount = 0;
  
  for (const fileName of files) {
    try {
      const filePath = path.join(dicomDir, fileName);
      const byteArray = new Uint8Array(fs.readFileSync(filePath));
      const dataSet = dicomParser.parseDicom(byteArray);
      
      // Extract metadata from DICOM file
      const sopInstanceUID = dataSet.string('x00080018');
      const instanceNumber = parseInt(dataSet.string('x00200013') || '0');
      const imagePosition = dataSet.string('x00200032');
      
      if (!sopInstanceUID) {
        console.log(`⚠️  No SOP Instance UID found in ${fileName}`);
        continue;
      }
      
      // Parse image position
      let imagePositionArray = null;
      if (imagePosition) {
        imagePositionArray = imagePosition.split('\\').map(parseFloat);
      }
      
      // Update database record by instance number (since we have sequential data)
      const updateQuery = `
        UPDATE images 
        SET 
          sop_instance_uid = $1,
          file_path = $2,
          file_name = $3,
          image_position = $4
        WHERE instance_number = $5 AND series_id = 15
      `;
      
      const result = await pool.query(updateQuery, [
        sopInstanceUID,
        filePath,
        fileName,
        imagePositionArray ? JSON.stringify(imagePositionArray) : null,
        instanceNumber
      ]);
      
      if (result.rowCount > 0) {
        updatedCount++;
        console.log(`✓ Updated instance ${instanceNumber}: ${fileName}`);
      }
      
    } catch (error) {
      console.error(`❌ Error processing ${fileName}:`, error.message);
    }
  }
  
  console.log(`\n🎉 Updated ${updatedCount} DICOM records with correct file paths`);
  
  // Verify the updates
  const verifyQuery = `
    SELECT COUNT(*) as count 
    FROM images 
    WHERE series_id = 15 AND file_path LIKE 'uploads/hn-atlas-complete/%'
  `;
  
  const verifyResult = await pool.query(verifyQuery);
  console.log(`✅ Verification: ${verifyResult.rows[0].count} records have correct file paths`);
  
  await pool.end();
}

fixDicomPaths().catch(console.error);