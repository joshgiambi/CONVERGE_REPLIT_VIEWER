import { db } from "../db";
import {
  series,
  studies,
  rtStructureSets,
  seriesRegistrationRelationships,
  planningSeriesDesignations,
  type Series as SeriesRecord,
} from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { logger } from "../logger";

type RegistrationRelationshipType = "rigid" | "deformable" | "shared-frame" | "frame-of-reference" | "identity";

export interface PlanningSeriesResult {
  series: SeriesRecord;
  confidence: number;
  reasons: string[];
  fusionCandidates: FusionCandidate[];
}

export interface FusionCandidate {
  seriesId: number;
  modality: string | null;
  seriesDescription: string | null;
  relationshipType: RegistrationRelationshipType;
  confidence: number;
}

export interface SeriesSelectionData {
  planningCT: SeriesRecord | null;
  planningCTConfidence: number;
  planningCTReasons: string[];
  fusionCandidates: FusionCandidate[];
  allSeries: SeriesRecord[];
}

const petModalities = ["PT", "PET", "NM"];

export class SeriesSelectionService {
  async selectPlanningCT(studyId: number): Promise<PlanningSeriesResult | null> {
    const cached = await db
      .select()
      .from(planningSeriesDesignations)
      .where(and(
        eq(planningSeriesDesignations.studyId, studyId),
        eq(planningSeriesDesignations.designationType, "planning_ct"),
      ))
      .limit(1);

    if (cached.length > 0) {
      const candidate = await db
        .select()
        .from(series)
        .where(eq(series.id, cached[0].seriesId))
        .limit(1);
      const planningRow = candidate[0];
      if (!planningRow) return null;
      const fusionCandidates = await this.getFusionCandidatesForSeries(planningRow.id);
      return {
        series: planningRow,
        confidence: cached[0].confidenceScore ?? 0,
        reasons: Array.isArray(cached[0].designationReason?.reasons)
          ? cached[0].designationReason.reasons
          : [],
        fusionCandidates,
      };
    }

    const ctSeries = await db
      .select()
      .from(series)
      .where(and(eq(series.studyId, studyId), eq(series.modality, "CT")))
      .orderBy(desc(series.imageCount));

    if (ctSeries.length === 0) return null;

    const modalities = await this.getStudyModalities(studyId);
    const hasPet = modalities.some((modality) => petModalities.includes(modality));

    const scored = await Promise.all(
      ctSeries.map(async (ct) => {
        let score = 0;
        const reasons: string[] = [];

        const rtCount = await this.countRtReferences(ct.id);
        if (rtCount > 0) {
          score += 1000;
          reasons.push(`Referenced by ${rtCount} RT structure sets`);
        }

        const registrationCount = await this.countRegistrations(ct.id);
        if (registrationCount > 0) {
          score += 500 + registrationCount * 5;
          reasons.push(`Primary in ${registrationCount} registrations`);
        }

        // Check if this CT shares Frame of Reference with any PT series (PET-CT acquisition indicator)
        const sharesFoRWithPT = await this.sharesFoRWithPTSeries(ct.id, ct.frameOfReferenceUid);
        if (sharesFoRWithPT) {
          score -= 10000; // Massive penalty - this is definitely an acquisition CT, not planning
          reasons.push("Shares FoR with PET scan (acquisition CT, not planning)");
        }

        if (!hasPet) {
          score += 100;
          reasons.push("Dedicated planning study bonus");
        } else {
          // CT in a PET-CT study is likely an acquisition CT, not planning
          score -= 500;
          reasons.push("PET-CT acquisition penalty");
        }

        const descText = (ct.seriesDescription ?? "").toLowerCase();
        if (descText.includes("ctac") || descText.includes("attenuation")) {
          score -= 200;
          reasons.push("CTAC penalty");
        }
        if (descText.includes("planning") || descText.includes("plan")) {
          score += 50;
          reasons.push("Planning keyword");
        }

        const imageBonus = Math.min(200, ct.imageCount ?? 0);
        score += imageBonus;
        reasons.push(`Image count bonus: ${imageBonus}`);

        return { ct, score, reasons };
      })
    );

    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];
    if (!best) return null;

    await db
      .insert(planningSeriesDesignations)
      .values({
        studyId,
        seriesId: best.ct.id,
        designationType: "planning_ct",
        confidenceScore: Math.min(1, best.score / 1000),
        designationReason: { reasons: best.reasons, score: best.score },
      })
      .onConflictDoUpdate({
        target: [planningSeriesDesignations.studyId, planningSeriesDesignations.designationType],
        set: {
          seriesId: best.ct.id,
          confidenceScore: Math.min(1, best.score / 1000),
          designationReason: { reasons: best.reasons, score: best.score },
          updatedAt: new Date(),
        },
      });

    const fusionCandidates = await this.getFusionCandidatesForSeries(best.ct.id);

    return {
      series: best.ct,
      confidence: Math.min(1, best.score / 1000),
      reasons: best.reasons,
      fusionCandidates,
    };
  }

  async getFusionCandidatesForSeries(primarySeriesId: number): Promise<FusionCandidate[]> {
    const primaryRows = await db
      .select()
      .from(series)
      .where(eq(series.id, primarySeriesId))
      .limit(1);
    const primary = primaryRows[0];
    if (!primary) return [];

    const map = new Map<number, FusionCandidate>();
    const visited = new Set<number>();
    visited.add(primarySeriesId);

    // Recursive function to find all fusible series (transitive closure)
    const findConnectedSeries = async (currentSeriesId: number, depth: number = 0): Promise<void> => {
      if (depth > 3) return; // Prevent infinite loops, max 3 hops

      // Get direct registration relationships (both directions)
      const directForward = await db
        .select({
          seriesId: seriesRegistrationRelationships.secondarySeriesId,
          relationshipType: seriesRegistrationRelationships.relationshipType,
          confidenceScore: seriesRegistrationRelationships.confidenceScore,
          modality: series.modality,
          seriesDescription: series.seriesDescription,
          isDerived: series.isDerived,
          frameOfReferenceUid: series.frameOfReferenceUid,
        })
        .from(seriesRegistrationRelationships)
        .innerJoin(series, eq(seriesRegistrationRelationships.secondarySeriesId, series.id))
        .where(eq(seriesRegistrationRelationships.primarySeriesId, currentSeriesId));

      const directReverse = await db
        .select({
          seriesId: seriesRegistrationRelationships.primarySeriesId,
          relationshipType: seriesRegistrationRelationships.relationshipType,
          confidenceScore: seriesRegistrationRelationships.confidenceScore,
          modality: series.modality,
          seriesDescription: series.seriesDescription,
          isDerived: series.isDerived,
          frameOfReferenceUid: series.frameOfReferenceUid,
        })
        .from(seriesRegistrationRelationships)
        .innerJoin(series, eq(seriesRegistrationRelationships.primarySeriesId, series.id))
        .where(eq(seriesRegistrationRelationships.secondarySeriesId, currentSeriesId));

      const allDirect = [...directForward, ...directReverse];

      for (const row of allDirect) {
        if (visited.has(row.seriesId)) continue;
        if (!this.isVisibleSeries(row)) continue;

        visited.add(row.seriesId);
        const confidence = Math.max(0.5, (row.confidenceScore ?? 0.8) - depth * 0.1);
        
        // Log when a FoR-only registration is auto-generated
        if (row.relationshipType === 'frame-of-reference') {
          logger.info({
            primarySeriesId: currentSeriesId,
            secondarySeriesId: row.seriesId,
            relationshipType: row.relationshipType,
            confidence,
            depth
          }, 'FoR-only registration included in fusion candidates');
        }
        
        const existing = map.get(row.seriesId);
        if (!existing || existing.confidence < confidence) {
          map.set(row.seriesId, {
            seriesId: row.seriesId,
            modality: row.modality ?? null,
            seriesDescription: row.seriesDescription ?? null,
            relationshipType: (row.relationshipType as RegistrationRelationshipType) ?? "rigid",
            confidence,
          });
        }

        // Recursively find connected series
        await findConnectedSeries(row.seriesId, depth + 1);

        // Also check Frame of Reference for this connected series
        if (row.frameOfReferenceUid) {
          const forMatches = await db
            .select()
            .from(series)
            .where(eq(series.frameOfReferenceUid, row.frameOfReferenceUid));

          for (const forCandidate of forMatches) {
            if (visited.has(forCandidate.id)) continue;
            if (!this.isVisibleSeries(forCandidate)) continue;

            visited.add(forCandidate.id);
            const forConfidence = Math.max(0.5, 0.9 - depth * 0.1);
            const existingFor = map.get(forCandidate.id);
            if (!existingFor || existingFor.confidence < forConfidence) {
              map.set(forCandidate.id, {
                seriesId: forCandidate.id,
                modality: forCandidate.modality,
                seriesDescription: forCandidate.seriesDescription,
                relationshipType: "shared-frame",
                confidence: forConfidence,
              });
            }
            // Continue traversal from FoR-matched series
            await findConnectedSeries(forCandidate.id, depth + 1);
          }
        }
      }
    };

    // Start with direct Frame of Reference matches (cross-study)
    if (primary.frameOfReferenceUid) {
      const shared = await db
        .select()
        .from(series)
        .where(eq(series.frameOfReferenceUid, primary.frameOfReferenceUid));

      for (const candidate of shared) {
        if (candidate.id === primarySeriesId) continue;
        if (!this.isVisibleSeries(candidate)) continue;
        
        visited.add(candidate.id);
        map.set(candidate.id, {
          seriesId: candidate.id,
          modality: candidate.modality,
          seriesDescription: candidate.seriesDescription,
          relationshipType: "shared-frame",
          confidence: 0.9,
        });

        // Traverse from FoR matches
        await findConnectedSeries(candidate.id, 1);
      }
    }

    // Start traversal from primary series
    await findConnectedSeries(primarySeriesId, 0);

    return Array.from(map.values()).sort((a, b) => b.confidence - a.confidence);
  }

  async getSeriesSelectionData(studyId: number): Promise<SeriesSelectionData> {
    const planning = await this.selectPlanningCT(studyId);
    const allSeries = await db
      .select()
      .from(series)
      .where(eq(series.studyId, studyId))
      .orderBy(desc(series.createdAt));

    return {
      planningCT: planning?.series ?? null,
      planningCTConfidence: planning?.confidence ?? 0,
      planningCTReasons: planning?.reasons ?? [],
      fusionCandidates: planning?.fusionCandidates ?? [],
      allSeries,
    };
  }

  private async countRtReferences(seriesId: number): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(rtStructureSets)
      .where(eq(rtStructureSets.referencedSeriesId, seriesId));
    return result[0]?.count ?? 0;
  }

  private async countRegistrations(seriesId: number): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(seriesRegistrationRelationships)
      .where(eq(seriesRegistrationRelationships.primarySeriesId, seriesId));
    return result[0]?.count ?? 0;
  }

  /**
   * Check if this CT series shares the same Frame of Reference with any PT series.
   * This is the strongest indicator that it's a PET-CT acquisition CT, not a planning CT.
   * PET-CT scanners acquire both modalities in the same coordinate space (same FoR).
   */
  private async sharesFoRWithPTSeries(seriesId: number, frameOfReferenceUid: string | null): Promise<boolean> {
    if (!frameOfReferenceUid) return false;

    // Get the patient ID for this series
    const seriesRows = await db
      .select({ patientId: studies.patientId })
      .from(series)
      .innerJoin(studies, eq(series.studyId, studies.id))
      .where(eq(series.id, seriesId))
      .limit(1);
    
    if (seriesRows.length === 0) return false;
    const patientId = seriesRows[0].patientId;

    // Check if any PT series in this patient shares the same FoR
    const ptSeries = await db
      .select({ id: series.id })
      .from(series)
      .innerJoin(studies, eq(series.studyId, studies.id))
      .where(
        and(
          eq(studies.patientId, patientId),
          eq(series.frameOfReferenceUid, frameOfReferenceUid),
          sql`${series.modality} IN ('PT', 'PET', 'NM')`
        )
      )
      .limit(1);
    
    return ptSeries.length > 0;
  }

  private async getStudyModalities(studyId: number): Promise<string[]> {
    const rows = await db
      .select({ modality: series.modality })
      .from(series)
      .where(eq(series.studyId, studyId));
    return rows.map((row) => row.modality).filter((value): value is string => Boolean(value));
  }

  private isVisibleSeries(record: { isDerived?: boolean | null; seriesDescription?: string | null; modality?: string | null }): boolean {
    if (record.isDerived) return false;

    // Exclude non-image modalities that can't be displayed in viewer or aren't useful for fusion
    const excludedModalities = ['RTIMAGE', 'RTPLAN', 'RTDOSE', 'RTSTRUCT', 'REG', 'SR', 'KO', 'PR', 'RTRECORD'];
    if (record.modality && excludedModalities.includes(record.modality)) {
      return false;
    }

    const desc = (record.seriesDescription ?? '').toLowerCase();
    if (desc.includes('fused') || desc.includes('resampled') || desc.includes('derived') || desc.includes('fusebox')) {
      return false;
    }
    return true;
  }
}

export const seriesSelectionService = new SeriesSelectionService();
