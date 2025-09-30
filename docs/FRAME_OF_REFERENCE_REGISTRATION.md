# Frame of Reference (FoR) Only Registration Handling

## Overview

Some DICOM REG (Registration) files reference Frame of Reference UIDs without explicitly referencing Series Instance UIDs. This is common in PET/CT fusion scenarios where the registration relates entire coordinate systems rather than specific series.

This document describes how the system handles these FoR-only registrations to enable PET↔CT fusion in both production and the test harness.

## Problem Statement

**Original Issue**: PET fusion would disappear when the REG file only contained Frame of Reference UIDs without explicit Series Instance UID references.

**Root Cause**: The registration relationship service (`processREGSeries`) only created `series_registration_relationships` entries when it could match both source and target series by Series Instance UID or by FoR. When no Series UIDs were present, no relationships were created, causing the series selection service to exclude PET from fusion candidates.

## Solution

### 1. FoR-Only Registration Detection

When `parseDicomRegistrationFromFile` returns matching `sourceFrameOfReferenceUid` and `targetFrameOfReferenceUid` but no `referencedSeriesInstanceUids`, the system now:

1. **Detects the FoR-only pattern** and logs it
2. **Finds all series** in the patient matching those Frame of Reference UIDs
3. **Creates `series_registration_relationship` entries** with type `frame-of-reference`

**Code Location**: `server/services/registration-relationship-service.ts` → `processREGSeries()`

```typescript
// FoR-only registration: If we have FoR UIDs but no explicit series references,
// still create relationships for all series matching those FoRs
if (sourceSeries.length === 0 && targetSeries.length === 0) {
  if (regInfo.sourceFrameOfReferenceUID && regInfo.targetFrameOfReferenceUID) {
    logger.info({
      regSeriesId: seriesId,
      sourceFrameRef: regInfo.sourceFrameOfReferenceUID?.substring(0, 30),
      targetFrameRef: regInfo.targetFrameOfReferenceUID?.substring(0, 30)
    }, 'FoR-only registration detected (no Series Instance UIDs referenced)');

    // Create relationships...
  }
}
```

### 2. Series Selection Service Integration

The `SeriesSelectionService.getFusionCandidatesForSeries()` now:

1. **Recognizes the `frame-of-reference` relationship type** (added to the union type)
2. **Logs when FoR-only registrations are included** in the fusion candidate graph
3. **Traverses these relationships** just like explicit series-based registrations

**Code Location**: `server/services/series-selection-service.ts` → `getFusionCandidatesForSeries()`

```typescript
// Log when a FoR-only registration is auto-generated
if (row.relationshipType === 'frame-of-reference') {
  logger.info({
    primarySeriesId: currentSeriesId,
    secondarySeriesId: row.seriesId,
    relationshipType: row.relationshipType,
    confidence,
    depth
  }, 'FoR-only registration included in fusion candidates');
}
```

### 3. Transform Resolution Metadata

The `resolveFuseboxTransform()` function now:

1. **Carries FoR metadata** through the transform resolution pipeline
2. **Marks the transform source** appropriately (including `'frame-of-reference'` as a valid source)
3. **Emits debug events** when FoR-based transforms are selected

**Code Location**: `server/fusion/fusebox.ts` → `resolveFuseboxTransform()`

**Type Definition**:
```typescript
export type FuseboxTransformInfo = {
  matrix?: number[];
  filePath?: string;
  transformFile?: string;
  transformSource?: FuseboxTransformSource;
  registrationId?: string;
  sourceFrameOfReferenceUid?: string | null;
  targetFrameOfReferenceUid?: string | null;
  referencedSeriesInstanceUids?: string[];
};
```

### 4. Manifest Service Filter Relaxation

The manifest service now:

1. **Allows explicitly requested secondary series** even if not in automatic candidates
2. **Warns (instead of silently dropping)** when requested series aren't in the candidate list
3. **Keeps the test harness usable** for bespoke/manual fusion requests

**Code Location**: `server/fusion/manifest-service.ts` → `buildManifest()`

```typescript
// When explicit secondarySeriesIds are provided, allow them through even if not in candidates
const explicitlyRequested = secondarySeriesIds.length > 0;
const filteredSecondaryIds = explicitlyRequested 
  ? requestedSecondaries  // Allow explicitly requested IDs
  : requestedSecondaries.filter((id) => candidateIds.has(id));  // Auto-select only candidates
```

### 5. Harmonized Test Harness

The fusion test harness (`/api/fusebox/test-slices`) now:

1. **Uses the manifest service** for fusion generation (same path as the viewer)
2. **Exercises identical logic** to what production uses
3. **Surfaces the same failures** the client would see

**Code Location**: `server/routes.ts` → `/api/fusebox/test-slices`

## Database Schema

### `series_registration_relationships` Table

**New Relationship Type**: `frame-of-reference`

```typescript
{
  primarySeriesId: number;
  secondarySeriesId: number;
  registrationId: null;
  registrationFilePath: string;  // Path to REG DICOM file
  transformMatrix: null;
  inverseTransformMatrix: null;
  transformHash: null;
  relationshipType: 'frame-of-reference',
  confidenceScore: 0.9,
  registrationMethod: 'DICOM-REG-FoR',
  geometricValidationPassed: true,
  validationMetrics: {
    source: 'REG-file-frame-of-reference',
    sourceFrameOfReferenceUID: string,
    targetFrameOfReferenceUID: string
  }
}
```

**Comparison to Other Types**:
- `rigid` / `deformable`: Explicit series-to-series registration from REG file
- `shared-frame`: Series in the same study sharing a Frame of Reference UID
- `frame-of-reference`: REG file with only FoR UIDs, no Series UIDs

## Debug Sources

### New Debug Event Sources

1. **`frame-of-reference`**: Transform selection events when FoR-based matching occurs
   ```bash
   curl "http://localhost:3000/api/debug/events?source=frame-of-reference&limit=50"
   ```

2. **`fusion-manifest`**: Manifest lifecycle events (already existed, now enhanced)
   ```bash
   curl "http://localhost:3000/api/debug/events?source=fusion-manifest&level=warn"
   ```

3. **`fusebox`**: Helper and resample events (already existed)
   ```bash
   curl "http://localhost:3000/api/debug/events?source=fusebox&limit=50"
   ```

## Troubleshooting

### Problem: PET Fusion Disappeared

**Symptoms**:
- PET series not appearing in fusion candidates
- Viewer doesn't show PET as fusible with CT

**Diagnosis Steps**:

1. **Check if registration relationships exist**:
   ```bash
   curl "http://localhost:3000/api/series/{CT_SERIES_ID}/fusion-candidates"
   ```
   Expected: PET series should appear in the list

2. **Check debug events for manifest filtering**:
   ```bash
   curl "http://localhost:3000/api/debug/events?source=fusion-manifest"
   ```
   Look for: "Requested secondary series are not valid fusion candidates"

3. **Check FoR-only registration detection**:
   ```bash
   curl "http://localhost:3000/api/debug/events?source=frame-of-reference"
   ```
   Expected: "FoR-based transform selected" events

4. **Query the database**:
   ```sql
   SELECT * FROM series_registration_relationships 
   WHERE relationship_type = 'frame-of-reference';
   ```

### Problem: FoR-Only Registration Not Created During Ingest

**Symptoms**:
- REG file uploaded but no `frame-of-reference` relationships created
- Logs show "FoR-only registration detected" but no entries in DB

**Diagnosis Steps**:

1. **Check the REG file parsing**:
   - Verify `sourceFrameOfReferenceUID` and `targetFrameOfReferenceUID` are extracted
   - Check if any series in the patient have matching FoR UIDs

2. **Review server logs** for relationship creation errors:
   ```bash
   grep "Failed to create FoR-only registration relationship" server.log
   ```

3. **Manually trigger relationship processing**:
   - Call `processSeriesRegistrationRelationships(regSeriesId)` for the REG series

### Problem: Manifest Filtering Removes Explicit Requests

**Symptoms**:
- Test harness requests specific secondary series ID
- Manifest returns empty secondaries or excludes requested series

**Diagnosis Steps**:

1. **Check manifest debug events**:
   ```bash
   curl "http://localhost:3000/api/debug/events?source=fusion-manifest&level=warn"
   ```
   Look for: "Requested secondary series are not in automatic fusion candidates (allowing anyway)"

2. **Verify the manifest service is allowing explicit requests**:
   - Check that `explicitlyRequested` is `true` when `secondarySeriesIds` is provided
   - Ensure `filteredSecondaryIds` includes the requested IDs

### Quick Troubleshooting Checklist

- [ ] REG series exists in database with modality `REG`
- [ ] REG file has both `sourceFrameOfReferenceUID` and `targetFrameOfReferenceUID`
- [ ] Series exist with matching Frame of Reference UIDs
- [ ] `series_registration_relationships` has entries with `relationship_type = 'frame-of-reference'`
- [ ] Fusion candidates API includes PET series
- [ ] Debug events show FoR-based transform selection
- [ ] Manifest service allows explicit secondary requests

## Migration / Backfill

### Backfilling Existing Data

If you have existing PET↔CT data that wasn't processed with FoR-only registration support:

1. **Re-process REG series**:
   ```javascript
   // Script to backfill existing REG series
   const { processSeriesRegistrationRelationships } = require('./server/services/registration-relationship-service');
   const { storage } = require('./server/storage');

   async function backfillRegSeries() {
     const allSeries = await storage.getAllSeries();
     const regSeries = allSeries.filter(s => s.modality === 'REG');
     
     for (const reg of regSeries) {
       console.log(`Processing REG series ${reg.id}...`);
       await processSeriesRegistrationRelationships(reg.id);
     }
   }

   backfillRegSeries();
   ```

2. **Verify creation**:
   ```sql
   SELECT COUNT(*) FROM series_registration_relationships 
   WHERE relationship_type = 'frame-of-reference';
   ```

## Related Documentation

- [Registration Relationships System](./REGISTRATION_RELATIONSHIPS.md)
- [Fusion Integration Status](./FUSION_INTEGRATION_STATUS.md)
- [Logging System](./LOGGING_SYSTEM.md)
- [Debug Sidebar Organization](./DEBUG_SIDEBAR_ORGANIZATION.md)

## Implementation Notes

- FoR-only relationships have **confidence score 0.9** (slightly lower than explicit series references at 0.95)
- Registration method is marked as `DICOM-REG-FoR` to distinguish from standard `DICOM-REG`
- The system creates bidirectional relationships (all matching source×target combinations)
- Primary/secondary determination uses image count heuristic (larger = planning CT)


