# Viewer Function Mapping & Migration Plan

**Updated:** 2025-10-02

## Executive Summary

The refactor goal remains: re-host the legacy viewer UI on top of modular providers/services without changing the visible UX. Most core plumbing is now complete:

- ✅ `PrimaryViewport` (Agent 1) handles CT rendering, zoom/pan, shared overlay canvas.
- ✅ Fusion and RT overlays run through the shared viewport using `FusionProvider` / `RTProvider` (Agents 2 & 3).
- ✅ Major legacy handlers (fusion boolean ops, margins, brush add/erase) now call the new service layer via `commitRtStructures` / provider APIs.
- 🟡 Legacy UI components still need to be mounted in `ViewerV2` so the refactored route (`/viewer-v2`) looks identical to `/viewer` (Agent 5).
- 🟡 Pen tooling + final RT UI wiring are the last big feature items (Agent 3).

## Current Status by Agent

### Agent 1 – Viewer Core
- `PrimaryViewport.tsx`, `ViewerShell.tsx`, `ViewportControls.tsx`, and `useViewportInteractions.ts` are production ready.
- No further action required unless new providers need additional hooks.

### Agent 2 – Fusion Layer
- `FusionProvider`, hooks (`useFusionCandidates`, `useRegistrationOptions`, `useFusionPanel`, `useFusionDebug`), and `FusionOverlayLayer` are complete.
- **TODO (with Agent 5):** Mount the existing `fusion-control-panel.tsx` (legacy UI) into `ViewerV2` once provider wiring is confirmed.

### Agent 3 – RT Structures
- `RTProvider`, `RTOverlayLayer`, `RTControlPanel`, and `ContourOperationsService` now cover union/subtract/intersect, margins (uniform + anisotropic), grow/shrink, brush add/erase, and multi-slice previews.
- Legacy handlers in `working-viewer.tsx` call the service layer via `commitRtStructures`.
- **Remaining:** migrate pen tooling, add boolean preview trigger, surface brush toolbar state via provider.

### Agent 4 – Services & Hooks
- Foundation layer (`useDICOMImages`, `useSeriesData`, metadata services, etc.) is stable and already consumed by Agents 1–3. No open work.

### Agent 5 – Integration & Testing
- Upcoming focus: import the legacy UI components (viewer toolbar, contour toolbar, fusion panel, series selector) into `ViewerV2` slots so `/viewer-v2` and `/viewer` look identical.
- Run regression testing once Agents 2/3 finish their remaining items.

## Updated Work Breakdown (Q4 2025)

### Phase 1 – Service/Provider Migration ✅
- PrimaryViewport, providers, overlay layers, and core contour services are complete.

### Phase 2 – Feature Wiring 🟡 In Progress
1. Agent 3: Finish pen tooling + preview UI hook-up.
2. Agent 2 & Agent 5: Mount legacy fusion panel in ViewerV2.
3. Agent 3: Ensure the brush/pen toolbars use provider state but keep legacy UI.

### Phase 3 – UI Parity & Regression (Agent 5)
- Import existing UI components into `ViewerV2` slots without restyling.
- Verify `/viewer-v2` visually matches `/viewer` (side-by-side checks, screenshots).
- Run fusion + RT integration tests (manual or automated) to confirm behavior parity.

### Phase 4 – Cleanup & Documentation
- Remove redundant legacy code paths from `working-viewer.tsx` once `/viewer-v2` is production ready.
- Document provider usage (`docs/RT_STRUCTURES_GUIDE.md`, fusion README update).

## Risk Assessment (Updated)

| Risk | Owner | Mitigation |
|------|-------|------------|
| Pen tooling migration | Agent 3 | Prioritize service extraction + provider wiring before UI swap |
| Fusion panel parity | Agents 2 & 5 | Reuse legacy component; no redesign |
| UI divergence during integration | Agent 5 | Snapshot `/viewer` vs `/viewer-v2` before launch |
| Testing gap | Agents 2/3/5 | Add targeted smoke tests once panels wired |

## Success Criteria
- [ ] `/viewer-v2` matches `/viewer` visually and functionally.
- [ ] Fusion overlay toggles/opacity work via provider (legacy panel reused).
- [ ] RT panel operations (boolean, margins, brush/pen) call service layer with undo support.
- [ ] Legacy viewer remains functional until feature flag flip.
- [ ] Documentation explains how to mount legacy UI on top of providers.

## Dependency Graph (Refined)
```
ViewerV2 (composition)
├── ViewerShell (Agent 1)
│   ├── toolbar slot ← Legacy viewer toolbar (Agent 5)
│   ├── sidebar slot ← Legacy series selector (Agent 5)
│   └── panels slot ← Fusion control panel + RT control panel (Agents 2 & 3)
├── RTProvider (Agent 3)
│   └── PrimaryViewport (Agent 1)
│       ├── FusionOverlayLayer (Agent 2)
│       └── RTOverlayLayer (Agent 3)
└── Providers/Services (Agent 4 foundation)
```

---

**Next check-in:** After Agent 3 lands pen tooling and Agent 5 mounts the legacy panels (target mid‑Oct 2025).
