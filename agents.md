# Agent Operations Guide

This viewer toolkit blends a React/Vite client with an Express + Vite middleware server that serves DICOM data, Fusebox fusion helpers, and manifest-driven overlays. Use this note as the single source of truth when you jump into the codebase.

## Project Layout
- `client/` – React app (Vite) with fusion tooling under `client/src/components/dicom/` and helpers in `client/src/lib/`.
- `server/` – Express entry (`server/index.ts`) registers API routes in `server/routes.ts` and wires the Vite dev middleware.
- `server/fusion/` – Fusion manifest service, Fusebox bridge, and resampler integration.
- `scripts/` – Python helpers (`fusebox_resample_volume.py`, validation scripts) and utilities for data loading.
- `storage/` – Local DICOM hierarchy (`storage/patients/...`). Populate via `node populate-from-storage.js`.
- `build/dicom-reg-converter/` – Compiled ITK/DCMTK helper (`dicom_reg_to_h5`) used when ITK support is enabled.
- `sam_env/` – Python venv expected to contain `SimpleITK`, `numpy`, etc. (`pip install -e .` inside repo).

## Getting Started
1. Install dependencies: `npm install`
2. Ensure local Postgres is running; copy `.env.template` to `.env` and set `DATABASE_URL`.
3. Push schema: `npm run db:push`
4. Populate the DB from local DICOMs (optional): `node populate-from-storage.js`

## Running the Dev Stack (with ITK helper)
- Verify helper prerequisites once: `npm run dev:setup`
  - Confirms `build/dicom-reg-converter/dicom_reg_to_h5` and `sam_env/bin/python` exist.
- Start server + Vite + ITK env: `npm run dev:itk`
  - Exports `DICOM_REG_CONVERTER`, `FUSEBOX_PYTHON`, `PORT=3000`, and runs `tsx watch server/index.ts`.
  - Express hosts API + client at the chosen port; Vite HMR is mounted automatically.
- Quick smoke: visit `http://localhost:3000/fusion-test?patientId=<ID>` to exercise the fusion manifest harness.

## Fusion + Manifest Notes
- `/api/fusion/manifest` is backed by `FusionManifestService` (`server/fusion/manifest-service.ts`).
  - Manifests are cached per primary series and saved under `tmp/fusebox-manifests` via `path-utils.ts`.
  - The service now records lifecycle events in the central debug feed (`source = fusion-manifest`).
- Full-volume resampling is handled by `FuseboxVolumeResampler`, calling `scripts/fusebox_resample_volume.py` through the Python runner.
- Use the Fusion Test page (`client/src/pages/fusion-test.tsx`) to request manifest-backed slices, inspect transforms, and read helper logs.

## Centralised Debug Feed
- All server-side logging (via `server/logger.ts`), Fusebox helper emissions, and manifest lifecycle events stream into an in-memory hub (`server/debug/debug-hub.ts`).
- Fetch everything or filter by source with `/api/debug/events`:
  ```bash
  curl "http://localhost:3000/api/debug/events?source=fusebox&limit=50"
  curl "http://localhost:3000/api/debug/events?source=fusion-manifest&level=info"
  ```
- Legacy `/api/fusebox/logs` now proxies to the same feed for backwards compatibility.
- The fusion test UI already refreshes from `/api/debug/events?source=fusebox`.

## Data Loading & Storage
- DICOM files live under `storage/patients/<PATIENT>/<STUDY>/<SERIES>/*.dcm`.
- Import script: `node populate-from-storage.js` scans storage and creates patients/studies/series/images in Postgres.
- Generated Fusebox volumes + manifests are written beneath `tmp/fusebox-*`; resampler metadata is cached per series pair.

## Useful Commands
- `npm run dev` – Starts server without enforcing ITK helper (falls back to matrix fusion).
- `npm run build` / `npm start` – Production bundle + server runner.
- `python scripts/fusebox_resample_volume.py --help` – Inspect resampler options for manual testing.
- `scripts/fusebox_resample_volume.py` expects JSON configs under `tmp/` (see manifest service for examples).

## Troubleshooting Checklist
- `npm run dev:setup` fails → rebuild helper (`cmake --build build/dicom-reg-converter`) or recreate `sam_env` then `pip install -e .`.
- Missing fusion overlays → hit `/api/debug/events?source=fusion-manifest` for manifest state, confirm resample succeeded and outputs exist under `tmp/fusebox-*`.
- Helper unavailable errors (`FUSEBOX_*`) → ensure `FUSEBOX_PYTHON` points at the venv; run `scripts/start-fusebox.sh` as a convenience wrapper.
- TypeScript linting: `npm run check` still surfaces legacy uploader/contour type errors (documented in checklist).

Keep this file updated whenever routes, scripts, or startup flows change so the next agent can ramp instantly.
