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

### **Focus: PARITY ONLY - Match Legacy Viewer**

**User Decision**: Stay on parity path. No advanced operations (blob separation, hole filling) yet. Just complete what legacy viewer already has.

**Your Remaining Tasks**:

### **1. Pen Tool Service Logic** (3 hours)

**Check legacy viewer**: Does it have a pen tool? If yes, you need:

**File**: `client/src/rt-structures/services/ContourOperationsService.ts`

**Add pen tool methods**:
```typescript
// Add to ContourServiceApi interface
addPenPoint(
  structures: RTStructureSet,
  roiNumber: number,
  slicePosition: number,
  point: { x: number; y: number; z: number }
): Promise<RTStructureSet>;

completePenContour(
  structures: RTStructureSet,
  roiNumber: number,
  slicePosition: number
): Promise<RTStructureSet>;

cancelPenContour(
  structures: RTStructureSet,
  roiNumber: number
): Promise<RTStructureSet>;
```

**Implementation**:
- Store points as user clicks
- Close contour when complete
- Add to structure's contours
- Support undo

---

### **2. Preview/Brush State in Provider** (2 hours)

**File**: `client/src/rt-structures/RTProvider.tsx`

**Add state for drawing tools**:
```typescript
interface RTState {
  // ... existing ...
  
  // Drawing tool state
  activeTool: 'none' | 'brush' | 'pen' | 'erase';
  brushSize: number;
  penPoints: Array<{ x: number; y: number; z: number }>; // For pen tool in progress
  previewContour: { roiNumber: number; points: number[] } | null; // For operation preview
}

type Action =
  // ... existing ...
  | { type: 'setActiveTool'; tool: 'none' | 'brush' | 'pen' | 'erase' }
  | { type: 'setBrushSize'; size: number }
  | { type: 'addPenPoint'; point: { x: number; y: number; z: number } }
  | { type: 'clearPenPoints' }
  | { type: 'setPreviewContour'; preview: { roiNumber: number; points: number[] } | null };
```

**Expose in context**:
```typescript
interface RTContextValue {
  // ... existing ...
  
  // Tool state
  activeTool: 'none' | 'brush' | 'pen' | 'erase';
  brushSize: number;
  setActiveTool: (tool: 'none' | 'brush' | 'pen' | 'erase') => void;
  setBrushSize: (size: number) => void;
  
  // Pen tool
  penPoints: Array<{ x: number; y: number; z: number }>;
  addPenPoint: (point: { x: number; y: number; z: number }) => void;
  completePenContour: () => Promise<void>;
  cancelPenContour: () => void;
  
  // Preview
  previewContour: { roiNumber: number; points: number[] } | null;
  setPreviewContour: (preview: { roiNumber: number; points: number[] } | null) => void;
}
```

**Why**: Agent 5 needs these in provider so legacy toolbar can read/write tool state.

---

### **3. Wire Operations to Provider** (2 hours)

**File**: `client/src/rt-structures/RTProvider.tsx`

**Expose all operations** so Agent 5 can call them:

```typescript
interface RTContextValue {
  // ... existing ...
  
  // Operations (async)
  performBooleanOp: (sourceId: number, targetId: number, op: 'union' | 'subtract' | 'intersect') => Promise<void>;
  performMarginOp: (roiId: number, marginMm: number) => Promise<void>;
  performGrowOp: (roiId: number, distanceMm: number) => Promise<void>;
  performBrushAdd: (roiId: number, sliceZ: number, points: number[]) => Promise<void>;
  performBrushErase: (roiId: number, sliceZ: number, points: number[]) => Promise<void>;
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

// ... similar for all operations ...
```

---

### **4. Preview Rendering in Overlay** (2 hours)

**File**: `client/src/rt-structures/components/RTOverlayLayer.tsx`

**Add preview contour rendering**:
```typescript
export function RTOverlayLayer({ contourWidth = 2, contourOpacity = 60 }: Props) {
  const { rtStructures, selection, previewContour } = useRT(); // Get preview
  
  // ... existing rendering ...
  
  // AFTER rendering normal structures, render preview
  if (previewContour) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 0, 0.8)'; // Yellow preview
    ctx.lineWidth = lw + 1; // Slightly thicker
    ctx.setLineDash([5, 5]); // Dashed line
    
    ctx.beginPath();
    for (let i = 0; i < previewContour.points.length; i += 3) {
      const x = previewContour.points[i];
      const y = previewContour.points[i + 1];
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }
}
```

---

### **5. Test Everything Legacy Viewer Has** (3 hours)

**Checklist of parity**:
- [ ] Load RT structures
- [ ] Select structure
- [ ] Toggle visibility
- [ ] Brush tool - add to contour
- [ ] Brush tool - erase from contour
- [ ] Pen tool - draw new contour (if in legacy)
- [ ] Boolean union
- [ ] Boolean subtract
- [ ] Boolean intersect
- [ ] Uniform margin
- [ ] Anisotropic margin (simplified version OK)
- [ ] Grow/shrink
- [ ] Preview operation
- [ ] Undo operation
- [ ] Redo operation

**If it works in `/viewer`, it must work through your provider/services.**

---

## **Total Remaining: ~12 hours**

---

## 📋 IMMEDIATE NEXT STEPS

### **Step 1: Inventory Legacy Viewer** (1 hour)

**Open**: `client/src/components/dicom/working-viewer.tsx` and `viewer-interface.tsx`

**Document**:
- What RT operations exist?
- Is there a pen tool?
- What tool states are tracked?
- How is preview handled?
- What can be undone?

**Create list**: "Everything RT that works in /viewer"

This is your **parity checklist**. Your job: Make all of it work through RTProvider/services.

---

### **Step 2: Complete Pen Tool** (if needed)

Check if legacy viewer has pen tool. If yes, add the service methods above. If no, skip.

---

### **Step 3: Add Tool State to RTProvider**

Add tool state (brush/pen/erase), brush size, pen points, preview contour as shown in Task #2 above. This lets Agent 5 wire the legacy toolbars to your provider.

---

### **Step 4: Wire All Operations to Provider**

Add wrapper methods in RTProvider that call your ContourOperationsService. This lets Agent 5's UI adapters call operations through provider instead of directly.

---

### **Step 5: Add Preview Rendering**

Update RTOverlayLayer to render preview contours (dashed yellow line) when `previewContour` is set in provider.

---

### **Step 6: Test Parity** (3 hours)

**Test every RT feature** that exists in `/viewer`:

Go through your parity checklist:
- [ ] Load RT structures ✅ (already works)
- [ ] Select/visibility ✅ (already works)
- [ ] Brush add
- [ ] Brush erase
- [ ] Pen tool (if exists)
- [ ] Boolean ops (all three)
- [ ] Margins (uniform & anisotropic)
- [ ] Grow/shrink
- [ ] Preview
- [ ] Undo/redo ✅ (already works)

**If it's in `/viewer`, it must work through your provider/services.**

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

## 📞 Questions Answered by User

**User's Decision**: 
- ✅ Stay on **parity path**
- ❌ **No advanced operations** (blob separation, hole filling) for now
- ✅ Complete pen tool service/UI wiring
- ✅ Hook preview/brush toggles into provider
- ✅ Make everything legacy viewer supports work through new plumbing
- ✅ Then hand off to Agent 5

**Your Focus**: Match legacy viewer's RT functionality exactly. No more, no less.

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
- [x] User decision: **Parity path confirmed**
- [x] Understand: You do backend, Agent 5 does UI

**Your work** (~12 hours):
- [ ] Inventory legacy viewer RT features (1h)
- [ ] Add pen tool service (if in legacy) (3h)
- [ ] Add tool state to RTProvider (brush/pen/erase, brush size) (2h)
- [ ] Wire all operations to RTProvider methods (2h)
- [ ] Add preview rendering to RTOverlayLayer (2h)
- [ ] Test complete parity with legacy viewer (3h)

**When done**:
- [ ] All legacy RT features work through new plumbing
- [ ] Agent 5 can call everything via RTProvider
- [ ] Preview/tool state exposed
- [ ] Push code to git
- [ ] Update status: "Agent 3 parity complete"
- [ ] Hand off to Agent 5

---

**You're almost done! Just a few hours of polish and you're ready for Agent 5 to wire the UI.** 🚀

**Agent 3 Mantra**: *"Build the engine, let Agent 5 build the car"*

