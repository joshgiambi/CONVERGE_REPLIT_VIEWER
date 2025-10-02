import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  RegistrationAssociation,
  RegistrationSeriesDetail,
  RegistrationTransformCandidate,
  RegistrationOption,
} from '@/types/fusion';

interface UseRegistrationOptionsParams {
  primarySeriesId: number | null;
  secondarySeriesId: number | null;
  registrationAssociations?: Map<number, RegistrationAssociation[]>;
}

export interface RegistrationResolveInfo {
  status: number;
  ok: boolean;
  data: Record<string, unknown>;
}

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

export function useRegistrationOptions({
  primarySeriesId,
  secondarySeriesId,
  registrationAssociations,
}: UseRegistrationOptionsParams) {
  const [selectedRegistrationId, setSelectedRegistrationId] = useState<string | null>(null);
  const [registrationMatrix, setRegistrationMatrix] = useState<number[] | null>(null);
  const registrationMatrixRef = useRef<number[] | null>(null);
  const [registrationAssociationsForPrimary, setRegistrationAssociationsForPrimary] = useState<RegistrationAssociation[]>([]);
  const [registrationResolveInfo, setRegistrationResolveInfo] = useState<RegistrationResolveInfo | null>(null);

  useEffect(() => {
    if (!registrationAssociations || !primarySeriesId) {
      setRegistrationAssociationsForPrimary([]);
      return;
    }
    const list = registrationAssociations.get(primarySeriesId) || [];
    setRegistrationAssociationsForPrimary(list);
  }, [registrationAssociations, primarySeriesId]);

  const registrationOptions = useMemo<RegistrationOption[]>(() => {
    if (secondarySeriesId == null) {
      return [];
    }
    const secondaryId = Number(secondarySeriesId);
    if (!Number.isFinite(secondaryId)) {
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
        ? assoc.sourceSeriesDetails.find((detail) => detail?.id === secondaryId) || null
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
          regFile: assoc.regFile ?? null,
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
          regFile: assoc.regFile ?? null,
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

    return options;
  }, [registrationAssociationsForPrimary, secondarySeriesId]);

  useEffect(() => {
    if (secondarySeriesId == null) {
      setSelectedRegistrationId(null);
      return;
    }
    if (!registrationOptions.length) {
      setSelectedRegistrationId(null);
      return;
    }
    const hasSelected = registrationOptions.some((opt) => (opt.id ?? null) === (selectedRegistrationId ?? null));
    if (!hasSelected) {
      setSelectedRegistrationId(registrationOptions[0].id ?? null);
    }
  }, [secondarySeriesId, registrationOptions, selectedRegistrationId]);

  useEffect(() => {
    if (!primarySeriesId || secondarySeriesId == null) {
      if (registrationMatrixRef.current !== null) {
        registrationMatrixRef.current = null;
        setRegistrationMatrix(null);
      }
      setRegistrationResolveInfo({
        status: 204,
        ok: false,
        data: {
          reason: !primarySeriesId ? 'missing-primary-series' : 'missing-secondary-series',
          primarySeriesId: primarySeriesId ?? null,
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
      setRegistrationResolveInfo({
        status: 404,
        ok: false,
        data: {
          reason: 'no-registration-options',
          primarySeriesId,
          secondarySeriesId,
        },
      });
      return;
    }

    const selectedOption = registrationOptions.find((opt) => (opt.id ?? null) === (selectedRegistrationId ?? null))
      ?? registrationOptions[0];

    if (!selectedOption) {
      if (registrationMatrixRef.current !== null) {
        registrationMatrixRef.current = null;
        setRegistrationMatrix(null);
      }
      setRegistrationResolveInfo({
        status: 404,
        ok: false,
        data: {
          reason: 'registration-option-not-found',
          primarySeriesId,
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
      setRegistrationResolveInfo({
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
      setRegistrationResolveInfo({
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
  }, [primarySeriesId, secondarySeriesId, registrationOptions, selectedRegistrationId]);

  return {
    registrationOptions,
    selectedRegistrationId,
    setSelectedRegistrationId,
    registrationMatrix,
    registrationResolveInfo,
  } as const;
}
