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
- [ ] **STEP 3**: Ensure changing registration clears the cache, updates the overlay, and writes the selection into the debug panel.

## Validation
- [ ] Load the CT 54 → secondary 50 case and confirm the UI offers the expected candidates instead of returning identity.
- [ ] Double-check FoR grouping: same-FoR siblings should show as “Shared FoR” with no helper call; distinct registrations should quote their `.dcm::0`, `.dcm::1`, etc.
- [ ] Confirm the “no signal” warning only appears when the actual resampled slice is flat (e.g., shared FoR) rather than because the wrong transform was used.

## Current Issues Found
- [ ] **ISSUE A**: PET series don't show fusion panels (only CT series work with anchor icons) - *DEFERRED until CT overlay working*
- [ ] **ISSUE B**: No actual fusion overlay rendering - **CRITICAL: `window.__fusion` undefined, no 🐟 logs, renderFusionOverlayNew never called** - *WorkingViewer fusion system not initializing*

## Next steps for follow-up
- Swap the front-end registration resolution logic to consume the new association map and drop `/api/registration/resolve`.
- Complete the dropdown behavior (selection → helper request → overlay update) and add any missing UI affordances.
- Re-run the 54↔50 scenario to prove the helper path is exercised end-to-end.
