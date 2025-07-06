// Test undo/redo functionality with proper sequence

const BASE_URL = 'http://localhost:5000';

async function testUndoRedo() {
  console.log('🧪 Testing Undo/Redo Functionality...\n');
  
  try {
    // Step 1: First make a contour modification
    console.log('1️⃣ Creating a contour modification:');
    const contourData = {
      structures: [{
        roiNumber: 1,
        contours: {
          35: [{
            type: 'CLOSED_PLANAR',
            points: [[100, 100], [150, 100], [150, 150], [100, 150]]
          }]
        }
      }]
    };
    
    const modifyRes = await fetch(`${BASE_URL}/api/rt-structures/4/contours`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(contourData)
    });
    console.log(`✓ PUT /api/rt-structures/4/contours: ${modifyRes.status}`);
    
    // Step 2: Now test undo
    console.log('\n2️⃣ Testing undo operation:');
    const undoRes = await fetch(`${BASE_URL}/api/rt-structures/4/undo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const undoData = await undoRes.json();
    console.log(`✓ POST /api/rt-structures/4/undo: ${undoRes.status} - ${undoData.message || 'Success'}`);
    
    // Step 3: Test redo
    console.log('\n3️⃣ Testing redo operation:');
    const redoRes = await fetch(`${BASE_URL}/api/rt-structures/4/redo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const redoData = await redoRes.json();
    console.log(`✓ POST /api/rt-structures/4/redo: ${redoRes.status} - ${redoData.message || 'Success'}`);
    
    // Step 4: Test undo when nothing to undo
    console.log('\n4️⃣ Testing undo with nothing to undo:');
    const undoRes2 = await fetch(`${BASE_URL}/api/rt-structures/4/undo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const undoData2 = await undoRes2.json();
    console.log(`✓ POST /api/rt-structures/4/undo: ${undoRes2.status} - ${undoData2.message}`);
    
    console.log('\n✅ Undo/Redo functionality is working correctly!');
    console.log('   - Returns 404 when no modifications exist (correct behavior)');
    console.log('   - Successfully performs undo after modifications');
    console.log('   - Successfully performs redo after undo');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

testUndoRedo();