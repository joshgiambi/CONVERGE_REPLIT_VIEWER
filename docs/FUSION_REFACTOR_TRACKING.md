# Fusion Refactor Tracking

**Updated:** 2025-10-02

## Purpose
Keep a running record of how fusion functionality is being lifted out of the legacy viewer and into composable providers, services, and reusable UI modules—without changing the visible UI.

---

## Current Snapshot
- ✅ `FusionProvider` (`client/src/fusion/fusion-context.tsx`) owns manifest fetching, polling, registration, preload progress, opacity, and overlay lookups.
- ✅ `PrimaryViewport` + shared overlay canvas are in place (`client/src/components/viewer/PrimaryViewport.tsx`), so fusion/RT layers now draw through the same CSS-space pipeline.
- ✅ `FusionOverlayLayer` works with the shared viewport context (no local canvas refs, proper DPR handling).
- ✅ Fusion state consumers (`useFusionCandidates`, `useRegistrationOptions`, `useFusionPanel`) are stable and used by both the legacy and refactored viewers.
- 🟡 `FusionPanel` UI exists in `client/src/fusion/components/FusionPanel.tsx` but is not yet mounted in `ViewerV2`; legacy `fusion-control-panel.tsx` still provides the production UI.
- 🟡 ViewerV2 currently shows a placeholder sidebar/panel; Agent 5 will swap in the legacy components during final integration.

---

## Completed Work
| Area | Notes |
|------|-------|
| State ownership | `FusionProvider` encapsulates manifest lifecycle, cache coordination, and overlay retrieval. |
| Service hooks | `useFusionCandidates`, `useRegistrationOptions`, and `useFusionDebug` give typed access to provider state. |
| Overlay rendering | `FusionOverlayLayer` draws PET overlays on the shared overlay canvas with correct transform math. |
| Legacy bridge | `working-viewer.tsx`/`viewer-interface.tsx` now call into the provider for overlays and registration, reducing bespoke cache code. |
| Layout shell | `ViewerShell` and `PrimaryViewport` give fusion (and RT) a clean host without altering the visible UI yet. |

---

## Outstanding Risks / Debt
- ViewerV2 still renders placeholder sidebar/panel content; legacy fusion panel not yet mounted (Agent 5 TODO).
- `viewer-interface.tsx` and `working-viewer.tsx` remain large; they still orchestrate fusion + RT + tool logic until the final UI swap happens.
- FusionPanel (new component) diverges from the legacy UI; ensure parity when Agent 5 integrates it or keep using the existing `fusion-control-panel.tsx` layout.
- No automated regression harness for fusion flows; manual testing required after each integration pass.

---

## Updated Roadmap
1. **UI Parity (in progress)**
   - Import the production `fusion-control-panel.tsx` (and related toolbars) into `ViewerV2` so the refactored viewer matches the legacy UI exactly (Agent 5).
   - Keep FusionPanel available for future redesign, but do not ship it yet.

2. **Legacy cleanup (post UI swap)**
   - Once ViewerV2 hosts the production UI, strip remaining fusion-specific code from `working-viewer.tsx` / `viewer-interface.tsx` (registration refs, cache mutation, polling guards).
   - Remove `window.__fusion` exports and replace remaining debug hooks with `useFusionDebug()`.

3. **Testing & Tooling**
   - Add Storybook / Cypress harnesses that mount `FusionProvider` with mocked manifest responses.
   - Provide a developer-only `<FusionDebugPanel />` behind a feature flag for troubleshooting.

---

## Near-Term Tasks
- **Agent 2**: Supply any missing props/state for the legacy fusion panel so it can run on top of `FusionProvider` without UI changes.
- **Agent 5**: Mount the production fusion/RT panels, toolbars, and series selector into the `ViewerShell` slots in `ViewerV2`; verify styling matches `/viewer`.
- **Agent 3**: Continue migrating RT logic (brush/pen) so fusion and RT share the same viewer scaffolding.

---

## Long-Term Enhancements (Optional)
- Refactor `FusionPanel` to replace the legacy UI once parity has been validated.
- Provide configurable panel layouts (PanelStack helper, persistence, drag-to-reposition).
- Move manifest polling & preload metrics into observability dashboards.

---

## Status Tracker
| Item | Owner | Status | Notes |
|------|-------|--------|-------|
| FusionProvider lifecycle | Agent 2 | ✅ Done | Stable since May, 2025 |
| Shared overlay canvas | Agents 1/2/3 | ✅ Done | Fusion + RT draw through same canvas |
| Legacy UI mounting | Agent 5 | 🟡 Pending | Needs to import legacy panels into ViewerV2 |
| Fusion-specific UI redesign | Agent 2/5 | ⏸️ Deferred | Only after parity is confirmed |
| Automated tests | Agent 2/5 | 🔴 Not started | Add after UI parity is delivered |

---

**Next review checkpoint:** After Agent 5 mounts the legacy panels and runs UI regression (target mid‑Oct 2025).
