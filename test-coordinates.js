// Test coordinate transformations for HFS patient position

// Sample DICOM metadata from our dataset
const imagePosition = [-249.51171875, -448.51171875, 506];
const pixelSpacing = [0.9765625, 0.9765625];
const imageWidth = 512;
const imageHeight = 512;

console.log('=== HFS Coordinate Transformation Test ===\n');
console.log('Image Position (origin):', imagePosition);
console.log('Pixel Spacing:', pixelSpacing);
console.log('Image Size:', imageWidth, 'x', imageHeight);

// Test some key anatomical points
const testPoints = [
  { name: 'Image Center', dicomX: -249.51171875, dicomY: -448.51171875 },
  { name: 'Patient Right Edge', dicomX: -249.51171875 - 250, dicomY: -448.51171875 },
  { name: 'Patient Left Edge', dicomX: -249.51171875 + 250, dicomY: -448.51171875 },
  { name: 'Anterior Edge', dicomX: -249.51171875, dicomY: -448.51171875 - 250 },
  { name: 'Posterior Edge', dicomX: -249.51171875, dicomY: -448.51171875 + 250 }
];

console.log('\n=== Coordinate Transformations ===');
testPoints.forEach(point => {
  // Calculate pixel coordinates
  const deltaX = point.dicomX - imagePosition[0];
  const deltaY = point.dicomY - imagePosition[1];
  
  // Standard mapping (incorrect)
  const standardPixelX = deltaX / pixelSpacing[1];
  const standardPixelY = deltaY / pixelSpacing[0];
  
  // HFS radiological mapping (correct)
  const hfsPixelX = imageWidth - (deltaX / pixelSpacing[1]); // Flip X
  const hfsPixelY = deltaY / pixelSpacing[0];
  
  console.log(`\n${point.name}:`);
  console.log(`  DICOM: (${point.dicomX.toFixed(1)}, ${point.dicomY.toFixed(1)})`);
  console.log(`  Standard pixels: (${standardPixelX.toFixed(1)}, ${standardPixelY.toFixed(1)})`);
  console.log(`  HFS pixels: (${hfsPixelX.toFixed(1)}, ${hfsPixelY.toFixed(1)})`);
  
  // Explain the position
  if (point.name === 'Patient Right Edge') {
    console.log('  → Should appear on LEFT side of screen (HFS flips X)');
  } else if (point.name === 'Patient Left Edge') {
    console.log('  → Should appear on RIGHT side of screen (HFS flips X)');
  }
});

console.log('\n=== Summary ===');
console.log('For HFS (Head First Supine) axial images:');
console.log('- Patient is lying on their back');
console.log('- We view from feet looking toward head');
console.log('- Patient\'s LEFT appears on screen RIGHT');
console.log('- Patient\'s ANTERIOR appears on screen TOP');
console.log('- This requires flipping the X axis during display');