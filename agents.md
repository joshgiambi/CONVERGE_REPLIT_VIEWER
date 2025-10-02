# Agent Operations Guide

This viewer toolkit blends a React/Vite client with an Express + Vite middleware server that serves DICOM data, Fusebox fusion helpers, and manifest-driven overlays. Use this note as the single source of truth when you jump into the codebase.

## Project Layout
- `client/` – React app (Vite) with fusion tooling under `client/src/components/dicom/` and helpers in `client/src/lib/`.
- `server/` – Express entry (`server/index.ts`) registers API routes in `server/routes.ts` and wires the Vite dev middleware.
- `server/fusion/` – Fusion manifest service, Fusebox bridge, and resampler integration.
- `scripts/` – Python helpers (`fusebox_resample_volume.py`, validation scripts) and utilities for data loading.
- `storage/` – Local DICOM hierarchy (`storage/patients/...`). Populate via `node populate-from-storage.js`.
- `build/dicom-reg-converter/` – Compiled ITK/DCMTK helper (`dicom_reg_to_h5`) used when ITK support is enabled.
- `sam_env/` – Python venv expected to contain `SimpleITK`, `numpy`, etc. (`pip install -e .` inside repo).

## Getting Started
1. Install dependencies: `npm install`
2. Ensure local Postgres is running; copy `.env.template` to `.env` and set `DATABASE_URL`.
3. Push schema: `npm run db:push`
4. Populate the DB from local DICOMs (optional): `node populate-from-storage.js`

## Running the Dev Stack (with ITK helper)
- Verify helper prerequisites once: `npm run dev:setup`
  - Confirms `build/dicom-reg-converter/dicom_reg_to_h5` and `sam_env/bin/python` exist.
- Start server + Vite + ITK env: `npm run dev:itk`
  - Exports `DICOM_REG_CONVERTER`, `FUSEBOX_PYTHON`, `PORT=3000`, and runs `tsx watch server/index.ts`.
  - Express hosts API + client at the chosen port; Vite HMR is mounted automatically.
- Quick smoke: visit `http://localhost:3000/fusion-test?patientId=<ID>` to exercise the fusion manifest harness.

## Fusion + Manifest Notes
- `/api/fusion/manifest` is backed by `FusionManifestService` (`server/fusion/manifest-service.ts`).
  - Manifests are cached per primary series and saved under `tmp/fusebox-manifests` via `path-utils.ts`.
  - The service now records lifecycle events in the central debug feed (`source = fusion-manifest`).
- Full-volume resampling is handled by `FuseboxVolumeResampler`, calling `scripts/fusebox_resample_volume.py` through the Python runner.
- Use the Fusion Test page (`client/src/pages/fusion-test.tsx`) to request manifest-backed slices, inspect transforms, and read helper logs.

### Fusion Manifest Gotchas (read this before debugging PET/CT)
- **Frame-of-Reference only registrations**: Many PET planning exports ship REG series where the transform references only the source/target Frame Of Reference UIDs, not the Series Instance UIDs. `parseDicomRegistrationFromFile` captures those FoRs, but `series_registration_relationships` will not have a row unless we synthesise one. When the manifest guards requested IDs through `seriesSelectionService`, anything missing from that table is silently dropped. If PET fusion vanishes, inspect the REG (`scripts/analyze-reg-file.ts`) and expect to seed a FoR-based relationship.
- **Manifest filtering behaviour**: `FusionManifestService.getManifest` now cross-checks requested `secondarySeriesIds` against `seriesSelectionService.getFusionCandidatesForSeries`. If the selector fails to recognise the pair (e.g. FoR-only PET link), the manifest throws the request away and reuses whatever was cached. Watch for debug events like `Requested secondary series are not valid fusion candidates` and don’t assume your ID was honoured.
- **Transform resolution**: `resolveFuseboxTransform` currently keeps the raw matrix but drops the FoR metadata. When you rely on FoR-only registries, make sure your changes carry that metadata forward so fusebox can validate the match. If you see `No registration transform produced a helper output`, it usually means the transform candidates didn’t match the series you asked for.
- **Fusion test harness vs viewer**: The `Fusion Test` page still calls `/api/fusebox/test-slices`, bypassing the manifest filter/caching. Production viewers go through `fetchFusionManifest` and `preloadFusionSecondary`. Harmonise the harness (or at least remember the difference) when validating fixes.
- **Debugging workflow**:
  - `curl "/api/fusion/manifest?primarySeriesId=<CT>&secondarySeriesIds=<PET>"` – verify the manifest includes your secondary and a `ready` status.
  - `curl "/api/debug/events?source=fusion-manifest&limit=50"` – look for cache hits, filter warnings, or transform failures.
  - `scripts/analyze-reg-file.ts --file <REG.dcm> --patientRoot storage/patients` – confirm the REG links the FoRs you expect.
  - When in doubt, temporarily disable the candidate filter to narrow down whether the selector or transform resolver is at fault.

## Centralised Debug Feed & Logging
- **All server-side logging** is centralized through `server/logger.ts`, which provides `debug()`, `info()`, `warn()`, and `error()` methods.
- Each log call accepts an optional `source` parameter to tag the origin (e.g., 'fusebox', 'fusion-manifest', 'server').
- Logs are automatically captured by `server/debug/debug-hub.ts` and stored in memory for inspection.
- Fetch everything or filter by source/level with `/api/debug/events`:
  ```bash
  curl "http://localhost:3000/api/debug/events?source=fusebox&limit=50"
  curl "http://localhost:3000/api/debug/events?source=fusion-manifest&level=info"
  curl "http://localhost:3000/api/debug/events?source=server&level=error"
  ```
- Legacy `/api/fusebox/logs` now proxies to the same feed for backwards compatibility.
- The fusion test UI already refreshes from `/api/debug/events?source=fusebox`.
- **Usage**: Import and use `logger` from `server/logger.ts`:
  ```typescript
  import { logger } from './logger.ts';
  logger.info('Processing started', 'my-service');
  logger.error('Failed to process', 'my-service');
  ```
- See `docs/LOGGING_SYSTEM.md` for complete documentation on logging patterns and migration strategy.

## Data Loading & Storage
- DICOM files are uploaded through the web UI upload portal at `/api/upload`.
- Uploaded files are stored under `storage/patients/<PATIENT_ID>/<STUDY_UID>/<SERIES_UID>/*.dcm`.
- All patient/study/series/image metadata is extracted during upload and stored in PostgreSQL.
- Generated Fusebox volumes + manifests are written beneath `tmp/fusebox-*`; resampler metadata is cached per series pair.
- **Note**: Demo data endpoints (`/api/populate-demo`, `/api/create-test-data`) have been removed. Use the upload portal for all data ingestion.

## Patient & Series Deletion
- `DELETE /api/patients/:id?full=true` triggers full cascade deletion via `storage.deletePatientFully()`.
- Deletion order ensures foreign key constraints are respected:
  1. RT structure sets (contours → structures → sets)
  2. Frame of reference groups
  3. Fusion schema tables (planning designations, registration relationships, fusion capabilities)
  4. Fusebox runs
  5. Series (via `deleteSeriesFully()` which handles images, media, and filesystem cleanup)
  6. Studies
  7. Patient tags
  8. Patient record
- Filesystem cleanup removes patient directories from `storage/patients/` and fusion artifacts from `tmp/fusebox-*`.
- **Note**: The fusion schema migration (`migrations/20250202_add_fusion_schema.sql`) added tables that must be cleaned up during deletion.

## Useful Commands
- `npm run dev` – Starts server without enforcing ITK helper (falls back to matrix fusion).
- `npm run build` / `npm start` – Production bundle + server runner.
- `python scripts/fusebox_resample_volume.py --help` – Inspect resampler options for manual testing.
- `scripts/fusebox_resample_volume.py` expects JSON configs under `tmp/` (see manifest service for examples).

## Frame of Reference (FoR) Only Registration Handling

**Context**: Some DICOM REG files only contain Frame of Reference UIDs without explicit Series Instance UID references (common in PET/CT fusion).

**Solution Implemented**:
1. **FoR-only registration detection**: When `parseDicomRegistrationFromFile` returns FoR UIDs but no Series UIDs, the system creates `series_registration_relationships` entries with type `frame-of-reference` for all matching series.
2. **SeriesSelectionService integration**: Recognizes and traverses `frame-of-reference` relationships, logs when included in candidates.
3. **Transform metadata**: `resolveFuseboxTransform` carries FoR metadata (`sourceFrameOfReferenceUid`, `targetFrameOfReferenceUid`, `referencedSeriesInstanceUids`) and emits `frame-of-reference` debug events.
4. **Manifest filtering relaxation**: Explicit `secondarySeriesIds` bypass automatic candidate filtering (warns instead of dropping).
5. **Harmonized test harness**: `/api/fusebox/test-slices` uses manifest service internally (same path as viewer).

**Debug Sources**:
- `frame-of-reference`: Transform selection events (`/api/debug/events?source=frame-of-reference`)
- `fusion-manifest`: Manifest lifecycle, filtering warnings (`/api/debug/events?source=fusion-manifest`)
- `fusebox`: Helper/resample events (existing)

**Quick Troubleshooting**: If PET fusion disappears, check `/api/debug/events?source=fusion-manifest` for "Requested secondary series are not valid fusion candidates" and verify `series_registration_relationships` has `frame-of-reference` type entries.

See `docs/FRAME_OF_REFERENCE_REGISTRATION.md` for complete documentation.

## Troubleshooting Checklist
- `npm run dev:setup` fails → rebuild helper (`cmake --build build/dicom-reg-converter`) or recreate `sam_env` then `pip install -e .`.
- Missing fusion overlays → hit `/api/debug/events?source=fusion-manifest` for manifest state, confirm resample succeeded and outputs exist under `tmp/fusebox-*`.
- Helper unavailable errors (`FUSEBOX_*`) → ensure `FUSEBOX_PYTHON` points at the venv; run `scripts/start-fusebox.sh` as a convenience wrapper.
- TypeScript linting: `npm run check` still surfaces legacy uploader/contour type errors (documented in checklist).

Keep this file updated whenever routes, scripts, or startup flows change so the next agent can ramp instantly.
