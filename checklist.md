# Active Checklist

Keep this section current; remove items as they ship and carry forward anything blocked.

## Fusion & Manifest
- [ ] Validate CT 54 → secondary 50 flow end-to-end through the manifest (dropdown candidates, cached slices, overlay alignment).
- [ ] Confirm frame-of-reference grouping logic labels shared FoR siblings correctly and avoids unnecessary helper calls.
- [ ] Ensure the "no signal" warning fires only when the fused slice is actually flat, not because the wrong transform was selected.
- [ ] Stabilize fusion overlays (eliminate flashing/misalignment when opacity changes or slices advance).
- [ ] Fix manifest gating regression: hide derived/resampled fusion series in dropdown and make anchor control responsive.
- [ ] Frontend loader should detect cached resampled volumes and fall back to live resample only when cache misses.
- [ ] Integrate a verification panel to surface QA assets generated during manifest builds.
- [ ] Add an "Open Fusion Test" action from the patient manager to jump into `/fusion-test` with context.
- [ ] Implement TTL cleanup for generated fusion assets to avoid stale cache growth.
- [ ] Capture structured tester feedback from the manifest harness and feed it into the rollout plan.
- [ ] Eliminate contour flashing by syncing overlay rendering with the manifest-backed image cache.
- [ ] Redesign fusion toolbar to list fused secondaries with modality-aware styling for quick switching.

## Fusebox Helper & Testing
- [ ] Run viewer smoke test (CT primary + MR secondary) to reconfirm overlay alignment with the SimpleITK path.
- [ ] Document a Dice validation command using the new manifest/volume routes.
- [ ] Validate multi-registration scenarios (multiple REG files per pair) and ensure cache/telemetry capture transform sources.

## Registration Pipeline
- [ ] Ingest every REG file per patient/study and persist the association graph for client enumeration.
- [ ] Surface shared frame-of-reference siblings so clients can reuse transforms without helper work.
- [ ] Persist both matrix and `.h5` transform metadata for each fusion pair and expose through the manifest/resampler APIs.
- [ ] Add QA endpoints/CLI to report transform residuals and voxel stats for validation runs.
- [ ] Harden helper failure handling (backoff, circuit breaker, operator alerting).
- [ ] Scope deformable registration ingestion once rigid flow is stable.

## Viewer Platform – Priority 0
- [ ] Decompose `client/src/components/dicom/working-viewer.tsx` into focused modules (`viewer-renderer`, `viewer-cache`, `viewer-interaction`, `viewer-fusion`, `viewer-contours`, `viewer-undo`).
- [ ] Introduce a `ViewerContext` provider to replace global `window` caches (zoom, pan, slice arrays, cache refs).
- [ ] Unify slice tolerance and render cadence constants across viewer/MPR (`SLICE_TOL_MM`, `RENDER_THROTTLE_MS`).
- [ ] Deduplicate the `/api/images/:sopInstanceUID` Express handler so there is a single canonical response with caching headers.

## Viewer Platform – Priority 1+
- [ ] Workerize boolean operations (move Clipper ops off the main thread, share scale/tolerance constants).
- [ ] Normalize viewer image caches with explicit limits, stats, and abortable fetches.
- [ ] Add a server endpoint for precomputed series metadata (sorted Z, default WL, pixel spacing).
- [ ] Set `ETag` + `Cache-Control` headers for image responses to improve client caching.

## Types, Tests, Logging
- [ ] Add fusion + boolean unit tests covering non-orthogonal orientations, degenerates, and cache fallbacks.
- [ ] Centralize client logging behind a `VITE_LOG_LEVEL` gate and use consistently across modules.
- [ ] Unify RT structure DTOs between client and shared schema to eliminate `any` hotspots.

## Known Gaps / Risks
- [ ] PET fusion panel parity (anchor availability, toolbar) once CT overlay stability is confirmed.
- [ ] Resolve legacy `npm run check` TypeScript failures (uploader, contour, RT parsing paths).
- [ ] Automate cleanup/TTL of Fusebox temp directories to prevent disk bloat.
