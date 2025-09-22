import fs from 'fs';
import path from 'path';
import { storage } from '../storage.ts';
import { fusionManifestService } from './manifest-service.ts';
import { parseMinimalDicomMeta } from './fusebox.ts';
import { findAllRegFilesForPatient } from '../registration/reg-resolver.ts';
import { parseDicomRegistrationFromFile } from '../registration/reg-parser.ts';
import { logger } from '../logger.ts';
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

const normalizeModality = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value.trim().toUpperCase();
};

const modalityPriority = (modality: string): number => {
  switch (modality) {
    case 'CT':
      return 0;
    case 'MR':
      return 1;
    case 'PT':
    case 'PET':
      return 2;
    case 'NM':
      return 3;
    default:
      return 9;
  }
};

const pickBestSeriesByModality = (candidateIds: number[], seriesSummaryById: Map<number, SeriesSummary>): number | null => {
  let bestId: number | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  candidateIds.forEach((id) => {
    const summary = seriesSummaryById.get(id);
    if (!summary) return;
    const score = modalityPriority(normalizeModality(summary.modality));
    if (score < bestScore) {
      bestScore = score;
      bestId = id;
    }
  });
  return bestId ?? null;
};

const isImagingModalityForRegistration = (modality: string): boolean => {
  const normalized = modality.trim().toUpperCase();
  return normalized === 'CT' || normalized === 'MR' || normalized === 'PT' || normalized === 'PET' || normalized === 'NM';
};

const extractFrameOfReferenceFromImage = (image: any): string | null => {
  if (!image) return null;
  const tryValue = (value: unknown): string | null => {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length) return trimmed;
    }
    return null;
  };

  const metadata = image?.metadata ?? {};
  const candidates = [
    metadata?.frameOfReferenceUID,
    metadata?.frameOfReferenceUid,
    metadata?.FrameOfReferenceUID,
    metadata?.FrameOfReferenceUid,
    image?.frameOfReferenceUID,
  ];

  for (const candidate of candidates) {
    const resolved = tryValue(candidate);
    if (resolved) return resolved;
  }

  return null;
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
  fixedSeriesIds?: number[];
  movingSeriesIds?: number[];
}

export type FusionAssociationStatus = 'ready' | 'pending' | 'missing-secondary' | 'unmapped';

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

const pickPrimaryFromReferenced = (referencedIds: number[], seriesById: Map<number, SeriesSummary>, fallbackStudyId: number | null): number | null => {
  if (!referencedIds.length) return null;
  const priority: Record<string, number> = { CT: 1, MR: 2, PT: 3, PET: 4 };
  let bestId: number | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const id of referencedIds) {
    const series = seriesById.get(id);
    if (!series) continue;
    const modality = (series.modality || '').toUpperCase();
    const score = priority[modality] ?? 10;
    if (score < bestScore) {
      bestScore = score;
      bestId = id;
    }
  }
  if (bestId != null) return bestId;
  if (fallbackStudyId != null) {
    const candidates = referencedIds.filter((id) => {
      const series = seriesById.get(id);
      return series?.studyId === fallbackStudyId;
    });
    if (candidates.length) return candidates[0];
  }
  return referencedIds[0];
};

interface BuildOptions {
  includeDebug?: boolean;
}

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

  const derivedSummaries: DerivedSeriesSummary[] = [];
  const registrationSeriesCandidates: Array<{ series: Series; summary: SeriesSummary }> = [];
  const derivedByPair = new Map<string, DerivedSeriesSummary>();
  const derivedSeriesIds = new Set<number>();
  const imageCache = new Map<number, any[]>();
  const frameOfReferenceBySeriesId = new Map<number, string>();
  const seriesIdsByFrameUid = new Map<string, Set<number>>();

  const getSeriesImages = async (seriesId: number): Promise<any[]> => {
    if (imageCache.has(seriesId)) {
      return imageCache.get(seriesId)!;
    }
    try {
      const images = await storage.getImagesBySeriesId(seriesId);
      imageCache.set(seriesId, images ?? []);
    } catch (err) {
      logger.warn({ err, seriesId }, 'Failed to load images for series');
      imageCache.set(seriesId, []);
    }
    return imageCache.get(seriesId)!;
  };

  const getSeriesIdsForFrame = (frameUid: string | null | undefined): number[] => {
    if (!frameUid) return [];
    return Array.from(seriesIdsByFrameUid.get(frameUid) ?? []);
  };

  const getFrameOfReferenceForSeries = (seriesId: number | null | undefined): string | null => {
    if (!Number.isFinite(seriesId ?? NaN)) return null;
    return frameOfReferenceBySeriesId.get(Number(seriesId)) ?? null;
  };

  const ensureFrameOfReferenceUID = async (series: Series): Promise<string | null> => {
    if (frameOfReferenceBySeriesId.has(series.id)) {
      return frameOfReferenceBySeriesId.get(series.id)!;
    }
    const images = await getSeriesImages(series.id);
    const firstImage = images?.[0];
    let frameUid = extractFrameOfReferenceFromImage(firstImage);
    if (!frameUid && firstImage?.filePath) {
      try {
        const minimal = parseMinimalDicomMeta(firstImage.filePath);
        frameUid = minimal?.frameOfReference ?? null;
      } catch (err) {
        logger.warn({ err, seriesId: series.id, filePath: firstImage.filePath }, 'Failed to parse frame of reference from DICOM file');
      }
    }
    if (typeof frameUid === 'string' && frameUid.trim().length) {
      const trimmed = frameUid.trim();
      frameOfReferenceBySeriesId.set(series.id, trimmed);
      const existing = seriesIdsByFrameUid.get(trimmed) ?? new Set<number>();
      existing.add(series.id);
      seriesIdsByFrameUid.set(trimmed, existing);
      return trimmed;
    }
    return null;
  };

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
      return;
    }

    if ((series.modality || '').toUpperCase() === 'REG') {
      registrationSeriesCandidates.push({ series, summary });
    }
  });

  const regFileRecords = await findAllRegFilesForPatient(patientId);
  const regFileMap = new Map<number, string>();
  regFileRecords.forEach((record) => {
    if (record.seriesId && record.filePath) {
      regFileMap.set(record.seriesId, record.filePath);
    }
  });

  let registrationSummaries: RegistrationSeriesSummary[] = await Promise.all(
    registrationSeriesCandidates.map(async ({ series, summary }) => {
      let filePath = regFileMap.get(series.id) ?? null;
      if (!filePath) {
        try {
          const images = await getSeriesImages(series.id);
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
        .filter((id): id is number => Number.isFinite(id))
        .filter((id) => {
          const modality = normalizeModality(seriesById.get(id)?.modality);
          return modality !== 'REG' && isImagingModalityForRegistration(modality);
        });

      const filteredReferencedUids = Array.from(referencedUidSet.values()).filter((uid) => {
        const series = seriesByUid.get(uid);
        const modality = normalizeModality(series?.modality);
        return modality !== 'REG' && isImagingModalityForRegistration(modality);
      });

      const mapSeriesUidsToIds = (uids?: string[]) => (uids ?? [])
        .map((uid) => seriesByUid.get(uid)?.id)
        .filter((id): id is number => Number.isFinite(id));

      const fixedSeriesIds = mapSeriesUidsToIds(parsed?.fixedSeriesInstanceUids);
      const movingSeriesIds = mapSeriesUidsToIds(parsed?.movingSeriesInstanceUids);

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
        fixedSeriesIds: fixedSeriesIds.length ? fixedSeriesIds : undefined,
        movingSeriesIds: movingSeriesIds.length ? movingSeriesIds : undefined,
      } satisfies RegistrationSeriesSummary;
    }),
  );

  const registrationPairSet = new Set<string>();
  registrationSummaries.forEach((summary) => {
    const referenced = summary.referencedSeriesIds ?? [];
    if (referenced.length < 2) return;
    for (let i = 0; i < referenced.length; i += 1) {
      for (let j = i + 1; j < referenced.length; j += 1) {
        const key = makePairKey(referenced[i], referenced[j]);
        if (key) registrationPairSet.add(key);
      }
    }
  });

  const frameGroups = new Map<string, Series[]>();
  await Promise.all(
    allSeries.map(async (series) => {
      if (derivedSeriesIds.has(series.id)) return;
      const modality = normalizeModality(series.modality);
      if (!modality || !isImagingModalityForRegistration(modality)) return;
      const frameUid = await ensureFrameOfReferenceUID(series);
      if (!frameUid) return;
      const list = frameGroups.get(frameUid) ?? [];
      list.push(series);
      frameGroups.set(frameUid, list);
    }),
  );

  for (const [frameUid, seriesList] of frameGroups.entries()) {
    const hasExplicitRegistration = registrationSummaries.some((reg) => {
      const parsedSource = reg.parsed?.sourceFrameOfReferenceUid ?? null;
      const parsedTarget = reg.parsed?.targetFrameOfReferenceUid ?? null;
      return parsedSource === frameUid || parsedTarget === frameUid;
    });
    if (hasExplicitRegistration) continue;

    const eligible = seriesList.filter((series) => seriesSummaryById.has(series.id));
    if (eligible.length < 2) continue;

    const sorted = eligible
      .slice()
      .sort((a, b) => modalityPriority(normalizeModality(a.modality)) - modalityPriority(normalizeModality(b.modality)));

    const primarySeries = sorted[0];
    const primarySummary = seriesSummaryById.get(primarySeries.id);
    if (!primarySummary) continue;

    const primaryModality = normalizeModality(primarySeries.modality);
    const potentialSecondaries = sorted
      .slice(1)
      .filter((candidate) => normalizeModality(candidate.modality) !== primaryModality);

    const unmappedSecondaries = potentialSecondaries.filter((secondary) => {
      const key = makePairKey(primarySeries.id, secondary.id);
      return key ? !registrationPairSet.has(key) : false;
    });

    if (!unmappedSecondaries.length) continue;

    const referencedSeriesIds = [primarySeries.id, ...unmappedSecondaries.map((series) => series.id)];
    const referencedSeriesInstanceUIDs = referencedSeriesIds
      .map((id) => seriesById.get(id)?.seriesInstanceUID)
      .filter((uid): uid is string => typeof uid === 'string' && uid.length > 0);

    const implicitSummary: RegistrationSeriesSummary = {
      ...primarySummary,
      filePath: null,
      fileExists: false,
      referencedSeriesInstanceUIDs,
      referencedSeriesIds,
      parsed: {
        matrixRowMajor4x4: null,
        sourceFrameOfReferenceUid: frameUid,
        targetFrameOfReferenceUid: frameUid,
        notes: ['frame-of-reference-match'],
      },
    } satisfies RegistrationSeriesSummary;

    registrationSummaries.push(implicitSummary);
    unmappedSecondaries.forEach((secondary) => {
      const key = makePairKey(primarySeries.id, secondary.id);
      if (key) registrationPairSet.add(key);
    });
  }

  const registrationSummaryById = new Map<number, RegistrationSeriesSummary>();
  registrationSummaries.forEach((summary) => {
    registrationSummaryById.set(summary.id, summary);
  });

  const associations: FusionAssociationSummary[] = [];
  const associationKeySet = new Set<string>();
  const associationsByStudy = new Map<number, FusionAssociationSummary[]>();

  const addAssociation = (association: FusionAssociationSummary) => {
    const key = [
      association.studyId ?? 'null',
      association.primarySeriesId ?? 'null',
      association.secondarySeriesId ?? 'null',
      association.registrationSeriesId ?? 'null',
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

  registrationSummaries.forEach((regSummary) => {
    const referencedIds = regSummary.referencedSeriesIds ?? [];
    const sourceFoR = regSummary.parsed?.sourceFrameOfReferenceUid ?? null;
    const targetFoR = regSummary.parsed?.targetFrameOfReferenceUid ?? null;

    const primaryCandidatesFromTarget = targetFoR
      ? referencedIds.filter((id) => getFrameOfReferenceForSeries(id) === targetFoR)
      : [];
    const fixedSeriesIdSet = new Set<number>(regSummary.fixedSeriesIds ?? []);
    const movingSeriesIdSet = new Set<number>(regSummary.movingSeriesIds ?? []);

    const primaryCandidatesFromFixed = referencedIds.filter((id) => fixedSeriesIdSet.has(id));

    let primaryId = pickBestSeriesByModality(primaryCandidatesFromFixed, seriesSummaryById);
    if (primaryId == null && primaryCandidatesFromTarget.length) {
      primaryId = pickBestSeriesByModality(primaryCandidatesFromTarget, seriesSummaryById);
    }
    if (primaryId == null) {
      primaryId = pickPrimaryFromReferenced(referencedIds, seriesSummaryById, regSummary.studyId);
    }

    if (primaryId == null) {
      addAssociation({
        studyId: regSummary.studyId ?? null,
        registrationSeriesId: regSummary.id,
        registrationFilePath: regSummary.filePath,
        registrationId: null,
        primarySeriesId: null,
        secondarySeriesId: null,
        derivedSeriesId: null,
        status: 'unmapped',
        reason: 'Unable to resolve primary series for registration',
        markers: [],
        registrationSeries: regSummary,
        primarySeries: null,
        secondarySeries: null,
        derivedSeries: null,
      });
      return;
    }

  const referencedDetails = referencedIds.map((id) => {
    const frameUid = getFrameOfReferenceForSeries(id);
    const extraIds = getSeriesIdsForFrame(frameUid)
      .filter((candidateId) => candidateId !== id && candidateId !== primaryId)
      .filter((candidateId) => {
        const summary = seriesSummaryById.get(candidateId);
        if (!summary) return false;
        const modality = normalizeModality(summary.modality);
        if (modality === 'REG' || modality === 'RTSTRUCT' || modality === 'RTRECORD') return false;
        return true;
      });
    const seriesRecord = seriesById.get(id);
    const metadata = (seriesRecord?.metadata ?? {}) as Record<string, unknown>;
    const manufacturerRaw = typeof metadata?.manufacturer === 'string' ? metadata.manufacturer : null;
    const manufacturer = manufacturerRaw ? manufacturerRaw.trim() : null;
    const isTreatmentConeBeam = manufacturer ? /VARIAN|ELEKTA/i.test(manufacturer) : false;
    let role: 'fixed' | 'moving' | 'unknown' = 'unknown';
    if (fixedSeriesIdSet.has(id)) role = 'fixed';
    else if (movingSeriesIdSet.has(id)) role = 'moving';
    return {
      id,
      frameUid,
      extraIds,
      modality: normalizeModality(seriesById.get(id)?.modality ?? ''),
      role,
      manufacturer,
      isTreatmentConeBeam,
    };
  });
    const detailById = new Map<number, typeof referencedDetails[number]>();
    referencedDetails.forEach((detail) => detailById.set(detail.id, detail));

    const primaryDetail = detailById.get(primaryId);
    if (primaryDetail?.modality === 'CT' && primaryDetail.isTreatmentConeBeam) {
      const alternativePrimaryIds = referencedDetails
        .filter(detail => detail.id !== primaryId && detail.modality === 'CT' && !detail.isTreatmentConeBeam)
        .map(detail => detail.id);
      const alternativePrimaryId = pickBestSeriesByModality(alternativePrimaryIds, seriesSummaryById);
      if (alternativePrimaryId != null) {
        primaryId = alternativePrimaryId;
      }
    }

    const secondaryDetails = referencedDetails
      .filter((detail) => detail.id !== primaryId)
      .sort((a, b) => {
        const treatmentDiff = (a.isTreatmentConeBeam ? 0 : 1) - (b.isTreatmentConeBeam ? 0 : 1);
        if (treatmentDiff !== 0) return treatmentDiff;
        const rolePriority = (detail: typeof a) => (detail.role === 'moving' ? 0 : detail.role === 'unknown' ? 1 : 2);
        const roleDiff = rolePriority(a) - rolePriority(b);
        if (roleDiff !== 0) return roleDiff;
        if (b.extraIds.length !== a.extraIds.length) return b.extraIds.length - a.extraIds.length;
        return modalityPriority(a.modality) - modalityPriority(b.modality);
      });

    let directSecondaryIds: number[] = secondaryDetails.map((detail) => detail.id);
    if (!directSecondaryIds.length && sourceFoR) {
      directSecondaryIds = referencedIds.filter((id) => id !== primaryId && getFrameOfReferenceForSeries(id) === sourceFoR);
    }
    if (!directSecondaryIds.length) {
      directSecondaryIds = referencedIds.filter((id) => id !== primaryId);
    }

    if (!directSecondaryIds.length) {
      addAssociation({
        studyId: regSummary.studyId ?? null,
        registrationSeriesId: regSummary.id,
        registrationFilePath: regSummary.filePath,
        registrationId: null,
        primarySeriesId: primaryId,
        secondarySeriesId: null,
        derivedSeriesId: null,
        status: 'missing-secondary',
        reason: 'Registration references only one series',
        markers: [],
        registrationSeries: regSummary,
        primarySeries: seriesSummaryById.get(primaryId) ?? null,
        secondarySeries: null,
        derivedSeries: null,
      });
      return;
    }

    directSecondaryIds.forEach((secondaryId) => {
      const key = makePairKey(primaryId, secondaryId);
      const derived = key ? derivedByPair.get(key) : undefined;
      const parsedNotes = Array.isArray(regSummary.parsed?.notes)
        ? (regSummary.parsed?.notes as string[]).filter((note): note is string => typeof note === 'string')
        : [];
      const hasFrameMatchNote = parsedNotes.includes('frame-of-reference-match');

      let status: FusionAssociationStatus;
      let reason: string | undefined;
      if (derived) {
        status = 'ready';
      } else if (hasFrameMatchNote) {
        status = 'pending';
        reason = 'Shared frame of reference – resample pending';
      } else {
        status = 'pending';
      }

      const sameFrameUid = regSummary.parsed?.sourceFrameOfReferenceUid
        && regSummary.parsed?.sourceFrameOfReferenceUid === regSummary.parsed?.targetFrameOfReferenceUid
        ? regSummary.parsed?.sourceFrameOfReferenceUid
        : null;

      const registrationId = derived?.fusion.registrationId
        ?? (hasFrameMatchNote && sameFrameUid ? `FOR:${sameFrameUid}` : null);

      const markers = derived?.fusion.markers
        ?? (hasFrameMatchNote ? ['FRAME_OF_REFERENCE'] : []);

      const transformSource = derived?.fusion.transformSource
        ?? (hasFrameMatchNote ? 'frame-of-reference' : null);

      addAssociation({
        studyId: regSummary.studyId ?? seriesSummaryById.get(primaryId)?.studyId ?? null,
        registrationSeriesId: regSummary.id,
        registrationFilePath: regSummary.filePath,
        registrationId,
        primarySeriesId: primaryId,
        secondarySeriesId: secondaryId,
        derivedSeriesId: derived?.id ?? null,
        status,
        reason,
        markers,
        transformSource,
        registrationSeries: regSummary,
        primarySeries: seriesSummaryById.get(primaryId) ?? null,
        secondarySeries: seriesSummaryById.get(secondaryId) ?? null,
        derivedSeries: derived ?? null,
      });

      if (key) registrationPairSet.add(key);

      const secondaryDetail = detailById.get(secondaryId);
      const secondaryFoR = secondaryDetail?.frameUid ?? getFrameOfReferenceForSeries(secondaryId);
      const coRegisteredIds = (secondaryDetail?.extraIds ?? getSeriesIdsForFrame(secondaryFoR)
        .filter((candidateId) => candidateId !== primaryId && candidateId !== secondaryId)
        .filter((candidateId) => {
          const summary = seriesSummaryById.get(candidateId);
          if (!summary) return false;
          const modality = normalizeModality(summary.modality);
          if (modality === 'REG' || modality === 'RTSTRUCT' || modality === 'RTRECORD') return false;
          return true;
        }))
        .filter((candidateId) => candidateId !== primaryId && candidateId !== secondaryId);

      coRegisteredIds.forEach((coId) => {
        const coKey = makePairKey(primaryId, coId);
        if (!coKey || registrationPairSet.has(coKey)) return;
        const coDerived = derivedByPair.get(coKey);
        const coMarkers = new Set<string>();
        (coDerived?.fusion.markers ?? []).forEach((marker) => coMarkers.add(marker));
        coMarkers.add('FRAME_OF_REFERENCE');

        const coReason = 'Co-registered via secondary frame of reference';

        const coStatus: FusionAssociationStatus = coDerived ? 'ready' : 'pending';

        addAssociation({
          studyId: regSummary.studyId ?? seriesSummaryById.get(primaryId)?.studyId ?? null,
          registrationSeriesId: regSummary.id,
          registrationFilePath: regSummary.filePath,
          registrationId,
          primarySeriesId: primaryId,
          secondarySeriesId: coId,
          derivedSeriesId: coDerived?.id ?? null,
          status: coStatus,
          reason: coReason,
          markers: Array.from(coMarkers.values()),
          transformSource: coDerived?.fusion.transformSource ?? 'frame-of-reference',
          registrationSeries: regSummary,
          primarySeries: seriesSummaryById.get(primaryId) ?? null,
          secondarySeries: seriesSummaryById.get(coId) ?? null,
          derivedSeries: coDerived ?? null,
        });

        registrationPairSet.add(coKey);
      });
    });
  });

  derivedSummaries.forEach((derived) => {
    const key = makePairKey(derived.fusion.primarySeriesId, derived.fusion.secondarySeriesId);
    if (!key) return;
    const alreadyMapped = associations.some(
      (assoc) => assoc.primarySeriesId === derived.fusion.primarySeriesId && assoc.secondarySeriesId === derived.fusion.secondarySeriesId,
    );
    if (alreadyMapped) return;
    addAssociation({
      studyId: derived.studyId ?? null,
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
      primarySeries: derived.fusion.primarySeriesId ? seriesSummaryById.get(derived.fusion.primarySeriesId) ?? null : null,
      secondarySeries: derived.fusion.secondarySeriesId ? seriesSummaryById.get(derived.fusion.secondarySeriesId) ?? null : null,
      derivedSeries: derived,
    });
  });

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
