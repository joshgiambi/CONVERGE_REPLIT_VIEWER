# Agent 3: RT Structures - Outstanding Work

**Status**: 🟡 **36% COMPLETE** (500 / 1,400 target lines)  
**Branch**: `feature/rt-structures`  
**Last Updated**: 2025-10-02

---

## Current State

### ✅ What's Complete (500 lines)

#### 1. RTProvider (151 lines)
**File**: `client/src/rt-structures/RTProvider.tsx`
- ✅ RT context with reducer pattern
- ✅ State management (status, error, structures, selection)
- ✅ Structure selection/visibility management
- ✅ Undo/redo integration
- ✅ React context API

#### 2. RTOverlayLayer (125 lines)  
**File**: `client/src/rt-structures/components/RTOverlayLayer.tsx`
- ✅ Contour drawing on canvas
- ✅ Zoom/pan transform application
- ✅ Structure visibility toggling
- ✅ Color coding per structure
- ✅ Opacity control
- ⚠️ **BUT**: Draws to canvasRef (should use overlayCanvasRef like Agent 2)

#### 3. RTControlPanel (73 lines)
**File**: `client/src/rt-structures/components/RTControlPanel.tsx`
- ✅ Structure list display
- ✅ Visibility toggles
- ✅ Structure selection UI
- ⚠️ **BUT**: Missing editing controls (boolean ops, margins, etc.)

#### 4. ContourOperationsService (84 lines)
**File**: `client/src/rt-structures/services/ContourOperationsService.ts`
- ✅ Interface definition
- ✅ Basic boolean operation (union/subtract/intersect)
- ✅ Basic margin operation
- ⚠️ **BUT**: Only single-slice operations, missing full 3D operations
- ⚠️ **BUT**: Missing preview, grow all slices, anisotropic margins

#### 5. UndoRedoService (67 lines)
**File**: `client/src/rt-structures/services/UndoRedoService.ts`
- ✅ Undo/redo state management
- ✅ History stack

---

## ❌ What's Missing (~900 lines)

### Critical Gap: Contour Editing Operations

From `viewer-interface.tsx` lines 1048-1498 (450+ lines):

#### 1. Boolean Operations (Full Implementation)
**Current**: Basic single-slice stub  
**Needed**: Complete extraction from viewer-interface.tsx

```typescript
// Lines 1048-1153 (~105 lines)
const handleBooleanOperation = useCallback(async (
  operation: 'combine' | 'subtract' | 'intersect',
  sourceStructureId: number,
  targetStructureId: number,
  sliceIndex: number,
) => {
  // Current implementation:
  // - Only works on single slice
  // - Doesn't handle multiple contours per slice
  // - No validation
  // - No undo history
  
  // NEEDED:
  // - Handle all slices where both structures exist
  // - Multiple contours per slice
  // - Validation (check structures exist, have contours)
  // - Progress feedback for long operations
  // - Undo/redo integration
  // - Error handling
});
```

**Missing Features**:
- ❌ Multi-slice boolean operations
- ❌ Progress indicator
- ❌ Validation & error messages
- ❌ Undo integration
- ❌ Result structure naming

#### 2. Margin Operations (Full Implementation)
**Current**: Basic uniform margin stub  
**Needed**: Complete from viewer-interface.tsx lines 1156-1269

```typescript
// Lines 1156-1269 (~113 lines)
const handleMarginOperation = useCallback(async (
  structureId: number,
  margins: {
    uniform?: number;
    superior?: number;
    inferior?: number;
    anterior?: number;
    posterior?: number;
    left?: number;
    right?: number;
  },
  slices?: 'current' | 'all',
) => {
  // NEEDED:
  // - Anisotropic margins (different per axis)
  // - Slice selection (current vs all)
  // - Image orientation awareness
  // - Progress feedback
  // - Preview before apply
  // - Undo integration
});
```

**Missing Features**:
- ❌ Anisotropic margins (6 directions)
- ❌ Image orientation handling
- ❌ Preview mode
- ❌ Slice selection
- ❌ Validation (margin bounds)

#### 3. Grow/Shrink Operations
**Current**: Not implemented  
**Needed**: From viewer-interface.tsx lines 1335-1417

```typescript
// Lines 1335-1417 (~82 lines)
const handleGrowContour = useCallback(async (
  structureId: number,
  growthMm: number,  // positive = grow, negative = shrink
  sliceIndex?: number,  // undefined = all slices
) => {
  // NEEDED:
  // - Grow all contours on slice
  // - Handle negative growth (shrink)
  // - Validate result doesn't disappear
  // - Handle self-intersections
  // - Smooth result
});
```

**Missing Features**:
- ❌ Grow/shrink contours
- ❌ Self-intersection handling
- ❌ Smoothing algorithm
- ❌ Validation (minimum size)

#### 4. Preview Operations
**Current**: Not implemented  
**Needed**: From viewer-interface.tsx lines 1272-1332 + 1420-1498

```typescript
// Lines 1272-1332 (~60 lines) - Preview grow single slice
const handlePreviewGrowOperation = useCallback((
  structureId: number,
  growthMm: number,
  sliceIndex: number,
) => {
  // NEEDED:
  // - Show preview without modifying structure
  // - Overlay preview in different color
  // - Allow adjustment before applying
  // - Cancel preview
});

// Lines 1420-1498 (~78 lines) - Preview grow all slices
const handlePreviewGrowStructure = useCallback((
  structureId: number,
  growthMm: number,
) => {
  // NEEDED:
  // - Preview all slices at once
  // - Show before/after comparison
  // - Slice-by-slice review
  // - Apply or cancel
});
```

**Missing Features**:
- ❌ Preview rendering
- ❌ Preview state management
- ❌ Before/after comparison
- ❌ Apply/cancel actions

#### 5. Brush Tool Integration
**Current**: Not implemented  
**Needed**: ~300 lines from working-viewer.tsx

```typescript
// Brush tool state and handlers
interface BrushToolState {
  enabled: boolean;
  brushSize: number;
  mode: 'add' | 'erase';
  currentStroke: number[][];
}

const handleBrushStroke = useCallback((
  startPoint: [number, number],
  endPoint: [number, number],
  structureId: number,
  slicePosition: number,
) => {
  // NEEDED:
  // - Convert brush stroke to contour
  // - Union with existing contour (add mode)
  // - Subtract from existing contour (erase mode)
  // - Real-time preview during stroke
  // - Smooth brush strokes
});
```

**Missing Features**:
- ❌ Brush tool state management
- ❌ Brush stroke to contour conversion
- ❌ Real-time preview
- ❌ Smoothing algorithm
- ❌ Add/erase modes
- ❌ Brush size adjustment

#### 6. Pen Tool Integration  
**Current**: Not implemented  
**Needed**: ~200 lines from working-viewer.tsx

```typescript
// Pen tool for drawing new contours
interface PenToolState {
  enabled: boolean;
  points: [number, number][];
  closed: boolean;
}

const handlePenPoint = useCallback((
  point: [number, number],
  structureId: number,
  slicePosition: number,
) => {
  // NEEDED:
  // - Click to add point
  // - Close contour
  // - Edit existing points
  // - Delete points
  // - Finish/cancel
});
```

**Missing Features**:
- ❌ Pen tool state management
- ❌ Point addition/removal
- ❌ Contour closing
- ❌ Point editing
- ❌ Visual feedback

---

## Integration with PrimaryViewport

### Issue: Using Wrong Canvas
**Current**: RTOverlayLayer draws to `canvasRef` (CT canvas)  
**Required**: Should use `overlayCanvasRef` like Agent 2

```typescript
// CURRENT (client/src/rt-structures/components/RTOverlayLayer.tsx:7-8)
interface Props {
  canvasRef: RefObject<HTMLCanvasElement>;  // ❌ WRONG
  // ...
}

// SHOULD BE:
import { useViewport } from '@/components/viewer/PrimaryViewport';

export function RTOverlayLayer() {
  const viewport = useViewport();
  const overlayCanvas = viewport.overlayCanvasRef.current;  // ✅ CORRECT
  const overlayCtx = overlayCanvas?.getContext('2d');
  
  // Get CSS dimensions (same as Agent 2)
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = overlayCanvas.width / dpr;
  const cssHeight = overlayCanvas.height / dpr;
  
  // Clear and draw RT structures
  overlayCtx.clearRect(0, 0, cssWidth, cssHeight);
  // ... drawing code
}
```

### Issue: Transform Math May Be Wrong
**Current**: Uses manual zoom/pan props  
**Should**: Use viewport context like Agent 2

```typescript
// Transform should match Agent 1's render logic
const baseScale = Math.min(cssWidth / imageWidth, cssHeight / imageHeight);
const totalScale = baseScale * viewport.zoom;
const scaledWidth = imageWidth * totalScale;
const scaledHeight = imageHeight * totalScale;
const offsetX = (cssWidth - scaledWidth) / 2 + viewport.panX;
const offsetY = (cssHeight - scaledHeight) / 2 + viewport.panY;
```

---

## Missing Features Summary

| Feature | Lines | Status | Priority |
|---------|-------|--------|----------|
| Multi-slice boolean ops | ~105 | ❌ Missing | Critical |
| Anisotropic margins | ~113 | ❌ Missing | High |
| Grow/shrink | ~82 | ❌ Missing | High |
| Preview grow (single) | ~60 | ❌ Missing | Medium |
| Preview grow (all) | ~78 | ❌ Missing | Medium |
| Brush tool | ~300 | ❌ Missing | Medium |
| Pen tool | ~200 | ❌ Missing | Medium |
| **TOTAL** | **~938** | **0%** | - |

**Current**: 500 lines (36% complete)  
**Target**: 1,400 lines (100% complete)  
**Gap**: 900 lines outstanding

---

## Priority Order for Agent 3

### Phase 1: Fix Overlay Integration (High Priority)
**Why**: Must work with Agent 1's PrimaryViewport  
**Effort**: ~2 hours

1. ✅ Update RTOverlayLayer to use `useViewport()` hook
2. ✅ Draw to `viewport.overlayCanvasRef` not `canvasRef`
3. ✅ Fix transform math to CSS pixel space (like Agent 2)
4. ✅ Test alignment with CT at different zoom/pan levels

### Phase 2: Complete Contour Operations (Critical)
**Why**: Core RT editing functionality  
**Effort**: ~8 hours

1. ❌ Extract `handleBooleanOperation` (complete version)
   - Multi-slice support
   - Progress feedback
   - Undo integration
   - Error handling

2. ❌ Extract `handleMarginOperation` (complete version)
   - Anisotropic margins
   - Image orientation handling
   - Preview support
   - Validation

3. ❌ Extract `handleGrowContour`
   - Grow/shrink algorithm
   - Self-intersection handling
   - Smoothing

4. ❌ Add preview operations
   - Preview state management
   - Temporary overlay rendering
   - Apply/cancel actions

### Phase 3: Add Drawing Tools (Medium Priority)
**Why**: Allow creating new contours  
**Effort**: ~6 hours

1. ❌ Implement brush tool
   - Stroke to contour conversion
   - Add/erase modes
   - Real-time preview

2. ❌ Implement pen tool
   - Point-by-point drawing
   - Contour closing
   - Point editing

### Phase 4: UI Enhancements (Low Priority)
**Why**: Better user experience  
**Effort**: ~4 hours

1. ❌ Expand RTControlPanel
   - Boolean operation controls
   - Margin operation controls
   - Tool selection
   - Preview controls

2. ❌ Add progress indicators
3. ❌ Add confirmation dialogs
4. ❌ Add keyboard shortcuts

---

## Files to Modify

### Must Update:
1. **`client/src/rt-structures/components/RTOverlayLayer.tsx`**
   - Switch to overlayCanvas
   - Fix transform math
   - Use viewport context

2. **`client/src/rt-structures/services/ContourOperationsService.ts`**
   - Expand boolean operations
   - Add anisotropic margins
   - Add grow/shrink
   - Add preview operations

3. **`client/src/rt-structures/RTProvider.tsx`**
   - Add preview state
   - Add operation progress
   - Add brush/pen tool state

### Should Create:
4. **`client/src/rt-structures/services/BrushToolService.ts`** (new)
   - Brush stroke handling
   - Stroke to contour conversion

5. **`client/src/rt-structures/services/PenToolService.ts`** (new)
   - Pen tool state management
   - Point manipulation

6. **`client/src/rt-structures/hooks/useRTDrawingTools.ts`** (new)
   - Unified drawing tool interface
   - Tool switching
   - Canvas event handling

### May Update:
7. **`client/src/rt-structures/components/RTControlPanel.tsx`**
   - Add operation controls
   - Add tool selection
   - Add progress display

---

## Code to Extract

### From viewer-interface.tsx:
- Lines 1048-1153: `handleBooleanOperation`
- Lines 1156-1269: `handleMarginOperation`
- Lines 1272-1332: `handlePreviewGrowOperation`
- Lines 1335-1417: `handleGrowContour`
- Lines 1420-1498: `handlePreviewGrowStructure`

### From working-viewer.tsx:
- Brush tool state management (~100 lines)
- Brush stroke handlers (~200 lines)
- Pen tool state management (~50 lines)
- Pen tool handlers (~150 lines)
- RT contour update logic (~200 lines)

**Total to extract**: ~1,050 lines from old viewer

---

## Testing Checklist

### Basic Overlay (Phase 1)
- [ ] RT structures render on overlay canvas (not CT canvas)
- [ ] Contours align with anatomy at zoom=1, pan=0
- [ ] Contours stay aligned during zoom
- [ ] Contours stay aligned during pan
- [ ] Structure visibility toggle works
- [ ] Structure color coding correct
- [ ] Opacity control works

### Contour Operations (Phase 2)
- [ ] Boolean union combines contours correctly
- [ ] Boolean subtract removes overlap
- [ ] Boolean intersect keeps only overlap
- [ ] Uniform margin expands structure
- [ ] Anisotropic margins expand per axis
- [ ] Grow operation expands contours
- [ ] Shrink operation contracts contours
- [ ] Preview shows expected result
- [ ] Apply/cancel work correctly

### Drawing Tools (Phase 3)
- [ ] Brush tool adds to structure
- [ ] Brush tool erases from structure
- [ ] Brush size adjustment works
- [ ] Pen tool creates new contours
- [ ] Pen tool closes contours
- [ ] Point editing works

### Integration
- [ ] Operations integrate with undo/redo
- [ ] Progress indicators show during long ops
- [ ] Error messages display appropriately
- [ ] Keyboard shortcuts work
- [ ] Multi-structure operations work

---

## Estimated Effort

| Phase | Work | Lines | Effort |
|-------|------|-------|--------|
| Phase 1 | Overlay integration | ~50 | 2 hours |
| Phase 2 | Contour operations | ~450 | 8 hours |
| Phase 3 | Drawing tools | ~500 | 6 hours |
| Phase 4 | UI enhancements | ~50 | 4 hours |
| **TOTAL** | | **~1,050** | **20 hours** |

**Current**: 500 lines (36% complete)  
**After completion**: 1,550 lines (111% of target)  
**Timeline**: ~20 hours of focused work

---

## Dependencies

### Blocks:
- ❌ Full RT structure editing in new viewer
- ❌ Production-ready RT workflow
- ❌ Brush/pen tool functionality

### Blocked By:
- ✅ Agent 1 (overlay canvas ready)
- ✅ Agent 4 (services ready)
- 🟡 Agent 2 (should use same overlay canvas - coordinate z-order)

### Coordination Needed:
**With Agent 2 (Fusion)**:
- Both use same overlayCanvas
- Need z-ordering strategy:
  - Option A: RT draws first, fusion on top
  - Option B: Fusion draws first, RT on top
  - Option C: Separate canvases

**Recommendation**: Use same overlay canvas, draw RT first (under fusion)

---

## Next Steps for Agent 3

### Immediate (Next Session):
1. Update RTOverlayLayer to use viewport.overlayCanvasRef
2. Fix transform math to CSS pixel space
3. Test overlay alignment with CT

### Short Term (Next 2 Sessions):
4. Extract handleBooleanOperation (complete version)
5. Extract handleMarginOperation (complete version)
6. Add progress/error handling

### Medium Term (Next 4 Sessions):
7. Add grow/shrink operations
8. Add preview functionality
9. Implement brush tool
10. Implement pen tool

### Long Term (Final Polish):
11. Expand RTControlPanel UI
12. Add keyboard shortcuts
13. Performance optimization
14. Comprehensive testing

---

## Success Criteria

### For Phase 1 (Minimum Viable):
- ✅ RT structures display correctly on overlay
- ✅ Transform math matches CT
- ✅ No rendering artifacts
- ✅ Performance acceptable

### For Phase 2 (Core Functionality):
- ✅ All contour operations work
- ✅ Multi-slice operations supported
- ✅ Undo/redo integrated
- ✅ Error handling robust

### For Phase 3 (Complete):
- ✅ Drawing tools functional
- ✅ Preview mode working
- ✅ UI controls complete
- ✅ Keyboard shortcuts added

---

## Conclusion

**Agent 3 Status**: 🟡 **36% Complete**

**Critical Path**:
1. Fix overlay integration (2 hours) ← **DO THIS FIRST**
2. Complete contour operations (8 hours) ← **CORE WORK**
3. Add drawing tools (6 hours) ← **FEATURE COMPLETE**
4. Polish UI (4 hours) ← **PRODUCTION READY**

**Total Remaining**: ~20 hours of work

**Coordination**: Must sync with Agent 2 on overlay canvas usage

**Ready**: Agent 1 overlay canvas ready for Agent 3 to use immediately

---

**Last Updated**: 2025-10-02  
**Next**: Agent 3 should start Phase 1 (overlay integration)

