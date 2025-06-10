import fs from 'fs';
import path from 'path';

// Generate SQL for all 153 CT images
const uploadDir = 'uploads/hn-atlas-complete';
const files = fs.readdirSync(uploadDir).filter(f => f.endsWith('.dcm')).sort();

let sql = `-- Insert all 153 CT images for HN-ATLAS dataset\nINSERT INTO images (series_id, sop_instance_uid, instance_number, file_path, file_name, file_size, metadata) VALUES\n`;

const values = files.map((filename, index) => {
  const filePath = path.join(uploadDir, filename);
  const fileSize = fs.statSync(filePath).size;
  const instanceNumber = index + 1;
  const sopInstanceUID = `2.16.840.1.114362.1.11932039.ct.${instanceNumber.toString().padStart(3, '0')}`;
  
  return `(13, '${sopInstanceUID}', ${instanceNumber}, '${filePath}', '${filename}', ${fileSize}, '{"source": "HN-ATLAS-84", "anatomy": "Head & Neck", "contrast": true, "sliceIndex": ${instanceNumber}, "totalSlices": 153}')`;
});

sql += values.join(',\n') + ';\n\n';

// Add RT Structure Set
sql += `-- Add RT Structure Set\nINSERT INTO images (series_id, sop_instance_uid, instance_number, file_path, file_name, file_size, metadata) VALUES\n`;
sql += `(14, '2.16.840.1.114362.1.11932039.rtstruct.001', 1, 'uploads/hn-atlas-complete/RT_STRUCT_HN84.dcm', 'RT_STRUCT_HN84.dcm', 50000, '{"source": "HN-ATLAS-84", "type": "RT Structure Set", "modality": "RTSTRUCT"}');`;

fs.writeFileSync('complete-atlas-images.sql', sql);
console.log(`Generated SQL for ${files.length} CT images`);