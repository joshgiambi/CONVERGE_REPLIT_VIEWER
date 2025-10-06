import { useEffect, useRef, useState, forwardRef, useImperativeHandle, useCallback, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Ruler } from "lucide-react";
import { SimpleBrushTool } from "./simple-brush-tool";
import { PenToolUnifiedV2 } from "./pen-tool-unified-v2";
import { EclipsePlanarContourTool } from "./eclipse-planar-contour-tool";
import { PenTool } from "./pen-tool";
import PenToolV2 from "./pen-tool-v2";

import { MeasurementTool } from "./measurement-tool";
import { MPRFloating } from './mpr-floating';
import { BrushOperation } from "@shared/schema";
import { growContour } from "@/lib/contour-grow";
import { gaussianSmoothContour as smoothContour } from "@/lib/contour-smooth-simple";
import {
  addBrushToContour,
  eraseBrushFromContour,
  mergeBrushWithContour,
  brushStrokeToPolishedPolygon,
} from "@/lib/brush-to-polygon";
import { applyDirectionalGrow } from "@/lib/contour-directional-grow";
import { naiveCombineContours as combineContours, naiveSubtractContours as subtractContours } from "@/lib/contour-boolean-operations";
import { predictNextSliceContour } from "@/lib/contour-prediction";
import { getFusedSlice, getFusedSliceSmart, fuseboxSliceToImageData, clearFusionSlices, getFusionManifest } from "@/lib/fusion-utils";
import type { FuseboxSlice } from "@/lib/fusion-utils";
import { performPolygonUnion, polygonUnion } from "@/lib/polygon-union";
import { doPolygonsIntersectSimple, unionMultipleContoursSimple, growContourSimple } from "@/lib/simple-polygon-operations";
import { undoRedoManager } from "@/lib/undo-system";
import { attachDiceDebug } from "@/lib/dice-utils";
import { 
  isGPUAccelerationAvailable,
  initializeCornerstone3D,
  render16BitImageGPU
} from "@/lib/cornerstone3d-adapter";
import { log } from '@/lib/log';
import { createOrUpdateGPUViewport, hideGPUViewport, cleanupGPUViewports } from "@/lib/gpu-viewport-manager";
import { getDicomWorkerManager, destroyDicomWorkerManager } from '@/lib/dicom-worker-manager';
import { getSliceZ, sameSlice, getSpacing, getRescaleParams, SLICE_TOL_MM } from "@/lib/dicom-spatial-helpers";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import type { RegistrationAssociation, RegistrationTransformCandidate, RegistrationSeriesDetail } from '@/types/fusion';

// Debug flags - more granular control over logging
const DEBUG = false; // TEMP: disabled permanently - console spam was causing performance issues
const RT_STRUCTURE_DEBUG = false; // Set to true when specifically debugging RT structures

// Typed preview contour interface for consistency
type PreviewContour = { 
  points: number[]; 
  slicePosition: number; 
  meta?: { margin?: number; type?: string };
};

type RegistrationOption = {
  id: string | null;
  label: string;
  relationship: RegistrationAssociation['relationship'];
  regFile: string | null;
  matrix: number[] | null;
  association: RegistrationAssociation;
  candidate?: RegistrationTransformCandidate | null;
  sourceDetail: RegistrationSeriesDetail | null;
  targetDetail: RegistrationSeriesDetail | null;
};

const IDENTITY_MATRIX_4X4 = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
] as const;

const cloneIdentityMatrix = () => Array.from(IDENTITY_MATRIX_4X4);

const matricesEqual = (a: number[] | null, b: number[] | null) => {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (Math.abs(a[i] - b[i]) > 1e-6) return false;
  }
  return true;
};

// Using doPolygonsIntersectSimple from simple-polygon-operations for consistency

interface WorkingViewerProps {
  seriesId: number;
  studyId?: number;
  windowLevel?: { window: number; level: number };
  onWindowLevelChange?: (windowLevel: {
    window: number;
    level: number;
  }) => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onResetZoom?: () => void;
  rtStructures?: any;
  structureVisibility?: Map<number, boolean>;
  brushToolState?: {
    tool: string | null;
    brushSize: number;
    isActive: boolean;
    predictionEnabled?: boolean;
    smartBrushEnabled?: boolean;
  };
  selectedForEdit?: number | null;
  selectedStructures?: Set<number>;
  onBrushSizeChange?: (size: number) => void;
  onBrushToolChange?: (state: {
    tool: string | null;
    brushSize: number;
    isActive: boolean;
    predictionEnabled?: boolean;
    smartBrushEnabled?: boolean;
  }) => void;
  onContourUpdate?: (updatedStructures: any) => void;
  onRTStructureUpdate?: (structures: any) => Promise<void>;
  contourSettings?: { width: number; opacity: number };
  autoZoomLevel?: number;
  autoLocalizeTarget?: { x: number; y: number; z: number };
  onSlicePositionChange?: (slicePosition: number) => void;
  secondarySeriesId?: number | null;
  fusionOpacity?: number;
  fusionDisplayMode?: 'overlay' | 'side-by-side';
  onSecondarySeriesSelect?: (id: number | null) => void;
  onFusionOpacityChange?: (opacity: number) => void;
  hasSecondarySeriesForFusion?: boolean;
  onImageMetadataChange?: (metadata: any) => void;
  allStructuresVisible?: boolean;
  imageCache?: React.MutableRefObject<Map<string, { images: any[], metadata: any }>>;
  orientation?: 'axial' | 'sagittal' | 'coronal';
  onMPRToggle?: () => void;
  isMPRVisible?: boolean;
  availableSeries?: Array<{
    id: number;
    modality?: string;
    seriesDescription?: string;
    imageCount?: number;
    studyId?: number;
  }>;
  allowedSecondaryIds?: number[];
  registrationAssociations?: Map<number, RegistrationAssociation[]>;
  fusionWindowLevel?: { window: number; level: number } | null;
  fusionSecondaryStatuses?: Map<number, { status: 'idle' | 'loading' | 'ready' | 'error'; error?: string | null }>;
  fusionManifestLoading?: boolean;
  fusionManifestPrimarySeriesId?: number | null;
}

const WorkingViewer = forwardRef(function WorkingViewerComponent(props: WorkingViewerProps, ref: any) {
  const {
    seriesId,
    studyId,
    windowLevel: externalWindowLevel,
    onWindowLevelChange,
    onZoomIn,
    onZoomOut,
    onResetZoom,
    rtStructures: externalRTStructures,
    structureVisibility: externalStructureVisibility,
    brushToolState,
    selectedForEdit,
    selectedStructures,
    onBrushSizeChange,
    onBrushToolChange,
    onContourUpdate,
    onRTStructureUpdate,
    contourSettings,
    autoZoomLevel,
    autoLocalizeTarget,
    onSlicePositionChange,
    secondarySeriesId: externalSecondarySeriesId,
    fusionOpacity: externalFusionOpacity = 0.5,
    fusionDisplayMode = 'overlay',
    onSecondarySeriesSelect,
    onFusionOpacityChange,
    hasSecondarySeriesForFusion,
    onImageMetadataChange,
    allStructuresVisible = true,
    imageCache,
    orientation = 'axial',
    availableSeries,
    registrationAssociations,
    fusionWindowLevel,
    fusionSecondaryStatuses,
    fusionManifestLoading = false,
    fusionManifestPrimarySeriesId = null,
  } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fusionOverlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const contoursOverlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const sagittalCanvasRef = useRef<HTMLCanvasElement>(null);
  const coronalCanvasRef = useRef<HTMLCanvasElement>(null);
  const [images, setImages] = useState<any[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Use external RT structures if provided, otherwise load our own
  const [localRTStructures, setLocalRTStructures] =
    useState(externalRTStructures);
  const rtStructures = localRTStructures || externalRTStructures;
  const structureVisibility = externalStructureVisibility || new Map();
  // Use prop directly instead of local state
  const showStructures = allStructuresVisible ?? true;
  const [renderTrigger, setRenderTrigger] = useState(0);
  const [animationTime, setAnimationTime] = useState(0);
  const [predictedContours, setPredictedContours] = useState<Map<string, any>>(new Map());
  const [previewContours, setPreviewContours] = useState<PreviewContour[]>([]);
  const [testPredictionAdded, setTestPredictionAdded] = useState(false);
  const [imageMetadata, setImageMetadata] = useState<any>(null);
  const [dicomPixelData, setDicomPixelData] = useState<any>(null);
  
  // GPU acceleration state for hybrid rendering
  const [isGPUMode, setIsGPUMode] = useState(false);
  const [gpuCheckComplete, setGpuCheckComplete] = useState(false);
  const [cornerstone3DInitialized, setCornerstone3DInitialized] = useState(false);
  const [prefetchProgress, setPrefetchProgress] = useState({ loaded: 0, total: 0 });
  // Blob tools dialog state
  const [blobDialogOpen, setBlobDialogOpen] = useState(false);
  const [blobDialogData, setBlobDialogData] = useState<null | {
    structureId: number;
    blobs: Array<{ id: number; volumeCc: number; contours: Array<{ slicePosition: number; points: number[]; numberOfPoints: number }> }>;
  }>(null);
  const [selectedBlobIdsToDelete, setSelectedBlobIdsToDelete] = useState<Set<number>>(new Set());
  const [isPreloading, setIsPreloading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isMeasurementToolActive, setIsMeasurementToolActive] = useState(false);
  const [isLoadingMPR, setIsLoadingMPR] = useState(false);
  // Use external MPR visibility state or fallback to internal state
  const mprVisible = props.isMPRVisible ?? false;
  
  const secondarySeriesId = externalSecondarySeriesId; // Use external prop directly instead of local state
  const fusionOpacity = externalFusionOpacity !== undefined ? externalFusionOpacity : 0.5;
  const [registrationMatrix, setRegistrationMatrix] = useState<number[] | null>(null);
  const registrationMatrixRef = useRef<number[] | null>(null);
  const [secondaryModality, setSecondaryModality] = useState<string>('MR');
  const [fuseboxTransformSource, setFuseboxTransformSource] = useState<FuseboxSlice['transformSource'] | null>(null);
  const [selectedRegistrationId, setSelectedRegistrationId] = useState<string | null>(null);
  const [registrationAssociationsForPrimary, setRegistrationAssociationsForPrimary] = useState<RegistrationAssociation[]>([]);
  // Fusion debug support
  const [showFusionDebug, setShowFusionDebug] = useState(false);
  const [fusionDebugText, setFusionDebugText] = useState('');
  const [fusionLogs, setFusionLogs] = useState<string[]>([]);
  const [showRegDetails, setShowRegDetails] = useState(false);
  const [regDetailsText, setRegDetailsText] = useState('');
  const [lastResolveInfo, setLastResolveInfo] = useState<any>(null);
  const fusionIssueRef = useRef<string | null>(null);
  const missingMatrixLogRef = useRef(false);
  const fuseboxCacheRef = useRef<Map<string, {
    canvas: HTMLCanvasElement;
    slice: FuseboxSlice;
    timestamp: number;
    hasSignal: boolean;
  }>>(new Map());
  // CT transform for fusion coordinate system alignment
  const ctTransform = useRef<{scale: number, offsetX: number, offsetY: number, imageWidth: number, imageHeight: number} | null>(null);
  const scheduleRenderRef = useRef<(() => void) | null>(null);
  const fusionRequestTokenRef = useRef(0);
  const fusionPrefetchSetRef = useRef<Set<string>>(new Set());

  const parseImagePosition = useCallback((image: any): [number, number, number] | null => {
    if (!image) return null;
    const direct = Array.isArray(image.imagePositionPatient) ? image.imagePositionPatient : null;
    if (direct && direct.length >= 3) {
      const coords = direct.map((value: any) => Number(value)) as [number, number, number];
      if (coords.every((value) => Number.isFinite(value))) return coords;
    }
    const metaArray = Array.isArray(image.metadata?.imagePositionPatient) ? image.metadata.imagePositionPatient : null;
    if (metaArray && metaArray.length >= 3) {
      const coords = metaArray.map((value: any) => Number(value)) as [number, number, number];
      if (coords.every((value) => Number.isFinite(value))) return coords;
    }
    const rawString = typeof image.imagePosition === 'string'
      ? image.imagePosition
      : (typeof image.metadata?.imagePosition === 'string' ? image.metadata.imagePosition : null);
    if (rawString) {
      const parts = rawString.split('\\').map((part: string) => Number(part.trim()));
      if (parts.length >= 3 && parts.every((value) => Number.isFinite(value))) {
        return [parts[0], parts[1], parts[2]];
      }
    }
    return null;
  }, []);

  const registrationOptions = useMemo<RegistrationOption[]>(() => {
    if (secondarySeriesId == null) {
      console.log('registrationOptions: no secondary selected');
      return [];
    }
    const secondaryId = Number(secondarySeriesId);
    if (!Number.isFinite(secondaryId)) {
      console.log('registrationOptions: secondary not finite', secondarySeriesId);
      return [];
    }

    const describeSeries = (detail: RegistrationSeriesDetail | null | undefined) => {
      if (!detail) return null;
      const modality = detail.modality ? detail.modality.toUpperCase() : null;
      const description = detail.description?.trim();
      const fallbackId = detail.id != null ? `Series ${detail.id}` : null;
      if (modality && description) return `${modality} · ${description}`;
      if (modality) return `${modality} · ${description || fallbackId || detail.uid || 'Series'}`;
      if (description) return description;
      if (fallbackId) return fallbackId;
      if (detail.uid) return detail.uid;
      return null;
    };

    const options: RegistrationOption[] = [];
    const seenOptionKeys = new Set<string>();

    for (const assoc of registrationAssociationsForPrimary) {
      const siblingIds = Array.isArray(assoc.siblingSeriesIds)
        ? assoc.siblingSeriesIds.map((id: any) => Number(id)).filter(Number.isFinite)
        : [];
      const sourceIds = Array.isArray(assoc.sourcesSeriesIds)
        ? assoc.sourcesSeriesIds.map((id: any) => Number(id)).filter(Number.isFinite)
        : [];

      const isShared = assoc.relationship === 'shared-frame' && siblingIds.includes(secondaryId);
      const isRegistered = assoc.relationship === 'registered' && sourceIds.includes(secondaryId);
      if (!isShared && !isRegistered) continue;

      const sourceDetail = Array.isArray(assoc.sourceSeriesDetails)
        ? assoc.sourceSeriesDetails.find(detail => detail?.id === secondaryId) || null
        : null;
      const targetDetail = assoc.targetSeriesDetail ?? null;
      const sourceLabel = describeSeries(sourceDetail) ?? `Series ${secondaryId}`;
      const targetLabel = describeSeries(targetDetail) ?? 'Primary CT';

      if (assoc.relationship === 'shared-frame') {
        const key = `${assoc.regFile || 'shared'}:${secondaryId}:shared`;
        if (seenOptionKeys.has(key)) continue;
        seenOptionKeys.add(key);
        options.push({
          id: null,
          label: `Shared FoR · ${sourceLabel}`,
          relationship: assoc.relationship,
          regFile: assoc.regFile,
          matrix: cloneIdentityMatrix(),
          association: assoc,
          candidate: null,
          sourceDetail,
          targetDetail,
        });
        continue;
      }

      const candidates = Array.isArray(assoc.transformCandidates) ? assoc.transformCandidates : [];
      if (!candidates.length) {
        const key = `${assoc.regFile || 'reg'}:${secondaryId}:default`;
        if (seenOptionKeys.has(key)) continue;
        seenOptionKeys.add(key);
        const baseName = assoc.regFile ? assoc.regFile.split(/[\\/]/).pop() : null;
        options.push({
          id: null,
          label: baseName ? `${sourceLabel} → ${targetLabel} (${baseName})` : `${sourceLabel} → ${targetLabel}`,
          relationship: assoc.relationship,
          regFile: assoc.regFile,
          matrix: null,
          association: assoc,
          candidate: null,
          sourceDetail,
          targetDetail,
        });
        continue;
      }

      candidates.forEach((cand, idx) => {
        if (!Array.isArray(cand.matrix) || cand.matrix.length !== 16) return;
        const regFile = cand.regFile || assoc.regFile;
        const suffixIndex = typeof cand.id === 'string' && cand.id.includes('::')
          ? Number(cand.id.split('::')[1])
          : idx;
        const candidateNumber = Number.isFinite(suffixIndex) ? (Number(suffixIndex) + 1) : (idx + 1);
        const candidateLabel = candidates.length > 1 ? ` (candidate ${candidateNumber})` : '';
        const label = `${sourceLabel} → ${targetLabel}${candidateLabel}`;
        const key = `${regFile || 'reg'}:${secondaryId}:${cand.id ?? candidateNumber}`;
        if (seenOptionKeys.has(key)) return;
        seenOptionKeys.add(key);
        options.push({
          id: cand.id ?? `${regFile || 'reg'}::${candidateNumber}`,
          label,
          relationship: assoc.relationship,
          regFile: regFile ?? null,
          matrix: cand.matrix.slice(),
          association: assoc,
          candidate: cand,
          sourceDetail,
          targetDetail,
        });
      });
    }
    console.log('registration options', { secondaryId, options, registrationAssociationsForPrimary });
    return options;
  }, [registrationAssociationsForPrimary, secondarySeriesId]);

  const buildFuseboxCacheKey = useCallback(
    (sopInstanceUID: string, secondaryId: number, registrationId: string | null) =>
      `${sopInstanceUID}:${secondaryId}:${registrationId ?? 'default'}`,
    [],
  );

  const clearFusionOverlayCanvas = useCallback(() => {
    const overlayCanvas = fusionOverlayCanvasRef.current;
    if (!overlayCanvas) return;
    const ctx = overlayCanvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  }, []);

  const updateFusionOverlayCanvas = useCallback(
    (
      overlaySource: HTMLCanvasElement | null,
      transform: { scale: number; offsetX: number; offsetY: number; imageWidth: number; imageHeight: number } | null,
      hasSignal: boolean,
    ) => {
      const overlayCanvas = fusionOverlayCanvasRef.current;
      const baseCanvas = canvasRef.current;
      if (!overlayCanvas || !baseCanvas) return;
      const ctx = overlayCanvas.getContext('2d');
      if (!ctx) return;

      if (overlayCanvas.width !== baseCanvas.width || overlayCanvas.height !== baseCanvas.height) {
        overlayCanvas.width = baseCanvas.width;
        overlayCanvas.height = baseCanvas.height;
      }

      ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
      if (!overlaySource || !transform || !hasSignal) return;

      const targetWidth = transform.imageWidth * transform.scale;
      const targetHeight = transform.imageHeight * transform.scale;
      if (targetWidth === 0 || targetHeight === 0) return;

      const widthScale = targetWidth / overlaySource.width;
      const heightScale = targetHeight / overlaySource.height;

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(
        overlaySource,
        0,
        0,
        overlaySource.width,
        overlaySource.height,
        transform.offsetX,
        transform.offsetY,
        overlaySource.width * widthScale,
        overlaySource.height * heightScale,
      );
    },
    [canvasRef, fusionOverlayCanvasRef],
  );

  const convertSliceToCanvas = useCallback(
    (slice: FuseboxSlice, defaultModality: string) => {
      const { imageData, hasSignal } = fuseboxSliceToImageData(
        slice,
        slice.secondaryModality ?? defaultModality,
        fusionWindowLevel,
      );
      const overlayCanvas = document.createElement('canvas');
      overlayCanvas.width = slice.width;
      overlayCanvas.height = slice.height;
      const overlayCtx = overlayCanvas.getContext('2d');
      if (!overlayCtx) return null;
      overlayCtx.putImageData(imageData, 0, 0);
      return { canvas: overlayCanvas, slice, hasSignal };
    },
    [fusionWindowLevel],
  );

  useEffect(() => {
    const entries = Array.from(fuseboxCacheRef.current.entries());
    if (!entries.length) return;
    const updatedCache = new Map<string, { canvas: HTMLCanvasElement; slice: FuseboxSlice; timestamp: number; hasSignal: boolean }>();
    entries.forEach(([key, value]) => {
      const updated = convertSliceToCanvas(value.slice, value.slice.secondaryModality ?? secondaryModality ?? '');
      if (updated) {
        updatedCache.set(key, { ...updated, timestamp: Date.now() });
      }
    });
    if (updatedCache.size) {
      fuseboxCacheRef.current = updatedCache;
      setRenderTrigger((prev) => prev + 1);
    }
  }, [convertSliceToCanvas, secondaryModality]);

  const FUSION_CACHE_MAX_AGE_MS = 45000;
  const FUSION_PREFETCH_RADIUS = 3;

  const prefetchFusionSlices = useCallback(
    (centerIndex: number) => {
      if (!secondarySeriesId || !images.length) return;
      // Gate prefetch on manifest readiness to avoid 'manifest not loaded' errors
      const status = fusionSecondaryStatuses?.get(secondarySeriesId);
      const manifestMatches = Number(fusionManifestPrimarySeriesId) === Number(seriesId);
      const localManifest = getFusionManifest(seriesId);
      const localReady = !!localManifest && localManifest.secondaries.some((s) => s.secondarySeriesId === secondarySeriesId && s.status === 'ready');
      if (fusionManifestLoading || status?.status !== 'ready' || !manifestMatches || !localReady) {
        return;
      }

      const registrationId = selectedRegistrationId ?? null;

      for (let offset = -FUSION_PREFETCH_RADIUS; offset <= FUSION_PREFETCH_RADIUS; offset += 1) {
        const targetIndex = centerIndex + offset;
        if (targetIndex < 0 || targetIndex >= images.length) continue;
        const targetImage = images[targetIndex];
        const sop = targetImage?.sopInstanceUID;
        if (!sop) continue;
        const key = buildFuseboxCacheKey(sop, secondarySeriesId, registrationId);
        if (fuseboxCacheRef.current.has(key) || fusionPrefetchSetRef.current.has(key)) continue;

        fusionPrefetchSetRef.current.add(key);
        const instNumber = Number(targetImage.instanceNumber ?? targetImage.metadata?.instanceNumber ?? NaN);
        const preferredIndex = Number.isFinite(instNumber) ? instNumber - 1 : targetIndex;
        const preferredPosition = parseImagePosition(targetImage);
        getFusedSlice(seriesId, secondarySeriesId, sop)
          .catch((error) => {
            if (error instanceof Error && error.message.includes('not found in manifest')) {
              return getFusedSliceSmart(
                seriesId,
                secondarySeriesId,
                sop,
                Number.isFinite(instNumber) ? instNumber : null,
                preferredIndex,
                preferredPosition,
              );
            }
            throw error;
          })
          .then((slice) => {
            const prepared = convertSliceToCanvas(slice, secondaryModality);
            if (prepared) {
              fuseboxCacheRef.current.set(key, { ...prepared, timestamp: Date.now() });
            }
          })
          .catch((error) => {
            if (import.meta.env.DEV) {
              console.warn('Fusion prefetch failed', error);
            }
          })
          .finally(() => {
            fusionPrefetchSetRef.current.delete(key);
          });
      }
    },
    [
      buildFuseboxCacheKey,
      convertSliceToCanvas,
      images,
      secondaryModality,
      secondarySeriesId,
      selectedRegistrationId,
      seriesId,
      fusionManifestLoading,
      fusionSecondaryStatuses,
      fusionManifestPrimarySeriesId,
    ],
  );

  useEffect(() => {
    const activeSeriesId = seriesId;
    return () => {
      fuseboxCacheRef.current.clear();
      clearFusionSlices(activeSeriesId);
    };
  }, [seriesId]);

  // Zoom and pan state
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  
  const compileFusionDebug = useCallback(() => {
    try {
      const primaryFirst: any = images?.[0];
      const pFoR = (primaryFirst?.metadata?.frameOfReferenceUID || primaryFirst?.frameOfReferenceUID || primaryFirst?.imageMetadata?.frameOfReferenceUID || '');
      const cacheSnapshot = Array.from(fuseboxCacheRef.current.entries()).map(([key, entry]) => ({
        key,
        sliceIndex: entry.slice.sliceIndex,
        modality: entry.slice.secondaryModality,
        dimensions: `${entry.slice.width}x${entry.slice.height}`,
        ageMs: Date.now() - entry.timestamp,
        hasSignal: entry.hasSignal,
        transformSource: entry.slice.transformSource,
      }));

      let derivedReason: string = fusionIssueRef.current || 'manual';
      if (!fusionIssueRef.current) {
        if (!secondarySeriesId) {
          derivedReason = 'no-secondary-series';
        } else if (cacheSnapshot.length === 0) {
          derivedReason = 'waiting-for-cache';
        } else {
          derivedReason = 'ok';
        }
      }

      const debug = {
        reason: derivedReason,
        primarySeriesId: seriesId,
        secondarySeriesId,
        primaryFoR: pFoR,
        registrationMatrixLength: registrationMatrix?.length || 0,
        registrationMatrix,
        resolve: lastResolveInfo,
        cacheSize: cacheSnapshot.length,
        cache: cacheSnapshot,
        transformSource: fuseboxTransformSource,
        ctTransform: ctTransform.current,
        registrationId: selectedRegistrationId,
        registrationOptions,
        logs: fusionLogs.slice(-50),
      };
      
      // Assign to window for debugging
      (window as any).__fusion = debug;
      console.log('🐟 FUSION: Assigned debug to window.__fusion', debug.reason);
      
      return JSON.stringify(debug, null, 2);
    } catch (e) {
      return `Failed to compile debug: ${String(e)}`;
    }
  }, [images, seriesId, secondarySeriesId, registrationMatrix, lastResolveInfo, fusionLogs, fuseboxTransformSource, selectedRegistrationId, registrationOptions]);

  const pushFusionLog = useCallback((msg: string, data?: any) => {
    const line = `[${new Date().toISOString()}] ${msg}${data !== undefined ? ' ' + (()=>{ try { return JSON.stringify(data); } catch { return String(data); } })() : ''}`;
    setFusionLogs(prev => {
      const next = [...prev, line];
      return next.length > 200 ? next.slice(next.length - 200) : next;
    });
  }, []);

  const handleRegistrationSelect = useCallback((registrationId: string | null) => {
    setSelectedRegistrationId(registrationId);
    fuseboxCacheRef.current.clear();
    clearFusionSlices(seriesId);
    setFuseboxTransformSource(null);
    scheduleRenderRef.current?.();
  }, [seriesId]);

  const openFusionDebug = useCallback((reason: string) => {
    fusionIssueRef.current = reason;
    const txt = compileFusionDebug();
    setFusionDebugText(txt);
    setShowFusionDebug(true);
  }, [compileFusionDebug]);

  const openRegDetails = useCallback(async () => {
    try {
      const lines: string[] = [];
      lines.push('=== Current Applied Registration (viewer) ===');
      if (registrationMatrix && registrationMatrix.length === 16) {
        const R = [
          [registrationMatrix[0], registrationMatrix[1], registrationMatrix[2]],
          [registrationMatrix[4], registrationMatrix[5], registrationMatrix[6]],
          [registrationMatrix[8], registrationMatrix[9], registrationMatrix[10]],
        ];
        const T = [registrationMatrix[3], registrationMatrix[7], registrationMatrix[11]];
        const sy = Math.sqrt(R[0][0]*R[0][0] + R[1][0]*R[1][0]);
        let rx=0, ry=0, rz=0; if (sy>1e-6){ rx=Math.atan2(R[2][1],R[2][2]); ry=Math.atan2(-R[2][0],sy); rz=Math.atan2(R[1][0],R[0][0]); }
        const deg=(r:number)=> (r*180/Math.PI);
        lines.push(`T (mm): [${T.map(v=>v.toFixed(4)).join(', ')}]`);
        lines.push(`R (deg ZYX): [${deg(rx).toFixed(4)}, ${deg(ry).toFixed(4)}, ${deg(rz).toFixed(4)}]`);
      } else {
        lines.push('No registration matrix applied');
      }

      if (seriesId && secondarySeriesId) {
        lines.push('');
        lines.push('=== Candidates from DICOM REG (server) ===');
        const url = `/api/registration/inspect-all?primarySeriesId=${seriesId}&secondarySeriesId=${secondarySeriesId}`;
        const r = await fetch(url, { cache: 'no-store' as RequestCache });
        if (r.ok) {
          const data = await r.json();
          const cands: any[] = data?.candidates || [];
          if (cands.length === 0) {
            lines.push('No candidates found');
          } else {
            cands.forEach((c, idx) => {
              const file = (c.file||'').split('/').pop();
              const asT = c.asIs?.translationMm || [];
              const asR = c.asIs?.rotationDegZYX || {};
              const ivT = c.inverted?.translationMm || [];
              const ivR = c.inverted?.rotationDegZYX || {};
              lines.push(`-- Candidate ${idx+1}: ${file}`);
              lines.push(`   FoR src=${c.sourceFoR||'?'}, tgt=${c.targetFoR||'?'}`);
              lines.push(`   asIs  T (mm): [${asT.map((v:number)=>v.toFixed(4)).join(', ')}]  R(deg ZYX): [${(asR.x??0).toFixed(4)}, ${(asR.y??0).toFixed(4)}, ${(asR.z??0).toFixed(4)}]`);
              lines.push(`   inv   T (mm): [${ivT.map((v:number)=>v.toFixed(4)).join(', ')}]  R(deg ZYX): [${(ivR.x??0).toFixed(4)}, ${(ivR.y??0).toFixed(4)}, ${(ivR.z??0).toFixed(4)}]`);
            });
          }
        } else {
          lines.push(`Failed to fetch candidates: ${r.status}`);
        }
      }

      setRegDetailsText(lines.join('\n'));
      setShowRegDetails(true);
    } catch (e: any) {
      setRegDetailsText(`Failed to compile REG details: ${String(e?.message||e)}`);
      setShowRegDetails(true);
    }
  }, [registrationMatrix, seriesId, secondarySeriesId]);

  // Crosshair position for MPR views (in pixel coordinates)
  // Initialize to center of first image, fallback to 256 for 512x512 default
  const [crosshairPos, setCrosshairPos] = useState(() => {
    const defaultWidth = 512;
    const defaultHeight = 512;
    return { x: defaultWidth / 2, y: defaultHeight / 2 };
  });
  const [crosshairMode, setCrosshairMode] = useState(false);
  const [isPanMode, setIsPanMode] = useState(true); // Pan mode is default
  
  // Update crosshair position to image center when images load
  useEffect(() => {
    if (images.length > 0 && images[0]) {
      const imageWidth = images[0].columns || images[0].width || 512;
      const imageHeight = images[0].rows || images[0].height || 512;
      setCrosshairPos(prev => {
        // Only update if the dimensions are different from current calculation
        const expectedX = imageWidth / 2;
        const expectedY = imageHeight / 2;
        if (Math.abs(prev.x - expectedX) > 1 || Math.abs(prev.y - expectedY) > 1) {
          console.log(`🐟 FUSION: Updating crosshair position to image center: ${expectedX}, ${expectedY}`);
          return { x: expectedX, y: expectedY };
        }
        return prev;
      });
    }
  }, [images]);
  
  // Monitor currentIndex changes to detect unexpected auto-scrolling
  const lastCurrentIndex = useRef<number>(0);
  useEffect(() => {
    const prev = lastCurrentIndex.current;
    const current = currentIndex;
    
    // Detect large jumps that weren't triggered by user navigation
    const jumpSize = Math.abs(current - prev);
    if (jumpSize > 10 && images.length > 0) {
      console.warn(`🚨 UNEXPECTED SLICE JUMP: ${prev} → ${current} (jump: ${jumpSize})`);
      console.trace('Slice jump stack trace');
    }
    
    lastCurrentIndex.current = current;
  }, [currentIndex, images.length]);
  
  // Render scheduling to prevent redundant renders
  const needsRenderRef = useRef(false);
  const displayCurrentImageRef = useRef<() => Promise<void>>();
  const prefetchCompleteRef = useRef(false);
  
  // Frame rate limiting for smoother scrolling
  const lastRenderTimeRef = useRef<number>(0);
  const RENDER_THROTTLE_MS = 16; // 60fps max
  const fusionRenderDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const isScrollingRef = useRef(false);
  
  const scheduleRender = useCallback(() => {
    if (needsRenderRef.current) return;
    needsRenderRef.current = true;
    
    // Mark as scrolling for fusion optimization
    isScrollingRef.current = true;
    if (fusionRenderDebounceRef.current) {
      clearTimeout(fusionRenderDebounceRef.current);
    }
    
    // Throttle renders during rapid scrolling
    const now = performance.now();
    const timeSinceLastRender = now - lastRenderTimeRef.current;
    
    if (timeSinceLastRender < RENDER_THROTTLE_MS) {
      // Delay render to maintain frame rate
      setTimeout(() => {
        needsRenderRef.current = false;
        if (displayCurrentImageRef.current) {
          displayCurrentImageRef.current();
        }
        lastRenderTimeRef.current = performance.now();
      }, RENDER_THROTTLE_MS - timeSinceLastRender);
    } else {
      requestAnimationFrame(async () => {
        needsRenderRef.current = false;
        if (displayCurrentImageRef.current) {
          await displayCurrentImageRef.current();
        }
        lastRenderTimeRef.current = performance.now();
        
        // Debounce fusion rendering for smoother scrolling
        fusionRenderDebounceRef.current = setTimeout(() => {
          isScrollingRef.current = false;
          // Re-render with full quality fusion after scrolling stops
          if (fusionOpacity > 0 && secondarySeriesId) {
            scheduleRender();
          }
        }, 100);
      });
    }
  }, [fusionOpacity, secondarySeriesId]);

  useEffect(() => {
    scheduleRenderRef.current = scheduleRender;
    return () => {
      if (scheduleRenderRef.current === scheduleRender) {
        scheduleRenderRef.current = null;
      }
    };
  }, [scheduleRender]);

  useEffect(() => {
    const overlay = fusionOverlayCanvasRef.current;
    if (!overlay) return;
    const clamped = Math.max(0, Math.min(1, fusionOpacity));
    overlay.style.opacity = `${clamped}`;
    overlay.style.visibility = clamped === 0 ? 'hidden' : 'visible';
  }, [fusionOpacity]);

  useEffect(() => {
    const overlay = fusionOverlayCanvasRef.current;
    if (!overlay) return;
    const clamped = Math.max(0, Math.min(1, fusionOpacity));
    overlay.style.opacity = `${clamped}`;
    overlay.style.visibility = clamped === 0 ? 'hidden' : 'visible';
  }, [fusionOpacity]);

  useEffect(() => {
    if (!secondarySeriesId) {
      clearFusionOverlayCanvas();
    }
  }, [secondarySeriesId, clearFusionOverlayCanvas]);
  
  // Abort controller for series changes
  const seriesAbortRef = useRef<AbortController | null>(null);
  
  // Optimized rendering with cached LUT and offscreen canvas
  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const cachedLUTRef = useRef<{ key: string; lut: Uint8Array } | null>(null);
  
  // Secondary image prefetch optimization
  const secondaryPrefetchCompleteRef = useRef(false);

  // Missing caches/levels used later in the file
  const imageCacheRef = useRef<Map<string, any>>(new Map());
  const mprCacheRef = useRef<Map<string, any>>(new Map());
  const [currentWindowLevel, setCurrentWindowLevel] = useState<{ width: number; center: number }>(
    props.windowLevel ? { width: props.windowLevel.window, center: props.windowLevel.level } : { width: 350, center: 40 }
  );

  // Keep internal window/level in sync with prop changes from sidebar sliders/presets
  useEffect(() => {
    if (props.windowLevel) {
      const nextWidth = props.windowLevel.window;
      const nextCenter = props.windowLevel.level;
      // Only update if values actually changed to avoid unnecessary renders
      if (
        nextWidth !== currentWindowLevel.width ||
        nextCenter !== currentWindowLevel.center
      ) {
        setCurrentWindowLevel({ width: nextWidth, center: nextCenter });
      }
    }
  }, [props.windowLevel?.window, props.windowLevel?.level]);
  const updateWindowLevel = ({ width, center }: { width: number; center: number }) => {
    setCurrentWindowLevel({ width, center });
    onWindowLevelChange && onWindowLevelChange({ window: width, level: center });
  };

  // Save contour updates using debounced save
  const saveContourUpdates = (updatedStructures: any, action?: string) => {
    log.debug(`Queuing save for ${action || 'unknown action'}`, 'viewer');
    if (debouncedSaveRef.current) {
      debouncedSaveRef.current(updatedStructures);
    } else {
      log.warn('Debounced save not initialized', 'viewer');
    }
  };

  // Handle boolean operations (combine/subtract) between structures
  const handleBooleanOperation = async (payload: any) => {
    if (!rtStructures) {
      log.error('RT structures not available for boolean operation', 'viewer');
      return;
    }

    const { operation, sourceStructureId, targetStructureId, slicePosition } = payload;
    log.debug(`🔶 Performing ${operation} op between ${sourceStructureId} and ${targetStructureId} @ slice ${slicePosition}`, 'viewer');

    // Create a deep copy of RT structures to avoid mutation
    const updatedRTStructures = structuredClone ? structuredClone(rtStructures) : JSON.parse(JSON.stringify(rtStructures));

    // Find the source and target structures
    const sourceStructure = updatedRTStructures.structures?.find(
      (s: any) => s.roiNumber === sourceStructureId,
    );
    const targetStructure = updatedRTStructures.structures?.find(
      (s: any) => s.roiNumber === targetStructureId,
    );

    if (!sourceStructure || !targetStructure) {
      log.error('Source or target structure not found', 'viewer');
      return;
    }

    // Find contours on the specified slice for both structures
    const sourceContour = sourceStructure.contours?.find(
      (c: any) => Math.abs(c.slicePosition - slicePosition) < SLICE_TOL_MM,
    );
    const targetContour = targetStructure.contours?.find(
      (c: any) => Math.abs(c.slicePosition - slicePosition) < SLICE_TOL_MM,
    );

    if (!sourceContour || !sourceContour.points || sourceContour.points.length < 9) {
      log.warn(`No source contour found on slice ${slicePosition}`, 'viewer');
      return;
    }

    if (!targetContour || !targetContour.points || targetContour.points.length < 9) {
      log.warn(`No target contour found on slice ${slicePosition}`, 'viewer');
      return;
    }

    try {
      let resultContours: number[][];

      // Import the boolean operations
      const { combineContours, subtractContours } = await import('@/lib/clipper-boolean-operations');

      if (operation === 'combine') {
        // Combine the two contours
        resultContours = await combineContours(sourceContour.points, targetContour.points);
        log.debug(`🔶 Combine returned ${resultContours.length} contours`, 'viewer');
      } else if (operation === 'subtract') {
        // Subtract target from source
        resultContours = await subtractContours(sourceContour.points, targetContour.points);
        log.debug(`🔶 Subtract returned ${resultContours.length} contours`, 'viewer');
      } else {
        log.error(`Unknown boolean operation: ${operation}`, 'viewer');
        return;
      }

      // Remove the source contour from current slice
      const sourceContourIndex = sourceStructure.contours.findIndex(
        (c: any) => Math.abs(c.slicePosition - slicePosition) < SLICE_TOL_MM
      );
      
      if (sourceContourIndex >= 0) {
        sourceStructure.contours.splice(sourceContourIndex, 1);
      }

      // Add all result contours
      if (resultContours && resultContours.length > 0) {
        resultContours.forEach((contourPoints: number[]) => {
          if (contourPoints.length >= 9) {
            sourceStructure.contours.push({
              slicePosition: slicePosition,
              points: contourPoints,
              numberOfPoints: contourPoints.length / 3,
            });
          }
        });
        
        log.debug(`✅ Boolean ${operation} completed: ${resultContours.length} contours`, 'viewer');
      } else {
        log.debug(`✅ Boolean ${operation} completed: empty`, 'viewer');
      }

      // Update local structures and save to server
      setLocalRTStructures(updatedRTStructures);
      saveContourUpdates(updatedRTStructures, 'boolean_operation');
      
      // Pass the updated structures up to parent component
      if (onContourUpdate) {
        onContourUpdate(updatedRTStructures);
      }

      // Save state to undo system
      if (seriesId) {
        undoRedoManager.saveState(seriesId, 'boolean_operation', sourceStructureId, updatedRTStructures);
      }

    } catch (error) {
      log.error(`Error performing ${operation} op: ${String(error)}`, 'viewer');
    }
  };

  // Handle Eclipse TPS margin operation
  const handleMarginOperation = (payload: any) => {
    log.debug('🔹 handleMarginOperation called', 'viewer');
    
    if (!localRTStructures && !rtStructures) {
      log.error('RT structures not available for margin operation', 'viewer');
      return;
    }

    const structures = localRTStructures || rtStructures;
    const { structureId, parameters } = payload;
    
    // Check if this is an execute operation (applying preview)
    if (payload.action === 'apply_margin' && !payload.isPreview && previewContours.length > 0) {
      log.debug('🔹 Executing margin operation - applying preview contours', 'viewer');
      
      // Create a deep copy of RT structures
      const updatedRTStructures = structuredClone ? structuredClone(structures) : JSON.parse(JSON.stringify(structures));
      
      // Find the target structure
      const structure = updatedRTStructures.structures?.find(
        (s: any) => s.roiNumber === structureId,
      );
      
      if (!structure) {
        log.error(`Structure ${structureId} not found`, 'viewer');
        return;
      }
      
      // Replace structure contours with preview contours
      structure.contours = previewContours.map((preview: any) => ({
        slicePosition: preview.slicePosition,
        points: preview.points,
        numberOfPoints: preview.points.length / 3
      }));
      
      log.debug(`🔹 Replaced ${structure.contours.length} contours with preview contours`, 'viewer');
      
      // Clear preview
      setPreviewContours([]);
      
      // Update local structures and save
      setLocalRTStructures(updatedRTStructures);
      saveContourUpdates(updatedRTStructures, 'apply_margin');
      
      // Pass the updated structures up to parent component
      if (onContourUpdate) {
        onContourUpdate(updatedRTStructures);
      }
      
      log.debug(`✅ Applied margin to structure ${structureId}`, 'viewer');
      return;
    }
    
    // For single slice margin operations (legacy)
    if (payload.slicePosition !== undefined) {
      log.debug('🔹 Single slice margin operation (legacy)', 'viewer');
      
      const { slicePosition, marginParams } = payload;
      const updatedRTStructures = structuredClone ? structuredClone(structures) : JSON.parse(JSON.stringify(structures));
      
      const structure = updatedRTStructures.structures?.find(
        (s: any) => s.roiNumber === structureId,
      );
      
      if (!structure) {
        log.error(`Structure ${structureId} not found`, 'viewer');
        return;
      }
      
      const contour = structure.contours.find(
        (c: any) => Math.abs(c.slicePosition - slicePosition) <= SLICE_TOL_MM,
      );
      
      if (!contour || !contour.points || contour.points.length === 0) {
        log.warn(`No contour found for structure ${structureId} at slice ${slicePosition}`, 'viewer');
        return;
      }
      
      try {
        const marginValueMm = marginParams.marginValues.uniform;
        
        const grownContour = growContour(
          {
            points: contour.points,
            slicePosition: slicePosition,
          },
          marginValueMm,
        );
        
        let smoothingFactor = 0.15;
        if (marginParams.interpolationType === 'SMOOTH') {
          smoothingFactor = 0.25;
        } else if (marginParams.interpolationType === 'DISCRETE') {
          smoothingFactor = 0.05;
        }
        
        const smoothedContour = smoothContour(grownContour, smoothingFactor);
        
        contour.points = smoothedContour.points;
        contour.numberOfPoints = smoothedContour.points.length / 3;
        
        setLocalRTStructures(updatedRTStructures);
        saveContourUpdates(updatedRTStructures, 'apply_margin');
        
        if (onContourUpdate) {
          onContourUpdate(updatedRTStructures);
        }
        
        log.debug(`Applied margin of ${marginValueMm}mm to structure ${structureId}`, 'viewer');
      } catch (error) {
        log.error(`Error applying margin operation: ${String(error)}`, 'viewer');
      }
    }
  };

  // Handle preview grow contour operation
  const handlePreviewGrowOperation = async (payload: any) => {
    if (!localRTStructures) {
      log.error('RT structures not available for preview', 'viewer');
      return;
    }

    const { structureId, slicePosition, distance, direction = 'all' } = payload;
    log.debug(`🔹 Generating preview for structure ${structureId} by ${distance}mm @ slice ${slicePosition}`, 'viewer');

    // Find the target structure
    const structure = localRTStructures.structures?.find(
      (s: any) => s.roiNumber === structureId,
    );
    if (!structure) {
      console.error(`Structure ${structureId} not found`);
      return;
    }

    // Find the contour for the specified slice
    const contour = structure.contours?.find(
      (c: any) => Math.abs(c.slicePosition - slicePosition) < SLICE_TOL_MM,
    );

    if (!contour || !contour.points || contour.points.length < 9) {
      console.error(`No contour found for structure ${structureId} at slice ${slicePosition}`);
      return;
    }

    try {
      // Use the simple grow operation for preview
      let previewPoints: number[];
      
      if (distance > 0) {
        // Growing - use simple operations
        const { growContourSimple } = await import('@/lib/simple-polygon-operations');
        previewPoints = growContourSimple(contour.points, distance);
      } else {
        // For shrinking, use the original algorithm for now
        const grownContour = growContour(
          {
            points: contour.points,
            slicePosition: slicePosition,
          },
          distance,
        );
        previewPoints = grownContour.points;
      }

      // Set preview contours for rendering
      setPreviewContours([{
        points: previewPoints,
        slicePosition: slicePosition,
        meta: { type: 'grow_preview' }
      }]);
      
      console.log(`🔹 ✅ Generated preview with ${previewPoints.length / 3} points`);
      
    } catch (error) {
      console.error(`🔹 ❌ Error generating preview:`, error);
    }
  };

  // Handle grow contour operation using medical imaging algorithms
  const handleGrowContour = (payload: any) => {
    if (!localRTStructures) {
      console.error("RT structures not available for growing");
      return;
    }

    const { structureId, slicePosition, distance, direction = 'all' } = payload;
    const isGrowing = distance > 0;
    if (RT_STRUCTURE_DEBUG) {
      console.log(
        `${isGrowing ? 'Growing' : 'Shrinking'} contour for structure ${structureId} by ${Math.abs(distance)}mm ${direction !== 'all' ? `in ${direction} direction` : 'in all directions'} at slice ${slicePosition}`,
      );
    }

    // Create a deep copy of RT structures to avoid mutation
    const updatedRTStructures = structuredClone ? structuredClone(localRTStructures) : JSON.parse(JSON.stringify(localRTStructures));

    // Find the target structure
    const structure = updatedRTStructures.structures?.find(
      (s: any) => s.roiNumber === structureId,
    );
    if (!structure) {
      console.error(`Structure ${structureId} not found`);
      return;
    }

    // Find the contour for the specified slice
    const contour = structure.contours?.find(
      (c: any) => Math.abs(c.slicePosition - slicePosition) < SLICE_TOL_MM,
    );

    if (!contour || !contour.points || contour.points.length < 9) {
      console.warn(
        `No contour found on slice ${slicePosition} or insufficient points`,
      );
      return;
    }

    try {
      let updatedPoints: number[];
      
      if (direction === 'all') {
        // For single slice operations, still use 2D for speed
        // But note this is a single-slice operation, not volumetric
        updatedPoints = growContourSimple(contour.points, distance);
      } else {
        // Use directional grow/shrink
        updatedPoints = applyDirectionalGrow(
          contour.points,
          distance,
          direction,
          imageMetadata?.imageOrientation
        );
        
        // Apply smoothing
        const smoothedContour = smoothContour(
          {
            points: updatedPoints,
            slicePosition: slicePosition,
          },
          0.15
        );
        updatedPoints = smoothedContour.points;
      }

      // Update the contour with grown/shrunk points
      contour.points = updatedPoints;
      contour.numberOfPoints = updatedPoints.length / 3;

      // Update local structures and save to server
      setLocalRTStructures(updatedRTStructures);
      saveContourUpdates(updatedRTStructures, 'grow_contour');
      
      // Pass the updated structures up to parent component
      if (onContourUpdate) {
        onContourUpdate(updatedRTStructures);
      }

      console.log(`Successfully ${isGrowing ? 'grew' : 'shrunk'} contour by ${Math.abs(distance)}mm`);
    } catch (error) {
      console.error(`Error ${isGrowing ? 'growing' : 'shrinking'} contour:`, error);
    }
  };

  // Handle preview grow structure operation - works on ALL slices
  const handlePreviewGrowStructure = async (payload: any) => {
    console.log('🔹 🚀 handlePreviewGrowStructure called with payload:', payload);
    
    if (!localRTStructures) {
      console.error("🔹 ❌ RT structures not available for structure preview");
      console.log('🔹 localRTStructures is:', localRTStructures);
      return;
    }

    console.log('🔹 ✅ localRTStructures available:', localRTStructures);
    console.log('🔹 Available structures:', localRTStructures.structures?.map((s: any) => ({
      roiNumber: s.roiNumber,
      structureName: s.structureName,
      contourCount: s.contours?.length || 0
    })));

    const { structureId, targetStructureId, parameters } = payload;
    const marginValue = parameters?.marginValues?.uniform || parameters?.margin || 5;
    console.log(`🔹 Generating simple margin preview for structure ${structureId} by ${marginValue}mm`);
    console.log(`🔹 Target structure: ${targetStructureId || 'same structure'}`);

    // Find the target structure
    const structure = localRTStructures.structures?.find(
      (s: any) => s.roiNumber === structureId,
    );
    if (!structure) {
      console.error(`🔹 ❌ Structure ${structureId} not found`);
      return;
    }

    console.log(`🔹 ✅ Found structure:`, {
      roiNumber: structure.roiNumber,
      structureName: structure.structureName,
      contourCount: structure.contours?.length || 0
    });

    // Get all contours for this structure
    const allContours = structure.contours || [];
    if (allContours.length === 0) {
      console.error(`🔹 ❌ No contours found for structure ${structureId}`);
      return;
    }

    console.log(`🔹 ✅ Found ${allContours.length} contours for processing`);

    try {
      const previewContoursWithSlices: Array<{points: number[], slicePosition: number}> = [];
      
      for (const contour of allContours) {
        if (!contour.points || contour.points.length < 9) {
          console.log('🔹 ⚠️ Skipping contour with insufficient points:', contour.points?.length);
          continue;
        }
        
        console.log(`🔹 Processing contour with ${contour.points.length / 3} points on slice ${contour.slicePosition}`);
        
        let previewPoints: number[];
        
        // Use simple grow operation for consistent results
        const { growContourSimple } = await import('@/lib/simple-polygon-operations');
        previewPoints = growContourSimple(contour.points, marginValue);
        
        // Store preview contour with slice position metadata
        previewContoursWithSlices.push({
          points: previewPoints,
          slicePosition: contour.slicePosition
        });
        console.log(`🔹 ✅ Generated preview contour with ${previewPoints.length / 3} points for slice ${contour.slicePosition}`);
      }

      // Convert to the format expected by the renderer
      setPreviewContours(previewContoursWithSlices as any);
      console.log(`🔹 ✅ Set ${previewContoursWithSlices.length} preview contours for rendering`);
      
      console.log(`🔹 ✅ Generated structure preview with ${previewContoursWithSlices.length} slices`);
      
    } catch (error) {
      console.error(`🔹 ❌ Error generating structure preview:`, error);
    }
  };

  // Handle advanced margin preview operation
  const handleAdvancedMarginPreview = async (payload: any) => {
    console.log('🔹 🎯 Working Viewer: handleAdvancedMarginPreview called with payload:', payload);
    
    // Use rtStructures from props if localRTStructures is not available
    const structures = localRTStructures || rtStructures;
    
    if (!structures) {
      console.error("🔹 ❌ RT structures not available for margin preview");
      return;
    }

    const { structureId, parameters } = payload;
    console.log(`🔹 📊 Generating 3D volumetric margin preview for structure ${structureId} with parameters:`, parameters);
    console.log('🔹 📊 Parameters detail:', JSON.stringify(parameters, null, 2));

    try {
      // Find the target structure
      const structure = structures.structures?.find(
        (s: any) => s.roiNumber === structureId,
      );
      if (!structure) {
        console.error(`🔹 ❌ Structure ${structureId} not found`);
        return;
      }
      
      console.log(`🔹 ✅ Found structure: ${structure.structureName || structure.name} with ${structure.contours?.length || 0} contours`);

      // Clear any existing preview
      setPreviewContours([]);

      const marginValue = parameters.margin || 5;
      console.log('🔹 📊 Margin value:', marginValue);

      // Uniform margin preview: use DT worker for large |margin|, otherwise fast 2D offset
      if (parameters?.marginType === 'UNIFORM') {
        const useWorker = Math.abs(marginValue) >= 3;
        if (useWorker) {
          try {
            // Abort any in-flight preview worker
            if ((window as any).__marginPreviewWorker) {
              try { (window as any).__marginPreviewWorker.terminate(); } catch {}
            }
            const worker = new Worker(new URL('@/margins/margin-worker.ts', import.meta.url), { type: 'module' });
            (window as any).__marginPreviewWorker = worker;
            const px = imageMetadata?.pixelSpacing || [1, 1];
            const th = imageMetadata?.sliceThickness || 2;
            const spacing: [number, number, number] = [px[1] ?? px[0], px[0], th];
            const jobId = `prev-${Date.now()}`;
            const padding = Math.abs(marginValue) + 5;
            const srcContours = structure.contours || [];
            const previewPromise: Promise<any> = new Promise((resolve, reject) => {
              worker.onmessage = (ev: MessageEvent<any>) => {
                if (!ev.data || ev.data.jobId !== jobId) return;
                try { worker.terminate(); } catch {}
                (window as any).__marginPreviewWorker = null;
                if (ev.data.ok) resolve(ev.data.contours); else reject(ev.data.error);
              };
              worker.onerror = (err) => {
                try { worker.terminate(); } catch {}
                (window as any).__marginPreviewWorker = null;
                reject(err);
              };
            });
            worker.postMessage({ jobId, kind: 'UNIFORM', contours: srcContours, spacing, padding, margin: marginValue });
            const workerContours = await previewPromise;
            const previewContoursWithSlices: any[] = (workerContours || []).map((c: any) => ({
              points: c.points,
              slicePosition: c.slicePosition,
              isPreview: true,
              previewColor: '#FFFF00'
            }));
            setPreviewContours(previewContoursWithSlices);
            return;
          } catch (err) {
            console.warn('DT preview worker failed, falling back to 2D offset:', err);
          }
        }
        // Fallback/fast path: 2D offset per slice
        const { offsetContour } = await import('@/lib/clipper-boolean-operations');
        const previewContoursWithSlices: any[] = [];
        for (const contour of structure.contours) {
          if (!contour.points || contour.points.length < 9) continue;
          try {
            const outs = await offsetContour(contour.points, marginValue);
            outs?.forEach(out => {
              if (out.length >= 9) {
                previewContoursWithSlices.push({
                  points: out,
                  slicePosition: contour.slicePosition,
                  isPreview: true,
                  previewColor: '#FFFF00'
                });
              }
            });
          } catch (err) {
            console.warn(`Offset preview failed for slice ${contour.slicePosition}:`, err);
          }
        }
        setPreviewContours(previewContoursWithSlices);
        return;
      }

      // Import the optimized 3D volumetric margin operation handler
      const { apply3DMarginOptimized } = await import('@/lib/volumetric-margin-operations-optimized');
      
      // Get pixel spacing from image metadata
      const pixelSpacing: [number, number, number] = imageMetadata?.pixelSpacing 
        ? [imageMetadata.pixelSpacing[0], imageMetadata.pixelSpacing[1], imageMetadata.sliceThickness || 2]
        : [1, 1, 2];
      
      console.log('🔹 Using pixel spacing for optimized 3D operation:', pixelSpacing);
      
      // Use fast 3D algorithm for preview if margin is large enough
      const useFast3D = Math.abs(marginValue) > 1;
      
      if (useFast3D) {
        console.log(`🚀 Using fast 3D preview for ${marginValue}mm margin`);
        
        const { applyFast3DMargin } = await import('@/lib/fast-3d-margin-operations');
        
        // Get image metadata for 3D processing
        const imgPixelSpacing = imageMetadata?.pixelSpacing || [1, 1];
        const sliceThickness = imageMetadata?.sliceThickness || 2;
        
        const fast3DResults = await applyFast3DMargin(
          structure.contours,
          {
            marginMm: marginValue,
            pixelSpacing: [imgPixelSpacing[0], imgPixelSpacing[1], sliceThickness],
            imageMetadata: {
              imagePosition: [0, 0, 0], // Will be calculated from contours
              imageSize: { width: 512, height: 512, depth: 100 }
            },
            useOptimizedAlgorithm: true,
            maxProcessingTime: 5000 // 5 seconds max for preview
          }
        );
        
        // Create preview contours
        const previewContoursWithSlices: any[] = fast3DResults.map((contour: any) => ({
          points: contour.points,
          slicePosition: contour.slicePosition,
          isPreview: true,
          previewColor: '#FFFF00'  // Yellow for preview
        }));
        
        console.log(`🚀 ✅ Generated ${previewContoursWithSlices.length} fast 3D preview contours`);
        setPreviewContours(previewContoursWithSlices);
        
      } else {
        // Use existing simple 2D preview for small margins
        console.log(`🔹 Using 2D preview for small ${marginValue}mm margin`);
        
        const { growContourSimple } = await import('@/lib/simple-polygon-operations');
        const previewContoursWithSlices: any[] = [];
        
        for (const contour of structure.contours) {
          if (!contour.points || contour.points.length < 9) continue;
          
          try {
            const expandedPoints = growContourSimple(contour.points, marginValue);
            previewContoursWithSlices.push({
              points: expandedPoints,
              slicePosition: contour.slicePosition,
              isPreview: true,
              previewColor: '#FFFF00'  // Yellow for preview
            });
          } catch (error) {
            console.warn(`Preview failed for contour at slice ${contour.slicePosition}:`, error);
          }
        }
        
        console.log(`🔹 ✅ Generated ${previewContoursWithSlices.length} 2D preview contours`);
        setPreviewContours(previewContoursWithSlices);
      }
    } catch (error) {
      console.error('🔹 ❌ 3D margin preview failed:', error);
      setPreviewContours([]);
    }
  };

  // Handle advanced margin execution operation
  const handleAdvancedMarginExecution = async (payload: any) => {
    console.log('🔹 🎯 Working Viewer: handleAdvancedMarginExecution called with payload:', payload);
    
    // Use local structures or props structures
    const structures = localRTStructures || rtStructures;
    
    if (!structures) {
      console.error("🔹 ❌ RT structures not available for margin execution");
      return;
    }
    
    const { structureId, targetStructureId, parameters } = payload;
    
    console.log(`🔹 📊 Executing margin operation for structure ${structureId} with parameters:`, parameters);
    console.log(`🔹 Target structure ID: ${targetStructureId || 'same structure'}`);
    
    try {
      // Create a deep copy of RT structures
      const updatedRTStructures = structuredClone ? structuredClone(structures) : JSON.parse(JSON.stringify(structures));
      
      // Find the source structure
      const sourceStructure = updatedRTStructures.structures?.find(
        (s: any) => s.roiNumber === structureId,
      );
      
      if (!sourceStructure) {
        console.error(`Source structure ${structureId} not found`);
        return;
      }
      
      // Determine target structure
      let targetStructure = sourceStructure;
      if (targetStructureId && targetStructureId !== structureId) {
        targetStructure = updatedRTStructures.structures?.find(
          (s: any) => s.roiNumber === targetStructureId,
        );
        if (!targetStructure) {
          console.error(`Target structure ${targetStructureId} not found`);
          return;
        }
      }
      
      const marginValue = parameters.marginValues?.uniform || parameters.margin || 5;
      console.log(`🔹 Applying margin of ${marginValue}mm to ${sourceStructure.contours?.length || 0} contours`);

      // Uniform margin: prefer fast 3D execution to match Eclipse volumetric margin
      if (parameters?.marginType === 'UNIFORM') {
        try {
          const { applyFast3DMargin } = await import('@/lib/fast-3d-margin-operations');
          const px = imageMetadata?.pixelSpacing || [1, 1];
          const th = imageMetadata?.sliceThickness || 2;
          const fast3DResults = await applyFast3DMargin(
            sourceStructure.contours || [],
            {
              marginMm: marginValue,
              pixelSpacing: [px[0], px[1], th],
              imageMetadata: {
                imagePosition: [0, 0, 0],
                imageSize: { width: 512, height: 512, depth: 100 }
              },
              useOptimizedAlgorithm: true,
              maxProcessingTime: 15000
            }
          );
          const processedContours = fast3DResults.map((c: any) => ({
            slicePosition: c.slicePosition,
            points: c.points,
            numberOfPoints: c.numberOfPoints || c.points.length / 3
          }));
          targetStructure.contours = processedContours;
        } catch (e2) {
          console.warn('Fast 3D execution failed, falling back to 2D offset:', e2);
          const { offsetContour } = await import('@/lib/clipper-boolean-operations');
          const processedContours: any[] = [];
          for (const contour of sourceStructure.contours || []) {
            if (!contour.points || contour.points.length < 9) continue;
            try {
              const outs = await offsetContour(contour.points, marginValue);
              outs?.forEach(out => {
                if (out.length >= 9) {
                  processedContours.push({
                    slicePosition: contour.slicePosition,
                    points: out,
                    numberOfPoints: out.length / 3
                  });
                }
              });
            } catch (err) {
              console.warn('Offset execution failed; preserving original contour:', err);
              processedContours.push({
                slicePosition: contour.slicePosition,
                points: contour.points,
                numberOfPoints: contour.points.length / 3
              });
            }
          }
          targetStructure.contours = processedContours;
        }

        // Clear preview and persist
        setPreviewContours([]);
        if (seriesId) {
          undoRedoManager.saveState(seriesId, 'apply_margin', structureId, updatedRTStructures);
        }
        setLocalRTStructures(updatedRTStructures);
        saveContourUpdates(updatedRTStructures, 'apply_margin');
        if (onContourUpdate) {
          onContourUpdate(updatedRTStructures);
        }
        console.log(`✅ Successfully applied uniform margin to structure ${targetStructure.roiNumber}`);
        return;
      }
      
      // Choose algorithm based on margin parameters and structure size
      let use3D = Math.abs(marginValue) > 2 || (sourceStructure.contours?.length || 0) > 5;
      let processedContours: any[] = [];
      
      if (use3D) {
        console.log(`🚀 Using fast 3D margin algorithm for ${marginValue}mm margin`);
        try {
          // Use fast 3D algorithm for true volumetric expansion
          const { applyFast3DMargin } = await import('@/lib/fast-3d-margin-operations');
          
          // Get image metadata for 3D processing
          const pixelSpacing = imageMetadata?.pixelSpacing || [1, 1];
          const sliceThickness = imageMetadata?.sliceThickness || 2;
          
          const fast3DResults = await applyFast3DMargin(
            sourceStructure.contours || [],
            {
              marginMm: marginValue,
              pixelSpacing: [pixelSpacing[0], pixelSpacing[1], sliceThickness],
              imageMetadata: {
                imagePosition: [0, 0, 0], // Will be calculated from contours
                imageSize: { width: 512, height: 512, depth: 100 }
              },
              useOptimizedAlgorithm: true,
              maxProcessingTime: 15000 // 15 seconds max
            }
          );
          
          processedContours = fast3DResults.map(contour => ({
            slicePosition: contour.slicePosition,
            points: contour.points,
            numberOfPoints: contour.numberOfPoints || contour.points.length / 3
          }));
          
          console.log(`🚀 ✅ Fast 3D margin generated ${processedContours.length} contours`);
          
        } catch (error) {
          console.warn('🚀 ⚠️ Fast 3D margin failed, falling back to 2D:', error);
          use3D = false; // Fall back to 2D
        }
      }
      
      if (!use3D || processedContours.length === 0) {
        console.log(`🔹 Using 2D simple algorithm for ${marginValue}mm margin`);
        
        // Import the simple grow operation
        const { growContourSimple } = await import('@/lib/simple-polygon-operations');
        
        // Process each contour using the simple algorithm
        processedContours = [];
        for (const contour of sourceStructure.contours || []) {
          if (!contour.points || contour.points.length < 9) {
            continue;
          }
          
          try {
            const expandedPoints = growContourSimple(contour.points, marginValue);
            
            processedContours.push({
              slicePosition: contour.slicePosition,
              points: expandedPoints,
              numberOfPoints: expandedPoints.length / 3
            });
          } catch (error) {
            console.warn(`Failed to process contour at slice ${contour.slicePosition}:`, error);
          }
        }
      }
      
      // Apply results to target structure
      targetStructure.contours = processedContours;
      
      console.log(`🔹 ✅ Applied simple/3D margin, generated ${processedContours.length} contours`);
      
      // Clear preview contours
      setPreviewContours([]);
      
      // Save to undo/redo and persist
      if (seriesId) {
        undoRedoManager.saveState(seriesId, 'apply_margin', structureId, updatedRTStructures);
      }
      setLocalRTStructures(updatedRTStructures);
      saveContourUpdates(updatedRTStructures, 'apply_margin');
      
      // Pass the updated structures up to parent component
      if (onContourUpdate) {
        onContourUpdate(updatedRTStructures);
      }
      
      console.log(`✅ Successfully applied simple margin to structure ${targetStructure.roiNumber}`);
    } catch (error) {
      console.error("🔹 ❌ Error applying simple margin operation:", error);
    }
  };

  // Handle grow structure operation - works on ALL slices
  const handleGrowStructure = (payload: any) => {
    if (!localRTStructures) {
      console.error("RT structures not available for structure growing");
      return;
    }

    const { structureId, distance, direction = 'all' } = payload;
    const isGrowing = distance > 0;
    if (RT_STRUCTURE_DEBUG) {
      console.log(
        `🔹 ${isGrowing ? 'Growing' : 'Shrinking'} ENTIRE STRUCTURE ${structureId} by ${Math.abs(distance)}mm on ALL slices`,
      );
    }

    // Create a deep copy of RT structures to avoid mutation
    const updatedRTStructures = structuredClone ? structuredClone(localRTStructures) : JSON.parse(JSON.stringify(localRTStructures));

    // Find the target structure
    const structure = updatedRTStructures.structures?.find(
      (s: any) => s.roiNumber === structureId,
    );
    if (!structure) {
      console.error(`Structure ${structureId} not found`);
      return;
    }

    // Get all contours for this structure
    const allContours = structure.contours || [];
    if (allContours.length === 0) {
      console.error(`No contours found for structure ${structureId}`);
      return;
    }

    try {
      let processedSlices = 0;
      
      for (const contour of allContours) {
        if (!contour.points || contour.points.length < 9) continue;
        
        let updatedPoints: number[];
        
        if (direction === 'all') {
          // Use new simple polygon grow/shrink algorithm for better results
          updatedPoints = growContourSimple(contour.points, distance);
        } else {
          // Use directional grow/shrink
          updatedPoints = applyDirectionalGrow(
            contour.points,
            distance,
            direction,
            imageMetadata?.imageOrientation
          );
          
          // Apply smoothing
          const smoothedContour = smoothContour(
            {
              points: updatedPoints,
              slicePosition: contour.slicePosition,
            },
            0.15
          );
          updatedPoints = smoothedContour.points;
        }

        // Update the contour with grown/shrunk points
        contour.points = updatedPoints;
        contour.numberOfPoints = updatedPoints.length / 3;
        processedSlices++;
      }

      // Update local structures and save to server
      setLocalRTStructures(updatedRTStructures);
      saveContourUpdates(updatedRTStructures, 'grow_structure');
      
      // Pass the updated structures up to parent component
      if (onContourUpdate) {
        onContourUpdate(updatedRTStructures);
      }

      console.log(`🔹 ✅ Successfully ${isGrowing ? 'grew' : 'shrunk'} structure ${structureId} on ${processedSlices} slices by ${Math.abs(distance)}mm`);
    } catch (error) {
      console.error(`🔹 ❌ Error ${isGrowing ? 'growing' : 'shrinking'} structure:`, error);
    }
  };

  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [lastPanX, setLastPanX] = useState(0);
  const [lastPanY, setLastPanY] = useState(0);

  // Simple debounce implementation
  const debounce = (func: Function, wait: number) => {
    let timeout: NodeJS.Timeout;
    const debounced = (...args: any[]) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => func(...args), wait);
    };
    debounced.cancel = () => clearTimeout(timeout);
    return debounced;
  };

  // Create debounced save function
  const debouncedSaveRef = useRef<any>(null);
  const lastSavedHashRef = useRef<string>("");
  
  // Initialize debounced save on mount
  useEffect(() => {
    const saveToServer = async (structures: any) => {
      if (!structures) return;
      
      // Create hash of structures to check for changes
      const structuresHash = JSON.stringify({
        count: structures.structures?.length || 0,
        contourCounts: structures.structures?.map((s: any) => ({
          id: s.roiNumber,
          count: s.contours?.length || 0
        }))
      });
      
      // Skip if no changes since last save
      if (structuresHash === lastSavedHashRef.current) {
        console.log("Skipping save - no changes detected");
        return;
      }
      
      try {
        console.log("Saving contour updates to server...");
        if (onRTStructureUpdate) {
          await onRTStructureUpdate(structures);
        }
        lastSavedHashRef.current = structuresHash;
      } catch (error) {
        console.error("Failed to save contour updates:", error);
      }
    };
    
    // Create debounced function with 500ms delay
    debouncedSaveRef.current = debounce(saveToServer, 500);
    
    return () => {
      if (debouncedSaveRef.current?.cancel) {
        debouncedSaveRef.current.cancel();
      }
    };
  }, [onRTStructureUpdate]);

  // Handle contour updates from brush tool and other contour editing operations
  const handleContourUpdate = async (payload: any) => {
    // Handle margin toolbar operations
    if (payload && payload.type && payload.type.includes('margin')) {
      if (payload.preview) {
        console.log("🔹 Margin preview request from toolbar:", payload);
        await handlePreviewGrowStructure({
          structureId: payload.structureId,
          targetStructureId: payload.targetStructureId,
          parameters: payload.parameters
        });
        return;
      } else {
        console.log("🔹 Margin execution request from toolbar:", payload);
        await handleAdvancedMarginExecution({
          action: 'execute_margin',
          structureId: payload.structureId,
          targetStructureId: payload.targetStructureId,
          parameters: payload.parameters
        });
        return;
      }
    }

    // Handle refresh action from undo/redo
    if (payload && payload.action === 'refresh' && payload.rtStructures) {
      console.log('Refreshing RT structures from undo/redo');
      setLocalRTStructures(payload.rtStructures);
      // Pass the updated structures up to parent component
      if (onContourUpdate) {
        onContourUpdate(payload.rtStructures);
      }
      return;
    }

    // Handle preview operations
    if (payload && payload.action === "preview_grow_contour") {
      console.log("🔹 Preview grow contour request:", payload);
      await handlePreviewGrowOperation(payload);
      return;
    }

    if (payload && payload.action === "preview_grow_structure") {
      console.log("🔹 Preview grow STRUCTURE request:", payload);
      await handlePreviewGrowStructure(payload);
      return;
    }

    if (payload && payload.action === "clear_preview") {
      console.log("🔹 Clearing preview contours");
      setPreviewContours([]);
      return;
    }

    // Handle advanced margin preview operations
    if (payload && payload.action === "preview_margin") {
      console.log("🔹 Advanced margin preview request:", payload);
      await handleAdvancedMarginPreview(payload);
      return;
    }

    // Handle advanced margin execution operations
    if (payload && payload.action === "execute_margin") {
      console.log("🔹 Advanced margin execution request:", payload);
      await handleAdvancedMarginExecution(payload);
      return;
    }
    
    // Special handling for undo/redo results which return full RT structures
    if (payload && payload.structures && !payload.action) {
      console.log('Applying undo/redo result with', payload.structures.length, 'structures');
      
      // Optimize update to only change modified structures
      setLocalRTStructures((prevStructures: any) => {
        if (!prevStructures) return payload;
        
        // Create a new object with the same reference for unchanged properties
        const updatedStructures = {
          ...prevStructures,
          structures: prevStructures.structures.map((oldStruct: any) => {
            // Find the corresponding structure in the new data
            const newStruct = payload.structures.find((s: any) => s.roiNumber === oldStruct.roiNumber);
            
            // If structure wasn't changed, keep the same reference
            if (newStruct && JSON.stringify(oldStruct) === JSON.stringify(newStruct)) {
              return oldStruct;
            }
            
            // If structure was changed or removed, use the new one
            return newStruct || oldStruct;
          })
        };
        
        // Add any new structures that weren't in the old data
        payload.structures.forEach((newStruct: any) => {
          if (!updatedStructures.structures.find((s: any) => s.roiNumber === newStruct.roiNumber)) {
            updatedStructures.structures.push(newStruct);
          }
        });
        
        return updatedStructures;
      });
      
      // Pass the updated structures up to parent component
      if (onContourUpdate) {
        onContourUpdate(payload);
      }
      return;
    }
    
    // Check if two polygons intersect by checking if any points are close
    const checkPolygonIntersection = (polygon1: number[], polygon2: number[]) => {
      const threshold = 2.0; // Distance threshold in world coordinates (mm) - reduced for more accurate contours
      
      // Check each point in polygon1 against polygon2
      for (let i = 0; i < polygon1.length; i += 3) {
        const p1x = polygon1[i];
        const p1y = polygon1[i + 1];
        
        for (let j = 0; j < polygon2.length; j += 3) {
          const p2x = polygon2[j];
          const p2y = polygon2[j + 1];
          
          const distance = Math.sqrt(
            Math.pow(p1x - p2x, 2) + Math.pow(p1y - p2y, 2)
          );
          
          if (distance < threshold) {
            return true; // Found intersection
          }
        }
      }
      
      return false; // No intersection found
    };
    log.debug('Handling contour update', 'viewer');

    if (!rtStructures || !rtStructures.structures) {
      log.error('No RT structures available', 'viewer');
      return;
    }

    // Handle refresh action for undo/redo
    if (payload.action === "refresh") {
      log.debug('Refreshing RT structures after undo/redo', 'viewer');
      // Update with the RT structures from the payload
      if (payload.rtStructures) {
        setLocalRTStructures(payload.rtStructures);
        // Force re-render of the canvas
        if (images.length > 0) {
          // Add a small delay to ensure state updates are processed
          setTimeout(() => {
            scheduleRender();
          }, 50);
        }
      }
      return;
    }

    // Create a deep copy to avoid mutations
    const updatedStructures = structuredClone ? structuredClone(rtStructures) : JSON.parse(JSON.stringify(rtStructures));

    if (payload.action === "brush_stroke") {
      // Handle brush stroke - add points to contour
      const structure = updatedStructures.structures.find(
        (s: any) => s.roiNumber === payload.structureId,
      );
      if (!structure) {
        log.error(`Structure ${payload.structureId} not found`, 'viewer');
        return;
      }

      // Convert brush stroke to polished polygon for smooth edges
      let brushPolygon: number[];
      
      // CRITICAL FIX: The brush size should NOT be converted to world coordinates here
      // The brush size is already in screen pixels and should remain that way
      // The polygon creation function will handle coordinate transformation internally
      
      log.debug(`Brush size: ${payload.brushSize}px (pixel units)`, 'viewer');
      log.debug('Sample brush point coordinates present', 'viewer');
      
      // TEMPORARILY DISABLED: Polishing causing structure morphing/shrinking
      // Use unpolished brush stroke until polishing is fixed
      brushPolygon = addBrushToContour(
        [], // Empty array to get just the brush polygon
        payload.points,
        payload.brushSize, // Use pixel size directly - let polygon function handle conversion
      );
      log.debug('Using unpolished brush stroke (polishing temporarily disabled)', 'viewer');
      
      // TODO: Fix polishing ClipperLib compatibility issue
      // The polishing function is failing with "Error polishing contour" 
      // and causing structures to morph/shrink when multiple strokes are added

      // Collect all contours on this slice
      const existingOnSlice = structure.contours.filter(
        (c: any) => Math.abs(c.slicePosition - payload.slicePosition) <= SLICE_TOL_MM
      );

      // Check if brush stroke intersects with any existing contour
      let intersectsWithExisting = false;
      const intersectingContours: any[] = [];
      const nonIntersectingContours: any[] = [];
      
      for (const contour of existingOnSlice) {
        if (contour.points && contour.points.length >= 9) {
          // Check if brush polygon intersects with this contour
          const intersects = doPolygonsIntersectSimple(brushPolygon, contour.points);
          if (intersects) {
            intersectsWithExisting = true;
            intersectingContours.push(contour);
          } else {
            nonIntersectingContours.push(contour);
          }
        }
      }

      if (intersectsWithExisting) {
        // Union brush with intersecting contours only
        const polygonsToUnion: number[][] = [];
        
        // Add intersecting contours
        for (const contour of intersectingContours) {
          polygonsToUnion.push(contour.points);
        }
        
        // Add the new brush polygon
        polygonsToUnion.push(brushPolygon);

        // Perform union of intersecting polygons using simple operations
        const unionResults = unionMultipleContoursSimple(polygonsToUnion);
        
        // Only remove existing contours AFTER confirming union succeeded
        if (unionResults && unionResults.length > 0) {
          // Union succeeded - remove ALL existing contours at this slice and replace with union result
          structure.contours = structure.contours.filter(
            (c: any) => Math.abs(c.slicePosition - payload.slicePosition) > SLICE_TOL_MM
          );
          
          // Add all unified contours (there can be multiple disjoint polygons)
          for (const polygon of unionResults) {
            if (polygon && polygon.length >= 9) {
              structure.contours.push({
                slicePosition: payload.slicePosition,
                points: polygon,
                numberOfPoints: polygon.length / 3,
              });
            }
          }
          
          // Re-add non-intersecting contours as separate blobs
          for (const contour of nonIntersectingContours) {
            structure.contours.push({
              slicePosition: payload.slicePosition,
              points: contour.points,
              numberOfPoints: contour.numberOfPoints,
            });
          }
        } else {
          // Fallback: if union failed/returned empty, preserve ALL existing contours
          // Just add the brush polygon as a separate blob without removing anything
          console.warn('🔸 BRUSH FIX: Union failed - preserving existing contours to prevent disappearing blobs');
          structure.contours.push({
            slicePosition: payload.slicePosition,
            points: brushPolygon,
            numberOfPoints: brushPolygon.length / 3,
          });
        }
      } else {
        // Brush doesn't intersect - create separate blob
        // Add brush as new separate contour
        structure.contours.push({
          slicePosition: payload.slicePosition,
          points: brushPolygon,
          numberOfPoints: brushPolygon.length / 3,
        });
        
        // Re-add all existing contours unchanged
        for (const contour of existingOnSlice) {
          structure.contours.push({
            slicePosition: payload.slicePosition,
            points: contour.points,
            numberOfPoints: contour.numberOfPoints,
          });
        }
      }

      console.log(`Structure now has ${structure.contours.length} contours`);
      setLocalRTStructures(updatedStructures);
      
      // Handle next slice prediction if enabled
      if (payload.predictionEnabled) {
        console.log("Next slice prediction is enabled, predicting contours for adjacent slices");
        
        // Get the final contour on this slice
        // Find the contour we just created
        const finalContour = structure.contours[structure.contours.length - 1];
        
        if (finalContour && finalContour.points && finalContour.points.length > 0) {
          // Calculate next slice positions (assuming 3mm slice spacing as typical)
          const sliceSpacing = 3; // mm
          const nextSlicePosition = payload.slicePosition + sliceSpacing;
          const prevSlicePosition = payload.slicePosition - sliceSpacing;
          
          // Predict for next slice
          const nextPrediction = predictNextSliceContour({
            currentContour: finalContour.points,
            currentSlicePosition: payload.slicePosition,
            targetSlicePosition: nextSlicePosition,
            anatomicalRegion: 'head', // You could determine this from metadata
            predictionMode: 'simple',
            confidenceThreshold: 0.5
          });
          
          // If prediction has good confidence, apply it
          if (nextPrediction.confidence > 0.5 && nextPrediction.predictedContour.length > 0) {
            // Check if there's already a contour on the next slice
            const nextSliceContourIndex = structure.contours.findIndex(
              (c: any) => Math.abs(c.slicePosition - nextSlicePosition) < SLICE_TOL_MM
            );
            
            if (nextSliceContourIndex === -1) {
              // No existing contour, add the predicted one
              structure.contours.push({
                slicePosition: nextSlicePosition,
                points: nextPrediction.predictedContour,
                numberOfPoints: nextPrediction.predictedContour.length / 3,
                isPredicted: true // Mark as predicted
              });
              console.log(`Added predicted contour to next slice ${nextSlicePosition} with confidence ${nextPrediction.confidence.toFixed(2)}`);
            }
          }
          
          // Also predict for previous slice
          const prevPrediction = predictNextSliceContour({
            currentContour: finalContour.points,
            currentSlicePosition: payload.slicePosition,
            targetSlicePosition: prevSlicePosition,
            anatomicalRegion: 'head',
            predictionMode: 'simple',
            confidenceThreshold: 0.5
          });
          
          if (prevPrediction.confidence > 0.5 && prevPrediction.predictedContour.length > 0) {
            const prevSliceContourIndex = structure.contours.findIndex(
              (c: any) => Math.abs(c.slicePosition - prevSlicePosition) < SLICE_TOL_MM
            );
            
            if (prevSliceContourIndex === -1) {
              structure.contours.push({
                slicePosition: prevSlicePosition,
                points: prevPrediction.predictedContour,
                numberOfPoints: prevPrediction.predictedContour.length / 3,
                isPredicted: true
              });
              console.log(`Added predicted contour to previous slice ${prevSlicePosition} with confidence ${prevPrediction.confidence.toFixed(2)}`);
            }
          }
          
          // Update the structures again with predictions
          setLocalRTStructures(updatedStructures);
        }
      }
      // Save state to new undo system
      if (seriesId) {
        undoRedoManager.saveState(seriesId, 'add_brush_stroke', payload.structureId, updatedStructures);
      }
      saveContourUpdates(updatedStructures, 'add_brush_stroke');
      // Trigger immediate render to show contours
      try { 
        scheduleRender(); 
        // Temporary debugging notification
        console.log('🎯 CONTOUR FIX: Immediate render triggered after brush stroke');
      } catch {}
    } else if (payload.action === "smart_brush_stroke") {
      // Handle smart brush stroke - add already processed contour points
      if (false) console.log("🎯 Processing smart brush stroke:", payload);
      
      const structure = updatedStructures.structures.find(
        (s: any) => s.roiNumber === payload.structureId,
      );
      if (!structure) {
        console.error(`Structure ${payload.structureId} not found`);
        return;
      }

      // The smart brush now provides a pre-unified polygon. We will process it
      // with the same robust logic as a regular brush stroke to correctly handle
      // intersections and the creation of multiple blobs.
      const brushPolygon: number[] = payload.points;

      // Collect all contours on this slice
      const existingOnSlice = structure.contours.filter(
        (c: any) => Math.abs(c.slicePosition - payload.slicePosition) <= SLICE_TOL_MM
      );

      // Check if brush stroke intersects with any existing contour
      let intersectsWithExisting = false;
      const intersectingContours: any[] = [];
      const nonIntersectingContours: any[] = [];

      for (const contour of existingOnSlice) {
        if (contour.points && contour.points.length >= 9) {
          const intersects = doPolygonsIntersectSimple(brushPolygon, contour.points);
          if (intersects) {
            intersectsWithExisting = true;
            intersectingContours.push(contour);
          } else {
            nonIntersectingContours.push(contour);
          }
        }
      }

      // Remove all existing contours at this slice; we will add them back.
      structure.contours = structure.contours.filter(
        (c: any) => Math.abs(c.slicePosition - payload.slicePosition) > SLICE_TOL_MM
      );

      if (intersectsWithExisting) {
        // If the new stroke intersects, union it with all intersecting contours
        const polygonsToUnion = [brushPolygon, ...intersectingContours.map(c => c.points)];
        const unionResults = unionMultipleContoursSimple(polygonsToUnion);
        
        // Add the new unified contour(s)
        if (unionResults && unionResults.length > 0) {
          unionResults.forEach((polygonPoints: number[]) => {
            if (polygonPoints.length >= 9) {
              structure.contours.push({
                slicePosition: payload.slicePosition,
                points: polygonPoints,
                numberOfPoints: polygonPoints.length / 3,
              });
            }
          });
        }
        
        // Re-add the contours that did not intersect
        for (const contour of nonIntersectingContours) {
          structure.contours.push(contour);
        }
      } else {
        // If there's no intersection, add the new brush stroke as a new contour
        structure.contours.push({
          slicePosition: payload.slicePosition,
          points: brushPolygon,
          numberOfPoints: brushPolygon.length / 3,
        });
        
        // And re-add all the other existing contours as they were
        for (const contour of existingOnSlice) {
          structure.contours.push(contour);
        }
      }

      if (false) console.log(`Structure now has ${structure.contours.length} contours after smart brush`);
      setLocalRTStructures(updatedStructures);
      
      // Save state to undo system
      if (seriesId) {
        undoRedoManager.saveState(seriesId, 'smart_brush_stroke', payload.structureId, updatedStructures);
      }
      saveContourUpdates(updatedStructures, 'smart_brush_stroke');
      // Trigger immediate render to show contours
      try { scheduleRender(); } catch {}
    } else if (payload.action === "erase_stroke") {
      // Handle erase stroke - subtract points from contour
      console.log("🔹 Processing erase stroke:", payload);
      
      const structure = updatedStructures.structures.find(
        (s: any) => s.roiNumber === payload.structureId,
      );
      if (!structure) {
        console.error(`Structure ${payload.structureId} not found`);
        return;
      }

      // Convert erase stroke to polygon for subtraction
      const erasePolygon = addBrushToContour(
        [], // Empty array to get just the erase polygon
        payload.points,
        payload.brushSize,
      );
      
      console.log(`Erase polygon created with ${erasePolygon.length / 3} points`);

      // Collect all contours on this slice
      const tol = 0.5;
      const existingOnSlice = structure.contours.filter(
        (c: any) => Math.abs(c.slicePosition - payload.slicePosition) <= tol
      );

      // Remove all existing contours at this slice
      structure.contours = structure.contours.filter(
        (c: any) => Math.abs(c.slicePosition - payload.slicePosition) > tol
      );

      // Process each existing contour - subtract the erase area
      for (const contour of existingOnSlice) {
        if (contour.points && contour.points.length >= 9) {
          // Check if erase polygon intersects with this contour
          const intersects = doPolygonsIntersectSimple(erasePolygon, contour.points);
          
          if (intersects) {
            // Subtract erase area from this contour
            const { subtractContourSimple } = await import('@/lib/simple-polygon-operations');
            const subtractResults = subtractContourSimple(contour.points, erasePolygon);
            
            // Add resulting contours (there may be multiple after subtraction)
            for (const resultContour of subtractResults) {
              if (resultContour.length >= 9) {
                structure.contours.push({
                  slicePosition: payload.slicePosition,
                  points: resultContour,
                  numberOfPoints: resultContour.length / 3,
                });
              }
            }
          } else {
            // No intersection - keep original contour
            structure.contours.push({
              slicePosition: payload.slicePosition,
              points: contour.points,
              numberOfPoints: contour.numberOfPoints,
            });
          }
        }
      }

      console.log(`Erase completed - structure now has ${structure.contours.length} contours`);

      // Update state
      setLocalRTStructures(updatedStructures);

      // Pass the updated structures up to parent component
      if (onContourUpdate) {
        onContourUpdate(updatedStructures);
      }

      // Save state to undo system
      if (seriesId) {
        undoRedoManager.saveState(seriesId, 'erase_brush_stroke', payload.structureId, updatedStructures);
      }
      saveContourUpdates(updatedStructures, 'erase_brush_stroke');
      // Trigger immediate render to show contours
      try { scheduleRender(); } catch {}
    } else if (
      payload.action === "add_pen_stroke" ||
      payload.action === "cut_pen_stroke"
    ) {
      // Handle pen tool operations
      const structure = updatedStructures.structures.find(
        (s: any) => s.roiNumber === payload.structureId,
      );
      if (!structure) return;

      // Find contour on current slice - use very tight tolerance to avoid affecting adjacent slices
      const tolerance = 0.1; // 0.1mm tolerance - much tighter to prevent multi-slice issues
      const sliceContour = structure.contours.find(
        (c: any) =>
          Math.abs(c.slicePosition - payload.slicePosition) <= tolerance,
      );

      if (payload.action === "add_pen_stroke") {
        if (sliceContour) {
          // Just append the new pen stroke without connecting
          // This creates a separate blob on the same slice
          const mergedPoints = [...sliceContour.points, ...payload.points];
          sliceContour.points = mergedPoints;
          sliceContour.numberOfPoints = mergedPoints.length / 3;
        } else {
          // Create new contour from pen stroke
          structure.contours.push({
            slicePosition: payload.slicePosition,
            points: payload.points,
            numberOfPoints: payload.points.length / 3,
          });
        }
      } else if (payload.action === "cut_pen_stroke") {
        // TODO: Implement contour cutting logic
        console.log("Cut pen stroke not yet implemented");
      }

      setLocalRTStructures(updatedStructures);
      // Save state to new undo system
      if (seriesId) {
        undoRedoManager.saveState(seriesId, payload.action, payload.structureId, updatedStructures);
      }
      // Save contour updates to server
      saveContourUpdates(updatedStructures, payload.action);
      // Trigger immediate render to show contours
      try { 
        scheduleRender(); 
        // Temporary debugging notification
        console.log('🎯 CONTOUR FIX: Immediate render triggered after pen tool operation:', payload.action);
      } catch {}
    } else if (payload.action === "pen_boolean_operation") {
      // Handle pen tool boolean operations (union/subtract)
      const structure = updatedStructures.structures.find(
        (s: any) => s.roiNumber === payload.structureId,
      );
      if (!structure) return;

      // Find contour on current slice - use tight tolerance to prevent multi-slice operations
      const tolerance = 0.1;
      const contourIndex = structure.contours.findIndex(
        (c: any) =>
          Math.abs(c.slicePosition - payload.slicePosition) <= tolerance,
      );

      if (payload.operation === 'union' && contourIndex >= 0) {
        // For union, use polygon union to merge overlapping areas properly
        const existingContour = structure.contours[contourIndex];
        const existingPolygons: number[][][] = [];
        
        // Convert existing contour points to polygons
        for (let i = 0; i < existingContour.points.length; i += 3) {
          if (i === 0 || (i > 0 && existingContour.points[i-3] === undefined)) {
            // Start of a new polygon
            existingPolygons.push([]);
          }
          existingPolygons[existingPolygons.length - 1].push([
            existingContour.points[i],
            existingContour.points[i+1]
          ]);
        }
        
        // Convert new pen stroke to polygon
        const newPolygon = [];
        for (let i = 0; i < payload.points.length; i += 3) {
          newPolygon.push([payload.points[i], payload.points[i+1]]);
        }
        
        // Perform polygon union
        const allPolygons = [...existingPolygons, newPolygon];
        const unionResult = performPolygonUnion(allPolygons);
        
        // Convert union result back to points array
        const unionPoints: number[] = [];
        unionResult.forEach(polygon => {
          polygon.forEach(([x, y]) => {
            unionPoints.push(x, y, payload.slicePosition);
          });
        });
        
        // Update contour with union result
        structure.contours[contourIndex] = {
          slicePosition: payload.slicePosition,
          points: unionPoints,
          numberOfPoints: unionPoints.length / 3,
        };
        
        console.log('Pen union operation completed');
      } else if (payload.operation === 'separate') {
        // For separate blobs, always create a new contour object
        // This keeps them visually separate without complex NaN handling
        structure.contours.push({
          slicePosition: payload.slicePosition,
          points: payload.points,
          numberOfPoints: payload.points.length / 3,
        });
        console.log('Added separate blob as new contour');
      } else if (payload.operation === 'union' && contourIndex === -1) {
        // First contour on slice
        structure.contours.push({
          slicePosition: payload.slicePosition,
          points: payload.points,
          numberOfPoints: payload.points.length / 3,
        });
      } else if (payload.operation === 'new') {
        // Handle the simple case - just add new contour from resultContours
        if (payload.resultContours && payload.resultContours.length > 0) {
          // resultContours is an array of polygons
          // For 'new' operation, we expect a single polygon
          const polygon = payload.resultContours[0];
          const points = [];
          
          // Convert polygon points to flat array
          for (let i = 0; i < polygon.length; i += 2) {
            points.push(polygon[i], polygon[i + 1], payload.slicePosition);
          }
          
          structure.contours.push({
            slicePosition: payload.slicePosition,
            points: points,
            numberOfPoints: points.length / 3,
          });
        }
      } else if (payload.operation === 'subtract') {
        // For subtraction, calculate the result using ClipperLib
        console.log('🔴 STARTING SUBTRACTION OPERATION:', {
          contourIndex,
          existingContoursAtSlice: structure.contours.filter((c: any) => 
            Math.abs(c.slicePosition - payload.slicePosition) <= tolerance
          ).length,
          slicePosition: payload.slicePosition
        });
        
        if (contourIndex >= 0) {
          // Get the existing contour to subtract from
          const existingContour = structure.contours[contourIndex];
          
          // Convert points to polygons for ClipperLib
          const existingPolygon = [];
          for (let i = 0; i < existingContour.points.length; i += 3) {
            existingPolygon.push([existingContour.points[i], existingContour.points[i+1]]);
          }
          
          const newPolygon = [];
          for (let i = 0; i < payload.points.length; i += 3) {
            newPolygon.push([payload.points[i], payload.points[i+1]]);
          }
          
          // Perform subtraction using ClipperLib
          const subtractResult = subtractContours(
            existingContour.points,
            payload.points
          );
          
          console.log('📐 Subtraction result:', {
            existingPoints: existingContour.points.length / 3,
            newPoints: payload.points.length / 3,
            resultPoints: subtractResult.length / 3
          });
          
          // Remove the original contour
          structure.contours.splice(contourIndex, 1);
          
          if (subtractResult.length === 0) {
            console.log('🗑️ Subtraction resulted in empty contour, removed slice');
          } else {
            // Add the subtraction result as new contour
            structure.contours.push({
              slicePosition: payload.slicePosition,
              points: subtractResult,
              numberOfPoints: subtractResult.length / 3,
            });
            console.log(`✅ Pen subtraction completed, replaced contour with ${subtractResult.length / 3} points`);
          }
        } else {
          console.warn('⚠️ Subtraction operation called but no existing contour found');
        }
      }

      setLocalRTStructures(updatedStructures);
      saveContourUpdates(updatedStructures, 'pen_boolean_operation');
      // Trigger immediate render to show contours
      try { scheduleRender(); } catch {}
    } else if (payload.action === "update_rt_structures") {
      // Simple update after pen tool operations - structure already modified directly
      setLocalRTStructures(updatedStructures);
      // Save state to undo system
      if (seriesId && payload.structureId) {
        undoRedoManager.saveState(seriesId, 'pen_tool', payload.structureId, updatedStructures);
      }
      // Save to server
      saveContourUpdates(updatedStructures, 'pen_tool');
      // Trigger immediate render to show contours
      try { scheduleRender(); } catch {}
    } else if (payload.action === "replace_contour") {
      // Handle contour replacement (morphing)
      const structure = updatedStructures.structures.find(
        (s: any) => s.roiNumber === payload.structureId,
      );
      if (!structure) return;

      // Find and replace the contour on current slice
      const contourIndex = structure.contours.findIndex(
        (c: any) =>
          Math.abs(c.slicePosition - payload.slicePosition) <= SLICE_TOL_MM,
      );

      if (contourIndex >= 0) {
        // Replace existing contour with new points
        structure.contours[contourIndex] = {
          slicePosition: payload.slicePosition,
          points: payload.points,
          numberOfPoints: payload.points.length / 3,
        };
        console.log(
          `Replaced contour at slice ${payload.slicePosition} with ${payload.points.length / 3} points`,
        );
      } else {
        // Create new contour if none exists
        structure.contours.push({
          slicePosition: payload.slicePosition,
          points: payload.points,
          numberOfPoints: payload.points.length / 3,
        });
        console.log(
          `Created new contour at slice ${payload.slicePosition} with ${payload.points.length / 3} points`,
        );
      }

      setLocalRTStructures(updatedStructures);
    } else if (payload.action === "merge_contours") {
      // Handle boolean merge operation (union) - properly merges multiple contours into one
      const structure = updatedStructures.structures.find(
        (s: any) => s.roiNumber === payload.structureId,
      );
      if (!structure) return;

      // Replace all contours at this slice with the merged result
      
      // Remove all existing contours at this slice
      structure.contours = structure.contours.filter(
        (c: any) => Math.abs(c.slicePosition - payload.slicePosition) > SLICE_TOL_MM
      );

      // Add the merged contours from the boolean operation
      if (payload.contours && payload.contours.length > 0) {
        payload.contours.forEach((contourPoints: number[]) => {
          if (contourPoints.length >= 9) {
            structure.contours.push({
              slicePosition: payload.slicePosition,
              points: contourPoints,
              numberOfPoints: contourPoints.length / 3,
            });
          }
        });
        console.log(`Merged contours at slice ${payload.slicePosition}: ${payload.contours.length} contours added`);
      }

      setLocalRTStructures(updatedStructures);
      saveContourUpdates(updatedStructures, 'merge_contours');
    } else if (payload.action === "subtract_contours") {
      // Handle boolean subtract operation (difference)
      const structure = updatedStructures.structures.find(
        (s: any) => s.roiNumber === payload.structureId,
      );
      if (!structure) return;

      // Replace all contours at this slice with the subtraction result
      
      // Remove all existing contours at this slice
      structure.contours = structure.contours.filter(
        (c: any) => Math.abs(c.slicePosition - payload.slicePosition) > SLICE_TOL_MM
      );

      // Add the resulting contours from the boolean operation
      if (payload.contours && payload.contours.length > 0) {
        payload.contours.forEach((contourPoints: number[]) => {
          if (contourPoints.length >= 9) {
            structure.contours.push({
              slicePosition: payload.slicePosition,
              points: contourPoints,
              numberOfPoints: contourPoints.length / 3,
            });
          }
        });
        console.log(`Subtraction result at slice ${payload.slicePosition}: ${payload.contours.length} contours added`);
      } else {
        console.log(`Subtraction result at slice ${payload.slicePosition}: all contours removed`);
      }

      setLocalRTStructures(updatedStructures);
      saveContourUpdates(updatedStructures, 'subtract_contours');
    } else if (payload.action === "grow_contour") {
      // Handle contour growing
      handleGrowContour(payload);
    } else if (payload.action === "apply_grow_contour") {
      // Handle applying previewed grow/shrink operation (single slice - legacy)
      console.log("🔹 Applying grow/shrink operation:", payload);
      handleGrowContour(payload);
      // Clear preview after applying
      setPreviewContours([]);
    } else if (payload.action === "apply_grow_structure") {
      // Handle applying grow/shrink to entire structure
      console.log("🔹 Applying grow/shrink to ENTIRE STRUCTURE:", payload);
      handleGrowStructure(payload);
      // Clear preview after applying
      setPreviewContours([]);
    } else if (payload.action === "apply_margin") {
      // Handle margin operation (Eclipse TPS style)
      handleMarginOperation(payload);
    } else if (payload.action === "boolean_operation") {
      // Handle boolean operations (combine/subtract)
      await handleBooleanOperation(payload);
    } else if (payload.action === "delete_slice") {
      // Handle delete slice action - only delete the contour for the selected structure
      const structure = updatedStructures.structures.find(
        (s: any) => s.roiNumber === payload.structureId,
      );
      if (!structure) {
        console.warn(`Structure ${payload.structureId} not found for delete operation`);
        return;
      }

      // Log current state before deletion
      console.log(`Before delete: Structure ${payload.structureId} has ${structure.contours.length} contours`);
      
      // Remove contour at specified slice position for this structure only - tight tolerance
      const originalLength = structure.contours.length;
      structure.contours = structure.contours.filter(
        (c: any) => Math.abs(c.slicePosition - payload.slicePosition) > SLICE_TOL_MM
      );

      const deletedCount = originalLength - structure.contours.length;
      console.log(`Deleted ${deletedCount} contour(s) for structure ${payload.structureId} (${structure.structureName}) at slice ${payload.slicePosition}`);
      console.log(`After delete: Structure ${payload.structureId} has ${structure.contours.length} contours`);
      
      // Log all structures to verify others are not affected
      console.log("All structures after delete:", updatedStructures.structures.map((s: any) => ({
        id: s.roiNumber,
        name: s.structureName,
        contourCount: s.contours.length
      })));
      
      setLocalRTStructures(updatedStructures);
      // Pass the full updated structures to parent
      if (onContourUpdate) {
        onContourUpdate(updatedStructures);
      }
      saveContourUpdates(updatedStructures, 'delete_slice');
    } else if (payload.action === "clear_all") {
      // Handle clear all slices action
      const structure = updatedStructures.structures.find(
        (s: any) => s.roiNumber === payload.structureId,
      );
      if (!structure) return;

      // Clear all contours for this structure
      structure.contours = [];

      console.log(`Cleared all contours for structure ${payload.structureId}`);
      
      setLocalRTStructures(updatedStructures);
      saveContourUpdates(updatedStructures, 'clear_all');
    } else if (payload.action === "interpolate") {
      // Handle interpolate missing slices (SDT multi-loop with CT-grid targeting)
      const structure = updatedStructures.structures.find((s: any) => s.roiNumber === payload.structureId);
      if (!structure || !structure.contours || structure.contours.length < 2) {
        console.log("Not enough contours to interpolate");
        return;
      }

      // Group contours by slice position
      const byZ = new Map<number, any[]>();
      for (const c of structure.contours) {
        const arr = byZ.get(c.slicePosition) || [];
        arr.push(c);
        byZ.set(c.slicePosition, arr);
      }
      const zKeys = Array.from(byZ.keys()).sort((a, b) => a - b);

      // Build CT Z array (mm) for real slice targeting
      const zArrayRaw: number[] = images.map((img: any) => {
        let z = img.parsedSliceLocation ?? img.parsedZPosition;
        if (z == null) {
          const m = img.imageMetadata || img;
          if (m?.sliceLocation != null) z = parseFloat(m.sliceLocation);
          else if (m?.imagePosition) {
            const pos = typeof m.imagePosition === 'string' ? m.imagePosition.split('\\').map(Number) : m.imagePosition;
            if (Array.isArray(pos) && pos.length >= 3) z = Number(pos[2]);
          }
        }
        return Number(z);
      }).filter((z: any) => Number.isFinite(z));
      const zArray = [...zArrayRaw].sort((a, b) => a - b);
      const tol = SLICE_TOL_MM;

      const newContours: any[] = [];
      for (let i = 0; i < zKeys.length - 1; i++) {
        const zA = zKeys[i];
        const zB = zKeys[i + 1];
        const listA = byZ.get(zA)!;
        const listB = byZ.get(zB)!;
        // Keep originals
        newContours.push(...listA);
        const zMin = Math.min(zA, zB) + tol;
        const zMax = Math.max(zA, zB) - tol;
        for (const z of zArray) {
          if (z > zMin && z < zMax) {
            let pts: number[] = [];
            try {
              const { interpolateBetweenContoursSDTMulti } = await import('@/lib/sdt-interpolation');
              pts = interpolateBetweenContoursSDTMulti(
                listA, zA, listB, zB, z,
                { gridSpacingMm: 0.25, paddingMm: 3, adaptiveMinCells: 180, pivotPiecewise: true, pivotMode: 'euclidean', closingMm: 0.3 }
              );
            } catch {}
            if (!pts || pts.length < 9) {
              // fallback to polar using largest contour of each slice
              const a0 = listA[0], b0 = listB[0];
              const { interpolateBetweenContoursPolar } = await import('@/lib/contour-interpolation');
              pts = interpolateBetweenContoursPolar(a0.points, zA, b0.points, zB, z, 512, true, false);
            }
            if (pts && pts.length >= 9) newContours.push({ slicePosition: z, points: pts, numberOfPoints: pts.length / 3 });
          }
        }
      }
      // push last originals
      const lastZ = zKeys[zKeys.length - 1];
      newContours.push(...(byZ.get(lastZ) || []));
      structure.contours = newContours;
      console.log(`Interpolated ${newContours.length - structure.contours.length} new slices for structure ${payload.structureId}`);
      setLocalRTStructures(updatedStructures);
      saveContourUpdates(updatedStructures, 'interpolate');
      try { scheduleRender(); } catch {}
    } else if (payload.action === "delete_nth_slice") {
      // Handle delete every nth slice
      const structure = updatedStructures.structures.find(
        (s: any) => s.roiNumber === payload.structureId,
      );
      if (!structure) return;

      // Sort contours by slice position
      const sortedContours = [...structure.contours].sort((a: any, b: any) => a.slicePosition - b.slicePosition);
      
      // Keep only contours that are not at nth positions
      const filteredContours = sortedContours.filter((_, index) => {
        // Keep the first contour (index 0), delete every nth after that
        return index === 0 || (index % payload.nth) !== 0;
      });
      
      structure.contours = filteredContours;
      const deletedCount = sortedContours.length - filteredContours.length;
      console.log(`Deleted ${deletedCount} contours (every ${payload.nth} slice) for structure ${payload.structureId}`);
      
      setLocalRTStructures(updatedStructures);
      saveContourUpdates(updatedStructures, 'delete_nth_slice');
    } else if (payload.action === "clear_below") {
      // Handle clear below current slice
      const structure = updatedStructures.structures.find(
        (s: any) => s.roiNumber === payload.structureId,
      );
      if (!structure) return;

      const originalCount = structure.contours.length;
      structure.contours = structure.contours.filter(
        (c: any) => c.slicePosition >= payload.slicePosition
      );
      
      const deletedCount = originalCount - structure.contours.length;
      console.log(`Cleared ${deletedCount} contours below slice ${payload.slicePosition} for structure ${payload.structureId}`);
      
      setLocalRTStructures(updatedStructures);
      saveContourUpdates(updatedStructures, 'clear_below');
    } else if (payload.action === "clear_above") {
      // Handle clear above current slice
      const structure = updatedStructures.structures.find(
        (s: any) => s.roiNumber === payload.structureId,
      );
      if (!structure) return;

      const originalCount = structure.contours.length;
      structure.contours = structure.contours.filter(
        (c: any) => c.slicePosition <= payload.slicePosition
      );
      
      const deletedCount = originalCount - structure.contours.length;
      console.log(`Cleared ${deletedCount} contours above slice ${payload.slicePosition} for structure ${payload.structureId}`);
      
      setLocalRTStructures(updatedStructures);
      saveContourUpdates(updatedStructures, 'clear_above');
    } else if (payload.action === "smooth") {
      // Handle contour smoothing
      const structure = updatedStructures.structures.find(
        (s: any) => s.roiNumber === payload.structureId,
      );
      if (!structure) {
        console.error(`Structure ${payload.structureId} not found`);
        return;
      }

      // Apply smoothing to all contours in the structure
      const { smoothContour } = await import('@/lib/contour-smooth-simple');
      const smoothingFactor = payload.smoothingFactor || 0.15;
      
      structure.contours = structure.contours.map((contour: any) => {
        if (contour.points && contour.points.length >= 9) {
          const smoothedContour = smoothContour(
            {
              points: contour.points,
              slicePosition: contour.slicePosition
            },
            smoothingFactor
          );
          
          return {
            ...contour,
            points: smoothedContour.points,
            numberOfPoints: smoothedContour.points.length / 3
          };
        }
        return contour;
      });

      console.log(`Applied smoothing to structure ${payload.structureId} with factor ${smoothingFactor}`);
      
      setLocalRTStructures(updatedStructures);
      
      // Pass the updated structures up to parent component
      if (onContourUpdate) {
        onContourUpdate(updatedStructures);
      }

      // Save state to undo system
      if (seriesId) {
        undoRedoManager.saveState(seriesId, 'smooth', payload.structureId, updatedStructures);
      }
      saveContourUpdates(updatedStructures, 'smooth');
    } else if (payload.action === 'open_remove_blobs_dialog') {
      const structure = updatedStructures.structures.find((s: any) => s.roiNumber === payload.structureId);
      if (!structure || !Array.isArray(structure.contours)) return;
      const blobs = groupStructureBlobs(structure, SLICE_TOL_MM).map((b, idx) => ({
        id: idx + 1,
        volumeCc: computeBlobVolumeCc(b, imageMetadata),
        contours: b
      }));
      if (!blobs || blobs.length <= 1) {
        return;
      }
      setSelectedBlobIdsToDelete(new Set());
      setBlobDialogData({ structureId: payload.structureId, blobs });
      setBlobDialogOpen(true);
    } else if (payload.action === 'separate_blobs') {
      const structure = updatedStructures.structures.find((s: any) => s.roiNumber === payload.structureId);
      if (!structure || !Array.isArray(structure.contours)) return;
      const blobs = groupStructureBlobs(structure, SLICE_TOL_MM);
      if (!blobs || blobs.length <= 1) {
        return;
      }
      const baseName = String(structure.structureName || 'Structure');
      const color = Array.isArray(structure.color) ? structure.color : [0, 255, 0];
      const maxRoi = Math.max(0, ...updatedStructures.structures.map((s: any) => s.roiNumber || 0));
      let nextRoi = maxRoi + 1;
      blobs.forEach((blobContours, index) => {
        updatedStructures.structures.push({
          roiNumber: nextRoi++,
          structureName: `${baseName}_${index + 1}`,
          color,
          contours: blobContours
        });
      });
      structure.contours = [];
      setLocalRTStructures(updatedStructures);
      if (seriesId) {
        undoRedoManager.saveState(seriesId, 'separate_blobs', payload.structureId, updatedStructures);
      }
      saveContourUpdates(updatedStructures, 'separate_blobs');
    }
  };

  // Expose methods to parent component
  useImperativeHandle(ref, () => ({
    handleContourUpdate,
    setPanMode: () => {
      setIsPanMode(true);
      setCrosshairMode(false);
      console.log('Pan mode activated');
    },
    setCrosshairMode: () => {
      setIsPanMode(false);
      setCrosshairMode(true);
      console.log('Crosshair mode activated');
    },
    openFusionDebug,
    navigateToSlice: (targetZ: number) => {
      if (!images || images.length === 0) {
        console.warn('🎯 Cannot navigate: no images available');
        return;
      }

      console.log(`🎯 Navigating to Z position: ${targetZ.toFixed(1)}`);

      // Find the closest slice to the target Z position
      let closestIndex = 0;
      let closestDistance = Infinity;

      images.forEach((image, index) => {
        // Get Z position from image metadata
        let imageZ = index; // fallback to index (synthetic)
        
        if (image.imageMetadata?.imagePosition || image.imagePosition) {
          const pos = Array.isArray(image.imagePosition)
            ? image.imagePosition
            : (typeof image.imagePosition === 'string' ? image.imagePosition.split("\\").map(Number) : (Array.isArray(image.imageMetadata?.imagePosition) ? image.imageMetadata.imagePosition : String(image.imageMetadata?.imagePosition||'').split("\\").map(Number)));
          if (pos && pos.length >= 3 && isFinite(pos[2])) imageZ = pos[2];
        } else if (image.parsedSliceLocation !== undefined && image.parsedSliceLocation !== null) {
          imageZ = image.parsedSliceLocation;
        } else if (image.parsedZPosition !== undefined && image.parsedZPosition !== null) {
          imageZ = image.parsedZPosition;
        } else if (image.imageMetadata?.sliceLocation !== undefined) {
          const parsed = parseFloat(image.imageMetadata.sliceLocation);
          if (!isNaN(parsed)) {
            imageZ = parsed;
          }
        } else if (image.imageMetadata?.imagePosition) {
          const imagePos = typeof image.imageMetadata.imagePosition === 'string'
            ? image.imageMetadata.imagePosition.split("\\")
            : image.imageMetadata.imagePosition;
          if (imagePos && imagePos.length >= 3) {
            const parsed = parseFloat(imagePos[2]);
            if (!isNaN(parsed)) {
              imageZ = parsed;
            }
          }
        }

        const distance = Math.abs(imageZ - targetZ);
        if (distance < closestDistance) {
          closestDistance = distance;
          closestIndex = index;
        }
      });
      // Navigate to the closest slice
      setCurrentIndex(closestIndex);
    },
  }), [rtStructures, images, setCurrentIndex]);

  // Handle auto-zoom when autoZoomLevel prop changes - DISABLED FOR DEBUGGING
  /*
  useEffect(() => {
    if (autoZoomLevel && autoZoomLevel !== zoom) {
      setZoom(autoZoomLevel);
      if (images.length > 0) {
        scheduleRender();
      }
    }
  }, [autoZoomLevel, zoom, images.length]);
  */

  // Handle auto-localize when autoLocalizeTarget prop changes
  useEffect(() => {
    if (autoLocalizeTarget) {
      const { x, y, z } = autoLocalizeTarget;
      // Convert world coordinates to pan offsets
      // Scale the coordinates appropriately for the canvas
      const scaleFactor = 0.1; // Adjust this value as needed
      setPanX(-x * scaleFactor);
      setPanY(-y * scaleFactor);
      setLastPanX(-x * scaleFactor);
      setLastPanY(-y * scaleFactor);
      if (images.length > 0) {
        scheduleRender();
      }
    }
  }, [autoLocalizeTarget, images.length]);

  useEffect(() => {
    loadImages();
  }, [seriesId]);

  useEffect(() => {
    if (!registrationAssociations) {
      setRegistrationAssociationsForPrimary([]);
      return;
    }
    const list = registrationAssociations.get(seriesId) || [];
    console.log('registration associations for primary', { seriesId, list });
    setRegistrationAssociationsForPrimary(list);
  }, [registrationAssociations, seriesId]);

  useEffect(() => {
    if (secondarySeriesId == null) {
      setSelectedRegistrationId(null);
      return;
    }
    if (!registrationOptions.length) {
      setSelectedRegistrationId(null);
      return;
    }
    const hasSelected = registrationOptions.some(opt => (opt.id ?? null) === (selectedRegistrationId ?? null));
    if (!hasSelected) {
      setSelectedRegistrationId(registrationOptions[0].id ?? null);
    }
  }, [secondarySeriesId, registrationOptions, selectedRegistrationId]);

  // Apply registration matrix derived from association graph instead of resolve endpoint
  useEffect(() => {
    if (!seriesId || secondarySeriesId == null) {
      if (registrationMatrixRef.current !== null) {
        registrationMatrixRef.current = null;
        setRegistrationMatrix(null);
      }
      setLastResolveInfo({
        status: 204,
        ok: false,
        data: {
          reason: !seriesId ? 'missing-primary-series' : 'missing-secondary-series',
          primarySeriesId: seriesId ?? null,
          secondarySeriesId: secondarySeriesId ?? null,
        },
      });
      return;
    }

    if (!registrationOptions.length) {
      if (registrationMatrixRef.current !== null) {
        registrationMatrixRef.current = null;
        setRegistrationMatrix(null);
      }
      setLastResolveInfo({
        status: 404,
        ok: false,
        data: {
          reason: 'no-registration-options',
          primarySeriesId: seriesId,
          secondarySeriesId,
        },
      });
      return;
    }

    const selectedOption = registrationOptions.find(opt => (opt.id ?? null) === (selectedRegistrationId ?? null))
      ?? registrationOptions[0];

    if (!selectedOption) {
      if (registrationMatrixRef.current !== null) {
        registrationMatrixRef.current = null;
        setRegistrationMatrix(null);
      }
      setLastResolveInfo({
        status: 404,
        ok: false,
        data: {
          reason: 'registration-option-not-found',
          primarySeriesId: seriesId,
          secondarySeriesId,
          registrationId: selectedRegistrationId ?? null,
        },
      });
      return;
    }

    const derivedMatrix = Array.isArray(selectedOption.matrix) && selectedOption.matrix.length === 16
      ? selectedOption.matrix.slice()
      : (selectedOption.relationship === 'shared-frame' ? cloneIdentityMatrix() : null);

    if (derivedMatrix) {
      if (!matricesEqual(registrationMatrixRef.current, derivedMatrix)) {
        registrationMatrixRef.current = derivedMatrix;
        setRegistrationMatrix(derivedMatrix);
      } else if (registrationMatrixRef.current === null) {
        registrationMatrixRef.current = derivedMatrix;
        setRegistrationMatrix(derivedMatrix);
      }
      setLastResolveInfo({
        status: 200,
        ok: true,
        data: {
          source: 'associations',
          registrationId: selectedOption.id ?? null,
          relationship: selectedOption.relationship,
          regFile: selectedOption.regFile ?? null,
          targetSeriesId: selectedOption.association?.targetSeriesId ?? null,
          sourceSeriesIds: selectedOption.association?.sourcesSeriesIds ?? [],
        },
      });
    } else {
      if (registrationMatrixRef.current !== null) {
        registrationMatrixRef.current = null;
        setRegistrationMatrix(null);
      }
      setLastResolveInfo({
        status: 422,
        ok: false,
        data: {
          source: 'associations',
          registrationId: selectedOption.id ?? null,
          relationship: selectedOption.relationship,
          reason: 'missing-matrix',
        },
      });
    }
  }, [seriesId, secondarySeriesId, registrationOptions, selectedRegistrationId]);
  
  // Re-render fusion overlay when registration matrix updates
  useEffect(() => {
    fuseboxCacheRef.current.clear();
    clearFusionSlices(seriesId);
    setFuseboxTransformSource(null);
    scheduleRender();
  }, [registrationMatrix, secondarySeriesId, selectedRegistrationId, scheduleRender, seriesId]);

  useEffect(() => {
    if (!secondarySeriesId) {
      setSecondaryModality('MR');
      setFuseboxTransformSource(null);
      fuseboxCacheRef.current.clear();
      clearFusionSlices(seriesId);
      return;
    }

    let cancelled = false;
    const loadMetadata = async () => {
      try {
        const response = await fetch(`/api/series/${secondarySeriesId}`);
        if (!response.ok) return;
        const data = await response.json();
        if (!cancelled && data?.modality) {
          setSecondaryModality(data.modality);
        }
      } catch {}
    };

    fuseboxCacheRef.current.clear();
    clearFusionSlices(seriesId);
    loadMetadata();

    return () => {
      cancelled = true;
    };
  }, [secondarySeriesId, seriesId]);

  // Auto-trigger background loading when primary images and registration are ready
  // TEMPORARILY DISABLED to fix scrolling and flashing issues
  // useEffect(() => {
  //   if (images.length > 0 && registrationMatrix && registrationMatrix.length === 16) {
  //     // Small delay to ensure primary is fully loaded before starting background tasks
  //     const timer = setTimeout(() => {
  //       startBackgroundLoading();
  //     }, 1000);
  //     
  //     return () => clearTimeout(timer);
  //   }
  // }, [images.length, registrationMatrix, startBackgroundLoading]);

  useEffect(() => {
    if (images.length > 0 && !isPreloading) {
      // Immediate rendering for smooth scrolling - this is critical for DICOM viewer performance
      scheduleRender();
      
      // Load metadata for current image with minimal delay
      const currentImage = images[currentIndex];
      if (currentImage?.id) {
        setTimeout(() => {
          loadImageMetadata(currentImage.id);
        }, 5); // Minimal delay only for metadata
      }
    }
  }, [images, currentIndex, isPreloading]);

  // Separate effect for window level changes - only re-render, don't reload metadata
  useEffect(() => {
    if (images.length > 0 && !isPreloading) {
      // Clear MPR cache on window/level change for proper updates
      if (mprCacheRef.current.size > 0) {
        if (DEBUG) console.log('Clearing MPR cache due to window/level change');
        mprCacheRef.current.clear();
      }
      scheduleRender();
    }
  }, [currentWindowLevel, zoom, panX, panY, images.length, isPreloading, fusionDisplayMode]);

  const loadImages = async () => {
    try {
      // Check if images are already cached
      if (imageCache?.current.has(seriesId.toString())) {
        const cached = imageCache.current.get(seriesId.toString());
        if (cached) {
          console.log(`Using cached images for series ${seriesId}`);
          setImages(cached.images);
          setCurrentIndex(0);
          setIsLoading(false);
          // Schedule initial render
          setTimeout(() => {
            displayCurrentImage();
          }, 10);
          // Start background prefetching for remaining images
          startBackgroundPrefetch(cached.images);
          return;
        }
      }
      
      setIsLoading(true);
      setError(null);

      // Check GPU acceleration availability for Cornerstone3D migration
      if (!gpuCheckComplete) {
        const gpuAvailable = isGPUAccelerationAvailable();
        console.log(`🖥️ GPU acceleration available: ${gpuAvailable ? 'YES ✅' : 'NO ❌'}`);
        setIsGPUMode(gpuAvailable);
        setGpuCheckComplete(true);
        
        if (gpuAvailable) {
          console.log('GPU acceleration detected - ready for Cornerstone3D migration phase');
          // Initialize Cornerstone3D in the next steps
        } else {
          console.log('No GPU acceleration - will continue using Cornerstone Core');
        }
      }

      // Cancel any existing series load
      if (seriesAbortRef.current) {
        seriesAbortRef.current.abort();
      }
      
      // Create new abort controller for this series
      seriesAbortRef.current = new AbortController();
      const signal = seriesAbortRef.current.signal;

      const response = await fetch(`/api/series/${seriesId}/images`, { signal });
      if (!response.ok) {
        throw new Error(`Failed to load images: ${response.statusText}`);
      }

      const seriesImages = await response.json();

      // Use batch metadata parsing for much better performance (1 request vs 300+)
      console.log(`📊 Loading metadata for ${seriesImages.length} images using batch API...`);
      let imagesWithMetadata;
      try {
        const batchResponse = await fetch(`/api/series/${seriesId}/batch-metadata`, { signal });
        if (batchResponse.ok) {
          const batchMetadata = await batchResponse.json();
          
          // Create lookup map for faster matching
          const metadataMap = new Map();
          batchMetadata.forEach((meta: any) => {
            metadataMap.set(meta.sopInstanceUID, meta);
          });
          
          // Merge batch metadata with series images
          imagesWithMetadata = seriesImages.map((img: any) => {
            const metadata = metadataMap.get(img.sopInstanceUID);
            if (metadata && !metadata.error) {
              return {
                ...img,
                parsedSliceLocation: metadata.parsedSliceLocation,
                parsedZPosition: metadata.parsedZPosition,
                parsedInstanceNumber: metadata.parsedInstanceNumber ?? img.instanceNumber,
              };
            } else {
              return {
                ...img,
                parsedSliceLocation: null,
                parsedZPosition: null,
                parsedInstanceNumber: img.instanceNumber,
              };
            }
          });
          
          console.log(`✅ Batch metadata loaded successfully for ${imagesWithMetadata.length} images`);
        } else {
          throw new Error('Batch metadata endpoint failed');
        }
      } catch (error) {
        console.warn('Batch metadata loading failed, falling back to individual parsing:', error);
        
        // Fallback to individual metadata parsing if batch fails
        const workerManager = getDicomWorkerManager();
        imagesWithMetadata = await Promise.all(
          seriesImages.map(async (img: any) => {
            try {
              const response = await fetch(`/api/images/${img.sopInstanceUID}`, { signal });
              const arrayBuffer = await response.arrayBuffer();
              const metadata = await workerManager.parseDicomMetadata(arrayBuffer);

              return {
                ...img,
                parsedSliceLocation: metadata.parsedSliceLocation,
                parsedZPosition: metadata.parsedZPosition,
                parsedInstanceNumber: metadata.parsedInstanceNumber ?? img.instanceNumber,
              };
            } catch (error) {
              console.warn(`Failed to parse DICOM metadata for ${img.fileName}:`, error);
              return {
                ...img,
                parsedSliceLocation: null,
                parsedZPosition: null,
                parsedInstanceNumber: img.instanceNumber,
              };
            }
          }),
        );
      }

      // Sort by spatial position - prefer slice location, then z-position, then instance number
      const sortedImages = imagesWithMetadata.sort((a: any, b: any) => {
        // Primary: slice location
        if (a.parsedSliceLocation !== null && b.parsedSliceLocation !== null) {
          return a.parsedSliceLocation - b.parsedSliceLocation;
        }

        // Secondary: z-position from image position
        if (a.parsedZPosition !== null && b.parsedZPosition !== null) {
          return a.parsedZPosition - b.parsedZPosition;
        }

        // Tertiary: instance number
        if (
          a.parsedInstanceNumber !== null &&
          b.parsedInstanceNumber !== null
        ) {
          return a.parsedInstanceNumber - b.parsedInstanceNumber;
        }

        // Final fallback: filename
        return a.fileName.localeCompare(b.fileName, undefined, {
          numeric: true,
        });
      });

      setImages(sortedImages);
      setCurrentIndex(0);
      
      // Cache the sorted images
      if (imageCache?.current) {
        imageCache.current.set(seriesId.toString(), {
          images: sortedImages,
          metadata: null // TODO: Add metadata if needed
        });
        console.log(`Cached ${sortedImages.length} images for series ${seriesId}`);
      }

      // Load the first image before removing loading screen
      if (sortedImages.length > 0) {
        try {
          const firstImage = sortedImages[0];
          const imageData = await fetchAndParseImage(firstImage.sopInstanceUID, signal);
          if (imageData) {
            // First image loaded, now we can remove loading screen
            setIsLoading(false);
            // Schedule initial render
            setTimeout(() => {
              displayCurrentImage();
            }, 10);
          }
        } catch (err) {
          console.error('Failed to load first image:', err);
        }
      }

      // OHIF 3.10-style background prefetching - runs after initial display
      // This doesn't block the UI and loads remaining images in background
      setTimeout(() => {
        console.log('📚 Starting OHIF-style background prefetching...');
        startBackgroundPrefetch(sortedImages);
      }, 100); // Small delay to ensure UI is responsive
    } catch (error: any) {
      // Don't show error for aborted requests (happens when switching series)
      if (error.name === 'AbortError') {
        console.log('Series load aborted (user switched series)');
        return;
      }
      setError(error.message);
      setIsLoading(false);
    }
  };

  const parseDicomImage = async (arrayBuffer: ArrayBuffer) => {
    try {
      // Use web worker for 65% performance improvement
      const workerManager = getDicomWorkerManager();
      const result = await workerManager.parseDicomImage(arrayBuffer);
      return result;
    } catch (error) {
      console.error("Error parsing DICOM image:", error);
      return null;
    }
  };

  // Single fetch/parse function to avoid double fetching
  const fetchAndParseImage = async (sopInstanceUID: string, signal?: AbortSignal) => {
    // Check if already in cache
    if (imageCacheRef.current.has(sopInstanceUID)) {
      return imageCacheRef.current.get(sopInstanceUID);
    }
    
    const response = await fetch(`/api/images/${sopInstanceUID}`, { signal });
    if (!response.ok) {
      throw new Error(`Failed to load image: ${response.status}`);
    }
    
    const arrayBuffer = await response.arrayBuffer();
    const imageData = await parseDicomImage(arrayBuffer);
    
    if (imageData) {
      imageCacheRef.current.set(sopInstanceUID, imageData);
    }
    
    return imageData;
  };
  
  // Batch fetch multiple images at once for better performance
  const fetchBatchImages = async (sopInstanceUIDs: string[], signal?: AbortSignal): Promise<Map<string, any>> => {
    const results = new Map<string, any>();
    
    // Filter out already cached images
    const uncachedUIDs = sopInstanceUIDs.filter(uid => !imageCacheRef.current.has(uid));
    
    if (uncachedUIDs.length === 0) {
      // All images are cached
      sopInstanceUIDs.forEach(uid => {
        const cached = imageCacheRef.current.get(uid);
        if (cached) results.set(uid, cached);
      });
      return results;
    }
    
    try {
      const response = await fetch('/api/images/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sopInstanceUIDs: uncachedUIDs }),
        signal
      });
      
      if (!response.ok) {
        throw new Error(`Batch fetch failed: ${response.status}`);
      }
      
      const batchData = await response.json();
      
      // Process batch results in parallel
      await Promise.all(Object.entries(batchData).map(async ([uid, result]: [string, any]) => {
        if (result.data) {
          // Convert base64 back to ArrayBuffer
          const binaryString = atob(result.data);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          
          const imageData = await parseDicomImage(bytes.buffer);
          if (imageData) {
            imageCacheRef.current.set(uid, imageData);
            results.set(uid, imageData);
          }
        }
      }));
      
      // Add cached images to results
      sopInstanceUIDs.forEach(uid => {
        const cached = imageCacheRef.current.get(uid);
        if (cached && !results.has(uid)) {
          results.set(uid, cached);
        }
      });
      
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.error('Batch fetch error:', error);
      }
      throw error;
    }
    
    return results;
  };

  // OHIF 3.10-style background prefetch - non-blocking and progressive
  const startBackgroundPrefetch = async (imageList: any[]) => {
    if (!imageList || imageList.length === 0 || prefetchCompleteRef.current) {
      return;
    }

    console.log(`🚀 OHIF-style background prefetch starting for ${imageList.length} images`);
    
    setPrefetchProgress({ loaded: imageCacheRef.current.size, total: imageList.length });
    
    const BATCH_SIZE = 50; // Match server batch size
    const PREFETCH_RADIUS = 10; // Images to prioritize around current position
    const COMPLETION_THRESHOLD = 0.95; // Hide progress at 95% complete
    const MAX_PREFETCH_TIME = 30000; // 30 second timeout
    let loadedCount = imageCacheRef.current.size;
    let failedCount = 0;
    const startTime = Date.now();
    
    // Auto-hide progress after timeout
    setTimeout(() => {
      if (!prefetchCompleteRef.current) {
        console.log('⏱️ Background prefetch timeout - hiding progress indicator');
        prefetchCompleteRef.current = true;
        setPrefetchProgress({ loaded: 0, total: 0 }); // Hide progress
      }
    }, MAX_PREFETCH_TIME);
    
    // Create priority queue based on viewing position
    const getPriority = (index: number) => {
      const distance = Math.abs(index - currentIndex);
      if (distance <= PREFETCH_RADIUS) return 0; // Highest priority
      return distance;
    };
    
    // Sort images by priority
    const prioritizedIndices = imageList
      .map((_, idx) => idx)
      .sort((a, b) => getPriority(a) - getPriority(b));
    
    // Process batches in background using requestIdleCallback for better performance
    const processBatch = async (startIdx: number) => {
      if (prefetchCompleteRef.current || !seriesAbortRef.current) return;
      
      // Check if we've loaded enough images
      const loadedPercentage = loadedCount / imageList.length;
      if (loadedPercentage >= COMPLETION_THRESHOLD) {
        prefetchCompleteRef.current = true;
        console.log(`✅ Background prefetch sufficient: ${loadedCount}/${imageList.length} images (${Math.round(loadedPercentage * 100)}%)`);
        setPrefetchProgress({ loaded: 0, total: 0 }); // Hide progress
        return;
      }
      
      const batchIndices = prioritizedIndices.slice(startIdx, startIdx + BATCH_SIZE);
      if (batchIndices.length === 0) {
        prefetchCompleteRef.current = true;
        console.log(`✅ Background prefetch complete: ${loadedCount}/${imageList.length} images, ${failedCount} failed`);
        setPrefetchProgress({ loaded: 0, total: 0 }); // Hide progress
        return;
      }
      
      // Get uncached images in this batch
      const uncachedImages = batchIndices
        .filter(idx => !imageCacheRef.current.has(imageList[idx].sopInstanceUID))
        .map(idx => imageList[idx]);
      
      if (uncachedImages.length > 0) {
        try {
          const batchUIDs = uncachedImages.map(img => img.sopInstanceUID);
          const batchResults = await fetchBatchImages(batchUIDs, seriesAbortRef.current?.signal);
          
          loadedCount += batchResults.size;
          failedCount += (batchUIDs.length - batchResults.size);
          
          const progress = Math.round((loadedCount / imageList.length) * 100);
          console.log(`📊 Prefetch progress: ${loadedCount}/${imageList.length} (${progress}%)`);
          setPrefetchProgress({ loaded: loadedCount, total: imageList.length });
          
        } catch (error: any) {
          if (error.name === 'AbortError') {
            console.log('Background prefetch aborted');
            setPrefetchProgress({ loaded: 0, total: 0 }); // Hide progress
            return;
          }
          console.warn('Batch prefetch error:', error.message);
          failedCount += uncachedImages.length;
        }
      }
      
      // Schedule next batch using requestIdleCallback for non-blocking behavior
      if ('requestIdleCallback' in window) {
        requestIdleCallback(() => processBatch(startIdx + BATCH_SIZE), { timeout: 2000 });
      } else {
        // Fallback for browsers without requestIdleCallback
        setTimeout(() => processBatch(startIdx + BATCH_SIZE), 100);
      }
    };
    
    // Start processing
    processBatch(0);
  };

  const preloadAllImages = async (imageList: any[]) => {
    console.log("Starting to preload all images with batch fetching...");
    if (!imageList || imageList.length === 0) {
      console.warn("No images to preload");
      setIsPreloading(false);
      return;
    }
    setIsPreloading(true);
    
    const BATCH_SIZE = 50; // Increased batch size for faster loading
    let loadedCount = 0;
    
    // Prioritize loading images near current index first
    const prioritizedList = [...imageList];
    const currentIdx = currentIndex;
    
    // Sort by distance from current index
    prioritizedList.sort((a, b) => {
      const aIdx = imageList.indexOf(a);
      const bIdx = imageList.indexOf(b);
      const aDist = Math.abs(aIdx - currentIdx);
      const bDist = Math.abs(bIdx - currentIdx);
      return aDist - bDist;
    });
    
    // Process images in batches
    for (let i = 0; i < prioritizedList.length; i += BATCH_SIZE) {
      const batch = prioritizedList.slice(i, i + BATCH_SIZE);
      const batchUIDs = batch.map(img => img.sopInstanceUID);
      
      try {
        // Fetch entire batch at once
        const batchResults = await fetchBatchImages(batchUIDs, seriesAbortRef.current?.signal);
        loadedCount += batchResults.size;
        
        console.log(`Batch loaded ${batchResults.size} images. Total: ${loadedCount}/${imageList.length} (${Math.round(loadedCount/imageList.length * 100)}%)`);
        
        // Check if current image was in this batch
        const currentImageUID = imageList[currentIndex]?.sopInstanceUID;
        if (currentImageUID && batchResults.has(currentImageUID)) {
          await displayCurrentImage();
        }
      } catch (error: any) {
        if (error.name === 'AbortError') {
          console.log('Batch loading aborted (user switched series)');
          break;
        }
        console.error(`Failed to load batch:`, error);
        
        // Fallback to individual loading for failed batch
        for (const image of batch) {
          try {
            await fetchAndParseImage(image.sopInstanceUID, seriesAbortRef.current?.signal);
            loadedCount++;
          } catch (individualError: any) {
            if (individualError.name !== 'AbortError') {
              console.error(`Failed to load individual image:`, individualError);
            }
          }
        }
      }
    }
    
    setIsPreloading(false);
    console.log(
      `Batch loading complete: ${imageCacheRef.current.size}/${imageList.length} images cached`,
    );
  };

  const loadImageMetadata = async (imageId: number) => {
    try {
      const response = await fetch(`/api/images/${imageId}/metadata`);
      if (response.ok) {
        const metadata = await response.json();
        console.log("Image metadata:", metadata);
        setImageMetadata(metadata);
        
        // Notify parent component of metadata change
        if (onImageMetadataChange) {
          onImageMetadataChange(metadata);
        }

        // Frame of Reference UIDs are verified during data import
      }
    } catch (error) {
      console.error("Failed to load image metadata:", error);
    }
  };

  // Helper function to create MPR volume from axial slices
  const createMPRVolume = (images: any[]) => {
    if (!images || images.length === 0) return null;
    
    // For a complete MPR implementation, we would:
    // 1. Sort images by Z position
    // 2. Create a 3D volume array
    // 3. Fill voxels with pixel data from each slice
    // 4. Handle spacing between slices
    
    // For now, return sorted images
    return images.sort((a, b) => {
      const zA = parseFloat(a.parsedZPosition || a.parsedSliceLocation || '0');
      const zB = parseFloat(b.parsedZPosition || b.parsedSliceLocation || '0');
      return zA - zB;
    });
  };

  // Helper function to reconstruct MPR slice from volume
  const reconstructMPRSlice = async (orientation: string, sliceIndex: number) => {
    if (!images || images.length === 0) return null;
    
    if (orientation === 'axial') {
      // Standard axial view
      return images[sliceIndex];
    }
    
    // Check cache first
    const cacheKey = `${orientation}-${sliceIndex}`;
    const cached = mprCacheRef.current.get(cacheKey);
    if (cached) {
      console.log(`Using cached MPR data for ${cacheKey}`);
      return cached;
    }
    
    // For MPR reconstruction, we need all images loaded with pixel data
    // Sort images by Z position
    const sortedImages = [...images].sort((a, b) => {
      const zA = parseFloat(a.parsedZPosition || a.parsedSliceLocation || '0');
      const zB = parseFloat(b.parsedZPosition || b.parsedSliceLocation || '0');
      return zA - zB;
    });
    
    // Get dimensions from first image - need to load pixel data from cache
    const firstImageData = imageCacheRef.current.get(sortedImages[0].sopInstanceUID);
    if (!firstImageData) {
      console.error("First image not in cache for MPR reconstruction");
      return null;
    }
    
    const width = firstImageData.width || 512;
    const height = firstImageData.height || 512;
    const numSlices = sortedImages.length;
    
    // Get pixel spacing and slice thickness for proper aspect ratio
    const firstImage = sortedImages[0];
    const pixelSpacing = firstImage.pixelSpacing?.split('\\').map(parseFloat) || [1, 1];
    const sliceThickness = parseFloat(firstImage.sliceThickness || '2.0');
    
    console.log(`MPR reconstruction: ${orientation}, slice ${sliceIndex}, volume ${width}x${height}x${numSlices}`);
    console.log(`Pixel spacing: ${pixelSpacing[0]}x${pixelSpacing[1]}, slice thickness: ${sliceThickness}`);
    
    // Create synthetic image for MPR view with proper dimensions
    let mprWidth, mprHeight;
    if (orientation === 'sagittal') {
      mprWidth = height; // Y dimension of axial
      mprHeight = numSlices; // Z dimension
    } else { // coronal
      mprWidth = width; // X dimension of axial
      mprHeight = numSlices; // Z dimension
    }
    
    const mprImage = {
      ...sortedImages[0],
      sopInstanceUID: `mpr-${orientation}-${sliceIndex}`,
      pixelData: new Uint16Array(mprWidth * mprHeight),
      columns: mprWidth,
      rows: mprHeight,
      orientation: orientation,
      // Update pixel spacing for MPR views
      pixelSpacing: orientation === 'sagittal' 
        ? `${pixelSpacing[1]}\\${sliceThickness}` // Y spacing x slice thickness
        : `${pixelSpacing[0]}\\${sliceThickness}` // X spacing x slice thickness
    };
    
    let pixelsSet = 0;
    
    // For sagittal: slice through X axis (left-right view)
    // For coronal: slice through Y axis (front-back view)
    if (orientation === 'sagittal') {
      // Sagittal view: fix X coordinate, vary Y and Z
      const x = Math.min(sliceIndex, width - 1);
      
      // Fill pixel data by sampling from axial slices
      // Reverse Z-axis to fix upside-down orientation (following OHIF convention)
      for (let z = 0; z < numSlices; z++) {
        const axialZ = numSlices - 1 - z; // Reverse Z for proper anatomical orientation
        const axialImage = sortedImages[axialZ];
        const axialImageData = imageCacheRef.current.get(axialImage.sopInstanceUID);
        
        if (axialImageData && axialImageData.data) {
          for (let y = 0; y < height; y++) {
            const srcIndex = y * width + x;
            const dstIndex = z * mprWidth + y;
            // Convert Float32 to Uint16, handling negative values properly
            const floatValue = axialImageData.data[srcIndex] || 0;
            const pixelValue = Math.max(0, Math.min(65535, Math.round(floatValue)));
            mprImage.pixelData[dstIndex] = pixelValue;
            if (pixelValue > 0) pixelsSet++;
          }
        }
      }
    } else if (orientation === 'coronal') {
      // Coronal view: fix Y coordinate, vary X and Z
      const y = Math.min(sliceIndex, height - 1);
      
      // Fill pixel data by sampling from axial slices
      // Reverse Z-axis to fix upside-down orientation (following OHIF convention)
      for (let z = 0; z < numSlices; z++) {
        const axialZ = numSlices - 1 - z; // Reverse Z for proper anatomical orientation
        const axialImage = sortedImages[axialZ];
        const axialImageData = imageCacheRef.current.get(axialImage.sopInstanceUID);
        
        if (axialImageData && axialImageData.data) {
          for (let x = 0; x < width; x++) {
            const srcIndex = y * width + x;
            const dstIndex = z * mprWidth + x;
            // Convert Float32 to Uint16, handling negative values properly
            const floatValue = axialImageData.data[srcIndex] || 0;
            const pixelValue = Math.max(0, Math.min(65535, Math.round(floatValue)));
            mprImage.pixelData[dstIndex] = pixelValue;
            if (pixelValue > 0) pixelsSet++;
          }
        }
      }
    }
    
    console.log(`MPR ${orientation}: ${pixelsSet} pixels set out of ${mprWidth * mprHeight}`);
    
    // Cache the result for performance
    mprCacheRef.current.set(cacheKey, mprImage);
    
    return mprImage;
  };

  // Helper function to get slice for specific orientation
  const getMPRSlice = (orientation: string, sliceIndex: number) => {
    if (!images || images.length === 0) return null;
    
    if (orientation === 'axial') {
      // Standard axial view
      return images[sliceIndex];
    }
    
    // For sagittal and coronal, return a promise for async reconstruction
    return reconstructMPRSlice(orientation, sliceIndex);
  };

  const renderMPRCanvas = async (
    canvas: HTMLCanvasElement, 
    targetOrientation: 'sagittal' | 'coronal',
    currentSliceIndex: number,
    windowWidth: number,
    windowCenter: number
  ) => {
    if (!canvas || images.length === 0 || !images[0]) {
      console.warn(`MPR render skipped - no canvas or images`);
      return;
    }
    
    console.log(`MPR renderMPRCanvas called for ${targetOrientation} at index ${currentSliceIndex}, canvas: ${canvas.width}x${canvas.height}`);
    
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      console.error(`MPR render failed - no 2D context for ${targetOrientation}`);
      return;
    }

    try {
      // Clear canvas first
      ctx.fillStyle = "black";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      // Enable smooth scaling for better quality
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      
      console.log(`Reconstructing ${targetOrientation} slice at index ${currentSliceIndex}`);
      const reconstructedImage = await reconstructMPRSlice(targetOrientation, currentSliceIndex);
      
      if (!reconstructedImage || !reconstructedImage.pixelData) {
        console.error(`No reconstructed image or pixel data for ${targetOrientation}`);
        return;
      }
      
      // Get pixel data from reconstructed image
      const pixelData = reconstructedImage.pixelData;
      
      // Fix typescript error and improve performance
      const pixelArray = pixelData as Uint16Array;
      let minVal = 65535, maxVal = 0;
      let hasData = false;
      for (let i = 0; i < pixelArray.length; i++) {
        const val = pixelArray[i];
        if (val > 0) {
          hasData = true;
          minVal = Math.min(minVal, val);
          maxVal = Math.max(maxVal, val);
        }
      }
      
      if (!hasData) {
        console.warn(`MPR ${targetOrientation} has no pixel data!`);
        minVal = 0;
      }
      
      console.log(`MPR pixel data stats: min=${minVal}, max=${maxVal}, hasData=${hasData}`);
      
      // Use larger canvas size for better resolution
      const canvasWidth = canvas.width;
      const canvasHeight = canvas.height;
      const imageData = ctx.createImageData(canvasWidth, canvasHeight);
      const data = imageData.data;
      
      // Get proper dimensions
      const sourceWidth = reconstructedImage.columns || 512;
      const sourceHeight = reconstructedImage.rows || 512;
      
      // For sagittal: width=imageHeight (Y), height=numSlices (Z)
      // For coronal: width=imageWidth (X), height=numSlices (Z)
      let displayWidth = sourceWidth;
      let displayHeight = sourceHeight;
      
      if (targetOrientation === 'sagittal') {
        // Sagittal view shows Y (horizontal) x Z (vertical)
        displayWidth = sourceHeight; // Y dimension (512)
        displayHeight = images.length; // Z dimension (number of slices)
      } else if (targetOrientation === 'coronal') {
        // Coronal view shows X (horizontal) x Z (vertical)
        displayWidth = sourceWidth; // X dimension (512)
        displayHeight = images.length; // Z dimension (number of slices)
      }
      
      // Calculate scale to fit canvas while preserving physical aspect ratio
      // Both sagittal and coronal should have the same display height
      
      // Use default pixel spacing for aspect ratio calculation
      const pixelSpacingX = 0.9765625;
      const pixelSpacingY = 0.9765625;
      const sliceThickness = 2.0; // Typical slice thickness for CT
      
      // Calculate physical dimensions in mm
      let physicalWidth, physicalHeight;
      
      if (targetOrientation === 'sagittal') {
        // Sagittal: Y (horizontal) x Z (vertical)
        physicalWidth = displayWidth * pixelSpacingY;
        physicalHeight = displayHeight * sliceThickness;
      } else if (targetOrientation === 'coronal') {
        // Coronal: X (horizontal) x Z (vertical)
        physicalWidth = displayWidth * pixelSpacingX;
        physicalHeight = displayHeight * sliceThickness;
      } else {
        physicalWidth = displayWidth;
        physicalHeight = displayHeight;
      }
      
      // Calculate scale to fill the canvas properly while maintaining aspect ratio
      const aspectRatio = physicalWidth / physicalHeight;
      let scaledWidth, scaledHeight, scale;
      
      // For sagittal/coronal views, prioritize filling the height (superior-inferior dimension)
      // This makes the body anatomy display properly in a tall, rectangular format
      if (aspectRatio < (canvasWidth / canvasHeight)) {
        // Height-constrained (typical for body scans)
        scaledHeight = canvasHeight;
        scaledWidth = scaledHeight * aspectRatio;
        scale = canvasHeight / displayHeight;
      } else {
        // Width-constrained
        scaledWidth = canvasWidth;
        scaledHeight = scaledWidth / aspectRatio;
        scale = canvasWidth / displayWidth;
      }
      
      // Center the image
      const offsetX = (canvasWidth - scaledWidth) / 2;
      const offsetY = (canvasHeight - scaledHeight) / 2;
      
      // Clear the data array first (ensure black background)
      data.fill(0);
      
      // Use the same window/level settings as the axial view
      const min = windowCenter - windowWidth / 2;
      const max = windowCenter + windowWidth / 2;
      
      console.log(`MPR ${targetOrientation} using window/level: W=${windowWidth}, C=${windowCenter}`);
      console.log(`MPR canvas size: ${canvasWidth}x${canvasHeight}, display size: ${displayWidth}x${displayHeight}, scale: ${scale}`);
      
      // Render pixels with proper scaling and aspect ratio
      for (let y = 0; y < canvasHeight; y++) {
        for (let x = 0; x < canvasWidth; x++) {
          // Check if we're within the scaled image bounds
          if (x >= offsetX && x < offsetX + scaledWidth && 
              y >= offsetY && y < offsetY + scaledHeight) {
            
            // Calculate source coordinates
            const sourceX = Math.floor(((x - offsetX) / scale));
            const sourceY = Math.floor(((y - offsetY) / scale));
            
            // Ensure source coords are within bounds
            if (sourceX >= 0 && sourceX < displayWidth && 
                sourceY >= 0 && sourceY < displayHeight) {
              
              const sourceIndex = sourceY * sourceWidth + sourceX;
              const pixelValue = pixelArray[sourceIndex] || 0;
              
              // Apply window/level
              let normalizedValue;
              if (pixelValue <= min) {
                normalizedValue = 0;
              } else if (pixelValue >= max) {
                normalizedValue = 255;
              } else {
                normalizedValue = Math.round(((pixelValue - min) / windowWidth) * 255);
              }
              
              const destIndex = (y * canvasWidth + x) * 4;
              data[destIndex] = normalizedValue;     // R
              data[destIndex + 1] = normalizedValue; // G
              data[destIndex + 2] = normalizedValue; // B
              data[destIndex + 3] = 255;            // A
            }
          }
        }
      }
      
      ctx.putImageData(imageData, 0, 0);
      
      // Draw crosshairs on MPR views
      if (crosshairPos) {
        ctx.save();
        ctx.strokeStyle = 'rgba(0, 255, 255, 0.8)';
        ctx.lineWidth = 2;
        
        if (targetOrientation === 'sagittal') {
          // Draw vertical line at coronal position and horizontal line at axial position
          // Vertical line corresponds to coronal slice position
          const coronalPos = Math.floor(crosshairPos.y);
          const lineX = offsetX + (coronalPos * scale);
          
          ctx.beginPath();
          ctx.moveTo(lineX, 0);
          ctx.lineTo(lineX, canvasHeight);
          ctx.stroke();
          
          // Horizontal line corresponds to axial slice position (inverted Z)
          const axialPos = displayHeight - 1 - currentIndex;
          const lineY = offsetY + (axialPos * scale);
          
          ctx.beginPath();
          ctx.moveTo(0, lineY);
          ctx.lineTo(canvasWidth, lineY);
          ctx.stroke();
          
        } else if (targetOrientation === 'coronal') {
          // Draw vertical line at sagittal position and horizontal line at axial position
          // Vertical line corresponds to sagittal slice position
          const sagittalPos = Math.floor(crosshairPos.x);
          const lineX = offsetX + (sagittalPos * scale);
          
          ctx.beginPath();
          ctx.moveTo(lineX, 0);
          ctx.lineTo(lineX, canvasHeight);
          ctx.stroke();
          
          // Horizontal line corresponds to axial slice position (inverted Z)
          const axialPos = displayHeight - 1 - currentIndex;
          const lineY = offsetY + (axialPos * scale);
          
          ctx.beginPath();
          ctx.moveTo(0, lineY);
          ctx.lineTo(canvasWidth, lineY);
          ctx.stroke();
        }
        
        ctx.restore();
      }
      
      console.log(`✓ ${targetOrientation} MPR rendered`);
    } catch (error) {
      console.error(`Error rendering ${targetOrientation} MPR:`, error);
    }
  };

  const displayCurrentImage = async () => {
    if (!canvasRef.current || images.length === 0) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    try {
      // Get the appropriate slice based on orientation
      let currentImage;
      if (orientation === 'axial') {
        // Ensure currentIndex is valid
        const safeIndex = Math.max(0, Math.min(currentIndex, images.length - 1));
        currentImage = images[safeIndex];
      } else {
        // For sagittal/coronal, use MPR reconstruction
        const mprSlice = await getMPRSlice(orientation, currentIndex);
        currentImage = mprSlice;
      }
      
      if (!currentImage) {
        console.error("No image available for orientation:", orientation);
        setError("Unable to display image. Please try refreshing.");
        return;
      }
      const cacheKey = currentImage.sopInstanceUID;

      // Clear canvas
      ctx.fillStyle = "black";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      let imageData;
      
      // Check if this is an MPR reconstructed image (synthetic)
      if (orientation !== 'axial' && currentImage.pixelData) {
        // For MPR slices, use the reconstructed pixel data directly
        imageData = {
          width: currentImage.columns || currentImage.width || 512,
          height: currentImage.rows || currentImage.height || 512,
          data: currentImage.pixelData
        };
      } else {
        // For axial slices, use the cache
        imageData = imageCacheRef.current.get(cacheKey);

        if (!imageData || !imageData.data) {
          // Try to reload the image if it's not in cache
          console.warn(
            "Image not in cache, attempting to reload:",
            cacheKey,
          );
          
          try {
            // Use single fetch/parse function to avoid double fetching
            const reloadedImageData = await fetchAndParseImage(currentImage.sopInstanceUID);
            
            if (reloadedImageData) {
              imageData = reloadedImageData;
              console.log("Successfully reloaded image:", cacheKey);
            } else {
              throw new Error("Failed to parse reloaded image");
            }
          } catch (reloadError) {
            console.error("Failed to reload image:", reloadError);
            throw new Error(`Image not available: ${reloadError instanceof Error ? reloadError.message : 'Unknown error'}`);
          }
        }
      }

      // Keep fixed canvas size for consistent display
      canvas.width = 1024;
      canvas.height = 1024;

      // Always use CPU rendering for now - GPU integration needs more work
      render16BitImage(ctx, imageData.data, imageData.width, imageData.height);
      
      // Render secondary image overlay for fusion if available
      if (secondarySeriesId) {
        // Fusion overlay rendering
        try {
          await renderFusionOverlayNew(ctx, currentImage);
        } catch (fusionError: any) {
          console.error("🐟 FUSION: ERROR in renderFusionOverlayNew:", fusionError);
          // Continue without fusion rather than failing entire image display
        }
      } else {
        console.log('🐟 FUSION: No secondarySeriesId in main render');
      }

      // Render RT structures and crosshairs on separate canvas above fusion
      const contoursCanvas = contoursOverlayCanvasRef.current;
      if (contoursCanvas) {
        const contoursCtx = contoursCanvas.getContext('2d');
        if (contoursCtx) {
          // Clear the contours overlay canvas
          contoursCtx.clearRect(0, 0, contoursCanvas.width, contoursCanvas.height);
          
          // Draw RT structures if available
          if (rtStructures) {
            try {
              // Pass currentImage with its metadata attached
              const imageWithMetadata = {
                ...currentImage,
                imageMetadata: imageMetadata // Use the actual imageMetadata state variable
              };
              renderRTStructures(contoursCtx, contoursCanvas, imageWithMetadata);
            } catch (rtError) {
              console.warn("Error drawing RT structures:", rtError);
              // Don't let RT structure errors prevent image display
            }
          }
          
          // Draw crosshairs on contours overlay if in axial view
          if (orientation === 'axial') {
            // Convert crosshair pixel coordinates to canvas coordinates
            const imageWidth = currentImage.columns || currentImage.width || 512;
            const imageHeight = currentImage.rows || currentImage.height || 512;
            
            // Calculate scale with zoom factor (same as render16BitImage)
            const baseScale = Math.min(canvas.width / imageWidth, canvas.height / imageHeight);
            const totalScale = baseScale * zoom;
            const scaledWidth = imageWidth * totalScale;
            const scaledHeight = imageHeight * totalScale;
            
            // Center position with pan offset
            const imageX = (canvas.width - scaledWidth) / 2 + panX;
            const imageY = (canvas.height - scaledHeight) / 2 + panY;
            
            // Convert crosshair pixel position to canvas position
            const crosshairCanvasX = imageX + (crosshairPos.x * totalScale);
            const crosshairCanvasY = imageY + (crosshairPos.y * totalScale);
            
            // Draw crosshairs on contours overlay
            contoursCtx.save();
            contoursCtx.strokeStyle = 'rgba(0, 255, 255, 0.8)'; // Cyan color
            contoursCtx.lineWidth = 1;
            contoursCtx.setLineDash([5, 5]); // Dashed line
            
            // Vertical line
            contoursCtx.beginPath();
            contoursCtx.moveTo(crosshairCanvasX, 0);
            contoursCtx.lineTo(crosshairCanvasX, canvas.height);
            contoursCtx.stroke();
            
            // Horizontal line
            contoursCtx.beginPath();
            contoursCtx.moveTo(0, crosshairCanvasY);
            contoursCtx.lineTo(canvas.width, crosshairCanvasY);
            contoursCtx.stroke();
            
            // Draw center point
            contoursCtx.fillStyle = 'rgba(0, 255, 255, 0.8)';
            contoursCtx.beginPath();
            contoursCtx.arc(crosshairCanvasX, crosshairCanvasY, 3, 0, 2 * Math.PI);
            contoursCtx.fill();
            
            contoursCtx.restore();
          }
        }
      }
      
      // Render MPR views if canvases are available
      if (orientation === 'axial' && sagittalCanvasRef.current && coronalCanvasRef.current) {
        try {
          // Use crosshair position for MPR slice indices
          // Ensure crosshair is within bounds
          const sagittalSliceIndex = Math.max(0, Math.min(crosshairPos.x, (images[0]?.columns || 512) - 1));
          const coronalSliceIndex = Math.max(0, Math.min(crosshairPos.y, (images[0]?.rows || 512) - 1));
          
          console.log(`Rendering MPR views - Sagittal: ${sagittalSliceIndex}, Coronal: ${coronalSliceIndex}, W=${currentWindowLevel.width}, C=${currentWindowLevel.center}`);
          
          // Render MPR views asynchronously with same window/level as axial
          await Promise.all([
            renderMPRCanvas(sagittalCanvasRef.current, 'sagittal', sagittalSliceIndex, currentWindowLevel.width, currentWindowLevel.center),
            renderMPRCanvas(coronalCanvasRef.current, 'coronal', coronalSliceIndex, currentWindowLevel.width, currentWindowLevel.center)
          ]);
        } catch (mprError) {
          console.warn("Error rendering MPR views:", mprError);
        }
      }
    } catch (error: any) {
      console.error("Error displaying image:", error);
      console.error("Error details:", error.message, error.stack);
      ctx.fillStyle = "black";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "red";
      ctx.font = "16px Arial";
      ctx.textAlign = "center";
      ctx.fillText(
        "Error loading DICOM",
        canvas.width / 2,
        canvas.height / 2 - 10,
      );
      ctx.fillText(error.message || "Unknown error", canvas.width / 2, canvas.height / 2 + 10);
    }
  };

  const render16BitImage = (
    ctx: CanvasRenderingContext2D,
    pixelArray: Float32Array,
    width: number,
    height: number,
  ) => {
    // Get rescale parameters for proper HU conversion
    const { slope, intercept } = getRescaleParams(imageMetadata);

    // Apply window/level settings
    const { width: windowWidth, center: windowCenter } = currentWindowLevel;
    const min = windowCenter - windowWidth / 2;
    const max = windowCenter + windowWidth / 2;
    
    // Create/update cached LUT if window/level changed
    const lutKey = `${windowWidth}-${windowCenter}-${slope}-${intercept}`;
    let lut: Uint8Array;
    
    if (cachedLUTRef.current?.key === lutKey) {
      lut = cachedLUTRef.current.lut;
    } else {
      // Build new LUT
      lut = new Uint8Array(65536);
      for (let i = 0; i < 65536; i++) {
        const hu = (i - 32768) * slope + intercept;
        let normalizedValue;
        if (hu <= min) {
          normalizedValue = 0;
        } else if (hu >= max) {
          normalizedValue = 255;
        } else {
          normalizedValue = ((hu - min) / windowWidth) * 255;
        }
        lut[i] = Math.max(0, Math.min(255, normalizedValue));
      }
      cachedLUTRef.current = { key: lutKey, lut };
    }
    
    // Create image data at original size
    const imageData = ctx.createImageData(width, height);
    const data = imageData.data;

    // Apply LUT to pixel data
    for (let i = 0; i < pixelArray.length; i++) {
      // Convert Float32 to Uint16 index for LUT
      const pixelValue = Math.max(0, Math.min(65535, Math.round(pixelArray[i] + 32768)));
      const gray = lut[pixelValue];

      const pixelIndex = i * 4;
      data[pixelIndex] = gray; // R
      data[pixelIndex + 1] = gray; // G
      data[pixelIndex + 2] = gray; // B
      data[pixelIndex + 3] = 255; // A
    }

    // Reuse offscreen canvas if possible
    if (!offscreenCanvasRef.current || 
        offscreenCanvasRef.current.width !== width || 
        offscreenCanvasRef.current.height !== height) {
      offscreenCanvasRef.current = document.createElement("canvas");
      offscreenCanvasRef.current.width = width;
      offscreenCanvasRef.current.height = height;
    }
    
    const tempCanvas = offscreenCanvasRef.current;
    const tempCtx = tempCanvas.getContext("2d", { willReadFrequently: true });
    if (!tempCtx) return;

    tempCtx.putImageData(imageData, 0, 0);

    // Scale and draw to the main canvas with zoom and pan
    const canvasWidth = ctx.canvas.width;
    const canvasHeight = ctx.canvas.height;

    // Calculate scale with zoom factor
    const baseScale = Math.min(canvasWidth / width, canvasHeight / height);
    const totalScale = baseScale * zoom;
    const scaledWidth = width * totalScale;
    const scaledHeight = height * totalScale;

    // Center the image on canvas with pan offset
    const x = (canvasWidth - scaledWidth) / 2 + panX;
    const y = (canvasHeight - scaledHeight) / 2 + panY;

    // Store CT transform for fusion overlay to use the same coordinate system
    ctTransform.current = {
      scale: totalScale,
      offsetX: x,
      offsetY: y,
      imageWidth: width,
      imageHeight: height
    };

    // Enable smooth scaling for better zoom quality while preserving medical image integrity
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(tempCanvas, x, y, scaledWidth, scaledHeight);
  };

  const render8BitImage = (
    ctx: CanvasRenderingContext2D,
    pixelArray: Uint8Array,
    width: number,
    height: number,
  ) => {
    const imageData = ctx.createImageData(width, height);
    const data = imageData.data;

    for (let i = 0; i < pixelArray.length; i++) {
      const gray = pixelArray[i];
      const pixelIndex = i * 4;
      data[pixelIndex] = gray; // R
      data[pixelIndex + 1] = gray; // G
      data[pixelIndex + 2] = gray; // B
      data[pixelIndex + 3] = 255; // A
    }

    ctx.putImageData(imageData, 0, 0);
  };
  
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const interval = window.setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of fuseboxCacheRef.current.entries()) {
        if (now - entry.timestamp > FUSION_CACHE_MAX_AGE_MS) {
          fuseboxCacheRef.current.delete(key);
        }
      }
    }, 5000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!secondarySeriesId) return;
    prefetchFusionSlices(currentIndex);
  }, [secondarySeriesId, selectedRegistrationId, currentIndex, prefetchFusionSlices]);

  useEffect(() => {
    if (secondarySeriesId) return;
    fusionPrefetchSetRef.current.clear();
  }, [secondarySeriesId]);

  const renderFusionOverlayNew = async (_ctx: CanvasRenderingContext2D, primaryImage: any) => {
    const requestToken = ++fusionRequestTokenRef.current;
    const ensureActive = () => requestToken === fusionRequestTokenRef.current;

    if (!secondarySeriesId || fusionOpacity === 0) {
      if (ensureActive()) {
        clearFusionOverlayCanvas();
        setFuseboxTransformSource(null);
      }
      return;
    }

    if (fusionManifestLoading) {
      // Gate rendering while the manifest is still loading
      if (ensureActive()) {
        fusionIssueRef.current = 'manifest-not-ready';
        setFuseboxTransformSource(null);
      }
      return;
    }

    const status = fusionSecondaryStatuses?.get(secondarySeriesId);
    // Normalize ID comparison to avoid string/number mismatch gating overlays forever
    const manifestMatches = Number(fusionManifestPrimarySeriesId) === Number(seriesId);
    const localManifest = getFusionManifest(seriesId);
    const localReady = !!localManifest && localManifest.secondaries.some((s) => s.secondarySeriesId === secondarySeriesId && s.status === 'ready');
    if (status?.status !== 'ready' || !manifestMatches || !localReady) {
      if (ensureActive()) {
        fusionIssueRef.current = 'manifest-not-ready';
        clearFusionOverlayCanvas();
        setFuseboxTransformSource(null);
      }
      return;
    }

    const hasRegistrationMatrix = Array.isArray(registrationMatrix) && registrationMatrix.length === 16;

    if (!primaryImage?.sopInstanceUID) {
      if (ensureActive()) {
        clearFusionOverlayCanvas();
        setFuseboxTransformSource(null);
      }
      return;
    }

    const transform = ctTransform.current;
    if (!transform) {
      clearFusionOverlayCanvas();
      return;
    }

    if (hasRegistrationMatrix) {
      missingMatrixLogRef.current = false;
    } else if (!missingMatrixLogRef.current) {
      pushFusionLog('Proceeding without client-side matrix; expecting helper output', {
        primary: seriesId,
        secondary: secondarySeriesId,
        registrationId: selectedRegistrationId ?? null,
      });
      missingMatrixLogRef.current = true;
    }

    const cacheKey = buildFuseboxCacheKey(
      primaryImage.sopInstanceUID,
      secondarySeriesId,
      selectedRegistrationId ?? null,
    );
    let cached = fuseboxCacheRef.current.get(cacheKey);

    if (!cached) {
      try {
        // Try exact SOP match first; if not found, fall back by instance number or index
        let slice: FuseboxSlice;
        const preferredPosition = parseImagePosition(primaryImage);
        try {
          slice = await getFusedSlice(seriesId, secondarySeriesId, primaryImage.sopInstanceUID);
        } catch (e) {
          const instNumber = Number(primaryImage.instanceNumber ?? primaryImage.metadata?.instanceNumber ?? NaN);
          const index = Number.isFinite(instNumber) ? instNumber - 1 : currentIndex;
          slice = await getFusedSliceSmart(
            seriesId,
            secondarySeriesId,
            primaryImage.sopInstanceUID,
            Number.isFinite(instNumber) ? instNumber : null,
            index,
            preferredPosition,
          );
        }

        if (slice.registrationId && slice.registrationId !== selectedRegistrationId && ensureActive()) {
          setSelectedRegistrationId(slice.registrationId);
        }

        if (slice.secondaryModality && slice.secondaryModality !== secondaryModality && ensureActive()) {
          setSecondaryModality(slice.secondaryModality);
        }

        const prepared = convertSliceToCanvas(slice, secondaryModality);
        if (!prepared) {
          if (ensureActive()) {
            fusionIssueRef.current = 'overlay-canvas-error';
            clearFusionOverlayCanvas();
            setFuseboxTransformSource(null);
          }
          return;
        }
        cached = { ...prepared, timestamp: Date.now() };
        fuseboxCacheRef.current.set(cacheKey, cached);
        if (!prepared.hasSignal) {
          pushFusionLog('Fused slice had no visible signal', {
            sop: primaryImage.sopInstanceUID,
            min: slice.min,
            max: slice.max,
          });
        }
      } catch (error) {
        if (ensureActive()) {
          console.error('Fused overlay load failed:', error);
          fusionIssueRef.current = 'fusebox-fetch-error';
          clearFusionOverlayCanvas();
          setFuseboxTransformSource(null);
        }
        return;
      }
    }

    if (!cached) {
      if (ensureActive()) {
        clearFusionOverlayCanvas();
        setFuseboxTransformSource(null);
      }
      return;
    }

    if (!cached.hasSignal) {
      if (ensureActive()) {
        fusionIssueRef.current = 'empty-fusebox-slice';
        clearFusionOverlayCanvas();
        setFuseboxTransformSource(cached.slice.transformSource ?? null);
      }
      return;
    }

    if (!ensureActive()) return;

    const source = cached.slice.transformSource ?? null;
    setFuseboxTransformSource(source);
    fusionIssueRef.current = null;

    updateFusionOverlayCanvas(cached.canvas, transform, cached.hasSignal);
    prefetchFusionSlices(currentIndex);
  };

  // Coordinate transformation functions for pen tool with CT transform applied
  // Using useCallback to ensure functions always use latest ctTransform value
  const worldToCanvas = useCallback((worldX: number, worldY: number): [number, number] => {
    if (!imageMetadata) return [0, 0];
    
    const [imagePositionX, imagePositionY] = imageMetadata.imagePosition.split("\\").map(parseFloat);
    const [rowSpacing, colSpacing] = imageMetadata.pixelSpacing.split("\\").map(parseFloat);
    
    // Convert world coordinates to raw pixel coordinates
    const pixelX = (worldX - imagePositionX) / colSpacing;
    const pixelY = (worldY - imagePositionY) / rowSpacing;
    
    // Apply CT transform to match the rendered canvas
    // Always get fresh ctTransform value to avoid stale closure
    const transform = ctTransform.current || { scale: 1, offsetX: 0, offsetY: 0 };
    const canvasX = (pixelX * transform.scale) + transform.offsetX;
    const canvasY = (pixelY * transform.scale) + transform.offsetY;
    
    return [canvasX, canvasY];
  }, [imageMetadata]); // Re-create when imageMetadata changes
  
  const canvasToWorld = useCallback((canvasX: number, canvasY: number): [number, number] => {
    if (!imageMetadata) return [0, 0];
    
    const [imagePositionX, imagePositionY] = imageMetadata.imagePosition.split("\\").map(parseFloat);
    const [rowSpacing, colSpacing] = imageMetadata.pixelSpacing.split("\\").map(parseFloat);
    
    // Apply inverse CT transform to get raw pixel coordinates
    // Always get fresh ctTransform value to avoid stale closure
    const transform = ctTransform.current || { scale: 1, offsetX: 0, offsetY: 0 };
    const pixelX = (canvasX - transform.offsetX) / transform.scale;
    const pixelY = (canvasY - transform.offsetY) / transform.scale;
    
    // Convert pixel coordinates to world coordinates
    const worldX = imagePositionX + (pixelX * colSpacing);
    const worldY = imagePositionY + (pixelY * rowSpacing);
    
    return [worldX, worldY];
  }, [imageMetadata]); // Re-create when imageMetadata changes

  const renderRTStructures = (
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    currentImage: any,
  ) => {
    const structuresRef = localRTStructures || externalRTStructures;
    if (!structuresRef || !currentImage) return;

    // FIXED: Get current slice position from actual DICOM metadata with fallbacks
    let currentSlicePosition: number = currentIndex + 1; // Default fallback

    // Priority 1: Use parsed slice location from DICOM (check for null/undefined)
    if (
      currentImage.parsedSliceLocation !== undefined &&
      currentImage.parsedSliceLocation !== null
    ) {
      currentSlicePosition = currentImage.parsedSliceLocation;
    }
    // Priority 2: Use parsed Z position from DICOM (check for null/undefined)
    else if (
      currentImage.parsedZPosition !== undefined &&
      currentImage.parsedZPosition !== null
    ) {
      currentSlicePosition = currentImage.parsedZPosition;
    }
    // Priority 3: Extract from image metadata directly
    else if (currentImage.imageMetadata && currentImage.imageMetadata.sliceLocation !== undefined) {
      const parsed = parseFloat(currentImage.imageMetadata.sliceLocation);
      if (!isNaN(parsed)) {
        currentSlicePosition = parsed;
      }
    }
    // Priority 4: Extract Z from image position
    else if (currentImage.imageMetadata && currentImage.imageMetadata.imagePosition) {
      const imagePos = typeof currentImage.imageMetadata.imagePosition === 'string'
        ? currentImage.imageMetadata.imagePosition.split("\\")
        : currentImage.imageMetadata.imagePosition;
      if (imagePos && imagePos.length >= 3) {
        const parsed = parseFloat(imagePos[2]);
        if (!isNaN(parsed)) {
          currentSlicePosition = parsed;
        }
      }
    }

    // Note: currentSlicePosition already has a fallback initialization, no need for additional check

    // CRITICAL DEBUG: Disabled for performance - was causing excessive console spam
    // Slice position calculation debug logs removed
    // if (DEBUG) console.log(
    //   `📋 Available structures:`,
    //   structuresRef?.structures?.map((s: any) => s.structureName) || [],
    // );

    // Get all RT structure Z positions to check coordinate space
    const allRTZPositions: number[] = [];
    if (structuresRef?.structures) {
      structuresRef.structures.forEach((structure: any) => {
        structure.contours.forEach((contour: any) => {
          allRTZPositions.push(contour.slicePosition);
        });
      });
    }

    if (allRTZPositions.length > 0) {
      const rtZMin = Math.min(...allRTZPositions);
      const rtZMax = Math.max(...allRTZPositions);
      if (DEBUG) console.log(
        `🎯 RT coordinate range: ${rtZMin.toFixed(1)} to ${rtZMax.toFixed(1)}mm`,
      );
      if (DEBUG) console.log(
        `🎯 Current CT slice ${currentSlicePosition}mm should show structures at RT positions near this value`,
      );
    }

    // Save context state
    ctx.save();

    // Apply global contour settings
    const lineWidth = contourSettings?.width || 3;
    const fillOpacity = (contourSettings?.opacity || 30) / 100;

    // Set line width
    ctx.lineWidth = lineWidth;
    // Keep stroke at full opacity - only fill should be affected by opacity setting
    ctx.globalAlpha = 1;

    if (structuresRef?.structures) {
      structuresRef.structures.forEach((structure: any) => {
      // Check if this structure is visible or if it's selected for editing/selection
      const isVisible = structureVisibility.get(structure.roiNumber);
      const isSelectedForEdit = selectedForEdit === structure.roiNumber;
      const isSelectedStructure = selectedStructures?.has(structure.roiNumber) || false;
      
      // Debug visibility map - only when specifically debugging RT structures
      if (RT_STRUCTURE_DEBUG) {
        console.log(`🔍 Structure ${structure.structureName} (${structure.roiNumber}) visibility:`, {
          isVisible,
          visibilityMapHasKey: structureVisibility.has(structure.roiNumber),
          allStructuresVisible,
          willShow: isSelectedForEdit || isSelectedStructure || 
                   (allStructuresVisible ? isVisible !== false : isVisible === true),
          isSelectedForEdit,
          isSelectedStructure,
          selectedStructuresSet: selectedStructures ? Array.from(selectedStructures) : []
        });
      }

      // Priority 1: Always show if selected (checkbox) or being edited
      if (isSelectedForEdit || isSelectedStructure) {
        // Continue to render - these always show
      } else {
        // Priority 2: For non-selected structures, check visibility rules
        // If all structures are hidden, only show structures with explicit visibility true
        if (!allStructuresVisible && isVisible !== true) {
          return;
        }
        // If all structures visible, hide only those explicitly set to false
        if (allStructuresVisible && isVisible === false) {
          return;
        }
      }

      // Use the structure's actual color, not hardcoded yellow
      const color = structure.color || [255, 255, 0]; // fallback to yellow only if no color
      const [r, g, b] = color;
      ctx.strokeStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${fillOpacity})`;

      // Determine an effective slice tolerance based on metadata to prevent flicker
      const metaTol = (() => {
        const meta = currentImage?.imageMetadata;
        if (!meta) return SLICE_TOL_MM;
        const sbs = parseFloat(meta.spacingBetweenSlices ?? '');
        const sth = parseFloat(meta.sliceThickness ?? '');
        const zCand = Number.isFinite(sbs) ? sbs * 0.45 : (Number.isFinite(sth) ? sth * 0.45 : 0);
        return Math.max(SLICE_TOL_MM, zCand || 0);
      })();

      structure.contours.forEach((contour: any) => {
        // Debug: Log what contours are being considered for drawing
        const positionDiff = Math.abs(
          contour.slicePosition - currentSlicePosition,
        );
        if (positionDiff <= metaTol) {
          if (RT_STRUCTURE_DEBUG) {
            console.log(
              `✓ Drawing ${structure.structureName} contour at RT ${contour.slicePosition.toFixed(1)}mm (CT slice: ${currentSlicePosition.toFixed(1)}mm, diff: ${positionDiff.toFixed(1)}mm)`,
            );
          }
          drawContour(ctx, contour, canvas.width, canvas.height, currentImage, animationTime);
        }
      });
    });
    }

    // Render preview contours with dashed yellow styling (FOR ALL SLICES - true 3D preview)
    if (previewContours && previewContours.length > 0) {
      let renderedPreviewCount = 0;
      
      // Set preview contour styling - bright yellow and dashed
      ctx.strokeStyle = '#FFFF00'; // Bright yellow
      ctx.fillStyle = 'rgba(255, 255, 0, 0.12)'; // Slightly lighter fill
      ctx.lineWidth = 1.25; // Thin dashed line per spec
      
      // Set dashed line pattern
      ctx.setLineDash([8, 4]); // 8px dash, 4px gap
      ctx.lineDashOffset = animationTime * 0.1; // Animated dashes
      
      previewContours.forEach((contour: any) => {
        // Check if this is the new format with slice position
        if (contour.slicePosition !== undefined) {
          const positionDiff = Math.abs(contour.slicePosition - currentSlicePosition);
          
          // Show preview only on the current slice to avoid layered jagged lines
          if (positionDiff <= SLICE_TOL_MM) {
            drawContour(ctx, { points: contour.points, isPreview: true }, canvas.width, canvas.height, currentImage, animationTime);
            renderedPreviewCount++;
            
            // Log when we're showing preview on current slice vs other slices
            if (positionDiff <= SLICE_TOL_MM) {
              console.log(`🔹 🎯 Showing preview on CURRENT slice ${currentSlicePosition.toFixed(1)} (diff: ${positionDiff.toFixed(1)}mm)`);
            }
          }
        } else {
          // Fallback for old format (array of points) - always show
          drawContour(ctx, { points: contour, isPreview: true }, canvas.width, canvas.height, currentImage, animationTime);
          renderedPreviewCount++;
        }
      });
      
      console.log(`🔹 🌐 Rendered ${renderedPreviewCount} preview contours for 3D visualization (current slice: ${currentSlicePosition.toFixed(1)})`);
      
      // Reset line dash for other elements
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
    }

    // Restore context state
    ctx.restore();
  };

  const drawContour = (
    ctx: CanvasRenderingContext2D,
    contour: any,
    canvasWidth: number,
    canvasHeight: number,
    currentImage: any,
    animationTime?: number,
  ) => {
    if (contour.points.length < 6) return; // Need at least 2 points (x,y,z each)

    ctx.beginPath();

    // Get image metadata from current image
    const imgMetadata = currentImage?.imageMetadata;
    if (!imgMetadata) {
      console.warn("No image metadata available for contour drawing");
      return;
    }
    
    // Debug logging disabled unless DEBUG is true
    if (DEBUG && contour.points.length >= 6) {
      console.log('Drawing contour with metadata:', {
        imagePosition: imgMetadata.imagePosition,
        pixelSpacing: imgMetadata.pixelSpacing,
        firstWorldPoint: [contour.points[0], contour.points[1], contour.points[2]],
        canvasSize: [canvasWidth, canvasHeight],
        zoom: zoom,
        pan: [panX, panY]
      });
    }

    // Parse DICOM metadata
    const imagePosition = imgMetadata.imagePosition
      ?.split("\\")
      .map(Number) || [-300, -300, 0];
    const pixelSpacing = imgMetadata.pixelSpacing
      ?.split("\\")
      .map(Number) || [1.171875, 1.171875];

    // Image dimensions
    const imageWidth = 512;
    const imageHeight = 512;

    // Calculate scale with zoom factor
    const baseScale = Math.min(canvasWidth / imageWidth, canvasHeight / imageHeight);
    // For a 512x512 image in 1024x1024 canvas, baseScale = 2
    
    // Apply zoom factor to base scale
    const totalScale = baseScale * zoom;
    const scaledWidth = imageWidth * totalScale;
    const scaledHeight = imageHeight * totalScale;
    
    // Center the image on canvas with pan offset (same as render16BitImage)
    const imageX = (canvasWidth - scaledWidth) / 2 + panX;
    const imageY = (canvasHeight - scaledHeight) / 2 + panY;

    // Set up animated dashed line for predicted contours
    if (contour.isPredicted && animationTime !== undefined) {
      const dashLength = 8;
      const gapLength = 6;
      const animationSpeed = 0.002; // Adjust for speed
      const offset = (animationTime * animationSpeed) % (dashLength + gapLength);
      ctx.setLineDash([dashLength, gapLength]);
      ctx.lineDashOffset = -offset;
    } else {
      // Solid line for confirmed contours
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
    }

    // Convert DICOM world coordinates to canvas coordinates
    for (let i = 0; i < contour.points.length; i += 3) {
      const worldX = contour.points[i]; // DICOM X coordinate
      const worldY = contour.points[i + 1]; // DICOM Y coordinate

      // Convert world coordinates to pixel coordinates
      // DICOM pixel spacing is [row spacing, column spacing] = [deltaY, deltaX]
      const pixelX = (worldX - imagePosition[0]) / pixelSpacing[1]; // column spacing
      const pixelY = (worldY - imagePosition[1]) / pixelSpacing[0]; // row spacing
      
      // Apply the same transformation as the image
      const canvasX = imageX + (pixelX * totalScale);
      const canvasY = imageY + (pixelY * totalScale);

      if (i === 0) {
        ctx.moveTo(canvasX, canvasY);
      } else {
        ctx.lineTo(canvasX, canvasY);
      }
    }

    // Close the contour
    ctx.closePath();

    // Fill only for confirmed contours; skip fill for previews
    // Also use reduced opacity for predictions
    if (contour.isPreview) {
      // No fill for preview to match thin dashed outline spec
    } else if (contour.isPredicted) {
      const originalAlpha = ctx.globalAlpha;
      ctx.globalAlpha = originalAlpha * 0.3; // Very subtle fill for predictions
      ctx.fill();
      ctx.globalAlpha = originalAlpha;
    } else {
      ctx.fill();
    }
    
    ctx.stroke();

    // Reset line dash for subsequent drawing operations
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
  };

  const loadDicomParser = (): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (window.dicomParser) {
        resolve();
        return;
      }

      const script = document.createElement("script");
      script.src =
        "https://unpkg.com/dicom-parser@1.8.21/dist/dicomParser.min.js";
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Failed to load dicom-parser"));
      document.head.appendChild(script);
    });
  };

  const goToPrevious = () => {
    const prevIndex = currentIndex - 1;
    if (prevIndex >= 0 && prevIndex < images.length) {
      console.log(`📍 Navigate: ${currentIndex} → ${prevIndex}`);
      setCurrentIndex(prevIndex);
    }
  };

  const goToNext = () => {
    // Get max slices based on orientation
    let maxSlices = images.length;
    if (orientation === 'sagittal' && images.length > 0) {
      // Sagittal slices = width of axial images
      maxSlices = images[0]?.columns || 512;
    } else if (orientation === 'coronal' && images.length > 0) {
      // Coronal slices = height of axial images
      maxSlices = images[0]?.rows || 512;
    }
    
    // Add protection against unexpected navigation
    const nextIndex = currentIndex + 1;
    if (nextIndex < maxSlices && nextIndex >= 0) {
      console.log(`📍 Navigate: ${currentIndex} → ${nextIndex} (max: ${maxSlices})`);
      setCurrentIndex(nextIndex);
    }
  };

  // MPR click handlers for navigation
  const handleSagittalClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (images.length === 0) return;
    
    const canvas = e.currentTarget as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Convert click position to slice index
    const canvasWidth = rect.width;
    const canvasHeight = rect.height;
    const volumeHeight = images[0]?.rows || 512;
    const volumeDepth = images.length;
    
    // Click Y position maps to axial Y coordinate
    const axialY = Math.floor((y / canvasHeight) * volumeHeight);
    // Click X position maps to axial Z index (slice)
    const axialZ = Math.floor((x / canvasWidth) * volumeDepth);
    
    // Update crosshair position
    setCrosshairPos(prev => ({ ...prev, y: axialY }));
    
    // Navigate to the clicked axial slice
    if (axialZ >= 0 && axialZ < images.length) {
      setCurrentIndex(axialZ);
    }
  };

  const handleCoronalClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (images.length === 0) return;
    
    const canvas = e.currentTarget as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Convert click position to slice index
    const canvasWidth = rect.width;
    const canvasHeight = rect.height;
    const volumeWidth = images[0]?.columns || 512;
    const volumeDepth = images.length;
    
    // Click X position maps to axial X coordinate
    const axialX = Math.floor((x / canvasWidth) * volumeWidth);
    // Click Y position maps to axial Z index (slice)
    const axialZ = Math.floor((y / canvasHeight) * volumeDepth);
    
    // Update crosshair position
    setCrosshairPos(prev => ({ ...prev, x: axialX }));
    
    // Navigate to the clicked axial slice
    if (axialZ >= 0 && axialZ < images.length) {
      setCurrentIndex(axialZ);
    }
  };

  // Notify parent when slice position changes
  useEffect(() => {
    if (images.length > 0 && images[currentIndex] && onSlicePositionChange) {
      const slicePosition =
        images[currentIndex].parsedSliceLocation ??
        images[currentIndex].parsedZPosition ??
        currentIndex;
      onSlicePositionChange(slicePosition);
    }
    
    // Clear preview contours when slice changes to prevent showing same preview on different slices
    setPreviewContours([]);
  }, [currentIndex, images, onSlicePositionChange]);
  
  // Set the displayCurrentImageRef to point to displayCurrentImage
  useEffect(() => {
    displayCurrentImageRef.current = displayCurrentImage;
  });

  // Watch for crosshair position changes and update MPR views
  useEffect(() => {
    if (orientation === 'axial' && images.length > 0 && sagittalCanvasRef.current && coronalCanvasRef.current) {
      // Update MPR views when crosshair position changes
      const updateMPRViews = async () => {
        try {
          setIsLoadingMPR(true);
          
          // Convert window/level props to width/center terminology used by renderMPRCanvas
          const windowWidth = props.windowLevel?.window || 350;
          const windowCenter = props.windowLevel?.level || 40;
          
          // Clamp crosshair position to valid range
          const sagittalSliceIndex = Math.max(0, Math.min(crosshairPos.x, (images[0]?.columns || 512) - 1));
          const coronalSliceIndex = Math.max(0, Math.min(crosshairPos.y, (images[0]?.rows || 512) - 1));
          
          // Render MPR views with current window/level settings
          await Promise.all([
            sagittalCanvasRef.current && renderMPRCanvas(sagittalCanvasRef.current, 'sagittal', sagittalSliceIndex, windowWidth, windowCenter),
            coronalCanvasRef.current && renderMPRCanvas(coronalCanvasRef.current, 'coronal', coronalSliceIndex, windowWidth, windowCenter)
          ].filter(Boolean));
        } catch (error) {
          console.error("Error updating MPR views:", error);
        } finally {
          setIsLoadingMPR(false);
        }
      };
      
      updateMPRViews();
    }
  }, [crosshairPos, orientation, images.length, props.windowLevel]);

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    // Check if any drawing tool or measurement tool is active - if so, skip pan functionality
    const isDrawingToolActive =
      (brushToolState?.isActive && 
       (brushToolState?.tool === "brush" || 
        brushToolState?.tool === "pen" || 
        brushToolState?.tool === "planar-contour")) ||
      isMeasurementToolActive;

    // Only prevent default and stop propagation if drawing/measurement tool is NOT active
    if (!isDrawingToolActive) {
      e.preventDefault();
      e.stopPropagation();
    }

    if (e.button === 0 && !isDrawingToolActive) {
      // Left click - crosshair mode or pan mode
      if (crosshairMode && canvasRef.current && images[currentIndex]) {
        // In crosshair mode, update crosshair position
        const rect = canvasRef.current.getBoundingClientRect();
        const canvasX = e.clientX - rect.left;
        const canvasY = e.clientY - rect.top;
        
        // Convert canvas coordinates to image pixel coordinates
        const canvasWidth = canvasRef.current.width;
        const canvasHeight = canvasRef.current.height;
        const imageWidth = images[currentIndex]?.columns || 512;
        const imageHeight = images[currentIndex]?.rows || 512;
        
        // Calculate scale with zoom factor (same as render16BitImage)
        const baseScale = Math.min(canvasWidth / imageWidth, canvasHeight / imageHeight);
        const totalScale = baseScale * zoom;
        const scaledWidth = imageWidth * totalScale;
        const scaledHeight = imageHeight * totalScale;
        
        // Center position with pan offset
        const imageX = (canvasWidth - scaledWidth) / 2 + panX;
        const imageY = (canvasHeight - scaledHeight) / 2 + panY;
        
        // Convert canvas coordinates to image pixel coordinates
        const pixelX = Math.floor((canvasX - imageX) / totalScale);
        const pixelY = Math.floor((canvasY - imageY) / totalScale);
        
        // Check if within image bounds
        if (pixelX >= 0 && pixelX < imageWidth && pixelY >= 0 && pixelY < imageHeight) {
          setCrosshairPos({ x: pixelX, y: pixelY });
          console.log(`Crosshair repositioned to: ${pixelX}, ${pixelY}`);
          scheduleRender(); // Re-render to show new crosshair position
        }
      } else {
        // Pan mode
        setIsDragging(true);
        setDragStart({ x: e.clientX, y: e.clientY });
        setLastPanX(panX);
        setLastPanY(panY);
      }
    } else if (e.button === 2 && !isDrawingToolActive) {
      // Right click for window/level (disabled during drawing mode)
      const startX = e.clientX;
      const startY = e.clientY;
      const startWindow = currentWindowLevel.width;
      const startCenter = currentWindowLevel.center;

      const handleWindowLevelDrag = (moveEvent: MouseEvent) => {
        moveEvent.preventDefault();
        const deltaX = moveEvent.clientX - startX;
        const deltaY = moveEvent.clientY - startY;

        const newWidth = Math.max(1, startWindow + deltaX * 2);
        const newCenter = startCenter - deltaY * 1.5;

        updateWindowLevel({ width: newWidth, center: newCenter });
      };

      const handleWindowLevelEnd = (endEvent: MouseEvent) => {
        endEvent.preventDefault();
        document.removeEventListener("mousemove", handleWindowLevelDrag);
        document.removeEventListener("mouseup", handleWindowLevelEnd);
      };

      document.addEventListener("mousemove", handleWindowLevelDrag);
      document.addEventListener("mouseup", handleWindowLevelEnd);
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    // Skip pan functionality if any drawing tool or measurement tool is active
    const isDrawingToolActive =
      (brushToolState?.isActive && 
       (brushToolState?.tool === "brush" || 
        brushToolState?.tool === "pen" || 
        brushToolState?.tool === "planar-contour")) ||
      isMeasurementToolActive;

    // NOTE: Crosshair position is now only updated on click when in crosshair mode,
    // not on mouse move. This prevents the crosshair from following the mouse cursor.

    // Only handle pan if drawing/measurement tool is NOT active
    if (isDragging && !isDrawingToolActive) {
      const deltaX = e.clientX - dragStart.x;
      const deltaY = e.clientY - dragStart.y;
      setPanX(lastPanX + deltaX);
      setPanY(lastPanY + deltaY);
    }
  };

  const handleCanvasMouseUp = () => {
    // Skip pan functionality if any drawing tool or measurement tool is active
    const isDrawingToolActive =
      (brushToolState?.isActive && 
       (brushToolState?.tool === "brush" || 
        brushToolState?.tool === "pen" || 
        brushToolState?.tool === "planar-contour")) ||
      isMeasurementToolActive;

    if (!isDrawingToolActive) {
      setIsDragging(false);
    }
  };

  const handleCanvasWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    // Always handle wheel events
    e.preventDefault();
    e.stopPropagation();

    if (e.ctrlKey || e.metaKey) {
      // Ctrl+scroll for zoom
      const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
      setZoom((prev) => Math.max(0.1, Math.min(5, prev * zoomFactor)));
      console.log(`🔍 Zoom: ${e.deltaY > 0 ? 'out' : 'in'} (factor: ${zoomFactor})`);
    } else {
      // Regular scroll for slice navigation
      console.log(`🖱️ Scroll: deltaY=${e.deltaY} currentIndex=${currentIndex}`);
      if (e.deltaY > 0) {
        goToNext();
      } else {
        goToPrevious();
      }
    }
  };

  const handleZoomIn = () => {
    setZoom((prev) => Math.min(5, prev * 1.2));
  };

  const handleZoomOut = () => {
    setZoom((prev) => Math.max(0.1, prev / 1.2));
  };

  const handleResetZoom = () => {
    setZoom(1);
    setPanX(0);
    setPanY(0);
  };

  // Expose zoom functions to parent component via imperative handle
  useEffect(() => {
    // Always expose zoom functions for toolbar access
    (window as any).currentViewerZoom = {
      zoomIn: handleZoomIn,
      zoomOut: handleZoomOut,
      resetZoom: handleResetZoom,
    };

    return () => {
      delete (window as any).currentViewerZoom;
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") goToPrevious();
      if (e.key === "ArrowRight" || e.key === "ArrowDown") goToNext();
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [currentIndex, images]);

  // Animation loop for dashed borders on predicted contours
  useEffect(() => {
    let animationFrameId: number;
    
    const animate = (timestamp: number) => {
      setAnimationTime(timestamp);
      
      // Check if we need to keep animating (if there are predicted contours)
      const hasPredictedContours = rtStructures?.structures?.some((structure: any) =>
        structure.contours?.some((contour: any) => contour.isPredicted)
      );
      
      if (hasPredictedContours) {
        animationFrameId = requestAnimationFrame(animate);
      }
    };
    
    // Start animation if there are predicted contours
    const hasPredictedContours = rtStructures?.structures?.some((structure: any) =>
      structure.contours?.some((contour: any) => contour.isPredicted)
    );
    
    if (hasPredictedContours) {
      animationFrameId = requestAnimationFrame(animate);
    }
    
    return () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, [rtStructures]); // Re-run when RT structures change

  // Animation loop for animated dashed preview contours
  useEffect(() => {
    if (!previewContours || previewContours.length === 0) return;

    let rafId: number | null = null;
    const animate = (ts: number) => {
      setAnimationTime(ts);
      try { scheduleRender(); } catch {}
      rafId = requestAnimationFrame(animate);
    };

    rafId = requestAnimationFrame(animate);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [previewContours.length, scheduleRender]);

  // Test function to add a predicted contour for demonstration
  const addTestPredictedContour = () => {
    if (!rtStructures || !rtStructures.structures || testPredictionAdded) return;
    
    console.log("🎯 Adding test predicted contour to demonstrate animated dashed borders");
    
    // Find the TEST structure (roiNumber 943)
    const testStructure = rtStructures.structures.find((s: any) => s.roiNumber === 943);
    if (!testStructure) {
      console.log("TEST structure not found, skipping prediction demo");
      return;
    }
    
    // Create a simple circular predicted contour on a different slice
    const currentSlice = images.length > 0 && images[currentIndex] 
      ? (images[currentIndex].parsedSliceLocation || images[currentIndex].parsedZPosition || currentIndex)
      : -115;
    
    const predictedSlice = currentSlice + 3; // 3mm away
    
    // Create a circular contour in world coordinates
    const centerX = -50; // World coordinates
    const centerY = 50;
    const radius = 20;
    const points: number[] = [];
    
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * 2 * Math.PI;
      const x = centerX + radius * Math.cos(angle);
      const y = centerY + radius * Math.sin(angle);
      points.push(x, y, predictedSlice);
    }
    
    // Add the predicted contour
    const predictedContour = {
      slicePosition: predictedSlice,
      points: points,
      numberOfPoints: points.length / 3,
      isPredicted: true,
      predictionConfidence: 0.85
    };
    
    // Deep copy and add the predicted contour
    const updatedStructures = structuredClone ? structuredClone(rtStructures) : JSON.parse(JSON.stringify(rtStructures));
    const updatedTestStructure = updatedStructures.structures.find((s: any) => s.roiNumber === 943);
    if (updatedTestStructure) {
      updatedTestStructure.contours.push(predictedContour);
      setLocalRTStructures(updatedStructures);
      setTestPredictionAdded(true);
      
      console.log(`✅ Added predicted contour to slice ${predictedSlice} with animated dashed border`);
      console.log(`Navigate to slice ${predictedSlice} to see the animated prediction!`);
    }
  };

  // Add test predicted contour when RT structures are loaded
  useEffect(() => {
    if (rtStructures && !testPredictionAdded) {
      // Add a small delay to ensure everything is loaded
      setTimeout(() => {
        addTestPredictedContour();
      }, 1000);
    }
  }, [rtStructures, testPredictionAdded]);

  // Handle prediction confirmation - convert dashed predicted contours to solid confirmed contours
  const handlePredictionConfirm = (structureId: number, slicePosition: number) => {
    if (!rtStructures) return;
    
    if (false) console.log(`🔄 Confirming prediction for structure ${structureId} at slice ${slicePosition}`);
    
    // Deep copy the structures
    const updatedStructures = structuredClone ? structuredClone(rtStructures) : JSON.parse(JSON.stringify(rtStructures));
    
    // Find the structure and contour to confirm
    const structure = updatedStructures.structures.find((s: any) => s.roiNumber === structureId);
    if (!structure) {
      console.error(`Structure ${structureId} not found`);
      return;
    }
    
    const contour = structure.contours.find((c: any) => 
      c.isPredicted && Math.abs(c.slicePosition - slicePosition) <= 1.5
    );
    
    if (!contour) {
      console.error(`Predicted contour not found for structure ${structureId} at slice ${slicePosition}`);
      return;
    }
    
    // Convert predicted contour to confirmed contour
    contour.isPredicted = false;
    delete contour.predictionConfidence;
    
    console.log(`✅ Confirmed contour for structure ${structureId} - changed from dashed to solid border`);
    
    // Update local state
    setLocalRTStructures(updatedStructures);
    
    // Save to server
    saveContourUpdates(updatedStructures);
    
    // Notify parent component
    if (onContourUpdate) {
      onContourUpdate(updatedStructures);
    }
  };

  // Group contours into connected blobs (per-slice, same-slice contours considered disconnected unless polygons intersect)
  function groupStructureBlobs(structure: any, tolMm: number): Array<Array<{ slicePosition: number; points: number[]; numberOfPoints: number }>> {
    const contours = Array.isArray(structure?.contours) ? structure.contours : [];
    const bySlice = new Map<number, Array<{ slicePosition: number; points: number[]; numberOfPoints: number }>>();
    for (const c of contours) {
      const key = findExistingKeyWithinTolerance(bySlice, c.slicePosition, tolMm);
      const list = bySlice.get(key) || [];
      list.push(c);
      bySlice.set(key, list);
    }
    // Start with each contour as its own blob; merge on intersection per slice
    const blobs: Array<Array<{ slicePosition: number; points: number[]; numberOfPoints: number }>> = [];
    for (const [, sliceContours] of bySlice) {
      // Union groups within slice based on polygon intersection
      const groups: Array<Array<typeof sliceContours[number]>> = [];
      for (const c of sliceContours) {
        let placed = false;
        for (const g of groups) {
          if (g.some((x) => doPolygonsIntersectSimple(x.points, c.points))) {
            g.push(c);
            placed = true;
            break;
          }
        }
        if (!placed) groups.push([c]);
      }
      // Append each group as separate blobs; different slices do not connect
      for (const g of groups) {
        blobs.push([...g]);
      }
    }
    return blobs;
  }

  function findExistingKeyWithinTolerance(map: Map<number, any>, value: number, tol: number): number {
    for (const k of map.keys()) {
      if (Math.abs(k - value) <= tol) return k;
    }
    return value;
  }

  function computeBlobVolumeCc(blobContours: Array<{ slicePosition: number; points: number[] }>, metadata: any): number {
    if (!blobContours?.length) return 0;
    const px = parseFloat(metadata?.pixelSpacing?.split?.("\\")?.[0]) || metadata?.pixelSpacing?.[0] || 1;
    const py = parseFloat(metadata?.pixelSpacing?.split?.("\\")?.[1]) || metadata?.pixelSpacing?.[1] || px || 1;
    const dz = parseFloat(metadata?.sliceThickness) || parseFloat(metadata?.spacingBetweenSlices) || 1;
    const areaPerPixelMm2 = px * py;
    // Polygon area in mm^2 from world points (assumed mm)
    const areaOf = (pts: number[]) => {
      let area = 0;
      for (let i = 0; i < pts.length; i += 3) {
        const j = (i + 3) % pts.length;
        area += pts[i] * pts[j + 1] - pts[j] * pts[i + 1];
      }
      return Math.abs(area / 2);
    };
    // Integrate per-slice area * dz
    const slices = new Map<number, number>();
    for (const c of blobContours) {
      slices.set(c.slicePosition, (slices.get(c.slicePosition) || 0) + areaOf(c.points));
    }
    let volumeMm3 = 0;
    for (const [, areaMm2] of slices) {
      volumeMm3 += areaMm2 * dz;
    }
    return volumeMm3 / 1000; // cc
  }

  if (isLoading) {
    return (
      <Card className="h-full bg-black border-indigo-800 flex items-center justify-center">
        <div className="text-center">
          {/* Medical-themed loading animation */}
          <div className="relative w-24 h-24 mx-auto mb-4">
            {/* Outer ring with gradient */}
            <div className="absolute inset-0 rounded-full border-4 border-transparent bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500 bg-clip-border animate-spin"></div>
            
            {/* Inner ring rotating opposite direction */}
            <div className="absolute inset-2 rounded-full border-4 border-transparent bg-gradient-to-l from-cyan-500 via-blue-500 to-indigo-500 bg-clip-border animate-spin" style={{ animationDirection: 'reverse' }}></div>
            
            {/* Center pulse effect */}
            <div className="absolute inset-4 rounded-full bg-gradient-to-br from-blue-600 to-indigo-600 animate-pulse"></div>
            
            {/* Medical cross icon in center */}
            <div className="absolute inset-0 flex items-center justify-center">
              <svg className="w-8 h-8 text-white z-10" fill="currentColor" viewBox="0 0 24 24">
                <path d="M9 3V21H15V3H9ZM3 9V15H21V9H3Z" />
              </svg>
            </div>
          </div>
          
          <p className="text-white text-lg font-medium mb-2">Loading medical images...</p>
          <p className="text-indigo-300 text-sm">Preparing visualization</p>
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="h-full bg-black border-indigo-800 flex items-center justify-center">
        <div className="text-center text-red-400">
          <p className="mb-2">Error loading CT scan:</p>
          <p className="text-sm">{error}</p>
          <Button
            onClick={loadImages}
            className="mt-4 bg-indigo-600 hover:bg-indigo-700"
          >
            Retry
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="h-full bg-black border-indigo-800">
      {/* Header with modern toolbar styling to match contour editing toolbar */}
      <div className="p-3 border-b border-gray-700/50">
        <div 
          className="backdrop-blur-md border rounded-xl px-4 py-3 shadow-lg flex items-center justify-between"
          style={{ 
            backgroundColor: '#1a1a1a95',
            borderColor: '#4a5568'
          }}
        >
          <div className="flex items-center space-x-2">
            <Badge className="bg-blue-900/60 text-blue-200 border border-blue-600/30 backdrop-blur-sm">
              CT Scan {orientation !== 'axial' && `- ${orientation.charAt(0).toUpperCase() + orientation.slice(1)}`}
            </Badge>
            {images.length > 0 && (
              <>
                <Badge
                  variant="outline"
                  className="border-gray-500/50 text-gray-300 bg-gray-800/40 backdrop-blur-sm"
                >
                  {currentIndex + 1} / {(() => {
                    let maxSlices = images.length;
                    if (orientation === 'sagittal' && images.length > 0) {
                      maxSlices = images[0]?.columns || 512;
                    } else if (orientation === 'coronal' && images.length > 0) {
                      maxSlices = images[0]?.rows || 512;
                    }
                    return maxSlices;
                  })()}
                </Badge>
                
                {/* Window/Level/Z position pills */}
                <Badge className="bg-cyan-900/40 text-cyan-200 border border-cyan-600/30 backdrop-blur-sm">
                  W: {Math.round(currentWindowLevel.width)}
                </Badge>
                <Badge className="bg-orange-900/40 text-orange-200 border border-orange-600/30 backdrop-blur-sm">
                  L: {Math.round(currentWindowLevel.center)}
                </Badge>
                {images[currentIndex] && orientation === 'axial' && (
                  <Badge className="bg-purple-900/40 text-purple-200 border border-purple-600/30 backdrop-blur-sm">
                    Z: {images[currentIndex].parsedSliceLocation?.toFixed(1) ||
                        images[currentIndex].parsedZPosition?.toFixed(1) ||
                        (currentIndex + 1)}
                  </Badge>
                )}
              </>
            )}
            {secondarySeriesId && (
              <Badge className={`flex items-center gap-1 border backdrop-blur-sm ${
                secondaryModality === 'PT' 
                  ? 'bg-yellow-900/40 text-yellow-200 border-yellow-600/30' 
                  : secondaryModality === 'CT'
                  ? 'bg-blue-900/40 text-blue-200 border-blue-600/30'
                  : 'bg-purple-900/40 text-purple-200 border-purple-600/30'
              }`}>
                <div className={`w-2 h-2 rounded-full animate-pulse ${
                  secondaryModality === 'PT' 
                    ? 'bg-yellow-400' 
                    : secondaryModality === 'CT'
                    ? 'bg-blue-400'
                    : 'bg-purple-400'
                }`} />
                {secondaryModality === 'PT' ? 'PT' : secondaryModality === 'CT' ? 'CT' : 'MR'} Fusion
                <span className={
                  secondaryModality === 'PT' 
                    ? 'text-yellow-300' 
                    : secondaryModality === 'CT'
                    ? 'text-blue-300'
                    : 'text-purple-300'
                }>
                  ({Math.round(fusionOpacity * 100)}%)
                </span>
                <Button size="sm" variant="ghost" className="h-5 px-2 ml-2 text-[10px] hover:bg-gray-700/40"
                  onClick={(e) => { e.stopPropagation(); setFusionDebugText(compileFusionDebug()); setShowFusionDebug(true); }}
                  title="Show fusion debug info">
                  Debug
                </Button>
              </Badge>
            )}
          </div>

          <div className="flex items-center space-x-2">
            {rtStructures && (
              <div className="flex items-center gap-1 px-2 py-1 bg-gray-800/50 rounded-lg">
                <Badge 
                  variant={showStructures ? "default" : "secondary"}
                  className={`${
                    showStructures 
                      ? 'bg-green-600/80 text-white border-green-500/50' 
                      : 'bg-gray-700/50 text-gray-300'
                  }`}
                >
                  RT ({rtStructures?.structures?.length || 0})
                </Badge>
                <span className="text-xs text-gray-400">
                  {showStructures ? 'Visible' : 'Hidden'}
                </span>
              </div>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="h-8 px-2 text-xs hover:bg-gray-700/40"
              onClick={() => { setFusionDebugText(compileFusionDebug()); setShowFusionDebug(true); }}
              title="Open Fusion Debug"
            >
              Fusion Debug
            </Button>
            
            {/* Background Loading Progress */}
            {prefetchProgress.total > 0 && prefetchProgress.loaded > 0 && prefetchProgress.loaded < prefetchProgress.total && !isLoading && (
              <div className="flex items-center space-x-2 px-3 py-1.5 bg-gray-800/50 rounded-lg">
                <div className="w-24 bg-gray-700 rounded-full h-1.5 overflow-hidden">
                  <div 
                    className="bg-gradient-to-r from-green-500 to-green-400 h-1.5 rounded-full transition-all duration-300 ease-out"
                    style={{ width: `${(prefetchProgress.loaded / prefetchProgress.total) * 100}%` }}
                  />
                </div>
                <span className="text-xs text-gray-300">
                  {Math.round((prefetchProgress.loaded / prefetchProgress.total) * 100)}% ({prefetchProgress.loaded}/{prefetchProgress.total})
                </span>
              </div>
            )}
            
            <Button
              size="sm"
              variant={isMeasurementToolActive ? "default" : "ghost"}
              onClick={() => {
                setIsMeasurementToolActive(!isMeasurementToolActive);
                if (brushToolState?.isActive) {
                  // Disable brush/pen tools when measurement is active
                  if (onBrushToolChange) {
                    onBrushToolChange({
                      ...brushToolState,
                      isActive: false
                    });
                  }
                }
              }}
              className={`h-8 px-3 transition-all duration-200 rounded-lg text-gray-300 ${
                isMeasurementToolActive 
                  ? 'bg-blue-600/80 hover:bg-blue-700/80 text-white border border-blue-500/50 shadow-sm backdrop-blur-sm' 
                  : 'hover:bg-gray-700/50 hover:text-white'
              }`}
              title="Measurement Tool"
            >
              <Ruler className="w-4 h-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={goToPrevious}
              disabled={currentIndex === 0}
              className="h-8 px-3 transition-all duration-200 rounded-lg text-gray-300 hover:bg-gray-700/50 hover:text-white disabled:opacity-50 disabled:hover:bg-transparent"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={goToNext}
              disabled={currentIndex === (() => {
                let maxSlices = images.length;
                if (orientation === 'sagittal' && images.length > 0) {
                  maxSlices = images[0]?.columns || 512;
                } else if (orientation === 'coronal' && images.length > 0) {
                  maxSlices = images[0]?.rows || 512;
                }
                return maxSlices - 1;
              })()}
              className="h-8 px-3 transition-all duration-200 rounded-lg text-gray-300 hover:bg-gray-700/50 hover:text-white disabled:opacity-50 disabled:hover:bg-transparent"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1 p-4 flex items-center justify-center relative overflow-hidden">
        {fusionDisplayMode === 'side-by-side' && secondarySeriesId ? (
          /* Side-by-Side Layout */
          <div className="w-full h-full flex gap-2">
            {/* Primary Canvas Container */}
            <div className="relative flex-1 flex items-center justify-center bg-black">
              <canvas
                ref={canvasRef}
                width={1024}
                height={1024}
                onMouseDown={handleCanvasMouseDown}
                onMouseMove={(e) => {
                  handleCanvasMouseMove(e);
                }}
                onMouseUp={handleCanvasMouseUp}
                onWheel={(e) => {
                  handleCanvasWheel(e);
                }}
                onContextMenu={(e) => e.preventDefault()}
                className={`max-w-full max-h-full object-contain rounded ${
                  brushToolState?.isActive && brushToolState?.tool === "brush"
                    ? "cursor-none"
                    : brushToolState?.isActive && (brushToolState?.tool === "pen" || brushToolState?.tool === "pen-original")
                    ? ""
                    : "cursor-move"
                }`}
                style={{
                  backgroundColor: "black",
                  imageRendering: "auto",
                  userSelect: "none",
                }}
              />
              <canvas
                ref={contoursOverlayCanvasRef}
                width={1024}
                height={1024}
                className="pointer-events-none absolute max-w-full max-h-full object-contain"
                style={{
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                  zIndex: 2,
                }}
              />
            </div>
            
            {/* Secondary/Fusion Canvas Container */}
            <div className="relative flex-1 flex items-center justify-center bg-black">
              <canvas
                ref={fusionOverlayCanvasRef}
                width={1024}
                height={1024}
                className="max-w-full max-h-full object-contain rounded"
                style={{
                  backgroundColor: "black",
                }}
              />
            </div>
          </div>
        ) : (
          /* Overlay Layout */
          <div className="relative w-full h-full flex items-center justify-center">
            <canvas
              ref={canvasRef}
              width={1024}
              height={1024}
              onMouseDown={handleCanvasMouseDown}
              onMouseMove={(e) => {
                handleCanvasMouseMove(e);
                // Crosshair position is only updated on click in crosshair mode
                // Not on mouse move
              }}
              onMouseUp={handleCanvasMouseUp}
              onWheel={(e) => {
                // Always handle wheel events for scrolling, even when pen tool is active
                handleCanvasWheel(e);
              }}
              onContextMenu={(e) => e.preventDefault()}
              className={`max-w-full max-h-full object-contain rounded ${
                brushToolState?.isActive && brushToolState?.tool === "brush"
                  ? "cursor-none"
                  : brushToolState?.isActive && (brushToolState?.tool === "pen" || brushToolState?.tool === "pen-original")
                  ? ""
                  : "cursor-move"
              }`}
              style={{
                backgroundColor: "black",
                imageRendering: "auto",
                userSelect: "none",
                opacity: secondarySeriesId && fusionDisplayMode === 'overlay' ? (1 - fusionOpacity) : 1,
                transition: 'opacity 120ms ease-out',
              }}
            />

            <canvas
              ref={fusionOverlayCanvasRef}
              width={1024}
              height={1024}
              className="pointer-events-none absolute max-w-full max-h-full object-contain"
              style={{
                visibility: fusionOpacity === 0 ? 'hidden' : 'visible',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                zIndex: 1,
              }}
            />

            <canvas
              ref={contoursOverlayCanvasRef}
              width={1024}
              height={1024}
              className="pointer-events-none absolute max-w-full max-h-full object-contain"
              style={{
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                zIndex: 2,
              }}
            />
          </div>
        )}

        <div>
          {/* Simple Brush Tool overlay */}
          {brushToolState?.isActive &&
            brushToolState?.tool === "brush" && (
              <SimpleBrushTool
                canvasRef={canvasRef}
                isActive={brushToolState.isActive}
                brushSize={brushToolState.brushSize}
                selectedStructure={selectedForEdit}
                rtStructures={rtStructures}
                currentSlicePosition={
                  images.length > 0 && images[currentIndex]
                    ? (images[currentIndex].parsedSliceLocation ??
                      images[currentIndex].parsedZPosition ??
                      currentIndex)
                    : 0
                }
                onContourUpdate={(payload: any) => {
                  // Handle different types of contour updates
                  if (payload.action === "grow_contour") {
                    handleGrowContour(payload);
                  } else {
                    handleContourUpdate(payload);
                  }
                }}
                zoom={zoom}
                panX={panX}
                panY={panY}
                imageMetadata={imageMetadata}
                smoothingEnabled={true}
                enableSmartMode={true}
                predictionEnabled={false}
                smartBrushEnabled={!!brushToolState.smartBrushEnabled}
                ctTransform={ctTransform}
                dicomImage={images.length > 0 && images[currentIndex] ? images[currentIndex] : null}
                onBrushModeChange={(mode: BrushOperation) => {
                  console.log("Brush mode changed:", mode);
                }}
                onBrushSizeChange={(newSize: number) => {
                  if (onBrushSizeChange) {
                    onBrushSizeChange(newSize);
                  }
                  if (onBrushToolChange) {
                    onBrushToolChange({
                      ...brushToolState,
                      brushSize: newSize
                    });
                  }
                }}
                onPreviewUpdate={(contours: any[] | null) => {
                  setPreviewContours(contours || []);
                }}
              />
            )}

          {/* Erase Tool overlay - works like brush but erases */}
          {brushToolState?.isActive &&
            brushToolState?.tool === "erase" && (
              <SimpleBrushTool
                canvasRef={canvasRef}
                isActive={brushToolState.isActive}
                brushSize={brushToolState.brushSize}
                selectedStructure={selectedForEdit}
                rtStructures={rtStructures}
                currentSlicePosition={
                  images.length > 0 && images[currentIndex]
                    ? (images[currentIndex].parsedSliceLocation ??
                      images[currentIndex].parsedZPosition ??
                      currentIndex)
                    : 0
                }
                onContourUpdate={(payload: any) => {
                  // Handle different types of contour updates
                  if (payload.action === "grow_contour") {
                    handleGrowContour(payload);
                  } else {
                    handleContourUpdate(payload);
                  }
                }}
                zoom={zoom}
                panX={panX}
                panY={panY}
                imageMetadata={imageMetadata}
                smoothingEnabled={true}
                enableSmartMode={true}
                predictionEnabled={false}
                smartBrushEnabled={!!brushToolState.smartBrushEnabled}
                ctTransform={ctTransform}
                dicomImage={images.length > 0 && images[currentIndex] ? images[currentIndex] : null}
                isEraseMode={true} // Pass erase mode flag
                onBrushModeChange={(mode: BrushOperation) => {
                  console.log("Erase mode changed:", mode);
                }}
                onBrushSizeChange={(newSize: number) => {
                  if (onBrushSizeChange) {
                    onBrushSizeChange(newSize);
                  }
                  if (onBrushToolChange) {
                    onBrushToolChange({
                      ...brushToolState,
                      brushSize: newSize
                    });
                  }
                }}
                onPreviewUpdate={(contours: any[] | null) => {
                  setPreviewContours(contours || []);
                }}
              />
            )}

          {/* Eclipse Pen Tool V2 - Clean implementation with proper boolean operations */}
          {brushToolState?.isActive &&
            brushToolState?.tool === "pen" &&
            selectedForEdit && (
              <PenToolV2
                isActive={brushToolState.isActive}
                selectedStructure={selectedForEdit}
                rtStructures={rtStructures}
                currentSlicePosition={
                  images.length > 0 && images[currentIndex]
                    ? (images[currentIndex].parsedSliceLocation ??
                      images[currentIndex].parsedZPosition ??
                      currentIndex)
                    : 0
                }
                imageMetadata={imageMetadata}
                onContourUpdate={(payload: any) => {
                  handleContourUpdate(payload);
                }}
                canvasRef={canvasRef}
                ctTransform={ctTransform}
              />
            )}

          {/* Eclipse Planar Contour Tool - Using PenToolUnifiedV2 */}
          {brushToolState?.isActive &&
            brushToolState?.tool === "planar-contour" &&
            selectedForEdit && (
              <PenToolUnifiedV2
                canvasRef={canvasRef}
                isActive={brushToolState.isActive}
                selectedStructure={selectedForEdit}
                rtStructures={rtStructures}
                onContourUpdate={(payload: any) => {
                  handleContourUpdate(payload);
                }}
                imageMetadata={imageMetadata}
                worldToCanvas={worldToCanvas}
                canvasToWorld={canvasToWorld}
              />
            )}

          {/* Original Pen Tool overlay */}
          {brushToolState?.isActive &&
            brushToolState?.tool === "pen-original" &&
            selectedForEdit && (
              <PenTool
                canvasRef={canvasRef}
                isActive={brushToolState.isActive}
                selectedStructure={selectedForEdit}
                rtStructures={rtStructures}
                currentSlicePosition={
                  images.length > 0 && images[currentIndex]
                    ? (images[currentIndex].parsedSliceLocation ??
                      images[currentIndex].parsedZPosition ??
                      currentIndex)
                    : 0
                }
                onContourUpdate={(payload: any) => {
                  handleContourUpdate(payload);
                }}
                zoom={zoom}
                panX={panX}
                panY={panY}
                imageMetadata={imageMetadata}
              />
            )}
            
          {/* Measurement Tool overlay */}
          {isMeasurementToolActive && (
            <MeasurementTool
              canvasRef={canvasRef}
              isActive={isMeasurementToolActive}
              imageMetadata={imageMetadata}
              ctTransform={ctTransform.current ? {
                current: {
                  scale: ctTransform.current.scale,
                  offsetX: ctTransform.current.offsetX,
                  offsetY: ctTransform.current.offsetY
                }
              } as React.MutableRefObject<{ scale: number; offsetX: number; offsetY: number }> : null}
              currentSlicePosition={
                images.length > 0 && images[currentIndex]
                  ? (images[currentIndex].parsedSliceLocation ??
                    images[currentIndex].parsedZPosition ??
                    currentIndex)
                  : 0
              }
              onMeasurementComplete={(distance, unit) => {
                console.log(`Measurement completed: ${distance.toFixed(1)} ${unit}`);
              }}
            />
          )}

          {/* Blob removal dialog */}
          <AlertDialog open={blobDialogOpen} onOpenChange={(open) => setBlobDialogOpen(open)}>
            <AlertDialogContent className="max-w-md">
              <AlertDialogHeader>
                <AlertDialogTitle>Remove blobs</AlertDialogTitle>
              </AlertDialogHeader>
              <div className="space-y-2">
                {blobDialogData?.blobs?.map((b) => (
                  <label key={b.id} className="flex items-center justify-between gap-3 text-sm text-white/90">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={selectedBlobIdsToDelete.has(b.id)}
                        onChange={(e) => {
                          const next = new Set(selectedBlobIdsToDelete);
                          if (e.target.checked) next.add(b.id); else next.delete(b.id);
                          setSelectedBlobIdsToDelete(next);
                        }}
                      />
                      <span>Blob {b.id}</span>
                    </div>
                    <span className="text-xs text-gray-300">{b.volumeCc.toFixed(2)} cc</span>
                  </label>
                ))}
                {(!blobDialogData?.blobs?.length || blobDialogData.blobs.length <= 1) && (
                  <div className="text-xs text-gray-400">Only one blob detected.</div>
                )}
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel>Close</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    try {
                      if (!blobDialogData || !blobDialogData.structureId) return;
                      const structure = (localRTStructures || rtStructures)?.structures?.find((s: any) => s.roiNumber === blobDialogData.structureId);
                      if (!structure) return;
                      const toDelete = new Set(Array.from(selectedBlobIdsToDelete));
                      if (toDelete.size === 0) return;

                      const keysToRemove = new Set<string>();
                      blobDialogData.blobs.forEach((b) => {
                        if (!toDelete.has(b.id)) return;
                        b.contours.forEach((c) => {
                          const key = `${c.slicePosition}|${c.points.length}|${c.points[0]}|${c.points[1]}`;
                          keysToRemove.add(key);
                        });
                      });

                      const updated = structuredClone ? structuredClone(localRTStructures || rtStructures) : JSON.parse(JSON.stringify(localRTStructures || rtStructures));
                      const s = updated.structures.find((x: any) => x.roiNumber === blobDialogData.structureId);
                      if (!s) return;
                      s.contours = s.contours.filter((c: any) => {
                        const key = `${c.slicePosition}|${c.points.length}|${c.points[0]}|${c.points[1]}`;
                        return !keysToRemove.has(key);
                      });

                      setLocalRTStructures(updated);
                      if (seriesId) {
                        undoRedoManager.saveState(seriesId, 'remove_blobs', blobDialogData.structureId, updated);
                      }
                      saveContourUpdates(updated, 'remove_blobs');
                    } finally {
                      setBlobDialogOpen(false);
                    }
                  }}
                >
                  Delete Selected
                </AlertDialogAction>
              </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Fusion Debug Aid */}
        <AlertDialog open={showFusionDebug} onOpenChange={(open) => setShowFusionDebug(open)}>
          <AlertDialogContent className="max-w-2xl">
            <AlertDialogHeader>
              <AlertDialogTitle>Fusion Debug Info</AlertDialogTitle>
            </AlertDialogHeader>
            <div className="space-y-2">
              <p className="text-sm text-gray-300">Copy and paste this back for analysis.</p>
              <textarea
                readOnly
                value={fusionDebugText}
                className="w-full h-64 p-2 text-xs bg-black/60 border border-gray-600 rounded-md text-gray-200 font-mono"
              />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>Close</AlertDialogCancel>
              <AlertDialogAction onClick={() => { try { navigator.clipboard.writeText(fusionDebugText); } catch {} }}>Copy</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* REG Details popup */}
        <AlertDialog open={showRegDetails} onOpenChange={(open) => setShowRegDetails(open)}>
          <AlertDialogContent className="max-w-3xl">
            <AlertDialogHeader>
              <AlertDialogTitle>Registration Details (for Eclipse compare)</AlertDialogTitle>
            </AlertDialogHeader>
            <div className="space-y-2">
              <textarea
                readOnly
                value={regDetailsText}
                className="w-full h-80 p-2 text-xs bg-black/60 border border-gray-600 rounded-md text-gray-200 font-mono"
              />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>Close</AlertDialogCancel>
              <AlertDialogAction onClick={() => { try { navigator.clipboard.writeText(regDetailsText); } catch {} }}>Copy</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

          {/* Floating MPR windows for sagittal and coronal views */}
          {orientation === 'axial' && images.length > 0 && mprVisible && (
            <div className="absolute right-4 top-16 flex flex-col gap-3">
              {/* Sagittal view */}
              <div className="mpr-window">
                <div className="mpr-window-header flex justify-between items-center">
                  <span>Sagittal</span>
                </div>
                <div className="mpr-canvas-container">
                  <MPRFloating
                    images={images}
                    orientation="sagittal"
                    sliceIndex={Math.max(0, Math.min(crosshairPos.x, (images[0]?.columns || 512) - 1))}
                    windowWidth={currentWindowLevel.width}
                    windowCenter={currentWindowLevel.center}
                    crosshairPos={crosshairPos}
                    rtStructures={rtStructures}
                    currentZIndex={currentIndex}
                    onClick={handleSagittalClick}
                  />
                  {isLoadingMPR && (
                    <div className="mpr-loading">
                      <div className="mpr-loading-spinner" />
                    </div>
                  )}
                </div>
              </div>
              
              {/* Coronal view */}
              <div className="mpr-window">
                <div className="mpr-window-header flex justify-between items-center">
                  <span>Coronal</span>
                </div>
                <div className="mpr-canvas-container">
                  <MPRFloating
                    images={images}
                    orientation="coronal"
                    sliceIndex={Math.max(0, Math.min(crosshairPos.y, (images[0]?.rows || 512) - 1))}
                    windowWidth={currentWindowLevel.width}
                    windowCenter={currentWindowLevel.center}
                    crosshairPos={crosshairPos}
                    rtStructures={rtStructures}
                    currentZIndex={currentIndex}
                    onClick={handleCoronalClick}
                  />
                  {isLoadingMPR && (
                    <div className="mpr-loading">
                      <div className="mpr-loading-spinner" />
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
});

WorkingViewer.displayName = 'WorkingViewer';

export { WorkingViewer };

declare global {
  interface Window {
    dicomParser: any;
    workingViewerZoomIn?: () => void;
    workingViewerZoomOut?: () => void;
    workingViewerResetZoom?: () => void;
  }
}
