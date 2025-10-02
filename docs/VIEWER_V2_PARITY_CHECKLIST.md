# ViewerV2 Parity Checklist

**Test Date**: 2025-10-02  
**Tester**: Agent 5B  
**Status**: 🔴 IN PROGRESS

---

## 🎯 Testing Instructions

1. Open `/viewer` in one browser tab
2. Open `/viewer-v2` in another tab
3. Use same patient/series for both
4. Test each item below
5. Mark ✅ if identical, ⚠️ if different, ❌ if broken

---

## 📊 Component Presence

### **Core Components**

| Component | Legacy Viewer | ViewerV2 | Status | Notes |
|-----------|---------------|----------|--------|-------|
| PrimaryViewport/Canvas | ✅ WorkingViewer | ✅ PrimaryViewport | ⏳ Untested | Different implementation |
| ViewerToolbar | ✅ Yes (bottom) | ✅ Yes (bottom) | ⏳ Untested | Should match |
| SeriesSelector | ✅ Yes (left) | ✅ Yes (left) | ⏳ Untested | Should match |
| FusionPanel | ✅ Yes | ✅ Yes | ⏳ Untested | Should match |
| RTControlPanel | ✅ Yes | ✅ Yes | ⏳ Untested | Should match |

### **RT Editing Toolbars**

| Component | Legacy Viewer | ViewerV2 | Status | Notes |
|-----------|---------------|----------|--------|-------|
| ContourEditToolbar | ✅ Floating | ✅ Floating | ⏳ Untested | Wired but untested |
| BooleanOperationsToolbar | ✅ Floating | ✅ Floating | ⏳ Untested | Wired but untested |
| MarginToolbar | ✅ Floating | ✅ Floating | ⏳ Untested | Wired but untested |

### **Support Components**

| Component | Legacy Viewer | ViewerV2 | Status | Notes |
|-----------|---------------|----------|--------|-------|
| ErrorModal | ✅ Yes | ❌ Missing | ❌ MISSING | Need to add |
| LoadingProgress | ✅ Yes | ❌ Missing | ❌ MISSING | Need to add |
| FusionDebugDialog | ✅ Yes | ❌ Missing | ⚠️ Optional | Debug tool |

---

## 🖼️ Visual Layout Parity

### **Layout Structure**

- [ ] Toolbar position (bottom center, floating)
- [ ] Toolbar styling (glass effect, icons)
- [ ] Sidebar width matches
- [ ] Sidebar styling matches
- [ ] Panel positioning matches
- [ ] Canvas area size matches
- [ ] Spacing/padding matches
- [ ] Colors match
- [ ] Fonts match
- [ ] Border styles match

### **Responsive Behavior**

- [ ] Window resize handling
- [ ] Panel collapse/expand
- [ ] Toolbar button tooltips
- [ ] Hover states
- [ ] Active states
- [ ] Disabled states

---

## 🔧 Functional Parity

### **Basic DICOM Viewing**

| Feature | Legacy | V2 | Status | Notes |
|---------|--------|----|----|-------|
| Image loads | ⏳ | ⏳ | ⏳ | Untested |
| Pan (middle mouse) | ⏳ | ⏳ | ⏳ | Untested |
| Zoom (scroll wheel) | ⏳ | ⏳ | ⏳ | Untested |
| Window/Level (right drag) | ⏳ | ⏳ | ⏳ | Untested |
| Slice nav (arrow keys) | ⏳ | ⏳ | ⏳ | Untested |
| Slice nav (mouse wheel) | ⏳ | ⏳ | ⏳ | Untested |
| Reset view | ⏳ | ⏳ | ⏳ | Untested |
| Fit to window | ⏳ | ⏳ | ⏳ | Untested |

### **Series Selection**

| Feature | Legacy | V2 | Status | Notes |
|---------|--------|----|----|-------|
| Series list loads | ⏳ | ⏳ | ⏳ | Untested |
| Series thumbnails | ⏳ | ⏳ | ⏳ | Untested |
| Click to switch series | ⏳ | ⏳ | ⏳ | Untested |
| Current series highlighted | ⏳ | ⏳ | ⏳ | Untested |
| Modality icons | ⏳ | ⏳ | ⏳ | Untested |
| Series descriptions | ⏳ | ⏳ | ⏳ | Untested |

### **RT Structures**

| Feature | Legacy | V2 | Status | Notes |
|---------|--------|----|----|-------|
| Structures load | ⏳ | ⏳ | ⏳ | Untested |
| Structures render | ⏳ | ⏳ | ⏳ | Untested |
| Structure colors correct | ⏳ | ⏳ | ⏳ | Untested |
| Toggle visibility | ⏳ | ⏳ | ⏳ | Untested |
| Select structure | ⏳ | ⏳ | ⏳ | Untested |
| Structure list in sidebar | ⏳ | ⏳ | ⏳ | Untested |
| Multi-select (Ctrl+click) | ⏳ | ⏳ | ⏳ | Untested |
| All structures visible toggle | ⏳ | ⏳ | ⏳ | Untested |

### **Contour Editing**

| Feature | Legacy | V2 | Status | Notes |
|---------|--------|----|----|-------|
| "Edit Contours" button | ⏳ | ⏳ | ⏳ | Untested |
| Toolbar appears | ⏳ | ⏳ | ⏳ | Untested |
| Structure name change | ⏳ | ⏳ | ⏳ | Untested |
| Structure color change | ⏳ | ⏳ | ⏳ | Untested |
| Brush tool activates | ⏳ | ⏳ | ⏳ | Untested - likely broken |
| Brush add mode | ⏳ | ⏳ | ⏳ | Untested - likely broken |
| Brush erase mode | ⏳ | ⏳ | ⏳ | Untested - likely broken |
| Brush size adjust | ⏳ | ⏳ | ⏳ | Untested - likely broken |
| Pen tool activates | ⏳ | ⏳ | ⏳ | Untested - likely broken |
| Pen add mode | ⏳ | ⏳ | ⏳ | Untested - likely broken |
| Pen cut mode | ⏳ | ⏳ | ⏳ | Untested - likely broken |
| Delete current slice | ⏳ | ⏳ | ⏳ | Untested |
| Close toolbar | ⏳ | ⏳ | ⏳ | Untested |

### **Boolean Operations**

| Feature | Legacy | V2 | Status | Notes |
|---------|--------|----|----|-------|
| "Boolean Operations" button | ⏳ | ⏳ | ⏳ | Untested |
| Toolbar appears | ⏳ | ⏳ | ⏳ | Untested |
| Structure selection dropdowns | ⏳ | ⏳ | ⏳ | Untested |
| Union preview | ⏳ | ⏳ | ⏳ | Untested |
| Union apply | ⏳ | ⏳ | ⏳ | Untested |
| Subtract preview | ⏳ | ⏳ | ⏳ | Untested |
| Subtract apply | ⏳ | ⏳ | ⏳ | Untested |
| Intersect preview | ⏳ | ⏳ | ⏳ | Untested |
| Intersect apply | ⏳ | ⏳ | ⏳ | Untested |
| Clear preview | ⏳ | ⏳ | ⏳ | Untested |
| Preview renders yellow | ⏳ | ⏳ | ⏳ | Untested |
| New structure creation | ⏳ | ⏳ | ⏳ | Untested |
| Close toolbar | ⏳ | ⏳ | ⏳ | Untested |

### **Margin Operations**

| Feature | Legacy | V2 | Status | Notes |
|---------|--------|----|----|-------|
| "Margin Tool" button | ⏳ | ⏳ | ⏳ | Untested |
| Toolbar appears | ⏳ | ⏳ | ⏳ | Untested |
| Uniform margin UI | ⏳ | ⏳ | ⏳ | Untested |
| Anisotropic margin UI | ⏳ | ⏳ | ⏳ | Untested |
| Directional margin UI | ⏳ | ⏳ | ⏳ | Untested |
| Preview mode | ⏳ | ⏳ | ⏳ | Untested - likely broken |
| Apply mode | ⏳ | ⏳ | ⏳ | Untested - likely broken |
| New structure creation | ⏳ | ⏳ | ⏳ | Untested |
| Close toolbar | ⏳ | ⏳ | ⏳ | Untested |

### **Fusion**

| Feature | Legacy | V2 | Status | Notes |
|---------|--------|----|----|-------|
| Fusion panel appears (CT) | ⏳ | ⏳ | ⏳ | Untested |
| No fusion panel (non-CT) | ⏳ | ⏳ | ⏳ | Untested |
| Secondary series list | ⏳ | ⏳ | ⏳ | Untested |
| Series descriptions show | ⏳ | ⏳ | ⏳ | Track A work |
| Registration options | ⏳ | ⏳ | ⏳ | Track A work |
| Select secondary | ⏳ | ⏳ | ⏳ | Untested |
| Opacity slider | ⏳ | ⏳ | ⏳ | Untested |
| Overlay renders | ⏳ | ⏳ | ⏳ | Untested |
| Overlay aligns | ⏳ | ⏳ | ⏳ | Untested |
| Overlay opacity changes | ⏳ | ⏳ | ⏳ | Untested |
| Window/level on secondary | ⏳ | ⏳ | ⏳ | Untested |
| Switch secondaries | ⏳ | ⏳ | ⏳ | Untested |

### **Undo/Redo**

| Feature | Legacy | V2 | Status | Notes |
|---------|--------|----|----|-------|
| Undo button in toolbar | ⏳ | ⏳ | ⏳ | Untested |
| Redo button in toolbar | ⏳ | ⏳ | ⏳ | Untested |
| Undo disabled when empty | ⏳ | ⏳ | ⏳ | Untested |
| Redo disabled when empty | ⏳ | ⏳ | ⏳ | Untested |
| History dropdown | ⏳ | ⏳ | ⏳ | Untested |
| Jump to history state | ⏳ | ⏳ | ⏳ | Untested |
| Undo after name change | ⏳ | ⏳ | ⏳ | Untested |
| Undo after color change | ⏳ | ⏳ | ⏳ | Untested |
| Undo after boolean op | ⏳ | ⏳ | ⏳ | Untested |
| Undo after margin op | ⏳ | ⏳ | ⏳ | Untested |

### **Keyboard Shortcuts**

| Shortcut | Action | Legacy | V2 | Status |
|----------|--------|--------|----|----|
| Arrow Up | Previous slice | ⏳ | ⏳ | ⏳ |
| Arrow Down | Next slice | ⏳ | ⏳ | ⏳ |
| Delete | Delete slice contours | ⏳ | ⏳ | ⏳ |
| Ctrl+Z | Undo | ⏳ | ⏳ | ⏳ |
| Ctrl+Shift+Z | Redo | ⏳ | ⏳ | ⏳ |
| Escape | Close toolbar | ⏳ | ⏳ | ⏳ |

---

## 🐛 Known Issues

### **Missing Components**:
- ❌ ErrorModal - Not integrated
- ❌ LoadingProgress - Not integrated
- ⚠️ FusionDebugDialog - Optional debug tool

### **Expected Limitations (Agent 3 work)**:
- ⚠️ Brush tool - UI works, canvas interaction needs wiring
- ⚠️ Pen tool - UI works, canvas interaction needs wiring
- ⚠️ Margin execution - UI works, backend algorithm needed

### **Found During Testing**:
(To be filled in during actual testing)

---

## 📈 Test Progress

**Total Items**: 98  
**Tested**: 0  
**Passing**: 0  
**Failing**: 0  
**Untested**: 98

**Progress**: 0%

---

## 🎯 Next Steps

1. ✅ Checklist created
2. ⏳ Add missing ErrorModal
3. ⏳ Add missing LoadingProgress
4. ⏳ Start manual testing
5. ⏳ Document all findings
6. ⏳ Fix issues found
7. ⏳ Request user validation

---

**Status**: 🔴 Testing not started - checklist ready

