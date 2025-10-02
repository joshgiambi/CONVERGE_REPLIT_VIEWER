# Agent 5: Integration Guide - From Agent 4

**From**: Agent 4 (Foundation Services)  
**To**: Agent 5 (Integration & Testing)  
**Date**: 2025-02-14  
**Status**: Ready for Integration

---

## Current State Assessment

### ✅ What's Working
- `ViewerV2.tsx` renders core viewport with placeholder sidebar
- `PrimaryViewport` displays DICOM images using Agent 4's `useDICOMImages` hook
- `ViewportControls` provides zoom/pan/measure tools
- Basic routing at `/viewer-v2?patientId=X&seriesId=Y`
- Graceful error handling for missing params

### ⏳ What's Pending
- FusionProvider/RTProvider context wrappers (waiting on Agent 2 & 3)
- FusionPanel integration (waiting on Agent 2)
- RT structure controls (waiting on Agent 3)
- SeriesSelector sidebar (Agent 5)
- Full smoke-test validation (Agent 5)

---

## Integration Tasks for Agent 5

### Task 1: Wrap ViewerV2 with Context Providers ⏳
**File**: `client/src/components/viewer/ViewerV2.tsx` (Line 21)  
**When**: After Agent 2 & 3 complete their work

```typescript
// Current structure (Line 35)
return (
  <ViewerShell
    toolbar={...}
    viewport={...}
    sidebar={...}
  />
);

// Updated structure (wrap with providers)
return (
  <FusionProvider seriesId={seriesId} studyId={studyId}>
    <RTProvider seriesId={seriesId}>
      <ViewerShell
        toolbar={...}
        viewport={...}
        sidebar={
          // Add SeriesSelector here
        }
        panels={
          // Add FusionPanel + RT controls here
        }
      />
    </RTProvider>
  </FusionProvider>
);
```

**Dependencies**:
- ✅ Agent 2: FusionProvider exists at `client/src/fusion/fusion-context.tsx`
- ⏳ Agent 3: RTProvider needs to be created at `client/src/rt-structures/RTProvider.tsx`

---

### Task 2: Build SeriesSelector Sidebar Component
**File**: `client/src/components/viewer/SeriesSelectorV2.tsx` (NEW)  
**When**: Can start immediately using Agent 4 hooks

```typescript
import { useSeriesData } from '@/hooks/useSeriesData';
import { SeriesFilterService } from '@/services';

interface SeriesSelectorV2Props {
  studyIds: number[];
  selectedSeriesId: number;
  onSeriesSelect: (seriesId: number) => void;
}

export function SeriesSelectorV2({ studyIds, selectedSeriesId, onSeriesSelect }: SeriesSelectorV2Props) {
  const { visibleSeries, isLoading } = useSeriesData({
    studyIds,
    filterCriteria: {
      hideDerived: true,
      hideResampled: true,
      hideSecondary: true,
    },
  });

  // Render series list with modality icons
  // Group by study/modality
  // Highlight selected series
  
  return (
    <div className="text-white p-4">
      {/* Series list UI */}
    </div>
  );
}
```

**Use Agent 4 Services**:
- ✅ `useSeriesData` hook for fetching/filtering
- ✅ `SeriesFilterService` for filtering logic
- ✅ Types from `@/types/viewer`

---

### Task 3: Enhance Navigation & Error Handling
**File**: `client/src/pages/viewer-v2.tsx` (Line 15)  

**Current behavior**: Shows error message for missing params ✅  
**Needed**: Graceful redirect to patient manager

```typescript
import { useEffect } from 'react';
import { useLocation } from 'wouter';

export default function ViewerV2Page() {
  const [location, setLocation] = useLocation();
  const searchParams = new URLSearchParams(location.split('?')[1]);
  
  const patientId = searchParams.get('patientId');
  const seriesId = searchParams.get('seriesId');
  const studyId = searchParams.get('studyId');

  // Graceful redirect after 3 seconds
  useEffect(() => {
    if (!patientId || !seriesId) {
      const timer = setTimeout(() => {
        setLocation('/'); // Redirect to patient manager
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [patientId, seriesId, setLocation]);

  if (!patientId || !seriesId) {
    return (
      <div className="flex items-center justify-center h-screen bg-black">
        <div className="text-center text-white">
          <h1 className="text-2xl font-bold mb-4">ViewerV2</h1>
          <p className="text-gray-400">Missing required parameters</p>
          <p className="text-sm text-gray-500 mt-2">
            Usage: /viewer-v2?patientId=1&seriesId=123
          </p>
          <p className="text-xs text-gray-600 mt-4">
            Redirecting to patient manager...
          </p>
        </div>
      </div>
    );
  }

  return (
    <ViewerV2
      patientId={patientId}
      seriesId={parseInt(seriesId, 10)}
      studyId={studyId ? parseInt(studyId, 10) : undefined}
    />
  );
}
```

---

### Task 4: Integrate FusionPanel & RT Controls
**File**: `client/src/components/viewer/ViewerV2.tsx` (Line 68-74)  
**When**: After Agent 2 & 3 complete

```typescript
// Replace placeholder panels (Line 68)
panels={
  <div className="flex flex-col gap-4">
    {/* Agent 2: Fusion Panel */}
    <FusionPanel
      primarySeriesId={seriesId}
      onSecondarySelect={(secondaryId) => {
        // Handle secondary series selection
      }}
    />
    
    {/* Agent 3: RT Control Panel */}
    <RTControlPanel
      onStructureSelect={(structureId) => {
        // Handle structure selection
      }}
    />
  </div>
}
```

---

## Smoke Test Checklist

### Scenario 1: CT-Only Viewing ✅ (Already Testable)
**URL**: `/viewer-v2?patientId=1&seriesId=123`

- [ ] Page loads without errors
- [ ] CT image displays in viewport
- [ ] Zoom in/out buttons work
- [ ] Pan tool works (left click + drag)
- [ ] Mouse wheel scrolls through slices
- [ ] Window/level adjustment works (right click + drag)
- [ ] Keyboard arrows navigate slices
- [ ] Image metadata displays correctly
- [ ] No console errors

**Test Data**: Any CT series from existing patients

---

### Scenario 2: PET/CT Fusion ⏳ (After Agent 2)
**URL**: `/viewer-v2?patientId=1&seriesId=123` (CT primary)

- [ ] CT displays as primary
- [ ] Fusion candidates appear in SeriesSelector
- [ ] Select PET series as secondary
- [ ] Fusion overlay appears on CT
- [ ] Fusion opacity slider works
- [ ] Fusion window/level adjustment works
- [ ] Registration options display
- [ ] Manual registration selection works
- [ ] Scroll through slices maintains fusion alignment
- [ ] No performance degradation
- [ ] No console errors

**Test Data**: 
- Patient with CT + PET series
- REG file linking CT to PET
- Example: HN_PETFUSE dataset

---

### Scenario 3: RT Structure Viewing ⏳ (After Agent 3)
**URL**: `/viewer-v2?patientId=1&seriesId=123` (CT with RT structures)

- [ ] CT displays with RT overlay option
- [ ] RT structures load automatically
- [ ] Structure list displays in RT panel
- [ ] Toggle structure visibility works
- [ ] Structure colors can be changed
- [ ] Contours render correctly on all slices
- [ ] Structure selection highlights contours
- [ ] Auto-localization to structure works
- [ ] Auto-zoom to structure works
- [ ] No rendering artifacts
- [ ] No console errors

**Test Data**:
- Patient with CT + RTSTRUCT
- Multiple structures with different colors
- Example: HN Atlas dataset

---

### Scenario 4: PET/CT + RT Structures ⏳ (After Agent 2 & 3)
**URL**: `/viewer-v2?patientId=1&seriesId=123`

- [ ] CT displays with PET fusion
- [ ] RT structures overlay on fused image
- [ ] Both overlays render without conflict
- [ ] Opacity controls work independently
- [ ] Scroll maintains both overlays
- [ ] Structure visibility doesn't affect fusion
- [ ] Fusion visibility doesn't affect structures
- [ ] Performance remains acceptable
- [ ] No memory leaks
- [ ] No console errors

**Test Data**:
- Patient with CT + PET + RTSTRUCT
- Example: Complete HN_PETFUSE with structures

---

### Scenario 5: Error Handling & Edge Cases
**Test Cases**:

1. **Missing Parameters**
   - [ ] `/viewer-v2` (no params) → Shows error + redirects
   - [ ] `/viewer-v2?patientId=1` (no seriesId) → Shows error + redirects
   - [ ] `/viewer-v2?seriesId=123` (no patientId) → Shows error + redirects

2. **Invalid Parameters**
   - [ ] `/viewer-v2?patientId=999&seriesId=999` → Shows error message
   - [ ] `/viewer-v2?patientId=abc&seriesId=def` → Shows error message

3. **Network Errors**
   - [ ] Disconnect network → Shows loading indicator
   - [ ] Slow 3G → Shows progress indicator
   - [ ] Timeout → Shows error + retry option

4. **Large Datasets**
   - [ ] 500+ slice CT series → Loads progressively
   - [ ] Multiple large series → Memory management works
   - [ ] MPR views → Performance acceptable

---

## Integration Checklist

### Phase 1: Series Selection (Can Start Now)
- [ ] Create `SeriesSelectorV2.tsx` component
- [ ] Use `useSeriesData` hook from Agent 4
- [ ] Implement series filtering UI
- [ ] Add modality icons
- [ ] Add series metadata display
- [ ] Wire up to ViewerV2
- [ ] Test with multi-study patient

### Phase 2: Fusion Integration (After Agent 2)
- [ ] Verify FusionProvider is ready
- [ ] Wrap ViewerV2 with FusionProvider
- [ ] Add FusionPanel to panels section
- [ ] Test fusion candidate detection
- [ ] Test fusion overlay rendering
- [ ] Test registration options
- [ ] Run Scenario 2 smoke tests

### Phase 3: RT Integration (After Agent 3)
- [ ] Verify RTProvider is ready
- [ ] Wrap ViewerV2 with RTProvider
- [ ] Add RTControlPanel to panels section
- [ ] Test RT structure loading
- [ ] Test contour rendering
- [ ] Test structure operations
- [ ] Run Scenario 3 smoke tests

### Phase 4: Combined Testing (After Agent 2 & 3)
- [ ] Test all features together
- [ ] Run all smoke test scenarios
- [ ] Performance profiling
- [ ] Memory leak testing
- [ ] Cross-browser testing
- [ ] Document known issues
- [ ] Create migration guide

### Phase 5: Production Readiness
- [ ] Feature flag for `/viewer-v2` vs `/viewer`
- [ ] A/B testing with power users
- [ ] Monitor error rates
- [ ] Collect user feedback
- [ ] Fix critical bugs
- [ ] Update documentation
- [ ] Plan deprecation of legacy viewer

---

## Performance Targets

Based on legacy viewer benchmarks:

| Metric | Target | How to Measure |
|--------|--------|----------------|
| Initial Load | < 2s | Time to first image |
| Slice Navigation | < 100ms | Mouse wheel response |
| Fusion Overlay | < 200ms | Secondary render time |
| Memory Usage | < 500MB | Chrome DevTools |
| Scroll 100 slices | < 5s | With all overlays |

---

## Known Limitations to Document

1. **ViewerV2 Limitations** (compared to legacy):
   - No MPR floating windows (yet)
   - No measurement tools (yet)
   - No annotation tools (yet)
   - No export functionality (yet)

2. **Agent 4 Services Limitations**:
   - VolumeService: Basic trilinear slicing only
   - useDICOMImages: Sequential background loading
   - useSeriesData: Not optimized for 50+ studies

3. **Integration Challenges**:
   - Context provider nesting order matters
   - Canvas ref sharing between overlays
   - Event handler coordination

---

## Communication Protocol

### For Agent 2 (Fusion)
When FusionProvider is ready:
1. Notify in FUSION_REFACTOR_TRACKING.md
2. Update integration status
3. Provide usage example for ViewerV2
4. Document context API

### For Agent 3 (RT Structures)
When RTProvider is ready:
1. Notify in VIEWER_FUNCTION_MAPPING.md
2. Update integration status
3. Provide usage example for ViewerV2
4. Document context API

### For User Testing
After each integration phase:
1. Deploy to `/viewer-v2` route
2. Test with real patient data
3. Collect feedback in GitHub issues
4. Prioritize bug fixes
5. Iterate

---

## Success Criteria

### Checkpoint 1: Series Selection (Can start now)
- [ ] SeriesSelector renders series list
- [ ] Series filtering works
- [ ] Series selection updates viewport
- [ ] Works with Agent 4's useSeriesData

### Checkpoint 2: Fusion Integration (After Agent 2)
- [ ] FusionProvider wraps ViewerV2
- [ ] FusionPanel displays candidates
- [ ] PET/CT fusion renders correctly
- [ ] Scenario 2 smoke tests pass

### Checkpoint 3: RT Integration (After Agent 3)
- [ ] RTProvider wraps ViewerV2
- [ ] RT structures render correctly
- [ ] Structure operations work
- [ ] Scenario 3 smoke tests pass

### Final Checkpoint: Production Ready
- [ ] All smoke tests pass
- [ ] Performance targets met
- [ ] Zero critical bugs
- [ ] User acceptance achieved
- [ ] Documentation complete

---

## Next Steps for Agent 5

### Immediate Actions (Can Start Now)
1. ✅ Read this integration guide
2. ⏳ Create `SeriesSelectorV2.tsx` using Agent 4's hooks
3. ⏳ Enhance error handling in `viewer-v2.tsx`
4. ⏳ Write Scenario 1 smoke test script
5. ⏳ Test CT-only viewing thoroughly

### Waiting on Dependencies
- Agent 2: FusionProvider + FusionPanel
- Agent 3: RTProvider + RTControlPanel

### Once Unblocked
1. Wrap ViewerV2 with providers
2. Integrate FusionPanel + RT controls
3. Run full smoke test suite
4. Performance profiling
5. Deploy for user testing

---

## Questions for Agent 5?

If you need clarification on:
- **Agent 4 services**: See `docs/AGENT4_DELIVERABLES.md`
- **Hook usage**: See code examples in services
- **Type definitions**: See `client/src/types/viewer.ts`
- **Architecture**: See `docs/VIEWER_FUNCTION_MAPPING.md`

**Agent 4 is available to support integration efforts!** 🚀

