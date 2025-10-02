# ViewerV2 UI Gaps - Complete Inventory

**Status**: ViewerV2 has viewer core working but is missing major UI elements
**Priority**: **CRITICAL** - Needed before ViewerV2 can replace old viewer
**Owner**: Agent 5 (or whoever takes this handoff)

---

## 🚨 CRITICAL MISSING: Page Header & Navigation

### Old Viewer Has:
**Entire header bar** (`/viewer.tsx` lines 212-310):
- **SUPERBEAM branding** - Fancy gradient logo
- **Patient Info Display** - Shows patient name and ID in header
- **Top Navigation Buttons**:
  - "Patient List" button → Opens patient list in new tab
  - "Save" button → Opens RT structure save dialog
  - "Export" button → Opens DICOM export dialog with series selection

### ViewerV2 Has:
- **NOTHING** - Just the raw viewer component, no page wrapper at all

### What Needs to be Done:
1. Create page header wrapper in `viewer-v2.tsx`
2. Add SUPERBEAM branding
3. Display patient info from bootstrap data
4. Add "Patient List", "Save", "Export" buttons
5. Wire up dialogs for Save and Export functionality

---

## 📋 Missing Dialogs

### 1. **Save RT Structures Dialog**
**Location in old viewer**: `viewer.tsx` lines 341-373
- Input field for series description
- Auto-generates default: "RT Structure Set - {date} {time}"
- Saves to `/api/rt-structures/{id}/save`
- Toast notifications

**Status**: ❌ Not implemented at all in ViewerV2

### 2. **Export DICOM Dialog**
**Location in old viewer**: `viewer.tsx` lines 375-427
- Lists all series for current study
- Checkboxes to select which series to export
- Calls `/api/studies/{id}/export` with selected series IDs
- Downloads ZIP file

**Status**: ❌ Not implemented at all in ViewerV2

---

## 🎨 Missing Styling & Layout

### Old Viewer Layout:
- Fixed header at top with backdrop blur
- Full-screen viewer below header
- Proper z-index stacking
- Animations (`animate-slide-up`)

### ViewerV2 Layout:
- No page structure
- Just raw `<ViewerV2>` component
- No header spacing
- No animations

### What Needs to be Done:
1. Add page wrapper `<div className="min-h-screen bg-dicom-black text-white">`
2. Add header with proper styling
3. Add spacing for viewport below header
4. Match animations and transitions

---

## 🔍 Series Selector Issues

### Current Status:
- ✅ Series selector component IS integrated
- ✅ Shows series list
- ⚠️ **BUT**: Clicking series doesn't navigate (line 76 in ViewerV2.tsx has TODO)

### What Needs to be Done:
```typescript
// In ViewerV2.tsx handleSeriesSelect
const handleSeriesSelect = (series: DICOMSeries) => {
  setCurrentSeriesId(series.id);
  // TODO: Navigate to new series (would need to update URL or notify parent)
  // SHOULD BE: Update URL params and reload ViewerV2
  window.history.pushState({}, '', `/viewer-v2?patientId=${patientId}&seriesId=${series.id}`);
  // Then somehow trigger reload...
};
```

---

## 🛠️ RT Structure Toolbars Status

### What's Integrated:
- ✅ ViewerToolbar (bottom toolbar)
- ✅ ContourEditToolbar (floating when editing)
- ✅ BooleanOperationsToolbar (floating)
- ✅ MarginToolbar (floating)

### What's NOT Working:
- ❌ **Undo/Redo** - Wired to RTProvider but `ViewerToolbarWithUndo` wrapper NOT used in ViewerV2
- ❌ **History dropdown** - Not passed to ViewerToolbar
- ❌ **RT Structure save button** - No dialog to save

### What Needs to be Done:
1. Create `ViewerToolbarWithUndo` wrapper in ViewerV2 (see `viewer-interface.tsx` lines 2246-2308)
2. Pass undo/redo handlers
3. Pass history state for timeline
4. Wire save button to dialog

---

## 🎯 Fusion Panel Issues

### Current Status:
- ✅ FusionPanel component integrated
- ✅ Shows when CT series selected
- ⚠️ **Minimized state** not persisted/controlled properly

### What Needs to be Done:
- Check if minimize toggle works
- Verify registration options display correctly
- Test secondary series selection

---

## 🖼️ Image Metadata Issues

### Current Problem:
**CRITICAL BUG**: `imageMetadata` causing null errors

**Root cause**: `imageMetadata` being passed as `null` in some places (line 570 in ViewerV2.tsx)

### What Needs to be Done:
1. Ensure `onImageMetadataChange` callback from PrimaryViewport updates ViewerV2 state
2. Pass real metadata to ALL toolbars (currently hardcoded `null` in line 570)
3. Test that pen tool, brush tool, and margin operations don't crash

---

## 🔄 State Management Issues

### Old Viewer State Management:
- Single component (`viewer-interface.tsx`) manages ALL state
- Passes state down to child components
- Complex but centralized

### ViewerV2 State Management:
- Split between page (`viewer-v2.tsx`) and component (`ViewerV2.tsx`)
- RTProvider handles RT state
- FusionProvider handles fusion state
- **Problem**: Some state needs coordination (like current series ID)

### What Needs to be Done:
1. Review state flow for series selection
2. Ensure window/level changes propagate correctly
3. Test that zoom/pan state persists during toolbar interactions

---

## 📊 Missing Features

### Not Yet Implemented:
1. ❌ **MPR (Multi-Planar Reconstruction)** - Toggle button exists but doesn't work
2. ❌ **Localization Tool** - Tool referenced but not integrated
3. ❌ **Contour Settings** - Old viewer has width/opacity controls (lines 20 in viewer.tsx)
4. ❌ **Auto-localization** - Old viewer has complex logic (lines 73-149 in viewer-interface.tsx)

### May Not Be Needed Yet:
- CrosshairsMode (old viewer has it)
- MeasureMode (old viewer has it)

---

## ✅ What's Actually Working

### Core Functionality:
- ✅ Image loading and display
- ✅ Window/level adjustments
- ✅ Zoom and pan
- ✅ Slice navigation
- ✅ Series selector UI
- ✅ RT structure display
- ✅ Fusion overlay rendering (when working)
- ✅ Toolbar placement

### Toolbars Integrated:
- ✅ ViewerToolbar (bottom)
- ✅ ContourEditToolbar
- ✅ BooleanOperationsToolbar
- ✅ MarginToolbar
- ✅ SeriesSelector

---

## 🚀 Recommended Fix Order (For Agent 5)

### Phase 1: Critical Page Structure (2-3 hours)
1. **Add page header wrapper** with SUPERBEAM branding
2. **Display patient info** from bootstrap
3. **Add navigation buttons** (Patient List, Save, Export)
4. **Basic layout styling** to match old viewer

### Phase 2: Essential Dialogs (2-3 hours)
5. **Save RT Structures dialog** - Copy from old viewer
6. **Export DICOM dialog** - Copy from old viewer
7. **Wire up API calls** for save and export

### Phase 3: Fix Critical Bugs (1-2 hours)
8. **Fix imageMetadata null errors** - Ensure proper propagation
9. **Fix series navigation** - Make clicking series actually work
10. **Add ViewerToolbarWithUndo wrapper** - Enable undo/redo

### Phase 4: Polish (2-3 hours)
11. **Test all toolbars** with real data
12. **Verify fusion panel** minimizes correctly
13. **Add loading states** for dialogs
14. **Match animations** from old viewer

### Phase 5: Verification (1-2 hours)
15. **Side-by-side comparison** - Old viewer vs ViewerV2
16. **Test all RT operations** (boolean, margins, brush, pen)
17. **Test fusion** with PET/CT
18. **Test save and export**

---

## 📝 Files That Need Editing

### Primary Files:
1. **`client/src/pages/viewer-v2.tsx`** - Add header, dialogs, navigation
2. **`client/src/components/viewer/ViewerV2.tsx`** - Fix metadata, add undo/redo wrapper
3. **New file: `client/src/components/viewer/ViewerV2Header.tsx`** - Extract header component

### Reference Files (Copy from these):
- `client/src/pages/viewer.tsx` - Lines 212-427 (header & dialogs)
- `client/src/components/dicom/viewer-interface.tsx` - Lines 2246-2308 (undo/redo wrapper)

---

## 🎯 Success Criteria

ViewerV2 is ready when:
- [ ] Header with patient info visible
- [ ] Can navigate back to patient list
- [ ] Can save RT structures
- [ ] Can export DICOM
- [ ] Clicking series actually switches series
- [ ] Undo/redo works
- [ ] No null metadata errors
- [ ] All toolbars functional
- [ ] Fusion panel works
- [ ] Looks identical to old viewer

---

## 🚨 Current Blocker

**ViewerV2 won't load at all** - Getting "Unable to load viewer context" error.
Need to check debug output when clicking "Debug Info" to see what's failing.

Possible causes:
- Bootstrap failing to resolve patient
- Series data not loading
- URL params not parsing correctly

**Fix this FIRST before doing any UI work!**

