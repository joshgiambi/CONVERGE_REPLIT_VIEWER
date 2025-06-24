import fs from 'fs';
import path from 'path';

// Generate SQL for all 153 HN-ATLAS CT images
const contrastPath = 'attached_assets/HN-ATLAS-84/HN-ATLAS-84/DICOM_CONTRAST';
const files = fs.readdirSync(contrastPath)
  .filter(f => f.endsWith('.dcm'))
  .sort();

console.log(`-- Creating ${files.length} HN-ATLAS CT image records`);
console.log('BEGIN;');

const values = files.map((fileName, index) => {
  const instanceNumber = index + 6; // Start after existing 5 records
  const sliceLocation = instanceNumber * 3.0;
  const sopUID = `HN-ATLAS-84-${instanceNumber.toString().padStart(3, '0')}`;
  
  return `(8, '${sopUID}', ${instanceNumber}, 'uploads/hn-atlas-demo/${fileName}', '${fileName}', 1048576, '["0.488", "0.488"]', '${sliceLocation}', '50', '350', '{"source": "HN-ATLAS-84", "anatomy": "Head & Neck", "contrast": true, "sliceIndex": ${instanceNumber}, "totalSlices": 153}', NOW())`;
}).join(',\n');

console.log(`INSERT INTO images (
  series_id, sop_instance_uid, instance_number, file_path, file_name,
  file_size, pixel_spacing, slice_location, window_center, window_width,
  metadata, created_at
) VALUES`);
console.log(values);
console.log(';');
console.log('COMMIT;');