#!/usr/bin/env node

// Test anisotropic margin operations
import { applyAnisotropicMargin } from './client/src/lib/anisotropic-margin-operations';

async function run() {
  console.log('Testing Anisotropic Margin Operations');
  console.log('=====================================');

  // Test contour (simple square)
  const testContour = [
    0, 0, 0,
    10, 0, 0,
    10, 10, 0,
    0, 10, 0,
    0, 0, 0
  ];

  console.log('\nTest 1: Anisotropic margin (expand X=2mm, Y=3mm)');
  const expandResult = await applyAnisotropicMargin(testContour, {
    marginX: 2,
    marginY: 3,
    marginZ: 0,
    pixelSpacing: [1, 1],
    sliceThickness: 3,
    interpolateSlices: false
  });
  console.log('Result contour points:', expandResult.contourPoints.length / 3);
  console.log('Processing time:', expandResult.processingTime, 'ms');

  console.log('\nTest 2: Anisotropic margin (shrink X=-1mm, Y=-1mm)');
  const shrinkResult = await applyAnisotropicMargin(testContour, {
    marginX: -1,
    marginY: -1,
    marginZ: 0,
    pixelSpacing: [1, 1],
    sliceThickness: 3,
    interpolateSlices: false
  });
  console.log('Result contour points:', shrinkResult.contourPoints.length / 3);
  console.log('Processing time:', shrinkResult.processingTime, 'ms');

  console.log('\nAll tests completed successfully!');
}

run().catch(err => {
  console.error('Test failed:', err);
});
