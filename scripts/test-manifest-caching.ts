#!/usr/bin/env tsx
/**
 * Test Manifest Multi-Secondary Caching
 * 
 * Tests that /api/fusion/manifest properly caches when:
 * - Same primarySeriesId
 * - Same secondarySeriesIds (both A and B)
 * 
 * And rebuilds when:
 * - Different secondarySeriesIds
 * - Subset/superset of cached IDs
 * 
 * Track A - Agent 5A
 * Created: 2025-10-02
 */

const BASE_URL = process.env.API_URL || 'http://localhost:3000';

interface ManifestResponse {
  primarySeriesId: number;
  secondaries: Array<{
    secondarySeriesId: number;
    status: 'idle' | 'loading' | 'ready' | 'error';
  }>;
  cached?: boolean;
}

async function fetchManifest(primarySeriesId: number, secondarySeriesIds: number[]): Promise<ManifestResponse> {
  const url = `${BASE_URL}/api/fusion/manifest?primarySeriesId=${primarySeriesId}&secondarySeriesIds=${secondarySeriesIds.join(',')}`;
  console.log(`📡 Fetching: ${url}`);
  
  const start = Date.now();
  const response = await fetch(url);
  const elapsed = Date.now() - start;
  
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }
  
  const data = await response.json();
  console.log(`✅ Response (${elapsed}ms):`, JSON.stringify(data, null, 2));
  
  return data;
}

async function testCachingBehavior(primarySeriesId: number, secondaryA: number, secondaryB: number) {
  console.log('\n' + '='.repeat(80));
  console.log(`🧪 Testing Manifest Caching`);
  console.log(`   Primary: ${primarySeriesId}`);
  console.log(`   Secondaries: ${secondaryA}, ${secondaryB}`);
  console.log('='.repeat(80) + '\n');

  // Test 1: First call (should build manifest)
  console.log('📋 Test 1: First call (should build manifest)');
  const firstStart = Date.now();
  const first = await fetchManifest(primarySeriesId, [secondaryA, secondaryB]);
  const firstElapsed = Date.now() - firstStart;
  console.log(`⏱️  First call took: ${firstElapsed}ms\n`);

  // Test 2: Second call with same IDs (should use cache)
  console.log('📋 Test 2: Second call with same IDs (should use cache)');
  const secondStart = Date.now();
  const second = await fetchManifest(primarySeriesId, [secondaryA, secondaryB]);
  const secondElapsed = Date.now() - secondStart;
  console.log(`⏱️  Second call took: ${secondElapsed}ms\n`);

  // Verify cache was used (second call should be much faster)
  if (secondElapsed < firstElapsed * 0.5) {
    console.log(`✅ PASS: Cache likely used (${secondElapsed}ms vs ${firstElapsed}ms)`);
  } else {
    console.log(`⚠️  WARN: Cache may not have been used (${secondElapsed}ms vs ${firstElapsed}ms)`);
  }

  // Test 3: Call with only one secondary (should rebuild)
  console.log('\n📋 Test 3: Call with only one secondary (should rebuild)');
  const thirdStart = Date.now();
  const third = await fetchManifest(primarySeriesId, [secondaryA]);
  const thirdElapsed = Date.now() - thirdStart;
  console.log(`⏱️  Third call took: ${thirdElapsed}ms`);
  
  if (third.secondaries.length === 1) {
    console.log(`✅ PASS: Manifest rebuilt with only 1 secondary`);
  } else {
    console.log(`❌ FAIL: Expected 1 secondary, got ${third.secondaries.length}`);
  }

  // Test 4: Call with original IDs again (should use cache again)
  console.log('\n📋 Test 4: Call with original IDs again (should use cache)');
  const fourthStart = Date.now();
  const fourth = await fetchManifest(primarySeriesId, [secondaryA, secondaryB]);
  const fourthElapsed = Date.now() - fourthStart;
  console.log(`⏱️  Fourth call took: ${fourthElapsed}ms`);
  
  if (fourthElapsed < firstElapsed * 0.5) {
    console.log(`✅ PASS: Cache used again`);
  } else {
    console.log(`⚠️  WARN: Cache may not have been reused`);
  }

  // Test 5: Call with reversed order (should still use cache)
  console.log('\n📋 Test 5: Call with reversed order (should still use cache)');
  const fifthStart = Date.now();
  const fifth = await fetchManifest(primarySeriesId, [secondaryB, secondaryA]);
  const fifthElapsed = Date.now() - fifthStart;
  console.log(`⏱️  Fifth call took: ${fifthElapsed}ms`);
  
  if (fifthElapsed < firstElapsed * 0.5) {
    console.log(`✅ PASS: Cache used (order-independent)`);
  } else {
    console.log(`⚠️  WARN: Cache may be order-dependent`);
  }

  console.log('\n' + '='.repeat(80));
  console.log('🎉 Test Complete');
  console.log('='.repeat(80) + '\n');
}

async function findTestSeriesIds(): Promise<{ primaryId: number; secondaryA: number; secondaryB: number } | null> {
  console.log('🔍 Finding test series with fusion candidates...\n');
  
  try {
    // Get all patients
    const patientsRes = await fetch(`${BASE_URL}/api/patients`);
    if (!patientsRes.ok) return null;
    const patients = await patientsRes.json();
    
    if (!patients || patients.length === 0) {
      console.log('❌ No patients found');
      return null;
    }
    
    // Try first patient
    const patient = patients[0];
    console.log(`📁 Using patient: ${patient.id} (${patient.name})`);
    
    // Get series for patient
    const seriesRes = await fetch(`${BASE_URL}/api/patients/${patient.id}/series`);
    if (!seriesRes.ok) return null;
    const data = await seriesRes.json();
    const series = data.series || [];
    
    // Find CT series (primary)
    const ctSeries = series.find((s: any) => s.modality === 'CT');
    if (!ctSeries) {
      console.log('❌ No CT series found');
      return null;
    }
    
    console.log(`📊 Primary CT series: ${ctSeries.id} - ${ctSeries.seriesDescription}`);
    
    // Find secondary series (PET or MR)
    const petSeries = series.filter((s: any) => s.modality === 'PT' || s.modality === 'PET' || s.modality === 'MR');
    
    if (petSeries.length < 2) {
      console.log(`⚠️  Only found ${petSeries.length} secondary series (need 2 for test)`);
      if (petSeries.length === 1) {
        console.log('  Using single secondary twice (same ID)');
        return {
          primaryId: ctSeries.id,
          secondaryA: petSeries[0].id,
          secondaryB: petSeries[0].id,
        };
      }
      return null;
    }
    
    console.log(`📊 Secondary A: ${petSeries[0].id} - ${petSeries[0].seriesDescription}`);
    console.log(`📊 Secondary B: ${petSeries[1].id} - ${petSeries[1].seriesDescription}`);
    
    return {
      primaryId: ctSeries.id,
      secondaryA: petSeries[0].id,
      secondaryB: petSeries[1].id,
    };
  } catch (error) {
    console.error('❌ Error finding test series:', error);
    return null;
  }
}

async function main() {
  console.log('\n🧪 Manifest Multi-Secondary Caching Test\n');
  console.log(`Server: ${BASE_URL}\n`);
  
  // Check if manual IDs provided
  const args = process.argv.slice(2);
  if (args.length === 3) {
    const [primaryId, secondaryA, secondaryB] = args.map(Number);
    if (primaryId && secondaryA && secondaryB) {
      console.log('📝 Using manual series IDs from command line\n');
      await testCachingBehavior(primaryId, secondaryA, secondaryB);
      return;
    }
  }
  
  // Auto-discover test series
  const testIds = await findTestSeriesIds();
  if (!testIds) {
    console.log('\n❌ Could not find suitable test series');
    console.log('   Usage: tsx scripts/test-manifest-caching.ts [primaryId] [secondaryA] [secondaryB]');
    process.exit(1);
  }
  
  await testCachingBehavior(testIds.primaryId, testIds.secondaryA, testIds.secondaryB);
}

main().catch(error => {
  console.error('\n❌ Test failed:', error);
  process.exit(1);
});

