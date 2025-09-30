# Agent Memory – Fusion Debug Lessons

This repo has bitten multiple agents in the same places. When you pick up fusion work, read this first.

## Never assume the ingestion path
- The uploader uses `/api/import-triage`, not `/api/import-dicom-metadata`. If you add processing hooks (e.g. registration relationships) make sure both flows call them.
- Series arrive one-by-one. REG files can fire before CT/PT series exist. You must either defer processing until the batch completes or rerun the relationship builder afterward. If you dont, PET↔CT links vanish.

## Manifest filtering
- `FusionManifestService` now filters secondaries through `SeriesSelectionService`. If the selector lacks a relationship, the manifest drops that ID. Explicit requests are allowed, but the UI list still mirrors the selector.
- Always verify new uploads by hitting `/api/fusion/manifest?primarySeriesId=<ct>&secondarySeriesIds=<pet>` and `/api/debug/events?source=fusion-manifest`.

## Documentation hygiene
- Update `agents.md` and this memory file whenever you battle a new gotcha, so the next agent doesnt repeat the same dig.
- Dont assume backfill scripts run automatically. If a fix depends on them, wire the scripts into the import pipeline or document the manual step clearly.
