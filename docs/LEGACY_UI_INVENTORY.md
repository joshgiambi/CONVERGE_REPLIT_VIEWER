# Legacy UI Component Inventory

**Created**: 2025-10-02 by Agent 5  
**Purpose**: Comprehensive audit of legacy UI components that need to be imported into ViewerV2

---

## 🎯 Mission Overview

**Goal**: Import all legacy UI components into ViewerV2 to achieve 100% visual parity with `/viewer`

**Approach**: 
1. Identify all legacy UI components
2. Create adapter components where needed
3. Wire to RTProvider/FusionProvider state
4. Mount in ViewerV2 slots (toolbar, sidebar, panels)
5. Visual regression testing

---

## 📦 Component Inventory

### **1. Main Toolbar** (`viewer-toolbar.tsx`)

**Location**: `client/src/components/dicom/viewer-toolbar.tsx`  
**Status**: ❌ Not imported  
**Target Slot**: `ViewerV2` → `toolbar`

**Features**:
- Zoom controls (in/out/fit)
- Pan tool
- Measure tool
- Crosshairs tool
- Contour edit button (opens ContourEditToolbar)
- Boolean operations button (opens BooleanOperationsToolbar)
- Advanced margin tool button (opens MarginToolbar)
- History panel toggle
- Window/level presets
- RT structure loading
- Series info display

**Current State**: ViewerV2 uses simple `ViewportControls` component  
**Action Required**: Replace with full `ViewerToolbar` or create adapter

---

### **2. Series Selector** (`series-selector.tsx`)

**Location**: `client/src/components/dicom/series-selector.tsx`  
**Status**: ❌ Not imported  
**Target Slot**: `ViewerV2` → `sidebar`

**Features**:
- Series list with thumbnails
- Modality badges
- Image count
- Series description
- Study grouping
- Selection state
- Filter controls (derived/resampled/secondary)

**Current State**: ViewerV2 shows placeholder sidebar  
**Action Required**: Import SeriesSelector and wire to series data

---

### **3. Contour Edit Toolbar** (`contour-edit-toolbar.tsx`)

**Location**: `client/src/components/dicom/contour-edit-toolbar.tsx`  
**Status**: ❌ Not imported  
**Target**: Floating toolbar (triggered by main toolbar button)

**Features**:
- Structure selection
- Structure name/color editing
- Brush tool controls (add/erase, size, 3D mode, smart brush)
- Pen tool controls (add/cut/close)
- Scissors tool
- Grow/shrink controls (with directional options)
- Delete slice/structure
- Undo/redo
- Auto-zoom settings
- Keyboard shortcuts (Delete key, etc.)

**Current State**: Not accessible in ViewerV2  
**Action Required**: Import and wire to RTProvider state (brush/pen)

**Key Integration Points**:
- `brush.size`, `brush.mode`, `brush.enabled` from RTProvider
- `pen.mode`, `pen.enabled` from RTProvider
- `setBrushSize()`, `setBrushMode()`, `setBrushEnabled()`
- `setPenMode()`, `setPenEnabled()`
- Tool exclusivity (only one active at a time)

---

### **4. Boolean Operations Toolbar** (`boolean-operations-toolbar-new.tsx`)

**Location**: `client/src/components/dicom/boolean-operations-toolbar-new.tsx`  
**Status**: ❌ Not imported  
**Target**: Floating toolbar (triggered by main toolbar button)

**Features**:
- Expression parser (union ∪, subtract −, intersect ∩, XOR ⊕)
- Visual A/B/Output selector (panel mode)
- Structure name autocomplete
- Live preview toggle
- Auto-preview when all structures selected
- Preview/Apply/Clear buttons
- Syntax validation
- Pill view for structure tags
- New structure creation
- Color picker

**Current State**: Not accessible in ViewerV2  
**Action Required**: Import and wire to RTProvider preview workflow

**Key Integration Points**:
- `setPreviewContours()` for preview
- `setStructures()` for apply
- `clearPreview()` after apply/cancel
- `saveHistory()` after apply
- `busy` state during operations

---

### **5. Margin Toolbar** (`margin-toolbar.tsx`)

**Location**: `client/src/components/dicom/margin-toolbar.tsx`  
**Status**: ❌ Not imported  
**Target**: Floating toolbar (triggered by main toolbar button)

**Features**:
- Uniform margin input
- Anisotropic margins (anterior/posterior/left/right/superior/inferior)
- Preview/Apply workflow
- Unit selection (mm)
- Structure selection
- Color-coded margin visualization

**Current State**: Not accessible in ViewerV2  
**Action Required**: Import and wire to RTProvider (margins service)

---

### **6. Fusion Control Panel** (`fusion-control-panel.tsx`)

**Location**: `client/src/components/dicom/fusion-control-panel.tsx`  
**Status**: ⚠️ Different component used  
**Target Slot**: `ViewerV2` → `panels` (floating)

**Features**:
- Opacity slider
- Secondary series selector (cards with status badges)
- Window/level presets (by modality)
- Registration method selector
- Manifest error display
- Loading indicators
- Minimize/maximize toggle

**Current State**: ViewerV2 uses newer `FusionPanel` from `client/src/fusion/components/FusionPanel.tsx`  
**Action Required**: Compare both, determine if legacy should replace or if new one is sufficient

**Note**: The new `FusionPanel` wraps the legacy `FusionControlPanel`, so this may already be correct.

---

### **7. RT Control Panel** (Production version)

**Location**: `client/src/rt-structures/components/RTControlPanel.tsx`  
**Status**: ✅ Already mounted in ViewerV2  
**Target Slot**: `ViewerV2` → `panels` (floating)

**Features**:
- Structure list with visibility toggles
- "Show all" checkbox
- Selection state
- Color indicators
- Load button

**Current State**: Already mounted and working  
**Action Required**: None (already integrated)

---

### **8. Additional Components to Consider**

#### **MPR Floating Windows** (`mpr-floating.tsx`)
- Status: ❌ Not imported
- Used by legacy viewer for sagittal/coronal views
- Floating window implementation
- Action: Determine if needed in ViewerV2

#### **Loading Progress** (`loading-progress.tsx`)
- Status: ❌ Not imported
- Shows image loading progress
- Action: Consider for ViewerV2

#### **Error Modal** (`error-modal.tsx`)
- Status: ❌ Not imported
- Displays errors to user
- Action: Import for error handling

---

## 🔗 Provider Wiring Strategy

### **RTProvider Integration** (for contour tools)

**Components that need wiring**:
1. `ContourEditToolbar` → brush/pen state
2. `BooleanOperationsToolbar` → preview workflow
3. `MarginToolbar` → margin service + preview

**Pattern** (from RTControlPanelDemo):
```typescript
const { 
  brush, pen, busy,
  setBrushMode, setBrushSize, setBrushEnabled,
  setPenMode, setPenEnabled,
  setPreviewContours, clearPreview,
  setStructures, saveHistory
} = useRT();
```

**Key Rules**:
- Call `setBrushEnabled(true); setPenEnabled(false)` for tool exclusivity
- Use `setPreviewContours()` during preview (don't mutate state)
- Only call `setStructures()` when applying (commits changes)
- Always call `saveHistory()` after applying operations
- Use `busy` flag to disable buttons during operations

---

### **FusionProvider Integration** (for fusion panel)

**Component that needs wiring**: `FusionControlPanel` (if replacing)

**Pattern**:
```typescript
const { 
  opacity, setOpacity,
  selectedSecondaryId, setSelectedSecondaryId,
  secondaries, secondaryStateMap,
  manifestStatus, manifestError,
  fusionWindowLevel, setFusionWindowLevel
} = useFusion();
```

---

## 📋 Import Checklist

### **Phase 0: Inventory** ✅
- [x] Create this document
- [x] Identify all legacy components
- [x] Map to ViewerV2 slots

### **Phase 1: Main Toolbar** ❌
- [ ] Import `ViewerToolbar` into ViewerV2
- [ ] Wire zoom/pan/measure handlers
- [ ] Wire RT structure loading
- [ ] Wire toolbar button handlers (contour edit, boolean ops, margins)
- [ ] Test all toolbar buttons

### **Phase 2: Series Selector** ❌
- [ ] Import `SeriesSelector` into ViewerV2 sidebar slot
- [ ] Wire to series data
- [ ] Wire series selection handler
- [ ] Test series switching

### **Phase 3: Contour Edit Toolbar** ❌
- [ ] Create state management for toolbar visibility
- [ ] Import `ContourEditToolbar` as floating component
- [ ] Wire brush controls to RTProvider (`brush` state)
- [ ] Wire pen controls to RTProvider (`pen` state)
- [ ] Implement tool exclusivity logic
- [ ] Wire structure editing (name/color)
- [ ] Wire grow/shrink to service
- [ ] Test all contour tools

### **Phase 4: Boolean Operations Toolbar** ❌
- [ ] Create state management for toolbar visibility
- [ ] Import `BooleanOperationsToolbar` as floating component
- [ ] Wire preview workflow to RTProvider
- [ ] Wire apply workflow with `setStructures()` + `saveHistory()`
- [ ] Test union/subtract/intersect operations

### **Phase 5: Margin Toolbar** ❌
- [ ] Create state management for toolbar visibility
- [ ] Import `MarginToolbar` as floating component
- [ ] Wire to margin service
- [ ] Wire preview/apply workflow
- [ ] Test uniform and anisotropic margins

### **Phase 6: Fusion Panel Review** ❌
- [ ] Compare legacy `FusionControlPanel` vs new `FusionPanel`
- [ ] Determine if replacement needed
- [ ] If needed, swap and wire to FusionProvider
- [ ] Test opacity, secondary selection, window/level

### **Phase 7: Visual Regression Testing** ❌
- [ ] Side-by-side screenshots (`/viewer` vs `/viewer-v2`)
- [ ] Compare toolbar layouts
- [ ] Compare panel positioning
- [ ] Compare button styling
- [ ] Compare fonts, colors, spacing
- [ ] Document any deviations

### **Phase 8: Functional Testing** ❌
- [ ] Test RT structure loading
- [ ] Test brush add/erase
- [ ] Test pen add/cut
- [ ] Test boolean operations (preview + apply)
- [ ] Test margins
- [ ] Test fusion overlay toggle
- [ ] Test fusion opacity control
- [ ] Test undo/redo
- [ ] Test series switching

### **Phase 9: Documentation** ❌
- [ ] Update `UI_INTEGRATION_ARCHITECTURE.md` with completion status
- [ ] Note any deviations from legacy UI
- [ ] Add screenshots to docs folder
- [ ] Update agent handoff notes

---

## 🎨 Styling Considerations

**Rule**: **Zero visual changes** - maintain exact legacy appearance

**Approach**:
1. Import legacy components with all their CSS classes
2. Copy inline styles exactly
3. Use browser DevTools to compare computed styles
4. Match button order, spacing, fonts, colors
5. Preserve all tooltips and keyboard shortcuts

**Testing Method**:
- Open legacy viewer in one browser tab
- Open ViewerV2 in another tab
- Use browser DevTools "Inspect Element"
- Compare side-by-side for exact match

---

## 📊 Progress Tracking

| Component | Import | Wire Providers | Test | Status |
|-----------|--------|----------------|------|--------|
| ViewerToolbar | ❌ | ❌ | ❌ | Not started |
| SeriesSelector | ❌ | ❌ | ❌ | Not started |
| ContourEditToolbar | ❌ | ❌ | ❌ | Not started |
| BooleanOperationsToolbar | ❌ | ❌ | ❌ | Not started |
| MarginToolbar | ❌ | ❌ | ❌ | Not started |
| FusionControlPanel | ⚠️ | ⚠️ | ❌ | Review needed |
| RTControlPanel | ✅ | ✅ | ✅ | Complete |

**Overall Progress**: 1/7 components complete (14%)

---

## 🚀 Next Steps for Agent 5

1. **Start with Main Toolbar** (highest visibility)
   - Import `ViewerToolbar`
   - Replace `ViewportControls` in ViewerV2
   - Wire all handlers

2. **Then Series Selector** (critical for navigation)
   - Import `SeriesSelector`
   - Replace placeholder sidebar
   - Wire series selection

3. **Then RT Toolbars** (most complex)
   - Import all three (contour edit, boolean ops, margins)
   - Wire to RTProvider state
   - Implement floating toolbar management

4. **Finally Testing & Documentation**
   - Visual regression
   - Functional testing
   - Update docs

---

**Last Updated**: 2025-10-02 by Agent 5  
**Status**: Phase 0 Complete - Ready to begin Phase 1 (Main Toolbar Import)

