# Fusion Registration Checklist

Tracking the current status of the multi-registration fusion refactor.

## Pre-reqs
- [x] Fix duplicate `registrationId` declaration (`server/routes.ts` around line 3560).
- [x] Replace `/api/registration/resolve` calls in `working-viewer.tsx` with the `registrationAssociations` data and surface `transformCandidates`.
- [x] Confirm `/api/registration/associations` exposes the full relationship graph for patient `nYHUfQQEeTNqKGsj` (siblings, multiple REGs, candidate IDs).
- [x] **FIXED**: Remove duplicate `registrationAssociations` prop in `viewer-interface.tsx` - fusion control panels now appear for CT series when clicking anchor icons.
- [x] Ship a one-touch Fusebox starter (`./scripts/start-fusebox.sh`) so devs don’t have to manually activate the venv, upgrade SimpleITK, and export helper paths before running `npm run dev:itk`.

## Helper integration
- [x] Once the wiring above is in place, hit `/api/fusebox/resampled-slice` and confirm `transformSource` is `helper-generated`/`helper-cache`. ✅ **CONFIRMED: "helper-cache"**
- [x] **STEP 1**: Verify the registration dropdown renders with correct options when fusion panel appears (visual test) - ✅ **WORKING FOR CT**
- [x] **STEP 2**: Verify toggling dropdown selection sends the matching `registrationId` (watch `/api/fusebox/resampled-slice?registrationId=...`) - ✅ **WORKING** API calls with registrationId confirmed
- [x] **STEP 3**: Ensure changing registration clears the cache, updates the overlay, and writes the selection into the debug panel. ✅ **WORKING** - overlays now render with registration changes

## Validation
- [ ] Load the CT 54 → secondary 50 case and confirm the UI offers the expected candidates instead of returning identity.
- [ ] Double-check FoR grouping: same-FoR siblings should show as “Shared FoR” with no helper call; distinct registrations should quote their `.dcm::0`, `.dcm::1`, etc.
- [ ] Confirm the “no signal” warning only appears when the actual resampled slice is flat (e.g., shared FoR) rather than because the wrong transform was used.

## Current Issues Found
- [ ] **ISSUE A**: PET series don't show fusion panels (only CT series work with anchor icons) - *DEFERRED until CT overlay working*
- [x] **ISSUE B**: No actual fusion overlay rendering - ✅ **RESOLVED** - Fusion overlays now appear! 
- [ ] **ISSUE C**: Fusion overlay instability - overlays pop in/out, misaligned, scale issues, opacity slider causes chaos - *Request-token guard + ITK prefetch shipped; still seeing flashing and misalignment*
- [ ] **ISSUE D**: Regression — series dropdown still surfaces derived/resampled fusion outputs and manifest preload isn’t firing (anchor control remains inert) *(Reopened 2025-09-19 pending PET/CT sidebar + manifest gating fixes — FoR-based fallback now wired on 2025-09-19 to keep PET/MR siblings together; validate on CT 54→PT 50)*

## Overlay Stabilization Workstream
- [x] Guard overlay requests with a session token so stale async responses can’t clobber the current slice.
- [x] Share the ITK slice-to-canvas conversion pipeline between live draws and background prefetch.
- [x] Prefetch neighboring fused slices (±3) once overlay active to eliminate 10s waits on scroll.
- [ ] Validate spatial alignment (CT 54 ↔ 50 workflow) against helper output and capture deltas.
- [ ] Extract viewport transform math into dedicated module and add tests for mm-accurate alignment.

## Server-Side Resampled Volume Rollout
- [x] Design cache layout for pre-resampled volumes (primary/secondary/registration) and define invalidation triggers. *(See `server/fusion/path-utils.ts` + manifest storage plan.)*
- [x] Implement background ITK job to resample full secondary volume and emit manifest + verification PNGs. *(Initial SimpleITK pipeline in `scripts/fusebox_resample_volume.py`; manifest JSON written per pair.)*
- [x] Add `/api/fusion/manifest` endpoint that exposes cached volume metadata for frontend consumption. *(Replaces former slice-only contract.)*
- [ ] Update frontend loader to detect cached volume, stream slices locally, and fall back only when cache missing. *(Pending — new workstream.)*
- [ ] Integrate verification panel in UI to preview/download generated QA assets.

## Fusion Test Harness
- [x] ✅ **IMPLEMENTED**: Backend endpoint `/api/fusebox/test-slices` generates fusion test assets (primary, resampled secondary, blended overlay) and returns manifest with debug info.
- [x] ✅ **IMPLEMENTED**: Lightweight test page at `/fusion-test?patientId=X` displays trio of images with slice navigation, registration metadata, and transform inspection.
- [x] ✅ **IMPLEMENTED**: Transform inspector with recursion protection and helper log capture for debugging.
- [ ] Add "Open Fusion Test" action in patient manager to trigger on-demand validation run.
- [ ] Implement temp storage/cleanup for generated assets (per-session TTL).
- [ ] **PRIORITY**: Validate fusion test page works end-to-end with known good data (CT 54 → secondary 50 case).
- [ ] Capture tester feedback and incorporate into main fusion rollout plan.

## Recent Fixes (2025-01-17)
- [x] ✅ **FIXED**: JSX adjacency build error in fusion-test.tsx
- [x] ✅ **FIXED**: Include candidateId in H5 cache filenames to prevent conflicts between registration candidates
- [x] ✅ **FIXED**: Reject identity H5 transforms and regenerate from 4x4 matrices with `helper-regenerated` source tracking
- [x] ✅ **FIXED**: Harden transform inspector against Composite recursion with depth limiting and error handling
- [x] ✅ **FIXED**: Remove duplicate `registrationAssociations` attribute in viewer-interface.tsx
- [x] ✅ **FIXED**: Page scrolling issue in fusion-test page (changed from `overflow-y-auto` to `overflow-auto`)
- [x] ✅ **FIXED**: Frame of Reference UID extraction in test-slices endpoint (was returning null, now extracts from DICOM files)
- [x] ✅ **ENHANCED**: Transform inspector now extracts meaningful transforms and filters out pathological identity composites

## Next steps for follow-up
- **IMMEDIATE**: Test fusion-test page with patient `nYHUfQQEeTNqKGsj` (CT 54 → secondary 50 case) to validate end-to-end functionality
- **IMMEDIATE**: Verify helper-generated H5 transforms are working correctly and not falling back to identity matrices
- Re-run the 54↔50 scenario after the resampled-volume path lands to measure alignment.
- Promote the new viewport transform helper + add unit coverage before removing legacy math.
- Wire PET fusion support once CT overlay stability is signed off.

- **Frontend Manifest Migration (2025-01-18)**
  - [x] Remove legacy slice-by-slice fusebox requests from `fusion-utils` and viewer components; rely exclusively on manifest-driven cached DICOMs.
  - [x] Refactor series dropdown + anchor/launch buttons so “Anchor” loads fused secondary and “Open” loads standalone CT without exposing derived series in the list.
  - [x] Implement manifest prefetch/preload flows that aggressively fetch all fused secondaries on initial CT load.
  - [ ] Eliminate contour flashing by syncing overlay rendering with manifest-backed image cache (investigate current re-render path).
  - [x] Add modality-specific window/level presets (MRI, CT, PET) accessible from the fusion toolbar with presets surfaced in UI and applied to overlay render path.
  - [ ] Redesign fusion toolbar to list all fused secondaries with color-coded chrome and fast switching.
  - [x] Ensure planning CT’s latest RT structure set is auto-selected while ignoring secondaries’ structure sets.
  - [x] Hide derived/resampled secondary series from the main series dropdown; anchor toggles fused overlay using manifest, open button keeps standalone CT/MR/etc.
  - [x] Ensure co-registered sibling series inherit fusion availability (sharing REG or FoR) including multi-MR and PET/CT pairs.
  - [x] Confirm series dropdown labels stay concise; adjust layout so anchor button remains visible even for long study names.
