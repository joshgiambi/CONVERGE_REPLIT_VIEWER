/// <reference types="vite/client" />
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SeriesSelector } from './series-selector';
import { WorkingViewer } from './working-viewer';
import { ViewerToolbar } from './viewer-toolbar';
import { ContourEditToolbar } from './contour-edit-toolbar';
import { FusionControlPanel } from './fusion-control-panel';
import { ErrorModal } from './error-modal';
import { BooleanOperationsToolbar } from './boolean-operations-toolbar-new';
import { X, Target } from 'lucide-react';
import { undoRedoManager } from '@/lib/undo-system';
import { log } from '@/lib/log';
import { Button } from '@/components/ui/button';
import { MarginToolbar } from './margin-toolbar';
import { contoursToVIP } from '@/boolean/integrate';
import { union as vipUnion, intersect as vipIntersect, subtract as vipSubtract } from '@/boolean/vipBoolean';
import { vipToRectContours } from '@/boolean/simpleContours';
import { DICOMSeries, DICOMStudy, WindowLevel, WINDOW_LEVEL_PRESETS } from '@/lib/dicom-utils';
import type { RegistrationAssociation, RegistrationSeriesDetail } from '@/types/fusion';
import type { FusionManifest, FusionSecondaryDescriptor } from '@/types/fusion';
import { fetchFusionManifest, preloadFusionSecondary, getFusionManifest, clearFusionCaches } from '@/lib/fusion-utils';
import { cornerstoneConfig } from '@/lib/cornerstone-config';
import { LoadingProgress } from './loading-progress';

// TypeScript declaration for cornerstone
declare global {
  interface Window {
    cornerstone: any;
  }
}


interface ViewerInterfaceProps {
  studyData: any;
  onContourSettingsChange?: (settings: { width: number; opacity: number }) => void;
  contourSettings?: { width: number; opacity: number };
  onLoadedRTSeriesChange?: (seriesId: number | null) => void;
}

export function ViewerInterface({ studyData, onContourSettingsChange, contourSettings, onLoadedRTSeriesChange }: ViewerInterfaceProps) {
  const [selectedSeries, setSelectedSeries] = useState<DICOMSeries | null>(null);
  const [windowLevel, setWindowLevel] = useState<WindowLevel>(WINDOW_LEVEL_PRESETS.abdomen);
  const [error, setError] = useState<any>(null);
  const [series, setSeries] = useState<DICOMSeries[]>([]);
  const [visibleSeries, setVisibleSeries] = useState<DICOMSeries[]>([]);
  const [regAssociations, setRegAssociations] = useState<Record<number, number[]>>({});
  const [registrationRelationshipMap, setRegistrationRelationshipMap] = useState<Map<number, RegistrationAssociation[]>>(new Map());
  // Single-view mode only; MPR uses floating windows inside WorkingViewer
  const [activeToolMode, setActiveToolMode] = useState<'pan' | 'crosshairs' | 'measure'>('pan'); // Default to pan mode
  
  // Shared image cache to prevent reloading when switching modes
  const imageCache = useRef<Map<string, { images: any[], metadata: any }>>(new Map());
  
  const [rtStructures, setRTStructures] = useState<any>(null);
  const [structureVisibility, setStructureVisibility] = useState<Map<number, boolean>>(new Map());
  const [selectedStructures, setSelectedStructures] = useState<Set<number>>(new Set());
  const [selectedStructureColors, setSelectedStructureColors] = useState<string[]>([]);
  const [selectedForEdit, setSelectedForEdit] = useState<number | null>(null);
  const [isContourEditMode, setIsContourEditMode] = useState(false);
  const [brushToolState, setBrushToolState] = useState({
    tool: null as string | null,
    brushSize: 3,
    isActive: false,
    predictionEnabled: false
  });
  const [currentSlicePosition, setCurrentSlicePosition] = useState<number>(0);
  const [autoZoomLevel, setAutoZoomLevel] = useState<number | undefined>(undefined);
  const [autoLocalizeTarget, setAutoLocalizeTarget] = useState<{ x: number; y: number; z: number } | undefined>(undefined);
  const workingViewerRef = useRef<any>(null);
  const [imageMetadata, setImageMetadata] = useState<any>(null);
  
  // Fusion state
  const [showFusionPanel, setShowFusionPanel] = useState(false);
  const [secondarySeriesId, setSecondarySeriesId] = useState<number | null>(null);
  const [fusionOpacity, setFusionOpacity] = useState(0.5);
  // Secondary loading states for visual feedback
  const [secondaryLoadingStates, setSecondaryLoadingStates] = useState<Map<number, {progress: number, isLoading: boolean}>>(new Map());
  const [currentlyLoadingSecondary, setCurrentlyLoadingSecondary] = useState<number | null>(null);
  const [fusionManifest, setFusionManifest] = useState<FusionManifest | null>(null);
  const [fusionManifestError, setFusionManifestError] = useState<string | null>(null);
  const [fusionManifestLoading, setFusionManifestLoading] = useState(false);
  const [fusionWindowLevel, setFusionWindowLevel] = useState<{ window: number; level: number } | null>(null);
  const fusionManifestRequestRef = useRef(0);
  const [manifestActionStatus, setManifestActionStatus] = useState<string | null>(null);
  const [associationsReady, setAssociationsReady] = useState(false);
  const [fusionDebugSnapshot, setFusionDebugSnapshot] = useState<string | null>(null);
  const manifestInitRequestedRef = useRef(false);
  const autoPrimarySelectedRef = useRef(false);
  const [fallbackPrimarySeries, setFallbackPrimarySeries] = useState<DICOMSeries | null>(null);
  const [associationPrimarySeries, setAssociationPrimarySeries] = useState<DICOMSeries | null>(null);
  const manifestPrimedPatientsRef = useRef<Set<number>>(new Set());
  const manifestPrimingTasksRef = useRef<Map<number, Promise<void>>>(new Map());

  // All structures visibility state for syncing between RT button and hide all button
  const [allStructuresVisible, setAllStructuresVisible] = useState(true);
  
  // Track loaded RT series for selection state
  const [loadedRTSeriesId, setLoadedRTSeriesId] = useState<number | null>(null);
  
  // MPR visibility state
  const [mprVisible, setMprVisible] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  
  // Watch for secondary series changes to show/hide fusion panel
  useEffect(() => {
    if (secondarySeriesId !== null) {
      log.debug('Secondary series selected, showing fusion panel', 'viewer-interface');
      setShowFusionPanel(true);
    }
  }, [secondarySeriesId]);
  
  // Boolean operations state
  const [showBooleanOperations, setShowBooleanOperations] = useState(false);
  const [showMarginToolbar, setShowMarginToolbar] = useState(false);
  const [showLocalizationTool, setShowLocalizationTool] = useState(true);
  const [previewStructureInfo, setPreviewStructureInfo] = useState<{ targetName: string; isNewStructure: boolean } | null>(null);
  const [highlightedStructures, setHighlightedStructures] = useState<{ inputs: string[]; output: string }>({ inputs: [], output: '' });

  // Clear RT structures when patient changes
  useEffect(() => {
    log.debug(`Patient changed, clearing RT structures. Patient ID: ${studyData?.patient?.id}`,'viewer-interface');
    setRTStructures(null);
    setStructureVisibility(new Map());
    setSelectedStructures(new Set());
    setSelectedForEdit(null);
    setSelectedStructureColors([]);
    setIsContourEditMode(false);
    setLoadedRTSeriesId(null);  // Clear loaded RT series ID
    }, [studyData?.patient?.id]);

  // Notify parent when loaded RT series changes
  useEffect(() => {
    if (onLoadedRTSeriesChange) {
      onLoadedRTSeriesChange(loadedRTSeriesId);
    }
  }, [loadedRTSeriesId, onLoadedRTSeriesChange]);

  // Automatically enter contour edit mode when a structure is selected for editing
  useEffect(() => {
    if (selectedForEdit && rtStructures) {
      setIsContourEditMode(true);
    } else {
      setIsContourEditMode(false);
    }
  }, [selectedForEdit, rtStructures]);

  // Fetch series data for all studies
  const DERIVED_DESCRIPTION_KEYWORDS = useMemo(
    () => [
      'resampled',
      're-sampled',
      'fused',
      'fusion',
      'helper cache',
      'helper-cache',
      'fusion manifest',
      'qa fusion',
      'qcfx',
      'qgfx',
      'manifest overlay',
      'resample cache',
    ],
    [],
  );

  const DERIVED_UID_MARKERS = useMemo(
    () => ['.fused', '.fusion', '.resampled', '.resample', '_fused', '_fusion', '_resamp', '-fused', '-fusion'],
    [],
  );

  const shouldHideSeries = useCallback(
    (entry: any): boolean => {
      if (!entry) return true;
      const modality = (entry.modality || '').toUpperCase();

      if (['RTSTRUCT', 'RT', 'REG'].includes(modality)) {
        return false;
      }

      if (['DERIVED', 'SECONDARY', 'OT'].includes(modality)) {
        return true;
      }

      const metadata = (entry?.metadata ?? {}) as Record<string, any>;
      const description = (entry.seriesDescription || '').toLowerCase();
      const uid = (entry.seriesInstanceUID || '').toLowerCase();

      const derivedByKeywords = DERIVED_DESCRIPTION_KEYWORDS.some((keyword) => description.includes(keyword));
      const derivedByUid = DERIVED_UID_MARKERS.some((marker) => uid.includes(marker));
      const flaggedFusion = Boolean(metadata?.fusion);
      const fusionCandidateModality = ['PT', 'PET', 'MR', 'NM'].includes(modality);

      if (flaggedFusion && !fusionCandidateModality) {
        return true;
      }

      if ((derivedByKeywords || derivedByUid) && !fusionCandidateModality) {
        // Hide derived CT/resampled overlays, but keep PET/MR secondaries available.
        return true;
      }

      return false;
    },
    [DERIVED_DESCRIPTION_KEYWORDS, DERIVED_UID_MARKERS],
  );

  const { data: seriesData, isLoading } = useQuery({
    queryKey: ['/api/studies', studyData.studies?.map((s: any) => s.id), 'series'],
    queryFn: async () => {
      if (!studyData.studies || studyData.studies.length === 0) throw new Error('No studies');
      
      // Fetch series for all studies and combine them
      const allSeries = [] as any[];
      for (const study of studyData.studies) {
        const response = await fetch(`/api/studies/${study.id}/series`);
        if (!response.ok) {
          throw new Error(`Failed to fetch series for study ${study.id}: ${response.statusText}`);
        }
        const series = await response.json();
        const extractFoR = (input: unknown): string | null => {
          if (typeof input === 'string') {
            const trimmed = input.trim();
            return trimmed.length ? trimmed : null;
          }
          return null;
        };
        // Add study info to each series for reference
        allSeries.push(
          ...series.map((s: any) => {
            const foFromRoot = extractFoR(s?.frameOfReferenceUID ?? s?.frame_of_reference_uid);
            const foFromMetadata = extractFoR(s?.metadata?.frameOfReferenceUID ?? s?.metadata?.FrameOfReferenceUID ?? s?.metadata?.frame_of_reference_uid);
            return {
              ...s,
              studyId: study.id,
              studyDate: study.studyDate,
              frameOfReferenceUID: foFromRoot ?? foFromMetadata ?? null,
            };
          }),
        );
      }
      return allSeries;
    },
    enabled: !!studyData.studies?.length,
  });

  // Fetch REG associations for this patient and build primary->secondary mapping by series IDs
  const [regCtacIds, setRegCtacIds] = useState<number[]>([]);
  useEffect(() => {
    const loadAssociations = async () => {
      setAssociationsReady(false);
      setAssociationPrimarySeries(null);
      try {
        // Patient ID will be resolved later using more sophisticated logic
        if (!seriesData || !Array.isArray(seriesData) || seriesData.length === 0) return;

        const ensureString = (value: unknown): string | null => {
          if (typeof value !== 'string') return null;
          const trimmed = value.trim();
          return trimmed ? trimmed : null;
        };

        const normalizeSeriesId = (value: unknown): number | null => {
          if (value === null || value === undefined) return null;
          if (typeof value === 'number' && Number.isFinite(value)) return value;
          if (typeof value === 'bigint') {
            const asNumber = Number(value);
            return Number.isFinite(asNumber) ? asNumber : null;
          }
          if (typeof value === 'string') {
            const trimmed = value.trim();
            if (!trimmed) return null;
            const parsed = Number(trimmed);
            return Number.isFinite(parsed) ? parsed : null;
          }
          const parsed = Number(value);
          return Number.isFinite(parsed) ? parsed : null;
        };

        const normalizeSeriesIdArray = (values: unknown[]): number[] => {
          const ids: number[] = [];
          for (const value of values) {
            const id = normalizeSeriesId(value);
            if (id != null) ids.push(id);
          }
          return ids;
        };

        const normalizeSeriesDetail = (detail: any): RegistrationSeriesDetail | null => {
          if (!detail) return null;
          const id = normalizeSeriesId(detail.id ?? detail.seriesId ?? detail.series_id);
          const uid = ensureString(detail.uid ?? detail.seriesInstanceUID ?? detail.seriesInstanceUid);
          const description = ensureString(detail.description ?? detail.seriesDescription);
          const modality = ensureString(detail.modality);
          const studyId = normalizeSeriesId(detail.studyId ?? detail.study_id);
          const imageCountRaw = detail.imageCount ?? detail.instances ?? detail.image_count;
          const imageCountNumber = Number(imageCountRaw);
          const imageCount = Number.isFinite(imageCountNumber) ? imageCountNumber : null;
          if (id == null && !uid) return null;
          return {
            id,
            uid,
            description,
            modality,
            studyId,
            imageCount,
          };
        };

        const seriesEntries: [string, any][] = [];
        (seriesData as any[]).forEach(ser => {
          const uid = ensureString(ser.seriesInstanceUID ?? ser.seriesInstanceUid ?? ser.uid);
          if (uid) seriesEntries.push([uid, ser]);
        });
        const uidToSeries = new Map<string, any>(seriesEntries);

        const fromSeriesRecord = (ser: any): RegistrationSeriesDetail => ({
          id: normalizeSeriesId(ser.id),
          uid: ensureString(ser.seriesInstanceUID ?? ser.seriesInstanceUid ?? ser.uid),
          description: ensureString(ser.seriesDescription ?? ser.description),
          modality: ensureString(ser.modality),
          studyId: normalizeSeriesId(ser.studyId ?? ser.study_id),
          imageCount: Number.isFinite(Number(ser.imageCount)) ? Number(ser.imageCount) : null,
        });

        const resolveDetailById = (id: number | string | null | undefined): RegistrationSeriesDetail | null => {
          const normalizedId = normalizeSeriesId(id);
          if (normalizedId == null) return null;
          const ser = (seriesData as any[]).find(s => normalizeSeriesId(s.id) === normalizedId);
          if (!ser) return null;
          return { ...fromSeriesRecord(ser), id: normalizedId };
        };

        const resolveDetailByUid = (uid: string | null | undefined): RegistrationSeriesDetail | null => {
          const normalizedUid = ensureString(uid);
          if (!normalizedUid) return null;
          const ser = uidToSeries.get(normalizedUid);
          if (!ser) return null;
          return fromSeriesRecord(ser);
        };

        const resolveDetailFromAssociation = (detail: any): RegistrationSeriesDetail | null => {
          if (!detail) return null;
          const explicitId = normalizeSeriesId(detail.id ?? detail.seriesId ?? detail.series_id);
          if (explicitId != null) {
            const resolved = resolveDetailById(explicitId);
            if (resolved) return resolved;
          }
          const resolvedByUid = resolveDetailByUid(detail.uid ?? detail.seriesInstanceUID ?? detail.seriesInstanceUid);
          if (resolvedByUid) return resolvedByUid;
          const normalized = normalizeSeriesDetail(detail);
          if (!normalized) return null;
          if (normalized.id != null && !normalized.uid) {
            return {
              ...normalized,
              uid: resolveDetailById(normalized.id)?.uid ?? normalized.uid,
            };
          }
          return normalized;
        };

        const resolvePatientIdentifier = (): string | number | null => {
          const urlPatientId = typeof window !== 'undefined'
            ? ensureString(new URL(window.location.href).searchParams.get('patientId'))
            : null;
          if (urlPatientId) return urlPatientId;

          const patient = studyData?.patient;
          if (patient) {
            const dicomId = ensureString((patient as any).patientID ?? (patient as any).patientId);
            if (dicomId) return dicomId;
            if (Number.isFinite(patient.id)) return patient.id as number;
          }
          const studyWithPatientId = Array.isArray(studyData?.studies)
            ? studyData.studies.find((st: any) => Number.isFinite(st?.patientId))
            : null;
          if (studyWithPatientId && Number.isFinite(studyWithPatientId.patientId)) {
            return studyWithPatientId.patientId as number;
          }
          return null;
        };

        const patientIdentifier = resolvePatientIdentifier();

        // Try patient-wide first, then per-study if empty
        const tryFetch = async (url: string) => {
          try {
            const r = await fetch(url, { cache: 'no-store' });
            if (!r.ok) return { associations: [] as any[], ctacSeriesIds: [] as number[] };
            const j = await r.json();
            const assocs = Array.isArray(j?.associations) ? j.associations : [];
            const ctac = Array.isArray(j?.ctacSeriesIds) ? j.ctacSeriesIds : [];
            return { associations: assocs, ctacSeriesIds: ctac };
          } catch { return { associations: [] as any[], ctacSeriesIds: [] as number[] }; }
        };

        let result = patientIdentifier != null
          ? await tryFetch(`/api/registration/associations?patientId=${encodeURIComponent(String(patientIdentifier))}`)
          : { associations: [] as any[], ctacSeriesIds: [] as number[] };
        let associations = result.associations;
        const ctacUnion = new Set<number>();
        (result.ctacSeriesIds || []).forEach((id: unknown) => {
          const normalized = normalizeSeriesId(id);
          if (normalized != null) ctacUnion.add(normalized);
        });
        if (import.meta.env.DEV) {
          console.log('📎 Registration fetch context', {
            patientIdentifier,
            associationsFromPatient: associations.length,
            ctacCount: ctacUnion.size,
          });
        }
        if (!associations.length && Array.isArray(studyData?.studies)) {
          const results = await Promise.all(
            studyData.studies.map((st: any) => tryFetch(`/api/registration/associations?studyId=${st.id}`))
          );
          associations = results.flatMap(r => r.associations);
          results.forEach(r => (r.ctacSeriesIds || []).forEach((id: unknown) => {
            const normalized = normalizeSeriesId(id);
            if (normalized != null) ctacUnion.add(normalized);
          }));
        }
        const allowedFusionModalities = new Set(['CT', 'PT', 'PET', 'MR', 'NM']);
        const filterDetailsByModality = (details: (RegistrationSeriesDetail | null)[]) => {
          const unique = new Map<number, RegistrationSeriesDetail>();
          const filtered: RegistrationSeriesDetail[] = [];
          for (const detail of details) {
            if (!detail) continue;
            const modality = detail.modality ? detail.modality.toUpperCase() : '';
            if (!allowedFusionModalities.has(modality)) continue;
            const detailId = normalizeSeriesId(detail.id);
            if (detailId != null) {
              if (unique.has(detailId)) continue;
              const normalizedDetail = { ...detail, id: detailId };
              unique.set(detailId, normalizedDetail);
              filtered.push(normalizedDetail);
              continue;
            }
            filtered.push(detail);
          }
          return filtered;
        };

        const mapping: Record<number, number[]> = {};
        const associationMap = new Map<number, RegistrationAssociation[]>();
        for (const a of associations) {
          // Resolve target detail and ensure modality is eligible
          let primaryDetail: RegistrationSeriesDetail | null = null;
          if (a?.targetSeriesDetail) {
            primaryDetail = resolveDetailFromAssociation(a.targetSeriesDetail);
          }
          if (!primaryDetail) {
            primaryDetail = resolveDetailById(a?.targetSeriesId ?? null);
          }
          if (!primaryDetail && a?.target) {
            primaryDetail = resolveDetailByUid(a.target);
          }
          if (!primaryDetail) continue;
          const targetModality = primaryDetail.modality ? primaryDetail.modality.toUpperCase() : '';
          if (!allowedFusionModalities.has(targetModality)) continue;

          const primaryId = normalizeSeriesId(primaryDetail.id ?? a?.targetSeriesId ?? a?.targetSeriesDetail?.id);
          if (primaryId == null) continue;
          if (!primaryDetail.id || primaryDetail.id !== primaryId) {
            primaryDetail = { ...primaryDetail, id: primaryId };
          }

          let secondaryIds: number[] = Array.isArray(a?.sourcesSeriesIds)
            ? normalizeSeriesIdArray(a.sourcesSeriesIds)
            : [];

          let resolvedDetails: RegistrationSeriesDetail[] = [];
          if (Array.isArray(a?.sourceSeriesDetails) && a.sourceSeriesDetails.length) {
            resolvedDetails = a.sourceSeriesDetails
              .map((detail: any) => resolveDetailFromAssociation(detail))
              .filter((detail): detail is RegistrationSeriesDetail => !!detail);
            if (!secondaryIds.length) {
              secondaryIds = resolvedDetails
                .map(detail => normalizeSeriesId(detail.id))
                .filter((id): id is number => id != null);
            }
          }

          if (!resolvedDetails.length && Array.isArray(a?.sources)) {
            resolvedDetails = a.sources
              .map(uid => resolveDetailByUid(uid))
              .filter((detail): detail is RegistrationSeriesDetail => !!detail);
          }

          if (!secondaryIds.length) {
            secondaryIds = resolvedDetails
              .map(detail => normalizeSeriesId(detail.id))
              .filter((id): id is number => id != null);
          }

          if (!secondaryIds.length && Array.isArray(a?.siblingSeriesIds)) {
            secondaryIds = normalizeSeriesIdArray(a.siblingSeriesIds);
          }

          if (!resolvedDetails.length && secondaryIds.length) {
            resolvedDetails = secondaryIds
              .map(id => resolveDetailById(id))
              .filter((detail): detail is RegistrationSeriesDetail => !!detail);
          }

          if (import.meta.env.DEV) {
            console.log('🔍 Association candidate', {
              primaryId,
              targetDetail: primaryDetail,
              secondaryIdsInitial: secondaryIds.slice(),
              resolvedDetailsInitial: resolvedDetails,
              rawAssociation: a,
            });
          }

          const filteredDetails = filterDetailsByModality(resolvedDetails);
          const filteredIds = filteredDetails
            .map(detail => normalizeSeriesId(detail.id))
            .filter((id): id is number => id != null);

          const candidateIds = filteredIds.length ? filteredIds : secondaryIds;
          const detailsById = new Map<number, RegistrationSeriesDetail>();
          filteredDetails.forEach(detail => {
            const id = normalizeSeriesId(detail.id);
            if (id != null) detailsById.set(id, { ...detail, id });
          });
          resolvedDetails.forEach(detail => {
            const id = normalizeSeriesId(detail.id);
            if (id != null && !detailsById.has(id)) {
              detailsById.set(id, { ...detail, id });
            }
          });

          const validSecondaryIds: number[] = [];
          const validSecondaryDetails: RegistrationSeriesDetail[] = [];
          const seenSecondary = new Set<number>();

          for (const rawId of candidateIds) {
            const normalizedId = normalizeSeriesId(rawId);
            if (normalizedId == null) continue;
            if (seenSecondary.has(normalizedId)) continue;

            let detail = detailsById.get(normalizedId) ?? resolveDetailById(normalizedId);
            const seriesRecord = (seriesData as any[]).find(s => normalizeSeriesId(s.id) === normalizedId);
            const modality = ensureString(detail?.modality ?? seriesRecord?.modality)?.toUpperCase() ?? '';
            if (!allowedFusionModalities.has(modality)) continue;

            seenSecondary.add(normalizedId);
            validSecondaryIds.push(normalizedId);
            const hydratedDetail: RegistrationSeriesDetail = {
              id: normalizedId,
              uid: ensureString(detail?.uid ?? seriesRecord?.seriesInstanceUID ?? seriesRecord?.seriesInstanceUid) ?? null,
              description: ensureString(detail?.description ?? seriesRecord?.seriesDescription) ?? null,
              modality,
              studyId: normalizeSeriesId(detail?.studyId ?? seriesRecord?.studyId ?? seriesRecord?.study_id),
              imageCount: (() => {
                const raw = detail?.imageCount ?? seriesRecord?.imageCount;
                const parsed = Number(raw);
                return Number.isFinite(parsed) ? parsed : null;
              })(),
            };
            validSecondaryDetails.push(hydratedDetail);
          }

          if (import.meta.env.DEV) {
            console.log('🔍 Filtered association details', {
              primaryId,
              filteredIds,
              candidateIds,
              validSecondaryIds,
              validSecondaryDetails,
            });
          }

          if (!validSecondaryIds.length) continue;

          secondaryIds = validSecondaryIds;

          if (secondaryIds.length) {
            const prev = mapping[primaryId as number] || [];
            const combined = Array.from(new Set([...prev, ...secondaryIds]));
            mapping[primaryId as number] = combined;
          }

          const entry: RegistrationAssociation = {
            ...a,
            targetSeriesId: primaryId as number,
            targetSeriesDetail: primaryDetail,
            sourcesSeriesIds: secondaryIds,
            sourceSeriesDetails: validSecondaryDetails,
          };
          const existing = associationMap.get(primaryId as number) || [];
          existing.push(entry);
          associationMap.set(primaryId as number, existing);
        }

        if (import.meta.env.DEV) {
          console.log('📎 Registration mapping built', mapping, associationMap);
        }
        setRegAssociations(mapping);
        setRegistrationRelationshipMap(associationMap);
        setRegCtacIds(Array.from(ctacUnion));

        // Determine best primary candidate from associations
        if (Object.keys(mapping).length > 0) {
          const ptStudyIds = new Set<number>((seriesData as any[])
            .filter(s => (s.modality || '').toUpperCase() === 'PT')
            .map(s => s.studyId));

          const primaryIds = Object.keys(mapping).map(Number).sort((a, b) => (mapping[b]?.length || 0) - (mapping[a]?.length || 0));
          const preferred = primaryIds.find(pid => {
            const ser = (seriesData as any[]).find(s => s.id === pid);
            if (!ser) return false;
            const modality = (ser.modality || '').toUpperCase();
            if (modality !== 'CT') return false;
            // Prefer CT not in PT study and not marked CTAC by server
            if (ptStudyIds.has(ser.studyId)) return false;
            if (ctacUnion.has(ser.id)) return false;
            return true;
          });
          const chosenId = preferred ?? primaryIds[0];
          const chosen = (seriesData as any[]).find(s => s.id === chosenId) ?? null;
          if (chosen) {
            setAssociationPrimarySeries(chosen);
          }
        }
        setAssociationsReady(true);
      } catch {
        // Silent fail; allow fallback heuristics
        setAssociationsReady(true);
      }
    };
    loadAssociations();
  }, [studyData?.patient?.id, seriesData]);

  useEffect(() => {
    manifestInitRequestedRef.current = false;
    autoPrimarySelectedRef.current = false;
    setFallbackPrimarySeries(null);
    setAssociationPrimarySeries(null);
    setAssociationsReady(false);
    setManifestActionStatus(null);
  }, [studyData?.patient?.id]);

  const handleSeriesSelect = async (seriesData: DICOMSeries) => {
    try {
      // Fetch images for the selected series
      const response = await fetch(`/api/series/${seriesData.id}`);
      if (!response.ok) {
        throw new Error('Failed to fetch series images');
      }
      
      const seriesWithImages = await response.json();
      setSelectedSeries(seriesWithImages);
      
      // Apply default window/level if available from first image
      if (seriesWithImages.images?.length > 0) {
        const firstImage = seriesWithImages.images[0];
        if (firstImage.windowCenter && firstImage.windowWidth) {
          setWindowLevel({
            level: parseFloat(firstImage.windowCenter),
            window: parseFloat(firstImage.windowWidth)
          });
        }
      }
      
      // Auto-load most recent RT structure set if this is a CT series (primary series)
      if (seriesData.modality === 'CT' && !rtStructures) {
        try {
          console.log(`🔄 Auto-loading RT structures for CT series ${seriesData.id}...`);
          const rtResponse = await fetch(`/api/studies/${seriesData.studyId}/rt-structures`);
          if (rtResponse.ok) {
            const rtSeries = await rtResponse.json();
            if (rtSeries && rtSeries.length > 0) {
              // Find the most recent RT structure (by date or series number)
              const mostRecentRT = rtSeries.reduce((latest: any, current: any) => {
                // Prefer by series date/time first, then by series number
                const latestDate = latest.seriesDate || latest.createdAt || '';
                const currentDate = current.seriesDate || current.createdAt || '';
                
                if (currentDate > latestDate) return current;
                if (currentDate === latestDate && (current.seriesNumber || 0) > (latest.seriesNumber || 0)) return current;
                return latest;
              });
              
              console.log(`🔄 Auto-loading most recent RT structure (ID: ${mostRecentRT.id}) for primary CT`);
              
              // Load the RT structure contours
              const contourResponse = await fetch(`/api/rt-structures/${mostRecentRT.id}/contours`);
              if (contourResponse.ok) {
                const rtStructData = await contourResponse.json();
                handleRTStructureLoad(rtStructData);
                
                // Notify parent about loaded RT series for selection state
                if (onLoadedRTSeriesChange) {
                  onLoadedRTSeriesChange(mostRecentRT.id);
                }
                
                console.log(`✅ Auto-loaded RT structures with ${rtStructData.structures.length} ROIs`);
              }
            }
          } else {
            console.log('No RT structures available for this CT study');
          }
        } catch (rtError) {
          console.log('No RT structures found for auto-loading:', rtError);
          // Don't throw error - RT structures are optional
        }
      }

      await initializeFusionForSeries(seriesData);
      
    } catch (error) {
      log.error(`Error selecting series: ${String(error)}`, 'viewer-interface');
      setError({
        title: 'Error Loading Series',
        message: 'Failed to load the selected series.',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  };

  const handleZoomIn = () => {
    try {
      if ((window as any).currentViewerZoom?.zoomIn) {
        (window as any).currentViewerZoom.zoomIn();
      }
    } catch (error) {
      log.warn(`Error zooming in: ${String(error)}`, 'viewer-interface');
    }
  };

  const handleZoomOut = () => {
    try {
      if ((window as any).currentViewerZoom?.zoomOut) {
        (window as any).currentViewerZoom.zoomOut();
      }
    } catch (error) {
      log.warn(`Error zooming out: ${String(error)}`, 'viewer-interface');
    }
  };

  const handleResetZoom = () => {
    try {
      if ((window as any).currentViewerZoom?.resetZoom) {
        (window as any).currentViewerZoom.resetZoom();
      }
    } catch (error) {
      log.warn(`Error resetting zoom: ${String(error)}`, 'viewer-interface');
    }
  };

  const setActiveTool = (toolName: string) => {
    try {
      const cornerstoneTools = cornerstoneConfig.getCornerstoneTools();
      const elements = document.querySelectorAll('.cornerstone-viewport');
      
      elements.forEach((element: any) => {
        if (element) {
          cornerstoneTools.setToolActiveForElement(element, toolName, { mouseButtonMask: 1 });
        }
      });
    } catch (error) {
      log.warn(`Error setting active tool: ${String(error)}`, 'viewer-interface');
    }
  };

  const handlePanTool = () => {
    if (workingViewerRef.current?.setPanMode) {
      workingViewerRef.current.setPanMode();
      setActiveToolMode('pan');
    }
  };
  
  const handleMeasureTool = () => {
    setActiveTool('Length');
    setActiveToolMode('measure');
  };
  const handleAnnotateTool = () => setActiveTool('ArrowAnnotate');
  
  const handleCrosshairsTool = () => {
    if (workingViewerRef.current?.setCrosshairMode) {
      workingViewerRef.current.setCrosshairMode();
      setActiveToolMode('crosshairs');
    }
  };

  const handleRotate = () => {
    try {
      if (!window.cornerstone) {
        log.warn('Cornerstone not available for rotation','viewer-interface');
        return;
      }
      const cornerstone = window.cornerstone;
      const elements = document.querySelectorAll('.cornerstone-viewport');
      
      elements.forEach((element: any) => {
        if (element) {
          const viewport = cornerstone.getViewport(element);
          if (viewport) {
            viewport.rotation += 90;
            cornerstone.setViewport(element, viewport);
          }
        }
      });
    } catch (error) {
      console.warn('Error rotating image:', error);
    }
  };

  const handleFlip = () => {
    try {
      if (!window.cornerstone) {
        console.warn('Cornerstone not available for flip');
        return;
      }
      const cornerstone = window.cornerstone;
      const elements = document.querySelectorAll('.cornerstone-viewport');
      
      elements.forEach((element: any) => {
        if (element) {
          const viewport = cornerstone.getViewport(element);
          if (viewport) {
            viewport.hflip = !viewport.hflip;
            cornerstone.setViewport(element, viewport);
          }
        }
      });
    } catch (error) {
      log.warn(`Error flipping image: ${String(error)}`, 'viewer-interface');
    }
  };

  const handleRTStructureLoad = (rtStructData: any) => {
    log.debug('Loading RT structures', 'viewer-interface');
    setRTStructures(rtStructData);
    // Initialize visibility for all structures
    const visibilityMap = new Map();
    rtStructData.structures.forEach((structure: any) => {
      visibilityMap.set(structure.roiNumber, true);
    });
    setStructureVisibility(visibilityMap);
  };
  
  const handleRTSeriesSelect = async (rtSeries: any) => {
    try {
      console.log('Auto-loading RT structures for series:', rtSeries.id);
      
      // Track which RT series is loaded
      setLoadedRTSeriesId(rtSeries.id);
      
      // Load RT structure contours
      const response = await fetch(`/api/rt-structures/${rtSeries.id}/contours`);
      if (response.ok) {
        const rtStructData = await response.json();
        log.debug('RT structures loaded successfully', 'viewer-interface');
        handleRTStructureLoad(rtStructData);
      } else {
        log.error(`Failed to load RT structures: ${response.status}`, 'viewer-interface');
      }
    } catch (error) {
      log.error(`Error loading RT structure contours: ${String(error)}`, 'viewer-interface');
    }
  };

  const handleStructureSelection = (structureId: number, selected: boolean) => {
    log.debug(`handleStructureSelection: ${structureId} -> ${selected}`, 'viewer-interface');
    
    const newSelection = new Set(selectedStructures);
    if (selected) {
      newSelection.add(structureId);
    } else {
      newSelection.delete(structureId);
    }
    setSelectedStructures(newSelection);
    
    log.debug(`Updated selectedStructures: ${Array.from(newSelection).join(',')}`, 'viewer-interface');
    
    // Update selected structure colors for viewer border
    if (rtStructures?.structures) {
      const colors = Array.from(newSelection).map(id => {
        const structure = rtStructures.structures.find((s: any) => s.roiNumber === id);
        return structure ? `rgb(${structure.color.join(',')})` : '';
      }).filter(Boolean);
      setSelectedStructureColors(colors);
    }
  };

  const handleStructureVisibilityChange = (structureId: number, visible: boolean) => {
    log.debug(`handleStructureVisibilityChange: ${structureId} -> ${visible}`, 'viewer-interface');
    
    setStructureVisibility(prev => {
      const next = new Map(prev);
      next.set(structureId, visible);
      console.log('Updated structureVisibility map:', Array.from(next.entries()));
      return next;
    });
  };

  const handleAllStructuresVisibilityChange = (allVisible: boolean) => {
    setAllStructuresVisible(allVisible);
  };

  const handleStructureColorChange = (structureId: number, color: [number, number, number]) => {
    if (rtStructures) {
      const updatedStructures = { ...rtStructures };
      const structure = updatedStructures.structures.find((s: any) => s.roiNumber === structureId);
      if (structure) {
        structure.color = color;
        setRTStructures(updatedStructures);
      }
    }
  };

  const getDefaultFusionWindow = useCallback((modality?: string | null) => {
    const mode = (modality || '').toUpperCase();
    switch (mode) {
      case 'MR':
        return { window: 80, level: 40 };
      case 'PT':
      case 'PET':
        return { window: 5, level: 2.5 };
      case 'CT':
        return { window: 400, level: 40 };
      default:
        return null;
    }
  }, []);

  const resetFusionState = useCallback((options?: { clearCache?: boolean; primarySeriesId?: number | null }) => {
    const { clearCache = false, primarySeriesId = null } = options ?? {};
    if (clearCache) {
      try {
        if (primarySeriesId != null) {
          clearFusionCaches(primarySeriesId);
        } else {
          clearFusionCaches();
        }
      } catch {}
    }
    setFusionManifest(null);
    setFusionManifestError(null);
    setFusionManifestLoading(false);
    setSecondarySeriesId(null);
    setShowFusionPanel(false);
    setSecondaryLoadingStates(new Map());
    setCurrentlyLoadingSecondary(null);
    setFusionWindowLevel(null);
  }, []);

  const fusionDescriptorMap = useMemo(() => {
    const map = new Map<number, FusionSecondaryDescriptor>();
    if (fusionManifest?.secondaries?.length) {
      fusionManifest.secondaries.forEach((secondary) => {
        map.set(secondary.secondarySeriesId, secondary);
      });
    }
    return map;
  }, [fusionManifest]);

  const fusionSecondaryStatuses = useMemo(() => {
    const map = new Map<number, { status: 'idle' | 'loading' | 'ready' | 'error'; error?: string | null }>();
    fusionDescriptorMap.forEach((secondary) => {
      const loadingState = secondaryLoadingStates.get(secondary.secondarySeriesId);
      if (loadingState?.isLoading) {
        map.set(secondary.secondarySeriesId, { status: 'loading' });
      } else if (secondary.status === 'error') {
        map.set(secondary.secondarySeriesId, { status: 'error', error: secondary.error ?? null });
      } else if (secondary.status === 'ready') {
        map.set(secondary.secondarySeriesId, { status: 'ready' });
      } else if (secondary.status === 'generating' || secondary.status === 'pending') {
        map.set(secondary.secondarySeriesId, { status: 'loading' });
      } else {
        map.set(secondary.secondarySeriesId, { status: 'idle' });
      }
    });
    return map;
  }, [fusionDescriptorMap, secondaryLoadingStates]);

  const seriesById = useMemo(() => {
    const map = new Map<number, DICOMSeries>();
    series.forEach((entry) => {
      if (!entry) return;
      const parsedId = Number(entry.id);
      if (Number.isFinite(parsedId)) {
        map.set(parsedId, entry);
      }
    });
    return map;
  }, [series]);

  const visibleSeriesIdSet = useMemo(() => {
    const set = new Set<number>();
    visibleSeries.forEach((entry) => {
      if (!entry) return;
      const parsedId = Number(entry.id);
      if (Number.isFinite(parsedId)) {
        set.add(parsedId);
      }
    });
    return set;
  }, [visibleSeries]);

  const seriesByFoR = useMemo(() => {
    const map = new Map<string, number[]>();
    const sanitizeFo = (value: unknown): string | null => {
      if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed.length ? trimmed : null;
      }
      return null;
    };

    visibleSeries.forEach((entry) => {
      if (!entry) return;
      const id = Number(entry.id);
      if (!Number.isFinite(id)) return;
      const fo = sanitizeFo(entry.frameOfReferenceUID ?? (entry as any)?.metadata?.frameOfReferenceUID);
      if (!fo) return;
      const list = map.get(fo) ?? [];
      list.push(id);
      map.set(fo, list);
    });

    return map;
  }, [visibleSeries]);

  const getNumericPatientId = useCallback((): number | null => {
    const patientRecord = studyData?.patient;
    if (patientRecord && Number.isFinite(patientRecord.id)) {
      return Number(patientRecord.id);
    }
    if (Array.isArray(studyData?.studies)) {
      for (const study of studyData.studies) {
        if (study && Number.isFinite(study.patientId)) {
          return Number(study.patientId);
        }
      }
    }
    return null;
  }, [studyData]);

  const runManifestForPatient = useCallback(async (patientId: number): Promise<void> => {
    if (!Number.isFinite(patientId)) return;

    if (manifestPrimedPatientsRef.current.has(patientId)) {
      const existingTask = manifestPrimingTasksRef.current.get(patientId);
      if (existingTask) {
        await existingTask.catch(() => undefined);
      }
      return;
    }

    const inFlight = manifestPrimingTasksRef.current.get(patientId);
    if (inFlight) {
      await inFlight.catch(() => undefined);
      return;
    }

    const task = (async () => {
      try {
        const response = await fetch(`/api/patients/${patientId}/fusion/run-manifest`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ includeReady: false }),
        });
        if (!response.ok) {
          const detail = await response.text().catch(() => '');
          throw new Error(detail || `Manifest run failed (${response.status})`);
        }
        manifestPrimedPatientsRef.current.add(patientId);
      } finally {
        manifestPrimingTasksRef.current.delete(patientId);
      }
    })();

    manifestPrimingTasksRef.current.set(patientId, task);
    try {
      await task;
    } catch (error) {
      console.error('Fusion manifest prime failed', error);
      throw error;
    }
  }, []);

  const getCandidateSecondaryIds = useCallback(
    (primarySeriesId: number): number[] => {
      const normalizeSeriesId = (value: unknown): number | null => {
        if (value === null || value === undefined) return null;
        if (typeof value === 'number' && Number.isFinite(value)) return value;
        if (typeof value === 'bigint') {
          const asNumber = Number(value);
          return Number.isFinite(asNumber) ? asNumber : null;
        }
        if (typeof value === 'string') {
          const trimmed = value.trim();
          if (!trimmed) return null;
          const parsed = Number(trimmed);
          return Number.isFinite(parsed) ? parsed : null;
        }
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
      };

      const allowedModalities = new Set(['CT', 'PT', 'PET', 'MR', 'NM']);

      const shouldIncludeSeries = (seriesId: number): boolean => {
        if (seriesId === primarySeriesId) return false;
        const entry = seriesById.get(seriesId);
        if (!entry) return false;
        if (shouldHideSeries(entry)) return false;
        const modality = (entry.modality || '').toUpperCase();
        return allowedModalities.has(modality);
      };

      const enqueueNeighbor = (
        neighborId: number | null,
        queue: number[],
        visited: Set<number>,
        results: Set<number>,
      ) => {
        if (neighborId == null) return;
        if (!Number.isFinite(neighborId)) return;
        const id = Number(neighborId);
        if (shouldIncludeSeries(id)) {
          results.add(id);
        }
        if (!visited.has(id)) {
          visited.add(id);
          queue.push(id);
        }
      };

      const visited = new Set<number>([primarySeriesId]);
      const results = new Set<number>();
      const queue: number[] = [primarySeriesId];

      while (queue.length) {
        const current = queue.shift()!;

        const direct = regAssociations?.[current] ?? [];
        direct.forEach((neighbor) => {
          enqueueNeighbor(normalizeSeriesId(neighbor), queue, visited, results);
        });

        const relations = registrationRelationshipMap.get(current) ?? [];
        relations.forEach((assoc) => {
          const neighborIds = new Set<number>();
          const targetId = normalizeSeriesId(assoc.targetSeriesId);
          if (targetId != null && targetId !== current) neighborIds.add(targetId);
          if (Array.isArray(assoc.sourcesSeriesIds)) {
            assoc.sourcesSeriesIds.forEach((id) => {
              const normalized = normalizeSeriesId(id);
              if (normalized != null) neighborIds.add(normalized);
            });
          }
          if (Array.isArray(assoc.siblingSeriesIds)) {
            assoc.siblingSeriesIds.forEach((id) => {
              const normalized = normalizeSeriesId(id);
              if (normalized != null) neighborIds.add(normalized);
            });
          }
          neighborIds.forEach((id) => enqueueNeighbor(id, queue, visited, results));
        });
      }

      const candidateIds = Array.from(results.values()).filter((id) => shouldIncludeSeries(id));
      if (import.meta.env.DEV) {
        log.debug(
          `Fusion candidates for primary ${primarySeriesId} (patient ${studyData?.patient?.id ?? 'unknown'}): ${candidateIds.join(', ')}`,
          'viewer-interface',
        );
      }
      return candidateIds;
    },
    [
      regAssociations,
      registrationRelationshipMap,
      seriesById,
      visibleSeriesIdSet,
      shouldHideSeries,
      studyData?.patient?.id,
    ],
  );

  const fusionCandidatesByPrimary = useMemo(() => {
    const map = new Map<number, number[]>();
    series.forEach((entry) => {
      if (!entry) return;
      const parsedId = Number(entry.id);
      if (!Number.isFinite(parsedId)) return;
      map.set(parsedId, getCandidateSecondaryIds(parsedId));
    });
    if (fusionManifest?.primarySeriesId && fusionManifest.secondaries?.length) {
      map.set(
        fusionManifest.primarySeriesId,
        fusionManifest.secondaries
          .map((secondary) => secondary.secondarySeriesId)
          .filter((id): id is number => typeof id === 'number' && Number.isFinite(id)),
      );
    }
    return map;
  }, [series, getCandidateSecondaryIds, fusionManifest]);

  useEffect(() => {
    if (typeof window === 'undefined' || !import.meta.env.DEV) return;
    (window as any).__fusionCandidates = Array.from(
      fusionCandidatesByPrimary.entries(),
    ).map(([primaryId, candidateIds]) => ({ primaryId, candidateIds }));
  }, [fusionCandidatesByPrimary]);

  useEffect(() => {
    if (typeof window === 'undefined' || !import.meta.env.DEV) return;
    (window as any).__currentFusionManifest = fusionManifest;
  }, [fusionManifest]);

  useEffect(() => {
    if (!manifestInitRequestedRef.current) return;
    if (fusionManifestLoading) {
      setManifestActionStatus((prev) => prev ?? 'Preparing fusion cache…');
    } else if (fusionManifest && manifestActionStatus === 'Preparing fusion cache…') {
      setManifestActionStatus(null);
    }
  }, [fusionManifestLoading, fusionManifest, manifestActionStatus]);

  const fusionSiblingMap = useMemo(() => {
    const normalizeSeriesIdLocal = (value: unknown): number | null => {
      if (value === null || value === undefined) return null;
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      if (typeof value === 'bigint') {
        const asNumber = Number(value);
        return Number.isFinite(asNumber) ? asNumber : null;
      }
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return null;
        const parsed = Number(trimmed);
        return Number.isFinite(parsed) ? parsed : null;
      }
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    };

    const modalityOf = (id: number | null): string => {
      if (id == null) return '';
      const entry = seriesById.get(id);
      return (entry?.modality || '').toUpperCase();
    };

    const map = new Map<number, Map<'PET' | 'MR', Map<number, number[]>>>();

    registrationRelationshipMap.forEach((associations, primaryId) => {
      const petMapping = new Map<number, Set<number>>();
      const mrMapping = new Map<number, Set<number>>();

      (associations ?? []).forEach((assoc) => {
        const petIds = new Set<number>();
        const ctIds = new Set<number>();
        const mrIds = new Set<number>();

        const registerByModality = (rawId: unknown, modality: string | null | undefined) => {
          const normalizedId = normalizeSeriesIdLocal(rawId);
          if (normalizedId == null || normalizedId === primaryId) return;
          const resolvedModality = (modality || modalityOf(normalizedId)).toUpperCase();
          if (!resolvedModality) return;
          if (!visibleSeriesIdSet.has(normalizedId)) return;
          if (resolvedModality === 'CT') {
            ctIds.add(normalizedId);
          } else if (resolvedModality === 'PT' || resolvedModality === 'PET' || resolvedModality === 'NM') {
            petIds.add(normalizedId);
          } else if (resolvedModality === 'MR') {
            mrIds.add(normalizedId);
          }
        };

        if (Array.isArray(assoc.sourceSeriesDetails)) {
          assoc.sourceSeriesDetails.forEach((detail) => {
            registerByModality(detail?.id, detail?.modality);
          });
        }

        if (Array.isArray(assoc.sourcesSeriesIds)) {
          assoc.sourcesSeriesIds.forEach((value) => {
            registerByModality(value, null);
          });
        }

        if (Array.isArray(assoc.siblingSeriesIds)) {
          assoc.siblingSeriesIds.forEach((value) => {
            registerByModality(value, null);
          });
        }

        if (petIds.size) {
          petIds.forEach((petId) => {
            const entry = petMapping.get(petId) ?? new Set<number>();
            ctIds.forEach((ctId) => entry.add(ctId));
            petMapping.set(petId, entry);
          });
        }

        if (mrIds.size) {
          mrIds.forEach((mrId) => {
            const entry = mrMapping.get(mrId) ?? new Set<number>();
            // MR siblings may include other MR series within same FoR or PET-driven MR matches
            mrIds.forEach((otherMrId) => {
              if (otherMrId !== mrId) entry.add(otherMrId);
            });
            // also allow CT siblings when PET present
            if (petIds.size) {
              ctIds.forEach((ctId) => entry.add(ctId));
            }
            mrMapping.set(mrId, entry);
          });
        }
      });

      const primaryEntry = seriesById.get(primaryId);
      const primaryFoR = typeof primaryEntry?.frameOfReferenceUID === 'string' ? primaryEntry.frameOfReferenceUID.trim() : '';
      if (primaryFoR) {
        const foMatches = seriesByFoR.get(primaryFoR) ?? [];
        const ctFoRIds = new Set<number>();
        ctFoRIds.add(primaryId);
        const petFoRIds = new Set<number>();
        const mrFoRIds = new Set<number>();

        foMatches.forEach((secondaryId) => {
          if (secondaryId === primaryId) return;
          if (!visibleSeriesIdSet.has(secondaryId)) return;
          const entry = seriesById.get(secondaryId);
          if (!entry) return;
          const modality = (entry.modality || '').toUpperCase();
          if (modality === 'CT') {
            ctFoRIds.add(secondaryId);
          } else if (['PT', 'PET', 'NM'].includes(modality)) {
            petFoRIds.add(secondaryId);
          } else if (modality === 'MR') {
            mrFoRIds.add(secondaryId);
          }
        });

        if (petFoRIds.size) {
          if (!ctFoRIds.size) {
            ctFoRIds.add(primaryId);
          }
          petFoRIds.forEach((petId) => {
            const entry = petMapping.get(petId) ?? new Set<number>();
            ctFoRIds.forEach((ctId) => entry.add(ctId));
            petMapping.set(petId, entry);
          });
        }

        if (mrFoRIds.size) {
          mrFoRIds.forEach((mrId) => {
            const entry = mrMapping.get(mrId) ?? new Set<number>();
            mrFoRIds.forEach((otherMrId) => {
              if (otherMrId !== mrId) entry.add(otherMrId);
            });
            entry.add(primaryId);
            petFoRIds.forEach((petId) => entry.add(petId));
            mrMapping.set(mrId, entry);
          });
        }
      }

      if (petMapping.size || mrMapping.size) {
        const forPrimary = new Map<'PET' | 'MR', Map<number, number[]>>();
        if (petMapping.size) {
          const petArrayMap = new Map<number, number[]>();
          petMapping.forEach((set, petId) => {
            petArrayMap.set(petId, Array.from(set.values()));
          });
          forPrimary.set('PET', petArrayMap);
        }
        if (mrMapping.size) {
          const mrArrayMap = new Map<number, number[]>();
          mrMapping.forEach((set, mrId) => {
            mrArrayMap.set(mrId, Array.from(set.values()));
          });
          forPrimary.set('MR', mrArrayMap);
        }
        map.set(primaryId, forPrimary);
      }
    });

    return map;
  }, [registrationRelationshipMap, seriesById, seriesByFoR, visibleSeriesIdSet]);

  useEffect(() => {
    if (import.meta.env.DEV) {
      const entries = Array.from(fusionCandidatesByPrimary.entries()).map(([primaryId, ids]) => ({
        primaryId,
        candidateIds: ids,
      }));
      console.debug('Fusion candidate map', entries);
    }
  }, [fusionCandidatesByPrimary]);

  useEffect(() => {
    if (import.meta.env.DEV) {
      const modalities = visibleSeries.map((entry) => ({
        id: entry.id,
        modality: entry.modality,
        description: entry.seriesDescription,
      }));
      console.debug('Visible series after derived filter', modalities);
    }
  }, [visibleSeries]);

  useEffect(() => {
    if (!fusionDescriptorMap.size || secondarySeriesId == null) {
      return;
    }
    const descriptor = fusionDescriptorMap.get(secondarySeriesId);
    if (!descriptor) return;
    const defaultWindow = getDefaultFusionWindow(descriptor.secondaryModality);
    setFusionWindowLevel(defaultWindow);
  }, [fusionManifest, secondarySeriesId, getDefaultFusionWindow]);

  useEffect(() => {
    if (secondarySeriesId == null) {
      setFusionWindowLevel(null);
    }
  }, [secondarySeriesId]);

  useEffect(() => {
    if (secondarySeriesId == null) return;
    const status = fusionSecondaryStatuses.get(secondarySeriesId);
    if (status?.status === 'error') {
      setSecondarySeriesId(null);
    }
  }, [secondarySeriesId, fusionSecondaryStatuses]);

  const preloadAllFusionSecondaries = useCallback(
    async (primarySeriesId: number, manifest: FusionManifest, requestToken: number) => {
      const readySecondaries = manifest.secondaries.filter((sec) => sec.status === 'ready');
      if (!readySecondaries.length) {
        setSecondaryLoadingStates(new Map());
        setCurrentlyLoadingSecondary(null);
        return;
      }

      const loadingMap = new Map<number, { progress: number; isLoading: boolean }>();
      readySecondaries.forEach((sec) => {
        loadingMap.set(sec.secondarySeriesId, { progress: 0, isLoading: true });
      });
      setSecondaryLoadingStates(loadingMap);

      for (const secondary of readySecondaries) {
        if (fusionManifestRequestRef.current !== requestToken) break;
        setCurrentlyLoadingSecondary(secondary.secondarySeriesId);
        try {
          await preloadFusionSecondary(primarySeriesId, secondary.secondarySeriesId, ({ completed, total }) => {
            if (fusionManifestRequestRef.current !== requestToken) return;
            setSecondaryLoadingStates((prev) => {
              const next = new Map(prev);
              const fraction = total ? (completed / total) * 100 : 100;
              next.set(secondary.secondarySeriesId, { isLoading: true, progress: fraction });
              return next;
            });
          });
          if (fusionManifestRequestRef.current !== requestToken) break;
          setSecondaryLoadingStates((prev) => {
            const next = new Map(prev);
            next.set(secondary.secondarySeriesId, { isLoading: false, progress: 100 });
            return next;
          });
        } catch (error: any) {
          if (fusionManifestRequestRef.current !== requestToken) break;
          console.error('Fusion preload failed', error);
          setFusionManifestError(error?.message || String(error));
          setSecondaryLoadingStates((prev) => {
            const next = new Map(prev);
            next.set(secondary.secondarySeriesId, { isLoading: false, progress: 0 });
            return next;
          });
        }
      }

      if (fusionManifestRequestRef.current === requestToken) {
        setCurrentlyLoadingSecondary(null);
      }
    },
    [],
  );

  const pollFusionManifestUntilReady = useCallback(
    async (
      primarySeriesId: number,
      candidateSecondaryIds: number[],
      requestToken: number,
      attempt: number = 0,
    ): Promise<FusionManifest | null> => {
      if (fusionManifestRequestRef.current !== requestToken) return null;
      const MAX_ATTEMPTS = 8;
      if (attempt >= MAX_ATTEMPTS) {
        return null;
      }

      const delayMs = Math.min(4000, 500 * Math.pow(2, attempt));
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      if (fusionManifestRequestRef.current !== requestToken) return null;

      try {
        const refreshed = await fetchFusionManifest(primarySeriesId, {
          preload: true,
          secondarySeriesIds: candidateSecondaryIds,
          force: true,
        });
        if (fusionManifestRequestRef.current !== requestToken) return null;
        setFusionManifest(refreshed);
        const relevantIds = candidateSecondaryIds.length ? new Set(candidateSecondaryIds) : null;
        const pending = refreshed.secondaries.filter((sec) => {
          if (sec.status === 'ready' || sec.status === 'error') return false;
          if (relevantIds && !relevantIds.has(sec.secondarySeriesId)) return false;
          return true;
        });
        if (pending.length) {
          return pollFusionManifestUntilReady(primarySeriesId, candidateSecondaryIds, requestToken, attempt + 1);
        }
        return refreshed;
      } catch (error) {
        console.error('Failed to refresh fusion manifest', error);
        return null;
      }
    },
    [],
  );

  const initializeFusionForSeries = useCallback(
    async (seriesEntry: DICOMSeries | null) => {
      const requestToken = ++fusionManifestRequestRef.current;
      if (!seriesEntry) {
        resetFusionState({ clearCache: true });
        return;
      }

      const modality = (seriesEntry.modality || '').toUpperCase();
      if (modality !== 'CT') {
        resetFusionState({ clearCache: true, primarySeriesId: seriesEntry.id });
        return;
      }

      const cachedManifest = getFusionManifest(seriesEntry.id);
      resetFusionState({ clearCache: !cachedManifest, primarySeriesId: seriesEntry.id });
      setFusionManifestError(null);

      if (cachedManifest && fusionManifestRequestRef.current === requestToken) {
        setFusionManifest(cachedManifest);
      }

      setFusionManifestLoading(true);

      try {
        const patientId = getNumericPatientId();
        const candidateSecondaryIds = getCandidateSecondaryIds(seriesEntry.id);
        if (!cachedManifest && patientId != null) {
          try {
            await runManifestForPatient(patientId);
          } catch (error) {
            console.error('Fusion manifest pre-run failed', error);
          }
        }
        let manifest = await fetchFusionManifest(seriesEntry.id, {
          preload: true,
          secondarySeriesIds: candidateSecondaryIds,
          force: !cachedManifest,
        });
        if (fusionManifestRequestRef.current !== requestToken) return;
        setFusionManifest(manifest);

        if (!manifest.secondaries.length) {
          setShowFusionPanel(false);
          setSecondarySeriesId(null);
          setSecondaryLoadingStates(new Map());
          return;
        }

        const relevantIds = candidateSecondaryIds.length
          ? candidateSecondaryIds
          : manifest.secondaries.map((sec) => sec.secondarySeriesId);
        const pending = manifest.secondaries.filter(
          (sec) =>
            relevantIds.includes(sec.secondarySeriesId) &&
            sec.status !== 'ready' &&
            sec.status !== 'error',
        );

        if (pending.length) {
          const refreshed = await pollFusionManifestUntilReady(seriesEntry.id, relevantIds, requestToken);
          if (fusionManifestRequestRef.current !== requestToken) return;
          if (refreshed) {
            manifest = refreshed;
          }
        }

        if (fusionManifestRequestRef.current !== requestToken) return;

        const pendingAfterPoll = manifest.secondaries.some(
          (sec) =>
            relevantIds.includes(sec.secondarySeriesId) &&
            sec.status !== 'ready' &&
            sec.status !== 'error',
        );
        if (pendingAfterPoll) {
          setFusionManifestError((prev) => prev ?? 'Fusion cache is still generating. Please retry shortly.');
        }

        // Keep any user selection; panel will reflect actual readiness via badges
        setShowFusionPanel(true);

        await preloadAllFusionSecondaries(seriesEntry.id, manifest, requestToken);

        // Auto-select a READY secondary once preload completes, gated by the active token
        if (fusionManifestRequestRef.current === requestToken) {
          try {
            // Prefer secondaries marked 'ready' in the manifest
            const readyIds = manifest.secondaries
              .filter((sec) => sec.status === 'ready')
              .map((sec) => sec.secondarySeriesId);

            // Fall back: intersect with currently allowed descriptors if available
            // Note: fusionDescriptorMap is derived via useMemo and may not be updated synchronously here,
            // so prefer manifest readiness as the primary signal.
            const candidate = readyIds[0] ?? null;

            if (candidate != null) {
              setSecondarySeriesId(candidate);
            }
          } catch {}
        }
      } catch (error: any) {
        if (fusionManifestRequestRef.current !== requestToken) return;
        console.error('Failed to initialize fusion manifest', error);
        setFusionManifest(null);
        setFusionManifestError(error?.message || String(error));
        setShowFusionPanel(false);
        setSecondarySeriesId(null);
      } finally {
        if (fusionManifestRequestRef.current === requestToken) {
          setFusionManifestLoading(false);
        }
      }
    },
    [
      getCandidateSecondaryIds,
      getNumericPatientId,
      pollFusionManifestUntilReady,
      preloadAllFusionSecondaries,
      resetFusionState,
      runManifestForPatient,
    ],
  );

  const maybeStartInitialManifest = useCallback(() => {
    if (manifestInitRequestedRef.current) return false;
    if (!associationsReady) return false;
    const candidate = associationPrimarySeries ?? fallbackPrimarySeries;
    if (!candidate) return false;

    manifestInitRequestedRef.current = true;
    setManifestActionStatus('Preparing fusion cache…');
    initializeFusionForSeries(candidate).catch((error) => {
      console.error('Initial fusion manifest initialization failed', error);
      setManifestActionStatus(`Fusion manifest failed: ${error instanceof Error ? error.message : String(error)}`);
    });
    return true;
  }, [associationsReady, associationPrimarySeries, fallbackPrimarySeries, initializeFusionForSeries]);

  useEffect(() => {
    maybeStartInitialManifest();
  }, [associationsReady, maybeStartInitialManifest]);

  useEffect(() => {
    if (!seriesData || !Array.isArray(seriesData)) return;
    setSeries(seriesData);
    setVisibleSeries(seriesData.filter((entry) => !shouldHideSeries(entry)));

    if (!selectedSeries && seriesData.length > 0) {
      const ctSeries = seriesData.filter((s) => s.modality === 'CT' && !shouldHideSeries(s));
      if (ctSeries.length > 0) {
        const scoreCT = (ct: any) => {
          let score = 0;
          score += Math.min(200, (ct.imageCount || 0));
          const desc = (ct.seriesDescription || '').toLowerCase();
          if (desc.includes('planning') || desc.includes('plan')) score += 100;
          if (desc.includes('ctac')) score -= 200;
          return score;
        };

        const bestCT = [...ctSeries].sort((a, b) => scoreCT(b) - scoreCT(a))[0] ?? null;
        setFallbackPrimarySeries(bestCT ?? null);
        if (bestCT && associationsReady) {
          maybeStartInitialManifest();
        }
      }
    }
  }, [seriesData, selectedSeries, shouldHideSeries, associationsReady, maybeStartInitialManifest]);

  // Prevent manifest init deathloops by gating on candidate set changes and a short cooldown
  const prevCandidateKeyRef = useRef<string | null>(null);
  const lastInitAtRef = useRef<number>(0);

  useEffect(() => {
    if (!selectedSeries) return;
    const modality = (selectedSeries.modality || '').toUpperCase();
    if (modality !== 'CT') return;
    if (fusionManifestLoading) return;

    const candidateSecondaryIds = getCandidateSecondaryIds(selectedSeries.id);
    const manifestMatchesSeries = fusionManifest?.primarySeriesId === selectedSeries.id;
    const manifestIds = manifestMatchesSeries ? new Set(fusionManifest.secondaries.map((sec) => sec.secondarySeriesId)) : null;
    const hasMissing = manifestIds ? candidateSecondaryIds.some((id) => !manifestIds.has(id)) : candidateSecondaryIds.length > 0;

    // Build a stable key for current candidates
    const candidateKey = candidateSecondaryIds.slice().sort((a, b) => a - b).join(',');
    const unchangedCandidates = prevCandidateKeyRef.current === candidateKey;
    const withinCooldown = Date.now() - lastInitAtRef.current < 5000; // 5s cooldown

    // Only (re)initialize if:
    // - manifest is for a different series, or
    // - there are genuinely new candidates not in the current manifest
    // And avoid tight loops when candidates/associations flicker
    if (!manifestMatchesSeries || hasMissing) {
      if (unchangedCandidates && withinCooldown) return;
      prevCandidateKeyRef.current = candidateKey;
      lastInitAtRef.current = Date.now();
      initializeFusionForSeries(selectedSeries);
    }
  }, [getCandidateSecondaryIds, regAssociations, selectedSeries, fusionManifest, fusionManifestLoading, initializeFusionForSeries]);

  useEffect(() => {
    if (!fusionManifest || !fusionManifest.primarySeriesId) return;
    if (autoPrimarySelectedRef.current) return;

    const primaryId = fusionManifest.primarySeriesId;
    const primaryEntry = series.find((entry) => Number(entry.id) === Number(primaryId));
    if (!primaryEntry) return;

    autoPrimarySelectedRef.current = true;
    console.log(`🎯 Manifest-selected planning CT ${primaryEntry.seriesDescription || primaryEntry.id} (ID: ${primaryEntry.id})`);
    handleSeriesSelect(primaryEntry).catch((error) => {
      console.warn('Failed to load manifest-selected primary series', error);
    });
  }, [fusionManifest, series, handleSeriesSelect]);

  useEffect(() => {
    if (!manifestInitRequestedRef.current) return;
    if (fusionManifest || fusionManifestLoading) return;
    if (!fusionManifestError) return;
    if (autoPrimarySelectedRef.current) return;

    const fallback = fallbackPrimarySeries;
    if (fallback) {
      autoPrimarySelectedRef.current = true;
      console.warn('Fusion manifest failed; falling back to heuristic primary selection');
      handleSeriesSelect(fallback).catch((error) => {
        console.warn('Failed to load fallback primary series', error);
      });
    }
  }, [fusionManifest, fusionManifestError, fusionManifestLoading, fallbackPrimarySeries, handleSeriesSelect]);

  const handleContourUpdate = (payload: any) => {
    console.log('Contour update received:', payload);
    
    // Check if this is an action payload from ContourEditToolbar or full structures from WorkingViewer
    if (payload && payload.action) {
      // This is an action payload from ContourEditToolbar
      // Pass it directly to WorkingViewer's handleContourUpdate
      console.log(`Received action: ${payload.action} for structure ${payload.structureId}`);
      if (workingViewerRef.current && workingViewerRef.current.handleContourUpdate) {
        workingViewerRef.current.handleContourUpdate(payload);
      }
      return;
    }
    
    // This is the full updated RT structures from WorkingViewer after processing
    if (payload && payload.structures) {
      setRTStructures(payload);
    }
  };

  // Undo/Redo handlers for bottom toolbar
  const handleGlobalUndo = () => {
    const prev = undoRedoManager.undo();
    if (prev) {
      setRTStructures(prev.rtStructures);
    }
  };

  const handleGlobalRedo = () => {
    const next = undoRedoManager.redo();
    if (next) {
      setRTStructures(next.rtStructures);
    }
  };

  const handleJumpToHistory = (index: number) => {
    const state = undoRedoManager.jumpTo(index);
    if (state) {
      setRTStructures(state.rtStructures);
    }
  };

  const triggerFusionDebug = useCallback(() => {
    try {
      workingViewerRef.current?.openFusionDebug?.('manual');
    } catch (error) {
      console.warn('Unable to open fusion debug panel', error);
    }
  }, []);

  const captureFusionDebug = useCallback(() => {
    try {
      const payload = (window as any)?.__fusion;
      if (!payload) {
        setFusionDebugSnapshot('window.__fusion is empty');
        return;
      }
      setFusionDebugSnapshot(JSON.stringify(payload, null, 2));
    } catch (error: any) {
      setFusionDebugSnapshot(`Failed to read window.__fusion: ${error?.message || String(error)}`);
    }
  }, []);

  const handleRebuildManifest = useCallback(async () => {
    if (!selectedSeries) {
      setManifestActionStatus('Select a primary series first.');
      return;
    }

    setManifestActionStatus('Rebuilding manifest…');
    setFusionDebugSnapshot(null);

    try {
      const response = await fetch(
        `/api/fusion/manifest?primarySeriesId=${selectedSeries.id}&force=true&preload=true`,
        { cache: 'no-store' },
      );

      let payload: any = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }

      if (!response.ok) {
        const message = payload?.error || payload?.details || response.statusText;
        setManifestActionStatus(`Manifest rebuild failed: ${message}`);
        if (payload) setFusionDebugSnapshot(JSON.stringify(payload, null, 2));
        return;
      }

      setManifestActionStatus(`Manifest rebuilt at ${new Date().toLocaleTimeString()}`);
      if (payload) setFusionDebugSnapshot(JSON.stringify(payload, null, 2));

      await initializeFusionForSeries(selectedSeries);
    } catch (error: any) {
      setManifestActionStatus(`Manifest rebuild threw: ${error?.message || String(error)}`);
    }
  }, [initializeFusionForSeries, selectedSeries]);

  // Subscribe to undo manager changes to refresh toolbar state
  const [historyState, setHistoryState] = useState({
    canUndo: false,
    canRedo: false,
    items: [] as Array<{ timestamp: number; action: string; structureId: number }>,
    index: -1
  });

  useEffect(() => {
    const update = () => {
      try {
        setHistoryState({
          canUndo: undoRedoManager.canUndo(),
          canRedo: undoRedoManager.canRedo(),
          items: undoRedoManager.getHistory().map(h => ({ timestamp: h.timestamp, action: h.action, structureId: h.structureId })),
          index: undoRedoManager.getCurrentIndex()
        });
      } catch {}
    };
    update();
    const unsubscribe = undoRedoManager.subscribe(update);
    return () => unsubscribe();
  }, [selectedSeries?.id]);

  // Auto-zoom functionality based on structure bounds
  const getStructureBounds = (structure: any) => {
    let xMin = Infinity, xMax = -Infinity;
    let yMin = Infinity, yMax = -Infinity;
    let zSum = 0, xSum = 0, ySum = 0, n = 0;

    for (const contour of structure.contours) {
      for (let i = 0; i < contour.points.length; i += 3) {
        const x = contour.points[i];
        const y = contour.points[i + 1];
        const z = contour.points[i + 2];
        xMin = Math.min(xMin, x);
        xMax = Math.max(xMax, x);
        yMin = Math.min(yMin, y);
        yMax = Math.max(yMax, y);
        xSum += x;
        ySum += y;
        zSum += z;
        n++;
      }
    }

    return {
      centroid: { x: xSum / n, y: ySum / n, z: zSum / n },
      widthMM: xMax - xMin,
      heightMM: yMax - yMin
    };
  };

  const getAutoZoomForBounds = (widthMM: number, heightMM: number, canvasWidth: number, canvasHeight: number, pixelSpacing: [number, number]) => {
    const fillFactor = 0.4; // target % of canvas to fill
    const targetPixelWidth = canvasWidth * fillFactor;
    const targetPixelHeight = canvasHeight * fillFactor;

    const widthInPixels = widthMM / pixelSpacing[0];
    const heightInPixels = heightMM / pixelSpacing[1];

    const zoomX = targetPixelWidth / widthInPixels;
    const zoomY = targetPixelHeight / heightInPixels;

    return Math.min(zoomX, zoomY, 5); // cap max zoom at 5x
  };

  // Auto-zoom effect disabled per user request
  // useEffect(() => {
  //   if (!selectedForEdit || !rtStructures?.structures) return;

  //   const structure = rtStructures.structures.find((s: any) => s.roiNumber === selectedForEdit);
  //   if (!structure || !structure.contours || structure.contours.length === 0) return;

  //   try {
  //     const { centroid, widthMM, heightMM } = getStructureBounds(structure);
      
  //     // Only auto-zoom if we have valid bounds
  //     if (isFinite(widthMM) && isFinite(heightMM) && widthMM > 0 && heightMM > 0) {
  //       console.log(`Auto-zooming to structure ${structure.structureName}: ${widthMM.toFixed(1)}mm x ${heightMM.toFixed(1)}mm`);
        
  //       // Focus on the structure's centroid slice
  //       const newSlice = Math.round(centroid.z);
        
  //       // For now, we'll just log the auto-zoom intent
  //       // The actual zoom/pan implementation would need to be integrated 
  //       // with the WorkingViewer component's zoom and pan state
  //       console.log(`Centering on slice ${newSlice}, structure centroid:`, centroid);
  //       console.log(`Recommended zoom for structure size: ${widthMM.toFixed(1)}mm x ${heightMM.toFixed(1)}mm`);
  //     }
  //   } catch (error) {
  //     console.warn('Error calculating auto-zoom for structure:', error);
  //   }
  // }, [selectedForEdit, rtStructures]);

  // Handle structure localization
  const handleStructureLocalization = useCallback((structureId: number) => {
    if (!rtStructures?.structures || !workingViewerRef.current) {
      log.warn('🎯 Cannot localize: missing structures or viewer ref', 'viewer-interface');
      return;
    }

    const structure = rtStructures.structures.find((s: any) => s.roiNumber === structureId);
    if (!structure || !structure.contours || structure.contours.length === 0) {
      console.warn(`🎯 Cannot localize: structure ${structureId} not found or has no contours`);
      return;
    }

    console.log(`🎯 Localizing to structure "${structure.structureName}"...`);

    // Calculate structure bounds and centroid
    let minZ = Infinity, maxZ = -Infinity;
    let totalX = 0, totalY = 0, totalZ = 0, totalPoints = 0;
    
    structure.contours.forEach((contour: any) => {
      if (contour.points && contour.points.length >= 6) {
        // Track Z bounds for finding middle slice
        if (contour.slicePosition !== undefined) {
          minZ = Math.min(minZ, contour.slicePosition);
          maxZ = Math.max(maxZ, contour.slicePosition);
        }
        
        // Calculate centroid
        for (let i = 0; i < contour.points.length; i += 3) {
          totalX += contour.points[i];
          totalY += contour.points[i + 1];
          totalZ += contour.points[i + 2];
          totalPoints++;
        }
      }
    });
    
    if (totalPoints === 0) {
      console.warn(`🎯 Cannot localize: structure ${structureId} has no valid points`);
      return;
    }

    // Calculate centroid
    const centroidX = totalX / totalPoints;
    const centroidY = totalY / totalPoints;
    const centroidZ = totalZ / totalPoints;
    
    // Use middle Z slice if we have slice position bounds, otherwise use centroid Z
    const targetZ = (minZ !== Infinity && maxZ !== -Infinity) ? (minZ + maxZ) / 2 : centroidZ;
    
    console.log(`🎯 Localizing to "${structure.structureName}":`, {
      centroid: `(${centroidX.toFixed(1)}, ${centroidY.toFixed(1)}, ${centroidZ.toFixed(1)})`,
      sliceBounds: minZ !== Infinity ? `${minZ.toFixed(1)} to ${maxZ.toFixed(1)}` : 'unknown',
      targetZ: targetZ.toFixed(1)
    });
    
    // Navigate to the structure by finding the closest slice
    if (workingViewerRef.current && workingViewerRef.current.navigateToSlice) {
      workingViewerRef.current.navigateToSlice(targetZ);
    } else {
      console.warn('🎯 WorkingViewer navigateToSlice method not available');
    }
    
    console.log(`🎯 ✅ Localization completed for "${structure.structureName}"`);
  }, [rtStructures, workingViewerRef]);

  // Handle localization button toggle
  const handleLocalizationToggle = useCallback(() => {
    const newState = !showLocalizationTool;
    setShowLocalizationTool(newState);
    
    if (newState) {
      console.log('🎯 Localization mode ACTIVATED - click any structure to navigate to its center');
    } else {
      console.log('🎯 Localization mode DEACTIVATED');
    }
  }, [showLocalizationTool]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <div className="w-8 h-8 border border-dicom-yellow border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-dicom-yellow">Loading study...</p>
        </div>
      </div>
    );
  }

  if (fusionManifestLoading && !selectedSeries) {
    return (
      <div className="flex h-96 flex-col items-center justify-center gap-3 text-slate-200">
        <div className="w-10 h-10 border border-cyan-400 border-t-transparent rounded-full animate-spin" />
        <div className="text-sm font-medium text-cyan-200">Preparing fusion cache…</div>
        <div className="text-xs text-slate-400">Please wait while the manifest is generated.</div>
      </div>
    );
  }

  return (
    <>
      {import.meta.env.DEV && (
        <div className="fixed top-2 left-1/2 z-50 flex -translate-x-1/2 transform flex-wrap items-center gap-2 rounded-lg border border-slate-700/70 bg-slate-950/95 px-4 py-2 text-[11px] text-slate-200 shadow-lg shadow-black/40 backdrop-blur">
          <div className="flex flex-col gap-0.5 pr-2">
            <span className="font-semibold text-slate-100">Fusion Debug</span>
            <span>Primary: {selectedSeries ? `${selectedSeries.id}` : '—'}</span>
            <span>Secondary: {secondarySeriesId ?? '—'}</span>
            <span>Status: {manifestActionStatus ?? 'idle'}</span>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={handleRebuildManifest}>
              Rebuild Manifest
            </Button>
            <Button size="sm" variant="secondary" onClick={captureFusionDebug}>
              Capture Debug
            </Button>
            <Button size="sm" variant="secondary" onClick={triggerFusionDebug}>
              Open Viewer Debug
            </Button>
          </div>
        </div>
      )}

      {import.meta.env.DEV && fusionDebugSnapshot && (
        <div className="fixed top-20 right-4 z-40 max-h-80 w-[420px] overflow-y-auto rounded-lg border border-slate-700/60 bg-slate-950/95 p-3 text-[11px] text-slate-200 shadow-xl shadow-black/50 backdrop-blur">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-semibold">Captured Debug Snapshot</span>
            <Button size="sm" variant="ghost" onClick={() => setFusionDebugSnapshot(null)}>
              Dismiss
            </Button>
          </div>
          <pre className="max-h-64 whitespace-pre-wrap break-all text-[10px] leading-snug">
            {fusionDebugSnapshot}
          </pre>
        </div>
      )}

      <div className="animate-in fade-in-50 duration-500">
      <div className="flex gap-4" style={{ height: 'calc(100vh - 8rem)' }}>
        
        {/* Series Selector - Responsive Width */}
        <div className="w-full md:w-96 h-full overflow-hidden flex-shrink-0 hidden md:block">
          <SeriesSelector
            series={visibleSeries}
            selectedSeries={selectedSeries}
            onSeriesSelect={handleSeriesSelect}
            windowLevel={windowLevel}
            onWindowLevelChange={setWindowLevel}
            studyId={studyData.studies[0]?.id}
            studyIds={studyData.studies.map((s: any) => s.id)}
            regAssociations={regAssociations}
            regCtacSeriesIds={regCtacIds}
            rtStructures={rtStructures}
            onRTStructureLoad={handleRTStructureLoad}
            onStructureVisibilityChange={handleStructureVisibilityChange}
            onStructureColorChange={handleStructureColorChange}
            onStructureSelection={handleStructureSelection}
            selectedForEdit={selectedForEdit}
            onSelectedForEditChange={(structureId) => {
              setSelectedForEdit(structureId);
              
              // If localization mode is active, auto-navigate to the selected structure
              if (showLocalizationTool && structureId && rtStructures?.structures) {
                handleStructureLocalization(structureId);
              }
            }}
            onContourSettingsChange={onContourSettingsChange}
            onAutoZoom={(zoom) => {
              // Set auto-zoom level for WorkingViewer
              setAutoZoomLevel(zoom);
              // Clear after a short delay to allow component to react
              setTimeout(() => setAutoZoomLevel(undefined), 100);
            }}
            onAutoLocalize={(x, y, z) => {
              // Set auto-localize target for WorkingViewer
              setAutoLocalizeTarget({ x, y, z });
              // Clear after a short delay to allow component to react
              setTimeout(() => setAutoLocalizeTarget(undefined), 100);
            }}
            secondarySeriesId={secondarySeriesId}
            onSecondarySeriesSelect={setSecondarySeriesId}
            preventRTLoading={false}
            onAllStructuresVisibilityChange={handleAllStructuresVisibilityChange}
            // Pass localization mode to highlight when active
            localizationMode={showLocalizationTool}
            // Pass preview state for highlighting
            previewStructureInfo={previewStructureInfo}
            // Pass highlighted structures for boolean operations
            highlightedStructures={highlightedStructures}
            loadedRTSeriesId={loadedRTSeriesId}
            secondaryLoadingStates={secondaryLoadingStates}
            currentlyLoadingSecondary={currentlyLoadingSecondary}
            fusionStatuses={fusionSecondaryStatuses}
            fusionCandidatesByPrimary={fusionCandidatesByPrimary}
            fusionSiblingMap={fusionSiblingMap}
            fusionManifest={fusionManifest}
          />
        </div>

        {/* DICOM Viewer with Dynamic Border - Flexible Width */}
        <div className="flex-1 relative overflow-hidden">
          {selectedSeries ? (
            <div className="relative h-full overflow-hidden">
              {/* Dynamic Border Based on Selected Structures */}
              <div 
                className="absolute inset-0 rounded-lg pointer-events-none"
                style={{
                  border: selectedStructureColors.length > 0 
                    ? `3px solid ${selectedStructureColors[0]}` 
                    : '1px solid #374151',
                  zIndex: 1
                }}
              />
              
              {/* Multi-color border effect for multiple selections */}
              {selectedStructureColors.length > 1 && (
                <div className="absolute inset-0 rounded-lg pointer-events-none" style={{ zIndex: 1 }}>
                  {selectedStructureColors.map((color, index) => (
                    <div
                      key={index}
                      className="absolute inset-0 rounded-lg"
                      style={{
                        border: `3px solid ${color}`,
                        transform: `scale(${1 - (index * 0.02)})`,
                        opacity: 0.8 - (index * 0.2)
                      }}
                    />
                  ))}
                </div>
              )}
              
              {/* Main Viewer - always single view; MPR shown as floating windows */}
                <WorkingViewer 
                  ref={workingViewerRef}
                  seriesId={selectedSeries.id}
                  studyId={selectedSeries.studyId ?? studyData.studies[0]?.id}
                  windowLevel={windowLevel}
                  onWindowLevelChange={setWindowLevel}
                  rtStructures={rtStructures}
                  structureVisibility={structureVisibility}
                  brushToolState={brushToolState}
                  selectedForEdit={selectedForEdit}
                  selectedStructures={selectedStructures}
                  onBrushSizeChange={(size) => {
                    setBrushToolState(prev => ({ ...prev, brushSize: size }));
                    try {
                      const evt = new CustomEvent('brush:size:update', { detail: { brushSize: size } });
                      window.dispatchEvent(evt);
                    } catch {}
                  }}
                  onContourUpdate={handleContourUpdate}
                  onSlicePositionChange={setCurrentSlicePosition}
                  contourSettings={contourSettings}
                  autoZoomLevel={autoZoomLevel}
                  autoLocalizeTarget={autoLocalizeTarget}
                  secondarySeriesId={secondarySeriesId}
                  fusionOpacity={fusionOpacity}
                  onSecondarySeriesSelect={setSecondarySeriesId}
                  onFusionOpacityChange={setFusionOpacity}
                  hasSecondarySeriesForFusion={fusionDescriptorMap.size > 0}
                  onImageMetadataChange={setImageMetadata}
                  allStructuresVisible={allStructuresVisible}
                  imageCache={imageCache}
                  onMPRToggle={() => setMprVisible(!mprVisible)}
                  isMPRVisible={mprVisible}
                  // Mirror associations from Series panel: restrict Fusion choices
                  allowedSecondaryIds={Array.from(fusionDescriptorMap.keys())}
                  registrationAssociations={registrationRelationshipMap}
                  availableSeries={series}
                  fusionWindowLevel={fusionWindowLevel}
                  fusionSecondaryStatuses={fusionSecondaryStatuses}
                  fusionManifestLoading={fusionManifestLoading}
                  fusionManifestPrimarySeriesId={fusionManifest?.primarySeriesId ?? null}
                />
              
              {/* Structure Tags on Right Side - Responsive */}
              {selectedStructures.size > 0 && rtStructures?.structures && (
                <div className="absolute right-2 sm:right-4 top-2 sm:top-4 space-y-2 z-10 max-h-[calc(100vh-12rem)] overflow-y-auto">
                  <div className="space-y-2 max-w-[200px] sm:max-w-[250px]">
                    {Array.from(selectedStructures).map(structureId => {
                      const structure = rtStructures.structures.find((s: any) => s.roiNumber === structureId);
                      if (!structure) return null;
                      
                      return (
                        <div 
                          key={structureId}
                          className="flex items-center space-x-2 bg-black/80 backdrop-blur-sm rounded-lg px-2 sm:px-3 py-1.5 sm:py-2 border"
                          style={{ borderColor: `rgb(${structure.color.join(',')})` }}
                        >
                          <div 
                            className="w-2.5 sm:w-3 h-2.5 sm:h-3 rounded-full border border-gray-400 flex-shrink-0"
                            style={{ backgroundColor: `rgb(${structure.color.join(',')})` }}
                          />
                          <span className="text-xs sm:text-sm text-white font-medium truncate">
                            {structure.structureName}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="h-full flex items-center justify-center bg-black border border-indigo-800 rounded-lg">
              <p className="text-indigo-400">Select a series to view DICOM images</p>
            </div>
          )}
        </div>
      </div>

      {/* Floating Toolbar */}
      {selectedSeries && (
        <ViewerToolbar
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onFitToWindow={handleResetZoom}
          onPan={handlePanTool}
          onMeasure={handleMeasureTool}
          onCrosshairs={handleCrosshairsTool}
          onContourEdit={() => {
            // Close boolean operations toolbar when opening contour edit
            setShowBooleanOperations(false);
            // Close margin toolbar when opening contour edit
            setShowMarginToolbar(false);
            
            // If no structure is selected, select the first one or last loaded
            if (!selectedForEdit && rtStructures?.structures && rtStructures.structures.length > 0) {
              // Try to get the last loaded structure or default to first
              const lastStructure = rtStructures.structures[rtStructures.structures.length - 1];
              setSelectedForEdit(lastStructure.roiNumber);
            }
            
            setIsContourEditMode(true);
          }}
          onContourOperations={() => {
            // Close contour edit toolbar when opening boolean operations
            setIsContourEditMode(false);
            // Close margin toolbar when opening boolean operations
            setShowMarginToolbar(false);
            setShowBooleanOperations(true);
          }}
          onAdvancedMarginTool={() => {
            // Close contour edit toolbar when opening margin toolbar
            setIsContourEditMode(false);
            // Close boolean operations toolbar when opening margin toolbar
            setShowBooleanOperations(false);
            setShowMarginToolbar(true);
          }}
          onMPRToggle={() => setMprVisible(!mprVisible)}
          isMPRActive={mprVisible}
          isPanActive={activeToolMode === 'pan'}
          isCrosshairsActive={activeToolMode === 'crosshairs'}
          isMeasureActive={activeToolMode === 'measure'}
          isContourEditActive={isContourEditMode}
          isContourOperationsActive={showBooleanOperations}
          isAdvancedMarginToolActive={showMarginToolbar}
          onLocalization={handleLocalizationToggle}
          isLocalizationActive={showLocalizationTool}
          className="toolbar-custom"
          onUndo={handleGlobalUndo}
          onRedo={handleGlobalRedo}
          canUndo={undoRedoManager.canUndo()}
          canRedo={undoRedoManager.canRedo()}
          historyItems={undoRedoManager.getHistory().map(h => ({ timestamp: h.timestamp, action: h.action, structureId: h.structureId }))}
          currentHistoryIndex={undoRedoManager.getCurrentIndex()}
          onSelectHistory={handleJumpToHistory}
        />
      )}

      {/* Contour Edit Toolbar and Fusion Control are handled inside WorkingViewer */}

      {/* Contour Edit Toolbar */}
      {selectedForEdit && rtStructures && rtStructures.structures && !showBooleanOperations && !showMarginToolbar && (
        <ContourEditToolbar
          selectedStructure={rtStructures.structures.find((s: any) => s.roiNumber === selectedForEdit)}
          isVisible={isContourEditMode}
          onClose={() => {
            setIsContourEditMode(false);
            setSelectedForEdit(null);
          }}
          onStructureNameChange={(name: string) => {
            // Update structure name locally so UI reflects immediately
            if (!rtStructures || !selectedForEdit) return;
            setRTStructures((prev: any) => {
              if (!prev?.structures) return prev;
              const updated = structuredClone ? structuredClone(prev) : JSON.parse(JSON.stringify(prev));
              const s = updated.structures.find((x: any) => x.roiNumber === selectedForEdit);
              if (s) s.structureName = name;
              return updated;
            });
          }}
          onStructureColorChange={(color: string) => {
            // Update structure color locally so UI reflects immediately
            if (!rtStructures || !selectedForEdit) return;
            const hex = color.replace('#', '');
            const r = parseInt(hex.substring(0, 2), 16);
            const g = parseInt(hex.substring(2, 4), 16);
            const b = parseInt(hex.substring(4, 6), 16);
            const rgb: [number, number, number] = [
              Number.isFinite(r) ? r : 255,
              Number.isFinite(g) ? g : 255,
              Number.isFinite(b) ? b : 255,
            ];
            setRTStructures((prev: any) => {
              if (!prev?.structures) return prev;
              const updated = structuredClone ? structuredClone(prev) : JSON.parse(JSON.stringify(prev));
              const s = updated.structures.find((x: any) => x.roiNumber === selectedForEdit);
              if (s) s.color = rgb;
              return updated;
            });
            // Also refresh the selected border colors if this structure is selected
            setSelectedStructureColors((prevColors: string[]) => {
              if (!selectedStructures.has(selectedForEdit)) return prevColors;
              const next = Array.from(selectedStructures).map(id => {
                const st = (rtStructures?.structures || []).find((x: any) => x.roiNumber === id);
                const use = id === selectedForEdit ? rgb : st?.color;
                return use ? `rgb(${use.join(',')})` : '';
              }).filter(Boolean);
              return next;
            });
          }}
          onToolChange={(toolState) => {
            setBrushToolState({
              ...brushToolState,
              ...toolState,
              predictionEnabled: toolState.predictionEnabled ?? brushToolState.predictionEnabled
            });
          }}
          currentSlicePosition={currentSlicePosition}
          onContourUpdate={handleContourUpdate}
          availableStructures={rtStructures.structures}
          onTargetStructureSelect={(structureId) => {
            // Handle target structure selection for boolean operations
            console.log('Target structure selected:', structureId);
          }}
          seriesId={selectedSeries?.id}
          imageMetadata={imageMetadata}
          onOpenBooleanOperations={() => {
            setIsContourEditMode(false);
            setShowMarginToolbar(false);
            setShowBooleanOperations(true);
          }}
          onOpenAdvancedMarginTool={() => {
            setIsContourEditMode(false);
            setShowBooleanOperations(false);
            setShowMarginToolbar(true);
          }}

        />
      )}

      {/* Boolean Operations Toolbar (integrated panel mode toggle inside) */}
      {showBooleanOperations && !showMarginToolbar && (
        <BooleanOperationsToolbar
          isVisible={showBooleanOperations}
          onClose={() => {
            setShowBooleanOperations(false);
            setPreviewStructureInfo(null);
            // Clear preview contours when closing
            if (workingViewerRef.current) {
              workingViewerRef.current.handleContourUpdate({ action: 'clear_preview' });
            }
          }}
          availableStructures={rtStructures?.structures?.map((s: any) => s.structureName) || []}
            structures={rtStructures?.structures}
            grid={{
              xSize: imageMetadata?.columns || 512,
              ySize: imageMetadata?.rows || 512,
              zSize: Math.max(1, Math.round((selectedSeries?.images?.length || 1))),
              xRes: imageMetadata?.pixelSpacing?.[0] || 1,
              yRes: imageMetadata?.pixelSpacing?.[1] || 1,
              zRes: imageMetadata?.sliceThickness || 1,
              origin: { x: 0, y: 0, z: 0 }
            } as any}
            structureColors={(rtStructures?.structures || []).reduce((acc: Record<string, string>, s: any) => {
              if (s?.structureName && Array.isArray(s?.color)) {
                acc[s.structureName] = `rgb(${s.color.join(',')})`;
              }
              return acc;
            }, {})}
            onPreview={(target, contours) => {
              // Handle preview by updating working viewer with preview contours
              if (workingViewerRef.current && contours.length > 0) {
                // Show preview contours in yellow
                const previewContoursForViewer = contours.map((c: any) => ({
                  slicePosition: c.slicePosition,
                  points: c.points,
                  numberOfPoints: c.numberOfPoints,
                  color: [255, 223, 0] // Yellow for preview
                }));
                workingViewerRef.current.setPreviewContours?.(previewContoursForViewer);
              } else if (workingViewerRef.current) {
                // Clear preview if no contours
                workingViewerRef.current.setPreviewContours?.([]);
              }
            }}
            onPreviewStateChange={(previewInfo) => {
              setPreviewStructureInfo(previewInfo.targetName ? previewInfo : null);
              if (!previewInfo.targetName && workingViewerRef.current) {
                // Clear preview when state is cleared
                workingViewerRef.current.setPreviewContours?.([]);
              }
            }}
            onHighlightStructures={(inputs, output) => {
              setHighlightedStructures({ inputs, output });
            }}
            onApply={(target, contours) => {
              if (!rtStructures?.structures) return;
              const updated = structuredClone ? structuredClone(rtStructures) : JSON.parse(JSON.stringify(rtStructures));
              let targetStruct = updated.structures.find((s: any) => s.structureName?.toLowerCase() === (target.name || '').toLowerCase());
              if (!targetStruct) {
                const maxRoi = Math.max(0, ...updated.structures.map((s: any) => s.roiNumber || 0));
                targetStruct = {
                  roiNumber: maxRoi + 1,
                  structureName: target.name,
                  color: target.color || [0, 255, 0],
                  contours: []
                };
                updated.structures.push(targetStruct);
              } else if (target.color) {
                targetStruct.color = target.color;
              }
              // Clear and replace contours to reflect new boolean result
              targetStruct.contours = Array.isArray(contours) ? contours : [];
              // Ensure visibility on
              setStructureVisibility(prev => {
                const next = new Map(prev);
                next.set(targetStruct.roiNumber, true);
                return next;
              });
              setRTStructures(updated);
              handleContourUpdate(updated);
              setShowBooleanOperations(false);
              setPreviewStructureInfo(null);
              // Clear preview contours after applying
              if (workingViewerRef.current) {
                workingViewerRef.current.setPreviewContours?.([]);
              }
            }}
            onExecuteOperation={async (expression, newStructure) => {
              try {
                if (!rtStructures?.structures) {
                  console.warn('No RT structures loaded');
                  return;
                }
              
              const structuresByName: Record<string, any> = {};
              for (const s of rtStructures.structures) {
                structuresByName[s.structureName.toLowerCase()] = s;
              }

              // Tokenize expression
              const raw = expression.trim();
              const tokens: string[] = (raw.match(/[A-Za-z][A-Za-z0-9_#-]*|[∪∩⊕\-()=]/g) || []) as string[];
              let outputName: string | null = null;
              let rhsTokens = tokens;
              const eqIndex = tokens.indexOf('=');
              if (eqIndex > -1) {
                // Preserve original LHS label including spaces
                const rawEqIndex = raw.indexOf('=');
                const lhsLabel = raw.slice(0, rawEqIndex).trim();
                outputName = lhsLabel || null;
                rhsTokens = tokens.slice(eqIndex + 1);
              }

              // Shunting-yard to RPN
              const precedence: Record<string, number> = { '∪': 1, '∩': 1, '⊕': 1, '-': 1 };
              const isOp = (t: string) => Object.prototype.hasOwnProperty.call(precedence, t);
              const output: string[] = [];
              const ops: string[] = [];
              for (const t of rhsTokens) {
                if (/^[A-Za-z][A-Za-z0-9_#-]*$/.test(t)) {
                  output.push(t);
                } else if (isOp(t)) {
                  while (ops.length && isOp(ops[ops.length - 1]) && precedence[ops[ops.length - 1]] >= precedence[t]) {
                    output.push(ops.pop() as string);
                  }
                  ops.push(t);
                } else if (t === '(') {
                  ops.push(t);
                } else if (t === ')') {
                  while (ops.length && ops[ops.length - 1] !== '(') output.push(ops.pop() as string);
                  ops.pop();
                }
              }
              while (ops.length) output.push(ops.pop() as string);

              // Helpers to get slice maps for a structure name
              const SLICE_TOL = 1.0; // mm tolerance for aligning slice positions
              type SliceMap = Map<number, number[][]>; // slice -> list of contours

              const getSliceMapForStructure = (name: string): SliceMap => {
                const s = structuresByName[name.toLowerCase()];
                const map: SliceMap = new Map();
                if (!s?.contours) return map;
                for (const c of s.contours) {
                  if (!c?.points || c.points.length < 9 || typeof c.slicePosition !== 'number') continue;
                  // Find an existing bucket within tolerance, otherwise create a new one
                  let bucketKey: number | null = null;
                  for (const existingKey of Array.from(map.keys())) {
                    if (Math.abs(existingKey - c.slicePosition) <= SLICE_TOL) {
                      bucketKey = existingKey;
                      break;
                    }
                  }
                  const key = bucketKey !== null ? bucketKey : c.slicePosition;
                  const arr = map.get(key) || [];
                  arr.push(c.points);
                  map.set(key, arr);
                }
                return map;
              };

              // Merge multiple contours into one set by union folding
              const { combineContours, subtractContours, intersectContours, xorContours } = await import('@/lib/clipper-boolean-operations');
              const unionReduce = async (contours: number[][]): Promise<number[][]> => {
                if (contours.length <= 1) return contours;
                let acc: number[][] = [contours[0]];
                for (let i = 1; i < contours.length; i++) {
                  const next = contours[i];
                  const newAcc: number[][] = [];
                  for (const a of acc) {
                    const res = await combineContours(a, next);
                    newAcc.push(...res);
                  }
                  acc = newAcc.length ? newAcc : acc;
                }
                return acc;
              };

              const applyBinary = async (op: string, A: SliceMap, B: SliceMap): Promise<SliceMap> => {
                const result: SliceMap = new Map();
                // Build union of slice keys and apply tolerance grouping across A and B
                const combinedKeys: number[] = [];
                const pushWithTolerance = (val: number) => {
                  for (let i = 0; i < combinedKeys.length; i++) {
                    if (Math.abs(combinedKeys[i] - val) <= SLICE_TOL) {
                      return; // already represented
                    }
                  }
                  combinedKeys.push(val);
                };
                Array.from(A.keys()).forEach(pushWithTolerance);
                Array.from(B.keys()).forEach(pushWithTolerance);
                combinedKeys.sort((a, b) => a - b);
                const getNearContours = (m: SliceMap, key: number): number[][] => {
                  const aggregated: number[][] = [];
                  for (const mk of Array.from(m.keys())) {
                    if (Math.abs(mk - key) <= SLICE_TOL) {
                      const arr = m.get(mk) || [];
                      aggregated.push(...arr);
                    }
                  }
                  return aggregated;
                };
                for (const k of combinedKeys) {
                  const aContours = await unionReduce(getNearContours(A, k));
                  const bContours = await unionReduce(getNearContours(B, k));
                  if ((aContours?.length || 0) === 0 && (bContours?.length || 0) === 0) continue;
                  // If side empty, handle identity
                  if (!aContours || aContours.length === 0) {
                    if (op === '∪' || op === '⊕') { if (bContours.length) result.set(k, bContours); }
                    // intersect/subtract with empty yields empty
                    continue;
                  }
                  if (!bContours || bContours.length === 0) {
                    if (op === '∪' || op === '⊕' || op === '-') { if (aContours.length) result.set(k, aContours); }
                    // intersect with empty is empty
                    continue;
                  }
                  // Reduce to single representative by folding pairwise
                  let mergedA = aContours;
                  let mergedB = bContours;
                  // Execute op for each pair; start with first pair and fold
                  let acc: number[][] = [];
                  const opFunc = op === '∪' ? combineContours : op === '∩' ? intersectContours : op === '⊕' ? xorContours : subtractContours;
                  // Simplify by union-reduce each side to one or few, then run op across all combinations
                  const left = await unionReduce(mergedA);
                  const right = await unionReduce(mergedB);
                  for (const la of left) {
                    for (const rb of right) {
                      const res = await opFunc(la, rb);
                      acc.push(...res);
                    }
                  }
                  // Union-reduce result to clean overlaps
                  const cleaned = await unionReduce(acc);
                  if (cleaned && cleaned.length) result.set(k, cleaned);
                }
                return result;
              };

              // Evaluate RPN
              const stack: SliceMap[] = [];
              for (const t of output) {
                if (/^[A-Za-z][A-Za-z0-9_#-]*$/.test(t)) {
                  stack.push(getSliceMapForStructure(t));
                } else if (['∪','∩','⊕','-'].includes(t)) {
                  const b = stack.pop();
                  const a = stack.pop();
                  if (!a || !b) throw new Error('Malformed expression');
                  const r = await applyBinary(t, a, b);
                  stack.push(r);
                }
              }
              if (stack.length !== 1) throw new Error('Malformed expression');
              const finalMap = stack[0];

              // Build contours array for structure from finalMap via VIP rectangles
              // Convert finalMap -> VIP structure then back to contours (rects)
              const gridGuess = {
                xSize: imageMetadata?.columns || 512,
                ySize: imageMetadata?.rows || 512,
                zSize: Math.max(1, Math.round((selectedSeries?.images?.length || 1))),
                xRes: imageMetadata?.pixelSpacing?.[0] || 1,
                yRes: imageMetadata?.pixelSpacing?.[1] || 1,
                zRes: imageMetadata?.sliceThickness || 1,
                origin: { x: 0, y: 0, z: 0 }
              } as any;
              const vips = Array.from(finalMap.entries()).reduce((acc: any[][][], [z, contourList]) => {
                const rows: any[][] = acc[z] || (acc[z] = []);
                // Raster per-row by slicing points' y; for now, approximate whole rows per contour as a rectangle span
                // Convert raw contour points to mask then VIP rows
                // Quick path: assume contours already in grid, build runs per y
                const mask2D = new Uint8Array(gridGuess.xSize * gridGuess.ySize);
                for (const pts of contourList) {
                  // Fill rectangle span across rows based on y from points
                  for (let i = 1; i < pts.length; i += 3) {
                    // not used; keeping interface consistent
                  }
                }
                return acc;
              }, [] as any[][][]);
              // Fall back: simple conversion using rectangles for each raw contour
              const rectContours = Array.from(finalMap.entries()).map(([slicePosition, contours]) => {
                return contours.map(points => ({ slicePosition: slicePosition as number, points, numberOfPoints: points.length / 3 }));
              }).flat();
              rectContours.sort((a, b) => (a.slicePosition as number) - (b.slicePosition as number));
              const newContours = rectContours;

              // Determine output target
              let targetName = outputName;
              let targetColor: [number, number, number] | null = null;
            if (newStructure?.createNewStructure) {
                targetName = newStructure.name || outputName || 'Combined';
                // parse hex color to rgb
                const hex = (newStructure.color || '#3B82F6').replace('#', '');
                const r = parseInt(hex.substring(0, 2), 16) || 59;
                const g = parseInt(hex.substring(2, 4), 16) || 130;
                const b = parseInt(hex.substring(4, 6), 16) || 246;
                targetColor = [r, g, b];
              }

              const updated = structuredClone ? structuredClone(rtStructures) : JSON.parse(JSON.stringify(rtStructures));
              let targetStruct = targetName ? updated.structures.find((s: any) => s.structureName.toLowerCase() === targetName!.toLowerCase()) : null;
              if (!targetStruct) {
                // Create new if requested or if assignment provided without existing
                const maxRoi = Math.max(0, ...updated.structures.map((s: any) => s.roiNumber || 0));
                targetStruct = {
                  roiNumber: maxRoi + 1,
                  structureName: targetName || 'Combined',
                  color: targetColor || [0, 255, 0],
                  contours: [] as any[]
                };
                updated.structures.push(targetStruct);
              }
              if (targetColor) {
                targetStruct.color = targetColor;
              }
              targetStruct.contours = newContours;

              // Update state and close
              setRTStructures(updated);
              // Also notify handler so any listeners update
              handleContourUpdate(updated);
            setShowBooleanOperations(false);
              } catch (err) {
                console.error('Boolean operation failed:', err);
              }
          }}
        />
      )}

      {fusionManifest && fusionManifest.secondaries.length > 0 && (
        <FusionControlPanel
          opacity={fusionOpacity}
          onOpacityChange={setFusionOpacity}
          secondaryOptions={fusionManifest.secondaries}
          selectedSecondaryId={secondarySeriesId}
          onSecondarySeriesSelect={setSecondarySeriesId}
          secondaryStatuses={fusionSecondaryStatuses}
          manifestLoading={fusionManifestLoading}
          manifestError={fusionManifestError}
          onOpenDebug={triggerFusionDebug}
          minimized={!showFusionPanel}
          onToggleMinimized={(minimized) => setShowFusionPanel(!minimized)}
          windowLevel={fusionWindowLevel}
          onWindowLevelPreset={(preset) => setFusionWindowLevel(preset)}
        />
      )}

      {/* Margin Toolbar */}
      {showMarginToolbar && rtStructures && selectedForEdit && !showBooleanOperations && !isContourEditMode && (
        <MarginToolbar
          selectedStructure={rtStructures.structures?.find((s: any) => s.roiNumber === selectedForEdit) ? {
            id: selectedForEdit,
            structureName: rtStructures.structures.find((s: any) => s.roiNumber === selectedForEdit)?.structureName || 'Unknown',
            color: `rgb(${rtStructures.structures.find((s: any) => s.roiNumber === selectedForEdit)?.color?.join(',') || '255,255,255'})`
          } : null}
          isVisible={showMarginToolbar}
          onClose={() => setShowMarginToolbar(false)}
          availableStructures={rtStructures.structures?.map((s: any) => ({
            id: s.roiNumber,
            name: s.structureName
          })) || []}
          onCreateNewStructure={(basedOnId) => {
            // Create a new structure based on the selected one
            const baseStructure = rtStructures.structures?.find((s: any) => s.roiNumber === basedOnId);
            if (baseStructure) {
              const newName = `${baseStructure.structureName}_margin`;
              console.log('Creating new structure:', newName, 'based on:', baseStructure.structureName);
              // TODO: Implement actual structure creation
              alert(`Creating new structure: ${newName}`);
            }
          }}
          onExecuteOperation={(operation) => {
            // Handle execute operation
            console.log('🔹 🎯 Viewer Interface: Handling margin operation:', operation);
            if (workingViewerRef.current) {
              console.log('🔹 ✅ Working viewer ref found, calling handleContourUpdate');
              if (operation.preview) {
                workingViewerRef.current.handleContourUpdate({
                  action: 'preview_margin',
                  structureId: operation.structureId,
                  parameters: operation.parameters
                });
              } else {
                workingViewerRef.current.handleContourUpdate({
                  action: 'execute_margin',
                  structureId: operation.structureId,
                  targetStructureId: operation.targetStructureId,
                  parameters: operation.parameters
                });
                setShowMarginToolbar(false);
              }
            } else {
              console.error('🔹 ❌ Working viewer ref not found!');
            }
          }}
          onPreviewClear={() => {
            // Handle clear preview
            if (workingViewerRef.current) {
              workingViewerRef.current.handleContourUpdate({
                action: 'clear_preview'
              });
            }
          }}
        />
      )}





      {/* Error Modal */}
      <ErrorModal
        isOpen={!!error}
        onClose={() => setError(null)}
        onRetry={() => {
          setError(null);
          if (selectedSeries) {
            handleSeriesSelect(selectedSeries);
          }
        }}
        error={error || { title: '', message: '' }}
      />
      
      {/* Background Loading Progress */}
      <LoadingProgress 
        loadingStates={secondaryLoadingStates as any}
        className="animate-in slide-in-from-right-2 duration-300"
      />
    </div>
    </>
  );
}
