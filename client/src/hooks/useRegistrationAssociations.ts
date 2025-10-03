/**
 * useRegistrationAssociations Hook
 * 
 * Fetches registration associations for fusion integration.
 * Mirrors legacy viewer's registration loading logic.
 * 
 * Agent 5: Integration
 * Created: 2025-10-02
 */

import { useQuery } from '@tanstack/react-query';
import type { RegistrationAssociation, RegistrationSeriesDetail } from '@/types/fusion';

interface RegistrationAssociationsResponse {
  associations: any[];
  ctacSeriesIds: number[];
}

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

const ensureString = (val: unknown): string | null => {
  if (val == null) return null;
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  return null;
};

/**
 * Fetch registration associations for a patient or study
 */
export function useRegistrationAssociations(patientId?: string | number, studyIds?: number[]) {
  return useQuery<{ associationMap: Map<number, RegistrationAssociation[]>; ctacSeriesIds: number[] }>({
    queryKey: ['registration-associations', patientId, studyIds],
    enabled: !!(patientId || (studyIds && studyIds.length > 0)),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    queryFn: async () => {
      const tryFetch = async (url: string): Promise<RegistrationAssociationsResponse> => {
        try {
          const r = await fetch(url, { cache: 'no-store' });
          if (!r.ok) return { associations: [], ctacSeriesIds: [] };
          const j = await r.json();
          const assocs = Array.isArray(j?.associations) ? j.associations : [];
          const ctac = Array.isArray(j?.ctacSeriesIds) ? j.ctacSeriesIds : [];
          return { associations: assocs, ctacSeriesIds: ctac };
        } catch {
          return { associations: [], ctacSeriesIds: [] };
        }
      };

      // Try patient-wide first
      let result: RegistrationAssociationsResponse = { associations: [], ctacSeriesIds: [] };
      if (patientId != null) {
        result = await tryFetch(`/api/registration/associations?patientId=${encodeURIComponent(String(patientId))}`);
      }

      let associations = result.associations;
      const ctacUnion = new Set<number>();
      (result.ctacSeriesIds || []).forEach((id: unknown) => {
        const normalized = normalizeSeriesId(id);
        if (normalized != null) ctacUnion.add(normalized);
      });

      // If no patient-wide associations, try per-study
      if (!associations.length && studyIds && studyIds.length > 0) {
        const results = await Promise.all(
          studyIds.map(studyId => tryFetch(`/api/registration/associations?studyId=${studyId}`))
        );
        associations = results.flatMap(r => r.associations);
        results.forEach(r => (r.ctacSeriesIds || []).forEach((id: unknown) => {
          const normalized = normalizeSeriesId(id);
          if (normalized != null) ctacUnion.add(normalized);
        }));
      }

      const allowedFusionModalities = new Set(['CT', 'PT', 'PET', 'MR', 'NM']);
      const associationMap = new Map<number, RegistrationAssociation[]>();

      for (const a of associations) {
        let primaryDetail: RegistrationSeriesDetail | null = null;
        const primaryId = normalizeSeriesId(a.targetSeriesId);
        if (primaryId == null) continue;

        primaryDetail = {
          id: primaryId,
          uid: ensureString(a.targetSeriesUID) ?? null,
          description: ensureString(a.targetSeriesDescription) ?? null,
          modality: ensureString(a.targetModality)?.toUpperCase() ?? '',
          studyId: normalizeSeriesId(a.targetStudyId),
          imageCount: null,
        };

        // Use API's sourceSeriesDetails if available (contains metadata)
        const seenSecondary = new Set<number>();
        const validSecondaryIds: number[] = [];
        const validSecondaryDetails: RegistrationSeriesDetail[] = [];

        // First, try to use the detailed objects from API
        if (Array.isArray(a.sourceSeriesDetails) && a.sourceSeriesDetails.length > 0) {
          for (const apiDetail of a.sourceSeriesDetails) {
            const normalizedId = normalizeSeriesId(apiDetail?.id);
            if (normalizedId == null || seenSecondary.has(normalizedId)) continue;

            const detail: RegistrationSeriesDetail = {
              id: normalizedId,
              uid: ensureString(apiDetail?.uid) ?? null,
              description: ensureString(apiDetail?.description) ?? null,
              modality: ensureString(apiDetail?.modality)?.toUpperCase() ?? '',
              studyId: normalizeSeriesId(apiDetail?.studyId),
              imageCount: typeof apiDetail?.imageCount === 'number' ? apiDetail.imageCount : null,
            };

            const modality = detail.modality;
            if (modality && !allowedFusionModalities.has(modality)) continue;

            seenSecondary.add(normalizedId);
            validSecondaryIds.push(normalizedId);
            validSecondaryDetails.push(detail);
          }
        } else {
          // Fallback: use sourceSeriesIds array if details not available
          const sourceIds = Array.isArray(a.sourceSeriesIds) ? a.sourceSeriesIds : [];
          for (const rawId of sourceIds) {
            const normalizedId = normalizeSeriesId(rawId);
            if (normalizedId == null || seenSecondary.has(normalizedId)) continue;

            // Minimal detail without metadata (API should provide this, but fallback)
            const detail: RegistrationSeriesDetail = {
              id: normalizedId,
              uid: null,
              description: null,
              modality: '',
              studyId: null,
              imageCount: null,
            };

            seenSecondary.add(normalizedId);
            validSecondaryIds.push(normalizedId);
            validSecondaryDetails.push(detail);
          }
        }

        if (!validSecondaryIds.length) continue;

        const entry: RegistrationAssociation = {
          ...a,
          targetSeriesId: primaryId,
          targetSeriesDetail: primaryDetail,
          sourcesSeriesIds: validSecondaryIds,
          sourceSeriesDetails: validSecondaryDetails,
        };

        const existing = associationMap.get(primaryId) || [];
        existing.push(entry);
        associationMap.set(primaryId, existing);
      }

      if (import.meta.env.DEV) {
        console.log('📎 Registration associations loaded:', {
          patientId,
          studyIds,
          associationCount: associationMap.size,
          ctacCount: ctacUnion.size,
          sampleEntry: associationMap.size > 0 ? Array.from(associationMap.values())[0][0] : null,
        });
      }

      return {
        associationMap,
        ctacSeriesIds: Array.from(ctacUnion.values()),
      };
    },
  });
}

