# RT Structure Race Condition Fix

## Problem
User reported: "RT struct initially loaded the correct one then instantly reverts to the wrong one!"

This was a **race condition** in the RT structure auto-selection logic.

## Root Cause

The useEffect in [series-selector.tsx:355-427](../client/src/components/dicom/series-selector.tsx#L355-L427) had two conflicting paths:

1. **loadedRTSeriesId path**: Sets RT based on explicit ID from props
2. **Auto-selection path**: Selects RT based on `referencedSeriesId` matching

The issue: Both paths could run in the same render cycle, causing:
1. ✅ Correct RT selected (matches primary CT's referencedSeriesId)
2. ❌ Immediately overwritten by auto-selection logic running again

## Fix Applied

### 1. Added Early Returns to Prevent Race
```typescript
// If loadedRTSeriesId is provided, prioritize that
if (loadedRTSeriesId) {
  const loadedSeries = rtSeries.find(s => s.id === loadedRTSeriesId);
  if (loadedSeries && (!selectedRTSeries || selectedRTSeries.id !== loadedRTSeriesId)) {
    console.log('📌 Setting selectedRTSeries based on loadedRTSeriesId:', loadedRTSeriesId);
    setSelectedRTSeries(loadedSeries);
    return; // 🔥 IMPORTANT: Return early to prevent auto-selection from running
  }
}

// Only auto-select if no RT series is currently selected
if (selectedRTSeries) {
  console.log('⏭️ Skipping auto-selection - RT series already selected:', selectedRTSeries.id);
  return;
}
```

### 2. Added Comprehensive Logging

Now logs every step of the RT selection process:

**🔄 Effect Trigger:**
```
🔄 RT Selection Effect triggered: {
  rtSeriesCount: 2,
  selectedSeriesId: 123,
  selectedRTSeriesId: 456,
  loadedRTSeriesId: null
}
```

**📌 Explicit Selection (from loadedRTSeriesId):**
```
📌 Setting selectedRTSeries based on loadedRTSeriesId: 456
```

**🎯 Auto-Selection (matches referencedSeriesId):**
```
  RT 456 (RTstruct_Planning): referencedSeriesId=123, matches=true
  RT 789 (RTstruct_Boost): referencedSeriesId=999, matches=false
🎯 Auto-selecting RT structure that references primary series 123: RTstruct_Planning (ID: 456)
```

**⚠️ Fallback (no matching RT found):**
```
⚠️ No RT structures reference primary series 123
Available RT structures: [
  { id: 456, desc: 'RTstruct_Planning', referencedSeriesId: 999 },
  { id: 789, desc: 'RTstruct_Boost', referencedSeriesId: null }
]
⚠️ Falling back to most recent RT: RTstruct_Planning (ID: 456)
```

**⏭️ Skip (already selected):**
```
⏭️ Skipping auto-selection - RT series already selected: 456
```

## Additional Fix: Fusion Debug API Endpoint

Created `GET /api/studies/:studyId/registration-relationships` endpoint to support the fusion debug dialog.

### Endpoint Details
- **Route**: `/api/studies/:studyId/registration-relationships`
- **Method**: GET
- **Location**: [server/routes.ts:3626-3688](../server/routes.ts#L3626-L3688)

### Response Format
```json
{
  "relationships": [
    {
      "id": 1,
      "primarySeriesId": 123,
      "secondarySeriesId": 456,
      "registrationId": "1.2.3.4.5",
      "registrationFilePath": "/storage/patients/.../REG.dcm",
      "relationshipType": "rigid",
      "registrationMethod": "DICOM-REG",
      "confidenceScore": 0.95,
      "geometricValidationPassed": true,
      "primaryModality": "CT",
      "primaryDescription": "CT Planning",
      "secondaryModality": "MR",
      "secondaryDescription": "T1 Post Contrast"
    }
  ]
}
```

### How to Access Debug Data

#### Option 1: Fusion Debug Dialog (UI)
The dialog is already implemented in [fusion-debug-dialog.tsx](../client/src/components/dicom/fusion-debug-dialog.tsx) and will now work with the new endpoint.

To open it (check viewer-interface.tsx for the button/trigger).

#### Option 2: Direct API Call
```bash
curl http://localhost:5000/api/studies/123/registration-relationships
```

#### Option 3: Browser Console
```javascript
const studyId = 123;
fetch(`/api/studies/${studyId}/registration-relationships`)
  .then(r => r.json())
  .then(data => console.table(data.relationships));
```

## Testing Instructions

### 1. Check Console Logs for RT Selection

Reload the viewer and look for these logs in the browser console:

**Expected sequence when working correctly:**
```
🔄 RT Selection Effect triggered: { rtSeriesCount: 2, selectedSeriesId: 123, ... }
  RT 456 (RTstruct_Planning): referencedSeriesId=123, matches=true
  RT 789 (RTstruct_Boost): referencedSeriesId=999, matches=false
🎯 Auto-selecting RT structure that references primary series 123: RTstruct_Planning (ID: 456)
```

**If you see the race condition:**
```
🎯 Auto-selecting RT structure that references primary series 123: RTstruct_Planning (ID: 456)
⏭️ Skipping auto-selection - RT series already selected: 456  <-- This is good!
```

The second message means the fix is working - it's preventing re-selection.

### 2. Check Database for Registration Relationships

```sql
-- Check if RT structures have referencedSeriesId set
SELECT
  id,
  modality,
  series_description,
  referenced_series_id
FROM series
WHERE modality = 'RTSTRUCT';

-- Check registration relationships table
SELECT
  srr.id,
  srr.primary_series_id,
  s1.modality as primary_modality,
  s1.series_description as primary_desc,
  srr.secondary_series_id,
  s2.modality as secondary_modality,
  s2.series_description as secondary_desc,
  srr.registration_method,
  srr.confidence_score
FROM series_registration_relationships srr
JOIN series s1 ON s1.id = srr.primary_series_id
JOIN series s2 ON s2.id = srr.secondary_series_id;
```

### 3. Use Fusion Debug Dialog

1. Open the viewer
2. Find and click the fusion debug button (look for database/bug icon)
3. Check the "Hierarchy" tab - should show primary→secondary relationships
4. Check the "Statistics" tab - should show counts and confidence scores
5. Check the "Raw Data" tab - copy report for detailed analysis

### 4. Check Why Secondary Series Aren't Showing

Look for these console logs (added in previous changes):

**🔍 Series Selection Data:**
```
🔍 Series Selection Data loaded: {
  planningCT: { id: 123, modality: 'CT', ... },
  fusionCandidates: [
    { seriesId: 456, modality: 'MR', score: 0.95 },
    { seriesId: 789, modality: 'PT', score: 0.9 }
  ],
  allSeriesCount: 5
}
```

**📋 Series List:**
```
📋 SeriesSelector series: {
  total: 5,
  byModality: { CT: 2, MR: 1, PT: 1, RTSTRUCT: 1 },
  seriesIds: [ ... ]
}
```

**🎯 Fusion Candidates:**
```
🎯 SeriesSelector fusion candidates: {
  selectedSeriesId: 123,
  candidates: [456, 789],
  totalPrimaryKeys: [123, 456]
}
```

## Diagnosis Based on Console Output

### Scenario A: RT selection logs show "matches=false" for all RT structures
**Issue**: RT structures don't have `referencedSeriesId` set correctly

**Fix**:
1. Check if RT was imported correctly
2. Update database manually:
   ```sql
   UPDATE series
   SET referenced_series_id = <ct_series_id>
   WHERE id = <rt_series_id> AND modality = 'RTSTRUCT';
   ```
3. Or reimport DICOM files

### Scenario B: RT selection works but secondary series (MR/PT) not showing
**Issue**: Fusion candidates not being populated

**Check**:
1. Does `🔍 Series Selection Data loaded` show fusion candidates?
   - **If NO**: Backend isn't finding relationships → Check database
   - **If YES**: Continue to next check

2. Does `📋 SeriesSelector series` include MR/PT series?
   - **If NO**: Series are being filtered by `shouldHideSeries()` → Check filtering logic
   - **If YES**: Continue to next check

3. Does `🎯 SeriesSelector fusion candidates` show candidate IDs?
   - **If NO**: `fusionCandidatesByPrimary` map not populated correctly
   - **If YES**: Rendering logic issue in series-selector.tsx lines 758-1500

### Scenario C: No registration relationships in database
**Issue**: Registration processing didn't run during import

**Fix**:
1. Run batch processing:
   ```bash
   curl -X POST http://localhost:5000/api/studies/123/process-registration-relationships
   ```

2. Or use the population script:
   ```bash
   node scripts/populate-registration-relationships.js
   ```

## Files Changed

1. [server/routes.ts:11-12](../server/routes.ts#L11-L12) - Added imports for `series`, `seriesRegistrationRelationships`, `or`, `inArray`
2. [server/routes.ts:3626-3688](../server/routes.ts#L3626-L3688) - Created GET endpoint for registration relationships
3. [client/src/components/dicom/series-selector.tsx:355-427](../client/src/components/dicom/series-selector.tsx#L355-L427) - Fixed RT selection race condition with early returns and detailed logging

## Summary

✅ **RT Structure Race Condition**: Fixed with early returns to prevent conflicting selection paths
✅ **Comprehensive Logging**: Added detailed console logs to trace RT selection flow
✅ **Fusion Debug API**: Created endpoint to view registration relationships
✅ **Ready for Testing**: User should reload and check console logs

**Next Action**: Reload the viewer, check the console logs, and report back:
1. What do the RT selection logs show?
2. Does the fusion debug dialog show any relationships?
3. Are secondary series (MR/PT) showing in the sidebar now?