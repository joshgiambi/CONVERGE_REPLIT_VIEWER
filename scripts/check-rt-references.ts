#!/usr/bin/env tsx
/**
 * Check RT structure references in the database
 *
 * This script shows which RT structures reference which CT series,
 * helping diagnose why the wrong RT is being auto-selected.
 */

import { db } from '../server/db';
import { series } from '../shared/schema';
import { eq } from 'drizzle-orm';

async function checkRTReferences() {
  console.log('🔍 Checking RT Structure References...\n');

  // Get all RT structures
  const rtSeries = await db
    .select()
    .from(series)
    .where(eq(series.modality, 'RTSTRUCT'));

  if (rtSeries.length === 0) {
    console.log('❌ No RT structures found in database');
    return;
  }

  console.log(`Found ${rtSeries.length} RT structure(s):\n`);

  for (const rt of rtSeries) {
    console.log(`📋 RT Structure ID: ${rt.id}`);
    console.log(`   Description: ${rt.seriesDescription || 'N/A'}`);
    console.log(`   Referenced Series ID: ${rt.referencedSeriesId || 'NULL ❌'}`);
    console.log(`   Referenced Series UID: ${rt.referencedSeriesUID || 'NULL'}`);
    console.log(`   Study ID: ${rt.studyId}`);

    // If referenced series ID exists, show what it references
    if (rt.referencedSeriesId) {
      const referencedSeries = await db
        .select()
        .from(series)
        .where(eq(series.id, rt.referencedSeriesId))
        .limit(1);

      if (referencedSeries.length > 0) {
        const ref = referencedSeries[0];
        console.log(`   ✅ References: ${ref.modality} - ${ref.seriesDescription || 'N/A'}`);
      } else {
        console.log(`   ⚠️ Referenced series ${rt.referencedSeriesId} not found in database`);
      }
    } else {
      console.log(`   ❌ No referenced series set - will fallback to most recent`);
    }

    console.log('');
  }

  // Get all CT series in the same studies
  const studyIds = [...new Set(rtSeries.map(rt => rt.studyId))];
  console.log(`\n📊 CT Series in studies [${studyIds.join(', ')}]:\n`);

  for (const studyId of studyIds) {
    const ctSeries = await db
      .select()
      .from(series)
      .where(eq(series.studyId, studyId));

    const cts = ctSeries.filter(s => s.modality === 'CT');

    console.log(`Study ${studyId}:`);
    for (const ct of cts) {
      const referencingRTs = rtSeries.filter(rt => rt.referencedSeriesId === ct.id);
      console.log(`  - CT ID: ${ct.id} | ${ct.seriesDescription || 'N/A'}`);
      console.log(`    Image Count: ${ct.imageCount || 0}`);
      if (referencingRTs.length > 0) {
        console.log(`    ✅ Referenced by: ${referencingRTs.map(rt => `RT ${rt.id}`).join(', ')}`);
      } else {
        console.log(`    ⚠️ Not referenced by any RT structures`);
      }
    }
    console.log('');
  }

  // Recommendations
  console.log('\n💡 Recommendations:\n');

  const rtsWithoutRef = rtSeries.filter(rt => !rt.referencedSeriesId);
  if (rtsWithoutRef.length > 0) {
    console.log('❌ RT structures without referenced_series_id:');
    for (const rt of rtsWithoutRef) {
      console.log(`   - RT ${rt.id}: ${rt.seriesDescription || 'N/A'}`);
    }
    console.log('\n   To fix, you need to either:');
    console.log('   1. Re-import the DICOM files (they should have Referenced Series UID)');
    console.log('   2. Manually update the database with the correct CT series ID');
    console.log('\n   Example SQL to fix:');
    console.log('   UPDATE series SET referenced_series_id = <ct_id> WHERE id = <rt_id>;');
  } else {
    console.log('✅ All RT structures have referenced_series_id set');
  }
}

checkRTReferences()
  .then(() => {
    console.log('\n✅ Check complete');
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ Error:', err);
    process.exit(1);
  });