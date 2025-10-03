import fs from 'fs';
import path from 'path';
import { storage } from '../storage.ts';
import { loadDicomMetadata } from './dicom-metadata.ts';
import type { FusionManifest, FusionSecondaryDescriptor, FusionInstanceDescriptor } from './types.ts';
import {
  FuseboxVolumeResampler,
  type VolumeResampleRequest,
  type InterpolationMode,
  type VolumeResampleResponse,
} from './resampler.ts';
import { collectSeriesFiles, resolveFuseboxTransform, sortImagesByInstance } from './fusebox.ts';
import { markFuseboxRunFailed, markFuseboxRunReady, markFuseboxRunStarted } from './fusebox-run-store.ts';
import type { FuseboxLogEmitter } from './fusebox.ts';

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

interface SecondaryCacheEntry {
  descriptor: FusionSecondaryDescriptor;
  buffers: Map<string, Buffer>;
}

const DEFAULT_INTERPOLATION: InterpolationMode = 'linear';
const CURRENT_MANIFEST_VERSION = 2;
const TMP_FUSEBOX_PREFIX = path.join(process.cwd(), 'tmp', 'fusebox-volume-');

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

const toInstanceDescriptor = (
  instance: any,
  primarySopInstanceUID: string | null,
  defaultPixelSpacing: [number, number] | null,
  primarySeriesId: number,
  secondarySeriesId: number,
): FusionInstanceDescriptor => {
  const pixelSpacing = Array.isArray(instance.pixelSpacing) && instance.pixelSpacing.length >= 2
    ? [Number(instance.pixelSpacing[0]), Number(instance.pixelSpacing[1])] as [number, number]
    : defaultPixelSpacing;

  const orientation = Array.isArray(instance.imageOrientationPatient) && instance.imageOrientationPatient.length >= 6
    ? [
        Number(instance.imageOrientationPatient[0]),
        Number(instance.imageOrientationPatient[1]),
        Number(instance.imageOrientationPatient[2]),
        Number(instance.imageOrientationPatient[3]),
        Number(instance.imageOrientationPatient[4]),
        Number(instance.imageOrientationPatient[5]),
      ] as [number, number, number, number, number, number]
    : null;

  const position = Array.isArray(instance.imagePositionPatient) && instance.imagePositionPatient.length >= 3
    ? [
        Number(instance.imagePositionPatient[0]),
        Number(instance.imagePositionPatient[1]),
        Number(instance.imagePositionPatient[2]),
      ] as [number, number, number]
    : null;

  const windowCenter = Array.isArray(instance.windowCenter) ? instance.windowCenter.map((v: any) => Number(v)) : null;
  const windowWidth = Array.isArray(instance.windowWidth) ? instance.windowWidth.map((v: any) => Number(v)) : null;

  const sliceLocation = typeof instance.sliceLocation === 'number'
    ? instance.sliceLocation
    : position?.[2] ?? null;

  return {
    sopInstanceUID: instance.sopInstanceUID,
    instanceNumber: Number(instance.instanceNumber ?? 0),
    fileName: instance.fileName ?? `slice_${instance.instanceNumber ?? 0}.dcm`,
    filePath: `memory://${primarySeriesId}/${secondarySeriesId}/${instance.sopInstanceUID}`,
    imagePositionPatient: position,
    imageOrientationPatient: orientation,
    pixelSpacing,
    sliceLocation,
    windowCenter,
    windowWidth,
    primarySopInstanceUID,
  };
};

const createSecondaryDescriptor = (
  base: Partial<FusionSecondaryDescriptor>,
  overrides: Partial<FusionSecondaryDescriptor>,
): FusionSecondaryDescriptor => ({
  secondarySeriesId: overrides.secondarySeriesId ?? base.secondarySeriesId!,
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
});

const cloneInstanceDescriptor = (instance: FusionInstanceDescriptor): FusionInstanceDescriptor => ({
  ...instance,
  imagePositionPatient: instance.imagePositionPatient ? [...instance.imagePositionPatient] as [number, number, number] : null,
  imageOrientationPatient: instance.imageOrientationPatient ? [...instance.imageOrientationPatient] as [number, number, number, number, number, number] : null,
  pixelSpacing: instance.pixelSpacing ? [...instance.pixelSpacing] as [number, number] : null,
  windowCenter: instance.windowCenter ? [...instance.windowCenter] : null,
  windowWidth: instance.windowWidth ? [...instance.windowWidth] : null,
});

const cloneDescriptor = (descriptor: FusionSecondaryDescriptor): FusionSecondaryDescriptor => ({
  ...descriptor,
  pixelSpacing: descriptor.pixelSpacing ? [...descriptor.pixelSpacing] as [number, number] : null,
  imageOrientationPatient: descriptor.imageOrientationPatient ? [...descriptor.imageOrientationPatient] as [number, number, number, number, number, number] : null,
  imagePositionPatientFirst: descriptor.imagePositionPatientFirst ? [...descriptor.imagePositionPatientFirst] as [number, number, number] : null,
  imagePositionPatientLast: descriptor.imagePositionPatientLast ? [...descriptor.imagePositionPatientLast] as [number, number, number] : null,
  windowCenter: descriptor.windowCenter ? [...descriptor.windowCenter] : null,
  windowWidth: descriptor.windowWidth ? [...descriptor.windowWidth] : null,
  instances: descriptor.instances.map(cloneInstanceDescriptor),
});

const buildResampleMetadata = (input: {
  primarySeries: any;
  secondarySeries: any;
  primaryMeta: ReturnType<typeof loadDicomMetadata>;
  secondaryMeta: ReturnType<typeof loadDicomMetadata>;
  transformInfo: any;
}) => {
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
};

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

export class FusionManifestService {
  private readonly manifestCache = new Map<number, FusionManifest>();
  private readonly pending = new Map<number, Promise<FusionManifest>>();
  private readonly resampler = new FuseboxVolumeResampler();
  private readonly overlays = new Map<number, Map<number, SecondaryCacheEntry>>();

  private getOverlayMap(primarySeriesId: number): Map<number, SecondaryCacheEntry> {
    let map = this.overlays.get(primarySeriesId);
    if (!map) {
      map = new Map();
      this.overlays.set(primarySeriesId, map);
    }
    return map;
  }

  async getManifest(options: ManifestRequestOptions): Promise<FusionManifest> {
    const { primarySeriesId, secondarySeriesIds = [], force = false } = options;

    if (!force && this.manifestCache.has(primarySeriesId)) {
      const cached = this.manifestCache.get(primarySeriesId)!;
      const requestedSet = new Set(secondarySeriesIds);
      const hasAllSecondaries = secondarySeriesIds.length === 0
        || secondarySeriesIds.every((id) => cached.secondaries.some((sec) => sec.secondarySeriesId === id));
      if (hasAllSecondaries) {
        return cloneManifest(cached);
      }
    }

    if (!force && this.pending.has(primarySeriesId)) {
      return cloneManifest(await this.pending.get(primarySeriesId)!);
    }

    const previous = this.manifestCache.get(primarySeriesId);
    const promise = this.buildManifest(options, previous).finally(() => {
      this.pending.delete(primarySeriesId);
    });
    this.pending.set(primarySeriesId, promise);
    const manifest = await promise;
    this.manifestCache.set(primarySeriesId, manifest);
    return cloneManifest(manifest);
  }

  getSliceBuffer(primarySeriesId: number, secondarySeriesId: number, sopInstanceUID: string): Buffer | null {
    const map = this.overlays.get(primarySeriesId);
    if (!map) return null;
    const entry = map.get(secondarySeriesId);
    if (!entry) return null;
    return entry.buffers.get(sopInstanceUID) ?? null;
  }

  clearCache(primarySeriesId: number, secondarySeriesId?: number): void {
    if (secondarySeriesId == null) {
      this.manifestCache.delete(primarySeriesId);
      this.pending.delete(primarySeriesId);
      this.overlays.delete(primarySeriesId);
      return;
    }

    const overlayMap = this.overlays.get(primarySeriesId);
    overlayMap?.delete(secondarySeriesId);
    if (overlayMap && overlayMap.size === 0) {
      this.overlays.delete(primarySeriesId);
    }

    const manifest = this.manifestCache.get(primarySeriesId);
    if (manifest) {
      const filtered = manifest.secondaries.filter((sec) => sec.secondarySeriesId !== secondarySeriesId);
      this.manifestCache.set(primarySeriesId, {
        ...manifest,
        secondaries: filtered,
      });
    }
  }

  clearAll(): void {
    this.manifestCache.clear();
    this.pending.clear();
    this.overlays.clear();
  }

  private async buildManifest(
    options: ManifestRequestOptions,
    previous: FusionManifest | undefined,
  ): Promise<FusionManifest> {
    const { primarySeriesId, secondarySeriesIds = [], force = false } = options;
    const interpolation = options.interpolation ?? DEFAULT_INTERPOLATION;
    const preload = options.preload ?? true;
    const logger = options.logger;

    const primarySeries = await storage.getSeriesById(primarySeriesId);
    if (!primarySeries) throw new Error(`Primary series ${primarySeriesId} not found`);

    const { studyId, patientId } = await resolvePatientInfo(primarySeriesId);

    const previousSettings = previous?.settings ?? null;
    const interpolationChanged = previousSettings?.interpolation && previousSettings.interpolation !== interpolation;

    const nowIso = new Date().toISOString();
    const manifest: FusionManifest = {
      manifestVersion: CURRENT_MANIFEST_VERSION,
      studyId,
      patientId,
      primarySeriesId,
      primarySeriesInstanceUID: primarySeries.seriesInstanceUID,
      primarySeriesDescription: primarySeries.seriesDescription ?? null,
      primaryModality: primarySeries.modality ?? null,
      createdAt: previous?.createdAt ?? nowIso,
      updatedAt: nowIso,
      settings: {
        interpolation,
        preload,
      },
      secondaries: [],
    };

    const overlayMap = this.overlays.get(primarySeriesId);
    let existingIds: number[] = [];
    if (overlayMap) {
      existingIds = Array.from(overlayMap.keys());
    } else if (previous) {
      existingIds = previous.secondaries.map((sec) => sec.secondarySeriesId);
    }

    const secondaryIdsToProcess = secondarySeriesIds.length ? secondarySeriesIds : existingIds;

    const processedDescriptors: FusionSecondaryDescriptor[] = [];
    const processedIds = new Set<number>();
    const effectiveForce = force || interpolationChanged;

    for (const secondarySeriesId of secondaryIdsToProcess) {
      try {
        const descriptor = await this.ensureSecondary({
          primarySeries,
          primarySeriesId,
          secondarySeriesId,
          interpolation,
          force: effectiveForce,
          resetCache: interpolationChanged,
          logger,
        });
        processedDescriptors.push(descriptor);
        processedIds.add(secondarySeriesId);
      } catch (err: any) {
        const existing = previous?.secondaries.find((sec) => sec.secondarySeriesId === secondarySeriesId);
        const message = err?.message || String(err);
        processedDescriptors.push(createSecondaryDescriptor(existing ?? {
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
        }, {
          status: 'error',
          error: message,
          generatedAt: new Date().toISOString(),
        }));
        processedIds.add(secondarySeriesId);
      }
    }

    if (overlayMap) {
      overlayMap.forEach((entry, secondaryId) => {
        if (!processedIds.has(secondaryId)) {
          processedDescriptors.push(cloneDescriptor(entry.descriptor));
        }
      });
    } else if (previous) {
      previous.secondaries.forEach((entry) => {
        if (!processedIds.has(entry.secondarySeriesId)) {
          processedDescriptors.push(cloneDescriptor(entry));
        }
      });
    }

    const order = previous?.secondaries.map((sec) => sec.secondarySeriesId) ?? [];
    const orderIndex = new Map(order.map((id, idx) => [id, idx] as const));
    processedDescriptors.sort((a, b) => {
      const aIdx = orderIndex.get(a.secondarySeriesId);
      const bIdx = orderIndex.get(b.secondarySeriesId);
      if (aIdx != null && bIdx != null && aIdx !== bIdx) return aIdx - bIdx;
      if (aIdx != null) return -1;
      if (bIdx != null) return 1;
      return a.secondarySeriesId - b.secondarySeriesId;
    });

    manifest.secondaries = processedDescriptors.map(cloneDescriptor);
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
  }): Promise<FusionSecondaryDescriptor> {
    const { primarySeries, primarySeriesId, secondarySeriesId, interpolation, force, resetCache, logger } = options;

    const overlayMap = this.getOverlayMap(primarySeriesId);
    if (!force && !resetCache && overlayMap.has(secondarySeriesId)) {
      return cloneDescriptor(overlayMap.get(secondarySeriesId)!.descriptor);
    }

    if (resetCache || force) {
      overlayMap.delete(secondarySeriesId);
    }

    const secondarySeries = await storage.getSeriesById(secondarySeriesId);
    if (!secondarySeries) {
      throw new Error(`Secondary series ${secondarySeriesId} not found`);
    }

    const primaryFiles = await collectSeriesFiles(primarySeriesId);
    const secondaryFiles = await collectSeriesFiles(secondarySeriesId);
    if (!primaryFiles.length || !secondaryFiles.length) {
      throw new Error('Primary or secondary series missing DICOM files');
    }

    const [primaryImages, secondaryImages] = await Promise.all([
      storage.getImagesBySeriesId(primarySeriesId),
      storage.getImagesBySeriesId(secondarySeriesId),
    ]);

    const sortedPrimaryImages = sortImagesByInstance(primaryImages || []);
    const sortedSecondaryImages = sortImagesByInstance(secondaryImages || []);
    const primaryFirstFile = sortedPrimaryImages[0]?.filePath || primaryFiles[0];
    const secondaryFirstFile = sortedSecondaryImages[0]?.filePath || secondaryFiles[0];

    const primaryMeta = loadDicomMetadata(primaryFirstFile);
    const secondaryMeta = loadDicomMetadata(secondaryFirstFile);

    const transformInfo = await resolveFuseboxTransform(primarySeriesId, secondarySeriesId, undefined, logger);
    if (!transformInfo || (!transformInfo.matrix && !transformInfo.transformFile)) {
      throw new Error('Registration transform unavailable for series pair');
    }

    const outputBase = path.join(process.cwd(), 'tmp');
    await fs.promises.mkdir(outputBase, { recursive: true });
    const pairRoot = await fs.promises.mkdtemp(TMP_FUSEBOX_PREFIX);

    const metadataPayload = buildResampleMetadata({
      primarySeries,
      secondarySeries,
      primaryMeta,
      secondaryMeta,
      transformInfo,
    });

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

    const baseRunContext = {
      primarySeriesId,
      secondarySeriesId,
      registrationId: transformInfo.registrationId ?? null,
      transformSource: transformInfo.transformSource ?? null,
      outputDirectory: 'memory',
      manifestPath: 'memory',
    } as const;

    await markFuseboxRunStarted(baseRunContext);

    let response: VolumeResampleResponse | null = null;
    const buffers = new Map<string, Buffer>();

    try {
      response = await this.resampler.execute(request);
      if (!response) {
        throw new Error('Fusebox resample failed');
      }

      const frameOfReferenceUID = response.frameOfReferenceUID
        || primaryMeta.frameOfReferenceUID
        || secondaryMeta.frameOfReferenceUID
        || null;

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

      const primaryPositionMap = sortedPrimaryImages.map((image, index) => ({
        sopInstanceUID: image?.sopInstanceUID ?? null,
        index,
        position: parsePosition(
          image?.imagePositionPatient
            ?? image?.imagePosition
            ?? image?.metadata?.imagePositionPatient
            ?? image?.metadata?.imagePosition,
        ),
      }));

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

        const fallback = sortedPrimaryImages[fallbackIndex];
        if (fallback?.sopInstanceUID) return fallback.sopInstanceUID;
        const candidate = primaryPositionMap[fallbackIndex];
        return candidate?.sopInstanceUID ?? null;
      };

      const responseInstances = Array.isArray(response.instances) ? response.instances : [];

      for (const inst of responseInstances) {
        if (!inst?.filePath) continue;
        const buffer = await fs.promises.readFile(inst.filePath);
        buffers.set(inst.sopInstanceUID, buffer);
      }

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
        windowCenter: Array.isArray(response.windowCenter) ? response.windowCenter.map((v) => Number(v)) : null,
        windowWidth: Array.isArray(response.windowWidth) ? response.windowWidth.map((v) => Number(v)) : null,
        outputDirectory: 'memory',
        manifestPath: 'memory',
        instances: responseInstances.map((inst, idx) => {
          return toInstanceDescriptor(inst, resolvePrimarySopForInstance(inst, idx), pixelSpacing, primarySeriesId, secondarySeriesId);
        }),
      };

      overlayMap.set(secondarySeriesId, {
        descriptor,
        buffers,
      });

      await markFuseboxRunReady({
        ...baseRunContext,
        sliceCount: descriptor.sliceCount,
        rows: descriptor.rows,
        columns: descriptor.columns,
      });

      return cloneDescriptor(descriptor);
    } catch (err: any) {
      const message = err?.message || String(err);
      await markFuseboxRunFailed({
        ...baseRunContext,
        error: message,
      });
      overlayMap.delete(secondarySeriesId);
      throw err;
    } finally {
      await fs.promises.rm(pairRoot, { recursive: true, force: true }).catch(() => {});
    }
  }
}

const cloneManifest = (manifest: FusionManifest): FusionManifest => ({
  ...manifest,
  settings: { ...manifest.settings },
  secondaries: manifest.secondaries.map(cloneDescriptor),
});

export const fusionManifestService = new FusionManifestService();
