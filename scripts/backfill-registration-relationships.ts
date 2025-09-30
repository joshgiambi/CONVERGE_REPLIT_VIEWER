/**
 * Backfill Registration Relationships Script
 *
 * Processes all series in a study (or all studies) to create registration relationships
 * based on:
 * - REG modality DICOM files (spatial registration objects)
 * - Shared Frame of Reference UIDs (series in same spatial coordinate system)
 *
 * Usage: tsx scripts/backfill-registration-relationships.ts [studyId]
 */

import 'dotenv/config';
import { db } from '../server/db';
import { series } from '../shared/schema';
import { eq } from 'drizzle-orm';
import { processSeriesRegistrationRelationships } from '../server/services/registration-relationship-service';

async function backfillRegistrationRelationships(studyId?: number) {
  console.log('🔍 Starting registration relationship backfill...');

  // Get all series (optionally filtered by study)
  const whereClause = studyId ? eq(series.studyId, studyId) : undefined;
  const allSeries = whereClause
    ? await db.select().from(series).where(whereClause)
    : await db.select().from(series);

  console.log(`Found ${allSeries.length} series to process${studyId ? ` in study ${studyId}` : ''}\n`);

  let processedCount = 0;
  let errorCount = 0;

  for (const ser of allSeries) {
    try {
      await processSeriesRegistrationRelationships(ser.id);
      processedCount++;

      // Log progress for image modalities and REG
      if (['CT', 'MR', 'PT', 'NM', 'REG'].includes(ser.modality || '')) {
        console.log(`✅ Processed series ${ser.id} (${ser.modality} - ${ser.seriesDescription || 'N/A'})`);
      }
    } catch (err) {
      errorCount++;
      console.error(`❌ Error processing series ${ser.id}:`, err);
    }
  }

  console.log(`\n📊 Backfill Summary:`);
  console.log(`   ✅ Processed: ${processedCount}`);
  console.log(`   ❌ Errors: ${errorCount}`);
  console.log(`   📦 Total: ${allSeries.length}`);
  console.log(`\n✨ Backfill complete!`);

  process.exit(0);
}

// Parse command line arguments
const studyId = process.argv[2] ? parseInt(process.argv[2], 10) : undefined;

if (studyId && isNaN(studyId)) {
  console.error('❌ Invalid study ID. Usage: tsx scripts/backfill-registration-relationships.ts [studyId]');
  process.exit(1);
}

backfillRegistrationRelationships(studyId).catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});