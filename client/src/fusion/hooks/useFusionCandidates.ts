import { useCallback, useMemo } from 'react';
import type { RegistrationAssociation } from '@/types/fusion';

interface SeriesEntryMinimal {
  id: number;
  modality?: string | null;
  frameOfReferenceUID?: string | null;
  metadata?: { frameOfReferenceUID?: string | null };
  isDerived?: boolean | null;
}

interface UseFusionCandidatesParams {
  series: SeriesEntryMinimal[];
  shouldHideSeries: (entry: SeriesEntryMinimal) => boolean;
  registrationRelationshipMap: Map<number, RegistrationAssociation[]>;
  regAssociations?: Record<number, number[]>; // legacy adjacency (seriesId -> neighbor seriesIds)
  seriesSelectionData?: {
    planningCT?: { id: number } | null;
    fusionCandidates?: Array<{ seriesId: number }> | null;
  } | null;
  studyPatientId?: number | null;
}

export interface UseFusionCandidatesResultInternal {
  getCandidateSecondaryIds: (primarySeriesId: number) => number[];
  fusionCandidatesByPrimary: Map<number, number[]>;
  fusionSiblingMap: Map<number, Map<'PET' | 'MR', Map<number, number[]>>>;
}

function normalizeSeriesId(value: unknown): number | null {
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
}

export function useFusionCandidates({
  series,
  shouldHideSeries,
  registrationRelationshipMap,
  regAssociations,
  seriesSelectionData,
  studyPatientId,
}: UseFusionCandidatesParams): UseFusionCandidatesResultInternal {
  const seriesById = useMemo(() => {
    const map = new Map<number, SeriesEntryMinimal>();
    for (const entry of series) {
      const id = Number(entry?.id);
      if (!Number.isFinite(id)) continue;
      map.set(id, entry);
    }
    return map;
  }, [series]);

  const getCandidateSecondaryIds = useCallback(
    (primarySeriesId: number): number[] => {
      const allowedModalities = new Set(['CT', 'PT', 'PET', 'MR', 'NM']);

      const shouldIncludeById = (seriesId: number): boolean => {
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
        if (shouldIncludeById(id)) {
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

      const candidateIds = Array.from(results.values()).filter((id) => shouldIncludeById(id));
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.debug(
          `Fusion candidates for primary ${primarySeriesId} (patient ${studyPatientId ?? 'unknown'}): ${candidateIds.join(', ')}`,
        );
      }
      return candidateIds;
    },
    [regAssociations, registrationRelationshipMap, seriesById, shouldHideSeries, studyPatientId],
  );

  const legacyFusionCandidates = useMemo(() => {
    const map = new Map<number, number[]>();
    series.forEach((entry) => {
      if (!entry) return;
      const parsedId = Number(entry.id);
      if (!Number.isFinite(parsedId)) return;
      map.set(parsedId, getCandidateSecondaryIds(parsedId));
    });
    return map;
  }, [series, getCandidateSecondaryIds]);

  const fusionCandidatesByPrimary = useMemo(() => {
    const merged = new Map<number, number[]>(legacyFusionCandidates);
    if (seriesSelectionData?.planningCT && Array.isArray(seriesSelectionData.fusionCandidates)) {
      merged.set(
        seriesSelectionData.planningCT.id,
        seriesSelectionData.fusionCandidates.map((candidate) => candidate.seriesId),
      );
    }
    return merged;
  }, [legacyFusionCandidates, seriesSelectionData?.fusionCandidates, seriesSelectionData?.planningCT]);

  // Minimal sibling map based on modality groupings; can be expanded to match legacy logic.
  const fusionSiblingMap = useMemo(() => {
    const byPrimary = new Map<number, Map<'PET' | 'MR', Map<number, number[]>>>();
    for (const [primaryId, candidateIds] of fusionCandidatesByPrimary.entries()) {
      const modalityBuckets: Map<'PET' | 'MR', Map<number, number[]>> = new Map();
      const petMap = new Map<number, number[]>();
      const mrMap = new Map<number, number[]>();
      candidateIds.forEach((cid) => {
        const entry = seriesById.get(cid);
        const modality = (entry?.modality || '').toUpperCase();
        if (modality === 'PT' || modality === 'PET') {
          petMap.set(cid, []);
        } else if (modality === 'MR') {
          mrMap.set(cid, []);
        }
      });
      if (petMap.size) modalityBuckets.set('PET', petMap);
      if (mrMap.size) modalityBuckets.set('MR', mrMap);
      byPrimary.set(primaryId, modalityBuckets);
    }
    return byPrimary;
  }, [fusionCandidatesByPrimary, seriesById]);

  return {
    getCandidateSecondaryIds,
    fusionCandidatesByPrimary,
    fusionSiblingMap,
  };
}


