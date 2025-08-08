#!/usr/bin/env node

// Test anisotropic margin operations
console.log('Testing Anisotropic Margin Operations');
console.log('=====================================');

// Import the anisotropic margin module
import('./client/src/lib/anisotropic-margin-operations.ts')
  .then(module => {
    const { applyAnisotropicMargin, rasterizeContour, dilateRaster, erodeRaster } = module;
    
    // Test contour (simple square)
    const testContour = [
      0, 0, 0,      // Point 1: (0, 0, 0)
      10, 0, 0,     // Point 2: (10, 0, 0)
      10, 10, 0,    // Point 3: (10, 10, 0)
      0, 10, 0,     // Point 4: (0, 10, 0)
      0, 0, 0       // Close the contour
    ];
    
    console.log('\nTest 1: Simple rasterization');
    console.log('Input contour:', testContour);
    
    const rasterized = rasterizeContour(testContour, [1, 1]);
    console.log('Rasterized grid size:', rasterized.grid.length, 'x', rasterized.grid[0].length);
    console.log('Rasterized bounds:', rasterized.bounds);
    
    console.log('\nTest 2: Anisotropic margin (expand X=2mm, Y=3mm)');
    applyAnisotropicMargin(testContour, {
      marginX: 2,
      marginY: 3,
      marginZ: 0,
      pixelSpacing: [1, 1],
      sliceThickness: 3,
      interpolateSlices: false
    }).then(result => {
      console.log('Result contour points:', result.contourPoints.length / 3);
      console.log('Processing time:', result.processingTime, 'ms');
      console.log('Success!');
      
      console.log('\nTest 3: Anisotropic margin (shrink X=-1mm, Y=-1mm)');
      return applyAnisotropicMargin(testContour, {
        marginX: -1,
        marginY: -1,
        marginZ: 0,
        pixelSpacing: [1, 1],
        sliceThickness: 3,
        interpolateSlices: false
      });
    }).then(result => {
      console.log('Result contour points:', result.contourPoints.length / 3);
      console.log('Processing time:', result.processingTime, 'ms');
      console.log('Success!');
      
      console.log('\nAll tests completed successfully!');
    }).catch(error => {
      console.error('Test failed:', error);
    });
  })
  .catch(error => {
    console.error('Failed to import module:', error);
  });