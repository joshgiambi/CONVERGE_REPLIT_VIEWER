const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const dicomParser = require('dicom-parser');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function processCompleteAtlas() {
  const client = await pool.connect();
  
  try {
    console.log('Processing complete HN-ATLAS dataset with proper DICOM metadata...');
    
    const dicomDir = 'attached_assets/HN-ATLAS-84/DICOM_CONTRAST';
    const files = fs.readdirSync(dicomDir)
      .filter(f => f.endsWith('.dcm'))
      .map(f => path.join(dicomDir, f));
    
    console.log(`Found ${files.length} DICOM files`);
    
    // Parse all DICOM files to extract metadata
    const dicomData = [];
    
    for (const filePath of files) {
      try {
        const buffer = fs.readFileSync(filePath);
        const byteArray = new Uint8Array(buffer);
        const dataSet = dicomParser.parseDicom(byteArray);
        
        // Extract critical spatial metadata
        const instanceNumber = dataSet.intString('x00200013');
        const sliceLocation = dataSet.floatString('x00201041');
        const imagePosition = dataSet.string('x00200032');
        const sopInstanceUID = dataSet.string('x00080018');
        
        // Parse image position for Z coordinate
        let zPosition = null;
        if (imagePosition) {
          const positions = imagePosition.split('\\').map(p => parseFloat(p));
          zPosition = positions[2]; // Z coordinate
        }
        
        dicomData.push({
          filePath: filePath,
          fileName: path.basename(filePath),
          sopInstanceUID: sopInstanceUID || `generated.${instanceNumber}`,
          instanceNumber: instanceNumber ? parseInt(instanceNumber) : null,
          sliceLocation: sliceLocation ? parseFloat(sliceLocation) : null,
          zPosition: zPosition,
          fileSize: buffer.length
        });
        
      } catch (error) {
        console.warn(`Failed to parse ${filePath}:`, error.message);
      }
    }
    
    // Sort by spatial position - prefer slice location, then Z position, then instance number
    dicomData.sort((a, b) => {
      // Primary: slice location
      if (a.sliceLocation !== null && b.sliceLocation !== null) {
        return a.sliceLocation - b.sliceLocation;
      }
      
      // Secondary: Z position from image position
      if (a.zPosition !== null && b.zPosition !== null) {
        return a.zPosition - b.zPosition;
      }
      
      // Tertiary: instance number
      if (a.instanceNumber !== null && b.instanceNumber !== null) {
        return a.instanceNumber - b.instanceNumber;
      }
      
      // Final fallback: filename
      return a.fileName.localeCompare(b.fileName, undefined, { numeric: true });
    });
    
    console.log(`Sorted ${dicomData.length} DICOM files by spatial position`);
    
    // Insert all images with proper ordering
    for (let i = 0; i < dicomData.length; i++) {
      const data = dicomData[i];
      
      await client.query(`
        INSERT INTO images (
          series_id, sop_instance_uid, instance_number, file_path, file_name, file_size, 
          slice_location, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [
        1, // series_id
        data.sopInstanceUID,
        i + 1, // Sequential instance number based on spatial order
        data.filePath,
        data.fileName,
        data.fileSize,
        data.sliceLocation?.toString(),
        JSON.stringify({
          source: 'HN-ATLAS-84',
          anatomy: 'Head & Neck',
          contrast: true,
          originalInstanceNumber: data.instanceNumber,
          originalSliceLocation: data.sliceLocation,
          zPosition: data.zPosition,
          spatialIndex: i + 1,
          totalSlices: dicomData.length
        })
      ]);
    }
    
    // Update series image count
    await client.query('UPDATE series SET image_count = $1 WHERE id = 1', [dicomData.length]);
    
    // Update study image count
    await client.query('UPDATE studies SET number_of_images = $1 WHERE id = 1', [dicomData.length]);
    
    console.log(`✅ Successfully processed ${dicomData.length} CT slices with proper spatial ordering`);
    
    // Verify ordering
    const result = await client.query(`
      SELECT instance_number, slice_location, file_name, 
             metadata->>'originalSliceLocation' as orig_slice,
             metadata->>'zPosition' as z_pos
      FROM images 
      WHERE series_id = 1 
      ORDER BY instance_number 
      LIMIT 10
    `);
    
    console.log('First 10 slices in order:');
    result.rows.forEach(row => {
      console.log(`${row.instance_number}: ${row.file_name} (slice: ${row.orig_slice}, z: ${row.z_pos})`);
    });
    
  } catch (error) {
    console.error('Error processing atlas:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

processCompleteAtlas();