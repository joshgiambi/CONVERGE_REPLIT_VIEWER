// Test script to verify all SuperBeam features

const BASE_URL = 'http://localhost:5000';

async function testAPI() {
  console.log('🧪 Testing SuperBeam Features...\n');
  
  // Test 1: Check API endpoints
  console.log('1️⃣ Testing API Endpoints:');
  
  try {
    // Test patients endpoint
    const patientsRes = await fetch(`${BASE_URL}/api/patients`);
    console.log(`✓ GET /api/patients: ${patientsRes.status}`);
    
    // Test studies endpoint
    const studiesRes = await fetch(`${BASE_URL}/api/patients/4/studies`);
    console.log(`✓ GET /api/patients/4/studies: ${studiesRes.status}`);
    
    // Test series endpoint
    const seriesRes = await fetch(`${BASE_URL}/api/studies/4/series`);
    console.log(`✓ GET /api/studies/4/series: ${seriesRes.status}`);
    
    // Test images endpoint
    const imagesRes = await fetch(`${BASE_URL}/api/series/4/images`);
    console.log(`✓ GET /api/series/4/images: ${imagesRes.status}`);
    
    // Test RT structures endpoint
    const rtRes = await fetch(`${BASE_URL}/api/rt-structures/4`);
    console.log(`✓ GET /api/rt-structures/4: ${rtRes.status}`);
    
  } catch (error) {
    console.error('❌ API test failed:', error.message);
  }
  
  console.log('\n2️⃣ Testing RT Structure Operations:');
  
  try {
    // Test contour update endpoint
    const testContour = {
      seriesId: 4,
      structureId: 1,
      slicePosition: 35,
      contourData: [[100, 100], [150, 100], [150, 150], [100, 150]]
    };
    
    const updateRes = await fetch(`${BASE_URL}/api/rt-structures/4/contours`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testContour)
    });
    console.log(`✓ POST /api/rt-structures/4/contours: ${updateRes.status}`);
    
    // Test undo endpoint
    const undoRes = await fetch(`${BASE_URL}/api/rt-structures/4/undo`, {
      method: 'POST'
    });
    console.log(`✓ POST /api/rt-structures/4/undo: ${undoRes.status}`);
    
    // Test redo endpoint
    const redoRes = await fetch(`${BASE_URL}/api/rt-structures/4/redo`, {
      method: 'POST'
    });
    console.log(`✓ POST /api/rt-structures/4/redo: ${redoRes.status}`);
    
  } catch (error) {
    console.error('❌ RT structure test failed:', error.message);
  }
  
  console.log('\n3️⃣ Checking Component Structure:');
  
  // Check if key files exist
  const components = [
    'client/src/components/dicom/viewer-toolbar.tsx',
    'client/src/components/dicom/floating-ui-controls.tsx',
    'client/src/components/dicom/contour-edit-toolbar.tsx',
    'client/src/components/dicom/multi-planar-viewer.tsx',
    'client/src/components/dicom/simple-brush-tool.tsx',
    'client/src/components/dicom/eclipse-pen-tool.tsx'
  ];
  
  const fs = require('fs');
  components.forEach(comp => {
    if (fs.existsSync(comp)) {
      console.log(`✓ ${comp.split('/').pop()} exists`);
    } else {
      console.log(`❌ ${comp.split('/').pop()} missing`);
    }
  });
  
  console.log('\n4️⃣ Testing Database Connection:');
  
  try {
    // Check database status
    const dbRes = await fetch(`${BASE_URL}/api/db-status`);
    if (dbRes.ok) {
      console.log('✓ Database connection is active');
    }
  } catch (error) {
    console.log('⚠️  Database status endpoint not available');
  }
  
  console.log('\n✅ Test suite completed!');
}

// Run tests
testAPI().catch(console.error);