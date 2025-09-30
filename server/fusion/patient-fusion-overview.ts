import fs from 'fs';
import path from 'path';
import { storage } from '../storage.ts';
import { fusionManifestService } from './manifest-service.ts';
import { findAllRegFilesForPatient } from '../registration/reg-resolver.ts';
import { parseDicomRegistrationFromFile } from '../registration/reg-parser.ts';
import { logger } from '../logger.ts';
import { seriesSelectionService, type FusionCandidate as SelectionFusionCandidate } from '../services/series-selection-service.ts';
import type { Patient, Series } from '@shared/schema';

const sanitizeForPath = (value: string | null | undefined): string => {
  if (!value) return 'unknown';
  return value.replace(/[<>:"/\\|?*]/g, '_');
};

const toIsoString = (value: unknown): string | null => {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
    return value;
  }
  return null;
};

const normalizeNumber = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const ensureString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

const uniqueStringArray = (input: unknown): string[] => {
  if (!Array.isArray(input)) return [];
  const set = new Set<string>();
  input.forEach((entry) => {
    if (typeof entry === 'string' && entry.trim().length) set.add(entry.trim());
  });
  return Array.from(set.values());
};

export interface SeriesSummary {
  id: number;
  studyId: number;
  seriesInstanceUID: string;
  seriesDescription: string | null;
  modality: string | null;
  seriesNumber: number | null;
  imageCount: number | null;
  sliceThickness?: string | null;
  createdAt: string | null;
}

export interface DerivedFusionDetails {
  primarySeriesId: number | null;
  secondarySeriesId: number | null;
  registrationId: string | null;
  transformSource: string | null;
  interpolation: string | null;
  generatedAt: string | null;
  manifestPath: string | null;
  outputDirectory: string | null;
  markers: string[];
}

export interface DerivedSeriesSummary extends SeriesSummary {
  fusion: DerivedFusionDetails;
}

export interface RegistrationSeriesSummary extends SeriesSummary {
  filePath: string | null;
  fileExists: boolean;
  referencedSeriesInstanceUIDs: string[];
  referencedSeriesIds: number[];
  parsed: {
    matrixRowMajor4x4: number[] | null;
    sourceFrameOfReferenceUid: string | null;
    targetFrameOfReferenceUid: string | null;
    notes: string[];
  } | null;
}

export type FusionAssociationStatus = 'ready' | 'pending' | 'missing-secondary' | 'unmapped' | 'excluded';

export interface FusionAssociationSummary {
  studyId: number | null;
  registrationSeriesId: number | null;
  registrationFilePath: string | null;
  registrationId: string | null;
  primarySeriesId: number | null;
  secondarySeriesId: number | null;
  derivedSeriesId: number | null;
  status: FusionAssociationStatus;
  reason?: string;
  markers: string[];
  transformSource?: string | null;
  registrationSeries: RegistrationSeriesSummary | null;
  primarySeries: SeriesSummary | null;
  secondarySeries: SeriesSummary | null;
  derivedSeries: DerivedSeriesSummary | null;
}

export interface PatientFusionOverviewDebug {
  generatedAt: string;
  fusedDirectories: Array<{ studyId: number; path: string; exists: boolean; contents: string[] }>;
  missingPaths: Array<{ seriesId: number; path: string }>;
}

export interface PatientFusionOverview {
  patient: {
    id: number;
    patientID: string | null;
    patientName: string | null;
    createdAt: string | null;
  };
  summary: {
    totalStudies: number;
    totalSeries: number;
    registrationSeries: number;
    derivedSeries: number;
  };
  studies: Array<{
    id: number;
    studyInstanceUID: string;
    studyDescription: string | null;
    studyDate: string | null;
    accessionNumber: string | null;
    modalityCounts: Record<string, number>;
    series: SeriesSummary[];
    registrationSeries: RegistrationSeriesSummary[];
    derivedSeries: DerivedSeriesSummary[];
    associations: FusionAssociationSummary[];
  }>;
  registrationSeries: RegistrationSeriesSummary[];
  derivedSeries: DerivedSeriesSummary[];
  associations: FusionAssociationSummary[];
  debug?: PatientFusionOverviewDebug;
}

const createSeriesSummary = (series: Series): SeriesSummary => ({
  id: series.id,
  studyId: series.studyId,
  seriesInstanceUID: series.seriesInstanceUID,
  seriesDescription: ensureString(series.seriesDescription),
  modality: ensureString(series.modality),
  seriesNumber: normalizeNumber(series.seriesNumber),
  imageCount: normalizeNumber(series.imageCount),
  sliceThickness: ensureString(series.sliceThickness),
  createdAt: toIsoString(series.createdAt),
});

const normalizeFusionDetails = (raw: Record<string, unknown> | undefined): DerivedFusionDetails => {
  const primarySeriesId = normalizeNumber(raw?.primarySeriesId);
  const secondarySeriesId = normalizeNumber(raw?.secondarySeriesId);
  return {
    primarySeriesId,
    secondarySeriesId,
    registrationId: ensureString(raw?.registrationId),
    transformSource: ensureString(raw?.transformSource),
    interpolation: ensureString(raw?.interpolation),
    generatedAt: toIsoString(raw?.generatedAt),
    manifestPath: ensureString(raw?.manifestPath),
    outputDirectory: ensureString(raw?.outputDirectory),
    markers: uniqueStringArray(raw?.markers).length ? uniqueStringArray(raw?.markers) : ['RESAMPLED_SUPERBEAM'],
  };
};

const makePairKey = (primary: number | null, secondary: number | null): string | null => {
  if (!Number.isFinite(primary ?? NaN) || !Number.isFinite(secondary ?? NaN)) return null;
  return `${primary}:${secondary}`;
};

interface BuildOptions {
  includeDebug?: boolean;
}

/**
 * Build patient fusion overview using seriesSelectionService for authoritative associations.
 * This ensures the frontend sees the same associations that manifest-service will process.
 */
export async function buildPatientFusionOverview(patientId: number, options: BuildOptions = {}): Promise<PatientFusionOverview> {
  if (!Number.isFinite(patientId)) {
    throw new Error('Invalid patientId provided to buildPatientFusionOverview');
  }

  const patient = await storage.getPatient(patientId);
  if (!patient) {
    throw new Error(`Patient ${patientId} not found`);
  }

  const studies = await storage.getStudiesByPatient(patientId);
  const seriesEntries = await Promise.all(
    studies.map(async (study) => ({
      study,
      series: await storage.getSeriesByStudyId(study.id),
    })),
  );

  const seriesByStudy = new Map<number, Series[]>();
  const allSeries: Series[] = [];
  seriesEntries.forEach(({ study, series }) => {
    seriesByStudy.set(study.id, series);
    allSeries.push(...series);
  });

  const seriesById = new Map<number, Series>();
  const seriesByUid = new Map<string, Series>();
  const seriesSummaryById = new Map<number, SeriesSummary>();

  allSeries.forEach((ser) => {
    seriesById.set(ser.id, ser);
    if (ser.seriesInstanceUID) seriesByUid.set(ser.seriesInstanceUID, ser);
    seriesSummaryById.set(ser.id, createSeriesSummary(ser));
  });

  // Collect derived series
  const derivedSummaries: DerivedSeriesSummary[] = [];
  const derivedByPair = new Map<string, DerivedSeriesSummary>();
  const derivedSeriesIds = new Set<number>();

  allSeries.forEach((series) => {
    const summary = seriesSummaryById.get(series.id);
    if (!summary) return;

    const metadata = (series.metadata ?? {}) as Record<string, unknown>;
    const fusionMeta = metadata?.fusion as Record<string, unknown> | undefined;
    if (fusionMeta && typeof fusionMeta === 'object') {
      const derived: DerivedSeriesSummary = {
        ...summary,
        fusion: normalizeFusionDetails(fusionMeta),
      };
      derivedSummaries.push(derived);
      const key = makePairKey(derived.fusion.primarySeriesId, derived.fusion.secondarySeriesId);
      if (key) derivedByPair.set(key, derived);
      derivedSeriesIds.add(series.id);
    }
  });

  // Collect REG series for reference
  const registrationSeriesCandidates: Array<{ series: Series; summary: SeriesSummary }> = [];
  allSeries.forEach((series) => {
    if ((series.modality || '').toUpperCase() === 'REG') {
      const summary = seriesSummaryById.get(series.id);
      if (summary) {
        registrationSeriesCandidates.push({ series, summary });
      }
    }
  });

  const regFileRecords = await findAllRegFilesForPatient(patientId);
  const regFileMap = new Map<number, string>();
  regFileRecords.forEach((record) => {
    if (record.seriesId && record.filePath) {
      regFileMap.set(record.seriesId, record.filePath);
    }
  });

  // Build registration series summaries
  const registrationSummaries: RegistrationSeriesSummary[] = await Promise.all(
    registrationSeriesCandidates.map(async ({ series, summary }) => {
      let filePath = regFileMap.get(series.id) ?? null;
      if (!filePath) {
        try {
          const images = await storage.getImagesBySeriesId(series.id);
          filePath = images?.[0]?.filePath ?? null;
        } catch (err) {
          logger.warn({ err }, `Failed to resolve image for REG series ${series.id}`);
        }
      }

      const fileExists = filePath ? fs.existsSync(filePath) : false;
      let parsed = null as ReturnType<typeof parseDicomRegistrationFromFile> | null;
      if (filePath && fileExists) {
        try {
          parsed = parseDicomRegistrationFromFile(filePath);
        } catch (err) {
          logger.warn({ err }, `Failed to parse REG file ${filePath}`);
        }
      }

      const referencedUidSet = new Set<string>();
      if (parsed?.referencedSeriesInstanceUids?.length) {
        parsed.referencedSeriesInstanceUids.forEach((uid) => {
          if (uid) referencedUidSet.add(uid);
        });
      }
      if (parsed?.candidates?.length) {
        parsed.candidates.forEach((candidate) => {
          candidate.referenced?.forEach((uid) => {
            if (uid) referencedUidSet.add(uid);
          });
        });
      }

      const referencedSeriesIds = Array.from(referencedUidSet.values())
        .map((uid) => seriesByUid.get(uid)?.id)
        .filter((id): id is number => Number.isFinite(id));

      const filteredReferencedUids = Array.from(referencedUidSet.values());

      return {
        ...summary,
        filePath,
        fileExists,
        referencedSeriesInstanceUIDs: filteredReferencedUids,
        referencedSeriesIds,
        parsed: parsed
          ? {
              matrixRowMajor4x4: Array.isArray(parsed.matrixRowMajor4x4) ? parsed.matrixRowMajor4x4 : null,
              sourceFrameOfReferenceUid: ensureString(parsed.sourceFrameOfReferenceUid),
              targetFrameOfReferenceUid: ensureString(parsed.targetFrameOfReferenceUid),
              notes: Array.isArray(parsed.notes) ? parsed.notes.filter((note): note is string => typeof note === 'string') : [],
            }
          : null,
      } satisfies RegistrationSeriesSummary;
    }),
  );

  // Build associations using seriesSelectionService - this is the authoritative source
  const associations: FusionAssociationSummary[] = [];
  const associationKeySet = new Set<string>();
  const associationsByStudy = new Map<number, FusionAssociationSummary[]>();

  const addAssociation = (association: FusionAssociationSummary) => {
    const key = [
      association.studyId ?? 'null',
      association.primarySeriesId ?? 'null',
      association.secondarySeriesId ?? 'null',
    ].join('|');
    if (associationKeySet.has(key)) return;
    associationKeySet.add(key);
    associations.push(association);
    if (Number.isFinite(association.studyId ?? NaN)) {
      const sid = Number(association.studyId);
      const list = associationsByStudy.get(sid) ?? [];
      list.push(association);
      associationsByStudy.set(sid, list);
    }
  };

  // Helper to check if a CT shares Frame of Reference with any PT series
  const sharesFoRWithPT = async (ctSeriesId: number, frameOfReferenceUid: string | null): Promise<boolean> => {
    if (!frameOfReferenceUid) return false;
    
    // Check if any PT series in this patient shares the same FoR
    const ptSeries = allSeries.filter(
      (s) => 
        (s.modality === 'PT' || s.modality === 'PET' || s.modality === 'NM') &&
        s.frameOfReferenceUid === frameOfReferenceUid
    );
    
    return ptSeries.length > 0;
  };

  // For each study, first check for excluded CTs, then get planning CT and fusion candidates
  for (const study of studies) {
    try {
      // Get all CT series in this study
      const studySeries = seriesByStudy.get(study.id) ?? [];
      const ctSeries = studySeries.filter((s) => s.modality === 'CT');
      
      // Check each CT for exclusion criteria (shares FoR with PT)
      for (const ct of ctSeries) {
        const sharesFoR = await sharesFoRWithPT(ct.id, ct.frameOfReferenceUid);
        if (sharesFoR) {
          // This CT shares FoR with PET - it's a PET-CT acquisition CT, not planning
          const ctSummary = seriesSummaryById.get(ct.id);
          if (ctSummary) {
            addAssociation({
              studyId: study.id,
              registrationSeriesId: null,
              registrationFilePath: null,
              registrationId: null,
              primarySeriesId: ct.id,
              secondarySeriesId: null,
              derivedSeriesId: null,
              status: 'excluded',
              reason: 'PET-CT acquisition CT (shares Frame of Reference with PET scan)',
              markers: ['EXCLUDED', 'PET-CT'],
              transformSource: null,
              registrationSeries: null,
              primarySeries: ctSummary,
              secondarySeries: null,
              derivedSeries: null,
            });
          }
        }
      }
      
      const planningResult = await seriesSelectionService.selectPlanningCT(study.id);
      if (!planningResult) continue;

      const primarySeriesId = planningResult.series.id;
      const primarySummary = seriesSummaryById.get(primarySeriesId);
      if (!primarySummary) continue;

      // Get fusion candidates - this is what manifest-service will use
      const fusionCandidates: SelectionFusionCandidate[] = planningResult.fusionCandidates;

      // Find relevant registration series
      const relevantRegSeries = registrationSummaries.find((reg) => {
        return reg.referencedSeriesIds.includes(primarySeriesId);
      });

      // Create associations for each fusion candidate
      for (const candidate of fusionCandidates) {
        const secondarySeriesId = candidate.seriesId;
        const secondarySummary = seriesSummaryById.get(secondarySeriesId);
        if (!secondarySummary) continue;

        const key = makePairKey(primarySeriesId, secondarySeriesId);
        const derived = key ? derivedByPair.get(key) : undefined;

        // Determine status
        let status: FusionAssociationStatus = 'pending';
        let reason: string | undefined;
        const markers: string[] = [];
        let transformSource: string | null = null;

        if (derived) {
          status = 'ready';
          markers.push(...derived.fusion.markers);
          transformSource = derived.fusion.transformSource;
        } else if (candidate.relationshipType === 'shared-frame') {
          status = 'pending';
          reason = 'Shared frame of reference – resample pending';
          markers.push('FRAME_OF_REFERENCE');
          transformSource = 'frame-of-reference';
        } else if (candidate.relationshipType === 'rigid' || candidate.relationshipType === 'deformable') {
          status = 'pending';
          reason = `Registration available (${candidate.relationshipType}) – resample pending`;
          markers.push(candidate.relationshipType.toUpperCase());
          transformSource = 'registration';
        }

        const registrationId = derived?.fusion.registrationId ?? null;

        addAssociation({
          studyId: study.id,
          registrationSeriesId: relevantRegSeries?.id ?? null,
          registrationFilePath: relevantRegSeries?.filePath ?? null,
          registrationId,
          primarySeriesId,
          secondarySeriesId,
          derivedSeriesId: derived?.id ?? null,
          status,
          reason,
          markers,
          transformSource,
          registrationSeries: relevantRegSeries ?? null,
          primarySeries: primarySummary,
          secondarySeries: secondarySummary,
          derivedSeries: derived ?? null,
        });
      }
    } catch (err) {
      logger.error({ err, studyId: study.id }, 'Failed to build associations for study');
    }
  }

  // Add any orphaned derived series (not matched above)
  derivedSummaries.forEach((derived) => {
    const alreadyMapped = associations.some(
      (assoc) => assoc.derivedSeriesId === derived.id,
    );
    if (alreadyMapped) return;

    const primarySummary = derived.fusion.primarySeriesId ? seriesSummaryById.get(derived.fusion.primarySeriesId) : null;
    const secondarySummary = derived.fusion.secondarySeriesId ? seriesSummaryById.get(derived.fusion.secondarySeriesId) : null;

    addAssociation({
      studyId: derived.studyId,
      registrationSeriesId: null,
      registrationFilePath: null,
      registrationId: derived.fusion.registrationId,
      primarySeriesId: derived.fusion.primarySeriesId,
      secondarySeriesId: derived.fusion.secondarySeriesId,
      derivedSeriesId: derived.id,
      status: 'ready',
      markers: derived.fusion.markers,
      transformSource: derived.fusion.transformSource,
      registrationSeries: null,
      primarySeries: primarySummary,
      secondarySeries: secondarySummary,
      derivedSeries: derived,
    });
  });

  // Build study summaries
  const studySummaries = studies.map((study) => {
    const studySeries = seriesByStudy.get(study.id) ?? [];
    const seriesSummaries = studySeries
      .map((ser) => seriesSummaryById.get(ser.id))
      .filter((summary): summary is SeriesSummary => !!summary)
      .sort((a, b) => (a.seriesNumber ?? 0) - (b.seriesNumber ?? 0));

    const modalityCounts = studySeries.reduce<Record<string, number>>((acc, ser) => {
      const modality = (ser.modality || 'UNKNOWN').toUpperCase();
      acc[modality] = (acc[modality] ?? 0) + 1;
      return acc;
    }, {});

    const registrationSeriesForStudy = registrationSummaries.filter((reg) => reg.studyId === study.id);
    const derivedSeriesForStudy = derivedSummaries.filter((derived) => derived.studyId === study.id);
    const associationsForStudy = associationsByStudy.get(study.id) ?? [];

    return {
      id: study.id,
      studyInstanceUID: study.studyInstanceUID,
      studyDescription: ensureString(study.studyDescription),
      studyDate: ensureString(study.studyDate),
      accessionNumber: ensureString(study.accessionNumber),
      modalityCounts,
      series: seriesSummaries,
      registrationSeries: registrationSeriesForStudy,
      derivedSeries: derivedSeriesForStudy,
      associations: associationsForStudy,
    };
  });

  // Build debug info if requested
  let debugInfo: PatientFusionOverviewDebug | undefined;
  if (options.includeDebug) {
    const fusedDirectories: Array<{ studyId: number; path: string; exists: boolean; contents: string[] }> = [];
    const missingPaths: Array<{ seriesId: number; path: string }> = [];

    const patientIdentifier = sanitizeForPath(patient.patientID ?? String(patient.id));
    studies.forEach((study) => {
      const fusedPath = path.join('storage', 'patients', patientIdentifier, sanitizeForPath(study.studyInstanceUID), 'fused');
      let exists = false;
      let contents: string[] = [];
      try {
        exists = fs.existsSync(fusedPath);
        if (exists) contents = fs.readdirSync(fusedPath);
      } catch (err) {
        logger.warn({ err }, `Failed to inspect fused directory ${fusedPath}`);
      }
      fusedDirectories.push({ studyId: study.id, path: fusedPath, exists, contents });
    });

    registrationSummaries.forEach((reg) => {
      if (reg.filePath && !reg.fileExists) {
        missingPaths.push({ seriesId: reg.id, path: reg.filePath });
      }
    });

    derivedSummaries.forEach((derived) => {
      const dir = derived.fusion.outputDirectory;
      if (dir && !fs.existsSync(dir)) {
        missingPaths.push({ seriesId: derived.id, path: dir });
      }
    });

    debugInfo = {
      generatedAt: new Date().toISOString(),
      fusedDirectories,
      missingPaths,
    };
  }

  return {
    patient: {
      id: patient.id,
      patientID: ensureString((patient as Patient).patientID) ?? null,
      patientName: ensureString((patient as Patient).patientName) ?? null,
      createdAt: toIsoString(patient.createdAt),
    },
    summary: {
      totalStudies: studies.length,
      totalSeries: allSeries.length,
      registrationSeries: registrationSummaries.length,
      derivedSeries: derivedSummaries.length,
    },
    studies: studySummaries,
    registrationSeries: registrationSummaries,
    derivedSeries: derivedSummaries,
    associations,
    debug: debugInfo,
  };
}

export interface ClearDerivedResult {
  ok: boolean;
  deletedSeriesIds: number[];
  removedPaths: string[];
  clearedPrimarySeriesIds: number[];
}

export async function clearPatientFusionDerivedData(patientId: number): Promise<ClearDerivedResult> {
  const overview = await buildPatientFusionOverview(patientId, { includeDebug: true });
  const deletedSeriesIds: number[] = [];
  const removedPathSet = new Set<string>();
  const clearedPrimaryIds = new Set<number>();

  for (const derived of overview.derivedSeries) {
    try {
      await storage.deleteSeriesFully(derived.id);
      deletedSeriesIds.push(derived.id);
    } catch (err) {
      logger.error({ err }, `Failed to delete derived series ${derived.id}`);
    }
    if (derived.fusion.outputDirectory) removedPathSet.add(derived.fusion.outputDirectory);
    if (Number.isFinite(derived.fusion.primarySeriesId ?? NaN)) {
      clearedPrimaryIds.add(Number(derived.fusion.primarySeriesId));
    }
  }

  const patientIdentifier = sanitizeForPath(overview.patient.patientID ?? String(overview.patient.id));
  overview.studies.forEach((study) => {
    const fusedPath = path.join('storage', 'patients', patientIdentifier, sanitizeForPath(study.studyInstanceUID), 'fused');
    removedPathSet.add(fusedPath);
  });

  for (const dir of Array.from(removedPathSet.values())) {
    try {
      const absolute = path.resolve(dir);
      if (!absolute.startsWith(path.resolve('storage'))) continue;
      await fs.promises.rm(absolute, { recursive: true, force: true });
    } catch (err) {
      logger.warn({ err }, `Failed to remove directory ${dir}`);
    }
  }

  clearedPrimaryIds.forEach((seriesId) => {
    fusionManifestService.clearCache(seriesId);
  });

  return {
    ok: true,
    deletedSeriesIds,
    removedPaths: Array.from(removedPathSet.values()),
    clearedPrimarySeriesIds: Array.from(clearedPrimaryIds.values()),
  };
}