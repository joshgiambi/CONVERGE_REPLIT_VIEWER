# Project TODOs (Engineers + Agents)

This is a living, prioritized checklist to guide work across viewer, server, and geometry pipelines. Each task references concrete files and includes clear outcomes. Keep entries small, verifiable, and PR‑scoped.

Legend: [ ] todo, [~] in progress, [x] done

## P0 — Stabilize Core Viewer Flow (High Impact)

- [ ] Split `WorkingViewer` into focused modules
  - Files: `client/src/components/dicom/working-viewer.tsx`
  - Create modules under `client/src/components/dicom/viewer/`:
    - viewer-renderer.ts (CPU/GPU switch, LUT, throttling)
    - viewer-cache.ts (primary/secondary/MPR caches, prefetch, aborts)
    - viewer-interaction.ts (scroll/zoom/pan/crosshair)
    - viewer-fusion.ts (MRI→CT mapping + overlay cadence)
    - viewer-contours.ts (add/erase/merge/smooth/grow/boolean bridge)
    - viewer-undo.ts (debounced saves + history events)
  - Outcomes: Smaller components, fewer re-renders, no global `window.*` for cache/zoom.

- [ ] Introduce `ViewerContext`
  - Files: new `client/src/components/dicom/viewer/context.tsx`
  - Expose: zoom/pan/crosshair, caches, WL, slice arrays, event dispatchers
  - Replace usages of `window.__WV_CACHE__`, `window.currentViewerZoom`

- [ ] Unify constants for slice matching and render cadence
  - Files: `client/src/lib/dicom-spatial-helpers.ts`, `client/src/components/dicom/working-viewer.tsx`, `client/src/components/dicom/mpr-floating.tsx`
  - Define single `SLICE_TOL_MM`, `RENDER_THROTTLE_MS`, and reuse everywhere
  - Outcome: Predictable overlays, fewer ghost contours

- [ ] Dedupe duplicate image route on server
  - Files: `server/routes.ts` (two definitions for `GET /api/images/:sopInstanceUID`)
  - Outcome: Single canonical handler with appropriate headers (Content-Type, ETag)

## P1 — Geometry Offload + Cache Hygiene (Perf)

- [ ] Workerize boolean operations
  - Files: `client/src/lib/clipper-boolean-operations.ts`, new `client/src/workers/boolean.worker.ts`
  - Move union/intersect/subtract into worker; expose typed API; keep scale/tolerance shared
  - Outcome: No main‑thread stalls during boolean ops

- [ ] Normalize image caches
  - Files: `client/src/components/dicom/working-viewer.tsx`
  - Merge `imageCacheRef` and `secondaryImageCacheRef` into a typed cache interface; add cache stats/limits/eviction
  - Cancel in‑flight on series switch via `seriesAbortRef`

- [ ] Server: precomputed series metadata
  - Files: `server/routes.ts`, `server/storage.ts`
  - Add endpoint returning: sorted Z array, default WL, pixel spacing, dimensions; avoid client recompute
  - Outcome: Faster series load; fewer client passes

- [ ] Add basic caching headers for images
  - Files: `server/routes.ts`
  - Set `ETag`, `Cache-Control` for `GET /api/images/:sopInstanceUID`

## P2 — Viewer UX + Orchestration

- [ ] Refactor `ViewerInterface` into hooks
  - Files: `client/src/components/dicom/viewer-interface.tsx`
  - Create: `useSeries`, `useRTStructures`, `useFusionAssociations`, `useToolsState`, `useHistorySync`
  - Outcome: Simpler component tree; easier unit tests

- [ ] Split `SeriesSelector` UI
  - Files: `client/src/components/dicom/series-selector.tsx`
  - Subcomponents: SeriesList, RTList (virtualized), StructureControls (visibility/color), FusionAssociations
  - Share auto‑zoom/localize util with viewer for consistent math

- [ ] Toolbar state from props
  - Files: `client/src/components/dicom/viewer-toolbar.tsx`
  - Remove internal `activeTool` duplication; render based on props, lift state to interface

- [ ] Fusion panel polish
  - Files: `client/src/components/dicom/fusion-control-panel.tsx`, `client/src/lib/fusion-utils.ts`
  - Show association confidence/notes; cache transformed MRI positions per primary/secondary pair

## P3 — Margin Operations Consolidation

- [ ] Select canonical margin pathway
  - Files (candidates):
    - `client/src/lib/morphological-margin-operations.ts`
    - `client/src/lib/enhanced-margin-operations.ts`
    - `client/src/lib/volumetric-margin-operations.ts`
    - `client/src/lib/volumetric-margin-operations-optimized.ts`
    - `client/src/lib/true-3d-margin-operations.ts`
    - `client/src/lib/anisotropic-margin-operations.ts`
  - Design one API: inputs (contours, parameters), outputs (contours), preview mode, workerized execution
  - Mark deprecated modules and route callers through a shim

## P4 — Types, Testing, Logging

- [ ] Unify RT structure types
  - Files: `client/src/lib/dicom-types.ts`, `shared/schema.ts`, UI components using `any`
  - Define DTOs for UI (structure, contour, sets) and replace `any`

- [ ] Unit tests for fusion and boolean
  - Files: `client/src/lib/fusion-utils.ts`, boolean worker
  - Cases: non‑orthogonal orientations, missing orientation fallback, rigid matrix validation, degenerate polygons, holes

- [ ] Centralize client logging
  - Files: `client/src/lib/log.ts`
  - Ensure level gated by `VITE_LOG_LEVEL`; use consistently across components

## Cleanup & Deprecations

- [ ] Confirm and remove unused/legacy components
  - Already excluded via tsconfig: `client/src/components/dicom/unused/**`, `server/unused/**`
  - Validate and remove if safe:
    - `client/src/components/dicom/BooleanPanel.tsx`
    - `client/src/components/dicom/fusion-panel.tsx`
    - `client/src/components/dicom/multi-viewport.tsx`
    - `client/src/components/dicom/rt-structure-overlay.tsx`

- [ ] Maintain `docs/CODEBASE_CLEANUP_REPORT.md`
  - Files: `docs/CODEBASE_CLEANUP_REPORT.md`
  - Append moves/deprecations; keep TS exclude up to date (`tsconfig.json`)

## Developer Notes (How‑Tos)

- Slice tolerance constant
  - Canonical: `SLICE_TOL_MM` in `client/src/lib/dicom-spatial-helpers.ts`
  - Match in `mpr-floating.tsx` and viewer overlay logic (no ad‑hoc tolerances)

- Boolean scaling
  - Clipper scale: see `client/src/lib/clipper-boolean-operations.ts` → `SCALE`
  - Keep scale/tolerance consistent between main thread and worker

- Workers
  - DICOM parsing: `client/src/lib/dicom-worker-manager.ts`, `client/src/workers/dicom-parser.worker.ts`
  - New boolean worker should mirror pattern: chunking, transferable buffers

## Quick Validation Steps

- Series load
  - Load CT series: verify initial WL from first image metadata
  - Scroll: 60fps target without fusion; no contour ghosting

- Boolean ops
  - Run union/subtract on two overlapping structures; no UI freeze; results per slice are topologically valid

- Fusion
  - With registration available, scrub: MRI overlay follows CT correctly; no stutter after idle re‑render

- Undo/Redo
  - Brush edit → Undo → Redo; state and toolbar history update consistently

## Helpful rg Queries (for agents)

- Find DICOM API calls: `rg -n "fetch\(\s*['\"]/api/" client/src`
- Where `WorkingViewer` is used: `rg -n "WorkingViewer" client/src`
- Unused components (open imports): `for f in client/src/components/dicom/*.tsx; do bn=$(basename \"$f\" .tsx); rg -n \"import .*${bn}\" -S || true; done`

## Recently Done (keep updated)

- Export and RT save endpoints added; viewer save wired
- Unused code moved under `client/src/components/dicom/unused/**` and excluded in `tsconfig.json`
- See: `docs/CODEBASE_CLEANUP_REPORT.md`

---

Owners: add your handle next to tasks you pick up. Keep checkboxes current in PRs.
