# Fusion Registration Checklist

Tracking the current status of the multi-registration fusion refactor.

## Pre-reqs
- [x] Fix duplicate `registrationId` declaration (`server/routes.ts` around line 3560).
- [x] Replace `/api/registration/resolve` calls in `working-viewer.tsx` with the `registrationAssociations` data and surface `transformCandidates`.
- [x] Confirm `/api/registration/associations` exposes the full relationship graph for patient `nYHUfQQEeTNqKGsj` (siblings, multiple REGs, candidate IDs).

## Helper integration
- [x] Once the wiring above is in place, hit `/api/fusebox/resampled-slice` and confirm `transformSource` is `helper-generated`/`helper-cache`.
- [ ] Verify the registration dropdown renders and toggling selection sends the matching `registrationId` (watch `/api/fusebox/resampled-slice?registrationId=...`).
- [ ] Ensure changing registration clears the cache, updates the overlay, and writes the selection into the debug panel.

## Validation
- [ ] Load the CT 54 → secondary 50 case and confirm the UI offers the expected candidates instead of returning identity.
- [ ] Double-check FoR grouping: same-FoR siblings should show as “Shared FoR” with no helper call; distinct registrations should quote their `.dcm::0`, `.dcm::1`, etc.
- [ ] Confirm the “no signal” warning only appears when the actual resampled slice is flat (e.g., shared FoR) rather than because the wrong transform was used.

## Next steps for follow-up
- Swap the front-end registration resolution logic to consume the new association map and drop `/api/registration/resolve`.
- Complete the dropdown behavior (selection → helper request → overlay update) and add any missing UI affordances.
- Re-run the 54↔50 scenario to prove the helper path is exercised end-to-end.
