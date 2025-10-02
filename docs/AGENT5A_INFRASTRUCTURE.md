# Agent 5A: Fusion Infrastructure Polish

**Track**: A (Backend/Provider)  
**Duration**: ~14 hours  
**Dependencies**: None (can start immediately)  
**Status**: Not started

---

## 🎯 Your Mission

Finish the fusion plumbing so `FusionProvider` behaves **exactly like the legacy viewer**.

**Goal**: Registration metadata complete, multi-secondary manifest tested, fusion provider production-ready.

---

## 📋 Tasks Breakdown

### **Task 1: Registration Metadata Passthrough** (6 hours)

**Problem**: Current `useRegistrationAssociations.ts` creates empty detail objects instead of reusing API payload.

**File**: `client/src/hooks/useRegistrationAssociations.ts`

**Current Code** (lines 118-126):
```typescript
// Basic detail construction (can be enhanced with seriesData if available)
const detail: RegistrationSeriesDetail = {
  id: normalizedId,
  uid: null,           // ❌ Empty
  description: null,   // ❌ Empty
  modality: '',        // ❌ Empty
  studyId: null,       // ❌ Empty
  imageCount: null,    // ❌ Empty
};
```

**Fix Required**:
```typescript
// Reuse API payload instead of empty objects
const detail: RegistrationSeriesDetail = {
  id: normalizedId,
  uid: ensureString(sourceSeriesData.uid) ?? null,
  description: ensureString(sourceSeriesData.description) ?? null,
  modality: ensureString(sourceSeriesData.modality)?.toUpperCase() ?? '',
  studyId: normalizeSeriesId(sourceSeriesData.studyId),
  imageCount: normalizeSeriesId(sourceSeriesData.imageCount),
};
```

**Steps**:
1. Check if API `/api/registration/associations` returns source series details
2. If yes, extract from payload and populate `sourceSeriesDetails`
3. If no, fetch series metadata separately and merge
4. Do the same for `targetSeriesDetail`

**Test**:
- Open `/viewer-v2` with a CT series that has PET fusion
- Open browser console
- Check registration options show proper descriptions
- Compare with `/viewer` - labels must match exactly

**Deliverable**: Registration options show descriptions like "PET AC 5mm" instead of just series IDs

---

### **Task 2: Manifest Multi-Secondary Regression Check** (4 hours)

**Problem**: Need to verify manifest caching works correctly with multiple secondaries.

**Create Test Script**: `scripts/test-fusion-manifest-multi.ts`

```typescript
/**
 * Test: Fusion manifest with multiple secondaries
 * 
 * Verifies:
 * 1. First call with [A, B] → cache miss, manifest built
 * 2. Second call with [A, B] → cache hit, instant return
 * 3. Call with [A, C] → cache miss (C is new)
 * 4. Call with [A] → cache hit (subset of [A, B])
 */

async function testManifestCaching() {
  const primary = 123; // CT series
  const secondaryA = 456; // PET series
  const secondaryB = 789; // MR series
  
  console.log('Test 1: First call with [A, B]');
  const t1 = Date.now();
  const r1 = await fetch(`/api/fusion/manifest?primarySeriesId=${primary}&secondarySeriesIds=${secondaryA},${secondaryB}`);
  console.log(`Time: ${Date.now() - t1}ms, Status: ${r1.status}`);
  
  console.log('Test 2: Second call with [A, B] (should be cached)');
  const t2 = Date.now();
  const r2 = await fetch(`/api/fusion/manifest?primarySeriesId=${primary}&secondarySeriesIds=${secondaryA},${secondaryB}`);
  console.log(`Time: ${Date.now() - t2}ms, Status: ${r2.status}`);
  // Assert: t2 < t1 / 2 (cached should be much faster)
  
  console.log('Test 3: Call with [A, C] (C is new, should rebuild)');
  // ... etc
}
```

**Run Test**:
```bash
npm run dev
# In another terminal:
npx tsx scripts/test-fusion-manifest-multi.ts
```

**Check**:
- First call builds manifest
- Second identical call hits cache
- Call with new secondary rebuilds
- Logs in `/api/debug/events?source=fusion-manifest` confirm behavior

**Deliverable**: Test script passes, manifest caching verified

---

### **Task 3: Optional Cleanup** (2 hours)

**File**: `client/src/components/viewer/ViewerV2.tsx`

**Current Issue**: `useFusionCandidates(seriesId)` is called even for non-CT series (wasteful).

**Fix**:
```typescript
// Only fetch fusion candidates if this is a CT series
const { data: directFusionCandidates = [] } = useFusionCandidates(
  isCT ? seriesId : null,  // Skip API call if not CT
);
```

**Also Improve Dev Logs**:
```typescript
if (import.meta.env.DEV) {
  console.log('🔧 ViewerV2 Fusion Setup:', {
    seriesId,
    modality: seriesData?.modality,
    isCT,
    fusionPrimarySeriesId,
    candidateCount: candidateSecondaryIds.length,
    registrationCount: registrationData?.size || 0,
    registrationDetails: registrationData ? 
      Array.from(registrationData.entries()).map(([id, assocs]) => ({
        primaryId: id,
        associations: assocs.map(a => ({
          sources: a.sourcesSeriesIds,
          targetDetail: a.targetSeriesDetail?.description,
        }))
      })) : [],
  });
}
```

**Test**:
- Open non-CT series (MR, PET) in `/viewer-v2`
- Check console - should NOT fetch fusion candidates
- Check no errors
- Open CT series - should fetch candidates and show detailed logs

**Deliverable**: Cleaner logs, no wasted API calls

---

### **Task 4: Update Documentation** (2 hours)

**File**: `docs/FUSION_REFACTOR_TRACKING.md`

**Add Section**:
```markdown
## Agent 5A – Infrastructure Complete ✅

**Completed**: 2025-10-02

### Registration Metadata Passthrough
- ✅ API payload reused for sourceSeriesDetails
- ✅ Descriptions, modalities, UIDs populated
- ✅ Fusion panel labels match legacy viewer

### Manifest Multi-Secondary Testing
- ✅ Test script created: `scripts/test-fusion-manifest-multi.ts`
- ✅ Caching verified with multiple secondaries
- ✅ Cache hit/miss behavior correct

### Optional Cleanup
- ✅ Fusion candidates only fetched for CT series
- ✅ Dev logs enhanced with registration details
- ✅ No errors on non-CT series

**Files Modified**:
- `client/src/hooks/useRegistrationAssociations.ts`
- `client/src/components/viewer/ViewerV2.tsx`
- `scripts/test-fusion-manifest-multi.ts`

**Testing**:
- Regression: All existing fusion tests pass
- New: Multi-secondary manifest test passes
- Manual: Labels match legacy viewer

**Handoff to Agent 5B**: Registration metadata ready for fusion panel display
```

---

## 📝 Testing Checklist

Before marking complete:

- [ ] Registration options show descriptions (not just IDs)
- [ ] Labels match legacy viewer exactly
- [ ] Manifest test script passes
- [ ] No errors on non-CT series
- [ ] Dev logs show detailed registration data
- [ ] All changes committed with clear messages
- [ ] `AGENT5_STATUS.md` updated
- [ ] `FUSION_REFACTOR_TRACKING.md` updated

---

## 🔗 Reference Documents

**API Endpoints**:
- `/api/registration/associations?patientId=X` - Get registration data
- `/api/fusion/manifest?primarySeriesId=X&secondarySeriesIds=Y,Z` - Get fusion manifest
- `/api/debug/events?source=fusion-manifest` - Debug logs

**Code References**:
- `server/fusion/manifest-service.ts` - Manifest backend
- `client/src/fusion/fusion-context.tsx` - FusionProvider
- `docs/FRAME_OF_REFERENCE_REGISTRATION.md` - Registration details

**Test Data**:
- Check `docs/AGENT3_NEXT_STEPS.md` for patient IDs with good test data

---

## ⚠️ Blockers & Escalation

**If you encounter**:
- API doesn't return source series details → May need backend enhancement
- Manifest test fails → Check server logs, debug events
- Registration labels still empty → Verify API payload structure

**Escalate to user** if:
- Backend API changes required
- Can't reproduce legacy behavior
- Breaking changes needed

---

## ✅ Done Criteria

You're done when:
1. ✅ Registration options show proper descriptions/modalities
2. ✅ Manifest multi-secondary test passes
3. ✅ All code committed and documented
4. ✅ Agent 5B can see proper labels in fusion panel

**Estimated**: 14 hours  
**Current**: Not started

---

## 🚀 Start Here

1. Read this document completely
2. Update `docs/AGENT5_STATUS.md` - mark Track A started
3. Start with Task 1 (most critical for Track B)
4. Test as you go
5. Update status doc every 2-3 hours

Good luck! 🎯

