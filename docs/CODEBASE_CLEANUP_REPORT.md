Codebase Cleanup Report
Date: 2025-09-02

Summary
- Implemented export and RT structure save endpoints on the server.
- Wired the viewer to save RT structures and export selected series as a ZIP.
- Moved obvious unused and backup files into an `unused/` structure and excluded them from TypeScript.
- Reduced noisy server and client logging in development-safe manner.

Key Changes
- New endpoints:
  - POST `/api/rt-structures/:seriesId/save`: Saves current RT structure state (original + edits) into DB tables (`rt_structure_sets`, `rt_structures`, `rt_structure_contours`) with a history snapshot.
  - POST `/api/studies/:studyId/export`: Streams a ZIP of selected series’ DICOM files using `archiver`.

- Viewer updates (`client/src/pages/viewer.tsx`):
  - Export dialog now posts selected series IDs to the export endpoint and downloads the ZIP.
  - Save dialog calls the RT-structures save endpoint using the currently loaded RTSTRUCT series.

- Viewer interface (`client/src/components/dicom/viewer-interface.tsx`):
  - Added optional prop `onLoadedRTSeriesChange` to report the active RTSTRUCT series to parent.
  - Emits the loaded RT series ID when it changes.

- Moved to unused (and excluded from TS):
  - `client/src/components/dicom/simple-viewer.tsx` → `client/src/components/dicom/unused/simple-viewer.tsx`
  - `client/src/components/dicom/brush-tool.tsx` → `client/src/components/dicom/unused/brush-tool.tsx`
  - `client/src/components/dicom/pen-tool.tsx` → `client/src/components/dicom/unused/pen-tool.tsx`
  - `client/src/components/dicom/mpr-viewer.tsx` → `client/src/components/dicom/unused/mpr-viewer.tsx`
  - `client/src/components/dicom/orthogonal-viewer.tsx` → `client/src/components/dicom/unused/orthogonal-viewer.tsx`
  - `client/src/components/patient-manager/patient-card-old.tsx` → `client/src/components/patient-manager/unused/patient-card-old.tsx`
  - `client/src/components/dicom/series-selector.tsx.backup*` → `client/src/components/dicom/unused/backups/`
  - Server examples/tests moved to `server/unused/`.

- TypeScript config (`tsconfig.json`):
  - Added exclusions for `client/src/**/unused/**`, backup files, and `server/unused/**` to speed typechecking and avoid errors from defunct code.

- Logging cleanup:
  - Introduced `isDev` guard for high-volume logs in `server/routes.ts`.
  - Gated debug output in `client/src/pages/viewer.tsx` under `import.meta.env.DEV`.

Notes
- No breaking changes to active imports. Unused files are excluded from compilation.
- Server adds dependency `archiver` for ZIP creation.
- Structure-set save persists a versioned snapshot in DB; future UI can list/reload versions by reading these tables.

Next Suggestions
- Add a small endpoint to list saved RT structure sets per study/patient for UI display.
- Centralize server logging with a tiny logger helper and replace scattered `console.log`.
- Gradually tighten TypeScript types in hot paths (uploader, fusion panel) once existing functionality is verified.

