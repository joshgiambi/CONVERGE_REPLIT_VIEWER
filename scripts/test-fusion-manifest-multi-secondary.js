#!/usr/bin/env node
/**
 * Regression test for fusion manifest multi-secondary validation
 * 
 * Tests that the .every() check in manifest-service.ts:178 properly validates
 * ALL requested secondary series are present in cache.
 * 
 * Usage:
 *   node scripts/test-fusion-manifest-multi-secondary.js
 * 
 * Prerequisites:
 *   - Server running on localhost:3000
 *   - Test patient with CT primary + multiple fusion candidates (PET, MRI, etc.)
 */

const BASE_URL = process.env.API_URL || 'http://localhost:3000';

async function testManifest(testName, primaryId, secondaryIds, expectedStatus, expectedSecondaryCount) {
  const url = `${BASE_URL}/api/fusion/manifest?primarySeriesId=${primaryId}&secondarySeriesIds=${secondaryIds.join(',')}`;
  
  try {
    const response = await fetch(url);
    const data = await response.json();
    
    const statusMatch = response.status === expectedStatus;
    const countMatch = !expectedSecondaryCount || (data.secondaries?.length === expectedSecondaryCount);
    const pass = statusMatch && countMatch;
    
    console.log(`\n${pass ? '✅' : '❌'} ${testName}`);
    console.log(`   URL: ${url}`);
    console.log(`   Status: ${response.status} (expected ${expectedStatus})`);
    console.log(`   Secondaries: ${data.secondaries?.length || 0} (expected ${expectedSecondaryCount || 'any'})`);
    
    if (!pass) {
      console.log(`   Response:`, JSON.stringify(data, null, 2));
    }
    
    return pass;
  } catch (err) {
    console.log(`\n❌ ${testName}`);
    console.log(`   Error: ${err.message}`);
    return false;
  }
}

async function checkDebugEvents(source = 'fusion-manifest', limit = 10) {
  try {
    const response = await fetch(`${BASE_URL}/api/debug/events?source=${source}&limit=${limit}`);
    const events = await response.json();
    console.log(`\n📊 Recent ${source} events:`);
    events.slice(0, 5).forEach(event => {
      console.log(`   [${event.level}] ${event.message}`);
    });
  } catch (err) {
    console.log(`\n⚠️  Could not fetch debug events: ${err.message}`);
  }
}

async function main() {
  console.log('🧪 Testing Fusion Manifest Multi-Secondary Validation\n');
  console.log('ℹ️  Update PRIMARY_ID, SECONDARY_IDs below with real data from your database\n');
  
  // TODO: Replace these with actual series IDs from your test data
  // Find valid IDs by querying: SELECT id FROM series WHERE modality IN ('CT', 'PET', 'MR') LIMIT 5;
  const PRIMARY_ID = 123;        // CT series
  const VALID_SECONDARY_1 = 456; // PET series
  const VALID_SECONDARY_2 = 789; // MRI series
  const INVALID_ID = 999999;     // Non-existent series
  
  const results = [];
  
  // Test 1: Single secondary (baseline)
  results.push(await testManifest(
    'Single valid secondary',
    PRIMARY_ID,
    [VALID_SECONDARY_1],
    200,
    1
  ));
  
  // Test 2: Multiple valid secondaries (main test for .every() fix)
  results.push(await testManifest(
    'Multiple valid secondaries',
    PRIMARY_ID,
    [VALID_SECONDARY_1, VALID_SECONDARY_2],
    200,
    2
  ));
  
  // Test 3: Mixed valid/invalid (should filter or reject)
  results.push(await testManifest(
    'Mixed valid/invalid secondaries',
    PRIMARY_ID,
    [VALID_SECONDARY_1, INVALID_ID],
    200, // May be 200 with filtering or 400, depending on implementation
    null // Count varies based on filtering strategy
  ));
  
  // Test 4: Cache hit - request same secondaries twice
  console.log('\n⏳ Requesting same manifest again (should hit cache)...');
  results.push(await testManifest(
    'Cache hit with multiple secondaries',
    PRIMARY_ID,
    [VALID_SECONDARY_1, VALID_SECONDARY_2],
    200,
    2
  ));
  
  // Show debug events
  await checkDebugEvents('fusion-manifest', 20);
  
  // Summary
  const passed = results.filter(Boolean).length;
  const total = results.length;
  console.log(`\n${'='.repeat(60)}`);
  console.log(`📊 Results: ${passed}/${total} tests passed`);
  console.log(`${'='.repeat(60)}\n`);
  
  if (passed === total) {
    console.log('✅ All tests passed! Multi-secondary validation working correctly.\n');
    process.exit(0);
  } else {
    console.log('❌ Some tests failed. Check manifest-service.ts:178 .every() logic.\n');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

