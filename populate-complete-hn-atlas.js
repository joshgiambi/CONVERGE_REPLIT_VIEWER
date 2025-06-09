const fs = require('fs');
const path = require('path');

// Copy all 153 CT slices to uploads directory
const sourceDir = 'attached_assets/HN-ATLAS-84/HN-ATLAS-84/DICOM_CONTRAST';
const destDir = 'uploads/hn-atlas-complete';

// Create destination directory
if (!fs.existsSync(destDir)) {
  fs.mkdirSync(destDir, { recursive: true });
}

// Get all DICOM files from the extracted dataset
const files = fs.readdirSync(sourceDir).filter(file => file.endsWith('.dcm'));
console.log(`Found ${files.length} DICOM files to copy`);

// Copy files to destination
files.forEach((file, index) => {
  const sourcePath = path.join(sourceDir, file);
  const destPath = path.join(destDir, file);
  fs.copyFileSync(sourcePath, destPath);
  if ((index + 1) % 20 === 0) {
    console.log(`Copied ${index + 1}/${files.length} files...`);
  }
});

console.log(`✅ Successfully copied all ${files.length} DICOM files to ${destDir}`);

// Generate SQL for inserting all images
const seriesId = 13; // CT series ID
let sqlStatements = [];

files.forEach((file, index) => {
  const instanceNumber = index + 1;
  const sopInstanceUID = `2.16.840.1.114362.1.11932039.hn84.${instanceNumber.toString().padStart(3, '0')}`;
  const filePath = path.join(destDir, file);
  const fileSize = fs.statSync(filePath).size;
  
  const metadata = JSON.stringify({
    source: "HN-ATLAS-84",
    anatomy: "Head & Neck",
    contrast: true,
    sliceIndex: instanceNumber,
    totalSlices: files.length
  });
  
  sqlStatements.push(`(${seriesId}, '${sopInstanceUID}', ${instanceNumber}, '${filePath}', '${file}', ${fileSize}, '${metadata}')`);
});

// Write SQL file
const sqlContent = `-- Insert all ${files.length} CT images for complete HN-ATLAS dataset
INSERT INTO images (series_id, sop_instance_uid, instance_number, file_path, file_name, file_size, metadata) VALUES
${sqlStatements.join(',\n')};`;

fs.writeFileSync('complete-hn-atlas-images.sql', sqlContent);
console.log(`✅ Generated SQL file with ${files.length} image records`);
console.log('Run: npx tsx -e "const { execSync } = require(\'child_process\'); execSync(\'psql $DATABASE_URL -f complete-hn-atlas-images.sql\');"');