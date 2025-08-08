// Test the brush tool polygon union functionality
import { polygonUnion } from './client/src/lib/polygon-union.js';

// Create three overlapping circles
function createCircle(centerX, centerY, radius, z = 0) {
  const points = [];
  const segments = 32;
  
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * 2 * Math.PI;
    points.push(
      centerX + radius * Math.cos(angle),
      centerY + radius * Math.sin(angle),
      z
    );
  }
  
  return points;
}

// Test case: Three overlapping circles
const circle1 = createCircle(100, 100, 10, 0);
const circle2 = createCircle(105, 100, 10, 0); // 5mm to the right
const circle3 = createCircle(110, 100, 10, 0); // 10mm to the right

console.log('Testing Eclipse TPS-style brush tool polygon union:');
console.log('Circle 1: Center (100,100), Radius 10mm');
console.log('Circle 2: Center (105,100), Radius 10mm - overlaps with Circle 1');
console.log('Circle 3: Center (110,100), Radius 10mm - overlaps with Circle 2');

// Test the union
try {
  const unionResult = polygonUnion([circle1, circle2, circle3]);
  
  console.log('\n✓ Union completed successfully!');
  console.log(`Result polygon has ${unionResult.length / 3} points`);
  
  // Check if result makes sense
  if (unionResult.length > 0) {
    // Find bounds
    let minX = Infinity, maxX = -Infinity;
    for (let i = 0; i < unionResult.length; i += 3) {
      minX = Math.min(minX, unionResult[i]);
      maxX = Math.max(maxX, unionResult[i]);
    }
    
    console.log(`\nBounding box X: ${minX.toFixed(1)} to ${maxX.toFixed(1)}`);
    console.log(`Expected width: ~30mm (3 circles of 10mm radius each with overlap)`);
    console.log(`Actual width: ${(maxX - minX).toFixed(1)}mm`);
    
    if (maxX - minX > 25 && maxX - minX < 35) {
      console.log('\n✅ SUCCESS: Circles merged correctly into single boundary!');
    }
  }
} catch (error) {
  console.error('❌ Error during union:', error.message);
}