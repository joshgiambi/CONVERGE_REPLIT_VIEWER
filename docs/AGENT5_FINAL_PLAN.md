# Agent 5: Final Integration Plan

**Last Updated**: 2025-10-02  
**Status**: Ready to start  
**Mission**: Import legacy UI components unchanged, wire to new backend

---

## 🎯 Core Principle

**DO NOT modify existing UI components**. Import them as-is from `client/src/components/dicom/` and wire to new providers via thin wrapper components (adapters).

**Architecture**: Hybrid
- **NEW**: Render core (PrimaryViewport, providers, services, hooks)
- **REUSE**: ALL UI components (toolbars, panels, styling)
- **NEW**: Plumbing layer (adapters connect old UI to new backend)

---

## 📋 7-PHASE WORK PLAN

### **PHASE 0: DISCOVERY & MAPPING** (2 hours)

**Goal**: Audit all legacy components, map props to new architecture

**Create**: `docs/AGENT5_COMPONENT_MAPPING.md`

**For each component, document**:
- Props expected
- Callbacks it fires
- State it reads  
- Maps to which provider/hook?
- Adapter complexity (Low/Medium/High)

**Components to audit**:
- `viewer-toolbar.tsx`
- `contour-edit-toolbar.tsx`
- `boolean-operations-toolbar-new.tsx`
- `margin-toolbar.tsx`
- `simple-brush-tool.tsx`
- `fusion-control-panel.tsx`
- `series-selector.tsx`

**Deliverable**: Spreadsheet/doc with complete prop mapping

---

### **PHASE 1: MOUNT NEW RENDER CORE** (2 hours)

**Goal**: PrimaryViewport rendering with providers

```tsx
<RTProvider>
  <FusionProvider primarySeriesId={seriesId}>
    <ViewerShell>
      <PrimaryViewport seriesId={seriesId}>
        <FusionOverlayLayer />
        <RTOverlayLayer />
      </PrimaryViewport>
    </ViewerShell>
  </FusionProvider>
</RTProvider>
```

**Test**: CT images load and render

---

### **PHASE 2: IMPORT MAIN TOOLBAR** (4 hours)

**Create**: `components/viewer/adapters/ViewerToolbarAdapter.tsx`

**Pattern**:
```tsx
import { ViewerToolbar } from '@/components/dicom/viewer-toolbar';

export function ViewerToolbarAdapter() {
  // Get data from new architecture
  const { currentIndex, images } = useDICOMImages();
  const { isPanMode } = useViewportTools();
  
  // Map to legacy props
  return (
    <ViewerToolbar
      currentSlice={currentIndex}
      totalSlices={images.length}
      isPanActive={isPanMode}
      // ... all other props
    />
  );
}
```

**Mount**: Position exactly like `/viewer` (bottom center, floating)

**Test**: All toolbar buttons work

---

### **PHASE 3: IMPORT RT TOOLBARS** (8 hours)

**Create adapters for**:
- `ContourEditToolbarAdapter` (3h)
- `BooleanOperationsToolbarAdapter` (3h)
- `MarginToolbarAdapter` (2h)

**Each follows same pattern**:
1. Import legacy component unchanged
2. Get data from `useRT()` hook
3. Transform to legacy prop shape
4. Return legacy component

**Test**: Each toolbar functions identically to `/viewer`

---

### **PHASE 4: IMPORT FUSION PANEL** (3 hours)

**Create**: `FusionControlPanelAdapter.tsx`

**Wire to**: `useFusion()`, `useFusionPanel()`, `useRegistrationOptions()`

**Position**: Same as `/viewer`

**Test**: Fusion controls work, PET overlay displays

---

### **PHASE 5: IMPORT SERIES SELECTOR** (3 hours)

**Create**: `SeriesSelectorAdapter.tsx`

**Wire to**: `useSeriesData()`

**Mount**: In ViewerShell sidebar slot

**Test**: Can select series, viewport updates

---

### **PHASE 6: REGRESSION TESTING** (4 hours)

**Side-by-side comparison**:
- Open `/viewer` (left window)
- Open `/viewer-v2` (right window)
- Perform identical workflows
- Document ANY differences

**Test workflows**:
- Load series
- Zoom/pan/window-level
- Select RT structure
- Edit with brush
- Boolean operation
- Add margin  
- PET/CT fusion
- Change series

**Fix gaps** until 100% identical

---

### **PHASE 7: USER VALIDATION** (2 hours)

**User performs tasks in `/viewer-v2`**:
- Does it feel the same?
- Any differences?
- Ready to ship?

**Must get**: User approval before deploy

**Create**: `docs/VIEWER_V2_MIGRATION_COMPLETE.md`

---

## ✅ SUCCESS CRITERIA

### **Visual**
- [ ] 100% UI elements in same positions
- [ ] 100% styling identical
- [ ] 0 visual differences

### **Functional**
- [ ] 100% workflows preserved
- [ ] All keyboard shortcuts same
- [ ] All mouse interactions same
- [ ] Performance same or better

### **Code**
- [ ] 0 modifications to legacy components
- [ ] All adapters < 100 lines each
- [ ] TypeScript passes
- [ ] 0 console errors

---

## 🚨 CRITICAL RULES

### **DO**:
- ✅ Import legacy components as-is
- ✅ Create wrapper adapters
- ✅ Test after each component
- ✅ Get user approval at milestones

### **DON'T**:
- ❌ Modify legacy component files
- ❌ Change styling/markup  
- ❌ Redesign UI
- ❌ "Improve" while porting

---

## ⏱️ TIMELINE

| Phase | Hours |
|-------|-------|
| 0: Discovery | 2 |
| 1: Render Core | 2 |
| 2: Main Toolbar | 4 |
| 3: RT Toolbars | 8 |
| 4: Fusion Panel | 3 |
| 5: Series Selector | 3 |
| 6: Regression | 4 |
| 7: User Validation | 2 |
| **TOTAL** | **28 hours** |

**Calendar**: 2 weeks with testing

---

## 💡 ADAPTER PATTERN

**Use Option A: Wrapper Components**

```tsx
// Every adapter follows this pattern
export function LegacyComponentAdapter(adapterProps) {
  // 1. Get data from new providers
  const data = useNewProvider();
  
  // 2. Transform to legacy shape
  const legacyProps = mapProps(data);
  
  // 3. Return unchanged component
  return <LegacyComponent {...legacyProps} />;
}
```

**Why**: Clearest, easiest to debug, TypeScript friendly

---

## 📚 FILES TO IMPORT

**ALL from** `client/src/components/dicom/`:
- `viewer-toolbar.tsx`
- `contour-edit-toolbar.tsx`
- `boolean-operations-toolbar-new.tsx`
- `margin-toolbar.tsx`
- `simple-brush-tool.tsx`
- `fusion-control-panel.tsx`
- `series-selector.tsx`
- Any other UI components

**NO modifications to any of these files**

---

## 🎓 SUCCESS = USER SAYS

*"I can't tell the difference"*

---

**Agent 5 Mantra**: *"Import as-is, wire with adapters, test relentlessly"*

