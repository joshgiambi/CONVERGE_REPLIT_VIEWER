# UI Integration Architecture

**Updated**: 2025-10-02 (evening run)

---

## 🏗️ Architecture Overview

`ViewerV2` uses a slot-based layout so feature teams can drop their UI into defined regions while keeping the legacy look-and-feel.

```
┌─────────────────────────────────────────┐
│           TOOLBAR (top)                 │  ← ViewportControls (Agent 1)
├──────────┬──────────────────────────────┤
│          │                              │
│ SIDEBAR  │        VIEWPORT              │  ← PrimaryViewport + Overlays
│ (left)   │        (center)              │
│          │                              │
│          │                              │
│          │                  ┌─────────┐ │
│          │                  │ PANELS  │ │  ← Floating panels (Fusion / RT)
└──────────┴──────────────────┴─────────┴─┘
```

`ViewerShell` simply renders the supplied nodes:
```tsx
<ViewerShell
  toolbar={<ViewportControls />}
  sidebar={<LegacySeriesSelector />}
  viewport={
    <PrimaryViewport>
      <FusionOverlayLayer opacity={0.5} />
      <RTOverlayLayer />
    </PrimaryViewport>
  }
  panels={
    <FloatingStack>
      <FusionPanel />
      <RTControlPanel />
    </FloatingStack>
  }
/>
```
*(Fusion/RT panels shown here for illustration; FusionPanel integration is still pending.)*

---

## 🎯 Design Principles

1. **UI parity first** – keep the legacy layout, wording, and styling. Only the plumbing underneath changes.
2. **Feature ownership** – each feature agent owns its service + overlay + control panel. Shared layout belongs to Agent 1/5.
3. **Composable slots** – ViewerV2 does not know about specific features; it just renders whatever nodes it receives.

---

## 📦 Component Ownership & Status

| Area | Owner | Status | Notes |
|------|-------|--------|-------|
| ViewerShell / PrimaryViewport / Toolbar | Agent 1 | ✅ Complete | Production ready |
| Fusion overlay & hooks | Agent 2 | ✅ Complete | Overlay integrated; panel pending |
| FusionPanel UI | Agent 2 | ✅ Exists | Needs mounting in ViewerV2 (Agent 5 task) |
| RT overlay + provider | Agent 3 | ✅ Complete | CSS-space math aligned |
| RTControlPanel | Agent 3 | ✅ Core actions | Structure list + union/subtract/grow/shrink wired to services |
| Brush add/erase service | Agent 3 | ✅ Services | Brush handlers migrated; UI toggle reuse legacy toolbar |
| Pen tooling | Agent 3 | 🟡 In progress | Service/UI migration next milestone |
| Panel stack polish | Agent 5 | 🟡 Pending | For final layout tidy + regression |

---

## ✅ Work Delivered Since Last Update

- **RTControlPanel** now exposes boolean union/subtract and grow/shrink buttons hooked to `ContourOperationsService` (`setStructures` + `saveHistory`).
- **Brush add/erase** handlers in `working-viewer.tsx` migrated to `addBrushStroke` / `eraseBrushStroke` service calls, preserving undo/redo.
- **Boolean preview** handler wired; service returns slice-specific preview polygons without mutating state.
- **ViewerV2** wraps the viewport with `RTProvider` and renders overlays/panel while reusing the existing UI components to keep the same visual appearance.

---

## 🔁 Remaining Integration Steps

### Agent 3 (feature team)
1. **Pen tool migration** – move add/cut/close pen handlers into services + provider, then expose via the existing pen toolbar.
2. **Boolean preview trigger** – add a button/toggle in the legacy toolbar or panel that calls `handleBooleanPreview` and clears previews on apply/cancel.
3. **Brush toolbar parity** – ensure the legacy brush toolbar toggles are wired to the provider state (size, mode) and reflect busy status when operations run.

### Agent 2 (fusion)
1. **Mount FusionPanel** – reuse the existing `fusion-control-panel` UI inside `ViewerV2`’s `panels` slot. No visual changes required.

### Agent 5 (integration/polish)
1. **Panel stacking** – once FusionPanel is mounted, introduce a lightweight `PanelStack` helper (or reuse existing CSS) to manage floating panels without overlap.
2. **Regression pass** – verify legacy flows (PET opacity, boolean ops, brush, margins, pen once ready) behave identically in `/viewer-v2`.
3. **Optional polish** – add progress badges/spinners using the existing busy state flags, ensure responsive layout matches old viewer.

---

## 📋 Coordination Checklist

- [ ] Agent 3: Pen tool service/UI migration
- [ ] Agent 3: Boolean preview button + preview clear logic
- [ ] Agent 3: Brush toolbar state routed through provider
- [ ] Agent 2: Add FusionPanel to `ViewerV2` panels slot
- [ ] Agent 5: Panel stack tidy + regression tests
- [ ] Agent 5: Confirm UI parity (screenshots vs legacy viewer)

---

## 📌 Notes on UI Parity

- **Do not redesign**: The refactor must ship with the same visual layout and copy. Reuse existing components (`fusion-control-panel.tsx`, legacy RT toolbars) whenever possible.
- **Service swap, not UI swap**: When migrating handlers, only change the plumbing to call the new services; do not alter component props, CSS classes, or markup.
- **Testing**: Compare `/viewer` and `/viewer-v2` side-by-side to ensure no regressions in appearance or behavior.

---

## Long-Term Ideas (post feature-freeze)

- Collapsible sidebar / accordion for panels.
- Configurable panel placement and persistence.
- Keyboard shortcut palette.
- Dedicated documentation (`docs/RT_STRUCTURES_GUIDE.md`, etc.).

---

**Summary**: The UI layer now routes RT operations through the new services while preserving the legacy interface. Pen tooling and panel integration remain, after which Agent 5 can finalize the viewer for rollout.
