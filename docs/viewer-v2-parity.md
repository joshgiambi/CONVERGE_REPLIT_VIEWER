# Viewer V2 Parity Mapping

## Series panel and fusion integration
- **Legacy implementation**: The original viewer wired `SeriesSelector` with fusion candidates, RT loaders, structure visibility/color callbacks, localization toggles, and auto zoom/localize hooks inside the fusion shell sidebar.【F:client/src/components/dicom/viewer-interface.tsx†L1497-L1550】
- **Viewer V2**: The refactored component passes the same callbacks (including localization state, fusion statuses, and auto zoom/localize handlers) to `SeriesSelector`, ensuring the series list, RT management, and fusion panel behavior match legacy expectations.【F:client/src/components/viewer/ViewerV2.tsx†L796-L830】

## Structure localization workflow
- **Legacy implementation**: Selecting a structure in localization mode computed centroid/slice bounds and triggered navigation via `handleStructureLocalization`, while the toolbar toggle controlled the mode state.【F:client/src/components/dicom/viewer-interface.tsx†L1368-L1436】
- **Viewer V2**: `handleStructureLocalization`, `handleAutoLocalize`, and the localization toggle replicate the centroid math, timeout management, and toolbar wiring so structure selections continue to recenter the viewport when localization mode is active.【F:client/src/components/viewer/ViewerV2.tsx†L536-L635】【F:client/src/components/viewer/ViewerV2.tsx†L845-L863】

## Auto zoom/localize viewport behavior
- **Legacy implementation**: The legacy `WorkingViewer` reacted to `autoLocalizeTarget` (and historically `autoZoomLevel`) by adjusting pan offsets and slice index toward the requested centroid.【F:client/src/components/dicom/working-viewer.tsx†L2880-L2924】
- **Viewer V2**: `PrimaryViewport` now listens for `autoZoomLevel` and `autoLocalizeTarget`, applying the same zoom reset, pan offsets, and nearest-slice selection so automated navigation behaves identically in the new architecture.【F:client/src/components/viewer/PrimaryViewport.tsx†L180-L292】

## Toolbar parity
- **Legacy implementation**: The viewer toolbar exposed contour, fusion, and localization actions alongside undo/redo history controls.【F:client/src/components/dicom/viewer-interface.tsx†L1680-L1713】
- **Viewer V2**: The toolbar wiring preserves those hooks (including localization toggle, contour modes, and undo/redo bindings) to maintain the same UX affordances in the refactored shell.【F:client/src/components/viewer/ViewerV2.tsx†L844-L883】
