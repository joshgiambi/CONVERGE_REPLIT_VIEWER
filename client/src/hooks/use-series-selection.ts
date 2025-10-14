import { useQuery } from "@tanstack/react-query";

export interface FusionCandidate {
  seriesId: number;
  modality: string | null;
  seriesDescription: string | null;
  relationshipType: "rigid" | "deformable" | "shared-frame" | "identity";
  confidence: number;
}

export interface SeriesSelectionData {
  planningCT: any | null;
  planningCTConfidence: number;
  planningCTReasons: string[];
  fusionCandidates: FusionCandidate[];
  allSeries: any[];
}

export function useSeriesSelection(studyId?: number) {
  return useQuery<SeriesSelectionData>({
    queryKey: ["series-selection", studyId],
    enabled: Number.isFinite(studyId),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    queryFn: async () => {
      if (!Number.isFinite(studyId)) {
        throw new Error("Study id required");
      }
      const response = await fetch(`/api/studies/${studyId}/series-selection`);
      if (!response.ok) {
        const body = await response.text();
        throw new Error(body || "Failed to load series selection");
      }
      return response.json();
    },
  });
}

export function useFusionCandidates(seriesId?: number) {
  return useQuery<FusionCandidate[]>({
    queryKey: ["fusion-candidates", seriesId],
    enabled: Number.isFinite(seriesId),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    queryFn: async () => {
      if (!Number.isFinite(seriesId)) {
        throw new Error("Series id required");
      }
      const response = await fetch(`/api/series/${seriesId}/fusion-candidates`);
      if (!response.ok) {
        const body = await response.text();
        throw new Error(body || "Failed to load fusion candidates");
      }
      return response.json();
    },
  });
}

