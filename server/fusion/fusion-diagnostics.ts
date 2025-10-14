/**
 * Fusion System Diagnostics
 *
 * Comprehensive diagnostic tool that checks all aspects of the fusion system
 * and returns a detailed report.
 */

import { db } from '../db';
import { series, seriesRegistrationRelationships } from '../../shared/schema';
import { eq, inArray, or } from 'drizzle-orm';

export async function getFusionDiagnostics(studyId: number) {
  const report: any = {
    studyId,
    timestamp: new Date().toISOString(),
    checks: {},
    problems: [],
    recommendations: [],
  };

  try {
    // 1. Get all series in study
    const allSeries = await db
      .select()
      .from(series)
      .where(eq(series.studyId, studyId));

    report.checks.totalSeries = allSeries.length;

    // 2. Count by modality
    const modalityCounts: Record<string, number> = {};
    allSeries.forEach(s => {
      const mod = s.modality || 'UNKNOWN';
      modalityCounts[mod] = (modalityCounts[mod] || 0) + 1;
    });
    report.checks.modalityCounts = modalityCounts;

    // 3. Identify fusion candidates
    const fusionModalities = ['MR', 'PT', 'PET', 'NM'];
    const ctSeries = allSeries.filter(s => s.modality === 'CT');
    const mrPtSeries = allSeries.filter(s => fusionModalities.includes(s.modality?.toUpperCase() || ''));

    report.checks.ctSeriesCount = ctSeries.length;
    report.checks.mrPtSeriesCount = mrPtSeries.length;
    report.checks.ctSeries = ctSeries.map(s => ({
      id: s.id,
      description: s.seriesDescription,
      images: s.imageCount,
    }));
    report.checks.mrPtSeries = mrPtSeries.map(s => ({
      id: s.id,
      modality: s.modality,
      description: s.seriesDescription,
      images: s.imageCount,
    }));

    // 4. Check registration relationships
    const seriesIds = allSeries.map(s => s.id);
    const relationships = await db
      .select()
      .from(seriesRegistrationRelationships)
      .where(
        or(
          inArray(seriesRegistrationRelationships.primarySeriesId, seriesIds),
          inArray(seriesRegistrationRelationships.secondarySeriesId, seriesIds)
        )
      );

    report.checks.registrationRelationshipsCount = relationships.length;
    report.checks.relationships = relationships.map(r => ({
      primary: r.primarySeriesId,
      secondary: r.secondarySeriesId,
      method: r.registrationMethod,
      type: r.relationshipType,
    }));

    // 5. Check for REG files
    const regSeries = allSeries.filter(s => s.modality === 'REG');
    report.checks.regFilesCount = regSeries.length;

    // 6. Check Frame of Reference UIDs
    const frameOfRefGroups: Record<string, number[]> = {};
    allSeries.forEach(s => {
      if (s.frameOfReferenceUID) {
        if (!frameOfRefGroups[s.frameOfReferenceUID]) {
          frameOfRefGroups[s.frameOfReferenceUID] = [];
        }
        frameOfRefGroups[s.frameOfReferenceUID].push(s.id);
      }
    });
    report.checks.frameOfReferenceGroups = Object.entries(frameOfRefGroups).map(([uid, ids]) => ({
      uid,
      seriesCount: ids.length,
      seriesIds: ids,
    }));

    // 7. Identify problems
    if (mrPtSeries.length > 0 && relationships.length === 0) {
      report.problems.push({
        severity: 'ERROR',
        message: 'MR/PT series exist but no registration relationships found',
        impact: 'Fusion candidates will not appear in sidebar',
      });

      report.recommendations.push({
        action: 'Process registration relationships',
        command: `POST /api/studies/${studyId}/process-registration-relationships`,
        reason: 'This will analyze REG files and Frame of Reference UIDs to create relationships',
      });
    }

    if (mrPtSeries.length === 0) {
      report.problems.push({
        severity: 'INFO',
        message: 'No MR/PT/PET series found in this study',
        impact: 'No fusion candidates available',
      });
    }

    if (ctSeries.length === 0) {
      report.problems.push({
        severity: 'WARNING',
        message: 'No CT series found in this study',
        impact: 'Cannot use as fusion primary',
      });
    }

    if (regSeries.length === 0 && Object.keys(frameOfRefGroups).length <= 1) {
      report.problems.push({
        severity: 'WARNING',
        message: 'No REG files and all series share same Frame of Reference',
        impact: 'Registration relationships may not be automatically created',
      });
    }

    // 8. Summary
    report.summary = {
      canFuse: ctSeries.length > 0 && mrPtSeries.length > 0,
      hasRelationships: relationships.length > 0,
      needsProcessing: mrPtSeries.length > 0 && relationships.length === 0,
    };

  } catch (error: any) {
    report.error = error.message;
    report.stack = error.stack;
  }

  return report;
}

export async function getPatientFusionDiagnostics(patientId: number) {
  const report: any = {
    patientId,
    timestamp: new Date().toISOString(),
    studies: [],
  };

  try {
    // Get all series for this patient
    const patientSeries = await db
      .select()
      .from(series)
      .where(eq(series.patientId, patientId));

    const studyIds = [...new Set(patientSeries.map(s => s.studyId))];

    for (const studyId of studyIds) {
      const studyReport = await getFusionDiagnostics(studyId);
      report.studies.push(studyReport);
    }

    report.summary = {
      totalStudies: studyIds.length,
      totalSeries: patientSeries.length,
      studiesWithFusion: report.studies.filter((s: any) => s.summary?.canFuse).length,
      studiesNeedingProcessing: report.studies.filter((s: any) => s.summary?.needsProcessing).length,
    };

  } catch (error: any) {
    report.error = error.message;
    report.stack = error.stack;
  }

  return report;
}