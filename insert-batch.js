import fs from 'fs';

// Get all the DICOM files we copied
const files = fs.readdirSync('uploads/hn-atlas-complete').filter(f => f.endsWith('.dcm'));
console.log(`Processing ${files.length} files...`);

// Create batch INSERT statements (PostgreSQL limit is usually 1000 per batch)
const batchSize = 50;
let sqlStatements = [];

for (let i = 0; i < files.length; i += batchSize) {
  const batch = files.slice(i, i + batchSize);
  const values = batch.map((file, index) => {
    const globalIndex = i + index + 1;
    const sopUID = `2.16.840.1.114362.1.11932039.hn84.${globalIndex.toString().padStart(3, '0')}`;
    const filePath = `uploads/hn-atlas-complete/${file}`;
    const metadata = {
      source: "HN-ATLAS-84",
      anatomy: "Head & Neck", 
      contrast: true,
      sliceIndex: globalIndex,
      totalSlices: files.length
    };
    
    return `(15, '${sopUID}', ${globalIndex}, '${filePath}', '${file}', 526160, '${JSON.stringify(metadata)}'::jsonb)`;
  }).join(',\n');
  
  const sql = `INSERT INTO images (series_id, sop_instance_uid, instance_number, file_path, file_name, file_size, metadata) VALUES\n${values};`;
  
  fs.writeFileSync(`batch-${Math.floor(i/batchSize) + 1}.sql`, sql);
  sqlStatements.push(`batch-${Math.floor(i/batchSize) + 1}.sql`);
}

console.log(`Created ${sqlStatements.length} batch files: ${sqlStatements.join(', ')}`);
console.log('Execute each batch with the SQL tool.');