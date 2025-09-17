# Fusion Registration Checklist

Tracking the current status of the multi-registration fusion refactor.

## Pre-reqs
- [x] Fix duplicate `registrationId` declaration (`server/routes.ts` around line 3560).
- [x] Replace `/api/registration/resolve` calls in `working-viewer.tsx` with the `registrationAssociations` data and surface `transformCandidates`.
- [x] Confirm `/api/registration/associations` exposes the full relationship graph for patient `nYHUfQQEeTNqKGsj` (siblings, multiple REGs, candidate IDs).
- [x] **FIXED**: Remove duplicate `registrationAssociations` prop in `viewer-interface.tsx` - fusion control panels now appear for CT series when clicking anchor icons.

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

## Overlay Stabilization Workstream
- [x] Guard overlay requests with a session token so stale async responses can’t clobber the current slice.
- [x] Share the ITK slice-to-canvas conversion pipeline between live draws and background prefetch.
- [x] Prefetch neighboring fused slices (±3) once overlay active to eliminate 10s waits on scroll.
- [ ] Validate spatial alignment (CT 54 ↔ 50 workflow) against helper output and capture deltas.
- [ ] Extract viewport transform math into dedicated module and add tests for mm-accurate alignment.

## Server-Side Resampled Volume Rollout
- [ ] Design cache layout for pre-resampled volumes (primary/secondary/registration) and define invalidation triggers.
- [ ] Implement background ITK job to resample full secondary volume and emit manifest + verification PNGs.
- [ ] Add `/api/fusebox/resampled-volume` endpoint that streams metadata + pixel slabs (fallback to legacy slice API while job runs).
- [ ] Update frontend loader to detect cached volume, stream slices locally, and fall back only when cache missing.
- [ ] Integrate verification panel in UI to preview/download generated PNGs for QA.

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
