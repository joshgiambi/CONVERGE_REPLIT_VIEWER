import { db } from '../db';
import {
  series as seriesTable,
  seriesRegistrationRelationships,
  registrations,
  type InsertSeriesRegistrationRelationship
} from '../../shared/schema';
import { eq, and, sql } from 'drizzle-orm';
import { storage } from '../storage';
import { logger } from '../logger';
import { parseDicomRegistrationFromFile } from '../registration/reg-parser.ts';

interface RegistrationTransform {
  sourceSeriesInstanceUID: string | null;
  targetSeriesInstanceUID: string | null;
  sourceFrameOfReferenceUID: string | null;
  targetFrameOfReferenceUID: string | null;
  transformMatrix: number[][] | null;
  registrationType: string;
}

/**
 * Parse DICOM REG file to extract registration transform information
 * Now uses the proper reg-parser.ts which correctly extracts BOTH FoR UIDs
 */
function parseRegistrationFile(filePath: string): RegistrationTransform | null {
  try {
    const parsed = parseDicomRegistrationFromFile(filePath);
    if (!parsed) return null;

    // Extract Series Instance UIDs from referencedSeriesInstanceUids if available
    const referencedUIDs = parsed.referencedSeriesInstanceUids || [];
    
    return {
      sourceSeriesInstanceUID: referencedUIDs[0] || null,
      targetSeriesInstanceUID: referencedUIDs[1] || null,
      sourceFrameOfReferenceUID: parsed.sourceFrameOfReferenceUid || null,
      targetFrameOfReferenceUID: parsed.targetFrameOfReferenceUid || null,
      transformMatrix: parsed.matrixRowMajor4x4 || null,
      registrationType: 'RIGID'
    };
  } catch (error) {
    logger.warn({ error, filePath }, 'Failed to parse REG file');
    return null;
  }
}

/**
 * Process REG modality series and create registration relationships
 */
async function processREGSeries(seriesId: number): Promise<number> {
  try {
    const series = await storage.getSeriesById(seriesId);
    if (!series || series.modality !== 'REG') {
      return 0;
    }

    // Get registration images
    const images = await storage.getImagesBySeriesId(seriesId);
    if (images.length === 0) {
      logger.debug({ seriesId }, 'No images found for REG series');
      return 0;
    }

    // Parse the first REG file
    const regImage = images[0];
    const regInfo = parseRegistrationFile(regImage.filePath);

    if (!regInfo) {
      logger.debug({ seriesId }, 'Could not extract registration info from REG file');
      return 0;
    }

    // Find series by Series Instance UID (preferred) or fall back to frame of reference
    // Search PATIENT-WIDE, not just within the same study (REG files often reference cross-study)
    const study = await storage.getStudy(series.studyId);
    if (!study) {
      logger.debug({ seriesId }, 'Could not find study for REG series');
      return 0;
    }

    const patientStudies = await storage.getStudiesByPatient(study.patientId);
    const allSeriesForPatient: any[] = [];
    for (const patientStudy of patientStudies) {
      const studySeries = await storage.getSeriesByStudyId(patientStudy.id);
      allSeriesForPatient.push(...studySeries);
    }

    let relationshipsCreated = 0;
    let sourceSeries: any[] = [];
    let targetSeries: any[] = [];

    // Prefer Frame of Reference matching when both FoRs are present and different
    // This avoids matching the REG series itself, which may appear in Referenced Series
    const useFoRMatching = regInfo.sourceFrameOfReferenceUID && 
                           regInfo.targetFrameOfReferenceUID &&
                           regInfo.sourceFrameOfReferenceUID !== regInfo.targetFrameOfReferenceUID;

    if (useFoRMatching) {
      // Match by Frame of Reference (more reliable for cross-FoR registrations)
      sourceSeries = allSeriesForPatient.filter(s =>
        s.id !== seriesId &&
        s.frameOfReferenceUid === regInfo.sourceFrameOfReferenceUID
      );

      targetSeries = allSeriesForPatient.filter(s =>
        s.id !== seriesId &&
        s.frameOfReferenceUid === regInfo.targetFrameOfReferenceUID
      );
    } else {
      // Fallback: Try to find by Series Instance UID
      if (regInfo.sourceSeriesInstanceUID) {
        const found = allSeriesForPatient.find(s => s.seriesInstanceUID === regInfo.sourceSeriesInstanceUID);
        if (found) sourceSeries.push(found);
      }

      if (regInfo.targetSeriesInstanceUID) {
        const found = allSeriesForPatient.find(s => s.seriesInstanceUID === regInfo.targetSeriesInstanceUID);
        if (found) targetSeries.push(found);
      }

      // If Series UIDs didn't work, try FoR matching
      if (sourceSeries.length === 0 && regInfo.sourceFrameOfReferenceUID) {
        sourceSeries = allSeriesForPatient.filter(s =>
          s.id !== seriesId &&
          s.frameOfReferenceUid === regInfo.sourceFrameOfReferenceUID
        );
      }

      if (targetSeries.length === 0 && regInfo.targetFrameOfReferenceUID) {
        targetSeries = allSeriesForPatient.filter(s =>
          s.id !== seriesId &&
          s.frameOfReferenceUid === regInfo.targetFrameOfReferenceUID
        );
      }
    }

    // Create relationships between source and target series
    // Determine primary (usually planning CT) vs secondary (CBCT, MR, PT, etc)
    for (const target of targetSeries) {
      for (const source of sourceSeries) {
        if (source.id === target.id) continue; // Skip self-relationships

        try {
          // Determine which should be primary (typically larger image count = planning CT)
          let primaryId = target.id;
          let secondaryId = source.id;

          // If source has more images, it's likely the planning CT
          if ((source.imageCount || 0) > (target.imageCount || 0)) {
            primaryId = source.id;
            secondaryId = target.id;
          }

          // Check if relationship already exists
          const existing = await db
            .select()
            .from(seriesRegistrationRelationships)
            .where(and(
              eq(seriesRegistrationRelationships.primarySeriesId, primaryId),
              eq(seriesRegistrationRelationships.secondarySeriesId, secondaryId)
            ))
            .limit(1);

          if (existing.length === 0) {
            await db.insert(seriesRegistrationRelationships).values({
              primarySeriesId: primaryId,
              secondarySeriesId: secondaryId,
              registrationId: null,
              registrationFilePath: regImage.filePath,
              transformMatrix: null,
              inverseTransformMatrix: null,
              transformHash: null,
              relationshipType: regInfo.registrationType.toLowerCase(),
              confidenceScore: 0.95,
              registrationMethod: 'DICOM-REG',
              geometricValidationPassed: true,
              validationMetrics: { source: 'REG-file' },
            });

            relationshipsCreated++;
            logger.info({
              primarySeriesId: primaryId,
              secondarySeriesId: secondaryId,
              regSeriesId: seriesId,
              sourceFrameRef: regInfo.sourceFrameOfReferenceUID?.substring(0, 30),
              targetFrameRef: regInfo.targetFrameOfReferenceUID?.substring(0, 30)
            }, 'Created registration relationship from REG file');
          }
        } catch (error: any) {
          console.error('REG relationship creation error:', error?.message || error);
          console.error('  Target:', target.id, 'Source:', source.id);
          logger.warn({
            error: error?.message || String(error),
            errorDetails: error,
            targetId: target.id,
            sourceId: source.id
          }, 'Failed to create registration relationship');
        }
      }
    }

    // FoR-only registration: If we have FoR UIDs but no explicit series references,
    // still create relationships for all series matching those FoRs
    if (sourceSeries.length === 0 && targetSeries.length === 0) {
      if (regInfo.sourceFrameOfReferenceUID && regInfo.targetFrameOfReferenceUID) {
        logger.info({
          regSeriesId: seriesId,
          sourceFrameRef: regInfo.sourceFrameOfReferenceUID?.substring(0, 30),
          targetFrameRef: regInfo.targetFrameOfReferenceUID?.substring(0, 30)
        }, 'FoR-only registration detected (no Series Instance UIDs referenced)');

        // Find all series matching these Frame of References across the patient
        const sourceFoRSeries = allSeriesForPatient.filter(s =>
          s.id !== seriesId &&
          s.frameOfReferenceUid === regInfo.sourceFrameOfReferenceUID
        );

        const targetFoRSeries = allSeriesForPatient.filter(s =>
          s.id !== seriesId &&
          s.frameOfReferenceUid === regInfo.targetFrameOfReferenceUID
        );

        for (const target of targetFoRSeries) {
          for (const source of sourceFoRSeries) {
            if (source.id === target.id) continue;

            try {
              let primaryId = target.id;
              let secondaryId = source.id;

              if ((source.imageCount || 0) > (target.imageCount || 0)) {
                primaryId = source.id;
                secondaryId = target.id;
              }

              const existing = await db
                .select()
                .from(seriesRegistrationRelationships)
                .where(and(
                  eq(seriesRegistrationRelationships.primarySeriesId, primaryId),
                  eq(seriesRegistrationRelationships.secondarySeriesId, secondaryId)
                ))
                .limit(1);

              if (existing.length === 0) {
                await db.insert(seriesRegistrationRelationships).values({
                  primarySeriesId: primaryId,
                  secondarySeriesId: secondaryId,
                  registrationId: null,
                  registrationFilePath: regImage.filePath,
                  transformMatrix: null,
                  inverseTransformMatrix: null,
                  transformHash: null,
                  relationshipType: 'frame-of-reference',
                  confidenceScore: 0.9,
                  registrationMethod: 'DICOM-REG-FoR',
                  geometricValidationPassed: true,
                  validationMetrics: {
                    source: 'REG-file-frame-of-reference',
                    sourceFrameOfReferenceUID: regInfo.sourceFrameOfReferenceUID,
                    targetFrameOfReferenceUID: regInfo.targetFrameOfReferenceUID
                  },
                });

                relationshipsCreated++;
                logger.info({
                  primarySeriesId: primaryId,
                  secondarySeriesId: secondaryId,
                  regSeriesId: seriesId,
                  sourceFrameRef: regInfo.sourceFrameOfReferenceUID?.substring(0, 30),
                  targetFrameRef: regInfo.targetFrameOfReferenceUID?.substring(0, 30)
                }, 'Created FoR-only registration relationship');
              }
            } catch (error: any) {
              logger.warn({
                error: error?.message || String(error),
                targetId: target.id,
                sourceId: source.id
              }, 'Failed to create FoR-only registration relationship');
            }
          }
        }
      }
    }

    return relationshipsCreated;
  } catch (error) {
    logger.error({ error, seriesId }, 'Failed to process REG series');
    return 0;
  }
}

/**
 * Find and create relationships for series with shared Frame of Reference
 */
async function processSharedFrameOfReference(seriesId: number): Promise<number> {
  try {
    const series = await storage.getSeriesById(seriesId);
    if (!series || !series.frameOfReferenceUid) {
      return 0;
    }

    // Skip REG and RTSTRUCT modalities
    if (['REG', 'RTSTRUCT'].includes(series.modality?.toUpperCase() || '')) {
      return 0;
    }

    // Find all series in the same study with the same Frame of Reference
    const allSeriesInStudy = await storage.getSeriesByStudyId(series.studyId);

    const sameFORSeries = allSeriesInStudy.filter(s =>
      s.id !== seriesId &&
      s.frameOfReferenceUid === series.frameOfReferenceUid &&
      !['REG', 'RTSTRUCT'].includes(s.modality?.toUpperCase() || '')
    );

    if (sameFORSeries.length === 0) {
      return 0;
    }

    let relationshipsCreated = 0;

    // Determine primary/secondary based on modality
    // CT is usually primary, MR/PT/PET are secondary
    const isPrimaryCT = series.modality?.toUpperCase() === 'CT';

    for (const otherSeries of sameFORSeries) {
      const isOtherCT = otherSeries.modality?.toUpperCase() === 'CT';

      // Determine primary and secondary
      let primaryId: number;
      let secondaryId: number;

      if (isPrimaryCT && !isOtherCT) {
        // Current is CT, other is not - current is primary
        primaryId = series.id;
        secondaryId = otherSeries.id;
      } else if (!isPrimaryCT && isOtherCT) {
        // Other is CT, current is not - other is primary
        primaryId = otherSeries.id;
        secondaryId = series.id;
      } else {
        // Both same type - use lower ID as primary for consistency
        primaryId = Math.min(series.id, otherSeries.id);
        secondaryId = Math.max(series.id, otherSeries.id);
      }

      try {
        // Check if relationship already exists
        const existing = await db
          .select()
          .from(seriesRegistrationRelationships)
          .where(and(
            eq(seriesRegistrationRelationships.primarySeriesId, primaryId),
            eq(seriesRegistrationRelationships.secondarySeriesId, secondaryId)
          ))
          .limit(1);

        if (existing.length === 0) {
          await db.insert(seriesRegistrationRelationships).values({
            primarySeriesId: primaryId,
            secondarySeriesId: secondaryId,
            registrationId: null,
            registrationFilePath: null,
            transformMatrix: null, // Identity transform for shared FOR
            inverseTransformMatrix: null,
            transformHash: null,
            relationshipType: 'shared-frame',
            confidenceScore: 0.9,
            registrationMethod: 'frame-of-reference',
            geometricValidationPassed: true,
            validationMetrics: {
              frameOfReferenceUID: series.frameOfReferenceUid,
              method: 'shared-frame-of-reference'
            },
          });

          relationshipsCreated++;
          logger.info({
            primarySeriesId: primaryId,
            secondarySeriesId: secondaryId,
            frameOfReferenceUID: series.frameOfReferenceUid
          }, 'Created shared Frame of Reference relationship');
        }
      } catch (error) {
        logger.warn({ error, primaryId, secondaryId }, 'Failed to create shared FOR relationship');
      }
    }

    return relationshipsCreated;
  } catch (error) {
    logger.error({ error, seriesId }, 'Failed to process shared Frame of Reference');
    return 0;
  }
}

/**
 * Process a series to create all applicable registration relationships
 * Should be called after a series is created during DICOM import
 */
export async function processSeriesRegistrationRelationships(seriesId: number): Promise<void> {
  try {
    logger.info({ seriesId }, 'Processing series for registration relationships');

    let totalCreated = 0;

    // 1. If REG modality, parse and create relationships
    const regCount = await processREGSeries(seriesId);
    totalCreated += regCount;

    // 2. Find series with shared Frame of Reference
    const forCount = await processSharedFrameOfReference(seriesId);
    totalCreated += forCount;

    if (totalCreated > 0) {
      logger.info({ seriesId, relationshipsCreated: totalCreated }, 'Completed registration relationship processing');
    }
  } catch (error) {
    logger.error({ error, seriesId }, 'Failed to process series registration relationships');
  }
}

/**
 * Batch process all series in a study to create registration relationships
 * Useful for reprocessing existing data
 */
export async function processStudyRegistrationRelationships(studyId: number): Promise<number> {
  try {
    logger.info({ studyId }, 'Processing study for registration relationships');

    const allSeries = await storage.getSeriesByStudyId(studyId);
    let totalCreated = 0;

    // First process all REG series
    const regSeries = allSeries.filter(s => s.modality?.toUpperCase() === 'REG');
    for (const series of regSeries) {
      const count = await processREGSeries(series.id);
      totalCreated += count;
    }

    // Then process all non-REG series for shared Frame of Reference
    const nonRegSeries = allSeries.filter(s =>
      s.modality?.toUpperCase() !== 'REG' &&
      s.modality?.toUpperCase() !== 'RTSTRUCT'
    );
    for (const series of nonRegSeries) {
      const count = await processSharedFrameOfReference(series.id);
      totalCreated += count;
    }

    logger.info({ studyId, relationshipsCreated: totalCreated }, 'Completed study registration relationship processing');
    return totalCreated;
  } catch (error) {
    logger.error({ error, studyId }, 'Failed to process study registration relationships');
    return 0;
  }
}

/**
 * Batch process all series for a patient
 */
export async function processPatientRegistrationRelationships(patientId: number): Promise<number> {
  try {
    logger.info({ patientId }, 'Processing patient for registration relationships');

    const studies = await storage.getStudiesByPatient(patientId);
    let totalCreated = 0;

    for (const study of studies) {
      const count = await processStudyRegistrationRelationships(study.id);
      totalCreated += count;
    }

    logger.info({ patientId, relationshipsCreated: totalCreated }, 'Completed patient registration relationship processing');
    return totalCreated;
  } catch (error) {
    logger.error({ error, patientId }, 'Failed to process patient registration relationships');
    return 0;
  }
}

/**
 * Clear all registration relationships for a series
 */
export async function clearSeriesRegistrationRelationships(seriesId: number): Promise<void> {
  await db.delete(seriesRegistrationRelationships)
    .where(
      sql`${seriesRegistrationRelationships.primarySeriesId} = ${seriesId} OR ${seriesRegistrationRelationships.secondarySeriesId} = ${seriesId}`
    );
}