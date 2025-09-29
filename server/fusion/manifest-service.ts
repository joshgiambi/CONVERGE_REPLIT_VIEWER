import fs from 'fs';
import path from 'path';
import { storage } from '../storage.ts';
import { db } from '../db.ts';
import { images as imagesTable, series as seriesTable } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { logger } from '../logger.ts';
import { fusionManifestPath, fusionDicomPath, fusionMetadataPath, ensureFusionDirectories, fusionPairRoot } from './path-utils.ts';
import { loadDicomMetadata } from './dicom-metadata.ts';
import type { FusionManifest, FusionSecondaryDescriptor, FusionInstanceDescriptor } from './types.ts';
import { FuseboxVolumeResampler, type VolumeResampleRequest, type InterpolationMode, type VolumeResampleResponse } from './resampler.ts';
import { collectSeriesFiles, resolveFuseboxTransform, sortImagesByInstance } from './fusebox.ts';
import { markFuseboxRunFailed, markFuseboxRunReady, markFuseboxRunStarted } from './fusebox-run-store.ts';
import type { FuseboxLogEmitter } from './fusebox.ts';
import { recordDebugEvent, type DebugEventLevel } from '../debug/debug-hub.ts';

interface ManifestRequestOptions {
  primarySeriesId: number;
  secondarySeriesIds?: number[];
  force?: boolean;
  interpolation?: InterpolationMode;
  preload?: boolean;
  logger?: FuseboxLogEmitter;
}

interface SeriesInfo {
  studyId: number;
  studyInstanceUID: string;
  patientId: number | null;
  patientDicomId: string | null;
}

const DEFAULT_INTERPOLATION: InterpolationMode = 'linear';
const CURRENT_MANIFEST_VERSION = 2;

const MANIFEST_DEBUG_SOURCE = 'fusion-manifest';

const manifestDebug = (level: DebugEventLevel, message: string, context: Record<string, unknown>) => {
  try {
    recordDebugEvent({
      level,
      source: MANIFEST_DEBUG_SOURCE,
      message,
      context,
    });
  } catch {
    // Never allow debugging instrumentation to interfere with manifest generation.
  }
};

const resolvePatientInfo = async (primarySeriesId: number): Promise<SeriesInfo> => {
  const primarySeries = await storage.getSeriesById(primarySeriesId);
  if (!primarySeries) throw new Error(`Primary series ${primarySeriesId} not found`);
  const study = await storage.getStudy(primarySeries.studyId);
  if (!study) throw new Error(`Study ${primarySeries.studyId} not found`);

  let patientDicomId = study.patientID || null;
  let patientId: number | null = study.patientId ?? null;

  if (!patientDicomId && patientId) {
    const patient = await storage.getPatient(patientId);
    patientDicomId = patient?.patientID ?? null;
  }

  return {
    studyId: study.id,
    studyInstanceUID: study.studyInstanceUID,
    patientId,
    patientDicomId,
  };
};

const readManifestFromDisk = async (manifestPath: string): Promise<FusionManifest | null> => {
  try {
    const raw = await fs.promises.readFile(manifestPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return parsed as FusionManifest;
    }
    return null;
  } catch (err: any) {
    if (err?.code === 'ENOENT') return null;
    logger.warn(`Failed to read fusion manifest at ${manifestPath}: ${err?.message || err}`);
    return null;
  }
};

const writeManifestToDisk = async (manifestPath: string, manifest: FusionManifest) => {
  await fs.promises.mkdir(path.dirname(manifestPath), { recursive: true });
  await fs.promises.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
};

const fileExists = (filePath: string): boolean => {
  try {
    fs.accessSync(filePath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
};

const toInstanceDescriptor = (instance: any, primarySopInstanceUID?: string | null): FusionInstanceDescriptor => {
  return {
    sopInstanceUID: instance.sopInstanceUID,
    instanceNumber: instance.instanceNumber,
    fileName: instance.fileName,
    filePath: instance.filePath,
    imagePositionPatient: Array.isArray(instance.imagePositionPatient) ? instance.imagePositionPatient : null,
    imageOrientationPatient: Array.isArray(instance.imageOrientationPatient) ? instance.imageOrientationPatient : null,
    pixelSpacing: Array.isArray(instance.pixelSpacing) ? instance.pixelSpacing as [number, number] : null,
    sliceLocation: typeof instance.sliceLocation === 'number' ? instance.sliceLocation : null,
    windowCenter: Array.isArray(instance.windowCenter) ? instance.windowCenter : null,
    windowWidth: Array.isArray(instance.windowWidth) ? instance.windowWidth : null,
    primarySopInstanceUID: primarySopInstanceUID ?? null,
  };
};

const createSecondaryDescriptor = (
  base: Partial<FusionSecondaryDescriptor>,
  overrides: Partial<FusionSecondaryDescriptor>,
): FusionSecondaryDescriptor => {
  return {
    secondarySeriesId: base.secondarySeriesId ?? overrides.secondarySeriesId!,
    secondarySeriesInstanceUID: overrides.secondarySeriesInstanceUID ?? base.secondarySeriesInstanceUID ?? '',
    secondarySeriesDescription: overrides.secondarySeriesDescription ?? base.secondarySeriesDescription ?? null,
    secondaryModality: overrides.secondaryModality ?? base.secondaryModality ?? null,
    registrationId: overrides.registrationId ?? base.registrationId ?? null,
    status: overrides.status ?? base.status ?? 'pending',
    generatedAt: overrides.generatedAt ?? base.generatedAt ?? null,
    frameOfReferenceUID: overrides.frameOfReferenceUID ?? base.frameOfReferenceUID ?? null,
    sliceCount: overrides.sliceCount ?? base.sliceCount ?? 0,
    rows: overrides.rows ?? base.rows ?? null,
    columns: overrides.columns ?? base.columns ?? null,
    pixelSpacing: overrides.pixelSpacing ?? base.pixelSpacing ?? null,
    imageOrientationPatient: overrides.imageOrientationPatient ?? base.imageOrientationPatient ?? null,
    imagePositionPatientFirst: overrides.imagePositionPatientFirst ?? base.imagePositionPatientFirst ?? null,
    imagePositionPatientLast: overrides.imagePositionPatientLast ?? base.imagePositionPatientLast ?? null,
    windowCenter: overrides.windowCenter ?? base.windowCenter ?? null,
    windowWidth: overrides.windowWidth ?? base.windowWidth ?? null,
    outputDirectory: overrides.outputDirectory ?? base.outputDirectory ?? '',
    manifestPath: overrides.manifestPath ?? base.manifestPath ?? '',
    instances: overrides.instances ?? base.instances ?? [],
    error: overrides.error ?? base.error,
  };
};

export class FusionManifestService {
  private readonly cache = new Map<string, FusionManifest>();
  private readonly pending = new Map<string, Promise<FusionManifest>>();
  private readonly resampler = new FuseboxVolumeResampler();

  private cacheKey(primarySeriesId: number): string {
    return String(primarySeriesId);
  }

  async getManifest(options: ManifestRequestOptions): Promise<FusionManifest> {
    const { primarySeriesId, secondarySeriesIds = [], force = false } = options;
    const cacheKey = this.cacheKey(primarySeriesId);

    manifestDebug(force ? 'info' : 'debug', 'Manifest request received', {
      primarySeriesId,
      secondarySeriesIds,
      force,
      interpolation: options.interpolation ?? null,
      preload: options.preload ?? null,
    });

    if (!force && this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey)!;
      const requestedSet = new Set(secondarySeriesIds);
      const hasAllSecondaries = secondarySeriesIds.length === 0 || cached.secondaries.some(sec => requestedSet.has(sec.secondarySeriesId));
      if (hasAllSecondaries) {
        manifestDebug('info', 'Manifest served from cache', {
          primarySeriesId,
          cachedSecondaries: cached.secondaries.length,
          secondarySeriesIds,
        });
        return cached;
      }
    }

    if (!force && this.pending.has(cacheKey)) {
      manifestDebug('debug', 'Awaiting in-flight manifest build', {
        primarySeriesId,
        secondarySeriesIds,
      });
      return this.pending.get(cacheKey)!;
    }

    manifestDebug('info', 'Building manifest', {
      primarySeriesId,
      secondarySeriesIds,
      force,
      interpolation: options.interpolation ?? null,
      preload: options.preload ?? null,
    });

    const promise = this.buildManifest(options).finally(() => {
      this.pending.delete(cacheKey);
    });
    this.pending.set(cacheKey, promise);
    const manifest = await promise;
    this.cache.set(cacheKey, manifest);
    manifestDebug('info', 'Manifest ready', {
      primarySeriesId,
      secondarySeries: manifest.secondaries.length,
      readySecondaries: manifest.secondaries.filter((sec) => sec.status === 'ready').length,
    });
    return manifest;
  }

  private async buildManifest(options: ManifestRequestOptions): Promise<FusionManifest> {
    const { primarySeriesId, secondarySeriesIds = [], force = false } = options;
    const interpolation = options.interpolation ?? DEFAULT_INTERPOLATION;
    const preload = options.preload ?? true;
    const logger = options.logger;

    const primarySeries = await storage.getSeriesById(primarySeriesId);
    if (!primarySeries) throw new Error(`Primary series ${primarySeriesId} not found`);

    const { studyId, studyInstanceUID, patientId, patientDicomId } = await resolvePatientInfo(primarySeriesId);
    const manifestPath = fusionManifestPath({
      patientId: patientDicomId ?? String(patientId ?? 'unknown'),
      studyInstanceUID,
      primarySeriesInstanceUID: primarySeries.seriesInstanceUID,
      secondarySeriesInstanceUID: 'manifest-root',
    });

    const manifestDir = path.dirname(path.dirname(manifestPath));
    await fs.promises.mkdir(manifestDir, { recursive: true });

    const existingManifest = await readManifestFromDisk(manifestPath).catch(() => null);
    const manifestVersionMismatch = existingManifest?.manifestVersion !== CURRENT_MANIFEST_VERSION;
    const persistedManifest = manifestVersionMismatch ? null : existingManifest;

    const nowIso = new Date().toISOString();
    const manifest: FusionManifest = persistedManifest ?? {
      manifestVersion: CURRENT_MANIFEST_VERSION,
      studyId,
      patientId,
      primarySeriesId,
      primarySeriesInstanceUID: primarySeries.seriesInstanceUID,
      primarySeriesDescription: primarySeries.seriesDescription ?? null,
      primaryModality: primarySeries.modality ?? null,
      createdAt: existingManifest?.createdAt ?? nowIso,
      updatedAt: nowIso,
      settings: {
        interpolation,
        preload,
      },
      secondaries: [],
    };

    manifest.manifestVersion = CURRENT_MANIFEST_VERSION;
    manifest.updatedAt = nowIso;
    manifest.settings = { interpolation, preload };

    const secondarySource = existingManifest ?? null;
    const secondaryIdsToProcess = secondarySeriesIds.length
      ? secondarySeriesIds
      : (secondarySource?.secondaries.map(sec => sec.secondarySeriesId) ?? []);

    const updatedSecondaries: FusionSecondaryDescriptor[] = [];
    const effectiveForce = force || manifestVersionMismatch;

    for (const secondarySeriesId of secondaryIdsToProcess) {
      const existing = existingManifest?.secondaries.find(sec => sec.secondarySeriesId === secondarySeriesId);
      try {
        const descriptor = await this.ensureSecondary({
          primarySeries,
          primarySeriesId,
          secondarySeriesId,
          interpolation,
          force: effectiveForce,
          resetCache: manifestVersionMismatch,
          logger,
          aggregatedManifestPath: manifestPath,
        });
        updatedSecondaries.push(descriptor);
      } catch (err: any) {
        const message = err?.message || String(err);
        const stderr = err?.context?.stderr ?? null;
        const stdout = err?.context?.stdout ?? null;
        const code = err?.context?.code ?? null;
        logger?.('warn', 'Fusion secondary generation failed', {
          primarySeriesId,
          secondarySeriesId,
          error: message,
          code,
          stderr,
          stdout,
        });
        if (existing) {
          updatedSecondaries.push(createSecondaryDescriptor(existing, {
            status: 'error',
            error: message,
            generatedAt: existing.generatedAt ?? nowIso,
          }));
        } else {
          updatedSecondaries.push({
            secondarySeriesId,
            secondarySeriesInstanceUID: '',
            secondarySeriesDescription: null,
            secondaryModality: null,
            registrationId: null,
            status: 'error',
            generatedAt: null,
            frameOfReferenceUID: null,
            sliceCount: 0,
            rows: null,
            columns: null,
            pixelSpacing: null,
            imageOrientationPatient: null,
            imagePositionPatientFirst: null,
            imagePositionPatientLast: null,
            windowCenter: null,
            windowWidth: null,
            outputDirectory: '',
            manifestPath: '',
            instances: [],
            error: message,
          });
        }
      }
    }

    manifest.secondaries = updatedSecondaries;

    await writeManifestToDisk(manifestPath, manifest);
    return manifest;
  }

  private async ensureSecondary(options: {
    primarySeries: any;
    primarySeriesId: number;
    secondarySeriesId: number;
    interpolation: InterpolationMode;
    force: boolean;
    resetCache: boolean;
    logger?: FuseboxLogEmitter;
    aggregatedManifestPath: string;
  }): Promise<FusionSecondaryDescriptor> {
    const { primarySeries, primarySeriesId, secondarySeriesId, interpolation, force, resetCache, logger, aggregatedManifestPath } = options;
    const secondarySeries = await storage.getSeriesById(secondarySeriesId);
    if (!secondarySeries) {
      throw new Error(`Secondary series ${secondarySeriesId} not found`);
    }

    const { studyId, studyInstanceUID, patientId, patientDicomId } = await resolvePatientInfo(primarySeriesId);

    const pathInput = {
      patientId: patientDicomId ?? String(patientId ?? 'unknown'),
      studyInstanceUID,
      primarySeriesInstanceUID: primarySeries.seriesInstanceUID,
      secondarySeriesInstanceUID: secondarySeries.seriesInstanceUID,
    };

    const pairRoot = fusionPairRoot(pathInput);
    if (force || resetCache) {
      await fs.promises.rm(pairRoot, { recursive: true, force: true }).catch(() => {});
    }

    ensureFusionDirectories(pathInput);

    const dicomOutputDir = fusionDicomPath(pathInput);
    const metadataPath = fusionMetadataPath(pathInput);

    const primaryFiles = await collectSeriesFiles(primarySeriesId);
    const secondaryFiles = await collectSeriesFiles(secondarySeriesId);
    if (!primaryFiles.length || !secondaryFiles.length) {
      throw new Error('Primary or secondary series missing DICOM files');
    }

    const primaryImages = sortImagesByInstance(await storage.getImagesBySeriesId(primarySeriesId));
    const secondaryImages = sortImagesByInstance(await storage.getImagesBySeriesId(secondarySeriesId));
    const primaryFirstFile = primaryImages[0]?.filePath || primaryFiles[0];
    const secondaryFirstFile = secondaryImages[0]?.filePath || secondaryFiles[0];

    const primaryMeta = loadDicomMetadata(primaryFirstFile);
    const secondaryMeta = loadDicomMetadata(secondaryFirstFile);

    const transformInfo = await resolveFuseboxTransform(primarySeriesId, secondarySeriesId, undefined, logger);
    if (!transformInfo || (!transformInfo.matrix && !transformInfo.transformFile)) {
      throw new Error('Registration transform unavailable for series pair');
    }

    const registrationId = transformInfo.registrationId ?? null;
    const baseRunContext = {
      primarySeriesId,
      secondarySeriesId,
      registrationId,
      transformSource: transformInfo.transformSource ?? null,
      outputDirectory: dicomOutputDir,
      manifestPath: aggregatedManifestPath,
    } as const;

    if (!force) {
      const expectedFirstInstance = path.join(dicomOutputDir, 'slice_0000.dcm');
      if (fileExists(expectedFirstInstance) && fileExists(aggregatedManifestPath)) {
        const descriptor = await this.buildDescriptorFromExisting({
          secondarySeries,
          aggregatedManifestPath,
          dicomOutputDir,
        });
        if (descriptor) {
          await markFuseboxRunReady({
            ...baseRunContext,
            manifestPath: descriptor.manifestPath || aggregatedManifestPath,
            outputDirectory: descriptor.outputDirectory,
            sliceCount: descriptor.sliceCount ?? null,
            rows: descriptor.rows ?? null,
            columns: descriptor.columns ?? null,
          });
          manifestDebug('info', 'Reused cached fusion secondary', {
            primarySeriesId,
            secondarySeriesId,
            registrationId,
            manifestPath: descriptor.manifestPath || aggregatedManifestPath,
            outputDirectory: descriptor.outputDirectory,
          });
          return descriptor;
        }
      }
    }

    const metadataPayload = this.buildResampleMetadata({
      primarySeries,
      secondarySeries,
      primaryMeta,
      secondaryMeta,
      transformInfo,
    });

    await fs.promises.writeFile(metadataPath, JSON.stringify(metadataPayload, null, 2), 'utf-8').catch(() => {});

    const invertTransformFile = transformInfo.transformFile ? true : undefined;
    const request: VolumeResampleRequest = {
      primarySeriesFiles: primaryFiles,
      secondarySeriesFiles: secondaryFiles,
      transformMatrix: transformInfo.matrix,
      transformFilePath: transformInfo.transformFile,
      invertTransformFile,
      interpolation,
      outputDirectory: pairRoot,
      metadata: metadataPayload,
    };

    await markFuseboxRunStarted(baseRunContext);
    manifestDebug('debug', 'Launching fusebox resample', {
      primarySeriesId,
      secondarySeriesId,
      registrationId,
      interpolation,
      outputDirectory: pairRoot,
    });

    let response: VolumeResampleResponse | null = null;

    try {
      // Use a single authoritative path: the Python helper decides orientation/flattening.
      response = await this.resampler.execute(request);

      if (!response) {
        throw new Error('Fusebox resample failed');
      }

      const seriesInstanceUID = response.seriesInstanceUID || transformInfo.registrationId || secondarySeries.seriesInstanceUID + '.fused';
      const frameOfReferenceUID = response.frameOfReferenceUID || primaryMeta.frameOfReferenceUID || null;

      const fusedSeries = await this.ensureSeriesRecord({
        primarySeries,
        secondarySeries,
        studyId,
        seriesInstanceUID,
        modality: response.modality ?? secondarySeries.modality,
        description: response.seriesDescription ?? `Fused ${secondarySeries.seriesDescription || secondarySeries.modality}`,
        sliceCount: response.sliceCount,
        transformInfo,
        interpolation,
      });

      await this.replaceSeriesImages({
        seriesId: fusedSeries.id,
        instances: response.instances,
        frameOfReferenceUID,
        pixelSpacing: response.pixelSpacing,
        imageOrientationPatient: response.imageOrientationPatient,
        primaryMeta,
        secondaryMeta,
      });

      const pixelSpacing = Array.isArray(response.pixelSpacing) && response.pixelSpacing.length >= 2
        ? [Number(response.pixelSpacing[0]), Number(response.pixelSpacing[1])] as [number, number]
        : null;
      const orientation = Array.isArray(response.imageOrientationPatient) && response.imageOrientationPatient.length >= 6
        ? [
            Number(response.imageOrientationPatient[0]),
            Number(response.imageOrientationPatient[1]),
            Number(response.imageOrientationPatient[2]),
            Number(response.imageOrientationPatient[3]),
            Number(response.imageOrientationPatient[4]),
            Number(response.imageOrientationPatient[5]),
          ] as [number, number, number, number, number, number]
        : null;
      const positionFirst = Array.isArray(response.imagePositionPatientFirst) && response.imagePositionPatientFirst.length >= 3
        ? [
            Number(response.imagePositionPatientFirst[0]),
            Number(response.imagePositionPatientFirst[1]),
            Number(response.imagePositionPatientFirst[2]),
          ] as [number, number, number]
        : null;
      const positionLast = Array.isArray(response.imagePositionPatientLast) && response.imagePositionPatientLast.length >= 3
        ? [
            Number(response.imagePositionPatientLast[0]),
            Number(response.imagePositionPatientLast[1]),
            Number(response.imagePositionPatientLast[2]),
          ] as [number, number, number]
        : null;

    const parsePosition = (value: unknown): [number, number, number] | null => {
      if (!value) return null;
      if (Array.isArray(value) && value.length >= 3) {
        const coords = value.map((component) => Number(component)) as [number, number, number];
        if (coords.every((component) => Number.isFinite(component))) return coords;
      }
      if (typeof value === 'string') {
        const parts = value.split('\\').map((part) => Number(part.trim()));
        if (parts.length >= 3 && parts.every((component) => Number.isFinite(component))) {
          return [parts[0], parts[1], parts[2]];
        }
      }
      return null;
    };

    const primaryPositionMap = primaryImages.map((image, index) => {
      const position = parsePosition(
        image?.imagePositionPatient ??
        image?.imagePosition ??
        image?.metadata?.imagePositionPatient ??
        image?.metadata?.imagePosition,
      );
      return {
        sopInstanceUID: image?.sopInstanceUID ?? null,
        index,
        position,
      };
    });

    const resolvePrimarySopForInstance = (inst: any, fallbackIndex: number): string | null => {
      const instPosition = parsePosition(inst?.imagePositionPatient);
      if (instPosition) {
        const instZ = instPosition[2];
        if (Number.isFinite(instZ)) {
          let bestMatch: { sop: string | null; distance: number } | null = null;
          primaryPositionMap.forEach((candidate) => {
            if (!candidate.position || candidate.sopInstanceUID == null) return;
            const distance = Math.abs(candidate.position[2] - instZ);
            if (!bestMatch || distance < bestMatch.distance) {
              bestMatch = { sop: candidate.sopInstanceUID, distance };
            }
          });
          if (bestMatch?.sop) return bestMatch.sop;
        }
      }

      const fallback = primaryImages[fallbackIndex];
      if (fallback?.sopInstanceUID) return fallback.sopInstanceUID;
      const candidate = primaryPositionMap[fallbackIndex];
      return candidate?.sopInstanceUID ?? null;
    };

    const descriptor: FusionSecondaryDescriptor = {
      secondarySeriesId,
      secondarySeriesInstanceUID: secondarySeries.seriesInstanceUID,
      secondarySeriesDescription: secondarySeries.seriesDescription ?? null,
      secondaryModality: secondarySeries.modality ?? null,
      registrationId: transformInfo.registrationId ?? null,
      status: 'ready',
      generatedAt: new Date().toISOString(),
      frameOfReferenceUID,
      sliceCount: response.sliceCount,
      rows: response.rows,
      columns: response.columns,
      pixelSpacing,
      imageOrientationPatient: orientation,
      imagePositionPatientFirst: positionFirst,
      imagePositionPatientLast: positionLast,
      windowCenter: Array.isArray(response.windowCenter) ? response.windowCenter : null,
      windowWidth: Array.isArray(response.windowWidth) ? response.windowWidth : null,
      outputDirectory: response.outputDirectory,
      manifestPath: response.manifestPath ?? path.join(dicomOutputDir, 'manifest.json'),
      instances: response.instances.map((inst, idx) => {
        const mappedPrimarySop = resolvePrimarySopForInstance(inst, idx);
        return toInstanceDescriptor(inst, mappedPrimarySop);
      }),
    };

      await markFuseboxRunReady({
        ...baseRunContext,
        manifestPath: descriptor.manifestPath || response.manifestPath || aggregatedManifestPath,
        outputDirectory: descriptor.outputDirectory,
        sliceCount: descriptor.sliceCount ?? null,
        rows: descriptor.rows ?? null,
        columns: descriptor.columns ?? null,
      });

      manifestDebug('info', 'Generated fusion secondary', {
        primarySeriesId,
        secondarySeriesId,
        registrationId,
        outputDirectory: descriptor.outputDirectory,
        sliceCount: descriptor.sliceCount,
        modality: descriptor.secondaryModality,
        transformSource: transformInfo.transformSource ?? null,
      });

      return descriptor;
    } catch (err: any) {
      const message = err?.message || String(err);
      await markFuseboxRunFailed({
        ...baseRunContext,
        error: message,
      });
      manifestDebug('warn', 'Fusion secondary generation failed', {
        primarySeriesId,
        secondarySeriesId,
        registrationId,
        error: message,
      });
      throw err;
    }
  }

  private buildResampleMetadata(input: {
    primarySeries: any;
    secondarySeries: any;
    primaryMeta: ReturnType<typeof loadDicomMetadata>;
    secondaryMeta: ReturnType<typeof loadDicomMetadata>;
    transformInfo: any;
  }): any {
    const { primarySeries, secondarySeries, primaryMeta, secondaryMeta, transformInfo } = input;

    const imageType = ['DERIVED', 'SECONDARY', 'FUSED'];
    const derivationDescription = `Resampled ${secondarySeries.seriesDescription || secondarySeries.modality || 'secondary'} into ${primarySeries.seriesDescription || primarySeries.modality || 'primary'} frame of reference`;

    return {
      patient: {
        PatientID: primaryMeta.patientID ?? secondaryMeta.patientID ?? null,
        PatientName: primaryMeta.patientName ?? secondaryMeta.patientName ?? null,
        PatientBirthDate: primaryMeta.patientBirthDate ?? secondaryMeta.patientBirthDate ?? null,
        PatientSex: primaryMeta.patientSex ?? secondaryMeta.patientSex ?? null,
        PatientAge: primaryMeta.patientAge ?? secondaryMeta.patientAge ?? null,
      },
      study: {
        StudyInstanceUID: primaryMeta.studyInstanceUID ?? secondaryMeta.studyInstanceUID ?? null,
        StudyDescription: primaryMeta.studyDescription ?? secondaryMeta.studyDescription ?? null,
        StudyDate: primaryMeta.studyDate ?? secondaryMeta.studyDate ?? null,
        StudyTime: primaryMeta.studyTime ?? secondaryMeta.studyTime ?? null,
        AccessionNumber: primaryMeta.accessionNumber ?? secondaryMeta.accessionNumber ?? null,
      },
      primarySeries: {
        SeriesInstanceUID: primarySeries.seriesInstanceUID,
        SeriesDescription: primarySeries.seriesDescription,
        SeriesNumber: primarySeries.seriesNumber,
        Modality: primarySeries.modality,
        FrameOfReferenceUID: primaryMeta.frameOfReferenceUID,
        ImageOrientationPatient: primaryMeta.imageOrientationPatient,
        PixelSpacing: primaryMeta.pixelSpacing,
        SliceThickness: primaryMeta.sliceThickness,
        SpacingBetweenSlices: primaryMeta.spacingBetweenSlices,
        WindowCenter: primaryMeta.windowCenter,
        WindowWidth: primaryMeta.windowWidth,
      },
      secondarySeries: {
        SeriesInstanceUID: secondarySeries.seriesInstanceUID,
        SeriesDescription: secondarySeries.seriesDescription,
        SeriesNumber: secondarySeries.seriesNumber,
        Modality: secondarySeries.modality,
        WindowCenter: secondaryMeta.windowCenter,
        WindowWidth: secondaryMeta.windowWidth,
        RescaleIntercept: secondaryMeta.rescaleIntercept,
        RescaleSlope: secondaryMeta.rescaleSlope,
        PhotometricInterpretation: secondaryMeta.photometricInterpretation,
        SamplesPerPixel: secondaryMeta.samplesPerPixel,
        BitsAllocated: secondaryMeta.bitsAllocated,
        BitsStored: secondaryMeta.bitsStored,
        HighBit: secondaryMeta.highBit,
        PixelRepresentation: secondaryMeta.pixelRepresentation,
      },
      derivedSeries: {
        SeriesDescription: `Fused ${secondarySeries.seriesDescription ?? secondarySeries.modality ?? 'Secondary'}`,
        ImageType: imageType,
        DerivationDescription: derivationDescription,
        ReferencedSeriesInstanceUID: primarySeries.seriesInstanceUID,
        RegistrationId: transformInfo.registrationId,
        WindowCenter: secondaryMeta.windowCenter,
        WindowWidth: secondaryMeta.windowWidth,
      },
    };
  }

  private async ensureSeriesRecord(input: {
    primarySeries: any;
    secondarySeries: any;
    studyId: number;
    seriesInstanceUID: string;
    modality: string | null;
    description: string | null;
    sliceCount: number;
    transformInfo: any;
    interpolation: InterpolationMode;
  }) {
    const { primarySeries, secondarySeries, studyId, seriesInstanceUID, modality, description, sliceCount, transformInfo, interpolation } = input;

    let existing = await storage.getSeriesByUID(seriesInstanceUID);
    if (!existing) {
      existing = await storage.createSeries({
        studyId,
        seriesInstanceUID,
        seriesDescription: description,
        modality: modality ?? secondarySeries.modality ?? primarySeries.modality,
        seriesNumber: (secondarySeries.seriesNumber ?? primarySeries.seriesNumber ?? 9901) + 1000,
        imageCount: sliceCount,
        sliceThickness: secondarySeries.sliceThickness ?? primarySeries.sliceThickness ?? null,
        metadata: {
          fusion: {
            primarySeriesId: primarySeries.id,
            secondarySeriesId: secondarySeries.id,
            registrationId: transformInfo.registrationId ?? null,
            transformSource: transformInfo.transformSource ?? null,
            interpolation,
            generatedAt: new Date().toISOString(),
          },
        },
      });
    } else {
      const existingMetadata = (existing.metadata ?? {}) as Record<string, unknown>;
      await db
        .update(seriesTable)
        .set({
          seriesDescription: description,
          modality: modality ?? existing.modality,
          imageCount: sliceCount,
          metadata: {
            ...existingMetadata,
            fusion: {
              primarySeriesId: primarySeries.id,
              secondarySeriesId: secondarySeries.id,
              registrationId: transformInfo.registrationId ?? null,
              transformSource: transformInfo.transformSource ?? null,
              interpolation,
              generatedAt: new Date().toISOString(),
            },
          },
        })
        .where(eq(seriesTable.id, existing.id));
      const refreshed = await storage.getSeriesById(existing.id);
      if (refreshed) existing = refreshed;
    }

    return existing;
  }

  private async replaceSeriesImages(input: {
    seriesId: number;
    instances: any[];
    frameOfReferenceUID: string | null;
    pixelSpacing: number[] | null;
    imageOrientationPatient: number[] | null;
    primaryMeta: ReturnType<typeof loadDicomMetadata>;
    secondaryMeta: ReturnType<typeof loadDicomMetadata>;
  }) {
    const { seriesId, instances, frameOfReferenceUID, pixelSpacing, imageOrientationPatient, primaryMeta, secondaryMeta } = input;

    await db.delete(imagesTable).where(eq(imagesTable.seriesId, seriesId));

    for (const instance of instances) {
      const stats = await fs.promises.stat(instance.filePath);
      const fileSize = stats.size;
      const imageOrientation = imageOrientationPatient ?? primaryMeta.imageOrientationPatient ?? null;

      await storage.createImage({
        seriesId,
        sopInstanceUID: instance.sopInstanceUID,
        instanceNumber: instance.instanceNumber,
        filePath: instance.filePath,
        fileName: instance.fileName,
        fileSize,
        imagePosition: instance.imagePositionPatient ?? null,
        imageOrientation: imageOrientation,
        pixelSpacing: pixelSpacing ?? primaryMeta.pixelSpacing ?? null,
        sliceLocation: instance.sliceLocation != null ? String(instance.sliceLocation) : null,
        windowCenter: instance.windowCenter ? instance.windowCenter.join('\\') : null,
        windowWidth: instance.windowWidth ? instance.windowWidth.join('\\') : null,
        metadata: {
          frameOfReferenceUID,
          source: {
            primary: primaryMeta.seriesInstanceUID,
            secondary: secondaryMeta.seriesInstanceUID,
          },
        },
      });
    }
  }

  private async buildDescriptorFromExisting(input: {
    secondarySeries: any;
    aggregatedManifestPath: string;
    dicomOutputDir: string;
  }): Promise<FusionSecondaryDescriptor | null> {
    const { secondarySeries, aggregatedManifestPath, dicomOutputDir } = input;
    const manifest = await readManifestFromDisk(aggregatedManifestPath);
    if (!manifest) return null;
    const descriptor = manifest.secondaries?.find(sec => sec.secondarySeriesId === secondarySeries.id);
    if (!descriptor) return null;

    const sampleFile = path.join(dicomOutputDir, 'slice_0000.dcm');
    if (!fileExists(sampleFile)) return null;

    return createSecondaryDescriptor(descriptor, {
      secondarySeriesId: secondarySeries.id,
      secondarySeriesInstanceUID: secondarySeries.seriesInstanceUID,
      secondarySeriesDescription: secondarySeries.seriesDescription ?? descriptor.secondarySeriesDescription ?? null,
      secondaryModality: secondarySeries.modality ?? descriptor.secondaryModality ?? null,
      status: 'ready',
      error: undefined,
    });
  }
}

export const fusionManifestService = new FusionManifestService();
