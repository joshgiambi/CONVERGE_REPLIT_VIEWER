/**
 * Backfill Series Metadata Script
 *
 * Extracts and populates missing DICOM metadata for all series from actual DICOM files:
 * - frame_of_reference_uid (critical for fusion)
 * - spatial metadata (IOP, IPP, pixel spacing)
 * - image dimensions (rows, columns)
 * - slice thickness and spacing
 *
 * Usage: tsx scripts/backfill-series-metadata.ts [studyId]
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { db } from '../server/db';
import { series, images } from '../shared/schema';
import { eq } from 'drizzle-orm';
import dicomParser from 'dicom-parser';

interface SeriesMetadataUpdate {
  frameOfReferenceUid?: string;
  rows?: number;
  columns?: number;
  pixelSpacing?: number[];
  imageOrientationPatient?: number[];
  imagePositionPatientFirst?: number[];
  imagePositionPatientLast?: number[];
  sliceThicknessMm?: number;
  spacingBetweenSlicesMm?: number;
}

function parseDicomFile(filePath: string): SeriesMetadataUpdate | null {
  try {
    if (!fs.existsSync(filePath)) {
      console.warn(`File not found: ${filePath}`);
      return null;
    }

    const buffer = fs.readFileSync(filePath);
    const byteArray = new Uint8Array(buffer);
    const dataSet = dicomParser.parseDicom(byteArray, {});

    const getString = (tag: string): string | null => {
      try {
        return dataSet.string(tag)?.trim() || null;
      } catch {
        return null;
      }
    };

    const getNumber = (tag: string): number | null => {
      try {
        const str = dataSet.string(tag);
        if (!str) return null;
        const num = parseFloat(str.trim());
        return isNaN(num) ? null : num;
      } catch {
        return null;
      }
    };

    const getArray = (tag: string): number[] | null => {
      try {
        const str = dataSet.string(tag);
        if (!str) return null;
        const parts = str.split('\\').filter(Boolean);
        const numbers = parts.map(p => parseFloat(p.trim())).filter(n => !isNaN(n));
        return numbers.length > 0 ? numbers : null;
      } catch {
        return null;
      }
    };

    const metadata: SeriesMetadataUpdate = {};

    // Frame of Reference UID (critical for fusion)
    const forUid = getString('x00200052');
    if (forUid) metadata.frameOfReferenceUid = forUid;

    // Image dimensions
    const rows = getNumber('x00280010');
    const columns = getNumber('x00280011');
    if (rows) metadata.rows = rows;
    if (columns) metadata.columns = columns;

    // Pixel Spacing
    const pixelSpacing = getArray('x00280030');
    if (pixelSpacing && pixelSpacing.length >= 2) {
      metadata.pixelSpacing = pixelSpacing;
    }

    // Image Orientation Patient
    const iop = getArray('x00200037');
    if (iop && iop.length >= 6) {
      metadata.imageOrientationPatient = iop;
    }

    // Image Position Patient
    const ipp = getArray('x00200032');
    if (ipp && ipp.length >= 3) {
      metadata.imagePositionPatientFirst = ipp;
    }

    // Slice Thickness
    const sliceThickness = getNumber('x00180050');
    if (sliceThickness) {
      metadata.sliceThicknessMm = sliceThickness;
    }

    // Spacing Between Slices
    const spacingBetweenSlices = getNumber('x00180088');
    if (spacingBetweenSlices) {
      metadata.spacingBetweenSlicesMm = spacingBetweenSlices;
    }

    return Object.keys(metadata).length > 0 ? metadata : null;
  } catch (error) {
    console.error(`Error parsing ${filePath}:`, error instanceof Error ? error.message : error);
    return null;
  }
}

async function backfillSeriesMetadata(studyId?: number) {
  console.log('🔍 Starting series metadata backfill...');

  // Get all series (optionally filtered by study)
  const whereClause = studyId ? eq(series.studyId, studyId) : undefined;
  const allSeries = whereClause
    ? await db.select().from(series).where(whereClause)
    : await db.select().from(series);

  console.log(`Found ${allSeries.length} series to process${studyId ? ` in study ${studyId}` : ''}`);

  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const ser of allSeries) {
    try {
      // Get first and last images for this series
      const seriesImages = await db
        .select()
        .from(images)
        .where(eq(images.seriesId, ser.id))
        .orderBy(images.instanceNumber);

      if (seriesImages.length === 0) {
        console.log(`⚠️  Series ${ser.id} has no images, skipping`);
        skipped++;
        continue;
      }

      const firstImage = seriesImages[0];
      const lastImage = seriesImages[seriesImages.length - 1];

      // Parse first image to get series-level metadata
      if (!firstImage.filePath) {
        console.log(`⚠️  Series ${ser.id} first image has no file path, skipping`);
        skipped++;
        continue;
      }

      const firstMetadata = parseDicomFile(firstImage.filePath);
      if (!firstMetadata) {
        console.log(`⚠️  Could not parse metadata for series ${ser.id}`);
        skipped++;
        continue;
      }

      // Parse last image for imagePositionPatientLast
      let lastIPP = firstMetadata.imagePositionPatientFirst;
      if (lastImage.filePath && lastImage.filePath !== firstImage.filePath) {
        const lastMetadata = parseDicomFile(lastImage.filePath);
        if (lastMetadata?.imagePositionPatientFirst) {
          lastIPP = lastMetadata.imagePositionPatientFirst;
        }
      }

      // Build update object with only fields that need updating
      const updates: any = {};
      let hasUpdates = false;

      if (firstMetadata.frameOfReferenceUid && !ser.frameOfReferenceUid) {
        updates.frameOfReferenceUid = firstMetadata.frameOfReferenceUid;
        hasUpdates = true;
      }

      if (firstMetadata.rows && !ser.rows) {
        updates.rows = firstMetadata.rows;
        hasUpdates = true;
      }

      if (firstMetadata.columns && !ser.columns) {
        updates.columns = firstMetadata.columns;
        hasUpdates = true;
      }

      if (firstMetadata.pixelSpacing && !ser.pixelSpacing) {
        updates.pixelSpacing = firstMetadata.pixelSpacing;
        hasUpdates = true;
      }

      if (firstMetadata.imageOrientationPatient && !ser.imageOrientationPatient) {
        updates.imageOrientationPatient = firstMetadata.imageOrientationPatient;
        hasUpdates = true;
      }

      if (firstMetadata.imagePositionPatientFirst && !ser.imagePositionPatientFirst) {
        updates.imagePositionPatientFirst = firstMetadata.imagePositionPatientFirst;
        hasUpdates = true;
      }

      if (lastIPP && !ser.imagePositionPatientLast) {
        updates.imagePositionPatientLast = lastIPP;
        hasUpdates = true;
      }

      if (firstMetadata.sliceThicknessMm && !ser.sliceThicknessMm) {
        updates.sliceThicknessMm = firstMetadata.sliceThicknessMm;
        hasUpdates = true;
      }

      if (firstMetadata.spacingBetweenSlicesMm && !ser.spacingBetweenSlicesMm) {
        updates.spacingBetweenSlicesMm = firstMetadata.spacingBetweenSlicesMm;
        hasUpdates = true;
      }

      if (hasUpdates) {
        await db
          .update(series)
          .set(updates)
          .where(eq(series.id, ser.id));

        console.log(`✅ Updated series ${ser.id} (${ser.modality} - ${ser.seriesDescription || 'No description'})`);
        if (updates.frameOfReferenceUid) {
          console.log(`   └─ Frame of Reference: ${updates.frameOfReferenceUid}`);
        }
        updated++;
      } else {
        skipped++;
      }
    } catch (error) {
      console.error(`❌ Error processing series ${ser.id}:`, error instanceof Error ? error.message : error);
      errors++;
    }
  }

  console.log('\n📊 Backfill Summary:');
  console.log(`   ✅ Updated: ${updated}`);
  console.log(`   ⏭️  Skipped: ${skipped}`);
  console.log(`   ❌ Errors: ${errors}`);
  console.log(`   📦 Total: ${allSeries.length}`);
}

// Run the script
const studyIdArg = process.argv[2];
const studyId = studyIdArg ? parseInt(studyIdArg) : undefined;

if (studyIdArg && isNaN(studyId!)) {
  console.error('❌ Invalid study ID. Usage: tsx scripts/backfill-series-metadata.ts [studyId]');
  process.exit(1);
}

backfillSeriesMetadata(studyId)
  .then(() => {
    console.log('\n✨ Backfill complete!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Backfill failed:', error);
    process.exit(1);
  });