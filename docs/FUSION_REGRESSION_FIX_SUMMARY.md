# Fusion Regression Fix - Implementation Summary

## Overview

This document summarizes the implementation of the Frame of Reference (FoR) only registration handling fix that resolves PET fusion regression issues.

## Problem Statement

PET fusion would disappear when DICOM REG files only contained Frame of Reference UIDs without explicit Series Instance UID references. This is a common pattern in PET/CT fusion scenarios.

## Solution Components

### 1. Registration Ingest Enhancement

**File**: `server/services/registration-relationship-service.ts`

**Changes**:
- Added FoR-only registration detection in `processREGSeries()`
- When REG file has FoR UIDs but no Series UIDs, system now:
  - Logs "FoR-only registration detected"
  - Finds all series matching source/target Frame of Reference UIDs
  - Creates `series_registration_relationships` with type `frame-of-reference`
  - Uses confidence score 0.9 and method `DICOM-REG-FoR`

**Code Block**:
```typescript
// FoR-only registration: If we have FoR UIDs but no explicit series references,
// still create relationships for all series matching those FoRs
if (sourceSeries.length === 0 && targetSeries.length === 0) {
  if (regInfo.sourceFrameOfReferenceUID && regInfo.targetFrameOfReferenceUID) {
    // Create frame-of-reference type relationships for all matching series
  }
}
```

### 2. Series Selection Service Integration

**File**: `server/services/series-selection-service.ts`

**Changes**:
- Added `frame-of-reference` to `RegistrationRelationshipType` union
- Added logger import
- Enhanced `getFusionCandidatesForSeries()` to:
  - Recognize `frame-of-reference` relationship type
  - Log when FoR-only registrations are included in candidates
  - Traverse these relationships like other registration types

**Code Block**:
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

### 3. Transform Resolution Metadata Enhancement

**File**: `server/fusion/fusebox.ts`

**Changes**:
- Extended `FuseboxTransformSource` type to include `frame-of-reference`
- Enhanced `FuseboxTransformInfo` type with:
  - `sourceFrameOfReferenceUid`
  - `targetFrameOfReferenceUid`
  - `referencedSeriesInstanceUids`
- Added debug event emission when FoR-based transforms are selected
- Preserved FoR metadata through helper processing

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

**File**: `server/fusion/manifest-service.ts`

**Changes**:
- Modified `buildManifest()` to allow explicitly requested secondary series
- When `secondarySeriesIds` are explicitly provided:
  - Bypass automatic candidate filtering
  - Warn (instead of silently dropping) when requested series aren't in candidates
- Maintains test harness and manual tooling usability

**Logic**:
```typescript
const explicitlyRequested = secondarySeriesIds.length > 0;
const filteredSecondaryIds = explicitlyRequested 
  ? requestedSecondaries  // Allow explicitly requested IDs
  : requestedSecondaries.filter((id) => candidateIds.has(id));
```

### 5. Test Harness Harmonization

**File**: `server/routes.ts`

**Changes**:
- Rewrote `/api/fusebox/test-slices` endpoint to use manifest service
- Test harness now:
  - Calls `fusionManifestService.getManifest()`
  - Uses same logic path as production viewer
  - Surfaces same failures client would see
  - Returns manifest metadata (path, output directory)

**Benefits**:
- QA exercises identical fusion logic
- Debugging insights match production behavior
- No divergence between test and production paths

### 6. Database Schema Additions

**New Relationship Type**: `frame-of-reference`

**Validation Metrics Example**:
```json
{
  "source": "REG-file-frame-of-reference",
  "sourceFrameOfReferenceUID": "1.2.840.113619.2.55...",
  "targetFrameOfReferenceUID": "1.2.840.113619.2.55..."
}
```

**Registration Method**: `DICOM-REG-FoR`

**Confidence Score**: 0.9 (vs 0.95 for explicit series references)

### 7. Documentation

**New Files**:
- `docs/FRAME_OF_REFERENCE_REGISTRATION.md` - Comprehensive FoR handling guide
- `docs/FUSION_REGRESSION_FIX_SUMMARY.md` - This file

**Updated Files**:
- `agents.md` - Added FoR handling section with quick troubleshooting

## Debug Sources

### New Debug Event Sources

1. **`frame-of-reference`**: Transform selection when FoR-based matching occurs
2. **`fusion-manifest`**: Enhanced with FoR filtering warnings
3. **`fusebox`**: Existing helper/resample events

### Debug Endpoints

```bash
# Check FoR transform selection
curl "http://localhost:3000/api/debug/events?source=frame-of-reference&limit=50"

# Check manifest filtering warnings
curl "http://localhost:3000/api/debug/events?source=fusion-manifest&level=warn"

# Check helper events
curl "http://localhost:3000/api/debug/events?source=fusebox&limit=50"
```

## Troubleshooting Quick Reference

### If PET Fusion Disappears

1. **Check fusion candidates**:
   ```bash
   curl "http://localhost:3000/api/series/{CT_SERIES_ID}/fusion-candidates"
   ```

2. **Check manifest debug events**:
   ```bash
   curl "http://localhost:3000/api/debug/events?source=fusion-manifest"
   ```
   Look for: "Requested secondary series are not valid fusion candidates"

3. **Verify FoR relationships exist**:
   ```sql
   SELECT * FROM series_registration_relationships 
   WHERE relationship_type = 'frame-of-reference';
   ```

4. **Check FoR transform selection**:
   ```bash
   curl "http://localhost:3000/api/debug/events?source=frame-of-reference"
   ```

## Migration / Backfill

To backfill existing data, re-process all REG series:

```javascript
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

## Testing Checklist

- [ ] REG file upload creates `frame-of-reference` relationships
- [ ] PET series appears in fusion candidates for CT
- [ ] Manifest service accepts explicit secondary series IDs
- [ ] Test harness uses manifest service path
- [ ] Debug events show FoR-based transform selection
- [ ] Manifest filtering warns instead of silently dropping
- [ ] Transform metadata carries FoR UIDs through pipeline

## Files Modified

1. `server/services/registration-relationship-service.ts`
2. `server/services/series-selection-service.ts`
3. `server/fusion/fusebox.ts`
4. `server/fusion/manifest-service.ts`
5. `server/routes.ts`
6. `agents.md`
7. `docs/FRAME_OF_REFERENCE_REGISTRATION.md` (new)
8. `docs/FUSION_REGRESSION_FIX_SUMMARY.md` (new)

## Related Documentation

- [Frame of Reference Registration](./FRAME_OF_REFERENCE_REGISTRATION.md) - Complete FoR handling documentation
- [Registration Relationships System](./REGISTRATION_RELATIONSHIPS.md) - Registration system overview
- [Fusion Integration Status](./FUSION_INTEGRATION_STATUS.md) - Fusion system status
- [Logging System](./LOGGING_SYSTEM.md) - Debug event system

## Implementation Date

Implementation completed: 2025-01-30

## Notes

- All changes are backwards compatible
- Existing explicit series-based registrations continue to work
- FoR-only registrations complement existing relationship types
- Test harness harmonization ensures production parity


