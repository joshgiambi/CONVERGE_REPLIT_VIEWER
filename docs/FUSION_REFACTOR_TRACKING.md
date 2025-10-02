# Fusion Refactor Tracking

## Purpose
Create a maintainable, testable fusion experience by extracting manifest/overlay orchestration from monolithic viewer components into dedicated stores, hooks, and composable UI layers.

## Current Snapshot (2025-02-??)
- **FusionProvider** (`client/src/fusion/fusion-context.tsx`) now owns manifest fetching, polling, preload progress, opacity, windowing, and overlay lookups.
- `viewer-interface.tsx` and `working-viewer.tsx` consume fusion state via provider props instead of managing bespoke caches.
- Core outcome: Fusion overlay logic is shareable, but viewer files still contain intertwined responsibilities (fusion + RT + tools + layout).

## Completed Work
| Area | Notes |
| --- | --- |
| Fusion state ownership | Added FusionProvider with manifest lifecycle, cache coordination, preload progress, and overlay accessor. |
| Viewer integration | Updated ViewerInterface to wrap content in provider; WorkingViewer delegates overlay fetch via provider when available. |
| Layout shell | Introduced `FusionViewerShell` to centralize sidebar/viewport/toolbar composition in ViewerInterface. |
| Overlay manager contract | Exported `OverlayCanvas` type and unified access for server/client slices. |

## Outstanding Risks / Debt
- `working-viewer.tsx` retains legacy state (window globals, registration matrix stubs, direct cache mutation).
- `viewer-interface.tsx` still exceeds 2k LOC; fusion panel, RT tooling, and selection logic live in a single component.
- Debug hooks (`__fusion`), cache invalidation, and registration selection remain tangled in viewer layer.

## Upcoming Milestones
1. **Decompose viewer into feature-focused components**
   - Extract fusion overlay presentation and controls into a dedicated layer using provider state.
   - Move RT structure management into its own provider/hook.
   - Isolate toolbars and orchestration logic from rendering surface.
2. **Legacy fusion cleanup**
   - Remove inline manifest polling, cache refs, and token/cooldown guards now superseded by FusionProvider.
   - Consolidate registration handling inside a dedicated service/hook.
3. **Testing & harnesses**
   - Add Storybook or lightweight Cypress harness to exercise fusion overlay with mocked manifests.

## Next PR Draft – “Fusion Viewer Decomposition: Phase 1”
**Goal**: Carve `viewer-interface.tsx` and `working-viewer.tsx` into composable pieces that consume the shared fusion store, reducing surface area per file and enabling targeted tests.

### Scope & Requirements
1. **Create a viewer layout shell**
   - New component `FusionViewerShell` handles layout & global UI (series sidebar, toolbar frame).
   - `ViewerInterface` becomes a coordinator that wires data providers and passes props to shell.
2. **Extract fusion-specific UI**
   - Move fusion panel logic into `FusionPanel` (controls + status badges) consuming `useFusion()` directly.
   - Add `useFusionPanel()` hook for status mapping (ready/loading/error) and opacity presets.
3. **Isolate WorkingViewer responsibilities**
   - Split into: `PrimaryViewport` (CT render + overlays), `FusionOverlayLayer` (canvas compositing), `RTOverlayLayer`, and `ViewportControls` (crosshairs, zoom, MPR toggles).
   - Each subcomponent receives explicit props; eliminate cross-cutting refs except via controlled callbacks.
4. **Registration handling**
   - Introduce `useRegistrationOptions(primaryId, secondaryId)` hook encapsulating association lookups, matrix resolution, and selection state.
   - Replace scattered registration state with hook outputs; persist selection in provider or dedicated context.
5. **Debug & developer tooling**
   - Remove `window.__fusion` exports; expose a `useFusionDebug()` hook that returns snapshot data for dev panels.
   - Build a developer-only `<FusionDebugPanel />` rendered behind feature flag/environment check.

### Acceptance Criteria
- No component in fusion viewer stack exceeds ~500 LOC; each layer has single responsibility.
- Viewer renders without legacy refs (`fusionManagerRef`, `fusionPrefetchSetRef`, `MAX_INIT_ATTEMPTS`) unless encapsulated in new hooks/providers.
- Switching secondaries updates overlays exclusively through provider; no direct cache mutation from `working-viewer`.
- TypeScript passes for touched files; add focused unit/Storybook stories for `FusionPanel` and `PrimaryViewport`.
- Documentation: update this tracking file and add README snippet under `client/src/fusion/` describing provider & hooks.

### Implementation Steps
1. Scaffold new components/hooks (fusion panel, primary viewport, registration hook).
2. Incrementally migrate logic from `working-viewer.tsx`, removing legacy refs as functionality moves over.
3. Update imports/sites to use decomposed components; ensure lint/tsc passes.
4. Add stories/tests; verify dev workflow with mock manifest.
5. Final cleanup: delete redundant state, update docs, attach PR checklist.

### Testing Strategy
- Unit tests for hooks (`useFusionPanel`, `useRegistrationOptions`).
- Storybook stories showing CT-only, CT+PET ready, and loading/error states.
- Cypress/Playwright smoke: verify overlay toggles and opacity adjustments with mocked API.

---
_Last updated: 2025-02-14_
