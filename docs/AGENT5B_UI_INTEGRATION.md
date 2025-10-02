# Agent 5B: UI Parity & Wiring

**Track**: B (UI Integration)  
**Duration**: ~14 hours  
**Dependencies**: Track A's registration metadata (after hour 6)  
**Status**: Not started

---

## 🎯 Your Mission

Import **legacy UI components** unchanged and wire them to the new providers without changing appearance.

**Goal**: `/viewer-v2` looks and behaves **identically** to `/viewer`.

---

## 📋 Tasks Breakdown

### **Task 1: Series Selector Port** (3 hours)

**Legacy Component**: `client/src/components/dicom/series-selector.tsx`

**Current State**: ViewerV2 has placeholder sidebar

**Your Job**: Wire legacy component to new hooks

**Steps**:

1. **Analyze legacy component** (30 min):
   ```bash
   # Open and document:
   client/src/components/dicom/series-selector.tsx
   ```
   - What props does it expect?
   - What callbacks does it use?
   - How does it get series data?

2. **Create adapter** (1 hour):
   ```typescript
   // client/src/components/viewer/adapters/SeriesSelectorAdapter.tsx
   import { SeriesSelector } from '@/components/dicom/series-selector';
   import { useSeriesSelection } from '@/hooks/use-series-selection';
   import { useNavigate } from 'react-router-dom';
   
   export function SeriesSelectorAdapter({ studyId }: { studyId: number }) {
     const { data: seriesData, isLoading } = useSeriesSelection(studyId);
     const navigate = useNavigate();
     
     const handleSeriesSelect = (seriesId: number) => {
       // Navigate to new series in ViewerV2
       const currentUrl = new URL(window.location.href);
       const patientId = currentUrl.searchParams.get('patientId');
       navigate(`/viewer-v2?patientId=${patientId}&seriesId=${seriesId}&studyId=${studyId}`);
     };
     
     return (
       <SeriesSelector
         series={seriesData?.series || []}
         currentSeriesId={seriesData?.currentSeriesId}
         loading={isLoading}
         onSelectSeries={handleSeriesSelect}
         // ... map all other props
       />
     );
   }
   ```

3. **Mount in ViewerV2** (30 min):
   ```typescript
   // client/src/components/viewer/ViewerV2.tsx
   import { SeriesSelectorAdapter } from './adapters/SeriesSelectorAdapter';
   
   <ViewerShell
     sidebar={<SeriesSelectorAdapter studyId={studyId} />}
     // ...
   />
   ```

4. **Test** (1 hour):
   - Visual match with `/viewer` sidebar
   - Series list loads
   - Clicking series switches view
   - Current series highlighted
   - Loading state works

**Deliverable**: Series selector works and looks identical to legacy

---

### **Task 2: RT Toolbars Wiring** (6 hours)

**Critical**: Use Agent 3's `RTControlPanelDemo.tsx` as your wiring reference!

**Legacy Components**:
- `client/src/components/dicom/contour-edit-toolbar.tsx` (brush + pen)
- `client/src/components/dicom/boolean-operations-toolbar-new.tsx` (boolean ops)
- `client/src/components/dicom/grow-margin-toolbar.tsx` (margins, grow/shrink)

---

#### **2a. Contour Edit Toolbar** (2 hours)

**Legacy**: `contour-edit-toolbar.tsx`

**Create Adapter**:
```typescript
// client/src/components/viewer/adapters/ContourEditToolbarAdapter.tsx
import { ContourEditToolbar } from '@/components/dicom/contour-edit-toolbar';
import { useRT } from '@/rt-structures/RTProvider';

export function ContourEditToolbarAdapter() {
  const {
    brush,
    pen,
    setBrushSize,
    setBrushMode,
    setBrushEnabled,
    setPenMode,
    setPenEnabled,
  } = useRT();
  
  const handleBrushSizeChange = (size: number) => {
    setBrushSize(size);
  };
  
  const handleBrushModeToggle = (mode: 'add' | 'erase') => {
    setBrushMode(mode);
    setBrushEnabled(true);
    setPenEnabled(false); // Disable pen when brush active
  };
  
  const handlePenModeToggle = (mode: 'add' | 'cut') => {
    setPenMode(mode);
    setPenEnabled(true);
    setBrushEnabled(false); // Disable brush when pen active
  };
  
  return (
    <ContourEditToolbar
      brushSize={brush.size}
      brushMode={brush.mode}
      brushEnabled={brush.enabled}
      penMode={pen.mode}
      penEnabled={pen.enabled}
      onBrushSizeChange={handleBrushSizeChange}
      onBrushModeChange={handleBrushModeToggle}
      onPenModeChange={handlePenModeToggle}
      // ... map all other props
    />
  );
}
```

**Reference Pattern**: See `RTControlPanelDemo.tsx` lines 22-42 for exact pattern.

---

#### **2b. Boolean Operations Toolbar** (2 hours)

**Legacy**: `boolean-operations-toolbar-new.tsx`

**Create Adapter**:
```typescript
// client/src/components/viewer/adapters/BooleanOpsToolbarAdapter.tsx
import { BooleanOperationsToolbar } from '@/components/dicom/boolean-operations-toolbar-new';
import { useRT } from '@/rt-structures/RTProvider';
import { createContourOperationsService } from '@/rt-structures/services/ContourOperationsService';

export function BooleanOpsToolbarAdapter() {
  const {
    rtStructures,
    setStructures,
    saveHistory,
    setPreviewContours,
    clearPreview,
    busy,
    setBusy,
  } = useRT();
  
  const handleBooleanPreview = async (
    sourceId: number,
    targetId: number,
    op: 'union' | 'subtract' | 'intersect'
  ) => {
    if (!rtStructures) return;
    setBusy(true);
    try {
      const service = createContourOperationsService();
      const preview = await service.previewBooleanOperation(
        rtStructures,
        sourceId,
        targetId,
        op
      );
      setPreviewContours(preview);
    } finally {
      setBusy(false);
    }
  };
  
  const handleBooleanApply = async (
    sourceId: number,
    targetId: number,
    op: 'union' | 'subtract' | 'intersect'
  ) => {
    if (!rtStructures) return;
    setBusy(true);
    try {
      clearPreview();
      const service = createContourOperationsService();
      const result = await service.booleanOperation(
        rtStructures,
        sourceId,
        targetId,
        op
      );
      setStructures(result);
      saveHistory(`boolean_${op}`, sourceId);
    } finally {
      setBusy(false);
    }
  };
  
  return (
    <BooleanOperationsToolbar
      structures={rtStructures?.structures || []}
      onPreview={handleBooleanPreview}
      onApply={handleBooleanApply}
      onClearPreview={clearPreview}
      busy={busy}
      // ... map all other props
    />
  );
}
```

**Reference Pattern**: See `RTControlPanelDemo.tsx` lines 47-74 for exact pattern.

---

#### **2c. Margin/Grow Toolbar** (2 hours)

**Legacy**: `grow-margin-toolbar.tsx`

**Create Adapter**: Similar pattern, wire to `ContourOperationsService`:
- `applyUniformMargin`
- `applyAnisotropicMargin`
- `applyGrowStructure`

**Reference**: `RT_PROVIDER_INTEGRATION_GUIDE.md` has examples.

---

### **Task 3: Fusion Panel Verification** (2 hours)

**Depends on**: Track A completing registration metadata

**Current**: ViewerV2 uses built-in `FusionPanel`

**Your Job**: Verify it matches legacy or swap it

**Steps**:

1. **Wait for Track A** to complete registration metadata (hour 6)

2. **Test current FusionPanel**:
   - Open `/viewer-v2` with CT + PET
   - Check fusion panel shows registration options
   - Compare with `/viewer` fusion panel
   - Check labels, layout, button order

3. **If matches**: Done! ✅

4. **If doesn't match**: Import legacy
   ```typescript
   // Import legacy fusion panel
   import { FusionControlPanel } from '@/components/dicom/fusion-control-panel';
   
   // Create adapter
   // Wire to useFusion() hook
   ```

**Deliverable**: Fusion panel matches legacy appearance

---

### **Task 4: Parity Testing** (3 hours)

**Manual Side-by-Side Checklist**:

#### **Visual Parity**
- [ ] Toolbar layout identical
- [ ] Button icons match
- [ ] Button order matches
- [ ] Panel positions match
- [ ] Series selector layout matches
- [ ] Colors/styling identical
- [ ] Tooltips match

#### **Functional Parity**
**DICOM Viewing**:
- [ ] Pan (middle mouse) works
- [ ] Zoom (scroll wheel) works
- [ ] Window/level (right mouse) works
- [ ] Slice nav (arrow keys) works
- [ ] Keyboard shortcuts work

**RT Structures**:
- [ ] Structures load
- [ ] Select structure
- [ ] Toggle visibility
- [ ] Brush add works
- [ ] Brush erase works
- [ ] Pen tool works
- [ ] Boolean union works
- [ ] Boolean subtract works
- [ ] Boolean intersect works
- [ ] Boolean preview shows
- [ ] Margin expansion works
- [ ] Grow/shrink works
- [ ] Undo works
- [ ] Redo works

**Fusion**:
- [ ] Secondary series loads
- [ ] Opacity slider works
- [ ] Registration options show
- [ ] Switching secondaries works
- [ ] Overlay renders correctly

**Series Selection**:
- [ ] Series list loads
- [ ] Switching series works
- [ ] Current series highlighted

**Capture Results**: Update `docs/UI_COMPARISON.md` with findings

---

## 📝 Coordination with Track A

**Hour 0-6**: Track A working on registration metadata
- **You can**: Port series selector, start RT toolbar adapters (placeholders OK)
- **You can't**: Test fusion panel labels (wait for Track A)

**Hour 6+**: Track A completes registration metadata
- **You can**: Test fusion panel with proper labels
- **You can**: Verify all registration options display correctly

**Communication**: Check `docs/AGENT5_STATUS.md` to see Track A progress

---

## 🔗 Reference Documents

**Wiring Patterns**:
- `client/src/rt-structures/components/RTControlPanelDemo.tsx` - **Study this!**
- `docs/RT_PROVIDER_INTEGRATION_GUIDE.md` - Step-by-step guide

**Legacy Components** (to import):
- `client/src/components/dicom/series-selector.tsx`
- `client/src/components/dicom/contour-edit-toolbar.tsx`
- `client/src/components/dicom/boolean-operations-toolbar-new.tsx`
- `client/src/components/dicom/grow-margin-toolbar.tsx`
- `client/src/components/dicom/fusion-control-panel.tsx`

**Provider APIs**:
- `client/src/rt-structures/RTProvider.tsx` - RT state
- `client/src/fusion/fusion-context.tsx` - Fusion state
- `client/src/hooks/use-series-selection.ts` - Series data

---

## ⚠️ Critical Rules

**DO**:
- ✅ Import legacy components unchanged (no modifications!)
- ✅ Create thin adapter wrappers
- ✅ Use RTControlPanelDemo as reference
- ✅ Test each component as you add it
- ✅ Update status doc frequently

**DON'T**:
- ❌ Modify legacy component files
- ❌ Create new UI from scratch
- ❌ Change styling or layout
- ❌ Add new features
- ❌ Skip testing

---

## ✅ Done Criteria

You're done when:
1. ✅ All legacy UI components mounted
2. ✅ Side-by-side parity checklist 100% pass
3. ✅ User says: "I can't tell the difference"

**Estimated**: 14 hours  
**Current**: Not started

---

## 🚀 Start Here

1. Read this document completely
2. Read `docs/RT_PROVIDER_INTEGRATION_GUIDE.md`
3. Study `client/src/rt-structures/components/RTControlPanelDemo.tsx`
4. Update `docs/AGENT5_STATUS.md` - mark Track B started
5. Start with Task 1 (Series Selector)
6. Test as you go

Good luck! 🎯

