import fs from 'fs';
import path from 'path';
import dicomParser from 'dicom-parser';

function extractRealDicomPositions() {
  console.log('Extracting real ImagePositionPatient data from all 153 DICOM files...');
  
  const dicomFolder = 'uploads/hn-atlas-complete';
  const files = fs.readdirSync(dicomFolder)
    .filter(f => f.endsWith('.dcm'))
    .map(f => path.join(dicomFolder, f));
  
  console.log(`Found ${files.length} DICOM files`);
  
  const slices = [];
  
  for (const file of files) {
    try {
      const buffer = fs.readFileSync(file);
      const dataSet = dicomParser.parseDicom(buffer);
      
      // Extract SOP Instance UID (0008,0018)
      let sopInstanceUID = '';
      if (dataSet.elements.x00080018) {
        sopInstanceUID = dataSet.string('x00080018');
      }
      
      // Extract ImagePositionPatient (0020,0032)
      let imagePosition = null;
      let zPosition = 0;
      if (dataSet.elements.x00200032) {
        const positionStr = dataSet.string('x00200032');
        const positions = positionStr.split('\\').map(p => parseFloat(p));
        if (positions.length >= 3) {
          imagePosition = positions;
          zPosition = positions[2]; // Z coordinate for sorting
        }
      }
      
      // Extract InstanceNumber (0020,0013)
      let instanceNumber = 0;
      if (dataSet.elements.x00200013) {
        instanceNumber = parseInt(dataSet.string('x00200013')) || 0;
      }
      
      // Extract SliceLocation (0020,1041) as fallback
      let sliceLocation = null;
      if (dataSet.elements.x00201041) {
        sliceLocation = parseFloat(dataSet.string('x00201041'));
      }
      
      slices.push({
        sopInstanceUID,
        fileName: path.basename(file),
        imagePosition,
        zPosition,
        sliceLocation,
        instanceNumber
      });
      
    } catch (error) {
      console.warn(`Error reading ${file}:`, error.message);
    }
  }
  
  console.log(`Successfully parsed ${slices.length} DICOM files`);
  
  // Sort by Z coordinate (superior to inferior for head/neck CT)
  const sortedSlices = slices.sort((a, b) => {
    // Primary sort by Z position (descending for superior→inferior)
    if (Math.abs(a.zPosition - b.zPosition) > 0.001) {
      return b.zPosition - a.zPosition;
    }
    // Fallback to instance number
    return a.instanceNumber - b.instanceNumber;
  });
  
  console.log('\n=== ANATOMICAL SORTING RESULTS ===');
  console.log(`Total slices: ${sortedSlices.length}`);
  console.log(`First slice (superior): Z=${sortedSlices[0].zPosition}, Instance=${sortedSlices[0].instanceNumber}`);
  console.log(`Last slice (inferior): Z=${sortedSlices[sortedSlices.length-1].zPosition}, Instance=${sortedSlices[sortedSlices.length-1].instanceNumber}`);
  
  // Generate SQL update statements
  console.log('\n=== GENERATING SQL UPDATES ===');
  
  let sqlStatements = [];
  
  for (let i = 0; i < sortedSlices.length; i++) {
    const slice = sortedSlices[i];
    const anatomicalIndex = i + 1; // 1-based anatomical ordering
    
    const updateSQL = `UPDATE images SET metadata = metadata || jsonb_build_object(
      'imagePositionPatient', ARRAY[${slice.imagePosition ? slice.imagePosition.join(',') : '0,0,' + slice.zPosition}],
      'zPosition', ${slice.zPosition},
      'anatomicalIndex', ${anatomicalIndex},
      'realPositionData', true,
      'sortingReady', true
    ) WHERE sop_instance_uid = '${slice.sopInstanceUID}';`;
    
    sqlStatements.push(updateSQL);
  }
  
  // Write SQL file
  const sqlContent = sqlStatements.join('\n');
  fs.writeFileSync('update-anatomical-positions.sql', sqlContent);
  
  console.log(`Generated ${sqlStatements.length} SQL update statements`);
  console.log('SQL file written to: update-anatomical-positions.sql');
  
  // Also generate a verification report
  const report = sortedSlices.map((slice, index) => ({
    anatomicalIndex: index + 1,
    sopInstanceUID: slice.sopInstanceUID,
    fileName: slice.fileName,
    zPosition: slice.zPosition,
    instanceNumber: slice.instanceNumber
  }));
  
  fs.writeFileSync('anatomical-order-report.json', JSON.stringify(report, null, 2));
  console.log('Anatomical order report written to: anatomical-order-report.json');
  
  return sortedSlices;
}

// Execute the extraction
extractRealDicomPositions();