# Frontend Filtering Update - Aligned with Fusion Manifest

## Problem

The `viewer-interface.tsx` had **two conflicting filtering systems**:

1. **`shouldHideSeries()`**: Ad-hoc rules using keyword matching and modality checks
2. **Fusion Manifest**: Backend service determining fusable series via registration relationships

This caused series to be filtered inconsistently - some fusable series were hidden while non-fusable series were shown.

## Solution

**Replaced ad-hoc filtering with fusion manifest rules** in `shouldHideSeries()`.

### Before (Ad-hoc Rules)

```typescript
// Old logic - keyword/modality based
const shouldHideSeries = (entry) => {
  const modality = entry.modality.toUpperCase();

  // Show RT/RTSTRUCT/REG
  if (['RTSTRUCT', 'RT', 'REG'].includes(modality)) return false;

  // Hide DERIVED/SECONDARY
  if (['DERIVED', 'SECONDARY', 'OT'].includes(modality)) return true;

  // Hide if description contains keywords like "fusion", "resampled"
  const derivedByKeywords = DERIVED_DESCRIPTION_KEYWORDS.some(kw =>
    description.includes(kw)
  );
  if (derivedByKeywords && !isPetOrMR) return true;

  return false;
};
```

**Issues:**
- ❌ Didn't check registration relationships
- ❌ Didn't respect Frame of Reference alignment
- ❌ Keyword matching could fail on edge cases
- ❌ Didn't align with fusion manifest's fusability determination

### After (Fusion Manifest Rules)

```typescript
// New logic - fusion manifest based
const shouldHideSeries = (entry) => {
  const modality = entry.modality.toUpperCase();
  const seriesId = Number(entry.id);

  // Always show RTSTRUCT (nested under referenced series)
  if (['RTSTRUCT', 'RT'].includes(modality)) return false;

  // Always hide REG (internal registration metadata)
  if (modality === 'REG') return true;

  // Show planning CT from fusion manifest
  if (seriesSelectionData?.planningCT?.id === seriesId) {
    return false;
  }

  // Show fusion candidates from fusion manifest
  const isFusionCandidate = seriesSelectionData?.fusionCandidates?.some(
    candidate => candidate.seriesId === seriesId
  );
  if (isFusionCandidate) return false;

  // Hide derived/resampled series (fusion outputs)
  if (derivedByKeywords || flaggedFusion || isDerived) {
    return true;
  }

  // Hide SECONDARY/OT unless they're fusion candidates
  if (['DERIVED', 'SECONDARY', 'OT'].includes(modality)) {
    return true;
  }

  // If not in manifest, hide (goes to "Other" dropdown)
  if (seriesSelectionData?.allSeries) {
    const isInManifest = seriesSelectionData.allSeries.some(
      s => s.id === seriesId
    );
    if (!isInManifest) return true;
  }

  return false; // Default: show
};
```

**Benefits:**
- ✅ Uses registration relationships from database
- ✅ Respects Frame of Reference alignment
- ✅ Aligns exactly with fusion manifest logic
- ✅ Planning CT determined by backend scoring
- ✅ Fusion candidates based on actual spatial relationships

## How It Works

### 1. Backend Determines Relationships

```
DICOM Import
  ↓
processSeriesRegistrationRelationships()
  ├─ Parse REG files
  └─ Detect shared Frame of Reference
  ↓
series_registration_relationships table
  ↓
seriesSelectionService.getFusionCandidatesForSeries()
  ↓
GET /api/studies/:id/series-selection
```

### 2. Frontend Uses Manifest Data

```
useSeriesSelection(studyId)
  ↓
seriesSelectionData: {
  planningCT: { id, modality, description, ... },
  fusionCandidates: [
    { seriesId, relationshipType, confidence, ... }
  ],
  allSeries: [...]
}
  ↓
shouldHideSeries() checks against this data
  ↓
Only shows:
  - Planning CT
  - Fusion candidates
  - RT structures
  - Everything else → "Other" dropdown
```

## Series Display Logic

| Series Type | Modality | Display Location | Logic |
|------------|----------|-----------------|-------|
| Planning CT | CT | Main list (top) | `seriesSelectionData.planningCT` |
| Fusion candidates | MR, PT, PET | Main list | In `fusionCandidates` array |
| RT structures | RTSTRUCT | Nested under referenced series | Always shown, modality check |
| REG files | REG | **Hidden** | Internal registration metadata |
| Derived/fusion outputs | Any | **Hidden** | Keyword/flag checks |
| Non-fusable series | Any | "Other" dropdown | Not in manifest |

## Hierarchy Structure

```
📊 Planning CT (Auto-selected)
  └─ Has registration relationships

📷 MR T1 with Contrast
  └─ relationshipType: "rigid", confidence: 0.95

📷 PET Scan
  └─ relationshipType: "shared-frame", confidence: 0.9

🎯 RT Structure Set #1
  └─ References Planning CT

🎯 RT Structure Set #2
  └─ References Planning CT

▼ Other Series (Dropdown)
  ├─ Scout Images
  ├─ Localizer
  └─ QA Series
```

## Edge Cases Handled

### 1. **No Fusion Manifest Data Yet**
```typescript
if (seriesSelectionData?.allSeries && seriesSelectionData.allSeries.length > 0) {
  // Only enforce manifest filtering if data is loaded
}
```
Falls back to basic modality checks until manifest loads.

### 2. **Series Not in Manifest**
```typescript
const isInManifest = seriesSelectionData.allSeries.some(s => s.id === seriesId);
if (!isInManifest) return true; // Hide → "Other" dropdown
```

### 3. **RT Structures Always Visible**
```typescript
if (['RTSTRUCT', 'RT'].includes(modality)) {
  return false; // Always show, regardless of manifest
}
```
RT structures are handled separately by the sidebar nesting logic.

### 4. **REG Files Always Hidden**
```typescript
if (modality === 'REG') {
  return true; // Internal metadata, not useful to display
}
```

## Testing

### Verify Filtering Alignment

```typescript
// In browser console:

// 1. Check what fusion manifest says
const manifest = await fetch('/api/studies/1/series-selection').then(r => r.json());
console.log('Planning CT:', manifest.planningCT);
console.log('Fusion Candidates:', manifest.fusionCandidates);

// 2. Check what's displayed
const visibleSeries = document.querySelectorAll('[data-series-id]');
console.log('Visible series IDs:',
  Array.from(visibleSeries).map(el => el.dataset.seriesId)
);

// 3. Verify they match
const fusableIds = [
  manifest.planningCT.id,
  ...manifest.fusionCandidates.map(c => c.seriesId)
];
console.log('Should be visible:', fusableIds);
```

### Test Scenarios

1. **Patient with REG file**
   - ✅ REG file should be hidden
   - ✅ CT and MR should both be visible
   - ✅ Relationship should be detected

2. **Patient with shared Frame of Reference**
   - ✅ Both series visible
   - ✅ Listed as fusion candidates

3. **Patient with RT structures**
   - ✅ RT structures always visible
   - ✅ Nested under their referenced series

4. **Patient with derived series**
   - ✅ Original series visible
   - ✅ Derived/resampled series hidden

## Related Files

- **Modified**: `client/src/components/dicom/viewer-interface.tsx` (line 175-236)
- **Backend Service**: `server/services/series-selection-service.ts`
- **Registration Service**: `server/services/registration-relationship-service.ts`
- **Database Schema**: `shared/schema.ts` (`series_registration_relationships` table)

## Summary

**Before**: Ad-hoc keyword matching → inconsistent filtering

**After**: Fusion manifest rules → consistent, relationship-based filtering

The frontend now **trusts the backend** to determine what's fusable, ensuring the sidebar displays exactly what the fusion system can handle.