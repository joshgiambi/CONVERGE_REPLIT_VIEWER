# Agent 3: Next Steps & Critical Instructions

**Last Updated**: 2025-10-02  
**Status**: Ready to continue  
**Current Progress**: 58% complete (814 lines / 1,400 target)

---

## 🎯 YOUR MISSION (Clarified)

**Focus ONLY on the backend logic**. Agent 5 will handle UI integration.

### **What You DO**:
✅ Build/maintain RT services and state management  
✅ Ensure `RTProvider` and `useRT()` work correctly  
✅ Complete `ContourOperationsService` (already excellent!)  
✅ Test your logic in isolation

### **What You DON'T Do**:
❌ Create new UI components  
❌ Extract or modify existing UI components  
❌ Worry about toolbars/panels - Agent 5 handles that  
❌ Try to integrate UI into ViewerV2

---

## ✅ WHAT'S COMPLETE (Great Work!)

### **Phase 1: Overlay Integration** ✅ DONE
- ✅ `RTOverlayLayer` uses `overlayCanvasRef` correctly
- ✅ Transform math matches Agent 1/2 (CSS pixel space)
- ✅ No DPR double-scaling
- ✅ Renders perfectly on viewport

### **Core Services** ✅ EXCELLENT
- ✅ `RTProvider` (152 lines) - State management working
- ✅ `RTOverlayLayer` (136 lines) - Rendering perfect
- ✅ `RTControlPanel` (74 lines) - Basic structure list
- ✅ `ContourOperationsService` (405 lines) - **Production ready!**
  - Boolean operations (single & multi-slice)
  - Margin operations (uniform & anisotropic)
  - Grow/shrink operations
  - Preview operations
  - Brush stroke operations (add/erase)
- ✅ `UndoRedoService` (68 lines) - Undo/redo working

**Your code quality is excellent** - 4.5/5 rating in review!

---

## 🔴 WHAT'S MISSING (Your Remaining Work)

### **Option A: Just Polish What You Have** (Recommended)

If the existing operations are sufficient, just:

**1. Add Progress Callbacks** (2 hours)
```typescript
// ContourOperationsService.ts
async booleanOperationMultiSlice(
  structures,
  sourceRoi,
  targetRoi,
  op,
  onProgress?: (current: number, total: number) => void  // ADD THIS
) {
  const slices = Array.from(bySlice.keys());
  for (let i = 0; i < slices.length; i++) {
    // ... process slice ...
    onProgress?.(i + 1, slices.length);  // Report progress
  }
}
```

**2. Add Error Handling** (1 hour)
- Log errors to console
- Return error states from operations
- Don't silently fail

**3. Document Anisotropic Limitation** (30 min)
- Add comment that current implementation uses max distance
- Note that true 3D requires image orientation

**4. Test Your Services** (2 hours)
- Create simple test cases
- Verify boolean ops work
- Verify margins work
- Verify undo/redo works

**Total: ~6 hours**

---

### **Option B: Add Advanced Operations** (If Needed)

Only do this if user needs them:

**1. Blob Separation** (3 hours)
- Split disconnected regions into separate structures

**2. Blob Removal** (2 hours)
- Remove small islands by area threshold

**3. Hole Filling** (2 hours)
- Fill interior gaps in contours

**4. Contour Simplification** (3 hours)
- Reduce points while preserving shape

**Total: ~10 hours**

---

## 📋 IMMEDIATE NEXT STEPS

### **Step 1: Confirm Scope with User** (5 minutes)

Ask user:
- "Do you need advanced operations (blob separation, hole filling)?"
- "Or should I just polish what's already built?"

**If polish only**: Follow Option A (~6 hours)  
**If advanced needed**: Follow Option B (~10 hours)

---

### **Step 2: Polish ContourOperationsService** (if Option A)

**File**: `client/src/rt-structures/services/ContourOperationsService.ts`

**Add**:

#### 2.1 Progress Reporting
```typescript
export interface OperationProgress {
  current: number;
  total: number;
  message?: string;
}

// Add to all long-running operations:
async booleanOperationMultiSlice(
  structures: RTStructureSet,
  sourceRoi: number,
  targetRoi: number,
  op: BooleanOperation,
  onProgress?: (progress: OperationProgress) => void
): Promise<RTStructureSet> {
  // ... existing code ...
  
  const slices = Array.from(bySlice.keys());
  for (let i = 0; i < slices.length; i++) {
    // Process slice...
    
    if (onProgress) {
      onProgress({
        current: i + 1,
        total: slices.length,
        message: `Processing slice ${i + 1}/${slices.length}`
      });
    }
  }
  
  return cloned;
}
```

#### 2.2 Error Handling
```typescript
async booleanOperation(...) {
  try {
    // ... existing code ...
  } catch (error) {
    console.error('Boolean operation failed:', error);
    // Return unchanged structure on error
    return deepClone(structures);
  }
}
```

#### 2.3 Documentation Comments
```typescript
/**
 * Performs boolean operation (union/intersect/subtract) on two structures.
 * 
 * @param structures - RT structure set
 * @param sourceRoiNumber - ROI to modify (result stored here)
 * @param targetRoiNumber - ROI to operate with
 * @param op - Operation: 'union' | 'intersect' | 'subtract'
 * @returns Modified structure set with results in source ROI
 * 
 * Note: Single-slice operation. For multi-slice, use booleanOperationMultiSlice.
 */
async booleanOperation(
  structures: RTStructureSet,
  sourceRoiNumber: number,
  targetRoiNumber: number,
  op: BooleanOperation,
): Promise<RTStructureSet> {
  // ...
}
```

---

### **Step 3: Update RTProvider** (if needed)

**File**: `client/src/rt-structures/RTProvider.tsx`

**Only if you need to expose operations**:

```typescript
interface RTContextValue extends RTState {
  // ... existing ...
  
  // Add operation wrappers if not already exposed
  performBooleanOp: (sourceId: number, targetId: number, op: BooleanOperation) => Promise<void>;
  performMarginOp: (roiId: number, marginMm: number) => Promise<void>;
  performGrowOp: (roiId: number, distanceMm: number) => Promise<void>;
}

// In provider:
const performBooleanOp = useCallback(async (sourceId, targetId, op) => {
  if (!state.rtStructures) return;
  
  const service = createContourOperationsService();
  const result = await service.booleanOperation(
    state.rtStructures,
    sourceId,
    targetId,
    op
  );
  
  setStructures(result);
  saveHistory(`boolean_${op}`, sourceId);
}, [state.rtStructures, setStructures, saveHistory]);
```

---

### **Step 4: Test Your Work** (2 hours)

**Create test file**: `client/src/rt-structures/__tests__/operations.test.ts`

**Or test manually**:
1. Load RT structures
2. Call operations via provider
3. Verify results are correct
4. Check undo/redo works

---

## 🚨 CRITICAL: What NOT to Do

### **DON'T Create These** (Agent 5 handles):
- ❌ `RTOperationsPanel.tsx` - UI for operation buttons
- ❌ `RTDrawingToolbar.tsx` - UI for brush/pen tools
- ❌ Any toolbar components
- ❌ Any button/input UI components

### **WHY?**
Agent 5 will import the **existing** UI components:
- `contour-edit-toolbar.tsx` (already exists in old viewer)
- `boolean-operations-toolbar-new.tsx` (already exists)
- `margin-toolbar.tsx` (already exists)

Agent 5 will wire those existing components to YOUR RTProvider via adapters.

### **Your Job**:
Just make sure `RTProvider` and `ContourOperationsService` work correctly. Agent 5 will connect the UI.

---

## 📊 Updated Status

### **Code Complete**
- **Phase 1**: ✅ 100% (overlay integration)
- **Phase 2**: ✅ 95% (operations mostly complete)
- **Phase 3**: ❌ 0% (drawing tools - SKIP, Agent 5 handles)
- **Phase 4**: ❌ 0% (UI polish - SKIP, Agent 5 handles)

### **Your Path to 100%**
If doing **Option A (Polish)**:
1. Add progress callbacks (2h)
2. Add error handling (1h)
3. Document limitations (30m)
4. Test services (2h)
5. **DONE** ✅

Total: ~6 hours to completion

---

## 🎯 SUCCESS CRITERIA (For You)

**Code Quality**:
- [x] Services work correctly ✅ Already excellent
- [ ] Progress reporting for long operations
- [ ] Error handling for failures
- [ ] Documentation comments

**Integration Ready**:
- [x] RTProvider exposes all needed data ✅
- [x] ContourOperationsService has all operations ✅
- [x] RTOverlayLayer renders correctly ✅
- [ ] Operations can be called from outside (via provider)

**Testing**:
- [ ] Boolean operations tested
- [ ] Margin operations tested
- [ ] Undo/redo tested
- [ ] No errors in console

---

## 💡 REMEMBER

**You're building the ENGINE, not the CAR**

- ✅ Your services = Engine (backend logic)
- ❌ UI components = Car body (Agent 5 handles)

**Your services are already excellent!** Just need some polish and you're done.

---

## 📞 Questions to Ask User

1. "Do you need advanced operations (blob separation, hole filling, etc)?"
   - If NO → Follow Option A (~6 hours)
   - If YES → Follow Option B (~10 hours)

2. "Should I expose operation functions in RTProvider for Agent 5?"
   - This makes it easier for Agent 5 to wire UI

3. "Any specific error scenarios I should handle?"

---

## 📚 Reference

**Your Files**:
- `client/src/rt-structures/RTProvider.tsx`
- `client/src/rt-structures/components/RTOverlayLayer.tsx`
- `client/src/rt-structures/components/RTControlPanel.tsx`
- `client/src/rt-structures/services/ContourOperationsService.ts`
- `client/src/rt-structures/services/UndoRedoService.ts`

**Review Doc**: `docs/AGENT3_COMPREHENSIVE_REVIEW.md` (you got 4.5/5!)

**Agent 5 Plan**: `docs/AGENT5_FINAL_PLAN.md` (so you know what they're doing)

---

## ✅ CHECKLIST

**Before continuing**:
- [ ] Read this document completely
- [ ] Ask user: Option A or Option B?
- [ ] Understand: You do backend, Agent 5 does UI

**Your work**:
- [ ] Add progress callbacks to operations
- [ ] Add error handling
- [ ] Document limitations
- [ ] Test your services
- [ ] Expose operations in RTProvider (if needed)

**When done**:
- [ ] Push code to git
- [ ] Update status: "Agent 3 complete"
- [ ] Hand off to Agent 5

---

**You're almost done! Just a few hours of polish and you're ready for Agent 5 to wire the UI.** 🚀

**Agent 3 Mantra**: *"Build the engine, let Agent 5 build the car"*

