# Debug: Sidebar Series Organization Issue

## Problem Report
User reported: "I'm testing first uploaded scan in viewer. The left sidebar has failed to organize the secondary images / proper nesting. I just see a CT and RT struct. The wrong RT structure set is also defaulting to loaded (not attached to the primary CT)"

## Changes Made

### 1. RT Structure Auto-Selection Fix ([series-selector.tsx:331-379](series-selector.tsx#L331-L379))

**Issue**: RT structures were auto-selected based on most recent date, regardless of which CT series they referenced.

**Fix**: Modified the auto-selection logic to:
1. Filter RT structures by `referencedSeriesId` or `referencedSeriesUID` matching the selected primary CT
2. Among those that reference the primary, select the most recent
3. If none reference the primary, fall back to most recent overall (with warning log)

```typescript
// Filter RT structures that reference the current primary series
const referencingRTStructures = rtSeries.filter(rt =>
  rt.referencedSeriesId === selectedSeries.id ||
  rt.referencedSeriesUID === selectedSeries.seriesInstanceUID
);

if (referencingRTStructures.length > 0) {
  // Select most recent that references primary
  const mostRecentRT = referencingRTStructures.reduce(...);
  console.log(`🎯 Auto-selecting RT structure that references primary series ${selectedSeries.id}`);
  handleRTSeriesSelect(mostRecentRT);
} else {
  // Fallback: select most recent overall
  console.log(`⚠️ No RT structures reference primary series ${selectedSeries.id}, selecting most recent`);
  handleRTSeriesSelect(mostRecentRT);
}
```

### 2. Debug Logging Added

Added comprehensive debug logging to trace data flow and identify why secondary images aren't showing:

#### viewer-interface.tsx (lines 98-107)
```typescript
// Debug log seriesSelectionData when it changes
useEffect(() => {
  if (seriesSelectionData) {
    console.log('🔍 Series Selection Data loaded:', {
      planningCT: seriesSelectionData.planningCT,
      fusionCandidates: seriesSelectionData.fusionCandidates,
      allSeriesCount: seriesSelectionData.allSeries?.length,
    });
  }
}, [seriesSelectionData]);
```

#### series-selector.tsx (lines 88-109)
```typescript
// Debug series being passed to SeriesSelector
useEffect(() => {
  console.log('📋 SeriesSelector series:', {
    total: series.length,
    byModality: series.reduce((acc, s) => {
      const mod = (s.modality || 'UNKNOWN').toUpperCase();
      acc[mod] = (acc[mod] || 0) + 1;
      return acc;
    }, {} as Record<string, number>),
    seriesIds: series.map(s => ({ id: s.id, modality: s.modality, desc: s.seriesDescription })),
  });
}, [series]);

// Debug fusion candidates for selected series
useEffect(() => {
  if (fusionCandidatesByPrimary && selectedSeries) {
    const candidates = fusionCandidatesByPrimary.get(selectedSeries.id);
    console.log('🎯 SeriesSelector fusion candidates:', {
      selectedSeriesId: selectedSeries.id,
      candidates: candidates,
      totalPrimaryKeys: Array.from(fusionCandidatesByPrimary.keys()),
    });
  }
}, [fusionCandidatesByPrimary, selectedSeries]);
```

## How to Debug

### Step 1: Open Browser Console
1. Load the viewer with your test scan
2. Open browser DevTools (F12 or right-click → Inspect)
3. Switch to the Console tab

### Step 2: Check Series Selection Data
Look for the log: **🔍 Series Selection Data loaded:**

This should show:
- `planningCT`: The selected primary CT series
- `fusionCandidates`: Array of series that can be fused (should include MR/PT if they exist)
- `allSeriesCount`: Total number of series in the manifest

**Expected**: If you have MR or PT series, they should appear in `fusionCandidates`

**If empty**: The backend series-selection service isn't finding fusion relationships. Check:
1. Does the database have entries in `series_registration_relationships`?
2. Run: `SELECT * FROM series_registration_relationships WHERE primary_series_id = <your_ct_series_id>`

### Step 3: Check Series List
Look for the log: **📋 SeriesSelector series:**

This shows:
- `total`: Total number of series being passed to the selector
- `byModality`: Count of each modality type (CT, MR, PT, RTSTRUCT, etc.)
- `seriesIds`: Full list of series with IDs and descriptions

**Expected**: Should see MR or PT series in the list if they exist

**If missing**: The series are being filtered out in `shouldHideSeries()` in viewer-interface.tsx. The filtering logic at lines 175-236 determines visibility.

### Step 4: Check Fusion Candidates Mapping
Look for the log: **🎯 SeriesSelector fusion candidates:**

This shows:
- `selectedSeriesId`: The currently selected primary CT
- `candidates`: Array of series IDs that can be fused with this primary
- `totalPrimaryKeys`: All primary series that have fusion candidates

**Expected**: `candidates` array should contain the IDs of MR/PT series that can be fused

**If empty**: Either:
1. `seriesSelectionData` didn't load properly
2. `fusionCandidatesByPrimary` wasn't populated (check lines 1173-1182 in viewer-interface.tsx)

### Step 5: Check RT Structure Selection
Look for logs starting with:
- **🎯 Auto-selecting RT structure that references primary series X** (good - found matching RT)
- **⚠️ No RT structures reference primary series X, selecting most recent** (warning - no matching RT)

**Expected**: Should see the first message if RT structure properly references the CT

**If warning**: The RT structure doesn't have `referencedSeriesId` set correctly. Check the database:
```sql
SELECT id, series_description, referenced_series_id
FROM series
WHERE modality = 'RTSTRUCT'
```

## Next Steps Based on Console Output

### Scenario A: No series shown in console
**Issue**: Series data isn't loading at all
**Fix**: Check network tab for failed API requests to `/api/studies/<id>/series`

### Scenario B: Series shown but no fusion candidates
**Issue**: Backend isn't finding registration relationships
**Fix**:
1. Check if `series_registration_relationships` table has data
2. Run the population script: `node scripts/populate-registration-relationships.js`
3. Verify REG files were parsed correctly during import

### Scenario C: Fusion candidates exist but not showing in sidebar
**Issue**: SeriesSelector rendering logic isn't using the candidates
**Fix**: The series are being filtered or the rendering logic needs adjustment. Check:
1. Lines 758-1500 in series-selector.tsx (hierarchical rendering section)
2. Verify `getCandidatesForPrimary()` function is using the right data source

### Scenario D: Wrong RT structure selected
**Issue**: RT structure doesn't reference the primary CT
**Fix**: Update the RT structure's `referencedSeriesId` in the database or reimport the DICOM files

## Architecture Overview

### Data Flow for Secondary Images
```
1. DICOM Import → series_registration_relationships table populated
2. Backend API → /api/studies/{id}/series-selection returns fusion candidates
3. Frontend Hook → useSeriesSelection() fetches and caches data
4. viewer-interface.tsx → merges with legacy candidates into fusionCandidatesByPrimary
5. SeriesSelector → uses fusionCandidatesByPrimary to render nested series
```

### Key Functions
- **shouldHideSeries()** (viewer-interface.tsx:175-236) - Determines if a series should be visible
- **choosePlanningCT()** (series-selector.tsx:767-802) - Selects the primary CT
- **getCandidatesForPrimary()** - Returns fusion candidate IDs for a primary series
- **fusionCandidatesByPrimary** (viewer-interface.tsx:1173-1182) - Map of primary → secondary series IDs

## Summary

The changes fix:
1. ✅ RT structure auto-selection now filters by referenced series
2. ✅ Added comprehensive debug logging to trace data flow
3. ⏳ Still need to verify why secondary images aren't appearing (pending console output)

Next action: **Check the browser console and report back what you see for the debug logs above.**