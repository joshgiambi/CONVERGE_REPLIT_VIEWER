# Agent 5: Start Here - UI Integration Plan

**Date**: 2025-10-02  
**Status**: Ready to Begin  
**Path Chosen**: **Option B - Import Legacy Toolbars** (Guaranteed Parity)

---

## 🎯 Your Mission

Import the **existing legacy UI components** from `/viewer` into `/viewer-v2` and wire them to the new backend (RTProvider, FusionProvider, etc.) through **thin adapter wrappers**.

**Goal**: `/viewer-v2` must look and behave **identically** to `/viewer`

---

## ✅ What's Already Complete

### **Agent 1: Viewer Core** ✅
- `PrimaryViewport` - DICOM canvas rendering
- `ViewerShell` - Layout with slots (toolbar, sidebar, viewport, panels)
- `useViewportInteractions` - Pan/zoom/windowing
- Overlay canvas for Agent 2/3

### **Agent 2: Fusion Layer** ✅
- `FusionOverlayLayer` - PET/secondary overlay rendering
- `useFusionCandidates` - Registration logic
- `useRegistrationOptions` - Transform options
- All wired to overlay canvas

### **Agent 3: RT Structures Backend** ✅
- `RTProvider` - Complete state management
- `ContourOperationsService` - All RT operations
- `RTOverlayLayer` - Contour rendering + preview
- **`RTControlPanel` - REFERENCE ONLY** (not for production)

### **Agent 4: Services & Hooks** ✅
- `useDICOMImages` - Image loading with worker
- `useSeriesData` - Series fetching
- `SeriesFilterService` - Series filtering
- All data plumbing complete

---

## 📋 Your Tasks (Estimated 28 hours)

### **Phase 0: Component Audit** (2 hours) ⏱️ START HERE

**Objective**: Inventory all legacy UI components and document their contracts.

**Steps**:

1. **Open `/viewer` and document the UI layout**:
   - What's in the top toolbar?
   - What's in the sidebar?
   - What panels appear for RT structures?
   - What panels appear for fusion?
   - Take screenshots for reference

2. **Find the legacy UI component files**:
   ```
   client/src/components/dicom/
   ├── viewer-toolbar.tsx                    # Main toolbar (top)
   ├── series-selector.tsx                   # Sidebar (left)
   ├── contour-edit-toolbar.tsx              # RT contour editing
   ├── boolean-operations-toolbar-new.tsx    # RT boolean ops
   ├── margin-toolbar.tsx                    # RT margins
   ├── fusion-control-panel.tsx              # Fusion controls
   └── ... (find any others)
   ```

3. **For each component, document**:
   ```markdown
   ## ComponentName
   - **File**: client/src/components/dicom/xyz.tsx
   - **Props**: (list required props)
   - **State**: (what local state does it have?)
   - **Callbacks**: (what handlers does it expect?)
   - **Data Sources**: (where does it get data? props? local state? context?)
   ```

4. **Map to new providers/hooks**:
   ```markdown
   Legacy Source → New Source
   - props.structures → useRT().rtStructures
   - props.onBooleanOp → useRT().performBooleanOp (wrapper needed)
   - local state zoom → useViewport().zoom
   - local state series → useDICOMImages().images
   ```

**Deliverable**: `docs/LEGACY_UI_INVENTORY.md` with complete component list and mapping

---

### **Phase 1: Mount Core Layout** (4 hours)

**Objective**: Get `ViewerV2` rendering with the new core and basic structure.

**Steps**:

1. **Verify `ViewerV2.tsx` has the new render core**:
   ```typescript
   // client/src/components/viewer/ViewerV2.tsx
   export function ViewerV2({ patientId, studyId, seriesId }: ViewerV2Props) {
     return (
       <FusionProvider primarySeriesId={seriesId}>
         <RTProvider>
           <ViewerShell
             toolbar={/* will add in Phase 2 */}
             sidebar={/* will add in Phase 5 */}
             viewport={
               <PrimaryViewport seriesId={seriesId}>
                 <FusionOverlayLayer />
                 <RTOverlayLayer />
               </PrimaryViewport>
             }
             panels={/* will add in Phases 3-4 */}
           />
         </RTProvider>
       </FusionProvider>
     );
   }
   ```

2. **Test**:
   - Navigate to `/viewer-v2?patientId=X&studyId=Y&seriesId=Z`
   - Verify canvas renders
   - Verify you can pan/zoom/window
   - Verify no errors in console

**Deliverable**: Empty shell rendering correctly

---

### **Phase 2: Import Main Toolbar** (4 hours)

**Objective**: Mount the main toolbar at the top.

**Steps**:

1. **Find the legacy toolbar** (likely `viewer-toolbar.tsx`)

2. **Analyze its contract**:
   ```typescript
   // What props does it expect?
   interface ViewerToolbarProps {
     zoom?: number;
     onZoomIn?: () => void;
     onZoomOut?: () => void;
     onResetView?: () => void;
     // ... etc
   }
   ```

3. **Create adapter component**:
   ```typescript
   // client/src/components/viewer/adapters/ViewerToolbarAdapter.tsx
   import { ViewerToolbar } from '@/components/dicom/viewer-toolbar';
   import { useViewport } from '@/components/viewer/PrimaryViewport';
   import { useDICOMImages } from '@/hooks/useDICOMImages';
   
   export function ViewerToolbarAdapter() {
     const viewport = useViewport();
     const images = useDICOMImages({ seriesId: /* get from context */ });
     
     // Transform new state → legacy props
     const handleZoomIn = () => viewport.zoomIn();
     const handleZoomOut = () => viewport.zoomOut();
     
     return (
       <ViewerToolbar
         zoom={viewport.zoom}
         onZoomIn={handleZoomIn}
         onZoomOut={handleZoomOut}
         // ... map all props
       />
     );
   }
   ```

4. **Mount in ViewerV2**:
   ```typescript
   <ViewerShell
     toolbar={<ViewerToolbarAdapter />}
     // ...
   />
   ```

5. **Test**:
   - All toolbar buttons work
   - Visual match with `/viewer`
   - No functionality lost

**Deliverable**: Main toolbar working in `/viewer-v2`

---

### **Phase 3: Import RT Toolbars** (8 hours)

**Objective**: Mount all RT structure editing toolbars.

**Steps**:

1. **Import contour editing toolbar**:
   - Find `contour-edit-toolbar.tsx`
   - Create `ContourEditToolbarAdapter.tsx`
   - Wire to `useRT()` hook:
     ```typescript
     const { 
       rtStructures,
       selection,
       brush,
       pen,
       selectStructure,
       setBrushMode,
       setPenMode,
       // ... etc
     } = useRT();
     ```
   - Map legacy props
   - Mount in ViewerShell

2. **Import boolean operations toolbar**:
   - Find `boolean-operations-toolbar-new.tsx`
   - Create `BooleanOpsToolbarAdapter.tsx`
   - Wire to `useRT()` hook:
     ```typescript
     const {
       rtStructures,
       setPreviewContours,
       clearPreview,
       setStructures,
       saveHistory,
     } = useRT();
     
     const handleBooleanPreview = async (sourceId, targetId, op) => {
       const service = createContourOperationsService();
       const preview = await service.previewBooleanOperation(
         rtStructures,
         sourceId,
         targetId,
         op
       );
       setPreviewContours(preview);
     };
     
     const handleBooleanApply = async (sourceId, targetId, op) => {
       const service = createContourOperationsService();
       const result = await service.booleanOperation(
         rtStructures,
         sourceId,
         targetId,
         op
       );
       setStructures(result);
       saveHistory(`boolean_${op}`, sourceId);
       clearPreview();
     };
     ```
   - **Use Agent 3's RTControlPanel as reference** for callback patterns
   - Mount in ViewerShell

3. **Import margin toolbar**:
   - Find `margin-toolbar.tsx`
   - Create `MarginToolbarAdapter.tsx`
   - Wire margin operations to `useRT()` + `ContourOperationsService`
   - Mount in ViewerShell

4. **Find any other RT panels** and repeat

5. **Test each toolbar**:
   - Visual match with `/viewer`
   - All buttons work
   - Operations apply correctly
   - Preview shows/clears properly
   - Undo/redo works

**Deliverable**: All RT toolbars functional in `/viewer-v2`

---

### **Phase 4: Import Fusion Panel** (3 hours)

**Objective**: Mount the fusion control panel.

**Steps**:

1. **Find the legacy fusion panel** (likely `fusion-control-panel.tsx`)

2. **Analyze its contract**:
   ```typescript
   interface FusionControlPanelProps {
     primarySeriesId?: string;
     secondarySeriesIds?: string[];
     opacity?: number;
     onOpacityChange?: (opacity: number) => void;
     // ... etc
   }
   ```

3. **Create adapter**:
   ```typescript
   // client/src/components/viewer/adapters/FusionPanelAdapter.tsx
   import { FusionControlPanel } from '@/components/dicom/fusion-control-panel';
   import { useFusion } from '@/fusion/fusion-context'; // Existing fusion provider
   
   export function FusionPanelAdapter() {
     const fusion = useFusion();
     
     // Transform new state → legacy props
     return (
       <FusionControlPanel
         primarySeriesId={fusion.primarySeriesId}
         secondarySeriesIds={fusion.secondarySeriesIds}
         opacity={fusion.opacity}
         onOpacityChange={fusion.setOpacity}
         // ... map all props
       />
     );
   }
   ```

4. **Mount in ViewerV2**:
   ```typescript
   <ViewerShell
     panels={
       <>
         <FusionPanelAdapter />
         {/* RT panels from Phase 3 */}
       </>
     }
   />
   ```

5. **Test**:
   - Fusion panel appears
   - Opacity slider works
   - Secondary series selection works
   - Visual match with `/viewer`

**Deliverable**: Fusion panel working in `/viewer-v2`

---

### **Phase 5: Import Series Selector** (3 hours)

**Objective**: Mount the series selector sidebar.

**Steps**:

1. **Find the legacy series selector** (likely `series-selector.tsx`)

2. **Create adapter**:
   ```typescript
   // client/src/components/viewer/adapters/SeriesSelectorAdapter.tsx
   import { SeriesSelector } from '@/components/dicom/series-selector';
   import { useSeriesData } from '@/hooks/useSeriesData';
   
   export function SeriesSelectorAdapter({ studyId }: { studyId: string }) {
     const { series, loading } = useSeriesData(studyId);
     
     const handleSeriesSelect = (seriesId: string) => {
       // Navigate to new series or update state
       window.location.href = `/viewer-v2?seriesId=${seriesId}`;
     };
     
     return (
       <SeriesSelector
         series={series}
         loading={loading}
         onSelect={handleSeriesSelect}
       />
     );
   }
   ```

3. **Mount in ViewerV2**:
   ```typescript
   <ViewerShell
     sidebar={<SeriesSelectorAdapter studyId={studyId} />}
     // ...
   />
   ```

4. **Test**:
   - Series list appears
   - Clicking series loads it
   - Visual match with `/viewer`

**Deliverable**: Series selector working in `/viewer-v2`

---

### **Phase 6: Regression Testing** (4 hours)

**Objective**: Verify `/viewer-v2` matches `/viewer` exactly.

**Steps**:

1. **Side-by-side visual comparison**:
   - Open `/viewer?seriesId=X` in one tab
   - Open `/viewer-v2?seriesId=X` in another tab
   - Compare every pixel, every button, every panel
   - Document any differences

2. **Functional testing checklist**:
   ```markdown
   ## DICOM Viewing
   - [ ] Image loads
   - [ ] Pan works (middle mouse drag)
   - [ ] Zoom works (scroll wheel)
   - [ ] Window/level works (right mouse drag)
   - [ ] Slice navigation works (arrow keys)
   - [ ] Keyboard shortcuts work
   
   ## RT Structures
   - [ ] Structures load and display
   - [ ] Select structure
   - [ ] Toggle visibility
   - [ ] Brush add mode works
   - [ ] Brush erase mode works
   - [ ] Pen tool works (if exists)
   - [ ] Boolean union works
   - [ ] Boolean subtract works
   - [ ] Boolean intersect works
   - [ ] Boolean preview works
   - [ ] Margin expansion works
   - [ ] Grow/shrink works
   - [ ] Undo/redo works
   
   ## Fusion
   - [ ] Secondary series loads
   - [ ] Opacity slider works
   - [ ] Registration options work
   - [ ] Fusion overlay renders correctly
   - [ ] Window/level on secondary works
   
   ## Series Selection
   - [ ] Series list loads
   - [ ] Switching series works
   - [ ] Series thumbnails work (if exists)
   ```

3. **Fix any gaps**:
   - If something doesn't work, debug the adapter
   - If visuals differ, adjust styling
   - If feature is missing, implement it

4. **Performance testing**:
   - Large RT structure sets (100+ structures)
   - Large image series (500+ slices)
   - Rapid tool switching
   - Verify no memory leaks

**Deliverable**: Comprehensive test report showing parity

---

### **Phase 7: User Validation** (2 hours)

**Objective**: Get user approval before deprecating `/viewer`.

**Steps**:

1. **Demo to user**:
   - Show side-by-side comparison
   - Walk through all features
   - Get feedback

2. **Incorporate feedback**:
   - Fix any issues
   - Adjust anything that doesn't feel right

3. **Final sign-off**:
   - User confirms: "I can't tell the difference"
   - Document approval

**Deliverable**: User approval to proceed

---

## 🔧 Adapter Pattern Reference

**Agent 3's `RTControlPanel` shows the correct pattern.** Use it as a reference for how to wire operations:

```typescript
// Reference: client/src/rt-structures/components/RTControlPanel.tsx

// 1. Get provider state
const { 
  rtStructures,
  selection,
  brush,
  pen,
  busy,
  setBrushSize,
  setBrushMode,
  setBrushEnabled,
  setPenMode,
  setPenEnabled,
  setPreviewContours,
  clearPreview,
  setStructures,
  saveHistory,
  setBusy,
} = useRT();

// 2. Create operation wrappers
const handleBooleanPreview = async () => {
  if (!rtStructures || sourceId === null || targetId === null) return;
  setBusy(true);
  try {
    const service = createContourOperationsService();
    const preview = await service.previewBooleanOperation(
      rtStructures,
      sourceId,
      targetId,
      operation
    );
    setPreviewContours(preview);
  } finally {
    setBusy(false);
  }
};

const handleBooleanApply = async () => {
  if (!rtStructures || sourceId === null || targetId === null) return;
  setBusy(true);
  try {
    clearPreview();
    const service = createContourOperationsService();
    const result = await service.booleanOperation(
      rtStructures,
      sourceId,
      targetId,
      operation
    );
    setStructures(result);
    saveHistory(`boolean_${operation}`, sourceId);
  } finally {
    setBusy(false);
  }
};

// 3. Pass to legacy component
return (
  <LegacyBooleanToolbar
    structures={rtStructures?.structures || []}
    onPreview={handleBooleanPreview}
    onApply={handleBooleanApply}
    busy={busy}
  />
);
```

---

## 📚 Reference Documents

**Read these first**:
- `docs/AGENT3_HANDOFF_CLARIFICATION.md` - Why RTControlPanel is reference only
- `docs/RT_PROVIDER_INTEGRATION_GUIDE.md` - How to use RTProvider
- `docs/AGENT5_FINAL_PLAN.md` - Original plan (now confirmed as Option B)
- `docs/UI_MIGRATION_STRATEGY.md` - Migration strategy

**Agent 3's reference code**:
- `client/src/rt-structures/components/RTControlPanel.tsx` - **Study this!**
- `client/src/rt-structures/RTProvider.tsx` - Provider API
- `client/src/rt-structures/services/ContourOperationsService.ts` - All operations

**Legacy components** (to be imported):
- `client/src/components/dicom/viewer-toolbar.tsx`
- `client/src/components/dicom/series-selector.tsx`
- `client/src/components/dicom/contour-edit-toolbar.tsx`
- `client/src/components/dicom/boolean-operations-toolbar-new.tsx`
- `client/src/components/dicom/margin-toolbar.tsx`
- `client/src/components/dicom/fusion-control-panel.tsx`

---

## ✅ Success Criteria

**You're done when**:
1. All legacy UI components are mounted in `/viewer-v2`
2. All features work identically to `/viewer`
3. Visual appearance is identical
4. Performance is equal or better
5. User says: **"I can't tell the difference"**

---

## 🚨 Critical Rules

**DO**:
- ✅ Import legacy components unchanged
- ✅ Create thin adapter wrappers
- ✅ Use Agent 3's RTControlPanel as reference for callbacks
- ✅ Test each component as you add it
- ✅ Maintain existing styling

**DON'T**:
- ❌ Modify legacy component files
- ❌ Create new UI components
- ❌ Change styling or layout
- ❌ Add new features
- ❌ Use Agent 3's RTControlPanel in production (reference only!)

---

## 🎯 Start Here

1. Read this entire document
2. Read the reference documents listed above
3. Start Phase 0: Component Audit
4. Create `docs/LEGACY_UI_INVENTORY.md`
5. Proceed through phases 1-7 in order

---

**Estimated Total**: 28 hours  
**Current Status**: Ready to begin  
**Next Agent**: You (Agent 5)!

Let's build a perfect drop-in replacement! 🚀

