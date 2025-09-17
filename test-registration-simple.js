#!/usr/bin/env node

/**
 * Simple Registration Resolution Test
 * 
 * Tests the registration/resolve endpoint with known series IDs from the data
 */

import fs from 'fs';

const SERVER_URL = 'http://localhost:3000';

async function testRegistrationResolution() {
  console.log('🐟 FUSION: Starting Simple Registration Resolution Test');
  console.log('=' .repeat(60));

  // Known series IDs from the API response we saw earlier
  const testCases = [
    // Patient 21 - CT and PET series
    { primary: 53, secondary: 51, type: 'CT-PET', description: 'CT (53) -> PET (51)' },
    { primary: 54, secondary: 51, type: 'CT-PET', description: 'CT (54) -> PET (51)' },
    
    // Patient 18 - CT and PET series  
    { primary: 37, secondary: 38, type: 'CT-PET', description: 'CTAC (37) -> PET (38)' },
    { primary: 36, secondary: 38, type: 'CT-PET', description: 'CT Contrast (36) -> PET (38)' },
    
    // Patient 17 - CT and PET series
    { primary: 33, secondary: 34, type: 'CT-PET', description: 'CT (33) -> PET (34)' },
    
    // CT-CT tests (same patient, different CT series)
    { primary: 53, secondary: 54, type: 'CT-CT', description: 'CT (53) -> CT (54)' },
    { primary: 36, secondary: 37, type: 'CT-CT', description: 'CT Contrast (36) -> CTAC (37)' },
  ];

  const results = {
    totalTests: testCases.length,
    successful: 0,
    failed: 0,
    tests: [],
    frameOfReferenceAnalysis: {},
    matrixAnalysis: {},
    inconsistencies: []
  };

  console.log(`🐟 FUSION: Running ${testCases.length} test cases`);

  for (const testCase of testCases) {
    console.log(`\n🐟 FUSION: Testing ${testCase.description}`);
    
    try {
      const url = `${SERVER_URL}/api/registration/resolve?primarySeriesId=${testCase.primary}&secondarySeriesId=${testCase.secondary}`;
      console.log(`    🐟 FUSION: Fetching ${url}`);
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Node.js Test Client'
        }
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.log(`  ❌ HTTP ${response.status}: ${errorText}`);
        results.failed++;
        results.tests.push({
          ...testCase,
          success: false,
          error: `HTTP ${response.status}: ${errorText}`,
          timestamp: new Date().toISOString()
        });
        continue;
      }

      const result = await response.json();
      results.successful++;
      
      console.log(`  ✅ Success`);
      console.log(`    🐟 FUSION: Source FoR: ${result.sourceFoR || 'unknown'}`);
      console.log(`    🐟 FUSION: Target FoR: ${result.targetFoR || 'unknown'}`);
      console.log(`    🐟 FUSION: Matrix present: ${result.matrixRowMajor4x4 ? 'yes' : 'no'}`);
      console.log(`    🐟 FUSION: Is identity: ${isIdentityMatrix(result.matrixRowMajor4x4) ? 'yes' : 'no'}`);
      console.log(`    🐟 FUSION: Referenced series: ${(result.referencedSeriesInstanceUids || []).length}`);
      console.log(`    🐟 FUSION: Notes: ${(result.notes || []).join(', ')}`);

      const testResult = {
        ...testCase,
        success: true,
        result,
        timestamp: new Date().toISOString()
      };
      results.tests.push(testResult);

      // Analyze Frame of Reference consistency
      if (result.sourceFoR && result.targetFoR) {
        const forKey = `${result.sourceFoR}->${result.targetFoR}`;
        if (!results.frameOfReferenceAnalysis[forKey]) {
          results.frameOfReferenceAnalysis[forKey] = [];
        }
        results.frameOfReferenceAnalysis[forKey].push({
          testCase: testCase.description,
          matrix: result.matrixRowMajor4x4,
          isIdentity: isIdentityMatrix(result.matrixRowMajor4x4)
        });
      }

      // Analyze matrix types
      const matrixType = isIdentityMatrix(result.matrixRowMajor4x4) ? 'identity' : 'non-identity';
      if (!results.matrixAnalysis[testCase.type]) {
        results.matrixAnalysis[testCase.type] = { identity: 0, nonIdentity: 0 };
      }
      if (matrixType === 'identity') {
        results.matrixAnalysis[testCase.type].identity++;
      } else {
        results.matrixAnalysis[testCase.type].nonIdentity++;
      }

    } catch (error) {
      console.log(`  ❌ Error: ${error.message}`);
      results.failed++;
      results.tests.push({
        ...testCase,
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  // Test repeatability
  console.log('\n🐟 FUSION: Testing API Repeatability');
  console.log('-'.repeat(50));
  
  const successfulTests = results.tests.filter(t => t.success);
  if (successfulTests.length > 0) {
    // Test the first successful case again
    const retest = successfulTests[0];
    console.log(`🐟 FUSION: Re-testing ${retest.description}`);
    
    try {
      const url = `${SERVER_URL}/api/registration/resolve?primarySeriesId=${retest.primary}&secondarySeriesId=${retest.secondary}`;
      const response = await fetch(url);
      const result2 = await response.json();
      
      const matrix1 = JSON.stringify(retest.result.matrixRowMajor4x4);
      const matrix2 = JSON.stringify(result2.matrixRowMajor4x4);
      
      if (matrix1 === matrix2) {
        console.log(`  ✅ Consistent: Same matrix returned on retest`);
      } else {
        console.log(`  ⚠️  INCONSISTENT: Different matrix on retest!`);
        results.inconsistencies.push({
          type: 'repeatability_failure',
          testCase: retest.description,
          originalMatrix: retest.result.matrixRowMajor4x4,
          retestMatrix: result2.matrixRowMajor4x4
        });
      }
    } catch (error) {
      console.log(`  ❌ Retest failed: ${error.message}`);
    }
  }

  // Analyze results
  console.log('\n' + '='.repeat(60));
  console.log('🐟 FUSION: TEST RESULTS SUMMARY');
  console.log('='.repeat(60));
  
  console.log(`Total Tests: ${results.totalTests}`);
  console.log(`Successful: ${results.successful}`);
  console.log(`Failed: ${results.failed}`);
  console.log(`Success Rate: ${((results.successful / results.totalTests) * 100).toFixed(1)}%`);

  console.log('\n🐟 FUSION: Matrix Analysis by Test Type:');
  for (const [testType, analysis] of Object.entries(results.matrixAnalysis)) {
    console.log(`  ${testType}:`);
    console.log(`    Identity matrices: ${analysis.identity}`);
    console.log(`    Non-identity matrices: ${analysis.nonIdentity}`);
  }

  console.log('\n🐟 FUSION: Frame of Reference Analysis:');
  for (const [forPair, tests] of Object.entries(results.frameOfReferenceAnalysis)) {
    console.log(`  ${forPair}: ${tests.length} tests`);
    
    // Check matrix consistency within same FoR pair
    const matrices = tests.map(t => JSON.stringify(t.matrix));
    const uniqueMatrices = [...new Set(matrices)];
    
    if (uniqueMatrices.length > 1) {
      console.log(`    ⚠️  INCONSISTENCY: ${uniqueMatrices.length} different matrices for same FoR pair!`);
      results.inconsistencies.push({
        type: 'frame_of_reference_matrix_mismatch',
        forPair,
        tests: tests.length,
        uniqueMatrices: uniqueMatrices.length,
        testCases: tests.map(t => t.testCase)
      });
    } else {
      console.log(`    ✅ Consistent: All tests use same matrix`);
    }
  }

  if (results.inconsistencies.length > 0) {
    console.log(`\n❌ Found ${results.inconsistencies.length} inconsistencies:`);
    results.inconsistencies.forEach((inc, i) => {
      console.log(`  ${i + 1}. ${inc.type}:`);
      console.log(`     ${JSON.stringify(inc, null, 6)}`);
    });
  } else {
    console.log('\n✅ No inconsistencies found in registration resolution logic!');
  }

  // Write results to file
  const outputFile = 'registration-resolution-test-results.json';
  fs.writeFileSync(outputFile, JSON.stringify(results, null, 2));
  console.log(`\n🐟 FUSION: Results written to ${outputFile}`);

  return results;
}

function isIdentityMatrix(matrix) {
  if (!matrix || matrix.length !== 16) return false;
  
  const identity = [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1
  ];
  
  const tolerance = 1e-6;
  for (let i = 0; i < 16; i++) {
    if (Math.abs(matrix[i] - identity[i]) > tolerance) {
      return false;
    }
  }
  return true;
}

// Run the test
if (import.meta.url === `file://${process.argv[1]}`) {
  testRegistrationResolution()
    .then(results => {
      console.log('\n🐟 FUSION: Test completed successfully');
      process.exit(results.inconsistencies.length > 0 ? 1 : 0);
    })
    .catch(error => {
      console.error('❌ Test failed:', error);
      process.exit(1);
    });
}

export { testRegistrationResolution };
