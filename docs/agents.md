## Agents Guide

A concise operating manual for contributors and automation agents working on this project. It consolidates prior checklists and current best practices across backend (Fusebox/registration), frontend (viewer/fusion/RTSTRUCT), and ops.

### Environments and Tooling
- **Node**: Use `npm` with Node 20+. Typescript 5.6, Vite 5.
- **Python (Fusebox)**: `sam_env` virtualenv with `numpy`, `SimpleITK`, `pydicom` installed via `pip install -e .` from repo root. Prefer `FUSEBOX_PYTHON=$PWD/sam_env/bin/python`.
- **ITK Helper (optional but preferred)**: Build `tools/dicom-reg-converter` to produce `build/dicom-reg-converter/dicom_reg_to_h5` and set `DICOM_REG_CONVERTER` to its absolute path.

### Commands
- Dev (strict helper/venv check): `npm run dev:itk`
- Dev (standard): `npm run dev`
- Build (client+server): `npm run build`
- Typecheck: `npm run check`
- DB migrations: `npm run db:push`

### Backend – Fusebox and Registration
- `/api/fusebox/resampled-slice` returns JSON slice payloads (width/height/min/max/data) for a primary CT and selected secondary with a registration. Prefer helper-generated H5 transforms; fall back paths should be treated as failure where feasible.
- `/api/fusion/manifest` exposes volume-level cache metadata; frontend should preload and stream from this cache where available.
- Registration graph is exposed via `/api/registration/associations` and should be the single source to discover valid fusion pairs, siblings by Frame of Reference (FoR), and multiple registration candidates.
- Cache layout and invalidation are handled in `server/fusion/path-utils.ts` and related modules.

Key invariants
- Prefer `transformFile` (H5) over raw 4×4 matrices. Log `transformSource` (`helper-generated`, `helper-cache`, or explicit fallback) to aid QA.
- Resolve transforms moving→fixed (secondary→primary). Invert only when necessary.
- Treat identity transforms from helper as suspicious; regenerate if needed and tag as `helper-regenerated`.

### Frontend – Viewer, Fusion, and UI
- Primary flow: select a CT series → load fusion manifest → choose a secondary → render overlay using Fusebox cache. Avoid legacy per-slice secondaries pipeline.
- Hide derived/resampled series from main series list; access fused overlays via dedicated fusion controls anchored to the CT entry.
- Gated debug UI: heavy fusion debug panels should only render in development.
- Window/level presets for MR/CT/PET are available and should be wired to the overlay pipeline.

RTSTRUCT rendering
- RT structures are drawn in patient space with exact slice matching tolerance and zoom-independent stroke width. Do not alter contour Z-snapping logic or opacity scaling without clinical signoff.
- Maintain the current public props/APIs of the overlay component and the selection/edit flows in the viewer.

### Testing and Validation
- Helper smoke: run `scripts/fusebox_resample.py` with a small config to validate Python/ITK stack.
- API smoke: call `/api/fusebox/resampled-slice` for a known CT↔MR/PET pair; ensure `transformSource` is `helper-*`.
- Manifest path: hit `/api/fusion/manifest?primarySeriesId=...` and verify secondaries enumerate with statuses; preload ready secondaries.
- Viewer: confirm overlays align when scrolling and opacity changes; ensure RTSTRUCT tools remain stable (no flashing, accurate slice targeting).

### Cleanup and Refactors – Policy
- Prefer removing dead legacy fusion code and RADFUSE-era toggles. Keep RTSTRUCT and undo/redo paths intact.
- Delete unused server stubs under `server/unused/` and obsolete helpers when no longer referenced.
- Audit dependencies; remove legacy Cornerstone v2 packages if not imported anywhere.
- Gate expensive debug UI and dev-only tooling behind `import.meta.env.DEV`.

### Known Workstreams (condensed)
- Manifest-driven fusion preload on CT select; restrict fusion options to association-derived candidates; surface MR/PET window/level presets.
- Overlay stabilization: request token guards, prefetch neighboring slices, extract viewport math, and unit tests for mm-accurate alignment.
- Registration ingestion: persist multi-REG relationships, allow selection among candidates, and treat shared FoR as non-resample visualization path.

### Troubleshooting Notes
- If overlays “flash” or misalign, validate the active registration candidate and that the helper produced a non-identity H5.
- If build fails on unrelated legacy modules, isolate and track separately; do not block fusion/RTSTRUCT workflows.

### References
- Prior checklists consolidated from `CHECKLIST_FUSEBOX.md` and `CHECKLIST_FUSION.md`.
- Backend fusion modules: `server/fusion/*`
- Viewer fusion entrypoints: `client/src/components/dicom/working-viewer.tsx`, `client/src/lib/fusion-utils.ts`
- RT overlay: `client/src/components/dicom/rt-structure-overlay.tsx`

