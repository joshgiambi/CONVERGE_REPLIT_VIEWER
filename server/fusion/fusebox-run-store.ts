import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db.ts';
import { fuseboxRuns, type FuseboxRun } from '@shared/schema';

export type FuseboxRunStatus = 'pending' | 'running' | 'ready' | 'error';

interface RunIdentity {
  primarySeriesId: number;
  secondarySeriesId: number;
  registrationId?: string | null;
}

interface RunMetadataUpdate {
  transformSource?: string | null;
  outputDirectory?: string | null;
  manifestPath?: string | null;
  sliceCount?: number | null;
  rows?: number | null;
  columns?: number | null;
}

interface MarkRunParams extends RunIdentity, RunMetadataUpdate {}

const normalizeRegistrationId = (registrationId?: string | null): string | null => {
  if (registrationId === undefined || registrationId === null) return null;
  const trimmed = String(registrationId).trim();
  return trimmed.length ? trimmed : null;
};

const buildWhereClause = (identity: RunIdentity) => {
  const registrationId = normalizeRegistrationId(identity.registrationId);
  const conditions = [
    eq(fuseboxRuns.primarySeriesId, identity.primarySeriesId),
    eq(fuseboxRuns.secondarySeriesId, identity.secondarySeriesId),
    registrationId ? eq(fuseboxRuns.registrationId, registrationId) : isNull(fuseboxRuns.registrationId),
  ];
  return and(...conditions);
};

const fetchExistingRun = async (identity: RunIdentity): Promise<FuseboxRun | undefined> => {
  const whereClause = buildWhereClause(identity);
  const results = await db.select().from(fuseboxRuns).where(whereClause).limit(1);
  return results[0];
};

const mergeMetadata = (existing: FuseboxRun | undefined, update: RunMetadataUpdate) => ({
  transformSource: update.transformSource ?? existing?.transformSource ?? null,
  outputDirectory: update.outputDirectory ?? existing?.outputDirectory ?? null,
  manifestPath: update.manifestPath ?? existing?.manifestPath ?? null,
  sliceCount: update.sliceCount ?? existing?.sliceCount ?? null,
  rows: update.rows ?? existing?.rows ?? null,
  columns: update.columns ?? existing?.columns ?? null,
});

export async function markFuseboxRunStarted(params: MarkRunParams): Promise<FuseboxRun> {
  const now = new Date();
  const registrationId = normalizeRegistrationId(params.registrationId);
  const identity = {
    primarySeriesId: params.primarySeriesId,
    secondarySeriesId: params.secondarySeriesId,
    registrationId,
  };

  const existing = await fetchExistingRun(identity);
  const metadata = mergeMetadata(existing, params);

  if (!existing) {
    const [inserted] = await db
      .insert(fuseboxRuns)
      .values({
        primarySeriesId: identity.primarySeriesId,
        secondarySeriesId: identity.secondarySeriesId,
        registrationId,
        status: 'running',
        error: null,
        startedAt: now,
        completedAt: null,
        updatedAt: now,
        ...metadata,
      })
      .returning();
    return inserted;
  }

  const [updated] = await db
    .update(fuseboxRuns)
    .set({
      status: 'running',
      error: null,
      startedAt: existing.startedAt ?? now,
      completedAt: null,
      updatedAt: now,
      ...metadata,
    })
    .where(eq(fuseboxRuns.id, existing.id))
    .returning();
  return updated;
}

export async function markFuseboxRunReady(params: MarkRunParams & { startedAt?: Date | null }): Promise<FuseboxRun> {
  const now = new Date();
  const registrationId = normalizeRegistrationId(params.registrationId);
  const identity = {
    primarySeriesId: params.primarySeriesId,
    secondarySeriesId: params.secondarySeriesId,
    registrationId,
  };

  const existing = await fetchExistingRun(identity);
  const metadata = mergeMetadata(existing, params);

  if (!existing) {
    const [inserted] = await db
      .insert(fuseboxRuns)
      .values({
        primarySeriesId: identity.primarySeriesId,
        secondarySeriesId: identity.secondarySeriesId,
        registrationId,
        status: 'ready',
        error: null,
        startedAt: params.startedAt ?? now,
        completedAt: now,
        updatedAt: now,
        ...metadata,
      })
      .returning();
    return inserted;
  }

  const [updated] = await db
    .update(fuseboxRuns)
    .set({
      status: 'ready',
      error: null,
      completedAt: now,
      updatedAt: now,
      startedAt: existing.startedAt ?? params.startedAt ?? now,
      ...metadata,
    })
    .where(eq(fuseboxRuns.id, existing.id))
    .returning();
  return updated;
}

export async function markFuseboxRunFailed(params: MarkRunParams & { error: string }): Promise<FuseboxRun> {
  const now = new Date();
  const registrationId = normalizeRegistrationId(params.registrationId);
  const identity = {
    primarySeriesId: params.primarySeriesId,
    secondarySeriesId: params.secondarySeriesId,
    registrationId,
  };

  const existing = await fetchExistingRun(identity);
  const metadata = mergeMetadata(existing, params);

  if (!existing) {
    const [inserted] = await db
      .insert(fuseboxRuns)
      .values({
        primarySeriesId: identity.primarySeriesId,
        secondarySeriesId: identity.secondarySeriesId,
        registrationId,
        status: 'error',
        error: params.error,
        startedAt: now,
        completedAt: now,
        updatedAt: now,
        ...metadata,
      })
      .returning();
    return inserted;
  }

  const [updated] = await db
    .update(fuseboxRuns)
    .set({
      status: 'error',
      error: params.error,
      completedAt: now,
      updatedAt: now,
      ...metadata,
    })
    .where(eq(fuseboxRuns.id, existing.id))
    .returning();
  return updated;
}

export async function getFuseboxRun(identity: RunIdentity): Promise<FuseboxRun | undefined> {
  return fetchExistingRun(identity);
}
